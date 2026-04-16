const axios = require('axios');
const config = require('./config');
const db = require('./db');
const log = require('./logger');
const fs = require('fs');
const path = require('path');
const { moscowISO } = require('./utils/time');

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const STATUS = { OK: 'OK', DEGRADED: 'DEGRADED', DOWN: 'DOWN', UNKNOWN: 'UNKNOWN' };
const MAX_INCIDENTS_DB = 500;
const MAX_INCIDENTS_CACHE = 100;
const MAX_HISTORY_ROWS = 10000;
const CHECK_INTERVAL_MS = 60000;
const HEALTH_CHECK_TIMEOUT = 10000;
const CLEANUP_INTERVAL_MS = 3600000;
const NOTIFY_DEBOUNCE_MS = 5 * 60 * 1000;

// SLA thresholds (ms) — DEGRADED if exceeded
const SLA = {
  ai: 15000,
  database: 2000,
  webhook: 5000,
  telegram: 5000,
  shop: 10000,
};

// Silent failure: no activity threshold (ms)
const ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min no messages → warning

// ──────────────────────────────────────────────
// In-memory cache (fast reads)
// ──────────────────────────────────────────────

const _components = {};
const _incidents = [];
let _incidentId = 0;
let _schedulerHeartbeat = null;
let _loaded = false;

// Anti-spam: last notification time per component
const _lastNotified = {};

// Timers
let _intervalId = null;
let _cleanupId = null;

// Activity tracking for silent failure detection
let _lastMessageTime = Date.now();
let _lastAiResponseTime = Date.now();

// Business metrics (in-memory counters)
const _metrics = {
  aiRequests: 0,
  aiErrors: 0,
  aiTotalLatency: 0,
  telegramSent: 0,
  telegramErrors: 0,
};

// ──────────────────────────────────────────────
// Write queue with retry (anti-loss)
// ──────────────────────────────────────────────

const _writeQueue = [];
const MAX_QUEUE = 500;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
let _flushing = false;

function enqueue(sql, params) {
  _writeQueue.push({ sql, params, attempts: 0 });
  if (_writeQueue.length > MAX_QUEUE) _writeQueue.shift();
  flushQueue();
}

