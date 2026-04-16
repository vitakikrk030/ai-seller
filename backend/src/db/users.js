const db = require('../db');

const users = {
  async findOrCreate(telegramId, name, username) {
    const existing = await db.query('SELECT * FROM users WHERE telegram_id = $1', [telegramId]);
    if (existing.rows[0]) {
      const updated = await db.query(
        `UPDATE users
         SET last_seen = NOW(),
             name = COALESCE($2, name),
             username = COALESCE($3, username)
         WHERE telegram_id = $1
         RETURNING *`,
        [telegramId, name, username]
      );
      return updated.rows[0];
    }

    const created = await db.query(
      'INSERT INTO users (telegram_id, name, username) VALUES ($1, $2, $3) RETURNING *',
      [telegramId, name, username]
    );
    return created.rows[0];
  },

  async getById(id) {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  },

  async getAll() {
    const result = await db.query(`
      SELECT
        u.*,
        lm.text AS last_message,
        lm.created_at AS last_message_at
      FROM users u
      LEFT JOIN LATERAL (
        SELECT text, created_at
        FROM messages
        WHERE user_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON true
      ORDER BY u.last_seen DESC
      LIMIT 500
    `);
    return result.rows;
  },
};

module.exports = users;
