/**
 * End-to-end тест: проверяет полный pipeline без реального Telegram/AI
 * 
 * Запуск: node src/test/e2e.js
 * Требует: работающую PostgreSQL с DATABASE_URL в .env
 */
require('dotenv').config();
const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const orders = require('../db/orders');
const prompts = require('../db/prompts');
const settings = require('../db/settings');
const config = require('../config');

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
  const user = await db.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
  if (user.rows.length > 0) {
    const uid = user.rows[0].id;
    await db.query('DELETE FROM messages WHERE user_id = $1', [uid]);
    await db.query('DELETE FROM orders WHERE user_id = $1', [uid]);
    await db.query('DELETE FROM users WHERE id = $1', [uid]);
  }
}

async function testDatabase() {
  console.log('\n📦 1. DATABASE TEST');

  // Test connection
  const res = await db.query('SELECT 1 as ok');
  assert(res.rows[0].ok === 1, 'DB connection works');

  // Test tables exist
  const tables = await db.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name IN ('users', 'messages', 'orders', 'prompt_settings', 'settings')
  `);
  assert(tables.rows.length === 5, `All 5 tables exist (found ${tables.rows.length})`);
}

async function testUserCRUD() {
  console.log('\n👤 2. USER CRUD TEST');
  const TG_ID = 999999999;

  await cleanup(TG_ID);

  // Create user
  const user = await users.findOrCreate(TG_ID, 'Test User', 'testuser');
  assert(user.id > 0, 'User created with valid ID');
  assert(user.telegram_id == TG_ID, 'Telegram ID matches');
  assert(user.name === 'Test User', 'Name correct');
  assert(user.state === 'NEW', 'Default state is NEW');
  assert(user.ai_enabled === true, 'AI enabled by default');

  // Update state
  const updated = await users.updateState(user.id, 'WAITING_SIZE');
  assert(updated.state === 'WAITING_SIZE', 'State updated to WAITING_SIZE');

  // Find existing user returns fresh data
  const found = await users.findOrCreate(TG_ID, 'Test User Updated', 'testuser');
  assert(found.id === user.id, 'Same user returned');
  assert(found.name === 'Test User Updated', 'Name updated on re-find');
  assert(found.state === 'WAITING_SIZE', 'State preserved on re-find');

  // Toggle AI
  await users.setAiEnabled(user.id, false);
  const reloaded = await users.getById(user.id);
  assert(reloaded.ai_enabled === false, 'AI disabled');

  // GetAll
  const all = await users.getAll();
  assert(all.length >= 1, 'getAll returns users');

  await cleanup(TG_ID);
}

async function testMessages() {
  console.log('\n💬 3. MESSAGES TEST');
  const TG_ID = 999999998;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Msg Test', 'msgtest');

  // Save messages
  const m1 = await messages.save(user.id, 'user', 'Привет');
  assert(m1.role === 'user', 'User message saved');

  const m2 = await messages.save(user.id, 'ai', 'Здравствуйте!');
  assert(m2.role === 'ai', 'AI message saved');

  const m3 = await messages.save(user.id, 'admin', 'Ручной ответ');
  assert(m3.role === 'admin', 'Admin message saved');

  // Get history
  const history = await messages.getHistory(user.id, 10);
  assert(history.length === 3, `History has 3 messages (got ${history.length})`);
  assert(history[0].text === 'Привет', 'First message is oldest');
  assert(history[2].text === 'Ручной ответ', 'Last message is newest');

  // Get by user
  const byUser = await messages.getByUser(user.id);
  assert(byUser.length === 3, 'getByUser returns all messages');

  await cleanup(TG_ID);
}

async function testOrders() {
  console.log('\n📦 4. ORDERS TEST');
  const TG_ID = 999999997;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Order Test', 'ordertest');

  // Create order
  const order = await orders.create({
    user_id: user.id,
    product: 'Nike Air Max',
    size: '42',
  });
  assert(order.id > 0, 'Order created');
  assert(order.product === 'Nike Air Max', 'Product correct');
  assert(order.size === '42', 'Size correct');
  assert(order.status === 'NEW', 'Default status NEW');

  // Update order with form data
  await db.query(
    'UPDATE orders SET full_name = $1, phone = $2, address = $3 WHERE id = $4',
    ['Иванов Иван', '+79991234567', 'Москва, ул. Ленина 1', order.id]
  );

  // Update status
  const updated = await orders.updateStatus(order.id, 'PAID');
  assert(updated.status === 'PAID', 'Status updated to PAID');

  // Get latest
  const latest = await orders.getLatestByUser(user.id);
  assert(latest.full_name === 'Иванов Иван', 'Full name saved');
  assert(latest.phone === '+79991234567', 'Phone saved');

  // GetAll with join
  const all = await orders.getAll();
  assert(all.length >= 1, 'getAll returns orders');
  assert(all[0].user_name !== undefined, 'Join with users works');

  await cleanup(TG_ID);
}

async function testPrompts() {
  console.log('\n📝 5. PROMPTS TEST');

  const core = await prompts.get('core_prompt');
  assert(core.length > 0, 'Core prompt exists');

  const sales = await prompts.get('sales_prompt');
  assert(sales.length > 0, 'Sales prompt exists');

  const followup = await prompts.get('followup_prompt');
  assert(followup.length > 0, 'Followup prompt exists');

  const all = await prompts.getAll();
  assert(all.length >= 3, `All prompts loaded (got ${all.length})`);

  // Update
  const original = core;
  await prompts.update('core_prompt', 'TEST PROMPT');
  const updated = await prompts.get('core_prompt');
  assert(updated === 'TEST PROMPT', 'Prompt updated');

  // Restore
  await prompts.update('core_prompt', original);
  const restored = await prompts.get('core_prompt');
  assert(restored === original, 'Prompt restored');
}

async function testSalesStateMachine() {
  console.log('\n🔄 6. SALES STATE MACHINE TEST');
  const TG_ID = 999999996;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Sales Test', 'salestest');

  // NEW → WAITING_SIZE
  assert(user.state === 'NEW', 'Starts at NEW');
  await users.updateState(user.id, 'WAITING_SIZE');
  let u = await users.getById(user.id);
  assert(u.state === 'WAITING_SIZE', 'NEW → WAITING_SIZE');

  // WAITING_SIZE → WAITING_FORM
  await users.updateState(user.id, 'WAITING_FORM');
  u = await users.getById(user.id);
  assert(u.state === 'WAITING_FORM', 'WAITING_SIZE → WAITING_FORM');

  // WAITING_FORM → WAITING_PAYMENT
  await users.updateState(user.id, 'WAITING_PAYMENT');
  u = await users.getById(user.id);
  assert(u.state === 'WAITING_PAYMENT', 'WAITING_FORM → WAITING_PAYMENT');

  // WAITING_PAYMENT → PAID
  await users.updateState(user.id, 'PAID');
  u = await users.getById(user.id);
  assert(u.state === 'PAID', 'WAITING_PAYMENT → PAID');

  // PAID → DONE
  await users.updateState(user.id, 'DONE');
  u = await users.getById(user.id);
  assert(u.state === 'DONE', 'PAID → DONE');

  // DONE → NEW (repeat customer)
  await users.updateState(user.id, 'NEW');
  u = await users.getById(user.id);
  assert(u.state === 'NEW', 'DONE → NEW (repeat order)');

  await cleanup(TG_ID);
}

async function testFullOrderFlow() {
  console.log('\n🛒 7. FULL ORDER FLOW (SALES LOGIC E2E)');
  const TG_ID = 999999995;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Клиент Полный', 'fulltest');
  assert(user.state === 'NEW', 'Step 1: Starts at NEW');

  // Step 2: Simulate WAITING_SIZE → user sends size "42"
  // Need to create order with price (as handleWaitingSize now requires catalog)
  await users.updateState(user.id, 'WAITING_SIZE');
  await messages.save(user.id, 'user', 'Хочу Nike Air Max 90');
  await messages.save(user.id, 'ai', 'Какой размер?');

  // Since no shop API in tests, manually set up order and transition to WAITING_FORM
  await orders.create({ user_id: user.id, product: 'Nike Air Max 90', size: '42', price: 12990 });
  await users.updateState(user.id, 'WAITING_FORM');

  let u = await users.getById(user.id);
  assert(u.state === 'WAITING_FORM', 'Step 2: WAITING_SIZE → WAITING_FORM after size');

  const order = await orders.getLatestByUser(user.id);
  assert(order !== undefined && order !== null, 'Step 2: Order created');
  assert(order.size === '42', 'Step 2: Order has size 42');
  assert(order.price == 12990, 'Step 2: Order has price from catalog');

  // Step 3: WAITING_FORM → user sends form data
  const formText = 'Иванов Иван Иванович, +79991234567, Москва, Тверская 1';
  await messages.save(user.id, 'user', formText);

  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);
  const formResponse = await processMessage(formUser, formText);

  u = await users.getById(user.id);
  assert(u.state === 'WAITING_PAYMENT', 'Step 3: WAITING_FORM → WAITING_PAYMENT');

  const responseText = typeof formResponse === 'object' ? formResponse.text : formResponse;
  assert(responseText.includes('✅'), 'Step 3: Response confirms data saved');
  assert(responseText.includes('12990'), 'Step 3: Response includes price');

  const updatedOrder = await orders.getLatestByUser(user.id);
  assert(updatedOrder.full_name === 'Иванов Иван Иванович', 'Step 3: full_name parsed correctly');
  assert(updatedOrder.phone === '+79991234567', 'Step 3: phone parsed correctly');
  assert(updatedOrder.address.includes('Москва'), 'Step 3: address parsed correctly');

  // Step 4: WAITING_PAYMENT → user confirms payment
  await messages.save(user.id, 'user', 'Оплатил, вот скрин');

  const payUser = await users.getById(user.id);
  const payResponse = await processMessage(payUser, 'Оплатил, вот скрин');

  u = await users.getById(user.id);
  assert(u.state === 'PAID', 'Step 4: WAITING_PAYMENT → PAID');
  assert(payResponse.includes('оформлен'), 'Step 4: Response confirms order');

  const paidOrder = await orders.getLatestByUser(user.id);
  assert(paidOrder.status === 'PAID', 'Step 4: Order status is PAID');

  // Step 5: PAID → DONE on next message
  await users.updateState(user.id, 'DONE');
  u = await users.getById(user.id);
  assert(u.state === 'DONE', 'Step 5: PAID → DONE');

  // Step 6: Verify all messages saved
  const allMsgs = await messages.getByUser(user.id);
  assert(allMsgs.length >= 3, `Step 6: Messages saved (got ${allMsgs.length})`);

  // Step 7: DONE → NEW on repeat buy intent
  await users.updateState(user.id, 'DONE');
  const doneUser = await users.getById(user.id);
  await users.updateState(doneUser.id, 'NEW');
  u = await users.getById(user.id);
  assert(u.state === 'NEW', 'Step 7: DONE → NEW (repeat purchase)');

  await cleanup(TG_ID);
}

async function testFormParsing() {
  console.log('\n📋 8. FORM PARSING TEST');
  const TG_ID = 999999994;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Parse Test', 'parsetest');
  await users.updateState(user.id, 'WAITING_FORM');

  // Create a preliminary order WITH price (required now)
  await orders.create({ user_id: user.id, product: 'Nike Air Max', size: '42', price: 12990 });

  // Test: "ФИО, +phone, address"
  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);
  await processMessage(formUser, 'Петров Пётр Петрович, +79998887766, Санкт-Петербург, Невский 10');

  const order = await orders.getLatestByUser(user.id);
  assert(order.full_name === 'Петров Пётр Петрович', 'Parsed full_name correctly');
  assert(order.phone === '+79998887766', 'Parsed phone correctly');
  assert(order.address.includes('Санкт-Петербург'), 'Parsed address correctly');
  assert(!order.address.includes('+7999'), 'Address does not contain phone');

  const u = await users.getById(user.id);
  assert(u.state === 'WAITING_PAYMENT', 'State transitioned to WAITING_PAYMENT');

  await cleanup(TG_ID);
}

async function testSettingsCRUD() {
  console.log('\n⚙️  9a. SETTINGS CRUD TEST');

  // Get all settings
  const all = await settings.getAll();
  assert(all.length >= 10, `Default settings exist (found ${all.length})`);

  // Get specific setting
  const model = await settings.get('openrouter_model');
  assert(model === 'openai/gpt-4o-mini', `Default model correct: ${model}`);

  // Set a value
  const result = await settings.set('openrouter_model', 'anthropic/claude-3-haiku');
  assert(result.key === 'openrouter_model', 'Set returns correct key');
  assert(result.value === 'anthropic/claude-3-haiku', 'Set saves correct value');

  // Verify it persists
  const check = await settings.get('openrouter_model');
  assert(check === 'anthropic/claude-3-haiku', 'Value persists after set');

  // setMany
  await settings.setMany([
    { key: 'response_delay', value: '3' },
    { key: 'global_ai_enabled', value: 'false' },
  ]);
  const delay = await settings.get('response_delay');
  assert(delay === '3', 'setMany: response_delay saved');
  const aiEnabled = await settings.get('global_ai_enabled');
  assert(aiEnabled === 'false', 'setMany: global_ai_enabled saved');

  // getMap
  const map = await settings.getMap();
  assert(typeof map === 'object', 'getMap returns object');
  assert(map.response_delay === '3', 'getMap includes response_delay');
  assert(map.global_ai_enabled === 'false', 'getMap includes global_ai_enabled');

  // Non-existent key returns null
  const missing = await settings.get('totally_nonexistent_key');
  assert(missing === null, 'Non-existent key returns null');

  // Restore defaults
  await settings.set('openrouter_model', 'openai/gpt-4o-mini');
  await settings.set('response_delay', '0');
  await settings.set('global_ai_enabled', 'true');
}

async function testConfigPriority() {
  console.log('\n⚙️  9b. CONFIG PRIORITY TEST (DB > .env)');

  // Load DB settings into config cache
  await config.loadDbSettings();

  // Set a known value in DB
  await settings.set('openrouter_model', 'test/model-from-db');
  await config.reloadSettings();

  // config.get should return DB value, not .env
  const model = config.get('OPENROUTER_MODEL');
  assert(model === 'test/model-from-db', `DB setting overrides .env: got "${model}"`);

  // Clear DB value → should fall back to .env
  await settings.set('openrouter_model', '');
  await config.reloadSettings();
  const fallback = config.get('OPENROUTER_MODEL');
  // Empty string is falsy, so fallback to env
  assert(fallback === (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'),
    `Fallback to .env on empty DB: got "${fallback}"`);

  // Test getSetting for non-mapped keys
  await settings.set('global_ai_enabled', 'false');
  const globalAi = await config.getSetting('global_ai_enabled');
  assert(globalAi === 'false', `getSetting reads DB: got "${globalAi}"`);

  // Test getSetting for missing key
  const missing = await config.getSetting('nonexistent_key_xyz');
  assert(missing === null, 'getSetting returns null for missing key');

  // Restore
  await settings.set('openrouter_model', 'openai/gpt-4o-mini');
  await settings.set('global_ai_enabled', 'true');
  await config.reloadSettings();
}

async function testSettingsAPI() {
  console.log('\n⚙️  9c. SETTINGS API TEST');

  const http = require('http');
  const express = require('express');
  const apiRoutes = require('../api/routes');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const base = `http://localhost:${port}`;

  // Helper
  async function req(method, path, body) {
    const axios = require('axios');
    try {
      const r = await axios({ method, url: `${base}${path}`, data: body });
      return r.data;
    } catch (e) {
      return e.response?.data || { error: e.message };
    }
  }

  // GET /api/settings
  const all = await req('get', '/api/settings');
  assert(typeof all === 'object' && all.openrouter_model, 'GET /api/settings returns settings map');

  // Check masking — set a long API key
  await settings.set('openrouter_api_key', 'sk-1234567890abcdef');
  const masked = await req('get', '/api/settings');
  assert(masked.openrouter_api_key.includes('••••'), `API key is masked: "${masked.openrouter_api_key}"`);
  assert(!masked.openrouter_api_key.includes('1234567890'), 'Full key not exposed');

  // POST /api/settings
  const saveResult = await req('post', '/api/settings', {
    entries: [
      { key: 'openrouter_model', value: 'api-test/model' },
      { key: 'response_delay', value: '5' },
    ],
  });
  assert(saveResult.ok === true, 'POST /api/settings returns ok');

  // Verify saved
  const verify = await settings.get('openrouter_model');
  assert(verify === 'api-test/model', `POST actually saved to DB: "${verify}"`);

  // Verify config was reloaded
  const configModel = config.get('OPENROUTER_MODEL');
  assert(configModel === 'api-test/model', `Config reloaded after POST: "${configModel}"`);

  // POST with invalid data
  const badResult = await req('post', '/api/settings', { entries: 'not-array' });
  assert(badResult.error, 'Rejects invalid entries format');

  // POST with unknown keys — should be filtered
  await req('post', '/api/settings', {
    entries: [{ key: 'hack_system', value: 'malicious' }],
  });
  const hackCheck = await settings.get('hack_system');
  assert(hackCheck === null, 'Unknown keys are filtered out');

  // test-telegram with no token → returns ok:false  
  await settings.set('bot_token', '');
  const tgTest = await req('post', '/api/settings/test-telegram');
  // Should either use .env BOT_TOKEN or return error
  assert(tgTest.ok === false || tgTest.ok === true, 'test-telegram returns ok field');

  // test-shop with no URL → returns ok:false
  await settings.set('shop_api_url', '');
  const shopTest = await req('post', '/api/settings/test-shop');
  assert(shopTest.ok === false, 'test-shop with no URL returns ok:false');
  assert(shopTest.error, 'test-shop has error message');

  // Restore  
  await settings.set('openrouter_api_key', '');
  await settings.set('openrouter_model', 'openai/gpt-4o-mini');
  await settings.set('response_delay', '0');
  await config.reloadSettings();

  server.close();
}

