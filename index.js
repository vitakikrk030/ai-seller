require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const db = require('./db/postgres');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'logs');
const CONFIG_FILE = path.join(DATA_DIR, 'runtime-config.json');
const LOG_FILE = path.join(LOG_DIR, 'runtime.jsonl');
const REQUEST_TIMEOUT_MS = 60000;

const app = express();
app.use(express.json({ limit: '20mb' }));

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function redact(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function loadConfig() {
  const saved = readJson(CONFIG_FILE, {});
  return {
    telegram_token: process.env.TELEGRAM_TOKEN || saved.telegram_token || '',
    webhook_url: process.env.WEBHOOK_URL || saved.webhook_url || '',
    ai_key: process.env.AI_API_KEY || saved.ai_key || saved.sai_gpt_key || '',
    ai_url: process.env.AI_BASE_URL || saved.ai_url || saved.sai_gpt_url || 'https://api.openai.com/v1',
    model: process.env.MODEL || saved.model || saved.sai_gpt_model || 'gpt-4o-mini',
    auto_reply_enabled: saved.auto_reply_enabled !== false,
  };
}

let runtimeConfig = loadConfig();
writeJson(CONFIG_FILE, runtimeConfig);

function publicConfig() {
  return {
    telegram_token_set: Boolean(runtimeConfig.telegram_token),
    telegram_token_preview: redact(runtimeConfig.telegram_token),
    webhook_url: runtimeConfig.webhook_url,
    ai_key_set: Boolean(runtimeConfig.ai_key),
    ai_key_preview: redact(runtimeConfig.ai_key),
    ai_url: runtimeConfig.ai_url,
    model: runtimeConfig.model,
    auto_reply_enabled: runtimeConfig.auto_reply_enabled,
  };
}

function createTraceId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logEvent(event, data = {}) {
  const item = {
    time: new Date().toISOString(),
    event,
    ...data,
  };
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(item)}\n`);
  db.recordEvent(event, data).catch(() => {});
  return item;
}

function getRecentLogs(limit = 100) {
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split(/\n/).filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try { return JSON.parse(line); } catch { return { event: 'LOG_PARSE_ERROR', line }; }
    });
  } catch {
    return [];
  }
}

function telegramApi(method) {
  return `https://api.telegram.org/bot${runtimeConfig.telegram_token}/${method}`;
}

function getTelegramMessage(update = {}) {
  const message = update.business_message || update.message || update.edited_message || null;
  const updateType = update.business_message ? 'business_message' : update.message ? 'message' : update.edited_message ? 'edited_message' : 'unknown';
  return {
    message,
    updateType,
    businessConnectionId: update.business_message?.business_connection_id || update.business_connection_id || '',
  };
}

function normalizeTelegramText(message = {}) {
  const text = String(message.text || message.caption || '').trim();
  if (text) return text;
  if (message.contact?.phone_number) return `Контакт: ${message.contact.phone_number}`;
  if (message.photo) return '[photo] Клиент прислал фото.';
  if (message.document) return `[document] Клиент прислал файл: ${message.document.file_name || 'без названия'}`;
  if (message.voice) return '[voice] Клиент прислал голосовое сообщение.';
  return '';
}

function normalizeMessages(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  return safeMessages
    .map((item) => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: String(item?.content || '').trim(),
    }))
    .filter((item) => item.content)
    .slice(-20);
}

function buildMessages(clientText, history = []) {
  return [
    ...normalizeMessages(history),
    { role: 'user', content: clientText },
  ];
}

