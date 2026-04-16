const settings = require('../db/settings');
const orders = require('../db/orders');
const memory = require('../db/memory');
const ownerReviews = require('../db/owner_reviews');
const { buildOrderContext, syncUserState } = require('../domain/order_service');

function extractOrderFields(collectedData, fallbackKnown) {
  const data = collectedData || {};
  const known = fallbackKnown || {};
  return {
    product_ref: data.product_ref || known.product_ref || undefined,
    product: data.product_name || known.product_name || undefined,
    size: data.size || known.size || undefined,
    price: known.price || undefined,
    full_name: data.full_name || known.full_name || undefined,
    phone: data.phone || known.phone || undefined,
    address: data.address || known.address || undefined,
  };
}

async function loadPaymentData() {
  const [cardNumber, bankName, receiverName] = await Promise.all([
    settings.get('payment_card_number'),
    settings.get('payment_bank_name'),
    settings.get('payment_receiver_name'),
  ]);
  return {
    cardNumber: cardNumber || null,
    bankName: bankName || null,
    receiverName: receiverName || null,
  };
}

async function reconcileInboundSignals(user, incoming, orderContext, sensors) {
  const actions = [];
  let order = orderContext.order;
  const normalizedStatus = orders.normalizeStatus(order?.status);

  if (
    (sensors.payment_claim_signal || incoming.hasPhoto) &&
    order &&
    ['payment_pending', 'payment_claimed'].includes(normalizedStatus)
  ) {
    const claimedOrder = await orders.markPaymentClaimed(order.id, { receiptMessageId: incoming.messageId || null });
    if (claimedOrder) {
      order = claimedOrder;
      await ownerReviews.open({
        orderId: order.id,
        userId: user.id,
        receiptMessageId: incoming.messageId || null,
        reason: 'payment_claim_signal',
      });
      await syncUserState(user.id, order);
      actions.push({
        type: 'mark_payment_claimed',
        order_id: order.id,
        receipt_message_id: incoming.messageId || null,
      });
    }
  }

  return { order, actions };
}

async function executeDecision(user, decision, orderContext, sensors) {
  const actions = [];
  const outbox = [];
  let order = orderContext.order;
  const shouldPersistOrder = ['upsert_order_draft', 'send_payment_details'].includes(decision.action.type)
    || Object.values(decision.collected_data || {}).some(Boolean);

  if (shouldPersistOrder) {
    const fields = extractOrderFields(decision.collected_data, orderContext.known);
    if (Object.values(fields).some((value) => value !== undefined)) {
      order = await orders.upsertDraft(user.id, fields);
      actions.push({
        type: 'upsert_order_draft',
        order_id: order.id,
        fields,
      });
    }
  }

  if (order) {
    await memory.update(user.id, {
      full_name: order.full_name || undefined,
      phone: order.phone || undefined,
      address: order.address || undefined,
      shoe_size: order.size || undefined,
      preferred_brand: sensors.extracted?.preferred_brand || undefined,
      shoe_type: sensors.extracted?.shoe_type || undefined,
      insole_cm: sensors.extracted?.insole_cm || undefined,
    }).catch(() => {});
  }

  if (decision.reply) {
    outbox.push({ kind: 'reply', text: decision.reply });
    actions.push({ type: 'queue_reply' });
  }

  if (decision.action.type === 'send_payment_details') {
    const refreshedContext = await buildOrderContext(user, sensors);
    const paymentData = await loadPaymentData();
    if (refreshedContext.can_send_payment && paymentData.cardNumber) {
      order = await orders.updateStatus(refreshedContext.order_id, 'payment_pending');
      outbox.push({
        kind: 'payment_details',
        cardNumber: paymentData.cardNumber,
        bankName: paymentData.bankName,
        receiverName: paymentData.receiverName,
        amount: refreshedContext.known.price || null,
      });
      actions.push({
        type: 'send_payment_details',
        order_id: order.id,
      });
    } else {
      actions.push({
        type: 'skip_payment_details',
        reason: !paymentData.cardNumber ? 'payment_settings_missing' : 'order_incomplete',
      });
    }
  }

  if (order) {
    await syncUserState(user.id, order);
  }

  return { order, actions, outbox };
}

module.exports = {
  reconcileInboundSignals,
  executeDecision,
};
