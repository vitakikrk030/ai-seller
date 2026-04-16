require('dotenv').config();
const { Pool } = require('pg');
const { ensureRuntimeSchema } = require('./runtime_schema');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const extraSchema = `
CREATE TABLE IF NOT EXISTS monitoring_components (
  name VARCHAR(50) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  last_ok TIMESTAMPTZ,
  last_error TIMESTAMPTZ,
  last_check TIMESTAMPTZ,
  message TEXT DEFAULT '',
  latency_ms INTEGER,
  critical BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_incidents (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_history (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  latency_ms INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mon_incidents_source ON monitoring_incidents(source);
CREATE INDEX IF NOT EXISTS idx_mon_incidents_created ON monitoring_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mon_incidents_open ON monitoring_incidents(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_mon_history_comp_time ON monitoring_history(component, recorded_at DESC);

CREATE TABLE IF NOT EXISTS ai_errors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  state VARCHAR(50),
  intent VARCHAR(50),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_errors_user ON ai_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_errors_category ON ai_errors(category);
CREATE INDEX IF NOT EXISTS idx_ai_errors_created ON ai_errors(created_at DESC);

CREATE TABLE IF NOT EXISTS funnel_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  state VARCHAR(50),
  intent VARCHAR(50),
  ab_variant VARCHAR(100),
  response_key VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_user ON funnel_events(user_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events(event);
CREATE INDEX IF NOT EXISTS idx_funnel_events_created ON funnel_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_ab ON funnel_events(ab_variant) WHERE ab_variant IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model VARCHAR(100),
  provider VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_failures (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(100),
  error_type VARCHAR(50),
  message TEXT,
  fallback_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_failures_created ON ai_failures(created_at DESC);
`;

const settingsSeed = `
INSERT INTO settings (key, value, updated_at) VALUES
  ('openrouter_api_key', '', NOW()),
  ('openrouter_model', 'openai/gpt-4o-mini', NOW()),
  ('ai_base_url', '', NOW()),
  ('ai_api_key', '', NOW()),
  ('ai_model', '', NOW()),
  ('secondary_ai_base_url', '', NOW()),
  ('secondary_ai_api_key', '', NOW()),
  ('secondary_ai_model', '', NOW()),
  ('bot_token', '', NOW()),
  ('webhook_url', '', NOW()),
  ('webhook_secret', '', NOW()),
  ('owner_chat_id', '', NOW()),
  ('shop_api_url', '', NOW()),
  ('shop_api_key', '', NOW()),
  ('response_delay', '0', NOW()),
  ('payment_card_number', '', NOW()),
  ('payment_name', '', NOW()),
  ('payment_bank_name', '', NOW()),
  ('payment_receiver_name', '', NOW()),
  ('policy_logging_enabled', 'true', NOW()),
  ('manual_payment_review_enabled', 'true', NOW())
ON CONFLICT (key) DO NOTHING;
`;

const promptSeed = `
DELETE FROM prompt_settings WHERE key = 'sales_prompt';

INSERT INTO prompt_settings (key, value, updated_at) VALUES
  ('core_prompt', 'Ты AI-продавец в Telegram. Веди клиента к покупке коротко и уверенно, не выдумывай данные и не повторяй уже известное. Если владелец подтвердил оплату, спокойно подтверди заказ и объясни следующий шаг.', NOW()),
  ('policy_prompt', 'Ты AI policy engine для Telegram-продаж. Возвращай только решение в JSON, не управляй side-effects напрямую и никогда не ставь статусы оплаты самостоятельно.', NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
`;

async function migrate() {
  try {
    await ensureRuntimeSchema(pool);
    await pool.query(extraSchema);
    await pool.query(settingsSeed);
    await pool.query(promptSeed);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
