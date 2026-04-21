require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const axios = require('axios');
const { createCustomerStore } = require('./src/customer-store');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const REQUEST_TIMEOUT_MS = 15000;
const AI_REQUEST_TIMEOUT_MS = 60000;
const MAX_INPUT_TEXT_LENGTH = 4000;
const AI_CONCURRENCY_LIMIT = 25;
const GETFILE_CONCURRENCY_LIMIT = 10;
const SLOT_WAIT_TIMEOUT_MS = 5000;
const SLOT_WAIT_INTERVAL_MS = 25;
const HTTP_BODY_LIMIT = '2mb';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_TEXT_LIMIT = 1200;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_ARCHIVES = 5;
const STT_TIMEOUT_MS = 30000;
const MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
const TYPING_REFRESH_MS = 4500;
const READ_DELAY_MIN_MS = 1200;
const READ_DELAY_MAX_MS = 3500;
const LONG_REPLY_PART_LIMIT = 700;
const HUMAN_TYPING_MIN_CPS = 12;
const HUMAN_TYPING_MAX_CPS = 18;
const HUMAN_TYPING_MIN_DELAY_MS = 1600;
const HUMAN_TYPING_MAX_DELAY_MS = 10000;
const MEMORY_RECENT_LIMIT = 10;
const MEMORY_MESSAGES_TTL_DAYS = 7;
const MEMORY_FACTS_TTL_DAYS = 90;
const MEMORY_STATE_TTL_DAYS = 14;
const MEMORY_MAX_MESSAGES = 5000;
const MEMORY_HISTORY_CHAR_LIMIT = 3500;
const BATCH_DEBOUNCE_MS = 3000;
const BATCH_MAX_WINDOW_MS = 6500;
const MIN_MEMORY_RECENT_LIMIT = 3;
const MAX_MEMORY_RECENT_LIMIT = 20;
const MIN_BATCH_DEBOUNCE_MS = 0;
const MAX_BATCH_DEBOUNCE_MS = 10000;
const MANAGER_RETURN_DELAY_MS = 180000;
const MIN_MANAGER_RETURN_DELAY_MS = 30000;
const MAX_MANAGER_RETURN_DELAY_MS = 900000;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_COOKIE_NAME = 'auth';
const AUTH_COOKIE_VALUE = crypto
  .createHash('sha256')
  .update(`${ADMIN_LOGIN}:${ADMIN_PASSWORD}:sai-admin`)
  .digest('hex');
const LOG_BUFFER_LIMIT = 1000;
const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'business_connection',
  'business_message',
  'edited_business_message',
];
let activeAiRequests = 0;
let activeGetFileRequests = 0;
let lastSaiRuntimeError = null;
const chatBatches = new Map();
const managerReturnTimers = new Map();
const managerPendingInputs = new Map();
const runtimeLogs = [];
const logDir = path.join(__dirname, 'logs');
const LOG_FILE_PATH = path.join(logDir, 'runtime.jsonl');
const dataDir = path.join(__dirname, 'data');
const CONFIG_FILE_PATH = path.join(dataDir, 'runtime-config.json');
const MEMORY_FILE_PATH = path.join(dataDir, 'memory.json');
const CUSTOMER_DB_PATH = path.join(dataDir, 'sai.sqlite');
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
let logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });

const DEFAULT_BEHAVIOR_PROMPT = [
  'Additional behavior guidance:',
  '{tone_guidance}',
  '{response_length_guidance}',
  '{persona_style_guidance}',
  '{persona_age_guidance}',
].join('\n');

const DEFAULT_RETAIL_PROMPT = [
  'If the user sends a photo, screenshot, or link, treat it as likely interest in a product, not automatically as a request to describe media.',
  'Use seller-first behavior only when the message shows clear or probable product interest.',
  'When product interest is absent, respond naturally, briefly, and helpfully without forcing the conversation toward a sale.',
  'Respond as a seller when relevant, not as a generic assistant. Do not use phrases like “in the image,” “it looks like,” “the photo shows,” or “as an AI.”',
  'If possible, briefly identify the product or product type, then move toward purchase: ask about size, availability, preferred option, or buying intent.',
  'Take initiative when product interest is present. Guide the user toward a decision instead of waiting, but avoid sounding pushy on neutral inputs.',
  'Keep replies short, confident, and practical. Description is allowed only when it helps the sale, not as the main goal.',
  'Write chat-first, not form-first: avoid numbered lists, questionnaires, and multi-step confirmations unless the client explicitly asks for a detailed checklist.',
  'Ask one natural next question at a time. Do not request full checkout details (full name, phone, delivery address) until the client has clearly confirmed the model, size/quantity, or asks to place/pay for the order.',
  'If several details are missing, ask only the next blocking detail. Priority: product/model, then size/quantity, then contact/delivery details, then payment.',
  'Even if the client says they want to order, do not ask for full name, phone, and address in the same reply if size or quantity is still unclear. First ask the size/quantity naturally.',
  'Do not mention internal product IDs, CRM data, saved phone numbers, or saved addresses unless the client asks or the conversation is already at checkout.',
  'If customer memory contains saved contact or delivery details, use it quietly to reduce repeated questions. Confirm it only at checkout and only in natural wording.',
  'When these instructions conflict with a broader sales instruction, prefer the chat-first behavior and one-next-step rule.',
  'Always respond in Russian.',
  'Отвечай как продавец: уверенно, по делу и с фокусом на продажу.',
  'Всегда обращайся к пользователю на “Вы”. Используй вежливую, профессиональную форму общения и избегай обращения на “ты”, сохраняя живой и естественный тон.',
  'Фото, ссылки и скрины обычно означают интерес к товару, а не просьбу описать изображение.',
  'Если виден явный или вероятный товарный интерес, помогай выбрать и веди к покупке. Если товарный интерес не выражен, отвечай естественно и по смыслу.',
  'Не превращай ответ в анкету. В обычном чате лучше одно короткое действие: уточнить размер, наличие, цвет, количество или готовность оформить.',
].join(' ');

const DEFAULT_MEDIA_PROMPT = '{media_behavior_guidance}';

const DEFAULT_LAYOUT_PROMPT = [
  'Write like a real person in Telegram chat.',
  'Keep replies visually light and easy to read on a phone.',
  'Usually use 1–3 short lines.',
  'Do not pack too many thoughts into one message.',
  'Ask only one next question at a time.',
  'Avoid long dense paragraphs, numbered lists, and form-like formatting unless truly necessary.',
  'Prefer short natural chat rhythm over perfect structure.',
  'Sometimes one short sentence is enough.',
  'Пишите как живой человек в Telegram.',
  'Ответ должен легко читаться с телефона.',
  'Обычно это 1–3 короткие строки.',
  'Не объединяйте слишком много мыслей в одно сообщение.',
  'Задавайте один следующий вопрос за раз.',
  'Избегайте длинных плотных абзацев, нумерации и анкетной формы без необходимости.',
  'Лучше короткий естественный ритм чата, чем слишком правильная структура.',
  'Иногда достаточно одной короткой фразы.',
].join(' ');

const DEFAULT_MEMORY_PROMPT = [
  'Use this naturally when relevant.',
  'Do not mention internal memory directly.',
  'Do not mention saved phone or delivery address before checkout.',
  'Confirm saved phone or delivery address only when the client is clearly placing an order and product size/quantity are already clear.',
  'Prefer one natural next question instead of forms or numbered checklists.',
  'Do not invent missing facts.',
].join(' ');

const DEFAULT_PAYMENT_PROMPT = [
  'Payment policy:',
  'When the client asks how to pay or where to transfer, provide the configured payment details briefly and ask them to send a receipt or screenshot after payment.',
  '{payment_details}',
  'If the client sends a receipt, screenshot, or payment file, treat it as payment proof for preliminary checking only.',
  'Compare visible recipient, bank, card/account digits, amount, date/time, and successful transfer status when available.',
  'Never say that payment is finally confirmed based only on a screenshot. Say that the receipt was received and looks preliminary correct / needs manual check / does not match, and that final confirmation happens after checking the banking app.',
].join('\n');

const DEFAULT_CRM_EXTRACT_PROMPT = [
  'Extract customer CRM and order facts from a retail Telegram conversation.',
  'Return JSON only. Do not invent missing data. Use null/empty string for unknown fields.',
  'Fields: customer.fullName, customer.phone, customer.city, customer.deliveryAddress, customer.shoeSize.',
  'Fields: intent.stage, intent.interest, intent.buyingIntent.',
  'Fields: order.product, order.size, order.price, order.status, order.paymentStatus.',
  'Confidence values may be high, medium, low.',
].join(' ');

const DEFAULT_PAYMENT_CHECK_PROMPT = 'Return JSON only: {"status":"","summary":"","amount":"","recipient":"","cardLast4":"","date":"","manualCheckRequired":true}.';

if ((process.env.TRUST_PROXY || '').trim() === 'true') {
  app.set('trust proxy', 1);
}

const runtimeConfig = {
  telegram_token: process.env.TELEGRAM_TOKEN || '',
  ai_key: process.env.AI_API_KEY || '',
  ai_url: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.MODEL || 'gpt-4o-mini',
  stt_api_key: process.env.STT_API_KEY || process.env.AI_API_KEY || '',
  stt_base_url: process.env.STT_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  stt_model: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',
  instruction: process.env.INSTRUCTION || '',
  tone: process.env.TONE || 'neutral',
  response_length: process.env.RESPONSE_LENGTH || 'medium',
  creativity: process.env.CREATIVITY || 'balanced',
  persona_style: process.env.PERSONA_STYLE || 'calm',
  persona_age: process.env.PERSONA_AGE || '27',
  conversation_mode: process.env.CONVERSATION_MODE || 'general',
  media_behavior: process.env.MEDIA_BEHAVIOR || 'describe_media',
  auto_reply_enabled: process.env.AUTO_REPLY_ENABLED !== 'false',
  memory_enabled: process.env.MEMORY_ENABLED !== 'false',
  memory_recent_limit: Number(process.env.MEMORY_RECENT_LIMIT || MEMORY_RECENT_LIMIT),
  batch_debounce_ms: Number(process.env.BATCH_DEBOUNCE_MS || BATCH_DEBOUNCE_MS),
  reply_mode: process.env.REPLY_MODE || 'smart',
  human_typing_mode: process.env.HUMAN_TYPING_MODE || 'natural',
  manager_takeover_enabled: process.env.MANAGER_TAKEOVER_ENABLED !== 'false',
  manager_return_delay_ms: Number(process.env.MANAGER_RETURN_DELAY_MS || MANAGER_RETURN_DELAY_MS),
  ai_crm_extractor_enabled: process.env.AI_CRM_EXTRACTOR_ENABLED !== 'false',
  payment_enabled: process.env.PAYMENT_ENABLED === 'true',
  payment_method: process.env.PAYMENT_METHOD || 'card',
  payment_card_number: process.env.PAYMENT_CARD_NUMBER || '',
  payment_recipient_name: process.env.PAYMENT_RECIPIENT_NAME || '',
  payment_bank: process.env.PAYMENT_BANK || '',
  payment_comment: process.env.PAYMENT_COMMENT || '',
  prompt_behavior_enabled: process.env.PROMPT_BEHAVIOR_ENABLED !== 'false',
  prompt_behavior_text: process.env.PROMPT_BEHAVIOR_TEXT || DEFAULT_BEHAVIOR_PROMPT,
  prompt_retail_enabled: process.env.PROMPT_RETAIL_ENABLED !== 'false',
  prompt_retail_text: process.env.PROMPT_RETAIL_TEXT || DEFAULT_RETAIL_PROMPT,
  prompt_media_enabled: process.env.PROMPT_MEDIA_ENABLED !== 'false',
  prompt_media_text: process.env.PROMPT_MEDIA_TEXT || DEFAULT_MEDIA_PROMPT,
  prompt_layout_enabled: process.env.PROMPT_LAYOUT_ENABLED !== 'false',
  prompt_layout_text: process.env.PROMPT_LAYOUT_TEXT || DEFAULT_LAYOUT_PROMPT,
  prompt_memory_enabled: process.env.PROMPT_MEMORY_ENABLED !== 'false',
  prompt_memory_text: process.env.PROMPT_MEMORY_TEXT || DEFAULT_MEMORY_PROMPT,
  prompt_payment_enabled: process.env.PROMPT_PAYMENT_ENABLED !== 'false',
  prompt_payment_text: process.env.PROMPT_PAYMENT_TEXT || DEFAULT_PAYMENT_PROMPT,
  prompt_crm_extract_enabled: process.env.PROMPT_CRM_EXTRACT_ENABLED !== 'false',
  prompt_crm_extract_text: process.env.PROMPT_CRM_EXTRACT_TEXT || DEFAULT_CRM_EXTRACT_PROMPT,
  prompt_payment_check_enabled: process.env.PROMPT_PAYMENT_CHECK_ENABLED !== 'false',
  prompt_payment_check_text: process.env.PROMPT_PAYMENT_CHECK_TEXT || DEFAULT_PAYMENT_CHECK_PROMPT,
  webhook_url: process.env.WEBHOOK_URL || '',
};

loadPersistedConfig();

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 150,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 150,
});

const httpClient = axios.create({
  httpAgent,
  httpsAgent,
});

app.use(express.json({ limit: HTTP_BODY_LIMIT }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 's.ai',
    uptime: Math.round(process.uptime()),
    webhook_open: true,
  });
});

function logEvent(event, payload) {
  const normalizedPayload = { ...payload };
  if (typeof normalizedPayload.text === 'string') {
    normalizedPayload.text = truncateLogText(normalizedPayload.text);
  }
  if (typeof normalizedPayload.replyText === 'string') {
    normalizedPayload.replyText = truncateLogText(normalizedPayload.replyText);
  }
  if (typeof normalizedPayload.error === 'string') {
    normalizedPayload.error = truncateLogText(normalizedPayload.error);
  }
  if (typeof normalizedPayload.message === 'string' && event === 'ERROR') {
    normalizedPayload.message = truncateLogText(normalizedPayload.message);
  }

  const entry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    event,
    status: normalizedPayload.status || (event === 'ERROR' ? 'error' : 'ok'),
    ...normalizedPayload,
  };

  runtimeLogs.push(entry);
  if (runtimeLogs.length > LOG_BUFFER_LIMIT) {
    runtimeLogs.shift();
  }

  rotateLogsIfNeeded();
  logStream.write(`${JSON.stringify(entry)}\n`);

  if (LOG_LEVEL === 'error' && event !== 'ERROR') return;
  console.log(`[${event}]`, JSON.stringify(entry));
}

function truncateLogText(text) {
  return String(text || '').slice(0, LOG_TEXT_LIMIT);
}

function createTraceId() {
  return crypto.randomUUID();
}

