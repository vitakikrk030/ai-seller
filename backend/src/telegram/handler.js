const users = require('../db/users');
const messages = require('../db/messages');
const memory = require('../db/memory');
const config = require('../config');
const { deliverOutbox } = require('./outbox');
const monitoring = require('../monitoring');
const queue = require('../queue');
const { processTurn } = require('../logic/sales');
const log = require('../logger');

function _broadcast(event, data) {
  try {
    const router = require('../api/routes');
    if (router.broadcastSSE) router.broadcastSSE(event, data);
  } catch {}
}

queue.configure({
  concurrency: 5,
});

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

  monitoring.recordMessageActivity();

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from?.username || null;
  const text = msg.text || msg.caption || null;
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;

  if (text && text.startsWith('/start bizChat')) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      const sendOptions = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
      await deliverOutbox({
        telegramId,
        user,
        outbox: [{ kind: 'reply', text: 'Подключение успешно.' }],
        businessConnectionId: sendOptions.business_connection_id || null,
        applyDelay: false,
        role: 'ai',
        broadcast: _broadcast,
      });
    } catch {}
    return;
  }

  if (!text && !hasPhoto) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      await messages.save(user.id, 'user', '[неподдерживаемый формат]', {
        telegramMessageId: msg.message_id || null,
        deliveryStatus: 'delivered',
      });
    } catch {}
    return;
  }

  try {
    const globalAi = await config.getSetting('global_ai_enabled');
    const autoReply = await config.getSetting('auto_reply');
    const user = await users.findOrCreate(telegramId, name, username);
    log.debug('telegram.handleMessage: inbound accepted', {
      telegramId,
      userId: user.id,
      hasPhoto,
      hasText: !!text,
      globalAi,
      autoReply,
      aiEnabled: !!user.ai_enabled,
    });

    const userMessage = await messages.save(user.id, 'user', text || '[фото]', {
      telegramMessageId: msg.message_id || null,
      deliveryStatus: 'delivered',
      metadata: { hasPhoto },
    });
    _broadcast('typing', { userId: user.id, typing: false });
    _broadcast('message', { userId: user.id, message: userMessage });
    if (text) memory.extractAndSave(user.id, text).catch(() => {});

    if (globalAi === 'false' || autoReply === 'false' || !user.ai_enabled) {
      log.info('telegram.handleMessage: AI response skipped by settings', {
        telegramId,
        userId: user.id,
        globalAi,
        autoReply,
        aiEnabled: !!user.ai_enabled,
      });
      return;
    }
    const enqueueResult = queue.enqueue(telegramId, async () => {
      const freshUser = await users.getById(user.id);
      if (!freshUser || !freshUser.ai_enabled) {
        log.info('telegram.handleMessage: queued task skipped (user missing or ai disabled)', {
          telegramId,
          userId: user.id,
        });
        return;
      }

      const result = await processTurn(freshUser, {
        text: text || '[фото]',
        messageId: msg.message_id || null,
        hasPhoto,
      });
      log.debug('telegram.handleMessage: processTurn completed', {
        telegramId,
        userId: freshUser.id,
        outboxCount: result.execution.outbox.length,
        actions: result.execution.actions.map((action) => action.type),
      });

      if (result.execution.outbox.length > 0) {
        log.debug('telegram.handleMessage: sending outbox', {
          telegramId,
          userId: freshUser.id,
          outboxCount: result.execution.outbox.length,
        });
        await deliverOutbox({
          telegramId,
          user: freshUser,
          outbox: result.execution.outbox,
          businessConnectionId,
          applyDelay: true,
          broadcast: _broadcast,
        });
      } else {
        log.warn('telegram.handleMessage: empty outbox, nothing to send', {
          telegramId,
          userId: freshUser.id,
        });
      }
    }, { userState: user.state });
    if (!enqueueResult) {
      log.error('telegram.handleMessage: failed to enqueue message', {
        telegramId,
        userId: user.id,
      });
    } else {
      log.debug('telegram.handleMessage: message enqueued', {
        telegramId,
        userId: user.id,
        queueTaskId: enqueueResult.id,
        queuePosition: enqueueResult.position,
      });
    }
  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = {
  handleMessage,
};