async function flushQueue() {
  if (_flushing || _writeQueue.length === 0) return;
  _flushing = true;
  try {
    while (_writeQueue.length > 0) {
      const item = _writeQueue[0];
      try {
        await db.query(item.sql, item.params);
        _writeQueue.shift();
      } catch (e) {
        item.attempts++;
        if (item.attempts >= RETRY_ATTEMPTS) {
          _writeQueue.shift();
          fallbackLog('WRITE_FAILED', { sql: item.sql.slice(0, 80), error: e.message });
        } else {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
  } finally {
    _flushing = false;
  }
}

// Fallback: write to file when DB is completely down
const FALLBACK_LOG_PATH = path.join(__dirname, '..', 'monitoring-fallback.log');

function fallbackLog(type, data) {
  const line = JSON.stringify({ ts: moscowISO(), type, ...data }) + '\n';
  try {
    fs.appendFileSync(FALLBACK_LOG_PATH, line);
  } catch (e) {
    log.error('fallback log write failed: ' + e.message);
  }
  log.error('MONITORING FALLBACK [' + type + ']: ' + JSON.stringify(data).slice(0, 200));
}

// ──────────────────────────────────────────────
// DB persistence (via write queue)
// ──────────────────────────────────────────────

function persistComponent(name) {
  const c = _components[name];
  if (!c) return;
  enqueue(
    `INSERT INTO monitoring_components (name, label, status, severity, last_ok, last_error, last_check, message, latency_ms, critical, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (name) DO UPDATE SET
       label=EXCLUDED.label, status=EXCLUDED.status, severity=EXCLUDED.severity,
       last_ok=EXCLUDED.last_ok, last_error=EXCLUDED.last_error, last_check=EXCLUDED.last_check,
       message=EXCLUDED.message, latency_ms=EXCLUDED.latency_ms, critical=EXCLUDED.critical, updated_at=NOW()`,
    [c.name, c.label, c.status, c.severity, c.lastOk, c.lastError, c.lastCheck, c.message, c.latencyMs, c.critical]
  );
}

function persistIncident(incident) {
  enqueue(
    `INSERT INTO monitoring_incidents (source, message, severity, resolved, resolved_at, notified, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [incident.source, incident.message, incident.severity, incident.resolved, incident.resolvedAt, incident.notified || false, incident.time]
  );
}

function persistResolveIncidents(source) {
  const now = moscowISO();
  enqueue(
    `UPDATE monitoring_incidents SET resolved=true, resolved_at=$1 WHERE source=$2 AND resolved=false`,
    [now, source]
  );
}

function recordHistory() {
  const entries = Object.values(_components).filter(c => c.status !== STATUS.UNKNOWN);
  if (entries.length === 0) return;
  const values = entries.map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`).join(',');
  const params = entries.flatMap(c => [c.name, c.status, c.latencyMs]);
  enqueue(
    `INSERT INTO monitoring_history (component, status, latency_ms) VALUES ${values}`,
    params
  );
}

async function cleanup() {
  try {
    await db.query(
      `DELETE FROM monitoring_incidents WHERE id NOT IN (SELECT id FROM monitoring_incidents ORDER BY created_at DESC LIMIT $1)`,
      [MAX_INCIDENTS_DB]
    );
    await db.query(
      `DELETE FROM monitoring_history WHERE id NOT IN (SELECT id FROM monitoring_history ORDER BY recorded_at DESC LIMIT $1)`,
      [MAX_HISTORY_ROWS]
    );
  } catch (e) {
    log.error('monitoring cleanup: ' + e.message);
  }
}

// ──────────────────────────────────────────────
// Load state from DB on startup
// ──────────────────────────────────────────────

async function loadFromDB() {
  if (_loaded) return;
  try {
    const compRes = await db.query('SELECT * FROM monitoring_components');
    for (const row of compRes.rows) {
      _components[row.name] = {
        name: row.name,
        label: row.label,
        status: row.status,
        severity: row.severity,
        lastOk: row.last_ok ? moscowISO(row.last_ok) : null,
        lastError: row.last_error ? moscowISO(row.last_error) : null,
        lastCheck: row.last_check ? moscowISO(row.last_check) : null,
        message: row.message || '',
        latencyMs: row.latency_ms,
        critical: row.critical,
      };
    }
    const incRes = await db.query(
      'SELECT * FROM monitoring_incidents ORDER BY created_at DESC LIMIT $1',
      [MAX_INCIDENTS_CACHE]
    );
    _incidents.length = 0;
    for (const row of incRes.rows) {
      _incidents.push({
        id: row.id,
        time: moscowISO(row.created_at),
        source: row.source,
        message: row.message,
        severity: row.severity,
        resolved: row.resolved,
        resolvedAt: row.resolved_at ? moscowISO(row.resolved_at) : null,
      });
    }
    if (_incidents.length > 0) {
      _incidentId = Math.max(..._incidents.map(i => i.id));
    }
    _loaded = true;
    log.info('Monitoring: restored ' + compRes.rows.length + ' components, ' + incRes.rows.length + ' incidents');
  } catch (e) {
    log.warn('Monitoring: DB load skipped: ' + e.message);
    _loaded = true;
  }
}

// ──────────────────────────────────────────────
// Component helpers
// ──────────────────────────────────────────────

function initComponent(name, opts = {}) {
  if (!_components[name]) {
    _components[name] = {
      name,
      label: opts.label || name,
      status: STATUS.UNKNOWN,
      severity: 'info',
      lastOk: null,
      lastError: null,
      lastCheck: null,
      message: '',
      latencyMs: null,
      critical: opts.critical !== false,
    };
  }
  return _components[name];
}

function setOk(name, latencyMs = null) {
  const c = _components[name];
  if (!c) return;
  const wasDown = c.status === STATUS.DOWN || c.status === STATUS.DEGRADED;

  // SLA check: if latency exceeds threshold -> DEGRADED
  if (latencyMs != null && SLA[name] && latencyMs > SLA[name]) {
    c.status = STATUS.DEGRADED;
    c.severity = 'warning';
    c.lastOk = moscowISO();
    c.lastCheck = c.lastOk;
    c.message = 'SLA breach: ' + latencyMs + 'ms > ' + SLA[name] + 'ms';
    c.latencyMs = latencyMs;
    if (wasDown) resolveIncidents(name);
    persistComponent(name);
    return;
  }

  c.status = STATUS.OK;
  c.severity = 'info';
  c.lastOk = moscowISO();
  c.lastCheck = c.lastOk;
  c.message = '';
  c.latencyMs = latencyMs;
  if (wasDown) resolveIncidents(name);
  persistComponent(name);
}

function setDegraded(name, message, severity = 'warning') {
  const c = _components[name];
  if (!c) return;
  c.status = STATUS.DEGRADED;
  c.severity = severity;
  c.lastCheck = moscowISO();
  c.message = message;
  persistComponent(name);
}

function setDown(name, message) {
  const c = _components[name];
  if (!c) return;
  const wasOk = c.status !== STATUS.DOWN;
  c.status = STATUS.DOWN;
  c.severity = 'critical';
  c.lastError = moscowISO();
  c.lastCheck = c.lastError;
  c.message = message;
  if (wasOk) {
    addIncident(name, message, 'critical');
    notifyCritical(name, message);
  }
  persistComponent(name);
}

// ──────────────────────────────────────────────
// Incidents
// ──────────────────────────────────────────────

function addIncident(source, message, severity = 'warning') {
  const incident = {
    id: ++_incidentId,
    time: moscowISO(),
    source,
    message,
    severity,
    resolved: false,
    resolvedAt: null,
    notified: false,
  };
  _incidents.unshift(incident);
  if (_incidents.length > MAX_INCIDENTS_CACHE) _incidents.length = MAX_INCIDENTS_CACHE;
  persistIncident(incident);
  return incident;
}

function resolveIncidents(source) {
  const now = moscowISO();
  for (const inc of _incidents) {
    if (inc.source === source && !inc.resolved) {
      inc.resolved = true;
      inc.resolvedAt = now;
    }
  }
  persistResolveIncidents(source);
}

// ──────────────────────────────────────────────
// Critical notification with anti-spam + failsafe
// ──────────────────────────────────────────────

async function notifyCritical(name, message) {
  const now = Date.now();
  if (_lastNotified[name] && (now - _lastNotified[name] < NOTIFY_DEBOUNCE_MS)) {
    return;
  }
  _lastNotified[name] = now;

  const label = _components[name]?.label || name;
  log.error('CRITICAL: ' + label + ' is DOWN — ' + message);

  let delivered = false;

  // Primary channel: Telegram
  try {
    const bot = require('./telegram/bot');
    const ownerChatId = config.get('OWNER_CHAT_ID');
    if (ownerChatId) {
      await bot.sendMessage(ownerChatId, '[ALERT] ' + label + ': DOWN\n' + message);
      delivered = true;
    }
  } catch (e) {
    log.error('Alert primary (Telegram) failed: ' + e.message);
  }

  // Failsafe channel: file log + console (always)
  if (!delivered) {
    fallbackLog('CRITICAL_ALERT', { component: name, label, message });
  }

  // Mark incident as notified
  const inc = _incidents.find(i => i.source === name && !i.resolved);
  if (inc) inc.notified = true;
}

// ──────────────────────────────────────────────
// Health check probes (with SLA)
// ──────────────────────────────────────────────

async function checkDatabase() {
  const name = 'database';
  initComponent(name, { label: 'PostgreSQL', critical: true });
  const start = Date.now();
  try {
    await db.query('SELECT NOW()');
    const latency = Date.now() - start;
    const pool = db.pool;
    if (pool && pool.totalCount > 0 && pool.idleCount === 0 && pool.waitingCount > 0) {
      setDegraded(name, 'Pool exhausted (waiting: ' + pool.waitingCount + ')', 'warning');
    } else {
      setOk(name, latency);
    }
  } catch (err) {
    setDown(name, err.message);
  }
}

async function checkTelegram() {
  const name = 'telegram';
  initComponent(name, { label: 'Telegram Bot API', critical: true });
  let token = '';
  try {
    const settings = require('./db/settings');
    token = (await settings.get('bot_token') || '').trim();
  } catch (e) {
    token = (config.get('BOT_TOKEN') || '').trim();
  }
  if (!token) {
    setDegraded(name, 'BOT_TOKEN not configured');
    return;
  }
  const start = Date.now();
  try {
    const res = await axios.get('https://api.telegram.org/bot' + token + '/getMe', { timeout: HEALTH_CHECK_TIMEOUT });
    if (res.data && res.data.ok) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, 'getMe returned ok=false');
    }
  } catch (err) {
    const status = err.response && err.response.status;
    // Auth errors are critical, transport/provider hiccups are degraded.
    if (status === 401 || status === 403) {
      setDown(name, 'Invalid BOT_TOKEN (' + status + ')');
    } else if (status === 429 || (status >= 500 && status < 600)) {
      setDegraded(name, 'Telegram API temporary error (' + status + ')');
    } else {
      const code = err.code || '';
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
        setDegraded(name, 'Telegram API network timeout/error: ' + code);
      } else {
        setDegraded(name, err.message || 'Telegram check failed');
      }
    }
  }
}

