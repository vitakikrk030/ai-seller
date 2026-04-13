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

// Quick-reply suggestions based on user state + memory
router.get('/users/:id/quick-replies', async (req, res) => {
  try {
    const user = await users.getById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const mem = await memory.get(req.params.id).catch(() => null);
    const replies = [];

    switch (user.state) {
      case 'NEW':
        replies.push('Какой размер носите?', 'Что ищете? Кроссовки, одежду?', 'Показать популярные модели?');
        break;
      case 'WAITING_SIZE':
        if (mem?.shoe_size) {
          replies.push(`Размер ${mem.shoe_size} оставляем?`);
        } else {
          replies.push('Какой размер носите?');
        }
        replies.push('Обычно эта модель идет размер в размер', 'Показать похожие варианты?');
        break;
      case 'WAITING_FORM':
        if (mem?.full_name && mem?.phone && mem?.address) {
          replies.push('Доставить по тем же данным или что-то изменилось?');
        } else {
          replies.push('Отправьте ФИО, телефон и адрес одним сообщением');
        }
        if (mem?.phone && !mem?.address) {
          replies.push('Подскажите адрес доставки');
        }
        replies.push('Доставка по всей России');
        break;
      case 'WAITING_PAYMENT':
        replies.push('Скинуть реквизиты для оплаты?', 'Напоминаю — заказ ждет оплаты', 'После оплаты скиньте скрин');
        break;
      case 'PAID':
        replies.push('Заказ принят, скоро отправим', 'Спасибо за покупку', 'Хотите что-то еще посмотреть?');
        break;
      case 'DONE':
        replies.push('Как вам товар?', 'Подъехали новинки — посмотрите?', 'Рады видеть снова');
        break;
      default:
        replies.push('Чем могу помочь?');
    }
    res.json(replies);
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

    // Cancel any pending AI responses for this chat (manager takes over)
    queue.cancelChat(user.telegram_id);

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
      'bot_token', 'webhook_url', 'webhook_secret', 'owner_chat_id',
      'shop_api_url', 'shop_api_key',
      'global_ai_enabled', 'response_delay', 'auto_reply',
      'payment_card_number', 'payment_name',
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

router.get('/monitoring', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    res.json(monitoring.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monitoring/history', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    const component = req.query.component || null;
    const hours = Math.min(parseInt(req.query.hours) || 24, 168);
    const data = await monitoring.getHistory(component, hours);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monitoring/incidents', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    const { source, limit } = req.query;
    const resolved = req.query.resolved === 'true' ? true : req.query.resolved === 'false' ? false : undefined;
    const data = await monitoring.queryIncidents({
      resolved,
      source: source || null,
      limit: Math.min(parseInt(limit) || 50, 200),
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/monitoring/check', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    await monitoring.runAllChecks();
    res.json(monitoring.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/monitoring/metrics', async (req, res) => {
  try {
    const monitoring = require('../monitoring');
    const data = await monitoring.getBusinessMetrics();
    if (!data) return res.status(500).json({ error: 'Failed to load metrics' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Queue metrics
router.get('/monitoring/queue', async (req, res) => {
  try {
    res.json(queue.getMetrics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
