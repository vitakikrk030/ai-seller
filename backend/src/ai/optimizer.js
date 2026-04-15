/**
 * Optimizer — самообучающийся слой AI-системы продаж.
 *
 * Содержит:
 * 1. Auto A/B Optimization — авто-выбор победителя
 * 2. Dialog Score — оценка диалога 0-100
 * 3. Strategy Engine — выбор стратегии по heat+score+segment
 * 4. Recovery Engine — возврат молчащих клиентов
 * 5. Self Learning Loop — цикл улучшения
 */

const db = require('../db');
const aiSettings = require('../db/ai_settings');
const analytics = require('./analytics');

// ═══════════════════════════════════════
// 1. AUTO A/B OPTIMIZATION
// ═══════════════════════════════════════

const MIN_SHOWS_FOR_DECISION = 50; // минимум показов для выбора победителя
const MIN_CONVERSION_DIFF = 5;     // минимальная разница в % для смены варианта

/**
 * Проверить и применить авто-оптимизацию A/B теста.
 * Если вариант B конвертирует лучше A на MIN_CONVERSION_DIFF% — делает его основным.
 */
async function autoOptimizeAB(testKey) {
  try {
    const results = await analytics.getABResults(testKey, 30);
    if (!results || results.length < 2) return null;

    // Находим лучший вариант
    const sorted = results
      .filter(r => parseInt(r.shown) >= MIN_SHOWS_FOR_DECISION)
      .sort((a, b) => parseFloat(b.conversion_pct || 0) - parseFloat(a.conversion_pct || 0));

    if (sorted.length < 2) return { status: 'insufficient_data', testKey };

    const winner = sorted[0];
    const loser = sorted[1];
    const diff = parseFloat(winner.conversion_pct || 0) - parseFloat(loser.conversion_pct || 0);

    if (diff >= MIN_CONVERSION_DIFF) {
      // Победитель определён — обновляем основную фразу
      const winnerKey = winner.ab_variant.replace(`${testKey}:`, '');
      const winnerText = await aiSettings.getRaw(winnerKey).catch(() => null);

      if (winnerText) {
        // Обновляем основную фразу (например speech_pushdown для pushdown теста)
        const mainKey = testKey === 'pushdown' ? 'speech_pushdown'
          : testKey === 'greeting' ? 'speech_greeting'
          : testKey === 'upsell' ? 'upsell_hint'
          : null;

        if (mainKey) {
          await aiSettings.set(mainKey, winnerText);
          aiSettings.invalidateCache();

          // Логируем оптимизацию
          await db.query(
            `INSERT INTO funnel_events (user_id, event, ab_variant, response_key, created_at)
             VALUES (0, 'ab_optimized', $1, $2, NOW())`,
            [`${testKey}:${winnerKey}`, `diff:${diff.toFixed(1)}%`]
          ).catch(() => {});

          return { status: 'optimized', testKey, winner: winnerKey, diff: diff.toFixed(1) };
        }
      }
    }

    return { status: 'no_winner_yet', testKey, diff: diff.toFixed(1) };
  } catch (e) {
    return { status: 'error', testKey, error: e.message };
  }
}

/**
 * Запустить авто-оптимизацию всех A/B тестов.
 */
async function runAutoOptimization() {
  const tests = ['pushdown', 'greeting', 'upsell'];
  const results = [];
  for (const test of tests) {
    const r = await autoOptimizeAB(test);
    if (r) results.push(r);
  }
  return results;
}

// ═══════════════════════════════════════
// 2. DIALOG SCORE
// ═══════════════════════════════════════

/**
 * Рассчитать score диалога (0-100).
 *
 * Компоненты:
 * - Прогресс в воронке (0-40 баллов)
 * - Активность клиента (0-20 баллов)
 * - Наличие данных (0-20 баллов)
 * - Intent качество (0-20 баллов)
 */