async function checkAI() {
  const name = 'ai';
  initComponent(name, { label: 'AI Provider', critical: true });
  const { getAIConfig } = require('./ai/client');
  const cfg = getAIConfig();
  const key = cfg.apiKey;
  if (!key) {
    setDegraded(name, 'API key not configured');
    return;
  }
  const start = Date.now();
  try {
    const baseUrl = (cfg.baseUrl || '').replace(/\/$/, '');
    const res = await axios.get(baseUrl + '/models', {
      headers: { Authorization: 'Bearer ' + key },
      timeout: HEALTH_CHECK_TIMEOUT,
    });
    if (res.data && res.data.data) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, 'Unexpected response from /models');
    }
  } catch (err) {
    const status = err.response && err.response.status;
    if (status === 401 || status === 403) {
      setDown(name, 'Invalid API key');
    } else if (status === 429) {
      setDegraded(name, 'Rate limited (429)', 'warning');
    } else if (status >= 500 && status < 600) {
      setDegraded(name, 'Provider temporary error (' + status + ')', 'warning');
    } else {
      const code = err.code || '';
      if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
        setDegraded(name, 'AI provider network timeout/error: ' + code, 'warning');
      } else {
        setDegraded(name, err.message, 'warning');
      }
    }
  }
}

async function checkWebhook() {
  const name = 'webhook';
  initComponent(name, { label: 'Webhook Endpoint', critical: true });
  const webhookUrl = config.get('WEBHOOK_URL');
  if (!webhookUrl) {
    setDegraded(name, 'WEBHOOK_URL not configured');
    return;
  }
  const start = Date.now();
  try {
    const res = await axios.get(webhookUrl, { timeout: HEALTH_CHECK_TIMEOUT });
    if (res.status === 200) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, 'HTTP ' + res.status);
    }
  } catch (err) {
    setDown(name, err.message);
  }
}

