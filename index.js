require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('node:dns').promises;
const net = require('node:net');
const express = require('express');
const axios = require('axios');
const db = require('./db/postgres');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'logs');
const CONFIG_FILE = path.join(DATA_DIR, 'runtime-config.json');
const AI_SELLER_CONTROL_FILE = path.join(DATA_DIR, 'ai-seller-control.json');
const PRODUCT_CATALOG_FILE = path.join(DATA_DIR, 'product-catalog.json');
const LOG_FILE = path.join(LOG_DIR, 'runtime.jsonl');
const REQUEST_TIMEOUT_MS = 20000;
const AUTH_USER = process.env.SAI_AUTH_USER || process.env.AUTH_USER || 'admin';
const AUTH_PASSWORD = process.env.SAI_AUTH_PASSWORD || process.env.AUTH_PASSWORD || '';
const AUTH_SECRET = process.env.SAI_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const AUTH_COOKIE = 'sai_session';
const AUTH_TTL_MS = 1000 * 60 * 60 * 24 * 7;

// DEBOUNCE_MS is now read from runtimeConfig.debounce_ms at runtime
function getDebounceMs() { return Math.max(500, Math.min(10000, Number(runtimeConfig.debounce_ms || 3000))); }

// Batch debounce: chatId → { timer, texts[], traceId, chatDbId, customerId, chatId, businessConnectionId }
const debounceBuffers = new Map();
// AI processing state: chatId → { cancelled, traceId }
const aiProcessing = new Map();
// System prompt cache — invalidated when AI seller control changes
const promptCache = { hash: '', prompt: '', catalogHash: '', mtime: 0 };
// Manager takeover: chatId → { lastManagerAt, managerUserId }
const passiveChats = new Map();
// Manual pause: chatId → { pausedAt, pausedBy }
const pausedChats = new Map();
// Escalation: chatId → { at, reason, traceId }
const escalatedChats = new Map();
// Reactions cooldown: chatId -> last reaction timestamp
const recentReactions = new Map();
// Iwak page cache: url -> { expiresAt, data }
const iwakPageCache = new Map();

function getChatAiStatus(chatId) {
  const key = String(chatId);
  if (!runtimeConfig.auto_reply_enabled) return { status: 'off', label: 'AI выключен' };
  if (pausedChats.has(key)) return { status: 'paused_manual', label: 'Пауза (менеджер)' };
  if (escalatedChats.has(key)) {
    const esc = escalatedChats.get(key);
    return { status: 'escalated', label: 'Ожидает менеджера', reason: esc.reason };
  }
  const passive = passiveChats.get(key);
  if (passive) {
    const passiveSec = Math.max(10, Math.min(600, Number(runtimeConfig.manager_passive_seconds || 120)));
    const elapsed = (Date.now() - passive.lastManagerAt) / 1000;
    if (elapsed < passiveSec) {
      const remaining = Math.round(passiveSec - elapsed);
      return { status: 'paused_manager', label: `Пауза (${remaining} сек)` };
    }
  }
  return { status: 'active', label: 'AI активен' };
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: false }));

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

const liveClients = new Map();
const authSessions = new Map();

function emitLive(type, payload = {}) {
  const event = {
    type,
    time: new Date().toISOString(),
    ...payload,
  };
  const data = `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const [id, client] of liveClients) {
    try {
      client.write(data);
    } catch {
      liveClients.delete(id);
    }
  }
}

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
    vision_model: process.env.VISION_MODEL || saved.vision_model || '',
    auto_reply_enabled: saved.auto_reply_enabled !== false,
  };
}

let runtimeConfig = loadConfig();
writeJson(CONFIG_FILE, runtimeConfig);

function defaultAiSellerControl() {
  return {
    version: 2,
    production_enabled: false,
    updated_at: new Date().toISOString(),
    foundation: [],
    funnel: [],
    memory: [],
    objections: [],
    polygon: [],
  };
}

function aiSellerRuntimeStatus() {
  return {
    compiler_connected: true,
    production_effect: runtimeConfig.auto_reply_enabled !== false,
    test_chat_effect: true,
    source: 'data/ai-seller-control.json',
    compiler: 'compileSystemPrompt',
  };
}

function normalizeSellerBlock(block = {}) {
  const id = String(block.id || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  const title = String(block.title || '').trim().slice(0, 120);
  const body = String(block.body || '').trim().slice(0, 12000);
  if (!id || !title) return null;
  return {
    id,
    title,
    enabled: block.enabled !== false,
    body,
  };
}

function normalizeSellerBlocks(blocks) {
  return Array.isArray(blocks)
    ? blocks.map(normalizeSellerBlock).filter(Boolean).slice(0, 80)
    : [];
}

function normalizeFunnelStage(stage = {}, index = 0) {
  const id = String(stage.id || `stage_${index + 1}`).trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 64);
  const title = String(stage.title || `Этап ${index + 1}`).trim().slice(0, 120);
  return {
    id,
    title,
    enabled: stage.enabled !== false,
    goal: String(stage.goal || '').trim().slice(0, 8000),
    actions: String(stage.actions || '').trim().slice(0, 12000),
    questions: String(stage.questions || '').trim().slice(0, 8000),
    objections: String(stage.objections || '').trim().slice(0, 8000),
    forbidden: String(stage.forbidden || '').trim().slice(0, 8000),
    examples: String(stage.examples || '').trim().slice(0, 12000),
    handoff: String(stage.handoff || '').trim().slice(0, 8000),
  };
}

function normalizeAiSellerControl(value = {}) {
  const fallbackFoundation = Array.isArray(value.sections) ? value.sections : [];
  const foundation = normalizeSellerBlocks(value.foundation || fallbackFoundation);
  const funnel = Array.isArray(value.funnel)
    ? value.funnel.map(normalizeFunnelStage).filter((stage) => stage.id && stage.title).slice(0, 20)
    : [];
  return {
    version: Number(value.version || 2),
    production_enabled: false,
    updated_at: String(value.updated_at || new Date().toISOString()),
    foundation,
    funnel,
    memory: normalizeSellerBlocks(value.memory),
    objections: normalizeSellerBlocks(value.objections),
    polygon: normalizeSellerBlocks(value.polygon),
  };
}

function loadAiSellerControl() {
  return normalizeAiSellerControl(readJson(AI_SELLER_CONTROL_FILE, defaultAiSellerControl()));
}

function loadProductCatalog() {
  const raw = readJson(PRODUCT_CATALOG_FILE, []);
  return Array.isArray(raw) ? raw : [];
}

function saveProductCatalog(items) {
  const safe = (Array.isArray(items) ? items : []).map((p) => ({
    id: String(p.id || `p${Date.now()}`).slice(0, 64),
    name: String(p.name || '').trim().slice(0, 200),
    price: String(p.price || '').trim().slice(0, 50),
    sizes: Array.isArray(p.sizes) ? p.sizes.map(String).slice(0, 30) : [],
    description: String(p.description || '').trim().slice(0, 2000),
    in_stock: p.in_stock !== false,
    photo_url: String(p.photo_url || '').trim().slice(0, 500),
  }));
  writeJson(PRODUCT_CATALOG_FILE, safe);
  return safe;
}

function publicConfig() {
  return {
    telegram_token_set: Boolean(runtimeConfig.telegram_token),
    telegram_token_preview: redact(runtimeConfig.telegram_token),
    webhook_url: runtimeConfig.webhook_url,
    ai_key_set: Boolean(runtimeConfig.ai_key),
    ai_key_preview: redact(runtimeConfig.ai_key),
    ai_url: runtimeConfig.ai_url,
    model: runtimeConfig.model,
    vision_model: runtimeConfig.vision_model || '',
    auto_reply_enabled: runtimeConfig.auto_reply_enabled,
    // Agent behavior settings (visible in AI Control)
    manager_passive_seconds: Number(runtimeConfig.manager_passive_seconds || 120),
    read_delay_ms: Number(runtimeConfig.read_delay_ms || 800),
    typing_speed_cps: Number(runtimeConfig.typing_speed_cps || 60),
    between_messages_delay_ms: Number(runtimeConfig.between_messages_delay_ms || 1200),
    greeting_dedup_enabled: runtimeConfig.greeting_dedup_enabled !== false,
    greeting_dedup_hours: Number(runtimeConfig.greeting_dedup_hours || 4),
    reaction_enabled: runtimeConfig.reaction_enabled !== false,
    reaction_mode: String(runtimeConfig.reaction_mode || 'smart'),
    reaction_emoji: String(runtimeConfig.reaction_emoji || '👀'),
    reaction_probability: Number(runtimeConfig.reaction_probability || 28),
    reaction_cooldown_sec: Number(runtimeConfig.reaction_cooldown_sec || 180),
    debounce_ms: Number(runtimeConfig.debounce_ms || 3000),
    vision_enabled: runtimeConfig.vision_enabled !== false,
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

async function fetchTelegramAvatarFileId(userId) {
  if (!runtimeConfig.telegram_token || !userId) return '';
  try {
    const response = await axios.get(telegramApi('getUserProfilePhotos'), {
      timeout: 8000,
      params: {
        user_id: userId,
        limit: 1,
      },
    });
    const photoSizes = response.data?.result?.photos?.[0] || [];
    const bestPhoto = Array.isArray(photoSizes) ? photoSizes[photoSizes.length - 1] : null;
    return bestPhoto?.file_id || '';
  } catch (error) {
    logEvent('TG_AVATAR_ERROR', {
      userId: String(userId),
      error: error.message,
      providerError: error.response?.data || null,
    });
    return '';
  }
}

async function refreshTelegramCustomerAvatar({ customerId, userId, chatDbId, traceId }) {
  const avatarFileId = await fetchTelegramAvatarFileId(userId);
  if (!avatarFileId) return;
  const updatedId = await db.updateCustomerAvatar(customerId, avatarFileId);
  if (!updatedId) return;
  logEvent('TG_AVATAR_UPDATED', { traceId, customerId, chatDbId });
  emitLive('chat.updated', { traceId, chatId: chatDbId, customerId, source: 'telegram', reason: 'avatar.updated' });
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

function getTelegramCustomerIdentity(message = {}, businessConnectionId = '') {
  const privateChat = message.chat?.type === 'private' ? message.chat : null;
  if (businessConnectionId && privateChat?.id) {
    return {
      id: privateChat.id,
      username: privateChat.username || '',
      first_name: privateChat.first_name || '',
      last_name: privateChat.last_name || '',
    };
  }
  return message.from || message.chat || {};
}

function normalizeTelegramText(message = {}) {
  const text = String(message.text || message.caption || '').trim();
  if (text) return text;
  if (message.contact?.phone_number) return `Контакт: ${message.contact.phone_number}`;
  if (message.photo) return '[photo] Клиент прислал фото.';
  if (message.document) return `[document] Клиент прислал файл: ${message.document.file_name || 'без названия'}`;
  if (message.voice) return '[voice] Клиент прислал голосовое сообщение.';
  if (message.sticker) return `[sticker] ${message.sticker.emoji || '🙂'}`;
  return '';
}

// Extract media file_id from Telegram message for Vision processing
function extractTelegramMedia(message = {}) {
  if (message.photo && Array.isArray(message.photo) && message.photo.length > 0) {
    const bestPhoto = message.photo[message.photo.length - 1];
    return { type: 'photo', fileId: bestPhoto.file_id, mimeType: 'image/jpeg' };
  }
  if (message.document) {
    const mime = String(message.document.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) {
      return { type: 'photo', fileId: message.document.file_id, mimeType: mime };
    }
  }
  if (message.sticker && !message.sticker.is_animated && !message.sticker.is_video) {
    return { type: 'photo', fileId: message.sticker.file_id, mimeType: 'image/webp' };
  }
  return null;
}

// Download a Telegram file and return as base64 data URI
async function downloadTelegramFileBase64(fileId) {
  if (!runtimeConfig.telegram_token || !fileId) return null;
  try {
    const fileResponse = await axios.get(telegramApi('getFile'), {
      timeout: 10000,
      params: { file_id: fileId },
    });
    const filePath = fileResponse.data?.result?.file_path || '';
    if (!filePath) return null;
    const file = await axios.get(
      `https://api.telegram.org/file/bot${runtimeConfig.telegram_token}/${filePath}`,
      { timeout: 20000, responseType: 'arraybuffer' }
    );
    const ext = path.extname(filePath).toLowerCase();
    const mime = { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
    const b64 = Buffer.from(file.data).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch (err) {
    logEvent('VISION_DOWNLOAD_FAIL', { fileId, error: err.message });
    return null;
  }
}

