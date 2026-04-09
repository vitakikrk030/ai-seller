const express = require('express');
const cors = require('cors');
const config = require('./config');
const db = require('./db');
const telegramRoutes = require('./telegram/routes');
const apiRoutes = require('./api/routes');
const scheduler = require('./scheduler');
const { authMiddleware, login, verify } = require('./api/auth');

const app = express();

app.use(cors({ origin: config.FRONTEND_URL }));
app.use(express.json());

// Public routes (no auth)
app.use('/api/telegram', telegramRoutes);
app.post('/api/auth/login', login);

// Auth verify (protected but before general api middleware)
app.get('/api/auth/verify', authMiddleware, verify);

// Protected routes
app.use('/api', authMiddleware, apiRoutes);

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

async function start() {
  await db.init();
  
  // Load DB settings (overrides .env)
  await config.loadDbSettings();

  app.listen(config.PORT, () => {
    console.log(`Server running on port ${config.PORT}`);
  });

  // Setup webhook
  const { setupWebhook } = require('./telegram/bot');
  await setupWebhook();

  // Start scheduler
  scheduler.start();
}

start().catch(console.error);