async function checkShop() {
  const name = 'shop';
  initComponent(name, { label: 'Shop API', critical: false });
  try {
    const shop = require('./shop');
    if (!shop.isConfigured()) {
      setDegraded(name, 'Not configured');
      return;
    }
    const start = Date.now();
    await shop.getProducts(true);
    const shopStatus = shop.getStatus();
    if (shopStatus === 'ok') {
      setOk(name, Date.now() - start);
    } else if (shopStatus === 'empty_catalog') {
      setDegraded(name, 'Catalog empty');
    } else if (shopStatus === 'not_configured') {
      setDegraded(name, 'Not configured');
    } else {
      setDegraded(name, 'API issue (' + shopStatus + ')', 'warning');
      addIncident(name, 'Shop API returned status: ' + shopStatus, 'warning');
    }
  } catch (err) {
    setDegraded(name, err.message, 'warning');
  }
}

async function checkScheduler() {
  const name = 'scheduler';
  initComponent(name, { label: 'Background Tasks', critical: false });
  if (_schedulerHeartbeat && (Date.now() - _schedulerHeartbeat < 15 * 60 * 1000)) {
    setOk(name);
  } else if (_schedulerHeartbeat) {
    setDegraded(name, 'Last heartbeat > 15 min ago');
  } else {
    initComponent(name, { label: 'Background Tasks', critical: false });
    _components[name].status = STATUS.UNKNOWN;
    _components[name].message = 'Waiting for first heartbeat';
  }
}

