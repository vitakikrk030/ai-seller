const messages = require('../db/messages');
const settings = require('../db/settings');
const bot = require('./bot');
const log = require('../logger');

const RETRY_BACKOFF_MS = [15000, 60000, 300000, 900000];
const DEFAULT_MAX_RETRIES = 4;

class OutboxDeliveryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OutboxDeliveryError';
    this.code = 'OUTBOX_DELIVERY_FAILED';
    this.details = details;
    this.failedMessage = details.failedMessage || null;
    this.status = details.status || null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTelegramError(err) {
  const status = err?.status || err?.response?.status || null;
  const description = err?.telegram?.description || err?.response?.data?.description || '';
  const code = err?.code || '';

  if (description && status) return `telegram_api_${status}: ${description}`;
  if (description) return `telegram_api: ${description}`;
  if (status) return `telegram_http_${status}`;
  if (code) return `telegram_network_${code}`;
  return err?.message || 'telegram_send_failed';
}

function getRetryDelayMs(retryCount) {
  const index = Math.max(0, Math.min(RETRY_BACKOFF_MS.length - 1, retryCount - 1));
  return RETRY_BACKOFF_MS[index];
}

async function deliverOutbox({
  telegramId,
  user,
  outbox,
  businessConnectionId = null,
  applyDelay = true,
  role = 'ai',
  broadcast = null,
}) {
  const results = [];
  log.debug('outbox.deliverOutbox: start', {
    userId: user?.id || null,
    telegramId,
    outboxCount: Array.isArray(outbox) ? outbox.length : 0,
    role,
  });
  const delay = applyDelay ? parseInt(await settings.get('response_delay') || '0', 10) : 0;
  if (delay > 0 && delay <= 30) await sleep(delay * 1000);

  const sendOptions = businessConnectionId ? { business_connection_id: businessConnectionId } : {};

  for (const item of outbox || []) {
    let text = item.text || '';
    if (item.kind === 'payment_details') {
      const amountLine = item.amount ? `\nСумма: ${item.amount}₽` : '';
      const bankLine = item.bankName ? `Банк: ${item.bankName}\n` : '';
      const receiver = item.receiverName || 'Не указан';
      text = `Реквизиты для оплаты:\n\n${bankLine}Карта: ${item.cardNumber}\nПолучатель: ${receiver}${amountLine}`.trim();
    }

    if (!text) continue;
    log.debug('outbox.deliverOutbox: enqueue message', {
      userId: user.id,
      telegramId,
      kind: item.kind || 'reply',
      textLength: text.length,
    });

    const saved = await messages.save(user.id, role, text, {
      deliveryStatus: 'pending',
      metadata: {
        kind: item.kind || 'reply',
        business_connection_id: sendOptions.business_connection_id || null,
      },
    });
    results.push(saved);
    if (broadcast) broadcast('message', { userId: user.id, message: saved });

    try {
      log.debug('outbox.deliverOutbox: sending to telegram', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
      });
      const sent = await bot.sendMessage(telegramId, text, sendOptions);
      const sentState = await messages.markDelivery(saved.id, 'sent');
      if (broadcast) broadcast('message', { userId: user.id, message: sentState || saved });
      const delivered = await messages.markDelivery(saved.id, 'delivered', {
        telegramMessageId: sent?.message_id || null,
        errorText: null,
      });
      results[results.length - 1] = delivered || sentState || saved;
      log.info('outbox.deliverOutbox: delivered', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
        telegramMessageId: sent?.message_id || null,
      });
      if (broadcast) broadcast('message', { userId: user.id, message: delivered || sentState || saved });
    } catch (err) {
      const errorText = normalizeTelegramError(err);
      const retryCount = 1;
      const failed = await messages.scheduleRetry(saved.id, {
        errorText,
        retryCount,
        nextRetryAt: new Date(Date.now() + getRetryDelayMs(retryCount)),
      });
      results[results.length - 1] = failed || saved;
      log.error('outbox.deliverOutbox: telegram send failed', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
        error: errorText,
        retryCount,
      });
      if (broadcast) broadcast('message', { userId: user.id, message: failed || saved });
      throw new OutboxDeliveryError('Telegram delivery failed', {
        failedMessage: failed || saved,
        status: err?.status || err?.response?.status || null,
        telegramId,
        userId: user?.id || null,
        errorText,
      });
    }
  }
  log.debug('outbox.deliverOutbox: complete', {
    userId: user?.id || null,
    telegramId,
  });
  return results;
}

async function retryFailedDeliveries({ limit = 20, maxRetries = DEFAULT_MAX_RETRIES, broadcast = null } = {}) {
  const batch = await messages.getRetryBatch(limit, maxRetries);
  if (batch.length === 0) {
    return { scanned: 0, delivered: 0, retried: 0, movedToDlq: 0 };
  }

  let delivered = 0;
  let retried = 0;
  let movedToDlq = 0;

  for (const candidate of batch) {
    const sendOptions = candidate.metadata?.business_connection_id
      ? { business_connection_id: candidate.metadata.business_connection_id }
      : {};
    const nextRetryCount = (candidate.retry_count || 0) + 1;
    try {
      log.info('outbox.retry: attempting redelivery', {
        messageId: candidate.id,
        userId: candidate.user_id,
        telegramId: candidate.telegram_id,
        attempt: nextRetryCount,
      });
      const sent = await bot.sendMessage(candidate.telegram_id, candidate.text, sendOptions);
      const sentState = await messages.markDelivery(candidate.id, 'sent');
      const deliveredState = await messages.markDelivery(candidate.id, 'delivered', {
        telegramMessageId: sent?.message_id || null,
        errorText: null,
      });
      delivered++;
      if (broadcast) {
        broadcast('message', { userId: candidate.user_id, message: sentState || candidate });
        broadcast('message', { userId: candidate.user_id, message: deliveredState || sentState || candidate });
      }
    } catch (err) {
      const errorText = normalizeTelegramError(err);
      if (nextRetryCount >= maxRetries) {
        const dlqState = await messages.moveToDlq(candidate.id, {
          errorText,
          retryCount: nextRetryCount,
          reason: 'delivery_retries_exhausted',
        });
        movedToDlq++;
        log.error('outbox.retry: moved to DLQ', {
          messageId: candidate.id,
          userId: candidate.user_id,
          telegramId: candidate.telegram_id,
          retryCount: nextRetryCount,
          error: errorText,
        });
        if (broadcast) broadcast('message', { userId: candidate.user_id, message: dlqState || candidate });
      } else {
        const retryState = await messages.scheduleRetry(candidate.id, {
          errorText,
          retryCount: nextRetryCount,
          nextRetryAt: new Date(Date.now() + getRetryDelayMs(nextRetryCount)),
        });
        retried++;
        log.warn('outbox.retry: rescheduled', {
          messageId: candidate.id,
          userId: candidate.user_id,
          telegramId: candidate.telegram_id,
          retryCount: nextRetryCount,
          error: errorText,
        });
        if (broadcast) broadcast('message', { userId: candidate.user_id, message: retryState || candidate });
      }
    }
  }

  return {
    scanned: batch.length,
    delivered,
    retried,
    movedToDlq,
  };
}

module.exports = {
  deliverOutbox,
  retryFailedDeliveries,
  OutboxDeliveryError,
};
