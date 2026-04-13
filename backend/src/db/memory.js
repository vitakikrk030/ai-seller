const db = require('../db');

// ── Extraction patterns ──

const PHONE_RE = /(\+?[78][\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2})/;
const SIZE_RE = /\b(3[5-9]|4[0-9]|5[0-2])\b/;
const INSOLE_RE = /(\d{2}[.,]\d)\s*(?:см|cm|стельк)/i;
const CITY_RE = /(?:город|г\.?|city)\s*[:\-]?\s*([А-ЯЁа-яё\s\-]{2,30})/i;

const KNOWN_CITIES = [
  'Москва', 'Санкт-Петербург', 'Питер', 'СПб', 'Новосибирск', 'Екатеринбург',
  'Казань', 'Нижний Новгород', 'Краснодар', 'Челябинск', 'Самара', 'Уфа',
  'Ростов-на-Дону', 'Красноярск', 'Омск', 'Воронеж', 'Пермь', 'Волгоград',
  'Тюмень', 'Саратов', 'Тольятти', 'Барнаул', 'Ижевск', 'Ульяновск',
  'Хабаровск', 'Махачкала', 'Иркутск', 'Томск', 'Сочи', 'Калининград',
];
const CITY_SET = new Set(KNOWN_CITIES.map(c => c.toLowerCase()));

const BRANDS = [
  'Nike', 'Adidas', 'Puma', 'Jordan', 'New Balance', 'Reebok', 'Asics',
  'Converse', 'Vans', 'Salomon', 'Under Armour', 'Balenciaga', 'Yeezy',
  'Travis Scott', 'Dunk', 'Air Max', 'Air Force', 'Yung',
];
const BRAND_RE = new RegExp(`\\b(${BRANDS.join('|')})\\b`, 'i');

const SHOE_TYPES = [
  'кроссовки', 'кроссы', 'кеды', 'ботинки', 'слипоны', 'сандали',
  'кроссовок', 'кед', 'беговые', 'баскетбольные', 'зимние', 'летние',
];
const SHOE_TYPE_RE = new RegExp(`(${SHOE_TYPES.join('|')})`, 'i');

/**
 * Extract structured data from a text message.
 * Returns only fields that were found (partial object).
 */
function extractFromText(text) {
  if (!text || typeof text !== 'string') return {};
  const data = {};

  // Phone
  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch) data.phone = phoneMatch[1].replace(/[\s\-()]/g, '');

  // Shoe size (only standalone 2-digit numbers in range)
  const sizeMatch = text.match(SIZE_RE);
  if (sizeMatch) data.shoe_size = sizeMatch[1];

  // Insole cm
  const insoleMatch = text.match(INSOLE_RE);
  if (insoleMatch) data.insole_cm = insoleMatch[1].replace(',', '.');

  // City — from explicit pattern or known cities list
  const cityExplicit = text.match(CITY_RE);
  if (cityExplicit) {
    data.city = cityExplicit[1].trim();
  } else {
    // Check if any known city appears in text
    const lower = text.toLowerCase();
    for (const city of KNOWN_CITIES) {
      if (lower.includes(city.toLowerCase())) {
        data.city = city;
        break;
      }
    }
  }

  // Brand
  const brandMatch = text.match(BRAND_RE);
  if (brandMatch) data.preferred_brand = brandMatch[1];

  // Shoe type
  const typeMatch = text.match(SHOE_TYPE_RE);
  if (typeMatch) data.shoe_type = typeMatch[1].toLowerCase();

  // Full name — from form-like messages (ФИО pattern: 2-3 capitalized words before phone)
  if (phoneMatch) {
    const beforePhone = text.substring(0, text.indexOf(phoneMatch[0])).trim();
    const nameCandidate = beforePhone.replace(/[,;]+$/, '').trim();
    if (nameCandidate.length >= 3 && nameCandidate.length <= 80) {
      // Check it looks like a name (has at least 2 words starting with uppercase)
      const words = nameCandidate.split(/\s+/);
      const capitalized = words.filter(w => /^[А-ЯЁA-Z]/.test(w));
      if (capitalized.length >= 2) {
        data.full_name = nameCandidate;
      }
    }
  }

  // Address — text after phone number (if long enough)
  if (phoneMatch) {
    const afterPhone = text.substring(text.indexOf(phoneMatch[0]) + phoneMatch[0].length).trim();
    const addr = afterPhone.replace(/^[,;.\s]+/, '').trim();
    if (addr.length >= 10) {
      data.address = addr;
      // Also try to extract city from address
      if (!data.city) {
        for (const city of KNOWN_CITIES) {
          if (addr.toLowerCase().includes(city.toLowerCase())) {
            data.city = city;
            break;
          }
        }
      }
    }
  }

  return data;
}

