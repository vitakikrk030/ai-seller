// Set timezone globally BEFORE any other imports
process.env.TZ = 'Europe/Moscow';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const log = require('./logger');
const telegramRoutes = require('./telegram/routes');
const apiRoutes = require('./api/routes');
const scheduler = require('./scheduler');
const monitoring = require('./monitoring');
const { authMiddleware, login, verify, refresh, logout } = require('./api/auth');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// Secure headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json({ limit: '1mb' }));

// Request ID + logger middleware
app.use((req, res, next) => {
  req.id = crypto.randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  if (!isProd) {
    const safeUrl = req.url.replace(/token=[^&]+/g, 'token=***');
    log.debug(`${req.method} ${safeUrl}`, { reqId: req.id });
  }
  next();
});

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Too many login attempts, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Webhook health check (GET) — Telegram and browsers can verify endpoint exists
app.get('/api/telegram/webhook', (req, res) => {
  res.json({ ok: true, endpoint: 'telegram webhook active' });
});

// Public routes (no auth)
app.use('/api/telegram', telegramRoutes);
app.post('/api/auth/login', loginLimiter, login);
app.post('/api/auth/refresh', loginLimiter, refresh);

// Auth verify (protected but before general api middleware)
app.get('/api/auth/verify', authMiddleware, verify);
app.post('/api/auth/logout', authMiddleware, logout);

// Protected routes
app.use('/api', apiLimiter, authMiddleware, apiRoutes);

// Health / readiness checks
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ready', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', db: 'error' });
  }
});

// Global error handler — catches unhandled errors in routes
app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large' });
  }
  log.error('Unhandled route error', { reqId: req.id, error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

let server;

async function start() {
  await db.init();
  
  // Load DB settings (overrides .env)
  await config.loadDbSettings();

  // Block production start with default credentials
  if (isProd) {
    if (config.ADMIN_PASSWORD === 'admin123' || config.ADMIN_PASSWORD === 'your_secure_password_here') {
      log.error('FATAL: Default admin password detected! Set ADMIN_PASSWORD in .env before running in production.');
      process.exit(1);
    }
    if (config.JWT_SECRET === 'change_me_in_production') {
      log.error('FATAL: Default JWT_SECRET detected! Set JWT_SECRET in .env before running in production.');
      process.exit(1);
    }
  }

  server = app.listen(config.PORT, () => {
    log.info(`Server running on port ${config.PORT}`);
  });

  // Setup webhook
  const { setupWebhook } = require('./telegram/bot');
  await setupWebhook();

  // Start scheduler
  scheduler.start();

  // Start monitoring health checks
  monitoring.startPeriodicChecks();
}

start().catch(console.error);

// Graceful shutdown
function shutdown(signal) {
  log.info(`${signal} received — shutting down...`);
  monitoring.stopPeriodicChecks();
  if (server) server.close();
  db.pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  // Force kill after 10s
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { error: reason?.message || String(reason) });
});
