const db = require('./index');

const ownerReviews = {
  async open({ orderId, userId, receiptMessageId = null, reason = null }) {
    const existing = await db.query(
      `SELECT * FROM owner_reviews
       WHERE order_id = $1 AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const result = await db.query(
      `INSERT INTO owner_reviews (order_id, user_id, status, receipt_message_id, reason)
       VALUES ($1, $2, 'open', $3, $4)
       RETURNING *`,
      [orderId, userId, receiptMessageId, reason]
    );
    return result.rows[0];
  },

  async resolveByOrder(orderId, status, resolvedBy, reason = null) {
    const result = await db.query(
      `UPDATE owner_reviews
       SET status = $1,
           resolved_by = $2,
           reason = COALESCE($3, reason),
           resolved_at = NOW()
       WHERE order_id = $4 AND status = 'open'
       RETURNING *`,
      [status, resolvedBy || null, reason, orderId]
    );
    return result.rows;
  },

  async getOpenByOrder(orderId) {
    const result = await db.query(
      `SELECT * FROM owner_reviews
       WHERE order_id = $1 AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
      [orderId]
    );
    return result.rows[0] || null;
  },
};

module.exports = ownerReviews;
