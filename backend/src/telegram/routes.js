const express = require('express');
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
router.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // Support regular + Telegram Business messages
    const msg = update.message || update.business_message || update.edited_business_message;

    if (msg) {
      const businessConnectionId =
        update.business_message?.business_connection_id ||
        update.edited_business_message?.business_connection_id ||
        null;

      await handleMessage(msg, businessConnectionId);
    }

    // Handle callback_query (inline button presses)
    if (update.callback_query) {
      const cbq = update.callback_query;
      if (cbq.data === 'copy_card') {
        const cardNumber = await settings.get('payment_card_number');
        if (cardNumber) {
          await bot.sendMessage(cbq.message.chat.id, cardNumber);
        }
        try {
          await axios.post(`${getAPI()}/answerCallbackQuery`, {
            callback_query_id: cbq.id,
            text: 'Номер карты отправлен для копирования',
          });
        } catch (e) {
          console.error('answerCallbackQuery error:', e.message);
        }
      }
    }

    // Handle business_connection events (bot connected/disconnected)
    if (update.business_connection) {
      const bc = update.business_connection;
      console.log(`Business connection: user=${bc.user?.id} enabled=${!bc.is_deleted}`);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // Always return 200 to Telegram
  }
});

module.exports = router;
