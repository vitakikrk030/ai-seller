const { compactObject, buildIntentState } = require('./order-intent-detector');

function normalizeOrderSnapshot(snapshot = {}) {
  const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const next = { ...source };
  const productName = String(source.product_name || source.product_interest || '').trim();
  const deliveryCity = String(source.delivery_city || source.city || '').trim();
  const deliveryService = String(source.delivery_service || source.delivery_method || '').trim();
  const deliveryAddress = String(source.delivery_address || source.address || '').trim();
  const deliveryPhone = String(source.delivery_phone || source.phone || '').trim();
  const deliveryName = String(source.delivery_fio || source.full_name || source.fio || source.recipient_name || source.customer_name || '').trim();

  if (productName) {
    next.product_name = productName;
    next.product_interest = productName;
  }
  if (deliveryCity) next.city = deliveryCity;
  if (deliveryService) next.delivery_service = deliveryService;
  if (deliveryAddress) next.delivery_address = deliveryAddress;
  if (deliveryPhone) {
    next.delivery_phone = deliveryPhone;
    next.phone = deliveryPhone;
  }
  if (deliveryName) {
    next.delivery_fio = deliveryName;
    next.full_name = deliveryName;
    next.fio = deliveryName;
    next.recipient_name = deliveryName;
  }

  return next;
}

function buildDeliveryState(facts = {}) {
  const deliveryData = compactObject({
    recipient_name: facts.delivery_fio || facts.full_name || facts.fio || facts.recipient_name || facts.customer_name || '',
    delivery_phone: facts.delivery_phone || facts.phone || '',
    delivery_city: facts.delivery_city || facts.city || '',
    delivery_service: facts.delivery_service || facts.delivery_method || '',
    delivery_address: facts.delivery_address || facts.address || '',
    pickup_point: facts.pickup_point || '',
  });

  const hasAny = Object.keys(deliveryData).length > 0;
  const targetKind = deliveryData.pickup_point
    ? 'pickup'
    : deliveryData.delivery_address
      ? 'address'
      : '';

  const missing = [];
  if (!deliveryData.recipient_name) missing.push('recipient_name');
  if (!deliveryData.delivery_phone) missing.push('delivery_phone');
  if (!deliveryData.delivery_city) missing.push('delivery_city');
  if (!deliveryData.delivery_service) missing.push('delivery_service');
  if (!targetKind) missing.push('delivery_target');

  const completeness = !hasAny
    ? 'missing'
    : missing.length
      ? 'partial'
      : 'complete';

  return {
    deliveryData: {
      ...compactObject({
        ...deliveryData,
        delivery_kind: targetKind,
        completeness,
      }),
      missing_fields: missing,
    },
    meta: compactObject({
      delivery_completeness: completeness,
      delivery_missing: missing.join(','),
    }),
  };
}

function buildPaymentState({ facts = {}, paymentTemplateSent = false, paymentAmount = null, paymentConfirmed = false }) {
  const factPaymentStatus = String(facts.payment_status || facts.order_status || '').trim().toLowerCase();
  const factPaymentReceived = String(facts.payment_received || '').trim().toLowerCase() === 'true';
  const amount = facts.payment_amount || facts.price || (paymentAmount != null ? String(paymentAmount) : '');

  const paymentState = paymentConfirmed || factPaymentStatus === 'paid' || factPaymentReceived
    ? 'paid'
    : paymentTemplateSent || amount
      ? 'requested'
      : 'not_requested';

  return {
    paymentData: compactObject({
      payment_amount: amount,
      payment_status: paymentConfirmed ? 'paid' : (facts.payment_status || ''),
      order_status: paymentConfirmed ? 'paid' : (facts.order_status || ''),
      payment_received: paymentConfirmed ? 'true' : (facts.payment_received || ''),
      payment_request_sent: paymentTemplateSent ? 'true' : '',
      payment_requested_at: paymentTemplateSent ? new Date().toISOString() : '',
      payment_state: paymentState,
    }),
    meta: compactObject({
      payment_state: paymentState,
    }),
  };
}

function getDraftStep({ intentData = {}, deliveryData = {}, paymentData = {}, stage = '' }) {
  const paymentStatus = String(paymentData.payment_status || paymentData.order_status || '').toLowerCase();
  const paymentReceived = String(paymentData.payment_received || '').toLowerCase() === 'true';
  if (paymentStatus === 'paid' || paymentReceived) return 'support';

  const hasDelivery = Boolean(
    deliveryData.recipient_name
    || deliveryData.delivery_phone
    || deliveryData.delivery_city
    || deliveryData.delivery_service
    || deliveryData.delivery_address
    || deliveryData.pickup_point
  );
  const hasPayment = Boolean(paymentData.payment_amount || paymentData.payment_requested_at || paymentData.payment_request_sent);
  const hasIntent = Boolean(intentData.product_id || intentData.product_name || intentData.product_link || intentData.shoe_size || intentData.clothing_size);

  if (hasPayment || stage === 'checkout') return 'payment';
  if (hasDelivery) return 'delivery';
  if (hasIntent) return 'intent';
  return 'intent';
}

function buildOrderDraftPayload({ facts = {}, currentStage = '', inputText = '', existingDraft = null, paymentTemplateSent = false, paymentAmount = null, paymentConfirmed = false }) {
  const intentState = buildIntentState({ facts, inputText, existingDraft });
  const intentData = intentState.intentData;
  const deliveryState = buildDeliveryState(facts);
  const deliveryData = deliveryState.deliveryData;
  const paymentState = buildPaymentState({ facts, paymentTemplateSent, paymentAmount, paymentConfirmed });
  const paymentData = paymentState.paymentData;

  const currentStep = getDraftStep({ intentData, deliveryData, paymentData, stage: currentStage });
  const status = paymentConfirmed || String(paymentData.payment_status || '').toLowerCase() === 'paid' || String(paymentData.payment_received || '').toLowerCase() === 'true'
    ? 'paid'
    : 'active';

  const meta = compactObject({
    funnel_stage: currentStage || '',
    last_input_excerpt: String(inputText || '').trim().slice(0, 500),
    ...intentState.meta,
    ...deliveryState.meta,
    ...paymentState.meta,
  });

  return {
    status,
    currentStep,
    intentData,
    deliveryData,
    paymentData,
    meta,
    productChanged: intentState.productChanged,
  };
}

module.exports = {
  compactObject,
  normalizeOrderSnapshot,
  buildDeliveryState,
  buildPaymentState,
  getDraftStep,
  buildOrderDraftPayload,
};