function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function rotateLogsIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE_PATH) && fs.statSync(LOG_FILE_PATH).size < MAX_LOG_FILE_BYTES) {
      return;
    }

    logStream.end();
    const archiveName = `runtime-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.renameSync(LOG_FILE_PATH, path.join(logDir, archiveName));
    }

    const archives = fs.readdirSync(logDir)
      .filter((file) => /^runtime-\d{4}-\d{2}-\d{2}T/.test(file))
      .sort()
      .reverse();

    archives.slice(MAX_LOG_ARCHIVES).forEach((file) => {
      fs.rmSync(path.join(logDir, file), { force: true });
    });

    logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  } catch (error) {
    console.error('[LOG_ROTATION_ERROR]', error.message);
  }
}

function readPersistedLogs() {
  if (!fs.existsSync(LOG_FILE_PATH)) return [];
  const content = fs.readFileSync(LOG_FILE_PATH, 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map(parseLogLine)
    .filter(Boolean);
}

function getMergedLogs() {
  const merged = new Map();

  readPersistedLogs().forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });

  runtimeLogs.forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });

  return Array.from(merged.values()).sort((a, b) => new Date(b.time) - new Date(a.time));
}

function filterLogs(items, query = {}) {
  const limit = Math.max(1, Math.min(1000, Number(query.limit) || 100));
  const type = String(query.type || '').trim();
  const traceId = String(query.traceId || '').trim();
  const userId = String(query.userId || '').trim();

  return items
    .filter((item) => !type || item.event === type)
    .filter((item) => !traceId || item.traceId === traceId)
    .filter((item) => !userId || String(item.userId || '') === userId)
    .slice(0, limit);
}

function createEmptyMemoryStore() {
  return {
    version: 1,
    messages: [],
    facts: {},
    states: {},
    businessConnections: {},
  };
}

function readMemoryStore() {
  if (!fs.existsSync(MEMORY_FILE_PATH)) return createEmptyMemoryStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf8'));
    return {
      ...createEmptyMemoryStore(),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      facts: parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {},
      states: parsed.states && typeof parsed.states === 'object' ? parsed.states : {},
      businessConnections: parsed.businessConnections && typeof parsed.businessConnections === 'object' ? parsed.businessConnections : {},
    };
  } catch (error) {
    logEvent('ERROR', {
      scope: 'memory.read',
      status: 'error',
      error: error.message,
    });
    return createEmptyMemoryStore();
  }
}

let memoryStore = readMemoryStore();
let customerStore = null;

try {
  customerStore = createCustomerStore({ dbPath: CUSTOMER_DB_PATH });
  customerStore.importLegacyMemory(memoryStore);
} catch (error) {
  customerStore = null;
  console.error('[CUSTOMER_DB_ERROR]', error.message);
}

function saveMemoryStore() {
  const tempPath = `${MEMORY_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(memoryStore, null, 2));
  fs.renameSync(tempPath, MEMORY_FILE_PATH);
}

function getMemoryCutoff(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function cleanupMemoryStore() {
  const messagesCutoff = getMemoryCutoff(MEMORY_MESSAGES_TTL_DAYS);
  const factsCutoff = getMemoryCutoff(MEMORY_FACTS_TTL_DAYS);
  const stateCutoff = getMemoryCutoff(MEMORY_STATE_TTL_DAYS);

  memoryStore.messages = memoryStore.messages
    .filter((message) => new Date(message.createdAt).getTime() >= messagesCutoff)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MEMORY_MAX_MESSAGES);

  Object.entries(memoryStore.facts).forEach(([chatId, facts]) => {
    Object.entries(facts || {}).forEach(([key, fact]) => {
      if (new Date(fact.updatedAt || 0).getTime() < factsCutoff) {
        delete facts[key];
      }
    });
    if (!Object.keys(facts || {}).length) delete memoryStore.facts[chatId];
  });

  Object.entries(memoryStore.states).forEach(([chatId, state]) => {
    if (new Date(state.updatedAt || 0).getTime() < stateCutoff) {
      delete memoryStore.states[chatId];
    }
  });
}

function persistMemoryStore() {
  try {
    cleanupMemoryStore();
    saveMemoryStore();
  } catch (error) {
    logEvent('ERROR', {
      scope: 'memory.write',
      status: 'error',
      error: error.message,
    });
  }
}

function normalizeMemoryText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function getMemoryChatId(inputOrChatId) {
  const raw = typeof inputOrChatId === 'object'
    ? inputOrChatId.chatId || inputOrChatId.userId
    : inputOrChatId;
  return String(raw || '').trim();
}

function getMemoryMessageText(input) {
  const text = normalizeMemoryText(input.text);
  if (text) return text;
  if (input.messageType === 'photo') return '[photo] Клиент прислал фото товара.';
  if (input.messageType === 'video_note') return '[video_note] Клиент прислал video note.';
  if (input.messageType === 'voice') return '[voice] Клиент прислал голосовое сообщение.';
  if (input.hasMedia) return `[${input.messageType || 'media'}] Клиент прислал медиа.`;
  return '';
}

function safeCustomerStoreCall(scope, action, fallback = null) {
  if (!customerStore) return fallback;
  try {
    return action(customerStore);
  } catch (error) {
    logEvent('ERROR', {
      scope,
      status: 'error',
      error: error.message,
    });
    return fallback;
  }
}

function appendMemoryMessage(input, role, text) {
  const chatId = getMemoryChatId(input);
  const cleanText = normalizeMemoryText(text);
  if (!chatId || !cleanText) return;

  safeCustomerStoreCall('customer.message.append', (store) => store.appendMessage(input, role, cleanText));

  const telegramMessageId = role !== 'assistant' ? String(input.messageId || '') : '';
  const duplicate = memoryStore.messages.some((message) => (
    message.chatId === chatId
    && message.role === role
    && telegramMessageId
    && message.telegramMessageId === telegramMessageId
  ));
  if (duplicate) return;

  memoryStore.messages.push({
    id: crypto.randomUUID(),
    chatId,
    userId: String(input.userId || chatId),
    role,
    type: input.messageType || 'text',
    text: cleanText,
    telegramMessageId,
    traceId: input.traceId || '',
    createdAt: new Date().toISOString(),
  });
  persistMemoryStore();
}

function upsertMemoryFact(chatId, key, value, source) {
  const cleanChatId = getMemoryChatId(chatId);
  const cleanValue = normalizeMemoryText(value);
  if (!cleanChatId || !key || !cleanValue) return;

  safeCustomerStoreCall('customer.fact.upsert', (store) => store.upsertFact(cleanChatId, key, cleanValue, source));

  if (!memoryStore.facts[cleanChatId]) memoryStore.facts[cleanChatId] = {};
  memoryStore.facts[cleanChatId][key] = {
    value: cleanValue,
    confidence: 'explicit',
    source: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
}

function setConversationStage(chatId, stage, source) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId || !stage) return;
  safeCustomerStoreCall('customer.state.stage', (store) => store.setDialogState(cleanChatId, { stage, source }));
  memoryStore.states[cleanChatId] = {
    ...(memoryStore.states[cleanChatId] || {}),
    stage,
    source: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
}

function upsertBusinessConnection(connection = {}) {
  const id = String(connection.id || '').trim();
  if (!id) return null;

  const normalized = {
    id,
    userId: String(connection.user?.id || connection.userId || '').trim(),
    userChatId: String(connection.user_chat_id || connection.userChatId || '').trim(),
    isEnabled: connection.is_enabled !== false,
    rights: connection.rights || null,
    updatedAt: new Date().toISOString(),
  };

  memoryStore.businessConnections[id] = {
    ...(memoryStore.businessConnections[id] || {}),
    ...normalized,
  };
  safeCustomerStoreCall('customer.business_connection.upsert', (store) => store.upsertBusinessConnection(normalized));
  persistMemoryStore();
  return memoryStore.businessConnections[id];
}

function getBusinessConnectionById(id) {
  const cleanId = String(id || '').trim();
  const dbConnection = safeCustomerStoreCall('customer.business_connection.get', (store) => store.getBusinessConnection(cleanId));
  if (dbConnection) return dbConnection;
  return cleanId ? memoryStore.businessConnections[cleanId] || null : null;
}

function setDialogAiMode(chatId, mode, source = '') {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId || !mode) return null;
  const previous = memoryStore.states[cleanChatId] || {};
  const next = {
    ...previous,
    aiMode: mode,
    modeSource: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
  if (mode === 'active') {
    delete next.autoTakeoverAt;
    delete next.pendingSince;
  }
  memoryStore.states[cleanChatId] = next;
  safeCustomerStoreCall('customer.state.mode', (store) => store.setDialogState(cleanChatId, next));
  persistMemoryStore();
  return next;
}

function setManagerActive(chatId, input, source = '') {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return null;
  cancelManagerReturnTimer(cleanChatId);
  const now = new Date().toISOString();
  memoryStore.states[cleanChatId] = {
    ...(memoryStore.states[cleanChatId] || {}),
    aiMode: 'passive_manager',
    managerActiveAt: now,
    managerLastMessageAt: now,
    autoTakeoverAt: '',
    pendingSince: '',
    modeSource: normalizeMemoryText(source).slice(0, 240),
    lastManagerTraceId: input?.traceId || '',
    updatedAt: now,
  };
  safeCustomerStoreCall('customer.state.manager_active', (store) => store.setDialogState(cleanChatId, memoryStore.states[cleanChatId]));
  persistMemoryStore();
  return memoryStore.states[cleanChatId];
}

function getDialogState(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  const dbState = safeCustomerStoreCall('customer.state.get', (store) => store.getDialogState(cleanChatId));
  if (dbState) return dbState;
  return cleanChatId ? memoryStore.states[cleanChatId] || null : null;
}

function extractPhone(text) {
  const match = String(text || '').match(/(?:\+?\d[\s().-]*){10,16}/);
  return match ? match[0].replace(/[^\d+]/g, '') : '';
}

function extractShoeSize(text) {
  const source = String(text || '');
  const patterns = [
    /(?:у\s+меня|мой\s+размер|мои?\s+размер|ношу|размер\s+у\s+меня)\s*(?:размер\s*)?(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?/i,
    /(\d{2}(?:[.,]5)?)\s*(?:размер|р-р)\s*(?:у\s+меня|мой|мои|ношу)?/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1].replace(',', '.');
  }
  return '';
}

function extractCity(text) {
  const match = String(text || '').match(/\b(?:город|г\.|из)\s+([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z -]{2,40})/);
  return match ? match[1].trim() : '';
}

function extractFullName(text) {
  const source = String(text || '').trim();
  const explicit = source.match(/(?:фио|имя)\s*[:\-]?\s*([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2})/i);
  if (explicit) return explicit[1].trim();
  if (!/(телефон|адрес|достав|оформ|получател|\+?\d[\s().-]*\d)/i.test(source)) return '';
  const lines = source.split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /^[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2}$/.test(line));
  return candidate || '';
}

function extractDeliveryAddress(text) {
  const source = String(text || '').trim();
  const explicit = source.match(/(?:адрес|доставка|доставить|отправить)\s*[:\-]?\s*([^\n]{8,220})/i);
  if (explicit) return explicit[1].trim();
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /(ул\.?|улица|проспект|пр-т|дом|д\.|кв\.?|квартира|корпус|подъезд|москва|санкт|спб|область|район)/i.test(line) && line.length >= 8);
  return candidate || '';
}

function extractLastProduct(text) {
  const source = normalizeMemoryText(text);
  const explicit = source.match(/(?:модель|товар|кроссовки|пара)\s*[:\-]?\s*([^.,\n]{3,120})/i);
  if (explicit) return explicit[1].trim();
  return '';
}

function isPaymentIntentText(text) {
  return /(куда\s+платить|как\s+оплат|реквизит|карта|номер\s+карты|перевести|оплатить)/i.test(String(text || ''));
}

function isPaymentProofInput(input) {
  const text = String(input.text || '').toLowerCase();
  if (/(оплатил|оплатила|чек|квитанц|перев[её]л|скинул оплат|скрин.*оплат|receipt|payment)/i.test(text)) return true;
  if (!input.hasMedia) return false;
  const state = getDialogState(input.chatId);
  return ['waiting_payment', 'ready_to_buy', 'collecting_order_info'].includes(state?.stage);
}

function inferConversationStage(input) {
  const text = String(input.text || '').toLowerCase();
  if (/(оплатил|оплатила|чек|квитанц|перев[её]л|скинул оплат)/i.test(text)) return 'waiting_payment';
  if (/(беру|оформляем|оформить|куда платить|реквизит|оплатить|заказываю)/i.test(text)) return 'ready_to_buy';
  if (/(фио|адрес|телефон|\+?\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d)/i.test(text)) return 'collecting_order_info';
  if (/(размер|сколько стоит|цена|налич|есть\s+\d{2}|какие есть|доставка)/i.test(text)) return 'choosing';
  if (input.hasMedia || input.hasLinkInput || ['photo', 'document', 'video', 'video_note'].includes(input.messageType)) return 'interested';
  return '';
}

function updateCustomerMemoryFromInput(input) {
  const chatId = getMemoryChatId(input);
  const source = input.text || getMemoryMessageText(input);
  if (!chatId) return;

  const phone = extractPhone(input.text);
  if (phone) upsertMemoryFact(chatId, 'phone', phone, source);

  const shoeSize = extractShoeSize(input.text);
  if (shoeSize) upsertMemoryFact(chatId, 'shoeSize', shoeSize, source);

  const city = extractCity(input.text);
  if (city) upsertMemoryFact(chatId, 'city', city, source);

  const fullName = extractFullName(input.text);
  if (fullName) upsertMemoryFact(chatId, 'fullName', fullName, source);

  const deliveryAddress = extractDeliveryAddress(input.text);
  if (deliveryAddress) upsertMemoryFact(chatId, 'deliveryAddress', deliveryAddress, source);

  const lastProduct = extractLastProduct(input.text);
  if (lastProduct) upsertMemoryFact(chatId, 'lastProduct', lastProduct, source);

  if (input.hasMedia || input.hasLinkInput) {
    upsertMemoryFact(chatId, 'interest', getMemoryMessageText(input), source);
    upsertMemoryFact(chatId, 'lastProduct', getMemoryMessageText(input), source);
  }

  const stage = inferConversationStage(input);
  if (stage) setConversationStage(chatId, stage, source);

  if (isPaymentIntentText(input.text)) {
    safeCustomerStoreCall('customer.order.payment_requested', (store) => store.upsertOrder(chatId, {
      product: lastProduct || (memoryStore.facts[chatId]?.lastProduct?.value || memoryStore.facts[chatId]?.interest?.value || ''),
      size: shoeSize || memoryStore.facts[chatId]?.shoeSize?.value || '',
      fullName: fullName || memoryStore.facts[chatId]?.fullName?.value || '',
      phone: phone || memoryStore.facts[chatId]?.phone?.value || '',
      deliveryAddress: deliveryAddress || memoryStore.facts[chatId]?.deliveryAddress?.value || '',
      status: 'waiting_payment',
      paymentStatus: 'payment_details_sent',
    }));
  }

  if (stage === 'ready_to_buy' || stage === 'collecting_order_info') {
    safeCustomerStoreCall('customer.order.draft', (store) => store.upsertOrder(chatId, {
      product: lastProduct || (memoryStore.facts[chatId]?.lastProduct?.value || memoryStore.facts[chatId]?.interest?.value || ''),
      size: shoeSize || memoryStore.facts[chatId]?.shoeSize?.value || '',
      fullName: fullName || memoryStore.facts[chatId]?.fullName?.value || '',
      phone: phone || memoryStore.facts[chatId]?.phone?.value || '',
      deliveryAddress: deliveryAddress || memoryStore.facts[chatId]?.deliveryAddress?.value || '',
      status: stage === 'ready_to_buy' ? 'draft' : 'collecting_info',
    }));
  }

  persistMemoryStore();
}

