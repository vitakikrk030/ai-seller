
/**
 * Validate AI response against real catalog data.
 * Returns { valid: bool, response: string, reason?: string }
 *
 * Rules:
 * 1. If catalog available — response must not mention prices/products NOT in catalog
 * 2. If catalog empty/down — response must NOT contain specific product names or prices
 * 3. Response must not be empty
 * 4. Response must not be too long (quality guard)
 * 5. Response must not reveal AI identity
 */

const MAX_RESPONSE_LENGTH = 500;

// Паттерны робо-языка, который нужно блокировать
const ROBOT_PATTERNS = [
  /я (?:—|-)?\s*(?:искусственный интеллект|ии|ai|бот|робот|языковая модель)/i,
  /как (?:искусственный интеллект|ии|ai|бот|языковая модель)/i,
  /я не (?:могу|умею|способен) (?:чувствовать|думать|иметь|испытывать)/i,
  /я (?:всего лишь|просто) (?:программа|бот|алгоритм)/i,
];

// SOFT_AVAILABILITY_MODE: фразы-убийцы продаж, которые нельзя говорить
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

  // Quality guard: too long → trim (don't reject, just truncate)
  if (text.length > MAX_RESPONSE_LENGTH) {
    // Find last sentence boundary within limit
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

  // Quality guard: AI reveals its identity
  for (const pattern of ROBOT_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, response: null, reason: 'robot_reveal' };
    }
  }

  // SOFT_AVAILABILITY_MODE: AI must never say "нет в наличии" / "нет такого"
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { valid: false, response: null, reason: 'negative_availability' };
    }
  }

  // If catalog is not available, AI must NOT mention specific products or prices
  if (!catalogAvailable) {
    const pricePattern = /\d{3,}[₽руб\.рub]/i;
    if (pricePattern.test(text)) {
      return {
        valid: false,
        response: null,
        reason: 'price_without_catalog',
      };
    }
    // Allow the response through — AI should be asking clarifying questions
    return { valid: true, response: text };
  }

  // Catalog is available — check for fabricated prices
  if (products && products.length > 0) {
    const realPrices = new Set(
      products.filter((p) => p.price).map((p) => String(p.price))
    );

    // Find all price-like patterns in AI response
    const mentionedPrices = text.match(/(\d[\d\s]*\d)\s*[₽руб]/gi) || [];
    for (const priceStr of mentionedPrices) {
      const digits = priceStr.replace(/[^\d]/g, '');
      if (digits.length >= 3 && !realPrices.has(digits)) {
        // Check if it's a delivery fee or something small — allow prices < 1000
        if (parseInt(digits) >= 1000) {
          return {
            valid: false,
            response: null,
            reason: `fabricated_price:${digits}`,
          };
        }
      }
    }
  }

  return { valid: true, response: text };
}

/**
 * Get a safe fallback response when AI validation fails or catalog is down.
 */
function getSafeFallback(status, reason) {
  if (status === 'not_configured') {
    return 'Каталог сейчас обновляется. Скинь что ищешь — передам менеджеру и он ответит 🙏';
  }

  if (status === 'api_error') {
    return 'Ой, информация о товарах временно недоступна. Скинь что интересует — менеджер поможет 🙏';
  }

  if (status === 'empty_catalog') {
    return 'Каталог пока пуст — возможно, обновляется. Напиши что ищешь, менеджер подскажет 🙏';
  }

  if (reason === 'fabricated_price' || (reason && reason.startsWith('fabricated_price:'))) {
    return 'Секунду, уточню актуальную цену. Что именно интересует? 🤔';
  }

  if (reason === 'price_without_catalog') {
    return 'Сейчас не могу подтвердить цены. Менеджер уточнит. Что ищешь? 🙏';
  }

  if (reason === 'robot_reveal') {
    return 'Чё ищешь? Помогу подобрать 😊';
  }

  if (reason === 'negative_availability') {
    return 'Сейчас гляну по наличию 👀 Если что — подберу похожие. Какой размер нужен?';
  }

  return 'Чё присматриваешь? Помогу подобрать 😊';
}

module.exports = { validateResponse, getSafeFallback };
