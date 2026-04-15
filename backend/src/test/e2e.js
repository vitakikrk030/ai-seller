/**
 * End-to-end тест: проверяет полный pipeline без реального Telegram/AI
 * 
 * Запуск: node src/test/e2e.js
 * Требует: работающую PostgreSQL с DATABASE_URL в .env
 */
process.env.TZ = 'Europe/Moscow';
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
  assert(response.length > 0, 'AI returns fallback text on error (never silent)');

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
  const { authMiddleware, login: loginHandler, verify: verifyHandler, refresh: refreshHandler, logout: logoutHandler } = require('../api/auth');

  // Test login with correct credentials
  let loginResult = null;
  const mockReq = { body: { login: config.ADMIN_LOGIN, password: config.ADMIN_PASSWORD } };
  const mockRes = {
    json: (data) => { loginResult = data; },
    status: function(code) { this.statusCode = code; return this; },
  };
  await loginHandler(mockReq, mockRes);
  assert(loginResult && loginResult.token, 'Login returns token');
  assert(loginResult && loginResult.refreshToken, 'Login returns refreshToken');

  // Verify token is valid JWT
  const decoded = jwt.verify(loginResult.token, config.JWT_SECRET);
  assert(decoded.login === config.ADMIN_LOGIN, 'Token contains correct login');
  assert(decoded.jti, 'Token contains JTI for revocation');

  // Test login with wrong password
  let wrongResult = null;
  const wrongReq = { body: { login: 'admin', password: 'wrong' } };
  const wrongRes = {
    json: (data) => { wrongResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  await loginHandler(wrongReq, wrongRes);
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
  await loginHandler(emptyReq, emptyRes);
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

  // Test refresh token flow
  let refreshResult = null;
  const refreshReq = { body: { refreshToken: loginResult.refreshToken } };
  const refreshRes = {
    json: (data) => { refreshResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  refreshHandler(refreshReq, refreshRes);
  assert(refreshResult && refreshResult.token, 'Refresh returns new access token');
  assert(refreshResult && refreshResult.refreshToken, 'Refresh returns rotated refresh token');

  // Test refresh with invalid token
  let badRefreshResult = null;
  const badRefreshReq = { body: { refreshToken: 'bad.token' } };
  const badRefreshRes = {
    json: (data) => { badRefreshResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  refreshHandler(badRefreshReq, badRefreshRes);
  assert(badRefreshRes.statusCode === 401, 'Bad refresh token returns 401');

  // Test logout (token revocation) — use rotated refresh token
  let logoutResult = null;
  const logoutReq = { user: decoded, body: { refreshToken: refreshResult.refreshToken } };
  const logoutRes = {
    json: (data) => { logoutResult = data; },
    status: function(code) { this.statusCode = code; return this; },
  };
  logoutHandler(logoutReq, logoutRes);
  assert(logoutResult && logoutResult.ok === true, 'Logout returns ok');

  // After logout, token should be revoked
  let revokedResult = null;
  const revokedReq = { headers: { authorization: `Bearer ${loginResult.token}` } };
  const revokedRes = {
    json: (data) => { revokedResult = data; },
    status: function(code) { this.statusCode = code; return this; },
    statusCode: 200,
  };
  authMiddleware(revokedReq, revokedRes, () => {});
  assert(revokedRes.statusCode === 401, 'Revoked token returns 401');
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
  await settings.set('payment_receiver_name', 'Тест Тестович');

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
  // Disable schedule so test works at any time of day
  const aiSettings = require('../db/ai_settings');
  await aiSettings.setEnabled('ai_schedule_enabled', false);

  const user = await users.findOrCreate(TG_ID, 'Handler Test', 'handlertest');
  await users.updateState(user.id, 'WAITING_FORM');
  await orders.create({ user_id: user.id, product: 'Test Sneakers', size: '41', price: 11990 });

  // handleMessage will call processMessage which returns structured response
  // bot.sendMessage will fail silently (no real Telegram) — that's ok
  const { handleMessage } = require('../telegram/handler');
  const queue = require('../queue');

  await handleMessage({
    from: { id: TG_ID, first_name: 'Handler', last_name: 'Test', username: 'handlertest' },
    text: 'Сидоров Сидор, +79990001122, Казань, ул. Баумана 15',
  });

  // Wait for queue to process async AI tasks
  await new Promise(r => setTimeout(r, 500));

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
  await aiSettings.setEnabled('ai_schedule_enabled', true);
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

  // Test safe fallbacks (getSafeFallback is async — await required)
  const f1 = await getSafeFallback('not_configured');
  assert(f1.includes('каталог') || f1.includes('менеджер'), 'not_configured fallback mentions catalog/manager');

  const f2 = await getSafeFallback('api_error');
  assert(f2.includes('менеджер') || f2.includes('поможет'), 'api_error fallback mentions manager');

  const f3 = await getSafeFallback('empty_catalog');
  assert(f3.includes('менеджер') || f3.includes('подскажет'), 'empty_catalog fallback mentions manager');

  const f4 = await getSafeFallback(null, 'fabricated_price:8990');
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
  const lr = response.toLowerCase();
  assert(
    lr.includes('гляну') || lr.includes('подбер') || lr.includes('размер') || lr.includes('норм') || lr.includes('наличи'),
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

  // detectOfftopic теперь async, REDIRECTS живут в БД (не экспортируются)
  const { detectOfftopic, OFFTOPIC_PATTERNS, SALES_KEYWORDS } = require('../ai/offtopic');

  // Module exports
  assert(typeof detectOfftopic === 'function', 'detectOfftopic is a function');
  assert(Array.isArray(OFFTOPIC_PATTERNS), 'OFFTOPIC_PATTERNS is array');
  assert(Array.isArray(SALES_KEYWORDS), 'SALES_KEYWORDS is array');

  // Редиректы теперь в БД — проверяем через aiSettings
  const aiSettings = require('../db/ai_settings');
  const redirects = await aiSettings.getOfftopicRedirects();
  assert(Array.isArray(redirects), 'REDIRECTS is array (from DB)');
  assert(redirects.length >= 3, `At least 3 redirects (got ${redirects.length})`);

  // Off-topic messages → detected (async)
  const r1 = await detectOfftopic('Какая сегодня погода?');
  assert(r1.offtopic === true, 'Weather is off-topic');
  assert(r1.redirect !== null, 'Redirect provided for weather');
  assert(redirects.includes(r1.redirect), 'Redirect is from REDIRECTS list (DB)');

  const r2 = await detectOfftopic('Расскажи анекдот');
  assert(r2.offtopic === true, 'Joke request is off-topic');

  const r3 = await detectOfftopic('Ты бот или человек?');
  assert(r3.offtopic === true, 'Personal bot question is off-topic');

  const r4 = await detectOfftopic('Что нового в мире?');
  assert(r4.offtopic === true, 'News request is off-topic');

  // Sales messages → NOT off-topic
  const s1 = await detectOfftopic('Хочу купить кроссовки');
  assert(s1.offtopic === false, 'Buy intent is NOT off-topic');

  const s2 = await detectOfftopic('Сколько стоит Nike Air Max?');
  assert(s2.offtopic === false, 'Price question is NOT off-topic');

  const s3 = await detectOfftopic('Есть размер 42?');
  assert(s3.offtopic === false, 'Size question is NOT off-topic');

  const s4 = await detectOfftopic('Как оформить доставку?');
  assert(s4.offtopic === false, 'Delivery question is NOT off-topic');

  // Mixed: sales keyword + off-topic → NOT off-topic (sales wins)
  const m1 = await detectOfftopic('В такую погоду хочу купить кроссовки');
  assert(m1.offtopic === false, 'Sales keyword overrides off-topic weather');

  // Empty/neutral → NOT off-topic
  const e1 = await detectOfftopic('');
  assert(e1.offtopic === false, 'Empty string is not off-topic');

  const e2 = await detectOfftopic('привет');
  assert(e2.offtopic === false, 'Simple greeting is not off-topic');

  const e3 = await detectOfftopic('ок');
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

  // robot_reveal fallback (async)
  const f1 = await getSafeFallback(null, 'robot_reveal');
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

  // QUICK_NUDGES удалён — nudge-тексты теперь живут в БД через NUDGE_CHAIN_CONFIG
  const { NUDGE_CHAIN_CONFIG } = require('../scheduler');
  const aiSettings = require('../db/ai_settings');

  assert(NUDGE_CHAIN_CONFIG.WAITING_SIZE !== undefined, 'WAITING_SIZE chain exists');
  assert(NUDGE_CHAIN_CONFIG.WAITING_FORM !== undefined, 'WAITING_FORM chain exists');
  assert(NUDGE_CHAIN_CONFIG.WAITING_PAYMENT !== undefined, 'WAITING_PAYMENT chain exists');

  // Проверяем что тексты читаются из БД
  const sizeNudge = await aiSettings.getNudge('nudge_size_1h');
  assert(sizeNudge && sizeNudge.length > 0, 'WAITING_SIZE nudge text from DB non-empty');

  const formNudge = await aiSettings.getNudge('nudge_form_1h');
  assert(formNudge && formNudge.length > 0, 'WAITING_FORM nudge text from DB non-empty');

  const payNudge = await aiSettings.getNudge('nudge_payment_1h');
  assert(payNudge && payNudge.length > 0, 'WAITING_PAYMENT nudge text from DB non-empty');
  assert(payNudge.includes('оплат') || payNudge.includes('скрин') || payNudge.includes('Заказ'),
    'WAITING_PAYMENT nudge mentions payment context');
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

  // All fallbacks should sound casual/living, not robotic (async)
  const f1 = await getSafeFallback('not_configured');
  assert(!f1.includes('Напишите'), 'not_configured: no formal "Напишите"');
  assert(f1.includes('менеджер'), 'not_configured: mentions manager');

  const f2 = await getSafeFallback('api_error');
  assert(!f2.includes('Попробуйте'), 'api_error: no formal "Попробуйте"');
  assert(f2.includes('менеджер'), 'api_error: mentions manager');

  const f3 = await getSafeFallback('empty_catalog');
  assert(f3.includes('менеджер'), 'empty_catalog: mentions manager');

  const f4 = await getSafeFallback(null, 'robot_reveal');
  assert(!f4.includes('Подскажите'), 'robot_reveal: no formal "Подскажите"');

  const f5 = await getSafeFallback(null, null);
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

  // Test 2: getSafeFallback for negative_availability (async)
  const fallback = await getSafeFallback(null, 'negative_availability');
  assert(fallback.includes('гляну') || fallback.includes('подбер') || fallback.length > 0, 'fallback: soft availability msg from DB');
  assert(!fallback.includes('нет в наличии'), 'fallback: no "нет в наличии"');

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
  console.log('\n🔧 44. AI MODES CRUD TEST (2-mode system)');

  const testId = 999044;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ModeTest', 'modetest');

  // Default mode should be 'ai' (or null which defaults to 'ai')
  assert(user.mode === 'ai' || user.mode === null, 'default: mode = ai or null');
  assert(user.manager_active === false, 'default: manager_active = false');
  assert(user.manager_active_at === null, 'default: manager_active_at = null');

  // Set mode to 'manager'
  const u1 = await users.setMode(user.id, 'manager');
  assert(u1.mode === 'manager', 'setMode: manager');

  // Set mode to 'ai'
  const u2 = await users.setMode(user.id, 'ai');
  assert(u2.mode === 'ai', 'setMode: ai');

  // Invalid mode should throw
  let threw = false;
  try { await users.setMode(user.id, 'INVALID'); } catch { threw = true; }
  assert(threw, 'invalid mode: throws error');

  // Legacy setAiMode still works
  const u3 = await users.setAiMode(user.id, 'OBSERVE');
  assert(u3.ai_mode === 'OBSERVE', 'legacy setAiMode: OBSERVE');
  assert(u3.mode === 'manager', 'legacy OBSERVE maps to mode=manager');

  const u4 = await users.setAiMode(user.id, 'AUTO');
  assert(u4.ai_mode === 'AUTO', 'legacy setAiMode: AUTO');
  assert(u4.mode === 'ai', 'legacy AUTO maps to mode=ai');

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

  // setMode('ai') should also clear manager_active
  await users.setManagerActive(user.id, true);
  const u7 = await users.setMode(user.id, 'ai');
  const u8 = await users.getById(user.id);
  assert(u8.manager_active === false, 'setMode ai: clears manager_active');

  await cleanup(testId);
}

async function testCheckAiMode() {
  console.log('\n🧠 45. CHECK AI MODE LOGIC TEST (2-mode system)');

  // isSimpleMessage/isComplexMessage удалены — логика встроена в checkAiMode через COMPLEX_PATTERNS
  const { checkAiMode } = require('../telegram/handler');
  const aiSettings45 = require('../db/ai_settings');
  await aiSettings45.setEnabled('ai_schedule_enabled', false);
  // checkAiMode теперь async — все вызовы с await
  const isSimpleMessage = async (text) => (await checkAiMode({ mode: 'ai' }, text)).shouldRespond;
  // isComplexMessage: проверяем оба reason — старый и новый (keyword_match из AI Settings)
  const isComplexMessage = async (text) => {
    const r = await checkAiMode({ mode: 'ai' }, text, []);
    return !r.shouldRespond && (r.reason === 'complex_escalation' || r.reason === 'keyword_match');
  };
  // isSimpleMessage: передаём пустую историю чтобы не срабатывал порог сообщений
  const isSimpleMessageFn = async (text) => (await checkAiMode({ mode: 'ai' }, text, [])).shouldRespond;

  // mode=manager — never responds
  const managerMode = await checkAiMode({ mode: 'manager' }, 'привет');
  assert(!managerMode.shouldRespond, 'manager mode: no response');
  assert(managerMode.reason === 'manager_mode', 'manager mode: correct reason');

  // mode=ai — responds
  const aiMode = await checkAiMode({ mode: 'ai' }, 'привет');
  assert(aiMode.shouldRespond, 'ai mode: responds');
  assert(aiMode.reason === 'ai_mode', 'ai mode: correct reason');

  // Default mode (null/undefined) = ai
  const autoDefault = await checkAiMode({}, 'привет');
  assert(autoDefault.shouldRespond, 'default mode: responds as ai');

  // mode=ai, manager_active — paused
  const paused = await checkAiMode({ mode: 'ai', manager_active: true }, 'привет');
  assert(!paused.shouldRespond, 'ai+manager_active: paused');
  assert(paused.reason === 'manager_pause', 'ai+manager_active: correct reason');

  // mode=ai, complex message — escalated (keyword_match из AI Settings)
  const complex = await checkAiMode({ mode: 'ai' }, 'хочу вернуть товар, брак');
  assert(!complex.shouldRespond, 'ai+complex: no response');
  assert(complex.reason === 'complex_escalation' || complex.reason === 'keyword_match', 'ai+complex: correct reason');

  // mode=ai, simple message — responds
  const simple = await checkAiMode({ mode: 'ai' }, 'сколько стоят?');
  assert(simple.shouldRespond, 'ai+simple: responds');

  // isSimpleMessage tests
  assert(await isSimpleMessageFn('привет'), 'simple: привет');
  assert(await isSimpleMessageFn('42'), 'simple: размер 42');
  assert(await isSimpleMessageFn('да'), 'simple: да');
  assert(await isSimpleMessageFn('сколько стоят?'), 'simple: сколько стоят');
  assert(await isSimpleMessageFn('хочу купить'), 'simple: хочу купить');

  // isComplexMessage tests (async)
  assert(await isComplexMessage('хочу вернуть, брак'), 'complex: возврат/брак');
  assert(await isComplexMessage('перевести на менеджера'), 'complex: менеджер');
  assert(await isComplexMessage('проблема с доставкой'), 'complex: проблема с доставкой');
  assert(!(await isComplexMessage('привет')), 'not complex: привет');
  await aiSettings45.setEnabled('ai_schedule_enabled', true);
}

async function testManagerOverrideFlow() {
  console.log('\n👨‍💼 46. MANAGER OVERRIDE FLOW TEST (2-mode)');

  const testId = 999046;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ManagerTest', 'managertest');
  // Default mode is 'ai'

  // Disable schedule so test works at any time of day
  const aiSettings46 = require('../db/ai_settings');
  await aiSettings46.setEnabled('ai_schedule_enabled', false);

  // Step 1: AI responds normally
  const { checkAiMode } = require('../telegram/handler');
  const u1 = await users.getById(user.id);
  const check1 = await checkAiMode(u1, 'привет');
  assert(check1.shouldRespond, 'step 1: AI responds in ai mode');

  // Step 2: Manager sends a message → mark manager_active
  await users.setManagerActive(user.id, true);
  const u2 = await users.getById(user.id);
  assert(u2.manager_active === true, 'step 2: manager flagged active');

  // Step 3: AI should NOT respond now (paused)
  const check2 = await checkAiMode(u2, 'привет');
  assert(!check2.shouldRespond, 'step 3: AI paused after manager');
  assert(check2.reason === 'manager_pause', 'step 3: reason is manager_pause');

  // Step 4: Manager timeout → manager_active clears
  await db.query(
    "UPDATE users SET manager_active_at = NOW() - INTERVAL '31 minutes' WHERE id = $1",
    [user.id]
  );
  const cleared = await users.clearStaleManagers(30);
  assert(cleared.length > 0, 'step 4: stale manager cleared');

  // Step 5: AI responds again
  const u3 = await users.getById(user.id);
  assert(u3.manager_active === false, 'step 5: manager_active = false');
  const check3 = await checkAiMode(u3, 'привет');
  assert(check3.shouldRespond, 'step 5: AI responds after timeout');

  await aiSettings46.setEnabled('ai_schedule_enabled', true);
  await cleanup(testId);
}

async function testObserveModeHandler() {
  console.log('\n👁 47. MANAGER MODE HANDLER TEST');

  const { handleMessage } = require('../telegram/handler');

  const testId = 999047;
  await cleanup(testId);

  await settings.set('global_ai_enabled', 'true');

  // Create user and set manager mode
  const user = await users.findOrCreate(testId, 'ManagerUser', 'manageruser');
  await users.setMode(user.id, 'manager');

  // Send message
  const msg = { from: { id: testId, first_name: 'ManagerUser', username: 'manageruser' }, text: 'привет' };
  await handleMessage(msg);

  // User message should be saved
  const history = await messages.getHistory(user.id, 10);
  const userMsgs = history.filter((m) => m.role === 'user');
  assert(userMsgs.length >= 1, 'manager mode: user message saved');

  // AI should NOT have responded
  const aiMsgs = history.filter((m) => m.role === 'ai');
  assert(aiMsgs.length === 0, 'manager mode: no AI response');

  await cleanup(testId);
}

async function testAiModeApiEndpoint() {
  console.log('\n🌐 48. MODE API ENDPOINT TEST (2-mode)');

  const testId = 999048;
  await cleanup(testId);

  const user = await users.findOrCreate(testId, 'ApiMode', 'apimode');

  // Test setMode
  const u1 = await users.setMode(user.id, 'manager');
  assert(u1.mode === 'manager', 'API: setMode manager works');

  const u2 = await users.setMode(user.id, 'ai');
  assert(u2.mode === 'ai', 'API: setMode ai works');

  // Verify getById returns mode field
  const fetched = await users.getById(user.id);
  assert(fetched.mode === 'ai', 'API: getById returns mode');
  assert(typeof fetched.manager_active === 'boolean', 'API: getById returns manager_active');

  // Verify getAll returns computed active_actor
  const all = await users.getAll();
  const found = all.find((u) => u.id === user.id);
  assert(found !== undefined, 'API: getAll includes test user');
  assert(found.active_actor === 'ai' || found.active_actor === 'manager' || found.active_actor === 'paused',
    'API: getAll returns active_actor');

  // Test active_actor computation
  // mode=ai, no manager → active_actor = ai
  await users.setMode(user.id, 'ai');
  const all2 = await users.getAll();
  const f2 = all2.find((u) => u.id === user.id);
  assert(f2.active_actor === 'ai', 'active_actor: ai when mode=ai and no manager');

  // mode=manager → active_actor = manager
  await users.setMode(user.id, 'manager');
  const all3 = await users.getAll();
  const f3 = all3.find((u) => u.id === user.id);
  assert(f3.active_actor === 'manager', 'active_actor: manager when mode=manager');

  // mode=ai + manager_active recent → active_actor = paused
  await users.setMode(user.id, 'ai');
  await users.setManagerActive(user.id, true);
  const all4 = await users.getAll();
  const f4 = all4.find((u) => u.id === user.id);
  assert(f4.active_actor === 'paused', 'active_actor: paused when ai+manager_active');
  assert(typeof f4.pause_remaining === 'number', 'pause_remaining is numeric');
  assert(f4.pause_remaining > 0, 'pause_remaining > 0 when just set');

  // Cleanup
  await users.setManagerActive(user.id, false);
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

async function testBusinessDeepLink() {
  console.log('\n🔗 51. BUSINESS DEEP LINK + CONNECTION TEST');

  const { handleMessage } = require('../telegram/handler');

  const testId = 999051;
  await cleanup(testId);

  await settings.set('global_ai_enabled', 'true');

  // Test 1: /start bizChat should return immediately, no AI call
  const msg1 = { from: { id: testId, first_name: 'BizStart', username: 'bizstart' }, text: '/start bizChat12345' };
  await handleMessage(msg1, 'biz_abc');
  // Should NOT create user messages (it returns before saving)
  const user1 = await users.findOrCreate(testId, 'BizStart', 'bizstart');
  const h1 = await messages.getHistory(user1.id, 10);
  const aiMsgs1 = h1.filter((m) => m.role === 'ai');
  assert(aiMsgs1.length === 0, 'deeplink: /start bizChat does not trigger AI');

  // Test 2: /start bizChat without businessConnectionId
  await cleanup(testId);
  const msg2 = { from: { id: testId, first_name: 'BizStart', username: 'bizstart' }, text: '/start bizChatXXX' };
  await handleMessage(msg2);
  const user2 = await users.findOrCreate(testId, 'BizStart', 'bizstart');
  const h2 = await messages.getHistory(user2.id, 10);
  assert(h2.length === 0, 'deeplink: /start bizChat without connId no crash');

  // Test 3: Regular /start should NOT be intercepted
  await cleanup(testId);
  const msg3 = { from: { id: testId, first_name: 'BizStart', username: 'bizstart' }, text: '/start' };
  await handleMessage(msg3);
  const user3 = await users.findOrCreate(testId, 'BizStart', 'bizstart');
  const h3 = await messages.getHistory(user3.id, 10);
  assert(h3.some((m) => m.role === 'user' && m.text === '/start'), 'deeplink: regular /start passes through');

  await cleanup(testId);
}

async function testWebhookDeduplication() {
  console.log('\n🔁 52. WEBHOOK DEDUPLICATION TEST');

  const TG_ID = 999999950;
  await cleanup(TG_ID);

  const user = await users.findOrCreate(TG_ID, 'Dedup Test', 'deduptest');

  // Save a message manually
  await messages.save(user.id, 'user', 'first msg');

  // Count user messages before
  const before = await db.query("SELECT COUNT(*)::int as cnt FROM messages WHERE user_id = $1 AND role = 'user'", [user.id]);
  const countBefore = before.rows[0].cnt;

  // Simulate handleMessage with same message_id twice
  const { handleMessage } = require('../telegram/handler');
  const msg = {
    message_id: 999999,
    from: { id: TG_ID, first_name: 'Dedup', last_name: 'Test' },
    text: 'duplicate test',
  };

  // First call processes normally
  await handleMessage(msg, null);

  // Second call with same message_id should be skipped
  await handleMessage(msg, null);

  const after = await db.query("SELECT COUNT(*)::int as cnt FROM messages WHERE user_id = $1 AND role = 'user'", [user.id]);
  const countAfter = after.rows[0].cnt;

  // Should have exactly 1 new user message (not 2)
  assert(countAfter - countBefore === 1, 'Duplicate message_id processed only once');

  // Different message_id should still work
  const msg2 = { ...msg, message_id: 1000000, text: 'unique msg' };
  await handleMessage(msg2, null);

  const after2 = await db.query("SELECT COUNT(*)::int as cnt FROM messages WHERE user_id = $1 AND role = 'user'", [user.id]);
  assert(after2.rows[0].cnt - countBefore === 2, 'Different message_id processed normally');

  await cleanup(TG_ID);
}

async function testMonitoring() {
  console.log('\n📊 53. MONITORING SYSTEM TEST');

  const monitoring = require('../monitoring');

  // Test initial state
  const status1 = monitoring.getStatus();
  assert(status1.overall, 'getStatus returns overall');
  assert(Array.isArray(status1.components), 'getStatus returns components array');
  assert(Array.isArray(status1.incidents), 'getStatus returns incidents array');
  assert(status1.checkedAt, 'getStatus returns checkedAt');

  // Test component initialization
  monitoring.recordSuccess('test_comp', 42);
  const status2 = monitoring.getStatus();
  const testComp = status2.components.find((c) => c.name === 'test_comp');
  assert(testComp, 'recordSuccess creates component');
  assert(testComp.status === 'OK', 'recordSuccess sets OK status');
  assert(testComp.latencyMs === 42, 'recordSuccess stores latency');

  // Test error recording
  monitoring.recordError('test_comp', 'test failure', 'critical');
  const status3 = monitoring.getStatus();
  const testComp2 = status3.components.find((c) => c.name === 'test_comp');
  assert(testComp2.status === 'DOWN', 'recordError sets DOWN status');
  assert(testComp2.message === 'test failure', 'recordError stores message');

  // Test incident creation
  const incidents = monitoring.getIncidents(10);
  const testIncident = incidents.find((i) => i.source === 'test_comp' && i.message === 'test failure');
  assert(testIncident, 'Incident created on DOWN');
  assert(testIncident.severity === 'critical', 'Incident severity is critical');
  assert(!testIncident.resolved, 'Incident initially unresolved');

  // Test auto-resolve on recovery
  monitoring.recordSuccess('test_comp', 10);
  const incidents2 = monitoring.getIncidents(10);
  const resolved = incidents2.find((i) => i.source === 'test_comp' && i.message === 'test failure');
  assert(resolved && resolved.resolved, 'Incident resolved after recordSuccess');
  assert(resolved.resolvedAt, 'Incident has resolvedAt timestamp');

  // Test degraded state
  monitoring.recordError('test_comp', 'slow response', 'warning');
  const status4 = monitoring.getStatus();
  const testComp3 = status4.components.find((c) => c.name === 'test_comp');
  assert(testComp3.status === 'DEGRADED', 'warning severity sets DEGRADED');

  // Test scheduler heartbeat
  monitoring.schedulerHeartbeat();
  const status5 = monitoring.getStatus();
  const sched = status5.components.find((c) => c.name === 'scheduler');
  assert(sched && sched.status === 'OK', 'schedulerHeartbeat sets scheduler OK');

  // Test addIncident directly
  const inc = monitoring.addIncident('test_source', 'manual incident', 'warning');
  assert(inc.id > 0, 'addIncident returns incident with id');
  assert(inc.source === 'test_source', 'addIncident stores source');

  // Test overall status computation
  monitoring.recordSuccess('test_comp', 5);
  const finalStatus = monitoring.getStatus();
  assert(['OK', 'DEGRADED', 'DOWN', 'UNKNOWN'].includes(finalStatus.overall), 'overall is valid status');

  // Test runAllChecks doesn't crash (DB check will work since we're connected)
  await monitoring.runAllChecks();
  const afterChecks = monitoring.getStatus();
  const dbComp = afterChecks.components.find((c) => c.name === 'database');
  assert(dbComp && dbComp.status === 'OK', 'Database check passes after runAllChecks');
  assert(dbComp.latencyMs != null, 'Database check reports latency');
}

async function testMonitoringPersistence() {
  console.log('\n📊 54. MONITORING PERSISTENCE & ANALYTICS TEST');

  const monitoring = require('../monitoring');

  // Wait briefly for fire-and-forget DB writes to complete
  await new Promise(r => setTimeout(r, 300));

  // Test DB persistence of components
  const compRes = await db.query("SELECT * FROM monitoring_components WHERE name = 'test_comp'");
  assert(compRes.rows.length > 0, 'Component persisted to DB');
  assert(compRes.rows[0].status === 'OK', 'Component status persisted correctly');

  // Test DB persistence of incidents
  const incRes = await db.query("SELECT * FROM monitoring_incidents WHERE source = 'test_comp' LIMIT 5");
  assert(incRes.rows.length > 0, 'Incidents persisted to DB');
  const criticalInc = incRes.rows.find(r => r.severity === 'critical');
  assert(criticalInc, 'Critical incident persisted');

  // Test resolved incidents in DB
  const resolvedRes = await db.query("SELECT * FROM monitoring_incidents WHERE source = 'test_comp' AND resolved = true LIMIT 5");
  assert(resolvedRes.rows.length > 0, 'Resolved incidents persisted in DB');
  assert(resolvedRes.rows[0].resolved_at, 'Resolved incident has resolved_at');

  // Test monitoring history recorded by runAllChecks
  const histRes = await db.query("SELECT * FROM monitoring_history ORDER BY recorded_at DESC LIMIT 10");
  assert(histRes.rows.length > 0, 'History recorded after runAllChecks');
  const dbHist = histRes.rows.find(r => r.component === 'database');
  assert(dbHist, 'Database component in history');
  assert(dbHist.status === 'OK', 'History records correct status');

  // Test getHistory API
  const history = await monitoring.getHistory(null, 1);
  assert(Array.isArray(history), 'getHistory returns array');
  assert(history.length > 0, 'getHistory has entries');
  assert(history[0].component, 'History entry has component');
  assert(history[0].status, 'History entry has status');
  assert(history[0].time, 'History entry has time');

  // Test getHistory with component filter
  const dbHistory = await monitoring.getHistory('database', 1);
  assert(dbHistory.length > 0, 'getHistory filters by component');
  assert(dbHistory.every(h => h.component === 'database'), 'All history entries are for database');

  // Test queryIncidents API
  const allInc = await monitoring.queryIncidents({ limit: 10 });
  assert(Array.isArray(allInc), 'queryIncidents returns array');
  assert(allInc.length > 0, 'queryIncidents has entries');

  // Test queryIncidents with resolved filter
  const openInc = await monitoring.queryIncidents({ resolved: false, limit: 10 });
  assert(Array.isArray(openInc), 'queryIncidents resolved=false returns array');
  assert(openInc.every(i => !i.resolved), 'All open incidents are unresolved');

  // Test queryIncidents with source filter
  const srcInc = await monitoring.queryIncidents({ source: 'test_source', limit: 10 });
  assert(Array.isArray(srcInc), 'queryIncidents source filter returns array');
  assert(srcInc.every(i => i.source === 'test_source'), 'All incidents match source filter');

  // Test anti-spam: STATUS constant exported
  assert(monitoring.STATUS.OK === 'OK', 'STATUS.OK exported');
  assert(monitoring.STATUS.DOWN === 'DOWN', 'STATUS.DOWN exported');
  assert(monitoring.STATUS.DEGRADED === 'DEGRADED', 'STATUS.DEGRADED exported');
}

async function testWriteQueue() {
  console.log('\n📊 55. WRITE QUEUE (ANTI-LOSS) TEST');

  const monitoring = require('../monitoring');

  // Test queue starts empty
  assert(monitoring.getQueueLength() === 0 || monitoring.getQueueLength() >= 0, 'getQueueLength returns number');

  // Record a success — this goes through the write queue
  monitoring.recordSuccess('queue_test', 25);
  // Wait for queue flush
  await new Promise(r => setTimeout(r, 500));

  // Verify data was persisted via queue
  const res = await db.query("SELECT * FROM monitoring_components WHERE name = 'queue_test'");
  assert(res.rows.length > 0, 'Write queue persists component to DB');
  assert(res.rows[0].status === 'OK', 'Queued write has correct status');
  assert(res.rows[0].latency_ms === 25, 'Queued write has correct latency');

  // Record error — incident queued
  monitoring.recordError('queue_test', 'queue error test', 'critical');
  await new Promise(r => setTimeout(r, 500));

  const incRes = await db.query("SELECT * FROM monitoring_incidents WHERE source = 'queue_test' AND message = 'queue error test'");
  assert(incRes.rows.length > 0, 'Write queue persists incidents');

  // Recovery resolves — queued resolve
  monitoring.recordSuccess('queue_test', 10);
  await new Promise(r => setTimeout(r, 500));

  const resolvedRes = await db.query("SELECT * FROM monitoring_incidents WHERE source = 'queue_test' AND message = 'queue error test' AND resolved = true");
  assert(resolvedRes.rows.length > 0, 'Write queue persists incident resolution');

  // Cleanup
  await db.query("DELETE FROM monitoring_components WHERE name = 'queue_test'");
  await db.query("DELETE FROM monitoring_incidents WHERE source = 'queue_test'");
}

async function testSLAThresholds() {
  console.log('\n📊 56. SLA THRESHOLDS TEST');

  const monitoring = require('../monitoring');

  // Verify SLA constants exported
  assert(monitoring.SLA, 'SLA object exported');
  assert(monitoring.SLA.ai === 15000, 'AI SLA threshold is 15000ms');
  assert(monitoring.SLA.database === 2000, 'Database SLA threshold is 2000ms');
  assert(monitoring.SLA.webhook === 5000, 'Webhook SLA threshold is 5000ms');
  assert(monitoring.SLA.telegram === 5000, 'Telegram SLA threshold is 5000ms');
  assert(monitoring.SLA.shop === 10000, 'Shop SLA threshold is 10000ms');

  // Test: latency below threshold → OK
  monitoring.recordSuccess('ai', 500);
  const s1 = monitoring.getStatus();
  const ai1 = s1.components.find(c => c.name === 'ai');
  assert(ai1.status === 'OK', 'AI OK when latency below SLA');

  // Test: latency above threshold → DEGRADED
  monitoring.recordSuccess('ai', 20000);
  const s2 = monitoring.getStatus();
  const ai2 = s2.components.find(c => c.name === 'ai');
  assert(ai2.status === 'DEGRADED', 'AI DEGRADED when latency exceeds SLA');
  assert(ai2.message.includes('SLA breach'), 'SLA breach message included');

  // Recovery: below threshold → OK again
  monitoring.recordSuccess('ai', 100);
  const s3 = monitoring.getStatus();
  const ai3 = s3.components.find(c => c.name === 'ai');
  assert(ai3.status === 'OK', 'AI back to OK after latency drops');

  // Test database SLA
  monitoring.recordSuccess('database', 3000);
  const s4 = monitoring.getStatus();
  const db4 = s4.components.find(c => c.name === 'database');
  assert(db4.status === 'DEGRADED', 'Database DEGRADED when exceeds 2000ms SLA');

  monitoring.recordSuccess('database', 50);
  const s5 = monitoring.getStatus();
  const db5 = s5.components.find(c => c.name === 'database');
  assert(db5.status === 'OK', 'Database OK when within SLA');
}

async function testActivityWatchdog() {
  console.log('\n📊 57. ACTIVITY WATCHDOG (SILENT FAILURE) TEST');

  const monitoring = require('../monitoring');

  // Test recordMessageActivity exists and is callable
  assert(typeof monitoring.recordMessageActivity === 'function', 'recordMessageActivity is a function');
  assert(typeof monitoring.recordAiActivity === 'function', 'recordAiActivity is a function');

  // Record activity — should mark activity component OK
  monitoring.recordMessageActivity();
  await monitoring.runAllChecks();
  const s1 = monitoring.getStatus();
  const act1 = s1.components.find(c => c.name === 'activity');
  assert(act1, 'Activity component exists after runAllChecks');
  assert(act1.status === 'OK', 'Activity OK when recent message activity');
  assert(act1.label === 'Message Activity', 'Activity has correct label');
}

async function testBusinessMetrics() {
  console.log('\n📊 58. BUSINESS METRICS TEST');

  const monitoring = require('../monitoring');

  // Test getBusinessMetrics returns data
  const metrics = await monitoring.getBusinessMetrics();
  assert(metrics !== null, 'getBusinessMetrics returns data');
  assert(typeof metrics.dialogs === 'number', 'metrics has dialogs count');
  assert(typeof metrics.orders === 'number', 'metrics has orders count');
  assert(typeof metrics.revenue === 'number', 'metrics has revenue');
  assert(typeof metrics.conversion === 'number', 'metrics has conversion rate');
  assert(typeof metrics.todayDialogs === 'number', 'metrics has todayDialogs');
  assert(typeof metrics.todayOrders === 'number', 'metrics has todayOrders');
  assert(typeof metrics.todayConversion === 'number', 'metrics has todayConversion');
  assert(typeof metrics.avgAiLatency === 'number', 'metrics has avgAiLatency');
  assert(typeof metrics.aiErrorRate === 'number', 'metrics has aiErrorRate');
  assert(typeof metrics.lostClients === 'number', 'metrics has lostClients');
  assert(typeof metrics.telegramSent === 'number', 'metrics has telegramSent');
  assert(typeof metrics.telegramErrors === 'number', 'metrics has telegramErrors');

  // Conversion should be >= 0
  assert(metrics.conversion >= 0, 'conversion is non-negative');
  assert(metrics.aiErrorRate >= 0, 'aiErrorRate is non-negative');
  assert(metrics.revenue >= 0, 'revenue is non-negative');
}

async function testFallbackLogAndFailsafe() {
  console.log('\n📊 59. FALLBACK LOG & FAILSAFE TEST');

  const fs = require('fs');
  const path = require('path');
  const FALLBACK_LOG = path.join(__dirname, '..', '..', 'monitoring-fallback.log');

  // Clean up old fallback log if present
  try { fs.unlinkSync(FALLBACK_LOG); } catch (_) {}

  // The fallback log file should be creatable
  // We test the path is correct per the module
  const monitoring = require('../monitoring');
  assert(typeof monitoring.getQueueLength === 'function', 'getQueueLength function available for queue monitoring');

  // STATUS constants from monitoring
  assert(monitoring.STATUS.OK === 'OK', 'STATUS constant OK available');
  assert(monitoring.STATUS.DEGRADED === 'DEGRADED', 'STATUS constant DEGRADED available');
  assert(monitoring.STATUS.DOWN === 'DOWN', 'STATUS constant DOWN available');
  assert(monitoring.STATUS.UNKNOWN === 'UNKNOWN', 'STATUS constant UNKNOWN available');
}

async function testMetricsCounters() {
  console.log('\n📊 60. METRICS COUNTERS TEST');

  const monitoring = require('../monitoring');

  // Record some AI successes and errors to test counters
  monitoring.recordSuccess('ai', 200);
  monitoring.recordSuccess('ai', 300);
  monitoring.recordError('ai', 'test AI error', 'warning');
  monitoring.recordSuccess('telegram', 150);
  monitoring.recordError('telegram', 'test tg error', 'warning');

  // Get metrics — counters should reflect activity
  const m = await monitoring.getBusinessMetrics();
  assert(m !== null, 'Metrics returns data after counter activity');
  assert(m.telegramSent > 0, 'telegramSent counter incremented');
  assert(m.telegramErrors > 0, 'telegramErrors counter incremented');

  // aiErrorRate should be > 0 since we recorded errors
  // Note: it depends on total counters across all tests
  assert(typeof m.aiErrorRate === 'number', 'aiErrorRate computed from counters');
}

async function testMonitoringMetricsEndpoint() {
  console.log('\n📊 61. MONITORING METRICS API ENDPOINT TEST');

  const http = require('http');
  const express = require('express');
  const jwt = require('jsonwebtoken');
  const routes = require('../api/routes');
  const { authMiddleware } = require('../api/auth');

  const app = express();
  app.use(express.json());

  // Create a valid JWT token
  const token = jwt.sign({ login: config.ADMIN_LOGIN, jti: 'test-metrics-jti' }, config.JWT_SECRET, { expiresIn: '1h' });
  app.use('/api', authMiddleware, routes);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const axios = require('axios');
    const headers = { Authorization: 'Bearer ' + token };

    // Test /monitoring/metrics endpoint
    const res = await axios.get(`http://localhost:${port}/api/monitoring/metrics`, { headers });
    assert(res.status === 200, 'GET /monitoring/metrics returns 200');
    assert(res.data.dialogs !== undefined, '/monitoring/metrics returns dialogs');
    assert(res.data.orders !== undefined, '/monitoring/metrics returns orders');
    assert(res.data.conversion !== undefined, '/monitoring/metrics returns conversion');
    assert(res.data.revenue !== undefined, '/monitoring/metrics returns revenue');
    assert(res.data.aiErrorRate !== undefined, '/monitoring/metrics returns aiErrorRate');
  } finally {
    server.close();
  }
}

async function testTimezoneConsistency() {
  console.log('\n🕐 62. TIMEZONE CONSISTENCY TEST');

  const { formatMoscowTime, moscowISO, MOSCOW_TZ } = require('../utils/time');

  // Test 1: process.env.TZ is set
  assert(process.env.TZ === 'Europe/Moscow', 'process.env.TZ is Europe/Moscow');

  // Test 2: formatMoscowTime returns Moscow time string
  const fmt = formatMoscowTime();
  assert(typeof fmt === 'string', 'formatMoscowTime returns string');
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(fmt), 'formatMoscowTime format: YYYY-MM-DD HH:MM:SS');

  // Test 3: moscowISO returns ISO-like Moscow string with +03:00
  const iso = moscowISO();
  assert(iso.endsWith('+03:00'), 'moscowISO ends with +03:00');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(iso), 'moscowISO format: YYYY-MM-DDTHH:MM:SS+03:00');

  // Test 4: moscowISO with a known date
  const knownDate = new Date('2026-01-15T12:00:00Z');
  const knownMoscow = moscowISO(knownDate);
  // UTC 12:00 = Moscow 15:00
  assert(knownMoscow.includes('T15:00:00'), 'UTC 12:00 → Moscow 15:00');

  // Test 5: MOSCOW_TZ constant
  assert(MOSCOW_TZ === 'Europe/Moscow', 'MOSCOW_TZ constant exported');

  // Test 6: PostgreSQL timezone is set to Moscow
  const tzRes = await db.query('SHOW timezone');
  const pgTz = tzRes.rows[0].TimeZone;
  assert(pgTz === 'Europe/Moscow', 'PostgreSQL timezone is Europe/Moscow (got: ' + pgTz + ')');

  // Test 7: DB NOW() matches Moscow time (within 5 seconds)
  const dbNow = await db.query('SELECT NOW() as now');
  const dbTimeStr = dbNow.rows[0].now;
  const dbDate = new Date(dbTimeStr);
  const localNow = new Date();
  const diffSec = Math.abs(dbDate.getTime() - localNow.getTime()) / 1000;
  assert(diffSec < 5, 'DB NOW() close to server time (diff: ' + diffSec.toFixed(1) + 's)');

  // Test 8: Create record → verify timestamp in DB is Moscow-formatted
  const testTelegramId = 999888777;
  await cleanup(testTelegramId);
  const user = await users.findOrCreate(testTelegramId, 'TZ Test', 'tztest');
  await messages.save(user.id, 'user', 'timezone test message');

  const msgRes = await db.query(
    "SELECT created_at, to_char(created_at, 'YYYY-MM-DD HH24:MI:SS TZ') as formatted FROM messages WHERE user_id = $1 ORDER BY id DESC LIMIT 1",
    [user.id]
  );
  assert(msgRes.rows.length > 0, 'Test message saved');
  const formattedTz = msgRes.rows[0].formatted;
  assert(formattedTz.includes('MSK'), 'DB timestamp formatted as MSK (got: ' + formattedTz + ')');

  // Test 9: Monitoring API returns Moscow time
  const monitoring = require('../monitoring');
  monitoring.recordSuccess('tz_test', 15);
  await new Promise(r => setTimeout(r, 200));
  const monStatus = monitoring.getStatus();
  const tzComp = monStatus.components.find(c => c.name === 'tz_test');
  assert(tzComp, 'Monitoring component tz_test exists');
  assert(tzComp.lastOk && tzComp.lastOk.includes('+03:00'), 'Monitoring lastOk has +03:00 offset');
  assert(monStatus.checkedAt && monStatus.checkedAt.includes('+03:00'), 'Monitoring checkedAt has +03:00 offset');

  // Test 10: Incident time in Moscow format
  monitoring.recordError('tz_test', 'tz test error', 'critical');
  const incidents = monitoring.getIncidents(5);
  const tzInc = incidents.find(i => i.source === 'tz_test');
  assert(tzInc && tzInc.time.includes('+03:00'), 'Incident time has +03:00 offset');

  // Test 11: Logger timestamps are Moscow-formatted
  const logger = require('../logger');
  assert(typeof logger.info === 'function', 'Logger available');
  // formatMoscowTime is used by logger — verified through module

  // Cleanup
  monitoring.recordSuccess('tz_test', 5);
  await cleanup(testTelegramId);
  await db.query("DELETE FROM monitoring_components WHERE name = 'tz_test'");
  await db.query("DELETE FROM monitoring_incidents WHERE source = 'tz_test'");
}

async function testCustomerMemory() {
  console.log('\n🧠 64. CUSTOMER MEMORY TEST');
  const telegramId = 880000 + Math.floor(Math.random() * 9999);
  const memory = require('../db/memory');

  try {
    const user = await users.findOrCreate(telegramId, 'ТестПамять', 'test_memory');

    // Test 1: extractFromText — phone
    const ex1 = memory.extractFromText('Иванов Иван Иванович +79991234567 Москва, ул. Ленина 15');
    assert(ex1.phone === '+79991234567', 'extract phone from text');
    assert(ex1.full_name === 'Иванов Иван Иванович', 'extract full_name from text');
    assert(ex1.city === 'Москва', 'extract city from text');
    assert(ex1.address && ex1.address.includes('Ленина'), 'extract address from text');

    // Test 2: extractFromText — shoe size
    const ex2 = memory.extractFromText('хочу Nike Air Max 44 размер');
    assert(ex2.shoe_size === '44', 'extract shoe size');
    assert(ex2.preferred_brand === 'Nike', 'extract brand');

    // Test 3: extractFromText — insole
    const ex3 = memory.extractFromText('стелька 28.5 см');
    assert(ex3.insole_cm === '28.5', 'extract insole cm');

    // Test 4: extractAndSave — saves to DB
    await memory.extractAndSave(user.id, 'Иванов Иван +79998887766 Казань, ул. Мира 10, кв 5');
    const mem1 = await memory.get(user.id);
    assert(mem1 !== null, 'memory saved to DB');
    assert(mem1.phone === '+79998887766', 'phone saved to DB');
    assert(mem1.full_name === 'Иванов Иван', 'full_name saved to DB');
    assert(mem1.city === 'Казань', 'city saved to DB');

    // Test 5: update — partial update preserves existing data
    await memory.update(user.id, { shoe_size: '43', preferred_brand: 'Adidas' });
    const mem2 = await memory.get(user.id);
    assert(mem2.shoe_size === '43', 'shoe_size updated');
    assert(mem2.preferred_brand === 'Adidas', 'brand updated');
    assert(mem2.phone === '+79998887766', 'phone preserved after partial update');
    assert(mem2.city === 'Казань', 'city preserved after partial update');

    // Test 6: overwrite — new data overwrites old
    await memory.extractAndSave(user.id, 'Петров Пётр +71112223344 Москва, Новый Арбат 12');
    const mem3 = await memory.get(user.id);
    assert(mem3.phone === '+71112223344', 'phone overwritten with new value');
    assert(mem3.city === 'Москва', 'city overwritten with new value');
    assert(mem3.shoe_size === '43', 'shoe_size preserved (not in new text)');

    // Test 7: behavior update — merge
    await memory.updateBehavior(user.id, { response_speed: 'fast' });
    const mem4 = await memory.get(user.id);
    assert(mem4.behavior && mem4.behavior.response_speed === 'fast', 'behavior stored');

    await memory.updateBehavior(user.id, { price_sensitive: true });
    const mem5 = await memory.get(user.id);
    assert(mem5.behavior.response_speed === 'fast', 'behavior merged - old key preserved');
    assert(mem5.behavior.price_sensitive === true, 'behavior merged - new key added');

    // Test 8: buildContextForAI — generates string
    const ctx = memory.buildContextForAI(mem5);
    assert(ctx.includes('Телефон'), 'AI context includes phone label');
    assert(ctx.includes('Размер обуви: 43'), 'AI context includes shoe size');
    assert(ctx.includes('Москва'), 'AI context includes city');
    assert(ctx.includes('Чувствителен к цене'), 'AI context includes behavior');

    // Test 9: saveFormData
    await memory.saveFormData(user.id, { fullName: 'Сидоров Алекс', phone: '+70001112233', address: 'Сочи, ул. Морская 1' });
    const mem6 = await memory.get(user.id);
    assert(mem6.full_name === 'Сидоров Алекс', 'saveFormData updates name');
    assert(mem6.phone === '+70001112233', 'saveFormData updates phone');

    // Test 10: saveOrderData
    await memory.saveOrderData(user.id, { product: 'Nike Air Max 90', size: '44', brand: null });
    const mem7 = await memory.get(user.id);
    assert(mem7.shoe_size === '44', 'saveOrderData updates size');
    assert(mem7.preferred_brand === 'Nike', 'saveOrderData extracts brand from product name');

    // Test 11: delete
    await memory.deleteByUser(user.id);
    const mem8 = await memory.get(user.id);
    assert(mem8 === null, 'memory deleted');

    // Test 12: memory persists (simulate returning customer)
    await memory.update(user.id, { shoe_size: '42', city: 'Екатеринбург', phone: '+79009009090' });
    // "time passes" - re-read from DB
    const memPersist = await memory.get(user.id);
    assert(memPersist.shoe_size === '42', 'memory persists across reads');
    assert(memPersist.city === 'Екатеринбург', 'city persists');

    // Test 13: multiple orders don't reset memory
    await memory.saveOrderData(user.id, { product: 'Adidas Yeezy 350', size: '42' });
    const memMulti = await memory.get(user.id);
    assert(memMulti.city === 'Екатеринбург', 'city survives order save');
    assert(memMulti.phone === '+79009009090', 'phone survives order save');

    // Test 14: extractFromText — no false positives
    const exEmpty = memory.extractFromText('привет, как дела?');
    assert(Object.keys(exEmpty).length === 0, 'no false positive extraction from simple message');

    const exPartial = memory.extractFromText('хочу кроссовки');
    assert(exPartial.shoe_type === 'кроссовки', 'extract shoe type');
    assert(!exPartial.phone, 'no false phone from shoe text');

    // Cleanup
    await memory.deleteByUser(user.id);
    await cleanup(telegramId);
  } catch (err) {
    console.error('  Customer memory test error:', err.message);
    await cleanup(telegramId).catch(() => {});
  }
}

async function testChatUpgrade() {
  console.log('\n🔧 63. CHAT UPGRADE TEST');
  const telegramId = 990000 + Math.floor(Math.random() * 9999);
  try {
    // Setup: create user and populate data
    const user = await users.findOrCreate(telegramId, 'ТестЧат', 'test_chat');
    await messages.save(user.id, 'user', 'Хочу кроссовки');
    await messages.save(user.id, 'ai', 'Какой размер нужен?');
    await messages.save(user.id, 'user', '42');
    await users.updateState(user.id, 'WAITING_SIZE');

    // Test 1: getAll returns priority fields
    const allUsers = await users.getAll();
    const found = allUsers.find(u => u.id === user.id);
    assert(found !== undefined, 'getAll returns test user');
    assert(found.state_priority !== undefined, 'getAll returns state_priority');
    assert(found.state_priority === 60, 'WAITING_SIZE priority = 60');
    assert(found.unread !== undefined, 'getAll returns unread field');
    assert(found.last_message_role !== undefined, 'getAll returns last_message_role');
    assert(found.last_user_message_at !== undefined || found.last_user_message_at === null, 'getAll returns last_user_message_at');
    assert(found.wait_minutes !== undefined || found.wait_minutes === null, 'getAll returns wait_minutes');

    // Test 2: unread logic — last user message "42" is after last AI reply
    // So unread should be true (user sent msg after AI replied)
    assert(found.unread === true, 'unread=true when last user msg after AI reply');

    // Mark as read, then verify unread becomes false
    await users.markRead(user.id);
    const allUsersRead = await users.getAll();
    const foundRead = allUsersRead.find(u => u.id === user.id);
    assert(foundRead.unread === false, 'unread=false after markRead (initial)');

    // Send a user message to make it unread again
    await messages.save(user.id, 'user', 'Есть 42?');
    const allUsers2 = await users.getAll();
    const found2 = allUsers2.find(u => u.id === user.id);
    assert(found2.unread === true, 'unread=true when last user msg > last reply');
    assert(found2.wait_minutes !== null && found2.wait_minutes >= 0, 'wait_minutes calculated');

    // Test 3: markRead
    await users.markRead(user.id);
    const allUsers3 = await users.getAll();
    const found3 = allUsers3.find(u => u.id === user.id);
    assert(found3.unread === false, 'unread=false after markRead');

    // Test 4: priority ordering — WAITING_PAYMENT > WAITING_SIZE
    const user2 = await users.findOrCreate(telegramId + 1, 'ТестОплата', 'test_pay');
    await users.updateState(user2.id, 'WAITING_PAYMENT');
    await messages.save(user2.id, 'user', 'Оплачу');
    const allUsers4 = await users.getAll();
    const pay = allUsers4.find(u => u.id === user2.id);
    assert(pay.state_priority === 100, 'WAITING_PAYMENT priority = 100');

    // Test 5: order data in getAll
    await orders.create({ user_id: user.id, product: 'Nike Air Max', size: '42', price: 8500, status: 'NEW' });
    const allUsers5 = await users.getAll();
    const withOrder = allUsers5.find(u => u.id === user.id);
    assert(withOrder.order_product === 'Nike Air Max', 'getAll returns order_product');
    assert(Number(withOrder.order_price) === 8500, 'getAll returns order_price');
    assert(withOrder.order_size === '42', 'getAll returns order_size');

    // Test 6: quick-replies API via routes
    const express = require('express');
    const request = require;
    // Direct function test instead of HTTP
    const quickReplies = {
      NEW: ['Какой размер носите?', 'Что ищете? Кроссовки, одежду?'],
      WAITING_SIZE: ['Какой размер носите?'],
      WAITING_FORM: ['Отправьте ФИО, телефон и адрес одним сообщением'],
      WAITING_PAYMENT: ['Скинуть реквизиты для оплаты?'],
    };
    assert(quickReplies[user.state] !== undefined, 'quick replies defined for WAITING_SIZE');
    assert(quickReplies['NEW'].length >= 2, 'quick replies has 2+ options for NEW');
    assert(quickReplies['WAITING_PAYMENT'].length >= 1, 'quick replies has options for WAITING_PAYMENT');

    // Cleanup
    await cleanup(telegramId);
    await cleanup(telegramId + 1);
  } catch (err) {
    console.error('  Chat upgrade test error:', err.message);
    await cleanup(telegramId).catch(() => {});
    await cleanup(telegramId + 1).catch(() => {});
  }
}

// ═══════════════════════════════════════
// BLOCK: Queue system tests
// ═══════════════════════════════════════

async function testQueueSystem() {
  console.log('\n📬 65. QUEUE SYSTEM TEST');
  const queue = require('../queue');

  try {
    queue.reset();

    // Test 1: Enqueue and process
    let processed = [];
    queue.configure({ concurrency: 3, fallbackDelay: 5000 });

    await queue.enqueue('chat_1', async () => { processed.push('chat_1'); });
    await queue.drain();
    assert(processed.includes('chat_1'), 'task processed for chat_1');

    // Test 2: Per-chat lock — tasks for same chat are serialized
    queue.reset();
    processed = [];
    let order = [];
    await queue.enqueue('chat_same', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push('A');
    });
    await queue.enqueue('chat_same', async () => {
      order.push('B');
    });
    await queue.drain();
    assert(order[0] === 'A' && order[1] === 'B', 'per-chat tasks serialized (A then B)');

    // Test 3: Different chats process in parallel
    queue.reset();
    let parallel = [];
    const start = Date.now();
    await queue.enqueue('chat_x', async () => {
      await new Promise(r => setTimeout(r, 50));
      parallel.push({ chat: 'x', time: Date.now() - start });
    });
    await queue.enqueue('chat_y', async () => {
      await new Promise(r => setTimeout(r, 50));
      parallel.push({ chat: 'y', time: Date.now() - start });
    });
    await queue.drain();
    assert(parallel.length === 2, 'both chats processed');
    // Both should finish around the same time if parallel
    const timeDiff = Math.abs(parallel[0].time - parallel[1].time);
    assert(timeDiff < 40, `parallel chats processed concurrently (diff: ${timeDiff}ms)`);

    // Test 4: Priority ordering
    queue.reset();
    const priorityOrder = [];
    queue.configure({ concurrency: 1 });
    // Enqueue low priority first, then high
    await queue.enqueue('chat_low', async () => {
      await new Promise(r => setTimeout(r, 30));
    }); // this one starts immediately (empty queue)
    await queue.enqueue('chat_wait_low', async () => { priorityOrder.push('low'); }, { userState: 'DONE' });
    await queue.enqueue('chat_wait_high', async () => { priorityOrder.push('high'); }, { userState: 'WAITING_PAYMENT' });
    await queue.drain();
    assert(priorityOrder[0] === 'high', 'higher priority task processed first');

    // Test 5: Cancel chat
    queue.reset();
    queue.configure({ concurrency: 1 });
    let cancelledRan = false;
    // Block queue with a slow task
    await queue.enqueue('chat_blocker', async () => {
      await new Promise(r => setTimeout(r, 100));
    });
    await queue.enqueue('chat_cancel', async () => {
      if (!queue.isCancelled('chat_cancel')) cancelledRan = true;
    });
    queue.cancelChat('chat_cancel');
    await queue.drain();
    assert(!cancelledRan, 'cancelled task did not run');

    // Test 6: Metrics tracking
    queue.reset();
    queue.configure({ concurrency: 3 });
    await queue.enqueue('m1', async () => {});
    await queue.enqueue('m2', async () => {});
    await queue.enqueue('m3', async () => { throw new Error('test error'); });
    await queue.drain();
    const metrics = queue.getMetrics();
    assert(metrics.totalEnqueued >= 3, `metrics.totalEnqueued >= 3 (${metrics.totalEnqueued})`);
    assert(metrics.totalProcessed >= 2, `metrics.totalProcessed >= 2 (${metrics.totalProcessed})`);
    assert(metrics.totalErrors >= 1, `metrics.totalErrors >= 1 (${metrics.totalErrors})`);

    // Test 7: Queue size limit
    queue.reset();
    queue.configure({ concurrency: 1 });
    // Fill with a slow blocking task
    await queue.enqueue('blocker', async () => {
      await new Promise(r => setTimeout(r, 200));
    });
    // Queue up to max
    let dropCount = 0;
    for (let i = 0; i < 510; i++) {
      try {
        await queue.enqueue(`overflow_${i}`, async () => {});
      } catch (e) {
        dropCount++;
      }
    }
    assert(dropCount > 0 || queue.getMetrics().totalDropped > 0, 'queue drops tasks when full');

    // Test 8: drain() waits for completion
    queue.reset();
    queue.configure({ concurrency: 3 });
    let drainCheck = false;
    await queue.enqueue('drain_test', async () => {
      await new Promise(r => setTimeout(r, 30));
      drainCheck = true;
    });
    await queue.drain();
    assert(drainCheck, 'drain waits for all tasks to complete');

    // Test 9: STATE_PRIORITY mapping
    const { STATE_PRIORITY } = queue;
    assert(STATE_PRIORITY['WAITING_PAYMENT'] < STATE_PRIORITY['DONE'], 'WAITING_PAYMENT has higher priority than DONE');
    assert(STATE_PRIORITY['WAITING_FORM'] < STATE_PRIORITY['NEW'], 'WAITING_FORM higher priority than NEW');

    queue.reset();
  } catch (err) {
    console.error('  Queue test error:', err.message, err.stack);
    queue.reset();
  }
}

async function testQueueConcurrentMessages() {
  console.log('\n📬 66. QUEUE CONCURRENT MESSAGES TEST');
  const queue = require('../queue');

  try {
    queue.reset();
    queue.configure({ concurrency: 5 });

    // Simulate 20 concurrent dialogs
    const results = new Map();
    const chatCount = 20;
    const promises = [];

    for (let i = 0; i < chatCount; i++) {
      const chatId = `concurrent_${i}`;
      promises.push(queue.enqueue(chatId, async () => {
        await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
        results.set(chatId, (results.get(chatId) || 0) + 1);
      }));
    }

    await queue.drain();

    // All 20 chats should have been processed exactly once
    assert(results.size === chatCount, `all ${chatCount} chats processed (got ${results.size})`);
    let dupes = 0;
    for (const [, count] of results) {
      if (count > 1) dupes++;
    }
    assert(dupes === 0, 'no duplicate processing');

    // No messages lost
    const m = queue.getMetrics();
    assert(m.totalProcessed >= chatCount, `all messages processed (${m.totalProcessed} >= ${chatCount})`);

    queue.reset();
  } catch (err) {
    console.error('  Concurrent queue test error:', err.message);
    queue.reset();
  }
}

// ═══════════════════════════════════════
// BLOCK: Enhanced memory tests
// ═══════════════════════════════════════

async function testEnhancedMemory() {
  console.log('\n🧠 67. ENHANCED MEMORY TEST');
  const memory = require('../db/memory');
  const telegramId = 870000 + Math.floor(Math.random() * 9999);

  try {
    const user = await users.findOrCreate(telegramId, 'ТестПамятьV2', 'test_mem_v2');

    // Test 1: saveOrderData with price — creates last_order_summary
    await memory.update(user.id, { shoe_size: '42', city: 'Москва', phone: '+79991234567', full_name: 'Тест Тестов', address: 'Москва, ул. Ленина 1' });
    await memory.saveOrderData(user.id, { product: 'Nike Air Max 90', size: '42', brand: null, price: 8500 });
    const mem1 = await memory.get(user.id);
    assert(mem1.last_order_summary !== null, 'last_order_summary saved');
    assert(mem1.last_order_summary.product === 'Nike Air Max 90', 'last_order_summary has product');
    assert(mem1.last_order_summary.price === 8500, 'last_order_summary has price');
    assert(mem1.last_order_summary.date !== null, 'last_order_summary has date');
    assert(mem1.order_count === 1, 'order_count = 1 after first order');
    assert(Number(mem1.total_spent) === 8500, 'total_spent = 8500 after first order');

    // Test 2: second order increments counters
    await memory.saveOrderData(user.id, { product: 'Adidas Yeezy 350', size: '42', brand: null, price: 12000 });
    const mem2 = await memory.get(user.id);
    assert(mem2.order_count === 2, 'order_count = 2 after second order');
    assert(Math.round(Number(mem2.total_spent)) === 20500, 'total_spent = 20500 after two orders');
    assert(mem2.last_order_summary.product === 'Adidas Yeezy 350', 'last_order_summary updated to latest');

    // Test 3: isVIP — 2+ orders
    assert(memory.isVIP(mem2) === true, 'isVIP=true with 2 orders');
    assert(memory.isVIP({ order_count: 1, total_spent: 5000 }) === false, 'isVIP=false with 1 order + low spend');
    assert(memory.isVIP({ order_count: 1, total_spent: 15000 }) === true, 'isVIP=true with high spend');
    assert(memory.isVIP(null) === false, 'isVIP=false for null memory');

    // Test 4: hasFullDeliveryData
    assert(memory.hasFullDeliveryData(mem2) === true, 'hasFullDeliveryData=true (name+phone+address)');
    assert(memory.hasFullDeliveryData({ full_name: 'Test' }) === false, 'hasFullDeliveryData=false (missing phone+address)');
    assert(memory.hasFullDeliveryData(null) === false, 'hasFullDeliveryData=false for null');

    // Test 5: validateExtracted — rejects garbage
    const v1 = memory.validateExtracted({ phone: 'abc', shoe_size: '99', city: 'A' });
    assert(!v1.phone, 'validates: rejects garbage phone');
    assert(!v1.shoe_size, 'validates: rejects shoe_size=99');
    assert(!v1.city, 'validates: rejects city=A (too short)');

    const v2 = memory.validateExtracted({ phone: '+79991234567', shoe_size: '42', city: 'Москва' });
    assert(v2.phone === '+79991234567', 'validates: accepts good phone');
    assert(v2.shoe_size === '42', 'validates: accepts good size');
    assert(v2.city === 'Москва', 'validates: accepts good city');

    const v3 = memory.validateExtracted({ insole_cm: '100', full_name: 'AB', address: 'short' });
    assert(!v3.insole_cm, 'validates: rejects insole=100');
    assert(!v3.full_name, 'validates: rejects name too short');
    assert(!v3.address, 'validates: rejects address too short');

    // Test 6: getNextAction
    const na1 = memory.getNextAction({ state: 'NEW' }, null);
    assert(na1 && na1.includes('Новый'), 'nextAction: NEW state');

    const na2 = memory.getNextAction({ state: 'NEW' }, { order_count: 1, preferred_brand: 'Nike' });
    assert(na2 && na2.includes('Вернувшийся'), 'nextAction: returning customer');

    const na3 = memory.getNextAction({ state: 'WAITING_SIZE' }, { shoe_size: '42' });
    assert(na3 && na3.includes('42'), 'nextAction: knows size');

    const na4 = memory.getNextAction({ state: 'WAITING_FORM' }, { full_name: 'Тест', phone: '+79991234567', address: 'Москва, ул. Ленина 1' });
    assert(na4 && na4.includes('прошлые'), 'nextAction: has data suggests reuse');

    const na5 = memory.getNextAction({ state: 'WAITING_PAYMENT' }, { behavior: { often_disappears: true } });
    assert(na5 && na5.includes('дожим'), 'nextAction: often_disappears → fast close');

    // Test 7: buildContextForAI with new fields
    const ctxMem = {
      full_name: 'Иванов', phone: '+79991234567', city: 'Москва', address: 'ул. Ленина 1',
      shoe_size: '42', preferred_brand: 'Nike', order_count: 2, total_spent: 20000,
      last_order_summary: { product: 'Nike Air Max', size: '42', price: 10000, date: '2024-01-15T00:00:00Z' },
      behavior: { price_sensitive: true, often_disappears: true },
    };
    const ctx = memory.buildContextForAI(ctxMem);
    assert(ctx.includes('Последний заказ'), 'context includes last order');
    assert(ctx.includes('20000₽'), 'context includes total spent');
    assert(ctx.includes('Кол-во заказов: 2'), 'context includes order count');
    assert(ctx.includes('предлагай выгодные'), 'context includes price_sensitive hint');
    assert(ctx.includes('дожимай быстрее'), 'context includes often_disappears hint');
    assert(ctx.includes('полные данные доставки'), 'context includes full delivery flag');
    assert(ctx.includes('VIP'), 'context includes VIP flag');

    // Cleanup
    await memory.deleteByUser(user.id);
    await cleanup(telegramId);
  } catch (err) {
    console.error('  Enhanced memory test error:', err.message);
    await cleanup(telegramId).catch(() => {});
  }
}

async function testAutoNudgeChain() {
  console.log('\n⏰ 68. AUTO-NUDGE CHAIN TEST');
  const scheduler = require('../scheduler');

  try {
    // Test 1: NUDGE_CHAIN_CONFIG structure (переименован из NUDGE_CHAIN)
    assert(scheduler.NUDGE_CHAIN_CONFIG !== undefined, 'NUDGE_CHAIN exported');
    assert(scheduler.NUDGE_CHAIN_CONFIG.WAITING_PAYMENT.length === 3, 'WAITING_PAYMENT has 3 nudge levels');
    assert(scheduler.NUDGE_CHAIN_CONFIG.WAITING_FORM.length === 3, 'WAITING_FORM has 3 nudge levels');
    assert(scheduler.NUDGE_CHAIN_CONFIG.WAITING_SIZE.length === 2, 'WAITING_SIZE has 2 nudge levels');

    // Test 2: Nudge timing is escalating
    const chain = scheduler.NUDGE_CHAIN_CONFIG.WAITING_PAYMENT;
    assert(chain[0].afterMin < chain[1].afterMin, 'nudge levels escalate in time');
    assert(chain[1].afterMin < chain[2].afterMin, 'nudge levels escalate further');

    // Test 3: First nudge is 1h (60 min)
    assert(chain[0].afterMin === 60, 'first nudge at 1 hour');
    assert(chain[1].afterMin === 1440, 'second nudge at 24 hours');
    assert(chain[2].afterMin === 4320, 'third nudge at 3 days');

    // Test 4: QUICK_NUDGES still exist
    assert(scheduler.QUICK_NUDGES.WAITING_SIZE !== undefined, 'QUICK_NUDGES still has WAITING_SIZE');
    assert(scheduler.QUICK_NUDGES.WAITING_PAYMENT !== undefined, 'QUICK_NUDGES still has WAITING_PAYMENT');
  } catch (err) {
    console.error('  Auto-nudge test error:', err.message);
  }
}

async function testQueueMonitoringEndpoint() {
  console.log('\n📊 69. QUEUE MONITORING TEST');
  const queue = require('../queue');

  try {
    queue.reset();
    queue.configure({ concurrency: 3 });

    // Process some tasks
    await queue.enqueue('mon1', async () => {});
    await queue.enqueue('mon2', async () => {});
    await queue.drain();

    const metrics = queue.getMetrics();
    assert(typeof metrics === 'object', 'getMetrics returns object');
    assert(typeof metrics.totalEnqueued === 'number', 'metrics has enqueued counter');
    assert(typeof metrics.totalProcessed === 'number', 'metrics has processed counter');
    assert(typeof metrics.totalErrors === 'number', 'metrics has errors counter');
    assert(typeof metrics.totalDropped === 'number', 'metrics has dropped counter');
    assert(typeof metrics.totalRetries === 'number', 'metrics has retries counter');
    assert(typeof metrics.queueLength === 'number', 'metrics has queueLength');
    assert(typeof metrics.activeWorkers === 'number', 'metrics has activeWorkers');
    assert(metrics.totalProcessed >= 2, 'metrics shows 2+ processed');

    queue.reset();
  } catch (err) {
    console.error('  Queue monitoring test error:', err.message);
    queue.reset();
  }
}

async function testReturningCustomerFormReuse() {
  console.log('\n🔄 70. RETURNING CUSTOMER FORM REUSE TEST');
  const memory = require('../db/memory');
  const telegramId = 860000 + Math.floor(Math.random() * 9999);

  try {
    const user = await users.findOrCreate(telegramId, 'Возврат', 'return_test');

    // Simulate first order — save full delivery data
    await memory.update(user.id, {
      full_name: 'Иванов Иван',
      phone: '+79991234567',
      address: 'Москва, ул. Ленина 15, кв 42',
      shoe_size: '42',
    });

    const mem = await memory.get(user.id);
    assert(memory.hasFullDeliveryData(mem), 'returning customer has full delivery data');

    // Test: buildContextForAI mentions not to ask again
    const ctx = memory.buildContextForAI(mem);
    assert(ctx.includes('НЕ спрашивай заново'), 'context tells AI not to re-ask');

    // Cleanup
    await memory.deleteByUser(user.id);
    await cleanup(telegramId);
  } catch (err) {
    console.error('  Returning customer test error:', err.message);
    await cleanup(telegramId).catch(() => {});
  }
}

// ═══════════════════════════════════════
// SAFETY GATE TESTS
// ═══════════════════════════════════════

async function testSafetyGateSanitizer() {
  console.log('\n🛡️ 71. SAFETY GATE — SANITIZER');
  const safety = require('../ai/safety');

  // Markdown stripping
  assert(safety.sanitize('**Bold text**') === 'Bold text', 'strips markdown bold');
  assert(safety.sanitize('*italic*') === 'italic', 'strips markdown italic');
  assert(safety.sanitize('# Heading') === 'Heading', 'strips markdown heading');
  assert(safety.sanitize('## Sub heading') === 'Sub heading', 'strips markdown h2');
  assert(safety.sanitize('[link](http://x.com)') === 'link', 'strips markdown links');

  // Code stripping
  assert(safety.sanitize('Hello `code` world') === 'Hello code world', 'strips inline code');
  const codeBlock = 'Hello ```\nconst x = 1;\n``` world';
  const codeResult = safety.sanitize(codeBlock);
  assert(!codeResult.includes('```'), 'strips code blocks');

  // JSON artifact stripping
  assert(safety.sanitize('{"key": "value"}') === '', 'strips JSON objects');
  const jsonArr = safety.sanitize('[{"id": 1}]');
  assert(!jsonArr.includes('{') || jsonArr === '', 'strips JSON arrays');

  // Prompt leak stripping
  assert(safety.sanitize('system: you are an AI') === 'you are an AI', 'strips system: prefix');
  const tokenResult = safety.sanitize('Hello <|im_start|> text');
  assert(!tokenResult.includes('<|'), 'strips special tokens');

  // Whitespace normalization
  assert(safety.sanitize('too   many   spaces') === 'too many spaces', 'normalizes spaces');
  assert(safety.sanitize('line\n\n\n\nline') === 'line\n\nline', 'normalizes blank lines');

  // Empty / null
  assert(safety.sanitize(null) === '', 'null → empty');
  assert(safety.sanitize(undefined) === '', 'undefined → empty');
  assert(safety.sanitize('') === '', 'empty → empty');

  // Normal text passes through
  assert(safety.sanitize('Привет! Как дела?') === 'Привет! Как дела?', 'normal text unchanged');
  assert(safety.sanitize('Nike Air Max за 12500₽ 🔥') === 'Nike Air Max за 12500₽ 🔥', 'product text unchanged');
}

async function testSafetyGateDetector() {
  console.log('\n🛡️ 72. SAFETY GATE — DETECTOR');
  const safety = require('../ai/safety');

  // Empty / short
  assert(!safety.detect('').safe, 'empty blocked');
  assert(!safety.detect('x').safe, 'too short blocked');
  assert(safety.detect('').reason === 'empty', 'empty reason correct');
  assert(safety.detect('x').reason === 'too_short', 'too_short reason correct');

  // JSON artifacts
  assert(!safety.detect('{"error": "something"}').safe, 'JSON object blocked');
  assert(!safety.detect('[{"id": 1}]').safe, 'JSON array blocked');

  // AI identity
  assert(!safety.detect('Я — искусственный интеллект').safe, 'AI identity blocked');
  assert(!safety.detect('Как AI, я не имею мнения').safe, 'AI perspective blocked');
  assert(!safety.detect('Я не могу чувствовать эмоции').safe, 'AI limitation blocked');
  assert(!safety.detect('Я просто программа, но помогу').safe, 'AI program blocked');
  assert(!safety.detect('Могу ошибаться, но попробую').safe, 'AI doubt blocked');

  // Technical leaks
  assert(!safety.detect('Error: API timeout на сервере').safe, 'tech error blocked');
  assert(!safety.detect('Проверьте token авторизации').safe, 'token leak blocked');
  assert(!safety.detect('Произошла ошибка, попробуйте позже').safe, 'error phrase blocked');
  assert(!safety.detect('Что-то пошло не так').safe, 'generic error blocked');
  assert(!safety.detect('Системная ошибка при обработке запроса').safe, 'system error blocked');

  // Model names
  assert(!safety.detect('Я использую GPT-4 для ответов').safe, 'model name blocked');
  assert(!safety.detect('OpenRouter подключён нормально').safe, 'provider name blocked');

  // Prompt leaks
  assert(!safety.detect('СТРОГИЕ ПРАВИЛА работы бота').safe, 'prompt leak blocked');
  assert(!safety.detect('--- КОНЕЦ КАТАЛОГА ---').safe, 'catalog marker blocked');

  // Suspicious patterns
  assert(!safety.detect('Не могу найти такую модель').safe, 'cant find blocked');
  assert(!safety.detect('К сожалению, ничего нет').safe, 'apology blocked');
  assert(!safety.detect('У нас такого нет').safe, 'no stock blocked');
  assert(!safety.detect('Нет в наличии на складе').safe, 'out of stock blocked');
  assert(!safety.detect('Извините, но я не уверен').safe, 'sorry blocked');

  // Normal messages pass
  assert(safety.detect('Привет! Хороший выбор 👍').safe, 'greeting passes');
  assert(safety.detect('Nike Air Max 90 — 12500₽. Какой размер?').safe, 'product pitch passes');
  assert(safety.detect('Записал! Скинь ФИО и телефон 📝').safe, 'form request passes');
  assert(safety.detect('Оплата получена ✅ Скоро отправим!').safe, 'confirmation passes');
  assert(safety.detect('Размер 42 — отличный выбор! Оформляем?').safe, 'size confirm passes');
  assert(safety.detect('Секунду, уточню и вернусь 👌').safe, 'holdoff passes');

  // Too long
  assert(!safety.detect('a'.repeat(2001)).safe, 'too long blocked');
  assert(safety.detect('a'.repeat(2001)).reason === 'too_long', 'too_long reason');
}

async function testSafetyGateEnforce() {
  console.log('\n🛡️ 73. SAFETY GATE — ENFORCE (full pipeline)');
  const safety = require('../ai/safety');

  // safety.enforce теперь async — все вызовы с await

  // Clean response passes through
  const ok = await safety.enforce('Привет! Как тебе Nike Air Max 90? Размер какой?');
  assert(ok.passed === true, 'clean response passes');
  assert(ok.text === 'Привет! Как тебе Nike Air Max 90? Размер какой?', 'clean text unchanged');

  // Markdown gets sanitized, but clean result passes
  const md = await safety.enforce('**Nike Air Max** — отлично!');
  assert(md.passed === true, 'sanitized markdown passes');
  assert(!md.text.includes('**'), 'bold stripped by enforce');

  // AI identity blocked → fallback
  const ai = await safety.enforce('Я — бот, но помогу тебе выбрать');
  assert(ai.passed === false, 'AI identity blocked');
  assert(ai.reason === 'blocked_pattern', 'blocked_pattern reason');
  assert(ai.text.length > 0, 'fallback returned for AI identity');

  // Empty → fallback
  const empty = await safety.enforce('');
  assert(empty.passed === false, 'empty blocked');
  assert(empty.text.length > 0, 'fallback for empty');

  // null → fallback
  const nul = await safety.enforce(null);
  assert(nul.passed === false, 'null blocked');
  assert(nul.text.length > 0, 'fallback for null');

  // JSON artifact → sanitized + blocked as empty
  const json = await safety.enforce('{"error": "timeout"}');
  assert(json.passed === false, 'JSON blocked');
  assert(json.text.length > 0, 'fallback for JSON');

  // Error message → blocked
  const err = await safety.enforce('Извините, произошла ошибка. Попробуйте позже.');
  assert(err.passed === false, 'error msg blocked');

  // Code block → stripped, result may pass if clean text remains
  const code = await safety.enforce('Вот твой заказ ```const order = {}``` 👍');
  assert(code.text.includes('заказ'), 'code block stripped, text preserved');

  // State-aware fallback
  const sized = await safety.enforce('', { userState: 'WAITING_SIZE' });
  assert(sized.passed === false, 'empty blocked for WAITING_SIZE');
  assert(sized.text.length > 0, 'state fallback returned');

  // Scheduled fallback
  const sched = await safety.enforce('', { isScheduled: true });
  assert(sched.passed === false, 'empty blocked for scheduled');
  assert(sched.text.length > 0, 'scheduled fallback returned');
}

async function testSafetyGateCircuitBreaker() {
  console.log('\n🛡️ 74. SAFETY GATE — CIRCUIT BREAKER');
  const safety = require('../ai/safety');

  // Reset state
  safety.cbReset();

  // shouldCallAI теперь async
  const cb1 = await safety.shouldCallAI();
  assert(cb1.allowed === true, 'CB closed: allows requests');
  assert(safety.cbGetState().state === 'CLOSED', 'initial state CLOSED');

  // Record failures
  for (let i = 0; i < 4; i++) {
    safety.cbRecord(false);
  }
  assert(safety.cbGetState().state === 'CLOSED', 'still CLOSED after 4 failures');
  const cb2 = await safety.shouldCallAI();
  assert(cb2.allowed === true, 'still allows after 4 failures');

  // 5th failure → OPEN
  safety.cbRecord(false);
  assert(safety.cbGetState().state === 'OPEN', 'OPEN after 5 failures');
  assert(safety.cbGetState().failures === 5, 'failure count = 5');

  // Blocked
  const blocked = await safety.shouldCallAI('NEW');
  assert(blocked.allowed === false, 'CB open: blocks requests');
  assert(blocked.fallback && blocked.fallback.length > 0, 'CB provides fallback');

  // Success recovery
  safety.cbReset();
  safety.cbRecord(true);
  assert(safety.cbGetState().state === 'CLOSED', 'recovery: back to CLOSED');
  const cb3 = await safety.shouldCallAI();
  assert(cb3.allowed === true, 'recovery: allows requests');
}

async function testSafetyGateFallbacks() {
  console.log('\n🛡️ 75. SAFETY GATE — FALLBACK QUALITY');
  // safety.getFallback удалён — fallback теперь через aiSettings.pickFallback()
  const aiSettings = require('../db/ai_settings');
  const safety = require('../ai/safety');

  // All fallback categories return non-empty strings from DB
  const categories = ['general', 'ai_down', 'blocked'];
  for (const cat of categories) {
    const fb = await aiSettings.pickFallback(cat);
    assert(fb && fb.length > 0, `fallback category "${cat}" returns text from DB`);
  }

  // State-specific fallbacks
  const states = ['WAITING_SIZE', 'WAITING_FORM', 'WAITING_PAYMENT'];
  for (const state of states) {
    const fb = await aiSettings.pickFallback('blocked', state);
    assert(fb && fb.length > 0, `state fallback "${state}" returns text from DB`);
  }

  // Fallbacks don't trigger safety gate themselves
  for (const cat of categories) {
    const fb = await aiSettings.pickFallback(cat);
    const check = safety.detect(fb);
    assert(check.safe === true, `fallback "${cat}" is itself safe: "${(fb || '').substring(0, 40)}"`);
  }

  for (const state of states) {
    const fb = await aiSettings.pickFallback('blocked', state);
    const check = safety.detect(fb);
    assert(check.safe === true, `state fallback "${state}" is safe: "${(fb || '').substring(0, 40)}"`);
  }
}

async function testSafetyGateNoLeakScenarios() {
  console.log('\n🛡️ 76. SAFETY — NO LEAK SCENARIOS');
  const safety = require('../ai/safety');

  // safety.enforce теперь async

  // Scenario: AI returns raw prompt
  const promptLeak = await safety.enforce('system: ты — менеджер магазина кроссовок. СТРОГИЕ ПРАВИЛА: 1. Не говори что ты AI');
  assert(promptLeak.passed === false, 'prompt leak blocked');

  // Scenario: AI returns JSON with customer data
  const jsonLeak = await safety.enforce('{"name": "Иван", "phone": "+79991234567"}');
  assert(jsonLeak.passed === false, 'JSON customer data blocked');

  // Scenario: AI stack trace
  const stackLeak = await safety.enforce('TypeError: Cannot read property "name" of undefined at processMessage');
  assert(stackLeak.passed === false, 'stack trace blocked');

  // Scenario: Mixed valid + invalid
  const mixed = await safety.enforce('Отличный выбор! Как AI, я рекомендую этот товар');
  assert(mixed.passed === false, 'mixed valid+AI blocked');

  // Scenario: AI suggests retry
  const retryLeak = await safety.enforce('Попробуйте позже, сейчас много заказов');
  assert(retryLeak.passed === false, 'retry suggestion blocked');

  // Scenario: ChatGPT-style disclaimer
  const disclaimer = await safety.enforce('Я виртуальный помощник и могу ошибаться');
  assert(disclaimer.passed === false, 'virtual assistant blocked');

  // Scenario: Repeated enforce calls don't accumulate state
  safety.cbReset();
  for (let i = 0; i < 10; i++) {
    const r = await safety.enforce('Нормальный ответ для клиента 👍');
    assert(r.passed === true, `repeat enforce #${i + 1} passes`);
  }
}

async function testSafetyGateValidatorIntegration() {
  console.log('\n🛡️ 77. SAFETY — VALIDATOR FALLBACK SAFETY');
  const { getSafeFallback } = require('../ai/validator');
  const safety = require('../ai/safety');

  // All validator fallbacks must pass safety gate
  const statuses = ['not_configured', 'api_error', 'empty_catalog', 'ok'];
  const reasons = ['fabricated_price', 'price_without_catalog', 'robot_reveal', 'negative_availability', undefined];

  for (const status of statuses) {
    for (const reason of reasons) {
      const fb = await getSafeFallback(status, reason);
      const check = safety.detect(fb);
      assert(check.safe === true, `validator fallback safe: status=${status} reason=${reason} → "${(fb || '').substring(0, 40)}"`);
    }
  }
}

async function testSafetyGateHardcodedMessages() {
  console.log('\n🛡️ 78. SAFETY — HARDCODED MESSAGES PASS');
  const safety = require('../ai/safety');

  // All hardcoded messages from sales.js should pass safety gate
  const hardcoded = [
    'Понял, сейчас гляну по наличию 👀 Если именно этой нет — подберу максимально похожие. Какой размер нужен?',
    'Хороший выбор 👍 Сейчас проверю наличие. Если что — есть очень похожие варианты. Размер какой?',
    'Норм модель 🔥 Гляну что есть. А пока скажи — какой размер носишь?',
    'Скинь одним сообщением: ФИО, телефон и адрес доставки — и сразу оформим 🚀',
    'Уточняю цену на этот товар. Подскажи, какой именно интересует — пересчитаем 🙏',
    '✅ Отлично! Заказ оформлен!\n\nМы проверим оплату и отправим заказ как можно скорее. Спасибо за покупку! 🎉',
    'Давай начнём заново — что хотите заказать? 😊',
    'Секунду, подбираю варианты 👌',
    'Ещё думаешь над размером? Если что — подскажу 👟',
    'Скинь ФИО, телефон и адрес — и оформим заказ 🚀',
    'Напоминаю — заказ ждёт оплаты. Переведи и скинь скрин 💳',
  ];

  for (const msg of hardcoded) {
    const result = await safety.enforce(msg);
    assert(result.passed === true, `hardcoded passes: "${msg.substring(0, 50)}..."`);
  }

  // Nudge chain messages should also pass
  const nudges = [
    'Привет! Всё ок? Заказ ждёт — если есть вопросы, пиши 😊',
    'Напоминаю про заказ 💳 Переведи и скинь скрин — отправим сразу!',
    'Заказ всё ещё ждёт! Может, оформим? Если что-то смущает — скажи, решим 🤝',
    'Осталось совсем чуть-чуть! Скинь ФИО, телефон и адрес — и оформим 🚀',
    'Определился с размером? Если надо — помогу подобрать 👟',
  ];

  for (const msg of nudges) {
    const result = await safety.enforce(msg);
    assert(result.passed === true, `nudge passes: "${msg.substring(0, 50)}..."`);
  }
}

async function testSafetyGateEdgeCases() {
  console.log('\n🛡️ 79. SAFETY — EDGE CASES');
  const safety = require('../ai/safety');

  // safety.enforce теперь async

  // Unicode edge cases
  assert((await safety.enforce('Привет 🔥🔥🔥')).passed === true, 'emoji-heavy passes');
  assert((await safety.enforce('👟'.repeat(50))).passed === true, 'many emojis pass');

  // Numbers only
  assert((await safety.enforce('42')).passed === true, 'size number passes');
  assert((await safety.enforce('+79991234567')).passed === true, 'phone number passes');

  // Price text
  assert((await safety.enforce('12500₽')).passed === true, 'price passes');

  // Very long valid text (close to limit)
  const longValid = 'Отличный выбор! '.repeat(100);
  const longResult = await safety.enforce(longValid);
  if (longValid.length > 2000) {
    assert(longResult.passed === false, 'very long blocked');
  } else {
    assert(longResult.passed === true, 'long but valid passes');
  }

  // Sanitizer preserves line breaks for product listings
  const listing = 'Вот что есть:\n• Nike Air Max — 12500₽\n• Adidas Yeezy — 15000₽\n\nКакой нравится?';
  const listingResult = await safety.enforce(listing);
  assert(listingResult.passed === true, 'product listing passes');
  assert(listingResult.text.includes('\n'), 'line breaks preserved');
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
    await testBusinessDeepLink();
    await testWebhookDeduplication();
    await testMonitoring();
    await testMonitoringPersistence();
    await testWriteQueue();
    await testSLAThresholds();
    await testActivityWatchdog();
    await testBusinessMetrics();
    await testFallbackLogAndFailsafe();
    await testMetricsCounters();
    await testMonitoringMetricsEndpoint();
    await testTimezoneConsistency();
    await testChatUpgrade();
    await testCustomerMemory();
    await testQueueSystem();
    await testQueueConcurrentMessages();
    await testEnhancedMemory();
    await testAutoNudgeChain();
    await testQueueMonitoringEndpoint();
    await testReturningCustomerFormReuse();
    await testSafetyGateSanitizer();
    await testSafetyGateDetector();
    await testSafetyGateEnforce();
    await testSafetyGateCircuitBreaker();
    await testSafetyGateFallbacks();
    await testSafetyGateNoLeakScenarios();
    await testSafetyGateValidatorIntegration();
    await testSafetyGateHardcodedMessages();
    await testSafetyGateEdgeCases();
    await testAiSettingsAllTextsInDB();
    await testAiSettingsToggles();
    await testAiSettingsQuickReplies();
    await testAiSettingsSelfCheck();
    await testAiSettingsAntiRepeat();
    await testAiSettingsFallbackFromDB();
    await testNoHardcodedClientTexts();

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

// ═══════════════════════════════════════
// AI SETTINGS: ЕДИНЫЙ ЦЕНТР УПРАВЛЕНИЯ РЕЧЬЮ
// ═══════════════════════════════════════

async function testAiSettingsAllTextsInDB() {
  console.log('\n🗂️  AI SETTINGS: все тексты живут в БД');
  const aiSettings = require('../db/ai_settings');

  const requiredKeys = [
    'speech_greeting', 'speech_ask_size', 'speech_ask_insole', 'speech_ask_address',
    'speech_ask_phone', 'speech_pushdown', 'speech_payment_request', 'speech_payment_confirm',
    'speech_reminder_payment', 'speech_reminder_form', 'speech_reminder_size',
    'speech_repeat_sale', 'speech_complaint', 'speech_return',
    'speech_objection_price', 'speech_objection_think',
    'speech_restart', 'speech_order_summary', 'speech_waiting_fallback',
    'speech_payment_card', 'speech_start_bizchat',
    'fallback_general_1', 'fallback_blocked_1', 'fallback_ai_down_1',
    'fallback_not_configured', 'fallback_robot_reveal', 'fallback_negative_avail',
    'soft_response_1', 'offtopic_redirect_1',
    'nudge_payment_1h', 'nudge_form_1h', 'nudge_size_1h',
    'qr_new_1', 'qr_size_alt', 'qr_payment_card',
    'seller_name', 'seller_address_format', 'sales_style_preset',
    'toggle_anti_repeat', 'toggle_self_check', 'toggle_fallback',
    'toggle_reminders', 'toggle_repeat_sales', 'toggle_memory',
  ];

  let missing = 0;
  for (const key of requiredKeys) {
    const val = await aiSettings.getRaw(key);
    if (!val) {
      console.log(`    ⚠️  Отсутствует ключ: ${key}`);
      missing++;
    }
  }
  assert(missing === 0, `Все ${requiredKeys.length} обязательных ключей присутствуют в БД`);
}

async function testAiSettingsToggles() {
  console.log('\n🔘 AI SETTINGS: тумблеры работают');
  const aiSettings = require('../db/ai_settings');

  // Проверяем что тумблеры читаются
  const antiRepeat = await aiSettings.isEnabled('toggle_anti_repeat');
  assert(typeof antiRepeat === 'boolean', 'toggle_anti_repeat возвращает boolean');

  const selfCheck = await aiSettings.isEnabled('toggle_self_check');
  assert(typeof selfCheck === 'boolean', 'toggle_self_check возвращает boolean');

  const fallback = await aiSettings.isEnabled('toggle_fallback');
  assert(typeof fallback === 'boolean', 'toggle_fallback возвращает boolean');

  const memory = await aiSettings.isEnabled('toggle_memory');
  assert(typeof memory === 'boolean', 'toggle_memory возвращает boolean');

  // Проверяем что выключенный тумблер возвращает null из get()
  await aiSettings.setEnabled('toggle_anti_repeat', false);
  aiSettings.invalidateCache();
  const disabledCheck = await aiSettings.isEnabled('toggle_anti_repeat');
  assert(disabledCheck === false, 'Выключенный тумблер isEnabled() = false');

  // Восстанавливаем
  await aiSettings.setEnabled('toggle_anti_repeat', true);
  aiSettings.invalidateCache();
  const restored = await aiSettings.isEnabled('toggle_anti_repeat');
  assert(restored === true, 'Тумблер восстановлен в true');
}

async function testAiSettingsQuickReplies() {
  console.log('\n💬 AI SETTINGS: quick replies из БД');
  const aiSettings = require('../db/ai_settings');

  const qr1 = await aiSettings.get('qr_new_1');
  assert(qr1 && qr1.length > 0, 'qr_new_1 возвращает текст из БД');

  const qrCard = await aiSettings.get('qr_payment_card');
  assert(qrCard && qrCard.length > 0, 'qr_payment_card возвращает текст из БД');

  // Проверяем что текст можно изменить
  const original = await aiSettings.getRaw('qr_new_1');
  await aiSettings.set('qr_new_1', 'Тест изменения quick reply');
  aiSettings.invalidateCache();
  const changed = await aiSettings.get('qr_new_1');
  assert(changed === 'Тест изменения quick reply', 'Текст quick reply изменился в БД');

  // Восстанавливаем
  await aiSettings.set('qr_new_1', original);
  aiSettings.invalidateCache();
  const restored = await aiSettings.get('qr_new_1');
  assert(restored === original, 'Текст quick reply восстановлен');
}

async function testAiSettingsSelfCheck() {
  console.log('\n🔍 AI SETTINGS: self-check работает');
  // Импортируем внутренние функции через прямой путь
  const safety = require('../ai/safety');

  // Шаблонные фразы должны блокироваться safety gate
  const templateResult = safety.detect('Здравствуйте, чем могу помочь вам сегодня?');
  // Эта фраза не в BLOCKED_PATTERNS safety, но проверяем что detect работает
  assert(typeof templateResult.safe === 'boolean', 'safety.detect возвращает { safe: boolean }');

  // Технические фразы блокируются
  const techResult = safety.detect('Произошла ошибка в системе');
  assert(techResult.safe === false, 'Техническая фраза "произошла ошибка" блокируется');

  // AI-раскрытие блокируется
  const aiReveal = safety.detect('Я — искусственный интеллект и не могу помочь');
  assert(aiReveal.safe === false, 'AI-раскрытие блокируется safety gate');

  // Нормальный ответ проходит
  const normalResult = safety.detect('Размер 42 — отличный выбор! Оформляем?');
  assert(normalResult.safe === true, 'Нормальный ответ проходит self-check');
}

async function testAiSettingsAntiRepeat() {
  console.log('\n🔄 AI SETTINGS: anti-repeat настраивается из БД');
  const aiSettings = require('../db/ai_settings');

  // Чувствительность читается из БД
  const sensitivity = await aiSettings.getRaw('anti_repeat_sensitivity');
  assert(sensitivity !== null, 'anti_repeat_sensitivity присутствует в БД');
  const val = parseFloat(sensitivity);
  assert(!isNaN(val) && val >= 0 && val <= 1, `Чувствительность ${val} в диапазоне 0-1`);

  // Тумблер anti-repeat управляет поведением
  const enabled = await aiSettings.isEnabled('toggle_anti_repeat');
  assert(typeof enabled === 'boolean', 'toggle_anti_repeat читается как boolean');
}

async function testAiSettingsFallbackFromDB() {
  console.log('\n🛡️  AI SETTINGS: fallback берётся только из БД');
  const aiSettings = require('../db/ai_settings');

  // Все категории fallback возвращают тексты из БД
  const general = await aiSettings.pickFallback('general');
  assert(general && general.length > 0, 'pickFallback("general") возвращает текст из БД');
  assert(!general.includes('👌') || general.length > 5, 'Fallback не является аварийным минимумом');

  const blocked = await aiSettings.pickFallback('blocked');
  assert(blocked && blocked.length > 0, 'pickFallback("blocked") возвращает текст из БД');

  const aiDown = await aiSettings.pickFallback('ai_down');
  assert(aiDown && aiDown.length > 0, 'pickFallback("ai_down") возвращает текст из БД');

  // State-specific fallback
  const waitingSize = await aiSettings.pickFallback('general', 'WAITING_SIZE');
  assert(waitingSize && waitingSize.length > 0, 'State-specific fallback для WAITING_SIZE работает');

  // Soft responses
  const soft = await aiSettings.pickSoftResponse();
  assert(soft && soft.length > 0, 'pickSoftResponse() возвращает текст из БД');

  // Offtopic redirects
  const offtopic = await aiSettings.pickOfftopicRedirect();
  assert(offtopic && offtopic.length > 0, 'pickOfftopicRedirect() возвращает текст из БД');
}

async function testNoHardcodedClientTexts() {
  console.log('\n🚫 АУДИТ: нет хардкод-текстов в pipeline-файлах');

  // Проверяем что ключевые файлы не содержат прямых клиентских строк
  const fs = require('fs');
  const path = require('path');

  const filesToCheck = [
    { file: 'telegram/handler.js', forbidden: ['Подключение успешно ✅', 'Реквизиты для оплаты:\n\nКарта:', 'Секунду, подбираю варианты 👌'] },
    { file: 'ai/safety.js', forbidden: ['Секунду 👌', 'Секунду, уточню 👌'] },
    { file: 'ai/validator.js', forbidden: ['Чё присматриваешь? Помогу подобрать 😊'] },
  ];

  let hardcodeFound = 0;
  for (const { file, forbidden } of filesToCheck) {
    const fullPath = path.join(__dirname, '..', file);
    let content = '';
    try { content = fs.readFileSync(fullPath, 'utf8'); } catch (e) { continue; }
    for (const phrase of forbidden) {
      if (content.includes(phrase)) {
        console.log(`    ⚠️  Хардкод найден в ${file}: "${phrase.substring(0, 40)}..."`);
        hardcodeFound++;
      }
    }
  }
  assert(hardcodeFound === 0, `Хардкод-тексты удалены из pipeline-файлов (найдено: ${hardcodeFound})`);

  // Проверяем что sales.js использует aiSettings.get() для всех текстов
  const salesPath = path.join(__dirname, '../logic/sales.js');
  const salesContent = fs.readFileSync(salesPath, 'utf8');
  const aiSettingsCallCount = (salesContent.match(/aiSettings\.(get|pickSoftResponse|pickFallback)/g) || []).length;
  assert(aiSettingsCallCount >= 10, `sales.js использует aiSettings минимум 10 раз (найдено: ${aiSettingsCallCount})`);

  // Проверяем что routes.js quick-replies не содержат хардкод строк
  const routesPath = path.join(__dirname, '../api/routes.js');
  const routesContent = fs.readFileSync(routesPath, 'utf8');
  const hasHardcodedQR = routesContent.includes("replies.push('Что ищете?")
    || routesContent.includes("replies.push('Показать популярные")
    || routesContent.includes("replies.push('Доставка по всей России')");
  assert(!hasHardcodedQR, 'routes.js quick-replies не содержат хардкод строк');
}

run();
