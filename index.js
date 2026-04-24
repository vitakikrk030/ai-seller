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
const GREETING_DIALOG_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const TYPING_REFRESH_MS = 4500;
const READ_DELAY_MIN_MS = 1200;
const READ_DELAY_MAX_MS = 3500;
const LONG_REPLY_PART_LIMIT = 1400;
const HUMAN_TYPING_MIN_CPS = 12;
const HUMAN_TYPING_MAX_CPS = 18;
const HUMAN_TYPING_MIN_DELAY_MS = 1600;
const HUMAN_TYPING_MAX_DELAY_MS = 10000;
const MEMORY_RECENT_LIMIT = 20;
const MEMORY_MESSAGES_TTL_DAYS = 7;
const MEMORY_FACTS_TTL_DAYS = 90;
const MEMORY_STATE_TTL_DAYS = 14;
const MEMORY_MAX_MESSAGES = 5000;
const MEMORY_HISTORY_CHAR_LIMIT = 3500;
const BATCH_DEBOUNCE_MS = 3000;
const BATCH_MAX_WINDOW_MS = 6500;
const SIZE_ONLY_FOLLOWUP_DEBOUNCE_MS = 900;
const ORDER_CONTEXT_BATCH_MAX_WINDOW_MS = 9000;
const ORDER_PENDING_REPLY_SETTLE_MS = 5000;
const SEMANTIC_BATCH_DEBOUNCE_MS = 9000;
const SEMANTIC_BATCH_MAX_WINDOW_MS = 15000;
const ORDER_CONTEXT_MERGE_GRACE_MS = 3000;
const ORDER_CONTEXT_MERGE_POLL_MS = 120;
const MIN_MEMORY_RECENT_LIMIT = 20;
const MAX_MEMORY_RECENT_LIMIT = 50;
const MIN_BATCH_DEBOUNCE_MS = 0;
const MAX_BATCH_DEBOUNCE_MS = 10000;
const MANAGER_RETURN_DELAY_MS = 180000;
const MIN_MANAGER_RETURN_DELAY_MS = 30000;
const MAX_MANAGER_RETURN_DELAY_MS = 900000;
const WEBHOOK_ERROR_GRACE_MS = 15 * 60 * 1000;
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
  instruction: normalizeInstructionConfigValue(process.env.INSTRUCTION || ''),
  core_hot_lead_enabled: process.env.CORE_HOT_LEAD_ENABLED !== 'false',
  core_published_available_enabled: process.env.CORE_PUBLISHED_AVAILABLE_ENABLED !== 'false',
  core_no_stock_check_enabled: process.env.CORE_NO_STOCK_CHECK_ENABLED !== 'false',
  core_no_catalog_return_enabled: process.env.CORE_NO_CATALOG_RETURN_ENABLED !== 'false',
  core_no_resell_enabled: process.env.CORE_NO_RESELL_ENABLED !== 'false',
  core_rules_text: process.env.CORE_RULES_TEXT || '',
  facts_no_invent_enabled: process.env.FACTS_NO_INVENT_ENABLED !== 'false',
  facts_no_fake_payment_enabled: process.env.FACTS_NO_FAKE_PAYMENT_ENABLED !== 'false',
  facts_no_fake_delivery_enabled: process.env.FACTS_NO_FAKE_DELIVERY_ENABLED !== 'false',
  facts_no_fake_discounts_enabled: process.env.FACTS_NO_FAKE_DISCOUNTS_ENABLED !== 'false',
  facts_no_final_payment_confirm_enabled: process.env.FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED !== 'false',
  facts_no_fake_delivery_time_enabled: process.env.FACTS_NO_FAKE_DELIVERY_TIME_ENABLED !== 'false',
  facts_rules_text: process.env.FACTS_RULES_TEXT || '',
  smalltalk_enabled: process.env.SMALLTALK_ENABLED !== 'false',
  smalltalk_style_enabled: process.env.SMALLTALK_STYLE_ENABLED !== 'false',
  smalltalk_outfit_advice_enabled: process.env.SMALLTALK_OUTFIT_ADVICE_ENABLED !== 'false',
  smalltalk_weather_enabled: process.env.SMALLTALK_WEATHER_ENABLED !== 'false',
  smalltalk_soft_product_link_enabled: process.env.SMALLTALK_SOFT_PRODUCT_LINK_ENABLED !== 'false',
  smalltalk_rules_text: process.env.SMALLTALK_RULES_TEXT || '',
  order_path_enabled: process.env.ORDER_PATH_ENABLED !== 'false',
  order_collect_size_enabled: process.env.ORDER_COLLECT_SIZE_ENABLED !== 'false',
  order_collect_insole_enabled: process.env.ORDER_COLLECT_INSOLE_ENABLED !== 'false',
  order_collect_full_name_enabled: process.env.ORDER_COLLECT_FULL_NAME_ENABLED !== 'false',
  order_collect_phone_enabled: process.env.ORDER_COLLECT_PHONE_ENABLED !== 'false',
  order_collect_city_enabled: process.env.ORDER_COLLECT_CITY_ENABLED !== 'false',
  order_collect_delivery_service_enabled: process.env.ORDER_COLLECT_DELIVERY_SERVICE_ENABLED !== 'false',
  order_collect_pickup_enabled: process.env.ORDER_COLLECT_PICKUP_ENABLED !== 'false',
  order_collect_payment_enabled: process.env.ORDER_COLLECT_PAYMENT_ENABLED !== 'false',
  order_collect_receipt_enabled: process.env.ORDER_COLLECT_RECEIPT_ENABLED !== 'false',
  order_step_mode: process.env.ORDER_STEP_MODE || 'natural',
  order_rules_text: process.env.ORDER_RULES_TEXT || '',
  response_guard_enabled: process.env.RESPONSE_GUARD_ENABLED !== 'false',
  response_guard_no_fake_payment_enabled: process.env.RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED !== 'false',
  response_guard_no_repeat_known_enabled: process.env.RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED !== 'false',
  response_guard_human_tone_enabled: process.env.RESPONSE_GUARD_HUMAN_TONE_ENABLED !== 'false',
  response_guard_next_step_enabled: process.env.RESPONSE_GUARD_NEXT_STEP_ENABLED !== 'false',
  response_guard_no_final_payment_enabled: process.env.RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED !== 'false',
  response_guard_rules_text: process.env.RESPONSE_GUARD_RULES_TEXT || '',
  receipt_check_enabled: process.env.RECEIPT_CHECK_ENABLED !== 'false',
  receipt_check_amount_enabled: process.env.RECEIPT_CHECK_AMOUNT_ENABLED !== 'false',
  receipt_check_bank_enabled: process.env.RECEIPT_CHECK_BANK_ENABLED !== 'false',
  receipt_check_recipient_enabled: process.env.RECEIPT_CHECK_RECIPIENT_ENABLED !== 'false',
  receipt_check_datetime_enabled: process.env.RECEIPT_CHECK_DATETIME_ENABLED !== 'false',
  receipt_check_mismatch_enabled: process.env.RECEIPT_CHECK_MISMATCH_ENABLED !== 'false',
  receipt_check_no_final_confirm_enabled: process.env.RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED !== 'false',
  receipt_check_success_text: process.env.RECEIPT_CHECK_SUCCESS_TEXT || 'Чек получил, спасибо. Статус доставки сможете отслеживать в приложении выбранной службы доставки. Если будут вопросы — напишите.',
  receipt_check_mismatch_text: process.env.RECEIPT_CHECK_MISMATCH_TEXT || 'Чек получил, но вижу расхождение с заказом. Проверьте, пожалуйста, сумму или реквизиты и пришлите корректный чек.',
  receipt_check_rules_text: process.env.RECEIPT_CHECK_RULES_TEXT || '',
  quality_replica_honesty_enabled: process.env.QUALITY_REPLICA_HONESTY_ENABLED !== 'false',
  quality_no_original_claims_enabled: process.env.QUALITY_NO_ORIGINAL_CLAIMS_ENABLED !== 'false',
  quality_calm_explanation_enabled: process.env.QUALITY_CALM_EXPLANATION_ENABLED !== 'false',
  quality_rules_text: process.env.QUALITY_RULES_TEXT || '',
  dialog_examples_enabled: process.env.DIALOG_EXAMPLES_ENABLED === 'true',
  dialog_examples_text: process.env.DIALOG_EXAMPLES_TEXT || '',
  tone: process.env.TONE || 'neutral',
  response_length: process.env.RESPONSE_LENGTH || 'medium',
  creativity: process.env.CREATIVITY || 'balanced',
  persona_style: process.env.PERSONA_STYLE || 'calm',
  persona_age: process.env.PERSONA_AGE || '27',
  conversation_mode: process.env.CONVERSATION_MODE || 'retail',
  media_behavior: process.env.MEDIA_BEHAVIOR || 'answer_from_media',
  auto_reply_enabled: process.env.AUTO_REPLY_ENABLED !== 'false',
  memory_enabled: process.env.MEMORY_ENABLED === 'true',
  memory_recent_limit: Number(process.env.MEMORY_RECENT_LIMIT || MEMORY_RECENT_LIMIT),
  batch_debounce_ms: Number(process.env.BATCH_DEBOUNCE_MS || BATCH_DEBOUNCE_MS),
  reply_mode: process.env.REPLY_MODE || 'smart',
  human_typing_mode: process.env.HUMAN_TYPING_MODE || 'natural',
  manager_takeover_enabled: process.env.MANAGER_TAKEOVER_ENABLED !== 'false',
  manager_return_delay_ms: Number(process.env.MANAGER_RETURN_DELAY_MS || MANAGER_RETURN_DELAY_MS),
  payment_enabled: process.env.PAYMENT_ENABLED === 'true',
  payment_method: process.env.PAYMENT_METHOD || 'card',
  payment_card_number: process.env.PAYMENT_CARD_NUMBER || '',
  payment_recipient_name: process.env.PAYMENT_RECIPIENT_NAME || '',
  payment_bank: process.env.PAYMENT_BANK || '',
  payment_comment: process.env.PAYMENT_COMMENT || '',
  delivery_rules_enabled: process.env.DELIVERY_RULES_ENABLED === 'true',
  delivery_rules_text: process.env.DELIVERY_RULES_TEXT || '',
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

