const NEXT_STEPS = new Set([
  'clarify_need',
  'show_options',
  'collect_size',
  'collect_delivery',
  'confirm_order',
  'request_payment',
  'ack_payment_claim',
  'post_verification_reassure',
]);

const ACTION_TYPES = new Set([
  'none',
  'upsert_order_draft',
  'send_payment_details',
  'schedule_followup',
]);

function fallbackReply(context) {
  if (context.order?.payment_review_pending) {
    return 'Чек получил. Передал на ручную проверку оплаты.';
  }
  if (context.order?.payment_verified) {
    return 'Оплату подтвердили. Заказ принят в работу, дальше напишу по отправке.';
  }
  if (context.order?.missing?.includes('product')) {
    return 'Скажи, какая модель интересует, и я сразу сориентирую.';
  }
  if (context.order?.missing?.includes('size')) {
    return 'Напиши свой размер, и двинемся к оформлению.';
  }
  if (context.order?.missing?.some((field) => ['full_name', 'phone', 'address'].includes(field))) {
    return 'Скинь ФИО, телефон и адрес одним сообщением.';
  }
  return 'Продолжим оформление. Если всё ок, отправлю следующий шаг.';
}

function deriveNextStep(context) {
  if (context.order?.payment_review_pending) return 'ack_payment_claim';
  if (context.order?.payment_verified) return 'post_verification_reassure';
  if (context.order?.missing?.includes('product')) return 'show_options';
  if (context.order?.missing?.includes('size')) return 'collect_size';
  if (context.order?.missing?.some((field) => ['full_name', 'phone', 'address'].includes(field))) return 'collect_delivery';
  return 'request_payment';
}

function normalizeString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePolicyJson(rawOutput) {
  if (!rawOutput) return null;
  try {
    return JSON.parse(rawOutput);
  } catch {}

  const start = rawOutput.indexOf('{');
  const end = rawOutput.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(rawOutput.slice(start, end + 1));
  } catch {
    return null;
  }
}

function validateDecision(parsed, context) {
  const errors = [];
  const base = {
    version: 'v1',
    reply: fallbackReply(context),
    next_step: deriveNextStep(context),
    action: { type: 'none', payload: {} },
    collected_data: {
      product_ref: null,
      product_name: null,
      size: null,
      full_name: null,
      phone: null,
      address: null,
    },
    confidence: 'medium',
  };

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('policy_output_not_json_object');
    return { decision: base, valid: false, errors };
  }

  const decision = {
    ...base,
    reply: normalizeString(parsed.reply) || base.reply,
    next_step: NEXT_STEPS.has(parsed.next_step) ? parsed.next_step : base.next_step,
    action: {
      type: ACTION_TYPES.has(parsed.action?.type) ? parsed.action.type : 'none',
      payload: parsed.action?.payload && typeof parsed.action.payload === 'object' ? parsed.action.payload : {},
    },
    collected_data: {
      product_ref: normalizeString(parsed.collected_data?.product_ref),
      product_name: normalizeString(parsed.collected_data?.product_name),
      size: normalizeString(parsed.collected_data?.size),
      full_name: normalizeString(parsed.collected_data?.full_name),
      phone: normalizeString(parsed.collected_data?.phone),
      address: normalizeString(parsed.collected_data?.address),
    },
    confidence: ['low', 'medium', 'high'].includes(parsed.confidence) ? parsed.confidence : 'medium',
  };

  const mergedKnown = {
    ...(context.order?.known || {}),
    ...Object.fromEntries(
      Object.entries(decision.collected_data).filter(([, value]) => value)
    ),
  };
  const paymentReady = !!(
    mergedKnown.product_name &&
    mergedKnown.size &&
    mergedKnown.full_name &&
    mergedKnown.phone &&
    mergedKnown.address &&
    (mergedKnown.price || context.order?.known?.price)
  );

  if (parsed.next_step && !NEXT_STEPS.has(parsed.next_step)) {
    errors.push('invalid_next_step');
  }
  if (parsed.action?.type && !ACTION_TYPES.has(parsed.action.type)) {
    errors.push('invalid_action_type');
  }
  if (decision.action.type === 'send_payment_details' && !paymentReady) {
    errors.push('payment_details_requested_without_complete_order');
    decision.action = { type: 'upsert_order_draft', payload: {} };
  }
  if (context.order?.payment_review_pending && decision.action.type === 'send_payment_details') {
    errors.push('payment_details_blocked_during_manual_review');
    decision.action = { type: 'none', payload: {} };
  }
  if (context.order?.payment_verified && decision.action.type === 'send_payment_details') {
    errors.push('payment_details_blocked_after_verification');
    decision.action = { type: 'none', payload: {} };
  }

  return { decision, valid: errors.length === 0, errors };
}

module.exports = {
  NEXT_STEPS,
  ACTION_TYPES,
  parsePolicyJson,
  validateDecision,
};
