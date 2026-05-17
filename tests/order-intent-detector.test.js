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

test('buildIntentState marks footwear partial until shoe size is known', () => {
  const state = buildIntentState({
    facts: {
      product_name: 'Nike Dunk Low',
      product_id: '837',
      category: 'sneakers',
      price: '3990',
    },
    inputText: 'Хочу заказать Nike Dunk Low за 3990 ₽',
  });

  assert.equal(state.intentData.product_category, 'footwear');
  assert.equal(state.intentData.completeness, 'partial');
  assert.deepEqual(state.intentData.missing_fields, ['shoe_size']);
});

test('buildIntentState marks clothing complete with clothing size', () => {
  const state = buildIntentState({
    facts: {
      product_name: 'Stone Island Hoodie',
      product_id: '501',
      category: 'hoodie',
      size: 'L',
    },
    inputText: 'Нужен Stone Island Hoodie, размер L',
  });

  assert.equal(state.intentData.product_category, 'clothing');
  assert.equal(state.intentData.clothing_size, 'L');
  assert.equal(state.intentData.completeness, 'complete');
});

test('buildIntentState does not require size for accessories and keeps fragrance volume', () => {
  const accessoryState = buildIntentState({
    facts: {
      product_name: 'Prada Sunglasses',
      product_id: '777',
      category: 'accessories',
    },
    inputText: 'Нужны очки Prada',
  });
  const fragranceState = buildIntentState({
    facts: {
      product_name: 'Tom Ford Lost Cherry',
      product_id: '778',
      category: 'perfume',
    },
    inputText: 'Tom Ford Lost Cherry 50 мл',
  });

  assert.equal(accessoryState.intentData.product_category, 'accessory');
  assert.equal(accessoryState.intentData.completeness, 'complete');
  assert.equal(fragranceState.intentData.product_category, 'fragrance');
  assert.equal(fragranceState.intentData.volume_ml, '50');
  assert.equal(fragranceState.intentData.completeness, 'complete');
});
