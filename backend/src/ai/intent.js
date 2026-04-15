/**
 * Intent Engine — определяет намерение клиента перед генерацией ответа.
 * Запрещено отвечать без определения intent.
 *
 * Intents:
 *   product_question  — вопрос о товаре
 *   size_question     — вопрос о размере
 *   price_question    — вопрос о цене
 *   doubt             — сомнение / колебание
 *   ready_to_buy      — готов купить
 *   complaint         — жалоба / возврат / брак
 *   repeat_order      — повторный заказ
 *   offtopic          — оффтоп
 *   greeting          — приветствие
 *   confirmation      — подтверждение (да/ок/угу)
 *   payment_confirm   — подтверждение оплаты
 *   unknown           — не определено
 */

const aiSettings = require('../db/ai_settings');

// ═══════════════════════════════════════
// ПАТТЕРНЫ ПО УМОЛЧАНИЮ
// ═══════════════════════════════════════

const DEFAULT_PATTERNS = {
  ready_to_buy: /купить|заказать|оформить|беру|берём|берем|давай|го\b|хочу|закаж/i,
  size_question: /размер|стелька|длина стопы|сантиметр|см\b|xl|xxl|xs\b|\b\d{2}\b/i,
  price_question: /цена|стоит|сколько|стоимость|почём|дорого|дёшево/i,
  doubt: /подумаю|не знаю|может быть|не уверен|сомнева|потом|позже|дорого|не готов/i,
  complaint: /жалоб|рекламаци|возврат|брак|обмен|сломал|порвал|проблема|не пришл|не получил|потерял/i,
  repeat_order: /ещё раз|снова|повторно|как прошлый|как раньше|тот же|те же/i,
  payment_confirm: /оплатил|перевел|перевёл|отправил|оплата|скрин|чек|квитанц/i,
  confirmation: /^(да|ок|окей|ага|угу|конечно|давай|подтверж|верно|точно|именно)\b/i,
  greeting: /^(привет|здравствуй|добрый|хай|hi\b|hello|йо\b|ку\b)/i,
  offtopic: /погод|политик|анекдот|расскажи историю|смысл жизни|ты бот|ты человек|сколько тебе лет/i,
  product_question: /есть|наличи|покажи|что у вас|ассортимент|модел|коллекц|новинк|бренд|nike|adidas|puma|jordan|reebok/i,
};

// ═══════════════════════════════════════
// ОПРЕДЕЛЕНИЕ INTENT
// ═══════════════════════════════════════

/**
 * Определить намерение клиента.
 * @param {string} text — сообщение клиента
 * @param {string} userState — текущее состояние воронки
 * @param {object} memory — память клиента
 * @returns {Promise<{ intent: string, confidence: 'high'|'medium'|'low', meta: object }>}
 */
async function detectIntent(text, userState, memory) {
  if (!text || text.trim().length === 0) {
    return { intent: 'unknown', confidence: 'low', meta: {} };
  }

  const lower = text.toLowerCase().trim();

  // Порядок важен — более специфичные паттерны первыми
  const checks = [
    ['payment_confirm', DEFAULT_PATTERNS.payment_confirm],
    ['complaint', DEFAULT_PATTERNS.complaint],
    ['repeat_order', DEFAULT_PATTERNS.repeat_order],
    ['ready_to_buy', DEFAULT_PATTERNS.ready_to_buy],
    ['confirmation', DEFAULT_PATTERNS.confirmation],
    ['greeting', DEFAULT_PATTERNS.greeting],
    ['offtopic', DEFAULT_PATTERNS.offtopic],
    ['price_question', DEFAULT_PATTERNS.price_question],
    ['size_question', DEFAULT_PATTERNS.size_question],
    ['doubt', DEFAULT_PATTERNS.doubt],
    ['product_question', DEFAULT_PATTERNS.product_question],
  ];

  for (const [intent, pattern] of checks) {
    if (pattern.test(text)) {
      return {
        intent,
        confidence: 'high',
        meta: { matched_pattern: intent },
      };
    }
  }

  // Контекстный intent по состоянию воронки
  const contextIntent = getContextIntent(userState, lower, memory);
  if (contextIntent) {
    return { intent: contextIntent, confidence: 'medium', meta: { context: userState } };
  }

  return { intent: 'unknown', confidence: 'low', meta: {} };
}

/**
 * Определить intent по контексту воронки.
 */
function getContextIntent(state, lower, memory) {
  switch (state) {
    case 'WAITING_SIZE':
      // В этом состоянии любое число — скорее всего размер
      if (/\d/.test(lower)) return 'size_question';
      break;
    case 'WAITING_FORM':
      // Если есть телефон — подтверждение данных
      if (/\+?\d[\d\s\-()]{8,}/.test(lower)) return 'confirmation';
      break;
    case 'WAITING_PAYMENT':
      // Любое сообщение в этом состоянии — либо оплата либо сомнение
      if (/дорого|подумаю|не готов|потом/.test(lower)) return 'doubt';
      return 'payment_confirm';
    case 'DONE':
      // Вернувшийся клиент — скорее всего повторный заказ
      if (memory && memory.order_count > 0) return 'repeat_order';
      break;
  }
  return null;
}

/**
 * Получить описание intent для промпта.
 */
function getIntentDescription(intent) {
  const descriptions = {
    product_question: 'Клиент интересуется товаром. Покажи варианты, предложи выбрать.',
    size_question: 'Клиент спрашивает о размере. Помоги определиться, запроси стельку если нужно.',
    price_question: 'Клиент спрашивает о цене. Назови цену из каталога, предложи оформить.',
    doubt: 'Клиент сомневается. Используй дожим: дефицит, ценность, прямой вопрос.',
    ready_to_buy: 'Клиент готов купить. Быстро переходи к оформлению, не теряй момент.',
    complaint: 'Жалоба или проблема. Прими с пониманием, передай менеджеру.',
    repeat_order: 'Повторный заказ. Используй прошлые данные, предложи то же или новинки.',
    offtopic: 'Оффтоп. Мягко верни к теме покупки за одну фразу.',
    greeting: 'Приветствие. Поздоровайся и узнай что ищет.',
    confirmation: 'Подтверждение. Прими и двигайся дальше по воронке.',
    payment_confirm: 'Клиент подтверждает оплату. Поблагодари и сообщи о следующем шаге.',
    unknown: 'Намерение неясно. Задай уточняющий вопрос.',
  };
  return descriptions[intent] || descriptions.unknown;
}

module.exports = { detectIntent, getIntentDescription };
