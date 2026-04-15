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
        lm.text as last_message,
        lm.created_at as last_message_at,
        lm.role as last_message_role,
        COALESCE(mc.cnt, 0)::int as message_count,
        um.created_at as last_user_message_at,
        lr.created_at as last_reply_at,
        lo.product as order_product,
        lo.size as order_size,
        lo.price as order_price,
        lo.status as order_status,
        CASE
          WHEN COALESCE(u."mode", 'ai') = 'manager' THEN 'manager'
          WHEN u.manager_active = true AND u.manager_active_at IS NOT NULL
            AND u.manager_active_at > NOW() - INTERVAL '30 minutes' THEN 'paused'
          ELSE 'ai'
        END as active_actor,
        CASE
          WHEN COALESCE(u."mode", 'ai') = 'ai' AND u.manager_active = true
            AND u.manager_active_at IS NOT NULL
            AND u.manager_active_at > NOW() - INTERVAL '30 minutes'
          THEN GREATEST(0, EXTRACT(EPOCH FROM (u.manager_active_at + INTERVAL '30 minutes' - NOW())) / 60)::int
          ELSE 0
        END as pause_remaining,
        CASE
          WHEN u.state = 'WAITING_PAYMENT' THEN 100
          WHEN u.state = 'WAITING_FORM' THEN 80
          WHEN u.state = 'WAITING_SIZE' THEN 60
          WHEN u.state = 'PAID' THEN 50
          WHEN u.state = 'NEW' THEN 40
          WHEN u.state = 'DONE' THEN 10
          ELSE 20
        END as state_priority,
        CASE
          WHEN um.created_at IS NOT NULL
            AND (u.last_read_at IS NULL OR um.created_at > u.last_read_at)
            AND um.created_at > COALESCE(lr.created_at, '1970-01-01')
          THEN true ELSE false
        END as unread,
        CASE
          WHEN um.created_at IS NOT NULL
            AND um.created_at > COALESCE(lr.created_at, '1970-01-01')
          THEN EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60
          ELSE NULL
        END as wait_minutes,
        -- needs_attention: override OR auto-detect
        CASE
          WHEN u.attention_override = true THEN u.needs_attention
          -- no reply for 2+ min and client is waiting
          WHEN um.created_at IS NOT NULL
            AND um.created_at > COALESCE(lr.created_at, '1970-01-01')
            AND EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60 >= 2
            AND u.state IN ('WAITING_PAYMENT','WAITING_FORM','WAITING_SIZE','NEW')
          THEN true
          -- stuck on payment for 30+ min
          WHEN u.state = 'WAITING_PAYMENT'
            AND um.created_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60 >= 30
          THEN true
          ELSE false
        END as needs_attention,
        CASE
          WHEN u.attention_override = true THEN u.attention_reason
          WHEN um.created_at IS NOT NULL
            AND um.created_at > COALESCE(lr.created_at, '1970-01-01')
            AND EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60 >= 2
            AND u.state IN ('WAITING_PAYMENT','WAITING_FORM','WAITING_SIZE','NEW')
          THEN 'Нет ответа ' || EXTRACT(EPOCH FROM (NOW() - um.created_at))::int / 60 || ' мин'
          WHEN u.state = 'WAITING_PAYMENT'
            AND um.created_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60 >= 30
          THEN 'Завис на оплате'
          ELSE NULL
        END as attention_reason,
        -- computed_priority score: pinned=1000, needs_attention=500, unread=100
        CASE
          WHEN u.pinned THEN 1000
          WHEN (
            CASE
              WHEN u.attention_override = true THEN u.needs_attention
              WHEN um.created_at IS NOT NULL AND um.created_at > COALESCE(lr.created_at,'1970-01-01')
                AND EXTRACT(EPOCH FROM (NOW()-um.created_at))/60 >= 2
                AND u.state IN ('WAITING_PAYMENT','WAITING_FORM','WAITING_SIZE','NEW') THEN true
              ELSE false
            END
          ) THEN 500
          WHEN um.created_at IS NOT NULL
            AND (u.last_read_at IS NULL OR um.created_at > u.last_read_at)
            AND um.created_at > COALESCE(lr.created_at,'1970-01-01') THEN 100
          ELSE 0
        END as computed_priority
      FROM users u
      LEFT JOIN LATERAL (
        SELECT text, created_at, role FROM messages WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
      ) lm ON true
      LEFT JOIN LATERAL (
        SELECT created_at FROM messages WHERE user_id = u.id AND role = 'user' ORDER BY created_at DESC LIMIT 1
      ) um ON true
      LEFT JOIN LATERAL (
        SELECT created_at FROM messages WHERE user_id = u.id AND role IN ('admin', 'ai') ORDER BY created_at DESC LIMIT 1
      ) lr ON true
      LEFT JOIN (
        SELECT user_id, COUNT(*) as cnt FROM messages WHERE role = 'user' GROUP BY user_id
      ) mc ON mc.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT product, size, price, status FROM orders WHERE user_id = u.id ORDER BY created_at DESC LIMIT 1
      ) lo ON true
      ORDER BY
        computed_priority DESC,
        state_priority DESC,
        u.last_seen DESC
      LIMIT 500
    `);
    return result.rows;
  },

  async markRead(userId) {
    await db.query('UPDATE users SET last_read_at = NOW() WHERE id = $1', [userId]);
  },

  async search(query) {
    const result = await db.query(
      `SELECT * FROM users WHERE name ILIKE $1 OR username ILIKE $1 ORDER BY last_seen DESC LIMIT 100`,
      [`%${query}%`]
    );
    return result.rows;
  },

  async setAiEnabled(userId, enabled) {
    await db.query('UPDATE users SET ai_enabled = $1 WHERE id = $2', [enabled, userId]);
  },

  async setAiMode(userId, mode) {
    // Legacy compat: map old 4-mode values to new 2-mode
    const newMode = (mode === 'OBSERVE') ? 'manager' : 'ai';
    const valid = ['OBSERVE', 'HYBRID', 'AUTO', 'AUTO_WITH_MANAGER_OVERRIDE'];
    if (!valid.includes(mode)) throw new Error(`Invalid ai_mode: ${mode}`);
    const result = await db.query(
      'UPDATE users SET ai_mode = $1, "mode" = $2 WHERE id = $3 RETURNING *',
      [mode, newMode, userId]
    );
    return result.rows[0];
  },

  async setMode(userId, mode) {
    const valid = ['ai', 'manager'];
    if (!valid.includes(mode)) throw new Error(`Invalid mode: ${mode}`);
    // Map to legacy ai_mode for backward compat
    const legacyMode = mode === 'manager' ? 'OBSERVE' : 'AUTO';
    // When switching to 'ai', also clear manager_active
    if (mode === 'ai') {
      const result = await db.query(
        'UPDATE users SET "mode" = $1, ai_mode = $2, manager_active = false, manager_active_at = NULL WHERE id = $3 RETURNING *',
        [mode, legacyMode, userId]
      );
      return result.rows[0];
    }
    const result = await db.query(
      'UPDATE users SET "mode" = $1, ai_mode = $2 WHERE id = $3 RETURNING *',
      [mode, legacyMode, userId]
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
