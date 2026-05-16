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
  const tables = ['customers', 'chats', 'messages', 'events', 'ai_turns', 'customer_facts', 'orders'];
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

function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
  return compact.replace(/\D/g, '');
}

function ensureReady() {
  if (!ready) throw new Error('PostgreSQL is not ready');
}

function clampLimit(value, fallback = 50, max = 100) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(number)));
}

function encodeCursor(row, field = 'sort_at') {
  if (!row?.[field] || !row?.id) return null;
  return Buffer.from(JSON.stringify({
    at: new Date(row[field]).toISOString(),
    id: String(row.id),
  })).toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
    if (!parsed.at || !parsed.id) return null;
    return { at: new Date(parsed.at).toISOString(), id: String(parsed.id) };
  } catch {
    return null;
  }
}

function pageResult(rows, limit, field = 'sort_at') {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? encodeCursor(items[items.length - 1], field) : null,
    },
  };
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

async function setCustomerAvatar(customerId, avatarFileId = null) {
  if (!ready || !customerId) return null;
  const result = await query(`
    update customers
    set
      avatar_file_id = $2,
      avatar_updated_at = now(),
      updated_at = now()
    where id = $1
      and coalesce(avatar_file_id, '') is distinct from $2
    returning id
  `, [customerId, avatarFileId || null]);
  return result.rows[0]?.id || null;
}

async function updateCustomerAvatar(customerId, avatarFileId) {
  if (!avatarFileId) return null;
  return setCustomerAvatar(customerId, avatarFileId);
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
  compiledPrompt = null,
  memorySummary = null,
  inputText = null,
  historyLength = null,
  structuredResponse = null,
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
      error,
      compiled_prompt,
      memory_summary,
      input_text,
      history_length,
      structured_response
    )
    values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
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
    compiledPrompt || null,
    memorySummary || null,
    inputText || null,
    historyLength,
    json(structuredResponse),
  ]);
  return result.rows[0]?.id || null;
}

async function crmOverview() {
  ensureReady();
  const result = await query(`
    select
      count(*)::int as chats_total,
      count(*) filter (where status = 'open')::int as chats_open,
      count(*) filter (where ai_enabled)::int as ai_enabled,
      count(*) filter (where not ai_enabled)::int as ai_paused,
      count(*) filter (where last_message_at > now() - interval '24 hours')::int as active_24h
    from chats
  `);
  const messages = await query(`
    select
      count(*)::int as messages_total,
      count(*) filter (where direction = 'in')::int as inbound,
      count(*) filter (where direction = 'out')::int as outbound
    from messages
  `);
  const ai = await query(`
    select
      count(*)::int as turns_total,
      count(*) filter (where ok)::int as ok,
      count(*) filter (where not ok)::int as failed,
      round(avg(latency_ms))::int as avg_latency_ms
    from ai_turns
  `);
  const channels = await query(`
    select source, count(*)::int as chats
    from chats
    group by source
    order by chats desc, source asc
  `);
  return {
    chats: result.rows[0] || {},
    messages: messages.rows[0] || {},
    ai: ai.rows[0] || {},
    channels: channels.rows,
  };
}

