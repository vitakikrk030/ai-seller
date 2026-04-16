const cron = require('node-cron');
const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const prompts = require('../db/prompts');
const { deliverOutbox } = require('../telegram/outbox');
const { generateResponse } = require('../ai');
const monitoring = require('../monitoring');
const safety = require('../ai/safety');
const aiSettings = require('../db/ai_settings');
const { buildOrderContext, normalizeUserState } = require('../logic/sales');

/**
 * Determine reactivation scenario based on user state & history.
 */
async function getScenario(user) {
  const orderResult = await db.query(
    `SELECT status FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const lastOrder = orderResult.rows[0];
  const normalizedStatus = lastOrder?.status ? String(lastOrder.status).toLowerCase() : null;

  if (lastOrder && (normalizedStatus === 'payment_verified' || normalizedStatus === 'fulfilled')) {
    return 'post_purchase';
  }

  const daysSince = Math.floor((Date.now() - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24));

  if (normalizeUserState(user.state) === 'COLLECTING') {
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
 * Nudge chain config — only timing lives in code.
 * afterMin — через сколько минут отправлять.
 */
const NUDGE_CHAIN_CONFIG = {
  COLLECTING: [
    { afterMin: 60 },
    { afterMin: 1440 },
    { afterMin: 4320 },
  ],
};

async function buildAutoNudge(user, level) {
  const normalizedState = normalizeUserState(user.state);
  const orderContext = await buildOrderContext({ ...user, state: normalizedState });
  const prompt = `Клиент замолчал в текущем оформлении. Напиши короткое продолжение диалога, которое вернёт его к следующему шагу. Уровень напоминания: ${level}.`;

  return generateResponse(
    { ...user, state: normalizedState },
    prompt,
    {
      orderContext,
      sensorContext: {
        automation: 'nudge',
      },
    }
  );
}

function start() {
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

          const normalizedState = normalizeUserState(user.state);
          const chain = NUDGE_CHAIN_CONFIG[normalizedState];
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

          const msg = await buildAutoNudge(user, nudgesSent + 1);
          if (!msg) continue;

          const safeResult = await safety.enforce(msg, { isScheduled: true, userState: normalizedState });
          console.log(`SEND TO (nudge): ${user.telegram_id} (user.id=${user.id}, state=${normalizedState})`);
          await deliverOutbox({
            telegramId: user.telegram_id,
            user,
            outbox: [{ kind: 'reply', text: safeResult.text }],
            applyDelay: false,
          });
          console.log(`Auto-nudge [${normalizedState} L${nudgesSent + 1}] to user ${user.id}`);
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
            await deliverOutbox({
              telegramId: user.telegram_id,
              user,
              outbox: [{ kind: 'reply', text: safeResult.text }],
              applyDelay: false,
            });
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
