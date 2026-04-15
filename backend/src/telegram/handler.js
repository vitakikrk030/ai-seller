const users = require('../db/users');
const messages = require('../db/messages');
const memory = require('../db/memory');
const config = require('../config');
const bot = require('./bot');
const { processMessage, processPhoto } = require('../logic/sales');
const monitoring = require('../monitoring');
const queue = require('../queue');
const safety = require('../ai/safety');
const aiSettings = require('../db/ai_settings');
const managerLearning = require('../db/manager_learning');

// SSE broadcast — lazy require to avoid circular dependency
function _broadcast(event, data) {
  try {
    const router = require('../api/routes');
    if (router.broadcastSSE) router.broadcastSSE(event, data);
  } catch {}
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Configure queue: fallback sends waiting message if AI is slow
queue.configure({
  concurrency: 5,
  onFallback: async (chatId) => {
    try {
      const msg = await aiSettings.get('speech_waiting_fallback').catch(() => null)
        || await aiSettings.get('speech_waiting_response').catch(() => null)
        || await aiSettings.pickFallback('general').catch(() => null)
        || 'Секунду';
      await bot.sendMessage(chatId, msg);
    } catch (e) { /* ignore */ }
  },
});

// Webhook deduplication
const _processedUpdates = new Map();
const DEDUP_TTL = 60000;

function isDuplicate(msgId, chatId) {
  const key = `${chatId}:${msgId}`;
  if (_processedUpdates.has(key)) return true;
  _processedUpdates.set(key, Date.now());
  if (_processedUpdates.size > 1000) {
    const now = Date.now();
    for (const [k, ts] of _processedUpdates) {
      if (now - ts > DEDUP_TTL) _processedUpdates.delete(k);
    }
  }
  return false;
}

/**
 * Проверить расписание AI — работает ли сейчас.
 */
async function checkSchedule() {
  try {
    const scheduleEnabled = await aiSettings.isEnabled('ai_schedule_enabled').catch(() => false);
    if (!scheduleEnabled) return { active: true };

    const start = await aiSettings.getRaw('ai_schedule_start').catch(() => '09:00');
    const end = await aiSettings.getRaw('ai_schedule_end').catch(() => '22:00');
    const fallback = await aiSettings.get('ai_schedule_fallback').catch(() => null);

    const { isMoscowInRange } = require('../utils/time');
    const active = isMoscowInRange(start || '09:00', end || '22:00');

    return { active, fallback };
  } catch (e) {
    return { active: true };
  }
}

/**
 * Проверить порог передачи менеджеру по ключевым словам из AI Settings.
 */
async function checkManagerThreshold(user, text, msgHistory) {
  try {
    // Ключевые слова из настроек
    const keywordsRaw = await aiSettings.getRaw('manager_threshold_keywords').catch(() => null);
    if (keywordsRaw) {
      const keywords = keywordsRaw.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
      if (text && keywords.some(kw => text.toLowerCase().includes(kw))) {
        return { escalate: true, reason: 'keyword_match' };
      }
    }

    // Порог по количеству сообщений без покупки
    const thresholdRaw = await aiSettings.getRaw('manager_threshold_messages').catch(() => '10');
    const threshold = parseInt(thresholdRaw) || 10;
    const userMsgCount = (msgHistory || []).filter(m => m.role === 'user').length;
    if (userMsgCount >= threshold && !['PAID', 'DONE'].includes(user.state)) {
      return { escalate: true, reason: 'message_threshold' };
    }

    return { escalate: false };
  } catch (e) {
    return { escalate: false };
  }
}

/**
 * Check if AI should respond based on the 2-mode system.
 * mode = 'ai' | 'manager'
 */
async function checkAiMode(user, text, msgHistory) {
  const mode = user.mode || 'ai';

  if (mode === 'manager') {
    return { shouldRespond: false, reason: 'manager_mode' };
  }

  if (user.manager_active) {
    return { shouldRespond: false, reason: 'manager_pause' };
  }

  // Расписание AI
  const schedule = await checkSchedule();
  if (!schedule.active) {
    return { shouldRespond: false, reason: 'schedule', fallback: schedule.fallback };
  }

  // Порог передачи менеджеру
  const threshold = await checkManagerThreshold(user, text, msgHistory);
  if (threshold.escalate) {
    // В Closer режиме блокируем только автоматическую эскалацию по кол-ву сообщений,
    // но keyword_match (жалобы, возврат) всё равно эскалируем
    if (threshold.reason === 'message_threshold') {
      const closerActive = await aiSettings.isEnabled('closer_mode_enabled').catch(() => false)
        || (await aiSettings.getRaw('sales_style_preset').catch(() => '')) === 'closer';
      if (closerActive) {
        // skip escalation — Closer handles it
      } else {
        return { shouldRespond: false, reason: threshold.reason };
      }
    } else {
      return { shouldRespond: false, reason: threshold.reason };
    }
  }

  return { shouldRespond: true, reason: 'ai_mode' };
}

async function sendAIResponse(telegramId, user, response, businessConnectionId) {
  const rawText = typeof response === 'object' ? response.text : response;
  const paymentData = typeof response === 'object' ? response.sendPayment : null;

  // Safety gate
  const safeResult = await safety.enforce(rawText, { userState: user.state });
  const responseText = safeResult.text;

  const delay = parseInt(await config.getSetting('response_delay') || '0', 10);
  if (delay > 0 && delay <= 30) await sleep(delay * 1000);

  const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};

  console.log(`SEND TO: ${telegramId} (user.id=${user.id}, state=${user.state})`);

  const aiMsg = await messages.save(user.id, 'ai', responseText);
  _broadcast('message', { userId: user.id, message: aiMsg });
  await bot.sendMessage(telegramId, responseText, sendOpts);

  if (paymentData) {
    const amountStr = paymentData.amount ? `\nСумма: ${paymentData.amount}₽` : '';
    const cardTpl = await aiSettings.get('speech_payment_card').catch(() => null)
      || 'Реквизиты для оплаты:\n\n{{bankLine}}Карта: {{cardNumber}}\nПолучатель: {{receiverName}}{{amount}}\n\nПереведи и скинь скрин/чек — сразу отправим заказ';
    const bankLine = paymentData.bankName ? `Банк: ${paymentData.bankName}\n` : '';
    const receiverName = paymentData.receiverName || paymentData.cardName || 'Не указан';
    // Log only last 4 digits for security
    const maskedCard = paymentData.cardNumber
      ? '**** **** **** ' + String(paymentData.cardNumber).replace(/\s/g, '').slice(-4)
      : '****';
    const paymentText = cardTpl
      .replace('{{bankLine}}', bankLine)
      .replace('{{bankName}}', paymentData.bankName || '')
      .replace('{{cardNumber}}', paymentData.cardNumber || '')
      .replace('{{cardName}}', receiverName)
      .replace('{{receiverName}}', receiverName)
      .replace('{{amount}}', amountStr);
    await bot.sendMessage(telegramId, paymentText, {
      ...sendOpts,
      reply_markup: {
        inline_keyboard: [[
          { text: 'Скопировать номер карты', callback_data: 'copy_card' }
        ]]
      }
    });
  }
}

