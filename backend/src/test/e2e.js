process.env.TZ = 'Europe/Moscow';
require('dotenv').config();

const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const { handleMessage } = require('../telegram/handler');
const aiClient = require('../ai/client');
const bot = require('../telegram/bot');

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
  if (!userRow.rows[0]) return;
  const userId = userRow.rows[0].id;
  await db.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function runScenario() {
  console.log('\n🚀 MINIMAL RELAY E2E');

  const TG_ID = 300000001;
  const sentMessages = [];
  const aiCalls = [];

  await db.init();
  await cleanup(TG_ID);

  const originalSendMessage = bot.sendMessage;
  const originalAiSendText = aiClient.sendText;

  bot.sendMessage = async (chatId, text) => {
    sentMessages.push({ chatId, text });
    return { message_id: 1000 + sentMessages.length };
  };

  aiClient.sendText = async (text) => {
    aiCalls.push(text);
    return `AI:${text}`;
  };

  try {
    await handleMessage({
      message_id: 1,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Привет, как дела?',
    });

    const user = await users.findOrCreate(TG_ID, 'Ivan Test', 'ivantest');
    let conversation = await messages.getByUser(user.id);

    assert(aiCalls.length === 1, '1. Входящее сообщение уходит в AI');
    assert(aiCalls[0] === 'Привет, как дела?', '2. В AI уходит ровно текст клиента');
    assert(sentMessages.length === 1, '3. Ответ уходит обратно в Telegram');
    assert(sentMessages[0].text === 'AI:Привет, как дела?', '4. В Telegram уходит ответ модели');
    assert(conversation.length === 2, '5. Диалог сохраняет user и ai сообщения');
    assert(conversation[1].delivery_status === 'delivered', '6. AI сообщение помечается delivered');

    bot.sendMessage = async () => {
      throw new Error('telegram_down');
    };

    await handleMessage({
      message_id: 2,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Ты здесь?',
    });

    conversation = await messages.getByUser(user.id);
    const failedMessage = conversation.filter((message) => message.role === 'ai').at(-1);
    assert(aiCalls.at(-1) === 'Ты здесь?', '7. Даже при сбое Telegram сообщение уходит в AI');
    assert(failedMessage.delivery_status === 'failed', '8. Ошибка доставки фиксируется как failed');
  } finally {
    bot.sendMessage = originalSendMessage;
    aiClient.sendText = originalAiSendText;
    await cleanup(TG_ID);
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
