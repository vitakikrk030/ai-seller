const DEFAULT_PATTERNS = {
  ready_to_buy: /купить|заказать|оформить|беру|берём|берем|давай|го\b|хочу|закаж/i,
  size_question: /размер|стелька|длина стопы|сантиметр|см\b|xl|xxl|xs\b|\b\d{2}\b/i,
  price_question: /цена|стоит|сколько|стоимость|поч[её]м|дорого|д[её]шево/i,
  doubt: /подумаю|не знаю|может быть|не уверен|сомнева|потом|позже|дорого|не готов/i,
  complaint: /жалоб|рекламаци|возврат|брак|обмен|сломал|порвал|проблема|не пришл|не получил|потерял/i,
  repeat_order: /ещ[её] раз|снова|повторно|как прошлый|как раньше|тот же|те же/i,
  payment_confirm: /оплатил|перевел|перев[её]л|отправил|оплата|скрин|чек|квитанц/i,
  confirmation: /^(да|ок|окей|ага|угу|конечно|давай|подтверж|верно|точно|именно)\b/i,
  greeting: /^(привет|здравствуй|добрый|хай|hi\b|hello|йо\b|ку\b)/i,
  offtopic: /погод|политик|анекдот|расскажи историю|смысл жизни|ты бот|ты человек|сколько тебе лет/i,
  product_question: /есть|наличи|покажи|что у вас|ассортимент|модел|коллекц|новинк|бренд|nike|adidas|puma|jordan|reebok/i,
};

async function detectIntent(text, _userState, memory) {
  if (!text || text.trim().length === 0) {
    return { intent: 'unknown', confidence: 'low', meta: {} };
  }

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

  if (memory?.shoe_size && /оформ|достав|адрес|телефон|фио/i.test(text)) {
    return { intent: 'ready_to_buy', confidence: 'medium', meta: { source: 'memory' } };
  }

  return { intent: 'unknown', confidence: 'low', meta: {} };
}

function getIntentDescription(intent) {
  const descriptions = {
    product_question: 'Клиент интересуется товаром. Предлагай варианты из каталога.',
    size_question: 'Клиент уточняет размер. Помоги определиться и двигай к оформлению.',
    price_question: 'Клиент спрашивает о цене. Дай цену из каталога и веди к покупке.',
    doubt: 'Клиент сомневается. Сними возражение и верни к следующему шагу.',
    ready_to_buy: 'Клиент готов купить. Максимально сокращай путь до заказа.',
    complaint: 'Проблема или жалоба. Действуй спокойно и аккуратно.',
    repeat_order: 'Повторный заказ. Используй память и ускоряй оформление.',
    offtopic: 'Оффтоп. Мягко верни к теме покупки.',
    greeting: 'Приветствие. Быстро выясни потребность.',
    confirmation: 'Подтверждение. Двигай разговор дальше.',
    payment_confirm: 'Клиент сообщает об оплате или чеке. Подтверди получение и объясни, что идёт ручная проверка.',
    unknown: 'Намерение неясно. Задай один уточняющий вопрос.',
  };
  return descriptions[intent] || descriptions.unknown;
}

module.exports = { detectIntent, getIntentDescription };