// Silent failure detection
function checkActivity() {
  const now = Date.now();
  const name = 'activity';
  initComponent(name, { label: 'Message Activity', critical: false });

  const sinceMsg = now - _lastMessageTime;
  if (sinceMsg > ACTIVITY_TIMEOUT_MS) {
    setDegraded(name, 'No messages for ' + Math.floor(sinceMsg / 60000) + ' min');
  } else {
    setOk(name);
  }
}

function schedulerHeartbeat() {
  _schedulerHeartbeat = Date.now();
  initComponent('scheduler', { label: 'Background Tasks', critical: false });
  setOk('scheduler');
}

// ──────────────────────────────────────────────
// Run all checks + record history
// ──────────────────────────────────────────────

async function runAllChecks() {
  await Promise.allSettled([
    checkDatabase(),
    checkTelegram(),
    checkAI(),
    checkWebhook(),
    checkShop(),
    checkScheduler(),
  ]);
  checkActivity();
  recordHistory();
}

// ──────────────────────────────────────────────
// Periodic checks with cleanup
// ──────────────────────────────────────────────

async function startPeriodicChecks() {
  await loadFromDB();

  initComponent('database', { label: 'PostgreSQL', critical: true });
  initComponent('telegram', { label: 'Telegram Bot API', critical: true });
  initComponent('ai', { label: 'AI Provider', critical: true });
  initComponent('webhook', { label: 'Webhook Endpoint', critical: true });
  initComponent('shop', { label: 'Shop API', critical: false });
  initComponent('scheduler', { label: 'Background Tasks', critical: false });
  initComponent('activity', { label: 'Message Activity', critical: false });

  runAllChecks().catch(function() {});

  _intervalId = setInterval(function() {
    runAllChecks().catch(function() {});
  }, CHECK_INTERVAL_MS);
  if (_intervalId.unref) _intervalId.unref();

  _cleanupId = setInterval(function() {
    cleanup().catch(function() {});
  }, CLEANUP_INTERVAL_MS);
  if (_cleanupId.unref) _cleanupId.unref();
}

function stopPeriodicChecks() {
  if (_intervalId) clearInterval(_intervalId);
  if (_cleanupId) clearInterval(_cleanupId);
}

// ──────────────────────────────────────────────
// Public API for recording events from other modules
// ──────────────────────────────────────────────

function recordSuccess(componentName, latencyMs) {
  if (latencyMs === undefined) latencyMs = null;
  initComponent(componentName);
  setOk(componentName, latencyMs);
  if (componentName === 'ai') {
    _metrics.aiRequests++;
    if (latencyMs != null) _metrics.aiTotalLatency += latencyMs;
  }
  if (componentName === 'telegram') _metrics.telegramSent++;
}

