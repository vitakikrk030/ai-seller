const db = require('../db');

const VALID_DELIVERY_STATUSES = new Set(['pending', 'delivered', 'failed']);

function normalizeDeliveryStatus(status) {
  if (!status) return null;
  const value = String(status).trim().toLowerCase();
  return VALID_DELIVERY_STATUSES.has(value) ? value : null;
}

const messages = {
  async save(userId, role, text, options = {}) {
    const deliveryStatus = normalizeDeliveryStatus(options.deliveryStatus);
    const result = await db.query(
      `INSERT INTO messages (user_id, role, text, delivery_status, telegram_message_id, error_text)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        userId,
        role,
        text,
        deliveryStatus,
        options.telegramMessageId || null,
        options.errorText || null,
      ]
    );
    return result.rows[0];
  },

  async markDelivery(id, deliveryStatus, options = {}) {
    const normalizedStatus = normalizeDeliveryStatus(deliveryStatus);
    if (!normalizedStatus) throw new Error(`Invalid delivery status: ${deliveryStatus}`);
    const result = await db.query(
      `UPDATE messages
       SET delivery_status = $2,
           telegram_message_id = COALESCE($3, telegram_message_id),
           error_text = $4
       WHERE id = $1
       RETURNING *`,
      [id, normalizedStatus, options.telegramMessageId || null, options.errorText || null]
    );
    return result.rows[0] || null;
  },

  async getByUser(userId) {
    const result = await db.query(
      'SELECT * FROM messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 500',
      [userId]
    );
    return result.rows;
  },
};

module.exports = messages;
