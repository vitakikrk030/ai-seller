require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT || '3001', 10),
  DATABASE_URL: process.env.DATABASE_URL || '',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || process.env.BOT_TOKEN || '',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_BASE_URL: process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1',
  MODEL: process.env.MODEL || 'openai/gpt-4o-mini',
  AI_MAX_TOKENS: parseInt(process.env.AI_MAX_TOKENS || '1000', 10),
  AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || '15000', 10),
};
