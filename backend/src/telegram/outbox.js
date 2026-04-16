const messages = require('../db/messages');
const settings = require('../db/settings');
const bot = require('./bot');

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

    const saved = await messages.save(user.id, role, text, {
      deliveryStatus: 'pending',
      metadata: { kind: item.kind || 'reply' },
    });
    if (broadcast) broadcast('message', { userId: user.id, message: saved });

    try {
      const sent = await bot.sendMessage(telegramId, text, sendOptions);
      const delivered = await messages.markDelivery(saved.id, 'delivered', {
        telegramMessageId: sent?.message_id || null,
      });
      if (broadcast) broadcast('message', { userId: user.id, message: delivered || saved });
    } catch (err) {
      const failed = await messages.markDelivery(saved.id, 'failed', {
        errorText: err.message || 'send_failed',
      });
      if (broadcast) broadcast('message', { userId: user.id, message: failed || saved });
      throw err;
    }
  }
}

module.exports = {
  deliverOutbox,
};
