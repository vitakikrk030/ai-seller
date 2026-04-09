const db = require('../db');

const orders = {
  async create(data) {
    const result = await db.query(
      `INSERT INTO orders (user_id, product, size, price, full_name, phone, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [data.user_id, data.product, data.size, data.price || null, data.full_name, data.phone, data.address, data.status || 'NEW']
    );
    return result.rows[0];
  },

  async getByUser(userId) {
    const result = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return result.rows;
  },

  async getAll() {
    const result = await db.query(`
      SELECT o.*, u.name as user_name, u.telegram_id 
      FROM orders o 
      JOIN users u ON o.user_id = u.id 
      ORDER BY o.created_at DESC
    `);
    return result.rows;
  },

  async updateStatus(orderId, status) {
    const result = await db.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, orderId]
    );
    return result.rows[0];
  },

  async getLatestByUser(userId) {
    const result = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
    return result.rows[0];
  },
};

module.exports = orders;
