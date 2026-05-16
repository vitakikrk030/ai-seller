const DROP_STAGES = {
  first_touch: 'first_touch_drop',
  sizing: 'sizing_drop',
  checkout: 'checkout_drop',
  payment: 'payment_drop',
};

const EXPECTED_TO_DROP = {
  reply_any: DROP_STAGES.first_touch,
  send_size: DROP_STAGES.sizing,
  send_checkout_data: DROP_STAGES.checkout,
  send_payment_confirmation: DROP_STAGES.payment,
};

const STAGE_LABELS = {
  none: 'Нет зависания',
  first_touch_drop: 'Первое касание',
  sizing_drop: 'Размер',
  checkout_drop: 'Оформление',
  payment_drop: 'Реквизиты',
};

const EXPECTED_LABELS = {
  none: 'Ничего не ждём',
  reply_any: 'Ответ клиента',
  send_size: 'Размер или стельку',
  send_checkout_data: 'Данные для оформления',
  send_payment_confirmation: 'Оплату или чек',
};

const DROP_TIMEOUTS_MS = {
  reply_any: 2 * 60 * 60 * 1000,
  send_size: 2 * 60 * 60 * 1000,
  send_checkout_data: 2 * 60 * 60 * 1000,
  send_payment_confirmation: 60 * 60 * 1000,
};

