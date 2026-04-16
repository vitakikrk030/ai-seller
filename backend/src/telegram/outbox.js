const messages = require('../db/messages');
const bot = require('./bot');

async function sendReply(user, telegramId, text) {
  const saved = await messages.save(user.id, 'ai', text, {
    deliveryStatus: 'pending',
  });

  try {
    const sent = await bot.sendMessage(telegramId, text);
    return await messages.markDelivery(saved.id, 'delivered', {
      telegramMessageId: sent?.message_id || null,
      errorText: null,
    });
  } catch (err) {
    const errorText = err.response?.data?.description || err.message || 'telegram_send_failed';
    await messages.markDelivery(saved.id, 'failed', { errorText });
    throw err;
  }
}

module.exports = { sendReply };
