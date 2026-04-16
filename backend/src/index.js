const express = require('express');
const config = require('./config');
const db = require('./db');
const telegramRoutes = require('./telegram/routes');
const apiRoutes = require('./api/routes');

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api/telegram', telegramRoutes);
app.use('/api', apiRoutes);
app.get('/health', (req, res) => res.json({ status: 'ok' }));

let server;

async function start() {
  await db.init();
  server = app.listen(config.PORT, () => {
    console.log(`Server running on port ${config.PORT}`);
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`${signal} received — shutting down...`);
  if (server) server.close();
  db.pool.end().then(() => process.exit(0)).catch(() => process.exit(1));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
