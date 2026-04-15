/**
 * Off-topic detector — определяет, уходит ли клиент от темы покупки.
 * Возвращает { offtopic: bool, redirect: string|null }
 * Тексты редиректов берутся из AI Settings (ai_speech_settings).
 */

const aiSettings = require('../db/ai_settings');

// Паттерны оффтопных тем
const OFFTOPIC_PATTERNS = [
  /погод[аеуы]|дождь|снег|солнц[еоа]|температур|жарк[оа]|холодн[оа]|мороз/i,
  /политик|выбор[ыа]|депутат|президент|правительств|партия/i,
  /как тебя зовут|сколько тебе лет|ты (бот|робот|человек|живой|настоящий)|кто ты|ты (парень|девушка)/i,
  /анекдот|шутк[аиу]|расскажи (историю|сказку|что-нибудь)|поиграем|поболтаем/i,
  /помоги с (домашк|уроком|задач|математик|физик|химии)/i,
  /новост[ия]|что нового в мире|что происходит/i,
  /смысл жизни|зачем мы живём|что такое (счастье|любовь|дружба)/i,
];

// Ключевые слова продажи (если есть — НЕ оффтоп)
const SALES_KEYWORDS = [
  'куп', 'заказ', 'цен', 'стоим', 'размер', 'кросс', 'обув', 'одежд',
  'nike', 'adidas', 'puma', 'jordan', 'reebok', 'new balance',
  'доставк', 'оплат', 'карт', 'перевод', 'наличи', 'товар',
  'модел', 'коллекц', 'новинк', 'скидк', 'акци', 'распродаж',
  'фио', 'телефон', 'адрес', 'оформ', 'подтверд',
  'хочу', 'нравится', 'подойд', 'посмотр', 'покаж', 'есть',
  'чёрн', 'бел', 'крас', 'сини', 'зелён',
];

/**
 * Проверяет, является ли сообщение оффтопом.
 * @param {string} text — сообщение пользователя
 * @returns {Promise<{ offtopic: boolean, redirect: string|null }>}
 */
async function detectOfftopic(text) {
  if (!text || text.trim().length === 0) {
    return { offtopic: false, redirect: null };
  }

  const lower = text.toLowerCase();

  // Если в тексте есть ключевые слова продажи — не оффтоп
  const hasSalesIntent = SALES_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasSalesIntent) {
    return { offtopic: false, redirect: null };
  }

  // Проверяем оффтоп-паттерны
  const isOfftopic = OFFTOPIC_PATTERNS.some((pattern) => pattern.test(text));
  if (isOfftopic) {
    const redirect = await aiSettings.pickOfftopicRedirect();
    return { offtopic: true, redirect };
  }

  return { offtopic: false, redirect: null };
}

module.exports = { detectOfftopic, OFFTOPIC_PATTERNS, SALES_KEYWORDS };
