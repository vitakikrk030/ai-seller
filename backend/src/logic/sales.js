const users = require('../db/users');
const orders = require('../db/orders');
const db = require('../db');
const bot = require('../telegram/bot');
const settings = require('../db/settings');
const messages = require('../db/messages');
const memory = require('../db/memory');
const { generateResponse } = require('../ai');
const shop = require('../shop');
const { validateResponse, getSafeFallback } = require('../ai/validator');
const { detectOfftopic } = require('../ai/offtopic');
const { analyzeImage } = require('../ai/vision');
const safety = require('../ai/safety');

// States: NEW -> WAITING_SIZE -> WAITING_FORM -> WAITING_PAYMENT -> PAID -> DONE

// SOFT_AVAILABILITY_MODE: никогда не говорим "нет товара", всегда ведём к продаже
const SOFT_RESPONSES = [
  'Понял, сейчас гляну по наличию 👀 Если именно этой нет — подберу максимально похожие. Какой размер нужен?',
  'Хороший выбор 👍 Сейчас проверю наличие. Если что — есть очень похожие варианты. Размер какой?',
  'Норм модель 🔥 Гляну что есть. А пока скажи — какой размер носишь?',
];

function getSoftResponse() {
  return SOFT_RESPONSES[Math.floor(Math.random() * SOFT_RESPONSES.length)];
}

const PHONE_RE = /(\+?\d[\d\s\-()]{8,})/;
const DELIVERY_QUESTION_RE = /бесплатн|доставк|пвз|пункт выдачи|пункт|ozon|wb|вайлдберриз|яндекс|почта|cdek|сдэк|курьер/i;

function isDeliveryQuestion(text) {
  return DELIVERY_QUESTION_RE.test(text || '');
}

// Temporary canonical delivery truth for the current sales contour.
// If delivery starts differing by channel/product/region, move this into the
// existing data/settings layer instead of adding another prompt or logic layer.
function getDeliveryTruth() {
  return 'Да — у нас бесплатная доставка до удобного ПВЗ: Яндекс Доставка, Ozon, WB, Почта России или CDEK. После оплаты оформляем накладную, дальше отслеживание идет в приложении выбранной службы. Если срочно по Москве — можем курьером до двери, но это уже доп. оплата.';
}

function normalizeSizes(sizes) {
  if (Array.isArray(sizes)) {
    return sizes.map((size) => String(size).trim()).filter(Boolean);
  }
  if (typeof sizes === 'string') {
    return sizes.split(',').map((size) => size.trim()).filter(Boolean);
  }
  return [];
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return 'цену уточню';
  return `${value} ₽`;
}

function buildSizeStep(product) {
  const sizes = normalizeSizes(product?.sizes);
  const sizePrompt = sizes.length > 0
    ? `Какой размер берёте: ${sizes.join(' / ')}?`
    : 'Какой размер берёте?';

  return `Отлично — оформляем ${product.name} за ${formatMoney(product.price)}. ${sizePrompt}`;
}

function buildCheckoutPrompt(order) {
  const sizeLine = order?.size ? `${order.size} записал.` : 'Размер записал.';
  const totalLine = order?.price ? `\n\nИтого: ${formatMoney(order.price)}.` : '';

  return `Отлично — ${sizeLine}\nНапомню: у нас бесплатная доставка.\nНапишите, пожалуйста:\nФИО\nГород\nНомер телефона${totalLine}`;
}

