const users = require('../db/users');
const messages = require('../db/messages');
const config = require('../config');
const bot = require('./bot');
const { processMessage, processPhoto } = require('../logic/sales');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// AI mode constants
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
  // Short messages are generally simple
  if (text.length < 30) return true;
  // Check patterns
  if (SIMPLE_PATTERNS.some((p) => p.test(text))) return true;
  return false;
}

function isComplexMessage(text) {
  if (!text) return false;
  if (COMPLEX_PATTERNS.some((p) => p.test(text))) return true;
  return false;
}

/**
 * Check if AI should respond based on user's ai_mode.
 * Returns { shouldRespond: bool, reason: string }
 */
function checkAiMode(user, text) {
  const mode = user.ai_mode || 'AUTO';

  switch (mode) {
    case AI_MODES.OBSERVE:
      return { shouldRespond: false, reason: 'observe_mode' };

    case AI_MODES.HYBRID:
      if (isComplexMessage(text)) {
        return { shouldRespond: false, reason: 'hybrid_complex' };
      }
      if (user.manager_active) {
        return { shouldRespond: false, reason: 'hybrid_manager_active' };
      }
      if (!isSimpleMessage(text)) {
        return { shouldRespond: false, reason: 'hybrid_not_simple' };
      }
      return { shouldRespond: true, reason: 'hybrid_simple' };

    case AI_MODES.AUTO_WITH_MANAGER_OVERRIDE:
      if (user.manager_active) {
        return { shouldRespond: false, reason: 'manager_override' };
      }
      return { shouldRespond: true, reason: 'auto_manager_clear' };

    case AI_MODES.AUTO:
    default:
      return { shouldRespond: true, reason: 'auto_mode' };
  }
}

async function sendAIResponse(telegramId, user, response, businessConnectionId) {
  const responseText = typeof response === 'object' ? response.text : response;
  const paymentData = typeof response === 'object' ? response.sendPayment : null;

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
  const name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || null;
  const text = msg.text || msg.caption || null;
  const photo = msg.photo;

  // Ignore unsupported message types (voice, sticker, video, document, etc.)
  if (!text && !photo) {
    try {
      const user = await users.findOrCreate(telegramId, name, username);
      await messages.save(user.id, 'user', '[неподдерживаемый формат]');
    } catch (e) { /* ignore */ }
    return;
  }

  try {
    // Check global AI setting
    const globalAi = await config.getSetting('global_ai_enabled');
    if (globalAi === 'false') {
      const user = await users.findOrCreate(telegramId, name, username);
      if (text) await messages.save(user.id, 'user', text);
      else if (photo) await messages.save(user.id, 'user', '[фото]');
      return;
    }

    const user = await users.findOrCreate(telegramId, name, username);

    // Photo message handling
    if (photo && Array.isArray(photo) && photo.length > 0) {
      await messages.save(user.id, 'user', msg.caption || '[фото]');

      if (!user.ai_enabled) return;
      const autoReply = await config.getSetting('auto_reply');
      if (autoReply === 'false') return;

      // Check AI mode
      const { shouldRespond } = checkAiMode(user, msg.caption || '[фото]');
      if (!shouldRespond) return;

      const largest = photo[photo.length - 1];
      const fileUrl = await bot.getFileUrl(largest.file_id);

      let response;
      if (fileUrl) {
        response = await processPhoto(user, fileUrl, msg.caption || null);
      } else {
        response = 'Не удалось загрузить фото 😔 Попробуй отправить ещё раз или напиши название товара текстом';
      }

      await sendAIResponse(telegramId, user, response, businessConnectionId);
      return;
    }

    // Text message handling
    await messages.save(user.id, 'user', text);

    if (!user.ai_enabled) return;

    const autoReply = await config.getSetting('auto_reply');
    if (autoReply === 'false') return;

    // Check AI mode
    const { shouldRespond } = checkAiMode(user, text);
    if (!shouldRespond) return;

    const response = await processMessage(user, text);

    if (response) {
      await sendAIResponse(telegramId, user, response, businessConnectionId);
    }
  } catch (err) {
    console.error(`Error handling message from ${telegramId}:`, err);
    const errOpts = businessConnectionId ? { business_connection_id: businessConnectionId } : {};
    await bot.sendMessage(telegramId, 'Произошла ошибка, попробуйте ещё раз через минуту.', errOpts);
  }
}

module.exports = { handleMessage, checkAiMode, isSimpleMessage, isComplexMessage, AI_MODES };