function recordError(componentName, message, severity) {
  if (!severity) severity = 'critical';
  initComponent(componentName);
  if (severity === 'critical') {
    setDown(componentName, message);
  } else {
    setDegraded(componentName, message, severity);
    addIncident(componentName, message, severity);
  }
  if (componentName === 'ai') {
    _metrics.aiRequests++;
    _metrics.aiErrors++;
  }
  if (componentName === 'telegram') {
    _metrics.telegramSent++;
    _metrics.telegramErrors++;
  }
}

// Activity markers: called from handler
function recordMessageActivity() {
  _lastMessageTime = Date.now();
}

function recordAiActivity() {
  _lastAiResponseTime = Date.now();
}

// ──────────────────────────────────────────────
// Getters
// ──────────────────────────────────────────────

function getStatus() {
  return Object.values(_components).map(function(c) {
    return {
      name: c.name,
      label: c.label,
      status: c.status,
      severity: c.severity,
      lastOk: c.lastOk,
      lastError: c.lastError,
      lastCheck: c.lastCheck,
      message: c.message,
      latencyMs: c.latencyMs,
      critical: c.critical,
    };
  });
}

function getIncidents(limit) {
  if (!limit) limit = 50;
  return _incidents.slice(0, limit);
}

function getOverview() {
  const components = getStatus();
  const down = components.filter(function(c) { return c.status === STATUS.DOWN; });
  const degraded = components.filter(function(c) { return c.status === STATUS.DEGRADED; });

  let overall = STATUS.OK;
  if (degraded.length > 0) overall = STATUS.DEGRADED;
  if (down.some(function(c) { return c.critical; })) overall = STATUS.DOWN;
  else if (down.length > 0) overall = STATUS.DEGRADED;

  return {
    overall: overall,
    components: components,
    incidents: getIncidents(30),
    checkedAt: moscowISO(),
  };
}

// ──────────────────────────────────────────────
// Business metrics
// ──────────────────────────────────────────────

async function getBusinessMetrics() {
  try {
    const results = await Promise.all([
      db.query("SELECT COUNT(DISTINCT user_id) as cnt FROM messages WHERE role = 'user'"),
      db.query('SELECT COUNT(*) as cnt FROM orders'),
      db.query("SELECT COALESCE(SUM(price), 0) as total FROM orders WHERE paid_at IS NOT NULL"),
      db.query("SELECT COUNT(DISTINCT user_id) as cnt FROM messages WHERE role = 'user' AND created_at > NOW() - INTERVAL '24 hours'"),
      db.query("SELECT COUNT(*) as cnt FROM orders WHERE created_at > NOW() - INTERVAL '24 hours'"),
      db.query("SELECT AVG(latency_ms) as avg_ms FROM monitoring_history WHERE component = 'ai' AND latency_ms IS NOT NULL AND recorded_at > NOW() - INTERVAL '24 hours'"),
      db.query("SELECT COUNT(*) as cnt FROM users WHERE last_seen < NOW() - INTERVAL '48 hours' AND state NOT IN ('DONE', 'PAID')"),
      // aiErrorRate from DB — survives restarts
      db.query("SELECT COUNT(*) as errors FROM ai_errors WHERE created_at > NOW() - INTERVAL '24 hours'"),
      db.query("SELECT COUNT(*) as total FROM messages WHERE role = 'ai' AND created_at > NOW() - INTERVAL '24 hours'"),
    ]);

    var dialogs = parseInt(results[0].rows[0].cnt);
    var orders = parseInt(results[1].rows[0].cnt);
    var revenue = parseFloat(results[2].rows[0].total) || 0;
    var todayDialogs = parseInt(results[3].rows[0].cnt);
    var todayOrders = parseInt(results[4].rows[0].cnt);
    var avgAiLatency = Math.round(parseFloat(results[5].rows[0].avg_ms) || 0);
    var lostClients = parseInt(results[6].rows[0].cnt);
    var aiErrorsDb = parseInt(results[7].rows[0].errors) || 0;
    var aiTotalDb = parseInt(results[8].rows[0].total) || 0;

    var conversion = dialogs > 0 ? ((orders / dialogs) * 100).toFixed(1) : '0.0';
    var todayConversion = todayDialogs > 0 ? ((todayOrders / todayDialogs) * 100).toFixed(1) : '0.0';
    // aiErrorRate from DB (persistent across restarts)
    var aiErrorRate = aiTotalDb > 0 ? ((aiErrorsDb / aiTotalDb) * 100).toFixed(1) : '0.0';

    return {
      dialogs: dialogs,
      orders: orders,
      revenue: revenue,
      conversion: parseFloat(conversion),
      todayDialogs: todayDialogs,
      todayOrders: todayOrders,
      todayConversion: parseFloat(todayConversion),
      avgAiLatency: avgAiLatency,
      aiErrorRate: parseFloat(aiErrorRate),
      lostClients: lostClients,
      telegramSent: _metrics.telegramSent,
      telegramErrors: _metrics.telegramErrors,
    };
  } catch (e) {
    log.error('business metrics: ' + e.message);
    return null;
  }
}

