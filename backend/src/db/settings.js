const db = require('./index');

const settings = {
  async getAll() {
    const result = await db.query(
      'SELECT key, value, updated_at FROM settings ORDER BY key'
    );
    return result.rows;
  },

  async get(key) {
    const result = await db.query(
      'SELECT value FROM settings WHERE key = $1',
      [key]
    );
    return result.rows[0]?.value || null;
  },

  async set(key, value) {
    const result = await db.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()
       RETURNING *`,
      [key, value]
    );
    return result.rows[0];
  },

  async setMany(entries) {
    const results = [];
    for (const { key, value } of entries) {
      results.push(await settings.set(key, value));
    }
    return results;
  },

  async getMap() {
    const rows = await settings.getAll();
    const map = {};
    for (const row of rows) {
      map[row.key] = row.value;
    }
    return map;
  },
};

module.exports = settings;
