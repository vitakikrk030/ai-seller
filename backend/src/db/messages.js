const db = require('../db');

const messages = {
  async save(userId, role, text) {
    const result = await db.query(
      'INSERT INTO messages (user_id, role, text) VALUES ($1, $2, $3) RETURNING *',
      [userId, role, text]
    );
    return result.rows[0];
  },

  async getHistory(userId, limit = 20) {
    const result = await db.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows.reverse();
  },

  async getByUser(userId) {
    const result = await db.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC',
      [userId]
    );
    return result.rows;
  },
};

module.exports = messages;
