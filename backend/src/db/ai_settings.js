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
   * Сбросить кеш вручную (например после массового обновления).
   */
  invalidateCache: _invalidate,
};

module.exports = aiSettings;
