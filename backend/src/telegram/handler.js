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

function checkAiMode(user) {
  if ((user.mode || 'ai') === 'manager') {
    return { shouldRespond: false, reason: 'manager_mode' };
  }
  // Manager pause is valid only when active_at is recent.
  if (user.manager_active && user.manager_active_at) {
    const activeAtMs = new Date(user.manager_active_at).getTime();
    if (Number.isFinite(activeAtMs) && activeAtMs > Date.now() - 30 * 60 * 1000) {
      return { shouldRespond: false, reason: 'manager_pause' };
    }
  }
  if (user.manager_active && !user.manager_active_at) {
    log.warn('telegram.handleMessage: manager_active without timestamp; ignoring stale pause', {
      userId: user.id,
      telegramId: user.telegram_id,
    });
  }
  if (user.manager_active) {
    users.setManagerActive(user.id, false).catch(() => {});
    log.info('telegram.handleMessage: cleared stale manager pause', {
      userId: user.id,
      telegramId: user.telegram_id,
    });
    return { shouldRespond: true, reason: 'cleared_stale_manager_pause' };
  }
  return { shouldRespond: true, reason: 'ai_mode' };
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
      mode: user.mode || 'ai',
      managerActive: !!user.manager_active,
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
    const modeCheck = checkAiMode(user);
    if (!modeCheck.shouldRespond) {
      log.info('telegram.handleMessage: AI response skipped by mode gate', {
        telegramId,
        userId: user.id,
        reason: modeCheck.reason,
      });
      return;
    }
    if (queue.isCancelled(String(telegramId))) {
      log.info('telegram.handleMessage: AI response skipped because queue cancelled', {
        telegramId,
        userId: user.id,
      });
      return;
    }

    const enqueueResult = queue.enqueue(telegramId, async () => {
      if (queue.isCancelled(String(telegramId))) {
        log.debug('telegram.handleMessage: queued task cancelled before execution', {
          telegramId,
          userId: user.id,
        });
        return;
      }
      const freshUser = await users.getById(user.id);
      if (!freshUser || !freshUser.ai_enabled) {
        log.info('telegram.handleMessage: queued task skipped (user missing or ai disabled)', {
          telegramId,
          userId: user.id,
        });
        return;
      }
      const freshModeCheck = checkAiMode(freshUser);
      if (!freshModeCheck.shouldRespond) {
        log.info('telegram.handleMessage: queued task skipped by mode gate', {
          telegramId,
          userId: freshUser.id,
          reason: freshModeCheck.reason,
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

      if (queue.isCancelled(String(telegramId))) {
        log.info('telegram.handleMessage: outbox send skipped because queue cancelled after processTurn', {
          telegramId,
          userId: freshUser.id,
        });
        return;
      }
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
  checkAiMode,
};