// ── Database operations ──

const memory = {
  /**
   * Get customer memory for a user.
   */
  async get(userId) {
    const result = await db.query(
      'SELECT * FROM customer_memory WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  },

  /**
   * Upsert customer memory. Only updates non-null fields.
   * Existing data is preserved if new value is not provided.
   */
  async update(userId, data) {
    const fields = ['full_name', 'phone', 'city', 'address', 'shoe_size', 'insole_cm', 'preferred_brand', 'shoe_type', 'behavior', 'notes', 'last_order_summary', 'total_spent', 'order_count'];
    const updates = {};
    for (const f of fields) {
      if (data[f] !== undefined && data[f] !== null && data[f] !== '') {
        updates[f] = data[f];
      }
    }
    if (Object.keys(updates).length === 0) return await memory.get(userId);

    // UPSERT: insert or update only provided fields
    const existing = await memory.get(userId);
    if (!existing) {
      const cols = ['user_id', ...Object.keys(updates), 'updated_at'];
      const vals = [userId, ...Object.values(updates), new Date()];
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
      await db.query(
        `INSERT INTO customer_memory (${cols.join(', ')}) VALUES (${placeholders})`,
        vals
      );
    } else {
      // Merge behavior JSONB if updating behavior
      if (updates.behavior && typeof updates.behavior === 'object' && existing.behavior) {
        updates.behavior = { ...existing.behavior, ...updates.behavior };
      }
      const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      setClauses.push(`updated_at = NOW()`);
      const vals = [userId, ...Object.values(updates)];
      await db.query(
        `UPDATE customer_memory SET ${setClauses.join(', ')} WHERE user_id = $1`,
        vals
      );
    }
    return await memory.get(userId);
  },

  /**
   * Validate extracted data — reject garbage values.
   */
  validateExtracted(data) {
    const clean = { ...data };
    // Phone: must be 10-12 digits
    if (clean.phone && !/^\+?\d{10,12}$/.test(clean.phone)) delete clean.phone;
    // Size: must be in valid range
    if (clean.shoe_size) {
      const s = parseInt(clean.shoe_size, 10);
      if (isNaN(s) || s < 35 || s > 52) delete clean.shoe_size;
    }
    // Insole: must be realistic (22-33 cm)
    if (clean.insole_cm) {
      const v = parseFloat(clean.insole_cm);
      if (isNaN(v) || v < 22 || v > 33) delete clean.insole_cm;
    }
    // City: min 2 chars, no digits
    if (clean.city && (clean.city.length < 2 || /\d/.test(clean.city))) delete clean.city;
    // Full name: min 3 chars
    if (clean.full_name && clean.full_name.length < 3) delete clean.full_name;
    // Address: min 10 chars
    if (clean.address && clean.address.length < 10) delete clean.address;
    return clean;
  },

  /**
   * Extract data from a user message and save to memory.
   * Called after every user message. Only saves if data was found.
   */
  async extractAndSave(userId, text) {
    const raw = extractFromText(text);
    const extracted = memory.validateExtracted(raw);
    if (Object.keys(extracted).length === 0) return null;
    return await memory.update(userId, extracted);
  },

  /**
   * Save form data from the sales flow (handleWaitingForm).
   */
  async saveFormData(userId, { fullName, phone, address }) {
    const data = {};
    if (fullName) data.full_name = fullName;
    if (phone) data.phone = phone;
    if (address) data.address = address;
    return await memory.update(userId, data);
  },

  /**
   * Save order data to memory (after order creation).
   * Updates last_order_summary, shoe_size, brand, total_spent, order_count.
   */
  async saveOrderData(userId, { product, size, brand, price }) {
    const data = {};
    if (size) data.shoe_size = size;
    if (brand) data.preferred_brand = brand;
    if (product) {
      const brandMatch = product.match(BRAND_RE);
      if (brandMatch && !data.preferred_brand) {
        data.preferred_brand = brandMatch[1];
      }
    }
    // Last order summary
    data.last_order_summary = {
      product: product || null,
      size: size || null,
      price: price || null,
      date: new Date().toISOString(),
    };
    // Increment totals
    const existing = await memory.get(userId);
    data.order_count = ((existing?.order_count) || 0) + 1;
    if (price) {
      data.total_spent = (Number(existing?.total_spent) || 0) + Number(price);
    }
    return await memory.update(userId, data);
  },

  /**
   * Update behavior data (response_speed, price_sensitive, etc.)
   */
  async updateBehavior(userId, behaviorData) {
    return await memory.update(userId, { behavior: behaviorData });
  },

  /**
   * Delete memory for a user.
   */
  async deleteByUser(userId) {
    await db.query('DELETE FROM customer_memory WHERE user_id = $1', [userId]);
  },

  /**
   * Check if customer has full delivery data.
   */
  hasFullDeliveryData(mem) {
    if (!mem) return false;
    return !!(mem.full_name && mem.phone && mem.address);
  },

  /**
   * Check if customer is VIP (2+ orders, or total_spent > 10000).
   */
  isVIP(mem) {
    if (!mem) return false;
    if ((mem.order_count || 0) >= 2) return true;
    if ((mem.total_spent || 0) >= 10000) return true;
    return false;
  },

  /**
   * Generate AI "next action" recommendation based on state + memory.
   */
  getNextAction(user, mem) {
    const state = user?.state || 'NEW';
    const hasData = memory.hasFullDeliveryData(mem);
    const isReturn = (mem?.order_count || 0) >= 1;
    const beh = mem?.behavior || {};

    switch (state) {
      case 'NEW':
        if (isReturn && mem?.preferred_brand) return `Вернувшийся клиент → предложи ${mem.preferred_brand}, размер ${mem.shoe_size || '?'}`;
        return 'Новый клиент → узнай что ищет';
      case 'WAITING_SIZE':
        if (mem?.shoe_size) return `Знаем размер ${mem.shoe_size} → уточни и двигай к оформлению`;
        return 'Ждём размер → помоги определиться';
      case 'WAITING_FORM':
        if (hasData) return 'Данные уже есть → предложи использовать прошлые';
        return 'Ждём данные → запроси ФИО, телефон, адрес';
      case 'WAITING_PAYMENT':
        if (beh.often_disappears) return 'Клиент часто пропадает → быстрый дожим';
        return 'Ждём оплату → мягко напомни';
      case 'PAID':
        return 'Оплачено → поблагодари, предложи ещё';
      case 'DONE':
        if (isReturn) return 'Вернулся → используй память, ускоряй заказ';
        return 'Завершён → реактивируй если вернулся';
      default:
        return null;
    }
  },

  /**
   * Build a context string for AI prompt from customer memory.
   */
  buildContextForAI(mem) {
    if (!mem) return '';
    const parts = [];

    if (mem.full_name) parts.push(`Имя: ${mem.full_name}`);
    if (mem.phone) parts.push(`Телефон: ${mem.phone}`);
    if (mem.city) parts.push(`Город: ${mem.city}`);
    if (mem.address) parts.push(`Адрес: ${mem.address}`);
    if (mem.shoe_size) parts.push(`Размер обуви: ${mem.shoe_size}`);
    if (mem.insole_cm) parts.push(`Стелька: ${mem.insole_cm} см`);
    if (mem.preferred_brand) parts.push(`Любимый бренд: ${mem.preferred_brand}`);
    if (mem.shoe_type) parts.push(`Тип обуви: ${mem.shoe_type}`);

    // Last order context for repeat sales
    if (mem.last_order_summary) {
      const lo = mem.last_order_summary;
      const loParts = [];
      if (lo.product) loParts.push(lo.product);
      if (lo.size) loParts.push(`р.${lo.size}`);
      if (lo.price) loParts.push(`${lo.price}₽`);
      if (lo.date) loParts.push(new Date(lo.date).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' }));
      parts.push(`Последний заказ: ${loParts.join(', ')}`);
    }

    if (mem.order_count > 0) parts.push(`Кол-во заказов: ${mem.order_count}`);
    if (mem.total_spent > 0) parts.push(`Общая сумма покупок: ${mem.total_spent}₽`);

    const beh = mem.behavior || {};
    if (beh.response_speed) parts.push(`Скорость ответов: ${beh.response_speed}`);
    if (beh.price_sensitive) parts.push('Чувствителен к цене — предлагай выгодные варианты, акции');
    if (beh.often_disappears) parts.push('Часто пропадает — дожимай быстрее, не тяни');

    if (mem.notes) parts.push(`Заметки: ${mem.notes}`);

    // Full delivery data flag
    if (memory.hasFullDeliveryData(mem)) {
      parts.push('✅ Есть полные данные доставки — НЕ спрашивай заново');
    }
    // VIP flag
    if (memory.isVIP(mem)) {
      parts.push('⭐ VIP клиент — повторный покупатель');
    }

    return parts.join('\n');
  },

  // Expose for testing
  extractFromText,
};

module.exports = memory;
