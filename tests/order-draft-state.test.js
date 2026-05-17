const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeOrderSnapshot,
  getDraftStep,
  buildOrderDraftPayload,
} = require('../lib/order-draft-state');

test('normalizeOrderSnapshot maps delivery aliases into stable order fields', () => {
  const normalized = normalizeOrderSnapshot({
    product_name: 'Nike Dunk',
    delivery_city: 'Москва',
    delivery_service: 'Ozon',
    delivery_address: 'ул. Пушкина 1',
    delivery_phone: '89990001122',
    delivery_fio: 'Иван Иванов',
  });

  assert.equal(normalized.city, 'Москва');
  assert.equal(normalized.delivery_service, 'Ozon');
  assert.equal(normalized.delivery_address, 'ул. Пушкина 1');
  assert.equal(normalized.phone, '89990001122');
  assert.equal(normalized.full_name, 'Иван Иванов');
  assert.equal(normalized.product_interest, 'Nike Dunk');
});

test('buildOrderDraftPayload detects payment step once payment template is sent', () => {
  const payload = buildOrderDraftPayload({
    facts: {
      product_id: '837',
      product_name: 'Nike Dunk Low',
      shoe_size: '44',
      delivery_fio: 'Иван Иванов',
      delivery_phone: '89990001122',
      delivery_city: 'Москва',
      delivery_service: 'Ozon',
      delivery_address: 'ул. Пушкина 1',
    },
    currentStage: 'checkout',
    inputText: 'Сумма к оплате: 3990 ₽',
    paymentTemplateSent: true,
    paymentAmount: 3990,
  });

  assert.equal(payload.status, 'active');
  assert.equal(payload.currentStep, 'payment');
  assert.equal(payload.intentData.product_id, '837');
  assert.equal(payload.deliveryData.delivery_city, 'Москва');
  assert.equal(payload.paymentData.payment_amount, '3990');
  assert.equal(payload.paymentData.payment_request_sent, 'true');
});

test('buildOrderDraftPayload detects product change against existing draft', () => {
  const payload = buildOrderDraftPayload({
    facts: {
      product_id: '999',
      product_name: 'Balenciaga 3XL',
    },
    existingDraft: {
      intent_data: {
        product_id: '837',
        product_name: 'Nike Dunk Low',
      },
    },
    inputText: 'https://iwak.ru/product/balenciaga-3xl-999',
  });

  assert.equal(payload.productChanged, true);
  assert.equal(payload.meta.previous_product_id, '837');
});

test('getDraftStep returns support when payment is confirmed', () => {
  const step = getDraftStep({
    intentData: { product_id: '837' },
    deliveryData: { delivery_city: 'Москва' },
    paymentData: { payment_status: 'paid' },
    stage: 'support',
  });

  assert.equal(step, 'support');
});
