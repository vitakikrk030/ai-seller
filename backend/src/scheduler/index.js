const { retryFailedDeliveries } = require('../telegram/outbox');
const log = require('../logger');

const RETRY_INTERVAL_MS = 15000;
const RETRY_BATCH_SIZE = 25;
const MAX_RETRIES = 4;

let retryTimer = null;
let retryInFlight = false;

async function runRetryTick() {
  if (retryInFlight) return;
  retryInFlight = true;
  try {
    let broadcast = null;
    try {
      const routes = require('../api/routes');
      broadcast = routes.broadcastSSE || null;
    } catch {}
    const result = await retryFailedDeliveries({
      limit: RETRY_BATCH_SIZE,
      maxRetries: MAX_RETRIES,
      broadcast,
    });
    if (result.scanned > 0) {
      log.info('scheduler.deliveryRetry: tick completed', result);
    }
  } catch (err) {
    log.error('scheduler.deliveryRetry: tick failed', { error: err.message });
  } finally {
    retryInFlight = false;
  }
}

function start() {
  if (retryTimer) return;
  retryTimer = setInterval(runRetryTick, RETRY_INTERVAL_MS);
  if (retryTimer.unref) retryTimer.unref();
  runRetryTick().catch(() => {});
  log.info('Scheduler started (delivery retry worker)');
}

function stop() {
  if (!retryTimer) return;
  clearInterval(retryTimer);
  retryTimer = null;
}

module.exports = {
  start,
  stop,
};
