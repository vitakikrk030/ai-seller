/**
 * Analytics Engine — собирает конверсию по этапам воронки,
 * отслеживает где клиент отваливается, какие фразы работают.
 * Revenue Analytics, Error Tracking.
 *
 * Таблицы: funnel_events, ai_errors
 */

const db = require('../db');

// ═══════════════════════════════════════
// СОБЫТИЯ ВОРОНКИ
// ═══════════════════════════════════════

/**
 * Записать событие воронки.
 * @param {number} userId
 * @param {string} event — 'state_enter' | 'state_exit' | 'purchase' | 'drop' | 'escalate' | 'ab_shown' | 'ab_converted'
 * @param {object} meta — { state, intent, ab_variant, response_key }
 */
async function trackEvent(userId, event, meta = {}) {
  try {
    await db.query(
      `INSERT INTO funnel_events (user_id, event, state, intent, ab_variant, response_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        userId,
        event,
        meta.state || null,
        meta.intent || null,
        meta.ab_variant || null,
        meta.response_key || null,
      ]
    );
  } catch (e) {
    // Аналитика не должна ломать основной поток
  }
}

// ═══════════════════════════════════════
// A/B TESTING
// ═══════════════════════════════════════

/**
 * Выбрать вариант A/B теста для пользователя.
 * Детерминированно по userId — один пользователь всегда видит один вариант.
 */
async function pickABVariant(userId, testKey, variants) {
  if (!variants || variants.length === 0) return { variant: null, variantIndex: 0 };
  if (variants.length === 1) return { variant: variants[0], variantIndex: 0 };
  const variantIndex = userId % variants.length;
  return { variant: variants[variantIndex], variantIndex };
}

/**
 * Записать показ A/B варианта.
 */
async function trackABShown(userId, testKey, variant) {
  await trackEvent(userId, 'ab_shown', { ab_variant: `${testKey}:${variant}` });
}

/**
 * Получить результаты A/B тестов (используется optimizer.js::autoOptimizeAB).
 */
async function getABResults(testKey, days = 30) {
  try {
    const result = await db.query(
      `SELECT
         ab_variant,
         COUNT(*) FILTER (WHERE event = 'ab_shown') as shown,
         COUNT(*) FILTER (WHERE event = 'ab_converted') as converted,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE event = 'ab_converted') /
           NULLIF(COUNT(*) FILTER (WHERE event = 'ab_shown'), 0), 1
         ) as conversion_pct
       FROM funnel_events
       WHERE ab_variant LIKE $1
         AND created_at > NOW() - INTERVAL '${parseInt(days)} days'
       GROUP BY ab_variant
       ORDER BY conversion_pct DESC NULLS LAST`,
      [`${testKey}:%`]
    );
    return result.rows;
  } catch (e) {
    return [];
  }
}

// ═══════════════════════════════════════
// ERROR TRACKING
// ═══════════════════════════════════════

async function trackError(userId, category, meta = {}) {
  try {
    await db.query(
      `INSERT INTO ai_errors (user_id, category, state, intent, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, category, meta.state || null, meta.intent || null,
       meta.details ? JSON.stringify(meta.details).substring(0, 500) : null]
    );
  } catch (e) { /* не ломаем основной поток */ }
}

module.exports = {
  trackEvent, trackError,
  pickABVariant, trackABShown,
  getABResults,
};
