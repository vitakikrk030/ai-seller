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

function extractRubAmount(text = '') {
  const match = String(text || '').match(/(?:^|[^\d])(\d[\d\s]{2,})(?:\s*₽|\s*руб(?:\.|лей|ля)?)/iu);
  return match ? match[1].replace(/\s+/g, '').trim() : '';
}

function extractExplicitSizeSignal(text = '') {
  const source = String(text || '');
  const sizeMatch = source.match(/(?:^|[\s,;])(?:размер(?:\s*[:\-])?\s*|size\s*[:\-]?\s*)(3[5-9]|4\d|50)(?=$|[\s,;.!?])/iu)
    || source.match(/(?:^|[\s,;])(3[5-9]|4\d|50)\s*размер(?=$|[\s,;.!?])/iu);
  const insoleMatch = source.match(/\b(\d{1,2}(?:[.,]\d+)?)\s*см\b/iu);
  return {
    shoe_size: sizeMatch ? String(sizeMatch[1]).trim() : '',
    insole_cm: insoleMatch ? String(insoleMatch[1]).replace(',', '.').trim() : '',
  };
}

function extractVolumeMl(text = '') {
  const match = String(text || '').match(/(?:^|[^\d])(\d{2,4})\s*мл(?=$|[^a-zа-яё])/iu);
  return match ? String(match[1]).trim() : '';
}

function inferProductCategory({ facts = {}, inputText = '', productName = '' }) {
  const explicit = String(
    facts.product_category
    || facts.category
    || facts.product_type
    || '',
  ).trim().toLowerCase();
  if (explicit) {
    if (/(обув|shoe|sneaker|кроссов|кед|ботин|тапк|сланц|ugg|boots?)/i.test(explicit)) return 'footwear';
    if (/(одеж|clothing|apparel|hoodie|t-?shirt|tee|футбол|худи|куртк|брюк|джинс|шорт|штаны|лонгслив|свитшот|рубашк)/i.test(explicit)) return 'clothing';
    if (/(парф|perfume|fragrance|дух|edp|edt|extrait|cologne)/i.test(explicit)) return 'fragrance';
    if (/(аксесс|accessor|bag|сумк|ремен|рюкзак|cardholder|кошел|очки|шапк|кепк)/i.test(explicit)) return 'accessory';
  }

  const value = `${productName} ${inputText}`.toLowerCase();
  if (/(кроссов|кед|обув|nike|dunk|jordan|new balance|nb 9060|9060|balenciaga|track|runner|3xl|asics|gel-|converse|all star|adidas|yeezy|puma|v5 rnr|pegasus|vomero|boots?|uggs?)/i.test(value)) {
    return 'footwear';
  }
  if (/(парфюм|духи|perfume|parfum|fragrance|аромат|edp|edt|extrait|cologne|\b\d{2,4}\s*мл\b)/i.test(value)) {
    return 'fragrance';
  }
  if (/(hoodie|t-?shirt|tee|футболк|худи|свитшот|лонгслив|куртк|пухов|жилет|брюк|брюки|джинс|шорт|майк|рубашк|поло|ветровк|кофт|олимпийк|штаны)/i.test(value)) {
    return 'clothing';
  }
  if (/(сумк|ремен|рюкзак|кошел|cardholder|картхолдер|очки|шапк|кепк|панам|браслет|цепочк|чехол|аксесс)/i.test(value)) {
    return 'accessory';
  }
  return 'unknown';
}

function categoryLabel(category = '') {
  switch (String(category || '').trim()) {
    case 'footwear': return 'Обувь';
    case 'clothing': return 'Одежда';
    case 'accessory': return 'Аксессуары';
    case 'fragrance': return 'Парфюм';
    default: return 'Не определена';
  }
}

