/**
 * Decision Engine — на основе intent + state + memory + heat
 * принимает решение о следующем действии.
 *
 * Actions:
 *   generate_response   — вызвать AI для генерации ответа
 *   funnel_guard        — запросить недостающие данные воронки
 *   escalate_manager    — передать менеджеру
 *   send_fallback       — отправить fallback без AI
 *   upsell              — предложить более дорогой товар
 *   pushdown            — усилить дожим
 *   repeat_sale         — предложить повторную покупку
 */

const aiSettings = require('../db/ai_settings');

// ═══════════════════════════════════════
// FUNNEL GUARD — жёсткий контроль воронки
// ═══════════════════════════════════════

/**
 * Проверить что воронка не пропускает шаги.
 * Возвращает { blocked: true, reason, action } если нужно заблокировать.
 */
async function funnelGuard(user, intent, memory) {
  const state = user.state;

  // WAITING_FORM: нельзя двигаться без данных доставки
  if (state === 'WAITING_FORM') {
    const hasData = memory && memory.full_name && memory.phone;
    if (!hasData && intent !== 'confirmation' && intent !== 'complaint') {
      const askAddress = await aiSettings.get('speech_ask_address').catch(() => null);
      return {
        blocked: true,
        reason: 'missing_delivery_data',
        action: 'send_fallback',
        fallback: askAddress,
      };
    }
  }

  // WAITING_SIZE: нельзя двигаться без размера
  if (state === 'WAITING_SIZE') {
    if (intent === 'offtopic' || intent === 'greeting') {
      const askSize = await aiSettings.get('speech_ask_size').catch(() => null);
      return {
        blocked: true,
        reason: 'missing_size',
        action: 'send_fallback',
        fallback: askSize,
      };
    }
  }

  // WAITING_PAYMENT: нельзя уйти без оплаты
  if (state === 'WAITING_PAYMENT') {
    if (intent === 'offtopic') {
      const reminder = await aiSettings.get('speech_reminder_payment').catch(() => null);
      return {
        blocked: true,
        reason: 'pending_payment',
        action: 'send_fallback',
        fallback: reminder,
      };
    }
  }

  return { blocked: false };
}

// ═══════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════

/**
 * Принять решение о следующем действии.
 *
 * @param {object} params
 * @param {object} params.user
 * @param {string} params.intent
 * @param {string} params.intentConfidence
 * @param {object} params.memory
 * @param {string} params.heatLevel — 'hot' | 'warm' | 'cold'
 * @param {number} params.msgCount
 * @param {object} params.lastOrder
 * @returns {Promise<{ action: string, meta: object }>}
 */
async function decide({ user, intent, intentConfidence, memory, heatLevel, msgCount, lastOrder }) {
  const state = user.state;

  // 1. Жалоба / возврат → всегда менеджеру
  if (intent === 'complaint') {
    return { action: 'escalate_manager', meta: { reason: 'complaint' } };
  }

  // 2. Funnel Guard
  const guard = await funnelGuard(user, intent, memory);
  if (guard.blocked) {
    return { action: guard.action, meta: { reason: guard.reason, fallback: guard.fallback } };
  }

  // 3. Готов купить → быстро к оформлению
  if (intent === 'ready_to_buy') {
    return { action: 'generate_response', meta: { priority: 'close_deal', hint: 'Клиент готов купить. Немедленно переходи к оформлению заказа.' } };
  }

  // 4. Подтверждение оплаты
  if (intent === 'payment_confirm' && state === 'WAITING_PAYMENT') {
    return { action: 'generate_response', meta: { priority: 'confirm_payment' } };
  }

  // 5. Сомнение → дожим
  if (intent === 'doubt') {
    const pushdownThreshold = parseFloat(await aiSettings.getRaw('pushdown_price_threshold').catch(() => '0')) || 0;
    const orderPrice = lastOrder?.price || 0;
    const shouldPushdown = pushdownThreshold === 0 || orderPrice >= pushdownThreshold;

    if (shouldPushdown) {
      return {
        action: 'generate_response',
        meta: {
          priority: 'pushdown',
          hint: 'Клиент сомневается. Используй дефицит, социальное доказательство, прямой вопрос "Берёшь?"',
        },
      };
    }
  }

  // 6. Upsell — если цена ниже порога
  const useUpsell = await aiSettings.isEnabled('toggle_upsell').catch(() => false);
  if (useUpsell && lastOrder?.price) {
    const upsellThreshold = parseFloat(await aiSettings.getRaw('upsell_threshold').catch(() => '8000')) || 8000;
    if (lastOrder.price < upsellThreshold && (intent === 'product_question' || intent === 'ready_to_buy')) {
      return {
        action: 'generate_response',
        meta: {
          priority: 'upsell',
          hint: `Цена товара ${lastOrder.price}₽ ниже порога ${upsellThreshold}₽. Предложи более дорогой вариант.`,
        },
      };
    }
  }

  // 7. Повторный заказ
  if (intent === 'repeat_order' || (state === 'DONE' && memory?.order_count > 0)) {
    return {
      action: 'generate_response',
      meta: {
        priority: 'repeat_sale',
        hint: 'Повторный клиент. Используй историю покупок, предложи новинки или то же самое.',
      },
    };
  }

  // 8. Горячий клиент → усиленный дожим
  if (heatLevel === 'hot' && ['WAITING_SIZE', 'WAITING_PAYMENT'].includes(state)) {
    return {
      action: 'generate_response',
      meta: {
        priority: 'hot_close',
        hint: 'Горячий клиент. Закрывай сделку прямо сейчас.',
      },
    };
  }

  // 9. Оффтоп → редирект
  if (intent === 'offtopic') {
    return { action: 'send_fallback', meta: { reason: 'offtopic', type: 'offtopic_redirect' } };
  }

  // 10. По умолчанию — генерация
  return { action: 'generate_response', meta: { priority: 'default' } };
}

module.exports = { decide, funnelGuard };
