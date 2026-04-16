const users = require('../db/users');
const messages = require('../db/messages');
const aiClient = require('../ai/client');
const { sendReply } = require('./outbox');

async function handleMessage(msg) {
  const telegramId = msg.chat?.id || msg.from?.id;
  if (!telegramId) return;

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from?.username || null;
  const text = msg.text || msg.caption || '';
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const normalizedText = text || (hasPhoto ? '[фото]' : '[пустое сообщение]');

  try {
    const user = await users.findOrCreate(telegramId, name, username);
    await messages.save(user.id, 'user', normalizedText, {
      telegramMessageId: msg.message_id || null,
      deliveryStatus: 'delivered',
    });
    const reply = await aiClient.sendText(normalizedText);
    await sendReply(user, telegramId, reply);
  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = { handleMessage };
