const db = require('../db');

const prompts = {
  async get(key) {
    const result = await db.query(
      'SELECT value FROM prompt_settings WHERE key = $1',
      [key]
    );
    return result.rows[0]?.value || '';
  },

  async getAll() {
    const result = await db.query('SELECT * FROM prompt_settings ORDER BY key');
    return result.rows;
  },

  async update(key, value) {
    const result = await db.query(
      `INSERT INTO prompt_settings (key, value, updated_at) 
       VALUES ($1, $2, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW() 
       RETURNING *`,
      [key, value]
    );
    return result.rows[0];
  },
};

module.exports = prompts;
