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

function compactOrderItemLabel(raw = '') {
  const text = String(raw || '')
    .replace(/^\d+\.\s*/, '')
    .replace(/\s*[—-]\s*\d[\d\s.,]*\s*₽.*$/i, '')
    .replace(/\s*,\s*\d+\s*размер.*$/iu, '')
    .replace(/\s*,\s*\d+(?:[.,]\d+)?\s*см\s*$/i, '')
    .trim();
  return text;
}

function parseRawItems(value) {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((entry) => parseRawItems(entry));
  }
  if (typeof value === 'object') {
    const objectName = value.name || value.title || value.product_name || value.label || '';
    return objectName ? [String(objectName).trim()] : [];
  }
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed !== value) return parseRawItems(parsed);
  } catch {}

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const numbered = lines.filter((line) => /^\d+\.\s+/.test(line));
  if (numbered.length >= 2) {
    return numbered.map(compactOrderItemLabel).filter(Boolean);
  }
  if (/\|/.test(text)) {
    return text.split(/\s*\|\s*/).map(compactOrderItemLabel).filter(Boolean);
  }
  return [compactOrderItemLabel(text)].filter(Boolean);
}

function buildIntentState({ facts = {}, inputText = '', existingDraft = null }) {
  const productId = String(facts.product_id || '').trim();
  const productName = String(facts.product_name || facts.product_interest || '').trim();
  const productLink = String(facts.product_link || facts.link || extractIwakProductLink(inputText) || '').trim();
  const shoeSize = String(facts.shoe_size || facts.size || '').trim();
  const clothingSize = String(facts.clothing_size || '').trim();
  const insoleCm = String(facts.insole_cm || '').trim();
  const sizeInsoleCheck = String(facts.size_insole_check || '').trim();

  const parsedItems = parseRawItems(facts.item);
  const activeItem = compactObject({
    product_id: productId,
    product_name: productName,
    product_link: productLink,
    shoe_size: shoeSize,
    clothing_size: clothingSize,
    insole_cm: insoleCm,
    size_insole_check: sizeInsoleCheck,
  });

  const items = parsedItems.length
    ? parsedItems.map((name, index) => compactObject({
        index,
        product_name: name,
        is_active: Boolean(productName) && String(name).toLowerCase() === productName.toLowerCase(),
      }))
    : (Object.keys(activeItem).length ? [compactObject({ index: 0, ...activeItem, is_active: true })] : []);

  const existingIntent = existingDraft?.intent_data || {};
  const currentProductId = String(existingIntent.product_id || '').trim();
  const currentProductName = String(existingIntent.product_name || '').trim().toLowerCase();
  const incomingProductName = productName.toLowerCase();

  const productChanged = Boolean(
    (productId && currentProductId && productId !== currentProductId)
    || (!productId && incomingProductName && currentProductName && incomingProductName !== currentProductName)
  );

  const hasProductSignal = Boolean(productId || productName || productLink || items.length);
  const hasSizeSignal = Boolean(shoeSize || clothingSize || insoleCm);

  const productStatus = hasProductSignal ? 'confirmed' : '';
  const sizeStatus = productChanged && hasSizeSignal
    ? 'obsolete'
    : hasSizeSignal
      ? 'confirmed'
      : '';
  const multiItem = items.length > 1;

  return {
    intentData: compactObject({
      ...activeItem,
      items,
      item_count: items.length ? String(items.length) : '',
      product_status: productStatus,
      size_status: sizeStatus,
      multi_item: multiItem ? 'true' : '',
    }),
    meta: compactObject({
      product_changed: productChanged ? 'true' : '',
      previous_product_id: productChanged ? currentProductId : '',
      previous_product_name: productChanged ? String(existingIntent.product_name || '') : '',
      multi_item_detected: multiItem ? 'true' : '',
    }),
    productChanged,
    multiItem,
  };
}

module.exports = {
  compactObject,
  extractIwakProductLink,
  buildIntentState,
  parseRawItems,
};