async function listCrmChats(filters = {}) {
  ensureReady();
  const limit = clampLimit(filters.limit, 30, 100);
  const cursor = decodeCursor(filters.cursor);
  const where = [];
  const params = [];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (filters.status) where.push(`c.status = ${add(filters.status)}`);
  if (filters.source) where.push(`c.source = ${add(filters.source)}`);
  if (typeof filters.aiEnabled === 'boolean') where.push(`c.ai_enabled = ${add(filters.aiEnabled)}`);
  if (filters.q) {
    const token = `%${String(filters.q).trim()}%`;
    const p1 = add(token);
    const p2 = add(token);
    const p3 = add(token);
    where.push(`(
      c.title ilike ${p1}
      or cu.display_name ilike ${p2}
      or exists (
        select 1 from messages mq
        where mq.chat_id = c.id and mq.text ilike ${p3}
      )
    )`);
  }
  if (cursor) {
    const p1 = add(cursor.at);
    const p2 = add(cursor.id);
    where.push(`(coalesce(c.last_message_at, c.updated_at, c.created_at), c.id) < (${p1}::timestamptz, ${p2}::uuid)`);
  }

  const result = await query(`
    select
      c.id,
      c.source,
      c.external_chat_id,
      c.title,
      c.status,
      c.ai_enabled,
      c.priority,
      c.assigned_to,
      c.notes,
      c.last_message_at,
      c.created_at,
      c.updated_at,
      coalesce(c.last_message_at, c.updated_at, c.created_at) as sort_at,
      cu.id as customer_id,
      cu.display_name as customer_display_name,
      cu.telegram_username as customer_username,
      cu.phone as customer_phone,
      cu.avatar_file_id as customer_avatar_file_id,
      lm.text as last_message_text,
      lm.direction as last_message_direction,
      lm.role as last_message_role,
      lm.created_at as last_message_created_at,
      coalesce(mc.messages_count, 0)::int as messages_count,
      coalesce(at.ai_turns_count, 0)::int as ai_turns_count
    from chats c
    left join customers cu on cu.id = c.customer_id
    left join lateral (
      select text, direction, role, created_at
      from messages
      where chat_id = c.id
      order by created_at desc, id desc
      limit 1
    ) lm on true
    left join lateral (
      select count(*) as messages_count
      from messages
      where chat_id = c.id
    ) mc on true
    left join lateral (
      select count(*) as ai_turns_count
      from ai_turns
      where chat_id = c.id
    ) at on true
    ${where.length ? `where ${where.join(' and ')}` : ''}
    order by sort_at desc, c.id desc
    limit ${add(limit + 1)}
  `, params);
  return pageResult(result.rows, limit);
}

async function getCrmChat(chatId) {
  ensureReady();
  const result = await query(`
    select
      c.*,
      cu.id as customer_id,
      cu.source as customer_source,
      cu.telegram_user_id,
      cu.telegram_username,
      cu.first_name,
      cu.last_name,
      cu.display_name,
      cu.phone,
      cu.avatar_file_id,
      cu.avatar_updated_at,
      cu.notes as customer_notes,
      cu.created_at as customer_created_at,
      cu.updated_at as customer_updated_at,
      coalesce(mc.messages_count, 0)::int as messages_count,
      coalesce(at.ai_turns_count, 0)::int as ai_turns_count
    from chats c
    left join customers cu on cu.id = c.customer_id
    left join lateral (
      select count(*) as messages_count from messages where chat_id = c.id
    ) mc on true
    left join lateral (
      select count(*) as ai_turns_count from ai_turns where chat_id = c.id
    ) at on true
    where c.id = $1
  `, [chatId]);
  return result.rows[0] || null;
}

async function listCrmMessages(chatId, filters = {}) {
  ensureReady();
  const limit = clampLimit(filters.limit, 50, 100);
  const cursor = decodeCursor(filters.cursor);
  const where = ['chat_id = $1'];
  const params = [chatId];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (filters.direction) where.push(`direction = ${add(filters.direction)}`);
  if (filters.role) where.push(`role = ${add(filters.role)}`);
  if (cursor) where.push(`(created_at, id) < (${add(cursor.at)}::timestamptz, ${add(cursor.id)}::uuid)`);

  const result = await query(`
    select
      id,
      chat_id,
      customer_id,
      direction,
      role,
      text,
      telegram_message_id,
      trace_id,
      raw,
      created_at,
      created_at as sort_at
    from messages
    where ${where.join(' and ')}
    order by created_at desc, id desc
    limit ${add(limit + 1)}
  `, params);
  return pageResult(result.rows, limit);
}

async function listCrmAiTurns(chatId, filters = {}) {
  ensureReady();
  const limit = clampLimit(filters.limit, 30, 100);
  const cursor = decodeCursor(filters.cursor);
  const params = [chatId];
  const where = ['chat_id = $1'];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (cursor) where.push(`(created_at, id) < (${add(cursor.at)}::timestamptz, ${add(cursor.id)}::uuid)`);

  const result = await query(`
    select
      id,
      chat_id,
      trace_id,
      model,
      request_messages,
      response_text,
      latency_ms,
      ok,
      error,
      compiled_prompt,
      memory_summary,
      input_text,
      history_length,
      structured_response,
      created_at,
      created_at as sort_at
    from ai_turns
    where ${where.join(' and ')}
    order by created_at desc, id desc
    limit ${add(limit + 1)}
  `, params);
  return pageResult(result.rows, limit);
}

