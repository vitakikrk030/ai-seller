const axios = require('axios');
const config = require('./config');
const db = require('./db');
const log = require('./logger');

// ──────────────────────────────────────────────
// Component states: OK | DEGRADED | DOWN | UNKNOWN
// Severity: critical | warning | info
// ──────────────────────────────────────────────

const STATUS = { OK: 'OK', DEGRADED: 'DEGRADED', DOWN: 'DOWN', UNKNOWN: 'UNKNOWN' };

// In-memory component registry
const _components = {};

// Incident log (ring-buffer, max 200)
const MAX_INCIDENTS = 200;
const _incidents = [];
let _incidentId = 0;

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
  c.status = STATUS.OK;
  c.severity = 'info';
  c.lastOk = new Date().toISOString();
  c.lastCheck = c.lastOk;
  c.message = '';
  c.latencyMs = latencyMs;
  // Auto-resolve open incidents for this component
  if (wasDown) {
    resolveIncidents(name);
  }
}

function setDegraded(name, message, severity = 'warning') {
  const c = _components[name];
  if (!c) return;
  c.status = STATUS.DEGRADED;
  c.severity = severity;
  c.lastCheck = new Date().toISOString();
  c.message = message;
}

function setDown(name, message) {
  const c = _components[name];
  if (!c) return;
  const wasOk = c.status !== STATUS.DOWN;
  c.status = STATUS.DOWN;
  c.severity = 'critical';
  c.lastError = new Date().toISOString();
  c.lastCheck = c.lastError;
  c.message = message;
  if (wasOk) {
    addIncident(name, message, 'critical');
    notifyCritical(name, message);
  }
}

// ──────────────────────────────────────────────
// Incidents
// ──────────────────────────────────────────────

function addIncident(source, message, severity = 'warning') {
  const incident = {
    id: ++_incidentId,
    time: new Date().toISOString(),
    source,
    message,
    severity,
    resolved: false,
    resolvedAt: null,
  };
  _incidents.unshift(incident);
  if (_incidents.length > MAX_INCIDENTS) _incidents.length = MAX_INCIDENTS;
  return incident;
}

function resolveIncidents(source) {
  const now = new Date().toISOString();
  for (const inc of _incidents) {
    if (inc.source === source && !inc.resolved) {
      inc.resolved = true;
      inc.resolvedAt = now;
    }
  }
}

// ──────────────────────────────────────────────
// Critical notification (logs + owner Telegram)
// ──────────────────────────────────────────────

async function notifyCritical(name, message) {
  const label = _components[name]?.label || name;
  log.error(`CRITICAL: ${label} is DOWN — ${message}`);
  try {
    const bot = require('./telegram/bot');
    const ownerChatId = config.get('OWNER_CHAT_ID');
    if (ownerChatId) {
      await bot.sendMessage(ownerChatId, `[ALERT] ${label}: DOWN\n${message}`);
    }
  } catch (e) {
    // notification failure should never break monitoring
  }
}

// ──────────────────────────────────────────────
// Health check probes
// ──────────────────────────────────────────────

async function checkDatabase() {
  const name = 'database';
  initComponent(name, { label: 'PostgreSQL', critical: true });
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    setOk(name, Date.now() - start);
  } catch (err) {
    setDown(name, err.message);
  }
}

async function checkTelegram() {
  const name = 'telegram';
  initComponent(name, { label: 'Telegram Bot API', critical: true });
  const token = config.get('BOT_TOKEN');
  if (!token) {
    setDegraded(name, 'BOT_TOKEN not configured');
    return;
  }
  const start = Date.now();
  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 });
    if (res.data?.ok) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, 'getMe returned ok=false');
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      setDown(name, 'Invalid BOT_TOKEN (401)');
    } else {
      setDown(name, err.message);
    }
  }
}

