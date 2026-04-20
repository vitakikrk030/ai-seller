require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const axios = require('axios');

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
const READ_DELAY_MIN_MS = 2000;
const READ_DELAY_MAX_MS = 5000;
const LONG_REPLY_PART_LIMIT = 700;
const HUMAN_TYPING_MIN_CPS = 9;
const HUMAN_TYPING_MAX_CPS = 14;
const HUMAN_TYPING_MIN_DELAY_MS = 2500;
const HUMAN_TYPING_MAX_DELAY_MS = 14000;
const MEMORY_RECENT_LIMIT = 10;
const MEMORY_MESSAGES_TTL_DAYS = 7;
const MEMORY_FACTS_TTL_DAYS = 90;
const MEMORY_STATE_TTL_DAYS = 14;
const MEMORY_MAX_MESSAGES = 5000;
const MEMORY_HISTORY_CHAR_LIMIT = 3500;
const BATCH_DEBOUNCE_MS = 3000;
const BATCH_MAX_WINDOW_MS = 8000;
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
const runtimeLogs = [];
const logDir = path.join(__dirname, 'logs');
const LOG_FILE_PATH = path.join(logDir, 'runtime.jsonl');
const dataDir = path.join(__dirname, 'data');
const CONFIG_FILE_PATH = path.join(dataDir, 'runtime-config.json');
const MEMORY_FILE_PATH = path.join(dataDir, 'memory.json');
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
  instruction: process.env.INSTRUCTION || '',
  tone: process.env.TONE || 'neutral',
  response_length: process.env.RESPONSE_LENGTH || 'medium',
  creativity: process.env.CREATIVITY || 'balanced',
  persona_style: process.env.PERSONA_STYLE || 'calm',
  persona_age: process.env.PERSONA_AGE || '27',
  conversation_mode: process.env.CONVERSATION_MODE || 'general',
  media_behavior: process.env.MEDIA_BEHAVIOR || 'describe_media',
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