async function listCrmEvents(chatId, filters = {}) {
  ensureReady();
  const limit = clampLimit(filters.limit, 50, 100);
  const cursor = decodeCursor(filters.cursor);
  const params = [chatId];
  const where = [`
    (
      trace_id in (select trace_id from messages where chat_id = $1 and trace_id is not null)
      or trace_id in (select trace_id from ai_turns where chat_id = $1 and trace_id is not null)
      or payload->>'chatDbId' = $1::text
    )
  `];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (cursor) where.push(`(created_at, id) < (${add(cursor.at)}::timestamptz, ${add(cursor.id)}::bigint)`);

  const result = await query(`
    select
      id::text,
      trace_id,
      event_type,
      source,
      payload,
      created_at,
      created_at as sort_at
    from events
    where ${where.join(' and ')}
    order by created_at desc, id desc
    limit ${add(limit + 1)}
  `, params);
  return pageResult(result.rows, limit);
}

async function updateCrmChat(chatId, changes = {}) {
  ensureReady();
  const allowedStatuses = new Set(['open', 'paused', 'needs_human', 'closed', 'archived']);
  const sets = [];
  const params = [];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'status')) {
    if (!allowedStatuses.has(changes.status)) throw new Error('Unsupported chat status');
    sets.push(`status = ${add(changes.status)}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'ai_enabled')) {
    sets.push(`ai_enabled = ${add(Boolean(changes.ai_enabled))}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'notes')) {
    sets.push(`notes = ${add(String(changes.notes || ''))}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'priority')) {
    const priority = Number(changes.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 5) throw new Error('Priority must be an integer from 0 to 5');
    sets.push(`priority = ${add(priority)}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'assigned_to')) {
    sets.push(`assigned_to = ${add(String(changes.assigned_to || '').trim() || null)}`);
  }
  if (changes.mark_read) {
    sets.push('last_read_at = now()');
  }
  if (!sets.length) return getCrmChat(chatId);

  sets.push('updated_at = now()');
  params.push(chatId);
  const result = await query(`
    update chats
    set ${sets.join(', ')}
    where id = $${params.length}
    returning id
  `, params);
  if (!result.rowCount) return null;
  return getCrmChat(chatId);
}

async function updateCrmCustomer(customerId, changes = {}) {
  ensureReady();
  const sets = [];
  const params = [];

  function add(value) {
    params.push(value);
    return `$${params.length}`;
  }

  if (Object.prototype.hasOwnProperty.call(changes, 'phone')) {
    sets.push(`phone = ${add(normalizePhone(changes.phone) || null)}`);
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'notes')) {
    sets.push(`notes = ${add(String(changes.notes || ''))}`);
  }
  if (!sets.length) return null;

  sets.push('updated_at = now()');
  params.push(customerId);
  const result = await query(`
    update customers
    set ${sets.join(', ')}
    where id = $${params.length}
    returning id
  `, params);
  return result.rows[0]?.id || null;
}

async function upsertCustomerFact(customerId, key, value, source = 'ai') {
  if (!ready || !customerId || !key) return null;
  const normalizedValue = String(value || '');
  const result = await query(`
    insert into customer_facts (customer_id, key, value, source)
    values ($1, $2, $3, $4)
    on conflict (customer_id, key)
    do update set
      value = excluded.value,
      source = excluded.source,
      updated_at = now()
    returning id
  `, [customerId, key, normalizedValue, source]);
  if (['phone', 'phone_number', 'customer_phone'].includes(String(key))) {
    const phone = normalizePhone(normalizedValue);
    if (phone) {
      await query(`
        update customers
        set phone = $2,
            updated_at = now()
        where id = $1
          and coalesce(phone, '') is distinct from $2
      `, [customerId, phone]);
    }
  }
  return result.rows[0]?.id || null;
}

async function getCustomerFacts(customerId) {
  if (!ready || !customerId) return [];
  const result = await query(`
    select key, value, source, updated_at
    from customer_facts
    where customer_id = $1
    order by key asc
  `, [customerId]);
  return result.rows;
}

