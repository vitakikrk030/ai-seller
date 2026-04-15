const db = require('./index');

// In-memory cache: key → { value, enabled, updatedAt }
let _cache = null;
let _cacheTime = 0;
const CACHE_TTL = 10_000; // 10 секунд

async function _load() {
  const result = await db.query(
    'SELECT key, value, enabled FROM ai_speech_settings ORDER BY category, sort_order'
  );
  const map = {};
  for (const row of result.rows) {
    map[row.key] = { value: row.value, enabled: row.enabled };
  }
  _cache = map;
  _cacheTime = Date.now();
  return map;
}

async function _getCache() {
  if (!_cache || Date.now() - _cacheTime > CACHE_TTL) {
    await _load();
  }
  return _cache;
}

function _invalidate() {
  _cache = null;
  _cacheTime = 0;
}

const aiSettings = {
  /**
   * Получить значение по ключу.
   * Если тумблер выключен (enabled=false) — возвращает null.
   */
  async get(key) {
    const cache = await _getCache();
    const entry = cache[key];
    if (!entry) return null;
    if (entry.enabled === false) return null;
    return entry.value;
  },

  /**
   * Получить значение по ключу независимо от enabled.
   */
  async getRaw(key) {
    const cache = await _getCache();
    return cache[key]?.value ?? null;
  },

  /**
   * Проверить, включён ли тумблер.
   */
  async isEnabled(key) {
    const cache = await _getCache();
    const entry = cache[key];
    if (!entry) return false;
    return entry.enabled !== false && entry.value !== 'false';
  },

  /**
   * Получить все записи по категории.
   */
  async getByCategory(category) {
    const result = await db.query(
      'SELECT * FROM ai_speech_settings WHERE category = $1 ORDER BY sort_order',
      [category]
    );
    return result.rows;
  },

  /**
   * Получить все записи.
   */
  async getAll() {
    const result = await db.query(
      'SELECT * FROM ai_speech_settings ORDER BY category, sort_order'
    );
    return result.rows;
  },

  /**
   * Обновить значение.
   */
  async set(key, value) {
    const result = await db.query(
      `UPDATE ai_speech_settings SET value = $1, updated_at = NOW() WHERE key = $2 RETURNING *`,
      [value, key]
    );
    _invalidate();
    return result.rows[0] || null;
  },

  /**
   * Обновить enabled (тумблер).
   */
  async setEnabled(key, enabled) {
    // For toggle-type settings, sync value with enabled so isEnabled() works correctly
    const result = await db.query(
      `UPDATE ai_speech_settings
       SET enabled = $1,
           value = CASE WHEN type = 'toggle' THEN $2 ELSE value END,
           updated_at = NOW()
       WHERE key = $3 RETURNING *`,
      [enabled, enabled ? 'true' : 'false', key]
    );
    _invalidate();
    return result.rows[0] || null;
  },

  /**
   * Массовое обновление: [{ key, value, enabled? }]
   */
  async setMany(entries) {
    const results = [];
    for (const { key, value, enabled } of entries) {
      if (value !== undefined) {
        await db.query(
          `UPDATE ai_speech_settings SET value = $1, updated_at = NOW() WHERE key = $2`,
          [value, key]
        );
      }
      if (enabled !== undefined) {
        await db.query(
          `UPDATE ai_speech_settings SET enabled = $1, updated_at = NOW() WHERE key = $2`,
          [enabled, key]
        );
      }
      results.push(key);
    }
    _invalidate();
    return results;
  },

  /**
   * Получить список fallback-ответов по категории (general, ai_down, blocked, waiting_*).
   * Возвращает массив строк.
   */
  async getFallbacks(category) {
    const prefix = `fallback_${category}`;
    const result = await db.query(
      `SELECT value FROM ai_speech_settings
       WHERE key LIKE $1 AND enabled = true
       ORDER BY sort_order`,
      [prefix + '%']
    );
    return result.rows.map(r => r.value).filter(Boolean);
  },

  /**
   * Получить случайный fallback по категории и состоянию пользователя.
   */
  async pickFallback(category, userState) {
    // Сначала пробуем state-specific
    if (userState) {
      const stateKey = userState.toLowerCase();
      const stateList = await aiSettings.getFallbacks(stateKey);
      if (stateList.length > 0) {
        return stateList[Math.floor(Math.random() * stateList.length)];
      }
    }
    const list = await aiSettings.getFallbacks(category);
    if (list.length > 0) {
      return list[Math.floor(Math.random() * list.length)];
    }
    // Аварийный минимум — не должен достигаться
    return 'Секунду, уточню и вернусь 👌';
  },

  /**
   * Получить список soft-ответов (мягкий режим наличия).
   */
  async getSoftResponses() {
    const result = await db.query(
      `SELECT value FROM ai_speech_settings
       WHERE key LIKE 'soft_response_%' AND enabled = true
       ORDER BY sort_order`
    );
    return result.rows.map(r => r.value).filter(Boolean);
  },

  /**
   * Получить случайный soft-ответ.
   */
  async pickSoftResponse() {
    const list = await aiSettings.getSoftResponses();
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
    return 'Сейчас гляну по наличию 👀 Какой размер нужен?';
  },

  /**
   * Получить список offtopic-редиректов.
   */
  async getOfftopicRedirects() {
    const result = await db.query(
      `SELECT value FROM ai_speech_settings
       WHERE key LIKE 'offtopic_redirect_%' AND enabled = true
       ORDER BY sort_order`
    );
    return result.rows.map(r => r.value).filter(Boolean);
  },

  /**
   * Получить случайный offtopic-редирект.
   */
  async pickOfftopicRedirect() {
    const list = await aiSettings.getOfftopicRedirects();
    if (list.length > 0) return list[Math.floor(Math.random() * list.length)];
    return 'Кстати, у нас новинки подъехали — глянешь? 🔥';
  },

  /**
   * Получить nudge-сообщение по ключу (nudge_payment_1h, nudge_form_24h и т.д.)
   */
  async getNudge(key) {
    return aiSettings.get(key);
  },

  /**
   * Получить state hint для AI по состоянию пользователя.
   */
  async getStateHint(state) {
    const key = `hint_${state.toLowerCase()}`;
    return aiSettings.get(key);
  },

  /**
   * Сбросить кеш вручную (например после массового обновления).
   */
  invalidateCache: _invalidate,
};

module.exports = aiSettings;
