const express = require('express');
const router = express.Router();
const users = require('../db/users');
const messages = require('../db/messages');
const orders = require('../db/orders');
const prompts = require('../db/prompts');
const settings = require('../db/settings');
const memory = require('../db/memory');
const queue = require('../queue');
const bot = require('../telegram/bot');
const axios = require('axios');
const shop = require('../shop');

// === USERS ===

router.get('/users', async (req, res) => {
  try {
    const { search } = req.query;
    const data = search ? await users.search(search) : await users.getAll();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await users.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const deleted = await users.deleteById(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/ai', async (req, res) => {
  try {
    const { enabled } = req.body;
    await users.setAiEnabled(req.params.id, enabled);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/ai-mode', async (req, res) => {
  try {
    const { mode } = req.body;
    const user = await users.setAiMode(req.params.id, mode);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/users/:id/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    const user = await users.setMode(req.params.id, mode);
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/users/:id/read', async (req, res) => {
  try {
    await users.markRead(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Quick-reply suggestions based on user state + memory (из AI Settings)
router.get('/users/:id/quick-replies', async (req, res) => {
  try {
    const aiSettings = require('../db/ai_settings');
    const toggleEnabled = await aiSettings.isEnabled('toggle_quick_replies');
    if (!toggleEnabled) return res.json([]);

    const user = await users.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const mem = await memory.get(req.params.id).catch(() => null);
    const replies = [];

    // Все тексты берутся только из AI Settings
    switch (user.state) {
      case 'NEW': {
        const [r1, r2, r3] = await Promise.all([
          aiSettings.get('qr_new_1'),
          aiSettings.get('qr_new_2'),
          aiSettings.get('qr_new_3'),
        ]);
        if (r1) replies.push(r1);
        if (r2) replies.push(r2);
        if (r3) replies.push(r3);
        break;
      }
      case 'WAITING_SIZE': {
        const askSize = await aiSettings.get('speech_ask_size');
        if (mem?.shoe_size) {
          replies.push(`Размер ${mem.shoe_size} оставляем?`);
        } else if (askSize) {
          replies.push(askSize);
        }
        const askInsole = await aiSettings.get('speech_ask_insole');
        if (askInsole) replies.push(askInsole);
        const alt = await aiSettings.get('qr_size_alt');
        if (alt) replies.push(alt);
        break;
      }
      case 'WAITING_FORM': {
        const askAddress = await aiSettings.get('speech_ask_address');
        if (mem?.full_name && mem?.phone && mem?.address) {
          const memConfirm = await aiSettings.get('speech_ask_address') || null;
          replies.push(memConfirm || askAddress);
        } else if (askAddress) {
          replies.push(askAddress);
        }
        const delivery = await aiSettings.get('qr_form_delivery');
        if (delivery) replies.push(delivery);
        break;
      }
      case 'WAITING_PAYMENT': {
        const [card, reminder, after] = await Promise.all([
          aiSettings.get('qr_payment_card'),
          aiSettings.get('speech_reminder_payment'),
          aiSettings.get('qr_payment_after'),
        ]);
        if (card) replies.push(card);
        if (reminder) replies.push(reminder);
        if (after) replies.push(after);
        break;
      }
      case 'PAID': {
        const confirm = await aiSettings.get('speech_payment_confirm');
        if (confirm) replies.push(confirm);
        break;
      }
      case 'DONE': {
        const [feedback, repeat, welcome] = await Promise.all([
          aiSettings.get('qr_done_feedback'),
          aiSettings.get('speech_repeat_sale'),
          aiSettings.get('qr_done_welcome'),
        ]);
        if (feedback) replies.push(feedback);
        if (repeat) replies.push(repeat);
        if (welcome) replies.push(welcome);
        break;
      }
      default: {
        const r1 = await aiSettings.get('qr_new_1');
        if (r1) replies.push(r1);
        break;
      }
    }
    res.json(replies.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Customer memory
router.get('/users/:id/memory', async (req, res) => {
  try {
    const user = await users.getById(req.params.id);
    const mem = await memory.get(req.params.id);
    const result = mem ? { ...mem } : {};
    // Add computed fields
    if (user && mem) {
      result._next_action = memory.getNextAction(user, mem);
      result._is_vip = memory.isVIP(mem);
      result._has_full_delivery = memory.hasFullDeliveryData(mem);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/memory', async (req, res) => {
  try {
    const allowedFields = ['full_name', 'phone', 'city', 'address', 'shoe_size', 'insole_cm', 'preferred_brand', 'shoe_type', 'notes'];
    const data = {};
    for (const f of allowedFields) {
      if (req.body[f] !== undefined) data[f] = req.body[f];
    }
    const result = await memory.update(req.params.id, data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/users/:id/state', async (req, res) => {
  try {
    const { state } = req.body;
    const validStates = ['NEW', 'WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT', 'PAID', 'DONE'];
    if (!state || !validStates.includes(state)) {
      return res.status(400).json({ error: `Invalid state. Allowed: ${validStates.join(', ')}` });
    }
    const user = await users.updateState(req.params.id, state);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MESSAGES ===

router.get('/users/:id/messages', async (req, res) => { // @test-only — UI uses /paginated
  try {
    const data = await messages.getByUser(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin sends message manually
router.post('/users/:id/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });

    const user = await users.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Save admin message
    const msg = await messages.save(user.id, 'admin', text);

    // Cancel any pending AI responses for this chat (manager takes over)
    queue.cancelChat(user.telegram_id);

    // Mark manager as active (for AUTO_WITH_MANAGER_OVERRIDE mode)
    await users.setManagerActive(user.id, true);

    // Send via Telegram
    console.log(`SEND TO (CRM): ${user.telegram_id} (user.id=${user.id})`);
    await bot.sendMessage(user.telegram_id, text);

    // Обучение от менеджера (non-blocking)
    const managerLearning = require('../db/manager_learning');
    managerLearning.learnFromManager(text).catch(() => {});

    // Broadcast SSE to admin panel
    broadcastSSE('message', { userId: user.id, message: msg });

    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Paginated messages
router.get('/users/:id/messages/paginated', async (req, res) => {
  try {
    const { limit = 50, before } = req.query;
    const data = await messages.getByUserPaginated(req.params.id, parseInt(limit), before ? parseInt(before) : null);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search messages
router.get('/users/:id/messages/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const data = await messages.searchByUser(req.params.id, q);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete message
router.delete('/messages/:id', async (req, res) => {
  try {
    await messages.deleteById(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit message
router.patch('/messages/:id', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    const msg = await messages.updateById(req.params.id, text);
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear chat history
router.delete('/users/:id/messages', async (req, res) => {
  try {
    await messages.clearByUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pin / unpin user
router.post('/users/:id/pin', async (req, res) => {
  try {
    const { pinned } = req.body;
    const db = require('../db');
    await db.query('UPDATE users SET pinned = $1 WHERE id = $2', [!!pinned, req.params.id]);
    broadcastSSE('user_update', { userId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manager override: set/clear needs_attention
router.patch('/users/:id/attention', async (req, res) => {
  try {
    const { needs_attention, reason } = req.body;
    const db = require('../db');
    await db.query(
      'UPDATE users SET needs_attention = $1, attention_reason = $2, attention_override = true WHERE id = $3',
      [!!needs_attention, reason || null, req.params.id]
    );
    broadcastSSE('user_update', { userId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear attention override
router.delete('/users/:id/attention', async (req, res) => {
  try {
    const db = require('../db');
    await db.query(
      'UPDATE users SET needs_attention = false, attention_reason = null, attention_override = false WHERE id = $1',
      [req.params.id]
    );
    broadcastSSE('user_update', { userId: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE stream for real-time updates
const sseClients = new Map(); // userId → Set of res objects

router.get('/sse', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = Date.now() + Math.random();
  if (!sseClients.has('admin')) sseClients.set('admin', new Map());
  sseClients.get('admin').set(clientId, res);

  // Heartbeat every 25s
  const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients.get('admin')?.delete(clientId);
  });
});

// Export SSE broadcaster for use in other modules
function broadcastSSE(event, data) {
  const clients = sseClients.get('admin');
  if (!clients) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients.values()) {
    try { res.write(payload); } catch {}
  }
}

router.broadcastSSE = broadcastSSE;

// === ORDERS ===

router.get('/orders', async (req, res) => { // @test-only — UI uses /users/:id/orders
  try {
    const data = await orders.getAll();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/users/:id/orders', async (req, res) => {
  try {
    const data = await orders.getByUser(req.params.id);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['NEW', 'PAID', 'DONE', 'CANCELLED'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
    }
    const order = await orders.updateStatus(req.params.id, status);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PROMPTS ===

router.get('/prompts', async (req, res) => { // @test-only — SettingsView removed from UI
  try {
    const data = await prompts.getAll();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/prompts/:key', async (req, res) => { // @test-only — SettingsView removed from UI
  try {
    const { value } = req.body;
    if (!value) return res.status(400).json({ error: 'Value required' });
    const result = await prompts.update(req.params.key, value);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === STATS ===

router.get('/stats', async (req, res) => {
  try {
    const db = require('../db');
    const [usersCount, ordersCount, messagesCount, todayOrders] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM orders'),
      db.query('SELECT COUNT(*) FROM messages'),
      db.query("SELECT COUNT(*) FROM orders WHERE created_at > NOW() - INTERVAL '24 hours'"),
    ]);

    res.json({
      users: parseInt(usersCount.rows[0].count),
      orders: parseInt(ordersCount.rows[0].count),
      messages: parseInt(messagesCount.rows[0].count),
      todayOrders: parseInt(todayOrders.rows[0].count),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === SETTINGS ===

router.get('/settings', async (req, res) => {
  try {
    const data = await settings.getMap();
    // Mask sensitive values for frontend display
    const masked = { ...data };
    const sensitiveKeys = ['openrouter_api_key', 'bot_token', 'shop_api_key', 'webhook_secret'];
    for (const k of sensitiveKeys) {
      if (masked[k] && masked[k].length > 8) {
        masked[k] = masked[k].slice(0, 4) + '••••' + masked[k].slice(-4);
      }
    }
    res.json(masked);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/settings', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) {
      return res.status(400).json({ error: 'entries array required' });
    }
    // Validate keys — only allow known settings
    const allowedKeys = [
      'openrouter_api_key', 'openrouter_model',
      'ai_base_url', 'ai_api_key', 'ai_model',
      'bot_token', 'webhook_url', 'webhook_secret', 'owner_chat_id',
      'shop_api_url', 'shop_api_key',
      'global_ai_enabled', 'response_delay', 'auto_reply',
      'payment_card_number', 'payment_name',
      'payment_bank_name', 'payment_receiver_name',
    ];
    const filtered = entries.filter((e) => allowedKeys.includes(e.key));
    // Skip masked values to prevent overwriting real secrets with masked versions
    const sensitiveKeys = ['openrouter_api_key', 'bot_token', 'shop_api_key', 'webhook_secret'];
    const safe = filtered.filter((e) => {
      if (sensitiveKeys.includes(e.key) && e.value && e.value.includes('••••')) {
        return false; // Don't save masked value
      }
      return true;
    });
    await settings.setMany(safe);
    // Reload cached settings in config
    const config = require('../config');
    await config.reloadSettings();
    // Invalidate shop cache if shop settings changed
    if (safe.some((e) => e.key === 'shop_api_url' || e.key === 'shop_api_key')) {
      shop.clearCache();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PAYMENT ===

router.get('/payment', async (req, res) => { // @test-only — payment data read via /settings
  try {
    const cardNumber = await settings.get('payment_card_number');
    const cardName = await settings.get('payment_name');
    res.json({ card_number: cardNumber || '', card_name: cardName || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset / disconnect an integration
router.post('/integrations/reset', async (req, res) => {
  try {
    const { type } = req.body;
    if (!['telegram', 'ai', 'shop'].includes(type)) {
      return res.status(400).json({ error: 'type must be telegram | ai | shop' });
    }

    const config = require('../config');
    let keysToReset = [];

    if (type === 'telegram') {
      // Delete webhook before clearing token
      const token = await settings.get('bot_token') || process.env.BOT_TOKEN;
      if (token) {
        try { await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`); } catch {}
      }
      keysToReset = ['bot_token', 'webhook_url', 'webhook_secret', 'owner_chat_id'];
    } else if (type === 'ai') {
      keysToReset = ['ai_base_url', 'ai_api_key', 'ai_model', 'openrouter_api_key', 'openrouter_model'];
    } else if (type === 'shop') {
      keysToReset = ['shop_api_url', 'shop_api_key'];
      shop.clearCache();
    }

    // Clear all keys in DB
    for (const key of keysToReset) {
      await settings.set(key, '');
    }

    // Reload config cache
    await config.reloadSettings();

    // Broadcast SSE
    broadcastSSE('integration_updated', { type, action: 'reset' });

    res.json({ ok: true, type, reset: keysToReset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified integrations status check
router.get('/integrations/status', async (req, res) => {
  const result = { telegram: null, ai: null, shop: null };

  // Telegram
  try {
    const token = await settings.get('bot_token') || process.env.BOT_TOKEN;
    if (!token) {
      result.telegram = { ok: false, error: 'Токен не задан', configured: false };
    } else {
      const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 5000 });
      if (resp.data?.ok) {
        result.telegram = { ok: true, bot: resp.data.result, configured: true };
      } else {
        result.telegram = { ok: false, error: 'Невалидный токен', configured: true };
      }
    }
  } catch (err) {
    result.telegram = { ok: false, error: err.response?.data?.description || err.message, configured: true };
  }

  // AI — universal provider check (uses AI_BASE_URL / AI_API_KEY from env or DB)
  try {
    const { getAIConfig } = require('../ai/client');
    const cfg = getAIConfig();
    if (!cfg.apiKey) {
      result.ai = { ok: false, error: 'API ключ не задан', configured: false };
    } else {
      const start = Date.now();
      const resp = await axios.post(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 8000,
      });
      const latency = Date.now() - start;
      if (resp.data?.choices) {
        result.ai = { ok: true, model: cfg.model, latency, configured: true };
      } else {
        result.ai = { ok: false, error: 'Нет ответа от модели', model: cfg.model, configured: true };
      }
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    result.ai = { ok: false, error: msg, configured: true };
  }

  // Shop
  try {
    const shopUrl = await settings.get('shop_api_url') || process.env.SHOP_API_URL;
    const shopKey = await settings.get('shop_api_key') || process.env.SHOP_API_KEY;
    if (!shopUrl) {
      result.shop = { ok: false, error: 'URL не задан', configured: false };
    } else {
      const shopModule = require('../shop');
      const products = await shopModule.fetchProducts();
      result.shop = { ok: true, count: products.length, configured: true };
    }
  } catch (err) {
    result.shop = { ok: false, error: err.message, configured: true };
  }

  res.json(result);
});

// Check Telegram bot connection
router.post('/settings/test-telegram', async (req, res) => {
  try {
    const token = await settings.get('bot_token') || process.env.BOT_TOKEN;
    if (!token) return res.json({ ok: false, error: 'Bot token не задан' });

    const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
    if (resp.data?.ok) {
      res.json({ ok: true, bot: resp.data.result });
    } else {
      res.json({ ok: false, error: 'Невалидный токен' });
    }
  } catch (err) {
    res.json({ ok: false, error: err.response?.data?.description || err.message });
  }
});

// Change bot token: validate → delete old webhook → save → set new webhook
router.post('/settings/change-token', async (req, res) => {
  try {
    const { token, webhook_url } = req.body;
    if (!token || typeof token !== 'string' || token.length < 10) {
      return res.status(400).json({ ok: false, error: 'Невалидный токен' });
    }

    // 1. Validate new token via getMe
    let botInfo;
    try {
      const resp = await axios.get(`https://api.telegram.org/bot${token}/getMe`);
      if (!resp.data?.ok) {
        return res.json({ ok: false, error: 'Telegram отклонил токен' });
      }
      botInfo = resp.data.result;
    } catch (err) {
      return res.json({ ok: false, error: err.response?.data?.description || 'Невалидный токен' });
    }

    // 2. Delete webhook on OLD token (if exists)
    const oldToken = await settings.get('bot_token') || process.env.BOT_TOKEN;
    if (oldToken && oldToken !== token) {
      try {
        await axios.post(`https://api.telegram.org/bot${oldToken}/deleteWebhook`);
      } catch (e) { /* old token may be invalid, ignore */ }
    }

    // 3. Save new token
    await settings.set('bot_token', token);
    if (webhook_url) {
      await settings.set('webhook_url', webhook_url);
    }

    // 4. Reload config
    const config = require('../config');
    await config.reloadSettings();

    // 5. Set webhook on new token
    const whUrl = webhook_url || config.get('WEBHOOK_URL');
    if (whUrl) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
          url: whUrl,
          allowed_updates: ['message', 'callback_query', 'business_connection', 'business_message', 'edited_business_message'],
        });
      } catch (err) {
        return res.json({ ok: true, bot: botInfo, webhook: false, webhook_error: err.response?.data?.description || err.message });
      }
    }

    res.json({ ok: true, bot: botInfo, webhook: !!whUrl });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Disconnect bot: remove webhook + clear token
router.post('/settings/disconnect-bot', async (req, res) => {
  try {
    const token = await settings.get('bot_token') || process.env.BOT_TOKEN;

    // Delete webhook
    if (token) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/deleteWebhook`);
      } catch (e) { /* ignore */ }
    }

    // Clear token and webhook from DB
    await settings.set('bot_token', '');
    await settings.set('webhook_url', '');

    // Reload config
    const config = require('../config');
    await config.reloadSettings();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Check shop API connection and fetch products
router.post('/settings/test-shop', async (req, res) => {
  try {
    const url = await settings.get('shop_api_url');
    if (!url) return res.json({ ok: false, error: 'URL не задан' });

    const apiKey = await settings.get('shop_api_key');
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
    const resp = await axios.get(`${url}/products`, { headers, timeout: 5000 });
    const products = Array.isArray(resp.data) ? resp.data : (resp.data?.products || []);
    res.json({ ok: true, status: resp.status, products_count: products.length });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// === MONITORING ===

// Business pulse summary — 6 metrics
router.get('/monitoring/summary', async (req, res) => {
  try {
    const db = require('../db');
    const monitoring = require('../monitoring');

    // 1. Revenue today (Moscow calendar day: 00:00–23:59 MSK)
    const revRow = await db.query(
      `SELECT COALESCE(SUM(price),0) as total FROM orders
       WHERE paid_at AT TIME ZONE 'Europe/Moscow' >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')
         AND paid_at AT TIME ZONE 'Europe/Moscow' < date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 day'
         AND status IN ('PAID','DONE')`
    );
    const revenue_today = parseFloat(revRow.rows[0]?.total || 0);

    // 2. Conversion: paid orders / total users with messages today (Moscow day)
    const convRow = await db.query(
      `SELECT COUNT(DISTINCT user_id) as total FROM messages
       WHERE created_at AT TIME ZONE 'Europe/Moscow' >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')
         AND role = 'user'`
    );
    const paidRow = await db.query(
      `SELECT COUNT(*) as paid FROM orders
       WHERE paid_at AT TIME ZONE 'Europe/Moscow' >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')
         AND paid_at AT TIME ZONE 'Europe/Moscow' < date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') + INTERVAL '1 day'
         AND status IN ('PAID','DONE')`
    );
    const totalDialogs = parseInt(convRow.rows[0]?.total || 0);
    const paidOrders = parseInt(paidRow.rows[0]?.paid || 0);
    const conversion = totalDialogs > 0 ? Math.round((paidOrders / totalDialogs) * 100) : 0;

    // 3. Missed clients: user sent message, no AI/admin reply within 5 min
    const missedRow = await db.query(`
      SELECT COUNT(DISTINCT m.user_id) as cnt
      FROM messages m
      WHERE m.role = 'user'
        AND m.created_at > NOW() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM messages r
          WHERE r.user_id = m.user_id
            AND r.role IN ('ai','admin')
            AND r.created_at > m.created_at
            AND r.created_at < m.created_at + INTERVAL '5 minutes'
        )
    `);
    const missed_clients = parseInt(missedRow.rows[0]?.cnt || 0);

    // 4. AI errors in last 24h
    let ai_errors = 0;
    try {
      const errRow = await db.query(
        "SELECT COUNT(*) as cnt FROM ai_errors WHERE created_at > NOW() - INTERVAL '24 hours'"
      );
      ai_errors = parseInt(errRow.rows[0]?.cnt || 0);
    } catch {}

    // 5. System status (reuse monitoring module)
    let system_status = { ai: 'unknown', telegram: 'unknown', db: 'unknown' };
    try {
      const monData = monitoring.getStatus();
      const comps = monData?.components || [];
      const find = (name) => comps.find(c => c.name === name)?.status?.toLowerCase() || 'unknown';
      system_status = { ai: find('ai'), telegram: find('telegram'), db: find('database') };
    } catch {}

    // 6. Lost clients: no activity for 48h+
    const lostRow = await db.query(
      "SELECT COUNT(*) as cnt FROM users WHERE last_seen < NOW() - INTERVAL '48 hours' AND state NOT IN ('DONE','PAID')"
    );
    const lost_clients = parseInt(lostRow.rows[0]?.cnt || 0);

    // Trends (yesterday Moscow day)
    const revYestRow = await db.query(
      `SELECT COALESCE(SUM(price),0) as total FROM orders
       WHERE paid_at AT TIME ZONE 'Europe/Moscow' >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') - INTERVAL '1 day'
         AND paid_at AT TIME ZONE 'Europe/Moscow' < date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')
         AND status IN ('PAID','DONE')`
    );
    const revenue_yesterday = parseFloat(revYestRow.rows[0]?.total || 0);

    const convYestDialogs = await db.query(
      `SELECT COUNT(DISTINCT user_id) as total FROM messages
       WHERE created_at AT TIME ZONE 'Europe/Moscow' >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') - INTERVAL '1 day'
         AND created_at AT TIME ZONE 'Europe/Moscow' < date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow')
         AND role = 'user'`
    );
    const convYestPaid = await db.query(
      "SELECT COUNT(*) as paid FROM orders WHERE paid_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours' AND status IN ('PAID','DONE')"
    );
    const yd = parseInt(convYestDialogs.rows[0]?.total || 0);
    const yp = parseInt(convYestPaid.rows[0]?.paid || 0);
    const conversion_yesterday = yd > 0 ? Math.round((yp / yd) * 100) : 0;

    let ai_errors_yesterday = 0;
    try {
      const errYRow = await db.query(
        "SELECT COUNT(*) as cnt FROM ai_errors WHERE created_at BETWEEN NOW() - INTERVAL '48 hours' AND NOW() - INTERVAL '24 hours'"
      );
      ai_errors_yesterday = parseInt(errYRow.rows[0]?.cnt || 0);
    } catch {}

    // Avg check (all time, only paid orders)
    const avgRow = await db.query(
      "SELECT COALESCE(AVG(price),0) as avg FROM orders WHERE paid_at IS NOT NULL AND price > 0"
    );
    const avg_check = Math.round(parseFloat(avgRow.rows[0]?.avg || 0));

    res.json({
      revenue_today,
      revenue_yesterday,
      conversion,
      conversion_yesterday,
      missed_clients,
      ai_errors,
      ai_errors_yesterday,
      avg_check,
      system_status,
      lost_clients,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monitoring', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    res.json(monitoring.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monitoring/metrics', async (req, res) => { // @test-only — UI uses /monitoring/summary
  try {
    const monitoring = require('../monitoring');
    const data = await monitoring.getBusinessMetrics();
    if (!data) return res.status(500).json({ error: 'Failed to load metrics' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AI PREVIEW (тест без отправки клиенту) ===

router.post('/ai-settings/preview', async (req, res) => {
  try {
    const { message, scenario, userState } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });
    const { previewResponse } = require('../ai');
    const text = await previewResponse(message, scenario || null, userState || 'NEW');
    if (!text) return res.json({ response: '(AI не ответил — проверьте API ключ)' });
    // Прогоняем через safety
    const safety = require('../ai/safety');
    const safe = await safety.enforce(text, { userState: userState || 'NEW' });
    res.json({ response: safe.text, passed: safe.passed, raw: text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AI SETTINGS ===

const aiSettings = require('../db/ai_settings');

// Получить все настройки AI (сгруппированные по категориям)
router.get('/ai-settings', async (req, res) => {
  try {
    const all = await aiSettings.getAll();
    // Группируем по категории
    const grouped = {};
    for (const row of all) {
      if (!grouped[row.category]) grouped[row.category] = [];
      grouped[row.category].push(row);
    }
    res.json(grouped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получить одну настройку по ключу
router.get('/ai-settings/:key', async (req, res) => {
  try {
    const val = await aiSettings.getRaw(req.params.key);
    if (val === null) return res.status(404).json({ error: 'Not found' });
    res.json({ key: req.params.key, value: val });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обновить одну настройку
router.patch('/ai-settings/:key', async (req, res) => {
  try {
    const { value, enabled } = req.body;
    if (value !== undefined) {
      await aiSettings.set(req.params.key, value);
    }
    if (enabled !== undefined) {
      await aiSettings.setEnabled(req.params.key, enabled);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === AI PROVIDER TEST ===

router.post('/ai/test-provider', async (req, res) => {
  try {
    const { base_url, api_key } = req.body;
    if (!base_url || !api_key) {
      return res.status(400).json({ success: false, error: 'base_url and api_key required' });
    }

    const url = `${base_url.replace(/\/$/, '')}/models`;
    const start = Date.now();

    let models = [];
    let success = false;
    let error = null;

    try {
      const resp = await axios.get(url, {
        headers: { Authorization: `Bearer ${api_key}`, 'Content-Type': 'application/json' },
        timeout: 8000,
      });
      const latency = Date.now() - start;

      // Normalize models list — handle OpenAI, OpenRouter, and custom formats
      const data = resp.data;
      if (Array.isArray(data)) {
        models = data.map(m => typeof m === 'string' ? m : (m.id || m.name || String(m))).filter(Boolean);
      } else if (Array.isArray(data?.data)) {
        models = data.data.map(m => m.id || m.name || String(m)).filter(Boolean);
      } else if (Array.isArray(data?.models)) {
        models = data.models.map(m => typeof m === 'string' ? m : (m.id || m.name || String(m))).filter(Boolean);
      }

      success = true;
      return res.json({ success: true, models, latency });
    } catch (err) {
      const latency = Date.now() - start;
      const status = err.response?.status;
      if (status === 404) {
        // /models not found — provider may not support listing, but API key might be valid
        return res.json({ success: true, models: [], latency, error: 'models_not_available' });
      }
      if (status === 401 || status === 403) {
        return res.json({ success: false, models: [], latency, error: 'invalid_api_key' });
      }
      return res.json({ success: false, models: [], latency, error: err.message || 'connection_failed' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === AI USAGE ===

router.get('/ai/usage', async (req, res) => {
  try {
    const { getUsageStats, getAIConfig } = require('../ai/client');
    const config = require('../config');
    const days = parseInt(req.query.days || '30');
    const stats = await getUsageStats({ days });
    const cfg = getAIConfig();
    const limit = parseInt(config.AI_TOKEN_LIMIT || process.env.AI_TOKEN_LIMIT || 1000000);
    const used = parseInt(stats.used) || 0;
    const remaining = Math.max(0, limit - used);
    const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
    res.json({
      used,
      limit,
      remaining,
      percent,
      tokens_in: parseInt(stats.tokens_in) || 0,
      tokens_out: parseInt(stats.tokens_out) || 0,
      requests: parseInt(stats.requests) || 0,
      last_request: stats.last_request || null,
      provider: cfg.baseUrl ? new URL(cfg.baseUrl).hostname : 'unknown',
      model: cfg.model,
      days,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Массовое обновление настроек
router.post('/ai-settings/bulk', async (req, res) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be array' });
    await aiSettings.setMany(entries);
    aiSettings.invalidateCache();
    res.json({ ok: true, updated: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
