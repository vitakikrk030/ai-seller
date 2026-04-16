const axios = require('axios');
const config = require('../config');
const log = require('../logger');
const settings = require('../db/settings');

async function getBotToken() {
  const token = (await settings.get('bot_token') || '').trim();
  return token || null;
}

async function getAPI() {
  const token = await getBotToken();
  if (!token) throw new Error('BOT_TOKEN is not configured in settings');
  return `https://api.telegram.org/bot${token}`;
}

// Retry helper for transient Telegram errors (429, 5xx)
async function tgRequest(method, payload, retries = 2) {
  const api = await getAPI();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(`${api}/${method}`, payload);
    } catch (err) {
      const status = err.response?.status;
      const retryAfter = err.response?.data?.parameters?.retry_after;
      // Retry on 429 (rate limit) or 5xx (server errors)
      if (attempt < retries && (status === 429 || (status >= 500 && status < 600))) {
        const delay = retryAfter ? retryAfter * 1000 : 1000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

const bot = {
  getBotToken,

  async sendMessage(chatId, text, options = {}) {
    try {
      const payload = {
        chat_id: chatId,
        text,
        ...options,
      };
      if (options.parse_mode) {
        payload.parse_mode = options.parse_mode;
      }
      if (options.business_connection_id) {
        payload.business_connection_id = options.business_connection_id;
      }
      log.debug('telegram.bot.sendMessage: request', {
        chatId,
        textLength: (text || '').length,
        hasBusinessConnection: !!options.business_connection_id,
      });
      const response = await tgRequest('sendMessage', payload);
      try { require('../monitoring').recordSuccess('telegram'); } catch(e) {}
      log.info('telegram.bot.sendMessage: success', {
        chatId,
        telegramMessageId: response.data?.result?.message_id || null,
      });
      return response.data?.result || null;
    } catch (err) {
      console.error('Telegram send error:', err.response?.data || err.message);
      const status = err.response?.status || null;
      const severity = status === 401 || status === 403 ? 'critical' : 'warning';
      try { require('../monitoring').recordError('telegram', err.message || 'sendMessage failed', severity); } catch(e) {}
      log.error('telegram.bot.sendMessage: failed', {
        chatId,
        error: err.message || 'sendMessage failed',
        status,
      });
      throw err;
    }
  },

  async setupWebhook() {
    const webhookUrl = config.get('WEBHOOK_URL');
    if (!webhookUrl) {
      console.log('WEBHOOK_URL not set, skipping webhook setup');
      return;
    }
    try {
      const webhookPayload = {
        url: webhookUrl,
        allowed_updates: [
          'message',
          'callback_query',
          'business_connection',
          'business_message',
          'edited_business_message',
        ],
      };
      // Add secret token for webhook verification
      const webhookSecret = config.get('WEBHOOK_SECRET');
      if (webhookSecret) {
        webhookPayload.secret_token = webhookSecret;
      }
      const api = await getAPI();
      await axios.post(`${api}/setWebhook`, webhookPayload);
      console.log('Webhook set:', webhookUrl);
    } catch (err) {
      console.error('Webhook setup error:', err.response?.data || err.message);
    }
  },

  async getFileUrl(fileId) {
    try {
      const api = await getAPI();
      const token = await getBotToken();
      const resp = await axios.post(`${api}/getFile`, { file_id: fileId });
      const filePath = resp.data?.result?.file_path;
      if (!filePath) return null;
      return `https://api.telegram.org/file/bot${token}/${filePath}`;
    } catch (err) {
      console.error('Telegram getFile error:', err.response?.data || err.message);
      return null;
    }
  },

  async notifyOwner(text, options = {}) {
    const ownerId = config.get('OWNER_CHAT_ID');
    if (!ownerId) return;
    await bot.sendMessage(ownerId, text, options);
  },

  async answerCallbackQuery(callbackQueryId, text) {
    await tgRequest('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
    });
  },
};

module.exports = bot;