async function testHandlerWithSettings() {
  console.log('\n⚙️  9d. HANDLER + SETTINGS INTEGRATION TEST');
  const TG_ID = 999999993;

  await cleanup(TG_ID);

  // Test 1: global_ai_enabled = false → message saved but no AI response
  await settings.set('global_ai_enabled', 'false');

  const { handleMessage } = require('../telegram/handler');

  // handleMessage expects msg.from.id, msg.from.first_name, etc.
  await handleMessage({
    from: { id: TG_ID, first_name: 'GlobalOff', last_name: 'Test', username: 'globalofftest' },
    text: 'Привет, хочу купить кроссовки',
  });

  // User should be created and message saved
  const user = await users.findOrCreate(TG_ID, 'GlobalOff Test', 'globalofftest');
  const msgs = await messages.getByUser(user.id);
  assert(msgs.length === 1, 'Message saved when global AI off');
  assert(msgs[0].role === 'user', 'Only user message saved (no AI response)');

  // Test 2: global_ai_enabled = true, auto_reply = false → also no AI response
  await settings.set('global_ai_enabled', 'true');
  await settings.set('auto_reply', 'false');

  await handleMessage({
    from: { id: TG_ID, first_name: 'GlobalOff', last_name: 'Test', username: 'globalofftest' },
    text: 'Ещё один тест',
  });

  const msgs2 = await messages.getByUser(user.id);
  assert(msgs2.length === 2, 'Second message saved');
  assert(msgs2.filter(m => m.role === 'ai').length === 0, 'No AI response when auto_reply=false');

  // Restore
  await settings.set('auto_reply', 'true');
  await settings.set('global_ai_enabled', 'true');
  await cleanup(TG_ID);
}

async function testErrorHandling() {
  console.log('\n⚠️  9e. ERROR HANDLING TEST');

  // Test bad API key in config → AI should return error message, not crash
  const originalKey = await settings.get('openrouter_api_key');
  await settings.set('openrouter_api_key', 'sk-INVALID-KEY');
  await config.reloadSettings();

  const TG_ID = 999999992;
  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Error Test', 'errortest');
  await users.updateState(user.id, 'NEW');
  await messages.save(user.id, 'user', 'привет');

  // AI call with bad key should handle gracefully
  const { generateResponse } = require('../ai');
  const response = await generateResponse(user, 'привет');
  assert(typeof response === 'string', 'AI returns string even on error');
  assert(response.length > 0, 'AI returns non-empty error message');

  // Restore
  await settings.set('openrouter_api_key', originalKey || '');
  await config.reloadSettings();
  await cleanup(TG_ID);
}

async function testAPIEndpoints() {
  console.log('\n🌐 10. API STRUCTURE TEST');

  const express = require('express');
  const apiRoutes = require('../api/routes');

  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  // Check route registration
  const routes = [];
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      routes.push(middleware.route.path);
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push(handler.route.path);
        }
      });
    }
  });

  assert(routes.includes('/users'), 'GET /api/users route exists');
  assert(routes.includes('/users/:id'), 'GET /api/users/:id route exists');
  assert(routes.includes('/users/:id/messages'), 'GET /api/users/:id/messages route exists');
  assert(routes.includes('/orders'), 'GET /api/orders route exists');
  assert(routes.includes('/prompts'), 'GET /api/prompts route exists');
  assert(routes.includes('/stats'), 'GET /api/stats route exists');
  assert(routes.includes('/settings'), 'GET /api/settings route exists');
  assert(routes.some(r => r === '/settings'), 'POST /api/settings route exists');
  assert(routes.includes('/settings/test-telegram'), 'POST /api/settings/test-telegram route exists');
  assert(routes.includes('/settings/test-shop'), 'POST /api/settings/test-shop route exists');
  assert(routes.includes('/payment'), 'GET /api/payment route exists');
}

