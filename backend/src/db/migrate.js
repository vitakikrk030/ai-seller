require('dotenv').config();
const { Pool } = require('pg');
const { ensureRuntimeSchema } = require('./runtime_schema');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const extraSchema = `
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

async function migrate() {
  try {
    await ensureRuntimeSchema(pool);
    await pool.query(extraSchema);
    await pool.query(settingsSeed);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

migrate();
