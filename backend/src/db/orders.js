const db = require('../db');

const STATUS_MAP = {
  DRAFT: 'draft',
  PAYMENT_PENDING: 'payment_pending',
  PAYMENT_CLAIMED: 'payment_claimed',
  PAYMENT_VERIFIED: 'payment_verified',
  FULFILLED: 'fulfilled',
  CANCELLED: 'cancelled',
};

function normalizeStatus(status) {
  if (!status) return 'draft';
  return STATUS_MAP[status] || String(status).toLowerCase();
}

function isFinalStatus(status) {
  const normalized = normalizeStatus(status);
  return normalized === 'fulfilled' || normalized === 'cancelled';
}

const orders = {
  async create(data) {
    const status = normalizeStatus(data.status || 'draft');
    const result = await db.query(
      `INSERT INTO orders (
        user_id,
        product_ref,
        product,
        size,
        price,
        full_name,
        phone,
        address,
        status,
        payment_claimed_at,
        payment_verified_at,
        payment_receipt_message_id,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
      RETURNING *`,
      [
        data.user_id,
        data.product_ref || null,
        data.product || null,
        data.size || null,
        data.price || null,
        data.full_name || null,
        data.phone || null,
        data.address || null,
        status,
        status === 'payment_claimed' ? new Date() : null,
        status === 'payment_verified' ? new Date() : null,
        data.payment_receipt_message_id || null,
        JSON.stringify(data.metadata || {}),
      ]
    );
    return result.rows[0];
  },

  async getByUser(userId) {
    const result = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [userId]
    );
    return result.rows;
  },

  async getAll() {
    const result = await db.query(`
      SELECT o.*, u.name as user_name, u.telegram_id 
      FROM orders o 
      LEFT JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC
      LIMIT 500
    `);
    return result.rows;
  },

  async getById(orderId) {
    const result = await db.query('SELECT * FROM orders WHERE id = $1', [orderId]);
    return result.rows[0] || null;
  },

  async updateStatus(orderId, status) {
    const nextStatus = normalizeStatus(status);
    if (nextStatus === 'payment_verified') {
      throw new Error('payment_verified must be set via explicit owner verification');
    }
    const claimed = nextStatus === 'payment_claimed';
    const verified = nextStatus === 'payment_verified';
    const result = await db.query(
      `UPDATE orders
       SET status = $1,
           payment_claimed_at = CASE
             WHEN $3 THEN COALESCE(payment_claimed_at, NOW())
             ELSE payment_claimed_at
           END,
           payment_verified_at = CASE
             WHEN $4 THEN COALESCE(payment_verified_at, NOW())
             ELSE payment_verified_at
           END,
           paid_at = CASE
             WHEN $4 THEN COALESCE(paid_at, NOW())
             ELSE paid_at
           END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [nextStatus, orderId, claimed, verified]
    );
    return result.rows[0];
  },

  async updateById(orderId, fields) {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return orders.getById(orderId);
    if (fields.status !== undefined && normalizeStatus(fields.status) === 'payment_verified') {
      throw new Error('payment_verified must be set via explicit owner verification');
    }

    const values = [orderId];
    const setClauses = entries.map(([column, value], index) => {
      const normalizedValue = column === 'status'
        ? normalizeStatus(value)
        : (column === 'metadata' ? JSON.stringify(value || {}) : value);
      values.push(normalizedValue);
      return `${column} = $${index + 2}`;
    });
    values.push(new Date());
    setClauses.push(`updated_at = $${values.length}`);

    const result = await db.query(
      `UPDATE orders SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      values
    );
    return result.rows[0] || null;
  },

  async getLatestByUser(userId) {
    const result = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    return result.rows[0];
  },

  async getActiveByUser(userId) {
    const result = await db.query(
      `SELECT * FROM orders
       WHERE user_id = $1
         AND status IN ('draft', 'payment_pending', 'payment_claimed')
       ORDER BY created_at DESC, updated_at DESC NULLS LAST
       LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  },

  async upsertDraft(userId, fields = {}) {
    const active = await orders.getActiveByUser(userId);
    if (active && !isFinalStatus(active.status)) {
      const patch = { ...fields };
      if (patch.status === undefined && ['payment_claimed', 'payment_verified'].includes(normalizeStatus(active.status))) {
        delete patch.status;
      }
      return orders.updateById(active.id, patch);
    }
    return orders.create({ user_id: userId, ...fields, status: fields.status || 'draft' });
  },

  async markPaymentClaimed(orderId, options = {}) {
    const result = await db.query(
      `UPDATE orders
       SET status = 'payment_claimed',
           payment_claimed_at = COALESCE(payment_claimed_at, NOW()),
           payment_receipt_message_id = COALESCE($2, payment_receipt_message_id),
           updated_at = NOW()
       WHERE id = $1
         AND status IN ('payment_pending', 'payment_claimed')
       RETURNING *`,
      [orderId, options.receiptMessageId || null]
    );
    return result.rows[0] || null;
  },

  async markPaymentVerified(orderId) {
    const result = await db.query(
      `UPDATE orders
       SET status = 'payment_verified',
           payment_verified_at = COALESCE(payment_verified_at, NOW()),
           paid_at = COALESCE(paid_at, NOW()),
           updated_at = NOW()
       WHERE id = $1
         AND status IN ('payment_claimed', 'payment_verified')
       RETURNING *`,
      [orderId]
    );
    return result.rows[0] || null;
  },

  async resetToPaymentPending(orderId) {
    const result = await db.query(
      `UPDATE orders
       SET status = 'payment_pending',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [orderId]
    );
    return result.rows[0] || null;
  },

  normalizeStatus,
  isFinalStatus,
};

module.exports = orders;
