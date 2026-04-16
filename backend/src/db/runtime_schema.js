async function ensureRuntimeSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(255),
      username VARCHAR(255),
      state VARCHAR(50) DEFAULT 'NEW',
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'ai')),
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      product VARCHAR(255),
      size VARCHAR(50),
      price NUMERIC,
      full_name VARCHAR(255),
      phone VARCHAR(50),
      address TEXT,
      status VARCHAR(50) DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) UNIQUE NOT NULL,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS customer_memory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      full_name VARCHAR(255),
      phone VARCHAR(50),
      city VARCHAR(255),
      address TEXT,
      shoe_size VARCHAR(50),
      insole_cm NUMERIC,
      preferred_brand VARCHAR(255),
      shoe_type VARCHAR(255),
      behavior JSONB DEFAULT '{}'::jsonb,
      notes TEXT,
      last_order_summary JSONB DEFAULT '{}'::jsonb,
      total_spent NUMERIC DEFAULT 0,
      order_count INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_reason VARCHAR(100);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_override BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
    ALTER TABLE users DROP COLUMN IF EXISTS ai_enabled;
    ALTER TABLE users DROP COLUMN IF EXISTS mode;
    ALTER TABLE users DROP COLUMN IF EXISTS ai_mode;
    ALTER TABLE users DROP COLUMN IF EXISTS manager_active;
    ALTER TABLE users DROP COLUMN IF EXISTS manager_active_at;

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(32);
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_text TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS dlq_at TIMESTAMPTZ;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS dlq_reason TEXT;
    UPDATE messages SET retry_count = 0 WHERE retry_count IS NULL;

    UPDATE messages
    SET delivery_status = 'delivered'
    WHERE delivery_status = 'received';

    UPDATE messages
    SET role = 'ai'
    WHERE role = 'admin';

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
    ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_role;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_role
      CHECK (role IN ('user', 'ai'));

    ALTER TABLE messages DROP CONSTRAINT IF EXISTS chk_messages_delivery_status;
    ALTER TABLE messages ADD CONSTRAINT chk_messages_delivery_status
      CHECK (
        delivery_status IS NULL
        OR delivery_status IN ('pending', 'sent', 'delivered', 'failed')
      );

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_ref VARCHAR(255);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_claimed_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_receipt_message_id BIGINT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON messages(delivery_status);
    CREATE INDEX IF NOT EXISTS idx_messages_telegram_message_id ON messages(telegram_message_id);
    CREATE INDEX IF NOT EXISTS idx_messages_delivery_pending ON messages(delivery_status, created_at DESC)
      WHERE delivery_status IN ('pending', 'sent');
    CREATE INDEX IF NOT EXISTS idx_messages_retry_ready ON messages(delivery_status, next_retry_at ASC, retry_count ASC)
      WHERE delivery_status = 'failed' AND dlq_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_messages_dlq_at ON messages(dlq_at DESC) WHERE dlq_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_status_runtime ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_orders_payment_claimed_at ON orders(payment_claimed_at) WHERE payment_claimed_at IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_payment_verified_at ON orders(payment_verified_at) WHERE payment_verified_at IS NOT NULL;

    CREATE TABLE IF NOT EXISTS policy_runs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      mode VARCHAR(32) NOT NULL DEFAULT 'primary',
      input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_output TEXT,
      decision_json JSONB,
      validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
      validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
      backend_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_policy_runs_user ON policy_runs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_policy_runs_order ON policy_runs(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_policy_runs_created ON policy_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS owner_reviews (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(32) NOT NULL DEFAULT 'open',
      receipt_message_id BIGINT,
      reason TEXT,
      resolved_by VARCHAR(255),
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_owner_reviews_order ON owner_reviews(order_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_owner_reviews_status ON owner_reviews(status, created_at DESC);
  `);

  await pool.query(`
    DROP TABLE IF EXISTS monitoring_history;
    DROP TABLE IF EXISTS monitoring_incidents;
    DROP TABLE IF EXISTS monitoring_components;
    DROP TABLE IF EXISTS funnel_events;
    DROP TABLE IF EXISTS ai_errors;
    DROP TABLE IF EXISTS ai_speech_settings;
    DROP TABLE IF EXISTS prompt_settings;

    DELETE FROM settings WHERE key = 'policy_mode';
    DELETE FROM settings WHERE key = 'global_ai_enabled';
    DELETE FROM settings WHERE key = 'auto_reply';

    INSERT INTO settings (key, value, updated_at) VALUES
      ('policy_logging_enabled', 'true', NOW()),
      ('manual_payment_review_enabled', 'true', NOW())
    ON CONFLICT (key) DO NOTHING;
  `);
}

module.exports = { ensureRuntimeSchema };
