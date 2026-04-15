const cron = require('node-cron');
const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const prompts = require('../db/prompts');
const bot = require('../telegram/bot');
const { generateResponse } = require('../ai');
const monitoring = require('../monitoring');
const memory = require('../db/memory');
const safety = require('../ai/safety');
const aiSettings = require('../db/ai_settings');

/**
 * Determine reactivation scenario based on user state & history.
 */
async function getScenario(user) {
  const orderResult = await db.query(
    `SELECT status FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const lastOrder = orderResult.rows[0];

  if (lastOrder && (lastOrder.status === 'PAID' || lastOrder.status === 'DONE')) {
    return 'post_purchase';
  }

  const daysSince = Math.floor((Date.now() - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24));

  if (['WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT'].includes(user.state)) {
    return 'abandoned_7d';
  }

  if (daysSince <= 5) return 'warm_3d';
  return 'cold_14d';
}

/**
 * Build followup message for a specific scenario.
 */
async function buildFollowup(user, scenario) {
  const followupTemplate = await prompts.get('followup_prompt');
  const prompt = followupTemplate.replace('{{scenario}}', scenario);

  const message = await generateResponse(
    { ...user, state: 'FOLLOWUP' },
    prompt,
    { scenario }
  );

  return message;
}

/**
 * Nudge chain config — тексты берутся из AI Settings по ключу.
 * afterMin — через сколько минут отправлять.
 */
const NUDGE_CHAIN_CONFIG = {
  WAITING_PAYMENT: [
    { afterMin: 60,   key: 'nudge_payment_1h',   closerKey: 'nudge_payment_closer_1h' },
    { afterMin: 1440, key: 'nudge_payment_24h',  closerKey: 'nudge_payment_closer_24h' },
    { afterMin: 4320, key: 'nudge_payment_3d' },
  ],
  WAITING_FORM: [
    { afterMin: 60,   key: 'nudge_form_1h',      closerKey: 'nudge_form_closer_1h' },
    { afterMin: 1440, key: 'nudge_form_24h' },
    { afterMin: 4320, key: 'nudge_form_3d' },
  ],
  WAITING_SIZE: [
    { afterMin: 60,   key: 'nudge_size_1h' },
    { afterMin: 1440, key: 'nudge_size_24h' },
  ],
};

function start() {
  // Self Learning Loop — каждый час авто-оптимизация A/B тестов
  cron.schedule('0 * * * *', async () => {
    try {
      const { runSelfLearningLoop } = require('../ai/optimizer');
      const result = await runSelfLearningLoop();
      if (result.ab_optimization?.some(r => r.status === 'optimized')) {
        console.log('Self-learning: A/B optimized', result.ab_optimization.filter(r => r.status === 'optimized'));
      }
    } catch (err) {
      console.error('Self-learning loop error:', err.message);
    }
  });

  // Clear stale manager_active flags every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    monitoring.schedulerHeartbeat();
    try {
      const cleared = await users.clearStaleManagers(30);
      if (cleared.length > 0) {
        console.log(`Manager timeout: cleared ${cleared.length} users`);
      }
    } catch (err) {
      console.error('Manager timeout error:', err.message);
    }
  });

  // Fast followup: every 15 min — auto-nudge chain for stuck users
  cron.schedule('*/15 * * * *', async () => {
    // Проверяем тумблер напоминаний
    const remindersEnabled = await aiSettings.isEnabled('toggle_reminders').catch(() => true);
    if (!remindersEnabled) return;

    try {
      const stuck = await users.getStuckInOrder(15);

      for (const user of stuck) {
        try {
          if (!user.ai_enabled) continue;
          if (user.manager_active) continue;

          const chain = NUDGE_CHAIN_CONFIG[user.state];
          if (!chain) continue;

          const recentMsgs = await messages.getHistory(user.id, 5);
          const lastAI = recentMsgs.filter(m => m.role === 'ai').pop();
          const lastUser = recentMsgs.filter(m => m.role === 'user').pop();

          if (lastUser && lastAI && new Date(lastUser.created_at) > new Date(lastAI.created_at)) {
            continue;
          }

          const lastAnyMsg = lastAI || lastUser;
          if (!lastAnyMsg) continue;

          const minutesSince = (Date.now() - new Date(lastAnyMsg.created_at).getTime()) / (1000 * 60);

          let nudgesSent = 0;
          for (let i = recentMsgs.length - 1; i >= 0; i--) {
            if (recentMsgs[i].role === 'ai') nudgesSent++;
            else break;
          }

          const nextNudgeCfg = chain.find((n, idx) => idx >= nudgesSent && minutesSince >= n.afterMin);
          if (!nextNudgeCfg) continue;

          if (nudgesSent > 0 && lastAI) {
            const lastNudgeAge = (Date.now() - new Date(lastAI.created_at).getTime()) / (1000 * 60);
            if (lastNudgeAge < 30) continue;
          }

          // Получаем текст из AI Settings — closer режим использует агрессивные дожимы
          const closerActive = await aiSettings.isEnabled('closer_mode_enabled').catch(() => false)
            || (await aiSettings.getRaw('sales_style_preset').catch(() => '')) === 'closer';
          const nudgeKey = (closerActive && nextNudgeCfg.closerKey) ? nextNudgeCfg.closerKey : nextNudgeCfg.key;
          const msg = await aiSettings.getNudge(nudgeKey) || await aiSettings.getNudge(nextNudgeCfg.key);
          if (!msg) continue;

          await messages.save(user.id, 'ai', msg);
          console.log(`SEND TO (nudge): ${user.telegram_id} (user.id=${user.id}, state=${user.state})`);
          await bot.sendMessage(user.telegram_id, msg);
          console.log(`Auto-nudge [${user.state} L${nudgesSent + 1}] to user ${user.id}`);
        } catch (err) {
          console.error(`Auto-nudge error for user ${user.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Auto-nudge scheduler error:', err.message);
    }
  });

  // Run every day at 12:00 — multi-tier reactivation
  cron.schedule('0 12 * * *', async () => {
    // Проверяем тумблер повторных продаж
    const repeatSalesEnabled = await aiSettings.isEnabled('toggle_repeat_sales').catch(() => true);
    if (!repeatSalesEnabled) return;

    console.log('Running daily follow-up...');

    try {
      const warm = await users.getInactive(3);
      const now = Date.now();

      for (const user of warm) {
        if (!user.ai_enabled) continue;

        try {
          const daysSince = Math.floor((now - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24));
          const scenario = await getScenario(user);

          if (scenario === 'warm_3d' && daysSince > 6) continue;
          if (scenario === 'abandoned_7d' && daysSince > 13) continue;

          const message = await buildFollowup(user, scenario);

          if (message) {
            const safeResult = await safety.enforce(message, { isScheduled: true, userState: 'FOLLOWUP' });
            await messages.save(user.id, 'ai', safeResult.text);
            await bot.sendMessage(user.telegram_id, safeResult.text);
            await db.query('UPDATE users SET last_seen = NOW() WHERE id = $1', [user.id]);
            console.log(`Follow-up [${scenario}] sent to user ${user.id} (${daysSince}d inactive)`);
          }
        } catch (err) {
          console.error(`Follow-up error for user ${user.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Scheduler error:', err.message);
    }
  });

  console.log('Scheduler started');
}

module.exports = { start, getScenario, buildFollowup, NUDGE_CHAIN_CONFIG };