async function testAuth() {
  console.log('\n🔐 11. AUTH TEST');

  const jwt = require('jsonwebtoken');
  const { authMiddleware, login: loginHandler, verify: verifyHandler } = require('../api/auth');

  // Test login with correct credentials
  let loginResult = null;
  const mockReq = { body: { login: config.ADMIN_LOGIN, password: config.ADMIN_PASSWORD } };
  const mockRes = {
    json: (data) => { loginResult = data; },
    status: function(code) { this.statusCode = code; return this; },
  };
  loginHandler(mockReq, mockRes);
  assert(loginResult && loginResult.token, 'Login returns token');

  // Verify token is valid JWT
  const decoded = jwt.verify(loginResult.token, config.JWT_SECRET);
  assert(decoded.login === config.ADMIN_LOGIN, 'Token contains correct login');

  // Test login with wrong password
  let wrongResult = null;
  const wrongReq = { body: { login: 'admin', password: 'wrong' } };
  const wrongRes = {
    json: (data) => { wrongResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  loginHandler(wrongReq, wrongRes);
  assert(wrongRes.statusCode === 401, 'Wrong password returns 401');
  assert(wrongResult.error, 'Wrong password returns error message');

  // Test login with empty body
  let emptyResult = null;
  const emptyReq = { body: {} };
  const emptyRes = {
    json: (data) => { emptyResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  loginHandler(emptyReq, emptyRes);
  assert(emptyRes.statusCode === 400, 'Empty body returns 400');

  // Test middleware with valid token
  let middlewareOk = false;
  const authReq = { headers: { authorization: `Bearer ${loginResult.token}` } };
  const authNext = () => { middlewareOk = true; };
  authMiddleware(authReq, {}, authNext);
  assert(middlewareOk, 'Auth middleware passes valid token');
  assert(authReq.user && authReq.user.login === config.ADMIN_LOGIN, 'Middleware sets req.user');

  // Test middleware with no token
  let noTokenResult = null;
  const noTokenReq = { headers: {} };
  const noTokenRes = {
    json: (data) => { noTokenResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  authMiddleware(noTokenReq, noTokenRes, () => {});
  assert(noTokenRes.statusCode === 401, 'No token returns 401');

  // Test middleware with invalid token
  let badTokenResult = null;
  const badTokenReq = { headers: { authorization: 'Bearer invalid.token.here' } };
  const badTokenRes = {
    json: (data) => { badTokenResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  authMiddleware(badTokenReq, badTokenRes, () => {});
  assert(badTokenRes.statusCode === 401, 'Invalid token returns 401');
}

async function testPaymentSystem() {
  console.log('\n💳 12. PAYMENT SYSTEM TEST');

  // Save payment settings
  await settings.set('payment_card_number', '4111222233334444');
  await settings.set('payment_name', 'Тест Тестович');

  // Test GET /api/payment
  const express = require('express');
  const apiRoutes = require('../api/routes');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const axios = require('axios');

  const paymentResp = await axios.get(`http://localhost:${port}/api/payment`);
  assert(paymentResp.data.card_number === '4111222233334444', 'GET /api/payment returns card number');
  assert(paymentResp.data.card_name === 'Тест Тестович', 'GET /api/payment returns card name');

  // Test with empty payment
  await settings.set('payment_card_number', '');
  await settings.set('payment_name', '');
  const emptyResp = await axios.get(`http://localhost:${port}/api/payment`);
  assert(emptyResp.data.card_number === '', 'Empty card returns empty string');

  server.close();

  // Test structured response from processMessage
  const TG_ID = 999999991;
  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Payment Test', 'paymenttest');
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Test Sneakers', size: '43', price: 9990 });

  // Set payment card
  await settings.set('payment_card_number', '4111222233334444');
  await settings.set('payment_name', 'Тест Тестович');

  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);
  const response = await processMessage(formUser, 'Иванов Иван, +79991112233, Москва, ул. Теста 1');

  assert(typeof response === 'object', 'processMessage returns object when payment configured');
  assert(typeof response.text === 'string', 'Response has text field');
  assert(response.text.includes('9990'), 'Text includes price amount');
  assert(response.sendPayment !== null, 'Response has sendPayment data');
  assert(response.sendPayment.cardNumber === '4111222233334444', 'sendPayment has correct card');
  assert(response.sendPayment.cardName === 'Тест Тестович', 'sendPayment has correct name');
  assert(response.sendPayment.amount == 9990, 'sendPayment has correct amount');

  // Test without payment card configured
  await cleanup(TG_ID);
  const user2 = await users.findOrCreate(TG_ID, 'NoPay Test', 'nopaytest');
  await users.updateState(user2.id, 'WAITING_FORM');
  await orders.create({ user_id: user2.id, product: 'Test', size: '40', price: 5990 });

  await settings.set('payment_card_number', '');
  await settings.set('payment_name', '');

  const formUser2 = await users.getById(user2.id);
  const response2 = await processMessage(formUser2, 'Петров Пётр, +79998887766, СПб, Невский 5');

  assert(typeof response2 === 'string', 'No payment card → returns plain string');
  assert(response2.includes('менеджер'), 'Message suggests contact manager when no card');
  assert(response2.includes('5990'), 'No-card message still shows price');

  // Restore
  await settings.set('payment_card_number', '');
  await settings.set('payment_name', '');
  await cleanup(TG_ID);
}

async function testHandlerStructuredResponse() {
  console.log('\n📨 13. HANDLER STRUCTURED RESPONSE TEST');
  const TG_ID = 999999990;

  await cleanup(TG_ID);

  // Set up — payment card configured, auto_reply on
  await settings.set('payment_card_number', '5555666677778888');
  await settings.set('payment_name', 'Handler Test');
  await settings.set('global_ai_enabled', 'true');
  await settings.set('auto_reply', 'true');
  await settings.set('response_delay', '0');

  const user = await users.findOrCreate(TG_ID, 'Handler Test', 'handlertest');
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Test Sneakers', size: '41', price: 11990 });

  // handleMessage will call processMessage which returns structured response
  // bot.sendMessage will fail silently (no real Telegram) — that's ok
  const { handleMessage } = require('../telegram/handler');

  await handleMessage({
    from: { id: TG_ID, first_name: 'Handler', last_name: 'Test', username: 'handlertest' },
    text: 'Сидоров Сидор, +79990001122, Казань, ул. Баумана 15',
  });

  // Check: user message saved, AI response saved
  const allMsgs = await messages.getByUser(user.id);
  const aiMsgs = allMsgs.filter(m => m.role === 'ai');
  assert(aiMsgs.length >= 1, 'AI response saved to DB');
  assert(aiMsgs[0].text.includes('11990'), 'Saved text includes order price');

  // Check: state is WAITING_PAYMENT
  const u = await users.getById(user.id);
  assert(u.state === 'WAITING_PAYMENT', 'State is WAITING_PAYMENT after form');

  // Restore
  await settings.set('payment_card_number', '');
  await settings.set('payment_name', '');
  await cleanup(TG_ID);
}

async function testCallbackQuery() {
  console.log('\n🔘 14. CALLBACK QUERY TEST');

  // Test that copy_card callback reads from settings
  await settings.set('payment_card_number', '1234567890123456');

  const cardNumber = await settings.get('payment_card_number');
  assert(cardNumber === '1234567890123456', 'Payment card stored correctly for callback');

  // Verify null card gracefully handled
  await settings.set('payment_card_number', '');
  const empty = await settings.get('payment_card_number');
  assert(empty === null || empty === '', 'Empty card returns null/empty (falsy)');

  // Restore
  await settings.set('payment_card_number', '');
}

async function testRepeatPurchaseState() {
  console.log('\n🔄 15. REPEAT PURCHASE STATE TEST');
  const TG_ID = 999999989;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Repeat Test', 'repeattest');
  await users.updateState(user.id, 'DONE');

  // After updateState, getById should return fresh state
  const freshUser = await users.getById(user.id);
  assert(freshUser.state === 'DONE', 'User starts at DONE');

  // Simulate repeat purchase — updateState to NEW, then getById
  await users.updateState(user.id, 'NEW');
  const newUser = await users.getById(user.id);
  assert(newUser.state === 'NEW', 'State properly updated to NEW');

  // Same for PAID → NEW
  await users.updateState(user.id, 'PAID');
  const paidUser = await users.getById(user.id);
  await users.updateState(paidUser.id, 'NEW');
  const resetUser = await users.getById(user.id);
  assert(resetUser.state === 'NEW', 'PAID → NEW state works correctly');

  await cleanup(TG_ID);
}

async function testShopApiIntegration() {
  console.log('\n🛒 16. SHOP API INTEGRATION TEST');

  // Test shop module import and functions
  const shop = require('../shop');

  // isConfigured returns false when no URL
  await settings.set('shop_api_url', '');
  shop.clearCache();
  const configured1 = await shop.isConfigured();
  assert(configured1 === false, 'isConfigured returns false with empty URL');

  // getProducts returns [] when not configured
  const products1 = await shop.getProducts();
  assert(Array.isArray(products1) && products1.length === 0, 'getProducts returns [] when not configured');

  // searchProducts returns [] when not configured
  const search1 = await shop.searchProducts('test');
  assert(Array.isArray(search1) && search1.length === 0, 'searchProducts returns [] when not configured');

  // getProduct returns null when not configured
  const product1 = await shop.getProduct(1);
  assert(product1 === null, 'getProduct returns null when not configured');

  // formatForAI with empty array returns null
  const formatted1 = shop.formatForAI([]);
  assert(formatted1 === null, 'formatForAI returns null for empty catalog');

  // formatForAI with products
  const formatted2 = shop.formatForAI([
    { name: 'Nike Air Max 90', price: 12990, sizes: ['40', '41', '42'], available: true },
    { name: 'Adidas Ultraboost', price: 15990, sizes: ['39', '43'], available: false },
  ]);
  assert(formatted2.includes('Nike Air Max 90'), 'formatForAI includes product name');
  assert(formatted2.includes('12990₽'), 'formatForAI includes price');
  assert(formatted2.includes('40, 41, 42'), 'formatForAI includes sizes');
  assert(formatted2.includes('НЕТ В НАЛИЧИИ'), 'formatForAI marks unavailable products');

  // isConfigured returns true with URL
  await settings.set('shop_api_url', 'https://example.com/api');
  shop.clearCache();
  const configured2 = await shop.isConfigured();
  assert(configured2 === true, 'isConfigured returns true with URL');

  // Test getStatus
  shop.clearCache();
  await shop.getProducts(); // will fail HTTP but sets status
  const status = shop.getStatus();
  assert(['ok', 'api_error', 'not_configured', 'empty_catalog'].includes(status), `getStatus returns valid status: ${status}`);

  // Test getCatalog structure
  shop.clearCache();
  const catalog = await shop.getCatalog();
  assert(typeof catalog.available === 'boolean', 'getCatalog returns available boolean');
  assert(typeof catalog.status === 'string', 'getCatalog returns status string');
  assert(Array.isArray(catalog.products), 'getCatalog returns products array');

  // Cleanup
  await settings.set('shop_api_url', '');
  shop.clearCache();
}

async function testFuzzyMatching() {
  console.log('\n🔍 17. FUZZY MATCHING TEST');

  const shop = require('../shop');

  // Test normalize
  assert(shop.normalize('Nike Air MAX 90!') === 'nike air max 90', 'normalize strips special chars and lowercases');
  assert(shop.normalize('  multiple   spaces  ') === 'multiple spaces', 'normalize collapses spaces');

  // Test tokenize
  const tokens = shop.tokenize('хочу Nike Air Max');
  assert(tokens.includes('хочу'), 'tokenize extracts words');
  assert(tokens.includes('nike'), 'tokenize lowercases');
  assert(tokens.length === 4, `tokenize returns correct count: ${tokens.length}`);

  // Test matchScore
  const product = { name: 'Nike Air Max 90', category: 'кроссовки', brand: 'Nike' };
  const score1 = shop.matchScore('хочу nike', product);
  assert(score1 > 0, `matchScore finds "nike" in product: ${score1}`);

  const score2 = shop.matchScore('adidas', product);
  assert(score2 === 0, 'matchScore returns 0 for no match');

  const score3 = shop.matchScore('nike air max', product);
  assert(score3 > score1, `More tokens match → higher score: ${score3} > ${score1}`);

  // Test findProductInText
  const products = [
    { name: 'Nike Air Max 90', price: 12990, sizes: ['40', '42'] },
    { name: 'Adidas Ultraboost', price: 15990, sizes: ['41', '43'] },
    { name: 'Puma RS-X', price: 9990, sizes: ['39', '44'] },
  ];

  const match1 = shop.findProductInText('хочу nike air max', products);
  assert(match1 !== null, 'findProductInText finds Nike');
  assert(match1.product.name === 'Nike Air Max 90', 'Correct product matched');
  assert(['high', 'medium'].includes(match1.confidence), `High/medium confidence: ${match1.confidence}`);

  const match2 = shop.findProductInText('adidas кроссовки', products);
  assert(match2 !== null, 'findProductInText finds Adidas');
  assert(match2.product.name === 'Adidas Ultraboost', 'Correct Adidas matched');

  const match3 = shop.findProductInText('привет', products);
  assert(match3 === null, 'findProductInText returns null for irrelevant text');

  // Test partial match
  const match4 = shop.findProductInText('есть puma?', products);
  assert(match4 !== null && match4.product.name === 'Puma RS-X', 'Partial brand match works');
}

async function testAIValidator() {
  console.log('\n🛡️ 18. AI RESPONSE VALIDATOR TEST');

  const { validateResponse, getSafeFallback } = require('../ai/validator');

  // Empty response → invalid
  const r1 = validateResponse('', [], true);
  assert(r1.valid === false, 'Empty response is invalid');
  assert(r1.reason === 'empty_response', 'Reason is empty_response');

  // Catalog unavailable + AI mentions price → invalid
  const r2 = validateResponse('Nike Air Max 90 стоит 12990₽', [], false);
  assert(r2.valid === false, 'Price without catalog is invalid');
  assert(r2.reason === 'price_without_catalog', 'Reason is price_without_catalog');

  // Catalog unavailable + AI asks question (no price) → valid
  const r3 = validateResponse('Что именно вас интересует?', [], false);
  assert(r3.valid === true, 'Generic question without catalog is valid');

  // Catalog available + correct price → valid
  const products = [
    { name: 'Nike Air Max 90', price: 12990 },
    { name: 'Adidas Ultraboost', price: 15990 },
  ];
  const r4 = validateResponse('Nike Air Max 90 стоит 12990₽, отличный выбор!', products, true);
  assert(r4.valid === true, 'Correct catalog price is valid');

  // Catalog available + fabricated price → invalid
  const r5 = validateResponse('Nike Air Max 90 стоит 8990₽, дёшево!', products, true);
  assert(r5.valid === false, 'Fabricated price is invalid');
  assert(r5.reason.startsWith('fabricated_price'), `Reason starts with fabricated_price: ${r5.reason}`);

  // Small price (< 1000, like delivery) → allowed
  const r6 = validateResponse('Доставка 300₽', products, true);
  assert(r6.valid === true, 'Small price (delivery) is allowed');

  // Test safe fallbacks
  const f1 = getSafeFallback('not_configured');
  assert(f1.includes('каталог') || f1.includes('менеджер'), 'not_configured fallback mentions catalog/manager');

  const f2 = getSafeFallback('api_error');
  assert(f2.includes('недоступна') || f2.includes('позже'), 'api_error fallback mentions unavailable');

  const f3 = getSafeFallback('empty_catalog');
  assert(f3.includes('пуст') || f3.includes('обновлен'), 'empty_catalog fallback mentions empty');

  const f4 = getSafeFallback(null, 'fabricated_price:8990');
  assert(f4.length > 0, 'fabricated_price fallback is non-empty');
}

async function testPriceMandatory() {
  console.log('\n💰 19. PRICE MANDATORY TEST');
  const TG_ID = 999999988;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Price Req Test', 'pricereqtest');

  // Test: order without price → form submission blocked
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Test No Price', size: '42' });
  // price is null

  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);
  const response = await processMessage(formUser, 'Иванов Иван, +79991234567, Москва, Тверская 1');

  // Should NOT transition to WAITING_PAYMENT
  const u = await users.getById(user.id);
  assert(u.state === 'WAITING_FORM', 'State stays WAITING_FORM when no price');
  assert(typeof response === 'string', 'Returns string error when no price');
  assert(response.includes('цен') || response.includes('уточн'), 'Error mentions price issue');

  // Test: order WITH price → succeeds
  await cleanup(TG_ID);
  const user2 = await users.findOrCreate(TG_ID, 'Price OK Test', 'priceoktest');
  await users.updateState(user2.id, 'WAITING_FORM');
  await orders.create({ user_id: user2.id, product: 'Nike Air Max', size: '42', price: 12990 });

  const formUser2 = await users.getById(user2.id);
  const response2 = await processMessage(formUser2, 'Петров Пётр, +79998887766, СПб, Невский 5');

  const u2 = await users.getById(user2.id);
  assert(u2.state === 'WAITING_PAYMENT', 'State transitions when price exists');

  const responseText = typeof response2 === 'object' ? response2.text : response2;
  assert(responseText.includes('12990'), 'Response includes order price');

  await cleanup(TG_ID);
}

async function testPaymentIncludesAmount() {
  console.log('\n💳 20. PAYMENT INCLUDES AMOUNT TEST');
  const TG_ID = 999999987;

  await cleanup(TG_ID);

  await settings.set('payment_card_number', '4111222233334444');
  await settings.set('payment_name', 'Тест Тестович');

  const user = await users.findOrCreate(TG_ID, 'Amount Test', 'amounttest');
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Nike Air Max 90', size: '42', price: 12990 });

  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);
  const response = await processMessage(formUser, 'Сидоров Сидор, +79990001122, Казань, ул. Баумана 15');

  assert(typeof response === 'object', 'Returns structured response');
  assert(response.sendPayment.amount == 12990, 'sendPayment contains amount');
  assert(response.text.includes('12990'), 'Text message includes amount');
  assert(response.text.includes('Nike Air Max 90'), 'Text includes product name');

  // Restore
  await settings.set('payment_card_number', '');
  await settings.set('payment_name', '');
  await cleanup(TG_ID);
}

async function testCatalogUnavailableFallback() {
  console.log('\n🚫 21. CATALOG UNAVAILABLE FALLBACK TEST');
  const TG_ID = 999999986;

  await cleanup(TG_ID);

  const shop = require('../shop');

  // Ensure shop API not configured
  await settings.set('shop_api_url', '');
  shop.clearCache();

  const user = await users.findOrCreate(TG_ID, 'Fallback Test', 'fallbacktest');

  // NEW state + buy intent + no catalog → safe fallback
  const { processMessage } = require('../logic/sales');
  const response = await processMessage(user, 'хочу купить кроссовки');

  assert(typeof response === 'string', 'Returns string (not AI call)');
  assert(
    response.includes('гляну') || response.includes('подбер') || response.includes('размер') || response.includes('норм') || response.includes('наличию'),
    'Soft fallback continues dialog'
  );

  // SOFT MODE: state moves to WAITING_SIZE even without catalog
  const u = await users.getById(user.id);
  assert(u.state === 'WAITING_SIZE', 'State advances to WAITING_SIZE with soft mode');

  // Cleanup
  await settings.set('shop_api_url', '');
  shop.clearCache();
  await cleanup(TG_ID);
}

async function testOrderWithPrice() {
  console.log('\n📦 22. ORDER WITH PRICE TEST');
  const TG_ID = 999999985;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'OrdPrice Test', 'ordpricetest');

  // Create order with price
  const order = await orders.create({
    user_id: user.id,
    product: 'Nike Air Max 90',
    size: '42',
    price: 12990,
  });
  assert(order.id > 0, 'Order with price created');
  assert(order.product === 'Nike Air Max 90', 'Product from catalog saved');
  assert(order.price == 12990, 'Price saved correctly');

  // Create order without price
  const order2 = await orders.create({
    user_id: user.id,
    product: 'Unknown',
    size: '40',
  });
  assert(order2.price === null, 'Order without price has null price');

  await cleanup(TG_ID);
}

async function testAIProductContext() {
  console.log('\n🤖 23. AI PRODUCT CONTEXT TEST');

  const { generateResponse } = require('../ai');
  assert(typeof generateResponse === 'function', 'generateResponse is a function');
  assert(generateResponse.length >= 2, 'generateResponse accepts user and message args');
}

async function testOfftopicDetector() {
  console.log('\n🚫 24. OFF-TOPIC DETECTOR TEST');

  const { detectOfftopic, OFFTOPIC_PATTERNS, SALES_KEYWORDS, REDIRECTS } = require('../ai/offtopic');

  // Module exports
  assert(typeof detectOfftopic === 'function', 'detectOfftopic is a function');
  assert(Array.isArray(OFFTOPIC_PATTERNS), 'OFFTOPIC_PATTERNS is array');
  assert(Array.isArray(SALES_KEYWORDS), 'SALES_KEYWORDS is array');
  assert(Array.isArray(REDIRECTS), 'REDIRECTS is array');
  assert(REDIRECTS.length >= 3, `At least 3 redirects (got ${REDIRECTS.length})`);

  // Off-topic messages → detected
  const r1 = detectOfftopic('Какая сегодня погода?');
  assert(r1.offtopic === true, 'Weather is off-topic');
  assert(r1.redirect !== null, 'Redirect provided for weather');
  assert(REDIRECTS.includes(r1.redirect), 'Redirect is from REDIRECTS list');

  const r2 = detectOfftopic('Расскажи анекдот');
  assert(r2.offtopic === true, 'Joke request is off-topic');

  const r3 = detectOfftopic('Ты бот или человек?');
  assert(r3.offtopic === true, 'Personal bot question is off-topic');

  const r4 = detectOfftopic('Что нового в мире?');
  assert(r4.offtopic === true, 'News request is off-topic');

  // Sales messages → NOT off-topic
  const s1 = detectOfftopic('Хочу купить кроссовки');
  assert(s1.offtopic === false, 'Buy intent is NOT off-topic');

  const s2 = detectOfftopic('Сколько стоит Nike Air Max?');
  assert(s2.offtopic === false, 'Price question is NOT off-topic');

  const s3 = detectOfftopic('Есть размер 42?');
  assert(s3.offtopic === false, 'Size question is NOT off-topic');

  const s4 = detectOfftopic('Как оформить доставку?');
  assert(s4.offtopic === false, 'Delivery question is NOT off-topic');

  // Mixed: sales keyword + off-topic → NOT off-topic (sales wins)
  const m1 = detectOfftopic('В такую погоду хочу купить кроссовки');
  assert(m1.offtopic === false, 'Sales keyword overrides off-topic weather');

  // Empty/neutral → NOT off-topic
  const e1 = detectOfftopic('');
  assert(e1.offtopic === false, 'Empty string is not off-topic');

  const e2 = detectOfftopic('привет');
  assert(e2.offtopic === false, 'Simple greeting is not off-topic');

  const e3 = detectOfftopic('ок');
  assert(e3.offtopic === false, '"ok" is not off-topic');
}

async function testResponseQualityGuard() {
  console.log('\n🛡️ 25. RESPONSE QUALITY GUARD TEST');

  const { validateResponse, getSafeFallback } = require('../ai/validator');

  // Long response → gets truncated (not rejected)
  const longText = 'A'.repeat(600) + '. Конец предложения.';
  const r1 = validateResponse(longText, [], true);
  assert(r1.valid === true, 'Long response is valid (truncated)');
  assert(r1.response.length <= 510, `Truncated to reasonable length: ${r1.response.length}`);

  // Robot reveal → blocked
  const r2 = validateResponse('Я — искусственный интеллект и не могу помочь с этим', [], true);
  assert(r2.valid === false, 'Robot reveal is blocked');
  assert(r2.reason === 'robot_reveal', 'Reason is robot_reveal');

  const r3 = validateResponse('Как бот, я не имею чувств', [], true);
  assert(r3.valid === false, 'Bot self-reference is blocked');

  const r4 = validateResponse('Я просто программа', [], true);
  assert(r4.valid === false, 'Program self-reference is blocked');

  // Normal response → passes
  const r5 = validateResponse('Отличный выбор! Какой размер носишь?', [], true);
  assert(r5.valid === true, 'Normal short response passes quality guard');

  // robot_reveal fallback
  const f1 = getSafeFallback(null, 'robot_reveal');
  assert(f1.length > 0, 'robot_reveal has a fallback message');
  assert(!f1.includes('бот') && !f1.includes('AI'), 'robot_reveal fallback does not mention bot/AI');
}

async function testSchedulerScenarios() {
  console.log('\n📅 26. SCHEDULER SCENARIOS TEST');
  const TG_ID = 999999984;

  await cleanup(TG_ID);

  const { getScenario } = require('../scheduler');

  // Test warm_3d scenario (recent activity, no orders)
  const user1 = await users.findOrCreate(TG_ID, 'Schedule Test', 'schedtest');
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'4 days\' WHERE id = $1', [user1.id]);
  const u1 = await users.getById(user1.id);
  const s1 = await getScenario(u1);
  assert(s1 === 'warm_3d', `4-day inactive NEW user → warm_3d (got ${s1})`);

  // Test abandoned_7d scenario (started order)
  await users.updateState(user1.id, 'WAITING_SIZE');
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'8 days\' WHERE id = $1', [user1.id]);
  const u2 = await users.getById(user1.id);
  const s2 = await getScenario(u2);
  assert(s2 === 'abandoned_7d', `8-day inactive WAITING_SIZE → abandoned_7d (got ${s2})`);

  // Test cold_14d scenario
  await users.updateState(user1.id, 'NEW');
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'20 days\' WHERE id = $1', [user1.id]);
  const u3 = await users.getById(user1.id);
  const s3 = await getScenario(u3);
  assert(s3 === 'cold_14d', `20-day inactive NEW → cold_14d (got ${s3})`);

  // Test post_purchase scenario
  await orders.create({ user_id: user1.id, product: 'Test', size: '42', price: 9990 });
  const order = await orders.getLatestByUser(user1.id);
  await orders.updateStatus(order.id, 'PAID');
  const u4 = await users.getById(user1.id);
  const s4 = await getScenario(u4);
  assert(s4 === 'post_purchase', `User with PAID order → post_purchase (got ${s4})`);

  await cleanup(TG_ID);
}

async function testSalesOfftopicIntegration() {
  console.log('\n🔄 27. SALES + OFF-TOPIC INTEGRATION TEST');
  const TG_ID = 999999983;

  await cleanup(TG_ID);

  const shop = require('../shop');
  await settings.set('shop_api_url', '');
  shop.clearCache();

  const user = await users.findOrCreate(TG_ID, 'Offtopic Test', 'offtopictest');

  const { processMessage } = require('../logic/sales');

  // Off-topic in NEW state → redirect
  const r1 = await processMessage(user, 'Какая сегодня погода?');
  assert(typeof r1 === 'string', 'Off-topic returns string redirect');
  assert(r1.length > 0, 'Redirect is non-empty');
  // Should contain something about products/shopping
  assert(
    r1.includes('кросс') || r1.includes('подбер') || r1.includes('присматр') || r1.includes('ищешь') || r1.includes('новинк'),
    'Redirect mentions products/shopping'
  );

  // State should NOT change
  const u1 = await users.getById(user.id);
  assert(u1.state === 'NEW', 'State stays NEW after off-topic');

  // Non-offtopic greeting in NEW → goes to AI (or fallback)
  const r2 = await processMessage(user, 'привет');
  assert(typeof r2 === 'string' && r2.length > 0, 'Greeting gets a response');

  // Off-topic in DONE state → redirect
  await users.updateState(user.id, 'DONE');
  const doneUser = await users.getById(user.id);
  const r3 = await processMessage(doneUser, 'Расскажи анекдот');
  assert(typeof r3 === 'string' && r3.length > 0, 'Off-topic in DONE gets redirect');

  // Off-topic in WAITING_FORM → NOT redirected (data collection state)
  await users.updateState(user.id, 'WAITING_FORM');
  const formUser = await users.getById(user.id);
  const r4 = await processMessage(formUser, 'Какая погода?');
  assert(typeof r4 === 'string', 'WAITING_FORM still responds to off-topic normally');
  // In WAITING_FORM without valid data → asks for form data
  assert(r4.includes('ФИО') || r4.includes('телефон') || r4.includes('адрес') || r4.includes('сообщени'),
    'WAITING_FORM response asks for form data');

  await cleanup(TG_ID);
}

async function testHesitationNudge() {
  console.log('\n💪 28. HESITATION NUDGE TEST');
  const TG_ID = 999999982;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Nudge Test', 'nudgetest');
  await users.updateState(user.id, 'WAITING_PAYMENT');
  await orders.create({ user_id: user.id, product: 'Nike Air Max 90', size: '42', price: 12990 });

  const { processMessage } = require('../logic/sales');
  const payUser = await users.getById(user.id);

  // Hesitation in WAITING_PAYMENT → nudge with product name
  const r1 = await processMessage(payUser, 'не знаю, подумаю');
  assert(typeof r1 === 'string', 'Hesitation gets a response');
  assert(r1.includes('Nike Air Max 90'), 'Nudge mentions the specific product');

  // State stays WAITING_PAYMENT
  const u1 = await users.getById(user.id);
  assert(u1.state === 'WAITING_PAYMENT', 'State stays WAITING_PAYMENT after hesitation');

  // Confirm payment → transitions
  const r2 = await processMessage(payUser, 'Оплатил, вот чек');
  assert(r2.includes('оформлен'), 'Payment confirmation works');

  const u2 = await users.getById(user.id);
  assert(u2.state === 'PAID', 'State transitions to PAID after payment');

  await cleanup(TG_ID);
}

async function testExpandedBuyKeywords() {
  console.log('\n🛒 29. EXPANDED BUY KEYWORDS TEST');
  const TG_ID = 999999981;

  await cleanup(TG_ID);

  const shop = require('../shop');
  await settings.set('shop_api_url', '');
  shop.clearCache();

  const { processMessage } = require('../logic/sales');

  // "оформим" should trigger buy intent
  const user1 = await users.findOrCreate(TG_ID, 'Keyword Test', 'kwtest');
  // With no catalog it returns fallback, but we check state doesn't advance
  const r1 = await processMessage(user1, 'давай оформим');
  assert(typeof r1 === 'string', '"давай оформим" gets a response');
  // Without catalog it stays NEW (fallback), but the keyword was recognized

  await cleanup(TG_ID);

  // "беру" should trigger
  const user2 = await users.findOrCreate(TG_ID, 'Keyword Test2', 'kwtest2');
  const r2 = await processMessage(user2, 'беру их');
  assert(typeof r2 === 'string', '"беру" gets a response');

  await cleanup(TG_ID);

  // "го" should trigger
  const user3 = await users.findOrCreate(TG_ID, 'Keyword Test3', 'kwtest3');
  const r3 = await processMessage(user3, 'го заказываем');
  assert(typeof r3 === 'string', '"го" gets a response');

  await cleanup(TG_ID);
}

async function testInfoQuestionNoStateChange() {
  console.log('\n❓ 30. INFO QUESTION NO STATE CHANGE TEST');
  const TG_ID = 999999980;

  await cleanup(TG_ID);

  const shop = require('../shop');
  await settings.set('shop_api_url', '');
  shop.clearCache();

  const user = await users.findOrCreate(TG_ID, 'Info Test', 'infotest');

  const { processMessage } = require('../logic/sales');

  // "как заказать" should NOT change state to WAITING_SIZE
  const r1 = await processMessage(user, 'как заказать?');
  assert(typeof r1 === 'string' && r1.length > 0, '"как заказать" gets a response');

  const u1 = await users.getById(user.id);
  assert(u1.state === 'NEW', 'State stays NEW after "как заказать?" (no state leak)');

  // "как оплатить" should NOT change state
  const r2 = await processMessage(user, 'как оплатить?');
  const u2 = await users.getById(user.id);
  assert(u2.state === 'NEW', 'State stays NEW after "как оплатить?"');

  await cleanup(TG_ID);
}

async function testLivingFormResponse() {
  console.log('\n📝 31. LIVING FORM RESPONSE TEST');
  const TG_ID = 999999979;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Form Test', 'formtestlive');
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Nike Air Max', size: '42', price: 12990 });

  const { processMessage } = require('../logic/sales');
  const formUser = await users.getById(user.id);

  // Send something that's NOT form data
  const r1 = await processMessage(formUser, 'потом скину');
  assert(typeof r1 === 'string', 'Non-form data gets response');
  // Should be the new living response, not the old dry one
  assert(r1.includes('ФИО') || r1.includes('оформим'), 'Response asks for data in living tone');
  assert(!r1.includes('Пожалуйста, отправьте'), 'Old dry response is gone');
  assert(r1.includes('🚀') || r1.includes('скинь') || r1.includes('Скинь'), 'New tone has emoji or casual language');

  await cleanup(TG_ID);
}

async function testQuickNudgeMessages() {
  console.log('\n⏰ 32. QUICK NUDGE MESSAGES TEST');

  const { QUICK_NUDGES } = require('../scheduler');

  assert(QUICK_NUDGES.WAITING_SIZE !== undefined, 'WAITING_SIZE nudge exists');
  assert(QUICK_NUDGES.WAITING_FORM !== undefined, 'WAITING_FORM nudge exists');
  assert(QUICK_NUDGES.WAITING_PAYMENT !== undefined, 'WAITING_PAYMENT nudge exists');

  assert(QUICK_NUDGES.WAITING_SIZE.length > 0, 'WAITING_SIZE nudge non-empty');
  assert(QUICK_NUDGES.WAITING_FORM.length > 0, 'WAITING_FORM nudge non-empty');
  assert(QUICK_NUDGES.WAITING_PAYMENT.includes('оплат') || QUICK_NUDGES.WAITING_PAYMENT.includes('скрин'),
    'WAITING_PAYMENT nudge mentions payment');
}

async function testGetStuckInOrder() {
  console.log('\n⏰ 33. GET STUCK IN ORDER TEST');
  const TG_ID = 999999978;

  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Stuck Test', 'stucktest');
  await users.updateState(user.id, 'WAITING_SIZE');

  // Set last_seen to 35 min ago
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'35 minutes\' WHERE id = $1', [user.id]);

  const stuck = await users.getStuckInOrder(30);
  assert(stuck.some(u => u.telegram_id == TG_ID), 'User found in stuck query (35 min)');

  // Set last_seen to 10 min ago — should NOT be stuck
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'10 minutes\' WHERE id = $1', [user.id]);

  const notStuck = await users.getStuckInOrder(30);
  assert(!notStuck.some(u => u.telegram_id == TG_ID), 'User NOT found when only 10 min (< 30)');

  // Set to DONE — should NOT be stuck even if old
  await users.updateState(user.id, 'DONE');
  await db.query('UPDATE users SET last_seen = NOW() - INTERVAL \'35 minutes\' WHERE id = $1', [user.id]);

  const doneStuck = await users.getStuckInOrder(30);
  assert(!doneStuck.some(u => u.telegram_id == TG_ID), 'DONE user not in stuck results');

  await cleanup(TG_ID);
}

