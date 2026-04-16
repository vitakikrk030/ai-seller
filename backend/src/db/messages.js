const db = require('../db');

const VALID_DELIVERY_STATUSES = new Set(['pending', 'sent', 'delivered', 'failed']);

function normalizeDeliveryStatus(status) {
  if (!status) return null;
  const value = String(status).trim().toLowerCase();
  return VALID_DELIVERY_STATUSES.has(value) ? value : null;
}

const messages = {
  async save(userId, role, text, options = {}) {
    const deliveryStatus = normalizeDeliveryStatus(options.deliveryStatus);
    const result = await db.query(
      `INSERT INTO messages (
        user_id,
        role,
        text,
        telegram_message_id,
        delivery_status,
        error_text,
        metadata,
        retry_count,
        next_retry_at,
        dlq_at,
        dlq_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, NULL, NULL, NULL)
      RETURNING *`,
      [
        userId,
        role,
        text,
        options.telegramMessageId || null,
        deliveryStatus,
        options.errorText || null,
        JSON.stringify(options.metadata || {}),
      ]
    );
    return result.rows[0];
  },

  async markDelivery(id, deliveryStatus, options = {}) {
    const normalizedStatus = normalizeDeliveryStatus(deliveryStatus);
    if (!normalizedStatus) {
      throw new Error(`Invalid delivery status: ${deliveryStatus}`);
    }
    const isDelivered = normalizedStatus === 'delivered';
    const result = await db.query(
      `UPDATE messages
       SET delivery_status = $2,
           telegram_message_id = COALESCE($3, telegram_message_id),
           error_text = $4,
           next_retry_at = CASE WHEN $5 THEN NULL ELSE next_retry_at END,
           dlq_at = CASE WHEN $5 THEN NULL ELSE dlq_at END,
           dlq_reason = CASE WHEN $5 THEN NULL ELSE dlq_reason END
       WHERE id = $1
       RETURNING *`,
      [id, normalizedStatus, options.telegramMessageId || null, options.errorText || null, isDelivered]
    );
    return result.rows[0] || null;
  },

  async scheduleRetry(id, options = {}) {
    const nextRetryAt = options.nextRetryAt instanceof Date ? options.nextRetryAt : new Date();
    const retryCount = Number.isInteger(options.retryCount) ? options.retryCount : 0;
    const result = await db.query(
      `UPDATE messages
       SET delivery_status = 'failed',
           error_text = $2,
           retry_count = $3,
           next_retry_at = $4,
           last_retry_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, options.errorText || null, retryCount, nextRetryAt]
    );
    return result.rows[0] || null;
  },

  async moveToDlq(id, options = {}) {
    const retryCount = Number.isInteger(options.retryCount) ? options.retryCount : 0;
    const result = await db.query(
      `UPDATE messages
       SET delivery_status = 'failed',
           error_text = $2,
           retry_count = $3,
           next_retry_at = NULL,
           dlq_at = NOW(),
           dlq_reason = $4,
           last_retry_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, options.errorText || null, retryCount, options.reason || 'delivery_retries_exhausted']
    );
    return result.rows[0] || null;
  },

  async getRetryBatch(limit = 20, maxRetries = 3) {
    const safeLimit = Math.max(1, Math.min(200, parseInt(limit, 10) || 20));
    const safeMaxRetries = Math.max(1, parseInt(maxRetries, 10) || 3);
    const result = await db.query(
      `SELECT
         m.*,
         u.telegram_id
       FROM messages m
       JOIN users u ON u.id = m.user_id
       WHERE m.delivery_status = 'failed'
         AND m.role IN ('ai', 'admin')
         AND m.dlq_at IS NULL
         AND COALESCE(m.retry_count, 0) < $2
         AND (
           m.next_retry_at IS NULL
           OR m.next_retry_at <= NOW()
         )
       ORDER BY COALESCE(m.next_retry_at, m.created_at) ASC, m.id ASC
       LIMIT $1`,
      [safeLimit, safeMaxRetries]
    );
    return result.rows;
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