async function getCustomerSnapshot(customerId) {
  if (!ready || !customerId) return {};
  const [customer, facts] = await Promise.all([
    query(`
      select
        id,
        display_name,
        telegram_username,
        phone,
        first_name,
        last_name,
        notes
      from customers
      where id = $1
    `, [customerId]),
    getCustomerFacts(customerId),
  ]);
  const customerRow = customer.rows[0] || {};
  const factMap = Object.fromEntries(facts.map((fact) => [fact.key, fact.value]));
  return {
    customer_name: customerRow.display_name || '',
    telegram_username: customerRow.telegram_username || '',
    phone: customerRow.phone || factMap.phone || '',
    first_name: customerRow.first_name || '',
    last_name: customerRow.last_name || '',
    notes: customerRow.notes || '',
    ...factMap,
  };
}

async function upsertOrderDraft({
  customerId = null,
  chatId = null,
  source = 'telegram',
  traceId = null,
  totalAmount = null,
  currency = 'RUB',
  summary = '',
  snapshot = {},
  paymentMessageId = null,
}) {
  if (!ready || (!customerId && !chatId)) return null;
  const recent = await query(`
    select id
    from orders
    where status = 'awaiting_payment'
      and (
        ($1::uuid is not null and customer_id = $1)
        or ($2::uuid is not null and chat_id = $2)
      )
    order by created_at desc
    limit 1
  `, [customerId, chatId]);
  if (recent.rowCount) {
    const orderId = recent.rows[0].id;
    const updated = await query(`
      update orders
      set source = $2,
          trace_id = $3,
          total_amount = $4,
          currency = $5,
          summary = $6,
          snapshot = $7::jsonb,
          payment_message_id = coalesce($8, payment_message_id),
          updated_at = now()
      where id = $1
      returning id
    `, [orderId, source, traceId, totalAmount, currency, summary || null, json(snapshot || {}), paymentMessageId ? String(paymentMessageId) : null]);
    return updated.rows[0]?.id || null;
  }
  const created = await query(`
    insert into orders (
      customer_id,
      chat_id,
      source,
      trace_id,
      total_amount,
      currency,
      summary,
      snapshot,
      payment_message_id
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    returning id
  `, [
    customerId,
    chatId,
    source,
    traceId,
    totalAmount,
    currency,
    summary || null,
    json(snapshot || {}),
    paymentMessageId ? String(paymentMessageId) : null,
  ]);
  return created.rows[0]?.id || null;
}

async function markLatestOrderPaid({
  customerId = null,
  chatId = null,
  traceId = null,
  receiptMessageId = null,
  snapshotPatch = {},
}) {
  if (!ready || (!customerId && !chatId)) return null;
  const pending = await query(`
    select id, snapshot
    from orders
    where status = 'awaiting_payment'
      and (
        ($1::uuid is not null and customer_id = $1)
        or ($2::uuid is not null and chat_id = $2)
      )
    order by created_at desc
    limit 1
  `, [customerId, chatId]);
  if (!pending.rowCount) return null;
  const order = pending.rows[0];
  const nextSnapshot = {
    ...(order.snapshot || {}),
    ...(snapshotPatch || {}),
  };
  const updated = await query(`
    update orders
    set status = 'paid',
        trace_id = coalesce($2, trace_id),
        receipt_message_id = coalesce($3, receipt_message_id),
        snapshot = $4::jsonb,
        paid_at = now(),
        updated_at = now()
    where id = $1
    returning id
  `, [order.id, traceId, receiptMessageId ? String(receiptMessageId) : null, json(nextSnapshot)]);
  return updated.rows[0]?.id || null;
}

async function listCustomerOrders(customerId, limit = 20) {
  if (!ready || !customerId) return [];
  const result = await query(`
    select
      id,
      customer_id,
      chat_id,
      source,
      trace_id,
      status,
      total_amount,
      currency,
      summary,
      snapshot,
      payment_message_id,
      receipt_message_id,
      paid_at,
      created_at,
      updated_at
    from orders
    where customer_id = $1
    order by created_at desc, id desc
    limit $2
  `, [customerId, clampLimit(limit, 20, 100)]);
  return result.rows;
}

