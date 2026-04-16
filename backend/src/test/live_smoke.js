process.env.TZ = 'Europe/Moscow';
require('dotenv').config();

const express = require('express');
const axios = require('axios');

const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const orders = require('../db/orders');
const settings = require('../db/settings');
const queue = require('../queue');
const { handleMessage } = require('../telegram/handler');
const apiRoutes = require('../api/routes');
const bot = require('../telegram/bot');
const shop = require('../shop');

const TG_ID = 399900001;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function cleanup(telegramId) {
  const userRow = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
  if (userRow.rows.length === 0) return;
  const userId = userRow.rows[0].id;
  await db.query('DELETE FROM policy_runs WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM owner_reviews WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM orders WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

function createPhotoStub(fileId = 'live-receipt-file-id') {
  return [{ file_id: fileId, width: 100, height: 100 }];
}

async function withApiServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const port = server.address().port;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const sentMessages = [];
  const originalSendMessage = bot.sendMessage;
  const originalGetCatalog = shop.getCatalog;

  try {
    await db.init();
    await cleanup(TG_ID);
    queue.reset();

    await settings.setMany([
      { key: 'global_ai_enabled', value: 'true' },
      { key: 'auto_reply', value: 'true' },
      { key: 'response_delay', value: '0' },
      { key: 'payment_card_number', value: '4111222233334444' },
      { key: 'payment_bank_name', value: 'T-Bank' },
      { key: 'payment_receiver_name', value: 'AI Seller Live Test' },
      { key: 'policy_mode', value: 'primary' },
      { key: 'policy_logging_enabled', value: 'true' },
      { key: 'manual_payment_review_enabled', value: 'true' },
    ]);

    bot.sendMessage = async (chatId, text) => {
      sentMessages.push({ chatId, text });
      return { message_id: 9000 + sentMessages.length };
    };

    shop.getCatalog = async () => ({
      available: true,
      status: 'ok',
      products: [
        { id: 'sku_airmax270', name: 'Nike Air Max 270', price: 12990, brand: 'Nike' },
        { id: 'sku_dunk_low', name: 'Nike Dunk Low', price: 10990, brand: 'Nike' },
      ],
    });

    await handleMessage({
      message_id: 1,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Live', last_name: 'Smoke', username: 'livesmoke' },
      text: 'Хочу Nike Air Max 270',
    });
    await queue.drain(30000);

    let user = await users.findOrCreate(TG_ID, 'Live Smoke', 'livesmoke');
    let order = await orders.getLatestByUser(user.id);
    assert(sentMessages.length >= 1, 'AI did not answer after product request');
    assert(order && order.product === 'Nike Air Max 270', 'Product was not captured in live smoke');

    await handleMessage({
      message_id: 2,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Live', last_name: 'Smoke', username: 'livesmoke' },
      text: '42 размер',
    });
    await queue.drain(30000);

    order = await orders.getLatestByUser(user.id);
    assert(order && order.size === '42', 'Size was not captured in live smoke');

    await handleMessage({
      message_id: 3,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Live', last_name: 'Smoke', username: 'livesmoke' },
      text: 'Иван Иванов, +79990000001, Москва, ул. Пушкина 10',
    });
    await queue.drain(30000);

    order = await orders.getLatestByUser(user.id);
    assert(order && orders.normalizeStatus(order.status) === 'payment_pending', 'Order did not reach payment_pending');

    await handleMessage({
      message_id: 4,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Live', last_name: 'Smoke', username: 'livesmoke' },
      caption: 'Оплатил, вот чек',
      photo: createPhotoStub(),
    });
    await queue.drain(30000);

    order = await orders.getLatestByUser(user.id);
    assert(order && orders.normalizeStatus(order.status) === 'payment_claimed', 'Payment claim was not registered');

    let verifyResponse;
    await withApiServer(async (baseUrl) => {
      verifyResponse = await axios.post(`${baseUrl}/api/orders/${order.id}/payment/verify`);
    });

    order = await orders.getLatestByUser(user.id);
    const conversation = await messages.getByUser(user.id);
    const deliveredAiMessages = conversation.filter((message) => message.role === 'ai' && message.delivery_status === 'delivered');

    assert(verifyResponse.data.order.status === 'payment_verified', 'Owner verification endpoint did not return payment_verified');
    assert(orders.normalizeStatus(order.status) === 'payment_verified', 'Order did not reach payment_verified');
    assert(deliveredAiMessages.length >= 4, 'Too few delivered AI replies in live smoke');

    console.log('LIVE_SMOKE_OK');
    console.log(JSON.stringify({
      model: process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
      sent_messages: sentMessages.map((item, index) => ({ index: index + 1, text: item.text })),
      final_order_status: order.status,
      delivered_ai_messages: deliveredAiMessages.length,
    }, null, 2));
  } finally {
    bot.sendMessage = originalSendMessage;
    shop.getCatalog = originalGetCatalog;
    await cleanup(TG_ID).catch(() => {});
    queue.reset();
  }
}

main().catch((err) => {
  console.error('LIVE_SMOKE_FAILED:', err.message);
  process.exit(1);
});