async function handleMessage(msg, businessConnectionId) {
  // Use chat.id as the destination for replies (correct for DMs and Business chats)
  const telegramId = msg.chat?.id || msg.from.id;

  if (msg.message_id && isDuplicate(msg.message_id, telegramId)) return;

  monitoring.recordMessageActivity();

  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = msg.from?.username || null;
  const text = msg.text || msg.caption || null;
  const photo = msg.photo;

  // Handle /start bizChat deep link
  if (text && text.startsWith('/start bizChat')) {
    try {
      const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
      const startMsg = await aiSettings.get('speech_start_bizchat').catch(() => null) || 'Подключение успешно';
      await bot.sendMessage(telegramId, startMsg, sendOpts);
    } catch (e) { /* ignore */ }
    return;
  }

  // Ignore unsupported message types
  if (!text && !photo) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      await messages.save(user.id, 'user', '[неподдерживаемый формат]');
    } catch (e) { /* ignore */ }
    return;
  }

  try {
    const globalAi = await config.getSetting('global_ai_enabled');
    const user = await users.findOrCreate(telegramId, name, username);

    if (photo && Array.isArray(photo) && photo.length > 0) {
      const uMsg = await messages.save(user.id, 'user', msg.caption || '[фото]');
      _broadcast('message', { userId: user.id, message: uMsg });
      _broadcast('typing', { userId: user.id, typing: false });
    } else if (text) {
      // Client sent message — clear typing indicator
      _broadcast('typing', { userId: user.id, typing: false });
      const uMsg = await messages.save(user.id, 'user', text);
      _broadcast('message', { userId: user.id, message: uMsg });
      memory.extractAndSave(user.id, text).catch(() => {});
    }

    if (globalAi === 'false') return;
    if (!user.ai_enabled) return;

    const autoReply = await config.getSetting('auto_reply');
    if (autoReply === 'false') return;

    const msgContent = text || msg.caption || '[фото]';
    const msgHistory = await messages.getHistory(user.id, 50).catch(() => []);
    const modeCheck = await checkAiMode(user, msgContent, msgHistory);
    if (!modeCheck.shouldRespond) {
      // Если вне расписания — отправить fallback один раз
      if (modeCheck.reason === 'schedule' && modeCheck.fallback) {
        const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
        const lastAI = msgHistory.filter(m => m.role === 'ai').pop();
        const lastAIAge = lastAI ? (Date.now() - new Date(lastAI.created_at).getTime()) / (1000 * 60) : 999;
        if (lastAIAge > 60) { // не спамить — раз в час
          await messages.save(user.id, 'ai', modeCheck.fallback);
          await bot.sendMessage(telegramId, modeCheck.fallback, sendOpts);
        }
      }
      return;
    }

    if (queue.isCancelled(String(telegramId))) return;

    queue.enqueue(telegramId, async () => {
      if (queue.isCancelled(String(telegramId))) return;

      const freshUser = await users.getById(user.id);
      if (!freshUser || !freshUser.ai_enabled) return;
      if (freshUser.manager_active) return;

      let response;
      if (photo && Array.isArray(photo) && photo.length > 0) {
        const largest = photo[photo.length - 1];
        const fileUrl = await bot.getFileUrl(largest.file_id);
        if (!fileUrl) return;
        response = await processPhoto(freshUser, fileUrl, msg.caption || null);
      } else {
        response = await processMessage(freshUser, text);
      }

      if (queue.isCancelled(String(telegramId))) return;

      if (response) {
        await sendAIResponse(telegramId, freshUser, response, businessConnectionId);
      }
    }, { userState: user.state });

  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = { handleMessage, checkAiMode };