function getRecentMemoryMessages(chatId, limit = MEMORY_RECENT_LIMIT, excludeTraceIds = []) {
  const cleanChatId = getMemoryChatId(chatId);
  const excluded = new Set((excludeTraceIds || []).filter(Boolean));
  if (!cleanChatId) return [];
  const dbMessages = safeCustomerStoreCall('customer.messages.recent', (store) => store.getRecentMessages(cleanChatId, limit, excludeTraceIds));
  if (Array.isArray(dbMessages) && dbMessages.length) return dbMessages;
  return memoryStore.messages
    .filter((message) => message.chatId === cleanChatId)
    .filter((message) => !excluded.has(message.traceId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}

function formatMemoryFacts(facts = {}) {
  const labels = {
    name: 'Name',
    fullName: 'Full name',
    phone: 'Phone',
    city: 'City',
    address: 'Delivery address',
    deliveryAddress: 'Delivery address',
    shoeSize: 'Shoe size',
    interest: 'Interest',
    lastProduct: 'Last product',
  };
  return Object.entries(labels)
    .filter(([key]) => facts[key]?.value)
    .map(([key, label]) => `${label}: ${facts[key].value}`);
}

function renderPromptTemplate(template, variables = {}) {
  return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key] ?? '') : match
  )).trim();
}

function buildMemoryContext(chatId, options = {}) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return { summary: '', history: [], facts: {}, state: null };

  const dbContext = safeCustomerStoreCall('customer.context.get', (store) => store.getCustomerContext(cleanChatId, {
    limit: options.limit || MEMORY_RECENT_LIMIT,
    excludeTraceIds: options.excludeTraceIds || [],
    memoryPromptEnabled: parseConfigBoolean(runtimeConfig.prompt_memory_enabled, true),
    memoryPromptText: runtimeConfig.prompt_memory_text || DEFAULT_MEMORY_PROMPT,
  }));
  if (dbContext) return dbContext;

  const facts = memoryStore.facts[cleanChatId] || {};
  const state = memoryStore.states[cleanChatId] || null;
  const factLines = formatMemoryFacts(facts);
  if (state?.stage) factLines.push(`Stage: ${state.stage}`);

  const summary = factLines.length
    ? [
      'Client memory:',
      ...factLines.map((line) => `- ${line}`),
      parseConfigBoolean(runtimeConfig.prompt_memory_enabled, true)
        ? renderPromptTemplate(runtimeConfig.prompt_memory_text || DEFAULT_MEMORY_PROMPT)
        : '',
    ].filter(Boolean).join('\n')
    : '';

  let usedChars = 0;
  const history = [];
  getRecentMemoryMessages(cleanChatId, options.limit || MEMORY_RECENT_LIMIT, options.excludeTraceIds || []).reverse().forEach((message) => {
    const text = normalizeMemoryText(message.text);
    if (!text || usedChars + text.length > MEMORY_HISTORY_CHAR_LIMIT) return;
    usedChars += text.length;
    const content = message.role === 'manager'
      ? `Manager: ${text}`
      : text;
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      createdAt: message.createdAt,
      type: message.type,
    });
  });

  return {
    summary,
    history: history.reverse(),
    facts,
    state,
  };
}

function buildBatchText(inputs) {
  const items = inputs
    .map((input) => getMemoryMessageText(input))
    .filter(Boolean);

  if (!items.length) return '';
  if (items.length === 1) return items[0];

  return [
    'Клиент отправил несколько сообщений подряд:',
    ...items.map((text, index) => `${index + 1}. ${text}`),
  ].join('\n');
}

function pickReplyTargetMessageId(inputs, config = runtimeConfig) {
  const mode = normalizeReplyMode(config.reply_mode);
  if (mode === 'off') return '';

  const mediaInput = inputs.find((input) => (
    input.messageId
    && (input.hasMedia || ['photo', 'document', 'video', 'video_note', 'voice'].includes(input.messageType))
  ));
  if ((mode === 'smart' || mode === 'media') && mediaInput) return mediaInput.messageId;
  if (mode === 'media') return '';

  const lastWithMessageId = [...inputs].reverse().find((input) => input.messageId);
  return lastWithMessageId ? lastWithMessageId.messageId : '';
}

function buildBatchInput(inputs) {
  const lastInput = inputs[inputs.length - 1];
  const images = [];
  inputs.forEach((input) => {
    (input.images || []).forEach((image) => images.push(image));
  });

  const messageTypes = Array.from(new Set(inputs.map((input) => input.messageType).filter(Boolean)));
  const hasMedia = inputs.some((input) => input.hasMedia);
  const hasLinkInput = inputs.some((input) => input.hasLinkInput);

  return {
    ...lastInput,
    traceId: lastInput.traceId,
    messageType: messageTypes.length > 1 ? 'batch' : lastInput.messageType,
    batchSize: inputs.length,
    batchTraceIds: inputs.map((input) => input.traceId),
    batchMessageIds: inputs.map((input) => input.messageId).filter(Boolean),
    replyToMessageId: pickReplyTargetMessageId(inputs, lastInput.config),
    text: buildBatchText(inputs),
    images,
    hasMedia,
    hasLinkInput,
  };
}

function shouldRunAiCrmExtractor(input) {
  if (!parseConfigBoolean(input.config.ai_crm_extractor_enabled, true)) return false;
  if (!hasRequiredConfig(input.config, ['ai_key', 'ai_url', 'model'])) return false;
  const text = String(input.text || '');
  return (
    input.hasMedia
    || input.hasLinkInput
    || isPaymentIntentText(text)
    || isPaymentProofInput(input)
    || /(беру|оформ|заказ|фио|адрес|телефон|доставка|размер|оплат|чек|реквизит|куда платить|\+?\d[\s().-]*\d[\s().-]*\d)/i.test(text)
  );
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function requestAiJson(config, messages, meta = {}) {
  if (logMissingConfig(meta.scope || 'ai.json', config, ['ai_key', 'ai_url', 'model'], meta)) return null;
  try {
    const response = await httpClient.post(
      `${config.ai_url.replace(/\/$/, '')}/chat/completions`,
      {
        model: config.model,
        messages,
        temperature: 0.1,
      },
      {
        headers: {
          Authorization: `Bearer ${config.ai_key}`,
          'Content-Type': 'application/json',
        },
        timeout: AI_REQUEST_TIMEOUT_MS,
      },
    );
    return parseJsonObject(extractAiReply(response.data?.choices?.[0]?.message?.content));
  } catch (e) {
    logEvent('ERROR', {
      scope: meta.scope || 'ai.json',
      traceId: meta.traceId || '',
      userId: meta.userId || '',
      chatId: meta.chatId || '',
      status: 'error',
      error: e.message,
    });
    return null;
  }
}

function applyExtractedCustomerData(input, extracted) {
  if (!extracted || typeof extracted !== 'object') return;
  const chatId = getMemoryChatId(input);
  const customer = extracted.customer && typeof extracted.customer === 'object' ? extracted.customer : {};
  const order = extracted.order && typeof extracted.order === 'object' ? extracted.order : {};
  const intent = extracted.intent && typeof extracted.intent === 'object' ? extracted.intent : {};
  const confidence = extracted.confidence && typeof extracted.confidence === 'object' ? extracted.confidence : {};
  const source = input.text || getMemoryMessageText(input);

  [
    ['fullName', customer.fullName],
    ['phone', customer.phone],
    ['city', customer.city],
    ['deliveryAddress', customer.deliveryAddress],
    ['shoeSize', customer.shoeSize],
    ['interest', intent.interest],
    ['lastProduct', order.product || intent.interest],
  ].forEach(([key, value]) => {
    if (!value) return;
    upsertMemoryFact(chatId, key, value, source);
    safeCustomerStoreCall('customer.fact.ai_extractor', (store) => store.upsertFact(chatId, key, value, source, confidence[key] || 'auto'));
  });

  const stage = extracted.stage || intent.stage || order.status;
  if (stage) setConversationStage(chatId, stage, source);

  if (order.product || order.size || order.status || customer.phone || customer.deliveryAddress || customer.fullName) {
    safeCustomerStoreCall('customer.order.ai_extractor', (store) => store.upsertOrder(chatId, {
      product: order.product || intent.interest || '',
      size: order.size || customer.shoeSize || '',
      price: order.price || '',
      fullName: customer.fullName || '',
      phone: customer.phone || '',
      deliveryAddress: customer.deliveryAddress || '',
      status: order.status || stage || 'draft',
      paymentStatus: order.paymentStatus || '',
    }));
  }

  logEvent('CRM_EXTRACT', {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    fields: Object.keys(customer).concat(Object.keys(order).map((key) => `order.${key}`)),
    stage: stage || '',
    status: 'ok',
  });
}

async function runAiCrmExtractor(input) {
  if (!shouldRunAiCrmExtractor(input)) return;
  if (!parseConfigBoolean(input.config.prompt_crm_extract_enabled, true)) return;
  const json = await requestAiJson(input.config, [
    {
      role: 'system',
      content: renderPromptTemplate(input.config.prompt_crm_extract_text || DEFAULT_CRM_EXTRACT_PROMPT),
    },
    {
      role: 'user',
      content: [
        `Current message type: ${input.messageType}`,
        `Current message: ${input.text}`,
        input.memoryContext?.summary ? `Known profile:\n${input.memoryContext.summary}` : '',
      ].filter(Boolean).join('\n\n'),
    },
  ], {
    scope: 'ai.crm_extract',
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
  });
  applyExtractedCustomerData(input, json);
}

function getCardLast4(cardNumber) {
  const digits = String(cardNumber || '').replace(/\D/g, '');
  return digits.slice(-4);
}

async function runPaymentProofPrecheck(input) {
  if (!parseConfigBoolean(input.config.payment_enabled, false)) return;
  if (!parseConfigBoolean(input.config.prompt_payment_check_enabled, true)) return;
  if (!isPaymentProofInput(input)) return;
  if (!input.images.length) return;

  const content = [
    {
      type: 'text',
      text: [
        'You are doing a preliminary payment receipt check for a retail order.',
        'Return JSON only with status: likely_paid, needs_manual_check, mismatch, or unreadable.',
        'Never mark payment as finally confirmed. Only analyze visible receipt/screenshot data.',
        `Expected recipient: ${input.config.payment_recipient_name || ''}`,
        `Expected bank: ${input.config.payment_bank || ''}`,
        `Expected card last4: ${getCardLast4(input.config.payment_card_number) || ''}`,
        `Message: ${input.text}`,
        'Check visible successful transfer status, recipient, bank/card digits, amount, date/time. If something is unclear, use needs_manual_check or unreadable.',
      ].join('\n'),
    },
    ...input.images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];

  const json = await requestAiJson(input.config, [
    {
      role: 'system',
      content: renderPromptTemplate(input.config.prompt_payment_check_text || DEFAULT_PAYMENT_CHECK_PROMPT),
    },
    {
      role: 'user',
      content,
    },
  ], {
    scope: 'ai.payment_precheck',
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
  });

  if (!json || typeof json !== 'object') return;
  const status = ['likely_paid', 'needs_manual_check', 'mismatch', 'unreadable'].includes(json.status)
    ? json.status
    : 'needs_manual_check';
  safeCustomerStoreCall('customer.order.payment_precheck', (store) => store.upsertOrder(input.chatId, {
    status: 'waiting_payment_check',
    paymentStatus: 'proof_received',
    paymentCheckStatus: status,
    paymentCheckSummary: json.summary || '',
    proofReceivedAt: new Date().toISOString(),
  }));
  setConversationStage(input.chatId, 'waiting_payment', input.text || 'payment proof received');
  logEvent('PAYMENT_CHECK', {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    paymentCheckStatus: status,
    paymentCheckSummary: json.summary || '',
    status: 'ok',
  });
}

async function processInputBatch(inputs) {
  if (!inputs.length) return;

  const batchInput = buildBatchInput(inputs);
  batchInput.batchStartedAt = new Date().toISOString();
  try {
    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
    }) : { summary: '', history: [], facts: {}, state: null };

    await runAiCrmExtractor(batchInput);
    await runPaymentProofPrecheck(batchInput);

    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
    }) : { summary: '', history: [], facts: {}, state: null };

    inputs.forEach((input) => logMessageDelivered(input));
    await waitAndMarkBatchRead(batchInput.config, inputs);

    logEvent('BATCH', {
      traceId: batchInput.traceId,
      userId: batchInput.userId,
      chatId: batchInput.chatId,
      updateType: batchInput.updateType || '',
      businessConnectionId: batchInput.businessConnectionId || '',
      messageType: batchInput.messageType,
      batchSize: batchInput.batchSize,
      batchTraceIds: batchInput.batchTraceIds,
      batchMessageIds: batchInput.batchMessageIds,
      replyToMessageId: batchInput.replyToMessageId || '',
      status: 'ok',
    });

    const stopTyping = startTypingLoop(batchInput.config, batchInput);
    try {
      const reply = await requestAi(batchInput);
      if (typeof reply === 'string') {
        const dialogState = getDialogState(batchInput.chatId);
        const managerLastMessageAt = dialogState?.managerLastMessageAt
          ? new Date(dialogState.managerLastMessageAt).getTime()
          : 0;
        const batchStartedAt = new Date(batchInput.batchStartedAt).getTime();
        if (
          parseConfigBoolean(batchInput.config.manager_takeover_enabled, true)
          && dialogState?.aiMode === 'passive_manager'
          && managerLastMessageAt >= batchStartedAt
        ) {
          logEvent('MESSAGE_STATUS', {
            traceId: batchInput.traceId,
            userId: batchInput.userId,
            chatId: batchInput.chatId,
            updateType: batchInput.updateType || '',
            businessConnectionId: batchInput.businessConnectionId || '',
            messageType: batchInput.messageType,
            messageStatus: 'ai_reply_skipped_manager_takeover',
            status: 'ok',
          });
          return;
        }
        if (parseConfigBoolean(batchInput.config.memory_enabled, true)) {
          appendMemoryMessage(batchInput, 'assistant', reply);
        }
        await sendHumanizedTelegramReply(batchInput.config, batchInput, reply);
        setDialogAiMode(batchInput.chatId, 'active', 'ai_reply');
      }
    } finally {
      stopTyping();
    }
  } catch (e) {
    logEvent('ERROR', {
      traceId: batchInput.traceId,
      userId: batchInput.userId,
      scope: 'batch.process',
      chatId: batchInput.chatId,
      updateType: batchInput.updateType || '',
      businessConnectionId: batchInput.businessConnectionId || '',
      status: 'error',
      error: e.message,
    });
  }
}

function flushChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch || batch.processing) return;

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);

  processInputBatch(batch.inputs);
}

function cancelChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch) return false;
  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);
  return true;
}

function cancelManagerReturnTimer(chatId) {
  const key = getMemoryChatId(chatId);
  const timer = managerReturnTimers.get(key);
  if (timer) clearTimeout(timer);
  managerReturnTimers.delete(key);
  managerPendingInputs.delete(key);
}