// ──────────────────────────────────────────────
// History & analytics queries (DB-backed)
// ──────────────────────────────────────────────

async function getHistory(component, hours) {
  if (!hours) hours = 24;
  try {
    const res = await db.query(
      "SELECT component, status, latency_ms, recorded_at FROM monitoring_history WHERE ($1::text IS NULL OR component = $1) AND recorded_at > NOW() - INTERVAL '1 hour' * $2 ORDER BY recorded_at DESC LIMIT 1000",
      [component || null, hours]
    );
    return res.rows.map(function(r) {
      return {
        component: r.component,
        status: r.status,
        latencyMs: r.latency_ms,
        time: moscowISO(r.recorded_at),
      };
    });
  } catch (e) {
    return [];
  }
}

async function queryIncidents(opts) {
  if (!opts) opts = {};
  var resolved = opts.resolved;
  var source = opts.source;
  var limit = opts.limit || 50;
  try {
    var conditions = [];
    var params = [];
    var idx = 1;
    if (typeof resolved === 'boolean') {
      conditions.push('resolved = $' + idx++);
      params.push(resolved);
    }
    if (source) {
      conditions.push('source = $' + idx++);
      params.push(source);
    }
    var where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    params.push(Math.min(limit, 200));
    const res = await db.query(
      'SELECT * FROM monitoring_incidents ' + where + ' ORDER BY created_at DESC LIMIT $' + idx,
      params
    );
    return res.rows.map(function(r) {
      return {
        id: r.id,
        time: moscowISO(r.created_at),
        source: r.source,
        message: r.message,
        severity: r.severity,
        resolved: r.resolved,
        resolvedAt: r.resolved_at ? moscowISO(r.resolved_at) : null,
      };
    });
  } catch (e) {
    return _incidents.slice(0, limit);
  }
}

// ──────────────────────────────────────────────
// Queue stats (for testing)
// ──────────────────────────────────────────────

function getQueueLength() {
  return _writeQueue.length;
}

module.exports = {
  startPeriodicChecks: startPeriodicChecks,
  stopPeriodicChecks: stopPeriodicChecks,
  runAllChecks: runAllChecks,
  schedulerHeartbeat: schedulerHeartbeat,
  recordSuccess: recordSuccess,
  recordError: recordError,
  recordMessageActivity: recordMessageActivity,
  recordAiActivity: recordAiActivity,
  addIncident: addIncident,
  getStatus: getOverview,
  getIncidents: getIncidents,
  getHistory: getHistory,
  queryIncidents: queryIncidents,
  getBusinessMetrics: getBusinessMetrics,
  getQueueLength: getQueueLength,
  SLA: SLA,
  STATUS: STATUS,
};