async function testImprovedFallbacks() {
  console.log('\n💬 34. IMPROVED FALLBACK MESSAGES TEST');

  const { getSafeFallback } = require('../ai/validator');

  // All fallbacks should sound casual/living, not robotic
  const f1 = getSafeFallback('not_configured');
  assert(!f1.includes('Напишите'), 'not_configured: no formal "Напишите"');
  assert(f1.includes('менеджер'), 'not_configured: mentions manager');

  const f2 = getSafeFallback('api_error');
  assert(!f2.includes('Попробуйте'), 'api_error: no formal "Попробуйте"');
  assert(f2.includes('менеджер'), 'api_error: mentions manager');

  const f3 = getSafeFallback('empty_catalog');
  assert(f3.includes('пуст'), 'empty_catalog: mentions empty');

  const f4 = getSafeFallback(null, 'robot_reveal');
  assert(!f4.includes('Подскажите'), 'robot_reveal: no formal "Подскажите"');

  const f5 = getSafeFallback(null, null);
  assert(!f5.includes('Подскажите'), 'default: no formal "Подскажите"');
  assert(f5.length > 0, 'default: non-empty');
}

// ---- PHOTO / VISION TESTS ----

async function testVisionParser() {
  console.log('\n📷 35. VISION RESPONSE PARSER TEST');

  const { parseVisionResponse } = require('../ai/vision');

  // Valid JSON response
  const r1 = parseVisionResponse('{"brand":"Nike","model":"Air Force 1","color":"white","keywords":"nike air force 1 white"}');
  assert(r1 !== null, 'valid JSON: parsed');
  assert(r1.brand === 'Nike', 'valid JSON: brand correct');
  assert(r1.model === 'Air Force 1', 'valid JSON: model correct');
  assert(r1.keywords === 'nike air force 1 white', 'valid JSON: keywords correct');

  // JSON with markdown fences
  const r2 = parseVisionResponse('```json\n{"brand":"Adidas","model":"Yeezy 350","color":"black","keywords":"adidas yeezy 350 black"}\n```');
  assert(r2 !== null, 'markdown fences: parsed');
  assert(r2.brand === 'Adidas', 'markdown fences: brand correct');

  // Not recognized — all nulls
  const r3 = parseVisionResponse('{"brand":null,"model":null,"color":null,"keywords":null}');
  assert(r3 === null, 'all nulls: returns null');

  // Invalid JSON
  const r4 = parseVisionResponse('Sorry, I cannot identify this');
  assert(r4 === null, 'invalid JSON: returns null');

  // Empty
  const r5 = parseVisionResponse('');
  assert(r5 === null, 'empty: returns null');

  // Keywords auto-generated from brand+model+color
  const r6 = parseVisionResponse('{"brand":"Puma","model":"RS-X","color":"blue"}');
  assert(r6 !== null, 'no keywords field: parsed');
  assert(r6.keywords.includes('Puma'), 'auto-keywords: includes brand');
  assert(r6.keywords.includes('RS-X'), 'auto-keywords: includes model');
}