async function requestAi(clientText, traceId, history = [], context = {}) {
  if (!runtimeConfig.ai_key) throw new Error('AI key is missing');
  const baseUrl = String(runtimeConfig.ai_url || '').replace(/\/+$/, '');
  const messages = buildMessages(clientText, history);
  const startedAt = Date.now();
  const payload = {
    model: runtimeConfig.model,
    messages,
  };
  logEvent('AI_REQUEST', {
    traceId,
    model: runtimeConfig.model,
    text: clientText,
    messages: messages.length,
  });
  try {
    const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${runtimeConfig.ai_key}`,
        'Content-Type': 'application/json',
      },
    });
    const reply = String(response.data?.choices?.[0]?.message?.content || '').trim();
    if (!reply) throw new Error('AI returned empty reply');
    const latencyMs = Date.now() - startedAt;
    logEvent('AI_REPLY', { traceId, text: reply, latencyMs });
    db.recordAiTurn({
      chatId: context.chatDbId || null,
      traceId,
      model: runtimeConfig.model,
      requestMessages: messages,
      responseText: reply,
      latencyMs,
      ok: true,
    }).catch(() => {});
    return reply;
  } catch (error) {
    db.recordAiTurn({
      chatId: context.chatDbId || null,
      traceId,
      model: runtimeConfig.model,
      requestMessages: messages,
      responseText: '',
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: error.message,
    }).catch(() => {});
    throw error;
  }
}

async function sendTelegramMessage({ chatId, chatDbId = null, customerId = null, text, businessConnectionId, traceId }) {
  if (!runtimeConfig.telegram_token) throw new Error('Telegram token is missing');
  const payload = {
    chat_id: chatId,
    text,
  };
  if (businessConnectionId) payload.business_connection_id = businessConnectionId;
  const response = await axios.post(telegramApi('sendMessage'), payload, {
    timeout: REQUEST_TIMEOUT_MS,
  });
  logEvent('TG_SEND', {
    traceId,
    chatId,
    businessConnectionId,
    text,
    telegramOk: response.data?.ok === true,
  });
  db.recordMessage({
    chatId: chatDbId,
    customerId,
    direction: 'out',
    role: 'assistant',
    text,
    telegramMessageId: response.data?.result?.message_id || null,
    traceId,
    raw: response.data?.result || response.data,
  }).catch(() => {});
  return response.data;
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 's.ai-trunk',
    mode: 'trunk',
    uptime: Math.round(process.uptime()),
    telegram: Boolean(runtimeConfig.telegram_token),
    ai: Boolean(runtimeConfig.ai_key),
    database: db.status(),
  });
});

app.get('/config/status', (req, res) => {
  res.json({
    success: true,
    mode: 'trunk',
    config: publicConfig(),
    transport: {
      telegram: true,
      ai_connect: true,
      user_message_only: true,
    },
    database: db.status(),
  });
});

app.post('/config', (req, res) => {
  const body = req.body || {};
  const allowed = ['telegram_token', 'webhook_url', 'ai_key', 'ai_url', 'model', 'auto_reply_enabled'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) runtimeConfig[key] = body[key];
  }
  runtimeConfig.auto_reply_enabled = runtimeConfig.auto_reply_enabled !== false;
  writeJson(CONFIG_FILE, runtimeConfig);
  logEvent('CONFIG_UPDATE', { keys: Object.keys(body).filter((key) => allowed.includes(key)) });
  res.json({ ok: true, config: publicConfig() });
});

app.get('/config/models', async (req, res) => {
  const aiKey = String(req.query.ai_key || runtimeConfig.ai_key || '').trim();
  const aiUrl = String(req.query.ai_url || runtimeConfig.ai_url || '').trim();
  const traceId = createTraceId();
  if (!aiKey || !aiUrl) {
    res.status(400).json({ ok: false, error: 'AI key and AI base URL are required' });
    return;
  }
  try {
    const baseUrl = aiUrl.replace(/\/+$/, '');
    const response = await axios.get(`${baseUrl}/models`, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${aiKey}` },
    });
    const rawModels = Array.isArray(response.data?.data) ? response.data.data : [];
    const models = rawModels
      .map((item) => String(item.id || item.name || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    logEvent('MODELS_LOADED', { traceId, count: models.length });
    res.json({ ok: true, models });
  } catch (error) {
    logEvent('ERROR', {
      traceId,
      scope: 'models.load',
      error: error.message,
      providerError: error.response?.data || null,
    });
    res.status(502).json({ ok: false, error: error.message, providerError: error.response?.data || null });
  }
});

