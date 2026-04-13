/**
 * Message Queue — in-process priority queue with per-chat locks.
 *
 * Design:
 *   Telegram → webhook → queue.enqueue(chatId, task)
 *   Workers pick highest-priority task where chat is NOT locked.
 *   Only 1 task per chatId runs at a time (serialization).
 *   Manager messages cancel pending AI tasks for that chat.
 *
 * Priority (lower number = higher priority):
 *   0  manager override / cancel
 *   1  WAITING_PAYMENT
 *   2  WAITING_FORM
 *   3  WAITING_SIZE / hot clients
 *   4  NEW / other
 *   5  DONE / cold
 */

const log = require('./logger');

// ── State priority map ──
const STATE_PRIORITY = {
  WAITING_PAYMENT: 1,
  WAITING_FORM: 2,
  WAITING_SIZE: 3,
  PAID: 4,
  NEW: 4,
  DONE: 5,
};

// ── Configuration ──
const DEFAULT_CONCURRENCY = 5;     // max parallel workers
const MAX_QUEUE_SIZE = 500;        // safety cap
const FALLBACK_DELAY_MS = 8000;    // send fallback after this delay
const MAX_RETRIES = 1;             // retry failed AI tasks once

// ── Queue state ──
const _queue = [];                 // { id, chatId, priority, task, retries, enqueuedAt }
const _chatLocks = new Map();      // chatId → true (locked while processing)
const _pendingCancels = new Set(); // chatIds where manager cancelled AI
let _activeWorkers = 0;
let _maxConcurrency = DEFAULT_CONCURRENCY;
let _totalEnqueued = 0;
let _totalProcessed = 0;
let _totalDropped = 0;
let _totalRetries = 0;
let _totalErrors = 0;
let _idCounter = 0;
let _onFallback = null;            // callback(chatId) — send "секунду..." message
let _processing = false;

/**
 * Configure queue.
 * @param {{ concurrency?: number, onFallback?: Function }} opts
 */
function configure(opts = {}) {
  if (opts.concurrency) _maxConcurrency = Math.max(1, Math.min(20, opts.concurrency));
  if (opts.onFallback) _onFallback = opts.onFallback;
}

/**
 * Get priority number for a user state.
 */
function getPriority(userState) {
  return STATE_PRIORITY[userState] || 4;
}

/**
 * Enqueue a task for a chat.
 * @param {number|string} chatId  Telegram chat ID
 * @param {Function} task         async () => result
 * @param {{ priority?: number, userState?: string }} opts
 * @returns {{ id: number, position: number } | null} null if dropped
 */
function enqueue(chatId, task, opts = {}) {
  if (_queue.length >= MAX_QUEUE_SIZE) {
    _totalDropped++;
    log.error('Queue full — dropping message', { chatId, queueSize: _queue.length });
    return null;
  }

  const priority = opts.priority !== undefined ? opts.priority : getPriority(opts.userState);
  const item = {
    id: ++_idCounter,
    chatId: String(chatId),
    priority,
    task,
    retries: 0,
    enqueuedAt: Date.now(),
  };

  _queue.push(item);
  _totalEnqueued++;

  // Sort: lower priority number first, then earlier enqueue time
  _queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);

  // Schedule processing
  _scheduleProcess();

  return { id: item.id, position: _queue.indexOf(item) + 1 };
}

/**
 * Cancel all pending AI tasks for a chatId (manager override).
 */
function cancelChat(chatId) {
  const cid = String(chatId);
  _pendingCancels.add(cid);
  // Remove pending tasks for this chat from queue
  let removed = 0;
  for (let i = _queue.length - 1; i >= 0; i--) {
    if (_queue[i].chatId === cid) {
      _queue.splice(i, 1);
      removed++;
    }
  }
  if (removed > 0) {
    log.info('Manager override: cancelled pending AI tasks', { chatId: cid, removed });
  }
  // Clear cancel flag after a short window
  setTimeout(() => _pendingCancels.delete(cid), 5000);
  return removed;
}

/**
 * Check if a chatId has a pending cancel (manager override in progress).
 */
function isCancelled(chatId) {
  return _pendingCancels.has(String(chatId));
}

/**
 * Internal: schedule the processing loop (non-recursive, debounced).
 */
function _scheduleProcess() {
  if (_processing) return;
  _processing = true;
  // Use setImmediate to avoid blocking the event loop
  setImmediate(() => {
    _processLoop();
    _processing = false;
  });
}

/**
 * Internal: pick and run tasks while workers are available.
 */
function _processLoop() {
  while (_activeWorkers < _maxConcurrency && _queue.length > 0) {
    // Find first task whose chat is NOT locked
    const idx = _queue.findIndex(item => !_chatLocks.has(item.chatId));
    if (idx === -1) break; // All pending chats are locked

    const item = _queue.splice(idx, 1)[0];
    _runTask(item);
  }
}

/**
 * Internal: run a single task with lock, fallback timer, and retry.
 */
async function _runTask(item) {
  const { chatId, task, id } = item;
  _chatLocks.set(chatId, true);
  _activeWorkers++;

  // Fallback timer — send "секунду..." if processing takes too long
  let fallbackSent = false;
  const fallbackTimer = _onFallback ? setTimeout(() => {
    if (_chatLocks.has(chatId) && !_pendingCancels.has(chatId)) {
      fallbackSent = true;
      try { _onFallback(chatId); } catch (e) { /* ignore */ }
    }
  }, FALLBACK_DELAY_MS) : null;

  try {
    // Check if cancelled before starting
    if (_pendingCancels.has(chatId)) {
      return;
    }

    await task();
    _totalProcessed++;
  } catch (err) {
    _totalErrors++;
    log.error('Queue task error', { taskId: id, chatId, error: err.message, retries: item.retries });

    // Retry once
    if (item.retries < MAX_RETRIES) {
      item.retries++;
      _totalRetries++;
      _queue.push(item);
      _queue.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
    }
  } finally {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    _chatLocks.delete(chatId);
    _activeWorkers--;
    // Try to process more tasks
    _scheduleProcess();
  }
}

// ── Metrics ──

function getMetrics() {
  return {
    queueLength: _queue.length,
    activeWorkers: _activeWorkers,
    maxConcurrency: _maxConcurrency,
    lockedChats: _chatLocks.size,
    totalEnqueued: _totalEnqueued,
    totalProcessed: _totalProcessed,
    totalDropped: _totalDropped,
    totalRetries: _totalRetries,
    totalErrors: _totalErrors,
  };
}

function getQueueLength() {
  return _queue.length;
}

/**
 * Wait until all tasks are processed (for testing).
 */
function drain(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (_queue.length === 0 && _activeWorkers === 0) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('Queue drain timeout'));
      setTimeout(check, 50);
    };
    check();
  });
}

/**
 * Clear queue state (for testing).
 */
function reset() {
  _queue.length = 0;
  _chatLocks.clear();
  _pendingCancels.clear();
  _activeWorkers = 0;
  _totalEnqueued = 0;
  _totalProcessed = 0;
  _totalDropped = 0;
  _totalRetries = 0;
  _totalErrors = 0;
  _idCounter = 0;
}

module.exports = {
  configure,
  enqueue,
  cancelChat,
  isCancelled,
  getMetrics,
  getQueueLength,
  getPriority,
  drain,
  reset,
  STATE_PRIORITY,
  MAX_QUEUE_SIZE,
  FALLBACK_DELAY_MS,
};
