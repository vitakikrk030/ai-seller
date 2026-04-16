const orders = require('../db/orders');
const memory = require('../db/memory');
const users = require('../db/users');

function normalizeUserState(state) {
  if (!state) return 'NEW';
  if (state === 'COLLECTING') {
    return 'COLLECTING';
  }
  if (state === 'PAYMENT_REVIEW') return 'PAYMENT_REVIEW';
  if (state === 'PAID') return 'PAID';
  if (state === 'DONE') return 'DONE';
  return state;
}

function deriveUserStateFromOrder(order) {
  const status = orders.normalizeStatus(order?.status);
  if (!order) return 'NEW';
  if (status === 'payment_claimed') return 'PAYMENT_REVIEW';
  if (status === 'payment_verified') return 'PAID';
  if (status === 'fulfilled') return 'DONE';
  if (status === 'cancelled') return 'NEW';
  return 'COLLECTING';
}

function mergeKnown(order, mem, sensors) {
  const extracted = sensors?.extracted || {};
  const productMatch = sensors?.product_match || {};
  return {
    product_ref: order?.product_ref || productMatch.product_ref || null,
    product_name: order?.product || productMatch.product_name || null,
    price: order?.price || productMatch.price || null,
    size: order?.size || extracted.size || mem?.shoe_size || null,
    full_name: order?.full_name || extracted.full_name || mem?.full_name || null,
    phone: order?.phone || extracted.phone || mem?.phone || null,
    address: order?.address || extracted.address || mem?.address || null,
  };
}

function deriveMissingFields(known) {
  const missing = [];
  if (!known.product_name) missing.push('product');
  if (!known.size) missing.push('size');
  if (!known.full_name) missing.push('full_name');
  if (!known.phone) missing.push('phone');
  if (!known.address) missing.push('address');
  return missing;
}

function deriveNextOperationalStep(status, missing) {
  if (status === 'payment_claimed') return 'manual_payment_review';
  if (status === 'payment_verified') return 'post_payment';
  if (missing.includes('product')) return 'collect_product';
  if (missing.includes('size')) return 'collect_size';
  if (missing.some((field) => ['full_name', 'phone', 'address'].includes(field))) return 'collect_delivery';
  return 'request_payment';
}

async function buildOrderContext(user, sensors = {}) {
  const [activeOrder, latestOrder, mem] = await Promise.all([
    orders.getActiveByUser(user.id).catch(() => null),
    orders.getLatestByUser(user.id).catch(() => null),
    memory.get(user.id).catch(() => null),
  ]);
  const latestStatus = orders.normalizeStatus(latestOrder?.status);
  const order = activeOrder
    || (latestOrder && !['fulfilled', 'cancelled'].includes(latestStatus) ? latestOrder : null)
    || null;
  const status = orders.normalizeStatus(order?.status);
  const known = mergeKnown(order, mem, sensors);
  const missing = deriveMissingFields(known);
  const deliveryReady = !!(known.full_name && known.phone && known.address);
  const lineItemReady = !!(known.product_name && known.size && known.price);
  const canSendPayment = lineItemReady && deliveryReady && ['draft', 'payment_pending'].includes(status || 'draft');

  return {
    order,
    order_id: order?.id || null,
    status,
    user_state: normalizeUserState(user.state),
    known,
    missing,
    delivery_ready: deliveryReady,
    line_item_ready: lineItemReady,
    can_send_payment: canSendPayment,
    next_operational_step: deriveNextOperationalStep(status, missing),
    payment_review_pending: status === 'payment_claimed',
    payment_verified: status === 'payment_verified',
    memory: mem,
  };
}

async function syncUserState(userId, order) {
  const nextState = deriveUserStateFromOrder(order);
  const current = await users.getById(userId).catch(() => null);
  if (!current || normalizeUserState(current.state) === nextState) return current;
  return users.updateState(userId, nextState);
}

module.exports = {
  buildOrderContext,
  syncUserState,
  normalizeUserState,
  deriveUserStateFromOrder,
};