app.get('/logs', (req, res) => {
  res.json({ logs: getRecentLogs(Math.min(500, Number(req.query.limit) || 100)) });
});

app.get('/db/status', async (req, res) => {
  try {
    res.json({ ok: true, database: await db.foundationStatus() });
  } catch (error) {
    res.status(500).json({ ok: false, database: db.status(), error: error.message });
  }
});

app.delete('/logs', (req, res) => {
  fs.writeFileSync(LOG_FILE, '');
  res.json({ ok: true });
});

app.post('/api/test-chat', async (req, res) => {
  const traceId = createTraceId();
  const text = String(req.body?.text || '').trim();
  const history = normalizeMessages(req.body?.history);
  if (!text) {
    res.status(400).json({ ok: false, error: 'Text is required' });
    return;
  }
  try {
    logEvent('TEST_IN', { traceId, text, history: history.length });
    const reply = await requestAi(text, traceId, history);
    logEvent('TEST_OUT', { traceId, text: reply });
    res.json({ ok: true, traceId, reply });
  } catch (error) {
    logEvent('ERROR', {
      traceId,
      scope: 'test-chat',
      error: error.message,
      providerError: error.response?.data || null,
    });
    res.status(500).json({ ok: false, traceId, error: error.message });
  }
});

app.post('/api/telegram/webhook', (req, res) => {
  const traceId = createTraceId();
  const { message, updateType, businessConnectionId } = getTelegramMessage(req.body || {});
  res.sendStatus(200);
  setImmediate(async () => {
    try {
      if (!message?.chat?.id) {
        logEvent('IN_IGNORED', { traceId, updateType, reason: 'no_message' });
        return;
      }
      if (message.from?.is_bot) {
        logEvent('IN_IGNORED', { traceId, updateType, reason: 'bot_message' });
        return;
      }
      const chatId = message.chat.id;
      const text = normalizeTelegramText(message);
      const customerId = await db.upsertTelegramCustomer(message.from || {}, message.chat || {});
      const chatDbId = await db.upsertTelegramChat({
        chat: message.chat || {},
        customerId,
        businessConnectionId,
      });
      await db.recordMessage({
        chatId: chatDbId,
        customerId,
        direction: 'in',
        role: 'customer',
        text,
        telegramMessageId: message.message_id || null,
        traceId,
        raw: message,
      });
      logEvent('IN', {
        traceId,
        updateType,
        businessConnectionId,
        chatId,
        userId: message.from?.id || '',
        firstName: message.from?.first_name || message.chat?.first_name || '',
        text,
      });
      if (!text) return;
      if (!runtimeConfig.auto_reply_enabled) {
        logEvent('AUTO_REPLY_DISABLED', { traceId, chatId });
        return;
      }
      const reply = await requestAi(text, traceId, [], { chatDbId });
      await sendTelegramMessage({ chatId, chatDbId, customerId, text: reply, businessConnectionId, traceId });
    } catch (error) {
      logEvent('ERROR', {
        traceId,
        scope: 'webhook',
        error: error.message,
        providerError: error.response?.data || null,
      });
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use((error, req, res, next) => {
  logEvent('ERROR', { scope: 'express', error: error.message });
  res.status(200).json({ ok: false, error: error.message });
});

async function start() {
  const database = await db.init();
  logEvent('BOOT', { mode: 'trunk', host: HOST, port: PORT });
  if (database.enabled && !database.ok) {
    logEvent('DB_ERROR', { error: database.error });
  }
  app.listen(PORT, HOST, () => {
    console.log(`S.AI trunk listening on ${HOST}:${PORT}`);
  });
}

start().catch((error) => {
  logEvent('ERROR', { scope: 'startup', error: error.message });
  process.exit(1);
});
