const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIntentState,
  parseRawItems,
} = require('../lib/order-intent-detector');

test('parseRawItems extracts multiple numbered order items', () => {
  const items = parseRawItems(`
1. New Balance 9060 Brown, 38 размер, 25 см
2. Nike V5 RNR White Metallic Pewter, 38 размер, 25 см
  `);

  assert.deepEqual(items, ['New Balance 9060 Brown', 'Nike V5 RNR White Metallic Pewter']);
});

test('buildIntentState marks multi item order and keeps items list', () => {
  const state = buildIntentState({
    facts: {
      item: `
1. New Balance 9060 Brown, 38 размер, 25 см
2. Nike V5 RNR White Metallic Pewter, 38 размер, 25 см
      `,
      product_name: 'Nike V5 RNR White Metallic Pewter',
      product_id: '222',
      shoe_size: '38',
    },
  });

  assert.equal(state.multiItem, true);
  assert.equal(state.intentData.multi_item, 'true');
  assert.equal(state.intentData.item_count, '2');
  assert.equal(state.intentData.items.length, 2);
});

test('buildIntentState marks previous size obsolete when product changes', () => {
  const state = buildIntentState({
    facts: {
      product_id: '999',
      product_name: 'Balenciaga 3XL',
      shoe_size: '44',
    },
    existingDraft: {
      intent_data: {
        product_id: '837',
        product_name: 'Nike Dunk Low',
        shoe_size: '44',
      },
    },
  });

  assert.equal(state.productChanged, true);
  assert.equal(state.intentData.size_status, 'obsolete');
  assert.equal(state.meta.previous_product_id, '837');
});

test('buildIntentState clears stale price when product changes without new price signal', () => {
  const state = buildIntentState({
    facts: {
      product_id: '999',
      product_name: 'Balenciaga 3XL',
      price: '3990',
    },
    existingDraft: {
      intent_data: {
        product_id: '837',
        product_name: 'Nike Dunk Low',
        product_price: '3990',
      },
    },
  });

  assert.equal(state.productChanged, true);
  assert.equal(state.intentData.price_status, 'obsolete');
  assert.equal(state.intentData.product_price, undefined);
  assert.equal(state.meta.previous_product_price, '3990');
});

test('buildIntentState keeps fresh size and price when they arrive with the new product message', () => {
  const state = buildIntentState({
    facts: {
      product_id: '999',
      product_name: 'Balenciaga 3XL',
      shoe_size: '45',
      price: '5500',
    },
    inputText: 'Хочу заказать Balenciaga 3XL, 45 размер, 5500 ₽',
    existingDraft: {
      intent_data: {
        product_id: '837',
        product_name: 'Nike Dunk Low',
        shoe_size: '44',
        product_price: '3990',
      },
    },
  });

  assert.equal(state.productChanged, true);
  assert.equal(state.intentData.size_status, 'confirmed');
  assert.equal(state.intentData.price_status, 'confirmed');
  assert.equal(state.intentData.product_price, '5500');
});
