const axios = require('axios');
const settings = require('./db/settings');

let _cache = { products: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// Status: 'ok' | 'not_configured' | 'api_error' | 'empty_catalog'
let _lastStatus = 'not_configured';

async function getConfig() {
  const url = await settings.get('shop_api_url');
  const key = await settings.get('shop_api_key');
  return { url: url || null, key: key || null };
}

/**
 * Fetch products. Returns { products: [...], status: string }
 * status: 'ok' | 'not_configured' | 'api_error' | 'empty_catalog'
 */
async function getProducts(forceRefresh = false) {
  if (!forceRefresh && _cache.products && Date.now() - _cache.ts < CACHE_TTL) {
    _lastStatus = _cache.products.length > 0 ? 'ok' : 'empty_catalog';
    return _cache.products;
  }

  const { url, key } = await getConfig();
  if (!url) { _lastStatus = 'not_configured'; return []; }

  try {
    const headers = {};
    if (key) headers.Authorization = `Bearer ${key}`;

    const resp = await axios.get(`${url}/products`, { headers, timeout: 5000 });
    const products = Array.isArray(resp.data) ? resp.data : (resp.data?.products || []);

    _cache = { products, ts: Date.now() };
    _lastStatus = products.length > 0 ? 'ok' : 'empty_catalog';
    return products;
  } catch (err) {
    console.error('Shop API error:', err.message);
    _lastStatus = 'api_error';
    return _cache.products || [];
  }
}

/** Last fetch status */
function getStatus() { return _lastStatus; }

/**
 * Check catalog availability. Returns { available, status, products }
 */
async function getCatalog() {
  const products = await getProducts();
  const status = getStatus();
  return {
    available: status === 'ok' && products.length > 0,
    status,
    products,
  };
}

// ---- FUZZY MATCHING ----

/** Normalize text for matching: lowercase, collapse spaces, remove special chars */
function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').replace(/\s+/g, ' ').trim();
}

/** Extract tokens from text */
function tokenize(str) {
  return normalize(str).split(' ').filter(Boolean);
}

/** Calculate match score between a query and a product (0-100) */
function matchScore(query, product) {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return 0;

  const nameNorm = normalize(product.name || '');
  const catNorm = normalize(product.category || '');
  const brandNorm = normalize(product.brand || '');
  const allText = `${nameNorm} ${catNorm} ${brandNorm}`;

  let matched = 0;
  for (const token of queryTokens) {
    if (token.length < 2) continue; // skip noise
    if (allText.includes(token)) {
      matched++;
    }
  }

  const meaningfulTokens = queryTokens.filter((t) => t.length >= 2).length || 1;
  return Math.round((matched / meaningfulTokens) * 100);
}

/**
 * Smart search: returns products sorted by relevance.
 * Returns top matches with score > 0.
 * Falls back to full catalog if nothing matched.
 */
async function searchProducts(query) {
  const products = await getProducts();
  if (products.length === 0) return [];
  if (!query) return products;

  const scored = products.map((p) => ({ product: p, score: matchScore(query, p) }));
  scored.sort((a, b) => b.score - a.score);

  const matches = scored.filter((s) => s.score > 0);
  if (matches.length > 0) return matches.map((s) => s.product);

  // No matches — return full catalog so AI can suggest alternatives
  return products;
}

/**
 * Find best matching product by text from conversation history.
 * Returns { product, confidence: 'high'|'medium'|'low'|'none' } or null
 */
function findProductInText(text, products) {
  if (!products || products.length === 0 || !text) return null;

  const scored = products.map((p) => ({ product: p, score: matchScore(text, p) }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score === 0) return null;

  let confidence = 'low';
  if (best.score >= 80) confidence = 'high';
  else if (best.score >= 40) confidence = 'medium';

  // If two products have same score, confidence drops
  if (scored.length > 1 && scored[1].score === best.score) {
    confidence = 'low';
  }

  return { product: best.product, confidence };
}

/**
 * Get single product by ID
 */
async function getProduct(productId) {
  const products = await getProducts();
  return products.find((p) => p.id == productId) || null;
}

/**
 * Format products list for AI context (compact text)
 */
function formatForAI(products) {
  if (!products || products.length === 0) return null;

  return products.map((p) => {
    const sizes = Array.isArray(p.sizes) ? p.sizes.join(', ') : (p.sizes || '—');
    const price = p.price ? `${p.price}₽` : 'цена по запросу';
    const stock = p.available === false ? ' [НЕТ В НАЛИЧИИ]' : '';
    return `• ${p.name} — ${price}, размеры: ${sizes}${stock}`;
  }).join('\n');
}

async function isConfigured() {
  const { url } = await getConfig();
  return !!url;
}

function clearCache() {
  _cache = { products: null, ts: 0 };
  _lastStatus = 'not_configured';
}

module.exports = {
  getProducts,
  getCatalog,
  getStatus,
  searchProducts,
  findProductInText,
  getProduct,
  formatForAI,
  isConfigured,
  clearCache,
  normalize,
  tokenize,
  matchScore,
};
