const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { handleMessage } = require('./handler');
const settings = require('../db/settings');
const bot = require('./bot');
const axios = require('axios');
const config = require('../config');

function getAPI() {
  return `https://api.telegram.org/bot${config.get('BOT_TOKEN')}`;
}

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

  // Support regular + Telegram Business messages.
  // edited_business_message is ignored here: edited texts were routed as new
  // client messages and could produce a duplicate AI reply.
  const msg = update.message || update.business_message;

  if (msg) {
    const businessConnectionId =
      update.business_message?.business_connection_id ||
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
            await bot.sendMessage(cbq.message.chat.id, cardNumber);
          }
          await axios.post(`${getAPI()}/answerCallbackQuery`, {
            callback_query_id: cbq.id,
            text: 'Номер карты отправлен для копирования',
          });
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
      bot.sendMessage(chatId, '✅ Бот подключён и готов к работе').catch((e) =>
        console.error('business_connection send error:', e.message)
      );
    }
  }
});

module.exports = router;
