const memory = require('../db/memory');
const shop = require('../shop');
const { detectIntent } = require('../ai/intent');

function parseDeliveryForm(text, extracted) {
  if (!text) return null;
  const phone = extracted.phone || null;
  if (!phone) return null;

  const phoneMatch = text.match(/(\+?\d[\d\s\-()]{8,})/);
  if (!phoneMatch) return null;

  const rawPhone = phoneMatch[0];
  const phoneIdx = text.indexOf(rawPhone);
  const beforePhone = text.substring(0, phoneIdx).trim().replace(/[,;]+$/, '').trim();
  const afterPhone = text.substring(phoneIdx + rawPhone.length).trim().replace(/^[,;]+/, '').trim();

  return {
    full_name: extracted.full_name || beforePhone || null,
    phone,
    address: extracted.address || afterPhone || null,
  };
}

function detectPaymentClaim(text) {
  const lower = String(text || '').toLowerCase();
  return /оплат|перев[её]л|чек|квитанц|скрин|скриншот|подтверди оплату/i.test(lower);
}

function normalizeProductMatch(match) {
  if (!match || !match.product) return null;
  return {
    product_ref: match.product.id != null ? String(match.product.id) : null,
    product_name: match.product.name || null,
    price: match.product.price || null,
    brand: match.product.brand || null,
    confidence: match.confidence || 'low',
  };
}

async function collectSensors({ user, text, history = [], catalog, hasPhoto = false }) {
  const extracted = memory.extractFromText(text || '');
  const deliveryForm = parseDeliveryForm(text || '', extracted);
  const combinedText = [text || '', ...history.map((item) => item.text || '')].join(' ');
  const productMatch = catalog?.products?.length
    ? normalizeProductMatch(shop.findProductInText(combinedText, catalog.products))
    : null;
  const mem = await memory.get(user.id).catch(() => null);
  const intentInfo = await detectIntent(text || (hasPhoto ? 'чек фото' : ''), user.state, mem).catch(() => ({
    intent: 'unknown',
    confidence: 'low',
    meta: {},
  }));

  return {
    intent: intentInfo.intent,
    intent_confidence: intentInfo.confidence,
    intent_meta: intentInfo.meta || {},
    has_photo: !!hasPhoto,
    payment_claim_signal: detectPaymentClaim(text),
    product_match: productMatch,
    extracted: {
      size: extracted.shoe_size || null,
      full_name: deliveryForm?.full_name || extracted.full_name || null,
      phone: deliveryForm?.phone || extracted.phone || null,
      address: deliveryForm?.address || extracted.address || null,
      city: extracted.city || null,
      preferred_brand: extracted.preferred_brand || null,
      shoe_type: extracted.shoe_type || null,
      insole_cm: extracted.insole_cm || null,
    },
  };
}

module.exports = {
  collectSensors,
  detectPaymentClaim,
};
