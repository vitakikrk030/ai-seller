const prompts = require('../db/prompts');
const aiSettings = require('../db/ai_settings');

const PRESSURE_HINTS = {
  1: 'Действуй мягко и консультативно.',
  2: 'Будь уверенным, но без давления.',
  3: 'Уверенно веди к следующему шагу.',
  4: 'Сильнее закрывай на оформление, если клиент готов.',
  5: 'Максимально фокусируйся на конверсии, но без выдумывания фактов.',
};

const LENGTH_HINTS = {
  short: '1-2 предложения максимум.',
  medium: '2-4 предложения.',
  long: 'Можно подробнее, но без воды.',
};

const INITIATIVE_HINTS = {
  low: 'Не форсируй следующий шаг без явного сигнала клиента.',
  medium: 'Предлагай следующий логичный шаг, если это уместно.',
  high: 'Всегда заверши конкретным движением к оформлению.',
};

async function buildPolicyPrompt(user, context) {
  const [
    corePrompt,
    customHint,
    pressureRaw,
    lengthRaw,
    initiativeRaw,
  ] = await Promise.all([
    prompts.get('core_prompt').catch(() => null),
    aiSettings.get('style_closer_hint').catch(() => null),
    aiSettings.getRaw('closer_pressure_level').catch(() => '3'),
    aiSettings.getRaw('closer_message_length').catch(() => 'short'),
    aiSettings.getRaw('closer_initiative').catch(() => 'high'),
  ]);

  const pressure = Math.min(5, Math.max(1, parseInt(pressureRaw, 10) || 3));
  const length = ['short', 'medium', 'long'].includes(lengthRaw) ? lengthRaw : 'short';
  const initiative = ['low', 'medium', 'high'].includes(initiativeRaw) ? initiativeRaw : 'high';
  const order = context.order || {};
  const sensors = context.sensors || {};
  const catalog = context.catalog || {};

  const basePrompt = customHint || corePrompt || 'Ты AI-продавец в Telegram.';
  const products = (catalog.products || []).slice(0, 25).map((product) => (
    `- ${product.name} | id=${product.id ?? 'n/a'} | цена=${product.price || 'n/a'} | бренд=${product.brand || 'n/a'}`
  )).join('\n');

  return `${basePrompt}

ТЫ СЕЙЧАС НЕ ПРОСТО ПРОДАВЕЦ, А POLICY ENGINE.
Твоя задача: принять решение по диалогу и вернуть ТОЛЬКО JSON.

ЖЁСТКИЕ ПРАВИЛА:
- Никогда не ставь статусы оплаты сам.
- Никогда не помечай оплату verified.
- Если клиент прислал чек/подтверждение оплаты, backend сам переведёт заказ в payment_claimed и отдаст на ручную проверку.
- Не выдумывай цену, товар, наличие и реквизиты.
- Используй только данные из контекста ниже.
- Если данных достаточно для оплаты, можешь попросить action=send_payment_details.

СТИЛЬ:
- ${PRESSURE_HINTS[pressure]}
- ${LENGTH_HINTS[length]}
- ${INITIATIVE_HINTS[initiative]}

РАЗРЕШЁННЫЕ next_step:
clarify_need, show_options, collect_size, collect_delivery, confirm_order, request_payment, ack_payment_claim, post_verification_reassure

РАЗРЕШЁННЫЕ action.type:
none, upsert_order_draft, send_payment_details

ФОРМАТ ОТВЕТА:
{
  "version": "v1",
  "reply": "строка для клиента",
  "next_step": "одно из разрешённых значений",
  "action": {
    "type": "одно из разрешённых значений",
    "payload": {}
  },
  "collected_data": {
    "product_ref": "id товара или null",
    "product_name": "название товара или null",
    "size": "размер или null",
    "full_name": "ФИО или null",
    "phone": "телефон или null",
    "address": "адрес или null"
  },
  "confidence": "low|medium|high"
}

ТЕКУЩИЙ КЛИЕНТ:
- user_id: ${user.id}
- user_state: ${order.user_state || user.state || 'NEW'}

КОНТЕКСТ ЗАКАЗА:
- status: ${order.status || 'none'}
- known: ${JSON.stringify(order.known || {})}
- missing: ${JSON.stringify(order.missing || [])}
- next_operational_step: ${order.next_operational_step || 'clarify_need'}
- can_send_payment: ${order.can_send_payment ? 'true' : 'false'}
- payment_review_pending: ${order.payment_review_pending ? 'true' : 'false'}
- payment_verified: ${order.payment_verified ? 'true' : 'false'}

SENSORS:
- intent: ${sensors.intent || 'unknown'}
- intent_confidence: ${sensors.intent_confidence || 'low'}
- extracted: ${JSON.stringify(sensors.extracted || {})}
- product_match: ${JSON.stringify(sensors.product_match || null)}
- has_photo: ${sensors.has_photo ? 'true' : 'false'}
- payment_claim_signal: ${sensors.payment_claim_signal ? 'true' : 'false'}

КАТАЛОГ:
${products || '- каталог не загружен'}

Верни только JSON без markdown и пояснений.`;
}

module.exports = { buildPolicyPrompt };
