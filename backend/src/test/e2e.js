process.env.TZ = 'Europe/Moscow';
require('dotenv').config();

const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const settings = require('../db/settings');
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
  if (userRow.rows.length === 0) return;
  const userId = userRow.rows[0].id;
  await db.query('DELETE FROM policy_runs WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM orders WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

function createPhotoStub(fileId = 'photo-file-id') {
  return [{ file_id: fileId, width: 100, height: 100 }];
}

async function runScenario() {
  console.log('\n🚀 DIRECT AI RELAY E2E');

  const TG_ID = 300000001;
  const sentMessages = [];
  const aiCalls = [];

  await db.init();
  await cleanup(TG_ID);

  await settings.setMany([
    { key: 'response_delay', value: '0' },
    { key: 'policy_logging_enabled', value: 'true' },
  ]);

  const originalSendMessage = bot.sendMessage;
  const originalAiSendMessage = aiClient.sendMessage;

  bot.sendMessage = async (chatId, text) => {
    sentMessages.push({ chatId, text });
    return { message_id: 1000 + sentMessages.length };
  };

  aiClient.sendMessage = async ({ messages: promptMessages }) => {
    const lastUserMessage = [...promptMessages].reverse().find((message) => message.role === 'user')?.content || '';
    aiCalls.push(lastUserMessage);
    return {
      text: `AI:${lastUserMessage}`,
      tokensIn: 10,
      tokensOut: 10,
    };
  };

  try {
    await handleMessage({
      message_id: 1,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Привет, что есть в наличии?',
    });

    let user = await users.findOrCreate(TG_ID, 'Ivan Test', 'ivantest');
    let conversation = await messages.getByUser(user.id);
    let policyRuns = await db.query('SELECT * FROM policy_runs WHERE user_id = $1 ORDER BY created_at ASC', [user.id]);

    assert(aiCalls.length === 1, '1. Входящее сообщение сразу уходит в AI');
    assert(aiCalls[0] === 'Привет, что есть в наличии?', '2. В AI уходит реальный текст клиента без шаблонов');
    assert(sentMessages.length === 1, '3. Ответ модели отправляется обратно в Telegram');
    assert(sentMessages[0].text === 'AI:Привет, что есть в наличии?', '4. В Telegram уходит именно ответ модели');
    assert(conversation.length === 2, '5. В диалоге сохраняются user + ai сообщения');
    assert(conversation[0].role === 'user' && conversation[1].role === 'ai', '6. Сообщения сохраняются в простой AI-only последовательности');
    assert(conversation[1].delivery_status === 'delivered', '7. AI сообщение помечается как delivered после успешной отправки');
    assert(policyRuns.rows.length === 1, '8. AI run логируется');
    assert(policyRuns.rows[0].raw_output === 'AI:Привет, что есть в наличии?', '9. В policy_runs сохраняется сырой ответ модели');

    await handleMessage({
      message_id: 2,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      caption: 'Смотри фото',
      photo: createPhotoStub(),
    });

    conversation = await messages.getByUser(user.id);
    assert(aiCalls.at(-1) === 'Смотри фото', '10. Подпись к фото тоже уходит в AI напрямую');
    assert(conversation.at(-1).text === 'AI:Смотри фото', '11. Ответ на фото тоже идёт напрямую от модели');

    await handleMessage({
      message_id: 3,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      photo: createPhotoStub('photo-no-caption'),
    });

    conversation = await messages.getByUser(user.id);
    assert(aiCalls.at(-1) === '[фото]', '12. Фото без текста всё равно проходит через AI');
    assert(conversation.at(-1).text === 'AI:[фото]', '13. Для фото без текста нет шаблона, только ответ модели');

    bot.sendMessage = async () => {
      throw new Error('telegram_down');
    };

    await handleMessage({
      message_id: 4,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Ivan', last_name: 'Test', username: 'ivantest' },
      text: 'Ты здесь?',
    });

    conversation = await messages.getByUser(user.id);
    const failedMessage = conversation.filter((message) => message.role === 'ai').at(-1);
    assert(aiCalls.at(-1) === 'Ты здесь?', '14. Даже при сбое Telegram сообщение всё равно проходит через AI');
    assert(failedMessage.delivery_status === 'failed', '15. При ошибке Telegram не создаётся фейковый delivered');
    assert((failedMessage.error_text || '').includes('telegram_down'), '16. Ошибка доставки фиксируется как ошибка системы');
  } finally {
    bot.sendMessage = originalSendMessage;
    aiClient.sendMessage = originalAiSendMessage;
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
