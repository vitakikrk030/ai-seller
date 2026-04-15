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
const aiSettings = require('../db/ai_settings');

// States: NEW -> WAITING_SIZE -> WAITING_FORM -> WAITING_PAYMENT -> PAID -> DONE

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
  const cbCheck = await safety.shouldCallAI(user.state);
  if (!cbCheck.allowed) return cbCheck.fallback;

  const productContext = (catalogAvailable && products.length > 0)
    ? shop.formatForAI(products)
    : null;

  const aiText = await generateResponse(user, text, { productContext, catalogAvailable });

  const { valid, response, reason } = validateResponse(aiText, products, catalogAvailable);

  if (!valid) {
    return getSafeFallback(shop.getStatus(), reason);
  }

  return response;
}

async function processMessage(user, text) {
  const lower = text.toLowerCase().trim();

  // Off-topic detection (only in conversational states)
  if (['NEW', 'DONE'].includes(user.state)) {
    const { offtopic, redirect } = await detectOfftopic(text);
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

  // If size already mentioned in first message — try to find product directly in text
  const sizeInText = text.match(/\b(\d{2})\b/) || text.match(/\b(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i);
  if (sizeInText && wantsToBuy) {
    const { available, status, products } = await fetchCatalog();
    if (available && products.length > 0) {
      const match = shop.findProductInText(text, products);
      if (match && match.confidence !== 'none' && match.product && match.product.price) {
        // Product found directly in first message — create order and go to WAITING_FORM
        const size = sizeInText[1];
        const product = match.product;
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
        memory.saveOrderData(user.id, { product: product.name, size, brand: null, price: product.price }).catch(() => {});
        const askAddress = await aiSettings.get('speech_ask_address') || 'Скинь одним сообщением: ФИО, телефон и адрес доставки 📝';
        const orderSummary = await aiSettings.get('speech_order_summary') || 'Отлично! Записал:';
        return `${orderSummary}\n👟 ${product.name}\n📏 Размер: ${size}\n💰 Стоимость: ${product.price}₽\n\n${askAddress}`;
      }
    }
    // Product not found in text — go to WAITING_SIZE as usual
    await users.updateState(user.id, 'WAITING_SIZE');
    const freshUser = await users.getById(user.id);
    return handleWaitingSize(freshUser, text, lower);
  }

  const { available, products } = await fetchCatalog();

  if (isInfo && !lower.match(/nike|adidas|puma|jordan|кросс/i)) {
    return safeAIResponse(user, text, products, available);
  }

  if (wantsToBuy) {
    const matched = available ? await shop.searchProducts(text) : [];
    const hasRelevant = matched.length > 0 && matched.length < (products || []).length;

    if (hasRelevant) {
      const response = await safeAIResponse(user, text, matched, available);
      await users.updateState(user.id, 'WAITING_SIZE');
      return response;
    }

    await users.updateState(user.id, 'WAITING_SIZE');
    if (available && products.length > 0) {
      const aiPrompt = `Клиент ищет: "${text}". Покажи похожие варианты из каталога, НЕ говори что товара нет. Предложи выбрать и спроси размер.`;
      return safeAIResponse(user, aiPrompt, products, available);
    }
    return aiSettings.pickSoftResponse();
  }

  if (isHesitating && available && products.length > 0) {
    return safeAIResponse(user, text, products, available);
  }

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

    const history = await messages.getHistory(user.id, 10);
    const recentTexts = [text, ...history.map((m) => m.text)].join(' ');
    const match = shop.findProductInText(recentTexts, products);

    if (!match || match.confidence === 'none') {
      const top3 = products.slice(0, 3);
      const listing = top3.map((p) => `• ${p.name} — ${p.price ? p.price + '₽' : 'цена по запросу'}`).join('\n');
      const sizeRecorded = await aiSettings.get('speech_size_recorded') || 'Размер {{size}} — записал';
      const askSize = await aiSettings.get('speech_ask_size') || 'Какой размер носишь? Подберу';
      const intro = sizeRecorded.replace('{{size}}', size);
      return `${intro} 👍\n\nГляну что есть под этот размер:\n${listing}\n\nКакой из них оставляем?`;
    }

    if (match.confidence === 'low') {
      const p = match.product;
      const tpl = await aiSettings.get('speech_size_confirm_low')
        || 'Размер {{size}} — отлично! Вы имеете в виду {{product}} за {{price}}? Подтвердите, и оформим заказ';
      return tpl
        .replace('{{size}}', size)
        .replace('{{product}}', p.name)
        .replace('{{price}}', p.price ? p.price + '₽' : 'цену уточню') + ' 👍';
    }

    const product = match.product;
    if (!product.price) {
      const tpl = await aiSettings.get('speech_price_clarify')
        || '{{product}} — отличный выбор. Уточняю цену, скоро скину. Размер {{size}} — верно?';
      return tpl.replace('{{product}}', product.name).replace('{{size}}', size);
    }

    if (product.available === false) {
      const alternatives = products.filter((p) => p.available !== false && p.id !== product.id).slice(0, 3);
      if (alternatives.length > 0) {
        const listing = alternatives.map((p) => `• ${p.name} — ${p.price ? p.price + '₽' : 'цена по запросу'}`).join('\n');
        const tpl = await aiSettings.get('speech_stock_check')
          || '{{product}} — огонь выбор. Сейчас уточню наличие. А пока глянь похожие:';
        return `${tpl.replace('{{product}}', product.name)} 🔥\n${listing}\n\nКакой больше нравится?`;
      }
      const tpl = await aiSettings.get('speech_stock_check_no_alt')
        || '{{product}} — отличный вкус. Уточняю наличие, скоро отвечу. Какой размер нужен?';
      return tpl.replace('{{product}}', product.name);
    }

    // Create order transactionally
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

    memory.saveOrderData(user.id, { product: product.name, size, brand: null, price: product.price }).catch(() => {});

    const askAddress = await aiSettings.get('speech_ask_address') || 'Скинь одним сообщением: ФИО, телефон и адрес доставки 📝';
    const orderSummary = await aiSettings.get('speech_order_summary') || 'Отлично! Записал:';
    return `${orderSummary}\n👟 ${product.name}\n📏 Размер: ${size}\n💰 Стоимость: ${product.price}₽\n\n${askAddress}`;
  }

  const { available, products } = await fetchCatalog();
  return safeAIResponse(user, text, products, available);
}

async function handleWaitingForm(user, text, lower) {
  const customerMem = await memory.get(user.id).catch(() => null);
  if (memory.hasFullDeliveryData(customerMem)) {
    const confirmYes = ['да', 'ок', 'окей', 'ага', 'угу', 'конечно', 'давай', 'подтверж', 'те же', 'тот же', 'прошлые', 'старые', 'как раньше', 'как прошлый'];
    if (confirmYes.some(kw => lower.includes(kw))) {
      text = `${customerMem.full_name} ${customerMem.phone} ${customerMem.address}`;
    }
  }

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
      const restart = await aiSettings.get('speech_restart') || 'Давай начнём заново — что хотите заказать?';
      return restart;
    }

    if (!order.price) {
      return await aiSettings.get('fallback_price_error') || 'Уточняю цену на этот товар. Подскажи, какой именно интересует 🙏';
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE orders SET full_name = $1, phone = $2, address = $3 WHERE id = $4',
        [fullName, phone, address, order.id]
      );
      await client.query('UPDATE users SET state = $1 WHERE id = $2', ['WAITING_PAYMENT', user.id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    memory.saveFormData(user.id, { fullName, phone, address }).catch(() => {});

    const [cardNumber, bankName, receiverName] = await Promise.all([
      settings.get('payment_card_number'),
      settings.get('payment_bank_name'),
      settings.get('payment_receiver_name'),
    ]);
    const paymentRequest = await aiSettings.get('speech_payment_request') || 'Спасибо! Данные записаны ✅ Сейчас отправлю реквизиты для оплаты 💳';
    const afterPayment = await aiSettings.get('speech_after_payment_hint') || 'После оплаты отправьте скриншот или чек 📸';

    // Only send payment if card number is set (required field)
    if (cardNumber) {
      return {
        text: `${paymentRequest}\n\n📦 Ваш заказ:\n👟 ${order.product}\n📏 Размер: ${order.size}\n💰 К оплате: ${order.price}₽\n\n${afterPayment}`,
        sendPayment: {
          cardNumber,
          cardName: receiverName || 'Не указан',
          bankName: bankName || null,
          receiverName: receiverName || null,
          amount: order.price,
          telegramId: user.telegram_id,
        },
      };
    }

    return `${paymentRequest}\n\n📦 Ваш заказ:\n👟 ${order.product}\n📏 Размер: ${order.size}\n💰 К оплате: ${order.price}₽\n\nДля оплаты свяжитесь с менеджером 💬`;
  }

  return await aiSettings.get('speech_ask_address') || 'Скинь одним сообщением: ФИО, телефон и адрес доставки — и сразу оформим 🚀';
}

async function handleWaitingPayment(user, text, lower) {
  const payKeywords = ['оплатил', 'перевел', 'перевёл', 'отправил', 'оплата', 'скрин', 'чек'];
  const confirmedPay = payKeywords.some((kw) => lower.includes(kw));

  if (confirmedPay) {
    const order = await orders.getLatestByUser(user.id);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET state = $1 WHERE id = $2', ['PAID', user.id]);
      if (order) {
        await client.query('UPDATE orders SET status = $1, paid_at = NOW() WHERE id = $2', ['PAID', order.id]);
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

    return await aiSettings.get('speech_payment_confirm') || '✅ Отлично! Заказ оформлен!\n\nМы проверим оплату и отправим заказ как можно скорее. Спасибо за покупку! 🎉';
  }

  const hesitationKeywords = ['дорого', 'подумаю', 'потом', 'не уверен', 'сомнева'];
  const isHesitating = hesitationKeywords.some((kw) => lower.includes(kw));

  if (isHesitating) {
    const order = await orders.getLatestByUser(user.id);
    if (order) {
      const pushdown = await aiSettings.get('speech_pushdown') || 'Размеры тают быстро — оформляем? 🔥';
      const tpl = await aiSettings.get('speech_hesitation_pushdown')
        || 'Понимаю. Но {{product}} — это реально крутой выбор.';
      return `${tpl.replace('{{product}}', order.product)} 😊 ${pushdown}`;
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
 * Process a photo message.
 */
async function processPhoto(user, imageUrl, caption) {
  const { available, status, products } = await fetchCatalog();

  const vision = await analyzeImage(imageUrl);

  if (!vision || !vision.keywords) {
    if (caption) {
      return processMessage(user, caption);
    }
    if (available && products.length > 0) {
      const aiPrompt = `Клиент прислал фото кроссовок. Покажи подходящие варианты из каталога. НЕ говори что не распознал. Предложи выбрать и спроси размер.`;
      if (['NEW', 'DONE'].includes(user.state)) {
        await users.updateState(user.id, 'WAITING_SIZE');
      }
      return safeAIResponse(user, aiPrompt, products, available);
    }
    return await aiSettings.pickSoftResponse();
  }

  if (!available) {
    const desc = [vision.brand, vision.model, vision.color].filter(Boolean).join(' ');
    const soft = await aiSettings.pickSoftResponse();
    return desc ? `Понял, ${desc} 👍 ${soft}` : soft;
  }

  const searchQuery = caption ? `${vision.keywords} ${caption}` : vision.keywords;
  const matched = await shop.searchProducts(searchQuery);
  const hasRelevant = matched.length > 0 && matched.length < products.length;

  const desc = [vision.brand, vision.model].filter(Boolean).join(' ');
  const colorHint = vision.color ? `, цвет: ${vision.color}` : '';

  if (hasRelevant) {
    const context = matched.slice(0, 5);
    const aiPrompt = desc
      ? `Клиент прислал фото кроссовок (${desc}${colorHint}). Вот подходящие товары из каталога. Покажи их и предложи выбрать размер.`
      : `Клиент прислал фото кроссовок${colorHint}. Вот подходящие товары из каталога. Покажи их и предложи выбрать размер.`;

    const response = await safeAIResponse(user, aiPrompt, context, available);

    if (['NEW', 'DONE'].includes(user.state)) {
      await users.updateState(user.id, 'WAITING_SIZE');
    }

    return response;
  }

  if (desc) {
    const listing = shop.formatForAI(products.slice(0, 5));
    if (['NEW', 'DONE'].includes(user.state)) {
      await users.updateState(user.id, 'WAITING_SIZE');
    }
    const soft = await aiSettings.pickSoftResponse();
    const photoRecognized = await aiSettings.get('speech_photo_recognized') || 'Понял, {{desc}}. Какой размер носишь?';
    const intro = photoRecognized.replace('{{desc}}', `${desc}${colorHint}`);
    return `${intro} 👍\n${soft}\n\nВот что сейчас есть:\n${listing}`;
  }

  if (['NEW', 'DONE'].includes(user.state)) {
    await users.updateState(user.id, 'WAITING_SIZE');
  }
  const listing = shop.formatForAI(products.slice(0, 5));
  if (listing) {
    const soft = await aiSettings.pickSoftResponse();
    const photoNotRecognized = await aiSettings.get('speech_photo_not_recognized') || 'Хороший выбор! Вот что сейчас есть:';
    return `${photoNotRecognized}\n${listing}\n\nКакой размер носишь?`;
  }
  return await aiSettings.pickSoftResponse();
}

module.exports = { processMessage, processPhoto, notifyOwnerNewOrder };