function normalizeInstructionConfigValue(value) {
  return String(value ?? '').trim();
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

function markLatestClientTrace(input) {
  const cleanChatId = getMemoryChatId(input?.chatId || input);
  const traceId = String(input?.traceId || '').trim();
  if (!cleanChatId || !traceId) return null;
  const previous = memoryStore.states[cleanChatId] || {};
  const next = {
    ...previous,
    lastClientTraceId: traceId,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.states[cleanChatId] = next;
  safeCustomerStoreCall('customer.state.last_client', (store) => store.setDialogState(cleanChatId, next));
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

function getCustomerProfileSnapshot(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  const profile = safeCustomerStoreCall('customer.profile.get', (store) => store.getCustomerProfile(cleanChatId));
  if (profile) return profile;
  return {
    customer: null,
    facts: memoryStore.facts[cleanChatId] || {},
    state: getDialogState(cleanChatId),
    lastOrder: null,
    recentMessages: getRecentMemoryMessages(cleanChatId, 20),
  };
}

function extractPhone(text) {
  const source = String(text || '');
  const matches = source.match(/(?:\+?\d[\s().-]*){10,16}/g) || [];
  const hasPhoneHint = /(тел(?:ефон)?|номер|контакт|phone|whatsapp|ватсап)/i.test(source);
  for (const match of matches) {
    const groups = match.match(/\d+/g) || [];
    if (!groups.length) continue;
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) continue;
    if (!digits.startsWith('9') && !digits.startsWith('7') && !digits.startsWith('8')) continue;

    if (!hasPhoneHint) {
      const manyTinyGroups = groups.length >= 4 && groups.filter((group) => group.length <= 2).length >= 3;
      const hasPriceLikeTail = groups.some((group) => group.length >= 4);
      if (manyTinyGroups && hasPriceLikeTail) continue;
    }

    if (digits.length === 10) return `+7${digits}`;
    if (digits.startsWith('8')) return `+7${digits.slice(1)}`;
    if (digits.startsWith('7')) return `+${digits}`;
    return `+7${digits.slice(-10)}`;
  }
  return '';
}

function normalizeSizeToken(value) {
  return String(value || '').replace(',', '.').trim().toUpperCase();
}

function extractSizeTokens(text) {
  const seen = new Set();
  const tokens = [];
  const pattern = /\b(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\b/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const token = normalizeSizeToken(match[1]);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function extractAvailableSizeOptions(text) {
  const source = String(text || '');
  const options = [];
  const seen = new Set();
  const patterns = [
    /(?:^|\n|\r)\s*(?:доступные\s+)?размер(?:ы)?\s*[:\-]\s*([^\n\r]+)/gi,
    /(?:^|\n|\r)\s*(?:в\s+наличии|есть)\s+размер(?:ы)?\s*[:\-]?\s*([^\n\r]+)/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      extractSizeTokens(match[1]).forEach((token) => {
        if (seen.has(token)) return;
        seen.add(token);
        options.push(token);
      });
    }
  });
  return options;
}

function extractSingleLabeledSize(text) {
  const source = String(text || '');
  const match = source.match(/(?:^|\n|\r)\s*(?:размер\s+клиента|нужный\s+размер|выбранный\s+размер|размер|size)\s*[:\-]\s*([^\n\r]+)/i);
  if (!match) return '';
  const tokens = extractSizeTokens(match[1]);
  return tokens.length === 1 ? tokens[0] : '';
}

function extractShoeSize(text) {
  const source = String(text || '').trim();
  if (!source) return '';

  const labeled = extractSingleLabeledSize(source);
  if (labeled) return labeled;

  const patterns = [
    /(?:у\s+меня|мой\s+размер|мои?\s+размер|ношу|размер\s+у\s+меня)\s*(?:размер\s*)?(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?/i,
    /(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)\b/i,
    /(?:размер|size)\s*(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\b/i,
    /(?:есть|нужен|нужна|ищу|хочу|беру|возьму|можно(?:\s+\S+){0,2}|давайте|закаж(?:у|ите)?|оформ(?:ить|ляем)?|подойд[её]т|возьму)\s+(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?(?:\b|\?)/i,
    /(?:можно|беру|возьму|нужен|нужна|хочу|давайте)\s+(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i,
    /(?:на|под)\s*(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?(?:\b|\?)/i,
    /^(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)?$/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeSizeToken(match[1]);
  }

  if (extractAvailableSizeOptions(source).length > 1) return '';
  return '';
}

function normalizeExtractedShoeSize(value, sourceText = '') {
  const explicit = extractShoeSize(sourceText);
  if (explicit) return explicit;
  const tokens = extractSizeTokens(value);
  if (tokens.length !== 1) return '';
  if (extractAvailableSizeOptions(sourceText).length > 1) return '';
  return tokens[0];
}

function extractNumericSize(text) {
  const token = extractShoeSize(text);
  return /^\d{2}(?:\.\d+)?$/.test(String(token || '')) ? token : '';
}

function extractSize(text) {
  return extractShoeSize(text);
}

function extractInsoleCm(text) {
  const source = String(text || '');
  const patterns = [
    /(?:стелька|стельки|по\s+стельке|стельк(?:а|и|е))\s*(?:в|—|-|:)?\s*(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)?\b/i,
    /(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)\s*(?:по\s+стельке|по\s+стельк|стелька|стельки|стельке)\b/i,
    /(?:по\s+стельке|по\s+стельк[еии])\s*(\d{1,2}(?:[.,]\d)?)\b/i,
    /(?:^|[\s,;:])(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)\b/i,
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
  const source = String(text || '');
  const cleanCandidate = (value) => {
    let candidate = normalizeMemoryText(value)
      .replace(/^(?:здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|привет)[!,.:\-\s]*/i, '')
      .replace(/^(?:хочу\s+заказать|оформить(?:\s+заказ)?|оформляем)\s*[:\-]?\s*/i, '')
      .trim();
    if (!candidate) return '';

    [
      /\s+(?:https?:\/\/|www\.)\S+.*$/i,
      /\s+(?:источник|source|ссылка|линк|link|url|канал|пост|сайт)\s*[:\-]?\s*.+$/i,
      /\s+(?:id|id\s+товара|товар\s+id|артикул|артикул\s+товара)\s*[:#-]?\s*\S.*$/i,
      /\s+(?:цена|стоимость)\s*[:\-]?\s*\d{3,6}(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?.*$/i,
      /\s+\d{3,6}\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?).*$/i,
    ].forEach((pattern) => {
      candidate = candidate.replace(pattern, '').trim();
    });

    candidate = candidate
      .replace(/\s+(?:(?:\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*){2,}$/i, '')
      .replace(/\s+\d{2}(?:[.,]5)?\s*(?:размер|р-р|size)\s*$/i, '')
      .replace(/\s+(?:XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)\s*$/i, '')
      .replace(/[|,;:-]\s*$/g, '')
      .trim();

    if (!candidate) return '';
    if (isSizeOnlyFollowupMessage(candidate)) return '';
    if (/^(?:цена|стоимость|price)\b/i.test(candidate)) return '';
    if (/^\d{3,6}(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?$/i.test(candidate)) return '';
    return candidate;
  };

  const explicitLine = source.match(/(?:^|\n|\r)\s*(?:модель|товар|кроссовки|пара)\s*[:\-]?\s*([^\n\r]{3,160})/i);
  if (explicitLine) {
    const cleaned = cleanCandidate(
      explicitLine[1].split(/\s+(?:цена|стоимость|размер(?:ы)?|цвет|артикул|количество)\s*[:\-]/i)[0],
    );
    if (cleaned) return cleaned;
  }
  const normalized = normalizeMemoryText(source);
  const explicit = normalized.match(/(?:модель|товар|кроссовки|пара)\s*[:\-]?\s*(.{3,120}?)(?=\s+(?:цена|стоимость|размер(?:ы)?|цвет|артикул|количество)\s*[:\-]|$)/i);
  if (explicit) {
    const cleaned = cleanCandidate(explicit[1]);
    if (cleaned) return cleaned;
  }
  const orderIntent = normalized.match(/(?:хочу\s+заказать|оформить(?:\s+заказ)?|оформляем)\s*[:\-]?\s*(.{3,200})/i);
  if (orderIntent) {
    const cleaned = cleanCandidate(orderIntent[1]);
    if (cleaned) return cleaned;
  }
  return '';
}

function extractOrderPrice(text) {
  const source = String(text || '');
  const labeled = source.match(/(?:цена|стоимость|итого)\s*[:\-]?\s*(\d{3,6})(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?/i);
  if (labeled) return labeled[1];
  const currency = source.match(/(?:^|[^\d])(\d{3,6})\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?)(?=$|[^0-9A-Za-zА-Яа-яЁё])/i);
  return currency ? currency[1] : '';
}

function extractDeliveryService(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return '';
  if (/(сд[эе]к|cdek)\b/i.test(source)) return 'CDEK';
  if (/(wildberries|\bwb\b)/i.test(source)) return 'WB';
  if (/(ozon|озон)\b/i.test(source)) return 'Ozon';
  if (/(яндекс.*достав|доставк.*яндекс|яндекс go|yandex)/i.test(source)) return 'Яндекс Доставка';
  if (/(почта\s+россии|почтой|почта)/i.test(source)) return 'Почта России';
  if (/(курьер|до двери)/i.test(source)) return 'Курьер';
  return '';
}

function extractPickupPoint(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /(пвз|пункт\s+выдачи|ozon|озон|wildberries|\bwb\b|сд[эе]к|cdek|яндекс|почта)/i.test(line) && line.length >= 6);
  if (explicit) return explicit;
  const inline = source.match(/(?:пвз|пункт\s+выдачи)\s*[:\-]?\s*([^\n]{4,180})/i);
  return inline ? inline[1].trim() : '';
}

function detectShoeContextFromText(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return false;
  if (/(худи|футболк|лонгслив|штаны|джинс|куртк|свитшот|сумк|рюкзак|футболка|одежд)/i.test(source)) return false;
  return /(кроссовк|кеды|обув|shoe|sneaker|air max|air force|jordan|new balance|asics|yeezy|nike|adidas|puma|reebok|salomon|lacoste|odyssa)/i.test(source);
}

function buildSlotSnapshot(chatId, currentInput = null) {
  const profile = getCustomerProfileSnapshot(chatId) || {};
  const facts = profile.facts || {};
  const lastOrder = profile.lastOrder || {};
  const currentText = normalizeMemoryText(currentInput?.text || '');
  const product = normalizeMemoryText(lastOrder.product || facts.lastProduct?.value || facts.interest?.value || extractLastProduct(currentText));
  const size = normalizeMemoryText(lastOrder.size || facts.size?.value || facts.shoeSize?.value || extractSize(currentText));
  const insoleCm = normalizeMemoryText(facts.insoleCm?.value || extractInsoleCm(currentText));
  const fullName = normalizeMemoryText(lastOrder.full_name || facts.fullName?.value || extractFullName(currentText));
  const phone = normalizeMemoryText(lastOrder.phone || facts.phone?.value || extractPhone(currentText));
  const city = normalizeMemoryText(facts.city?.value || extractCity(currentText));
  const deliveryService = normalizeMemoryText(facts.deliveryService?.value || extractDeliveryService(currentText));
  const pickupPoint = normalizeMemoryText(facts.pickupPoint?.value || lastOrder.delivery_address || extractPickupPoint(currentText));
  const shoeContext = Boolean(
    facts.shoeContext?.value === 'true'
    || detectShoeContextFromText(product)
    || detectShoeContextFromText(facts.interest?.value || '')
    || detectShoeContextFromText(currentText)
  );
  const paymentRequested = ['payment_details_sent', 'proof_received'].includes(String(lastOrder.payment_status || ''));
  const paymentProofReceived = Boolean(
    lastOrder.payment_status === 'proof_received'
    || lastOrder.payment_check_status
    || lastOrder.proof_received_at
  );

  const closedSlots = [
    product && 'product',
    size && 'size',
    insoleCm && 'insole_cm',
    fullName && 'full_name',
    phone && 'phone',
    city && 'city',
    deliveryService && 'delivery_service',
    pickupPoint && 'pickup_point',
    paymentRequested && 'payment_requested',
    paymentProofReceived && 'payment_proof_received',
  ].filter(Boolean);

  let nextBlockingSlot = '';
  if (!product) nextBlockingSlot = 'product';
  else if (!size) nextBlockingSlot = 'size';
  else if (shoeContext && !insoleCm) nextBlockingSlot = 'insole_cm';
  else if (!fullName) nextBlockingSlot = 'full_name';
  else if (!phone) nextBlockingSlot = 'phone';
  else if (!deliveryService) nextBlockingSlot = 'delivery_service';
  else if (!pickupPoint) nextBlockingSlot = 'pickup_point';
  else if (parseConfigBoolean(currentInput?.config?.payment_enabled, false) && !paymentRequested) nextBlockingSlot = 'payment_requested';
  else if (parseConfigBoolean(currentInput?.config?.payment_enabled, false) && !paymentProofReceived) nextBlockingSlot = 'payment_proof_received';

  return {
    product,
    size,
    insoleCm,
    fullName,
    phone,
    city,
    deliveryService,
    pickupPoint,
    paymentRequested,
    paymentProofReceived,
    shoeContext,
    closedSlots,
    nextBlockingSlot,
  };
}

function buildSlotSummary(snapshot) {
  if (!snapshot) return '';
  const nextStepAction = {
    product: 'Уточнить товар',
    size: 'Уточнить размер',
    insole_cm: 'Уточнить длину стельки (см)',
    full_name: 'Запросить ФИО получателя',
    phone: 'Запросить телефон',
    city: 'Запросить город',
    delivery_service: 'Уточнить службу доставки',
    pickup_point: 'Уточнить ПВЗ или адрес',
    payment_requested: 'Перейти к оплате и дать реквизиты',
    payment_proof_received: 'Подтвердить получение чека',
  };
  const lines = [
    `- Товар: ${snapshot.product ? 'есть' : 'нет'}`,
    `- Размер: ${snapshot.size ? 'есть' : 'нет'}`,
    `- Стелька: ${snapshot.shoeContext ? (snapshot.insoleCm ? 'есть' : 'нет') : 'не нужна'}`,
    `- ФИО: ${snapshot.fullName ? 'есть' : 'нет'}`,
    `- Телефон: ${snapshot.phone ? 'есть' : 'нет'}`,
    `- Город: ${snapshot.city ? 'есть' : 'нет'}`,
    `- Служба доставки: ${snapshot.deliveryService ? 'есть' : 'нет'}`,
    `- ПВЗ/адрес: ${snapshot.pickupPoint ? 'есть' : 'нет'}`,
    `- Реквизиты уже отправлены: ${snapshot.paymentRequested ? 'да' : 'нет'}`,
    `- Чек получен: ${snapshot.paymentProofReceived ? 'да' : 'нет'}`,
    snapshot.closedSlots?.length && `- Уже закрыто: ${snapshot.closedSlots.join(', ')}`,
    snapshot.nextBlockingSlot && nextStepAction[snapshot.nextBlockingSlot] && `- Ближайший шаг: ${nextStepAction[snapshot.nextBlockingSlot]}`,
  ].filter(Boolean);
  if (!lines.length) return '';
  return ['Контекст оформления для AI Control. Не копировать клиенту дословно:', ...lines].join('\n');
}

function isPaymentIntentText(text) {
  return /(куда\s+платить|как\s+оплат|реквизит|карта|номер\s+карты|перевести|оплатить)/i.test(String(text || ''));
}

function isPaymentProofInput(input) {
  const text = String(input.text || '').toLowerCase();
  if (/(оплатил|оплатила|чек|квитанц|перев[её]л|скинул оплат|скрин.*оплат|receipt|payment)/i.test(text)) return true;
  if (!input.hasMedia) return false;
  const profile = getCustomerProfileSnapshot(input.chatId);
  const lastOrder = profile?.lastOrder || null;
  return [
    lastOrder?.payment_status,
    lastOrder?.status,
  ].some((value) => ['payment_details_sent', 'proof_received', 'waiting_payment', 'collecting_info', 'draft'].includes(String(value || '')));
}

function inferConversationStage(input) {
  const text = String(input.text || '').toLowerCase();
  if (/(оплатил|оплатила|чек|квитанц|перев[её]л|скинул оплат)/i.test(text)) return 'waiting_payment';
  if (/(беру|оформляем|оформить|куда платить|реквизит|оплатить|заказываю)/i.test(text)) return 'ready_to_buy';
  if (/(фио|адрес|телефон|\+?\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d)/i.test(text)) return 'collecting_order_info';
  if (/(размер|сколько стоит|цена|налич|есть\s+\d{2}|какие есть)/i.test(text)) return 'choosing';
  if (input.hasMedia || input.hasLinkInput || ['photo', 'document', 'video', 'video_note'].includes(input.messageType)) return 'interested';
  return '';
}

function updateCustomerMemoryFromInput(input) {
  const chatId = getMemoryChatId(input);
  const source = input.text || getMemoryMessageText(input);
  if (!chatId) return;

  const phone = extractPhone(input.text);
  if (phone) upsertMemoryFact(chatId, 'phone', phone, source);

  const size = extractSize(input.text);
  if (size) {
    upsertMemoryFact(chatId, 'size', size, source);
    if (/^\d{2}(?:\.\d+)?$/.test(size)) upsertMemoryFact(chatId, 'shoeSize', size, source);
  }

  const insoleCm = extractInsoleCm(input.text);
  if (insoleCm) upsertMemoryFact(chatId, 'insoleCm', insoleCm, source);

  const city = extractCity(input.text);
  if (city) upsertMemoryFact(chatId, 'city', city, source);

  const fullName = extractFullName(input.text);
  if (fullName) upsertMemoryFact(chatId, 'fullName', fullName, source);

  const deliveryAddress = extractDeliveryAddress(input.text);
  if (deliveryAddress) upsertMemoryFact(chatId, 'deliveryAddress', deliveryAddress, source);

  const deliveryService = extractDeliveryService(input.text);
  if (deliveryService) upsertMemoryFact(chatId, 'deliveryService', deliveryService, source);

  const pickupPoint = extractPickupPoint(input.text);
  if (pickupPoint) upsertMemoryFact(chatId, 'pickupPoint', pickupPoint, source);

  const lastProduct = extractLastProduct(input.text);
  if (lastProduct) upsertMemoryFact(chatId, 'lastProduct', lastProduct, source);

  const slotContextText = [lastProduct, memoryStore.facts[chatId]?.lastProduct?.value, memoryStore.facts[chatId]?.interest?.value, input.text].filter(Boolean).join(' ');
  if (detectShoeContextFromText(slotContextText)) {
    upsertMemoryFact(chatId, 'shoeContext', 'true', source);
  }

  if (input.hasMedia || input.hasLinkInput) {
    upsertMemoryFact(chatId, 'interest', getMemoryMessageText(input), source);
    upsertMemoryFact(chatId, 'lastProduct', getMemoryMessageText(input), source);
  }

  const stage = inferConversationStage(input);
  if (stage) setConversationStage(chatId, stage, source);

  if (isPaymentIntentText(input.text)) {
    safeCustomerStoreCall('customer.order.payment_requested', (store) => store.upsertOrder(chatId, {
      product: lastProduct || (memoryStore.facts[chatId]?.lastProduct?.value || memoryStore.facts[chatId]?.interest?.value || ''),
      size: size || memoryStore.facts[chatId]?.size?.value || memoryStore.facts[chatId]?.shoeSize?.value || '',
      fullName: fullName || memoryStore.facts[chatId]?.fullName?.value || '',
      phone: phone || memoryStore.facts[chatId]?.phone?.value || '',
      deliveryAddress: pickupPoint || deliveryAddress || memoryStore.facts[chatId]?.pickupPoint?.value || memoryStore.facts[chatId]?.deliveryAddress?.value || '',
      status: 'waiting_payment',
      paymentStatus: 'payment_details_sent',
    }));
  }

  if (stage === 'ready_to_buy' || stage === 'collecting_order_info') {
    safeCustomerStoreCall('customer.order.draft', (store) => store.upsertOrder(chatId, {
      product: lastProduct || (memoryStore.facts[chatId]?.lastProduct?.value || memoryStore.facts[chatId]?.interest?.value || ''),
      size: size || memoryStore.facts[chatId]?.size?.value || memoryStore.facts[chatId]?.shoeSize?.value || '',
      fullName: fullName || memoryStore.facts[chatId]?.fullName?.value || '',
      phone: phone || memoryStore.facts[chatId]?.phone?.value || '',
      deliveryAddress: pickupPoint || deliveryAddress || memoryStore.facts[chatId]?.pickupPoint?.value || memoryStore.facts[chatId]?.deliveryAddress?.value || '',
      status: stage === 'ready_to_buy' ? 'draft' : 'collecting_info',
    }));
  }

  persistMemoryStore();
}

function applyManagerStageHints(input) {
  const text = String(input?.text || '');
  const chatId = getMemoryChatId(input?.chatId || input);
  if (!chatId || !text) return;

  if (/(передал[аи]?\s+в\s+доставк|передан[ао]?\s+в\s+доставк|отправил[аи]?\b|отправлен[ао]?\b|трек|накладн|номер\s+отправлени)/i.test(text)) {
    setConversationStage(chatId, 'delivery', text);
    safeCustomerStoreCall('customer.order.delivery', (store) => store.upsertOrder(chatId, {
      status: 'delivery',
    }));
  }
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

function selectRecentDialogTurns(messages = [], limit = MEMORY_RECENT_LIMIT) {
  const items = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const maxTurns = getConfigMemoryLimit({ memory_recent_limit: limit });
  let turns = 0;
  let insideClientBlock = false;
  let startIndex = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const role = items[index]?.role;
    if (role === 'user') {
      if (!insideClientBlock) {
        turns += 1;
        insideClientBlock = true;
        if (turns > maxTurns) {
          startIndex = index + 1;
          break;
        }
      }
    } else {
      insideClientBlock = false;
    }
  }

  return items.slice(startIndex);
}

function formatMemoryFacts(facts = {}) {
  const labels = {
    name: 'Имя',
    fullName: 'ФИО',
    phone: 'Телефон',
    city: 'Город',
    size: 'Размер',
    address: 'Адрес доставки',
    deliveryAddress: 'Адрес доставки',
    shoeSize: 'Размер обуви',
    insoleCm: 'Стелька, см',
    deliveryService: 'Служба доставки',
    pickupPoint: 'ПВЗ',
    interest: 'Интерес клиента',
    lastProduct: 'Последний товар',
  };
  return Object.entries(labels)
    .filter(([key]) => facts[key]?.value)
    .map(([key, label]) => `${label}: ${facts[key].value}`);
}

function buildMemoryContext(chatId, options = {}) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return { summary: '', history: [], facts: {}, state: null };

  const dbContext = safeCustomerStoreCall('customer.context.get', (store) => store.getCustomerContext(cleanChatId, {
    limit: options.limit || MEMORY_RECENT_LIMIT,
    excludeTraceIds: options.excludeTraceIds || [],
  }));
  if (dbContext) {
    const slotSnapshot = buildSlotSnapshot(cleanChatId, options.currentInput || null);
    const slotSummary = buildSlotSummary(slotSnapshot);
    return {
      ...dbContext,
      summary: [dbContext.summary, slotSummary].filter(Boolean).join('\n\n'),
      slotSnapshot,
    };
  }

  const facts = memoryStore.facts[cleanChatId] || {};
  const state = memoryStore.states[cleanChatId] || null;
  const factLines = formatMemoryFacts(facts);

  const baseSummary = factLines.length
    ? [
      'Память клиента:',
      ...factLines.map((line) => `- ${line}`),
    ].filter(Boolean).join('\n')
    : '';

  let usedChars = 0;
  const history = [];
  const dialogHistory = selectRecentDialogTurns(
    getRecentMemoryMessages(
      cleanChatId,
      Math.min(100, (options.limit || MEMORY_RECENT_LIMIT) * 6),
      options.excludeTraceIds || [],
    ),
    options.limit || MEMORY_RECENT_LIMIT,
  );

  dialogHistory.reverse().forEach((message) => {
    const text = normalizeMemoryText(message.text);
    if (!text || usedChars + text.length > MEMORY_HISTORY_CHAR_LIMIT) return;
    usedChars += text.length;
    const content = message.role === 'manager'
      ? `Менеджер: ${text}`
      : text;
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      createdAt: message.createdAt,
      type: message.type,
    });
  });

  const slotSnapshot = buildSlotSnapshot(cleanChatId, options.currentInput || null);
  const slotSummary = buildSlotSummary(slotSnapshot);

  return {
    summary: [baseSummary, slotSummary].filter(Boolean).join('\n\n'),
    history: history.reverse(),
    facts,
    state,
    slotSnapshot,
  };
}

function buildBatchText(inputs) {
  const orderedInputs = [...inputs].sort((left, right) => {
    const leftStructured = looksLikeStructuredOrderPayload(left.text);
    const rightStructured = looksLikeStructuredOrderPayload(right.text);
    if (leftStructured !== rightStructured) return leftStructured ? -1 : 1;
    const leftSizeOnly = isSizeOnlyFollowupMessage(left.text);
    const rightSizeOnly = isSizeOnlyFollowupMessage(right.text);
    if (leftSizeOnly !== rightSizeOnly) return leftSizeOnly ? 1 : -1;
    return 0;
  });

  const items = orderedInputs
    .map((input) => getMemoryMessageText(input))
    .filter(Boolean);

  if (!items.length) return '';
  if (items.length === 1) return items[0];

  return items.join('\n\n');
}

function looksLikeStructuredOrderPayload(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  let score = 0;
  if (/(хочу заказать|оформить заказ|заказ[:\s])/i.test(source)) score += 2;
  if (/\n/.test(source)) score += 1;
  if (/(товар|модель|кроссовки|пара|цена|стоимость|артикул|цвет|размер|количество)\s*[:\-]/i.test(source)) score += 1;
  if (/цена\s*[:\-]?\s*\d{3,5}/i.test(source)) score += 1;
  return score >= 3;
}

function isFullNameOnlyText(text) {
  const source = String(text || '').trim();
  if (!source || source.length > 90) return false;
  if (/[?!:;@#/=]|\d/.test(source)) return false;
  if (/(достав|оплат|чек|товар|модель|размер|пвз|курьер|cdek|сд[эе]к|ozon|wb|яндекс|почт)/i.test(source)) return false;
  return /^[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2}$/.test(source);
}

function isCityOnlyText(text) {
  const source = normalizeMemoryText(text);
  if (!source || source.length > 60) return false;
  if (/[?!:;@#/=]|\d/.test(source)) return false;
  return /^(?:город\s+|г\.\s*|из\s+)?(?:москва|санкт[- ]петербург|спб|казань|сочи|краснодар|екатеринбург|новосибирск|ростов(?:-на-дону)?|самара|уфа|пермь|омск|челябинск|воронеж|нижний\s+новгород)$/i.test(source);
}

function isPickupPointText(text) {
  return /(?:пвз|пункт(?:е|а)?\s+выдач|cdek|сд[эе]к|ozon|озон|wb|wildberries|вайлдберр|яндекс|почт[ауы]|рядом\s+с\s+домом)/i.test(String(text || ''));
}

function isDeliveryTopicText(text) {
  return /(?:доставк|пвз|пункт(?:е|а)?\s+выдач|cdek|сд[эе]к|ozon|озон|wb|wildberries|вайлдберр|яндекс|почт[ауы]|курьер|по\s+москве|москва)/i.test(String(text || ''));
}

function isPaymentTopicText(text) {
  return isPaymentIntentText(text)
    || /(оплатил|оплатила|оплатили|перев[её]л|перевела|чек|квитанц|скрин.*оплат|receipt|payment)/i.test(String(text || ''));
}

function getSemanticMergeInfo(input = {}) {
  const text = String(input.text || '');
  const structuredOrder = looksLikeStructuredOrderPayload(text);
  const sizeOnly = isSizeOnlyFollowupMessage(text);
  const phone = !!extractPhone(text);
  const fullName = !!extractFullName(text) || isFullNameOnlyText(text);
  const city = !!extractCity(text) || isCityOnlyText(text);
  const pickup = isPickupPointText(text);
  const delivery = isDeliveryTopicText(text);
  const payment = isPaymentTopicText(text) || isPaymentProofInput(input);
  const returnTopic = /(возврат|вернуть|обмен|гарант)/i.test(text);
  const product = structuredOrder || !!extractLastProduct(text) || input.hasMedia || input.hasLinkInput;
  const contact = sizeOnly || phone || fullName || city || pickup;
  return {
    structuredOrder,
    sizeOnly,
    phone,
    fullName,
    city,
    pickup,
    delivery,
    payment,
    returnTopic,
    product,
    contact,
    hasMedia: !!input.hasMedia,
  };
}

function batchNeedsSemanticMerge(inputs = []) {
  if (!inputs.length) return false;
  const infos = inputs.map((input) => getSemanticMergeInfo(input));
  if (infos.some((info) => info.returnTopic)) return false;

  const checkoutPieces = infos.every((info) => (
    info.structuredOrder
    || info.sizeOnly
    || info.phone
    || info.fullName
    || info.city
    || info.pickup
    || info.product
  ));
  const hasCheckoutAnchor = infos.some((info) => info.structuredOrder || info.product || info.sizeOnly);
  const hasCheckoutDetail = infos.some((info) => info.phone || info.fullName || info.city || info.pickup || info.sizeOnly);
  if (checkoutPieces && hasCheckoutAnchor && hasCheckoutDetail) return true;

  const deliveryPieces = infos.every((info) => info.delivery || info.pickup || info.city);
  if (deliveryPieces && infos.some((info) => info.delivery || info.pickup)) return true;

  const paymentPieces = infos.every((info) => info.payment || info.hasMedia);
  if (paymentPieces && infos.some((info) => info.payment)) return true;

  return false;
}

function isSizeOnlyFollowupMessage(text) {
  const source = normalizeMemoryText(text);
  const size = extractShoeSize(source);
  if (!size || !source || source.length > 80) return false;
  if (containsLink(source)) return false;
  if (extractFullName(source) || extractPhone(source) || extractCity(source) || extractDeliveryAddress(source)) return false;
  const stripped = source.replace(size, '').trim();
  return !/(товар|модель|кроссовки|пара|цена|стоимость|артикул|фио|телефон|город|адрес|доставк|оплат|чек)/i.test(stripped);
}

function batchHasStructuredOrderPayload(inputs = []) {
  return inputs.some((input) => looksLikeStructuredOrderPayload(input.text));
}

function batchHasSizeOnlyFollowup(inputs = []) {
  return inputs.some((input) => isSizeOnlyFollowupMessage(input.text));
}

function batchHasPendingStructuredOrder(inputs = []) {
  return inputs.some((input) => looksLikeStructuredOrderPayload(input.text) && !extractShoeSize(input.text))
    && !batchHasSizeOnlyFollowup(inputs);
}

function batchNeedsPendingPayloadContext(inputs = []) {
  if (!inputs.length || batchHasStructuredOrderPayload(inputs) || batchHasPendingStructuredOrder(inputs)) return false;
  if (!batchHasSizeOnlyFollowup(inputs)) return false;
  const lastInput = inputs[inputs.length - 1];
  const profile = getCustomerProfileSnapshot(lastInput.chatId);
  return !(
    profile?.lastOrder?.product
    || profile?.facts?.lastProduct?.value
    || profile?.facts?.interest?.value
  );
}

function batchNeedsOrderContextMerge(inputs = []) {
  return batchHasPendingStructuredOrder(inputs)
    || (batchHasSizeOnlyFollowup(inputs) && !batchHasStructuredOrderPayload(inputs))
    || batchNeedsSemanticMerge(inputs);
}

function getBatchDebounceDelayMs(batch, input) {
  const baseDelay = getConfigBatchDebounceMs(input.config);
  const inputs = Array.isArray(batch?.inputs) ? batch.inputs : [input];
  if (batchHasPendingStructuredOrder(inputs)) {
    if (isSizeOnlyFollowupMessage(input.text)) {
      return Math.min(baseDelay, SIZE_ONLY_FOLLOWUP_DEBOUNCE_MS);
    }
    return Math.max(baseDelay, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsPendingPayloadContext(inputs)) {
    return Math.max(baseDelay, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseDelay, SEMANTIC_BATCH_DEBOUNCE_MS);
  }
  return baseDelay;
}

function getBatchMaxWindowMs(batch, input) {
  const baseWindow = Math.max(BATCH_MAX_WINDOW_MS, getConfigBatchDebounceMs(input.config) + 1000);
  const inputs = Array.isArray(batch?.inputs) ? batch.inputs : [input];
  if (inputs.length > 1 && batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseWindow, SEMANTIC_BATCH_MAX_WINDOW_MS);
  }
  if (batchHasPendingStructuredOrder(inputs) || batchNeedsPendingPayloadContext(inputs)) {
    return Math.max(baseWindow, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseWindow, SEMANTIC_BATCH_MAX_WINDOW_MS);
  }
  return baseWindow;
}

function scheduleBatchMaxTimer(key, batch, input) {
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  const maxWindowMs = getBatchMaxWindowMs(batch, input);
  const remainingMs = Math.max(0, maxWindowMs - (Date.now() - batch.startedAt));
  if (remainingMs === 0) {
    setImmediate(() => flushChatBatch(key));
    return;
  }
  batch.maxTimer = setTimeout(() => flushChatBatch(key), remainingMs);
}

function getBatchInputIdentity(input) {
  if (input?.traceId) return `trace:${input.traceId}`;
  if (input?.messageId) return `message:${input.updateType || ''}:${input.messageId}`;
  return `text:${input?.updateType || ''}:${normalizeMemoryText(input?.text || '')}`;
}

function mergeBatchInputs(inputs, extraInputs) {
  const seen = new Set();
  return [...inputs, ...extraInputs]
    .filter((input) => {
      const key = getBatchInputIdentity(input);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftTs = Number(left?.receivedAt || 0);
      const rightTs = Number(right?.receivedAt || 0);
      if (leftTs !== rightTs) return leftTs - rightTs;
      return Number(left?.messageId || 0) - Number(right?.messageId || 0);
    });
}

function peekPendingChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  return chatBatches.get(key) || null;
}

function takePendingChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch) return [];
  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);
  return Array.isArray(batch.inputs) ? batch.inputs : [];
}

function shouldMergePendingOrderInputs(currentInputs = [], pendingInputs = []) {
  if (!pendingInputs.length) return false;
  const pendingHasStructured = pendingInputs.some((input) => looksLikeStructuredOrderPayload(input.text));
  const pendingHasSizeOnly = pendingInputs.some((input) => isSizeOnlyFollowupMessage(input.text));
  if (batchHasPendingStructuredOrder(currentInputs)) return pendingHasStructured || pendingHasSizeOnly;
  if (batchHasSizeOnlyFollowup(currentInputs) && !batchHasStructuredOrderPayload(currentInputs)) return pendingHasStructured;
  if (batchNeedsPendingPayloadContext(currentInputs)) return pendingHasStructured || pendingHasSizeOnly;
  if (batchNeedsSemanticMerge(mergeBatchInputs(currentInputs, pendingInputs))) return true;
  return false;
}

function shouldSplitSemanticBatchForInput(batch, input) {
  const existingInputs = Array.isArray(batch?.inputs) ? batch.inputs : [];
  if (!existingInputs.length) return false;
  if (!batchNeedsSemanticMerge(existingInputs)) return false;
  const baseDelay = getConfigBatchDebounceMs(input.config);
  const elapsedSinceLastInput = Date.now() - Number(batch.lastInputAt || batch.startedAt || Date.now());
  if (elapsedSinceLastInput <= baseDelay) return false;
  return !batchNeedsSemanticMerge(mergeBatchInputs(existingInputs, [input]));
}

function buildRecentStructuredOrderContextInput(inputs = []) {
  if (!batchHasSizeOnlyFollowup(inputs) || batchHasStructuredOrderPayload(inputs)) return null;

  const lastInput = inputs[inputs.length - 1];
  const recentMessages = getRecentMemoryMessages(lastInput?.chatId, 12, inputs.map((input) => input.traceId));

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (!message) continue;
    if (message.role === 'manager') break;
    if (message.role === 'assistant') continue;
    if (message.role !== 'user' || !looksLikeStructuredOrderPayload(message.text)) continue;

    return {
      chatId: lastInput.chatId,
      userId: lastInput.userId,
      traceId: message.traceId || `memory:${message.telegramMessageId || message.createdAt || index}`,
      messageId: '',
      messageType: message.type || 'text',
      text: message.text,
      images: [],
      hasMedia: false,
      hasLinkInput: containsLink(message.text),
      updateType: lastInput.updateType,
      businessConnectionId: lastInput.businessConnectionId || '',
      receivedAt: Date.parse(message.createdAt || '') || 0,
      isContextOnly: true,
    };
  }

  return null;
}

async function absorbPendingOrderContextInputs(inputs = []) {
  let merged = mergeBatchInputs([], inputs);
  if (!batchNeedsOrderContextMerge(merged)) return merged;

  const chatId = merged[merged.length - 1]?.chatId || merged[0]?.chatId || '';
  const deadline = Date.now() + ORDER_CONTEXT_MERGE_GRACE_MS;

  while (Date.now() < deadline) {
    const pendingBatch = peekPendingChatBatch(chatId);
    const pendingInputs = Array.isArray(pendingBatch?.inputs) ? pendingBatch.inputs : [];
    if (shouldMergePendingOrderInputs(merged, pendingInputs)) {
      merged = mergeBatchInputs(merged, takePendingChatBatch(chatId));
      if (!batchNeedsOrderContextMerge(merged)) break;
      continue;
    }
    await wait(ORDER_CONTEXT_MERGE_POLL_MS);
  }

  const tailBatch = peekPendingChatBatch(chatId);
  const tailInputs = Array.isArray(tailBatch?.inputs) ? tailBatch.inputs : [];
  if (shouldMergePendingOrderInputs(merged, tailInputs)) {
    merged = mergeBatchInputs(merged, takePendingChatBatch(chatId));
  }

  const recentStructuredOrderInput = buildRecentStructuredOrderContextInput(merged);
  if (recentStructuredOrderInput) {
    merged = mergeBatchInputs([recentStructuredOrderInput], merged);
  }

  return merged;
}

function hasNewerClientFollowup(context) {
  const batchTraceIds = Array.isArray(context?.batchTraceIds) ? context.batchTraceIds.map(String) : [];
  if (!batchTraceIds.length) return false;
  const dialogState = getDialogState(context?.chatId || '');
  const lastClientTraceId = String(dialogState?.lastClientTraceId || '').trim();
  if (!lastClientTraceId) return false;
  return !batchTraceIds.includes(lastClientTraceId);
}

function isOrderLikeClientText(text) {
  const source = String(text || '');
  if (!source.trim()) return false;
  return looksLikeStructuredOrderPayload(source)
    || /(хочу\s+заказать|оформить\s+заказ|заказ)/i.test(source)
    || (extractShoeSize(source) && /(размер|беру|возьму|хочу|можно|оформ)/i.test(source))
    || !!extractLastProduct(source);
}

function batchHasOrderLikeContext(inputs = []) {
  return batchHasStructuredOrderPayload(inputs)
    || batchHasSizeOnlyFollowup(inputs)
    || batchNeedsSemanticMerge(inputs)
    || inputs.some((input) => isOrderLikeClientText(input.text));
}

function finalizeAiReply(input, reply) {
  return String(reply || '').trim();
}

async function waitForPendingOrderReplySettle(context) {
  if (!context?.pendingStructuredOrder) return true;
  const deadline = Date.now() + ORDER_PENDING_REPLY_SETTLE_MS;
  while (Date.now() < deadline) {
    if (hasNewerClientFollowup(context)) return false;
    await wait(Math.min(250, deadline - Date.now()));
  }
  return !hasNewerClientFollowup(context);
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
  const hasStructuredOrderPayload = batchHasStructuredOrderPayload(inputs);
  const hasSizeOnlyFollowup = batchHasSizeOnlyFollowup(inputs);

  return {
    ...lastInput,
    traceId: lastInput.traceId,
    messageType: messageTypes.length > 1 ? 'batch' : lastInput.messageType,
    batchSize: inputs.length,
    batchTraceIds: inputs.map((input) => input.traceId),
    batchMessageIds: inputs.map((input) => input.messageId).filter(Boolean),
    batchHasStructuredOrderPayload: hasStructuredOrderPayload,
    batchHasSizeOnlyFollowup: hasSizeOnlyFollowup,
    pendingStructuredOrder: batchHasPendingStructuredOrder(inputs),
    replyToMessageId: pickReplyTargetMessageId(inputs, lastInput.config),
    text: buildBatchText(inputs),
    images,
    hasMedia,
    hasLinkInput,
  };
}

async function processInputBatch(inputs) {
  if (!inputs.length) return;

  const preparedInputs = await absorbPendingOrderContextInputs(inputs);
  if (!preparedInputs.length) return;

  const batchInput = buildBatchInput(preparedInputs);
  batchInput.batchStartedAt = new Date().toISOString();
  try {
    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
      currentInput: batchInput,
    }) : { summary: '', history: [], facts: {}, state: null };


    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
      currentInput: batchInput,
    }) : { summary: '', history: [], facts: {}, state: null };

    preparedInputs.forEach((input) => logMessageDelivered(input));
    await waitAndMarkBatchRead(batchInput.config, preparedInputs);

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
        const finalReply = finalizeAiReply(batchInput, reply);
        if (!finalReply) return;
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
        const sent = await sendHumanizedTelegramReply(batchInput.config, batchInput, finalReply);
        if (!sent) {
          logEvent('MESSAGE_STATUS', {
            traceId: batchInput.traceId,
            userId: batchInput.userId,
            chatId: batchInput.chatId,
            updateType: batchInput.updateType || '',
            businessConnectionId: batchInput.businessConnectionId || '',
            messageType: batchInput.messageType,
            messageStatus: 'ai_reply_skipped_newer_client_input',
            status: 'ok',
          });
          return;
        }
        if (parseConfigBoolean(batchInput.config.memory_enabled, true)) {
          appendMemoryMessage(batchInput, 'assistant', finalReply);
        }
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
  if (batch && shouldSplitSemanticBatchForInput(batch, input)) {
    flushChatBatch(key);
    batch = null;
  }
  if (!batch) {
    batch = {
      inputs: [],
      startedAt: Date.now(),
      lastInputAt: 0,
      debounceTimer: null,
      maxTimer: null,
      processing: false,
    };
    chatBatches.set(key, batch);
  }

  batch.inputs.push(input);
  batch.lastInputAt = Date.now();
  scheduleBatchMaxTimer(key, batch, input);

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  batch.debounceTimer = setTimeout(() => flushChatBatch(key), getBatchDebounceDelayMs(batch, input));
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

  if (!webhookInfo) {
    return {
      status: 'error',
      label: 'Webhook с ошибкой',
    };
  }

  const lastErrorTs = Number(webhookInfo.last_error_date || 0) * 1000;
  const hasRecentWebhookError = Number.isFinite(lastErrorTs)
    && lastErrorTs > 0
    && (Date.now() - lastErrorTs) < WEBHOOK_ERROR_GRACE_MS;

  if (!webhookInfo.url && webhookInfo.last_error_message) {
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
      status: hasRecentWebhookError ? 'error' : 'warning',
      label: hasRecentWebhookError ? 'Webhook с ошибкой' : 'Есть pending updates',
    };
  }

  if (hasRecentWebhookError) {
    return {
      status: 'warning',
      label: 'Были недавние ошибки webhook',
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
    core_hot_lead_enabled: parseConfigBoolean(runtimeConfig.core_hot_lead_enabled, true),
    core_published_available_enabled: parseConfigBoolean(runtimeConfig.core_published_available_enabled, true),
    core_no_stock_check_enabled: parseConfigBoolean(runtimeConfig.core_no_stock_check_enabled, true),
    core_no_catalog_return_enabled: parseConfigBoolean(runtimeConfig.core_no_catalog_return_enabled, true),
    core_no_resell_enabled: parseConfigBoolean(runtimeConfig.core_no_resell_enabled, true),
    core_rules_text: runtimeConfig.core_rules_text,
    facts_no_invent_enabled: parseConfigBoolean(runtimeConfig.facts_no_invent_enabled, true),
    facts_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_payment_enabled, true),
    facts_no_fake_delivery_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_enabled, true),
    facts_no_fake_discounts_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_discounts_enabled, true),
    facts_no_final_payment_confirm_enabled: parseConfigBoolean(runtimeConfig.facts_no_final_payment_confirm_enabled, true),
    facts_no_fake_delivery_time_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_time_enabled, true),
    facts_rules_text: runtimeConfig.facts_rules_text,
    smalltalk_enabled: parseConfigBoolean(runtimeConfig.smalltalk_enabled, true),
    smalltalk_style_enabled: parseConfigBoolean(runtimeConfig.smalltalk_style_enabled, true),
    smalltalk_outfit_advice_enabled: parseConfigBoolean(runtimeConfig.smalltalk_outfit_advice_enabled, true),
    smalltalk_weather_enabled: parseConfigBoolean(runtimeConfig.smalltalk_weather_enabled, true),
    smalltalk_soft_product_link_enabled: parseConfigBoolean(runtimeConfig.smalltalk_soft_product_link_enabled, true),
    smalltalk_rules_text: runtimeConfig.smalltalk_rules_text,
    order_path_enabled: parseConfigBoolean(runtimeConfig.order_path_enabled, true),
    order_collect_size_enabled: parseConfigBoolean(runtimeConfig.order_collect_size_enabled, true),
    order_collect_insole_enabled: parseConfigBoolean(runtimeConfig.order_collect_insole_enabled, true),
    order_collect_full_name_enabled: parseConfigBoolean(runtimeConfig.order_collect_full_name_enabled, true),
    order_collect_phone_enabled: parseConfigBoolean(runtimeConfig.order_collect_phone_enabled, true),
    order_collect_city_enabled: parseConfigBoolean(runtimeConfig.order_collect_city_enabled, true),
    order_collect_delivery_service_enabled: parseConfigBoolean(runtimeConfig.order_collect_delivery_service_enabled, true),
    order_collect_pickup_enabled: parseConfigBoolean(runtimeConfig.order_collect_pickup_enabled, true),
    order_collect_payment_enabled: parseConfigBoolean(runtimeConfig.order_collect_payment_enabled, true),
    order_collect_receipt_enabled: parseConfigBoolean(runtimeConfig.order_collect_receipt_enabled, true),
    order_step_mode: runtimeConfig.order_step_mode,
    order_rules_text: runtimeConfig.order_rules_text,
    response_guard_enabled: parseConfigBoolean(runtimeConfig.response_guard_enabled, true),
    response_guard_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_fake_payment_enabled, true),
    response_guard_no_repeat_known_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_repeat_known_enabled, true),
    response_guard_human_tone_enabled: parseConfigBoolean(runtimeConfig.response_guard_human_tone_enabled, true),
    response_guard_next_step_enabled: parseConfigBoolean(runtimeConfig.response_guard_next_step_enabled, true),
    response_guard_no_final_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_final_payment_enabled, true),
    response_guard_rules_text: runtimeConfig.response_guard_rules_text,
    receipt_check_enabled: parseConfigBoolean(runtimeConfig.receipt_check_enabled, true),
    receipt_check_amount_enabled: parseConfigBoolean(runtimeConfig.receipt_check_amount_enabled, true),
    receipt_check_bank_enabled: parseConfigBoolean(runtimeConfig.receipt_check_bank_enabled, true),
    receipt_check_recipient_enabled: parseConfigBoolean(runtimeConfig.receipt_check_recipient_enabled, true),
    receipt_check_datetime_enabled: parseConfigBoolean(runtimeConfig.receipt_check_datetime_enabled, true),
    receipt_check_mismatch_enabled: parseConfigBoolean(runtimeConfig.receipt_check_mismatch_enabled, true),
    receipt_check_no_final_confirm_enabled: parseConfigBoolean(runtimeConfig.receipt_check_no_final_confirm_enabled, true),
    receipt_check_success_text: runtimeConfig.receipt_check_success_text,
    receipt_check_mismatch_text: runtimeConfig.receipt_check_mismatch_text,
    receipt_check_rules_text: runtimeConfig.receipt_check_rules_text,
    quality_replica_honesty_enabled: parseConfigBoolean(runtimeConfig.quality_replica_honesty_enabled, true),
    quality_no_original_claims_enabled: parseConfigBoolean(runtimeConfig.quality_no_original_claims_enabled, true),
    quality_calm_explanation_enabled: parseConfigBoolean(runtimeConfig.quality_calm_explanation_enabled, true),
    quality_rules_text: runtimeConfig.quality_rules_text,
    dialog_examples_enabled: parseConfigBoolean(runtimeConfig.dialog_examples_enabled, false),
    dialog_examples_text: runtimeConfig.dialog_examples_text,
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
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method,
    payment_card_number: runtimeConfig.payment_card_number,
    payment_recipient_name: runtimeConfig.payment_recipient_name,
    payment_bank: runtimeConfig.payment_bank,
    payment_comment: runtimeConfig.payment_comment,
    delivery_rules_enabled: parseConfigBoolean(runtimeConfig.delivery_rules_enabled, true),
    delivery_rules_text: runtimeConfig.delivery_rules_text,
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
    if (Object.keys(persisted).some((key) => !allowedKeys.includes(key))) {
      shouldRewrite = true;
    }
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

    const normalizedInstruction = normalizeInstructionConfigValue(runtimeConfig.instruction);
    if (normalizedInstruction !== runtimeConfig.instruction) {
      runtimeConfig.instruction = normalizedInstruction;
      shouldRewrite = true;
    }

    [
      ['conversation_mode', 'retail'],
    ].forEach(([key, nextValue]) => {
      if (runtimeConfig[key] !== nextValue) {
        runtimeConfig[key] = nextValue;
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

function applyBooleanConfig(body, key, envKey, fallback = true) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return;
  runtimeConfig[key] = parseConfigBoolean(body[key], fallback);
  process.env[envKey] = String(runtimeConfig[key]);
}

function applyStringConfig(body, key, envKey, fallback = '') {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return;
  runtimeConfig[key] = String(body[key] || fallback);
  process.env[envKey] = runtimeConfig[key];
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
    runtimeConfig.instruction = normalizeInstructionConfigValue(body.instruction || '');
    process.env.INSTRUCTION = runtimeConfig.instruction;
  }

  [
    ['core_hot_lead_enabled', 'CORE_HOT_LEAD_ENABLED'],
    ['core_published_available_enabled', 'CORE_PUBLISHED_AVAILABLE_ENABLED'],
    ['core_no_stock_check_enabled', 'CORE_NO_STOCK_CHECK_ENABLED'],
    ['core_no_catalog_return_enabled', 'CORE_NO_CATALOG_RETURN_ENABLED'],
    ['core_no_resell_enabled', 'CORE_NO_RESELL_ENABLED'],
    ['facts_no_invent_enabled', 'FACTS_NO_INVENT_ENABLED'],
    ['facts_no_fake_payment_enabled', 'FACTS_NO_FAKE_PAYMENT_ENABLED'],
    ['facts_no_fake_delivery_enabled', 'FACTS_NO_FAKE_DELIVERY_ENABLED'],
    ['facts_no_fake_discounts_enabled', 'FACTS_NO_FAKE_DISCOUNTS_ENABLED'],
    ['facts_no_final_payment_confirm_enabled', 'FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED'],
    ['facts_no_fake_delivery_time_enabled', 'FACTS_NO_FAKE_DELIVERY_TIME_ENABLED'],
    ['smalltalk_enabled', 'SMALLTALK_ENABLED'],
    ['smalltalk_style_enabled', 'SMALLTALK_STYLE_ENABLED'],
    ['smalltalk_outfit_advice_enabled', 'SMALLTALK_OUTFIT_ADVICE_ENABLED'],
    ['smalltalk_weather_enabled', 'SMALLTALK_WEATHER_ENABLED'],
    ['smalltalk_soft_product_link_enabled', 'SMALLTALK_SOFT_PRODUCT_LINK_ENABLED'],
    ['order_path_enabled', 'ORDER_PATH_ENABLED'],
    ['order_collect_size_enabled', 'ORDER_COLLECT_SIZE_ENABLED'],
    ['order_collect_insole_enabled', 'ORDER_COLLECT_INSOLE_ENABLED'],
    ['order_collect_full_name_enabled', 'ORDER_COLLECT_FULL_NAME_ENABLED'],
    ['order_collect_phone_enabled', 'ORDER_COLLECT_PHONE_ENABLED'],
    ['order_collect_city_enabled', 'ORDER_COLLECT_CITY_ENABLED'],
    ['order_collect_delivery_service_enabled', 'ORDER_COLLECT_DELIVERY_SERVICE_ENABLED'],
    ['order_collect_pickup_enabled', 'ORDER_COLLECT_PICKUP_ENABLED'],
    ['order_collect_payment_enabled', 'ORDER_COLLECT_PAYMENT_ENABLED'],
    ['order_collect_receipt_enabled', 'ORDER_COLLECT_RECEIPT_ENABLED'],
    ['response_guard_enabled', 'RESPONSE_GUARD_ENABLED'],
    ['response_guard_no_fake_payment_enabled', 'RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED'],
    ['response_guard_no_repeat_known_enabled', 'RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED'],
    ['response_guard_human_tone_enabled', 'RESPONSE_GUARD_HUMAN_TONE_ENABLED'],
    ['response_guard_next_step_enabled', 'RESPONSE_GUARD_NEXT_STEP_ENABLED'],
    ['response_guard_no_final_payment_enabled', 'RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED'],
    ['receipt_check_enabled', 'RECEIPT_CHECK_ENABLED'],
    ['receipt_check_amount_enabled', 'RECEIPT_CHECK_AMOUNT_ENABLED'],
    ['receipt_check_bank_enabled', 'RECEIPT_CHECK_BANK_ENABLED'],
    ['receipt_check_recipient_enabled', 'RECEIPT_CHECK_RECIPIENT_ENABLED'],
    ['receipt_check_datetime_enabled', 'RECEIPT_CHECK_DATETIME_ENABLED'],
    ['receipt_check_mismatch_enabled', 'RECEIPT_CHECK_MISMATCH_ENABLED'],
    ['receipt_check_no_final_confirm_enabled', 'RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED'],
    ['quality_replica_honesty_enabled', 'QUALITY_REPLICA_HONESTY_ENABLED'],
    ['quality_no_original_claims_enabled', 'QUALITY_NO_ORIGINAL_CLAIMS_ENABLED'],
    ['quality_calm_explanation_enabled', 'QUALITY_CALM_EXPLANATION_ENABLED'],
  ].forEach(([key, envKey]) => applyBooleanConfig(body, key, envKey, true));

  [
    ['core_rules_text', 'CORE_RULES_TEXT'],
    ['facts_rules_text', 'FACTS_RULES_TEXT'],
    ['smalltalk_rules_text', 'SMALLTALK_RULES_TEXT'],
    ['order_rules_text', 'ORDER_RULES_TEXT'],
    ['response_guard_rules_text', 'RESPONSE_GUARD_RULES_TEXT'],
    ['receipt_check_success_text', 'RECEIPT_CHECK_SUCCESS_TEXT'],
    ['receipt_check_mismatch_text', 'RECEIPT_CHECK_MISMATCH_TEXT'],
    ['receipt_check_rules_text', 'RECEIPT_CHECK_RULES_TEXT'],
    ['quality_rules_text', 'QUALITY_RULES_TEXT'],
  ].forEach(([key, envKey]) => applyStringConfig(body, key, envKey));

  applyBooleanConfig(body, 'dialog_examples_enabled', 'DIALOG_EXAMPLES_ENABLED', false);
  applyStringConfig(body, 'dialog_examples_text', 'DIALOG_EXAMPLES_TEXT');

  if (Object.prototype.hasOwnProperty.call(body, 'order_step_mode')) {
    runtimeConfig.order_step_mode = body.order_step_mode || 'natural';
    process.env.ORDER_STEP_MODE = runtimeConfig.order_step_mode;
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
    runtimeConfig.conversation_mode = body.conversation_mode || 'retail';
    process.env.CONVERSATION_MODE = runtimeConfig.conversation_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'media_behavior')) {
    runtimeConfig.media_behavior = body.media_behavior || 'answer_from_media';
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

  if (Object.prototype.hasOwnProperty.call(body, 'delivery_rules_enabled')) {
    runtimeConfig.delivery_rules_enabled = parseConfigBoolean(body.delivery_rules_enabled, true);
    process.env.DELIVERY_RULES_ENABLED = String(runtimeConfig.delivery_rules_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'delivery_rules_text')) {
    runtimeConfig.delivery_rules_text = String(body.delivery_rules_text || '');
    process.env.DELIVERY_RULES_TEXT = runtimeConfig.delivery_rules_text;
  }

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
    ? randomBetween(250, 800)
    : length <= 300
      ? randomBetween(500, 1400)
      : randomBetween(900, 2200);
  const baseDelay = Math.min(
    7000,
    Math.max(900, typingTime + thinkingTime + randomBetween(250, 900)),
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

function escapeTelegramHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatTelegramOutgoingText(text) {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

  if (!text && !images.length) {
    text = 'пользователь отправил сообщение без текста';
  }

  hasLinkInput = hasLinkInput || containsLink(text);

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

function getCreativityTemperature(creativity) {
  const map = {
    precise: 0.2,
    balanced: 0.5,
    creative: 0.8,
  };
  return map[creativity] ?? map.balanced;
}

function getToneGuidance(tone) {
  const map = {
    neutral: 'тон: нейтрально, ясно, без лишней эмоциональности',
    friendly: 'тон: дружелюбно, тепло, по-человечески',
    sales: 'тон: уверенно и закрывающе, но без давления',
    concise: 'тон: очень коротко и прямо',
  };
  return map[tone] || map.neutral;
}

function getResponseLengthGuidance(responseLength) {
  const map = {
    short: 'длина ответа: коротко, без простыней',
    medium: 'длина ответа: средне, только нужные детали',
    long: 'длина ответа: можно подробнее, если клиенту реально нужно объяснение',
  };
  return map[responseLength] || map.medium;
}

function getPersonaGuidance(config) {
  const styleMap = {
    calm: 'манера: спокойная',
    conversational: 'манера: разговорная',
    reserved: 'манера: сдержанная',
  };
  const age = String(config.persona_age || '').trim();
  return [styleMap[config.persona_style] || styleMap.calm, age && `возрастной ритм: примерно ${age}`]
    .filter(Boolean)
    .join(', ');
}

function getMediaBehaviorGuidance(mediaBehavior) {
  const map = {
    describe_media: 'медиа: если есть фото/скрин, сначала понять и описать, что на нём',
    answer_from_media: 'медиа: если есть фото/скрин, использовать его как главный контекст ответа',
    text_first: 'медиа: сначала опираться на текст клиента, фото/скрин использовать как дополнительный контекст',
  };
  return map[mediaBehavior] || map.answer_from_media;
}

function buildGuidanceSection(title, rows, freeText = '') {
  const body = rows.filter(Boolean);
  const text = String(freeText || '').trim();
  if (text) body.push(text);
  if (!body.length) return '';
  return [title, ...body.map((row) => `- ${row}`)].join('\n');
}

function getIwakCoreGuidance(config) {
  return buildGuidanceSection('Ядро IWAK:', [
    parseConfigBoolean(config.core_hot_lead_enabled, true)
      && 'Клиент из Telegram/сайта обычно уже тёплый и пришёл к покупке, поэтому не продавать с нуля.',
    parseConfigBoolean(config.core_published_available_enabled, true)
      && 'Опубликованный товар считается доступным к заказу.',
    parseConfigBoolean(config.core_no_stock_check_enabled, true)
      && 'Не проверять склад, остатки или базу товаров и не писать, что нужно уточнить наличие.',
    parseConfigBoolean(config.core_no_catalog_return_enabled, true)
      && 'Не возвращать клиента в каталог, если он уже прислал товар или размер.',
    parseConfigBoolean(config.core_no_resell_enabled, true)
      && 'Работать как closing-менеджер: принять заказ, уточнить недостающее, довести до оплаты и чека.',
  ], config.core_rules_text);
}

function getFactBoundaryGuidance(config) {
  return buildGuidanceSection('Границы фактов:', [
    parseConfigBoolean(config.facts_no_invent_enabled, true)
      && 'Свободно формулировать, но не выдумывать факты, цены, наличие, сроки, службы, реквизиты или скидки.',
    parseConfigBoolean(config.facts_no_fake_payment_enabled, true)
      && 'Реквизиты брать только из раздела Оплата. Если их нет, не придумывать.',
    parseConfigBoolean(config.facts_no_fake_delivery_enabled, true)
      && 'Условия доставки брать только из раздела Доставка.',
    parseConfigBoolean(config.facts_no_fake_discounts_enabled, true)
      && 'Если клиент просит скидку, не обещать её от себя: текущая цена финальная, акции бывают только если они явно указаны.',
    parseConfigBoolean(config.facts_no_final_payment_confirm_enabled, true)
      && 'После чека не подтверждать финально оплату: чек получен, дальше проверка вручную.',
    parseConfigBoolean(config.facts_no_fake_delivery_time_enabled, true)
      && 'Не обещать точные сроки отправки или доставки, если они не указаны в AI Control.',
  ], config.facts_rules_text);
}

function getSmalltalkGuidance(config) {
  if (!parseConfigBoolean(config.smalltalk_enabled, true)) return '';
  return buildGuidanceSection('Живость общения:', [
    'Можно отвечать живо, естественно и по-человечески, без канцелярита и ощущения анкеты.',
    parseConfigBoolean(config.smalltalk_style_enabled, true)
      && 'Можно поддержать лёгкий разговор, если клиент хочет поболтать.',
    parseConfigBoolean(config.smalltalk_outfit_advice_enabled, true)
      && 'Можно советовать, что надеть и с чем сочетать товары IWAK, не выдумывая конкретные остатки сверх присланного товара.',
    parseConfigBoolean(config.smalltalk_weather_enabled, true)
      && 'Если клиент спрашивает про погоду, можно ответить общими словами или честно сказать, что точной онлайн-погоды нет, если она не передана в диалог.',
    parseConfigBoolean(config.smalltalk_soft_product_link_enabled, true)
      && 'Если разговор уместно связан со стилем, можно мягко привязать его к товару IWAK без давления.',
  ], config.smalltalk_rules_text);
}

function getOrderPathGuidance(config) {
  if (!parseConfigBoolean(config.order_path_enabled, true)) return '';
  const stepMode = config.order_step_mode === 'single'
    ? 'Собирать данные максимально по одному шагу, чтобы клиенту было легко отвечать.'
    : 'Собирать данные естественно: не повторять уже полученное, можно объединять близкие вопросы в одно сообщение.';
  return buildGuidanceSection('Путь заказа:', [
    stepMode,
    parseConfigBoolean(config.order_collect_size_enabled, true)
      && 'Если размер уже указан, записать его и не спрашивать повторно.',
    parseConfigBoolean(config.order_collect_insole_enabled, true)
      && 'Для обуви уточнить длину стельки в сантиметрах, если её ещё нет.',
    parseConfigBoolean(config.order_collect_full_name_enabled, true)
      && 'Для оформления собрать ФИО получателя.',
    parseConfigBoolean(config.order_collect_phone_enabled, true)
      && 'Собрать телефон получателя для накладной и уведомлений доставки.',
    parseConfigBoolean(config.order_collect_city_enabled, true)
      && 'Собрать город доставки.',
    parseConfigBoolean(config.order_collect_delivery_service_enabled, true)
      && 'Уточнить удобную службу доставки из разрешённых в разделе Доставка.',
    parseConfigBoolean(config.order_collect_pickup_enabled, true)
      && 'Для ПВЗ собрать адрес/название пункта или ориентир; для курьера собрать адрес.',
    parseConfigBoolean(config.order_collect_payment_enabled, true)
      && 'Когда основные данные собраны, аккуратно отправить реквизиты из раздела Оплата.',
    parseConfigBoolean(config.order_collect_receipt_enabled, true)
      && 'После оплаты попросить чек или скрин и сверить видимые данные с заказом настолько, насколько возможно по сообщению/изображению.',
  ], config.order_rules_text);
}

function getResponseGuardGuidance(config) {
  if (!parseConfigBoolean(config.response_guard_enabled, true)) return '';
  return buildGuidanceSection('Проверка ответа:', [
    'Перед финальным ответом клиенту молча проверь черновик по этим пунктам. Не показывай клиенту сам чек-лист.',
    parseConfigBoolean(config.response_guard_no_fake_payment_enabled, true)
      && 'Не выдуманы ли реквизиты, банк, получатель или способ оплаты.',
    parseConfigBoolean(config.response_guard_no_repeat_known_enabled, true)
      && 'Не спрашиваются ли повторно данные, которые уже есть в памяти, текущем сообщении или контексте заказа.',
    parseConfigBoolean(config.response_guard_human_tone_enabled, true)
      && 'Не звучит ли ответ как робот, анкета, CRM или сухой сценарий.',
    parseConfigBoolean(config.response_guard_next_step_enabled, true)
      && 'Есть ли в ответе понятный следующий шаг для клиента, если диалог ещё не завершён.',
    parseConfigBoolean(config.response_guard_no_final_payment_enabled, true)
      && 'Нет ли финального подтверждения оплаты, поступления денег или отправки без ручной проверки.',
  ], config.response_guard_rules_text);
}

function getReceiptCheckGuidance(config) {
  if (!parseConfigBoolean(config.receipt_check_enabled, true)) return '';
  return buildGuidanceSection('Проверка чека:', [
    'Если клиент прислал чек, квитанцию, скрин оплаты или фото оплаты, сначала извлеки видимые данные из изображения/текста и сравни с контекстом заказа.',
    parseConfigBoolean(config.receipt_check_amount_enabled, true)
      && 'Сверить сумму с ценой заказа, если сумма видна.',
    parseConfigBoolean(config.receipt_check_bank_enabled, true)
      && 'Сверить банк, если он виден и банк указан в разделе Оплата.',
    parseConfigBoolean(config.receipt_check_recipient_enabled, true)
      && 'Сверить получателя, карту или последние цифры реквизитов, если они видны.',
    parseConfigBoolean(config.receipt_check_datetime_enabled, true)
      && 'Посмотреть дату и время перевода, если они видны.',
    parseConfigBoolean(config.receipt_check_mismatch_enabled, true)
      && 'Если сумма, реквизиты, банк или получатель не сходятся, мягко попросить клиента проверить и прислать корректный чек, без обвинений.',
    parseConfigBoolean(config.receipt_check_no_final_confirm_enabled, true)
      && 'Даже если визуально всё выглядит нормально, не писать, что оплата подтверждена финально или деньги поступили. Финальная проверка вручную.',
    String(config.receipt_check_success_text || '').trim()
      && `Ориентир ответа, если видимых расхождений нет: ${String(config.receipt_check_success_text).trim()}`,
    String(config.receipt_check_mismatch_text || '').trim()
      && `Ориентир ответа, если есть расхождение: ${String(config.receipt_check_mismatch_text).trim()}`,
  ], config.receipt_check_rules_text);
}

function getQualityGuidance(config) {
  return buildGuidanceSection('Товар и качество:', [
    parseConfigBoolean(config.quality_replica_honesty_enabled, true)
      && 'Если клиент спрашивает про оригинальность, честно говорить: это хорошая фабричная реплика.',
    parseConfigBoolean(config.quality_no_original_claims_enabled, true)
      && 'Не использовать слово "оригинал" и не создавать впечатление оригинала, если товар не оригинальный.',
    parseConfigBoolean(config.quality_calm_explanation_enabled, true)
      && 'Объяснять качество спокойно, уверенно и без оправданий.',
  ], config.quality_rules_text);
}

function getDialogExamplesGuidance(config) {
  if (!parseConfigBoolean(config.dialog_examples_enabled, false)) return '';
  const text = String(config.dialog_examples_text || '').trim();
  if (!text) return '';
  return ['Примеры диалогов для стиля. Не копировать дословно, использовать как ориентир:', text].join('\n');
}

function getVisiblePaymentGuidance(config) {
  if (!parseConfigBoolean(config.payment_enabled, false)) {
    return 'Оплата в AI Control выключена: не отправляйте и не придумывайте реквизиты, номер карты/телефона, банк или получателя.';
  }

  const details = [
    `Способ оплаты: ${String(config.payment_method || 'card').trim()}`,
    String(config.payment_card_number || '').trim() && `Реквизиты: ${String(config.payment_card_number).trim()}`,
    String(config.payment_recipient_name || '').trim() && `Получатель: ${String(config.payment_recipient_name).trim()}`,
    String(config.payment_bank || '').trim() && `Банк: ${String(config.payment_bank).trim()}`,
    String(config.payment_comment || '').trim() && `Комментарий клиенту: ${String(config.payment_comment).trim()}`,
  ].filter(Boolean);

  if (details.length <= 1) {
    return 'Оплата в AI Control включена, но реквизиты не заполнены: не придумывайте реквизиты, попросите клиента подождать или уточнить их у менеджера.';
  }
  return [
    'Оплата в AI Control включена.',
    'Используйте только эти реквизиты. Не изменяйте и не придумывайте номер, банк или получателя.',
    ...details,
  ].join('\n');
}

function getVisibleDeliveryGuidance(config) {
  if (!parseConfigBoolean(config.delivery_rules_enabled, true)) {
    return 'Доставка в AI Control выключена: не придумывайте условия, службы, сроки или стоимость доставки.';
  }
  const text = String(config.delivery_rules_text || '').trim();
  if (!text) return 'Доставка в AI Control включена, но правила пустые: не придумывайте условия доставки.';
  return ['Доставка из AI Control:', text].join('\n');
}

function getVisibleControlState(config, memoryContext = null) {
  return {
    core: Boolean(getIwakCoreGuidance(config)),
    facts: Boolean(getFactBoundaryGuidance(config)),
    smalltalk: Boolean(getSmalltalkGuidance(config)),
    orderPath: Boolean(getOrderPathGuidance(config)),
    responseGuard: Boolean(getResponseGuardGuidance(config)),
    receiptCheck: Boolean(getReceiptCheckGuidance(config)),
    quality: Boolean(getQualityGuidance(config)),
    examples: Boolean(getDialogExamplesGuidance(config)),
    instruction: !!String(config.instruction || '').trim(),
    behavior: true,
    media: true,
    persona: true,
    memory: parseConfigBoolean(config.memory_enabled, true) && !!memoryContext?.summary,
    payment: parseConfigBoolean(config.payment_enabled, false),
    delivery: parseConfigBoolean(config.delivery_rules_enabled, true)
      && !!String(config.delivery_rules_text || '').trim(),
  };
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

function buildSystemPrompt(config, memoryContext = null) {
  const parts = [];
  const control = [
    'AI Control:',
    getToneGuidance(config.tone),
    getResponseLengthGuidance(config.response_length),
    getPersonaGuidance(config),
    getMediaBehaviorGuidance(config.media_behavior),
  ].filter(Boolean);

  [
    getIwakCoreGuidance(config),
    getFactBoundaryGuidance(config),
    getSmalltalkGuidance(config),
    getOrderPathGuidance(config),
    getResponseGuardGuidance(config),
    getReceiptCheckGuidance(config),
    getQualityGuidance(config),
  ].forEach((section) => {
    if (section) control.push(section);
  });

  if (String(config.instruction || '').trim()) {
    control.push('Инструкция:', String(config.instruction).trim());
  }

  const paymentGuidance = getVisiblePaymentGuidance(config);
  if (paymentGuidance) control.push(paymentGuidance);
  const deliveryGuidance = getVisibleDeliveryGuidance(config);
  if (deliveryGuidance) control.push(deliveryGuidance);
  const examplesGuidance = getDialogExamplesGuidance(config);
  if (examplesGuidance) control.push(examplesGuidance);
  parts.push(control.join('\n'));
  return parts.filter((part) => String(part || '').trim()).join('\n\n');
}

function buildAiControlPreview(config = runtimeConfig) {
  return {
    systemPrompt: buildSystemPrompt(config),
    appliedControls: getVisibleControlState(config),
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
  const systemPrompt = buildSystemPrompt(input.config, input.memoryContext);
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
      memoryStage: input.memoryContext?.state?.stage ? 'set' : '',
      memoryFacts: Object.keys(input.memoryContext?.facts || {}),
      closedSlots: input.memoryContext?.slotSnapshot?.closedSlots || [],
      nextBlockingSlot: input.memoryContext?.slotSnapshot?.nextBlockingSlot || '',
      shoeContext: !!input.memoryContext?.slotSnapshot?.shoeContext,
      appliedControls: getVisibleControlState(input.config, input.memoryContext),
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
  const outgoingText = formatTelegramOutgoingText(text);
  const htmlText = escapeTelegramHtml(outgoingText);

  try {
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      text: outgoingText,
      status: 'process',
    });
    const payload = {
      chat_id: context.chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (context.businessConnectionId) {
      payload.business_connection_id = context.businessConnectionId;
    }
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    const response = await httpClient.post(getTelegramApiUrl(config, 'sendMessage'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const result = response.data?.result || null;
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      telegramMessageId: result?.message_id || '',
      duration: Date.now() - startedAt,
      status: 'ok',
    });
    return result;
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

      return sendTelegramMessage(config, { ...context, useReply: false }, text);
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
  return null;
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
  const settled = await waitForPendingOrderReplySettle(context);
  if (!settled) return false;
  const parts = splitReplyForTelegram(reply);
  for (let index = 0; index < parts.length; index += 1) {
    if (hasNewerClientFollowup(context)) return false;
    await sendTelegramChatAction(config, context, 'typing');
    await wait(getHumanTypingDelayMs(parts[index], config));
    if (hasNewerClientFollowup(context)) return false;
    await sendTelegramMessage(config, {
      ...context,
      useReply: index === 0 && !!context.replyToMessageId,
    }, parts[index]);
    if (index < parts.length - 1) {
      await wait(randomBetween(700, 1500));
    }
  }
  return true;
}

function isTruthyStatus(value, patterns) {
  const normalized = String(value || '').trim().toLowerCase();
  return !!normalized && patterns.some((pattern) => pattern.test(normalized));
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
  const aiControlPreview = buildAiControlPreview(runtimeConfig);
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
    core_hot_lead_enabled: parseConfigBoolean(runtimeConfig.core_hot_lead_enabled, true),
    core_published_available_enabled: parseConfigBoolean(runtimeConfig.core_published_available_enabled, true),
    core_no_stock_check_enabled: parseConfigBoolean(runtimeConfig.core_no_stock_check_enabled, true),
    core_no_catalog_return_enabled: parseConfigBoolean(runtimeConfig.core_no_catalog_return_enabled, true),
    core_no_resell_enabled: parseConfigBoolean(runtimeConfig.core_no_resell_enabled, true),
    core_rules_text: runtimeConfig.core_rules_text || '',
    facts_no_invent_enabled: parseConfigBoolean(runtimeConfig.facts_no_invent_enabled, true),
    facts_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_payment_enabled, true),
    facts_no_fake_delivery_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_enabled, true),
    facts_no_fake_discounts_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_discounts_enabled, true),
    facts_no_final_payment_confirm_enabled: parseConfigBoolean(runtimeConfig.facts_no_final_payment_confirm_enabled, true),
    facts_no_fake_delivery_time_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_time_enabled, true),
    facts_rules_text: runtimeConfig.facts_rules_text || '',
    smalltalk_enabled: parseConfigBoolean(runtimeConfig.smalltalk_enabled, true),
    smalltalk_style_enabled: parseConfigBoolean(runtimeConfig.smalltalk_style_enabled, true),
    smalltalk_outfit_advice_enabled: parseConfigBoolean(runtimeConfig.smalltalk_outfit_advice_enabled, true),
    smalltalk_weather_enabled: parseConfigBoolean(runtimeConfig.smalltalk_weather_enabled, true),
    smalltalk_soft_product_link_enabled: parseConfigBoolean(runtimeConfig.smalltalk_soft_product_link_enabled, true),
    smalltalk_rules_text: runtimeConfig.smalltalk_rules_text || '',
    order_path_enabled: parseConfigBoolean(runtimeConfig.order_path_enabled, true),
    order_collect_size_enabled: parseConfigBoolean(runtimeConfig.order_collect_size_enabled, true),
    order_collect_insole_enabled: parseConfigBoolean(runtimeConfig.order_collect_insole_enabled, true),
    order_collect_full_name_enabled: parseConfigBoolean(runtimeConfig.order_collect_full_name_enabled, true),
    order_collect_phone_enabled: parseConfigBoolean(runtimeConfig.order_collect_phone_enabled, true),
    order_collect_city_enabled: parseConfigBoolean(runtimeConfig.order_collect_city_enabled, true),
    order_collect_delivery_service_enabled: parseConfigBoolean(runtimeConfig.order_collect_delivery_service_enabled, true),
    order_collect_pickup_enabled: parseConfigBoolean(runtimeConfig.order_collect_pickup_enabled, true),
    order_collect_payment_enabled: parseConfigBoolean(runtimeConfig.order_collect_payment_enabled, true),
    order_collect_receipt_enabled: parseConfigBoolean(runtimeConfig.order_collect_receipt_enabled, true),
    order_step_mode: runtimeConfig.order_step_mode || 'natural',
    order_rules_text: runtimeConfig.order_rules_text || '',
    response_guard_enabled: parseConfigBoolean(runtimeConfig.response_guard_enabled, true),
    response_guard_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_fake_payment_enabled, true),
    response_guard_no_repeat_known_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_repeat_known_enabled, true),
    response_guard_human_tone_enabled: parseConfigBoolean(runtimeConfig.response_guard_human_tone_enabled, true),
    response_guard_next_step_enabled: parseConfigBoolean(runtimeConfig.response_guard_next_step_enabled, true),
    response_guard_no_final_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_final_payment_enabled, true),
    response_guard_rules_text: runtimeConfig.response_guard_rules_text || '',
    receipt_check_enabled: parseConfigBoolean(runtimeConfig.receipt_check_enabled, true),
    receipt_check_amount_enabled: parseConfigBoolean(runtimeConfig.receipt_check_amount_enabled, true),
    receipt_check_bank_enabled: parseConfigBoolean(runtimeConfig.receipt_check_bank_enabled, true),
    receipt_check_recipient_enabled: parseConfigBoolean(runtimeConfig.receipt_check_recipient_enabled, true),
    receipt_check_datetime_enabled: parseConfigBoolean(runtimeConfig.receipt_check_datetime_enabled, true),
    receipt_check_mismatch_enabled: parseConfigBoolean(runtimeConfig.receipt_check_mismatch_enabled, true),
    receipt_check_no_final_confirm_enabled: parseConfigBoolean(runtimeConfig.receipt_check_no_final_confirm_enabled, true),
    receipt_check_success_text: runtimeConfig.receipt_check_success_text || '',
    receipt_check_mismatch_text: runtimeConfig.receipt_check_mismatch_text || '',
    receipt_check_rules_text: runtimeConfig.receipt_check_rules_text || '',
    quality_replica_honesty_enabled: parseConfigBoolean(runtimeConfig.quality_replica_honesty_enabled, true),
    quality_no_original_claims_enabled: parseConfigBoolean(runtimeConfig.quality_no_original_claims_enabled, true),
    quality_calm_explanation_enabled: parseConfigBoolean(runtimeConfig.quality_calm_explanation_enabled, true),
    quality_rules_text: runtimeConfig.quality_rules_text || '',
    dialog_examples_enabled: parseConfigBoolean(runtimeConfig.dialog_examples_enabled, false),
    dialog_examples_text: runtimeConfig.dialog_examples_text || '',
    tone: runtimeConfig.tone || 'neutral',
    response_length: runtimeConfig.response_length || 'medium',
    creativity: runtimeConfig.creativity || 'balanced',
    persona_style: runtimeConfig.persona_style || 'calm',
    persona_age: runtimeConfig.persona_age || '27',
    conversation_mode: runtimeConfig.conversation_mode || 'retail',
    media_behavior: runtimeConfig.media_behavior || 'answer_from_media',
    auto_reply_enabled: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
    memory_enabled: parseConfigBoolean(runtimeConfig.memory_enabled, true),
    memory_recent_limit: getConfigMemoryLimit(runtimeConfig),
    batch_debounce_ms: getConfigBatchDebounceMs(runtimeConfig),
    reply_mode: normalizeReplyMode(runtimeConfig.reply_mode),
    human_typing_mode: normalizeHumanTypingMode(runtimeConfig.human_typing_mode),
    manager_takeover_enabled: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
    manager_return_delay_ms: getConfigManagerReturnDelayMs(runtimeConfig),
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method || 'card',
    payment_card_number: runtimeConfig.payment_card_number || '',
    payment_recipient_name: runtimeConfig.payment_recipient_name || '',
    payment_bank: runtimeConfig.payment_bank || '',
    payment_comment: runtimeConfig.payment_comment || '',
    ai_control_context: aiControlPreview.systemPrompt,
    applied_controls: aiControlPreview.appliedControls,
    capabilities: getCapabilitySnapshot(runtimeConfig),
    delivery_rules_enabled: parseConfigBoolean(runtimeConfig.delivery_rules_enabled, true),
    delivery_rules_text: runtimeConfig.delivery_rules_text || '',
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
        last_error_date: response.data?.result?.last_error_date || 0,
        last_error_message: response.data?.result?.last_error_message || '',
      };
    } catch (e) {
      status.webhook = {
        url: '',
        pending_update_count: 0,
        last_error_date: Math.floor(Date.now() / 1000),
        last_error_message: e.response?.data?.description || e.message,
      };
    }
  } else {
    status.webhook = {
      url: runtimeConfig.webhook_url || '',
      pending_update_count: 0,
      last_error_date: 0,
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

app.get('/config/ai-control-preview', (req, res) => {
  res.json(buildAiControlPreview(getRuntimeSnapshot()));
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
  const chatId = getMemoryChatId(req.body.chatId || 'test') || 'test';
  const userId = getMemoryChatId(req.body.userId || chatId) || chatId;
  const images = Array.isArray(req.body.images)
    ? req.body.images.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const messageType = String(req.body.messageType || (images.length ? 'photo' : 'test')).trim() || 'test';
  const traceId = createTraceId();

  if (!text && !images.length) {
    res.json({ ok: false, reply: '', error: 'Message is required' });
    return;
  }

  const input = {
    traceId,
    chatId,
    userId,
    messageType,
    text,
    images,
    hasMedia: images.length > 0,
    hasLinkInput: /https?:\/\//i.test(text),
    config,
  };

  logEvent('IN', {
    traceId,
    status: 'ok',
    scope: 'test.ai',
    userId,
    chatId,
    firstName: 'Test',
    username: 'test_user',
    messageType,
    text,
    images: images.length,
    hasMedia: images.length > 0,
  });

  if (parseConfigBoolean(config.memory_enabled, true)) {
    updateCustomerMemoryFromInput(input);
    appendMemoryMessage(input, 'user', getMemoryMessageText(input));
  }

  input.memoryContext = parseConfigBoolean(config.memory_enabled, true)
    ? buildMemoryContext(chatId, {
      limit: getConfigMemoryLimit(config),
      excludeTraceIds: [traceId],
      currentInput: input,
    })
    : { summary: '', history: [], facts: {}, state: null };


  input.memoryContext = parseConfigBoolean(config.memory_enabled, true)
    ? buildMemoryContext(chatId, {
      limit: getConfigMemoryLimit(config),
      excludeTraceIds: [traceId],
      currentInput: input,
    })
    : { summary: '', history: [], facts: {}, state: null };

  const reply = await requestAi(input);

  if (typeof reply !== 'string') {
    res.json({ ok: false, reply: '', error: 'AI did not return a reply' });
    return;
  }

  const finalReply = finalizeAiReply(input, reply);
  if (!finalReply) {
    res.json({ ok: false, reply: '', error: 'AI returned empty reply after normalization' });
    return;
  }

  if (parseConfigBoolean(config.memory_enabled, true)) {
    appendMemoryMessage({
      chatId,
      traceId,
      text: finalReply,
    }, 'assistant', finalReply);
  }

  res.json({ ok: true, reply: finalReply });
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
  runtimeConfig.core_hot_lead_enabled = true;
  runtimeConfig.core_published_available_enabled = true;
  runtimeConfig.core_no_stock_check_enabled = true;
  runtimeConfig.core_no_catalog_return_enabled = true;
  runtimeConfig.core_no_resell_enabled = true;
  runtimeConfig.core_rules_text = '';
  runtimeConfig.facts_no_invent_enabled = true;
  runtimeConfig.facts_no_fake_payment_enabled = true;
  runtimeConfig.facts_no_fake_delivery_enabled = true;
  runtimeConfig.facts_no_fake_discounts_enabled = true;
  runtimeConfig.facts_no_final_payment_confirm_enabled = true;
  runtimeConfig.facts_no_fake_delivery_time_enabled = true;
  runtimeConfig.facts_rules_text = '';
  runtimeConfig.smalltalk_enabled = true;
  runtimeConfig.smalltalk_style_enabled = true;
  runtimeConfig.smalltalk_outfit_advice_enabled = true;
  runtimeConfig.smalltalk_weather_enabled = true;
  runtimeConfig.smalltalk_soft_product_link_enabled = true;
  runtimeConfig.smalltalk_rules_text = '';
  runtimeConfig.order_path_enabled = true;
  runtimeConfig.order_collect_size_enabled = true;
  runtimeConfig.order_collect_insole_enabled = true;
  runtimeConfig.order_collect_full_name_enabled = true;
  runtimeConfig.order_collect_phone_enabled = true;
  runtimeConfig.order_collect_city_enabled = true;
  runtimeConfig.order_collect_delivery_service_enabled = true;
  runtimeConfig.order_collect_pickup_enabled = true;
  runtimeConfig.order_collect_payment_enabled = true;
  runtimeConfig.order_collect_receipt_enabled = true;
  runtimeConfig.order_step_mode = 'natural';
  runtimeConfig.order_rules_text = '';
  runtimeConfig.response_guard_enabled = true;
  runtimeConfig.response_guard_no_fake_payment_enabled = true;
  runtimeConfig.response_guard_no_repeat_known_enabled = true;
  runtimeConfig.response_guard_human_tone_enabled = true;
  runtimeConfig.response_guard_next_step_enabled = true;
  runtimeConfig.response_guard_no_final_payment_enabled = true;
  runtimeConfig.response_guard_rules_text = '';
  runtimeConfig.receipt_check_enabled = true;
  runtimeConfig.receipt_check_amount_enabled = true;
  runtimeConfig.receipt_check_bank_enabled = true;
  runtimeConfig.receipt_check_recipient_enabled = true;
  runtimeConfig.receipt_check_datetime_enabled = true;
  runtimeConfig.receipt_check_mismatch_enabled = true;
  runtimeConfig.receipt_check_no_final_confirm_enabled = true;
  runtimeConfig.receipt_check_success_text = 'Чек получил, спасибо. Статус доставки сможете отслеживать в приложении выбранной службы доставки. Если будут вопросы — напишите.';
  runtimeConfig.receipt_check_mismatch_text = 'Чек получил, но вижу расхождение с заказом. Проверьте, пожалуйста, сумму или реквизиты и пришлите корректный чек.';
  runtimeConfig.receipt_check_rules_text = '';
  runtimeConfig.quality_replica_honesty_enabled = true;
  runtimeConfig.quality_no_original_claims_enabled = true;
  runtimeConfig.quality_calm_explanation_enabled = true;
  runtimeConfig.quality_rules_text = '';
  runtimeConfig.dialog_examples_enabled = false;
  runtimeConfig.dialog_examples_text = '';
  runtimeConfig.tone = 'neutral';
  runtimeConfig.response_length = 'medium';
  runtimeConfig.creativity = 'balanced';
  runtimeConfig.persona_style = 'calm';
  runtimeConfig.persona_age = '27';
  runtimeConfig.conversation_mode = 'retail';
  runtimeConfig.media_behavior = 'answer_from_media';
  runtimeConfig.auto_reply_enabled = true;
  runtimeConfig.memory_enabled = false;
  runtimeConfig.memory_recent_limit = MEMORY_RECENT_LIMIT;
  runtimeConfig.batch_debounce_ms = BATCH_DEBOUNCE_MS;
  runtimeConfig.reply_mode = 'smart';
  runtimeConfig.human_typing_mode = 'natural';
  runtimeConfig.manager_takeover_enabled = true;
  runtimeConfig.manager_return_delay_ms = MANAGER_RETURN_DELAY_MS;
  runtimeConfig.payment_enabled = false;
  runtimeConfig.payment_method = 'card';
  runtimeConfig.payment_card_number = '';
  runtimeConfig.payment_recipient_name = '';
  runtimeConfig.payment_bank = '';
  runtimeConfig.payment_comment = '';
  runtimeConfig.delivery_rules_enabled = false;
  runtimeConfig.delivery_rules_text = '';
  runtimeConfig.webhook_url = '';

  process.env.TELEGRAM_TOKEN = '';
  process.env.AI_API_KEY = '';
  process.env.AI_BASE_URL = '';
  process.env.MODEL = '';
  process.env.STT_API_KEY = '';
  process.env.STT_BASE_URL = 'https://api.openai.com/v1';
  process.env.STT_MODEL = 'gpt-4o-mini-transcribe';
  process.env.INSTRUCTION = '';
  process.env.CORE_HOT_LEAD_ENABLED = 'true';
  process.env.CORE_PUBLISHED_AVAILABLE_ENABLED = 'true';
  process.env.CORE_NO_STOCK_CHECK_ENABLED = 'true';
  process.env.CORE_NO_CATALOG_RETURN_ENABLED = 'true';
  process.env.CORE_NO_RESELL_ENABLED = 'true';
  process.env.CORE_RULES_TEXT = '';
  process.env.FACTS_NO_INVENT_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_PAYMENT_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DELIVERY_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DISCOUNTS_ENABLED = 'true';
  process.env.FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DELIVERY_TIME_ENABLED = 'true';
  process.env.FACTS_RULES_TEXT = '';
  process.env.SMALLTALK_ENABLED = 'true';
  process.env.SMALLTALK_STYLE_ENABLED = 'true';
  process.env.SMALLTALK_OUTFIT_ADVICE_ENABLED = 'true';
  process.env.SMALLTALK_WEATHER_ENABLED = 'true';
  process.env.SMALLTALK_SOFT_PRODUCT_LINK_ENABLED = 'true';
  process.env.SMALLTALK_RULES_TEXT = '';
  process.env.ORDER_PATH_ENABLED = 'true';
  process.env.ORDER_COLLECT_SIZE_ENABLED = 'true';
  process.env.ORDER_COLLECT_INSOLE_ENABLED = 'true';
  process.env.ORDER_COLLECT_FULL_NAME_ENABLED = 'true';
  process.env.ORDER_COLLECT_PHONE_ENABLED = 'true';
  process.env.ORDER_COLLECT_CITY_ENABLED = 'true';
  process.env.ORDER_COLLECT_DELIVERY_SERVICE_ENABLED = 'true';
  process.env.ORDER_COLLECT_PICKUP_ENABLED = 'true';
  process.env.ORDER_COLLECT_PAYMENT_ENABLED = 'true';
  process.env.ORDER_COLLECT_RECEIPT_ENABLED = 'true';
  process.env.ORDER_STEP_MODE = 'natural';
  process.env.ORDER_RULES_TEXT = '';
  process.env.RESPONSE_GUARD_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED = 'true';
  process.env.RESPONSE_GUARD_HUMAN_TONE_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NEXT_STEP_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED = 'true';
  process.env.RESPONSE_GUARD_RULES_TEXT = '';
  process.env.RECEIPT_CHECK_ENABLED = 'true';
  process.env.RECEIPT_CHECK_AMOUNT_ENABLED = 'true';
  process.env.RECEIPT_CHECK_BANK_ENABLED = 'true';
  process.env.RECEIPT_CHECK_RECIPIENT_ENABLED = 'true';
  process.env.RECEIPT_CHECK_DATETIME_ENABLED = 'true';
  process.env.RECEIPT_CHECK_MISMATCH_ENABLED = 'true';
  process.env.RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED = 'true';
  process.env.RECEIPT_CHECK_SUCCESS_TEXT = runtimeConfig.receipt_check_success_text;
  process.env.RECEIPT_CHECK_MISMATCH_TEXT = runtimeConfig.receipt_check_mismatch_text;
  process.env.RECEIPT_CHECK_RULES_TEXT = '';
  process.env.QUALITY_REPLICA_HONESTY_ENABLED = 'true';
  process.env.QUALITY_NO_ORIGINAL_CLAIMS_ENABLED = 'true';
  process.env.QUALITY_CALM_EXPLANATION_ENABLED = 'true';
  process.env.QUALITY_RULES_TEXT = '';
  process.env.DIALOG_EXAMPLES_ENABLED = 'false';
  process.env.DIALOG_EXAMPLES_TEXT = '';
  process.env.TONE = 'neutral';
  process.env.RESPONSE_LENGTH = 'medium';
  process.env.CREATIVITY = 'balanced';
  process.env.PERSONA_STYLE = 'calm';
  process.env.PERSONA_AGE = '27';
  process.env.CONVERSATION_MODE = 'retail';
  process.env.MEDIA_BEHAVIOR = 'answer_from_media';
  process.env.AUTO_REPLY_ENABLED = 'true';
  process.env.MEMORY_ENABLED = 'false';
  process.env.MEMORY_RECENT_LIMIT = String(MEMORY_RECENT_LIMIT);
  process.env.BATCH_DEBOUNCE_MS = String(BATCH_DEBOUNCE_MS);
  process.env.REPLY_MODE = 'smart';
  process.env.HUMAN_TYPING_MODE = 'natural';
  process.env.MANAGER_TAKEOVER_ENABLED = 'true';
  process.env.MANAGER_RETURN_DELAY_MS = String(MANAGER_RETURN_DELAY_MS);
  process.env.PAYMENT_ENABLED = 'false';
  process.env.PAYMENT_METHOD = 'card';
  process.env.PAYMENT_CARD_NUMBER = '';
  process.env.PAYMENT_RECIPIENT_NAME = '';
  process.env.PAYMENT_BANK = '';
  process.env.PAYMENT_COMMENT = '';
  process.env.DELIVERY_RULES_ENABLED = 'false';
  process.env.DELIVERY_RULES_TEXT = '';
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
      input.receivedAt = Date.now();
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

        if (sourceInfo.source === 'manager') {
          applyManagerStageHints(input);
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
      markLatestClientTrace(input);

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
