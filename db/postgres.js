const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const DATABASE_URL = process.env.DATABASE_URL || '';

let pool = null;
let ready = false;
let lastError = '';

function isEnabled() {
  return Boolean(DATABASE_URL);
}

async function query(text, params = []) {
  if (!pool) throw new Error('PostgreSQL is not configured');
  return pool.query(text, params);
}

async function migrate() {
  if (!pool) return;
  await query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const exists = await query('select 1 from schema_migrations where version = $1', [version]);
    if (exists.rowCount) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    await query('begin');
    try {
      await query(sql);
      await query('insert into schema_migrations (version) values ($1)', [version]);
      await query('commit');
    } catch (error) {
      await query('rollback');
      throw error;
    }
  }
}

async function init() {
  if (!isEnabled()) {
    lastError = '';
    return { ok: false, enabled: false, error: '' };
  }
  try {
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 8),
    });
    await migrate();
    ready = true;
    lastError = '';
    return { ok: true, enabled: true, error: '' };
  } catch (error) {
    ready = false;
    lastError = error.message;
    return { ok: false, enabled: true, error: lastError };
  }
}

function status() {
  return {
    enabled: isEnabled(),
    ready,
    error: lastError,
  };
}

async function foundationStatus() {
  const baseStatus = status();
  const tables = ['customers', 'chats', 'messages', 'events', 'ai_turns'];
  if (!ready) {
    return {
      ...baseStatus,
      type: 'PostgreSQL',
      tables: tables.map((name) => ({ name, exists: false, rows: null })),
    };
  }
  const result = await query(`
    select
      table_name,
      to_regclass(format('public.%I', table_name)) is not null as exists
    from unnest($1::text[]) as table_name
  `, [tables]);
  const existing = new Map(result.rows.map((row) => [row.table_name, row.exists]));
  const tableStats = [];
  for (const name of tables) {
    let rows = null;
    if (existing.get(name)) {
      const count = await query(`select count(*)::int as rows from ${name}`);
      rows = count.rows[0]?.rows ?? 0;
    }
    tableStats.push({ name, exists: Boolean(existing.get(name)), rows });
  }
  return {
    ...baseStatus,
    type: 'PostgreSQL',
    tables: tableStats,
  };
}

function json(value) {
  return value == null ? null : JSON.stringify(value);
}

async function recordEvent(event, data = {}) {
  if (!ready) return null;
  const result = await query(`
    insert into events (trace_id, event_type, source, payload)
    values ($1, $2, $3, $4::jsonb)
    returning id
  `, [
    data.traceId || data.trace_id || null,
    event,
    data.source || 'server',
    json(data),
  ]);
  return result.rows[0]?.id || null;
}

async function upsertTelegramCustomer(from = {}, chat = {}) {
  if (!ready) return null;
  const telegramUserId = from.id ? String(from.id) : chat.id ? String(chat.id) : '';
  if (!telegramUserId) return null;
  const result = await query(`
    insert into customers (
      source,
      telegram_user_id,
      telegram_username,
      first_name,
      last_name,
      display_name,
      raw
    )
    values ($1, $2, $3, $4, $5, $6, $7::jsonb)
    on conflict (source, telegram_user_id)
    do update set
      telegram_username = excluded.telegram_username,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      display_name = excluded.display_name,
      raw = excluded.raw,
      updated_at = now()
    returning id
  `, [
    'telegram',
    telegramUserId,
    from.username || chat.username || null,
    from.first_name || chat.first_name || null,
    from.last_name || chat.last_name || null,
    [from.first_name || chat.first_name, from.last_name || chat.last_name].filter(Boolean).join(' ') || from.username || chat.username || telegramUserId,
    json({ from, chat }),
  ]);
  return result.rows[0]?.id || null;
}

async function upsertTelegramChat({ chat = {}, customerId = null, businessConnectionId = '' }) {
  if (!ready || !chat.id) return null;
  const externalChatId = String(chat.id);
  const result = await query(`
    insert into chats (
      source,
      external_chat_id,
      customer_id,
      business_connection_id,
      title,
      status
    )
    values ($1, $2, $3, $4, $5, $6)
    on conflict (source, external_chat_id)
    do update set
      customer_id = coalesce(excluded.customer_id, chats.customer_id),
      business_connection_id = excluded.business_connection_id,
      title = excluded.title,
      updated_at = now()
    returning id
  `, [
    'telegram',
    externalChatId,
    customerId,
    businessConnectionId || null,
    chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || externalChatId,
    'open',
  ]);
  return result.rows[0]?.id || null;
}

async function recordMessage({
  chatId,
  customerId = null,
  direction,
  role,
  text,
  telegramMessageId = null,
  traceId = null,
  raw = null,
}) {
  if (!ready || !chatId || !text) return null;
  const result = await query(`
    insert into messages (
      chat_id,
      customer_id,
      direction,
      role,
      text,
      telegram_message_id,
      trace_id,
      raw
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    on conflict (chat_id, telegram_message_id)
    where telegram_message_id is not null
    do update set
      text = excluded.text,
      raw = excluded.raw
    returning id
  `, [
    chatId,
    customerId,
    direction,
    role,
    text,
    telegramMessageId ? String(telegramMessageId) : null,
    traceId,
    json(raw || {}),
  ]);
  await query('update chats set last_message_at = now(), updated_at = now() where id = $1', [chatId]);
  return result.rows[0]?.id || null;
}

async function recordAiTurn({
  chatId = null,
  traceId,
  model,
  requestMessages = [],
  responseText = '',
  latencyMs = null,
  ok = true,
  error = '',
}) {
  if (!ready) return null;
  const result = await query(`
    insert into ai_turns (
      chat_id,
      trace_id,
      model,
      request_messages,
      response_text,
      latency_ms,
      ok,
      error
    )
    values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)
    returning id
  `, [
    chatId,
    traceId,
    model,
    json(requestMessages),
    responseText,
    latencyMs,
    ok,
    error || null,
  ]);
  return result.rows[0]?.id || null;
}

module.exports = {
  init,
  status,
  foundationStatus,
  query,
  recordEvent,
  upsertTelegramCustomer,
  upsertTelegramChat,
  recordMessage,
  recordAiTurn,
};