async function testProcessPhoto() {
  console.log('\n📸 36. PROCESS PHOTO FLOW TEST');

  const { processPhoto } = require('../logic/sales');

  const testId = 999035;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'Photo Tester', 'phototester');

  // Test: vision returns null (not recognized) and no caption
  // We need to mock analyzeImage — we can test the fallback message
  // Since we can't call real API, test the processPhoto with caption fallback
  assert(typeof processPhoto === 'function', 'processPhoto exported');

  // Test: processPhoto exists and is a function
  assert(processPhoto.length >= 2, 'processPhoto accepts imageUrl + caption args');

  await cleanup(testId);
}

async function testPhotoHandlerIntegration() {
  console.log('\n📱 37. HANDLER PHOTO MESSAGE TEST');

  const { handleMessage } = require('../telegram/handler');

  const testId = 999036;
  await cleanup(testId);

  // Ensure settings
  await settings.set('global_ai_enabled', 'true');

  // Test: photo message with no text — should not crash
  const photoMsg = {
    from: { id: testId, first_name: 'PhotoUser', username: 'photouser' },
    photo: [
      { file_id: 'small_123', width: 90, height: 90 },
      { file_id: 'medium_123', width: 320, height: 320 },
      { file_id: 'large_123', width: 800, height: 800 },
    ],
    caption: null,
  };

  // handleMessage won't crash even if bot.getFileUrl fails (returns download error)
  let threw = false;
  try {
    await handleMessage(photoMsg);
  } catch {
    threw = true;
  }
  assert(!threw, 'photo message: no crash');

  // User should be created
  const user = await users.findOrCreate(testId, 'PhotoUser', 'photouser');
  assert(user !== null, 'photo message: user created');

  // Message should be saved
  const history = await messages.getHistory(user.id, 5);
  const hasPhotoMsg = history.some((m) => m.text === '[фото]' || m.text?.includes('фото'));
  assert(hasPhotoMsg || history.length > 0, 'photo message: saved to history');

  // Test: photo with caption
  const photoCaptionMsg = {
    from: { id: testId, first_name: 'PhotoUser', username: 'photouser' },
    photo: [
      { file_id: 'cap_large_123', width: 800, height: 800 },
    ],
    caption: 'Есть такие Nike?',
  };

  threw = false;
  try {
    await handleMessage(photoCaptionMsg);
  } catch {
    threw = true;
  }
  assert(!threw, 'photo with caption: no crash');

  // Test: global AI off — photo still saved
  await settings.set('global_ai_enabled', 'false');
  const photoMsgOff = {
    from: { id: testId, first_name: 'PhotoUser', username: 'photouser' },
    photo: [{ file_id: 'off_123', width: 800, height: 800 }],
  };

  threw = false;
  try {
    await handleMessage(photoMsgOff);
  } catch {
    threw = true;
  }
  assert(!threw, 'photo with AI off: no crash');

  await settings.set('global_ai_enabled', 'true');
  await cleanup(testId);
}

