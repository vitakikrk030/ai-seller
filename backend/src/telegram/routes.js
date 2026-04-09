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

    if (update.message) {
      await handleMessage(update.message);
    }

    // Handle callback_query (inline button presses)
    if (update.callback_query) {
      const cbq = update.callback_query;
      if (cbq.data === 'copy_card') {
        const cardNumber = await settings.get('payment_card_number');
        if (cardNumber) {
          // Send card number as plain text for easy copying
          await bot.sendMessage(cbq.message.chat.id, cardNumber);
        }
        // Answer callback to remove loading state
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

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200); // Always return 200 to Telegram
  }
});

module.exports = router;
