const users = require('../db/users');
const messages = require('../db/messages');
const memory = require('../db/memory');
const config = require('../config');
const bot = require('./bot');
const { processMessage, processPhoto } = require('../logic/sales');
const monitoring = require('../monitoring');
const queue = require('../queue');
const safety = require('../ai/safety');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Configure queue: fallback sends "секунду..." if AI is slow
queue.configure({
  concurrency: 5,
  onFallback: async (chatId) => {
    try {
      await bot.sendMessage(chatId, 'Секунду, подбираю варианты 👌');
    } catch (e) { /* ignore */ }
  },
});

// Webhook deduplication — prevents processing duplicate updates from Telegram
const _processedUpdates = new Map();
const DEDUP_TTL = 60000; // 60 seconds

function isDuplicate(msgId, chatId) {
  const key = `${chatId}:${msgId}`;
  if (_processedUpdates.has(key)) return true;
  _processedUpdates.set(key, Date.now());
  // Cleanup old entries periodically
  if (_processedUpdates.size > 1000) {
    const now = Date.now();
    for (const [k, ts] of _processedUpdates) {
      if (now - ts > DEDUP_TTL) _processedUpdates.delete(k);
    }
  }
  return false;
}

// AI mode constants (legacy — kept for backward compat)
const AI_MODES = {
  OBSERVE: 'OBSERVE',
  HYBRID: 'HYBRID',
  AUTO: 'AUTO',
  AUTO_WITH_MANAGER_OVERRIDE: 'AUTO_WITH_MANAGER_OVERRIDE',
};

// HYBRID heuristic: simple messages the AI can handle
const SIMPLE_PATTERNS = [
  /^(привет|здравствуй|хай|йо|хей|салам|hi|hello)/i,
  /^(да|нет|ок|ага|угу|лан|хорошо|ладно|понял)/i,
  /цена|сколько|размер|есть|хочу|купить|заказать/i,
  /оплатил|перевел|перевёл|скрин|чек|оплата/i,
  /^\d{2}$/, // size like "42"
  /^\+?\d[\d\s\-()]{8,}/, // phone
];

// HYBRID: complex messages AI should skip
const COMPLEX_PATTERNS = [
  /жалоб|рекламаци|возврат|брак|обмен|сломал|порвал/i,
  /менеджер|оператор|человек|живой/i,
  /проблема с доставк|не пришл|не получил|потерял/i,
];

function isSimpleMessage(text) {
  if (!text) return false;
  if (text.length < 30) return true;
  if (SIMPLE_PATTERNS.some((p) => p.test(text))) return true;
  return false;
}

function isComplexMessage(text) {
  if (!text) return false;
  if (COMPLEX_PATTERNS.some((p) => p.test(text))) return true;
  return false;
}

/**
 * Check if AI should respond based on the new 2-mode system.
 * mode = 'ai' | 'manager'
 *
 * 'ai': AI responds unless manager is in active pause (wrote recently).
 *       Complex messages (complaints, requests for human) still bypass AI internally.
 * 'manager': AI never responds.
 */
function checkAiMode(user, text) {
  const mode = user.mode || 'ai';

  // Mode: manager — AI always silent
  if (mode === 'manager') {
    return { shouldRespond: false, reason: 'manager_mode' };
  }

  // Mode: ai — check internal conditions
  // 1. If manager is actively in chat (wrote within last 30 min), AI pauses
  if (user.manager_active) {
    return { shouldRespond: false, reason: 'manager_pause' };
  }

  // 2. Complex messages (complaints, requests for human) — escalate silently
  if (isComplexMessage(text)) {
    return { shouldRespond: false, reason: 'complex_escalation' };
  }

  // 3. AI responds
  return { shouldRespond: true, reason: 'ai_mode' };
}

async function sendAIResponse(telegramId, user, response, businessConnectionId) {
  const rawText = typeof response === 'object' ? response.text : response;
  const paymentData = typeof response === 'object' ? response.sendPayment : null;

  // Safety gate: sanitize + detect before sending to client
  const safeResult = safety.enforce(rawText, { userState: user.state });
  const responseText = safeResult.text;

  const delay = parseInt(await config.getSetting('response_delay') || '0', 10);
  if (delay > 0 && delay <= 30) await sleep(delay * 1000);

  const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};

  await messages.save(user.id, 'ai', responseText);
  await bot.sendMessage(telegramId, responseText, sendOpts);

  if (paymentData) {
    const amountStr = paymentData.amount ? `\nСумма: ${paymentData.amount}₽` : '';
    const paymentText = `💳 Реквизиты для оплаты:\n\nКарта: ${paymentData.cardNumber}\nПолучатель: ${paymentData.cardName}${amountStr}\n\nПереведи и скинь скрин/чек — сразу отправим заказ 🚀`;
    await bot.sendMessage(telegramId, paymentText, {
      ...sendOpts,
      reply_markup: {
        inline_keyboard: [[
          { text: '📋 Скопировать номер карты', callback_data: 'copy_card' }
        ]]
      }
    });
  }
}

async function handleMessage(msg, businessConnectionId) {
  const telegramId = msg.from.id;

  // Deduplicate: skip if we've seen this message already
  if (msg.message_id && isDuplicate(msg.message_id, telegramId)) return;

  // Record activity for silent failure detection
  monitoring.recordMessageActivity();

  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || null;
  const text = msg.text || msg.caption || null;
  const photo = msg.photo;

  // Handle /start bizChat deep link (Telegram Business connection handshake)
  if (text && text.startsWith('/start bizChat')) {
    try {
      const sendOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
      await bot.sendMessage(telegramId, 'Подключение успешно ✅', sendOpts);
    } catch (e) { /* ignore */ }
    return;
  }

  // Ignore unsupported message types (voice, sticker, video, document, etc.)
  if (!text && !photo) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      await messages.save(user.id, 'user', '[неподдерживаемый формат]');
    } catch (e) { /* ignore */ }
    return;
  }

  try {
    // ── SYNCHRONOUS PART: save message immediately, never lose it ──
    const globalAi = await config.getSetting('global_ai_enabled');
    const user = await users.findOrCreate(telegramId, name, username);

    if (photo && Array.isArray(photo) && photo.length > 0) {
      await messages.save(user.id, 'user', msg.caption || '[фото]');
    } else if (text) {
      await messages.save(user.id, 'user', text);
      // Extract customer data (non-blocking)
      memory.extractAndSave(user.id, text).catch(() => {});
    }

    // ── CHECK: should AI respond? ──
    if (globalAi === 'false') return;
    if (!user.ai_enabled) return;

    const autoReply = await config.getSetting('auto_reply');
    if (autoReply === 'false') return;

    const msgContent = text || msg.caption || '[фото]';
    const { shouldRespond } = checkAiMode(user, msgContent);
    if (!shouldRespond) return;

    // Check if manager cancelled AI for this chat
    if (queue.isCancelled(String(telegramId))) return;

    // ── ASYNC PART: enqueue AI response via queue ──
    queue.enqueue(telegramId, async () => {
      // Re-check cancel before AI call
      if (queue.isCancelled(String(telegramId))) return;

      // Re-fetch user in case state changed while queued
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

      // Final cancel check after AI call
      if (queue.isCancelled(String(telegramId))) return;

      if (response) {
        await sendAIResponse(telegramId, freshUser, response, businessConnectionId);
      }
    }, { userState: user.state });

  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
  }
}

module.exports = { handleMessage, checkAiMode, isSimpleMessage, isComplexMessage, AI_MODES, queue };