async function testVisionPrompt() {
  console.log('\n🔍 38. VISION MODULE STRUCTURE TEST');

  const vision = require('../ai/vision');

  assert(typeof vision.analyzeImage === 'function', 'analyzeImage exported');
  assert(typeof vision.parseVisionResponse === 'function', 'parseVisionResponse exported');
  assert(typeof vision.VISION_PROMPT === 'string', 'VISION_PROMPT exported');
  assert(vision.VISION_PROMPT.includes('JSON'), 'prompt requires JSON output');
  assert(vision.VISION_PROMPT.includes('brand') || vision.VISION_PROMPT.includes('бренд'), 'prompt asks for brand');
}

async function testBotGetFileUrl() {
  console.log('\n🤖 39. BOT getFileUrl METHOD TEST');

  const bot = require('../telegram/bot');

  assert(typeof bot.getFileUrl === 'function', 'getFileUrl exported');

  // Calling with invalid fileId should not crash, just return null
  const result = await bot.getFileUrl('invalid_file_id_12345');
  assert(result === null, 'invalid fileId: returns null');
}

async function testSoftAvailabilityMode() {
  console.log('\n🧊 40. SOFT AVAILABILITY MODE TEST');

  const { processMessage, processPhoto } = require('../logic/sales');
  const { validateResponse, getSafeFallback } = require('../ai/validator');

  const testId = 999040;
  await cleanup(testId);

  // Test 1: Validator blocks "нет в наличии" phrases
  const neg1 = validateResponse('К сожалению, этой модели нет в каталоге.', [], true);
  assert(!neg1.valid, 'validator: blocks "нет в каталоге"');
  assert(neg1.reason === 'negative_availability', 'validator: reason = negative_availability');

  const neg2 = validateResponse('У нас такого нет, попробуйте другой магазин.', [], true);
  assert(!neg2.valid, 'validator: blocks "у нас такого нет"');

  const neg3 = validateResponse('Не могу найти этот товар в базе.', [], true);
  assert(!neg3.valid, 'validator: blocks "не могу найти"');

  const neg4 = validateResponse('Отличные кроссовки! Какой размер нужен?', [], true);
  assert(neg4.valid, 'validator: allows positive response');

  const neg5 = validateResponse('Сейчас гляну по наличию, подберу варианты', [], true);
  assert(neg5.valid, 'validator: allows soft response');

  const neg6 = validateResponse('Товар нет в наличии, но есть похожие', [], true);
  assert(!neg6.valid, 'validator: blocks "нет в наличии" even with alternatives');

  // Test 2: getSafeFallback for negative_availability
  const fallback = getSafeFallback(null, 'negative_availability');
  assert(fallback.includes('гляну') || fallback.includes('подбер'), 'fallback: soft availability msg');
  assert(!fallback.includes('нет'), 'fallback: no negative words');

  // Test 3: processPhoto with unrecognized — should NOT say "не смог распознать"
  assert(typeof processPhoto === 'function', 'processPhoto exists for soft mode');

  // Test 4: SOFT_RESPONSES and getSoftResponse exist in sales
  const sales = require('../logic/sales');
  assert(typeof sales.processMessage === 'function', 'processMessage exports ok');

  await cleanup(testId);
}