function scheduleManagerReturn(input) {
  const key = getMemoryChatId(input);
  if (!key) return;

  const existing = managerPendingInputs.get(key) || [];
  existing.push(input);
  managerPendingInputs.set(key, existing);

  const delayMs = getConfigManagerReturnDelayMs(input.config);
  const now = new Date();
  memoryStore.states[key] = {
    ...(memoryStore.states[key] || {}),
    aiMode: 'passive_manager',
    pendingSince: now.toISOString(),
    autoTakeoverAt: new Date(now.getTime() + delayMs).toISOString(),
    lastClientTraceId: input.traceId || '',
    updatedAt: now.toISOString(),
  };
  safeCustomerStoreCall('customer.state.manager_wait', (store) => store.setDialogState(key, memoryStore.states[key]));
  persistMemoryStore();

  const previousTimer = managerReturnTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);

  managerReturnTimers.set(key, setTimeout(() => {
    const pending = managerPendingInputs.get(key) || [];
    managerPendingInputs.delete(key);
    managerReturnTimers.delete(key);
    if (!pending.length) return;

    const state = getDialogState(key);
    if (state?.aiMode !== 'passive_manager') return;

    setDialogAiMode(key, 'active', 'manager_return_timeout');
    logEvent('MESSAGE_STATUS', {
      traceId: pending[pending.length - 1]?.traceId || createTraceId(),
      userId: pending[pending.length - 1]?.userId || key,
      chatId: key,
      messageStatus: 'ai_auto_takeover',
      batchSize: pending.length,
      status: 'ok',
    });
    processInputBatch(pending);
  }, delayMs));

  logEvent('MESSAGE_STATUS', {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageId: input.messageId || '',
    messageType: input.messageType,
    messageStatus: 'manager_passive_wait',
    autoTakeoverMs: delayMs,
    status: 'ok',
  });
}

function enqueueInputForBatch(input) {
  const key = getMemoryChatId(input);
  if (!key) {
    processInputBatch([input]);
    return;
  }

  let batch = chatBatches.get(key);
  if (!batch) {
    batch = {
      inputs: [],
      startedAt: Date.now(),
      debounceTimer: null,
      maxTimer: null,
      processing: false,
    };
    batch.maxTimer = setTimeout(() => flushChatBatch(key), Math.max(BATCH_MAX_WINDOW_MS, getConfigBatchDebounceMs(input.config) + 1000));
    chatBatches.set(key, batch);
  }

  batch.inputs.push(input);

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  batch.debounceTimer = setTimeout(() => flushChatBatch(key), getConfigBatchDebounceMs(input.config));
}

function clearMemoryForChat(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return false;
  safeCustomerStoreCall('customer.clear', (store) => store.clearCustomer(cleanChatId));
  memoryStore.messages = memoryStore.messages.filter((message) => message.chatId !== cleanChatId);
  delete memoryStore.facts[cleanChatId];
  delete memoryStore.states[cleanChatId];
  persistMemoryStore();
  return true;
}

cleanupMemoryStore();
persistMemoryStore();
setInterval(() => persistMemoryStore(), 24 * 60 * 60 * 1000).unref();

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function isAuthorized(req) {
  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) return false;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] === AUTH_COOKIE_VALUE;
}

function setAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `${AUTH_COOKIE_NAME}=; Path=/login; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
  ]);
}

function requireAuth(req, res, next) {
  if (req.path === '/api/telegram/webhook') {
    next();
    return;
  }

  if (isAuthorized(req)) {
    next();
    return;
  }

  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    res.redirect('/login');
    return;
  }

  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function markSaiRuntimeError(scope, message) {
  lastSaiRuntimeError = {
    scope,
    message,
    at: Date.now(),
  };
}

function getSaiStatus() {
  const requiredFields = ['telegram_token', 'ai_key', 'ai_url', 'model'];
  const missing = requiredFields.filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (lastSaiRuntimeError) {
    return {
      status: 'error',
      missing,
    };
  }

  if (missing.length) {
    return {
      status: 'warning',
      missing,
    };
  }

  return {
    status: 'ok',
    missing: [],
  };
}

function buildTelegramHealth({ tokenValid, webhookInfo }) {
  if (!runtimeConfig.telegram_token) {
    return {
      status: 'warning',
      label: 'Токен не задан',
    };
  }

  if (!tokenValid) {
    return {
      status: 'error',
      label: 'Ошибка Telegram',
    };
  }

  if (!runtimeConfig.webhook_url) {
    return {
      status: 'warning',
      label: 'Webhook не задан',
    };
  }

  if (!webhookInfo || webhookInfo.last_error_message) {
    return {
      status: 'error',
      label: 'Webhook с ошибкой',
    };
  }

  if (webhookInfo.url !== runtimeConfig.webhook_url) {
    return {
      status: 'warning',
      label: 'Webhook не совпадает',
    };
  }

  if (Number(webhookInfo.pending_update_count || 0) > 0) {
    return {
      status: 'warning',
      label: 'Есть pending updates',
    };
  }

  return {
    status: 'ok',
    label: 'Webhook активен',
  };
}

function buildAiHealth({ providerReachable }) {
  const missing = ['ai_key', 'ai_url', 'model']
    .filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (missing.length) {
    return {
      status: 'warning',
      label: 'AI не настроен',
    };
  }

  if (!providerReachable) {
    return {
      status: 'error',
      label: 'Провайдер недоступен',
    };
  }

  return {
    status: 'ok',
    label: 'Провайдер доступен',
  };
}

function buildSttHealth({ providerReachable }) {
  const missing = ['stt_api_key', 'stt_base_url', 'stt_model']
    .filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (missing.length) {
    return {
      status: 'warning',
      label: 'STT не настроен',
    };
  }

  if (!providerReachable) {
    return {
      status: 'error',
      label: 'STT недоступен',
    };
  }

  return {
    status: 'ok',
    label: 'STT доступен',
  };
}

function getSaiStatusLabel(saiStatus) {
  if (saiStatus.status === 'error') {
    return 'Runtime error';
  }

  if (saiStatus.status === 'warning') {
    return saiStatus.missing?.length ? 'Конфиг неполный' : 'Нужно внимание';
  }

  return 'Система готова';
}

function getRuntimeSnapshot() {
  return {
    telegram_token: runtimeConfig.telegram_token,
    ai_key: runtimeConfig.ai_key,
    ai_url: runtimeConfig.ai_url,
    model: runtimeConfig.model,
    stt_api_key: runtimeConfig.stt_api_key,
    stt_base_url: runtimeConfig.stt_base_url,
    stt_model: runtimeConfig.stt_model,
    instruction: runtimeConfig.instruction,
    tone: runtimeConfig.tone,
    response_length: runtimeConfig.response_length,
    creativity: runtimeConfig.creativity,
    persona_style: runtimeConfig.persona_style,
    persona_age: runtimeConfig.persona_age,
    conversation_mode: runtimeConfig.conversation_mode,
    media_behavior: runtimeConfig.media_behavior,
    auto_reply_enabled: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
    memory_enabled: parseConfigBoolean(runtimeConfig.memory_enabled, true),
    memory_recent_limit: getConfigMemoryLimit(runtimeConfig),
    batch_debounce_ms: getConfigBatchDebounceMs(runtimeConfig),
    reply_mode: normalizeReplyMode(runtimeConfig.reply_mode),
    human_typing_mode: normalizeHumanTypingMode(runtimeConfig.human_typing_mode),
    manager_takeover_enabled: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
    manager_return_delay_ms: getConfigManagerReturnDelayMs(runtimeConfig),
    ai_crm_extractor_enabled: parseConfigBoolean(runtimeConfig.ai_crm_extractor_enabled, true),
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method,
    payment_card_number: runtimeConfig.payment_card_number,
    payment_recipient_name: runtimeConfig.payment_recipient_name,
    payment_bank: runtimeConfig.payment_bank,
    payment_comment: runtimeConfig.payment_comment,
    prompt_behavior_enabled: parseConfigBoolean(runtimeConfig.prompt_behavior_enabled, true),
    prompt_behavior_text: runtimeConfig.prompt_behavior_text,
    prompt_retail_enabled: parseConfigBoolean(runtimeConfig.prompt_retail_enabled, true),
    prompt_retail_text: runtimeConfig.prompt_retail_text,
    prompt_media_enabled: parseConfigBoolean(runtimeConfig.prompt_media_enabled, true),
    prompt_media_text: runtimeConfig.prompt_media_text,
    prompt_layout_enabled: parseConfigBoolean(runtimeConfig.prompt_layout_enabled, true),
    prompt_layout_text: runtimeConfig.prompt_layout_text,
    prompt_memory_enabled: parseConfigBoolean(runtimeConfig.prompt_memory_enabled, true),
    prompt_memory_text: runtimeConfig.prompt_memory_text,
    prompt_payment_enabled: parseConfigBoolean(runtimeConfig.prompt_payment_enabled, true),
    prompt_payment_text: runtimeConfig.prompt_payment_text,
    prompt_crm_extract_enabled: parseConfigBoolean(runtimeConfig.prompt_crm_extract_enabled, true),
    prompt_crm_extract_text: runtimeConfig.prompt_crm_extract_text,
    prompt_payment_check_enabled: parseConfigBoolean(runtimeConfig.prompt_payment_check_enabled, true),
    prompt_payment_check_text: runtimeConfig.prompt_payment_check_text,
    webhook_url: runtimeConfig.webhook_url,
  };
}

function normalizeWebhookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = raw.replace(/\/+$/, '');
  return clean.endsWith('/api/telegram/webhook') ? clean : `${clean}/api/telegram/webhook`;
}

function loadPersistedConfig() {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return;

  try {
    const persisted = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    const allowedKeys = Object.keys(runtimeConfig);
    let shouldRewrite = false;
    allowedKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(persisted, key)) {
        const value = key === 'webhook_url'
          ? normalizeWebhookUrl(persisted[key] || '')
          : persisted[key];
        runtimeConfig[key] = value;
        if (key === 'webhook_url' && value !== persisted[key]) {
          shouldRewrite = true;
        }
      } else {
        shouldRewrite = true;
      }
    });

    if (shouldRewrite) {
      savePersistedConfig();
    }
  } catch (error) {
    logEvent('ERROR', {
      scope: 'config.load',
      status: 'error',
      error: error.message,
    });
    try {
      const corruptPath = `${CONFIG_FILE_PATH}.corrupt-${Date.now()}`;
      fs.renameSync(CONFIG_FILE_PATH, corruptPath);
      savePersistedConfig();
    } catch (secondaryError) {
      logEvent('ERROR', {
        scope: 'config.load.recover',
        status: 'error',
        error: secondaryError.message,
      });
    }
  }
}

function savePersistedConfig() {
  const tempPath = `${CONFIG_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(getRuntimeSnapshot(), null, 2));
  fs.renameSync(tempPath, CONFIG_FILE_PATH);
}

function applyConfigUpdate(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'telegram_token')) {
    runtimeConfig.telegram_token = body.telegram_token || '';
    process.env.TELEGRAM_TOKEN = runtimeConfig.telegram_token;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_key')) {
    runtimeConfig.ai_key = body.ai_key || '';
    process.env.AI_API_KEY = runtimeConfig.ai_key;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_url')) {
    runtimeConfig.ai_url = body.ai_url || '';
    process.env.AI_BASE_URL = runtimeConfig.ai_url;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    runtimeConfig.model = body.model || '';
    process.env.MODEL = runtimeConfig.model;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_api_key')) {
    runtimeConfig.stt_api_key = body.stt_api_key || '';
    process.env.STT_API_KEY = runtimeConfig.stt_api_key;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_base_url')) {
    runtimeConfig.stt_base_url = body.stt_base_url || '';
    process.env.STT_BASE_URL = runtimeConfig.stt_base_url;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_model')) {
    runtimeConfig.stt_model = body.stt_model || 'gpt-4o-mini-transcribe';
    process.env.STT_MODEL = runtimeConfig.stt_model;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'instruction')) {
    runtimeConfig.instruction = body.instruction || '';
    process.env.INSTRUCTION = runtimeConfig.instruction;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tone')) {
    runtimeConfig.tone = body.tone || 'neutral';
    process.env.TONE = runtimeConfig.tone;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'response_length')) {
    runtimeConfig.response_length = body.response_length || 'medium';
    process.env.RESPONSE_LENGTH = runtimeConfig.response_length;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'creativity')) {
    runtimeConfig.creativity = body.creativity || 'balanced';
    process.env.CREATIVITY = runtimeConfig.creativity;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'persona_style')) {
    runtimeConfig.persona_style = body.persona_style || 'calm';
    process.env.PERSONA_STYLE = runtimeConfig.persona_style;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'persona_age')) {
    runtimeConfig.persona_age = String(body.persona_age || '27');
    process.env.PERSONA_AGE = runtimeConfig.persona_age;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'conversation_mode')) {
    runtimeConfig.conversation_mode = body.conversation_mode || 'general';
    process.env.CONVERSATION_MODE = runtimeConfig.conversation_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'media_behavior')) {
    runtimeConfig.media_behavior = body.media_behavior || 'describe_media';
    process.env.MEDIA_BEHAVIOR = runtimeConfig.media_behavior;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'auto_reply_enabled')) {
    runtimeConfig.auto_reply_enabled = parseConfigBoolean(body.auto_reply_enabled, true);
    process.env.AUTO_REPLY_ENABLED = String(runtimeConfig.auto_reply_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'memory_enabled')) {
    runtimeConfig.memory_enabled = parseConfigBoolean(body.memory_enabled, true);
    process.env.MEMORY_ENABLED = String(runtimeConfig.memory_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'memory_recent_limit')) {
    runtimeConfig.memory_recent_limit = getConfigMemoryLimit({ memory_recent_limit: body.memory_recent_limit });
    process.env.MEMORY_RECENT_LIMIT = String(runtimeConfig.memory_recent_limit);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'batch_debounce_ms')) {
    runtimeConfig.batch_debounce_ms = getConfigBatchDebounceMs({ batch_debounce_ms: body.batch_debounce_ms });
    process.env.BATCH_DEBOUNCE_MS = String(runtimeConfig.batch_debounce_ms);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'reply_mode')) {
    runtimeConfig.reply_mode = normalizeReplyMode(body.reply_mode || 'smart');
    process.env.REPLY_MODE = runtimeConfig.reply_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'human_typing_mode')) {
    runtimeConfig.human_typing_mode = normalizeHumanTypingMode(body.human_typing_mode || 'natural');
    process.env.HUMAN_TYPING_MODE = runtimeConfig.human_typing_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'manager_takeover_enabled')) {
    runtimeConfig.manager_takeover_enabled = parseConfigBoolean(body.manager_takeover_enabled, true);
    process.env.MANAGER_TAKEOVER_ENABLED = String(runtimeConfig.manager_takeover_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'manager_return_delay_ms')) {
    runtimeConfig.manager_return_delay_ms = getConfigManagerReturnDelayMs({ manager_return_delay_ms: body.manager_return_delay_ms });
    process.env.MANAGER_RETURN_DELAY_MS = String(runtimeConfig.manager_return_delay_ms);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_crm_extractor_enabled')) {
    runtimeConfig.ai_crm_extractor_enabled = parseConfigBoolean(body.ai_crm_extractor_enabled, true);
    process.env.AI_CRM_EXTRACTOR_ENABLED = String(runtimeConfig.ai_crm_extractor_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_enabled')) {
    runtimeConfig.payment_enabled = parseConfigBoolean(body.payment_enabled, false);
    process.env.PAYMENT_ENABLED = String(runtimeConfig.payment_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_method')) {
    runtimeConfig.payment_method = body.payment_method || 'card';
    process.env.PAYMENT_METHOD = runtimeConfig.payment_method;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_card_number')) {
    runtimeConfig.payment_card_number = body.payment_card_number || '';
    process.env.PAYMENT_CARD_NUMBER = runtimeConfig.payment_card_number;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_recipient_name')) {
    runtimeConfig.payment_recipient_name = body.payment_recipient_name || '';
    process.env.PAYMENT_RECIPIENT_NAME = runtimeConfig.payment_recipient_name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_bank')) {
    runtimeConfig.payment_bank = body.payment_bank || '';
    process.env.PAYMENT_BANK = runtimeConfig.payment_bank;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_comment')) {
    runtimeConfig.payment_comment = body.payment_comment || '';
    process.env.PAYMENT_COMMENT = runtimeConfig.payment_comment;
  }

  [
    ['prompt_behavior_enabled', 'PROMPT_BEHAVIOR_ENABLED', true],
    ['prompt_retail_enabled', 'PROMPT_RETAIL_ENABLED', true],
    ['prompt_media_enabled', 'PROMPT_MEDIA_ENABLED', true],
    ['prompt_layout_enabled', 'PROMPT_LAYOUT_ENABLED', true],
    ['prompt_memory_enabled', 'PROMPT_MEMORY_ENABLED', true],
    ['prompt_payment_enabled', 'PROMPT_PAYMENT_ENABLED', true],
    ['prompt_crm_extract_enabled', 'PROMPT_CRM_EXTRACT_ENABLED', true],
    ['prompt_payment_check_enabled', 'PROMPT_PAYMENT_CHECK_ENABLED', true],
  ].forEach(([key, envKey, defaultValue]) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      runtimeConfig[key] = parseConfigBoolean(body[key], defaultValue);
      process.env[envKey] = String(runtimeConfig[key]);
    }
  });

  [
    ['prompt_behavior_text', 'PROMPT_BEHAVIOR_TEXT', DEFAULT_BEHAVIOR_PROMPT],
    ['prompt_retail_text', 'PROMPT_RETAIL_TEXT', DEFAULT_RETAIL_PROMPT],
    ['prompt_media_text', 'PROMPT_MEDIA_TEXT', DEFAULT_MEDIA_PROMPT],
    ['prompt_layout_text', 'PROMPT_LAYOUT_TEXT', DEFAULT_LAYOUT_PROMPT],
    ['prompt_memory_text', 'PROMPT_MEMORY_TEXT', DEFAULT_MEMORY_PROMPT],
    ['prompt_payment_text', 'PROMPT_PAYMENT_TEXT', DEFAULT_PAYMENT_PROMPT],
    ['prompt_crm_extract_text', 'PROMPT_CRM_EXTRACT_TEXT', DEFAULT_CRM_EXTRACT_PROMPT],
    ['prompt_payment_check_text', 'PROMPT_PAYMENT_CHECK_TEXT', DEFAULT_PAYMENT_CHECK_PROMPT],
  ].forEach(([key, envKey, defaultValue]) => {
    if (Object.prototype.hasOwnProperty.call(body, key)) {
      runtimeConfig[key] = String(body[key] || defaultValue);
      process.env[envKey] = runtimeConfig[key];
    }
  });

  if (Object.prototype.hasOwnProperty.call(body, 'webhook_url')) {
    runtimeConfig.webhook_url = normalizeWebhookUrl(body.webhook_url || '');
    process.env.WEBHOOK_URL = runtimeConfig.webhook_url;
  }

  savePersistedConfig();
}

