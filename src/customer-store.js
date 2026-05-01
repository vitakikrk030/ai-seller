const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA_VERSION = 4;

function nowIso() {
  return new Date().toISOString();
}

function clean(value, limit = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function createCustomerStore(options = {}) {
  const dbPath = options.dbPath;
  if (!dbPath) throw new Error('dbPath is required');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  const statements = prepareStatements(db);

  function getOrCreateByTelegram(input = {}) {
    const chatId = clean(input.chatId || input.userId, 80);
    if (!chatId) return null;
    const userId = clean(input.userId || chatId, 80);
    const existing = statements.getCustomerByChatId.get(chatId);
    const timestamp = nowIso();

    if (existing) {
      statements.updateCustomerTelegram.run({
        id: existing.id,
        telegram_user_id: userId,
        username: clean(input.username, 120) || existing.username || '',
        first_name: clean(input.firstName, 120) || existing.first_name || '',
        last_name: clean(input.lastName, 120) || existing.last_name || '',
        phone: clean(input.phoneNumber, 80) || existing.phone || '',
        last_seen_at: timestamp,
        updated_at: timestamp,
      });
      return statements.getCustomerById.get(existing.id);
    }

    const result = statements.insertCustomer.run({
      telegram_user_id: userId,
      telegram_chat_id: chatId,
      username: clean(input.username, 120),
      first_name: clean(input.firstName, 120),
      last_name: clean(input.lastName, 120),
      phone: clean(input.phoneNumber, 80),
      created_at: timestamp,
      updated_at: timestamp,
      last_seen_at: timestamp,
    });
    return statements.getCustomerById.get(result.lastInsertRowid);
  }

  function getCustomerId(inputOrChatId) {
    const input = typeof inputOrChatId === 'object' ? inputOrChatId : { chatId: inputOrChatId };
    return getOrCreateByTelegram(input)?.id || null;
  }

  function appendMessage(input = {}, role, text) {
    const customer = getOrCreateByTelegram(input);
    const messageText = clean(text);
    if (!customer || !messageText) return null;
    const telegramMessageId = role !== 'assistant' ? clean(input.messageId, 80) : '';

    if (telegramMessageId) {
      const duplicate = statements.getMessageDuplicate.get({
        customer_id: customer.id,
        role,
        telegram_message_id: telegramMessageId,
      });
      if (duplicate) return duplicate;
    } else if (role === 'assistant' && clean(input.traceId, 80)) {
      const duplicate = statements.getAssistantMessageDuplicate.get({
        customer_id: customer.id,
        trace_id: clean(input.traceId, 80),
      });
      if (duplicate) return duplicate;
    }

    const timestamp = nowIso();
    const result = statements.insertMessage.run({
      customer_id: customer.id,
      telegram_message_id: telegramMessageId,
      role,
      text: messageText,
      message_type: clean(input.messageType || 'text', 60),
      trace_id: clean(input.traceId, 80),
      created_at: timestamp,
    });
    statements.touchCustomer.run({ id: customer.id, updated_at: timestamp, last_seen_at: timestamp });
    return statements.getMessageById.get(result.lastInsertRowid);
  }

  function upsertFact(inputOrChatId, key, value, source, confidence = 'explicit') {
    const customerId = getCustomerId(inputOrChatId);
    const factKey = clean(key, 80);
    const factValue = clean(value);
    if (!customerId || !factKey || !factValue) return null;
    const timestamp = nowIso();
    statements.upsertFact.run({
      customer_id: customerId,
      key: factKey,
      value: factValue,
      confidence: clean(confidence, 40) || 'explicit',
      source: clean(source, 240),
      updated_at: timestamp,
    });
    statements.touchCustomer.run({ id: customerId, updated_at: timestamp, last_seen_at: timestamp });
    return getFactMapByCustomerId(customerId, statements)[factKey] || null;
  }

  function setDialogState(inputOrChatId, patch = {}) {
    const customerId = getCustomerId(inputOrChatId);
    if (!customerId) return null;
    const previous = statements.getDialogState.get(customerId) || {};
    const next = {
      customer_id: customerId,
      stage: clean(patch.stage ?? previous.stage, 80),
      ai_mode: clean(patch.aiMode ?? patch.ai_mode ?? previous.ai_mode, 80),
      mode_source: clean(patch.modeSource ?? patch.mode_source ?? previous.mode_source, 240),
      source: clean(patch.source ?? previous.source, 240),
      manager_active_at: clean(patch.managerActiveAt ?? patch.manager_active_at ?? previous.manager_active_at, 80),
      manager_last_message_at: clean(patch.managerLastMessageAt ?? patch.manager_last_message_at ?? previous.manager_last_message_at, 80),
      pending_since: clean(patch.pendingSince ?? patch.pending_since ?? previous.pending_since, 80),
      auto_takeover_at: clean(patch.autoTakeoverAt ?? patch.auto_takeover_at ?? previous.auto_takeover_at, 80),
      last_manager_trace_id: clean(patch.lastManagerTraceId ?? patch.last_manager_trace_id ?? previous.last_manager_trace_id, 80),
      last_client_trace_id: clean(patch.lastClientTraceId ?? patch.last_client_trace_id ?? previous.last_client_trace_id, 80),
      updated_at: nowIso(),
    };
    statements.upsertDialogState.run(next);
    return getDialogState(inputOrChatId);
  }

  function getDialogState(inputOrChatId) {
    const customerId = getCustomerId(inputOrChatId);
    if (!customerId) return null;
    const row = statements.getDialogState.get(customerId);
    return row ? mapStateRow(row) : null;
  }

  function upsertOrder(inputOrChatId, patch = {}) {
    const customerId = getCustomerId(inputOrChatId);
    if (!customerId) return null;
    const timestamp = nowIso();
    const latest = statements.getLastOrder.get(customerId);
    if (latest && patch.newOrder !== true) {
      statements.updateOrder.run({
        id: latest.id,
        product: clean(patch.product) || latest.product || '',
        size: clean(patch.size, 40) || latest.size || '',
        price: clean(patch.price, 80) || latest.price || '',
        full_name: clean(patch.fullName || patch.full_name) || latest.full_name || '',
        phone: clean(patch.phone, 80) || latest.phone || '',
        delivery_address: clean(patch.deliveryAddress || patch.delivery_address) || latest.delivery_address || '',
        status: clean(patch.status, 80) || latest.status || 'draft',
        payment_status: clean(patch.paymentStatus || patch.payment_status, 80) || latest.payment_status || 'not_requested',
        payment_check_status: clean(patch.paymentCheckStatus || patch.payment_check_status, 80) || latest.payment_check_status || '',
        payment_check_summary: clean(patch.paymentCheckSummary || patch.payment_check_summary) || latest.payment_check_summary || '',
        proof_received_at: clean(patch.proofReceivedAt || patch.proof_received_at, 80) || latest.proof_received_at || '',
        updated_at: timestamp,
      });
      return statements.getOrderById.get(latest.id);
    }

    const result = statements.insertOrder.run({
      customer_id: customerId,
      product: clean(patch.product),
      size: clean(patch.size, 40),
      price: clean(patch.price, 80),
      full_name: clean(patch.fullName || patch.full_name),
      phone: clean(patch.phone, 80),
      delivery_address: clean(patch.deliveryAddress || patch.delivery_address),
      status: clean(patch.status || 'draft', 80),
      payment_status: clean(patch.paymentStatus || patch.payment_status || 'not_requested', 80),
      payment_check_status: clean(patch.paymentCheckStatus || patch.payment_check_status, 80),
      payment_check_summary: clean(patch.paymentCheckSummary || patch.payment_check_summary),
      proof_received_at: clean(patch.proofReceivedAt || patch.proof_received_at, 80),
      created_at: timestamp,
      updated_at: timestamp,
    });
    return statements.getOrderById.get(result.lastInsertRowid);
  }

  function upsertBusinessConnection(connection = {}) {
    const id = clean(connection.id || connection.business_connection_id, 120);
    if (!id) return null;
    const timestamp = nowIso();
    statements.upsertBusinessConnection.run({
      business_connection_id: id,
      business_user_id: clean(connection.user?.id || connection.userId || connection.business_user_id, 80),
      user_chat_id: clean(connection.user_chat_id || connection.userChatId || connection.user_chat_id, 80),
      is_enabled: connection.is_enabled === false ? 0 : 1,
      rights_json: connection.rights ? JSON.stringify(connection.rights) : '',
      updated_at: timestamp,
    });
    return getBusinessConnection(id);
  }

  function getBusinessConnection(id) {
    const row = statements.getBusinessConnection.get(clean(id, 120));
    if (!row) return null;
    return {
      id: row.business_connection_id,
      userId: row.business_user_id || '',
      userChatId: row.user_chat_id || '',
      isEnabled: row.is_enabled !== 0,
      rights: parseJson(row.rights_json),
      updatedAt: row.updated_at,
    };
  }

  function getBusinessConnectionByUserChatId(chatId) {
    const row = statements.getBusinessConnectionByUserChatId.get(clean(chatId, 80));
    if (!row) return null;
    return {
      id: row.business_connection_id,
      userId: row.business_user_id || '',
      userChatId: row.user_chat_id || '',
      isEnabled: row.is_enabled !== 0,
      rights: parseJson(row.rights_json),
      updatedAt: row.updated_at,
    };
  }

  function getRecentMessages(inputOrChatId, limit = 20, excludeTraceIds = []) {
    const customerId = getCustomerId(inputOrChatId);
    if (!customerId) return [];
    const excluded = new Set((excludeTraceIds || []).filter(Boolean).map(String));
    return statements.getRecentMessages.all({
      customer_id: customerId,
      limit: Math.max(1, Math.min(100, Number(limit) || 20)),
    })
      .filter((message) => !excluded.has(message.trace_id))
      .reverse()
      .map(mapMessageRow);
  }

  function selectRecentDialogTurns(messages = [], limit = 20) {
    const items = Array.isArray(messages) ? messages.filter(Boolean) : [];
    const maxTurns = Math.max(20, Math.min(50, Number(limit) || 20));
    let turns = 0;
    let insideClientBlock = false;
    let startIndex = 0;

    for (let index = items.length - 1; index >= 0; index -= 1) {
      const role = items[index]?.role;
      if (role === 'user') {
        if (!insideClientBlock) {
          turns += 1;
          insideClientBlock = true;
          if (turns > maxTurns) {
            startIndex = index + 1;
            break;
          }
        }
      } else {
        insideClientBlock = false;
      }
    }

    return items.slice(startIndex);
  }

  function getCustomerContext(inputOrChatId, options = {}) {
    const customer = getOrCreateByTelegram(typeof inputOrChatId === 'object' ? inputOrChatId : { chatId: inputOrChatId });
    if (!customer) return { summary: '', history: [], facts: {}, state: null, customer: null, lastOrder: null };

    const facts = getFactMapByCustomerId(customer.id, statements);
    const state = getDialogState(customer.telegram_chat_id);
    const lastOrder = statements.getLastOrder.get(customer.id) || null;
    const dialogLimit = Math.max(20, Math.min(50, Number(options.limit) || 20));
    const history = selectRecentDialogTurns(
      getRecentMessages(customer.telegram_chat_id, Math.min(100, dialogLimit * 6), options.excludeTraceIds || []),
      dialogLimit,
    );
    const summary = buildProfileSummary(customer, facts, state, lastOrder, options);

    return {
      summary,
      history: history.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.role === 'manager' ? `Менеджер: ${message.text}` : message.text,
        createdAt: message.createdAt,
        type: message.type,
      })),
      facts,
      state,
      customer: mapCustomerRow(customer),
      lastOrder,
    };
  }

  function getCustomerProfile(inputOrChatId) {
    const customer = getOrCreateByTelegram(typeof inputOrChatId === 'object' ? inputOrChatId : { chatId: inputOrChatId });
    if (!customer) return null;
    return {
      customer: mapCustomerRow(customer),
      facts: getFactMapByCustomerId(customer.id, statements),
      state: getDialogState(customer.telegram_chat_id),
      lastOrder: statements.getLastOrder.get(customer.id) || null,
      recentMessages: getRecentMessages(customer.telegram_chat_id, 20),
    };
  }

  function getInboxCustomers(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 200));
    const messageLimit = Math.max(50, Math.min(2000, Number(options.messageLimit) || 300));
    return statements.listCustomers.all({ limit }).map((customerRow) => {
      const facts = getFactMapByCustomerId(customerRow.id, statements);
      const stateRow = statements.getDialogState.get(customerRow.id);
      const orders = statements.getOrdersByCustomerId.all(customerRow.id).map(mapOrderRow);
      const recentMessages = statements.getRecentMessages.all({
        customer_id: customerRow.id,
        limit: messageLimit,
      }).reverse().map((row) => ({
        ...mapMessageRow(row),
        chatId: customerRow.telegram_chat_id || '',
        userId: customerRow.telegram_user_id || customerRow.telegram_chat_id || '',
      }));

      return {
        customer: mapCustomerRow(customerRow),
        facts,
        state: stateRow ? mapStateRow(stateRow) : null,
        lastOrder: orders[0] || null,
        orders,
        recentMessages,
      };
    });
  }

  function clearCustomer(inputOrChatId) {
    const customerId = getCustomerId(inputOrChatId);
    if (!customerId) return false;
    db.transaction(() => {
      statements.deleteMessages.run(customerId);
      statements.deleteFacts.run(customerId);
      statements.deleteState.run(customerId);
      statements.deleteOrders.run(customerId);
      statements.deleteFollowupJobs.run(customerId);
    })();
    return true;
  }

  function upsertFollowupJob(patch = {}) {
    const customer = getOrCreateByTelegram({
      chatId: patch.chatId || patch.chat_id,
      userId: patch.userId || patch.user_id || patch.chatId || patch.chat_id,
    });
    if (!customer) return null;
    const timestamp = nowIso();
    const id = Number(patch.id) || 0;
    const params = {
      id,
      customer_id: customer.id,
      chat_id: customer.telegram_chat_id,
      kind: clean(patch.kind || 'order_followup', 40),
      status_key: clean(patch.statusKey || patch.status_key, 80),
      status_label: clean(patch.statusLabel || patch.status_label, 120),
      mode: clean(patch.mode || 'drafts', 40),
      state: clean(patch.state || 'draft', 40),
      draft_text: clean(patch.draftText || patch.draft_text, 1800),
      reason: clean(patch.reason, 600),
      due_at: clean(patch.dueAt || patch.due_at, 80),
      sent_at: clean(patch.sentAt || patch.sent_at, 80),
      skipped_at: clean(patch.skippedAt || patch.skipped_at, 80),
      canceled_at: clean(patch.canceledAt || patch.canceled_at, 80),
      attempts: Math.max(0, Number(patch.attempts) || 0),
      max_attempts: Math.max(1, Number(patch.maxAttempts || patch.max_attempts) || 1),
      last_client_message_at: clean(patch.lastClientMessageAt || patch.last_client_message_at, 80),
      last_outgoing_message_at: clean(patch.lastOutgoingMessageAt || patch.last_outgoing_message_at, 80),
      safety_json: JSON.stringify(patch.safety || patch.safety_json || {}),
      created_at: clean(patch.createdAt || patch.created_at, 80) || timestamp,
      updated_at: timestamp,
    };

    if (id) {
      statements.updateFollowupJob.run(params);
      return getFollowupJob(id);
    }

    const result = statements.insertFollowupJob.run(params);
    return getFollowupJob(result.lastInsertRowid);
  }

  function getFollowupJob(id) {
    const row = statements.getFollowupJob.get(Number(id) || 0);
    return mapFollowupJobRow(row);
  }

  function getOpenFollowupJobByChat(chatId) {
    const row = statements.getOpenFollowupJobByChat.get(clean(chatId, 80));
    return mapFollowupJobRow(row);
  }

  function listFollowupJobs(options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    return statements.listFollowupJobs.all({ limit }).map(mapFollowupJobRow).filter(Boolean);
  }

  function insertFollowupEvent(event = {}) {
    const timestamp = nowIso();
    const customerId = Number(event.customerId || event.customer_id) || null;
    const result = statements.insertFollowupEvent.run({
      job_id: Number(event.jobId || event.job_id) || null,
      customer_id: customerId,
      chat_id: clean(event.chatId || event.chat_id, 80),
      event: clean(event.event, 80),
      message: clean(event.message, 800),
      metadata_json: JSON.stringify(event.metadata || event.metadata_json || {}),
      created_at: timestamp,
    });
    return statements.getFollowupEvent.get(result.lastInsertRowid);
  }

  function importLegacyMemory(memoryStore = {}) {
    db.transaction(() => {
      Object.values(memoryStore.businessConnections || {}).forEach((connection) => {
        upsertBusinessConnection(connection);
      });

      Object.entries(memoryStore.facts || {}).forEach(([chatId, facts]) => {
        getOrCreateByTelegram({ chatId, userId: chatId });
        Object.entries(facts || {}).forEach(([key, fact]) => {
          upsertFact(chatId, key, fact?.value, fact?.source || '', fact?.confidence || 'explicit');
        });
      });

      Object.entries(memoryStore.states || {}).forEach(([chatId, state]) => {
        setDialogState(chatId, {
          stage: state.stage || '',
          aiMode: state.aiMode || '',
          modeSource: state.modeSource || '',
          source: state.source || '',
          managerActiveAt: state.managerActiveAt || '',
          managerLastMessageAt: state.managerLastMessageAt || '',
          pendingSince: state.pendingSince || '',
          autoTakeoverAt: state.autoTakeoverAt || '',
          lastManagerTraceId: state.lastManagerTraceId || '',
          lastClientTraceId: state.lastClientTraceId || '',
        });
      });

      (memoryStore.messages || []).forEach((message) => {
        appendMessage({
          chatId: message.chatId,
          userId: message.userId,
          messageId: message.telegramMessageId,
          messageType: message.type,
          traceId: message.traceId,
        }, message.role || 'client', message.text || '');
      });
    })();
  }

  function close() {
    db.close();
  }

  return {
    db,
    getOrCreateByTelegram,
    appendMessage,
    upsertFact,
    setDialogState,
    getDialogState,
    upsertOrder,
    upsertBusinessConnection,
    getBusinessConnection,
    getBusinessConnectionByUserChatId,
    getRecentMessages,
    getCustomerContext,
    getCustomerProfile,
    getInboxCustomers,
    upsertFollowupJob,
    getFollowupJob,
    getOpenFollowupJobByChat,
    listFollowupJobs,
    insertFollowupEvent,
    clearCustomer,
    importLegacyMemory,
    close,
  };
}

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const hasV1 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(1);
  if (!hasV1) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_user_id TEXT,
      telegram_chat_id TEXT NOT NULL UNIQUE,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      telegram_message_id TEXT,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      message_type TEXT,
      trace_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_customer_role_tg
      ON messages(customer_id, role, telegram_message_id)
      WHERE telegram_message_id IS NOT NULL AND telegram_message_id != '';

    CREATE TABLE IF NOT EXISTS customer_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence TEXT,
      source TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(customer_id, key),
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dialog_states (
      customer_id INTEGER PRIMARY KEY,
      stage TEXT,
      ai_mode TEXT,
      mode_source TEXT,
      source TEXT,
      manager_active_at TEXT,
      manager_last_message_at TEXT,
      pending_since TEXT,
      auto_takeover_at TEXT,
      last_manager_trace_id TEXT,
      last_client_trace_id TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      product TEXT,
      size TEXT,
      price TEXT,
      full_name TEXT,
      phone TEXT,
      delivery_address TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS business_connections (
      business_connection_id TEXT PRIMARY KEY,
      business_user_id TEXT,
      user_chat_id TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      rights_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);

    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, nowIso());
  }

  const hasV2 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(2);
  if (!hasV2) {
    addColumnIfMissing(db, 'orders', 'payment_status', 'TEXT');
    addColumnIfMissing(db, 'orders', 'payment_check_status', 'TEXT');
    addColumnIfMissing(db, 'orders', 'payment_check_summary', 'TEXT');
    addColumnIfMissing(db, 'orders', 'proof_received_at', 'TEXT');
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, nowIso());
  }

  const hasV4 = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(4);
  if (!hasV4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS followup_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        chat_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status_key TEXT,
        status_label TEXT,
        mode TEXT NOT NULL,
        state TEXT NOT NULL,
        draft_text TEXT,
        reason TEXT,
        due_at TEXT,
        sent_at TEXT,
        skipped_at TEXT,
        canceled_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 1,
        last_client_message_at TEXT,
        last_outgoing_message_at TEXT,
        safety_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_followup_jobs_chat_state
        ON followup_jobs(chat_id, state, updated_at);

      CREATE INDEX IF NOT EXISTS idx_followup_jobs_due
        ON followup_jobs(state, due_at);

      CREATE TABLE IF NOT EXISTS followup_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER,
        customer_id INTEGER,
        chat_id TEXT,
        event TEXT NOT NULL,
        message TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES followup_jobs(id) ON DELETE SET NULL,
        FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_followup_events_chat_created
        ON followup_events(chat_id, created_at);
    `);
    db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(4, nowIso());
  }

}

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function prepareStatements(db) {
  return {
    getCustomerByChatId: db.prepare('SELECT * FROM customers WHERE telegram_chat_id = ?'),
    getCustomerById: db.prepare('SELECT * FROM customers WHERE id = ?'),
    listCustomers: db.prepare(`
      SELECT * FROM customers
      ORDER BY datetime(last_seen_at) DESC, datetime(updated_at) DESC, id DESC
      LIMIT @limit
    `),
    insertCustomer: db.prepare(`
      INSERT INTO customers (telegram_user_id, telegram_chat_id, username, first_name, last_name, phone, created_at, updated_at, last_seen_at)
      VALUES (@telegram_user_id, @telegram_chat_id, @username, @first_name, @last_name, @phone, @created_at, @updated_at, @last_seen_at)
    `),
    updateCustomerTelegram: db.prepare(`
      UPDATE customers
      SET telegram_user_id = @telegram_user_id,
          username = @username,
          first_name = @first_name,
          last_name = @last_name,
          phone = @phone,
          last_seen_at = @last_seen_at,
          updated_at = @updated_at
      WHERE id = @id
    `),
    touchCustomer: db.prepare('UPDATE customers SET updated_at = @updated_at, last_seen_at = @last_seen_at WHERE id = @id'),
    getMessageDuplicate: db.prepare(`
      SELECT * FROM messages
      WHERE customer_id = @customer_id AND role = @role AND telegram_message_id = @telegram_message_id
      LIMIT 1
    `),
    getAssistantMessageDuplicate: db.prepare(`
      SELECT * FROM messages
      WHERE customer_id = @customer_id AND role = 'assistant' AND trace_id = @trace_id
      LIMIT 1
    `),
    insertMessage: db.prepare(`
      INSERT INTO messages (customer_id, telegram_message_id, role, text, message_type, trace_id, created_at)
      VALUES (@customer_id, @telegram_message_id, @role, @text, @message_type, @trace_id, @created_at)
    `),
    getMessageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    getRecentMessages: db.prepare(`
      SELECT * FROM messages
      WHERE customer_id = @customer_id
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT @limit
    `),
    upsertFact: db.prepare(`
      INSERT INTO customer_facts (customer_id, key, value, confidence, source, updated_at)
      VALUES (@customer_id, @key, @value, @confidence, @source, @updated_at)
      ON CONFLICT(customer_id, key) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        source = excluded.source,
        updated_at = excluded.updated_at
    `),
    getFactsByCustomerId: db.prepare('SELECT * FROM customer_facts WHERE customer_id = ? ORDER BY key'),
    upsertDialogState: db.prepare(`
      INSERT INTO dialog_states (
        customer_id, stage, ai_mode, mode_source, source, manager_active_at,
        manager_last_message_at, pending_since, auto_takeover_at,
        last_manager_trace_id, last_client_trace_id, updated_at
      )
      VALUES (
        @customer_id, @stage, @ai_mode, @mode_source, @source, @manager_active_at,
        @manager_last_message_at, @pending_since, @auto_takeover_at,
        @last_manager_trace_id, @last_client_trace_id, @updated_at
      )
      ON CONFLICT(customer_id) DO UPDATE SET
        stage = excluded.stage,
        ai_mode = excluded.ai_mode,
        mode_source = excluded.mode_source,
        source = excluded.source,
        manager_active_at = excluded.manager_active_at,
        manager_last_message_at = excluded.manager_last_message_at,
        pending_since = excluded.pending_since,
        auto_takeover_at = excluded.auto_takeover_at,
        last_manager_trace_id = excluded.last_manager_trace_id,
        last_client_trace_id = excluded.last_client_trace_id,
        updated_at = excluded.updated_at
    `),
    getDialogState: db.prepare('SELECT * FROM dialog_states WHERE customer_id = ?'),
    insertOrder: db.prepare(`
      INSERT INTO orders (
        customer_id, product, size, price, full_name, phone, delivery_address, status,
        payment_status, payment_check_status, payment_check_summary, proof_received_at,
        created_at, updated_at
      )
      VALUES (
        @customer_id, @product, @size, @price, @full_name, @phone, @delivery_address, @status,
        @payment_status, @payment_check_status, @payment_check_summary, @proof_received_at,
        @created_at, @updated_at
      )
    `),
    getOrderById: db.prepare('SELECT * FROM orders WHERE id = ?'),
    getLastOrder: db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY datetime(created_at) DESC, id DESC LIMIT 1'),
    getOrdersByCustomerId: db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY datetime(created_at) DESC, id DESC'),
    updateOrder: db.prepare(`
      UPDATE orders
      SET product = @product,
          size = @size,
          price = @price,
          full_name = @full_name,
          phone = @phone,
          delivery_address = @delivery_address,
          status = @status,
          payment_status = @payment_status,
          payment_check_status = @payment_check_status,
          payment_check_summary = @payment_check_summary,
          proof_received_at = @proof_received_at,
          updated_at = @updated_at
      WHERE id = @id
    `),
    upsertBusinessConnection: db.prepare(`
      INSERT INTO business_connections (business_connection_id, business_user_id, user_chat_id, is_enabled, rights_json, updated_at)
      VALUES (@business_connection_id, @business_user_id, @user_chat_id, @is_enabled, @rights_json, @updated_at)
      ON CONFLICT(business_connection_id) DO UPDATE SET
        business_user_id = excluded.business_user_id,
        user_chat_id = excluded.user_chat_id,
        is_enabled = excluded.is_enabled,
        rights_json = excluded.rights_json,
        updated_at = excluded.updated_at
    `),
    getBusinessConnection: db.prepare('SELECT * FROM business_connections WHERE business_connection_id = ?'),
    getBusinessConnectionByUserChatId: db.prepare(`
      SELECT * FROM business_connections
      WHERE user_chat_id = ? AND is_enabled != 0
      ORDER BY datetime(updated_at) DESC
      LIMIT 1
    `),
    insertFollowupJob: db.prepare(`
      INSERT INTO followup_jobs (
        customer_id, chat_id, kind, status_key, status_label, mode, state,
        draft_text, reason, due_at, sent_at, skipped_at, canceled_at,
        attempts, max_attempts, last_client_message_at, last_outgoing_message_at,
        safety_json, created_at, updated_at
      )
      VALUES (
        @customer_id, @chat_id, @kind, @status_key, @status_label, @mode, @state,
        @draft_text, @reason, @due_at, @sent_at, @skipped_at, @canceled_at,
        @attempts, @max_attempts, @last_client_message_at, @last_outgoing_message_at,
        @safety_json, @created_at, @updated_at
      )
    `),
    updateFollowupJob: db.prepare(`
      UPDATE followup_jobs
      SET kind = @kind,
          status_key = @status_key,
          status_label = @status_label,
          mode = @mode,
          state = @state,
          draft_text = @draft_text,
          reason = @reason,
          due_at = @due_at,
          sent_at = @sent_at,
          skipped_at = @skipped_at,
          canceled_at = @canceled_at,
          attempts = @attempts,
          max_attempts = @max_attempts,
          last_client_message_at = @last_client_message_at,
          last_outgoing_message_at = @last_outgoing_message_at,
          safety_json = @safety_json,
          updated_at = @updated_at
      WHERE id = @id
    `),
    getFollowupJob: db.prepare('SELECT * FROM followup_jobs WHERE id = ?'),
    getOpenFollowupJobByChat: db.prepare(`
      SELECT * FROM followup_jobs
      WHERE chat_id = ?
        AND state IN ('draft', 'ready', 'blocked')
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT 1
    `),
    listFollowupJobs: db.prepare(`
      SELECT * FROM followup_jobs
      ORDER BY datetime(updated_at) DESC, id DESC
      LIMIT @limit
    `),
    insertFollowupEvent: db.prepare(`
      INSERT INTO followup_events (job_id, customer_id, chat_id, event, message, metadata_json, created_at)
      VALUES (@job_id, @customer_id, @chat_id, @event, @message, @metadata_json, @created_at)
    `),
    getFollowupEvent: db.prepare('SELECT * FROM followup_events WHERE id = ?'),
    deleteMessages: db.prepare('DELETE FROM messages WHERE customer_id = ?'),
    deleteFacts: db.prepare('DELETE FROM customer_facts WHERE customer_id = ?'),
    deleteState: db.prepare('DELETE FROM dialog_states WHERE customer_id = ?'),
    deleteOrders: db.prepare('DELETE FROM orders WHERE customer_id = ?'),
    deleteFollowupJobs: db.prepare('DELETE FROM followup_jobs WHERE customer_id = ?'),
  };
}

function getFactMapByCustomerId(customerId, statements = null) {
  const rows = statements
    ? statements.getFactsByCustomerId.all(customerId)
    : [];
  return rows.reduce((acc, row) => {
    acc[row.key] = {
      value: row.value,
      confidence: row.confidence || '',
      source: row.source || '',
      updatedAt: row.updated_at || '',
    };
    return acc;
  }, {});
}

function mapStateRow(row) {
  return {
    stage: row.stage || '',
    aiMode: row.ai_mode || '',
    modeSource: row.mode_source || '',
    source: row.source || '',
    managerActiveAt: row.manager_active_at || '',
    managerLastMessageAt: row.manager_last_message_at || '',
    pendingSince: row.pending_since || '',
    autoTakeoverAt: row.auto_takeover_at || '',
    lastManagerTraceId: row.last_manager_trace_id || '',
    lastClientTraceId: row.last_client_trace_id || '',
    updatedAt: row.updated_at || '',
  };
}

function mapMessageRow(row) {
  return {
    id: row.id,
    chatId: '',
    userId: '',
    role: row.role,
    type: row.message_type || 'text',
    text: row.text || '',
    telegramMessageId: row.telegram_message_id || '',
    traceId: row.trace_id || '',
    createdAt: row.created_at || '',
  };
}

function mapOrderRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    product: row.product || '',
    size: row.size || '',
    price: row.price || '',
    fullName: row.full_name || '',
    phone: row.phone || '',
    deliveryAddress: row.delivery_address || '',
    status: row.status || '',
    paymentStatus: row.payment_status || '',
    paymentCheckStatus: row.payment_check_status || '',
    paymentCheckSummary: row.payment_check_summary || '',
    proofReceivedAt: row.proof_received_at || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function mapFollowupJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    chatId: row.chat_id || '',
    kind: row.kind || '',
    statusKey: row.status_key || '',
    statusLabel: row.status_label || '',
    mode: row.mode || '',
    state: row.state || '',
    draftText: row.draft_text || '',
    reason: row.reason || '',
    dueAt: row.due_at || '',
    sentAt: row.sent_at || '',
    skippedAt: row.skipped_at || '',
    canceledAt: row.canceled_at || '',
    attempts: row.attempts || 0,
    maxAttempts: row.max_attempts || 1,
    lastClientMessageAt: row.last_client_message_at || '',
    lastOutgoingMessageAt: row.last_outgoing_message_at || '',
    safety: parseJson(row.safety_json) || {},
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

function mapCustomerRow(row) {
  return {
    id: row.id,
    userId: row.telegram_user_id || '',
    chatId: row.telegram_chat_id || '',
    username: row.username || '',
    firstName: row.first_name || '',
    lastName: row.last_name || '',
    phone: row.phone || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
    lastSeenAt: row.last_seen_at || '',
  };
}

function buildProfileSummary(customer, facts, state, lastOrder, options = {}) {
  const lines = [];
  const name = facts.fullName?.value || [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim();
  const pairs = [
    ['Имя', name],
    ['Город', facts.city?.value],
    ['Размер обуви', facts.shoeSize?.value],
    ['Интерес клиента', facts.interest?.value],
    ['Последний товар', facts.lastProduct?.value],
  ];

  pairs.forEach(([label, value]) => {
    if (value) lines.push(`- ${label}: ${value}`);
  });

  if (lastOrder?.product) {
    lines.push(`- Последний заказ: ${[
      lastOrder.product,
      lastOrder.size && `размер ${lastOrder.size}`,
      lastOrder.price && `цена ${lastOrder.price}`,
    ].filter(Boolean).join(', ')}`);
  }

  if (lastOrder?.payment_check_summary) lines.push(`- Заметка по чеку: ${lastOrder.payment_check_summary}`);

  if (!lines.length) return '';
  return [
    'Память клиента:',
    ...lines,
  ].filter(Boolean).join('\n');
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

module.exports = {
  createCustomerStore,
};
