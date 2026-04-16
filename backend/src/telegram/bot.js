const axios = require('axios');
const config = require('../config');
const log = require('../logger');

function ensureToken() {
  if (!config.TELEGRAM_TOKEN) {
    throw new Error('TELEGRAM_TOKEN is not configured');
  }
}

async function sendMessage(chatId, text) {
  ensureToken();
  const response = await axios.post(
    `https://api.telegram.org/bot${config.TELEGRAM_TOKEN}/sendMessage`,
    { chat_id: chatId, text }
  );
  log.info('telegram.bot.sendMessage: success', {
    chatId,
    telegramMessageId: response.data?.result?.message_id || null,
  });
  return response.data?.result || null;
}

module.exports = { sendMessage };