function getTelegramApiUrl(config, method) {
  return `https://api.telegram.org/bot${config.telegram_token}/${method}`;
}

async function fetchTelegramBusinessConnection(config, businessConnectionId) {
  const id = String(businessConnectionId || '').trim();
  if (!config.telegram_token || !id) return null;

  try {
    const response = await httpClient.get(getTelegramApiUrl(config, 'getBusinessConnection'), {
      params: {
        business_connection_id: id,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (response.data?.ok && response.data.result) {
      return upsertBusinessConnection(response.data.result);
    }
  } catch (e) {
    logEvent('ERROR', {
      scope: 'telegram.getBusinessConnection',
      businessConnectionId: id,
      status: 'error',
      error: e.message,
    });
  }

  return null;
}

function detectMessageType(message) {
  if (message.text) return 'text';
  if (message.photo) return 'photo';
  if (message.sticker) return 'sticker';
  if (message.voice) return 'voice';
  if (message.video) return 'video';
  if (message.video_note) return 'video_note';
  if (message.animation) return 'animation';
  if (message.document) return 'document';
  if (message.audio) return 'audio';
  if (message.contact) return 'contact';
  if (message.location) return 'location';
  if (message.venue) return 'venue';
  if (message.poll) return 'poll';
  return 'unknown';
}

function getTelegramMessageContext(update) {
  if (update.business_message) {
    return {
      message: update.business_message,
      updateType: 'business_message',
      businessConnectionId: update.business_message.business_connection_id || '',
      messageId: update.business_message.message_id || '',
    };
  }

  if (update.edited_business_message) {
    return {
      message: update.edited_business_message,
      updateType: 'edited_business_message',
      businessConnectionId: update.edited_business_message.business_connection_id || '',
      messageId: update.edited_business_message.message_id || '',
    };
  }

  if (update.message) {
    return {
      message: update.message,
      updateType: 'message',
      businessConnectionId: '',
      messageId: update.message.message_id || '',
    };
  }

  if (update.edited_message) {
    return {
      message: update.edited_message,
      updateType: 'edited_message',
      businessConnectionId: '',
      messageId: update.edited_message.message_id || '',
    };
  }

  if (update.channel_post) {
    return {
      message: update.channel_post,
      updateType: 'channel_post',
      businessConnectionId: '',
    };
  }

  if (update.edited_channel_post) {
    return {
      message: update.edited_channel_post,
      updateType: 'edited_channel_post',
      businessConnectionId: '',
    };
  }

  return {
    message: null,
    updateType: getTelegramUpdateType(update),
    businessConnectionId: update.business_connection?.id || '',
  };
}

function getTelegramUpdateType(update) {
  if (!update || typeof update !== 'object') return 'unknown';
  return [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'callback_query',
    'business_connection',
    'business_message',
    'edited_business_message',
  ].find((key) => update[key]) || 'unknown';
}

async function classifyTelegramMessageSource(config, context, message) {
  if (!context.businessConnectionId || !String(context.updateType || '').includes('business_message')) {
    return {
      source: 'client',
      businessConnection: null,
    };
  }

  if (message.sender_business_bot) {
    return {
      source: 'bot',
      businessConnection: getBusinessConnectionById(context.businessConnectionId),
    };
  }

  let businessConnection = getBusinessConnectionById(context.businessConnectionId);
  if (!businessConnection) {
    businessConnection = await fetchTelegramBusinessConnection(config, context.businessConnectionId);
  }

  const fromId = String(message.from?.id || '').trim();
  const chatId = String(message.chat?.id || '').trim();
  const businessUserId = String(businessConnection?.userId || '').trim();
  if (fromId && businessUserId && fromId === businessUserId) {
    return {
      source: message.is_from_offline ? 'manager_auto' : 'manager',
      businessConnection,
    };
  }

  if (!businessUserId && fromId && chatId && fromId !== chatId) {
    return {
      source: message.is_from_offline ? 'manager_auto' : 'manager',
      businessConnection,
    };
  }

  return {
    source: 'client',
    businessConnection,
  };
}

function truncateText(text) {
  return String(text || '').slice(0, MAX_INPUT_TEXT_LENGTH);
}

function containsLink(text) {
  return /(https?:\/\/\S+|www\.\S+|t\.me\/\S+)/i.test(String(text || ''));
}

function hasRequiredConfig(config, fields) {
  return fields.every((field) => typeof config[field] === 'string' && config[field].trim());
}

function logMissingConfig(scope, config, fields, meta = {}) {
  const missing = fields.filter((field) => !config[field] || !String(config[field]).trim());
  if (missing.length) {
    logEvent('ERROR', {
      traceId: meta.traceId || null,
      scope: 'config.missing',
      target: scope,
      missing,
      status: 'error',
      ...meta,
    });
    return true;
  }
  return false;
}

function isTimeoutError(error) {
  return error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
}

function isRateLimitError(error) {
  return error.response?.status === 429;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseConfigBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeReplyMode(value) {
  return ['smart', 'last', 'media', 'off'].includes(value) ? value : 'smart';
}

function normalizeHumanTypingMode(value) {
  return ['fast', 'natural', 'slow'].includes(value) ? value : 'natural';
}

function getConfigManagerReturnDelayMs(config = runtimeConfig) {
  return clampNumber(
    config.manager_return_delay_ms,
    MANAGER_RETURN_DELAY_MS,
    MIN_MANAGER_RETURN_DELAY_MS,
    MAX_MANAGER_RETURN_DELAY_MS,
  );
}

function getConfigMemoryLimit(config = runtimeConfig) {
  return clampNumber(config.memory_recent_limit, MEMORY_RECENT_LIMIT, MIN_MEMORY_RECENT_LIMIT, MAX_MEMORY_RECENT_LIMIT);
}

function getConfigBatchDebounceMs(config = runtimeConfig) {
  return clampNumber(config.batch_debounce_ms, BATCH_DEBOUNCE_MS, MIN_BATCH_DEBOUNCE_MS, MAX_BATCH_DEBOUNCE_MS);
}

function getHumanTypingDelayMs(text, config = runtimeConfig) {
  const length = String(text || '').length;
  const cps = randomBetween(HUMAN_TYPING_MIN_CPS, HUMAN_TYPING_MAX_CPS);
  const typingTime = Math.round((length / cps) * 1000);
  const thinkingTime = length <= 100
    ? randomBetween(500, 1200)
    : length <= 300
      ? randomBetween(900, 2200)
      : randomBetween(1400, 3000);
  const baseDelay = Math.min(
    HUMAN_TYPING_MAX_DELAY_MS,
    Math.max(HUMAN_TYPING_MIN_DELAY_MS, typingTime + thinkingTime + randomBetween(500, 1500)),
  );
  const mode = normalizeHumanTypingMode(config.human_typing_mode);
  if (mode === 'fast') return Math.round(baseDelay * 0.65);
  if (mode === 'slow') return Math.round(baseDelay * 1.25);
  return baseDelay;
}

function splitReplyForTelegram(reply) {
  const text = String(reply || '').trim();
  if (!text || text.length <= LONG_REPLY_PART_LIMIT) return text ? [text] : [];

  const parts = [];
  let current = '';
  const chunks = text
    .split(/(\n{2,})/)
    .reduce((acc, chunk) => {
      if (!chunk) return acc;
      if (/^\n{2,}$/.test(chunk) && acc.length) {
        acc[acc.length - 1] += chunk;
      } else {
        acc.push(chunk);
      }
      return acc;
    }, []);

  chunks.forEach((chunk) => {
    if ((current + chunk).length <= LONG_REPLY_PART_LIMIT) {
      current += chunk;
      return;
    }

    if (current.trim()) {
      parts.push(current.trim());
      current = '';
    }

    if (chunk.length <= LONG_REPLY_PART_LIMIT) {
      current = chunk;
      return;
    }

    for (let index = 0; index < chunk.length; index += LONG_REPLY_PART_LIMIT) {
      parts.push(chunk.slice(index, index + LONG_REPLY_PART_LIMIT).trim());
    }
  });

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

async function markTelegramBusinessMessageRead(config, context) {
  if (!config.telegram_token || !context.businessConnectionId || !context.messageId) {
    return false;
  }

  const payload = {
    business_connection_id: context.businessConnectionId,
    chat_id: context.chatId,
    message_id: context.messageId,
  };

  try {
    await httpClient.post(getTelegramApiUrl(config, 'readBusinessMessage'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    logEvent('TG_READ', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageId: context.messageId,
      messageType: context.messageType,
      status: 'ok',
    });
    return true;
  } catch (e) {
    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.readBusinessMessage',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageId: context.messageId,
      messageType: context.messageType,
      status: 'error',
      error: e.message,
    });
    return false;
  }
}

function logMessageDelivered(context) {
  logEvent('MESSAGE_STATUS', {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageId: context.messageId || '',
    messageType: context.messageType,
    messageStatus: 'delivered',
    status: 'ok',
  });
}

async function waitAndMarkMessageRead(config, context) {
  await wait(randomBetween(READ_DELAY_MIN_MS, READ_DELAY_MAX_MS));
  const telegramRead = await markTelegramBusinessMessageRead(config, context);
  logEvent('MESSAGE_STATUS', {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageId: context.messageId || '',
    messageType: context.messageType,
    messageStatus: 'read',
    telegramRead,
    status: 'ok',
  });
}

async function waitAndMarkBatchRead(config, inputs) {
  await wait(randomBetween(READ_DELAY_MIN_MS, READ_DELAY_MAX_MS));

  for (const input of inputs) {
    const telegramRead = await markTelegramBusinessMessageRead(config, input);
    logEvent('MESSAGE_STATUS', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageId: input.messageId || '',
      messageType: input.messageType,
      messageStatus: 'read',
      telegramRead,
      status: 'ok',
    });
  }
}

async function waitForSlot(type, chatId, messageType, getActiveCount, limit, timeoutMs) {
  if (getActiveCount() < limit) {
    return true;
  }

  logEvent(`${type}.wait_start`, {
    status: 'process',
    chatId,
    messageType,
    active: getActiveCount(),
    limit,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(SLOT_WAIT_INTERVAL_MS);
    if (getActiveCount() < limit) {
      logEvent(`${type}.wait_acquired`, {
        status: 'ok',
        chatId,
        messageType,
        active: getActiveCount(),
        limit,
        waitedMs: Date.now() - startedAt,
      });
      return true;
    }
  }

  logEvent(`${type}.wait_timeout`, {
    status: 'error',
    chatId,
    messageType,
    active: getActiveCount(),
    limit,
    waitedMs: Date.now() - startedAt,
  });
  return false;
}

async function getTelegramFileUrl(config, chatId, messageType, fileId) {
  if (logMissingConfig('telegram.getFile', config, ['telegram_token'], { chatId, messageType })) {
    return null;
  }

  const acquired = await waitForSlot(
    'getfile',
    chatId,
    messageType,
    () => activeGetFileRequests,
    GETFILE_CONCURRENCY_LIMIT,
    SLOT_WAIT_TIMEOUT_MS
  );

  if (!acquired) {
    return null;
  }

  activeGetFileRequests += 1;

  try {
    const response = await httpClient.get(getTelegramApiUrl(config, 'getFile'), {
      params: { file_id: fileId },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const filePath = response.data?.result?.file_path;
    if (!filePath) return null;
    return `https://api.telegram.org/file/bot${config.telegram_token}/${filePath}`;
  } finally {
    activeGetFileRequests -= 1;
  }
}

async function downloadTelegramFile(config, chatId, messageType, fileId) {
  const fileUrl = await getTelegramFileUrl(config, chatId, messageType, fileId);
  if (!fileUrl) return null;

  const response = await httpClient.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
  });

  return Buffer.from(response.data);
}

function getSttRuntimeConfig(config) {
  return {
    apiKey: String(config.stt_api_key || config.ai_key || '').trim(),
    baseUrl: String(config.stt_base_url || config.ai_url || '').trim(),
    model: String(config.stt_model || 'gpt-4o-mini-transcribe').trim(),
  };
}

function isOpenAiAudioApi(baseUrl) {
  return /api\.openai\.com\/v1\/?$/i.test(String(baseUrl || '').trim());
}

async function transcribeTelegramMedia(config, context, fileId, options = {}) {
  const sttConfig = getSttRuntimeConfig(config);

  if (logMissingConfig('stt.request', { ai_key: sttConfig.apiKey, ai_url: sttConfig.baseUrl }, ['ai_key', 'ai_url'], {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    messageType: context.messageType,
  })) {
    return null;
  }

  if (!isOpenAiAudioApi(sttConfig.baseUrl)) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      error: 'Current STT provider does not support built-in OpenAI STT path',
    });
    return null;
  }

  if (options.fileSize && options.fileSize > MAX_STT_FILE_BYTES) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      error: 'Audio file exceeds STT size limit',
      fileSize: options.fileSize,
    });
    return null;
  }

  const startedAt = Date.now();

  try {
    logEvent('STT_REQUEST', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'process',
      fileSize: options.fileSize || 0,
      mimeType: options.mimeType || '',
      model: sttConfig.model,
      sttBaseUrl: sttConfig.baseUrl,
    });

    const fileBuffer = await downloadTelegramFile(config, context.chatId, context.messageType, fileId);
    if (!fileBuffer || !fileBuffer.length) {
      throw new Error('Failed to download media for STT');
    }

    const form = new FormData();
    form.append('model', sttConfig.model);
    form.append(
      'file',
      new Blob([fileBuffer], { type: options.mimeType || 'application/octet-stream' }),
      options.fileName || `${context.messageType}.bin`
    );

    const response = await httpClient.post(
      `${sttConfig.baseUrl.replace(/\/$/, '')}/audio/transcriptions`,
      form,
      {
        headers: {
          Authorization: `Bearer ${sttConfig.apiKey}`,
        },
        timeout: STT_TIMEOUT_MS,
      }
    );

    const text = String(response.data?.text || '').trim();
    if (!text) {
      throw new Error('STT returned empty transcript');
    }

    logEvent('STT_REPLY', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'ok',
      duration: Date.now() - startedAt,
      text,
    });

    return text;
  } catch (error) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      duration: Date.now() - startedAt,
      error: error.message,
    });
    return null;
  }
}

