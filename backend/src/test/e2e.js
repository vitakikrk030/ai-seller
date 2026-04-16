process.env.TZ = 'Europe/Moscow';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
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
const aiClient = require('../ai/client');
const bot = require('../telegram/bot');
const shop = require('../shop');

let passed = 0;
let failed = 0;

function assert(condition, name) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
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

function createPhotoStub(fileId = 'receipt-file-id') {
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

function buildPolicyReply(lastUserMessage) {
  const text = String(lastUserMessage || '').toLowerCase();

  if (text.includes('air max 270')) {
    return {
      version: 'v1',
      reply: 'Да, Nike Air Max 270 есть. Напиши размер, и сразу двинемся к оформлению.',
      next_step: 'collect_size',
      action: { type: 'upsert_order_draft', payload: {} },
      collected_data: {
        product_ref: 'sku_airmax270',
        product_name: 'Nike Air Max 270',
        size: null,
        full_name: null,
        phone: null,
        address: null,
      },
      confidence: 'high',
    };
  }

  if (text.includes('42')) {
    return {
      version: 'v1',
      reply: '42 записал. Скинь ФИО, телефон и адрес одним сообщением.',
      next_step: 'collect_delivery',
      action: { type: 'upsert_order_draft', payload: {} },
      collected_data: {
        product_ref: null,
        product_name: null,
        size: '42',
        full_name: null,
        phone: null,
        address: null,
      },
      confidence: 'high',
    };
  }

  if (text.includes('+79990000001')) {
    return {
      version: 'v1',
      reply: 'Данные записал. Ниже отправлю реквизиты для оплаты.',
      next_step: 'request_payment',
      action: { type: 'send_payment_details', payload: {} },
      collected_data: {
        product_ref: null,
        product_name: null,
        size: null,
        full_name: 'Иван Иванов',
        phone: '+79990000001',
        address: 'Москва, ул. Пушкина 10',
      },
      confidence: 'high',
    };
  }

  if (text.includes('оплатил') || text.includes('[фото]') || text.includes('клиент отправил фото')) {
    return {
      version: 'v1',
      reply: 'Чек получил. Передал оплату на ручную проверку.',
      next_step: 'ack_payment_claim',
      action: { type: 'none', payload: {} },
      collected_data: {
        product_ref: null,
        product_name: null,
        size: null,
        full_name: null,
        phone: null,
        address: null,
      },
      confidence: 'high',
    };
  }

  if (text.includes('владелец подтвердил оплату')) {
    return {
      version: 'v1',
      reply: 'Оплату подтвердили, заказ принят в работу. Дальше напишу по отправке.',
      next_step: 'post_verification_reassure',
      action: { type: 'none', payload: {} },
      collected_data: {
        product_ref: null,
        product_name: null,
        size: null,
        full_name: null,
        phone: null,
        address: null,
      },
      confidence: 'high',
    };
  }

  return {
    version: 'v1',
    reply: 'Помогу оформить заказ. Напиши, какая модель нужна.',
    next_step: 'clarify_need',
    action: { type: 'none', payload: {} },
    collected_data: {
      product_ref: null,
      product_name: null,
      size: null,
      full_name: null,
      phone: null,
      address: null,
    },
    confidence: 'medium',
  };
}

async function runScenario() {
  console.log('\n🚀 AI-DRIVEN SALES E2E');

  const TG_ID = 300000001;
  const sentMessages = [];
  let aiCallCount = 0;

  await cleanup(TG_ID);
  queue.reset();
  await db.init();

  await settings.setMany([
    { key: 'global_ai_enabled', value: 'true' },
    { key: 'auto_reply', value: 'true' },
    { key: 'response_delay', value: '0' },
    { key: 'payment_card_number', value: '4111222233334444' },
    { key: 'payment_bank_name', value: 'T-Bank' },
    { key: 'payment_receiver_name', value: 'AI Seller Test' },
    { key: 'policy_mode', value: 'primary' },
    { key: 'policy_logging_enabled', value: 'true' },
    { key: 'manual_payment_review_enabled', value: 'true' },
  ]);

  const originalSendMessage = bot.sendMessage;
  const originalAiSendMessage = aiClient.sendMessage;
  const originalGetCatalog = shop.getCatalog;

  bot.sendMessage = async (chatId, text) => {
    sentMessages.push({ chatId, text });
    return { message_id: 1000 + sentMessages.length };
  };

  aiClient.sendMessage = async ({ messages: promptMessages }) => {
    aiCallCount++;
    const lastUserMessage = [...promptMessages].reverse().find((message) => message.role === 'user')?.content || '';
    return { text: JSON.stringify(buildPolicyReply(lastUserMessage)), tokensIn: 10, tokensOut: 10 };
  };

  shop.getCatalog = async () => ({
    available: true,
    status: 'ok',
    products: [
      { id: 'sku_airmax270', name: 'Nike Air Max 270', price: 12990, brand: 'Nike' },
      { id: 'sku_dunk_low', name: 'Nike Dunk Low', price: 10990, brand: 'Nike' },
    ],
  });

  try {
    await handleMessage({
      message_id: 1,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Хочу Nike Air Max 270',
    });
    await queue.drain();

    let user = await users.findOrCreate(TG_ID, 'Ivan Test', 'ivantest');
    let userMessages = await messages.getByUser(user.id);
    let order = await orders.getLatestByUser(user.id);
    let policyRunRows = await db.query('SELECT * FROM policy_runs WHERE user_id = $1 ORDER BY created_at ASC', [user.id]);

    assert(sentMessages.length >= 1, '1. Клиент пишет -> AI отвечает');
    assert(sentMessages[0].text.includes('размер'), 'AI ведёт к следующему шагу');
    assert(order && order.product === 'Nike Air Max 270', '2. Подбор товара работает');
    assert(order && orders.normalizeStatus(order.status) === 'draft', 'Заказ создан как draft после выбора товара');
    assert(policyRunRows.rows.length === 1, 'Policy run сохранён после первого AI-решения');

    await handleMessage({
      message_id: 2,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: '42 размер',
    });
    await queue.drain();

    order = await orders.getLatestByUser(user.id);
    assert(order.size === '42', '3. Размер собирается корректно');
    assert(orders.normalizeStatus(order.status) === 'draft', '5. Реквизиты не отправляются до полного заказа');

    await handleMessage({
      message_id: 3,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Иван Иванов, +79990000001, Москва, ул. Пушкина 10',
    });
    await queue.drain();

    order = await orders.getLatestByUser(user.id);
    user = await users.getById(user.id);
    userMessages = await messages.getByUser(user.id);

    const paymentMessages = sentMessages.filter((message) => message.text.includes('Реквизиты для оплаты'));
    assert(order.full_name === 'Иван Иванов' && order.phone === '+79990000001' && order.address === 'Москва, ул. Пушкина 10', '3. Сбор ФИО/адреса/телефона работает');
    assert(order && orders.normalizeStatus(order.status) === 'payment_pending', '4. Полный заказ создаётся корректно и переходит в payment_pending');
    assert(paymentMessages.length === 1, '5. Реквизиты отправляются только при полном заказе');
    assert(user.state === 'COLLECTING', 'User state остаётся coarse-grained без legacy funnel шагов');

    await handleMessage({
      message_id: 4,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      caption: 'Оплатил, вот чек',
      photo: createPhotoStub(),
    });
    await queue.drain();

    order = await orders.getLatestByUser(user.id);
    const ownerReview = await db.query('SELECT * FROM owner_reviews WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [order.id]);
    policyRunRows = await db.query('SELECT * FROM policy_runs WHERE user_id = $1 ORDER BY created_at ASC', [user.id]);

    assert(orders.normalizeStatus(order.status) === 'payment_claimed', '6. Клиент отправляет чек -> ставится payment_claimed');
    assert(orders.normalizeStatus(order.status) !== 'payment_verified', '8. Нет автоперехода в payment_verified');
    assert(ownerReview.rows.length === 1 && ownerReview.rows[0].status === 'open', 'Owner review создаётся для ручной проверки оплаты');
    assert(policyRunRows.rows.some((row) => JSON.stringify(row.backend_actions).includes('mark_payment_claimed')), 'Backend action payment_claimed логируется');

    await withApiServer(async (baseUrl) => {
      const blocked = await axios.patch(`${baseUrl}/api/orders/${order.id}/status`, {
        status: 'payment_verified',
      }).catch((error) => error.response);
      assert(blocked.status === 400, '7. Общий status API не может ставить payment_verified');

      const response = await axios.post(`${baseUrl}/api/orders/${order.id}/payment/verify`);
      assert(response.data.order.status === 'payment_verified', '8. Владелец подтверждает -> payment_verified');
      assert(response.data.notification.notified === true, 'После payment_verified клиент получает подтверждение заказа');
    });

    order = await orders.getLatestByUser(user.id);
    const resolvedReview = await db.query('SELECT * FROM owner_reviews WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [order.id]);
    policyRunRows = await db.query('SELECT * FROM policy_runs WHERE user_id = $1 ORDER BY created_at ASC', [user.id]);
    const conversation = await messages.getByUser(user.id);
    const aiMessages = conversation.filter((message) => message.role === 'ai');
    const outboundMessages = conversation.filter((message) => ['ai', 'admin'].includes(message.role));

    assert(orders.normalizeStatus(order.status) === 'payment_verified', 'Order остаётся под ручным контролем до подтверждения владельцем');
    assert(resolvedReview.rows[0].status === 'verified', 'Owner review закрыт как verified');
    assert(outboundMessages.every((message) => ['pending', 'sent', 'delivered', 'failed'].includes(message.delivery_status)), 'Outbound сообщения используют строгую delivery модель');
    assert(aiMessages.every((message) => message.delivery_status === 'delivered'), 'Outbound сообщения получают delivery status');
    assert(aiMessages.some((message) => message.text.includes('заказ принят в работу')), 'Post-payment reply объясняет клиенту следующий шаг');
    assert(policyRunRows.rows.some((row) => JSON.stringify(row.input_json).includes('owner_payment_verified')), 'Owner-triggered reply тоже логируется в policy_runs');

    const beforeStaleCount = sentMessages.length;
    await db.query(
      "UPDATE users SET manager_active = true, manager_active_at = NOW() - INTERVAL '31 minutes' WHERE id = $1",
      [user.id]
    );
    await handleMessage({
      message_id: 5,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Хочу ещё одну пару',
    });
    await queue.drain();
    const refreshedUser = await users.getById(user.id);
    assert(sentMessages.length > beforeStaleCount, 'Stale manager_active не блокирует ответ AI');
    assert(refreshedUser.manager_active === false, 'Stale manager_active автоматически очищается');

    const stableBotStub = bot.sendMessage;
    bot.sendMessage = async () => {
      throw new Error('telegram_down');
    };

    await withApiServer(async (baseUrl) => {
      const failed = await axios.post(`${baseUrl}/api/users/${user.id}/messages`, {
        text: 'Ручная проверка доставки',
      }).catch((error) => error.response);
      assert(failed.status === 502, 'Ошибки Telegram не игнорируются в admin send flow');
    });

    bot.sendMessage = stableBotStub;
    const failedAdminMessage = (await messages.getByUser(user.id)).filter((message) => message.role === 'admin').at(-1);
    assert(failedAdminMessage.delivery_status === 'failed', 'Failed delivery сохраняется как failed, а не как отправленная');
    assert((failedAdminMessage.error_text || '').includes('telegram_down'), 'error_text сохраняет причину ошибки Telegram');

    const salesSource = fs.readFileSync(path.join(__dirname, '../logic/sales.js'), 'utf8');
    const policySource = fs.readFileSync(path.join(__dirname, '../policy/index.js'), 'utf8');
    assert(!salesSource.includes('speech_') && !policySource.includes('speech_'), '9. Нет шаблонов speech_* в runtime');
    assert(!fs.existsSync(path.join(__dirname, '../ai/decision.js')), 'Legacy decision.js удалён');
    assert(!fs.existsSync(path.join(__dirname, '../ai/offtopic.js')), 'Legacy offtopic.js удалён');
    assert(!fs.existsSync(path.join(__dirname, '../ai/validator.js')), 'Legacy validator.js удалён');
    assert(!fs.existsSync(path.join(__dirname, '../ai/optimizer.js')), 'Legacy optimizer.js удалён');
    assert(aiCallCount >= 4, '10. Нет обхода AI: каждый ключевой turn проходит через policy layer');
    assert(policyRunRows.rows.length >= 4, 'Все решения AI логируются в policy_runs');
    assert(policyRunRows.rows.every((row) => row.raw_output && row.decision_json), 'Policy runs сохраняют input/output и решение');
  } finally {
    bot.sendMessage = originalSendMessage;
    aiClient.sendMessage = originalAiSendMessage;
    shop.getCatalog = originalGetCatalog;
    await cleanup(TG_ID);
    queue.reset();
  }
}

async function main() {
  try {
    await runScenario();
  } catch (err) {
    console.error('\n❌ E2E crashed:', err);
    failed++;
  } finally {
    console.log(`\n📊 RESULT: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