function parseCheckoutForm(text, user) {
  const prepared = String(text || '').replace(/\r/g, '\n');
  const extracted = memory.validateExtracted(memory.extractFromText(prepared));
  const parts = prepared
    .split(/\n|[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const phone = extracted.phone || (prepared.match(PHONE_RE)?.[1] || '').replace(/[\s\-()]/g, '');
  const nonPhoneParts = parts.filter((part) => !PHONE_RE.test(part));

  let fullName = extracted.full_name || null;
  let city = extracted.city || null;
  let address = extracted.address || null;

  if (nonPhoneParts.length >= 1) fullName = nonPhoneParts[0];
  if (!city && nonPhoneParts.length >= 2) city = nonPhoneParts[1];
  if (!address && nonPhoneParts.length >= 3) address = nonPhoneParts.slice(2).join(', ');

  return {
    fullName: (fullName || user.name || 'Не указано').trim(),
    phone: phone.trim(),
    city: (city || '').trim(),
    address: (address || '').trim(),
  };
}

/**
 * Get catalog + status. Single entry point for catalog access.
 */
async function fetchCatalog() {
  return shop.getCatalog();
}

/**
 * Generate AI response with validation.
 * If AI fabricates data — returns safe fallback instead.
 */
async function safeAIResponse(user, text, products, catalogAvailable) {
  // Circuit breaker: if AI keeps failing, don't even call it
  const cbCheck = safety.shouldCallAI(user.state);
  if (!cbCheck.allowed) return cbCheck.fallback;

  const productContext = (catalogAvailable && products.length > 0)
    ? shop.formatForAI(products)
    : null;

  const aiText = await generateResponse(user, text, { productContext, catalogAvailable });

  const { valid, response, reason } = validateResponse(aiText, products, catalogAvailable);

  if (!valid) {
    // AI validation failed, use fallback
    return getSafeFallback(shop.getStatus(), reason);
  }

  return response;
}

async function processMessage(user, text) {
  const lower = text.toLowerCase().trim();

  // Off-topic detection (only in conversational states, not during data collection)
  if (['NEW', 'DONE'].includes(user.state)) {
    const { offtopic, redirect } = detectOfftopic(text);
    if (offtopic && redirect) {
      return redirect;
    }
  }

  switch (user.state) {
    case 'NEW':
      return handleNew(user, text, lower);

    case 'WAITING_SIZE':
      return handleWaitingSize(user, text, lower);

    case 'WAITING_FORM':
      return handleWaitingForm(user, text, lower);

    case 'WAITING_PAYMENT':
      return handleWaitingPayment(user, text, lower);

    case 'PAID':
      return handlePaid(user, text, lower);

    case 'DONE':
      return handleDone(user, text, lower);

    default: {
      const { available, products } = await fetchCatalog();
      return safeAIResponse(user, text, products, available);
    }
  }
}

async function handleNew(user, text, lower) {
  const buyKeywords = ['купить', 'заказать', 'хочу', 'цена', 'сколько', 'размер', 'есть', 'оформ', 'закаж', 'беру', 'давай', 'го ', 'берём', 'берем'];
  const infoKeywords = ['как заказать', 'как купить', 'как оформить', 'как оплатить', 'как это работает'];
  const hesitationKeywords = ['дорого', 'подумаю', 'потом', 'не знаю', 'может быть', 'не уверен'];
  const wantsToBuy = buyKeywords.some((kw) => lower.includes(kw));
  const isInfo = infoKeywords.some((kw) => lower.includes(kw));
  const isHesitating = hesitationKeywords.some((kw) => lower.includes(kw));

  const { available, products } = await fetchCatalog();

  // Info questions — answer but DON'T change state
  if (isInfo && !lower.match(/nike|adidas|puma|jordan|кросс/i)) {
    return safeAIResponse(user, text, products, available);
  }

  if (isDeliveryQuestion(lower)) {
    return getDeliveryTruth();
  }

  if (wantsToBuy) {
    // Search for relevant products
    const matched = available ? await shop.searchProducts(text) : [];
    const hasRelevant = matched.length > 0 && (matched.length < (products || []).length || matched.length === 1);

    if (hasRelevant) {
      await users.updateState(user.id, 'WAITING_SIZE');

      const directMatch = shop.findProductInText(text, matched);
      const chosenProduct = (directMatch && ['high', 'medium'].includes(directMatch.confidence))
        ? directMatch.product
        : (matched.length === 1 ? matched[0] : null);

      if (chosenProduct) {
        return buildSizeStep(chosenProduct);
      }

      return safeAIResponse(user, text, matched, available);
    }

    // SOFT MODE: no exact match or catalog down — soft transition, never say "нет"
    await users.updateState(user.id, 'WAITING_SIZE');
    if (available && products.length > 0) {
      // Show alternatives through AI without saying "not found"
      const aiPrompt = `Клиент ищет: "${text}". Покажи похожие варианты из каталога, НЕ говори что товара нет. Предложи выбрать и спроси размер.`;
      return safeAIResponse(user, aiPrompt, products, available);
    }
    return getSoftResponse();
  }

  // Hesitation handling — nudge toward purchase
  if (isHesitating && available && products.length > 0) {
    return safeAIResponse(user, text, products, available);
  }

  // General conversation — safe AI with catalog if available
  return safeAIResponse(user, text, products, available);
}

async function handleWaitingSize(user, text, lower) {
  if (isDeliveryQuestion(lower)) {
    return getDeliveryTruth();
  }

  const sizeMatch = text.match(/\b(\d{2})\b/) || text.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i);

  if (sizeMatch) {
    const size = sizeMatch[1];
    const { available, status, products } = await fetchCatalog();
    if (!available || products.length === 0) {
      return getSafeFallback(status);
    }

    // Find product from conversation history
    const history = await messages.getHistory(user.id, 10);
    const recentTexts = history.map((m) => m.text).join(' ');

    const match = shop.findProductInText(recentTexts, products);

    if (!match || match.confidence === 'none') {
      // SOFT MODE: can't determine — show options without saying "can't find"
      const top3 = products.slice(0, 3);
      const listing = top3.map((p) => `• ${p.name} — ${p.price ? p.price + '₽' : 'цена по запросу'}`).join('\n');
      return `Размер ${size} — записал 👍\n\nГляну что есть под этот размер:\n${listing}\n\nКакой из них оставляем?`;
    }

    if (match.confidence === 'low') {
      // Low confidence — ask to confirm
      const p = match.product;
      return `Размер ${size} — отлично! Вы имеете в виду ${p.name} за ${p.price ? p.price + '₽' : 'цену уточню'}? Подтвердите, и оформим заказ 👍`;
    }

    // High/medium confidence — check price
    const product = match.product;
    if (!product.price) {
      return `${product.name} — отличный выбор 👍 Уточняю цену, скоро скину. Размер ${size} — верно?`;
    }

    if (product.available === false) {
      // SOFT MODE: product unavailable — redirect to alternatives
      const alternatives = products.filter((p) => p.available !== false && p.id !== product.id).slice(0, 3);
      if (alternatives.length > 0) {
        const listing = alternatives.map((p) => `• ${p.name} — ${p.price ? p.price + '₽' : 'цена по запросу'}`).join('\n');
        return `${product.name} — огонь выбор 🔥 Сейчас уточню наличие. А пока глянь похожие:\n${listing}\n\nКакой больше нравится?`;
      }
      return `${product.name} — отличный вкус 👍 Уточняю наличие, скоро отвечу. Какой размер нужен?`;
    }

    // Create order with REAL product and price from catalog (transactional)
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO orders (user_id, product, size, price, status) VALUES ($1, $2, $3, $4, $5)',
        [user.id, product.name, size, product.price, 'NEW']
      );
      await client.query('UPDATE users SET state = $1 WHERE id = $2', ['WAITING_FORM', user.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Save size + brand + price to customer memory (non-blocking)
    memory.saveOrderData(user.id, { product: product.name, size, brand: null, price: product.price }).catch(() => {});

    return buildCheckoutPrompt({ product: product.name, size, price: product.price });
  }

  // AI helps pick size (with catalog data)
  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function handleWaitingForm(user, text, lower) {
  if (isDeliveryQuestion(lower)) {
    return getDeliveryTruth();
  }

  // Returning customer: check if memory has full data and user confirms
  const customerMem = await memory.get(user.id).catch(() => null);
  if (memory.hasFullDeliveryData(customerMem)) {
    const confirmYes = ['да', 'ок', 'окей', 'ага', 'угу', 'конечно', 'давай', 'подтверж', 'те же', 'тот же', 'прошлые', 'старые', 'как раньше', 'как прошлый'];
    if (confirmYes.some(kw => lower.includes(kw))) {
      // Use saved data
      text = `${customerMem.full_name}\n${customerMem.city || customerMem.address}\n${customerMem.phone}`;
    }
  }

  const parsed = parseCheckoutForm(text, user);
  const hasCheckoutData = !!(parsed.fullName && parsed.phone && (parsed.city || parsed.address));

  if (hasCheckoutData) {
    let order = await orders.getLatestByUser(user.id);
    if (!order) {
      // Should not happen — order should exist from handleWaitingSize
      return 'Давай начнём заново — что хотите заказать? 😊';
    }

    // Validate order has product and price before proceeding to payment
    if (!order.price) {
      return 'Уточняю цену на этот товар. Подскажи, какой именно интересует — пересчитаем 🙏';
    }

    // Transactional — update order + user state together
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE orders SET full_name = $1, phone = $2, address = $3 WHERE id = $4',
        [parsed.fullName, parsed.phone, parsed.address || parsed.city, order.id]
      );
      await client.query('UPDATE users SET state = $1 WHERE id = $2', ['WAITING_PAYMENT', user.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Save form data to customer memory (non-blocking)
    memory.saveFormData(user.id, {
      fullName: parsed.fullName,
      phone: parsed.phone,
      city: parsed.city,
      address: parsed.address || parsed.city,
    }).catch(() => {});

    const cardNumber = await settings.get('payment_card_number');
    const cardName = await settings.get('payment_name');

    if (cardNumber) {
      return {
        text: `Спасибо! Данные записаны ✅\n\n📦 Ваш заказ:\n👟 ${order.product}\n📏 Размер: ${order.size}\n💰 К оплате: ${order.price}₽\n\nСейчас отправлю реквизиты для оплаты 💳`,
        sendPayment: {
          cardNumber,
          cardName: cardName || 'Не указан',
          amount: order.price,
          telegramId: user.telegram_id,
        },
      };
    }

    return `Спасибо! Данные записаны ✅\n\n📦 Ваш заказ:\n👟 ${order.product}\n📏 Размер: ${order.size}\n💰 К оплате: ${order.price}₽\n\nДля оплаты свяжитесь с менеджером 💬`;
  }

  const order = await orders.getLatestByUser(user.id);
  if (!order) return 'Напишите, пожалуйста:\nФИО\nГород\nНомер телефона';
  return buildCheckoutPrompt(order);
}

async function handleWaitingPayment(user, text, lower) {
  if (isDeliveryQuestion(lower)) {
    return getDeliveryTruth();
  }

  const payKeywords = ['оплатил', 'перевел', 'перевёл', 'отправил', 'оплата', 'скрин', 'чек'];
  const confirmedPay = payKeywords.some((kw) => lower.includes(kw));

  if (confirmedPay) {
    const order = await orders.getLatestByUser(user.id);
    // Transactional state + order status update
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET state = $1 WHERE id = $2', ['PAID', user.id]);
      if (order) {
        await client.query('UPDATE orders SET status = $1 WHERE id = $2', ['PAID', order.id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (order) {
      const updatedOrder = await orders.getLatestByUser(user.id);
      await notifyOwnerNewOrder(user, updatedOrder);
    }

    return '✅ Отлично! Заказ оформлен!\n\nМы проверим оплату и отправим заказ как можно скорее. Спасибо за покупку! 🎉';
  }

  // Hesitation/question during payment — gentle nudge
  const hesitationKeywords = ['дорого', 'подумаю', 'потом', 'не уверен', 'сомнева'];
  const isHesitating = hesitationKeywords.some((kw) => lower.includes(kw));

  if (isHesitating) {
    const order = await orders.getLatestByUser(user.id);
    if (order) {
      return `Понимаю 😊 Но ${order.product} — это реально крутой выбор. Оплачивай — завтра уже отправим!`;
    }
  }

  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function handlePaid(user, text, lower) {
  const buyKeywords = ['купить', 'заказать', 'хочу', 'ещё', 'еще', 'новый'];
  const wantsMore = buyKeywords.some((kw) => lower.includes(kw));

  if (wantsMore) {
    await users.updateState(user.id, 'NEW');
    const freshUser = await users.getById(user.id);
    return handleNew(freshUser, text, lower);
  }

  await users.updateState(user.id, 'DONE');
  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function handleDone(user, text, lower) {
  const buyKeywords = ['купить', 'заказать', 'хочу', 'ещё', 'еще', 'новый'];
  const wantsMore = buyKeywords.some((kw) => lower.includes(kw));

  if (wantsMore) {
    await users.updateState(user.id, 'NEW');
    const freshUser = await users.getById(user.id);
    return handleNew(freshUser, text, lower);
  }

  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function notifyOwnerNewOrder(user, order) {
  // Escape HTML to prevent injection via user-supplied data
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const priceStr = order.price ? `\n💰 Цена: ${esc(order.price)}₽` : '';
  const text = `🆕 <b>Новый заказ #${order.id}</b>\n\n👤 ${esc(order.full_name || user.name)}\n📞 ${esc(order.phone || 'не указан')}\n📍 ${esc(order.address || 'не указан')}\n👟 ${esc(order.product)}\n📏 Размер: ${esc(order.size)}${priceStr}\n📋 Статус: ${order.status}\n\n🔗 Telegram: @${esc(user.username || user.telegram_id)}`;

  try {
    await bot.notifyOwner(text, { parse_mode: 'HTML' });
  } catch (err) {
    console.error('notifyOwner error:', err.message);
  }
}

/**
 * Process a photo message. Uses AI vision to identify product, then searches catalog.
 * Separate flow from text — does not break existing state machine.
 */
async function processPhoto(user, imageUrl, caption) {
  const { available, status, products } = await fetchCatalog();

  // Analyze image with AI vision
  const vision = await analyzeImage(imageUrl);

  if (!vision || !vision.keywords) {
    // SOFT MODE: vision failed — don't say "can't recognize"
    if (caption) {
      return processMessage(user, caption);
    }
    // Soft response + move to selection
    if (available && products.length > 0) {
      const listing = shop.formatForAI(products.slice(0, 5));
      const aiPrompt = `Клиент прислал фото кроссовок. Покажи подходящие варианты из каталога. НЕ говори что не распознал. Предложи выбрать и спроси размер.`;
      if (['NEW', 'DONE'].includes(user.state)) {
        await users.updateState(user.id, 'WAITING_SIZE');
      }
      return safeAIResponse(user, aiPrompt, products, available);
    }
    return 'Понял, норм модель 👍 Сейчас гляну по наличию. Если что — подберу похожие. Какой размер нужен?';
  }

  // Catalog not available — soft wait, don't close dialog
  if (!available) {
    const desc = [vision.brand, vision.model, vision.color].filter(Boolean).join(' ');
    return `Понял${desc ? ', ' + desc : ''} 👍 Сейчас гляну по наличию. Если что — подберу похожие. Какой размер носишь?`;
  }

  // Search catalog by vision keywords
  const searchQuery = caption
    ? `${vision.keywords} ${caption}`
    : vision.keywords;

  const matched = await shop.searchProducts(searchQuery);

  // Check if matched products are relevant (score > 0)
  const hasRelevant = matched.length > 0 && matched.length < products.length;

  const desc = [vision.brand, vision.model].filter(Boolean).join(' ');
  const colorHint = vision.color ? `, цвет: ${vision.color}` : '';

  if (hasRelevant) {
    // Found relevant products — respond with catalog data
    const context = matched.slice(0, 5); // top 5 matches
    const productContext = shop.formatForAI(context);

    const aiPrompt = desc
      ? `Клиент прислал фото кроссовок (${desc}${colorHint}). Вот подходящие товары из каталога. Покажи их и предложи выбрать размер.`
      : `Клиент прислал фото кроссовок${colorHint}. Вот подходящие товары из каталога. Покажи их и предложи выбрать размер.`;

    const response = await safeAIResponse(user, aiPrompt, context, available);

    // Move to WAITING_SIZE if user is in NEW or DONE state
    if (['NEW', 'DONE'].includes(user.state)) {
      await users.updateState(user.id, 'WAITING_SIZE');
    }

    return response;
  }

  // No relevant match in catalog — SOFT MODE: show alternatives, never say "no"
  if (desc) {
    const listing = shop.formatForAI(products.slice(0, 5));
    if (['NEW', 'DONE'].includes(user.state)) {
      await users.updateState(user.id, 'WAITING_SIZE');
    }
    return `Понял, ${desc}${colorHint} 👍\nСейчас гляну по наличию. Если именно этой нет — подберу максимально похожие ✅\n\nВот что сейчас есть:\n${listing}\n\nКакой размер носишь?`;
  }

  // Completely unknown photo — soft response
  if (['NEW', 'DONE'].includes(user.state)) {
    await users.updateState(user.id, 'WAITING_SIZE');
  }
  const listing = shop.formatForAI(products.slice(0, 5));
  if (listing) {
    return `Понял, норм модель 👍 Сейчас гляну что есть. А пока — вот популярные:\n${listing}\n\nКакой размер носишь?`;
  }
  return 'Понял, норм модель 👍 Сейчас гляну по наличию. Если что — подберу похожие. Какой размер нужен?';
}

module.exports = { processMessage, processPhoto, notifyOwnerNewOrder };