// Send a photo to Telegram from URL or file_id
async function sendTelegramPhoto({ chatId, photoSource, caption, businessConnectionId }) {
  if (!runtimeConfig.telegram_token || !photoSource) return null;
  try {
    const payload = { chat_id: chatId, photo: photoSource };
    if (caption) payload.caption = caption;
    if (businessConnectionId) payload.business_connection_id = businessConnectionId;
    const response = await axios.post(telegramApi('sendPhoto'), payload, { timeout: REQUEST_TIMEOUT_MS });
    return response.data;
  } catch (err) {
    logEvent('TG_SEND_PHOTO_ERROR', { chatId, error: err.message });
    return null;
  }
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

function extractUrls(text = '') {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')]+/gi);
  return matches ? Array.from(new Set(matches.map((item) => item.trim()))) : [];
}

function normalizeIwakUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || '').trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (host !== 'iwak.ru' && host !== 'www.iwak.ru') return null;
    if (url.username || url.password || url.port) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function extractIwakProductIdFromUrl(urlString = '') {
  try {
    const url = new URL(urlString);
    const pathMatch = url.pathname.match(/-(\d+)(?:\/)?$/);
    return pathMatch?.[1] || '';
  } catch {
    return '';
  }
}

function isPrivateIp(ip = '') {
  const type = net.isIP(ip);
  if (!type) return true;
  if (type === 4) {
    if (ip.startsWith('10.')) return true;
    if (ip.startsWith('127.')) return true;
    if (ip.startsWith('192.168.')) return true;
    if (ip.startsWith('169.254.')) return true;
    const parts = ip.split('.').map(Number);
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }
  const normalized = ip.toLowerCase();
  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.')
    || /^::ffff:172\.(1[6-9]|2\d|3[0-1])\./.test(normalized);
}

async function assertSafeIwakHost(urlString) {
  const url = new URL(urlString);
  const host = url.hostname.toLowerCase();
  if (host !== 'iwak.ru' && host !== 'www.iwak.ru') {
    throw new Error('Only iwak.ru is allowed');
  }
  const answers = await dns.lookup(host, { all: true, verbatim: true });
  if (!answers.length) throw new Error('Host resolution failed');
  for (const answer of answers) {
    if (isPrivateIp(answer.address)) {
      throw new Error('Resolved address is not allowed');
    }
  }
}

function extractMetaContent(html, attrName, attrValue) {
  const escaped = String(attrValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta[^>]+${attrName}=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>|<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escaped}["'][^>]*>`, 'i');
  const match = html.match(pattern);
  return (match && (match[1] || match[2]) || '').trim();
}

function extractJsonLdObjects(html) {
  const matches = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const out = [];
  for (const match of matches) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {}
  }
  return out;
}

