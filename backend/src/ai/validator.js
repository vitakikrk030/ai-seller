/**
 * Validate AI response against real catalog data.
 * Fallback-тексты берутся из AI Settings (ai_speech_settings).
 */

const MAX_RESPONSE_LENGTH = 500;

const ROBOT_PATTERNS = [
  /я (?:—|-)?\s*(?:искусственный интеллект|ии|ai|бот|робот|языковая модель)/i,
  /как (?:искусственный интеллект|ии|ai|бот|языковая модель)/i,
  /я не (?:могу|умею|способен) (?:чувствовать|думать|иметь|испытывать)/i,
  /я (?:всего лишь|просто) (?:программа|бот|алгоритм)/i,
];

const NEGATIVE_PATTERNS = [
  /нет в наличии/i,
  /нет в каталоге/i,
  /у нас (?:такого |этого )?нет/i,
  /не (?:могу|удалось) найти/i,
  /не (?:могу|удалось) (?:определить|распознать)/i,
  /(?:к сожалению|увы)[,.]?\s*(?:этой|такой|данной) модели нет/i,
  /(?:этого|такого) товара нет/i,
  /отсутствует в (?:каталоге|наличии)/i,
  /нет в продаже/i,
  /закончил(?:ся|ась|ись|ось)/i,
];

function validateResponse(aiResponse, products, catalogAvailable) {
  if (!aiResponse || aiResponse.trim().length === 0) {
    return { valid: false, response: null, reason: 'empty_response' };
  }

  let text = aiResponse.trim();

  if (text.length > MAX_RESPONSE_LENGTH) {
    const truncated = text.substring(0, MAX_RESPONSE_LENGTH);
    const lastSentence = truncated.lastIndexOf('.');
    const lastExcl = truncated.lastIndexOf('!');
    const lastQ = truncated.lastIndexOf('?');
    const cutPoint = Math.max(lastSentence, lastExcl, lastQ);
    if (cutPoint > MAX_RESPONSE_LENGTH * 0.5) {
      text = truncated.substring(0, cutPoint + 1);
    } else {
      text = truncated + '…';
    }
  }

  for (const pattern of ROBOT_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, response: null, reason: 'robot_reveal' };
    }
  }

  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, response: null, reason: 'negative_availability' };
    }
  }

  if (!catalogAvailable) {
    const pricePattern = /\d{3,}[₽руб\.рub]/i;
    if (pricePattern.test(text)) {
      return { valid: false, response: null, reason: 'price_without_catalog' };
    }
    return { valid: true, response: text };
  }

  if (products && products.length > 0) {
    const realPrices = new Set(
      products.filter((p) => p.price).map((p) => String(p.price))
    );
    const mentionedPrices = text.match(/(\d[\d\s]*\d)\s*[₽руб]/gi) || [];
    for (const priceStr of mentionedPrices) {
      const digits = priceStr.replace(/[^\d]/g, '');
      if (digits.length >= 3 && !realPrices.has(digits)) {
        if (parseInt(digits) >= 1000) {
          return { valid: false, response: null, reason: `fabricated_price:${digits}` };
        }
      }
    }
  }

  return { valid: true, response: text };
}

/**
 * Получить безопасный fallback из AI Settings.
 */
async function getSafeFallback(status, reason) {
  let key = null;

  if (status === 'not_configured') key = 'fallback_not_configured';
  else if (status === 'api_error') key = 'fallback_api_error';
  else if (status === 'empty_catalog') key = 'fallback_empty_catalog';
  else if (reason === 'robot_reveal') key = 'fallback_robot_reveal';
  else if (reason === 'negative_availability') key = 'fallback_negative_avail';
  else if (reason === 'price_without_catalog') key = 'fallback_price_error';
  else if (reason && reason.startsWith('fabricated_price:')) key = 'fallback_price_error';

  try {
    const aiSettings = require('../db/ai_settings');
    if (key) {
      const val = await aiSettings.get(key);
      if (val) return val;
    }
    // Всегда берём из AI Settings — никакого хардкода
    return await aiSettings.pickFallback('blocked');
  } catch (e) {
    // Аварийный минимум — только если БД недоступна
    return await require('../db/ai_settings').pickFallback('general').catch(() => 'Секунду');
  }
}

module.exports = { validateResponse, getSafeFallback };
