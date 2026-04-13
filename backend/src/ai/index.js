const axios = require('axios');
const config = require('../config');
const prompts = require('../db/prompts');
const messages = require('../db/messages');
const memory = require('../db/memory');

async function generateResponse(user, userMessage, { productContext, catalogAvailable, scenario } = {}) {
  const [corePrompt, salesPrompt, customerMemory] = await Promise.all([
    prompts.get('core_prompt'),
    prompts.get('sales_prompt'),
    memory.get(user.id).catch(() => null),
  ]);

  // Get conversation history
  const history = await messages.getHistory(user.id, 15);

  let systemMessage = `${corePrompt}\n\n${salesPrompt}\n\nТекущее состояние клиента: ${user.state}\nИмя клиента: ${user.name || 'неизвестно'}`;

  // Inject customer memory for personalized responses
  const memoryContext = memory.buildContextForAI(customerMemory);
  if (memoryContext) {
    systemMessage += `\n\n--- ПАМЯТЬ О КЛИЕНТЕ ---\n${memoryContext}\n--- КОНЕЦ ПАМЯТИ ---\n\nПРАВИЛА РАБОТЫ С ПАМЯТЬЮ:\n- НЕ спрашивай заново то, что уже знаешь (размер, имя, адрес, телефон).\n- Вместо этого УТОЧНЯЙ: «размер 44 оставляем?», «отправим на тот же адрес?»\n- НЕ утверждай, что данные точно те же — ВСЕГДА спрашивай «или что-то изменилось?»\n- Если чего-то не хватает — мягко запроси.`;
  }

  // Next action recommendation
  const nextAction = memory.getNextAction(user, customerMemory);
  if (nextAction) {
    systemMessage += `\n\nРЕКОМЕНДАЦИЯ: ${nextAction}`;
  }

  // State-specific behavior hints
  const stateHints = {
    NEW: '\n\nСЕЙЧАС: Клиент новый. Узнай что ищет. Задай ОДИН вопрос.',
    WAITING_SIZE: '\n\nСЕЙЧАС: Клиент выбирает товар/размер. Помоги определиться. Один вопрос.',
    WAITING_FORM: '\n\nСЕЙЧАС: Клиент готов оформить. Попроси ФИО, телефон, адрес одним сообщением.',
    WAITING_PAYMENT: '\n\nСЕЙЧАС: Ждём оплату. Если клиент молчит — мягко напомни. Если сомневается — дожми.',
    PAID: '\n\nСЕЙЧАС: Клиент оплатил. Поблагодари, предложи что-то ещё если уместно.',
    DONE: '\n\nСЕЙЧАС: Завершённый клиент. Если вернулся — прими как старого знакомого.',
    FOLLOWUP: '\n\nСЕЙЧАС: Реактивация неактивного клиента. Пиши коротко, как живой человек.',
  };

  if (stateHints[user.state]) {
    systemMessage += stateHints[user.state];
  }

  // Followup scenario context
  if (scenario) {
    systemMessage += `\nСценарий реактивации: ${scenario}`;
  }

  if (productContext) {
    systemMessage += `\n\n--- КАТАЛОГ ТОВАРОВ С САЙТА (актуальные данные) ---\n${productContext}\n--- КОНЕЦ КАТАЛОГА ---\n\nСТРОГИЕ ПРАВИЛА:\n1. Предлагай ТОЛЬКО товары из каталога выше.\n2. Называй ТОЛЬКО цены из каталога. Не округляй, не выдумывай.\n3. Называй ТОЛЬКО размеры из каталога.\n4. НЕ придумывай товары, цены, размеры или наличие.\n5. НИКОГДА не говори «нет в наличии», «нет такого», «не могу найти».\n6. Если товара нет в каталоге — НЕ ГОВОРИ ОБ ЭТОМ. Покажи похожие варианты из каталога.\n7. Если клиент спрашивает о товаре, которого нет — предложи ближайшие альтернативы.\n8. Всегда заканчивай вопросом: размер, оформляем, какой нравится.\n9. Если товар [НЕТ В НАЛИЧИИ] — предложи похожие, НЕ сообщай что нет в наличии.`;
  } else if (catalogAvailable === false) {
    systemMessage += `\n\nВНИМАНИЕ: Каталог товаров сейчас обновляется. НЕ НАЗЫВАЙ конкретные товары, цены или размеры. Скажи что уточняешь наличие. Задавай уточняющие вопросы (размер, бренд, предпочтения). НИКОГДА не говори что каталог недоступен или товара нет.`;
  }

  const chatMessages = [
    { role: 'system', content: systemMessage },
    ...history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    })),
  ];

  // If last message isn't already the current user message, add it
  const lastMsg = chatMessages[chatMessages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    chatMessages.push({ role: 'user', content: userMessage });
  }

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const aiStart = Date.now();
      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: config.get('OPENROUTER_MODEL'),
          messages: chatMessages,
          max_tokens: 500,
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${config.get('OPENROUTER_API_KEY')}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      );

      try { require('../monitoring').recordSuccess('ai', Date.now() - aiStart); } catch(e) {}
      return response.data.choices[0]?.message?.content || '';
    } catch (err) {
      const status = err.response?.status;
      if (attempt < 1 && (status === 429 || (status >= 500 && status < 600))) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error('AI error:', err.response?.data || err.message);
      try { require('../monitoring').recordError('ai', err.message || 'AI request failed'); } catch(e) {}
      return '';
    }
  }
}

module.exports = { generateResponse };
