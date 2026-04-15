/**
 * Manager Learning — анализирует сообщения менеджера и сохраняет паттерны.
 * Используется как подсказки для AI при генерации ответов.
 */

const db = require('./index');
const aiSettings = require('./ai_settings');

// Минимальная длина сообщения для сохранения как паттерн
const MIN_LENGTH = 10;
// Максимум паттернов в контексте для AI
const MAX_PATTERNS_FOR_AI = 5;

/**
 * Определить контекст сообщения менеджера по ключевым словам.
 */
function detectContext(text) {
  const lower = text.toLowerCase();
  if (/размер|стелька|см|сантиметр/.test(lower)) return 'size';
  if (/адрес|доставк|фио|телефон/.test(lower)) return 'delivery';
  if (/оплат|перевод|карт|реквизит/.test(lower)) return 'payment';
  if (/дорого|скидк|цена|стоим/.test(lower)) return 'price_objection';
  if (/подумаю|потом|не уверен|сомнева/.test(lower)) return 'hesitation';
  if (/жалоб|возврат|брак|проблем/.test(lower)) return 'complaint';
  if (/привет|здравствуй|добрый/.test(lower)) return 'greeting';
  return 'general';
}

/**
 * Сохранить сообщение менеджера как паттерн (если обучение включено).
 */
async function learnFromManager(text) {
  if (!text || text.length < MIN_LENGTH) return;

  const enabled = await aiSettings.isEnabled('toggle_manager_learning').catch(() => false);
  if (!enabled) return;

  const context = detectContext(text);

  try {
    // Проверяем дубликат (схожий текст уже есть)
    const existing = await db.query(
      'SELECT id FROM manager_patterns WHERE text = $1 LIMIT 1',
      [text.trim()]
    );
    if (existing.rows.length > 0) {
      // Увеличиваем счётчик использования
      await db.query('UPDATE manager_patterns SET usage_count = usage_count + 1 WHERE id = $1', [existing.rows[0].id]);
      return;
    }

    await db.query(
      'INSERT INTO manager_patterns (text, context) VALUES ($1, $2)',
      [text.trim(), context]
    );
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Получить паттерны для AI-контекста по состоянию пользователя.
 */
async function getPatternsForAI(userState) {
  const enabled = await aiSettings.isEnabled('toggle_manager_learning').catch(() => false);
  if (!enabled) return null;

  // Маппинг состояния → контекст
  const contextMap = {
    NEW: 'greeting',
    WAITING_SIZE: 'size',
    WAITING_FORM: 'delivery',
    WAITING_PAYMENT: 'payment',
    PAID: 'general',
    DONE: 'general',
  };

  const context = contextMap[userState] || 'general';

  try {
    const result = await db.query(
      `SELECT text FROM manager_patterns
       WHERE context = $1 OR context = 'general'
       ORDER BY usage_count DESC, created_at DESC
       LIMIT $2`,
      [context, MAX_PATTERNS_FOR_AI]
    );

    if (result.rows.length === 0) return null;

    const patterns = result.rows.map(r => r.text).join('\n- ');
    return `--- ПРИМЕРЫ ОТВЕТОВ МЕНЕДЖЕРА (используй как стиль, не копируй дословно) ---\n- ${patterns}\n--- КОНЕЦ ПРИМЕРОВ ---`;
  } catch (e) {
    return null;
  }
}

module.exports = { learnFromManager, getPatternsForAI };
