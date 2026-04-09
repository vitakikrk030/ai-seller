const users = require('../db/users');
const orders = require('../db/orders');
const db = require('../db');
const bot = require('../telegram/bot');
const settings = require('../db/settings');
const messages = require('../db/messages');
const { generateResponse } = require('../ai');
const shop = require('../shop');
const { validateResponse, getSafeFallback } = require('../ai/validator');
const { detectOfftopic } = require('../ai/offtopic');
const { analyzeImage } = require('../ai/vision');

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

  if (wantsToBuy) {
    // Search for relevant products
    const matched = available ? await shop.searchProducts(text) : [];
    const hasRelevant = matched.length > 0 && matched.length < (products || []).length;

    if (hasRelevant) {
      // FAST SALE: exact match found — sell immediately
      const response = await safeAIResponse(user, text, matched, available);
      await users.updateState(user.id, 'WAITING_SIZE');
      return response;
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

    // Create order with REAL product and price from catalog
    await orders.create({
      user_id: user.id,
      product: product.name,
      size,
      price: product.price,
    });

    await users.updateState(user.id, 'WAITING_FORM');

    return `Отлично! Записал:\n👟 ${product.name}\n📏 Размер: ${size}\n💰 Стоимость: ${product.price}₽\n\nОсталось чуть-чуть — скинь одним сообщением: ФИО, телефон и адрес доставки 📝`;
  }

  // AI helps pick size (with catalog data)
  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function handleWaitingForm(user, text, lower) {
  const phoneMatch = text.match(/(\+?\d[\d\s\-()]{8,})/);
  const hasPhone = !!phoneMatch;
  const longEnough = text.length > 15;

  if (hasPhone && longEnough) {
    const phone = phoneMatch[1].trim();

    const phoneIndex = text.indexOf(phoneMatch[0]);
    const beforePhone = text.substring(0, phoneIndex).trim().replace(/[,;]+$/, '').trim();
    const afterPhone = text.substring(phoneIndex + phoneMatch[0].length).trim().replace(/^[,;]+/, '').trim();

    const fullName = beforePhone || user.name || 'Не указано';
    const address = afterPhone || 'Не указан';

    let order = await orders.getLatestByUser(user.id);
    if (!order) {
      // Should not happen — order should exist from handleWaitingSize
      return 'Произошла ошибка с заказом. Давайте начнём сначала — что хотите заказать?';
    }

    // Validate order has product and price before proceeding to payment
    if (!order.price) {
      return 'Уточняю цену на этот товар. Подскажи, какой именно интересует — пересчитаем 🙏';
    }

    await db.query(
      'UPDATE orders SET full_name = $1, phone = $2, address = $3 WHERE id = $4',
      [fullName, phone, address, order.id]
    );

    await users.updateState(user.id, 'WAITING_PAYMENT');

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

  return 'Скинь одним сообщением: ФИО, телефон и адрес доставки — и сразу оформим 🚀';
}

async function handleWaitingPayment(user, text, lower) {
  const payKeywords = ['оплатил', 'перевел', 'перевёл', 'отправил', 'оплата', 'скрин', 'чек'];
  const confirmedPay = payKeywords.some((kw) => lower.includes(kw));

  if (confirmedPay) {
    await users.updateState(user.id, 'PAID');

    const order = await orders.getLatestByUser(user.id);
    if (order) {
      const updatedOrder = await orders.updateStatus(order.id, 'PAID');
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
  const priceStr = order.price ? `\n💰 Цена: ${order.price}₽` : '';
  const text = `🆕 <b>Новый заказ #${order.id}</b>\n\n👤 ${order.full_name || user.name}\n📞 ${order.phone || 'не указан'}\n📍 ${order.address || 'не указан'}\n👟 ${order.product}\n📏 Размер: ${order.size}${priceStr}\n📋 Статус: ${order.status}\n\n🔗 Telegram: @${user.username || user.telegram_id}`;

  await bot.notifyOwner(text, { parse_mode: 'HTML' });
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
