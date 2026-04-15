const aiClient = require('./client');
const messages = require('../db/messages');
const memory = require('../db/memory');
const aiSettings = require('../db/ai_settings');
const safety = require('./safety');

// ═══════════════════════════════════════
// CLOSER PROMPT — единственный режим
// ═══════════════════════════════════════
const CLOSER_PROMPT = `Ты продавец кроссовок (closer).

Правила:
- всегда ведёшь к покупке
- не задаёшь лишних вопросов
- если клиент выбрал товар → сразу оформляешь
- не говоришь про менеджера
- не передаёшь диалог

Ты:
- подтверждаешь наличие
- называешь цену
- ведёшь к оплате

Отвечай коротко, уверенно, по делу.

Цель — закрыть клиента.

ЗАПРЕЩЕНО: упоминать менеджера, оператора, поддержку, передачу диалога.
ЗАПРЕЩЕНО: говорить "уточню", "проверю", "к сожалению нет".
ЗАПРЕЩЕНО: задавать вопрос о размере если размер уже назван.`;

// SSE broadcast — lazy require to avoid circular dependency
function _broadcastAI(event, data) {
  try {
    const router = require('../api/routes');
    if (router.broadcastSSE) router.broadcastSSE(event, data);
  } catch {}
}

/**
 * Генерация ответа — только Closer режим.
 * @param {object} user
 * @param {string} userMessage
 * @param {object} opts
 * @param {string|null} opts.productContext — текст каталога для AI
 * @param {boolean} opts.catalogAvailable
 * @param {string|null} opts.scenario — сценарий реактивации
 */
async function generateResponse(user, userMessage, { productContext, catalogAvailable, scenario } = {}) {
  _broadcastAI('ai_typing', { userId: user.id, typing: true });

  try {
    // Кастомный промпт из БД (если задан) — иначе дефолтный CLOSER_PROMPT
    const customPrompt = await aiSettings.get('style_closer_hint').catch(() => null);
    const systemBase = customPrompt || CLOSER_PROMPT;

    // Память клиента
    const customerMemory = await memory.get(user.id).catch(() => null);
    const memCtx = memory.buildContextForAI ? memory.buildContextForAI(customerMemory) : null;

    // Строим system prompt
    let systemMessage = systemBase;
    systemMessage += `\n\nТекущее состояние клиента: ${user.state}`;
    if (user.name) systemMessage += `\nИмя клиента: ${user.name}`;

    if (memCtx) {
      systemMessage += `\n\n--- ПАМЯТЬ О КЛИЕНТЕ ---\n${memCtx}\n--- КОНЕЦ ПАМЯТИ ---\nНЕ спрашивай заново то, что уже знаешь.`;
    }

    if (productContext) {
      systemMessage += `\n\n--- КАТАЛОГ ТОВАРОВ (актуальные данные) ---\n${productContext}\n--- КОНЕЦ КАТАЛОГА ---\n\nПРАВИЛА:\n1. Предлагай ТОЛЬКО товары из каталога.\n2. Называй ТОЛЬКО цены из каталога.\n3. НИКОГДА не говори «нет в наличии».\n4. Если товара нет — покажи похожие.\n5. Всегда веди к оформлению.`;
    } else if (catalogAvailable === false) {
      systemMessage += `\n\nКаталог обновляется. Задавай уточняющие вопросы о предпочтениях.`;
    }

    if (scenario) systemMessage += `\n\nСценарий реактивации: ${scenario}`;

    // История диалога
    const history = await messages.getHistory(user.id, 15);
    const chatMessages = [
      { role: 'system', content: systemMessage },
      ...history.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.text,
      })),
    ];

    // Добавляем текущее сообщение если его нет в истории
    const lastMsg = chatMessages[chatMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
      chatMessages.push({ role: 'user', content: userMessage });
    }

    console.log(`AI INPUT (user=${user.id}, state=${user.state}):`, userMessage.substring(0, 80));

    // Генерация с retry
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const temperature = attempt === 0 ? 0.3 : 0.5 + attempt * 0.1;
        const { text } = await aiClient.sendMessage({ messages: chatMessages, temperature });

        if (!text) continue;

        console.log(`AI OUTPUT (user=${user.id}):`, text.substring(0, 80));
        _broadcastAI('ai_typing', { userId: user.id, typing: false });
        return text;

      } catch (err) {
        const status = err.response?.status;
        if (attempt < MAX_ATTEMPTS - 1 && (status === 429 || (status >= 500 && status < 600))) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        console.error('AI error:', err.response?.data || err.message);
        try { require('../monitoring').recordError('ai', err.message || 'AI request failed'); } catch(e) {}
        break;
      }
    }

    // Fallback из БД
    const fallback = await aiSettings.pickFallback('general').catch(() => null);
    _broadcastAI('ai_typing', { userId: user.id, typing: false });
    return fallback || 'Сек, сейчас отвечу 👌';

  } catch (err) {
    console.error('generateResponse fatal:', err.message);
    _broadcastAI('ai_typing', { userId: user.id, typing: false });
    return 'Сек, сейчас отвечу 👌';
  }
}

/**
 * Preview — тестовый запрос без отправки клиенту.
 */
async function previewResponse(testMessage, scenario, userState = 'NEW') {
  const fakeUser = { id: 0, state: userState, name: 'Тест', telegram_id: 0 };
  return generateResponse(fakeUser, testMessage, { scenario });
}

module.exports = { generateResponse, previewResponse };
