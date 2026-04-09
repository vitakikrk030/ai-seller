const express = require('express');
const router = express.Router();
const users = require('../db/users');
const messages = require('../db/messages');
const orders = require('../db/orders');
const prompts = require('../db/prompts');
const settings = require('../db/settings');
const bot = require('../telegram/bot');
const axios = require('axios');

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

router.patch('/users/:id/state', async (req, res) => {
  try {
    const { state } = req.body;
    const user = await users.updateState(req.params.id, state);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === MESSAGES ===

router.get('/users/:id/messages', async (req, res) => {
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

    // Mark manager as active (for AUTO_WITH_MANAGER_OVERRIDE mode)
    await users.setManagerActive(user.id, true);

    // Send via Telegram
    await bot.sendMessage(user.telegram_id, text);

    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === ORDERS ===

router.get('/orders', async (req, res) => {
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
    const order = await orders.updateStatus(req.params.id, status);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PROMPTS ===

router.get('/prompts', async (req, res) => {
  try {
    const data = await prompts.getAll();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/prompts/:key', async (req, res) => {
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
    const sensitiveKeys = ['openrouter_api_key', 'bot_token', 'shop_api_key'];
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
      'bot_token', 'webhook_url', 'owner_chat_id',
      'shop_api_url', 'shop_api_key',
      'global_ai_enabled', 'response_delay', 'auto_reply',
      'payment_card_number', 'payment_name',
    ];
    const filtered = entries.filter((e) => allowedKeys.includes(e.key));
    // Skip masked values to prevent overwriting real secrets with masked versions
    const sensitiveKeys = ['openrouter_api_key', 'bot_token', 'shop_api_key'];
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// === PAYMENT ===

router.get('/payment', async (req, res) => {
  try {
    const cardNumber = await settings.get('payment_card_number');
    const cardName = await settings.get('payment_name');
    res.json({ card_number: cardNumber || '', card_name: cardName || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

module.exports = router;
