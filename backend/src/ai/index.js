const aiClient = require('./client');
const config = require('../config');
const prompts = require('../db/prompts');
const messages = require('../db/messages');
const memory = require('../db/memory');
const aiSettings = require('../db/ai_settings');
const managerLearning = require('../db/manager_learning');
const { detectIntent, getIntentDescription } = require('./intent');
const { decide } = require('./decision');
const analytics = require('./analytics');
const { calculateDialogScore, selectStrategy, getStrategyHint } = require('./optimizer');

// ═══════════════════════════════════════
// ANTI-REPEAT: хранить последние ответы по user_id
// ═══════════════════════════════════════
const _recentResponses = new Map(); // userId → string[]

function _storeResponse(userId, text) {
  const list = _recentResponses.get(userId) || [];
  list.push(text);
  if (list.length > 5) list.shift();
  _recentResponses.set(userId, list);
}

function _similarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : intersection / union;
}

async function _isRepeat(userId, text) {
  const enabled = await aiSettings.isEnabled('toggle_anti_repeat').catch(() => false);
  if (!enabled) return false;
  const threshold = parseFloat(await aiSettings.getRaw('anti_repeat_sensitivity').catch(() => '0.6')) || 0.6;
  const recent = _recentResponses.get(userId) || [];
  return recent.some(prev => _similarity(prev, text) >= threshold);
}

// ═══════════════════════════════════════
// SELF-CHECK: проверить ответ перед отправкой
// ═══════════════════════════════════════

const TEMPLATE_PHRASES = [
  /здравствуйте,?\s+чем\s+могу\s+помочь/i,
  /рад[а]?\s+вас\s+приветствовать/i,
  /если\s+у\s+вас\s+есть\s+вопросы/i,
  /не\s+стесняйтесь\s+обращаться/i,
  /с\s+удовольствием\s+помогу/i,
  /благодарю\s+за\s+обращение/i,
  /надеюсь,?\s+что\s+смог[ла]?\s+помочь/i,
];

async function _selfCheck(text, addressFormat) {
  const enabled = await aiSettings.isEnabled('toggle_self_check').catch(() => false);
  if (!enabled) return { ok: true };

  // Проверка шаблонности
  for (const p of TEMPLATE_PHRASES) {
    if (p.test(text)) return { ok: false, reason: 'template_phrase' };
  }

  // Проверка формата ты/вы
  if (addressFormat === 'ты') {
    const hasVy = /\bвы\b|\bвас\b|\bвам\b|\bвашем?\b|\bвашей\b|\bвашим\b/i.test(text);
    if (hasVy) return { ok: false, reason: 'wrong_address_format_vy' };
  } else if (addressFormat === 'вы') {
    const hasTy = /\bты\b|\bтебя\b|\bтебе\b|\bтвой\b|\bтвоя\b|\bтвоё\b|\bтвоих?\b/i.test(text);
    if (hasTy) return { ok: false, reason: 'wrong_address_format_ty' };
  }

  return { ok: true };
}

// ═══════════════════════════════════════
// MAIN: generateResponse
// ═══════════════════════════════════════

function _broadcastAI(event, data) {
  try { require('../api/routes').broadcastSSE(event, data); } catch {}
}