function calculateDialogScore(user, memory, msgCount, lastIntent) {
  let score = 0;

  // 1. Прогресс в воронке (0-40)
  const stateScores = {
    'NEW': 5,
    'WAITING_SIZE': 15,
    'WAITING_FORM': 25,
    'WAITING_PAYMENT': 35,
    'PAID': 40,
    'DONE': 40,
  };
  score += stateScores[user.state] || 0;

  // 2. Активность клиента (0-20)
  if (msgCount >= 10) score += 20;
  else if (msgCount >= 5) score += 15;
  else if (msgCount >= 3) score += 10;
  else if (msgCount >= 1) score += 5;

  // 3. Наличие данных (0-20)
  if (memory) {
    if (memory.shoe_size || memory.insole_cm) score += 5;
    if (memory.full_name) score += 5;
    if (memory.phone) score += 5;
    if (memory.address) score += 5;
  }

  // 4. Intent качество (0-20)
  const intentScores = {
    'ready_to_buy': 20,
    'payment_confirm': 20,
    'confirmation': 15,
    'product_question': 10,
    'size_question': 10,
    'price_question': 8,
    'doubt': 3,
    'offtopic': 0,
    'complaint': 0,
    'unknown': 2,
  };
  score += intentScores[lastIntent] || 5;

  return Math.min(100, Math.max(0, score));
}

// ═══════════════════════════════════════
// 3. STRATEGY ENGINE
// ═══════════════════════════════════════

/**
 * Выбрать стратегию на основе heat + score + segment.
 *
 * Стратегии:
 * - aggressive  — максимальный дожим, дефицит, прямые вопросы
 * - consultative — помощь в выборе, экспертность, мягкий дожим
 * - premium      — эксклюзивность, качество, VIP обращение
 * - recovery     — возврат клиента, новый аргумент, смена подхода
 */
function selectStrategy({ heatLevel, score, segment, intent, state }) {
  // VIP всегда premium
  if (segment === 'vip') return 'premium';

  // Горячий клиент близко к покупке — aggressive
  if (heatLevel === 'hot' && score >= 60) return 'aggressive';

  // Сомнение — consultative или aggressive в зависимости от score
  if (intent === 'doubt') {
    return score >= 40 ? 'aggressive' : 'consultative';
  }

  // Холодный клиент — recovery
  if (heatLevel === 'cold') return 'recovery';

  // Низкий score — consultative
  if (score < 30) return 'consultative';

  // Средний score, тёплый — consultative
  if (heatLevel === 'warm' && score < 60) return 'consultative';

  // По умолчанию — aggressive для горячих, consultative для остальных
  return heatLevel === 'hot' ? 'aggressive' : 'consultative';
}

/**
 * Получить инструкцию для стратегии.
 */
async function getStrategyHint(strategy, score) {
  const hints = {
    aggressive: `СТРАТЕГИЯ: Агрессивное закрытие. Используй дефицит ("размеры тают"), социальное доказательство, прямой вопрос "Берёшь?". Score клиента: ${score}/100.`,
    consultative: `СТРАТЕГИЯ: Консультативные продажи. Помоги выбрать, задай уточняющий вопрос, покажи экспертность. Score клиента: ${score}/100.`,
    premium: `СТРАТЕГИЯ: Премиум обслуживание. Подчеркни эксклюзивность, качество, особое отношение. Score клиента: ${score}/100.`,
    recovery: `СТРАТЕГИЯ: Возврат клиента. Предложи новый аргумент, смени подход, создай срочность. Score клиента: ${score}/100.`,
  };
  return hints[strategy] || hints.consultative;
}

// ═══════════════════════════════════════
// 4. SELF LEARNING LOOP
// ═══════════════════════════════════════

/**
 * Запустить цикл самообучения.
 * Вызывается по расписанию (раз в час).
 */
async function runSelfLearningLoop() {
  const results = {
    timestamp: new Date().toISOString(),
    ab_optimization: [],
    errors: [],
  };

  try {
    // 1. Авто-оптимизация A/B тестов
    results.ab_optimization = await runAutoOptimization();

    // 2. Логируем запуск цикла
    await db.query(
      `INSERT INTO funnel_events (user_id, event, response_key, created_at)
       VALUES (0, 'learning_loop', $1, NOW())`,
      [JSON.stringify({ ab: results.ab_optimization.length })]
    ).catch(() => {});

  } catch (e) {
    results.errors.push(e.message);
  }

  return results;
}

module.exports = {
  autoOptimizeAB,
  runAutoOptimization,
  calculateDialogScore,
  selectStrategy,
  getStrategyHint,
  runSelfLearningLoop,
};
