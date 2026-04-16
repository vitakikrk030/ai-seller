const db = require('../db');

const messages = {
  async save(userId, role, text, options = {}) {
    const result = await db.query(
      `INSERT INTO messages (
        user_id,
        role,
        text,
        telegram_message_id,
        delivery_status,
        error_text,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        userId,
        role,
        text,
        options.telegramMessageId || null,
        options.deliveryStatus || null,
        options.errorText || null,
        JSON.stringify(options.metadata || {}),
      ]
    );
    return result.rows[0];
  },

  async markDelivery(id, deliveryStatus, options = {}) {
    const result = await db.query(
      `UPDATE messages
       SET delivery_status = $2,
           telegram_message_id = COALESCE($3, telegram_message_id),
           error_text = $4
       WHERE id = $1
       RETURNING *`,
      [id, deliveryStatus, options.telegramMessageId || null, options.errorText || null]
    );
    return result.rows[0] || null;
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
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 200',
      [userId]
    );
    return result.rows;
  },

  async getByUserPaginated(userId, limit = 50, before = null) {
    if (before) {
      const result = await db.query(
        'SELECT * FROM messages WHERE user_id = $1 AND id < $2 ORDER BY created_at DESC LIMIT $3',
        [userId, before, limit]
      );
      return result.rows.reverse();
    }
    const result = await db.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows.reverse();
  },

  async searchByUser(userId, query) {
    const result = await db.query(
      "SELECT * FROM messages WHERE user_id = $1 AND text ILIKE $2 ORDER BY created_at ASC LIMIT 100",
      [userId, `%${query}%`]
    );
    return result.rows;
  },

  async deleteById(id) {
    await db.query('DELETE FROM messages WHERE id = $1', [id]);
  },

  async updateById(id, text) {
    const result = await db.query(
      'UPDATE messages SET text = $1, edited = true WHERE id = $2 RETURNING *',
      [text, id]
    );
    return result.rows[0];
  },

  async clearByUser(userId) {
    await db.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  },

  async getUnreadSince(userId, since) {
    const result = await db.query(
      'SELECT * FROM messages WHERE user_id = $1 AND created_at > $2 AND role = $3 ORDER BY created_at ASC',
      [userId, since, 'user']
    );
    return result.rows;
  },
};

module.exports = messages;