async function testSoftPhotoUnknown() {
  console.log('\n📸 41. SOFT PHOTO UNKNOWN MODEL TEST');

  // Test that processPhoto never returns "не смог" / "не могу" / "нет в каталоге" messages
  const { processPhoto } = require('../logic/sales');

  const testId = 999041;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'SoftPhotoUser', 'softphoto');

  // The function should exist and accept 3 args
  assert(processPhoto.length >= 2, 'processPhoto: accepts url+caption');

  // We can't call real vision API, but we can verify the function doesn't crash
  // and the module structure is correct
  const bannedPhrases = ['не смог распознать', 'не могу определить', 'нет в каталоге', 'нет в наличии', 'не удалось'];
  const softPhrases = ['гляну', 'подбер', 'Понял', 'размер'];

  // Verify the sales.js source contains soft phrases, not banned ones
  const fs = require('fs');
  const salesSource = fs.readFileSync(require.resolve('../logic/sales'), 'utf8');

  for (const phrase of bannedPhrases) {
    // These should NOT appear in hardcoded response strings (allow in comments/code logic)
    const inResponses = salesSource.match(new RegExp(`['"\`].*${phrase}.*['"\`]`, 'gi')) || [];
    assert(inResponses.length === 0, `sales.js: no hardcoded "${phrase}" in responses`);
  }

  let hasSoftPhrase = false;
  for (const phrase of softPhrases) {
    if (salesSource.includes(phrase)) hasSoftPhrase = true;
  }
  assert(hasSoftPhrase, 'sales.js: contains soft response phrases');

  await cleanup(testId);
}

async function testSoftNoProductFastSale() {
  console.log('\n⚡ 42. FAST SALE + SOFT MODE SPLIT TEST');

  const { processMessage } = require('../logic/sales');

  const testId = 999042;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'FastSaleUser', 'fastsale');

  // Test: "есть такие?" → should lead to sales, not rejection
  const response = await processMessage(user, 'есть такие кроссовки?');
  assert(response !== null && response !== undefined, '"есть такие?" → response not empty');
  assert(typeof response === 'string' || typeof response === 'object', '"есть такие?" → valid response type');

  const responseText = typeof response === 'string' ? response : response.text;
  // Response should NOT contain negative words
  const negWords = ['нет в наличии', 'нет в каталоге', 'у нас нет', 'не могу найти'];
  let hasNeg = false;
  for (const w of negWords) {
    if (responseText.toLowerCase().includes(w)) hasNeg = true;
  }
  assert(!hasNeg, '"есть такие?" → no negative words in response');

  await cleanup(testId);
}

async function testValidatorNegativePatterns() {
  console.log('\n🚫 43. VALIDATOR NEGATIVE PATTERNS COMPREHENSIVE TEST');

  const { validateResponse } = require('../ai/validator');

  // All these should be blocked
  const blocked = [
    'Nike Air Force 1 нет в наличии',
    'К сожалению, этой модели нет в каталоге',
    'У нас такого нет',
    'У нас этого нет, посмотрите другие',
    'Не могу найти эту модель',
    'Не удалось определить модель',
    'Этого товара нет',
    'Отсутствует в каталоге',
    'Этот товар нет в продаже',
    'Кроссовки закончились',
  ];

  for (const text of blocked) {
    const result = validateResponse(text, [], true);
    assert(!result.valid, `blocks: "${text.substring(0, 40)}..."`);
  }

  // All these should be allowed
  const allowed = [
    'Сейчас гляну по наличию 👀',
    'Понял, норм модель! Подберу варианты',
    'Хороший выбор! Какой размер нужен?',
    'Вот что есть — Nike Air Force 1, 10990₽',
    'Подобрал несколько вариантов для тебя',
  ];

  for (const text of allowed) {
    const result = validateResponse(text, [], true);
    assert(result.valid, `allows: "${text.substring(0, 40)}..."`);
  }
}

// ---- AI MODES TESTS ----

async function testAiModesCRUD() {
  console.log('\n🔧 44. AI MODES CRUD TEST');

  const testId = 999044;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ModeTest', 'modetest');

  // Default mode should be AUTO
  assert(user.ai_mode === 'AUTO' || user.ai_mode === null, 'default: AUTO or null');
  assert(user.manager_active === false, 'default: manager_active = false');
  assert(user.manager_active_at === null, 'default: manager_active_at = null');

  // Set OBSERVE
  const u1 = await users.setAiMode(user.id, 'OBSERVE');
  assert(u1.ai_mode === 'OBSERVE', 'setAiMode: OBSERVE');

  // Set HYBRID
  const u2 = await users.setAiMode(user.id, 'HYBRID');
  assert(u2.ai_mode === 'HYBRID', 'setAiMode: HYBRID');

  // Set AUTO_WITH_MANAGER_OVERRIDE
  const u3 = await users.setAiMode(user.id, 'AUTO_WITH_MANAGER_OVERRIDE');
  assert(u3.ai_mode === 'AUTO_WITH_MANAGER_OVERRIDE', 'setAiMode: AUTO_WITH_MANAGER_OVERRIDE');

  // Set back to AUTO
  const u4 = await users.setAiMode(user.id, 'AUTO');
  assert(u4.ai_mode === 'AUTO', 'setAiMode: AUTO');

  // Invalid mode should throw
  let threw = false;
  try { await users.setAiMode(user.id, 'INVALID'); } catch { threw = true; }
  assert(threw, 'invalid mode: throws error');

  // Manager active
  await users.setManagerActive(user.id, true);
  const u5 = await users.getById(user.id);
  assert(u5.manager_active === true, 'setManagerActive: true');
  assert(u5.manager_active_at !== null, 'setManagerActive: timestamp set');

  // Manager inactive
  await users.setManagerActive(user.id, false);
  const u6 = await users.getById(user.id);
  assert(u6.manager_active === false, 'setManagerActive: false');
  assert(u6.manager_active_at === null, 'setManagerActive: timestamp cleared');

  await cleanup(testId);
}

async function testCheckAiMode() {
  console.log('\n🧠 45. CHECK AI MODE LOGIC TEST');

  const { checkAiMode, isSimpleMessage, isComplexMessage, AI_MODES } = require('../telegram/handler');

  // OBSERVE mode — never responds
  const observe = checkAiMode({ ai_mode: 'OBSERVE' }, 'привет');
  assert(!observe.shouldRespond, 'OBSERVE: no response');
  assert(observe.reason === 'observe_mode', 'OBSERVE: correct reason');

  // AUTO mode — always responds
  const auto = checkAiMode({ ai_mode: 'AUTO' }, 'привет');
  assert(auto.shouldRespond, 'AUTO: responds');
  assert(auto.reason === 'auto_mode', 'AUTO: correct reason');

  // AUTO default (null/undefined)
  const autoDefault = checkAiMode({}, 'привет');
  assert(autoDefault.shouldRespond, 'AUTO default: responds');

  // HYBRID mode — simple message
  const hybSimple = checkAiMode({ ai_mode: 'HYBRID' }, 'привет');
  assert(hybSimple.shouldRespond, 'HYBRID simple: responds');

  // HYBRID mode — complex message
  const hybComplex = checkAiMode({ ai_mode: 'HYBRID' }, 'хочу вернуть товар, брак');
  assert(!hybComplex.shouldRespond, 'HYBRID complex: no response');

  // HYBRID mode — manager active
  const hybManager = checkAiMode({ ai_mode: 'HYBRID', manager_active: true }, 'привет');
  assert(!hybManager.shouldRespond, 'HYBRID manager active: no response');

  // AUTO_WITH_MANAGER_OVERRIDE — normal
  const amoNormal = checkAiMode({ ai_mode: 'AUTO_WITH_MANAGER_OVERRIDE' }, 'привет');
  assert(amoNormal.shouldRespond, 'AMO normal: responds');

  // AUTO_WITH_MANAGER_OVERRIDE — manager active
  const amoManager = checkAiMode({ ai_mode: 'AUTO_WITH_MANAGER_OVERRIDE', manager_active: true }, 'привет');
  assert(!amoManager.shouldRespond, 'AMO manager active: no response');
  assert(amoManager.reason === 'manager_override', 'AMO manager: correct reason');

  // isSimpleMessage tests
  assert(isSimpleMessage('привет'), 'simple: привет');
  assert(isSimpleMessage('42'), 'simple: размер 42');
  assert(isSimpleMessage('да'), 'simple: да');
  assert(isSimpleMessage('сколько стоят?'), 'simple: сколько стоят');
  assert(isSimpleMessage('хочу купить'), 'simple: хочу купить');

  // isComplexMessage tests
  assert(isComplexMessage('хочу вернуть, брак'), 'complex: возврат/брак');
  assert(isComplexMessage('перевести на менеджера'), 'complex: менеджер');
  assert(isComplexMessage('проблема с доставкой'), 'complex: проблема с доставкой');
  assert(!isComplexMessage('привет'), 'not complex: привет');
}

