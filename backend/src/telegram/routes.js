const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleMessage } = require('./handler');
const settings = require('../db/settings');
const bot = require('./bot');
const users = require('../db/users');
const { deliverOutbox } = require('./outbox');
const config = require('../config');

// Telegram webhook endpoint
router.post('/webhook', (req, res) => {
  // Verify Telegram webhook secret token if configured
  const webhookSecret = config.get('WEBHOOK_SECRET');
  if (webhookSecret) {
    const headerToken = req.headers['x-telegram-bot-api-secret-token'] || '';
    const a = Buffer.from(headerToken);
    const b = Buffer.from(webhookSecret);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.sendStatus(403);
    }
  }

  res.sendStatus(200); // Сразу отвечаем Telegram

  const update = req.body;
  if (process.env.NODE_ENV !== 'production') {
    console.log('UPDATE:', JSON.stringify(update));
  }

  // Support regular + Telegram Business messages
  const msg = update.message || update.business_message || update.edited_business_message;

  if (msg) {
    const businessConnectionId =
      update.business_message?.business_connection_id ||
      update.edited_business_message?.business_connection_id ||
      null;

    handleMessage(msg, businessConnectionId).catch((err) =>
      console.error('handleMessage error:', err)
    );
  }

  // Handle callback_query (inline button presses)
  if (update.callback_query) {
    const cbq = update.callback_query;
    if (cbq.data === 'copy_card') {
      (async () => {
        try {
          const cardNumber = await settings.get('payment_card_number');
          if (cardNumber) {
            const chatId = cbq.message?.chat?.id;
            const from = cbq.from || {};
            if (chatId) {
              const user = await users.findOrCreate(chatId, [from.first_name, from.last_name].filter(Boolean).join(' ') || null, from.username || null);
              await deliverOutbox({
                telegramId: chatId,
                user,
                outbox: [{ kind: 'reply', text: cardNumber }],
                applyDelay: false,
                role: 'ai',
              });
            }
          }
          await bot.answerCallbackQuery(cbq.id, 'Номер карты отправлен для копирования');
        } catch (e) {
          console.error('callbackQuery error:', e.message);
        }
      })();
    }
  }

  // Handle business_connection events (bot connected/disconnected)
  if (update.business_connection) {
    const bc = update.business_connection;
    const chatId = bc.user?.id;
    const enabled = !bc.is_deleted;
    console.log(`Business connection: user=${chatId} enabled=${enabled}`);

    if (chatId && enabled) {
      const from = bc.user || {};
      users.findOrCreate(chatId, [from.first_name, from.last_name].filter(Boolean).join(' ') || null, from.username || null)
        .then((user) => deliverOutbox({
          telegramId: chatId,
          user,
          outbox: [{ kind: 'reply', text: '✅ Бот подключён и готов к работе' }],
          applyDelay: false,
          role: 'ai',
        }))
        .catch((e) => console.error('business_connection send error:', e.message));
    }
  }
});

module.exports = router;
