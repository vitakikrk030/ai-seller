const db = require('../db');

const users = {
  async findOrCreate(telegramId, name, username) {
    const existing = await db.query(
      'SELECT * FROM users WHERE telegram_id = $1',
      [telegramId]
    );

    if (existing.rows.length > 0) {
      const updated = await db.query(
        'UPDATE users SET last_seen = NOW(), name = COALESCE($2, name), username = COALESCE($3, username) WHERE telegram_id = $1 RETURNING *',
        [telegramId, name, username]
      );
      return updated.rows[0];
    }

    const result = await db.query(
      'INSERT INTO users (telegram_id, name, username) VALUES ($1, $2, $3) RETURNING *',
      [telegramId, name, username]
    );
    return result.rows[0];
  },

  async updateState(userId, state) {
    const result = await db.query(
      'UPDATE users SET state = $1 WHERE id = $2 RETURNING *',
      [state, userId]
    );
    return result.rows[0];
  },

  async getById(id) {
    const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0];
  },

  async getAll() {
    const result = await db.query(`
      SELECT u.*, 
        (SELECT text FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1) as last_message_at,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.id AND role = 'user') as message_count
      FROM users u 
      ORDER BY last_seen DESC
    `);
    return result.rows;
  },

  async search(query) {
    const result = await db.query(
      `SELECT * FROM users WHERE name ILIKE $1 OR username ILIKE $1 ORDER BY last_seen DESC`,
      [`%${query}%`]
    );
    return result.rows;
  },

  async setAiEnabled(userId, enabled) {
    await db.query('UPDATE users SET ai_enabled = $1 WHERE id = $2', [enabled, userId]);
  },

  async setAiMode(userId, mode) {
    const valid = ['OBSERVE', 'HYBRID', 'AUTO', 'AUTO_WITH_MANAGER_OVERRIDE'];
    if (!valid.includes(mode)) throw new Error(`Invalid ai_mode: ${mode}`);
    const result = await db.query(
      'UPDATE users SET ai_mode = $1 WHERE id = $2 RETURNING *',
      [mode, userId]
    );
    return result.rows[0];
  },

  async setManagerActive(userId, active) {
    await db.query(
      'UPDATE users SET manager_active = $1, manager_active_at = $2 WHERE id = $3',
      [active, active ? new Date() : null, userId]
    );
  },

  async clearStaleManagers(minutes) {
    const result = await db.query(
      `UPDATE users SET manager_active = false, manager_active_at = NULL
       WHERE manager_active = true AND manager_active_at < NOW() - INTERVAL '1 minute' * $1
       RETURNING *`,
      [minutes]
    );
    return result.rows;
  },

  async getInactive(days) {
    const result = await db.query(
      `SELECT * FROM users WHERE last_seen < NOW() - INTERVAL '1 day' * $1 AND state != 'DONE'`,
      [days]
    );
    return result.rows;
  },

  async getStuckInOrder(minutes) {
    const result = await db.query(
      `SELECT * FROM users
       WHERE state IN ('WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT')
         AND ai_enabled = true
         AND last_seen < NOW() - INTERVAL '1 minute' * $1
         AND last_seen > NOW() - INTERVAL '1 day'`,
      [minutes]
    );
    return result.rows;
  },

  async deleteById(id) {
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  },
};

module.exports = users;