function stripHtmlToText(html = '') {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseIwakProductPage(html, finalUrl) {
  const text = stripHtmlToText(html);
  const jsonLd = extractJsonLdObjects(html);
  const productJson = jsonLd.find((item) => {
    const type = item?.['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  }) || {};
  const offerJson = Array.isArray(productJson.offers) ? productJson.offers[0] : (productJson.offers || {});

  const ogTitle = extractMetaContent(html, 'property', 'og:title') || extractMetaContent(html, 'name', 'twitter:title');
  const ogDescription = extractMetaContent(html, 'property', 'og:description') || extractMetaContent(html, 'name', 'description');
  const ogImage = extractMetaContent(html, 'property', 'og:image') || extractMetaContent(html, 'name', 'twitter:image');
  const canonical = (() => {
    const match = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["'][^>]*>/i);
    return (match?.[1] || finalUrl || '').trim();
  })();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (productJson.name || ogTitle || titleMatch?.[1] || '').replace(/\s+/g, ' ').trim();
  const priceMeta = extractMetaContent(html, 'property', 'product:price:amount')
    || extractMetaContent(html, 'name', 'price')
    || String(offerJson.price || '').trim();
  const currency = extractMetaContent(html, 'property', 'product:price:currency')
    || String(offerJson.priceCurrency || 'RUB').trim();
  const price = priceMeta ? `${priceMeta}${currency === 'RUB' ? ' ₽' : ` ${currency}`}` : '';

  const oldPriceMatch = text.match(/(\d[\d\s]{2,})\s*₽\s*(\d[\d\s]{2,})\s*₽/);
  const oldPrice = oldPriceMatch ? `${oldPriceMatch[1].replace(/\s+/g, '')} ₽` : '';

  const sizeSet = new Set();
  for (const match of text.matchAll(/\b(3[5-9]|4\d|5[0-9])\b/g)) {
    const value = match[1];
    if (Number(value) >= 35 && Number(value) <= 50) sizeSet.add(value);
  }
  const availability = /в наличии/i.test(text)
    ? 'В наличии'
    : /нет в наличии|отсутствует/i.test(text)
      ? 'Нет в наличии'
      : '';

  const regionMatch = text.match(/(Россия\s*\/\s*Беларусь|Россия|Беларусь)/i);
  const productIdMatch = finalUrl.match(/-(\d+)(?:\/)?$/) || text.match(/\bID[:\s#]*([0-9]{2,})\b/i);

  return {
    source: 'iwak.ru',
    canonical_url: canonical || finalUrl,
    title,
    description: productJson.description || ogDescription || '',
    price,
    old_price: oldPrice,
    currency,
    sizes: Array.from(sizeSet).sort((a, b) => Number(a) - Number(b)),
    availability,
    region: regionMatch?.[1] || '',
    product_id: productIdMatch?.[1] || '',
    image: productJson.image?.[0] || productJson.image || ogImage || '',
    text_excerpt: text.slice(0, 1200),
  };
}

function normalizeIwakApiProduct(product, finalUrl) {
  if (!product || typeof product !== 'object') return null;
  const base = new URL(finalUrl).origin;
  const imagePath = Array.isArray(product.images) && product.images[0] ? product.images[0] : (product.image || '');
  return {
    source: 'iwak.ru',
    canonical_url: finalUrl,
    title: String(product.name || '').trim(),
    description: [product.brand, product.category, product.color].filter(Boolean).join(' · '),
    price: product.price ? `${product.price} ₽` : '',
    old_price: product.originalPrice ? `${product.originalPrice} ₽` : '',
    currency: 'RUB',
    sizes: Array.isArray(product.sizes) ? product.sizes.map(String) : [],
    availability: product.deletedAt ? 'Нет в наличии' : 'В наличии',
    region: 'Россия / Беларусь',
    product_id: String(product.id || ''),
    image: imagePath ? new URL(String(imagePath).replace(/^\.\//, '/'), base).toString() : '',
    text_excerpt: '',
    fetched_via: 'api',
    raw_product: {
      brand: String(product.brand || ''),
      category: String(product.category || ''),
      color: String(product.color || ''),
      gender: String(product.gender || ''),
    },
  };
}

async function fetchIwakProductContext(rawUrl, traceId = '') {
  const normalizedUrl = normalizeIwakUrl(rawUrl);
  if (!normalizedUrl) return null;
  const cached = iwakPageCache.get(normalizedUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  await assertSafeIwakHost(normalizedUrl);
  const productId = extractIwakProductIdFromUrl(normalizedUrl);
  if (productId) {
    try {
      const apiUrl = new URL(`/api/products/${productId}`, normalizedUrl).toString();
      const apiResponse = await axios.get(apiUrl, {
        timeout: 5000,
        maxRedirects: 0,
        responseType: 'json',
        validateStatus: (status) => status >= 200 && status < 300,
        headers: {
          'User-Agent': 'S.AI Product Reader/1.0',
          'Accept': 'application/json',
        },
      });
      const apiResult = normalizeIwakApiProduct(apiResponse.data, normalizedUrl);
      if (apiResult?.title) {
        const result = {
          ...apiResult,
          fetched_url: normalizedUrl,
          final_url: normalizedUrl,
        };
        iwakPageCache.set(normalizedUrl, { expiresAt: Date.now() + 1000 * 60 * 10, data: result });
        logEvent('IWAK_FETCH_OK', {
          traceId,
          url: normalizedUrl,
          finalUrl: normalizedUrl,
          title: result.title,
          productId: result.product_id,
          source: 'api',
        });
        return result;
      }
    } catch (error) {
      logEvent('IWAK_API_FETCH_FAIL', {
        traceId,
        url: normalizedUrl,
        productId,
        error: error.message,
        providerError: error.response?.data || null,
      });
    }
  }

  const response = await axios.get(normalizedUrl, {
    timeout: 5000,
    maxRedirects: 3,
    maxContentLength: 1024 * 1024 * 2,
    maxBodyLength: 1024 * 1024 * 2,
    responseType: 'text',
    transformResponse: [(data) => data],
    validateStatus: (status) => status >= 200 && status < 400,
    headers: {
      'User-Agent': 'S.AI Product Reader/1.0',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  const finalUrl = normalizeIwakUrl(response.request?.res?.responseUrl || normalizedUrl);
  if (!finalUrl) throw new Error('Redirect target is not allowed');
  await assertSafeIwakHost(finalUrl);

  const parsed = parseIwakProductPage(String(response.data || ''), finalUrl);
  const result = {
    ...parsed,
    fetched_url: normalizedUrl,
    final_url: finalUrl,
  };
  iwakPageCache.set(normalizedUrl, { expiresAt: Date.now() + 1000 * 60 * 10, data: result });
  logEvent('IWAK_FETCH_OK', {
    traceId,
    url: normalizedUrl,
    finalUrl,
    title: result.title,
    productId: result.product_id,
    source: 'html',
  });
  return result;
}

async function buildIwakContextFromText(text, traceId = '') {
  const urls = extractUrls(text);
  for (const rawUrl of urls) {
    const normalizedUrl = normalizeIwakUrl(rawUrl);
    if (!normalizedUrl) continue;
    try {
      return await fetchIwakProductContext(normalizedUrl, traceId);
    } catch (error) {
      logEvent('IWAK_FETCH_FAIL', {
        traceId,
        url: normalizedUrl,
        error: error.message,
      });
    }
  }
  return null;
}

function parseBool(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true' || value === '1' || value === 'yes') return true;
  if (value === false || value === 'false' || value === '0' || value === 'no') return false;
  return undefined;
}

function parseCookies(header = '') {
  return String(header || '').split(';').reduce((cookies, item) => {
    const index = item.indexOf('=');
    if (index === -1) return cookies;
    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function signSession(id) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(id).digest('hex');
}

function createSession() {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + AUTH_TTL_MS;
  authSessions.set(id, { expiresAt });
  return `${id}.${signSession(id)}`;
}

function readSession(req) {
  const token = parseCookies(req.headers.cookie || '')[AUTH_COOKIE] || '';
  const [id, signature] = token.split('.');
  if (!id || !signature || !safeEqual(signature, signSession(id))) return null;
  const session = authSessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    authSessions.delete(id);
    return null;
  }
  session.expiresAt = Date.now() + AUTH_TTL_MS;
  return { id, ...session };
}

function sessionCookie(token, req) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return [
    `${AUTH_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(AUTH_TTL_MS / 1000)}`,
    secure ? 'Secure' : '',
  ].filter(Boolean).join('; ');
}

function clearSessionCookie() {
  return `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function wantsJson(req) {
  return req.path.startsWith('/api/') || req.path.startsWith('/config') || req.path.startsWith('/db') || req.path === '/logs' || String(req.headers.accept || '').includes('application/json');
}

function loginPage(error = '') {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>S.AI вход</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; color: #111; background: #f6f8f9; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 30% 0%, rgba(255,255,255,.86), transparent 34%), linear-gradient(135deg, #edf1f3 0%, #f6f8f9 45%, #fbfcfd 100%); }
    .card { width: min(100%, 380px); border: 1px solid #e4e8eb; border-radius: 18px; background: rgba(251,252,253,.82); box-shadow: inset 0 1px 0 rgba(255,255,255,.75), 0 24px 70px rgba(26,32,37,.12); padding: 28px; backdrop-filter: blur(22px); }
    .brand { width: 48px; height: 42px; display: grid; place-items: center; border: 1px solid rgba(20,20,20,.12); border-radius: 13px; background: rgba(248,250,251,.82); font-weight: 800; margin-bottom: 22px; }
    h1 { margin: 0 0 8px; font-size: 30px; line-height: 1; letter-spacing: 0; }
    p { margin: 0 0 24px; color: rgba(20,20,20,.54); font-size: 14px; line-height: 1.45; }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 7px; color: rgba(20,20,20,.58); font-size: 12px; font-weight: 650; }
    input { width: 100%; height: 46px; border: 1px solid #e4e8eb; border-radius: 13px; background: rgba(248,250,251,.86); color: #111; padding: 0 14px; font: inherit; font-size: 16px; outline: none; }
    input:focus { border-color: rgba(20,20,20,.28); background: rgba(251,252,253,.96); }
    button { height: 46px; border: 0; border-radius: 13px; background: #171717; color: #fff; font: inherit; font-weight: 750; cursor: pointer; box-shadow: 0 16px 32px rgba(0,0,0,.16); }
    .error { min-height: 18px; color: #b84a4a; font-size: 13px; font-weight: 650; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">S.AI</div>
    <h1>Вход</h1>
    <p>Доступ к панели управления S.AI закрыт логином и паролем.</p>
    <form method="post" action="/login">
      <label>Логин<input name="username" autocomplete="username" autofocus></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password"></label>
      <div class="error">${error}</div>
      <button type="submit">Войти</button>
    </form>
  </main>
</body>
</html>`;
}

function requireAuth(req, res, next) {
  if (readSession(req)) return next();
  if (wantsJson(req)) {
    res.status(401).json({ ok: false, error: 'Auth required' });
    return;
  }
  res.redirect('/login');
}

function crmOk(res, data, page) {
  res.json({ ok: true, data, ...(page ? { page } : {}) });
}

function crmError(res, error, statusCode = 500) {
  const database = db.status();
  const code = database.enabled && !database.ready ? 503 : statusCode;
  res.status(code).json({
    ok: false,
    error: error.message,
    database,
  });
}

function crmHandler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (error) {
      crmError(res, error);
    }
  };
}

function getMskTime() {
  const now = new Date();
  const msk = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  const h = msk.getHours();
  let greeting = 'Добрый день';
  let period = 'day';
  if (h >= 5 && h < 12) { greeting = 'Доброе утро'; period = 'morning'; }
  else if (h >= 18 || h < 5) { greeting = 'Добрый вечер'; period = 'evening'; }
  const isNight = h >= 0 && h < 7;
  return {
    hour: h,
    minute: msk.getMinutes(),
    period,
    greeting,
    isNight,
    formatted: `${String(h).padStart(2, '0')}:${String(msk.getMinutes()).padStart(2, '0')} МСК`,
  };
}

// Check if we already greeted this customer recently
async function shouldSkipGreeting(chatDbId) {
  if (runtimeConfig.greeting_dedup_enabled === false) return false;
  const hours = Math.max(1, Math.min(24, Number(runtimeConfig.greeting_dedup_hours || 4)));
  try {
    const recentMessages = await db.getChatHistory(chatDbId, 10);
    if (!recentMessages.length) return false;
    const lastMsg = recentMessages[recentMessages.length - 1];
    if (!lastMsg || !lastMsg.created_at) return false;
    const hoursSinceLastMessage = (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60);
    return hoursSinceLastMessage < hours;
  } catch {
    return false;
  }
}

// Send a Telegram reaction (e.g. 👀 or 👍) on a message before replying
async function sendTelegramReaction({ chatId, messageId, emoji, businessConnectionId }) {
  if (!runtimeConfig.telegram_token || !messageId) return;
  try {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji: emoji || '👀' }],
    };
    if (businessConnectionId) payload.business_connection_id = businessConnectionId;
    await axios.post(telegramApi('setMessageReaction'), payload, { timeout: 5000 });
  } catch {
    // Reaction API may not be available for all chats — silently ignore
  }
}

function getReactionMode() {
  const mode = String(runtimeConfig.reaction_mode || 'smart').toLowerCase();
  return ['off', 'fixed', 'smart'].includes(mode) ? mode : 'smart';
}

function detectCheckoutLikeMessage(text = '') {
  const lines = String(text).split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const hasPhone = /\+?\d[\d()\-\s]{8,}/.test(text);
  const hasDeliveryWords = /(город|доставка|пвз|cdek|сдэк|ozon|wildberries|яндекс|почта|адрес|фио|телефон)/i.test(text);
  return (lines.length >= 3 && hasPhone) || (hasPhone && hasDeliveryWords);
}

function normalizePhoneValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
  return compact.replace(/\D/g, '');
}

function extractPhoneFromText(text = '') {
  const match = String(text || '').match(/(\+?\d[\d()\-\s]{8,}\d)/);
  return match ? normalizePhoneValue(match[1]) : '';
}

function parsePaymentAmount(text = '') {
  const match = String(text || '').match(/сумма\s+к\s+оплате\s*:\s*([\d\s]+)\s*₽/i);
  if (!match) return null;
  const digits = Number(String(match[1] || '').replace(/[^\d]/g, ''));
  return Number.isFinite(digits) && digits > 0 ? digits : null;
}

function isPaymentTemplateReply(replyMessages = []) {
  const joined = String((replyMessages || []).join('\n')).toLowerCase();
  return joined.includes('сумма к оплате')
    && joined.includes('реквизиты')
    && joined.includes('получатель');
}

function isReceiptLikeMessage(message = {}, text = '') {
  const lower = String(text || '').toLowerCase();
  if (/(перевел|перевела|оплатил|оплатила|чек|оплата прошла|сделал оплату|сделала оплату)/i.test(lower)) {
    return true;
  }
  const documentName = String(message.document?.file_name || '').toLowerCase();
  if (/(receipt|чек|pdf)/i.test(documentName)) return true;
  return false;
}

function summarizeOrderSnapshot(snapshot = {}) {
  const parts = [];
  if (snapshot.product_interest) parts.push(snapshot.product_interest);
  if (snapshot.shoe_size) parts.push(`${snapshot.shoe_size} размер`);
  if (snapshot.clothing_size) parts.push(`${snapshot.clothing_size} размер`);
  if (snapshot.city) parts.push(snapshot.city);
  return parts.join(' · ').slice(0, 500);
}

function pickSmartReaction({ chatId, texts, mediaFileId, stage, lastClientText }) {
  if (runtimeConfig.reaction_enabled === false) return null;
  if (getReactionMode() === 'off') return null;

  const probability = Math.max(0, Math.min(100, Number(runtimeConfig.reaction_probability || 28)));
  const cooldownMs = Math.max(15, Math.min(3600, Number(runtimeConfig.reaction_cooldown_sec || 180))) * 1000;
  const lastAt = recentReactions.get(String(chatId)) || 0;
  if (Date.now() - lastAt < cooldownMs) return null;

  const joined = String(texts.join('\n') || lastClientText || '');
  const lower = joined.toLowerCase();

  if (/(не обман|обман|дорого|подумаю|сомнева|возврат|жалоба|плохо|не устраивает|почему так|долго)/i.test(lower)) {
    return null;
  }

  let reaction = null;
  let chance = probability;

  if (mediaFileId) {
    reaction = '👀';
    chance = Math.max(probability, 65);
  } else if (/(чек|оплатил|оплатила|перевел|перевела|оплата прошла|сделал оплату|сделала оплату)/i.test(lower)) {
    reaction = '✅';
    chance = Math.max(probability, 80);
  } else if (detectCheckoutLikeMessage(joined) || stage === 'checkout') {
    reaction = '👍';
    chance = Math.max(probability, 55);
  } else if (/(беру|оформляем|давайте оформим|заказываю|хочу заказать|забираю|готов оформить)/i.test(lower)) {
    reaction = '🔥';
    chance = Math.max(probability, 58);
  } else if (/(спасибо|супер|отлично|класс|идеально|понял|поняла)/i.test(lower)) {
    reaction = '👍';
    chance = Math.max(probability, 35);
  }

  if (!reaction) return null;
  if (Math.random() * 100 > chance) return null;
  return reaction;
}

async function markTelegramBusinessMessageRead({ chatId, messageId, businessConnectionId, traceId }) {
  if (!runtimeConfig.telegram_token || !businessConnectionId || !messageId) return false;
  try {
    await axios.post(telegramApi('readBusinessMessage'), {
      business_connection_id: businessConnectionId,
      chat_id: chatId,
      message_id: messageId,
    }, { timeout: 5000 });
    logEvent('TG_MARK_READ', { traceId, chatId, businessConnectionId, messageId, ok: true });
    return true;
  } catch (error) {
    logEvent('TG_MARK_READ_ERROR', {
      traceId,
      chatId,
      businessConnectionId,
      messageId,
      error: error.message,
      providerError: error.response?.data || null,
    });
    return false;
  }
}

async function sendTelegramTyping({ chatId, businessConnectionId }) {
  const actionPayload = { chat_id: chatId, action: 'typing' };
  if (businessConnectionId) actionPayload.business_connection_id = businessConnectionId;
  await axios.post(telegramApi('sendChatAction'), actionPayload, { timeout: 5000 }).catch(() => {});
}

function estimateTypingMs(text, typingSpeedCps, nightMultiplier, vary) {
  const safeText = String(text || '');
  const charBasedMs = (safeText.length / Math.max(5, typingSpeedCps)) * 1000;
  const wordCount = safeText.trim() ? safeText.trim().split(/\s+/).length : 0;
  const punctuationPauses = (safeText.match(/[.,!?;:]/g) || []).length * 110;
  const wordThinkMs = wordCount * 45;
  const total = (charBasedMs + punctuationPauses + wordThinkMs) * vary() * nightMultiplier;
  return Math.max(700, Math.min(22000, Math.round(total)));
}

function estimateThinkingPauseMs({ text, index, totalMessages, readDelayMs, nightMultiplier, vary }) {
  const safeText = String(text || '');
  const charCount = safeText.length;
  const wordCount = safeText.trim() ? safeText.trim().split(/\s+/).length : 0;
  const isFirst = index === 0;
  const multiMessageBonus = totalMessages > 1 ? 140 : 0;
  const complexityBonus = Math.min(700, wordCount * 18 + Math.floor(charCount / 9));
  const base = isFirst ? Math.max(220, readDelayMs * 0.28) : 180;
  const total = (base + multiMessageBonus + complexityBonus) * vary() * nightMultiplier;
  return Math.max(isFirst ? 320 : 180, Math.min(isFirst ? 1800 : 1100, Math.round(total)));
}

function estimateBetweenMessagesMs({ previousText, nextText, betweenDelayMs, nightMultiplier, vary }) {
  const prevLen = String(previousText || '').length;
  const nextLen = String(nextText || '').length;
  const bridgeMs = Math.min(900, Math.round(prevLen * 2.8 + nextLen * 1.6));
  const total = (betweenDelayMs * 0.35 + bridgeMs) * vary() * nightMultiplier;
  return Math.max(350, Math.min(2600, Math.round(total)));
}

function shouldForceSingleTemplateReply(items) {
  if (!Array.isArray(items) || items.length < 2) return false;
  const joined = items.join('\n').toLowerCase();
  const paymentHits = [
    'сумма к оплате',
    'способ оплаты',
    'реквизиты:',
    'получатель:',
    'банк:',
    'жду ваш чек',
  ].filter((token) => joined.includes(token)).length;
  if (paymentHits >= 3) return true;

  const deliveryHits = [
    'для оформления заказа',
    'фио полностью',
    'номер телефона',
    'город доставки',
    'удобная служба доставки',
    'адрес выбранного пвз',
    'обратите внимание:',
  ].filter((token) => joined.includes(token)).length;
  if (deliveryHits >= 3) return true;

  const numberedLines = items.filter((item) => /^\d+\.\s/.test(item)).length;
  if (numberedLines >= 3) return true;

  return false;
}

function collapseReplyMessages(replyMessages, { preferSingle = false } = {}) {
  const items = Array.isArray(replyMessages)
    ? replyMessages.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!items.length) return [];
  if (!preferSingle && !shouldForceSingleTemplateReply(items)) return items;
  return [items.join('\n\n')];
}

async function simulateTelegramTyping({ chatId, businessConnectionId, durationMs }) {
  const totalMs = Math.max(0, Number(durationMs || 0));
  if (!totalMs) return;
  const actionTtlMs = 4500;
  let remaining = totalMs;
  while (remaining > 0) {
    await sendTelegramTyping({ chatId, businessConnectionId });
    const chunk = Math.min(actionTtlMs, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
}

function getSellerControlMtime() {
  try { return fs.statSync(AI_SELLER_CONTROL_FILE).mtimeMs; } catch { return 0; }
}

function getCatalogMtime() {
  try { return fs.statSync(PRODUCT_CATALOG_FILE).mtimeMs; } catch { return 0; }
}

function compileSystemPrompt(sellerControl, context = {}) {
  const msk = getMskTime();
  const catalog = loadProductCatalog().filter((p) => p.in_stock);
  const greetingDedupHours = Math.max(1, Math.min(24, Number(runtimeConfig.greeting_dedup_hours || 4)));
  
  // Build cache key from: control file mtime + catalog mtime + context keys (skipGreeting, funnelStage)
  const controlMtime = getSellerControlMtime();
  const catalogMtime = getCatalogMtime();
  const contextKey = [context.skipGreeting ? 1 : 0, context.funnelStage || '', msk.hour].join('|');
  const cacheKey = `${controlMtime}|${catalogMtime}|${contextKey}`;
  
  if (promptCache.hash === cacheKey && promptCache.prompt) {
    return promptCache.prompt;
  }
  
  const parts = [];

  parts.push('Ты — AI-агент личного менеджера магазина в Telegram. Клиент пишет тебе в личные сообщения. Ты общаешься на вы, коротко, по-человечески. Ты не бот и не скрипт.');

  // Greeting logic: skip if already greeted recently
  if (context.skipGreeting) {
    parts.push(`Сейчас ${msk.formatted}. Клиент уже общался с вами недавно, в пределах последних ${greetingDedupHours} ч — НЕ начинай с приветствия, даже если он снова написал «Привет» или «Здравствуйте». Продолжай разговор естественно и сразу отвечай по сути.`);
  } else {
    parts.push(`Сейчас ${msk.formatted}. Правило приветствия: если клиент не писал дольше ${greetingDedupHours} ч, это можно считать новым касанием. Тогда зеркаль стиль клиента. Если клиент написал «Привет» — ответь «Привет». Если клиент написал без приветствия — поздоровайся по времени суток: «${msk.greeting}». Затем СРАЗУ вопрос или ответ по делу. Никогда не отправляй одно приветствие без полезной информации.`);
  }

  const foundation = (sellerControl.foundation || []).filter((b) => b.enabled && b.body);
  for (const block of foundation) {
    parts.push(`### ${block.title}\n${block.body}`);
  }

  const funnel = (sellerControl.funnel || []).filter((s) => s.enabled);
  if (funnel.length) {
    const stage = context.funnelStage || '';
    const activeStage = stage ? funnel.find((s) => s.id === stage) : null;
    parts.push('### Этапы воронки продаж');
    parts.push(funnel.map((s) => `- ${s.title}: ${s.goal}`).join('\n'));
    if (activeStage) {
      parts.push(`\n### Текущий этап: ${activeStage.title}`);
      if (activeStage.actions) parts.push(`Действия:\n${activeStage.actions}`);
      if (activeStage.questions) parts.push(`Вопросы:\n${activeStage.questions}`);
      if (activeStage.forbidden) parts.push(`Запрещено:\n${activeStage.forbidden}`);
      if (activeStage.handoff) parts.push(`Передача человеку:\n${activeStage.handoff}`);
    }
  }

  const objections = (sellerControl.objections || []).filter((b) => b.enabled && b.body);
  for (const block of objections) {
    parts.push(`### ${block.title}\n${block.body}`);
  }

  // Product catalog — inject into system prompt
  if (catalog.length > 0) {
    const catalogLines = catalog.map((p) => {
      let line = `- ${p.name}: ${p.price}`;
      if (p.sizes && p.sizes.length > 0) line += ` (размеры: ${p.sizes.join(', ')})`;
      if (p.description) line += ` — ${p.description}`;
      return line;
    });
    parts.push(`### Каталог товаров\nВот товары, которые есть в наличии:\n${catalogLines.join('\n')}`);
  }

  const hasPhotoCatalog = catalog.some((p) => p.photo_url);
  const sendPhotoInstruction = hasPhotoCatalog
    ? '\n- send_photo — id товара из каталога, если стоит показать фото клиенту (необязательно, null если не нужно)'
    : '';

  parts.push(`### Формат ответа
Ты ОБЯЗАН ответить ТОЛЬКО валидным JSON без markdown-обёрток. Формат:
{
  "reply": ["сообщение1", "сообщение2"],
  "facts": {"ключ": "значение"},
  "stage": "id этапа",
  "decision": "reply",
  "needs_human": false,
  "needs_human_reason": null${hasPhotoCatalog ? ',\n  "send_photo": null' : ''}
}

Правила:
- reply — массив коротких сообщений
- facts — новые факты о клиенте
- stage: first_touch|interest|trust|decision|checkout|support|return_conflict
- decision: reply|wait|skip|escalate
- needs_human — true если нужен менеджер${sendPhotoInstruction}`);

  const finalPrompt = parts.join('\n\n');
  promptCache.hash = cacheKey;
  promptCache.prompt = finalPrompt;
  return finalPrompt;
}

async function compileAiRequest({ chatDbId, customerId, inputText, traceId, mediaFileId = null }) {
  const sellerControl = loadAiSellerControl();
  const memorySummary = await db.buildMemorySummary(customerId);
  const history = await db.getChatHistory(chatDbId, 50);
  const customerFacts = await db.getCustomerFacts(customerId);
  const iwakContext = await buildIwakContextFromText(inputText, traceId);
  const currentStage = customerFacts.find((f) => f.key === 'funnel_stage')?.value || '';
  const skipGreeting = await shouldSkipGreeting(chatDbId);
  const requestModel = mediaFileId && runtimeConfig.vision_enabled !== false
    ? String(runtimeConfig.vision_model || runtimeConfig.model || '').trim()
    : String(runtimeConfig.model || '').trim();

  // If the dialog is already active, suppress first_touch stage to avoid re-greeting
  const effectiveStage = skipGreeting && currentStage === 'first_touch' ? '' : currentStage;

  const systemPrompt = compileSystemPrompt(sellerControl, { funnelStage: effectiveStage, skipGreeting });

  const messages = [{ role: 'system', content: systemPrompt }];
  if (memorySummary) {
    messages.push({ role: 'system', content: `Память о клиенте:\n${memorySummary}` });
  }
  const batchedLines = String(inputText || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (batchedLines.length > 1) {
    messages.push({
      role: 'system',
      content: 'Клиент отправил несколько коротких сообщений подряд. Воспринимай их как одну общую мысль и отвечай одним цельным сообщением по суммарному смыслу, а не отдельной репликой на каждую строку.',
    });
  }
  if (mediaFileId && runtimeConfig.vision_enabled !== false) {
    messages.push({
      role: 'system',
      content: [
        'Клиент прислал фото.',
        'Если на фото товар и точная модель неочевидна, не выдумывай уверенное название.',
        'Вместо этого используй честную формулировку вроде «похоже на ...» и предложи проверить наличие на складе.',
        'Если есть риск перепутать близкие линейки вроде Balenciaga 3XL / Track / Runner, не называй конкретную линейку вообще.',
        'Если товар не найден в явном каталоге или нет ссылки iwak.ru, не обещай наличие сразу.',
        'Предпочтительный fallback-ответ: коротко описать, на что похож товар, и сказать, что такие позиции не всегда успевают попасть на витрину, поэтому ты уточнишь по складу и вернёшься чуть позже.',
      ].join(' '),
    });
  }
  if (iwakContext) {
    messages.push({
      role: 'system',
      content: `Контекст товара по ссылке iwak.ru:\n${JSON.stringify(iwakContext, null, 2)}`,
    });
  }
  for (const msg of history) {
    const role = msg.role === 'assistant' || msg.role === 'operator' ? 'assistant' : 'user';
    if (msg.text) messages.push({ role, content: msg.text });
  }

  // Vision: if there's a photo and vision is enabled, build multimodal user message
  let visionUsed = false;
  if (mediaFileId && runtimeConfig.vision_enabled !== false) {
    const dataUri = await downloadTelegramFileBase64(mediaFileId);
    if (dataUri) {
      const contentParts = [];
      if (inputText) contentParts.push({ type: 'text', text: inputText });
      else contentParts.push({ type: 'text', text: 'Клиент прислал фото. Опиши что видишь и ответь в контексте нашего магазина.' });
      contentParts.push({ type: 'image_url', image_url: { url: dataUri } });
      messages.push({ role: 'user', content: contentParts });
      visionUsed = true;
      logEvent('VISION_ATTACHED', { traceId, mediaFileId, dataUriLen: dataUri.length });
    } else {
      // Vision download failed — fallback to text
      messages.push({ role: 'user', content: inputText || '[Клиент прислал фото, но его не удалось загрузить]' });
    }
  } else {
    messages.push({ role: 'user', content: inputText });
  }

  const activeBlocks = (sellerControl.foundation || []).filter((b) => b.enabled).map((b) => b.id);
  const activeStages = (sellerControl.funnel || []).filter((s) => s.enabled).map((s) => s.id);

  return {
    messages,
    metadata: {
      systemPromptLength: systemPrompt.length,
      activeBlocks,
      activeStages,
      currentStage,
      memorySummary: memorySummary || '',
      historyLength: history.length,
      model: runtimeConfig.model,
      requestModel,
      visionUsed,
      iwakContext,
    },
  };
}

function parseStructuredResponse(rawReply) {
  try {
    let text = rawReply.trim();
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();
    const parsed = JSON.parse(text);
    const reply = Array.isArray(parsed.reply) ? parsed.reply.map((s) => String(s).trim()).filter(Boolean) : [String(parsed.reply || text)];
    return {
      reply,
      facts: parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {},
      stage: String(parsed.stage || ''),
      decision: ['reply', 'wait', 'skip', 'escalate'].includes(parsed.decision) ? parsed.decision : 'reply',
      needsHuman: Boolean(parsed.needs_human),
      needsHumanReason: parsed.needs_human_reason || null,
      sendPhoto: parsed.send_photo ? String(parsed.send_photo) : null,
      parsedOk: true,
    };
  } catch {
    return {
      reply: [rawReply.trim()],
      facts: {},
      stage: '',
      decision: 'reply',
      needsHuman: false,
      needsHumanReason: null,
      sendPhoto: null,
      parsedOk: false,
    };
  }
}

async function requestAi(compiledMessages, traceId, context = {}) {
  if (!runtimeConfig.ai_key) throw new Error('AI key is missing');
  const baseUrl = String(runtimeConfig.ai_url || '').replace(/\/+$/, '');
  const startedAt = Date.now();
  const requestModel = String(context.modelOverride || runtimeConfig.model || '').trim();
  const payload = {
    model: requestModel,
    messages: compiledMessages,
    temperature: 0.75,
  };
  logEvent('AI_REQUEST', {
    traceId,
    model: requestModel,
    messages: compiledMessages.length,
  });
  emitLive('ai.requested', {
    traceId,
    chatId: context.chatDbId || null,
    model: requestModel,
  });
  try {
    const response = await axios.post(`${baseUrl}/chat/completions`, payload, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${runtimeConfig.ai_key}`,
        'Content-Type': 'application/json',
      },
    });
    const rawReply = String(response.data?.choices?.[0]?.message?.content || '').trim();
    if (!rawReply) throw new Error('AI returned empty reply');
    const latencyMs = Date.now() - startedAt;
    const structured = parseStructuredResponse(rawReply);
    if (!structured.parsedOk) {
      logEvent('STRUCTURED_PARSE_FAIL', { traceId, rawReply: rawReply.slice(0, 500) });
    }
    logEvent('AI_REPLY', { traceId, structured, latencyMs });
    emitLive('ai.replied', { traceId, chatId: context.chatDbId || null, latencyMs });
    db.recordAiTurn({
      chatId: context.chatDbId || null,
      traceId,
      model: requestModel,
      requestMessages: compiledMessages,
      responseText: rawReply,
      latencyMs,
      ok: true,
      compiledPrompt: context.compiledPrompt || null,
      memorySummary: context.memorySummary || null,
      inputText: context.inputText || null,
      historyLength: context.historyLength || null,
      structuredResponse: structured,
    }).catch(() => {});
    return { rawReply, structured, latencyMs };
  } catch (error) {
    emitLive('ai.error', { traceId, chatId: context.chatDbId || null, error: error.message });
    db.recordAiTurn({
      chatId: context.chatDbId || null,
      traceId,
      model: requestModel,
      requestMessages: compiledMessages,
      responseText: '',
      latencyMs: Date.now() - startedAt,
      ok: false,
      error: error.message,
      compiledPrompt: context.compiledPrompt || null,
      memorySummary: context.memorySummary || null,
      inputText: context.inputText || null,
      historyLength: context.historyLength || null,
    }).catch(() => {});
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendHumanizedReply({ chatId, chatDbId, customerId, replyMessages, businessConnectionId, traceId, lastMessageId, sendPhotoId = null, reactionEmoji = null, processingState = null }) {
  if (!runtimeConfig.telegram_token) throw new Error('Telegram token is missing');
  const readDelayMs = Number(runtimeConfig.read_delay_ms || 800);
  const typingSpeedCps = Number(runtimeConfig.typing_speed_cps || 60);
  const betweenDelayMs = Number(runtimeConfig.between_messages_delay_ms || 1200);
  const nightMultiplier = 1;

  // Variability: ±30% random on all timings
  const vary = () => 0.7 + Math.random() * 0.6;

  // Step 1: "Read" the message — short pause before reaction
  await sleep(Math.round(readDelayMs * vary() * nightMultiplier));

  // Step 1.5: for Telegram Business, first mark the incoming message as read,
  // let the UI show the second tick, and only then move into reaction/typing.
  if (lastMessageId && businessConnectionId) {
    await markTelegramBusinessMessageRead({
      chatId,
      messageId: lastMessageId,
      businessConnectionId,
      traceId,
    });
    await sleep(Math.round((320 + Math.random() * 380) * nightMultiplier));
  }

  // Step 2: Put a reaction on the last message — humans do this (only if enabled)
  if (lastMessageId && runtimeConfig.reaction_enabled !== false) {
    const mode = getReactionMode();
    const emoji = reactionEmoji || (mode === 'fixed' ? String(runtimeConfig.reaction_emoji || '👀') : '');
    if (emoji) {
      await sendTelegramReaction({ chatId, messageId: lastMessageId, emoji, businessConnectionId });
      recentReactions.set(String(chatId), Date.now());
      logEvent('TG_REACTION_SENT', { traceId, chatId, businessConnectionId, messageId: lastMessageId, emoji, mode });
      await sleep(Math.round((420 + Math.random() * 780) * nightMultiplier));
    }
  }

  // Step 3 (optional): Send product photo before reply
  if (sendPhotoId) {
    const catalog = loadProductCatalog();
    const product = catalog.find((p) => p.id === sendPhotoId);
    if (product && product.photo_url) {
      const photoResult = await sendTelegramPhoto({
        chatId,
        photoSource: product.photo_url,
        caption: product.name || '',
        businessConnectionId,
      });
      if (photoResult) {
        logEvent('TG_SEND_PHOTO', { traceId, chatId, productId: sendPhotoId, telegramOk: photoResult?.ok });
        await db.recordMessage({
          chatId: chatDbId,
          customerId,
          direction: 'out',
          role: 'assistant',
          text: `[фото товара: ${product.name}]`,
          telegramMessageId: photoResult?.result?.message_id || null,
          traceId,
          raw: photoResult?.result || photoResult,
        });
        emitLive('message.created', { traceId, chatId: chatDbId, customerId, direction: 'out', role: 'assistant', source: 'telegram' });
        await sleep(Math.round((1000 + Math.random() * 1000) * nightMultiplier));
      }
    }
  }

  for (let i = 0; i < replyMessages.length; i++) {
    if (processingState?.cancelled) {
      logEvent('TG_SEND_ABORTED', {
        traceId,
        chatId,
        reason: 'new_message_during_send',
        sentParts: i,
        totalParts: replyMessages.length,
      });
      break;
    }
    const text = replyMessages[i];
    const thinkingMs = estimateThinkingPauseMs({
      text,
      index: i,
      totalMessages: replyMessages.length,
      readDelayMs,
      nightMultiplier,
      vary,
    });
    await sleep(thinkingMs);
    const typingMs = estimateTypingMs(text, typingSpeedCps, nightMultiplier, vary);
    await simulateTelegramTyping({ chatId, businessConnectionId, durationMs: typingMs });

    const sendPayload = { chat_id: chatId, text };
    if (businessConnectionId) sendPayload.business_connection_id = businessConnectionId;
    const response = await axios.post(telegramApi('sendMessage'), sendPayload, { timeout: REQUEST_TIMEOUT_MS });

    logEvent('TG_SEND', { traceId, chatId, businessConnectionId, text, part: i + 1, total: replyMessages.length, telegramOk: response.data?.ok === true });

    await db.recordMessage({
      chatId: chatDbId,
      customerId,
      direction: 'out',
      role: 'assistant',
      text,
      telegramMessageId: response.data?.result?.message_id || null,
      traceId,
      raw: response.data?.result || response.data,
    });

    emitLive('message.created', { traceId, chatId: chatDbId, customerId, direction: 'out', role: 'assistant', source: 'telegram' });

    if (i < replyMessages.length - 1) {
      if (processingState?.cancelled) {
        logEvent('TG_SEND_ABORTED', {
          traceId,
          chatId,
          reason: 'new_message_after_partial_send',
          sentParts: i + 1,
          totalParts: replyMessages.length,
        });
        break;
      }
      const gapMs = estimateBetweenMessagesMs({
        previousText: text,
        nextText: replyMessages[i + 1],
        betweenDelayMs,
        nightMultiplier,
        vary,
      });
      await sleep(gapMs);
    }
  }

  emitLive('telegram.sent', { traceId, chatId: chatDbId, externalChatId: String(chatId), telegramOk: true });
}

async function sendTelegramMessage({ chatId, chatDbId = null, customerId = null, text, businessConnectionId, traceId, role = 'assistant' }) {
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
  await db.recordMessage({
    chatId: chatDbId,
    customerId,
    direction: 'out',
    role,
    text,
    telegramMessageId: response.data?.result?.message_id || null,
    traceId,
    raw: response.data?.result || response.data,
  });
  emitLive('message.created', {
    traceId,
    chatId: chatDbId,
    customerId,
    direction: 'out',
    role,
    source: 'telegram',
  });
  emitLive('telegram.sent', {
    traceId,
    chatId: chatDbId,
    externalChatId: String(chatId),
    telegramOk: response.data?.ok === true,
  });
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

app.get('/login', (req, res) => {
  if (readSession(req)) {
    res.redirect('/');
    return;
  }
  res.type('html').send(loginPage());
});

app.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!AUTH_PASSWORD) {
    res.status(503).type('html').send(loginPage('Пароль доступа не настроен на сервере.'));
    return;
  }
  if (!safeEqual(username, AUTH_USER) || !safeEqual(password, AUTH_PASSWORD)) {
    logEvent('AUTH_FAILED', { username });
    res.status(401).type('html').send(loginPage('Неверный логин или пароль.'));
    return;
  }
  const token = createSession();
  logEvent('AUTH_LOGIN', { username });
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie || '')[AUTH_COOKIE] || '';
  const [id] = token.split('.');
  if (id) authSessions.delete(id);
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.redirect('/login');
});

app.get('/auth/status', (req, res) => {
  res.json({ ok: true, authenticated: Boolean(readSession(req)), user: readSession(req) ? AUTH_USER : '' });
});

app.use((req, res, next) => {
  if (req.path === '/health' || req.path === '/login' || req.path === '/auth/status') return next();
  if (req.path === '/api/telegram/webhook') return next();
  return requireAuth(req, res, next);
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
  const allowed = [
    'telegram_token', 'webhook_url', 'ai_key', 'ai_url', 'model', 'vision_model', 'auto_reply_enabled',
    'manager_passive_seconds', 'read_delay_ms', 'typing_speed_cps', 'between_messages_delay_ms',
    'greeting_dedup_enabled', 'greeting_dedup_hours',
    'reaction_enabled', 'reaction_mode', 'reaction_emoji', 'reaction_probability', 'reaction_cooldown_sec', 'debounce_ms',
    'vision_enabled',
  ];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key)) runtimeConfig[key] = body[key];
  }
  runtimeConfig.auto_reply_enabled = runtimeConfig.auto_reply_enabled !== false;
  writeJson(CONFIG_FILE, runtimeConfig);
  logEvent('CONFIG_UPDATE', { keys: Object.keys(body).filter((key) => allowed.includes(key)) });
  res.json({ ok: true, config: publicConfig() });
});

app.get('/api/ai-seller/control', (req, res) => {
  res.json({
    ok: true,
    data: loadAiSellerControl(),
    production_effect: aiSellerRuntimeStatus().production_effect,
    runtime: aiSellerRuntimeStatus(),
  });
});

app.post('/api/ai-seller/control', (req, res) => {
  const nextControl = normalizeAiSellerControl(req.body || {});
  nextControl.updated_at = new Date().toISOString();
  writeJson(AI_SELLER_CONTROL_FILE, nextControl);
  logEvent('AI_SELLER_CONTROL_UPDATE', {
    foundation: nextControl.foundation.map((block) => block.id),
    funnel: nextControl.funnel.map((stage) => stage.id),
    memory: nextControl.memory.map((block) => block.id),
    objections: nextControl.objections.map((block) => block.id),
    polygon: nextControl.polygon.map((block) => block.id),
    production_effect: false,
  });
  res.json({
    ok: true,
    data: nextControl,
    production_effect: aiSellerRuntimeStatus().production_effect,
    runtime: aiSellerRuntimeStatus(),
  });
});

// Product catalog API
app.get('/api/products', (req, res) => {
  res.json({ ok: true, items: loadProductCatalog() });
});

app.post('/api/products', (req, res) => {
  const items = saveProductCatalog(req.body?.items || req.body || []);
  logEvent('PRODUCTS_UPDATE', { count: items.length });
  res.json({ ok: true, items });
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

app.get('/api/crm/overview', crmHandler(async (req, res) => {
  crmOk(res, await db.crmOverview());
}));

app.get('/api/crm/live', (req, res) => {
  const clientId = createTraceId();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ type: 'connected', time: new Date().toISOString(), clientId })}\n\n`);
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ type: 'heartbeat', time: new Date().toISOString(), clientId })}\n\n`);
  }, 10000);
  liveClients.set(clientId, res);
  req.on('close', () => {
    clearInterval(heartbeat);
    liveClients.delete(clientId);
  });
});

app.get('/api/crm/chats', crmHandler(async (req, res) => {
  const result = await db.listCrmChats({
    status: req.query.status ? String(req.query.status) : '',
    source: req.query.source ? String(req.query.source) : '',
    aiEnabled: parseBool(req.query.ai_enabled),
    q: req.query.q ? String(req.query.q) : '',
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  crmOk(res, result.items, result.page);
}));

app.get('/api/crm/chats/:chatId', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  const [facts, orders, orderStats] = chat.customer_id
    ? await Promise.all([
        db.getCustomerFacts(chat.customer_id),
        db.listCustomerOrders(chat.customer_id, 20),
        db.getCustomerOrderStats(chat.customer_id),
      ])
    : [[], [], { orders_total: 0, paid_orders: 0, paid_amount_total: 0 }];
  const phoneFact = facts.find((fact) => ['phone', 'phone_number', 'customer_phone'].includes(String(fact.key || '')));
  crmOk(res, {
    ...chat,
    phone: chat.phone || phoneFact?.value || '',
    facts,
    orders,
    order_stats: orderStats,
  });
}));

app.get('/api/crm/chats/:chatId/messages', crmHandler(async (req, res) => {
  const result = await db.listCrmMessages(req.params.chatId, {
    direction: req.query.direction ? String(req.query.direction) : '',
    role: req.query.role ? String(req.query.role) : '',
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  crmOk(res, result.items, result.page);
}));

app.get('/api/crm/chats/:chatId/ai-turns', crmHandler(async (req, res) => {
  const result = await db.listCrmAiTurns(req.params.chatId, {
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  crmOk(res, result.items, result.page);
}));

app.get('/api/crm/chats/:chatId/events', crmHandler(async (req, res) => {
  const result = await db.listCrmEvents(req.params.chatId, {
    limit: req.query.limit,
    cursor: req.query.cursor,
  });
  crmOk(res, result.items, result.page);
}));

app.patch('/api/crm/chats/:chatId', crmHandler(async (req, res) => {
  const chat = await db.updateCrmChat(req.params.chatId, req.body || {});
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  logEvent('CRM_CHAT_UPDATE', {
    chatDbId: req.params.chatId,
    keys: Object.keys(req.body || {}),
  });
  emitLive('chat.updated', { chatId: chat.id, source: chat.source, reason: 'crm.patch' });
  crmOk(res, chat);
}));

app.post('/api/crm/chats/:chatId/send', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  const text = String(req.body?.text || '').trim();
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  if (!text) {
    res.status(400).json({ ok: false, error: 'Text is required' });
    return;
  }
  if (chat.source !== 'telegram') {
    res.status(400).json({ ok: false, error: 'Manual send is available only for Telegram chats now' });
    return;
  }
  const traceId = createTraceId();
  await sendTelegramMessage({
    chatId: chat.external_chat_id,
    chatDbId: chat.id,
    customerId: chat.customer_id,
    text,
    businessConnectionId: chat.business_connection_id,
    traceId,
    role: 'operator',
  });
  if (isPaymentTemplateReply([text]) && chat.customer_id) {
    const snapshot = await db.getCustomerSnapshot(chat.customer_id);
    await db.upsertOrderDraft({
      customerId: chat.customer_id,
      chatId: chat.id,
      source: 'telegram',
      traceId,
      totalAmount: parsePaymentAmount(text),
      currency: 'RUB',
      summary: summarizeOrderSnapshot(snapshot),
      snapshot,
      paymentMessageId: null,
    });
  }
  // CRM manual send also activates passive mode and clears escalation
  const chatKey = String(chat.external_chat_id);
  passiveChats.set(chatKey, { lastManagerAt: Date.now(), managerUserId: 'crm' });
  escalatedChats.delete(chatKey);
  logEvent('CRM_MANUAL_SEND', {
    traceId,
    chatDbId: chat.id,
    externalChatId: chat.external_chat_id,
    text,
  });
  emitLive('chat.updated', { traceId, chatId: chat.id, source: chat.source, reason: 'crm.manual_send' });
  crmOk(res, { traceId });
}));

app.get('/api/crm/chats/:chatId/ai-status', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  const status = getChatAiStatus(chat.external_chat_id);
  crmOk(res, status);
}));

app.post('/api/crm/chats/:chatId/ai-pause', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  const chatKey = String(chat.external_chat_id);
  pausedChats.set(chatKey, { pausedAt: Date.now(), pausedBy: 'crm' });
  // Cancel pending AI
  const pending = aiProcessing.get(chatKey);
  if (pending) pending.cancelled = true;
  const buf = debounceBuffers.get(chatKey);
  if (buf) { clearTimeout(buf.timer); debounceBuffers.delete(chatKey); }
  logEvent('AI_PAUSED_MANUAL', { chatId: chatKey, chatDbId: chat.id });
  emitLive('chat.updated', { chatId: chat.id, source: chat.source, reason: 'ai.paused' });
  crmOk(res, getChatAiStatus(chat.external_chat_id));
}));

app.post('/api/crm/chats/:chatId/ai-resume', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  const chatKey = String(chat.external_chat_id);
  pausedChats.delete(chatKey);
  passiveChats.delete(chatKey);
  escalatedChats.delete(chatKey);
  logEvent('AI_RESUMED_MANUAL', { chatId: chatKey, chatDbId: chat.id });
  emitLive('chat.updated', { chatId: chat.id, source: chat.source, reason: 'ai.resumed' });
  crmOk(res, getChatAiStatus(chat.external_chat_id));
}));

app.post('/api/crm/chats/:chatId/reset-history', crmHandler(async (req, res) => {
  const chat = await db.getCrmChat(req.params.chatId);
  if (!chat) {
    res.status(404).json({ ok: false, error: 'Chat not found' });
    return;
  }
  // Cancel any pending AI processing for this chat
  const chatKey = String(chat.external_chat_id);
  const pending = aiProcessing.get(chatKey);
  if (pending) pending.cancelled = true;
  const buf = debounceBuffers.get(chatKey);
  if (buf) { clearTimeout(buf.timer); debounceBuffers.delete(chatKey); }
  const result = await db.resetChatHistory(req.params.chatId);
  logEvent('CRM_CHAT_HISTORY_RESET', {
    chatId: chat.external_chat_id,
    chatDbId: chat.id,
    customerId: result.customerId || null,
    deleted: result.deleted,
  });
  emitLive('chat.updated', { chatId: chat.id, source: chat.source, reason: 'history.reset' });
  crmOk(res, result);
}));

app.get('/api/crm/escalations', crmHandler(async (req, res) => {
  const list = [];
  for (const [chatId, esc] of escalatedChats.entries()) {
    list.push({ externalChatId: chatId, ...esc });
  }
  crmOk(res, list);
}));

app.patch('/api/crm/customers/:customerId', crmHandler(async (req, res) => {
  const customerId = await db.updateCrmCustomer(req.params.customerId, req.body || {});
  if (!customerId) {
    res.status(404).json({ ok: false, error: 'Customer not found' });
    return;
  }
  logEvent('CRM_CUSTOMER_UPDATE', {
    customerId,
    keys: Object.keys(req.body || {}),
  });
  emitLive('chat.updated', { customerId, reason: 'customer.patch' });
  crmOk(res, { id: customerId });
}));

app.get('/api/telegram/avatar/:fileId', async (req, res) => {
  if (!runtimeConfig.telegram_token) {
    res.sendStatus(404);
    return;
  }
  try {
    const fileResponse = await axios.get(telegramApi('getFile'), {
      timeout: 8000,
      params: { file_id: req.params.fileId },
    });
    const filePath = fileResponse.data?.result?.file_path || '';
    if (!filePath) {
      res.sendStatus(404);
      return;
    }
    const imageResponse = await axios.get(`https://api.telegram.org/file/bot${runtimeConfig.telegram_token}/${filePath}`, {
      timeout: 12000,
      responseType: 'arraybuffer',
    });
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type(contentType).send(Buffer.from(imageResponse.data));
  } catch (error) {
    logEvent('TG_AVATAR_PROXY_ERROR', {
      fileId: req.params.fileId,
      error: error.message,
      providerError: error.response?.data || null,
    });
    res.sendStatus(404);
  }
});

app.get('/api/telegram/file/:fileId', async (req, res) => {
  if (!runtimeConfig.telegram_token) {
    res.sendStatus(404);
    return;
  }
  try {
    const fileResponse = await axios.get(telegramApi('getFile'), {
      timeout: 8000,
      params: { file_id: req.params.fileId },
    });
    const filePath = fileResponse.data?.result?.file_path || '';
    if (!filePath) {
      res.sendStatus(404);
      return;
    }
    const file = await axios.get(`https://api.telegram.org/file/bot${runtimeConfig.telegram_token}/${filePath}`, {
      timeout: 20000,
      responseType: 'arraybuffer',
    });
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.oga': 'audio/ogg',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/ogg',
      '.webm': 'video/webm',
      '.pdf': 'application/pdf',
    }[ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type(type).send(Buffer.from(file.data));
  } catch (error) {
    logEvent('TG_FILE_PROXY_ERROR', {
      fileId: req.params.fileId,
      error: error.message,
      providerError: error.response?.data || null,
    });
    res.sendStatus(404);
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
    const sellerControl = loadAiSellerControl();
    const systemPrompt = compileSystemPrompt(sellerControl, {});
    const iwakContext = await buildIwakContextFromText(text, traceId);
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: text }];
    if (iwakContext) {
      messages.splice(1, 0, {
        role: 'system',
        content: `Контекст товара по ссылке iwak.ru:\n${JSON.stringify(iwakContext, null, 2)}`,
      });
    }
    const { structured, latencyMs } = await requestAi(messages, traceId, {
      compiledPrompt: systemPrompt,
      inputText: text,
      historyLength: history.length,
      iwakContext,
    });
    logEvent('TEST_OUT', { traceId, structured });
    res.json({
      ok: true,
      traceId,
      reply: structured.reply.join('\n\n'),
      structured,
      latencyMs,
      iwakContext,
      compiledPromptPreview: systemPrompt.slice(0, 800),
    });
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

async function processBatchedMessages(bufferKey, buffer) {
  const { texts, traceId, chatDbId, customerId, chatId, businessConnectionId, lastMessageId, mediaFileId } = buffer;
  const combinedText = texts.join('\n');
  const processingState = { cancelled: false, traceId };
  aiProcessing.set(bufferKey, processingState);
  try {
    // Guard: check if chat was paused/passive while waiting in debounce
    if (pausedChats.has(bufferKey)) {
      logEvent('BATCH_SKIPPED', { traceId, chatId, reason: 'chat_paused' });
      return;
    }

    logEvent('BATCH_PROCESS', { traceId, chatId, texts: texts.length, combinedText, hasMedia: Boolean(mediaFileId) });
    const compiled = await compileAiRequest({ chatDbId, customerId, inputText: combinedText, traceId, mediaFileId });
    logEvent('AI_COMPILED', { traceId, metadata: compiled.metadata });

    if (processingState.cancelled) {
      logEvent('AI_CANCELLED', { traceId, chatId, reason: 'new_message_during_compile' });
      return;
    }

    const { structured } = await requestAi(compiled.messages, traceId, {
      chatDbId,
      compiledPrompt: compiled.messages[0]?.content || '',
      memorySummary: compiled.metadata.memorySummary || '',
      inputText: combinedText,
      historyLength: compiled.metadata.historyLength || 0,
      modelOverride: compiled.metadata.requestModel || runtimeConfig.model,
    });

    if (processingState.cancelled) {
      logEvent('AI_CANCELLED', { traceId, chatId, reason: 'new_message_during_ai' });
      return;
    }

    if (structured.decision === 'skip') {
      logEvent('AI_DECISION_SKIP', { traceId, chatId });
      emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'ai.skip' });
      return;
    }
    if (structured.decision === 'wait') {
      logEvent('AI_DECISION_WAIT', { traceId, chatId });
      emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'ai.wait' });
      return;
    }
    if (structured.decision === 'escalate' || structured.needsHuman) {
      // Save escalation to Map so CRM shows it
      escalatedChats.set(bufferKey, {
        at: Date.now(),
        reason: structured.needsHumanReason || 'AI requested manager',
        traceId,
        chatDbId,
      });
      logEvent('AI_DECISION_ESCALATE', { traceId, chatId, reason: structured.needsHumanReason });
      emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'ai.escalate' });
      return;
    }

    const factsEntries = Object.entries(structured.facts || {});
    for (const [key, value] of factsEntries) {
      if (!value) continue;
      const normalizedValue = typeof value === 'string'
        ? value
        : JSON.stringify(value);
      if (normalizedValue) {
        await db.upsertCustomerFact(customerId, key, normalizedValue, 'ai');
      }
    }
    if (structured.stage) {
      await db.upsertCustomerFact(customerId, 'funnel_stage', structured.stage, 'ai');
    }

    if (processingState.cancelled) {
      logEvent('AI_CANCELLED', { traceId, chatId, reason: 'new_message_before_send' });
      return;
    }

    if (structured.reply.length > 0) {
      const normalizedReply = collapseReplyMessages(structured.reply, { preferSingle: texts.length > 1 });
      if (isPaymentTemplateReply(normalizedReply)) {
        const paymentAmount = parsePaymentAmount(normalizedReply.join('\n'));
        const snapshot = customerId ? await db.getCustomerSnapshot(customerId) : {};
        await db.upsertOrderDraft({
          customerId,
          chatId: chatDbId,
          source: 'telegram',
          traceId,
          totalAmount: paymentAmount,
          currency: 'RUB',
          summary: summarizeOrderSnapshot(snapshot),
          snapshot,
          paymentMessageId: null,
        });
      }
      const reactionEmoji = getReactionMode() === 'smart'
        ? pickSmartReaction({
            chatId,
            texts,
            mediaFileId,
            stage: structured.stage || '',
            lastClientText: combinedText,
          })
        : null;
      await sendHumanizedReply({
        chatId,
        chatDbId,
        customerId,
        replyMessages: normalizedReply,
        businessConnectionId,
        traceId,
        lastMessageId,
        sendPhotoId: structured.sendPhoto || null,
        reactionEmoji,
        processingState,
      });
    }
  } catch (error) {
    if (processingState.cancelled) return;
    logEvent('ERROR', { traceId, scope: 'batch_process', error: error.message, providerError: error.response?.data || null });
    emitLive('error', { traceId, scope: 'batch_process', error: error.message });
  } finally {
    if (aiProcessing.get(bufferKey) === processingState) {
      aiProcessing.delete(bufferKey);
    }
  }
}

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
      const media = extractTelegramMedia(message);
      const customerIdentity = getTelegramCustomerIdentity(message, businessConnectionId);
      const customerId = await db.upsertTelegramCustomer(customerIdentity, message.chat || {});
      const chatDbId = await db.upsertTelegramChat({
        chat: message.chat || {},
        customerId,
        businessConnectionId,
      });
      if (message.contact?.phone_number && customerId) {
        const phone = normalizePhoneValue(message.contact.phone_number);
        if (phone) {
          await db.updateCrmCustomer(customerId, { phone });
          await db.upsertCustomerFact(customerId, 'phone', phone, 'telegram_contact');
        }
      }
      if (customerId && text) {
        const phoneFromText = extractPhoneFromText(text);
        if (phoneFromText) {
          await db.updateCrmCustomer(customerId, { phone: phoneFromText });
          await db.upsertCustomerFact(customerId, 'phone', phoneFromText, 'telegram_text');
        }
      }
      refreshTelegramCustomerAvatar({
        customerId,
        userId: message.from?.id || message.chat?.id || '',
        chatDbId,
        traceId,
      }).catch(() => {});

      // Detect manager vs client: in business messages, from.id != chat.id means manager
      const isManager = businessConnectionId && message.from?.id && message.chat?.id && String(message.from.id) !== String(message.chat.id);
      const messageRole = isManager ? 'operator' : 'customer';
      const messageDirection = isManager ? 'out' : 'in';

      await db.recordMessage({
        chatId: chatDbId,
        customerId,
        direction: messageDirection,
        role: messageRole,
        text,
        telegramMessageId: message.message_id || null,
        traceId,
        raw: message,
      });
      if (!isManager && isReceiptLikeMessage(message, text)) {
        const snapshot = customerId ? await db.getCustomerSnapshot(customerId) : {};
        await db.markLatestOrderPaid({
          customerId,
          chatId: chatDbId,
          traceId,
          receiptMessageId: message.message_id || null,
          snapshotPatch: {
            ...snapshot,
            paid_confirmation_text: text,
          },
        });
      }
      emitLive('message.created', {
        traceId,
        chatId: chatDbId,
        customerId,
        direction: messageDirection,
        role: messageRole,
        source: 'telegram',
      });
      emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'telegram.in' });
      logEvent('IN', {
        traceId,
        updateType,
        businessConnectionId,
        chatId,
        userId: message.from?.id || '',
        firstName: message.from?.first_name || message.chat?.first_name || '',
        text,
        isManager,
      });
      if (!text) return;

      if (isManager) {
        // Manager sent a message — activate passive mode
        passiveChats.set(String(chatId), { lastManagerAt: Date.now(), managerUserId: message.from.id });
        logEvent('MANAGER_TAKEOVER', { traceId, chatId, managerUserId: message.from.id, text });
        emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'manager.takeover' });

        // Cancel any pending AI for this chat
        const pendingAi = aiProcessing.get(String(chatId));
        if (pendingAi) {
          pendingAi.cancelled = true;
          logEvent('AI_CANCEL_REQUESTED', { traceId, chatId, reason: 'manager_takeover', cancelledTrace: pendingAi.traceId });
        }
        const pendingBuffer = debounceBuffers.get(String(chatId));
        if (pendingBuffer) {
          clearTimeout(pendingBuffer.timer);
          debounceBuffers.delete(String(chatId));
          logEvent('BATCH_CANCELLED', { traceId, chatId, reason: 'manager_takeover' });
        }
        return;
      }

      // Client message — check if chat is in passive mode
      const passive = passiveChats.get(String(chatId));
      const passiveSec = Math.max(10, Math.min(600, Number(runtimeConfig.manager_passive_seconds || 120)));
      if (passive && (Date.now() - passive.lastManagerAt) < passiveSec * 1000) {
        const minutesAgo = Math.round((Date.now() - passive.lastManagerAt) / 60000);
        logEvent('PASSIVE_MODE', { traceId, chatId, minutesAgo, expiresInMinutes: 30 - minutesAgo });
        emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'passive_mode' });
        return;
      }
      if (passive) {
        passiveChats.delete(String(chatId));
        logEvent('PASSIVE_EXPIRED', { traceId, chatId });
      }

      if (!runtimeConfig.auto_reply_enabled) {
        logEvent('AUTO_REPLY_DISABLED', { traceId, chatId });
        emitLive('chat.updated', { traceId, chatId: chatDbId, source: 'telegram', reason: 'auto_reply_disabled' });
        return;
      }

      const bufferKey = String(chatId);

      // Cancel any pending AI processing for this chat
      const pending = aiProcessing.get(bufferKey);
      if (pending) {
        pending.cancelled = true;
        logEvent('AI_CANCEL_REQUESTED', { traceId, chatId, cancelledTrace: pending.traceId });
      }

      // Add to debounce buffer
      const existing = debounceBuffers.get(bufferKey);
      if (existing) {
        clearTimeout(existing.timer);
        existing.texts.push(text);
        existing.traceId = traceId;
        existing.lastMessageId = message.message_id || existing.lastMessageId;
        logEvent('BATCH_BUFFERED', { traceId, chatId, bufferedTexts: existing.texts.length });
      } else {
        debounceBuffers.set(bufferKey, {
          texts: [text],
          traceId,
          chatDbId,
          customerId,
          chatId,
          businessConnectionId,
          lastMessageId: message.message_id || null,
          mediaFileId: media?.fileId || null,
          timer: null,
        });
      }
      // Always update media if present (latest message wins)
      if (media?.fileId) {
        const buf = debounceBuffers.get(bufferKey);
        if (buf) buf.mediaFileId = media.fileId;
      }

      const buf = debounceBuffers.get(bufferKey);
      buf.timer = setTimeout(() => {
        debounceBuffers.delete(bufferKey);
        processBatchedMessages(bufferKey, buf).catch((err) => {
          logEvent('ERROR', { traceId: buf.traceId, scope: 'debounce_trigger', error: err.message });
        });
      }, getDebounceMs());

    } catch (error) {
      logEvent('ERROR', {
        traceId,
        scope: 'webhook',
        error: error.message,
        providerError: error.response?.data || null,
      });
      emitLive('error', {
        traceId,
        scope: 'webhook',
        error: error.message,
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