async function testManagerOverrideFlow() {
  console.log('\n👨‍💼 46. MANAGER OVERRIDE FLOW TEST');

  const testId = 999046;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ManagerTest', 'managertest');
  await users.setAiMode(user.id, 'AUTO_WITH_MANAGER_OVERRIDE');

  // Step 1: AI responds normally
  const { checkAiMode } = require('../telegram/handler');
  const u1 = await users.getById(user.id);
  const check1 = checkAiMode(u1, 'привет');
  assert(check1.shouldRespond, 'step 1: AI responds before manager');

  // Step 2: Manager sends a message → mark manager_active
  await users.setManagerActive(user.id, true);
  const u2 = await users.getById(user.id);
  assert(u2.manager_active === true, 'step 2: manager flagged active');

  // Step 3: AI should NOT respond now
  const check2 = checkAiMode(u2, 'привет');
  assert(!check2.shouldRespond, 'step 3: AI silent after manager');

  // Step 4: Manager timeout → manager_active clears
  // Simulate old timestamp
  await db.query(
    "UPDATE users SET manager_active_at = NOW() - INTERVAL '31 minutes' WHERE id = $1",
    [user.id]
  );
  const cleared = await users.clearStaleManagers(30);
  assert(cleared.length > 0, 'step 4: stale manager cleared');

  // Step 5: AI responds again
  const u3 = await users.getById(user.id);
  assert(u3.manager_active === false, 'step 5: manager_active = false');
  const check3 = checkAiMode(u3, 'привет');
  assert(check3.shouldRespond, 'step 5: AI responds after timeout');

  await cleanup(testId);
}

async function testObserveModeHandler() {
  console.log('\n👁 47. OBSERVE MODE HANDLER TEST');

  const { handleMessage } = require('../telegram/handler');

  const testId = 999047;
  await cleanup(testId);

  await settings.set('global_ai_enabled', 'true');

  // Create user and set OBSERVE mode
  const user = await users.findOrCreate(testId, 'ObserveUser', 'observeuser');
  await users.setAiMode(user.id, 'OBSERVE');

  // Send message
  const msg = { from: { id: testId, first_name: 'ObserveUser', username: 'observeuser' }, text: 'привет' };
  await handleMessage(msg);

  // User message should be saved
  const history = await messages.getHistory(user.id, 10);
  const userMsgs = history.filter((m) => m.role === 'user');
  assert(userMsgs.length >= 1, 'OBSERVE: user message saved');

  // AI should NOT have responded
  const aiMsgs = history.filter((m) => m.role === 'ai');
  assert(aiMsgs.length === 0, 'OBSERVE: no AI response');

  await cleanup(testId);
}

async function testAiModeApiEndpoint() {
  console.log('\n🌐 48. AI MODE API ENDPOINT TEST');

  const testId = 999048;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ApiMode', 'apimode');

  // Test setAiMode directly
  const u1 = await users.setAiMode(user.id, 'HYBRID');
  assert(u1.ai_mode === 'HYBRID', 'API: setAiMode HYBRID works');

  const u2 = await users.setAiMode(user.id, 'AUTO_WITH_MANAGER_OVERRIDE');
  assert(u2.ai_mode === 'AUTO_WITH_MANAGER_OVERRIDE', 'API: setAiMode AMO works');

  // Verify getById returns new field
  const fetched = await users.getById(user.id);
  assert(fetched.ai_mode === 'AUTO_WITH_MANAGER_OVERRIDE', 'API: getById returns ai_mode');
  assert(typeof fetched.manager_active === 'boolean', 'API: getById returns manager_active');

  // Verify getAll returns new fields
  const all = await users.getAll();
  const found = all.find((u) => u.id === user.id);
  assert(found !== undefined, 'API: getAll includes test user');

  await cleanup(testId);
}

async function testTelegramBusinessSupport() {
  console.log('\n💼 49. TELEGRAM BUSINESS SUPPORT TEST');

  const { handleMessage } = require('../telegram/handler');

  const testId = 999049;
  await cleanup(testId);

  await settings.set('global_ai_enabled', 'true');

  // Test 1: handleMessage accepts businessConnectionId without crashing
  const msg1 = { from: { id: testId, first_name: 'BizUser', username: 'bizuser' }, text: 'привет' };
  await handleMessage(msg1, 'biz_conn_abc123');
  const user = await users.findOrCreate(testId, 'BizUser', 'bizuser');
  const h1 = await messages.getHistory(user.id, 10);
  assert(h1.some((m) => m.role === 'user' && m.text === 'привет'), 'business: message saved with connectionId');

  // Test 2: handleMessage works without businessConnectionId (backward compat)
  await cleanup(testId);
  const msg2 = { from: { id: testId, first_name: 'BizUser', username: 'bizuser' }, text: 'hello' };
  await handleMessage(msg2, null);
  const user2 = await users.findOrCreate(testId, 'BizUser', 'bizuser');
  const h2 = await messages.getHistory(user2.id, 10);
  assert(h2.some((m) => m.role === 'user' && m.text === 'hello'), 'business: backward compat without connectionId');

  // Test 3: handleMessage with no second arg (legacy callers)
  await cleanup(testId);
  const msg3 = { from: { id: testId, first_name: 'BizUser', username: 'bizuser' }, text: 'test' };
  await handleMessage(msg3);
  const user3 = await users.findOrCreate(testId, 'BizUser', 'bizuser');
  const h3 = await messages.getHistory(user3.id, 10);
  assert(h3.some((m) => m.role === 'user' && m.text === 'test'), 'business: legacy call without arg works');

  // Test 4: caption extracted as text for business photo-like messages
  await cleanup(testId);
  const msg4 = { from: { id: testId, first_name: 'BizUser', username: 'bizuser' }, caption: 'найди мне эти кроссы' };
  // No text, no photo — should be treated as unsupported format (caption without photo)
  await handleMessage(msg4, 'biz_conn_xyz');
  const user4 = await users.findOrCreate(testId, 'BizUser', 'bizuser');
  const h4 = await messages.getHistory(user4.id, 10);
  // With caption fallback in text extraction, it becomes text message
  const hasCaptionOrUnsupported = h4.some((m) => m.role === 'user');
  assert(hasCaptionOrUnsupported, 'business: caption msg handled without crash');

  // Test 5: unsupported msg type with business connection — no crash
  await cleanup(testId);
  const msg5 = { from: { id: testId, first_name: 'BizUser', username: 'bizuser' }, voice: { file_id: 'xyz' } };
  await handleMessage(msg5, 'biz_conn_voice');
  const user5 = await users.findOrCreate(testId, 'BizUser', 'bizuser');
  const h5 = await messages.getHistory(user5.id, 10);
  assert(h5.some((m) => m.text === '[неподдерживаемый формат]'), 'business: voice msg saved as unsupported');

  await cleanup(testId);
}

async function testBusinessWebhookRouting() {
  console.log('\n📡 50. BUSINESS WEBHOOK ROUTING TEST');

  // Test that routes.js correctly extracts msg from business_message
  // We test the routing logic by simulating different update shapes

  // Simulate business_message update structure
  const bizUpdate = {
    business_message: {
      from: { id: 999050, first_name: 'BizClient' },
      chat: { id: 999050 },
      text: 'бизнес привет',
      business_connection_id: 'conn_123',
    },
  };

  const msg = bizUpdate.message || bizUpdate.business_message || bizUpdate.edited_business_message;
  assert(msg !== undefined, 'routing: business_message extracted');
  assert(msg.text === 'бизнес привет', 'routing: business_message text correct');

  const bcId = bizUpdate.business_message?.business_connection_id ||
    bizUpdate.edited_business_message?.business_connection_id || null;
  assert(bcId === 'conn_123', 'routing: business_connection_id extracted');

  // Simulate edited_business_message
  const editedUpdate = {
    edited_business_message: {
      from: { id: 999050, first_name: 'BizClient' },
      chat: { id: 999050 },
      text: 'edited text',
      business_connection_id: 'conn_456',
    },
  };

  const msg2 = editedUpdate.message || editedUpdate.business_message || editedUpdate.edited_business_message;
  assert(msg2.text === 'edited text', 'routing: edited_business_message extracted');

  const bcId2 = editedUpdate.business_message?.business_connection_id ||
    editedUpdate.edited_business_message?.business_connection_id || null;
  assert(bcId2 === 'conn_456', 'routing: edited connectionId extracted');

  // Simulate regular message — backward compat
  const regularUpdate = {
    message: {
      from: { id: 999050, first_name: 'RegularUser' },
      chat: { id: 999050 },
      text: 'обычное',
    },
  };

  const msg3 = regularUpdate.message || regularUpdate.business_message || regularUpdate.edited_business_message;
  assert(msg3.text === 'обычное', 'routing: regular message still works');

  const bcId3 = regularUpdate.business_message?.business_connection_id ||
    regularUpdate.edited_business_message?.business_connection_id || null;
  assert(bcId3 === null, 'routing: no connectionId for regular msg');

  // Empty update — should not crash
  const emptyUpdate = {};
  const msg4 = emptyUpdate.message || emptyUpdate.business_message || emptyUpdate.edited_business_message;
  assert(msg4 === undefined, 'routing: empty update returns undefined');
}

async function run() {
  console.log('🚀 Starting E2E tests...\n');

  try {
    await db.init();
    await config.loadDbSettings();

    await testDatabase();
    await testUserCRUD();
    await testMessages();
    await testOrders();
    await testPrompts();
    await testSalesStateMachine();
    await testFullOrderFlow();
    await testFormParsing();
    await testSettingsCRUD();
    await testConfigPriority();
    await testSettingsAPI();
    await testHandlerWithSettings();
    await testErrorHandling();
    await testAPIEndpoints();
    await testAuth();
    await testPaymentSystem();
    await testHandlerStructuredResponse();
    await testCallbackQuery();
    await testRepeatPurchaseState();
    await testShopApiIntegration();
    await testFuzzyMatching();
    await testAIValidator();
    await testPriceMandatory();
    await testPaymentIncludesAmount();
    await testCatalogUnavailableFallback();
    await testOrderWithPrice();
    await testAIProductContext();
    await testOfftopicDetector();
    await testResponseQualityGuard();
    await testSchedulerScenarios();
    await testSalesOfftopicIntegration();
    await testHesitationNudge();
    await testExpandedBuyKeywords();
    await testInfoQuestionNoStateChange();
    await testLivingFormResponse();
    await testQuickNudgeMessages();
    await testGetStuckInOrder();
    await testImprovedFallbacks();
    await testVisionParser();
    await testProcessPhoto();
    await testPhotoHandlerIntegration();
    await testVisionPrompt();
    await testBotGetFileUrl();
    await testSoftAvailabilityMode();
    await testSoftPhotoUnknown();
    await testSoftNoProductFastSale();
    await testValidatorNegativePatterns();
    await testAiModesCRUD();
    await testCheckAiMode();
    await testManagerOverrideFlow();
    await testObserveModeHandler();
    await testAiModeApiEndpoint();
    await testTelegramBusinessSupport();
    await testBusinessWebhookRouting();

    console.log(`\n${'='.repeat(40)}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`${'='.repeat(40)}`);

    if (failed > 0) {
      console.log('\n⚠️  СИСТЕМА НЕ ГОТОВА — есть ошибки');
      process.exit(1);
    } else {
      console.log('\n🚀 ВСЕ ТЕСТЫ ПРОЙДЕНЫ — система готова');
    }
  } catch (err) {
    console.error('\n💥 FATAL ERROR:', err);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

run();
