#!/usr/bin/env node

require('dotenv').config();

const db = require('../db/postgres');

async function ensureCustomerFromIdentity(identity = {}, chat = {}) {
  return db.upsertTelegramCustomer({
    id: identity.id || chat.id || '',
    username: identity.username || chat.username || '',
    first_name: identity.first_name || chat.first_name || '',
    last_name: identity.last_name || chat.last_name || '',
  }, chat || {});
}

async function repairChats() {
  const chats = await db.query(`
    select id, external_chat_id, customer_id
    from chats
    where source = 'telegram'
    order by updated_at desc
  `);

  let repaired = 0;
  let scanned = 0;

  for (const chat of chats.rows) {
    scanned += 1;
    const firstInbound = await db.query(`
      select raw
      from messages
      where chat_id = $1
        and direction = 'in'
        and role = 'customer'
      order by created_at asc, id asc
      limit 1
    `, [chat.id]);
    const raw = firstInbound.rows[0]?.raw || null;
    const from = raw?.from || {};
    const rawChat = raw?.chat || {};
    const identityId = from.id || rawChat.id || null;
    if (!identityId) continue;

    const correctCustomerId = await ensureCustomerFromIdentity(from, rawChat);
    if (!correctCustomerId) continue;

    if (correctCustomerId !== chat.customer_id) {
      await db.query(`
        update chats
        set customer_id = $2,
            updated_at = now()
        where id = $1
      `, [chat.id, correctCustomerId]);
      repaired += 1;
    }
  }

  return { scanned, repaired };
}

async function main() {
  const init = await db.init();
  if (!init.ok) throw new Error(init.error || 'DB init failed');
  const result = await repairChats();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