async function normalizeTelegramMessage(config, context, message) {
  const images = [];
  let text = message.text || message.caption || '';
  const messageType = detectMessageType(message);
  let hasMedia = false;
  let hasLinkInput = containsLink(text);

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    hasMedia = true;
    try {
      const imageUrl = await getTelegramFileUrl(config, context.chatId, messageType, photo.file_id);
      if (imageUrl) images.push(imageUrl);
    } catch (e) {
      logEvent('ERROR', { scope: 'telegram.getFile', message: e.message, messageType });
    }
    if (!text) {
      text = config.conversation_mode === 'retail'
        ? 'Пользователь прислал фото товара или похожего товара. Рассматривай это как вероятный интерес к товару и помоги с выбором или покупкой, если это уместно.'
        : 'опиши изображение';
    }
  }

  if (message.document) {
    const isImageLikeDocument =
      String(message.document.mime_type || '').startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(message.document.file_name || ''));

    if (isImageLikeDocument) {
      hasMedia = true;
      try {
        const imageUrl = await getTelegramFileUrl(config, context.chatId, 'document', message.document.file_id);
        if (imageUrl) images.push(imageUrl);
      } catch (e) {
        logEvent('ERROR', { scope: 'telegram.getFile', message: e.message, messageType: 'document' });
      }

      if (!text) {
        text = config.conversation_mode === 'retail'
          ? 'Пользователь прислал скрин или изображение товара. Рассматривай это как вероятный интерес к товару и помоги с выбором или покупкой, если это уместно.'
          : 'пользователь прислал изображение или скрин';
      }
    }
  }

  if (!text && message.sticker) {
    text = `пользователь отправил стикер${message.sticker.emoji ? ` ${message.sticker.emoji}` : ''}`;
  }

  if (!text && message.voice) {
    text = await transcribeTelegramMedia(config, context, message.voice.file_id, {
      fileSize: message.voice.file_size,
      mimeType: message.voice.mime_type || 'audio/ogg',
      fileName: `voice-${context.chatId}.ogg`,
    }) || 'пользователь отправил голосовое сообщение';
  }

  if (!text && message.video) {
    text = 'пользователь отправил видео';
  }

  if (!text && message.video_note) {
    text = await transcribeTelegramMedia(config, context, message.video_note.file_id, {
      fileSize: message.video_note.file_size,
      mimeType: 'video/mp4',
      fileName: `video-note-${context.chatId}.mp4`,
    }) || 'пользователь отправил видео-сообщение';
  }

  if (!text && message.animation) {
    text = 'пользователь отправил анимацию';
  }

  if (!text && message.document) {
    text = 'пользователь отправил файл';
  }

  if (!text && message.audio) {
    text = 'пользователь отправил аудио';
  }

  if (!text && message.contact) {
    text = 'пользователь отправил контакт';
  }

  if (!text && message.location) {
    text = `пользователь отправил геолокацию ${message.location.latitude}, ${message.location.longitude}`;
  }

  if (!text && message.venue) {
    text = `пользователь отправил место ${message.venue.title || ''}`.trim();
  }

  if (!text && message.poll) {
    text = `пользователь отправил опрос ${message.poll.question || ''}`.trim();
  }

  if (!text) {
    text = 'пользователь отправил сообщение без текста';
  }

  hasLinkInput = hasLinkInput || containsLink(text);

  if (config.conversation_mode === 'retail') {
    if (images.length > 0) {
      text = `Пользователь показывает товар или пример товара. Обычно это означает интерес к товару. Если запрос выглядит как товарный, отвечай как продавец и веди к выбору или покупке. Если сообщение нейтральное, отвечай естественно и по контексту.\n\nВход пользователя:\n${text}`;
    } else if (hasLinkInput) {
      text = `Пользователь прислал ссылку на товар, сайт или пост. Часто это означает интерес к товару. Если запрос выглядит как товарный, отвечай как продавец и веди к выбору или покупке. Если сообщение нейтральное, отвечай естественно и по контексту.\n\nВход пользователя:\n${text}`;
    }
  }

  return {
    text: truncateText(text),
    images,
    messageType,
    hasMedia,
    hasLinkInput,
  };
}

function extractAiReply(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item.text === 'string' ? item.text : '')
      .join('')
      .trim();
  }
  return '';
}

function getToneGuidance(tone) {
  const map = {
    neutral: 'Use a neutral, clear and professional tone.',
    friendly: 'Use a warm, friendly and approachable tone.',
    sales: 'Use a persuasive, confident and commercially oriented tone without sounding pushy.',
    concise: 'Use a very concise and direct tone.',
  };
  return map[tone] || map.neutral;
}

function getResponseLengthGuidance(responseLength) {
  const map = {
    short: 'Keep the reply short and compact.',
    medium: 'Keep the reply balanced in length.',
    long: 'Allow a more detailed reply when it helps.',
  };
  return map[responseLength] || map.medium;
}

function getMediaBehaviorGuidance(mediaBehavior) {
  const map = {
    describe_media: 'If media is attached, interpret and describe the media before answering.',
    answer_from_media: 'If media is attached, use the media as a primary source for the answer.',
    text_first: 'Prioritize the text input first and use media only as supporting context.',
  };
  return map[mediaBehavior] || map.describe_media;
}

function getConversationModeGuidance(conversationMode, config = runtimeConfig) {
  const map = {
    general: 'Treat incoming text and media as general-purpose user messages.',
    retail: parseConfigBoolean(config.prompt_retail_enabled, true)
      ? renderPromptTemplate(config.prompt_retail_text || DEFAULT_RETAIL_PROMPT)
      : '',
  };
  return map[conversationMode] || map.general;
}

function getCreativityTemperature(creativity) {
  const map = {
    precise: 0.2,
    balanced: 0.5,
    creative: 0.8,
  };
  return map[creativity] ?? map.balanced;
}

function getPersonaStyleGuidance(personaStyle) {
  const map = {
    calm: 'Write like a calm, natural person in chat. Keep the wording steady, clear, and not overly emotional.',
    conversational: 'Write like a natural conversational person in messenger. Allow light variation in phrasing and sentence rhythm without becoming casual or sloppy.',
    reserved: 'Write like a restrained, neat, professional person in chat. Keep the tone composed, concise, and low-pressure.',
  };
  return map[personaStyle] || map.calm;
}

function getPersonaAgeGuidance(personaAge) {
  const age = String(personaAge || '27').trim();
  return `Write with the natural rhythm of an adult around ${age} years old in messenger. Do not mention age and do not roleplay it explicitly.`;
}

function getPaymentGuidance(config) {
  if (!parseConfigBoolean(config.payment_enabled, false)) return '';
  if (!parseConfigBoolean(config.prompt_payment_enabled, true)) return '';

  const card = String(config.payment_card_number || '').trim();
  const recipient = String(config.payment_recipient_name || '').trim();
  const bank = String(config.payment_bank || '').trim();
  const comment = String(config.payment_comment || '').trim();
  const details = [
    card && `Payment card/details: ${card}`,
    recipient && `Recipient: ${recipient}`,
    bank && `Bank: ${bank}`,
    comment && `Payment note for client: ${comment}`,
  ].filter(Boolean);

  return renderPromptTemplate(config.prompt_payment_text || DEFAULT_PAYMENT_PROMPT, {
    payment_details: details.join('\n'),
  });
}

function getPromptLayerState(config, memoryContext = null) {
  return {
    instruction: !!String(config.instruction || '').trim(),
    behavior: parseConfigBoolean(config.prompt_behavior_enabled, true),
    retail: config.conversation_mode === 'retail' && parseConfigBoolean(config.prompt_retail_enabled, true),
    media: parseConfigBoolean(config.prompt_media_enabled, true),
    layout: parseConfigBoolean(config.prompt_layout_enabled, true),
    memory: parseConfigBoolean(config.memory_enabled, true)
      && parseConfigBoolean(config.prompt_memory_enabled, true)
      && !!memoryContext?.summary,
    payment: parseConfigBoolean(config.payment_enabled, false)
      && parseConfigBoolean(config.prompt_payment_enabled, true),
    crmExtract: parseConfigBoolean(config.ai_crm_extractor_enabled, true)
      && parseConfigBoolean(config.prompt_crm_extract_enabled, true),
    paymentCheck: parseConfigBoolean(config.payment_enabled, false)
      && parseConfigBoolean(config.prompt_payment_check_enabled, true),
  };
}

function getPromptConflictWarnings(config) {
  const warnings = [];
  const instruction = String(config.instruction || '').toLowerCase();
  const retail = String(config.prompt_retail_text || '').toLowerCase();
  const layout = String(config.prompt_layout_text || '').toLowerCase();

  if (instruction.includes('не выдум') && /(identify|определ|модель|product type)/i.test(config.prompt_retail_text || '')) {
    warnings.push('Instruction просит не выдумывать модель, а retail prompt может просить определить товар. Лучше уточнить: определять только при уверенности.');
  }

  if (instruction.includes('не тороп') && /(immediately|сразу|toward purchase|вести к покупке)/i.test(config.prompt_retail_text || '')) {
    warnings.push('Instruction просит не торопить клиента, а retail prompt может слишком активно вести к покупке. Нужен приоритет “один следующий шаг”.');
  }

  if (instruction.includes('всегда есть') && /(availability|налич|провер)/i.test(config.prompt_retail_text || '')) {
    warnings.push('Instruction говорит, что товары всегда в наличии, а prompt может просить проверять наличие.');
  }

  if (retail.includes('numbered') && instruction.includes('спис')) {
    warnings.push('Проверьте правила списков/нумерации: лучше запретить анкеты по умолчанию и разрешать списки только по запросу клиента.');
  }

  if (/(1–3 short lines|1-3 short lines|1–3 короткие строки|1-3 короткие строки)/i.test(config.prompt_layout_text || '')
    && /(подробно|длинн|развернут)/i.test(instruction)) {
    warnings.push('Layout prompt просит очень короткие сообщения, а Instruction может просить более развёрнутые ответы. Проверьте баланс длины.');
  }

  if (layout.includes('one next question') && /(несколько вопросов|1–2 коротких вопрос|1-2 коротких вопрос)/i.test(instruction)) {
    warnings.push('Layout prompt просит один вопрос за раз, а Instruction местами допускает 1–2 вопроса. Лучше зафиксировать один следующий шаг.');
  }

  return warnings;
}

function getCapabilitySnapshot(config) {
  const model = String(config.model || '').toLowerCase();
  const hasAi = !!(config.ai_key && config.ai_url && config.model);
  const visionKnown = /gpt-4|gpt-5|vision|vl|qwen-vl|gemini|claude|pixtral|llava/i.test(model);
  return {
    textAi: hasAi ? 'available' : 'missing',
    vision: hasAi ? (visionKnown ? 'likely' : 'unknown') : 'missing',
    stt: config.stt_api_key && config.stt_base_url && config.stt_model ? 'available' : 'missing',
    telegramBusiness: config.telegram_token ? 'configured' : 'missing',
    aiTimeoutMs: AI_REQUEST_TIMEOUT_MS,
    model: config.model || '',
    sttModel: config.stt_model || '',
  };
}

function buildSystemPrompt(config) {
  const parts = [];

  if (String(config.instruction || '').trim()) {
    parts.push(String(config.instruction).trim());
  }

  if (parseConfigBoolean(config.prompt_behavior_enabled, true)) {
    parts.push(renderPromptTemplate(config.prompt_behavior_text || DEFAULT_BEHAVIOR_PROMPT, {
      tone_guidance: getToneGuidance(config.tone),
      response_length_guidance: getResponseLengthGuidance(config.response_length),
      persona_style_guidance: getPersonaStyleGuidance(config.persona_style),
      persona_age_guidance: getPersonaAgeGuidance(config.persona_age),
    }));
  }
  parts.push(getConversationModeGuidance(config.conversation_mode, config));
  if (parseConfigBoolean(config.prompt_media_enabled, true)) {
    parts.push(renderPromptTemplate(config.prompt_media_text || DEFAULT_MEDIA_PROMPT, {
      media_behavior_guidance: getMediaBehaviorGuidance(config.media_behavior),
    }));
  }
  if (parseConfigBoolean(config.prompt_layout_enabled, true)) {
    parts.push(renderPromptTemplate(config.prompt_layout_text || DEFAULT_LAYOUT_PROMPT));
  }
  const paymentGuidance = getPaymentGuidance(config);
  if (paymentGuidance) parts.push(paymentGuidance);

  return parts.filter((part) => String(part || '').trim()).join('\n\n');
}

