process.env.TZ = 'Europe/Moscow';
require('dotenv').config();

const db = require('../db');
const users = require('../db/users');
const messages = require('../db/messages');
const settings = require('../db/settings');
const { handleMessage } = require('../telegram/handler');
const bot = require('../telegram/bot');

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
  await db.query('DELETE FROM messages WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM orders WHERE user_id = $1', [userId]);
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

async function main() {
  const sentMessages = [];
  const originalSendMessage = bot.sendMessage;

  try {
    await db.init();
    await cleanup(TG_ID);

    await settings.setMany([
      { key: 'response_delay', value: '0' },
      { key: 'policy_logging_enabled', value: 'true' },
    ]);

    bot.sendMessage = async (chatId, text) => {
      sentMessages.push({ chatId, text });
      return { message_id: 9000 + sentMessages.length };
    };

    await handleMessage({
      message_id: 1,
      chat: { id: TG_ID },
      from: { id: TG_ID, first_name: 'Live', last_name: 'Smoke', username: 'livesmoke' },
      text: 'Привет, это live smoke',
    });

    const user = await users.findOrCreate(TG_ID, 'Live Smoke', 'livesmoke');
    const conversation = await messages.getByUser(user.id);
    const aiMessages = conversation.filter((message) => message.role === 'ai');

    assert(sentMessages.length === 1, 'AI did not send a Telegram reply');
    assert(aiMessages.length === 1, 'AI message was not saved to DB');
    assert(aiMessages[0].delivery_status === 'delivered', 'AI reply was not marked delivered');
    assert(aiMessages[0].text === sentMessages[0].text, 'Saved AI reply differs from delivered Telegram text');

    console.log('LIVE_SMOKE_OK');
    console.log(JSON.stringify({
      sent_messages: sentMessages,
      ai_reply: aiMessages[0].text,
      delivery_status: aiMessages[0].delivery_status,
    }, null, 2));
  } finally {
    bot.sendMessage = originalSendMessage;
    await cleanup(TG_ID).catch(() => {});
  }
}

main().catch((err) => {
  console.error('LIVE_SMOKE_FAILED:', err.message);
  process.exit(1);
});