async function checkOpenRouter() {
  const name = 'ai';
  initComponent(name, { label: 'OpenRouter AI', critical: true });
  const key = config.get('OPENROUTER_API_KEY');
  if (!key) {
    setDegraded(name, 'API key not configured');
    return;
  }
  const start = Date.now();
  try {
    // Use models endpoint — lightweight, no credits consumed
    const res = await axios.get('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
    });
    if (res.data?.data) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, 'Unexpected response from /models');
    }
  } catch (err) {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      setDown(name, 'Invalid API key');
    } else if (status === 429) {
      setDegraded(name, 'Rate limited (429)', 'warning');
    } else {
      setDown(name, err.message);
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
    // GET to webhook URL should return the health-check response from our server
    const res = await axios.get(webhookUrl, { timeout: 10000 });
    if (res.status === 200) {
      setOk(name, Date.now() - start);
    } else {
      setDegraded(name, `HTTP ${res.status}`);
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
    const status = shop.getStatus();
    if (status === 'ok') {
      setOk(name, Date.now() - start);
    } else if (status === 'empty_catalog') {
      setDegraded(name, 'Catalog empty');
    } else if (status === 'not_configured') {
      setDegraded(name, 'Not configured');
    } else {
      setDegraded(name, `API issue (${status})`, 'warning');
      addIncident(name, `Shop API returned status: ${status}`, 'warning');
    }
  } catch (err) {
    setDegraded(name, err.message, 'warning');
  }
}

async function checkScheduler() {
  const name = 'scheduler';
  initComponent(name, { label: 'Background Tasks', critical: false });
  // Scheduler runs node-cron — mark ok if running. Track via heartbeat.
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

let _schedulerHeartbeat = null;

function schedulerHeartbeat() {
  _schedulerHeartbeat = Date.now();
  initComponent('scheduler', { label: 'Background Tasks', critical: false });
  setOk('scheduler');
}

// ──────────────────────────────────────────────
// Run all checks
// ──────────────────────────────────────────────

async function runAllChecks() {
  await Promise.allSettled([
    checkDatabase(),
    checkTelegram(),
    checkOpenRouter(),
    checkWebhook(),
    checkShop(),
    checkScheduler(),
  ]);
}

// Periodic check (every 60s)
let _intervalId = null;

function startPeriodicChecks() {
  // Initialize all components immediately
  initComponent('database', { label: 'PostgreSQL', critical: true });
  initComponent('telegram', { label: 'Telegram Bot API', critical: true });
  initComponent('ai', { label: 'OpenRouter AI', critical: true });
  initComponent('webhook', { label: 'Webhook Endpoint', critical: true });
  initComponent('shop', { label: 'Shop API', critical: false });
  initComponent('scheduler', { label: 'Background Tasks', critical: false });

  // Run first check immediately
  runAllChecks().catch(() => {});

  // Then every 60s
  _intervalId = setInterval(() => {
    runAllChecks().catch(() => {});
  }, 60000);
  if (_intervalId.unref) _intervalId.unref();
}

function stopPeriodicChecks() {
  if (_intervalId) clearInterval(_intervalId);
}

// ──────────────────────────────────────────────
// Public API for recording events from other modules
// ──────────────────────────────────────────────

function recordSuccess(componentName, latencyMs = null) {
  initComponent(componentName);
  setOk(componentName, latencyMs);
}

function recordError(componentName, message, severity = 'critical') {
  initComponent(componentName);
  if (severity === 'critical') {
    setDown(componentName, message);
  } else {
    setDegraded(componentName, message, severity);
    addIncident(componentName, message, severity);
  }
}

// ──────────────────────────────────────────────
// Getters
// ──────────────────────────────────────────────

function getStatus() {
  return Object.values(_components).map((c) => ({
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
  }));
}

function getIncidents(limit = 50) {
  return _incidents.slice(0, limit);
}

function getOverview() {
  const components = getStatus();
  const down = components.filter((c) => c.status === STATUS.DOWN);
  const degraded = components.filter((c) => c.status === STATUS.DEGRADED);
  const ok = components.filter((c) => c.status === STATUS.OK);

  let overall = STATUS.OK;
  if (degraded.length > 0) overall = STATUS.DEGRADED;
  if (down.some((c) => c.critical)) overall = STATUS.DOWN;
  else if (down.length > 0) overall = STATUS.DEGRADED;

  return {
    overall,
    components,
    incidents: getIncidents(30),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  startPeriodicChecks,
  stopPeriodicChecks,
  runAllChecks,
  schedulerHeartbeat,
  recordSuccess,
  recordError,
  addIncident,
  getStatus: getOverview,
  getIncidents,
  STATUS,
};
