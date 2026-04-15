require('dotenv').config();

const envConfig = {
  PORT: process.env.PORT || 3001,
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_CHAT_ID: process.env.OWNER_CHAT_ID,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '',
  DATABASE_URL: process.env.DATABASE_URL,
  // Universal AI provider (preferred)
  AI_BASE_URL: process.env.AI_BASE_URL || process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  AI_API_KEY: process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY,
  AI_MODEL: process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  AI_MAX_TOKENS: parseInt(process.env.AI_MAX_TOKENS || '500'),
  AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || '10000'),
  AI_TOKEN_LIMIT: parseInt(process.env.AI_TOKEN_LIMIT || '1000000'),
  // Secondary AI provider (failover)
  SECONDARY_AI_BASE_URL: process.env.SECONDARY_AI_BASE_URL || '',
  SECONDARY_AI_API_KEY: process.env.SECONDARY_AI_API_KEY || '',
  SECONDARY_AI_MODEL: process.env.SECONDARY_AI_MODEL || '',
  // Backward compat aliases
  OPENROUTER_API_KEY: process.env.AI_API_KEY || process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  ADMIN_LOGIN: process.env.ADMIN_LOGIN || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  JWT_SECRET: process.env.JWT_SECRET || 'change_me_in_production_32chars_min',
};

// Warn about insecure defaults in production
if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change_me_in_production_32chars_min') {
    console.error('[SECURITY] JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env!');
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin123') {
    console.error('[SECURITY] ADMIN_PASSWORD not set or using default. Change it in .env!');
  }
  if (!process.env.DATABASE_URL) {
    console.error('[FATAL] DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.BOT_TOKEN) {
    console.warn('[WARN] BOT_TOKEN not set — Telegram integration disabled');
  }
}

// DB settings override .env at runtime
// Maps DB key → config key
const DB_KEY_MAP = {
  openrouter_api_key: 'OPENROUTER_API_KEY',
  openrouter_model: 'OPENROUTER_MODEL',
  ai_base_url: 'AI_BASE_URL',
  ai_api_key: 'AI_API_KEY',
  ai_model: 'AI_MODEL',
  bot_token: 'BOT_TOKEN',
  webhook_url: 'WEBHOOK_URL',
  webhook_secret: 'WEBHOOK_SECRET',
  owner_chat_id: 'OWNER_CHAT_ID',
};

let _dbSettings = null;
let _settingsModule = null;
let _loadingPromise = null;

function _getSettingsModule() {
  if (!_settingsModule) {
    try { _settingsModule = require('./db/settings'); } catch (e) { }
  }
  return _settingsModule;
}

async function loadDbSettings() {
  // Mutex: prevent concurrent DB reads from racing
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    try {
      const settings = _getSettingsModule();
      if (settings) {
        _dbSettings = await settings.getMap();
      }
    } catch (e) {
      _dbSettings = {};
    } finally {
      _loadingPromise = null;
    }
  })();
  return _loadingPromise;
}

// Reload cache — called after POST /api/settings
async function reloadSettings() {
  await loadDbSettings();
}

function get(key) {
  // Check DB override first
  if (_dbSettings) {
    for (const [dbKey, configKey] of Object.entries(DB_KEY_MAP)) {
      if (configKey === key && _dbSettings[dbKey]) {
        return _dbSettings[dbKey];
      }
    }
  }
  return envConfig[key];
}

// Get any setting by DB key (for global_ai_enabled, response_delay, etc.)
async function getSetting(dbKey) {
  const settings = _getSettingsModule();
  if (settings) {
    return await settings.get(dbKey);
  }
  return null;
}

// Export static config + dynamic getter
module.exports = {
  ...envConfig,
  get,
  getSetting,
  loadDbSettings,
  reloadSettings,
};
