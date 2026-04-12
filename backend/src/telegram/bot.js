const axios = require('axios');
const config = require('../config');

function getAPI() {
  return `https://api.telegram.org/bot${config.get('BOT_TOKEN')}`;
}

// Retry helper for transient Telegram errors (429, 5xx)
async function tgRequest(method, payload, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await axios.post(`${getAPI()}/${method}`, payload);
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
      // Telegram Business: send as the connected user
      if (options.business_connection_id) {
        payload.business_connection_id = options.business_connection_id;
      }
      await tgRequest('sendMessage', payload);
    } catch (err) {
      console.error('Telegram send error:', err.response?.data || err.message);
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
      await axios.post(`${getAPI()}/setWebhook`, webhookPayload);
      console.log('Webhook set:', webhookUrl);
    } catch (err) {
      console.error('Webhook setup error:', err.response?.data || err.message);
    }
  },

  async getFileUrl(fileId) {
    try {
      const resp = await axios.post(`${getAPI()}/getFile`, { file_id: fileId });
      const filePath = resp.data?.result?.file_path;
      if (!filePath) return null;
      return `https://api.telegram.org/file/bot${config.get('BOT_TOKEN')}/${filePath}`;
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
};

module.exports = bot;