async function getCustomerOrderStats(customerId) {
  if (!ready || !customerId) {
    return { orders_total: 0, paid_orders: 0, paid_amount_total: 0 };
  }
  const result = await query(`
    select
      count(*)::int as orders_total,
      count(*) filter (where status = 'paid')::int as paid_orders,
      coalesce(sum(total_amount) filter (where status = 'paid'), 0)::int as paid_amount_total
    from orders
    where customer_id = $1
  `, [customerId]);
  return result.rows[0] || { orders_total: 0, paid_orders: 0, paid_amount_total: 0 };
}

async function buildMemorySummary(customerId) {
  const facts = await getCustomerFacts(customerId);
  if (!facts.length) return '';
  const LABELS = {
    name: 'Имя',
    city: 'Город',
    phone: 'Телефон',
    shoe_size: 'Размер обуви',
    foot_length: 'Длина стопы',
    clothing_size: 'Размер одежды',
    preferred_brands: 'Бренды',
    preferred_colors: 'Цвета',
    preferred_style: 'Стиль',
    budget: 'Бюджет',
    delivery_method: 'Доставка',
    delivery_address: 'Адрес доставки',
    product_interest: 'Интерес к товару',
    previous_purchases: 'Прошлые покупки',
    concerns: 'Опасения',
    communication_style: 'Стиль общения',
    funnel_stage: 'Этап',
  };
  return facts
    .map((f) => `${LABELS[f.key] || f.key}: ${f.value}`)
    .join('\n');
}

async function getChatHistory(chatId, limit = 50) {
  if (!ready || !chatId) return [];
  const result = await query(`
    select role, text, created_at
    from messages
    where chat_id = $1
    order by created_at desc, id desc
    limit $2
  `, [chatId, limit]);
  return result.rows.reverse();
}

async function resetChatHistory(chatId) {
  ensureReady();

  await query('begin');
  try {
    // Find customer_id for this chat
    const chat = await query('select customer_id from chats where id = $1', [chatId]);
    const customerId = chat.rows[0]?.customer_id || null;

    // Delete events FIRST (before messages/ai_turns, so trace_id subqueries still match)
    const events = await query(`
      delete from events
      where
        trace_id in (select trace_id from messages where chat_id = $1 and trace_id is not null
                     union
                     select trace_id from ai_turns where chat_id = $1 and trace_id is not null)
        or payload->>'chatDbId' = $1::text
    `, [chatId]);

    // Delete messages only for the selected chat.
    const messages = await query('delete from messages where chat_id = $1', [chatId]);

    // Delete AI turns only for the selected chat.
    const aiTurns = await query('delete from ai_turns where chat_id = $1', [chatId]);

    // Delete memory facts only for this selected chat's customer.
    let facts = { rowCount: 0 };
    if (customerId) {
      facts = await query('delete from customer_facts where customer_id = $1', [customerId]);
    }

    // Reset chat metadata
    await query(`
      update chats
      set last_message_at = null,
          status = 'open',
          updated_at = now()
      where id = $1
    `, [chatId]);

    await query('commit');
    return {
      ok: true,
      chatId,
      customerId,
      deleted: {
        events: events.rowCount,
        messages: messages.rowCount,
        aiTurns: aiTurns.rowCount,
        customerFacts: facts.rowCount,
      },
    };
  } catch (error) {
    await query('rollback');
    throw error;
  }
}

module.exports = {
  init,
  status,
  foundationStatus,
  query,
  recordEvent,
  upsertTelegramCustomer,
  setCustomerAvatar,
  updateCustomerAvatar,
  upsertTelegramChat,
  recordMessage,
  recordAiTurn,
  crmOverview,
  listCrmChats,
  getCrmChat,
  listCrmMessages,
  listCrmAiTurns,
  listCrmEvents,
  updateCrmChat,
  updateCrmCustomer,
  upsertCustomerFact,
  getCustomerFacts,
  getCustomerSnapshot,
  upsertOrderDraft,
  markLatestOrderPaid,
  listCustomerOrders,
  getCustomerOrderStats,
  buildMemorySummary,
  getChatHistory,
  resetChatHistory,
};
