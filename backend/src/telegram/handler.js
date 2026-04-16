const users = require('../db/users');
const messages = require('../db/messages');
const { deliverOutbox } = require('./outbox');
const { processTurn } = require('../logic/sales');
const log = require('../logger');

function _broadcast(event, data) {
  try {
    const router = require('../api/routes');
    if (router.broadcastSSE) router.broadcastSSE(event, data);
  } catch {}
}

const processedUpdates = new Map();
const DEDUP_TTL = 60000;

function isDuplicate(msgId, chatId) {
  const key = `${chatId}:${msgId}`;
  if (processedUpdates.has(key)) return true;
  processedUpdates.set(key, Date.now());
  if (processedUpdates.size > 1000) {
    const now = Date.now();
    for (const [currentKey, ts] of processedUpdates) {
      if (now - ts > DEDUP_TTL) processedUpdates.delete(currentKey);
    }
  }
  return false;
}

async function handleMessage(msg, businessConnectionId) {
  const telegramId = msg.chat?.id || msg.from?.id;
  if (!telegramId) return;
  if (msg.message_id && isDuplicate(msg.message_id, telegramId)) {
    log.debug('telegram.handleMessage: duplicate update skipped', {
      telegramId,
      messageId: msg.message_id,
    });
    return;
  }

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from?.username || null;
  const text = msg.text || msg.caption || '';
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
  const normalizedText = text || (hasPhoto ? '[фото]' : '[неподдерживаемый формат]');

  try {
    const user = await users.findOrCreate(telegramId, name, username);
    log.debug('telegram.handleMessage: inbound accepted', {
      telegramId,
      userId: user.id,
      hasPhoto,
      hasText: !!text,
      actor: 'ai',
    });

    const userMessage = await messages.save(user.id, 'user', normalizedText, {
      telegramMessageId: msg.message_id || null,
      deliveryStatus: 'delivered',
      metadata: { hasPhoto },
    });
    _broadcast('typing', { userId: user.id, typing: false });
    _broadcast('message', { userId: user.id, message: userMessage });

    const freshUser = await users.getById(user.id);
    if (!freshUser) {
      throw new Error('User disappeared before AI turn');
    }

    const result = await processTurn(freshUser, {
      text: normalizedText,
      messageId: msg.message_id || null,
      hasPhoto,
    });
    log.debug('telegram.handleMessage: processTurn completed', {
      telegramId,
      userId: freshUser.id,
      outboxCount: result.execution.outbox.length,
      actions: result.execution.actions.map((action) => action.type),
    });

    await deliverOutbox({
      telegramId,
      user: freshUser,
      outbox: result.execution.outbox,
      businessConnectionId,
      applyDelay: true,
      broadcast: _broadcast,
    });
  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = {
  handleMessage,
};
