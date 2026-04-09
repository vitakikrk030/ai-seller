require('dotenv').config();

const envConfig = {
  PORT: process.env.PORT || 3001,
  BOT_TOKEN: process.env.BOT_TOKEN,
  OWNER_CHAT_ID: process.env.OWNER_CHAT_ID,
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  ADMIN_LOGIN: process.env.ADMIN_LOGIN || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'admin123',
  JWT_SECRET: process.env.JWT_SECRET || 'change_me_in_production',
};

// DB settings override .env at runtime
// Maps DB key → config key
const DB_KEY_MAP = {
  openrouter_api_key: 'OPENROUTER_API_KEY',
  openrouter_model: 'OPENROUTER_MODEL',
  bot_token: 'BOT_TOKEN',
  webhook_url: 'WEBHOOK_URL',
  owner_chat_id: 'OWNER_CHAT_ID',
};

let _dbSettings = null;
let _settingsModule = null;

function _getSettingsModule() {
  if (!_settingsModule) {
    try { _settingsModule = require('./db/settings'); } catch (e) { }
  }
  return _settingsModule;
}

async function loadDbSettings() {
  try {
    const settings = _getSettingsModule();
    if (settings) {
      _dbSettings = await settings.getMap();
    }
  } catch (e) {
    _dbSettings = {};
  }
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