function buildFinalPromptPreview(config = runtimeConfig) {
  return {
    systemPrompt: buildSystemPrompt(config),
    appliedPrompts: getPromptLayerState(config),
    conflictWarnings: getPromptConflictWarnings(config),
    capabilities: getCapabilitySnapshot(config),
  };
}

function buildAiMessages(input) {
  const content = [{ type: 'text', text: input.text }];

  input.images.forEach((url) => {
    content.push({
      type: 'image_url',
      image_url: { url },
    });
  });

  const messages = [];
  const systemPrompt = buildSystemPrompt(input.config);
  if (systemPrompt.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  if (input.memoryContext?.summary) {
    messages.push({
      role: 'system',
      content: input.memoryContext.summary,
    });
  }

  (input.memoryContext?.history || []).forEach((message) => {
    if (!message.content) return;
    messages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  });

  messages.push({ role: 'user', content });

  return messages;
}

async function requestAi(input) {
  if (logMissingConfig('ai.request', input.config, ['ai_key', 'ai_url', 'model'], {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageType: input.messageType,
  })) {
    return null;
  }

  const acquired = await waitForSlot(
    'ai',
    input.chatId,
    input.messageType,
    () => activeAiRequests,
    AI_CONCURRENCY_LIMIT,
    SLOT_WAIT_TIMEOUT_MS
  );

  if (!acquired) {
    logEvent('ERROR', {
      traceId: input.traceId,
      userId: input.userId,
      scope: 'ai.wait_timeout',
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      status: 'error',
      active: activeAiRequests,
      limit: AI_CONCURRENCY_LIMIT,
    });
    return null;
  }

  const payload = {
    model: input.config.model,
    messages: buildAiMessages(input),
    temperature: getCreativityTemperature(input.config.creativity),
  };

    logEvent('AI_REQUEST', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      model: input.config.model,
      images: input.images.length,
      hasMedia: !!input.hasMedia,
      hasLinkInput: !!input.hasLinkInput,
      text: input.text,
      instructionPreview: truncateLogText(input.config.instruction || ''),
      memoryHistory: input.memoryContext?.history?.length || 0,
      memoryStage: input.memoryContext?.state?.stage || '',
      memoryFacts: Object.keys(input.memoryContext?.facts || {}),
      appliedPrompts: getPromptLayerState(input.config, input.memoryContext),
      promptWarnings: getPromptConflictWarnings(input.config),
    tone: input.config.tone,
    responseLength: input.config.response_length,
    creativity: input.config.creativity,
    personaStyle: input.config.persona_style,
    personaAge: input.config.persona_age,
    conversationMode: input.config.conversation_mode,
    mediaBehavior: input.config.media_behavior,
    autoReplyEnabled: parseConfigBoolean(input.config.auto_reply_enabled, true),
    memoryEnabled: parseConfigBoolean(input.config.memory_enabled, true),
    memoryRecentLimit: getConfigMemoryLimit(input.config),
    batchDebounceMs: getConfigBatchDebounceMs(input.config),
    replyMode: normalizeReplyMode(input.config.reply_mode),
    humanTypingMode: normalizeHumanTypingMode(input.config.human_typing_mode),
    managerTakeoverEnabled: parseConfigBoolean(input.config.manager_takeover_enabled, true),
    managerReturnDelayMs: getConfigManagerReturnDelayMs(input.config),
    aiCrmExtractorEnabled: parseConfigBoolean(input.config.ai_crm_extractor_enabled, true),
    paymentEnabled: parseConfigBoolean(input.config.payment_enabled, false),
    paymentMethod: input.config.payment_method || '',
    temperature: payload.temperature,
    status: 'process',
  });

  activeAiRequests += 1;
  const startedAt = Date.now();

  try {
    const aiResponse = await httpClient.post(
      `${input.config.ai_url.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${input.config.ai_key}`,
          'Content-Type': 'application/json',
        },
        timeout: AI_REQUEST_TIMEOUT_MS,
      }
    );

    const reply = extractAiReply(aiResponse.data?.choices?.[0]?.message?.content);
    if (typeof reply !== 'string' || !reply.trim()) {
      logEvent('ERROR', {
        traceId: input.traceId,
        userId: input.userId,
        scope: 'ai.reply',
        chatId: input.chatId,
        updateType: input.updateType || '',
        businessConnectionId: input.businessConnectionId || '',
        messageType: input.messageType,
        status: 'error',
        message: 'AI returned empty or invalid reply',
      });
      return null;
    }

    logEvent('AI_REPLY', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      duration: Date.now() - startedAt,
      replyText: reply,
      status: 'ok',
    });
    return reply;
  } catch (e) {
    logEvent('ERROR', {
      traceId: input.traceId,
      userId: input.userId,
      scope: isRateLimitError(e)
        ? 'ai.rate_limit'
        : isTimeoutError(e)
          ? 'ai.timeout'
          : 'ai.request',
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      duration: Date.now() - startedAt,
      status: 'error',
      error: e.message,
    });
    return null;
  } finally {
    activeAiRequests -= 1;
  }
}

async function sendTelegramMessage(config, context, text) {
  if (logMissingConfig('telegram.sendMessage', config, ['telegram_token'], {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageType: context.messageType,
  })) {
    return;
  }

  const startedAt = Date.now();
  const replyToMessageId = context.useReply && context.replyToMessageId
    ? context.replyToMessageId
    : '';

  try {
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      text,
      status: 'process',
    });
    const payload = {
      chat_id: context.chatId,
      text,
    };
    if (context.businessConnectionId) {
      payload.business_connection_id = context.businessConnectionId;
    }
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    await httpClient.post(getTelegramApiUrl(config, 'sendMessage'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      duration: Date.now() - startedAt,
      status: 'ok',
    });
  } catch (e) {
    if (replyToMessageId) {
      logEvent('ERROR', {
        traceId: context.traceId,
        userId: context.userId,
        scope: 'telegram.sendMessage.reply',
        chatId: context.chatId,
        updateType: context.updateType || '',
        businessConnectionId: context.businessConnectionId || '',
        messageType: context.messageType,
        replyToMessageId,
        duration: Date.now() - startedAt,
        status: 'error',
        error: e.message,
      });

      await sendTelegramMessage(config, { ...context, useReply: false }, text);
      return;
    }

    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.sendMessage',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      duration: Date.now() - startedAt,
      status: 'error',
      error: e.message,
    });
  }
}

async function sendTelegramChatAction(config, context, action = 'typing') {
  if (!config.telegram_token) return;

  const payload = {
    chat_id: context.chatId,
    action,
  };
  if (context.businessConnectionId) {
    payload.business_connection_id = context.businessConnectionId;
  }

  try {
    await httpClient.post(getTelegramApiUrl(config, 'sendChatAction'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    logEvent('TG_ACTION', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      action,
      status: 'ok',
    });
  } catch (e) {
    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.sendChatAction',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      status: 'error',
      error: e.message,
    });
  }
}

function startTypingLoop(config, context) {
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    await sendTelegramChatAction(config, context, 'typing');
    if (!stopped) {
      timer = setTimeout(tick, TYPING_REFRESH_MS);
    }
  };

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function sendHumanizedTelegramReply(config, context, reply) {
  const parts = splitReplyForTelegram(reply);
  for (let index = 0; index < parts.length; index += 1) {
    await sendTelegramChatAction(config, context, 'typing');
    await wait(getHumanTypingDelayMs(parts[index], config));
    await sendTelegramMessage(config, {
      ...context,
      useReply: index === 0 && !!context.replyToMessageId,
    }, parts[index]);
    if (index < parts.length - 1) {
      await wait(randomBetween(700, 1500));
    }
  }
}

async function setTelegramWebhook(config) {
  if (logMissingConfig('telegram.setWebhook', config, ['telegram_token', 'webhook_url'])) {
    return { ok: false, description: 'Missing telegram_token or webhook_url' };
  }

  try {
    const response = await httpClient.post(getTelegramApiUrl(config, 'setWebhook'), {
      url: config.webhook_url,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    }, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    return {
      ok: !!response.data?.ok,
      description: response.data?.description || '',
    };
  } catch (e) {
    logEvent('ERROR', {
      scope: 'telegram.setWebhook',
      message: e.response?.data?.description || e.message,
    });
    return {
      ok: false,
      description: e.response?.data?.description || e.message,
    };
  }
}

app.get('/login', (req, res) => {
  if (isAuthorized(req)) {
    res.redirect('/');
    return;
  }

  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const login = String(req.body?.login || '');
  const password = String(req.body?.password || '');

  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    setAuthCookie(res);
    res.json({ success: true });
    return;
  }

  res.status(401).json({ success: false });
});

app.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  clearAuthCookie(res);
  res.redirect('/login');
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/config/status', async (req, res) => {
  const status = {
    telegram: runtimeConfig.telegram_token ? 'подключен' : 'нет',
    ai: runtimeConfig.ai_key ? 'подключен' : 'нет',
    stt: runtimeConfig.stt_api_key ? 'подключен' : 'нет',
    model: runtimeConfig.model || '',
    base_url: runtimeConfig.ai_url || '',
    stt_api_key: runtimeConfig.stt_api_key || '',
    stt_base_url: runtimeConfig.stt_base_url || '',
    stt_model: runtimeConfig.stt_model || 'gpt-4o-mini-transcribe',
    instruction: runtimeConfig.instruction || '',
    tone: runtimeConfig.tone || 'neutral',
    response_length: runtimeConfig.response_length || 'medium',
    creativity: runtimeConfig.creativity || 'balanced',
    persona_style: runtimeConfig.persona_style || 'calm',
    persona_age: runtimeConfig.persona_age || '27',
    conversation_mode: runtimeConfig.conversation_mode || 'general',
    media_behavior: runtimeConfig.media_behavior || 'describe_media',
    auto_reply_enabled: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
    memory_enabled: parseConfigBoolean(runtimeConfig.memory_enabled, true),
    memory_recent_limit: getConfigMemoryLimit(runtimeConfig),
    batch_debounce_ms: getConfigBatchDebounceMs(runtimeConfig),
    reply_mode: normalizeReplyMode(runtimeConfig.reply_mode),
    human_typing_mode: normalizeHumanTypingMode(runtimeConfig.human_typing_mode),
    manager_takeover_enabled: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
    manager_return_delay_ms: getConfigManagerReturnDelayMs(runtimeConfig),
    ai_crm_extractor_enabled: parseConfigBoolean(runtimeConfig.ai_crm_extractor_enabled, true),
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method || 'card',
    payment_card_number: runtimeConfig.payment_card_number || '',
    payment_recipient_name: runtimeConfig.payment_recipient_name || '',
    payment_bank: runtimeConfig.payment_bank || '',
    payment_comment: runtimeConfig.payment_comment || '',
    final_system_prompt: buildFinalPromptPreview(runtimeConfig).systemPrompt,
    prompt_conflict_warnings: getPromptConflictWarnings(runtimeConfig),
    capabilities: getCapabilitySnapshot(runtimeConfig),
    prompt_behavior_enabled: parseConfigBoolean(runtimeConfig.prompt_behavior_enabled, true),
    prompt_behavior_text: runtimeConfig.prompt_behavior_text || DEFAULT_BEHAVIOR_PROMPT,
    prompt_retail_enabled: parseConfigBoolean(runtimeConfig.prompt_retail_enabled, true),
    prompt_retail_text: runtimeConfig.prompt_retail_text || DEFAULT_RETAIL_PROMPT,
    prompt_media_enabled: parseConfigBoolean(runtimeConfig.prompt_media_enabled, true),
    prompt_media_text: runtimeConfig.prompt_media_text || DEFAULT_MEDIA_PROMPT,
    prompt_layout_enabled: parseConfigBoolean(runtimeConfig.prompt_layout_enabled, true),
    prompt_layout_text: runtimeConfig.prompt_layout_text || DEFAULT_LAYOUT_PROMPT,
    prompt_memory_enabled: parseConfigBoolean(runtimeConfig.prompt_memory_enabled, true),
    prompt_memory_text: runtimeConfig.prompt_memory_text || DEFAULT_MEMORY_PROMPT,
    prompt_payment_enabled: parseConfigBoolean(runtimeConfig.prompt_payment_enabled, true),
    prompt_payment_text: runtimeConfig.prompt_payment_text || DEFAULT_PAYMENT_PROMPT,
    prompt_crm_extract_enabled: parseConfigBoolean(runtimeConfig.prompt_crm_extract_enabled, true),
    prompt_crm_extract_text: runtimeConfig.prompt_crm_extract_text || DEFAULT_CRM_EXTRACT_PROMPT,
    prompt_payment_check_enabled: parseConfigBoolean(runtimeConfig.prompt_payment_check_enabled, true),
    prompt_payment_check_text: runtimeConfig.prompt_payment_check_text || DEFAULT_PAYMENT_CHECK_PROMPT,
    webhook_url: runtimeConfig.webhook_url || '',
    sai: getSaiStatus(),
  };
  let telegramTokenValid = false;
  let aiProviderReachable = false;
  let sttProviderReachable = false;

  if (runtimeConfig.telegram_token) {
    try {
      await httpClient.get(`https://api.telegram.org/bot${runtimeConfig.telegram_token}/getMe`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      telegramTokenValid = true;
    } catch (e) {
      status.telegram = e.response?.data?.description || e.message;
    }
  }

  if (runtimeConfig.telegram_token && runtimeConfig.webhook_url) {
    try {
      const response = await httpClient.get(getTelegramApiUrl(runtimeConfig, 'getWebhookInfo'), {
        timeout: REQUEST_TIMEOUT_MS,
      });
      status.webhook = {
        url: response.data?.result?.url || '',
        pending_update_count: response.data?.result?.pending_update_count || 0,
        last_error_message: response.data?.result?.last_error_message || '',
      };
    } catch (e) {
      status.webhook = {
        url: '',
        pending_update_count: 0,
        last_error_message: e.response?.data?.description || e.message,
      };
    }
  } else {
    status.webhook = {
      url: runtimeConfig.webhook_url || '',
      pending_update_count: 0,
      last_error_message: '',
    };
  }

  if (runtimeConfig.ai_key && runtimeConfig.ai_url) {
    try {
      await httpClient.get(`${runtimeConfig.ai_url.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${runtimeConfig.ai_key}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      aiProviderReachable = true;
    } catch (e) {
      status.ai = e.response?.data?.error?.message || e.message;
    }
  }

  if (runtimeConfig.stt_api_key && runtimeConfig.stt_base_url) {
    try {
      await httpClient.get(`${runtimeConfig.stt_base_url.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${runtimeConfig.stt_api_key}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      sttProviderReachable = true;
    } catch (e) {
      status.stt = e.response?.data?.error?.message || e.message;
    }
  }

  const telegramHealth = buildTelegramHealth({
    tokenValid: telegramTokenValid,
    webhookInfo: status.webhook,
  });
  const aiHealth = buildAiHealth({
    providerReachable: aiProviderReachable,
  });
  const sttHealth = buildSttHealth({
    providerReachable: sttProviderReachable,
  });

  status.telegram_status = telegramHealth.status;
  status.telegram_label = telegramHealth.label;
  status.ai_status = aiHealth.status;
  status.ai_label = aiHealth.label;
  status.stt_status = sttHealth.status;
  status.stt_label = sttHealth.label;
  status.sai_label = getSaiStatusLabel(status.sai);

  res.json(status);
});

app.get('/config/final-prompt', (req, res) => {
  res.json(buildFinalPromptPreview(getRuntimeSnapshot()));
});

app.get('/logs', (req, res) => {
  const items = filterLogs(getMergedLogs(), req.query || {});
  res.json({ items });
});

app.get('/logs/:traceId', (req, res) => {
  const traceId = String(req.params.traceId || '').trim();
  const items = getMergedLogs()
    .filter((item) => item.traceId === traceId)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  res.json({
    traceId,
    items,
  });
});

app.get('/memory/:chatId', (req, res) => {
  const chatId = String(req.params.chatId || '').trim();
  const profile = safeCustomerStoreCall('customer.profile.get', (store) => store.getCustomerProfile(chatId));
  if (profile) {
    res.json({
      chatId,
      customer: profile.customer,
      facts: profile.facts || {},
      state: profile.state || null,
      lastOrder: profile.lastOrder || null,
      recentMessages: profile.recentMessages || [],
    });
    return;
  }
  const context = buildMemoryContext(chatId);
  res.json({
    chatId,
    facts: context.facts || {},
    state: context.state || null,
    recentMessages: getRecentMemoryMessages(chatId),
  });
});

app.delete('/memory/:chatId', (req, res) => {
  const chatId = String(req.params.chatId || '').trim();
  const ok = clearMemoryForChat(chatId);
  res.json({ ok });
});

app.delete('/logs', (req, res) => {
  runtimeLogs.length = 0;
  fs.writeFileSync(LOG_FILE_PATH, '');
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    markSaiRuntimeError('body.too_large', err.message);
    logEvent('ERROR', {
      scope: 'body.too_large',
      path: req.originalUrl || req.url,
    });
    res.sendStatus(200);
    return;
  }

  if (err) {
    markSaiRuntimeError('express', err.message);
    logEvent('ERROR', {
      scope: 'express',
      message: err.message,
      path: req.originalUrl || req.url,
    });
    res.sendStatus(200);
    return;
  }

  next();
});