function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulText(message = {}) {
  const text = normalizeText(message.text || '');
  return Boolean(text && !/^\[(photo|фото|video|voice|document|audio|sticker|animation)/i.test(text));
}

function isInbound(message = {}) {
  return message.direction === 'in' && message.role === 'customer';
}

function isOutbound(message = {}) {
  return message.direction === 'out' && ['assistant', 'operator'].includes(message.role);
}

function actorOf(message = {}) {
  return message.role === 'operator' ? 'manager' : message.role === 'assistant' ? 'ai' : '';
}

function isPaymentRequest(text = '') {
  const value = normalizeText(text);
  if (!/(оплат|перевод|реквизит|получател|банк|чек|карта|сумма к оплате)/i.test(value)) return false;
  return value.includes('сумма к оплате')
    || value.includes('реквизит')
    || /(жду|пришлите|отправьте|скиньте).{0,40}(чек|перевод|оплат)/i.test(value)
    || /(чек|подтверждение).{0,40}(перевод|оплат)/i.test(value);
}

function isPaymentConfirmation(message = {}) {
  const value = normalizeText(message.text || '');
  if (/(перевел|перевела|оплатил|оплатила|чек|оплата прошла|сделал оплату|сделала оплату)/i.test(value)) return true;
  const raw = message.raw || {};
  const documentName = normalizeText(raw.document?.file_name || '');
  return /(receipt|чек|pdf)/i.test(documentName);
}

function isCheckoutRequest(text = '') {
  const value = normalizeText(text);
  if (!/(оформлен|оформить|оформления|заказа|доставк)/i.test(value)) return false;
  const score = [
    /фио|имя|полностью/.test(value),
    /телефон|номер/.test(value),
    /город/.test(value),
    /адрес|пвз|пункт выдачи/.test(value),
    /служб[ауы] доставки|доставка|озон|ozon|wildberries|яндекс|сдэк|cdek|почта/.test(value),
  ].filter(Boolean).length;
  return score >= 3 || /отправьте следующие данные|скину что нужно заполнить|что нужно для оформления/.test(value);
}

function isSizingRequest(text = '') {
  const value = normalizeText(text);
  if (!/(размер|стельк|см|сантиметр|длина стопы|параметр)/i.test(value)) return false;
  return /(какой|какая|напишите|подскажите|нужен|интересует|измерьте|замер|длина)/i.test(value);
}

function hasSizeAnswer(text = '') {
  const value = normalizeText(text);
  if (/\b(3[5-9]|4\d|5[0-2])\b/.test(value) && /(размер|р-р|рр|стельк|см|сантиметр)?/.test(value)) return true;
  if (/\b\d{2}(?:[,.]\d)?\s*(см|сантиметр)/i.test(value)) return true;
  return false;
}

function extractCheckoutSignals(text = '') {
  const value = normalizeText(text);
  return {
    fio: /[а-яa-z]{2,}\s+[а-яa-z]{2,}(?:\s+[а-яa-z]{2,})?/i.test(String(text || '')),
    phone: /(?:\+?\d[\d()\-\s]{8,}\d)/.test(String(text || '')),
    city: /(город|г\.|москва|санкт|спб|ижевск|казань|минск|екатеринбург|новосибирск|краснодар|самара|воронеж|пермь|омск|уфа|ростов|челябинск)/i.test(value),
    delivery: /(ozon|озон|wildberries|вайлдбер|яндекс|сдэк|cdek|почта|курьер|доставка)/i.test(value),
    address: /(адрес|пвз|пункт выдачи|ул\.|улица|проспект|пр-т|дом|д\.|корпус|кв\.|строение)/i.test(value),
  };
}

function mergeSignals(a, b) {
  return {
    fio: Boolean(a.fio || b.fio),
    phone: Boolean(a.phone || b.phone),
    city: Boolean(a.city || b.city),
    delivery: Boolean(a.delivery || b.delivery),
    address: Boolean(a.address || b.address),
  };
}

function checkoutComplete(signals = {}, facts = {}) {
  const factSignals = {
    fio: Boolean(facts.fio || facts.full_name || facts.recipient_name),
    phone: Boolean(facts.phone || facts.phone_number || facts.customer_phone),
    city: Boolean(facts.city),
    delivery: Boolean(facts.delivery_service || facts.delivery_method),
    address: Boolean(facts.delivery_address || facts.pickup_point),
  };
  const merged = mergeSignals(signals, factSignals);
  const missing = [];
  if (!merged.fio) missing.push('fio');
  if (!merged.phone) missing.push('phone');
  if (!merged.city) missing.push('city');
  if (!merged.delivery) missing.push('delivery');
  if (!merged.address) missing.push('address');
  return { complete: missing.length === 0, missing, signals: merged };
}

function messageAt(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function buildState(input = {}, options = {}) {
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();
  const messages = Array.isArray(input.messages) ? [...input.messages].sort((a, b) => messageAt(a.created_at) - messageAt(b.created_at)) : [];
  const facts = input.facts || {};
  const orders = Array.isArray(input.orders) ? input.orders : [];
  const paidOrder = orders.some((order) => order.status === 'paid');
  const awaitingPaymentOrder = orders.some((order) => order.status === 'awaiting_payment');

  let expectedAction = 'none';
  let expectedSince = null;
  let expectedMessageId = null;
  let expectedBy = '';
  let expectedText = '';
  let stage = 'none';
  let firstInboundAt = null;
  let firstOutboundAfterFirstInbound = null;
  let openedSpecificExpectation = false;
  let lastCustomerMessageAt = null;
  let lastOutboundMessageAt = null;
  let checkoutSignals = {};
  let paymentConfirmed = paidOrder;

  function openExpectation(action, message) {
    if (action !== 'reply_any') openedSpecificExpectation = true;
    expectedAction = action;
    expectedSince = message.created_at || null;
    expectedMessageId = message.id || message.telegram_message_id || null;
    expectedBy = actorOf(message);
    expectedText = String(message.text || '').slice(0, 500);
    stage = action === 'send_payment_confirmation'
      ? 'payment'
      : action === 'send_checkout_data'
        ? 'checkout'
        : action === 'send_size'
          ? 'sizing'
          : 'first_touch';
    if (action === 'send_checkout_data') checkoutSignals = {};
  }

  function clearExpectation() {
    expectedAction = 'none';
    expectedSince = null;
    expectedMessageId = null;
    expectedBy = '';
    expectedText = '';
  }

  for (const message of messages) {
    const text = String(message.text || '');
    if (isInbound(message)) {
      if (!firstInboundAt && hasMeaningfulText(message)) firstInboundAt = message.created_at || null;
      lastCustomerMessageAt = message.created_at || lastCustomerMessageAt;

      if (expectedAction === 'reply_any' && hasMeaningfulText(message)) clearExpectation();
      if (expectedAction === 'send_size' && hasSizeAnswer(text)) clearExpectation();
      if (expectedAction === 'send_checkout_data') {
        checkoutSignals = mergeSignals(checkoutSignals, extractCheckoutSignals(text));
        if (checkoutComplete(checkoutSignals, facts).complete) clearExpectation();
      }
      if (expectedAction === 'send_payment_confirmation' && isPaymentConfirmation(message)) {
        paymentConfirmed = true;
        clearExpectation();
      }
      continue;
    }

    if (!isOutbound(message)) continue;
    lastOutboundMessageAt = message.created_at || lastOutboundMessageAt;
    const isFirstOutboundAfterFirstInbound = Boolean(firstInboundAt && !firstOutboundAfterFirstInbound);

    if (isPaymentRequest(text)) {
      openExpectation('send_payment_confirmation', message);
      if (isFirstOutboundAfterFirstInbound) firstOutboundAfterFirstInbound = message.created_at || null;
      continue;
    }
    if (isCheckoutRequest(text)) {
      openExpectation('send_checkout_data', message);
      if (isFirstOutboundAfterFirstInbound) firstOutboundAfterFirstInbound = message.created_at || null;
      continue;
    }
    if (isSizingRequest(text)) {
      openExpectation('send_size', message);
      if (isFirstOutboundAfterFirstInbound) firstOutboundAfterFirstInbound = message.created_at || null;
      continue;
    }
    if (isFirstOutboundAfterFirstInbound && expectedAction === 'none' && !openedSpecificExpectation) {
      openExpectation('reply_any', message);
    }
    if (isFirstOutboundAfterFirstInbound) firstOutboundAfterFirstInbound = message.created_at || null;
  }

  if (awaitingPaymentOrder && !paymentConfirmed && expectedAction === 'none') {
    const latestAwaiting = orders
      .filter((order) => order.status === 'awaiting_payment')
      .sort((a, b) => messageAt(b.created_at) - messageAt(a.created_at))[0];
    expectedAction = 'send_payment_confirmation';
    expectedSince = latestAwaiting?.created_at || null;
    expectedBy = 'system';
    expectedText = latestAwaiting?.summary || 'awaiting_payment_order';
    stage = 'payment';
  }

  if (paidOrder || paymentConfirmed) {
    clearExpectation();
    stage = 'done';
  }

  const evidence = {
    expected_message_id: expectedMessageId,
    expected_by: expectedBy,
    expected_text: expectedText,
    last_customer_message_at: lastCustomerMessageAt,
    last_outbound_message_at: lastOutboundMessageAt,
  };

  let dropStage = 'none';
  let dropDetectedAt = null;
  let confidence = 0;
  let reason = '';
  let blockedReason = '';

  if (expectedAction !== 'none' && expectedSince) {
    const elapsedMs = nowMs - messageAt(expectedSince);
    const timeoutMs = DROP_TIMEOUTS_MS[expectedAction] || DROP_TIMEOUTS_MS.reply_any;
    if (elapsedMs >= timeoutMs) {
      dropStage = EXPECTED_TO_DROP[expectedAction] || 'none';
      dropDetectedAt = new Date(nowMs).toISOString();
      confidence = expectedAction === 'reply_any' ? 0.86 : 0.94;
      reason = `${expectedAction}_no_customer_response`;
      if (expectedAction === 'send_checkout_data') {
        const checkout = checkoutComplete(checkoutSignals, facts);
        evidence.checkout_missing = checkout.missing;
        evidence.checkout_signals = checkout.signals;
        if (checkout.complete) {
          dropStage = 'none';
          dropDetectedAt = null;
          confidence = 0;
          blockedReason = 'checkout_data_complete';
        }
      }
    } else {
      blockedReason = 'timeout_not_reached';
    }
  } else if (paidOrder || paymentConfirmed) {
    blockedReason = 'paid_or_done';
  } else {
    blockedReason = 'no_open_expected_action';
  }

  const followupMessages = expectedSince
    ? messages.filter((message) => isOutbound(message) && messageAt(message.created_at) > messageAt(expectedSince))
    : [];
  const followupAttempted = followupMessages.length > 0;
  const lastFollowup = followupMessages[followupMessages.length - 1] || null;

  return {
    stage,
    expected_action: expectedAction,
    expected_since: expectedSince,
    drop_stage: dropStage,
    drop_detected_at: dropDetectedAt,
    confidence,
    reason,
    evidence,
    blocked_reason: blockedReason,
    followup_attempted: followupAttempted,
    last_customer_message_at: lastCustomerMessageAt,
    last_outbound_message_at: lastOutboundMessageAt,
    last_followup_at: lastFollowup?.created_at || null,
    followup_actor: lastFollowup ? actorOf(lastFollowup) : '',
    label: STAGE_LABELS[dropStage] || STAGE_LABELS.none,
    expected_label: EXPECTED_LABELS[expectedAction] || EXPECTED_LABELS.none,
  };
}

module.exports = {
  buildState,
  DROP_STAGES,
  EXPECTED_TO_DROP,
  STAGE_LABELS,
  EXPECTED_LABELS,
};