function appendMemoryMessage(input, role, text) {
  const chatId = getMemoryChatId(input);
  const cleanText = normalizeMemoryText(text);
  if (!chatId || !cleanText) return;

  const telegramMessageId = role === 'user' ? String(input.messageId || '') : '';
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
  memoryStore.states[cleanChatId] = {
    stage,
    source: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
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

  if (input.hasMedia || input.hasLinkInput) {
    upsertMemoryFact(chatId, 'interest', getMemoryMessageText(input), source);
  }

  const stage = inferConversationStage(input);
  if (stage) setConversationStage(chatId, stage, source);

  persistMemoryStore();
}

function getRecentMemoryMessages(chatId, limit = MEMORY_RECENT_LIMIT, excludeTraceIds = []) {
  const cleanChatId = getMemoryChatId(chatId);
  const excluded = new Set((excludeTraceIds || []).filter(Boolean));
  if (!cleanChatId) return [];
  return memoryStore.messages
    .filter((message) => message.chatId === cleanChatId)
    .filter((message) => !excluded.has(message.traceId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}

function formatMemoryFacts(facts = {}) {
  const labels = {
    name: 'Name',
    phone: 'Phone',
    city: 'City',
    address: 'Delivery address',
    shoeSize: 'Shoe size',
    interest: 'Interest',
    lastProduct: 'Last product',
  };
  return Object.entries(labels)
    .filter(([key]) => facts[key]?.value)
    .map(([key, label]) => `${label}: ${facts[key].value}`);
}

function buildMemoryContext(chatId, options = {}) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return { summary: '', history: [], facts: {}, state: null };

  const facts = memoryStore.facts[cleanChatId] || {};
  const state = memoryStore.states[cleanChatId] || null;
  const factLines = formatMemoryFacts(facts);
  if (state?.stage) factLines.push(`Stage: ${state.stage}`);

  const summary = factLines.length
    ? [
      'Client memory:',
      ...factLines.map((line) => `- ${line}`),
      'Use this only when relevant. Do not mention internal memory directly. Do not invent missing facts.',
    ].join('\n')
    : '';

  let usedChars = 0;
  const history = [];
  getRecentMemoryMessages(cleanChatId, MEMORY_RECENT_LIMIT, options.excludeTraceIds || []).reverse().forEach((message) => {
    const text = normalizeMemoryText(message.text);
    if (!text || usedChars + text.length > MEMORY_HISTORY_CHAR_LIMIT) return;
    usedChars += text.length;
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: text,
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
    text: buildBatchText(inputs),
    images,
    hasMedia,
    hasLinkInput,
  };
}

async function processInputBatch(inputs) {
  if (!inputs.length) return;

  const batchInput = buildBatchInput(inputs);
  try {
    batchInput.memoryContext = buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
    });

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
      status: 'ok',
    });

    const stopTyping = startTypingLoop(batchInput.config, batchInput);
    try {
      const reply = await requestAi(batchInput);
      if (typeof reply === 'string') {
        appendMemoryMessage(batchInput, 'assistant', reply);
        await sendHumanizedTelegramReply(batchInput.config, batchInput, reply);
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
    batch.maxTimer = setTimeout(() => flushChatBatch(key), BATCH_MAX_WINDOW_MS);
    chatBatches.set(key, batch);
  }

  batch.inputs.push(input);

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  batch.debounceTimer = setTimeout(() => flushChatBatch(key), BATCH_DEBOUNCE_MS);
}

function clearMemoryForChat(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return false;
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

  if (Object.prototype.hasOwnProperty.call(body, 'webhook_url')) {
    runtimeConfig.webhook_url = normalizeWebhookUrl(body.webhook_url || '');
    process.env.WEBHOOK_URL = runtimeConfig.webhook_url;
  }

  savePersistedConfig();
}

function getTelegramApiUrl(config, method) {
  return `https://api.telegram.org/bot${config.telegram_token}/${method}`;
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

function getHumanTypingDelayMs(text) {
  const length = String(text || '').length;
  const cps = randomBetween(HUMAN_TYPING_MIN_CPS, HUMAN_TYPING_MAX_CPS);
  const typingTime = Math.round((length / cps) * 1000);
  const thinkingTime = length <= 100
    ? randomBetween(500, 1200)
    : length <= 300
      ? randomBetween(900, 2200)
      : randomBetween(1400, 3000);
  return Math.min(
    HUMAN_TYPING_MAX_DELAY_MS,
    Math.max(HUMAN_TYPING_MIN_DELAY_MS, typingTime + thinkingTime + randomBetween(500, 1500)),
  );
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

function getConversationModeGuidance(conversationMode) {
  const map = {
    general: 'Treat incoming text and media as general-purpose user messages.',
    retail: [
      'If the user sends a photo, screenshot, or link, treat it as likely interest in a product, not automatically as a request to describe media.',
      'Use seller-first behavior only when the message shows clear or probable product interest.',
      'When product interest is absent, respond naturally, briefly, and helpfully without forcing the conversation toward a sale.',
      'Respond as a seller when relevant, not as a generic assistant. Do not use phrases like “in the image,” “it looks like,” “the photo shows,” or “as an AI.”',
      'If possible, briefly identify the product or product type, then move toward purchase: ask about size, availability, preferred option, or buying intent.',
      'Take initiative when product interest is present. Guide the user toward a decision instead of waiting, but avoid sounding pushy on neutral inputs.',
      'Keep replies short, confident, and practical. Description is allowed only when it helps the sale, not as the main goal.',
      'Always respond in Russian.',
      'Отвечай как продавец: уверенно, по делу и с фокусом на продажу.',
      'Всегда обращайся к пользователю на “Вы”. Используй вежливую, профессиональную форму общения и избегай обращения на “ты”, сохраняя живой и естественный тон.',
      'Фото, ссылки и скрины обычно означают интерес к товару, а не просьбу описать изображение.',
      'Если виден явный или вероятный товарный интерес, помогай выбрать и веди к покупке. Если товарный интерес не выражен, отвечай естественно и по смыслу.',
    ].join(' '),
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

function buildSystemPrompt(config) {
  const parts = [];

  if (String(config.instruction || '').trim()) {
    parts.push(String(config.instruction).trim());
  }

  parts.push('Additional behavior guidance:');
  parts.push(getToneGuidance(config.tone));
  parts.push(getResponseLengthGuidance(config.response_length));
  parts.push(getPersonaStyleGuidance(config.persona_style));
  parts.push(getPersonaAgeGuidance(config.persona_age));
  parts.push(getConversationModeGuidance(config.conversation_mode));
  parts.push(getMediaBehaviorGuidance(config.media_behavior));

  return parts.join('\n\n');
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
    tone: input.config.tone,
    responseLength: input.config.response_length,
    creativity: input.config.creativity,
    personaStyle: input.config.persona_style,
    personaAge: input.config.persona_age,
    conversationMode: input.config.conversation_mode,
    mediaBehavior: input.config.media_behavior,
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

  try {
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
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
      duration: Date.now() - startedAt,
      status: 'ok',
    });
  } catch (e) {
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
    await wait(getHumanTypingDelayMs(parts[index]));
    await sendTelegramMessage(config, context, parts[index]);
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
      logEvent('IN', {
        traceId: createTraceId(),
        status: 'ok',
        scope: 'telegram.business_connection',
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        userId: req.body.business_connection?.user?.id || '',
        chatId: req.body.business_connection?.user_chat_id || '',
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
      logEvent('IN', {
        traceId,
        received: true,
        userId,
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
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
      updateCustomerMemoryFromInput(input);
      appendMemoryMessage(input, 'user', memoryText);
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