app.post('/config', (req, res) => {
  const body = req.body || {};
  applyConfigUpdate(body);

  const shouldApplyWebhook =
    Object.prototype.hasOwnProperty.call(body, 'telegram_token') ||
    Object.prototype.hasOwnProperty.call(body, 'webhook_url');

  if (!shouldApplyWebhook) {
    res.json({ ok: true, webhook: null });
    return;
  }

  const snapshot = getRuntimeSnapshot();
  if (!snapshot.telegram_token || !snapshot.webhook_url) {
    res.json({
      ok: true,
      webhook: {
        ok: false,
        description: 'Webhook не применён: укажите токен бота и адрес webhook.',
      },
    });
    return;
  }

  setTelegramWebhook(snapshot)
    .then((webhook) => res.json({ ok: true, webhook }))
    .catch((error) => {
      res.json({
        ok: true,
        webhook: {
          ok: false,
          description: error.message,
        },
      });
    });
});

app.post('/config/models', async (req, res) => {
  const aiKey = req.body.ai_key || runtimeConfig.ai_key || '';
  const aiUrl = req.body.ai_url || runtimeConfig.ai_url || '';

  if (!aiKey || !aiUrl) {
    res.json([]);
    return;
  }

  try {
    const response = await httpClient.get(`${aiUrl.replace(/\/$/, '')}/models`, {
      headers: {
        Authorization: `Bearer ${aiKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    res.json(Array.isArray(response.data?.data) ? response.data.data.map((item) => item.id).filter(Boolean) : []);
  } catch (e) {
    res.json([]);
  }
});

app.post('/config/test-ai', async (req, res) => {
  const config = getRuntimeSnapshot();
  const text = truncateText(req.body.message || '');
  const traceId = createTraceId();

  if (!text) {
    res.json({ ok: false, reply: '', error: 'Message is required' });
    return;
  }

  logEvent('IN', {
    traceId,
    status: 'ok',
    scope: 'test.ai',
    userId: 'test',
    chatId: 'test',
    firstName: 'Test',
    username: 'test_user',
    messageType: 'test',
    text,
  });

  const reply = await requestAi({
    chatId: 'test',
    userId: 'test',
    traceId,
    messageType: 'test',
    text,
    images: [],
    config,
  });

  if (typeof reply !== 'string') {
    res.json({ ok: false, reply: '', error: 'AI did not return a reply' });
    return;
  }

  res.json({ ok: true, reply });
});

app.delete('/config', (req, res) => {
  runtimeConfig.telegram_token = '';
  runtimeConfig.ai_key = '';
  runtimeConfig.ai_url = '';
  runtimeConfig.model = '';
  runtimeConfig.stt_api_key = '';
  runtimeConfig.stt_base_url = 'https://api.openai.com/v1';
  runtimeConfig.stt_model = 'gpt-4o-mini-transcribe';
  runtimeConfig.instruction = '';
  runtimeConfig.tone = 'neutral';
  runtimeConfig.response_length = 'medium';
  runtimeConfig.creativity = 'balanced';
  runtimeConfig.persona_style = 'calm';
  runtimeConfig.persona_age = '27';
  runtimeConfig.conversation_mode = 'general';
  runtimeConfig.media_behavior = 'describe_media';
  runtimeConfig.auto_reply_enabled = true;
  runtimeConfig.memory_enabled = true;
  runtimeConfig.memory_recent_limit = MEMORY_RECENT_LIMIT;
  runtimeConfig.batch_debounce_ms = BATCH_DEBOUNCE_MS;
  runtimeConfig.reply_mode = 'smart';
  runtimeConfig.human_typing_mode = 'natural';
  runtimeConfig.manager_takeover_enabled = true;
  runtimeConfig.manager_return_delay_ms = MANAGER_RETURN_DELAY_MS;
  runtimeConfig.ai_crm_extractor_enabled = true;
  runtimeConfig.payment_enabled = false;
  runtimeConfig.payment_method = 'card';
  runtimeConfig.payment_card_number = '';
  runtimeConfig.payment_recipient_name = '';
  runtimeConfig.payment_bank = '';
  runtimeConfig.payment_comment = '';
  runtimeConfig.prompt_behavior_enabled = true;
  runtimeConfig.prompt_behavior_text = DEFAULT_BEHAVIOR_PROMPT;
  runtimeConfig.prompt_retail_enabled = true;
  runtimeConfig.prompt_retail_text = DEFAULT_RETAIL_PROMPT;
  runtimeConfig.prompt_media_enabled = true;
  runtimeConfig.prompt_media_text = DEFAULT_MEDIA_PROMPT;
  runtimeConfig.prompt_layout_enabled = true;
  runtimeConfig.prompt_layout_text = DEFAULT_LAYOUT_PROMPT;
  runtimeConfig.prompt_memory_enabled = true;
  runtimeConfig.prompt_memory_text = DEFAULT_MEMORY_PROMPT;
  runtimeConfig.prompt_payment_enabled = true;
  runtimeConfig.prompt_payment_text = DEFAULT_PAYMENT_PROMPT;
  runtimeConfig.prompt_crm_extract_enabled = true;
  runtimeConfig.prompt_crm_extract_text = DEFAULT_CRM_EXTRACT_PROMPT;
  runtimeConfig.prompt_payment_check_enabled = true;
  runtimeConfig.prompt_payment_check_text = DEFAULT_PAYMENT_CHECK_PROMPT;
  runtimeConfig.webhook_url = '';

  process.env.TELEGRAM_TOKEN = '';
  process.env.AI_API_KEY = '';
  process.env.AI_BASE_URL = '';
  process.env.MODEL = '';
  process.env.STT_API_KEY = '';
  process.env.STT_BASE_URL = 'https://api.openai.com/v1';
  process.env.STT_MODEL = 'gpt-4o-mini-transcribe';
  process.env.INSTRUCTION = '';
  process.env.TONE = 'neutral';
  process.env.RESPONSE_LENGTH = 'medium';
  process.env.CREATIVITY = 'balanced';
  process.env.PERSONA_STYLE = 'calm';
  process.env.PERSONA_AGE = '27';
  process.env.CONVERSATION_MODE = 'general';
  process.env.MEDIA_BEHAVIOR = 'describe_media';
  process.env.AUTO_REPLY_ENABLED = 'true';
  process.env.MEMORY_ENABLED = 'true';
  process.env.MEMORY_RECENT_LIMIT = String(MEMORY_RECENT_LIMIT);
  process.env.BATCH_DEBOUNCE_MS = String(BATCH_DEBOUNCE_MS);
  process.env.REPLY_MODE = 'smart';
  process.env.HUMAN_TYPING_MODE = 'natural';
  process.env.MANAGER_TAKEOVER_ENABLED = 'true';
  process.env.MANAGER_RETURN_DELAY_MS = String(MANAGER_RETURN_DELAY_MS);
  process.env.AI_CRM_EXTRACTOR_ENABLED = 'true';
  process.env.PAYMENT_ENABLED = 'false';
  process.env.PAYMENT_METHOD = 'card';
  process.env.PAYMENT_CARD_NUMBER = '';
  process.env.PAYMENT_RECIPIENT_NAME = '';
  process.env.PAYMENT_BANK = '';
  process.env.PAYMENT_COMMENT = '';
  process.env.WEBHOOK_URL = '';

  savePersistedConfig();

  res.json({ ok: true });
});

app.post('/api/telegram/webhook', async (req, res) => {
  const updateContext = getTelegramMessageContext(req.body || {});
  const message = updateContext.message;
  const chatId = message && message.chat && message.chat.id;

  if (!message || !chatId) {
    if (updateContext.updateType === 'business_connection') {
      const connection = upsertBusinessConnection(req.body.business_connection || {});
      logEvent('IN', {
        traceId: createTraceId(),
        status: 'ok',
        scope: 'telegram.business_connection',
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        userId: connection?.userId || req.body.business_connection?.user?.id || '',
        chatId: connection?.userChatId || req.body.business_connection?.user_chat_id || '',
        isEnabled: connection?.isEnabled ?? '',
        text: 'Telegram Business connection update',
      });
    }
    res.sendStatus(200);
    return;
  }

  const config = getRuntimeSnapshot();
  const traceId = createTraceId();
  const userId = message.from?.id || chatId;
  const firstName = String(message.from?.first_name || message.chat?.first_name || '').trim();
  const lastName = String(message.from?.last_name || message.chat?.last_name || '').trim();
  const username = String(message.from?.username || message.chat?.username || '').trim();
  const phoneNumber = String(message.contact?.phone_number || '').trim();

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      const sourceInfo = await classifyTelegramMessageSource(config, updateContext, message);
      const input = await normalizeTelegramMessage(config, {
        traceId,
        userId,
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        messageId: updateContext.messageId,
        messageType: detectMessageType(message),
      }, message);
      input.chatId = chatId;
      input.userId = userId;
      input.traceId = traceId;
      input.config = config;
      input.updateType = updateContext.updateType;
      input.businessConnectionId = updateContext.businessConnectionId;
      input.messageId = updateContext.messageId;
      input.messageSource = sourceInfo.source;
      input.firstName = firstName;
      input.lastName = lastName;
      input.username = username;
      input.phoneNumber = phoneNumber;
      safeCustomerStoreCall('customer.upsert', (store) => store.getOrCreateByTelegram(input));
      logEvent('IN', {
        traceId,
        received: true,
        userId,
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        messageSource: sourceInfo.source,
        businessUserId: sourceInfo.businessConnection?.userId || '',
        messageId: updateContext.messageId,
        firstName,
        lastName,
        username,
        phoneNumber,
        messageType: input.messageType,
        text: input.text,
        textLength: input.text.length,
        images: input.images.length,
        hasMedia: !!input.hasMedia,
        hasLinkInput: !!input.hasLinkInput,
        status: 'ok',
      });

      const memoryText = getMemoryMessageText(input);
      const memoryEnabled = parseConfigBoolean(config.memory_enabled, true);
      const managerTakeoverEnabled = parseConfigBoolean(config.manager_takeover_enabled, true);

      if (sourceInfo.source !== 'client') {
        if (memoryEnabled && ['manager', 'manager_auto'].includes(sourceInfo.source)) {
          appendMemoryMessage(input, 'manager', memoryText);
        }

        if (sourceInfo.source === 'manager' && managerTakeoverEnabled) {
          cancelChatBatch(chatId);
          cancelManagerReturnTimer(chatId);
          setManagerActive(chatId, input, 'manager_message');
          logEvent('MESSAGE_STATUS', {
            traceId,
            userId,
            chatId,
            updateType: updateContext.updateType,
            businessConnectionId: updateContext.businessConnectionId,
            messageId: updateContext.messageId,
            messageType: input.messageType,
            messageStatus: 'manager_takeover',
            status: 'ok',
          });
        } else {
          logEvent('MESSAGE_STATUS', {
            traceId,
            userId,
            chatId,
            updateType: updateContext.updateType,
            businessConnectionId: updateContext.businessConnectionId,
            messageId: updateContext.messageId,
            messageType: input.messageType,
            messageStatus: `${sourceInfo.source}_ignored`,
            status: 'ok',
          });
        }
        return;
      }

      if (memoryEnabled) {
        updateCustomerMemoryFromInput(input);
        appendMemoryMessage(input, 'user', memoryText);
      }

      if (!parseConfigBoolean(config.auto_reply_enabled, true)) {
        logEvent('MESSAGE_STATUS', {
          traceId,
          userId,
          chatId,
          updateType: updateContext.updateType,
          businessConnectionId: updateContext.businessConnectionId,
          messageId: updateContext.messageId,
          messageType: input.messageType,
          messageStatus: 'auto_reply_disabled',
          status: 'ok',
        });
        return;
      }

      const dialogState = getDialogState(chatId);
      if (managerTakeoverEnabled && dialogState?.aiMode === 'passive_manager') {
        scheduleManagerReturn(input);
        return;
      }

      enqueueInputForBatch(input);
    } catch (e) {
      logEvent('ERROR', {
        traceId,
        userId,
        scope: 'webhook',
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        status: 'error',
        error: e.message,
      });
    }
  });
});

const server = app.listen(PORT, HOST);
server.requestTimeout = 20000;
server.headersTimeout = 22000;
server.keepAliveTimeout = 5000;

console.log(`[BOOT] S.AI listening on http://${HOST}:${PORT}`);

process.on('unhandledRejection', (error) => {
  markSaiRuntimeError('process.unhandledRejection', error && error.message ? error.message : String(error));
  logEvent('ERROR', {
    scope: 'process.unhandledRejection',
    message: error && error.message ? error.message : String(error),
  });
});

process.on('uncaughtException', (error) => {
  markSaiRuntimeError('process.uncaughtException', error && error.message ? error.message : String(error));
  logEvent('ERROR', {
    scope: 'process.uncaughtException',
    message: error && error.message ? error.message : String(error),
  });
});