async function generateResponse(user, userMessage, { productContext, catalogAvailable, scenario, intent: passedIntent } = {}) {
  // Signal AI is typing
  _broadcastAI('ai_typing', { userId: user.id, typing: true });
  // Промпты читаются из ai_speech_settings (категория prompts) — единый источник правды
  const [corePromptAI, salesPromptAI, corePromptLegacy, salesPromptLegacy, customerMemory] = await Promise.all([
    aiSettings.get('prompt_core_prompt').catch(() => null),
    aiSettings.get('prompt_sales_prompt').catch(() => null),
    prompts.get('core_prompt').catch(() => null),
    prompts.get('sales_prompt').catch(() => null),
    memory.get(user.id).catch(() => null),
  ]);
  const DEFAULT_CORE_PROMPT = 'Ты — продавец-консультант в Telegram-магазине. Общайся коротко, по-человечески, на русском. Помогай клиенту выбрать товар и оформить заказ.';
  const DEFAULT_SALES_PROMPT = 'Веди клиента по воронке: выбор товара → размер → данные доставки → оплата. Задавай один вопрос за раз.';
  const corePrompt = corePromptAI || corePromptLegacy || DEFAULT_CORE_PROMPT;
  const salesPrompt = salesPromptAI || salesPromptLegacy || DEFAULT_SALES_PROMPT;

  // ═══════════════════════════════════════
  // INTENT ENGINE — определяем намерение
  // ═══════════════════════════════════════
  const intentResult = passedIntent
    ? { intent: passedIntent, confidence: 'high', meta: {} }
    : await detectIntent(userMessage, user.state, customerMemory).catch(() => ({ intent: 'unknown', confidence: 'low', meta: {} }));

  // Трекаем intent для аналитики
  analytics.trackEvent(user.id, 'intent_detected', { state: user.state, intent: intentResult.intent }).catch(() => {});

  // Персона и стиль из AI Settings
  const [
    sellerName,
    sellerGender,
    addressFormat,
    salesStylePreset,
    msgLength,
    sellerTone,
  ] = await Promise.all([
    aiSettings.get('seller_name').catch(() => null),
    aiSettings.get('seller_gender').catch(() => null),
    aiSettings.get('seller_address_format').catch(() => 'ты'),
    aiSettings.get('sales_style_preset').catch(() => 'friendly'),
    aiSettings.get('seller_msg_length').catch(() => 'коротко'),
    aiSettings.get('seller_tone').catch(() => 'живой'),
  ]);

  // Стиль продаж
  const styleKeyMap = {
    friendly: 'style_friendly_hint',
    confident: 'style_confident_hint',
    aggressive: 'style_aggressive_hint',
    premium: 'style_premium_hint',
    closer: 'style_closer_hint',
  };
  const styleHint = await aiSettings.get(styleKeyMap[salesStylePreset] || 'style_friendly_hint').catch(() => null);

  // Closer mode override — check toggle
  const closerEnabled = salesStylePreset === 'closer'
    || await aiSettings.isEnabled('closer_mode_enabled').catch(() => false);

  const history = await messages.getHistory(user.id, 15);

  // Системный промпт — в режиме closer salesPrompt заменяется, а не дополняется
  let closerHint = null;
  if (closerEnabled) {
    closerHint = await aiSettings.get('style_closer_hint').catch(() => null);
  }

  // Если closer активен — используем closerHint вместо salesPrompt (нет конфликта инструкций)
  let systemMessage = closerHint
    ? `${corePrompt}\n\n${closerHint}`
    : `${corePrompt}\n\n${salesPrompt}`;

  // Персона
  if (sellerName) systemMessage += `\n\nИМЯ ПРОДАВЦА: ${sellerName}`;
  if (sellerGender) systemMessage += `\nПОЛ: ${sellerGender === 'male' ? 'мужской' : sellerGender === 'female' ? 'женский' : 'нейтральный'}`;

  // Формат обращения — КРИТИЧНО
  const addrLabel = addressFormat === 'вы' ? 'ВЫ (уважительно)' : 'ТЫ (неформально)';
  const addrWord = addressFormat === 'вы' ? 'вы' : 'ты';
  systemMessage += '\n\nФОРМАТ ОБРАЩЕНИЯ: СТРОГО на "' + addrWord + '". НИКОГДА не смешивай "ты" и "вы" в одном сообщении. Всегда ' + addrLabel + '.';

  // Стиль продаж (только если не closer — иначе уже включён в closerHint)
  if (!closerEnabled && styleHint) systemMessage += `\n\nСТИЛЬ ПРОДАЖ: ${styleHint}`;

  // Длина и тон
  const lengthMap = { 'коротко': '1-2 предложения', 'средне': '2-4 предложения', 'подробно': '4+ предложений' };
  systemMessage += `\n\nДЛИНА ОТВЕТА: ${lengthMap[msgLength] || '1-3 предложения'}. ТОН: ${sellerTone}.`;

  systemMessage += `\n\nТекущее состояние клиента: ${user.state}\nИмя клиента: ${user.name || 'неизвестно'}`;

  // ═══════════════════════════════════════
  // INTENT ENGINE — добавляем в промпт
  // ═══════════════════════════════════════
  const intentDesc = getIntentDescription(intentResult.intent);
  systemMessage += `\n\nНАМЕРЕНИЕ КЛИЕНТА: ${intentResult.intent} (уверенность: ${intentResult.confidence})\nЧТО ДЕЛАТЬ: ${intentDesc}`;

  // ═══════════════════════════════════════
  // СЕГМЕНТАЦИЯ КЛИЕНТА
  // ═══════════════════════════════════════
  const useSegments = await aiSettings.isEnabled('toggle_segments').catch(() => true);
  if (useSegments && customerMemory) {
    const orderCount = customerMemory.order_count || 0;
    const totalSpent = parseFloat(customerMemory.total_spent || 0);
    const vipOrders = parseInt(await aiSettings.getRaw('segment_vip_threshold_orders').catch(() => '3')) || 3;
    const vipAmount = parseFloat(await aiSettings.getRaw('segment_vip_threshold_amount').catch(() => '30000')) || 30000;

    let segmentHint = null;
    let segmentGreeting = null;

    if (orderCount >= vipOrders || totalSpent >= vipAmount) {
      segmentHint = await aiSettings.get('segment_vip_hint').catch(() => null);
      segmentGreeting = await aiSettings.get('segment_vip_greeting').catch(() => null);
      systemMessage += `\n\nСЕГМЕНТ: VIP клиент (${orderCount} заказов, ${totalSpent}₽)`;
    } else if (orderCount > 0) {
      segmentHint = await aiSettings.get('segment_returning_hint').catch(() => null);
      segmentGreeting = await aiSettings.get('segment_returning_greeting').catch(() => null);
      systemMessage += `\n\nСЕГМЕНТ: Повторный клиент (${orderCount} заказов)`;
    } else {
      segmentHint = await aiSettings.get('segment_new_hint').catch(() => null);
      systemMessage += `\n\nСЕГМЕНТ: Новый клиент`;
    }

    if (segmentHint) systemMessage += `\nИНСТРУКЦИЯ ПО СЕГМЕНТУ: ${segmentHint}`;
    if (segmentGreeting && user.state === 'NEW') systemMessage += `\nПРИВЕТСТВИЕ: ${segmentGreeting}`;
  }

  // ═══════════════════════════════════════
  // HEAT КЛИЕНТА
  // ═══════════════════════════════════════
  const msgCount = (await messages.getHistory(user.id, 50).catch(() => [])).filter(m => m.role === 'user').length;
  const hotThreshold = parseInt(await aiSettings.getRaw('heat_hot_threshold').catch(() => '5')) || 5;
  const coldDays = parseInt(await aiSettings.getRaw('heat_cold_days').catch(() => '7')) || 7;
  const daysSinceLastSeen = user.last_seen
    ? Math.floor((Date.now() - new Date(user.last_seen).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  let heatLevel = 'warm';
  if (msgCount >= hotThreshold) heatLevel = 'hot';
  else if (daysSinceLastSeen >= coldDays) heatLevel = 'cold';

  const heatHint = await aiSettings.get(`heat_${heatLevel}_hint`).catch(() => null);
  if (heatHint) systemMessage += `\n\nАКТИВНОСТЬ КЛИЕНТА (${heatLevel}): ${heatHint}`;

  // ═══════════════════════════════════════
  // DIALOG SCORE + STRATEGY ENGINE
  // ═══════════════════════════════════════
  const dialogScore = calculateDialogScore(user, customerMemory, msgCount, intentResult.intent);

  const vipOrdersThreshold = parseInt(await aiSettings.getRaw('segment_vip_threshold_orders').catch(() => '3')) || 3;
  const vipAmountThreshold = parseFloat(await aiSettings.getRaw('segment_vip_threshold_amount').catch(() => '30000')) || 30000;
  const orderCountForStrategy = customerMemory?.order_count || 0;
  const totalSpentForStrategy = parseFloat(customerMemory?.total_spent || 0);
  const segmentForStrategy = (orderCountForStrategy >= vipOrdersThreshold || totalSpentForStrategy >= vipAmountThreshold) ? 'vip'
    : orderCountForStrategy > 0 ? 'returning' : 'new';

  const strategy = selectStrategy({ heatLevel, score: dialogScore, segment: segmentForStrategy, intent: intentResult.intent, state: user.state });
  const strategyHint = await getStrategyHint(strategy, dialogScore);
  systemMessage += `\n\n${strategyHint}`;

  // Трекаем score для аналитики
  analytics.trackEvent(user.id, 'dialog_score', { state: user.state, intent: intentResult.intent, response_key: String(dialogScore) }).catch(() => {});

  // ═══════════════════════════════════════
  // UPSELL
  // ═══════════════════════════════════════
  const useUpsell = await aiSettings.isEnabled('toggle_upsell').catch(() => false);
  if (useUpsell && productContext) {
    const upsellThreshold = parseFloat(await aiSettings.getRaw('upsell_threshold').catch(() => '8000')) || 8000;
    const upsellHint = await aiSettings.get('upsell_hint').catch(() => null);
    if (upsellHint) {
      systemMessage += `\n\nUPSELL: Если клиент смотрит на товар дешевле ${upsellThreshold}₽ — предложи более дорогой вариант: "${upsellHint}"`;
    }
  }

  // ═══════════════════════════════════════
  // ДОЖИМ ПО ЦЕНЕ
  // ═══════════════════════════════════════
  const usePushdown = await aiSettings.isEnabled('toggle_pushdown').catch(() => true);
  if (usePushdown) {
    const pushdownThreshold = parseFloat(await aiSettings.getRaw('pushdown_price_threshold').catch(() => '0')) || 0;
    if (pushdownThreshold > 0) {
      systemMessage += `\n\nДОЖИМ: Усиливай дожим если цена товара выше ${pushdownThreshold}₽. Используй дефицит, социальное доказательство, прямой вопрос.`;
    }
  }

  // ═══════════════════════════════════════
  // СТОП-СЛОВА
  // ═══════════════════════════════════════
  const stopWordsRaw = await aiSettings.get('stop_words').catch(() => null);
  if (stopWordsRaw && stopWordsRaw.trim()) {
    const stopList = stopWordsRaw.split(',').map(w => w.trim()).filter(Boolean);
    if (stopList.length > 0) {
      systemMessage += `\n\nСТОП-СЛОВА: НИКОГДА не используй эти слова: ${stopList.join(', ')}`;
    }
  }

  // Память клиента
  const useMemory = await aiSettings.isEnabled('toggle_memory').catch(() => true);
  if (useMemory) {
    const memoryContext = memory.buildContextForAI(customerMemory);
    if (memoryContext) {
      systemMessage += `\n\n--- ПАМЯТЬ О КЛИЕНТЕ ---\n${memoryContext}\n--- КОНЕЦ ПАМЯТИ ---\n\nПРАВИЛА РАБОТЫ С ПАМЯТЬЮ:\n- НЕ спрашивай заново то, что уже знаешь.\n- Уточняй: «размер 44 оставляем?», «отправим на тот же адрес?»\n- Если чего-то не хватает — мягко запроси.`;
    }
    const nextAction = memory.getNextAction(user, customerMemory);
    if (nextAction) systemMessage += `\n\nРЕКОМЕНДАЦИЯ: ${nextAction}`;
  }

  // State hints
  const useScenarios = await aiSettings.isEnabled('toggle_scenarios').catch(() => true);
  if (useScenarios) {
    const hint = await aiSettings.getStateHint(user.state).catch(() => null);
    if (hint) systemMessage += `\n\nСЕЙЧАС: ${hint}`;
  }

  if (scenario) systemMessage += `\nСценарий реактивации: ${scenario}`;

  // Паттерны менеджера (обучение)
  const managerPatterns = await managerLearning.getPatternsForAI(user.state).catch(() => null);
  if (managerPatterns) systemMessage += '\n\n' + managerPatterns;

  if (productContext) {
    systemMessage += `\n\n--- КАТАЛОГ ТОВАРОВ С САЙТА (актуальные данные) ---\n${productContext}\n--- КОНЕЦ КАТАЛОГА ---\n\nСТРОГИЕ ПРАВИЛА:\n1. Предлагай ТОЛЬКО товары из каталога.\n2. Называй ТОЛЬКО цены из каталога.\n3. НИКОГДА не говори «нет в наличии».\n4. Если товара нет — покажи похожие.\n5. Всегда заканчивай вопросом.`;
  } else if (catalogAvailable === false) {
    systemMessage += `\n\nВНИМАНИЕ: Каталог обновляется. НЕ называй конкретные товары или цены. Задавай уточняющие вопросы.`;
  }

  // ═══════════════════════════════════════
  // A/B TESTING — выбираем вариант фразы
  // ═══════════════════════════════════════
  const abEnabled = await aiSettings.isEnabled('toggle_ab_testing').catch(() => false);
  let abVariantKey = null;
  if (abEnabled && user.id) {
    // Определяем тест по intent
    let abTestKey = null;
    if (intentResult.intent === 'doubt') abTestKey = 'pushdown';
    else if (intentResult.intent === 'greeting' && user.state === 'NEW') abTestKey = 'greeting';
    else if (intentResult.intent === 'ready_to_buy') abTestKey = 'upsell';

    if (abTestKey) {
      const variants = [`ab_${abTestKey}_a`, `ab_${abTestKey}_b`];
      const { variant } = await analytics.pickABVariant(user.id, abTestKey, variants);
      if (variant) {
        const abText = await aiSettings.get(variant).catch(() => null);
        if (abText) {
          systemMessage += `\n\nA/B ТЕСТ (${abTestKey}): Используй эту фразу как основу: "${abText}"`;
          abVariantKey = variant;
          analytics.trackABShown(user.id, abTestKey, variant).catch(() => {});
        }
      }
    }
  }

  const chatMessages = [
    { role: 'system', content: systemMessage },
    ...history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    })),
  ];

  const lastMsg = chatMessages[chatMessages.length - 1];
  if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== userMessage) {
    chatMessages.push({ role: 'user', content: userMessage });
  }

  // Генерация с retry + anti-repeat + self-check
  const MAX_ATTEMPTS = 3;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const temperature = attempt === 0 ? 0.3 : 0.5 + attempt * 0.1;
      const { text } = await aiClient.sendMessage({
        messages: chatMessages,
        temperature,
      });

      if (!text) continue; // retry instead of returning empty

      // Anti-repeat check
      const isRepeat = await _isRepeat(user.id, text);
      if (isRepeat && attempt < MAX_ATTEMPTS - 1) {
        // Добавляем инструкцию перегенерировать иначе
        chatMessages[0].content += '\n\nВАЖНО: Ответь ИНАЧЕ, чем в предыдущих сообщениях. Используй другие слова и структуру.';
        continue;
      }

      // Self-check
      const check = await _selfCheck(text, addressFormat || 'ты');
      if (!check.ok && attempt < MAX_ATTEMPTS - 1) {
        if (check.reason === 'template_phrase') {
          chatMessages[0].content += '\n\nВАЖНО: Не используй шаблонные фразы. Пиши как живой человек.';
        } else if (check.reason?.startsWith('wrong_address_format')) {
          chatMessages[0].content += `\n\nВАЖНО: Обращайся ТОЛЬКО на "${addressFormat}". Исправь формат обращения.`;
        }
        continue;
      }

      // Сохраняем ответ для anti-repeat
      _storeResponse(user.id, text);
      return text;

    } catch (err) {
      const status = err.response?.status;
      if (attempt < MAX_ATTEMPTS - 1 && (status === 429 || (status >= 500 && status < 600))) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      console.error('AI error:', err.response?.data || err.message);
      try { require('../monitoring').recordError('ai', err.message || 'AI request failed'); } catch(e) {}
      _broadcastAI('ai_typing', { userId: user.id, typing: false });
      // All attempts exhausted — return DB fallback, never empty
      try {
        const aiSettings = require('../db/ai_settings');
        const fallback = await aiSettings.pickFallback('general').catch(() => null);
        if (fallback) return fallback;
      } catch (e) { /* ignore */ }
      return 'Уточните, пожалуйста, детали заказа.';
    }
  }

  // All attempts returned empty text — use DB fallback
  try {
    const fallback = await aiSettings.pickFallback('general').catch(() => null);
    if (fallback) return fallback;
  } catch (e) { /* ignore */ }
  return 'Уточните, пожалуйста, детали заказа.';
}

// ═══════════════════════════════════════
// PREVIEW: тестовый запрос без отправки клиенту
// ═══════════════════════════════════════

async function previewResponse(testMessage, scenario, userState = 'NEW') {
  const fakeUser = { id: 0, state: userState, name: 'Тест', telegram_id: 0 };
  return generateResponse(fakeUser, testMessage, { scenario });
}

module.exports = { generateResponse, previewResponse };