function buildIntentState({ facts = {}, inputText = '', existingDraft = null }) {
  const productId = String(facts.product_id || '').trim();
  const productName = String(facts.product_name || facts.product_interest || '').trim();
  const productLink = String(facts.product_link || facts.link || extractIwakProductLink(inputText) || '').trim();
  const inferredCategory = inferProductCategory({ facts, inputText, productName });
  const fallbackSize = String(facts.size || '').trim();
  const shoeSize = String(facts.shoe_size || (inferredCategory === 'footwear' ? fallbackSize : '') || '').trim();
  const clothingSize = String(facts.clothing_size || (inferredCategory === 'clothing' ? fallbackSize : '') || '').trim();
  const insoleCm = String(facts.insole_cm || '').trim();
  const sizeInsoleCheck = String(facts.size_insole_check || '').trim();
  const productPrice = String(facts.price || '').replace(/\s+/g, '').trim();
  const explicitSignals = extractExplicitSizeSignal(inputText);
  const explicitPrice = extractRubAmount(inputText);
  const volumeMl = String(facts.volume_ml || extractVolumeMl(inputText) || '').trim();

  const parsedItems = parseRawItems(facts.item);
  const activeItem = compactObject({
    product_id: productId,
    product_name: productName,
    product_link: productLink,
    product_category: inferredCategory,
    product_category_label: categoryLabel(inferredCategory),
    product_price: productPrice,
    shoe_size: shoeSize,
    clothing_size: clothingSize,
    insole_cm: insoleCm,
    size_insole_check: sizeInsoleCheck,
    volume_ml: volumeMl,
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
  const currentProductPrice = String(existingIntent.product_price || '').replace(/\s+/g, '').trim();
  const incomingProductName = productName.toLowerCase();

  const productChanged = Boolean(
    (productId && currentProductId && productId !== currentProductId)
    || (!productId && incomingProductName && currentProductName && incomingProductName !== currentProductName)
  );

  const hasProductSignal = Boolean(productId || productName || productLink || items.length);
  const hasSizeSignal = Boolean(shoeSize || clothingSize || insoleCm);
  const explicitSizeForCurrentMessage = Boolean(
    (explicitSignals.shoe_size && explicitSignals.shoe_size === shoeSize)
    || (explicitSignals.insole_cm && explicitSignals.insole_cm === insoleCm)
  );
  const explicitPriceForCurrentMessage = Boolean(
    explicitPrice && (explicitPrice === productPrice || !productPrice)
  );

  const productStatus = hasProductSignal ? 'confirmed' : '';
  const sizeStatus = productChanged && hasSizeSignal
    ? (explicitSizeForCurrentMessage ? 'confirmed' : 'obsolete')
    : hasSizeSignal
      ? 'confirmed'
      : '';
  const priceStatus = productChanged && (productPrice || currentProductPrice)
    ? (explicitPriceForCurrentMessage || (productPrice && productPrice !== currentProductPrice) ? 'confirmed' : 'obsolete')
    : productPrice
      ? 'confirmed'
      : '';
  const multiItem = items.length > 1;
  const normalizedProductPrice = priceStatus === 'obsolete' ? '' : productPrice;
  const missing = [];
  if (!hasProductSignal) missing.push('product');
  if (inferredCategory === 'footwear' && !shoeSize) missing.push('shoe_size');
  if (inferredCategory === 'clothing' && !clothingSize) missing.push('clothing_size');
  const completeness = !hasProductSignal
    ? 'missing'
    : missing.length
      ? 'partial'
      : 'complete';

  return {
    intentData: compactObject({
      ...activeItem,
      product_price: normalizedProductPrice,
      items,
      item_count: items.length ? String(items.length) : '',
      product_status: productStatus,
      size_status: sizeStatus,
      price_status: priceStatus,
      completeness,
      missing_fields: missing,
      multi_item: multiItem ? 'true' : '',
    }),
    meta: compactObject({
      product_changed: productChanged ? 'true' : '',
      previous_product_id: productChanged ? currentProductId : '',
      previous_product_name: productChanged ? String(existingIntent.product_name || '') : '',
      previous_product_price: productChanged ? currentProductPrice : '',
      product_category: inferredCategory,
      intent_completeness: completeness,
      intent_missing: missing.join(','),
      multi_item_detected: multiItem ? 'true' : '',
    }),
    productChanged,
    multiItem,
  };
}

module.exports = {
  compactObject,
  extractIwakProductLink,
  extractRubAmount,
  extractExplicitSizeSignal,
  extractVolumeMl,
  inferProductCategory,
  categoryLabel,
  buildIntentState,
  parseRawItems,
};
