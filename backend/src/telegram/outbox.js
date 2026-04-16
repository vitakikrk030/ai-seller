const messages = require('../db/messages');
const settings = require('../db/settings');
const bot = require('./bot');
const log = require('../logger');

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
      metadata: { kind: item.kind || 'reply' },
    });
    results.push(saved);
    if (broadcast) broadcast('message', { userId: user.id, message: saved });

    try {
      const sentState = await messages.markDelivery(saved.id, 'sent');
      if (broadcast) broadcast('message', { userId: user.id, message: sentState || saved });
      log.debug('outbox.deliverOutbox: sending to telegram', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
      });
      const sent = await bot.sendMessage(telegramId, text, sendOptions);
      const delivered = await messages.markDelivery(saved.id, 'delivered', {
        telegramMessageId: sent?.message_id || null,
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
      const failed = await messages.markDelivery(saved.id, 'failed', {
        errorText,
      });
      results[results.length - 1] = failed || saved;
      log.error('outbox.deliverOutbox: telegram send failed', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
        error: errorText,
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

module.exports = {
  deliverOutbox,
  OutboxDeliveryError,
};
