const axios = require('axios');
const config = require('../config');

function getAPI() {
  return `https://api.telegram.org/bot${config.get('BOT_TOKEN')}`;
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
      await axios.post(`${getAPI()}/sendMessage`, payload);
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
      await axios.post(`${getAPI()}/setWebhook`, {
        url: webhookUrl,
      });
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
