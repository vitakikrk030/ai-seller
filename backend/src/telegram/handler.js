const users = require('../db/users');
const messages = require('../db/messages');
const memory = require('../db/memory');
const config = require('../config');
const bot = require('./bot');
const { deliverOutbox } = require('./outbox');
const monitoring = require('../monitoring');
const queue = require('../queue');
const { processTurn } = require('../logic/sales');

function _broadcast(event, data) {
  try {
    const router = require('../api/routes');
    if (router.broadcastSSE) router.broadcastSSE(event, data);
  } catch {}
}

queue.configure({
  concurrency: 5,
  onFallback: async (chatId) => {
    try {
      await bot.sendMessage(chatId, 'Секунду.');
    } catch {}
  },
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
  if (user.manager_active) {
    return { shouldRespond: false, reason: 'manager_pause' };
  }
  return { shouldRespond: true, reason: 'ai_mode' };
}

async function handleMessage(msg, businessConnectionId) {
  const telegramId = msg.chat?.id || msg.from?.id;
  if (!telegramId) return;
  if (msg.message_id && isDuplicate(msg.message_id, telegramId)) return;

  monitoring.recordMessageActivity();

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from?.username || null;
  const text = msg.text || msg.caption || null;
  const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;

  if (text && text.startsWith('/start bizChat')) {
    try {
      const sendOptions = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
      await bot.sendMessage(telegramId, 'Подключение успешно.', sendOptions);
    } catch {}
    return;
  }

  if (!text && !hasPhoto) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      await messages.save(user.id, 'user', '[неподдерживаемый формат]', {
        telegramMessageId: msg.message_id || null,
        deliveryStatus: 'received',
      });
    } catch {}
    return;
  }

  try {
    const globalAi = await config.getSetting('global_ai_enabled');
    const autoReply = await config.getSetting('auto_reply');
    const user = await users.findOrCreate(telegramId, name, username);

    const userMessage = await messages.save(user.id, 'user', text || '[фото]', {
      telegramMessageId: msg.message_id || null,
      deliveryStatus: 'received',
      metadata: { hasPhoto },
    });
    _broadcast('typing', { userId: user.id, typing: false });
    _broadcast('message', { userId: user.id, message: userMessage });
    if (text) memory.extractAndSave(user.id, text).catch(() => {});

    if (globalAi === 'false' || autoReply === 'false' || !user.ai_enabled) return;
    const modeCheck = checkAiMode(user);
    if (!modeCheck.shouldRespond) return;
    if (queue.isCancelled(String(telegramId))) return;

    queue.enqueue(telegramId, async () => {
      if (queue.isCancelled(String(telegramId))) return;
      const freshUser = await users.getById(user.id);
      if (!freshUser || !freshUser.ai_enabled) return;
      if ((freshUser.mode || 'ai') === 'manager' || freshUser.manager_active) return;

      const result = await processTurn(freshUser, {
        text: text || '[фото]',
        messageId: msg.message_id || null,
        hasPhoto,
      });

      if (queue.isCancelled(String(telegramId))) return;
      if (result.execution.outbox.length > 0) {
        await deliverOutbox({
          telegramId,
          user: freshUser,
          outbox: result.execution.outbox,
          businessConnectionId,
          applyDelay: true,
          broadcast: _broadcast,
        });
      }
    }, { userState: user.state });
  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = {
  handleMessage,
  checkAiMode,
};
