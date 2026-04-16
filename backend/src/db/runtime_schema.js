async function ensureRuntimeSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE NOT NULL,
      name VARCHAR(255),
      username VARCHAR(255),
      state VARCHAR(50) DEFAULT 'NEW',
      ai_enabled BOOLEAN DEFAULT true,
      last_seen TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'ai', 'admin')),
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

    CREATE TABLE IF NOT EXISTS prompt_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(50) UNIQUE NOT NULL,
      value TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS ai_speech_settings (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) UNIQUE NOT NULL,
      label VARCHAR(255),
      description TEXT,
      value TEXT,
      type VARCHAR(50) DEFAULT 'text',
      category VARCHAR(100) DEFAULT 'general',
      enabled BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'ai';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_mode VARCHAR(50) DEFAULT 'AUTO';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_active BOOLEAN DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_active_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_reason VARCHAR(100);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_override BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;

    ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(32);
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS error_text TEXT;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_ref VARCHAR(255);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_claimed_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_receipt_message_id BIGINT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

    UPDATE users
    SET state = 'COLLECTING'
    WHERE state IN ('WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT');

    UPDATE orders
    SET status = CASE
          WHEN status IN ('NEW', 'COLLECTING', 'WAITING_SIZE', 'WAITING_FORM') THEN 'draft'
          WHEN status = 'WAITING_PAYMENT' THEN 'payment_pending'
          WHEN status = 'PAID' THEN 'payment_verified'
          WHEN status = 'DONE' THEN 'fulfilled'
          ELSE status
        END,
        payment_verified_at = CASE
          WHEN status = 'PAID' THEN COALESCE(payment_verified_at, paid_at, updated_at, created_at, NOW())
          ELSE payment_verified_at
        END,
        paid_at = CASE
          WHEN status = 'PAID' THEN COALESCE(paid_at, updated_at, created_at, NOW())
          ELSE paid_at
        END,
        updated_at = NOW()
    WHERE status IN ('NEW', 'COLLECTING', 'WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT', 'PAID', 'DONE');

    CREATE INDEX IF NOT EXISTS idx_messages_delivery_status ON messages(delivery_status);
    CREATE INDEX IF NOT EXISTS idx_messages_telegram_message_id ON messages(telegram_message_id);
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
    DELETE FROM ai_speech_settings
    WHERE key LIKE 'speech_%'
       OR key LIKE 'offtopic_redirect_%'
       OR key LIKE 'soft_response_%'
       OR key LIKE 'ab_%'
       OR key LIKE 'hint_waiting_%'
       OR key LIKE 'nudge_%'
       OR key IN ('toggle_ab_testing');

    DELETE FROM prompt_settings WHERE key = 'sales_prompt';

    INSERT INTO prompt_settings (key, value, updated_at) VALUES
      ('core_prompt', 'Ты AI-продавец в Telegram. Веди клиента к покупке коротко и уверенно, не выдумывай данные и не повторяй уже известное. Если оплата подтверждена владельцем, спокойно сообщи клиенту, что заказ подтверждён и что будет дальше.', NOW()),
      ('followup_prompt', 'Сделай короткое follow-up сообщение для возврата клиента в диалог о покупке.', NOW()),
      ('policy_prompt', 'Ты AI policy engine для Telegram-продаж. Возвращай только решение в JSON и никогда не ставь статусы оплаты самостоятельно.', NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

    INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
      ('closer_pressure_level', 'Уровень давления', 'Насколько активно AI ведёт к покупке', '3', 'text', 'closer', true, 1),
      ('closer_message_length', 'Длина сообщения', 'short / medium / long', 'short', 'text', 'closer', true, 2),
      ('closer_initiative', 'Инициатива', 'low / medium / high', 'high', 'text', 'closer', true, 3),
      ('style_closer_hint', 'Custom closer hint', 'Дополнительная инструкция для policy prompt', '', 'textarea', 'closer', true, 4),
      ('toggle_fallback', 'Fallbacks', 'Разрешить fallback при ошибках', 'true', 'toggle', 'toggles', true, 5)
    ON CONFLICT (key) DO NOTHING;

    INSERT INTO settings (key, value, updated_at) VALUES
      ('policy_mode', 'primary', NOW()),
      ('policy_logging_enabled', 'true', NOW()),
      ('manual_payment_review_enabled', 'true', NOW())
    ON CONFLICT (key) DO NOTHING;
  `);
}

module.exports = { ensureRuntimeSchema };
