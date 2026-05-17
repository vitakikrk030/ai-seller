function compactObject(input = {}) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string') return String(value).trim() !== '';
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') return Object.keys(value).length > 0;
      return true;
    }),
  );
}

function extractIwakProductLink(text = '') {
  const match = String(text || '').match(/https?:\/\/[^\s]*iwak\.(?:ru|рф)\/product\/[^\s]+/i);
  return match ? match[0].trim() : '';
}

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
  const intentData = compactObject({
    product_id: facts.product_id || '',
    product_name: facts.product_name || facts.product_interest || '',
    product_link: facts.product_link || facts.link || extractIwakProductLink(inputText) || '',
    shoe_size: facts.shoe_size || facts.size || '',
    clothing_size: facts.clothing_size || '',
    insole_cm: facts.insole_cm || '',
    size_insole_check: facts.size_insole_check || '',
    item: facts.item || '',
  });

  const deliveryData = compactObject({
    recipient_name: facts.delivery_fio || facts.full_name || facts.fio || facts.recipient_name || facts.customer_name || '',
    delivery_phone: facts.delivery_phone || facts.phone || '',
    delivery_city: facts.delivery_city || facts.city || '',
    delivery_service: facts.delivery_service || facts.delivery_method || '',
    delivery_address: facts.delivery_address || facts.address || '',
    pickup_point: facts.pickup_point || '',
  });

  const paymentData = compactObject({
    payment_amount: facts.payment_amount || facts.price || (paymentAmount != null ? String(paymentAmount) : ''),
    payment_status: paymentConfirmed ? 'paid' : (facts.payment_status || ''),
    order_status: paymentConfirmed ? 'paid' : (facts.order_status || ''),
    payment_received: paymentConfirmed ? 'true' : (facts.payment_received || ''),
    payment_request_sent: paymentTemplateSent ? 'true' : '',
    payment_requested_at: paymentTemplateSent ? new Date().toISOString() : '',
  });

  const existingIntent = existingDraft?.intent_data || {};
  const incomingProductId = String(intentData.product_id || '').trim();
  const incomingProductName = String(intentData.product_name || '').trim().toLowerCase();
  const currentProductId = String(existingIntent.product_id || '').trim();
  const currentProductName = String(existingIntent.product_name || '').trim().toLowerCase();
  const productChanged = Boolean(
    (incomingProductId && currentProductId && incomingProductId !== currentProductId)
    || (!incomingProductId && incomingProductName && currentProductName && incomingProductName !== currentProductName)
  );

  const currentStep = getDraftStep({ intentData, deliveryData, paymentData, stage: currentStage });
  const status = paymentConfirmed || String(paymentData.payment_status || '').toLowerCase() === 'paid' || String(paymentData.payment_received || '').toLowerCase() === 'true'
    ? 'paid'
    : 'active';

  const meta = compactObject({
    funnel_stage: currentStage || '',
    product_changed: productChanged ? 'true' : '',
    previous_product_id: productChanged ? currentProductId : '',
    previous_product_name: productChanged ? String(existingIntent.product_name || '') : '',
    last_input_excerpt: String(inputText || '').trim().slice(0, 500),
  });

  return {
    status,
    currentStep,
    intentData,
    deliveryData,
    paymentData,
    meta,
    productChanged,
  };
}

module.exports = {
  compactObject,
  extractIwakProductLink,
  normalizeOrderSnapshot,
  getDraftStep,
  buildOrderDraftPayload,
};
