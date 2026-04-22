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

/**
 * Determine reactivation scenario based on user state & history.
 */
async function getScenario(user) {
  // Check if user has any completed orders
  const orderResult = await db.query(
    `SELECT status FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const lastOrder = orderResult.rows[0];

  if (lastOrder && (lastOrder.status === 'PAID' || lastOrder.status === 'DONE')) {
    return 'post_purchase';
  }

  // Count days inactive
  const daysSince = Math.floor((Date.now() - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24));

  // Abandoned order (started but didn't finish)
  if (['WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT'].includes(user.state)) {
    return 'abandoned_7d';
  }

  if (daysSince <= 5) {
    return 'warm_3d';
  }

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

// Quick nudge messages for stuck-in-order users
const QUICK_NUDGES = {
  WAITING_SIZE: 'Ещё думаешь над размером? Если что — подскажу 👟',
  WAITING_FORM: 'Скинь ФИО, город и телефон — и оформим заказ 🚀',
  WAITING_PAYMENT: 'Напоминаю — заказ ждёт оплаты. Переведи и скинь скрин 💳',
};

// Auto-nudge chain: escalating reminders
// Level 1 (1h): soft check-in
// Level 2 (24h): direct nudge
// Level 3 (3d): reactivation offer
const NUDGE_CHAIN = {
  WAITING_PAYMENT: [
    { afterMin: 60, msg: 'Привет! Всё ок? Заказ ждёт — если есть вопросы, пиши 😊' },
    { afterMin: 1440, msg: 'Напоминаю про заказ 💳 Переведи и скинь скрин — отправим сразу!' },
    { afterMin: 4320, msg: 'Заказ всё ещё ждёт! Может, оформим? Если что-то смущает — скажи, решим 🤝' },
  ],
  WAITING_FORM: [
    { afterMin: 60, msg: 'Осталось совсем чуть-чуть! Скинь ФИО, город и телефон — и оформим 🚀' },
    { afterMin: 1440, msg: 'Привет! Заказ на паузе — жду ФИО, город и телефон одним сообщением 📝' },
    { afterMin: 4320, msg: 'Заказ всё ещё можно оформить! Скинь ФИО, город и телефон — и продолжим 🎁' },
  ],
  WAITING_SIZE: [
    { afterMin: 60, msg: 'Определился с размером? Если надо — помогу подобрать 👟' },
    { afterMin: 1440, msg: 'Привет! Ещё думаешь? Могу показать популярные размеры и модели 😉' },
  ],
};

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
    try {
      const stuck = await users.getStuckInOrder(15);

      for (const user of stuck) {
        try {
          if (!user.ai_enabled) continue;
          if (user.manager_active) continue;

          const chain = NUDGE_CHAIN[user.state];
          if (!chain) continue;

          // Find last AI message time to determine nudge level
          const recentMsgs = await messages.getHistory(user.id, 5);
          const lastAI = recentMsgs.filter(m => m.role === 'ai').pop();
          const lastUser = recentMsgs.filter(m => m.role === 'user').pop();

          // Don't nudge if user sent a message after our last nudge
          if (lastUser && lastAI && new Date(lastUser.created_at) > new Date(lastAI.created_at)) {
            continue; // User replied — stop nudging
          }

          const lastAnyMsg = lastAI || lastUser;
          if (!lastAnyMsg) continue;

          const minutesSince = (Date.now() - new Date(lastAnyMsg.created_at).getTime()) / (1000 * 60);

          // Count how many AI nudges we already sent in a row
          let nudgesSent = 0;
          for (let i = recentMsgs.length - 1; i >= 0; i--) {
            if (recentMsgs[i].role === 'ai') nudgesSent++;
            else break;
          }

          // Pick the right nudge level from chain
          const nextNudge = chain.find((n, idx) => idx >= nudgesSent && minutesSince >= n.afterMin);
          if (!nextNudge) continue;

          // Don't send same level twice
          if (nudgesSent > 0 && lastAI) {
            const lastNudgeAge = (Date.now() - new Date(lastAI.created_at).getTime()) / (1000 * 60);
            if (lastNudgeAge < 30) continue; // At least 30 min between nudges
          }

          await messages.save(user.id, 'ai', nextNudge.msg);
          await bot.sendMessage(user.telegram_id, nextNudge.msg);
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
    console.log('Running daily follow-up...');

    try {
      // Tier 1: warm clients (3+ days inactive, were recently active)
      const warm = await users.getInactive(3);
      // Tier 2: cold clients (14+ days) already included in warm since 14 > 3
      // Filter by tiers
      const now = Date.now();

      for (const user of warm) {
        if (!user.ai_enabled) continue;

        try {
          const daysSince = Math.floor((now - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24));

          // Only send one followup per tier per day
          // Warm: 3-6 days, Abandoned: 7-13 days (and in order states), Cold: 14+
          const scenario = await getScenario(user);

          // Skip warm clients older than 6 days (they'll get abandoned/cold)
          if (scenario === 'warm_3d' && daysSince > 6) continue;
          // Skip abandoned older than 13 days (they'll get cold)
          if (scenario === 'abandoned_7d' && daysSince > 13) continue;

          const message = await buildFollowup(user, scenario);

          if (message) {
            const safeResult = safety.enforce(message, { isScheduled: true, userState: 'FOLLOWUP' });
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

module.exports = { start, getScenario, buildFollowup, QUICK_NUDGES, NUDGE_CHAIN };
