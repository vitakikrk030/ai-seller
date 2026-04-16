const messages = require('../db/messages');
const settings = require('../db/settings');
const bot = require('./bot');
const log = require('../logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (broadcast) broadcast('message', { userId: user.id, message: saved });

    try {
      log.debug('outbox.deliverOutbox: sending to telegram', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
      });
      const sent = await bot.sendMessage(telegramId, text, sendOptions);
      const delivered = await messages.markDelivery(saved.id, 'delivered', {
        telegramMessageId: sent?.message_id || null,
      });
      log.info('outbox.deliverOutbox: delivered', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
        telegramMessageId: sent?.message_id || null,
      });
      if (broadcast) broadcast('message', { userId: user.id, message: delivered || saved });
    } catch (err) {
      const failed = await messages.markDelivery(saved.id, 'failed', {
        errorText: err.message || 'send_failed',
      });
      log.error('outbox.deliverOutbox: telegram send failed', {
        userId: user.id,
        telegramId,
        messageId: saved.id,
        error: err.message || 'send_failed',
      });
      if (broadcast) broadcast('message', { userId: user.id, message: failed || saved });
      throw err;
    }
  }
  log.debug('outbox.deliverOutbox: complete', {
    userId: user?.id || null,
    telegramId,
  });
}

module.exports = {
  deliverOutbox,
};
