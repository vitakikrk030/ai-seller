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
          WHEN u.state = 'PAYMENT_REVIEW' THEN 110
          WHEN u.state = 'COLLECTING' THEN 100
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
            AND u.state IN ('COLLECTING','PAYMENT_REVIEW','NEW')
          THEN true
          WHEN u.state IN ('COLLECTING')
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
            AND u.state IN ('COLLECTING','PAYMENT_REVIEW','NEW')
          THEN 'Нет ответа ' || EXTRACT(EPOCH FROM (NOW() - um.created_at))::int / 60 || ' мин'
          WHEN u.state IN ('COLLECTING')
            AND um.created_at IS NOT NULL
            AND EXTRACT(EPOCH FROM (NOW() - um.created_at)) / 60 >= 30
          THEN 'Диалог завис на оформлении'
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
                AND u.state IN ('COLLECTING','PAYMENT_REVIEW','NEW') THEN true
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
        SELECT created_at FROM messages WHERE user_id = u.id AND role = 'ai' ORDER BY created_at DESC LIMIT 1
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

  async deleteById(id) {
    const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING *', [id]);
    return result.rows[0];
  },
};

module.exports = users;
