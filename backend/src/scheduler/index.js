const cron = require('node-cron');
const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const prompts = require('../db/prompts');
const bot = require('../telegram/bot');
const { generateResponse } = require('../ai');

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
  WAITING_FORM: 'Скинь ФИО, телефон и адрес — и оформим заказ 🚀',
  WAITING_PAYMENT: 'Напоминаю — заказ ждёт оплаты. Переведи и скинь скрин 💳',
};

function start() {
  // Clear stale manager_active flags every 10 minutes
  cron.schedule('*/10 * * * *', async () => {
    try {
      const cleared = await users.clearStaleManagers(30);
      if (cleared.length > 0) {
        console.log(`Manager timeout: cleared ${cleared.length} users`);
      }
    } catch (err) {
      console.error('Manager timeout error:', err.message);
    }
  });

  // Fast followup: every 30 min — nudge users stuck in order states
  cron.schedule('*/30 * * * *', async () => {
    try {
      const stuck = await users.getStuckInOrder(30);

      for (const user of stuck) {
        try {
          const nudge = QUICK_NUDGES[user.state];
          if (!nudge) continue;

          // Check if we already sent a nudge recently (avoid double-nudge)
          const recentMsgs = await messages.getHistory(user.id, 1);
          if (recentMsgs.length > 0 && recentMsgs[recentMsgs.length - 1].role === 'ai') {
            // Last message is from AI — don't spam
            const lastMsg = recentMsgs[recentMsgs.length - 1];
            const msgAge = Date.now() - new Date(lastMsg.created_at).getTime();
            if (msgAge < 25 * 60 * 1000) continue; // < 25 min ago
          }

          await messages.save(user.id, 'ai', nudge);
          await bot.sendMessage(user.telegram_id, nudge);
          console.log(`Quick nudge [${user.state}] sent to user ${user.id}`);
        } catch (err) {
          console.error(`Quick nudge error for user ${user.id}:`, err.message);
        }
      }
    } catch (err) {
      console.error('Quick nudge scheduler error:', err.message);
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
            await messages.save(user.id, 'ai', message);
            await bot.sendMessage(user.telegram_id, message);
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

module.exports = { start, getScenario, buildFollowup, QUICK_NUDGES };
