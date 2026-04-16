async function ensureRuntimeSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(255),
      username VARCHAR(255),
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'ai')),
      text TEXT NOT NULL,
      delivery_status VARCHAR(32),
      telegram_message_id BIGINT,
      error_text TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    DROP TABLE IF EXISTS owner_reviews;
    DROP TABLE IF EXISTS policy_runs;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS customer_memory;
    DROP TABLE IF EXISTS settings;
    DROP TABLE IF EXISTS monitoring_history;
    DROP TABLE IF EXISTS monitoring_incidents;
    DROP TABLE IF EXISTS monitoring_components;
    DROP TABLE IF EXISTS funnel_events;
    DROP TABLE IF EXISTS ai_errors;
    DROP TABLE IF EXISTS ai_speech_settings;
    DROP TABLE IF EXISTS prompt_settings;

    ALTER TABLE users DROP COLUMN IF EXISTS state;
    ALTER TABLE users DROP COLUMN IF EXISTS pinned;
    ALTER TABLE users DROP COLUMN IF EXISTS last_read_at;
    ALTER TABLE users DROP COLUMN IF EXISTS needs_attention;
    ALTER TABLE users DROP COLUMN IF EXISTS attention_reason;
    ALTER TABLE users DROP COLUMN IF EXISTS attention_override;
    ALTER TABLE users DROP COLUMN IF EXISTS priority;
    ALTER TABLE users DROP COLUMN IF EXISTS ai_enabled;
    ALTER TABLE users DROP COLUMN IF EXISTS mode;
    ALTER TABLE users DROP COLUMN IF EXISTS ai_mode;
    ALTER TABLE users DROP COLUMN IF EXISTS manager_active;
    ALTER TABLE users DROP COLUMN IF EXISTS manager_active_at;

    ALTER TABLE messages DROP COLUMN IF EXISTS edited;
    ALTER TABLE messages DROP COLUMN IF EXISTS metadata;
    ALTER TABLE messages DROP COLUMN IF EXISTS retry_count;
    ALTER TABLE messages DROP COLUMN IF EXISTS next_retry_at;
    ALTER TABLE messages DROP COLUMN IF EXISTS last_retry_at;
    ALTER TABLE messages DROP COLUMN IF EXISTS dlq_at;
    ALTER TABLE messages DROP COLUMN IF EXISTS dlq_reason;

    UPDATE messages SET role = 'ai' WHERE role = 'admin';

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_role;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_role CHECK (role IN ('user', 'ai'));

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_delivery_status;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_delivery_status
      CHECK (delivery_status IS NULL OR delivery_status IN ('pending', 'delivered', 'failed'));
  `);
}

module.exports = { ensureRuntimeSchema };
