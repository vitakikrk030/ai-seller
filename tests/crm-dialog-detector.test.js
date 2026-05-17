const test = require('node:test');
const assert = require('node:assert/strict');

const detector = require('../lib/crm-dialog-detector');

function buildState(messages, options = {}) {
  return detector.buildState({ messages, facts: options.facts || {}, orders: options.orders || [] }, { now: options.now });
}

function msg(direction, role, text, createdAt, extra = {}) {
  return {
    direction,
    role,
    text,
    created_at: createdAt,
    ...extra,
  };
}

test('detects first touch drop when client sent one message and disappeared after first reply', () => {
  const state = buildState([
    msg('in', 'customer', 'Здравствуйте, хочу заказать', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Здравствуйте! Отличный выбор.', '2026-05-16T10:01:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
  });

  assert.equal(state.drop_stage, 'first_touch_drop');
  assert.equal(state.expected_action, 'reply_any');
  assert.equal(state.followup_attempted, false);
});

test('does not mark first touch drop before timeout', () => {
  const state = buildState([
    msg('in', 'customer', 'Здравствуйте, хочу заказать', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Здравствуйте! Отличный выбор.', '2026-05-16T10:01:00Z'),
  ], {
    now: '2026-05-16T11:00:00Z',
  });

  assert.equal(state.drop_stage, 'none');
  assert.equal(state.blocked_reason, 'timeout_not_reached');
});

test('detects sizing drop when agent waits for size or insole and client goes silent', () => {
  const state = buildState([
    msg('in', 'customer', 'Хочу заказать Nike Dunk', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Какой размер нужен и какая длина стельки в см? Так точнее подберем.', '2026-05-16T10:01:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
  });

  assert.equal(state.drop_stage, 'sizing_drop');
  assert.equal(state.expected_action, 'send_size');
});

test('clears sizing expectation when client sends only centimeters', () => {
  const state = buildState([
    msg('in', 'customer', 'Хочу заказать Nike Dunk', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Какой размер нужен и какая длина стельки в см? Так точнее подберем.', '2026-05-16T10:01:00Z'),
    msg('in', 'customer', '28 см', '2026-05-16T10:03:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
  });

  assert.equal(state.drop_stage, 'none');
  assert.equal(state.expected_action, 'none');
});

test('detects checkout drop when order form data is still incomplete', () => {
  const state = buildState([
    msg('in', 'customer', 'Оформим', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Для оформления заказа отправьте ФИО, номер телефона, город, службу доставки и адрес ПВЗ.', '2026-05-16T10:01:00Z'),
    msg('in', 'customer', 'Ижевск, Ozon', '2026-05-16T10:05:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
  });

  assert.equal(state.drop_stage, 'checkout_drop');
  assert.equal(state.expected_action, 'send_checkout_data');
  assert.deepEqual(state.evidence.checkout_missing.sort(), ['address', 'fio', 'phone'].sort());
});

test('does not mark checkout drop when data is complete in customer facts', () => {
  const state = buildState([
    msg('in', 'customer', 'Оформим', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Для оформления заказа отправьте ФИО, номер телефона, город, службу доставки и адрес ПВЗ.', '2026-05-16T10:01:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
    facts: {
      fio: 'Галиев Салават Рафисович',
      phone: '89992281030',
      city: 'Ижевск',
      delivery_service: 'Ozon',
      delivery_address: 'г. Ижевск, ул. Азина 135',
    },
  });

  assert.equal(state.drop_stage, 'none');
  assert.equal(state.blocked_reason, 'checkout_data_complete');
});

test('detects payment drop when реквизиты are sent in several separate messages', () => {
  const state = buildState([
    msg('in', 'customer', 'Да, все верно', '2026-05-16T16:38:00Z'),
    msg('out', 'assistant', 'Сумма к оплате: 9980 ₽', '2026-05-16T16:39:00Z'),
    msg('out', 'assistant', 'Способ оплаты: Перевод на карту', '2026-05-16T16:39:10Z'),
    msg('out', 'assistant', 'Реквизиты: 2200702127378995', '2026-05-16T16:39:20Z'),
    msg('out', 'assistant', 'Получатель: Мадина.И', '2026-05-16T16:39:30Z'),
    msg('out', 'assistant', 'Банк: Т-Банк', '2026-05-16T16:39:40Z'),
    msg('out', 'assistant', 'Жду ваш чек после перевода!', '2026-05-16T16:39:50Z'),
  ], {
    now: '2026-05-16T18:30:00Z',
  });

  assert.equal(state.drop_stage, 'payment_drop');
  assert.equal(state.expected_action, 'send_payment_confirmation');
});

test('clears payment drop when client sends receipt document', () => {
  const state = buildState([
    msg('in', 'customer', 'Да, все верно', '2026-05-16T16:38:00Z'),
    msg('out', 'assistant', 'Сумма к оплате: 9980 ₽', '2026-05-16T16:39:00Z'),
    msg('out', 'assistant', 'Реквизиты: 2200702127378995', '2026-05-16T16:39:20Z'),
    msg('out', 'assistant', 'Жду ваш чек после перевода!', '2026-05-16T16:39:50Z'),
    msg('in', 'customer', '[document]', '2026-05-16T16:42:00Z', {
      raw: {
        document: {
          file_name: 'receipt_15.05.2026.pdf',
        },
      },
    }),
  ], {
    now: '2026-05-16T18:30:00Z',
  });

  assert.equal(state.drop_stage, 'none');
  assert.equal(state.expected_action, 'none');
  assert.equal(state.blocked_reason, 'paid_or_done');
});

test('marks followup_attempted when manager already touched the dialog after open expectation', () => {
  const state = buildState([
    msg('in', 'customer', 'Хочу заказать Nike SB', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Какой размер нужен и какая длина стельки в см? Так точнее подберем.', '2026-05-16T10:01:00Z'),
    msg('out', 'operator', 'Какой размер вас интересует?', '2026-05-16T15:19:00Z'),
  ], {
    now: '2026-05-16T18:00:00Z',
  });

  assert.equal(state.drop_stage, 'sizing_drop');
  assert.equal(state.followup_attempted, true);
  assert.equal(state.followup_actor, 'manager');
});

test('prefers specific expectation over generic first reply', () => {
  const state = buildState([
    msg('in', 'customer', 'Хочу заказать', '2026-05-16T10:00:00Z'),
    msg('out', 'assistant', 'Какой размер нужен и какая длина стельки в см? Так точнее подберем.', '2026-05-16T10:01:00Z'),
  ], {
    now: '2026-05-16T13:30:00Z',
  });

  assert.equal(state.expected_action, 'send_size');
  assert.notEqual(state.drop_stage, 'first_touch_drop');
});
