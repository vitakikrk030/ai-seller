require('dotenv').config();

const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');
const express = require('express');
const axios = require('axios');
const { createCustomerStore } = require('./src/customer-store');

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const REQUEST_TIMEOUT_MS = 15000;
const AI_REQUEST_TIMEOUT_MS = 60000;
const MAX_INPUT_TEXT_LENGTH = 4000;
const AI_CONCURRENCY_LIMIT = 25;
const GETFILE_CONCURRENCY_LIMIT = 10;
const SLOT_WAIT_TIMEOUT_MS = 5000;
const SLOT_WAIT_INTERVAL_MS = 25;
const HTTP_BODY_LIMIT = '2mb';
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const LOG_TEXT_LIMIT = 1200;
const AI_DECISION_TRACE_TEXT_LIMIT = 12000;
const AI_DECISION_TRACE_SHORT_LIMIT = 3000;
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_ARCHIVES = 5;
const STT_TIMEOUT_MS = 30000;
const MAX_STT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_RECEIPT_BYTES = 8 * 1024 * 1024;
const PDF_RECEIPT_TEXT_LIMIT = 2500;
const PDF_RENDER_TIMEOUT_MS = 15000;
const PDF_RENDER_DPI = 180;
const RECEIPT_ACK_REPLY = 'Чек получил, спасибо.';
const IWAK_CART_MAX_ITEMS = 20;
const IWAK_CART_FETCH_TIMEOUT_MS = 4500;
const IWAK_CART_PRODUCT_CACHE_TTL_MS = 10 * 60 * 1000;
const IWAK_PRODUCT_API_BASE_URL = (process.env.IWAK_PRODUCT_API_BASE_URL || 'https://iwak.ru/api/products').replace(/\/$/, '');
const DEFAULT_QUALITY_RETURN_TEXT = 'При получении спокойно осмотрите товар. Если что-то не подойдёт, напишите нам — вопрос решим через возврат или обмен по правилам магазина.';
const DEFAULT_STORE_TRUST_TEXT = 'Сейчас работаем только онлайн. Раньше действительно были на Садоводе, но от офлайн-точки отказались: содержание павильона, склада и сотрудников стало сильно дороже, и это отражалось бы на цене товара. Поэтому оставили онлайн-формат, чтобы держать адекватные цены. Заказ оформляем здесь, доставка бесплатная, перед отправкой товар проверяем.';
const DEFAULT_CONTACTS_WEBSITE = 'https://iwak.ru';
const DEFAULT_DELIVERY_TRACKING_TEXT = [
  'Когда клиент спрашивает, как отследить заказ, сначала ориентируйся на выбранную службу доставки. Если служба еще не выбрана или заказ еще не отправлен, коротко объясни: после отправки дадим трек-номер, ссылку или уведомление службы доставки.',
  '',
  'Яндекс Доставка: получатель отслеживает доставку в приложении Яндекс Go или по ссылке из SMS/уведомления. По одному номеру заказа клиент обычно не отслеживает доставку сам; номер нужен поддержке. Если ссылки нет, попроси проверить SMS/уведомления или напиши, что менеджер пришлет ссылку после оформления отправки.',
  '',
  'Ozon: статус смотреть в личном кабинете Ozon в разделе Заказы. Если доставка идет через курьерскую службу, трек-номер находится на странице заказа; по нему можно отслеживать на стороне службы доставки. Для получения в ПВЗ/постамате нужен штрихкод или код из личного кабинета Ozon, а не номер телефона.',
  '',
  'CDEK/СДЭК: отслеживать по номеру накладной/трек-номеру на официальном сайте или в мобильном приложении CDEK. Если трек еще не появился, значит отправление могло быть только создано или еще не передано в СДЭК; не обещай точное время обновления, предложи проверить позже или дождаться сообщения менеджера.',
  '',
  'Почта России: отслеживать по трек-номеру на сайте или в мобильном приложении Почты России. Трек по России обычно состоит из 14 цифр, международный — из 13 символов с латинскими буквами и цифрами. Вводить без пробелов и скобок. Без трек-номера отследить по фамилии или адресу нельзя.',
  '',
  'Не выдумывай трек-номер, ссылку отслеживания, дату прибытия или статус. Если трека/ссылки еще нет в диалоге, честно скажи, что после передачи заказа в службу доставки менеджер пришлет данные для отслеживания.',
].join('\n');
const GREETING_DIALOG_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const TYPING_REFRESH_MS = 4500;
const READ_DELAY_MIN_MS = 1200;
const READ_DELAY_MAX_MS = 3500;
const LONG_REPLY_PART_LIMIT = 1400;
const HUMAN_TYPING_MIN_CPS = 12;
const HUMAN_TYPING_MAX_CPS = 18;
const HUMAN_TYPING_MIN_DELAY_MS = 1600;
const HUMAN_TYPING_MAX_DELAY_MS = 10000;
const MEMORY_RECENT_LIMIT = 20;
const MEMORY_MESSAGES_TTL_DAYS = 7;
const MEMORY_FACTS_TTL_DAYS = 90;
const MEMORY_STATE_TTL_DAYS = 14;
const MEMORY_MAX_MESSAGES = 5000;
const MEMORY_HISTORY_CHAR_LIMIT = 3500;
const BATCH_DEBOUNCE_MS = 3000;
const BATCH_MAX_WINDOW_MS = 6500;
const SIZE_ONLY_FOLLOWUP_DEBOUNCE_MS = 900;
const ORDER_CONTEXT_BATCH_MAX_WINDOW_MS = 9000;
const ORDER_PENDING_REPLY_SETTLE_MS = 5000;
const SEMANTIC_BATCH_DEBOUNCE_MS = 9000;
const SEMANTIC_BATCH_MAX_WINDOW_MS = 15000;
const MULTIPART_RESPONSE_DEBOUNCE_MS = 45000;
const MULTIPART_RESPONSE_MAX_WINDOW_MS = 90000;
const ORDER_CONTEXT_MERGE_GRACE_MS = 3000;
const ORDER_CONTEXT_MERGE_POLL_MS = 120;
const MIN_MEMORY_RECENT_LIMIT = 20;
const MAX_MEMORY_RECENT_LIMIT = 50;
const MIN_BATCH_DEBOUNCE_MS = 0;
const MAX_BATCH_DEBOUNCE_MS = 10000;
const MANAGER_RETURN_DELAY_MS = 180000;
const MIN_MANAGER_RETURN_DELAY_MS = 30000;
const MAX_MANAGER_RETURN_DELAY_MS = 900000;
const MIN_MULTIPART_RESPONSE_DEBOUNCE_MS = 5000;
const MAX_MULTIPART_RESPONSE_DEBOUNCE_MS = 120000;
const MIN_MULTIPART_RESPONSE_MAX_WINDOW_MS = 10000;
const MAX_MULTIPART_RESPONSE_MAX_WINDOW_MS = 600000;
const WEBHOOK_ERROR_GRACE_MS = 15 * 60 * 1000;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || '';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const AUTH_COOKIE_NAME = 'auth';
const AUTH_COOKIE_VALUE = crypto
  .createHash('sha256')
  .update(`${ADMIN_LOGIN}:${ADMIN_PASSWORD}:sai-admin`)
  .digest('hex');
const LOG_BUFFER_LIMIT = 1000;
const TELEGRAM_ALLOWED_UPDATES = [
  'message',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'callback_query',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
];
let activeAiRequests = 0;
let activeGetFileRequests = 0;
let lastSaiRuntimeError = null;
const chatBatches = new Map();
const managerReturnTimers = new Map();
const managerPendingInputs = new Map();
const iwakCartProductCache = new Map();
const runtimeLogs = [];
const logDir = path.join(__dirname, 'logs');
const LOG_FILE_PATH = path.join(logDir, 'runtime.jsonl');
const dataDir = path.join(__dirname, 'data');
const CONFIG_FILE_PATH = path.join(dataDir, 'runtime-config.json');
const MEMORY_FILE_PATH = path.join(dataDir, 'memory.json');
const TRAINING_FILE_PATH = path.join(dataDir, 'training-examples.json');
const SAI_GPT_MEMORY_FILE_PATH = path.join(dataDir, 'sai-gpt-memory.json');
const CUSTOMER_DB_PATH = path.join(dataDir, 'sai.sqlite');
const MAX_TRAINING_EXAMPLES = 200;
const SAI_GPT_MEMORY_MAX_MESSAGES = 200;
const TRAINING_PROMPT_EXAMPLES = 10;
const TRAINING_RELEVANT_PROMPT_EXAMPLES = 6;
const TRAINING_RECENT_PROMPT_EXAMPLES = 4;
const SAI_GPT_CODE_FILE_LIMIT = 500;
const SAI_GPT_CODE_SNIPPET_LIMIT = 8;
const SAI_GPT_CONTEXT_CHAR_LIMIT = 70000;
const SAI_GPT_ALLOWED_CODE_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.md', '.sql']);
const SAI_GPT_CODE_EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'data', 'logs', 'coverage', 'dist', 'build']);
const TRAINING_CATEGORIES = {
  hallucination: {
    label: 'выдумал факт',
    keywords: ['выдум', 'придум', 'факт', 'нет данных', 'не знает', 'ложн', 'обещал', 'срок'],
    rule: 'Не выдумывать факты, сроки, цены, скидки, наличие, реквизиты и действия менеджера. Если данных нет, честно попросить уточнение.',
  },
  repeated_question: {
    label: 'повторно спросил',
    keywords: ['повтор', 'снова', 'уже написал', 'размер', 'фио', 'телефон', 'город', 'пвз', 'адрес'],
    rule: 'Перед вопросом проверять контекст. Если клиент уже дал данные, не спрашивать их повторно, а переходить к следующему недостающему шагу.',
  },
  order_context: {
    label: 'не понял заказ',
    keywords: ['заказ', 'оформ', 'размер', 'стельк', 'фио', 'телефон', 'город', 'доставка', 'пвз', 'адрес'],
    rule: 'Держать путь заказа: товар/размер, ФИО, телефон, город, служба доставки, ПВЗ или адрес, потом оплата и чек.',
  },
  payment: {
    label: 'оплата',
    keywords: ['оплат', 'чек', 'скрин', 'банк', 'карт', 'реквизит', 'получател', 'сумм'],
    rule: 'Реквизиты брать только из AI Control. Не подтверждать оплату финально: чек принимает менеджер, при расхождении мягко попросить проверить.',
  },
  delivery: {
    label: 'доставка',
    keywords: ['достав', 'сдэк', 'cdek', 'озон', 'ozon', 'яндекс', 'почт', 'пвз', 'курьер', 'срок'],
    rule: 'Условия доставки брать только из AI Control и контекста. Не обещать точные сроки, если они явно не указаны.',
  },
  tone: {
    label: 'плохой тон',
    keywords: ['тон', 'груб', 'робот', 'сух', 'шаблон', 'crm', 'довер', 'жив'],
    rule: 'Писать как живой менеджер IWAK: коротко, спокойно, без CRM-канцелярита, давления и технических упоминаний AI.',
  },
  product: {
    label: 'товар / наличие',
    keywords: ['товар', 'модель', 'налич', 'размер', 'цвет', 'каталог', 'фото', 'реплик', 'оригинал'],
    rule: 'Не придумывать товар, наличие, фото и свойства модели. Если клиент прислал конкретный товар, работать с ним, а не возвращать в каталог.',
  },
  other: {
    label: 'другое',
    keywords: [],
    rule: 'Следовать сохраненному уроку по смыслу и не переносить его на неподходящие ситуации.',
  },
};
fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
let logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });

if ((process.env.TRUST_PROXY || '').trim() === 'true') {
  app.set('trust proxy', 1);
}

const runtimeConfig = {
  telegram_token: process.env.TELEGRAM_TOKEN || '',
  ai_key: process.env.AI_API_KEY || '',
  ai_url: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  model: process.env.MODEL || 'gpt-4o-mini',
  sai_gpt_key: process.env.SAI_GPT_API_KEY || '',
  sai_gpt_url: process.env.SAI_GPT_BASE_URL || 'https://api.openai.com/v1',
  sai_gpt_model: process.env.SAI_GPT_MODEL || 'gpt-4o-mini',
  stt_api_key: process.env.STT_API_KEY || process.env.AI_API_KEY || '',
  stt_base_url: process.env.STT_BASE_URL || process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  stt_model: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',
  instruction: normalizeInstructionConfigValue(process.env.INSTRUCTION || ''),
  core_hot_lead_enabled: process.env.CORE_HOT_LEAD_ENABLED !== 'false',
  core_published_available_enabled: process.env.CORE_PUBLISHED_AVAILABLE_ENABLED !== 'false',
  core_no_stock_check_enabled: process.env.CORE_NO_STOCK_CHECK_ENABLED !== 'false',
  core_no_catalog_return_enabled: process.env.CORE_NO_CATALOG_RETURN_ENABLED !== 'false',
  core_no_resell_enabled: process.env.CORE_NO_RESELL_ENABLED !== 'false',
  core_rules_text: process.env.CORE_RULES_TEXT || '',
  facts_no_invent_enabled: process.env.FACTS_NO_INVENT_ENABLED !== 'false',
  facts_no_fake_payment_enabled: process.env.FACTS_NO_FAKE_PAYMENT_ENABLED !== 'false',
  facts_no_fake_delivery_enabled: process.env.FACTS_NO_FAKE_DELIVERY_ENABLED !== 'false',
  facts_no_fake_discounts_enabled: process.env.FACTS_NO_FAKE_DISCOUNTS_ENABLED !== 'false',
  facts_no_final_payment_confirm_enabled: process.env.FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED !== 'false',
  facts_no_fake_delivery_time_enabled: process.env.FACTS_NO_FAKE_DELIVERY_TIME_ENABLED !== 'false',
  facts_rules_text: process.env.FACTS_RULES_TEXT || '',
  smalltalk_enabled: process.env.SMALLTALK_ENABLED !== 'false',
  smalltalk_style_enabled: process.env.SMALLTALK_STYLE_ENABLED !== 'false',
  smalltalk_outfit_advice_enabled: process.env.SMALLTALK_OUTFIT_ADVICE_ENABLED !== 'false',
  smalltalk_weather_enabled: process.env.SMALLTALK_WEATHER_ENABLED !== 'false',
  smalltalk_soft_product_link_enabled: process.env.SMALLTALK_SOFT_PRODUCT_LINK_ENABLED !== 'false',
  smalltalk_rules_text: process.env.SMALLTALK_RULES_TEXT || '',
  order_path_enabled: process.env.ORDER_PATH_ENABLED !== 'false',
  order_collect_size_enabled: process.env.ORDER_COLLECT_SIZE_ENABLED !== 'false',
  order_collect_insole_enabled: process.env.ORDER_COLLECT_INSOLE_ENABLED !== 'false',
  order_collect_full_name_enabled: process.env.ORDER_COLLECT_FULL_NAME_ENABLED !== 'false',
  order_collect_phone_enabled: process.env.ORDER_COLLECT_PHONE_ENABLED !== 'false',
  order_collect_city_enabled: process.env.ORDER_COLLECT_CITY_ENABLED !== 'false',
  order_collect_delivery_service_enabled: process.env.ORDER_COLLECT_DELIVERY_SERVICE_ENABLED !== 'false',
  order_collect_pickup_enabled: process.env.ORDER_COLLECT_PICKUP_ENABLED !== 'false',
  order_collect_payment_enabled: process.env.ORDER_COLLECT_PAYMENT_ENABLED !== 'false',
  order_collect_receipt_enabled: process.env.ORDER_COLLECT_RECEIPT_ENABLED !== 'false',
  order_step_mode: process.env.ORDER_STEP_MODE || 'natural',
  order_rules_text: process.env.ORDER_RULES_TEXT || '',
  response_guard_enabled: process.env.RESPONSE_GUARD_ENABLED !== 'false',
  response_guard_no_fake_payment_enabled: process.env.RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED !== 'false',
  response_guard_no_repeat_known_enabled: process.env.RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED !== 'false',
  response_guard_human_tone_enabled: process.env.RESPONSE_GUARD_HUMAN_TONE_ENABLED !== 'false',
  response_guard_next_step_enabled: process.env.RESPONSE_GUARD_NEXT_STEP_ENABLED !== 'false',
  response_guard_no_final_payment_enabled: process.env.RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED !== 'false',
  response_guard_rules_text: process.env.RESPONSE_GUARD_RULES_TEXT || '',
  receipt_check_enabled: process.env.RECEIPT_CHECK_ENABLED !== 'false',
  receipt_check_amount_enabled: process.env.RECEIPT_CHECK_AMOUNT_ENABLED !== 'false',
  receipt_check_bank_enabled: process.env.RECEIPT_CHECK_BANK_ENABLED !== 'false',
  receipt_check_recipient_enabled: process.env.RECEIPT_CHECK_RECIPIENT_ENABLED !== 'false',
  receipt_check_datetime_enabled: process.env.RECEIPT_CHECK_DATETIME_ENABLED !== 'false',
  receipt_check_mismatch_enabled: process.env.RECEIPT_CHECK_MISMATCH_ENABLED !== 'false',
  receipt_check_no_final_confirm_enabled: process.env.RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED !== 'false',
  receipt_check_success_text: process.env.RECEIPT_CHECK_SUCCESS_TEXT || RECEIPT_ACK_REPLY,
  receipt_check_mismatch_text: process.env.RECEIPT_CHECK_MISMATCH_TEXT || 'Чек получил, но вижу расхождение с заказом. Проверьте, пожалуйста, сумму или реквизиты и пришлите корректный чек.',
  receipt_check_rules_text: process.env.RECEIPT_CHECK_RULES_TEXT || '',
  quality_replica_honesty_enabled: process.env.QUALITY_REPLICA_HONESTY_ENABLED !== 'false',
  quality_no_original_claims_enabled: process.env.QUALITY_NO_ORIGINAL_CLAIMS_ENABLED !== 'false',
  quality_calm_explanation_enabled: process.env.QUALITY_CALM_EXPLANATION_ENABLED !== 'false',
  quality_no_extra_photos_enabled: process.env.QUALITY_NO_EXTRA_PHOTOS_ENABLED !== 'false',
  quality_return_soft_enabled: process.env.QUALITY_RETURN_SOFT_ENABLED !== 'false',
  quality_return_no_dates_enabled: process.env.QUALITY_RETURN_NO_DATES_ENABLED !== 'false',
  quality_return_inspect_enabled: process.env.QUALITY_RETURN_INSPECT_ENABLED !== 'false',
  quality_return_text: process.env.QUALITY_RETURN_TEXT || DEFAULT_QUALITY_RETURN_TEXT,
  quality_rules_text: process.env.QUALITY_RULES_TEXT || '',
  store_trust_enabled: process.env.STORE_TRUST_ENABLED !== 'false',
  store_trust_online_only_enabled: process.env.STORE_TRUST_ONLINE_ONLY_ENABLED !== 'false',
  store_trust_sadovod_history_enabled: process.env.STORE_TRUST_SADOVOD_HISTORY_ENABLED !== 'false',
  store_trust_cost_reason_enabled: process.env.STORE_TRUST_COST_REASON_ENABLED !== 'false',
  store_trust_no_address_enabled: process.env.STORE_TRUST_NO_ADDRESS_ENABLED !== 'false',
  store_trust_safe_purchase_enabled: process.env.STORE_TRUST_SAFE_PURCHASE_ENABLED !== 'false',
  store_trust_text: process.env.STORE_TRUST_TEXT || DEFAULT_STORE_TRUST_TEXT,
  contacts_enabled: process.env.CONTACTS_ENABLED !== 'false',
  contacts_website: process.env.CONTACTS_WEBSITE || DEFAULT_CONTACTS_WEBSITE,
  contacts_telegram: process.env.CONTACTS_TELEGRAM || '',
  contacts_manager: process.env.CONTACTS_MANAGER || '',
  contacts_phone: process.env.CONTACTS_PHONE || '',
  contacts_whatsapp: process.env.CONTACTS_WHATSAPP || '',
  contacts_instagram_enabled: process.env.CONTACTS_INSTAGRAM_ENABLED === 'true',
  contacts_instagram: process.env.CONTACTS_INSTAGRAM || '',
  contacts_anti_scam_enabled: process.env.CONTACTS_ANTI_SCAM_ENABLED !== 'false',
  contacts_about_text: process.env.CONTACTS_ABOUT_TEXT || '',
  contacts_rules_text: process.env.CONTACTS_RULES_TEXT || '',
  dialog_examples_enabled: process.env.DIALOG_EXAMPLES_ENABLED === 'true',
  dialog_examples_text: process.env.DIALOG_EXAMPLES_TEXT || '',
  tone: process.env.TONE || 'neutral',
  response_length: process.env.RESPONSE_LENGTH || 'medium',
  creativity: process.env.CREATIVITY || 'balanced',
  persona_style: process.env.PERSONA_STYLE || 'calm',
  persona_age: process.env.PERSONA_AGE || '27',
  conversation_mode: process.env.CONVERSATION_MODE || 'retail',
  media_behavior: process.env.MEDIA_BEHAVIOR || 'answer_from_media',
  auto_reply_enabled: process.env.AUTO_REPLY_ENABLED !== 'false',
  memory_enabled: process.env.MEMORY_ENABLED === 'true',
  memory_recent_limit: Number(process.env.MEMORY_RECENT_LIMIT || MEMORY_RECENT_LIMIT),
  batch_debounce_ms: Number(process.env.BATCH_DEBOUNCE_MS || BATCH_DEBOUNCE_MS),
  reply_mode: process.env.REPLY_MODE || 'smart',
  human_typing_mode: process.env.HUMAN_TYPING_MODE || 'natural',
  manager_takeover_enabled: process.env.MANAGER_TAKEOVER_ENABLED !== 'false',
  manager_return_delay_ms: Number(process.env.MANAGER_RETURN_DELAY_MS || MANAGER_RETURN_DELAY_MS),
  listen_wait_enabled: process.env.LISTEN_WAIT_ENABLED !== 'false',
  listen_wait_debounce_ms: Number(process.env.LISTEN_WAIT_DEBOUNCE_MS || MULTIPART_RESPONSE_DEBOUNCE_MS),
  listen_wait_max_window_ms: Number(process.env.LISTEN_WAIT_MAX_WINDOW_MS || MULTIPART_RESPONSE_MAX_WINDOW_MS),
  payment_enabled: process.env.PAYMENT_ENABLED === 'true',
  payment_method: process.env.PAYMENT_METHOD || 'card',
  payment_card_number: process.env.PAYMENT_CARD_NUMBER || '',
  payment_recipient_name: process.env.PAYMENT_RECIPIENT_NAME || '',
  payment_bank: process.env.PAYMENT_BANK || '',
  payment_comment: process.env.PAYMENT_COMMENT || '',
  payment_style_text: process.env.PAYMENT_STYLE_TEXT || '',
  payment_layout_text: process.env.PAYMENT_LAYOUT_TEXT || '',
  payment_bold_mode: process.env.PAYMENT_BOLD_MODE || 'off',
  payment_example_text: process.env.PAYMENT_EXAMPLE_TEXT || '',
  delivery_rules_enabled: process.env.DELIVERY_RULES_ENABLED === 'true',
  delivery_rules_text: process.env.DELIVERY_RULES_TEXT || '',
  delivery_style_text: process.env.DELIVERY_STYLE_TEXT || '',
  delivery_layout_text: process.env.DELIVERY_LAYOUT_TEXT || '',
  delivery_bold_mode: process.env.DELIVERY_BOLD_MODE || 'off',
  delivery_example_text: process.env.DELIVERY_EXAMPLE_TEXT || '',
  delivery_tracking_enabled: process.env.DELIVERY_TRACKING_ENABLED !== 'false',
  delivery_tracking_text: process.env.DELIVERY_TRACKING_TEXT || DEFAULT_DELIVERY_TRACKING_TEXT,
  followup_master_enabled: process.env.FOLLOWUP_MASTER_ENABLED === 'true',
  followup_worker_enabled: process.env.FOLLOWUP_WORKER_ENABLED === 'true',
  followup_auto_send_enabled: process.env.FOLLOWUP_AUTO_SEND_ENABLED === 'true',
  followup_repeat_sales_enabled: process.env.FOLLOWUP_REPEAT_SALES_ENABLED === 'true',
  followup_mode: process.env.FOLLOWUP_MODE || 'off',
  followup_quiet_start: process.env.FOLLOWUP_QUIET_START || '22:00',
  followup_quiet_end: process.env.FOLLOWUP_QUIET_END || '10:00',
  followup_min_interval_hours: process.env.FOLLOWUP_MIN_INTERVAL_HOURS || '24',
  followup_daily_limit: process.env.FOLLOWUP_DAILY_LIMIT || '20',
  followup_repeat_sales_days: process.env.FOLLOWUP_REPEAT_SALES_DAYS || '30',
  followup_worker_interval_seconds: process.env.FOLLOWUP_WORKER_INTERVAL_SECONDS || '300',
  followup_wait_data_enabled: process.env.FOLLOWUP_WAIT_DATA_ENABLED !== 'false',
  followup_wait_data_hours: process.env.FOLLOWUP_WAIT_DATA_HOURS || '2',
  followup_wait_data_max: process.env.FOLLOWUP_WAIT_DATA_MAX || '2',
  followup_wait_payment_enabled: process.env.FOLLOWUP_WAIT_PAYMENT_ENABLED !== 'false',
  followup_wait_payment_hours: process.env.FOLLOWUP_WAIT_PAYMENT_HOURS || '3',
  followup_wait_payment_max: process.env.FOLLOWUP_WAIT_PAYMENT_MAX || '2',
  followup_wait_receipt_enabled: process.env.FOLLOWUP_WAIT_RECEIPT_ENABLED !== 'false',
  followup_wait_receipt_hours: process.env.FOLLOWUP_WAIT_RECEIPT_HOURS || '1',
  followup_wait_receipt_max: process.env.FOLLOWUP_WAIT_RECEIPT_MAX || '1',
  followup_promised_later_enabled: process.env.FOLLOWUP_PROMISED_LATER_ENABLED !== 'false',
  followup_promised_later_hours: process.env.FOLLOWUP_PROMISED_LATER_HOURS || '4',
  followup_promised_later_max: process.env.FOLLOWUP_PROMISED_LATER_MAX || '2',
  followup_choosing_enabled: process.env.FOLLOWUP_CHOOSING_ENABLED !== 'false',
  followup_choosing_hours: process.env.FOLLOWUP_CHOOSING_HOURS || '24',
  followup_choosing_max: process.env.FOLLOWUP_CHOOSING_MAX || '1',
  webhook_url: process.env.WEBHOOK_URL || '',
};

loadPersistedConfig();

const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 150,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 150,
});

const httpClient = axios.create({
  httpAgent,
  httpsAgent,
});

app.use(express.json({ limit: HTTP_BODY_LIMIT }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 's.ai',
    uptime: Math.round(process.uptime()),
    webhook_open: true,
  });
});

function logEvent(event, payload) {
  const normalizedPayload = { ...payload };
  if (typeof normalizedPayload.text === 'string') {
    normalizedPayload.text = truncateLogText(normalizedPayload.text);
  }
  if (typeof normalizedPayload.replyText === 'string') {
    normalizedPayload.replyText = truncateLogText(normalizedPayload.replyText);
  }
  if (typeof normalizedPayload.error === 'string') {
    normalizedPayload.error = truncateLogText(normalizedPayload.error);
  }
  if (typeof normalizedPayload.message === 'string' && event === 'ERROR') {
    normalizedPayload.message = truncateLogText(normalizedPayload.message);
  }

  const entry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    event,
    status: normalizedPayload.status || (event === 'ERROR' ? 'error' : 'ok'),
    ...normalizedPayload,
  };

  runtimeLogs.push(entry);
  if (runtimeLogs.length > LOG_BUFFER_LIMIT) {
    runtimeLogs.shift();
  }

  rotateLogsIfNeeded();
  logStream.write(`${JSON.stringify(entry)}\n`);

  if (LOG_LEVEL === 'error' && event !== 'ERROR') return;
  console.log(`[${event}]`, JSON.stringify(entry));
}

function truncateLogText(text) {
  return String(text || '').slice(0, LOG_TEXT_LIMIT);
}

function truncateTraceText(value, limit = AI_DECISION_TRACE_TEXT_LIMIT) {
  return redactSensitiveText(String(value || '')).slice(0, limit);
}

function hashTraceText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function normalizeInstructionConfigValue(value) {
  return String(value ?? '').trim();
}

function createTraceId() {
  return crypto.randomUUID();
}

function parseLogLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function rotateLogsIfNeeded() {
  try {
    if (fs.existsSync(LOG_FILE_PATH) && fs.statSync(LOG_FILE_PATH).size < MAX_LOG_FILE_BYTES) {
      return;
    }

    logStream.end();
    const archiveName = `runtime-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    if (fs.existsSync(LOG_FILE_PATH)) {
      fs.renameSync(LOG_FILE_PATH, path.join(logDir, archiveName));
    }

    const archives = fs.readdirSync(logDir)
      .filter((file) => /^runtime-\d{4}-\d{2}-\d{2}T/.test(file))
      .sort()
      .reverse();

    archives.slice(MAX_LOG_ARCHIVES).forEach((file) => {
      fs.rmSync(path.join(logDir, file), { force: true });
    });

    logStream = fs.createWriteStream(LOG_FILE_PATH, { flags: 'a' });
  } catch (error) {
    console.error('[LOG_ROTATION_ERROR]', error.message);
  }
}

function readPersistedLogs() {
  if (!fs.existsSync(LOG_FILE_PATH)) return [];
  const content = fs.readFileSync(LOG_FILE_PATH, 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map(parseLogLine)
    .filter(Boolean);
}

function getMergedLogs() {
  const merged = new Map();

  readPersistedLogs().forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });

  runtimeLogs.forEach((item) => {
    if (item && item.id) merged.set(item.id, item);
  });

  return Array.from(merged.values()).sort((a, b) => new Date(b.time) - new Date(a.time));
}

function filterLogs(items, query = {}) {
  const limit = Math.max(1, Math.min(1000, Number(query.limit) || 100));
  const type = String(query.type || '').trim();
  const traceId = String(query.traceId || '').trim();
  const userId = String(query.userId || '').trim();

  return items
    .filter((item) => !type || item.event === type)
    .filter((item) => !traceId || item.traceId === traceId)
    .filter((item) => !userId || String(item.userId || '') === userId)
    .slice(0, limit);
}

function createEmptyMemoryStore() {
  return {
    version: 1,
    messages: [],
    facts: {},
    states: {},
    businessConnections: {},
  };
}

function readMemoryStore() {
  if (!fs.existsSync(MEMORY_FILE_PATH)) return createEmptyMemoryStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_FILE_PATH, 'utf8'));
    return {
      ...createEmptyMemoryStore(),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      facts: parsed.facts && typeof parsed.facts === 'object' ? parsed.facts : {},
      states: parsed.states && typeof parsed.states === 'object' ? parsed.states : {},
      businessConnections: parsed.businessConnections && typeof parsed.businessConnections === 'object' ? parsed.businessConnections : {},
    };
  } catch (error) {
    logEvent('ERROR', {
      scope: 'memory.read',
      status: 'error',
      error: error.message,
    });
    return createEmptyMemoryStore();
  }
}

let memoryStore = readMemoryStore();
let trainingStore = readTrainingStore();
let saiGptMemoryStore = readSaiGptMemoryStore();
let customerStore = null;

try {
  customerStore = createCustomerStore({ dbPath: CUSTOMER_DB_PATH });
  customerStore.importLegacyMemory(memoryStore);
} catch (error) {
  customerStore = null;
  console.error('[CUSTOMER_DB_ERROR]', error.message);
}

function saveMemoryStore() {
  const tempPath = `${MEMORY_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(memoryStore, null, 2));
  fs.renameSync(tempPath, MEMORY_FILE_PATH);
}

function createEmptyTrainingStore() {
  return {
    version: 1,
    items: [],
  };
}

function readTrainingStore() {
  if (!fs.existsSync(TRAINING_FILE_PATH)) return createEmptyTrainingStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(TRAINING_FILE_PATH, 'utf8'));
    return {
      ...createEmptyTrainingStore(),
      ...parsed,
      items: Array.isArray(parsed.items) ? parsed.items.filter(Boolean) : [],
    };
  } catch (error) {
    logEvent('ERROR', {
      scope: 'training.read',
      status: 'error',
      error: error.message,
    });
    return createEmptyTrainingStore();
  }
}

function saveTrainingStore() {
  const tempPath = `${TRAINING_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(trainingStore, null, 2));
  fs.renameSync(tempPath, TRAINING_FILE_PATH);
}

function createEmptySaiGptMemoryStore() {
  return {
    version: 1,
    messages: [],
    pendingAction: null,
  };
}

function readSaiGptMemoryStore() {
  if (!fs.existsSync(SAI_GPT_MEMORY_FILE_PATH)) return createEmptySaiGptMemoryStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(SAI_GPT_MEMORY_FILE_PATH, 'utf8'));
    return {
      ...createEmptySaiGptMemoryStore(),
      ...parsed,
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(Boolean) : [],
      pendingAction: parsed.pendingAction && typeof parsed.pendingAction === 'object' ? parsed.pendingAction : null,
    };
  } catch (error) {
    logEvent('ERROR', {
      scope: 'sai_gpt.memory.read',
      status: 'error',
      error: error.message,
    });
    return createEmptySaiGptMemoryStore();
  }
}

function saveSaiGptMemoryStore() {
  const tempPath = `${SAI_GPT_MEMORY_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(saiGptMemoryStore, null, 2));
  fs.renameSync(tempPath, SAI_GPT_MEMORY_FILE_PATH);
}

function appendSaiGptMemoryMessage(role, content, metadata = {}) {
  const cleanRole = role === 'assistant' ? 'assistant' : 'user';
  const cleanContent = sanitizeSaiGptText(content, 5000);
  if (!cleanContent) return null;
  const item = {
    id: crypto.randomUUID(),
    role: cleanRole,
    content: cleanContent,
    createdAt: new Date().toISOString(),
    selectedChatId: String(metadata.selectedChatId || '').trim(),
    imageCount: Math.max(0, Math.min(3, Number(metadata.imageCount) || 0)),
  };
  saiGptMemoryStore.messages.push(item);
  saiGptMemoryStore.messages = saiGptMemoryStore.messages.slice(-SAI_GPT_MEMORY_MAX_MESSAGES);
  saveSaiGptMemoryStore();
  return item;
}

function getSaiGptPendingAction() {
  const action = saiGptMemoryStore.pendingAction;
  if (!action || typeof action !== 'object') return null;
  if (!action.type || !action.payload || typeof action.payload !== 'object') return null;
  return action;
}

function setSaiGptPendingAction(action = {}) {
  const cleanAction = normalizeSaiGptPendingAction(action);
  if (!cleanAction) return null;
  saiGptMemoryStore.pendingAction = cleanAction;
  saveSaiGptMemoryStore();
  return cleanAction;
}

function clearSaiGptPendingAction() {
  saiGptMemoryStore.pendingAction = null;
  saveSaiGptMemoryStore();
}

function normalizeSaiGptPendingAction(action = {}) {
  const type = String(action.type || '').trim();
  const payload = action.payload && typeof action.payload === 'object' ? action.payload : {};
  const allowedTypes = [
    'create_training',
    'set_training_active',
    'inspect_chat',
    'search_code',
    'inspect_file',
    'show_prompt',
    'search_logs',
    'prepare_patch_plan',
    'prepare_deploy_plan',
  ];
  if (!allowedTypes.includes(type)) return null;

  if (type === 'create_training') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        type: payload.type === 'good' ? 'good' : 'bad',
        chatId: sanitizeSaiGptText(payload.chatId || '', 120),
        category: getTrainingCategory(payload.category || 'other'),
        contextText: normalizeTrainingBlock(payload.contextText || '', 2200),
        clientText: normalizeTrainingText(payload.clientText || '', 900),
        aiText: normalizeTrainingText(payload.aiText || '', 1200),
        correctedText: normalizeTrainingText(payload.correctedText || '', 1200),
        note: normalizeTrainingText(payload.note || '', 600),
      },
    };
  }

  if (type === 'inspect_chat') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        chatId: sanitizeSaiGptText(payload.chatId || '', 120),
        query: sanitizeSaiGptText(payload.query || '', 300),
        limit: Math.max(50, Math.min(2000, Number(payload.limit) || 800)),
      },
    };
  }

  if (type === 'search_code') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        query: sanitizeSaiGptText(payload.query || '', 300),
      },
    };
  }

  if (type === 'inspect_file') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        file: sanitizeSaiGptText(payload.file || '', 260),
        pattern: sanitizeSaiGptText(payload.pattern || '', 160),
        line: Math.max(1, Number(payload.line) || 1),
        contextLines: Math.max(20, Math.min(180, Number(payload.contextLines) || 80)),
      },
    };
  }

  if (type === 'show_prompt') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        query: sanitizeSaiGptText(payload.query || '', 500),
        chatId: sanitizeSaiGptText(payload.chatId || '', 120),
      },
    };
  }

  if (type === 'search_logs') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        query: sanitizeSaiGptText(payload.query || '', 300),
        scope: sanitizeSaiGptText(payload.scope || '', 120),
        limit: Math.max(20, Math.min(200, Number(payload.limit) || 80)),
      },
    };
  }

  if (type === 'prepare_patch_plan' || type === 'prepare_deploy_plan') {
    return {
      id: crypto.randomUUID(),
      type,
      createdAt: new Date().toISOString(),
      payload: {
        goal: sanitizeSaiGptText(payload.goal || payload.query || '', 800),
        files: Array.isArray(payload.files)
          ? payload.files.map((file) => sanitizeSaiGptText(file, 260)).filter(Boolean).slice(0, 12)
          : [],
      },
    };
  }

  return {
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    payload: {
      id: sanitizeSaiGptText(payload.id || '', 120),
      active: payload.active !== false,
      reason: normalizeTrainingText(payload.reason || '', 600),
    },
  };
}

function extractSaiGptPendingAction(reply = '') {
  const source = String(reply || '');
  const match = source.match(/\[SAI_ACTION\]([\s\S]*?)\[\/SAI_ACTION\]/i);
  if (!match) return { reply: source, action: null };
  let action = null;
  try {
    action = JSON.parse(match[1].trim());
  } catch {
    action = null;
  }
  return {
    reply: source.replace(match[0], '').trim(),
    action: normalizeSaiGptPendingAction(action || {}),
  };
}

function isSaiGptActionConfirmation(text = '') {
  const value = String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!value) return false;
  return /^(да|ок|окей|подтверждаю|согласен|согласна|добавь|сохрани|запомни|включай|выключай|делай|можно)([.! ]|$)/i.test(value);
}

function isSaiGptActionCancel(text = '') {
  const value = String(text || '').trim().toLowerCase().replace(/ё/g, 'е');
  return /^(нет|не надо|отмена|отмени|стой|стоп|не добавляй|не сохраняй|не меняй)([.! ]|$)/i.test(value);
}

function describeSaiGptPendingAction(action = null) {
  if (!action) return '';
  if (action.type === 'create_training') {
    const payload = action.payload || {};
    const category = getTrainingCategory(payload.category || 'other');
    const label = TRAINING_CATEGORIES[category]?.label || TRAINING_CATEGORIES.other.label;
    return [
      'Ожидает подтверждения: добавить урок в training.',
      `Тип: ${payload.type === 'good' ? 'хороший ответ' : 'плохой ответ'}.`,
      `Категория: ${label}.`,
      payload.note && `Почему: ${payload.note}`,
      payload.correctedText && `Как отвечать: ${payload.correctedText}`,
    ].filter(Boolean).join('\n');
  }
  if (action.type === 'set_training_active') {
    return `Ожидает подтверждения: ${action.payload?.active === false ? 'выключить' : 'включить'} урок ${action.payload?.id || ''}.`;
  }
  if (action.type === 'inspect_chat') {
    return `Ожидает подтверждения: открыть полный диалог ${action.payload?.chatId || action.payload?.query || 'по поиску'} (${action.payload?.limit || 800} сообщений).`;
  }
  if (action.type === 'search_code') {
    return `Ожидает подтверждения: поиск по коду "${action.payload?.query || ''}".`;
  }
  if (action.type === 'inspect_file') {
    return `Ожидает подтверждения: открыть фрагмент файла ${action.payload?.file || ''}.`;
  }
  if (action.type === 'show_prompt') {
    return `Ожидает подтверждения: показать собранный prompt для "${action.payload?.query || 'текущего вопроса'}".`;
  }
  if (action.type === 'search_logs') {
    return `Ожидает подтверждения: поиск по логам "${action.payload?.query || action.payload?.scope || ''}".`;
  }
  if (action.type === 'prepare_patch_plan') {
    return `Ожидает подтверждения: подготовить patch-план для "${action.payload?.goal || ''}".`;
  }
  if (action.type === 'prepare_deploy_plan') {
    return `Ожидает подтверждения: подготовить deploy-план для "${action.payload?.goal || ''}".`;
  }
  return 'Ожидает подтверждения: системное действие S.AI GPT.';
}

function formatSaiGptJsonBlock(title, value) {
  return `${title}\n\`\`\`json\n${redactSensitiveText(JSON.stringify(value, null, 2))}\n\`\`\``;
}

function findSaiGptInboxProfiles({ chatId = '', query = '', limit = 800 } = {}) {
  const inbox = buildInboxPayload(500, Math.max(50, Math.min(2000, limit)));
  const normalizedChatId = String(chatId || '').trim();
  if (normalizedChatId) {
    const exact = (inbox.items || []).find((item) => String(item.customer?.chatId || '') === normalizedChatId);
    if (exact) return [exact];
  }
  return buildSaiGptInboxDeepMatches(inbox, query || chatId, normalizedChatId);
}

function resolveSaiGptProjectFile(file = '') {
  const cleanFile = String(file || '').replace(/^\/+/, '').trim();
  if (!cleanFile || cleanFile.includes('\0')) return null;
  const resolved = path.resolve(__dirname, cleanFile);
  if (!resolved.startsWith(`${__dirname}${path.sep}`) && resolved !== __dirname) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  if (path.basename(resolved) === '.env' || path.basename(resolved).endsWith('.log')) return null;
  if (!SAI_GPT_ALLOWED_CODE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) return null;
  return resolved;
}

function inspectSaiGptProjectFile(payload = {}) {
  const resolved = resolveSaiGptProjectFile(payload.file);
  if (!resolved) throw new Error('Файл не найден или недоступен для S.AI GPT.');
  const content = fs.readFileSync(resolved, 'utf8');
  const lines = content.split('\n');
  const pattern = String(payload.pattern || '').trim().toLowerCase();
  let center = Math.max(1, Number(payload.line) || 1);
  if (pattern) {
    const found = lines.findIndex((line) => line.toLowerCase().includes(pattern));
    if (found >= 0) center = found + 1;
  }
  const contextLines = Math.max(20, Math.min(180, Number(payload.contextLines) || 80));
  const start = Math.max(1, center - Math.floor(contextLines / 2));
  const end = Math.min(lines.length, start + contextLines - 1);
  return {
    file: path.relative(__dirname, resolved),
    totalLines: lines.length,
    start,
    end,
    excerpt: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join('\n'),
  };
}

function buildSaiGptPromptInspection(payload = {}, selectedChatId = '') {
  const query = sanitizeSaiGptText(payload.query || '', 500);
  const chatId = sanitizeSaiGptText(payload.chatId || selectedChatId || '', 120);
  const inbox = buildInboxPayload(500, 2000);
  const selectedProfile = chatId
    ? (inbox.items || []).find((item) => String(item.customer?.chatId || '') === String(chatId))
    : null;
  const memoryContext = selectedProfile
    ? buildMemoryContext(selectedProfile.customer?.chatId || chatId, getRuntimeSnapshot())
    : null;
  const prompt = buildSystemPrompt(getRuntimeSnapshot(), memoryContext, query);
  const selectedTraining = selectTrainingExamples(query, memoryContext);
  return {
    query,
    chatId,
    selectedTrainingIds: selectedTraining.map((item) => item.id),
    selectedTraining: selectedTraining.map((item) => ({
      id: item.id,
      type: item.type,
      category: item.category,
      ruleText: item.ruleText || buildTrainingRuleText(item),
      note: item.note || '',
    })),
    prompt,
  };
}

function searchSaiGptLogs(payload = {}) {
  const query = sanitizeSaiGptText(payload.query || '', 300);
  const scope = sanitizeSaiGptText(payload.scope || '', 120);
  const limit = Math.max(20, Math.min(200, Number(payload.limit) || 80));
  return getMergedLogs()
    .filter((entry) => !scope || String(entry.scope || '').includes(scope))
    .map((entry) => ({ entry, score: scoreSaiGptLogEntry(entry, query || scope) }))
    .filter((item) => item.score > 0 || scope)
    .sort((a, b) => b.score - a.score || new Date(b.entry.time) - new Date(a.entry.time))
    .slice(0, limit)
    .map((item) => item.entry);
}

function executeSaiGptPendingAction(action = null, selectedChatId = '') {
  if (!action) throw new Error('Нет действия для подтверждения.');
  if (action.type === 'create_training') {
    const item = addTrainingExample({
      ...action.payload,
      chatId: action.payload?.chatId || selectedChatId || '',
    });
    logEvent('SAI_GPT_ACTION', {
      status: 'ok',
      action: action.type,
      trainingId: item.id,
      category: item.category,
    });
    return [
      'Готово, добавил урок в training.',
      `ID: ${item.id}`,
      `Категория: ${TRAINING_CATEGORIES[item.category]?.label || item.category}`,
      'Он уже активен и может попадать в prompt по смыслу диалога.',
    ].join('\n');
  }
  if (action.type === 'set_training_active') {
    const item = updateTrainingExample(action.payload?.id, { active: action.payload?.active !== false });
    if (!item) throw new Error('Урок не найден.');
    logEvent('SAI_GPT_ACTION', {
      status: 'ok',
      action: action.type,
      trainingId: item.id,
      active: item.active !== false,
    });
    return `Готово, урок ${item.id} ${item.active === false ? 'выключен' : 'включён'}.`;
  }
  if (action.type === 'inspect_chat') {
    const matches = findSaiGptInboxProfiles(action.payload || {});
    if (!matches.length) return 'Не нашёл подходящий диалог в Inbox. Попробуй дать chatId, username, имя или точную фразу.';
    return formatSaiGptJsonBlock('Нашёл и открыл диалог:', matches.slice(0, 3));
  }
  if (action.type === 'search_code') {
    const snippets = buildSaiGptCodeSnippets(action.payload?.query || '');
    return formatSaiGptJsonBlock('Результаты поиска по коду:', snippets);
  }
  if (action.type === 'inspect_file') {
    const result = inspectSaiGptProjectFile(action.payload || {});
    return [
      `Файл: ${result.file}:${result.start}`,
      '```text',
      redactSensitiveText(result.excerpt),
      '```',
    ].join('\n');
  }
  if (action.type === 'show_prompt') {
    const result = buildSaiGptPromptInspection(action.payload || {}, selectedChatId);
    return formatSaiGptJsonBlock('Собранный prompt и уроки для этого вопроса:', result);
  }
  if (action.type === 'search_logs') {
    const result = searchSaiGptLogs(action.payload || {});
    return formatSaiGptJsonBlock('Результаты поиска по логам:', result);
  }
  if (action.type === 'prepare_patch_plan') {
    return formatSaiGptJsonBlock('Patch-план без изменения файлов:', {
      goal: action.payload?.goal || '',
      filesToInspect: action.payload?.files || [],
      safeSteps: [
        'Найти точные функции/роуты через search_code или inspect_file.',
        'Сформулировать минимальный diff-кандидат.',
        'Показать риски для клиентской магистрали.',
        'После отдельного подтверждения вносить код обычным деплоем, не через S.AI GPT.',
      ],
    });
  }
  if (action.type === 'prepare_deploy_plan') {
    return formatSaiGptJsonBlock('Deploy-план без запуска команд:', {
      goal: action.payload?.goal || '',
      steps: [
        'Проверить diff и убедиться, что нет лишних data/logs файлов.',
        'npm run check.',
        'Inline JS syntax check для public/index.html.',
        'Commit + push.',
        'На VPS: git pull --ff-only, npm run check, pm2 restart sai, pm2 status sai, health check.',
      ],
    });
  }
  throw new Error('Этот тип действия пока не поддержан.');
}

function normalizeTrainingText(value, limit = 1000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeTrainingBlock(value, limit = 1800) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, limit);
}

function getTrainingCategory(key) {
  return TRAINING_CATEGORIES[key] ? key : 'other';
}

function tokenizeTrainingText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .match(/[a-zа-я0-9]{3,}/g) || [];
}

function inferTrainingCategory(input = {}) {
  const explicit = getTrainingCategory(String(input.category || '').trim());
  if (explicit !== 'other') return explicit;
  const haystack = [
    input.note,
    input.contextText,
    input.clientText,
    input.aiText,
    input.correctedText,
  ].join(' ').toLowerCase().replace(/ё/g, 'е');

  let best = { key: 'other', score: 0 };
  Object.entries(TRAINING_CATEGORIES).forEach(([key, meta]) => {
    if (key === 'other') return;
    const score = (meta.keywords || []).reduce((sum, keyword) => (
      haystack.includes(String(keyword).toLowerCase().replace(/ё/g, 'е')) ? sum + 1 : sum
    ), 0);
    if (score > best.score) best = { key, score };
  });
  return best.key;
}

function buildTrainingRuleText(item) {
  const category = getTrainingCategory(item.category);
  const meta = TRAINING_CATEGORIES[category] || TRAINING_CATEGORIES.other;
  const note = normalizeTrainingText(item.note, 360);
  const corrected = normalizeTrainingText(item.correctedText, 420);
  const parts = [meta.rule];
  if (note) parts.push(`Причина из диалога: ${note}`);
  if (item.type === 'bad' && corrected) parts.push(`Правильный ориентир: ${corrected}`);
  return parts.join(' ');
}

function addTrainingExample(input = {}) {
  const type = input.type === 'good' ? 'good' : 'bad';
  const item = {
    id: crypto.randomUUID(),
    type,
    active: true,
    createdAt: new Date().toISOString(),
    chatId: String(input.chatId || '').trim(),
    category: inferTrainingCategory(input),
    contextText: normalizeTrainingBlock(input.contextText, 2200),
    clientText: normalizeTrainingText(input.clientText, 900),
    aiText: normalizeTrainingText(input.aiText, 1200),
    correctedText: normalizeTrainingText(input.correctedText, 1200),
    note: normalizeTrainingText(input.note, 600),
  };
  item.ruleText = buildTrainingRuleText(item);

  if (!item.contextText && (!item.clientText || !item.aiText)) {
    throw new Error('Нужен фрагмент диалога или пара клиент + AI');
  }
  if (!item.note) {
    throw new Error('Добавьте короткий комментарий: почему это хорошо или плохо');
  }
  if (type === 'bad' && !item.correctedText) {
    throw new Error('Для плохого ответа нужен правильный вариант');
  }

  trainingStore.items.unshift(item);
  trainingStore.items = trainingStore.items.slice(0, MAX_TRAINING_EXAMPLES);
  saveTrainingStore();
  return item;
}

function scoreTrainingExample(item, queryText = '', memoryContext = null) {
  const source = [
    queryText,
    memoryContext?.summary,
    ...(memoryContext?.history || []).slice(-6).map((message) => message.content || ''),
  ].join(' ');
  const queryTokens = new Set(tokenizeTrainingText(source));
  if (!queryTokens.size) return 0;

  const itemTokens = tokenizeTrainingText([
    item.category,
    item.note,
    item.contextText,
    item.clientText,
    item.aiText,
    item.correctedText,
    item.ruleText,
  ].join(' '));
  const overlap = itemTokens.reduce((sum, token) => sum + (queryTokens.has(token) ? 1 : 0), 0);
  const category = getTrainingCategory(item.category);
  const categoryHit = (TRAINING_CATEGORIES[category]?.keywords || []).some((keyword) => (
    String(source).toLowerCase().replace(/ё/g, 'е').includes(String(keyword).toLowerCase().replace(/ё/g, 'е'))
  ));
  return overlap + (categoryHit ? 3 : 0) + (item.type === 'bad' ? 1 : 0);
}

function selectTrainingExamples(queryText = '', memoryContext = null) {
  const all = (trainingStore.items || []).filter((item) => item && item.active !== false);
  const relevant = all
    .map((item, index) => ({ item, index, score: scoreTrainingExample(item, queryText, memoryContext) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, TRAINING_RELEVANT_PROMPT_EXAMPLES)
    .map((entry) => entry.item);
  const selectedIds = new Set(relevant.map((item) => item.id));
  const recent = all
    .filter((item) => !selectedIds.has(item.id))
    .slice(0, TRAINING_RECENT_PROMPT_EXAMPLES);
  return [...relevant, ...recent].slice(0, TRAINING_PROMPT_EXAMPLES);
}

function findTrainingExample(id) {
  return (trainingStore.items || []).find((item) => item?.id === id) || null;
}

function updateTrainingExample(id, input = {}) {
  const item = findTrainingExample(id);
  if (!item) return null;

  if (Object.prototype.hasOwnProperty.call(input, 'active')) {
    item.active = input.active !== false;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'category')) {
    item.category = getTrainingCategory(String(input.category || '').trim());
  }
  if (Object.prototype.hasOwnProperty.call(input, 'ruleText')) {
    item.ruleText = normalizeTrainingText(input.ruleText, 1200);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'note')) {
    item.note = normalizeTrainingText(input.note, 600);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'correctedText')) {
    item.correctedText = normalizeTrainingText(input.correctedText, 1200);
  }

  if (!item.category) item.category = inferTrainingCategory(item);
  if (!item.ruleText) item.ruleText = buildTrainingRuleText(item);
  item.updatedAt = new Date().toISOString();
  saveTrainingStore();
  return item;
}

function getTrainingExamplesGuidance(queryText = '', memoryContext = null) {
  const items = selectTrainingExamples(queryText, memoryContext);
  if (!items.length) return '';

  const rows = items.map((item, index) => {
    const category = getTrainingCategory(item.category);
    const categoryLabel = TRAINING_CATEGORIES[category]?.label || TRAINING_CATEGORIES.other.label;
    const ruleText = item.ruleText || buildTrainingRuleText({ ...item, category });
    if (item.type === 'good') {
      return [
        `Урок ${index + 1}: хороший ответ. Категория: ${categoryLabel}. Использовать как ориентир по смыслу и тону, не копировать дословно.`,
        ruleText && `Правило: ${ruleText}`,
        item.contextText ? `Фрагмент диалога:\n${item.contextText}` : `Клиент: ${item.clientText}`,
        item.aiText && `Хороший ответ: ${item.aiText}`,
        item.note && `Почему хорошо: ${item.note}`,
      ].filter(Boolean).join('\n');
    }

    return [
      `Урок ${index + 1}: плохой ответ. Категория: ${categoryLabel}. Не повторять ошибку, исправлять по правильному варианту.`,
      ruleText && `Правило: ${ruleText}`,
      item.contextText ? `Фрагмент диалога:\n${item.contextText}` : `Клиент: ${item.clientText}`,
      item.aiText && `Плохой ответ: ${item.aiText}`,
      `Правильно отвечать так: ${item.correctedText}`,
      item.note && `Причина: ${item.note}`,
    ].filter(Boolean).join('\n');
  });

  return [
    'Обучение на диалогах IWAK:',
    '- Эти уроки важнее общего стиля, если есть конфликт.',
    '- Подбирай уроки по смыслу текущего диалога: не тащи правило в неподходящую ситуацию.',
    '- Если во фрагменте есть время или паузы между сообщениями, учитывай темп диалога: не торопи клиента и не игнорируй долгую паузу.',
    '- Если в уроке показано, что факт был выдуман, не повторять этот факт и честно просить уточнение.',
    '- Если урок говорит, что клиент уже дал данные, не спрашивай их повторно.',
    '- Хорошие ответы использовать как ориентир, плохие ответы не копировать.',
    ...rows,
  ].join('\n\n');
}

function getMemoryCutoff(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function cleanupMemoryStore() {
  const messagesCutoff = getMemoryCutoff(MEMORY_MESSAGES_TTL_DAYS);
  const factsCutoff = getMemoryCutoff(MEMORY_FACTS_TTL_DAYS);
  const stateCutoff = getMemoryCutoff(MEMORY_STATE_TTL_DAYS);

  memoryStore.messages = memoryStore.messages
    .filter((message) => new Date(message.createdAt).getTime() >= messagesCutoff)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MEMORY_MAX_MESSAGES);

  Object.entries(memoryStore.facts).forEach(([chatId, facts]) => {
    Object.entries(facts || {}).forEach(([key, fact]) => {
      if (new Date(fact.updatedAt || 0).getTime() < factsCutoff) {
        delete facts[key];
      }
    });
    if (!Object.keys(facts || {}).length) delete memoryStore.facts[chatId];
  });

  Object.entries(memoryStore.states).forEach(([chatId, state]) => {
    if (new Date(state.updatedAt || 0).getTime() < stateCutoff) {
      delete memoryStore.states[chatId];
    }
  });
}

function persistMemoryStore() {
  try {
    cleanupMemoryStore();
    saveMemoryStore();
  } catch (error) {
    logEvent('ERROR', {
      scope: 'memory.write',
      status: 'error',
      error: error.message,
    });
  }
}

function normalizeMemoryText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function getMemoryChatId(inputOrChatId) {
  const raw = typeof inputOrChatId === 'object'
    ? inputOrChatId.chatId || inputOrChatId.userId
    : inputOrChatId;
  return String(raw || '').trim();
}

function getMemoryMessageText(input) {
  const text = normalizeMemoryText(input.text);
  if (text) return text;
  if (input.messageType === 'photo') return '[photo] Клиент прислал фото.';
  if (input.messageType === 'video_note') return '[video_note] Клиент прислал video note.';
  if (input.messageType === 'voice') return '[voice] Клиент прислал голосовое сообщение.';
  if (input.hasMedia) return `[${input.messageType || 'media'}] Клиент прислал медиа.`;
  return '';
}

function safeCustomerStoreCall(scope, action, fallback = null) {
  if (!customerStore) return fallback;
  try {
    return action(customerStore);
  } catch (error) {
    logEvent('ERROR', {
      scope,
      status: 'error',
      error: error.message,
    });
    return fallback;
  }
}

function appendMemoryMessage(input, role, text) {
  const chatId = getMemoryChatId(input);
  const cleanText = normalizeMemoryText(text);
  if (!chatId || !cleanText) return;

  safeCustomerStoreCall('customer.message.append', (store) => store.appendMessage(input, role, cleanText));

  const telegramMessageId = role !== 'assistant' ? String(input.messageId || '') : '';
  const traceId = String(input.traceId || '');
  const duplicate = memoryStore.messages.some((message) => (
    message.chatId === chatId
    && message.role === role
    && (
      (telegramMessageId && message.telegramMessageId === telegramMessageId)
      || (!telegramMessageId && traceId && message.traceId === traceId)
    )
  ));
  if (duplicate) return;

  memoryStore.messages.push({
    id: crypto.randomUUID(),
    chatId,
    userId: String(input.userId || chatId),
    role,
    type: input.messageType || 'text',
    text: cleanText,
    media: Array.isArray(input.media) ? input.media.slice(0, 8) : [],
    telegramMessageId,
    traceId,
    createdAt: new Date().toISOString(),
  });
  persistMemoryStore();
}

function upsertMemoryFact(chatId, key, value, source) {
  const cleanChatId = getMemoryChatId(chatId);
  const cleanValue = normalizeMemoryText(value);
  if (!cleanChatId || !key || !cleanValue) return;

  safeCustomerStoreCall('customer.fact.upsert', (store) => store.upsertFact(cleanChatId, key, cleanValue, source));

  if (!memoryStore.facts[cleanChatId]) memoryStore.facts[cleanChatId] = {};
  memoryStore.facts[cleanChatId][key] = {
    value: cleanValue,
    confidence: 'explicit',
    source: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
}

function setConversationStage(chatId, stage, source) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId || !stage) return;
  safeCustomerStoreCall('customer.state.stage', (store) => store.setDialogState(cleanChatId, { stage, source }));
  memoryStore.states[cleanChatId] = {
    ...(memoryStore.states[cleanChatId] || {}),
    stage,
    source: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
}

function upsertBusinessConnection(connection = {}) {
  const id = String(connection.id || '').trim();
  if (!id) return null;

  const normalized = {
    id,
    userId: String(connection.user?.id || connection.userId || '').trim(),
    userChatId: String(connection.user_chat_id || connection.userChatId || '').trim(),
    isEnabled: connection.is_enabled !== false,
    rights: connection.rights || null,
    updatedAt: new Date().toISOString(),
  };

  memoryStore.businessConnections[id] = {
    ...(memoryStore.businessConnections[id] || {}),
    ...normalized,
  };
  safeCustomerStoreCall('customer.business_connection.upsert', (store) => store.upsertBusinessConnection(normalized));
  persistMemoryStore();
  return memoryStore.businessConnections[id];
}

function getBusinessConnectionById(id) {
  const cleanId = String(id || '').trim();
  const dbConnection = safeCustomerStoreCall('customer.business_connection.get', (store) => store.getBusinessConnection(cleanId));
  if (dbConnection) return dbConnection;
  return cleanId ? memoryStore.businessConnections[cleanId] || null : null;
}

function getBusinessConnectionByUserChatId(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return null;
  const dbConnection = safeCustomerStoreCall('customer.business_connection.get_by_chat', (store) => (
    typeof store.getBusinessConnectionByUserChatId === 'function'
      ? store.getBusinessConnectionByUserChatId(cleanChatId)
      : null
  ));
  if (dbConnection) return dbConnection;
  return Object.values(memoryStore.businessConnections || {})
    .filter((connection) => String(connection.userChatId || '') === cleanChatId && connection.isEnabled !== false)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0] || null;
}

function getBusinessConnectionForFollowupChat(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return null;

  const storedConnection = getBusinessConnectionByUserChatId(cleanChatId);
  if (storedConnection?.id) return storedConnection;

  const logConnectionId = getMergedLogs()
    .filter((item) => (
      String(item.chatId || item.userId || '').trim() === cleanChatId
      && String(item.businessConnectionId || '').trim()
    ))
    .sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0))[0]?.businessConnectionId || '';

  if (!logConnectionId) return null;

  return rememberBusinessConnectionChat(logConnectionId, cleanChatId)
    || getBusinessConnectionById(logConnectionId)
    || { id: logConnectionId, userChatId: cleanChatId, isEnabled: true };
}

function rememberBusinessConnectionChat(businessConnectionId, chatId) {
  const id = String(businessConnectionId || '').trim();
  const userChatId = String(chatId || '').trim();
  if (!id || !userChatId) return null;
  const existing = getBusinessConnectionById(id) || {};
  return upsertBusinessConnection({
    id,
    userId: existing.userId || '',
    user_chat_id: userChatId,
    is_enabled: existing.isEnabled !== false,
    rights: existing.rights || null,
  });
}

function setDialogAiMode(chatId, mode, source = '') {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId || !mode) return null;
  const previous = memoryStore.states[cleanChatId] || {};
  const next = {
    ...previous,
    aiMode: mode,
    modeSource: normalizeMemoryText(source).slice(0, 240),
    updatedAt: new Date().toISOString(),
  };
  if (mode === 'active') {
    delete next.autoTakeoverAt;
    delete next.pendingSince;
  }
  memoryStore.states[cleanChatId] = next;
  safeCustomerStoreCall('customer.state.mode', (store) => store.setDialogState(cleanChatId, next));
  persistMemoryStore();
  return next;
}

function markLatestClientTrace(input) {
  const cleanChatId = getMemoryChatId(input?.chatId || input);
  const traceId = String(input?.traceId || '').trim();
  if (!cleanChatId || !traceId) return null;
  const previous = memoryStore.states[cleanChatId] || {};
  const next = {
    ...previous,
    lastClientTraceId: traceId,
    updatedAt: new Date().toISOString(),
  };
  memoryStore.states[cleanChatId] = next;
  safeCustomerStoreCall('customer.state.last_client', (store) => store.setDialogState(cleanChatId, next));
  persistMemoryStore();
  return next;
}

function setManagerActive(chatId, input, source = '') {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return null;
  cancelManagerReturnTimer(cleanChatId);
  const now = new Date().toISOString();
  memoryStore.states[cleanChatId] = {
    ...(memoryStore.states[cleanChatId] || {}),
    aiMode: 'passive_manager',
    managerActiveAt: now,
    managerLastMessageAt: now,
    autoTakeoverAt: '',
    pendingSince: '',
    modeSource: normalizeMemoryText(source).slice(0, 240),
    lastManagerTraceId: input?.traceId || '',
    updatedAt: now,
  };
  safeCustomerStoreCall('customer.state.manager_active', (store) => store.setDialogState(cleanChatId, memoryStore.states[cleanChatId]));
  persistMemoryStore();
  return memoryStore.states[cleanChatId];
}

function getDialogState(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  const dbState = safeCustomerStoreCall('customer.state.get', (store) => store.getDialogState(cleanChatId));
  if (dbState) return dbState;
  return cleanChatId ? memoryStore.states[cleanChatId] || null : null;
}

function getCustomerProfileSnapshot(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  const profile = safeCustomerStoreCall('customer.profile.get', (store) => store.getCustomerProfile(cleanChatId));
  if (profile) return profile;
  return {
    customer: null,
    facts: memoryStore.facts[cleanChatId] || {},
    state: getDialogState(cleanChatId),
    lastOrder: null,
    recentMessages: getRecentMemoryMessages(cleanChatId, 20),
  };
}

function extractPhone(text) {
  const source = String(text || '');
  const matches = source.match(/(?:\+?\d[\s().-]*){10,16}/g) || [];
  const hasPhoneHint = /(тел(?:ефон)?|номер|контакт|phone|whatsapp|ватсап)/i.test(source);
  for (const match of matches) {
    const groups = match.match(/\d+/g) || [];
    if (!groups.length) continue;
    const digits = match.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) continue;
    if (!digits.startsWith('9') && !digits.startsWith('7') && !digits.startsWith('8')) continue;

    if (!hasPhoneHint) {
      const manyTinyGroups = groups.length >= 4 && groups.filter((group) => group.length <= 2).length >= 3;
      const hasPriceLikeTail = groups.some((group) => group.length >= 4);
      if (manyTinyGroups && hasPriceLikeTail) continue;
    }

    if (digits.length === 10) return `+7${digits}`;
    if (digits.startsWith('8')) return `+7${digits.slice(1)}`;
    if (digits.startsWith('7')) return `+${digits}`;
    return `+7${digits.slice(-10)}`;
  }
  return '';
}

function normalizeSizeToken(value) {
  return String(value || '').replace(',', '.').trim().toUpperCase();
}

function extractSizeTokens(text) {
  const seen = new Set();
  const tokens = [];
  const pattern = /\b(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\b/gi;
  for (const match of String(text || '').matchAll(pattern)) {
    const token = normalizeSizeToken(match[1]);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function extractAvailableSizeOptions(text) {
  const source = String(text || '');
  const options = [];
  const seen = new Set();
  const patterns = [
    /(?:^|\n|\r)\s*(?:доступные\s+)?размер(?:ы)?\s*[:\-]\s*([^\n\r]+)/gi,
    /(?:^|\n|\r)\s*(?:в\s+наличии|есть)\s+размер(?:ы)?\s*[:\-]?\s*([^\n\r]+)/gi,
  ];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      extractSizeTokens(match[1]).forEach((token) => {
        if (seen.has(token)) return;
        seen.add(token);
        options.push(token);
      });
    }
  });
  return options;
}

function extractAvailableShoeSizeInsolePairs(text) {
  const source = String(text || '');
  if (!/(остал[аои]?с[ья]?|остались|в\s+наличии|наличие|есть)/i.test(source)) return [];
  if (!/(размер|стельк|см|остал[аои]?с[ья]?|остались)/i.test(source)) return [];

  const pairs = [];
  const seen = new Set();
  const patterns = [
    /\b(3[5-9]|4[0-9])\s*(?:[-–—/:=]|\s+)\s*(2[0-9]|3[0-2])(?:[,.](\d))?\s*(?:см|cm)?\b/g,
    /\b(3[5-9]|4[0-9])\s*(?:размер|р-р)?\s*(?:стелька|стельки|по\s+стельке)\s*(2[0-9]|3[0-2])(?:[,.](\d))?\s*(?:см|cm)?\b/gi,
  ];

  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const size = String(match[1]);
      const insole = Number(`${match[2]}.${match[3] || 0}`);
      if (!Number.isFinite(insole) || insole < 20 || insole > 32.5) continue;
      const key = `${size}:${insole}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ size, insole });
    }
  });

  return pairs;
}

function serializeAvailableShoeSizePairs(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => `${pair.size}:${formatCm(pair.insole)}`)
    .join('; ');
}

function parseAvailableShoeSizePairs(value = '') {
  const pairs = [];
  const seen = new Set();
  for (const part of String(value || '').split(/[;\n]+/)) {
    const match = part.match(/\b(3[5-9]|4[0-9])\s*:\s*(2[0-9]|3[0-2])(?:[,.](\d))?\b/);
    if (!match) continue;
    const size = String(match[1]);
    const insole = Number(`${match[2]}.${match[3] || 0}`);
    const key = `${size}:${insole}`;
    if (!Number.isFinite(insole) || seen.has(key)) continue;
    seen.add(key);
    pairs.push({ size, insole });
  }
  return pairs;
}

function formatAvailableShoeSizePairs(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((pair) => `${pair.size} (${formatCm(pair.insole)} см)`)
    .join(', ');
}

function extractSingleLabeledSize(text) {
  const source = String(text || '');
  const match = source.match(/(?:^|\n|\r)\s*(?:размер\s+клиента|нужный\s+размер|выбранный\s+размер|размер|size)\s*[:\-]\s*([^\n\r]+)/i);
  if (!match) return '';
  const tokens = extractSizeTokens(match[1]);
  return tokens.length === 1 ? tokens[0] : '';
}

function extractShoeSize(text) {
  const source = String(text || '').trim();
  if (!source) return '';

  const labeled = extractSingleLabeledSize(source);
  if (labeled) return labeled;

  const patterns = [
    /(?:у\s+меня|мой\s+размер|мои?\s+размер|ношу|размер\s+у\s+меня)\s*(?:размер\s*)?(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?/i,
    /(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)\b/i,
    /(?:размер|size)\s*(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\b/i,
    /(?:есть|нужен|нужна|ищу|хочу|беру|возьму|можно(?:\s+\S+){0,2}|давайте|закаж(?:у|ите)?|оформ(?:ить|ляем)?|подойд[её]т|возьму)\s+(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?(?:\b|\?)/i,
    /(?:можно|беру|возьму|нужен|нужна|хочу|давайте)\s+(XXS|XS|S|M|L|XL|XXL|XXXL)\b/i,
    /(?:на|под)\s*(\d{2}(?:[.,]5)?)(?:\s*(?:размер|р-р))?(?:\b|\?)/i,
    /^(\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)?$/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return normalizeSizeToken(match[1]);
  }

  if (extractAvailableSizeOptions(source).length > 1) return '';
  return '';
}

function normalizeExtractedShoeSize(value, sourceText = '') {
  const explicit = extractShoeSize(sourceText);
  if (explicit) return explicit;
  const tokens = extractSizeTokens(value);
  if (tokens.length !== 1) return '';
  if (extractAvailableSizeOptions(sourceText).length > 1) return '';
  return tokens[0];
}

function extractNumericSize(text) {
  const token = extractShoeSize(text);
  return /^\d{2}(?:\.\d+)?$/.test(String(token || '')) ? token : '';
}

function extractSize(text) {
  return extractShoeSize(text);
}

function extractInsoleCm(text) {
  const source = String(text || '');
  const patterns = [
    /(?:стелька|стельки|по\s+стельке|стельк(?:а|и|е))\s*(?:в|—|-|:)?\s*(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)?\b/i,
    /(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)\s*(?:по\s+стельке|по\s+стельк|стелька|стельки|стельке)\b/i,
    /(?:по\s+стельке|по\s+стельк[еии])\s*(\d{1,2}(?:[.,]\d)?)\b/i,
    /(?:^|[\s,;:])(\d{1,2}(?:[.,]\d)?)\s*(?:см|cm)\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return match[1].replace(',', '.');
  }
  return '';
}

function normalizeNumericValue(value) {
  const normalized = String(value || '').replace(',', '.').replace(/[^\d.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

const SHOE_SIZE_INSOLE_RANGES = {
  35: [22.0, 22.8],
  36: [22.6, 23.4],
  37: [23.2, 24.0],
  38: [23.8, 24.6],
  39: [24.4, 25.2],
  40: [25.0, 25.8],
  41: [25.6, 26.4],
  42: [26.2, 27.0],
  43: [26.8, 27.6],
  44: [27.4, 28.4],
  45: [28.3, 29.2],
  46: [29.0, 30.1],
  47: [30.0, 30.8],
};

function getExpectedShoeSizesForInsole(insoleCm) {
  const insole = normalizeNumericValue(insoleCm);
  if (!insole) return [];
  return Object.entries(SHOE_SIZE_INSOLE_RANGES)
    .filter(([, range]) => insole >= range[0] - 0.15 && insole <= range[1] + 0.15)
    .map(([size]) => size);
}

function getShoeSizeInsoleIssue(sizeValue, insoleValue) {
  const size = Math.round(normalizeNumericValue(sizeValue));
  const insole = normalizeNumericValue(insoleValue);
  if (!size || !insole || !SHOE_SIZE_INSOLE_RANGES[size]) return null;
  const [min, max] = SHOE_SIZE_INSOLE_RANGES[size];
  if (insole >= min - 0.15 && insole <= max + 0.15) return null;
  const expectedSizes = getExpectedShoeSizesForInsole(insole);
  return {
    size,
    insole,
    min,
    max,
    expectedSizes,
    direction: insole > max ? 'too_big' : 'too_small',
  };
}

function getAvailableShoeSizeIssue(sizeValue, insoleValue, availablePairs = []) {
  const pairs = Array.isArray(availablePairs) ? availablePairs.filter(Boolean) : [];
  if (!pairs.length) return null;

  const size = Math.round(normalizeNumericValue(sizeValue));
  const insole = normalizeNumericValue(insoleValue);
  const availableSizes = pairs.map((pair) => String(pair.size));
  const hasSize = size ? availableSizes.includes(String(size)) : true;
  const hasInsole = insole
    ? pairs.some((pair) => Math.abs(Number(pair.insole) - insole) <= 0.35)
    : true;
  if (hasSize && hasInsole) return null;

  const maxInsole = Math.max(...pairs.map((pair) => Number(pair.insole) || 0));
  const minInsole = Math.min(...pairs.map((pair) => Number(pair.insole) || 0).filter(Boolean));
  return {
    size: size || '',
    insole: insole || '',
    availablePairs: pairs,
    availableSizes,
    maxInsole,
    minInsole,
    reason: !hasSize ? 'size_unavailable' : 'insole_unavailable',
  };
}

function formatCm(value) {
  return String(Number(value).toFixed(1)).replace('.', ',').replace(/,0$/, '');
}

function extractCity(text) {
  const match = String(text || '').match(/\b(?:город|г\.|из)\s+([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z -]{2,40})/);
  return match ? match[1].trim() : '';
}

function extractFullName(text) {
  const source = String(text || '').trim();
  const explicit = source.match(/(?:фио|имя)\s*[:\-]?\s*([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2})/i);
  if (explicit) return explicit[1].trim();
  if (!/(телефон|адрес|достав|оформ|получател|\+?\d[\s().-]*\d)/i.test(source)) return '';
  const lines = source.split(/\n|,/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /^[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2}$/.test(line));
  return candidate || '';
}

function extractDeliveryAddress(text) {
  const source = String(text || '').trim();
  const explicit = source.match(/(?:адрес|доставка|доставить|отправить)\s*[:\-]?\s*([^\n]{8,220})/i);
  if (explicit) return explicit[1].trim();
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.find((line) => /(ул\.?|улица|проспект|пр-т|дом|д\.|кв\.?|квартира|корпус|подъезд|москва|санкт|спб|область|район)/i.test(line) && line.length >= 8);
  return candidate || '';
}

function extractLastProduct(text) {
  const source = String(text || '');
  const cleanCandidate = (value) => {
    let candidate = normalizeMemoryText(value)
      .replace(/^(?:здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|привет)[!,.:\-\s]*/i, '')
      .replace(/^(?:хочу\s+заказать|оформить(?:\s+заказ)?|оформляем)\s*[:\-]?\s*/i, '')
      .trim();
    if (!candidate) return '';

    [
      /\s+(?:https?:\/\/|www\.)\S+.*$/i,
      /\s+(?:источник|source|ссылка|линк|link|url|канал|пост|сайт)\s*[:\-]?\s*.+$/i,
      /\s+(?:id|id\s+товара|товар\s+id|артикул|артикул\s+товара)\s*[:#-]?\s*\S.*$/i,
      /\s+(?:цена|стоимость)\s*[:\-]?\s*\d{3,6}(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?.*$/i,
      /\s+\d{3,6}\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?).*$/i,
    ].forEach((pattern) => {
      candidate = candidate.replace(pattern, '').trim();
    });

    candidate = candidate
      .replace(/\s+(?:(?:\d{2}(?:[.,]5)?|XXS|XS|S|M|L|XL|XXL|XXXL)\s*){2,}$/i, '')
      .replace(/\s+\d{2}(?:[.,]5)?\s*(?:размер|р-р|size)\s*$/i, '')
      .replace(/\s+(?:XXS|XS|S|M|L|XL|XXL|XXXL)\s*(?:размер|р-р|size)\s*$/i, '')
      .replace(/[|,;:-]\s*$/g, '')
      .trim();

    if (!candidate) return '';
    if (isSizeOnlyFollowupMessage(candidate)) return '';
    if (/^(?:цена|стоимость|price)\b/i.test(candidate)) return '';
    if (/^\d{3,6}(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?$/i.test(candidate)) return '';
    return candidate;
  };

  const explicitLine = source.match(/(?:^|\n|\r)\s*(?:модель|товар|кроссовки|пара)\s*[:\-]?\s*([^\n\r]{3,160})/i);
  if (explicitLine) {
    const cleaned = cleanCandidate(
      explicitLine[1].split(/\s+(?:цена|стоимость|размер(?:ы)?|цвет|артикул|количество)\s*[:\-]/i)[0],
    );
    if (cleaned) return cleaned;
  }
  const normalized = normalizeMemoryText(source);
  const explicit = normalized.match(/(?:модель|товар|кроссовки|пара)\s*[:\-]?\s*(.{3,120}?)(?=\s+(?:цена|стоимость|размер(?:ы)?|цвет|артикул|количество)\s*[:\-]|$)/i);
  if (explicit) {
    const cleaned = cleanCandidate(explicit[1]);
    if (cleaned) return cleaned;
  }
  const orderIntent = normalized.match(/(?:хочу\s+заказать|оформить(?:\s+заказ)?|оформляем)\s*[:\-]?\s*(.{3,200})/i);
  if (orderIntent) {
    const cleaned = cleanCandidate(orderIntent[1]);
    if (cleaned) return cleaned;
  }
  return '';
}

function extractOrderPrice(text) {
  const source = String(text || '');
  const labeled = source.match(/(?:цена|стоимость|итого)\s*[:\-]?\s*(\d{3,6})(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?/i);
  if (labeled) return labeled[1];
  const currency = source.match(/(?:^|[^\d])(\d{3,6})\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?)(?=$|[^0-9A-Za-zА-Яа-яЁё])/i);
  return currency ? currency[1] : '';
}

function extractPaymentProofAmount(text) {
  const source = String(text || '');
  const patterns = [
    /(?:сумма|итого|оплачено|перевод|плат[её]ж|к\s+оплате|amount|total)\s*[:\-]?\s*(\d[\d\s]{2,8})(?:[.,]\d{1,2})?\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?|rub)?/i,
    /(\d[\d\s]{2,8})(?:[.,]\d{1,2})?\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?|rub)\b/i,
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const amount = Number(String(match[1] || '').replace(/\s+/g, ''));
    if (amount >= 300 && amount <= 500000) return String(amount);
  }
  return '';
}

function extractDeliveryService(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return '';
  if (/(сд[эе]к|cdek)\b/i.test(source)) return 'CDEK';
  if (/(wildberries|\bwb\b)/i.test(source)) return 'WB';
  if (/(ozon|озон)\b/i.test(source)) return 'Ozon';
  if (/(яндекс.*достав|доставк.*яндекс|яндекс go|yandex)/i.test(source)) return 'Яндекс Доставка';
  if (/(почта\s+россии|почтой|почта)/i.test(source)) return 'Почта России';
  if (/(курьер|до двери)/i.test(source)) return 'Курьер';
  return '';
}

function extractPickupPoint(text) {
  const source = String(text || '').trim();
  if (!source) return '';
  const lines = source.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const explicit = lines.find((line) => /(пвз|пункт\s+выдачи|ozon|озон|wildberries|\bwb\b|сд[эе]к|cdek|яндекс|почта)/i.test(line) && line.length >= 6);
  if (explicit) return explicit;
  const inline = source.match(/(?:пвз|пункт\s+выдачи)\s*[:\-]?\s*([^\n]{4,180})/i);
  return inline ? inline[1].trim() : '';
}

function detectShoeContextFromText(text) {
  const source = String(text || '').toLowerCase();
  if (!source) return false;
  if (/(худи|футболк|лонгслив|штаны|джинс|куртк|свитшот|сумк|рюкзак|футболка|одежд)/i.test(source)) return false;
  return /(кроссовк|кеды|обув|shoe|sneaker|air max|air force|jordan|new balance|asics|yeezy|nike|adidas|puma|reebok|salomon|lacoste|odyssa)/i.test(source);
}

function buildSlotSnapshot(chatId, currentInput = null) {
  const profile = getCustomerProfileSnapshot(chatId) || {};
  const facts = profile.facts || {};
  const lastOrder = profile.lastOrder || {};
  const currentText = normalizeMemoryText(currentInput?.text || '');
  const product = normalizeMemoryText(lastOrder.product || facts.lastProduct?.value || facts.interest?.value || extractLastProduct(currentText));
  const size = normalizeMemoryText(lastOrder.size || facts.size?.value || facts.shoeSize?.value || extractSize(currentText));
  const insoleCm = normalizeMemoryText(facts.insoleCm?.value || extractInsoleCm(currentText));
  const fullName = normalizeMemoryText(lastOrder.full_name || facts.fullName?.value || extractFullName(currentText));
  const phone = normalizeMemoryText(lastOrder.phone || facts.phone?.value || extractPhone(currentText));
  const city = normalizeMemoryText(facts.city?.value || extractCity(currentText));
  const deliveryService = normalizeMemoryText(facts.deliveryService?.value || extractDeliveryService(currentText));
  const pickupPoint = normalizeMemoryText(facts.pickupPoint?.value || lastOrder.delivery_address || extractPickupPoint(currentText));
  const shoeContext = Boolean(
    facts.shoeContext?.value === 'true'
    || detectShoeContextFromText(product)
    || detectShoeContextFromText(facts.interest?.value || '')
    || detectShoeContextFromText(currentText)
  );
  const paymentRequested = ['payment_details_sent', 'proof_received'].includes(String(lastOrder.payment_status || ''));
  const paymentProofReceived = Boolean(
    lastOrder.payment_status === 'proof_received'
    || lastOrder.payment_check_status
    || lastOrder.proof_received_at
  );
  const availableShoeSizePairs = parseAvailableShoeSizePairs(facts.availableShoeSizePairs?.value || '');
  const sizeInsoleIssue = shoeContext ? getShoeSizeInsoleIssue(size, insoleCm) : null;
  const availabilityIssue = shoeContext && !sizeInsoleIssue
    ? getAvailableShoeSizeIssue(size, insoleCm, availableShoeSizePairs)
    : null;

  const closedSlots = [
    product && 'product',
    size && 'size',
    insoleCm && !sizeInsoleIssue && !availabilityIssue && 'insole_cm',
    fullName && 'full_name',
    phone && 'phone',
    city && 'city',
    deliveryService && 'delivery_service',
    pickupPoint && 'pickup_point',
    paymentRequested && 'payment_requested',
    paymentProofReceived && 'payment_proof_received',
  ].filter(Boolean);

  let nextBlockingSlot = '';
  if (!product) nextBlockingSlot = 'product';
  else if (!size) nextBlockingSlot = 'size';
  else if (sizeInsoleIssue) nextBlockingSlot = 'insole_confirm';
  else if (availabilityIssue) nextBlockingSlot = 'availability_confirm';
  else if (shoeContext && !insoleCm) nextBlockingSlot = 'insole_cm';
  else if (!fullName) nextBlockingSlot = 'full_name';
  else if (!phone) nextBlockingSlot = 'phone';
  else if (!deliveryService) nextBlockingSlot = 'delivery_service';
  else if (!pickupPoint) nextBlockingSlot = 'pickup_point';
  else if (parseConfigBoolean(currentInput?.config?.payment_enabled, false) && !paymentRequested) nextBlockingSlot = 'payment_requested';
  else if (parseConfigBoolean(currentInput?.config?.payment_enabled, false) && !paymentProofReceived) nextBlockingSlot = 'payment_proof_received';

  return {
    product,
    size,
    insoleCm,
    fullName,
    phone,
    city,
    deliveryService,
    pickupPoint,
    paymentRequested,
    paymentProofReceived,
    shoeContext,
    availableShoeSizePairs,
    sizeInsoleIssue,
    availabilityIssue,
    closedSlots,
    nextBlockingSlot,
  };
}

function buildSlotSummary(snapshot) {
  if (!snapshot) return '';
  const nextStepAction = {
    product: 'Уточнить товар',
    size: 'Уточнить размер',
    insole_cm: 'Уточнить длину стельки (см)',
    full_name: 'Запросить ФИО получателя',
    phone: 'Запросить телефон',
    city: 'Запросить город',
    delivery_service: 'Уточнить службу доставки',
    pickup_point: 'Уточнить ПВЗ или адрес',
    payment_requested: 'Перейти к оплате и дать реквизиты',
    payment_proof_received: 'Подтвердить получение чека',
    insole_confirm: 'Перепроверить связку размера и стельки',
    availability_confirm: 'Проверить остатки размера от менеджера',
  };
  const lines = [
    `- Товар: ${snapshot.product ? 'есть' : 'нет'}`,
    `- Размер: ${snapshot.size ? 'есть' : 'нет'}`,
    `- Стелька: ${snapshot.shoeContext ? (snapshot.insoleCm ? 'есть' : 'нет') : 'не нужна'}`,
    `- ФИО: ${snapshot.fullName ? 'есть' : 'нет'}`,
    `- Телефон: ${snapshot.phone ? 'есть' : 'нет'}`,
    `- Город: ${snapshot.city ? 'есть' : 'нет'}`,
    `- Служба доставки: ${snapshot.deliveryService ? 'есть' : 'нет'}`,
    `- ПВЗ/адрес: ${snapshot.pickupPoint ? 'есть' : 'нет'}`,
    snapshot.sizeInsoleIssue && `- Внимание: размер ${snapshot.sizeInsoleIssue.size} и ${formatCm(snapshot.sizeInsoleIssue.insole)} см по стельке выглядят несоответствием. Сначала перепроверить, не оформлять дальше.`,
    snapshot.availableShoeSizePairs?.length && `- Остатки по этой модели от менеджера: ${formatAvailableShoeSizePairs(snapshot.availableShoeSizePairs)}.`,
    snapshot.availabilityIssue && `- Внимание: выбранный размер/стелька не попадает в остатки менеджера. Не оформлять доставку, сначала предложить выбрать другой размер или модель.`,
    `- Реквизиты уже отправлены: ${snapshot.paymentRequested ? 'да' : 'нет'}`,
    `- Чек получен: ${snapshot.paymentProofReceived ? 'да' : 'нет'}`,
    snapshot.closedSlots?.length && `- Уже закрыто: ${snapshot.closedSlots.join(', ')}`,
    snapshot.nextBlockingSlot && nextStepAction[snapshot.nextBlockingSlot] && `- Ближайший шаг: ${nextStepAction[snapshot.nextBlockingSlot]}`,
  ].filter(Boolean);
  if (!lines.length) return '';
  return ['Контекст оформления для AI Control. Не копировать клиенту дословно:', ...lines].join('\n');
}

function isPaymentIntentText(text) {
  return /(куда\s+платить|как\s+оплат|реквизит|карта|номер\s+карты|перевести|оплатить)/i.test(String(text || ''));
}

function isPaymentProofText(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  return /(?:^|\b)(?:оплатил|оплатила|оплатили|перев[её]л|перевела|перевели|скинул(?:а|и)?\s+(?:оплат|чек|квитанц)|отправил(?:а|и)?\s+(?:оплат|чек|квитанц)|прислал(?:а|и)?\s+(?:оплат|чек|квитанц)|вот\s+(?:чек|квитанц)|ловите\s+(?:чек|квитанц)|чек\s+(?:прикрепил|прикрепила|отправил|отправила|прислал|прислала)|квитанц(?:ия|ию)\s+(?:прикрепил|прикрепила|отправил|отправила|прислал|прислала)|receipt|payment|pdf-файл\s+с\s+чеком|pdf.*квитанц|receipt\s+ocr)/i.test(source)
    || /^(?:чек|квитанц(?:ия|ию)?)[\s.!-]*$/i.test(source);
}

function isDeliveryMediaHintText(text) {
  return /(?:пвз|пункт(?:е|а)?\s+выдач|самовывоз|курьер|достав|куда\s+достав|куда\s+отправ|адрес|улиц|дом\s+\d|корпус|подъезд|ozon|озон|cdek|сд[эе]к|яндекс|yandex|почт[ауы]|карта|скрин\s+карт|геолокац|локац|метк[ау]|точк[ау]|вот\s+сюда|сюда\s+тогда|можете\s+(?:вот\s+)?сюда|этот\s+адрес|адрес\s+не\s+показывает)/i.test(String(text || ''));
}

function isProductMediaHintText(text) {
  return /(?:товар|модель|кроссов|кед[ыа]|обув|размер|стельк|цвет|фото\s+товара|скрин\s+товара|корзин|каталог|карточк[аи]\s+товар|iwak\.ru|ссылк[ау]|артикул|налич|подошв|nike|adidas|puma|new\s*balance|asics|reebok|crocs|balenciaga|prada|gucci)/i.test(String(text || ''));
}

function isNonPaymentMediaHintText(text) {
  return isDeliveryMediaHintText(text) || isProductMediaHintText(text);
}

function isPaymentProofInput(input) {
  const text = String(input.text || '').toLowerCase();
  if (isPaymentProofText(text)) return true;
  return false;
}

function inferConversationStage(input) {
  const text = String(input.text || '').toLowerCase();
  if (/(оплатил|оплатила|чек|квитанц|перев[её]л|скинул оплат)/i.test(text)) return 'waiting_payment';
  if (/(беру|оформляем|оформить|куда платить|реквизит|оплатить|заказываю)/i.test(text)) return 'ready_to_buy';
  if (/(фио|адрес|телефон|\+?\d[\s().-]*\d[\s().-]*\d[\s().-]*\d[\s().-]*\d)/i.test(text)) return 'collecting_order_info';
  if (/(размер|сколько стоит|цена|налич|есть\s+\d{2}|какие есть)/i.test(text)) return 'choosing';
  if (input.hasMedia || input.hasLinkInput || ['photo', 'document', 'video', 'video_note'].includes(input.messageType)) return 'interested';
  return '';
}

function updateCustomerMemoryFromInput(input) {
  const chatId = getMemoryChatId(input);
  const source = input.text || getMemoryMessageText(input);
  if (!chatId) return;
  const profileSnapshot = getCustomerProfileSnapshot(chatId) || {};
  const lastOrderSnapshot = profileSnapshot.lastOrder || {};
  const factsSnapshot = profileSnapshot.facts || memoryStore.facts[chatId] || {};

  const phone = extractPhone(input.text);
  if (phone) upsertMemoryFact(chatId, 'phone', phone, source);

  const size = extractSize(input.text);
  if (size) {
    upsertMemoryFact(chatId, 'size', size, source);
    if (/^\d{2}(?:\.\d+)?$/.test(size)) upsertMemoryFact(chatId, 'shoeSize', size, source);
  }

  const insoleCm = extractInsoleCm(input.text);
  if (insoleCm) upsertMemoryFact(chatId, 'insoleCm', insoleCm, source);

  const city = extractCity(input.text);
  if (city) upsertMemoryFact(chatId, 'city', city, source);

  const fullName = extractFullName(input.text);
  if (fullName) upsertMemoryFact(chatId, 'fullName', fullName, source);

  const deliveryAddress = extractDeliveryAddress(input.text);
  if (deliveryAddress) upsertMemoryFact(chatId, 'deliveryAddress', deliveryAddress, source);

  const deliveryService = extractDeliveryService(input.text);
  if (deliveryService) upsertMemoryFact(chatId, 'deliveryService', deliveryService, source);

  const pickupPoint = extractPickupPoint(input.text);
  if (pickupPoint) upsertMemoryFact(chatId, 'pickupPoint', pickupPoint, source);

  const lastProduct = extractLastProduct(input.text);
  if (lastProduct) upsertMemoryFact(chatId, 'lastProduct', lastProduct, source);
  const orderPrice = extractOrderPrice(source) || extractPaymentProofAmount(source);
  const commonOrderPatch = {
    product: lastProduct || lastOrderSnapshot.product || (factsSnapshot.lastProduct?.value || factsSnapshot.interest?.value || ''),
    size: size || lastOrderSnapshot.size || factsSnapshot.size?.value || factsSnapshot.shoeSize?.value || '',
    price: orderPrice || lastOrderSnapshot.price || '',
    fullName: fullName || lastOrderSnapshot.fullName || lastOrderSnapshot.full_name || factsSnapshot.fullName?.value || '',
    phone: phone || lastOrderSnapshot.phone || factsSnapshot.phone?.value || '',
    deliveryAddress: pickupPoint || deliveryAddress || lastOrderSnapshot.deliveryAddress || lastOrderSnapshot.delivery_address || factsSnapshot.pickupPoint?.value || factsSnapshot.deliveryAddress?.value || '',
  };

  const slotContextText = [lastProduct, memoryStore.facts[chatId]?.lastProduct?.value, memoryStore.facts[chatId]?.interest?.value, input.text].filter(Boolean).join(' ');
  if (detectShoeContextFromText(slotContextText)) {
    upsertMemoryFact(chatId, 'shoeContext', 'true', source);
  }

  if (input.hasMedia || input.hasLinkInput) {
    upsertMemoryFact(chatId, 'interest', getMemoryMessageText(input), source);
    upsertMemoryFact(chatId, 'lastProduct', getMemoryMessageText(input), source);
  }

  const stage = inferConversationStage(input);
  if (stage) setConversationStage(chatId, stage, source);

  if (isPaymentIntentText(input.text)) {
    safeCustomerStoreCall('customer.order.payment_requested', (store) => store.upsertOrder(chatId, {
      ...commonOrderPatch,
      status: 'waiting_payment',
      paymentStatus: 'payment_details_sent',
    }));
  }

  if (isPaymentProofInput(input)) {
    const paymentAmount = extractPaymentProofAmount(source) || extractOrderPrice(source) || commonOrderPatch.price;
    safeCustomerStoreCall('customer.order.payment_proof', (store) => store.upsertOrder(chatId, {
      ...commonOrderPatch,
      price: paymentAmount || commonOrderPatch.price,
      status: 'waiting_payment_check',
      paymentStatus: 'proof_received',
      paymentCheckStatus: 'proof_received',
      paymentCheckSummary: [
        paymentAmount && `Сумма из чека/контекста: ${formatMoneyAmount(paymentAmount)}`,
        input.messageType && `Тип сообщения: ${input.messageType}`,
        input.hasMedia && 'Клиент приложил медиа/файл',
      ].filter(Boolean).join('. '),
      proofReceivedAt: new Date().toISOString(),
    }));
  }

  if (stage === 'ready_to_buy' || stage === 'collecting_order_info') {
    safeCustomerStoreCall('customer.order.draft', (store) => store.upsertOrder(chatId, {
      ...commonOrderPatch,
      status: stage === 'ready_to_buy' ? 'draft' : 'collecting_info',
    }));
  }

  persistMemoryStore();
}

function applyManagerStageHints(input) {
  const text = String(input?.text || '');
  const chatId = getMemoryChatId(input?.chatId || input);
  if (!chatId || !text) return;

  if (/(передал[аи]?\s+в\s+доставк|передан[ао]?\s+в\s+доставк|отправил[аи]?\b|отправлен[ао]?\b|трек|накладн|номер\s+отправлени)/i.test(text)) {
    setConversationStage(chatId, 'delivery', text);
    safeCustomerStoreCall('customer.order.delivery', (store) => store.upsertOrder(chatId, {
      status: 'delivery',
    }));
  }

  const availablePairs = extractAvailableShoeSizeInsolePairs(text);
  if (availablePairs.length) {
    upsertMemoryFact(chatId, 'availableShoeSizePairs', serializeAvailableShoeSizePairs(availablePairs), text);
    upsertMemoryFact(chatId, 'shoeContext', 'true', text);
  }
}

function getRecentMemoryMessages(chatId, limit = MEMORY_RECENT_LIMIT, excludeTraceIds = []) {
  const cleanChatId = getMemoryChatId(chatId);
  const excluded = new Set((excludeTraceIds || []).filter(Boolean));
  if (!cleanChatId) return [];
  const dbMessages = safeCustomerStoreCall('customer.messages.recent', (store) => store.getRecentMessages(cleanChatId, limit, excludeTraceIds));
  if (Array.isArray(dbMessages) && dbMessages.length) return dbMessages;
  return memoryStore.messages
    .filter((message) => message.chatId === cleanChatId)
    .filter((message) => !excluded.has(message.traceId))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-limit);
}

function selectRecentDialogTurns(messages = [], limit = MEMORY_RECENT_LIMIT) {
  const items = Array.isArray(messages) ? messages.filter(Boolean) : [];
  const maxTurns = getConfigMemoryLimit({ memory_recent_limit: limit });
  let turns = 0;
  let insideClientBlock = false;
  let startIndex = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const role = items[index]?.role;
    if (role === 'user') {
      if (!insideClientBlock) {
        turns += 1;
        insideClientBlock = true;
        if (turns > maxTurns) {
          startIndex = index + 1;
          break;
        }
      }
    } else {
      insideClientBlock = false;
    }
  }

  return items.slice(startIndex);
}

function formatMemoryFacts(facts = {}) {
  const labels = {
    name: 'Имя',
    fullName: 'ФИО',
    phone: 'Телефон',
    city: 'Город',
    size: 'Размер',
    address: 'Адрес доставки',
    deliveryAddress: 'Адрес доставки',
    shoeSize: 'Размер обуви',
    insoleCm: 'Стелька, см',
    deliveryService: 'Служба доставки',
    pickupPoint: 'ПВЗ',
    interest: 'Интерес клиента',
    lastProduct: 'Последний товар',
  };
  return Object.entries(labels)
    .filter(([key]) => facts[key]?.value)
    .map(([key, label]) => `${label}: ${facts[key].value}`);
}

function buildMemoryContext(chatId, options = {}) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return { summary: '', history: [], facts: {}, state: null };

  const dbContext = safeCustomerStoreCall('customer.context.get', (store) => store.getCustomerContext(cleanChatId, {
    limit: options.limit || MEMORY_RECENT_LIMIT,
    excludeTraceIds: options.excludeTraceIds || [],
  }));
  if (dbContext) {
    const slotSnapshot = buildSlotSnapshot(cleanChatId, options.currentInput || null);
    const slotSummary = buildSlotSummary(slotSnapshot);
    return {
      ...dbContext,
      summary: [dbContext.summary, slotSummary].filter(Boolean).join('\n\n'),
      slotSnapshot,
    };
  }

  const facts = memoryStore.facts[cleanChatId] || {};
  const state = memoryStore.states[cleanChatId] || null;
  const factLines = formatMemoryFacts(facts);

  const baseSummary = factLines.length
    ? [
      'Память клиента:',
      ...factLines.map((line) => `- ${line}`),
    ].filter(Boolean).join('\n')
    : '';

  let usedChars = 0;
  const history = [];
  const dialogHistory = selectRecentDialogTurns(
    getRecentMemoryMessages(
      cleanChatId,
      Math.min(100, (options.limit || MEMORY_RECENT_LIMIT) * 6),
      options.excludeTraceIds || [],
    ),
    options.limit || MEMORY_RECENT_LIMIT,
  );

  dialogHistory.reverse().forEach((message) => {
    const text = normalizeMemoryText(message.text);
    if (!text || usedChars + text.length > MEMORY_HISTORY_CHAR_LIMIT) return;
    usedChars += text.length;
    const content = message.role === 'manager'
      ? `Менеджер: ${text}`
      : text;
    history.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content,
      createdAt: message.createdAt,
      type: message.type,
    });
  });

  const slotSnapshot = buildSlotSnapshot(cleanChatId, options.currentInput || null);
  const slotSummary = buildSlotSummary(slotSnapshot);

  return {
    summary: [baseSummary, slotSummary].filter(Boolean).join('\n\n'),
    history: history.reverse(),
    facts,
    state,
    slotSnapshot,
  };
}

function buildBatchText(inputs) {
  const orderedInputs = [...inputs].sort((left, right) => {
    const leftStructured = looksLikeStructuredOrderPayload(left.text);
    const rightStructured = looksLikeStructuredOrderPayload(right.text);
    if (leftStructured !== rightStructured) return leftStructured ? -1 : 1;
    const leftSizeOnly = isSizeOnlyFollowupMessage(left.text);
    const rightSizeOnly = isSizeOnlyFollowupMessage(right.text);
    if (leftSizeOnly !== rightSizeOnly) return leftSizeOnly ? 1 : -1;
    return 0;
  });

  const items = orderedInputs
    .map((input) => getMemoryMessageText(input))
    .filter(Boolean);

  if (!items.length) return '';
  if (items.length === 1) return items[0];

  return items.join('\n\n');
}

function looksLikeStructuredOrderPayload(text) {
  const source = String(text || '').trim();
  if (!source) return false;
  let score = 0;
  if (/(хочу заказать|оформить заказ|заказ[:\s])/i.test(source)) score += 2;
  if (/\n/.test(source)) score += 1;
  if (/(товар|модель|кроссовки|пара|цена|стоимость|артикул|цвет|размер|количество)\s*[:\-]/i.test(source)) score += 1;
  if (/цена\s*[:\-]?\s*\d{3,5}/i.test(source)) score += 1;
  return score >= 3;
}

function isFullNameOnlyText(text) {
  const source = String(text || '').trim();
  if (!source || source.length > 90) return false;
  if (/[?!:;@#/=]|\d/.test(source)) return false;
  if (/(достав|оплат|чек|товар|модель|размер|пвз|курьер|cdek|сд[эе]к|ozon|wb|яндекс|почт)/i.test(source)) return false;
  return /^[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+(?:\s+[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]+){1,2}$/.test(source);
}

function isCityOnlyText(text) {
  const source = normalizeMemoryText(text);
  if (!source || source.length > 60) return false;
  if (/[?!:;@#/=]|\d/.test(source)) return false;
  return /^(?:город\s+|г\.\s*|из\s+)?(?:москва|санкт[- ]петербург|спб|казань|сочи|краснодар|екатеринбург|новосибирск|ростов(?:-на-дону)?|самара|уфа|пермь|омск|челябинск|воронеж|нижний\s+новгород)$/i.test(source);
}

function isPickupPointText(text) {
  return /(?:пвз|пункт(?:е|а)?\s+выдач|cdek|сд[эе]к|ozon|озон|wb|wildberries|вайлдберр|яндекс|почт[ауы]|рядом\s+с\s+домом)/i.test(String(text || ''));
}

function isDeliveryTopicText(text) {
  return /(?:доставк|пвз|пункт(?:е|а)?\s+выдач|cdek|сд[эе]к|ozon|озон|wb|wildberries|вайлдберр|яндекс|почт[ауы]|курьер|по\s+москве|москва)/i.test(String(text || ''));
}

function isPaymentTopicText(text) {
  return isPaymentIntentText(text)
    || /(оплатил|оплатила|оплатили|перев[её]л|перевела|чек|квитанц|скрин.*оплат|receipt|payment)/i.test(String(text || ''));
}

function getSemanticMergeInfo(input = {}) {
  const text = String(input.text || '');
  const structuredOrder = looksLikeStructuredOrderPayload(text);
  const sizeOnly = isSizeOnlyFollowupMessage(text);
  const phone = !!extractPhone(text);
  const fullName = !!extractFullName(text) || isFullNameOnlyText(text);
  const city = !!extractCity(text) || isCityOnlyText(text);
  const pickup = isPickupPointText(text);
  const delivery = isDeliveryTopicText(text);
  const payment = isPaymentTopicText(text) || isPaymentProofInput(input);
  const returnTopic = /(возврат|вернуть|обмен|гарант)/i.test(text);
  const product = structuredOrder || !!extractLastProduct(text) || input.hasMedia || input.hasLinkInput;
  const contact = sizeOnly || phone || fullName || city || pickup;
  return {
    structuredOrder,
    sizeOnly,
    phone,
    fullName,
    city,
    pickup,
    delivery,
    payment,
    returnTopic,
    product,
    contact,
    hasMedia: !!input.hasMedia,
  };
}

function batchNeedsSemanticMerge(inputs = []) {
  if (!inputs.length) return false;
  const infos = inputs.map((input) => getSemanticMergeInfo(input));
  if (infos.some((info) => info.returnTopic)) return false;

  const checkoutPieces = infos.every((info) => (
    info.structuredOrder
    || info.sizeOnly
    || info.phone
    || info.fullName
    || info.city
    || info.pickup
    || info.product
  ));
  const hasCheckoutAnchor = infos.some((info) => info.structuredOrder || info.product || info.sizeOnly);
  const hasCheckoutDetail = infos.some((info) => info.phone || info.fullName || info.city || info.pickup || info.sizeOnly);
  if (checkoutPieces && hasCheckoutAnchor && hasCheckoutDetail) return true;

  const deliveryPieces = infos.every((info) => info.delivery || info.pickup || info.city);
  if (deliveryPieces && infos.some((info) => info.delivery || info.pickup)) return true;

  const paymentPieces = infos.every((info) => info.payment || info.hasMedia);
  if (paymentPieces && infos.some((info) => info.payment)) return true;

  return false;
}

function isSizeOnlyFollowupMessage(text) {
  const source = normalizeMemoryText(text);
  const size = extractShoeSize(source);
  if (!size || !source || source.length > 80) return false;
  if (containsLink(source)) return false;
  if (extractFullName(source) || extractPhone(source) || extractCity(source) || extractDeliveryAddress(source)) return false;
  const stripped = source.replace(size, '').trim();
  return !/(товар|модель|кроссовки|пара|цена|стоимость|артикул|фио|телефон|город|адрес|доставк|оплат|чек)/i.test(stripped);
}

function batchHasStructuredOrderPayload(inputs = []) {
  return inputs.some((input) => looksLikeStructuredOrderPayload(input.text));
}

function batchHasSizeOnlyFollowup(inputs = []) {
  return inputs.some((input) => isSizeOnlyFollowupMessage(input.text));
}

function batchHasPendingStructuredOrder(inputs = []) {
  return inputs.some((input) => looksLikeStructuredOrderPayload(input.text) && !extractShoeSize(input.text))
    && !batchHasSizeOnlyFollowup(inputs);
}

function batchNeedsPendingPayloadContext(inputs = []) {
  if (!inputs.length || batchHasStructuredOrderPayload(inputs) || batchHasPendingStructuredOrder(inputs)) return false;
  if (!batchHasSizeOnlyFollowup(inputs)) return false;
  const lastInput = inputs[inputs.length - 1];
  const profile = getCustomerProfileSnapshot(lastInput.chatId);
  return !(
    profile?.lastOrder?.product
    || profile?.facts?.lastProduct?.value
    || profile?.facts?.interest?.value
  );
}

function batchNeedsOrderContextMerge(inputs = []) {
  return batchHasPendingStructuredOrder(inputs)
    || (batchHasSizeOnlyFollowup(inputs) && !batchHasStructuredOrderPayload(inputs))
    || batchNeedsSemanticMerge(inputs);
}

function getOutgoingRequestBlockBeforeInputs(inputs = []) {
  const lastInput = inputs[inputs.length - 1];
  if (!lastInput?.chatId) return null;
  const excludeTraceIds = inputs.map((input) => input.traceId).filter(Boolean);
  const recentMessages = getRecentMemoryMessages(lastInput.chatId, 16, excludeTraceIds);
  const outgoing = [];
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (message?.role === 'assistant' || message?.role === 'manager') {
      outgoing.push(message);
      continue;
    }
    if (message?.role === 'user' && outgoing.length) break;
  }
  if (!outgoing.length) return null;
  const ordered = outgoing.reverse();
  return {
    ...ordered[ordered.length - 1],
    text: ordered.map((message) => message.text).filter(Boolean).join('\n'),
    createdAt: ordered[ordered.length - 1]?.createdAt || '',
  };
}

function countRequestCueKinds(text = '') {
  const source = String(text || '');
  return [
    /(?:фото|скрин|картин|изображ|ссылк[ау]|модел|товар)/i.test(source),
    /(?:размер|стельк|см\s+нога|сантиметр)/i.test(source),
    /(?:адрес|пвз|пункт(?:е|а)?\s+выдач|доставк|город|улиц)/i.test(source),
    /(?:фио|имя|фамил|телефон|номер)/i.test(source),
  ].filter(Boolean).length;
}

function isMultipartCustomerRequestText(text = '') {
  const source = String(text || '');
  if (!source) return false;
  const cueKinds = countRequestCueKinds(source);
  if (cueKinds < 2) return false;
  return /(?:пришл|продублир|напиш|скин|укаж|подскаж|нужн|чтобы\s+не\s+ошиб)/i.test(source);
}

function batchNeedsMultipartResponseWait(inputs = []) {
  if (!inputs.length) return false;
  const lastInput = inputs[inputs.length - 1];
  if (!parseConfigBoolean(lastInput?.config?.listen_wait_enabled, true)) return false;
  if (inputs.some((input) => isPaymentProofInput(input))) return false;
  const outgoingBlock = getOutgoingRequestBlockBeforeInputs(inputs);
  if (!outgoingBlock || !isMultipartCustomerRequestText(outgoingBlock.text)) return false;
  const outgoingAt = Date.parse(outgoingBlock.createdAt || '') || 0;
  if (outgoingAt && Date.now() - outgoingAt > 20 * 60 * 1000) return false;
  return true;
}

function getBatchDebounceDelayMs(batch, input) {
  const baseDelay = getConfigBatchDebounceMs(input.config);
  const inputs = Array.isArray(batch?.inputs) ? batch.inputs : [input];
  if (batchNeedsMultipartResponseWait(inputs)) {
    return Math.max(baseDelay, getConfigListenWaitDebounceMs(input.config));
  }
  if (batchHasPendingStructuredOrder(inputs)) {
    if (isSizeOnlyFollowupMessage(input.text)) {
      return Math.min(baseDelay, SIZE_ONLY_FOLLOWUP_DEBOUNCE_MS);
    }
    return Math.max(baseDelay, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsPendingPayloadContext(inputs)) {
    return Math.max(baseDelay, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseDelay, SEMANTIC_BATCH_DEBOUNCE_MS);
  }
  return baseDelay;
}

function getBatchMaxWindowMs(batch, input) {
  const baseWindow = Math.max(BATCH_MAX_WINDOW_MS, getConfigBatchDebounceMs(input.config) + 1000);
  const inputs = Array.isArray(batch?.inputs) ? batch.inputs : [input];
  if (batchNeedsMultipartResponseWait(inputs)) {
    return Math.max(baseWindow, getConfigListenWaitMaxWindowMs(input.config));
  }
  if (inputs.length > 1 && batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseWindow, SEMANTIC_BATCH_MAX_WINDOW_MS);
  }
  if (batchHasPendingStructuredOrder(inputs) || batchNeedsPendingPayloadContext(inputs)) {
    return Math.max(baseWindow, ORDER_CONTEXT_BATCH_MAX_WINDOW_MS);
  }
  if (batchNeedsSemanticMerge(inputs)) {
    return Math.max(baseWindow, SEMANTIC_BATCH_MAX_WINDOW_MS);
  }
  return baseWindow;
}

function scheduleBatchMaxTimer(key, batch, input) {
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  const maxWindowMs = getBatchMaxWindowMs(batch, input);
  const remainingMs = Math.max(0, maxWindowMs - (Date.now() - batch.startedAt));
  if (remainingMs === 0) {
    setImmediate(() => flushChatBatch(key));
    return;
  }
  batch.maxTimer = setTimeout(() => flushChatBatch(key), remainingMs);
}

function getBatchInputIdentity(input) {
  if (input?.traceId) return `trace:${input.traceId}`;
  if (input?.messageId) return `message:${input.updateType || ''}:${input.messageId}`;
  return `text:${input?.updateType || ''}:${normalizeMemoryText(input?.text || '')}`;
}

function mergeBatchInputs(inputs, extraInputs) {
  const seen = new Set();
  return [...inputs, ...extraInputs]
    .filter((input) => {
      const key = getBatchInputIdentity(input);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftTs = Number(left?.receivedAt || 0);
      const rightTs = Number(right?.receivedAt || 0);
      if (leftTs !== rightTs) return leftTs - rightTs;
      return Number(left?.messageId || 0) - Number(right?.messageId || 0);
    });
}

function peekPendingChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  return chatBatches.get(key) || null;
}

function takePendingChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch) return [];
  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);
  return Array.isArray(batch.inputs) ? batch.inputs : [];
}

function shouldMergePendingOrderInputs(currentInputs = [], pendingInputs = []) {
  if (!pendingInputs.length) return false;
  const pendingHasStructured = pendingInputs.some((input) => looksLikeStructuredOrderPayload(input.text));
  const pendingHasSizeOnly = pendingInputs.some((input) => isSizeOnlyFollowupMessage(input.text));
  if (batchHasPendingStructuredOrder(currentInputs)) return pendingHasStructured || pendingHasSizeOnly;
  if (batchHasSizeOnlyFollowup(currentInputs) && !batchHasStructuredOrderPayload(currentInputs)) return pendingHasStructured;
  if (batchNeedsPendingPayloadContext(currentInputs)) return pendingHasStructured || pendingHasSizeOnly;
  if (batchNeedsSemanticMerge(mergeBatchInputs(currentInputs, pendingInputs))) return true;
  return false;
}

function shouldSplitSemanticBatchForInput(batch, input) {
  const existingInputs = Array.isArray(batch?.inputs) ? batch.inputs : [];
  if (!existingInputs.length) return false;
  if (batchNeedsMultipartResponseWait(existingInputs)) return false;
  if (!batchNeedsSemanticMerge(existingInputs)) return false;
  const baseDelay = getConfigBatchDebounceMs(input.config);
  const elapsedSinceLastInput = Date.now() - Number(batch.lastInputAt || batch.startedAt || Date.now());
  if (elapsedSinceLastInput <= baseDelay) return false;
  return !batchNeedsSemanticMerge(mergeBatchInputs(existingInputs, [input]));
}

function buildRecentStructuredOrderContextInput(inputs = []) {
  if (!batchHasSizeOnlyFollowup(inputs) || batchHasStructuredOrderPayload(inputs)) return null;

  const lastInput = inputs[inputs.length - 1];
  const recentMessages = getRecentMemoryMessages(lastInput?.chatId, 12, inputs.map((input) => input.traceId));

  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (!message) continue;
    if (message.role === 'manager') break;
    if (message.role === 'assistant') continue;
    if (message.role !== 'user' || !looksLikeStructuredOrderPayload(message.text)) continue;

    return {
      chatId: lastInput.chatId,
      userId: lastInput.userId,
      traceId: message.traceId || `memory:${message.telegramMessageId || message.createdAt || index}`,
      messageId: '',
      messageType: message.type || 'text',
      text: message.text,
      images: [],
      hasMedia: false,
      hasLinkInput: containsLink(message.text),
      updateType: lastInput.updateType,
      businessConnectionId: lastInput.businessConnectionId || '',
      receivedAt: Date.parse(message.createdAt || '') || 0,
      isContextOnly: true,
    };
  }

  return null;
}

async function absorbPendingOrderContextInputs(inputs = []) {
  let merged = mergeBatchInputs([], inputs);
  if (!batchNeedsOrderContextMerge(merged)) return merged;

  const chatId = merged[merged.length - 1]?.chatId || merged[0]?.chatId || '';
  const deadline = Date.now() + ORDER_CONTEXT_MERGE_GRACE_MS;

  while (Date.now() < deadline) {
    const pendingBatch = peekPendingChatBatch(chatId);
    const pendingInputs = Array.isArray(pendingBatch?.inputs) ? pendingBatch.inputs : [];
    if (shouldMergePendingOrderInputs(merged, pendingInputs)) {
      merged = mergeBatchInputs(merged, takePendingChatBatch(chatId));
      if (!batchNeedsOrderContextMerge(merged)) break;
      continue;
    }
    await wait(ORDER_CONTEXT_MERGE_POLL_MS);
  }

  const tailBatch = peekPendingChatBatch(chatId);
  const tailInputs = Array.isArray(tailBatch?.inputs) ? tailBatch.inputs : [];
  if (shouldMergePendingOrderInputs(merged, tailInputs)) {
    merged = mergeBatchInputs(merged, takePendingChatBatch(chatId));
  }

  const recentStructuredOrderInput = buildRecentStructuredOrderContextInput(merged);
  if (recentStructuredOrderInput) {
    merged = mergeBatchInputs([recentStructuredOrderInput], merged);
  }

  return merged;
}

function hasNewerClientFollowup(context) {
  const batchTraceIds = Array.isArray(context?.batchTraceIds) ? context.batchTraceIds.map(String) : [];
  if (!batchTraceIds.length) return false;
  const dialogState = getDialogState(context?.chatId || '');
  const lastClientTraceId = String(dialogState?.lastClientTraceId || '').trim();
  if (!lastClientTraceId) return false;
  return !batchTraceIds.includes(lastClientTraceId);
}

function isOrderLikeClientText(text) {
  const source = String(text || '');
  if (!source.trim()) return false;
  return looksLikeStructuredOrderPayload(source)
    || /(хочу\s+заказать|оформить\s+заказ|заказ)/i.test(source)
    || (extractShoeSize(source) && /(размер|беру|возьму|хочу|можно|оформ)/i.test(source))
    || !!extractLastProduct(source);
}

function batchHasOrderLikeContext(inputs = []) {
  return batchHasStructuredOrderPayload(inputs)
    || batchHasSizeOnlyFollowup(inputs)
    || batchNeedsSemanticMerge(inputs)
    || inputs.some((input) => isOrderLikeClientText(input.text));
}

function isBotIdentityChallengeText(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return /\b(ты|вы)\s+(бот|робот|ai|ии)\b/.test(normalized)
    || /\b(бот|робот|ai|ии)\s+(ты|вы)\b/.test(normalized)
    || /искусственн(ый|ого)\s+интеллект/i.test(normalized);
}

function containsForbiddenBotIdentityReply(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return /я\s+на\s+связи\s+от\s+iwak/i.test(normalized)
    || /на\s+связи\s+от\s+iwak/i.test(normalized)
    || /я\s+здесь,\s*чтобы\s+помочь/i.test(normalized)
    || /я\s+языковая\s+модель/i.test(normalized)
    || /как\s+искусственный\s+интеллект/i.test(normalized);
}

function isStrongCheckoutIntent(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return /(беру|возьму|оформ(?:ить|ляем|ляйте)|заказ(?:ать|ываю)?|можно\s+заказ|давайте|хочу\s+(?:оформить|заказать|купить))/i.test(normalized);
}

function isAvailabilityOnlyQuestion(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return !isStrongCheckoutIntent(normalized)
    && /(есть|налич|бывает|остал[аио]с|размер|стельк|см\b)/i.test(normalized);
}

function isFullCheckoutFormReply(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  const hits = [
    /фио|полные\s+фио|имя\s+получателя/i,
    /город\s+достав/i,
    /служб[ауы]\s+достав|яндекс|ozon|озон|cdek|сд[эе]к|почта\s+россии/i,
    /пвз|пункт\s+выдачи|полный\s+адрес|адрес\s+для\s+курьер/i,
    /номер\s+телефон|телефон/i,
  ].filter((pattern) => pattern.test(normalized)).length;
  return hits >= 4 || /(для\s+оформления[\s\S]{0,500}(фио|телефон)[\s\S]{0,500}(город|достав|пвз|адрес))/i.test(normalized);
}

function stripCheckoutFormTail(text = '') {
  let result = String(text || '').trim();
  result = result
    .replace(/\n?\s*Для оформления заказа мне понадобятся[\s\S]*$/i, '')
    .replace(/\n?\s*Для оформления мне понадобятся[\s\S]*$/i, '')
    .replace(/\n?\s*Для оформления заказа нужны[\s\S]*$/i, '')
    .replace(/\n?\s*Для оформления нужны[\s\S]*$/i, '')
    .replace(/\n?\s*Мне понадобятся[\s\S]*$/i, '')
    .replace(/\n?\s*Нужны ваши[\s\S]*$/i, '')
    .replace(/\n?\s*Доставка у нас бесплатная\.?\s*$/i, '')
    .trim();
  return result || '';
}

function getMissingOrderSlots(snapshot = {}) {
  if (!snapshot) return [];
  const missing = [];
  if (!snapshot.fullName) missing.push('full_name');
  if (!snapshot.phone) missing.push('phone');
  if (!snapshot.city) missing.push('city');
  if (!snapshot.deliveryService) missing.push('delivery_service');
  if (!snapshot.pickupPoint) missing.push('pickup_point');
  return missing;
}

function buildMissingOrderFieldsReply(snapshot = {}) {
  const missing = getMissingOrderSlots(snapshot);
  if (!missing.length) return 'Отлично, всё есть. Можно переходить к оплате.';
  const labels = {
    full_name: 'ФИО',
    phone: 'телефон',
    city: 'город',
    delivery_service: 'службу доставки',
    pickup_point: 'ПВЗ или адрес',
  };
  const picked = missing.slice(0, 2).map((slot) => labels[slot]).filter(Boolean);
  if (!picked.length) return '';
  if (picked.length === 1) return `Пришлите, пожалуйста, ${picked[0]}.`;
  return `Пришлите, пожалуйста, ${picked[0]} и ${picked[1]}.`;
}

function buildShoeSizeInsoleIssueReply(issue) {
  if (!issue) return '';
  const expected = issue.expectedSizes?.length
    ? ` ${formatCm(issue.insole)} см больше похоже на ${issue.expectedSizes.join('-')} размер.`
    : '';
  const range = `Для ${issue.size} размера стелька обычно около ${formatCm(issue.min)}-${formatCm(issue.max)} см.`;
  return `Проверьте, пожалуйста: ${range}${expected} Ориентируемся на стопу ${formatCm(issue.insole)} см или нужен именно ${issue.size} размер?`;
}

function buildAvailabilityIssueReply(issue) {
  if (!issue) return '';
  const available = formatAvailableShoeSizePairs(issue.availablePairs);
  const base = available
    ? `По этой модели сейчас остались ${available}.`
    : 'По этой модели нужного размера сейчас нет.';
  if (issue.insole) {
    return `${base} На ${formatCm(issue.insole)} см они не подойдут. Давайте подберём другую модель под вашу стельку?`;
  }
  if (issue.size) {
    return `${base} ${issue.size} размера нет в остатках. Давайте подберём другую модель?`;
  }
  return `${base} Давайте сначала уточним подходящий размер или выберем другую модель.`;
}

function containsNextStepAfterSuspiciousInsole(reply = '') {
  return /(?:пришлите|напишите|нужен|нужна|нужны|теперь|далее|для\s+оформления|фио|телефон|город|доставк|пвз|адрес|оплат)/i.test(String(reply || ''));
}

function finalizeShoeSizeInsoleReply(input = {}, reply = '') {
  const issue = input?.memoryContext?.slotSnapshot?.sizeInsoleIssue;
  if (!issue) return String(reply || '').trim();
  const finalReply = String(reply || '').trim();
  const acceptsMismatch = new RegExp(`${issue.size}[\\s\\S]{0,80}${String(issue.insole).replace('.', '[.,]')}\\s*(?:см|cm)`, 'i').test(finalReply)
    || /принял|подходит|всё\s+верно|оформляем/i.test(finalReply);
  if (!acceptsMismatch && !containsNextStepAfterSuspiciousInsole(finalReply)) return finalReply;
  return buildShoeSizeInsoleIssueReply(issue);
}

function finalizeAvailabilityIssueReply(input = {}, reply = '') {
  const issue = input?.memoryContext?.slotSnapshot?.availabilityIssue;
  if (!issue) return String(reply || '').trim();
  const finalReply = String(reply || '').trim();
  const asksCheckout = containsNextStepAfterSuspiciousInsole(finalReply) || isFullCheckoutFormReply(finalReply);
  const acceptsUnavailable = /оформляем|подходит|принял|всё\s+верно|есть\s+в\s+наличии|отлично/i.test(finalReply);
  if (!asksCheckout && !acceptsUnavailable) return finalReply;
  return buildAvailabilityIssueReply(issue);
}

function finalizeOrderFormReply(input, reply) {
  const finalReply = String(reply || '').trim();
  if (!isFullCheckoutFormReply(finalReply)) return finalReply;

  const compact = stripCheckoutFormTail(finalReply);
  if (isAvailabilityOnlyQuestion(input?.text)) {
    return compact || 'Да, есть.';
  }

  const slotReply = buildMissingOrderFieldsReply(input?.memoryContext?.slotSnapshot || {});
  if (!slotReply) return compact || finalReply;
  return [compact, slotReply].filter(Boolean).join('\n\n');
}

function containsCatalogPromise(text = '') {
  const normalized = String(text || '').toLowerCase().replace(/ё/g, 'е');
  return /(могу|можем|давайте|сейчас|пришлю|скину|отправлю|найду|подберу|покажу)[\s\S]{0,80}(фото|ссылк|вариант|модел)/i.test(normalized)
    || /(фото|ссылк)[\s\S]{0,80}(пришлю|скину|отправлю|покажу)/i.test(normalized);
}

function containsInventedRecommendationList(text = '') {
  const source = String(text || '');
  const numberedItems = source.match(/(?:^|\n)\s*\d+\.\s+/g) || [];
  const brandMentions = source.match(/\b(?:Adidas|Nike|Puma|New Balance|NB|Asics|Reebok|Salomon|Lacoste|Jordan|Yeezy)\b/gi) || [];
  return numberedItems.length >= 2 && brandMentions.length >= 2;
}

function stripCatalogPromiseTail(text = '') {
  return String(text || '')
    .replace(/\n?\s*Как вам эти модели\?[\s\S]*$/i, '')
    .replace(/\n?\s*Могу\s+(?:прислать|скинуть|отправить|показать)[\s\S]*$/i, '')
    .replace(/\n?\s*(?:Пришлю|Скину|Отправлю|Покажу)\s+(?:фото|ссылки?)[\s\S]*$/i, '')
    .trim();
}

function finalizeCatalogPromiseReply(input, reply) {
  const finalReply = String(reply || '').trim();
  const hasPromise = containsCatalogPromise(finalReply);
  const hasInventedList = containsInventedRecommendationList(finalReply);
  if (!hasPromise && !hasInventedList) return finalReply;

  const compact = stripCatalogPromiseTail(finalReply)
    .replace(/(?:^|\n)\s*\d+\.\s+[\s\S]*$/i, '')
    .trim();
  const fallback = 'Поняла, эта модель не подходит по виду. Я не буду придумывать варианты без точного фото или ссылки. Пришлите, пожалуйста, вариант, который понравился, и я помогу по нему с размером и оформлением.';
  if (!compact || hasInventedList) return fallback;
  return compact;
}

function extractMoneyAmounts(text = '') {
  const source = String(text || '');
  const amounts = [];
  const matches = source.matchAll(/(?:₽\s*)?(\d{1,3}(?:[\s.,]\d{3})+|\d{4,6})(?:\s*(?:₽|руб(?:\.|лей|ля|ль)?|р\.?))?/gi);
  for (const match of matches) {
    const value = normalizeCartPriceValue(match[1]);
    if (value !== null) amounts.push(Math.round(value));
  }
  return amounts;
}

function hasCartSwitchIntent(text = '') {
  return /(?:давайте\s+(?:вот\s+)?эти|вот\s+эти|лучше\s+эти|бер[её]м\s+(?:вот\s+)?эти|оформ(?:им|ляем)\s+(?:вот\s+)?эти|не[,\s]+давайте\s+(?:вот\s+)?эти)/i.test(String(text || ''));
}

function finalizeCartSwitchReply(input = {}, reply = '') {
  const finalReply = String(reply || '').trim();
  const profile = input.cartContext?.orderDetails ? null : getCustomerProfileSnapshot(input.chatId);
  const cleanChatId = getMemoryChatId(input);
  const memoryCart = memoryStore.facts[cleanChatId]?.currentCart?.value || profile?.facts?.currentCart?.value || '';
  const details = input.cartContext?.orderDetails || (memoryCart ? {
    product: memoryCart,
    price: extractOrderPrice(memoryCart) || extractMoneyAmounts(memoryCart)[0] || '',
  } : null);
  if (!details?.product) return finalReply;

  const cartPrice = Number(details.price || 0);
  const amounts = extractMoneyAmounts(finalReply);
  const hasWrongPrice = cartPrice > 0 && amounts.some((amount) => amount > 0 && amount !== cartPrice);
  const hasOldPremiata = /premiata/i.test(finalReply) && !/premiata/i.test(details.product);

  if (!hasWrongPrice && !hasOldPremiata) return finalReply;

  const priceText = cartPrice > 0 ? ` за ${formatMoneyAmount(cartPrice)}` : '';
  const cartSwitch = hasCartSwitchIntent(input.text)
    ? `Понял, меняем на товар из новой корзины${priceText}.`
    : `Понял, ориентируюсь на свежую корзину${priceText}.`;
  return `${cartSwitch} Пришлите, пожалуйста, адрес или название удобного ПВЗ.`;
}

function getReceiptAcknowledgementReply() {
  return RECEIPT_ACK_REPLY;
}

function shouldForceReceiptAcknowledgement(input = {}) {
  const config = input.config || runtimeConfig;
  if (!parseConfigBoolean(config.receipt_check_enabled, true)) return false;
  return Boolean(input.hasPaymentProofInput) || isPaymentProofInput(input);
}

function containsReceiptAcknowledgement(reply = '') {
  return /чек\s+(?:получил|получен|принял|принят)/i.test(String(reply || ''));
}

function containsReceiptPaymentHandling(reply = '') {
  const source = String(reply || '');
  return containsReceiptAcknowledgement(source)
    || /(?:оплат[ау]\s+(?:получ|прин|подтверж)|деньги\s+поступ|плат[её]ж\s+(?:получ|прин|подтверж)|вс[её]\s+верно|заказ\s+передан\s+в\s+сборк|передан\s+в\s+отправк)/i.test(source)
    || (
      /(?:чек|квитанц|оплат|плат[её]ж|перевод)/i.test(source)
      && /(?:сумм[аы]|банк|получател|карта|реквизит|т[-\s]?банк|сбер|альфа|тинькофф|сборк|отправк|статус\s+доставк)/i.test(source)
    );
}

function shouldForceMediaReceiptAcknowledgement(input = {}, reply = '') {
  if (!input.hasMedia) return false;
  if (isNonPaymentMediaHintText(input.text)) return false;
  return containsReceiptPaymentHandling(reply);
}

function isSimplePositiveAckText(text = '') {
  const source = String(text || '')
    .trim()
    .replace(/[.!?,;:]+$/g, '')
    .toLowerCase();
  if (!source || source.length > 80) return false;
  return /^(?:хорошо|ок|окей|ладно|понял|поняла|спасибо|благодарю|супер|отлично)(?:\s+(?:хорошо|ок|окей|ладно|понял|поняла|спасибо|благодарю|супер|отлично))*$/i.test(source);
}

function getStaleReceiptAckFallback(input = {}) {
  if (isDeliveryMediaHintText(input.text)) return 'Да, подойдёт. Пришлите, пожалуйста, адрес или название ПВЗ текстом, чтобы не ошибиться.';
  if (isProductMediaHintText(input.text)) return 'Понял. Подскажите, что именно по этой модели хотите уточнить?';
  if (isSimplePositiveAckText(input.text)) return 'Пожалуйста.';
  return 'Подскажите, что хотите уточнить?';
}

function finalizeAiReply(input, reply) {
  let finalReply = String(reply || '').trim();
  if (shouldForceReceiptAcknowledgement(input)) {
    return getReceiptAcknowledgementReply();
  }
  if (shouldForceMediaReceiptAcknowledgement(input, finalReply)) {
    return getReceiptAcknowledgementReply();
  }
  if (containsReceiptAcknowledgement(finalReply)) {
    return getStaleReceiptAckFallback(input);
  }
  finalReply = finalizeCartSwitchReply(input, finalReply);
  finalReply = finalizeShoeSizeInsoleReply(input, finalReply);
  finalReply = finalizeAvailabilityIssueReply(input, finalReply);
  if (isBotIdentityChallengeText(input?.text) && containsForbiddenBotIdentityReply(finalReply)) {
    return 'Почему так решили?';
  }
  finalReply = finalizeOrderFormReply(input, finalReply);
  finalReply = finalizeCatalogPromiseReply(input, finalReply);
  return finalReply;
}

async function waitForPendingOrderReplySettle(context) {
  if (!context?.pendingStructuredOrder) return true;
  const deadline = Date.now() + ORDER_PENDING_REPLY_SETTLE_MS;
  while (Date.now() < deadline) {
    if (hasNewerClientFollowup(context)) return false;
    await wait(Math.min(250, deadline - Date.now()));
  }
  return !hasNewerClientFollowup(context);
}

function pickReplyTargetMessageId(inputs, config = runtimeConfig) {
  const mode = normalizeReplyMode(config.reply_mode);
  if (mode === 'off') return '';

  const mediaInput = inputs.find((input) => (
    input.messageId
    && (input.hasMedia || ['photo', 'document', 'video', 'video_note', 'voice'].includes(input.messageType))
  ));
  if ((mode === 'smart' || mode === 'media') && mediaInput) return mediaInput.messageId;
  if (mode === 'media') return '';

  const lastWithMessageId = [...inputs].reverse().find((input) => input.messageId);
  return lastWithMessageId ? lastWithMessageId.messageId : '';
}

function buildBatchInput(inputs) {
  const lastInput = inputs[inputs.length - 1];
  const images = [];
  inputs.forEach((input) => {
    (input.images || []).forEach((image) => images.push(image));
  });

  const messageTypes = Array.from(new Set(inputs.map((input) => input.messageType).filter(Boolean)));
  const hasMedia = inputs.some((input) => input.hasMedia);
  const hasLinkInput = inputs.some((input) => input.hasLinkInput);
  const hasPaymentProofInput = inputs.some((input) => isPaymentProofInput(input));
  const hasStructuredOrderPayload = batchHasStructuredOrderPayload(inputs);
  const hasSizeOnlyFollowup = batchHasSizeOnlyFollowup(inputs);

  return {
    ...lastInput,
    traceId: lastInput.traceId,
    messageType: messageTypes.length > 1 ? 'batch' : lastInput.messageType,
    batchSize: inputs.length,
    batchTraceIds: inputs.map((input) => input.traceId),
    batchMessageIds: inputs.map((input) => input.messageId).filter(Boolean),
    batchHasStructuredOrderPayload: hasStructuredOrderPayload,
    batchHasSizeOnlyFollowup: hasSizeOnlyFollowup,
    pendingStructuredOrder: batchHasPendingStructuredOrder(inputs),
    replyToMessageId: pickReplyTargetMessageId(inputs, lastInput.config),
    text: buildBatchText(inputs),
    images,
    hasMedia,
    hasLinkInput,
    hasPaymentProofInput,
  };
}

function stripTrailingUrlNoise(value) {
  return String(value || '').replace(/[.,;!?]+$/g, '').replace(/[)\]}]+$/g, '');
}

function extractIwakCartLinks(text) {
  const source = String(text || '');
  const matches = source.match(/(?<![\w./-])(?:https?:\/\/)?(?:www\.)?iwak\.ru\/cart\?[^\s<>"']+/gi) || [];
  return matches
    .map(stripTrailingUrlNoise)
    .map((raw) => {
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      try {
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase();
        if (!['iwak.ru', 'www.iwak.ru'].includes(host)) return null;
        if (url.pathname !== '/cart') return null;
        const items = url.searchParams.get('items');
        if (!items) return null;
        return { raw, items };
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean);
}

function parseIwakCartItems(itemsValue) {
  const parsed = [];
  String(itemsValue || '').split(',').forEach((part) => {
    if (parsed.length >= IWAK_CART_MAX_ITEMS) return;
    const [idRaw, ...sizeParts] = String(part || '').trim().split(':');
    const sizeRaw = sizeParts.join(':');
    if (!/^\d{1,10}$/.test(String(idRaw || '').trim())) return;
    const id = Number(idRaw);
    if (!Number.isSafeInteger(id) || id <= 0) return;

    let size = '';
    try {
      size = decodeURIComponent(String(sizeRaw || '')).trim();
    } catch (error) {
      size = String(sizeRaw || '').trim();
    }
    if (!size || size.length > 24) return;
    if (!/^[\p{L}\p{N}\s.,_+/-]+$/u.test(size)) return;
    parsed.push({ id, size });
  });
  return parsed;
}

function getIwakCartItemsFromText(text) {
  const items = [];
  extractIwakCartLinks(text).forEach((link) => {
    parseIwakCartItems(link.items).forEach((item) => {
      if (items.length < IWAK_CART_MAX_ITEMS) items.push(item);
    });
  });
  return items;
}

function normalizeCartPriceValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatCartPrice(value) {
  const numeric = normalizeCartPriceValue(value);
  if (numeric === null) return '';
  return `₽${new Intl.NumberFormat('ru-RU').format(Math.round(numeric))}`;
}

function pickCartProductPayload(data, requestedId) {
  const source = data?.product || data?.data?.product || data?.data || data || {};
  const brand = typeof source.brand === 'object'
    ? (source.brand?.name || source.brand?.title || '')
    : (source.brand || '');
  const image = source.image || source.imageUrl || source.thumbnail || source.photo || '';
  return {
    id: Number(source.id || requestedId),
    brand: String(brand || '').trim(),
    name: String(source.name || source.title || '').trim(),
    price: source.price ?? source.currentPrice ?? source.salePrice ?? null,
    originalPrice: source.originalPrice ?? source.oldPrice ?? null,
    image: typeof image === 'string' ? image : '',
  };
}

async function fetchIwakProduct(productId) {
  const cached = iwakCartProductCache.get(productId);
  if (cached && Date.now() - cached.savedAt < IWAK_CART_PRODUCT_CACHE_TTL_MS) {
    return cached.product;
  }

  const response = await httpClient.get(`${IWAK_PRODUCT_API_BASE_URL}/${productId}`, {
    timeout: IWAK_CART_FETCH_TIMEOUT_MS,
    responseType: 'json',
    validateStatus: (status) => status >= 200 && status < 300,
  });
  const product = pickCartProductPayload(response.data, productId);
  if (!product.name && !product.brand) {
    throw new Error(`empty_product_${productId}`);
  }
  iwakCartProductCache.set(productId, { product, savedAt: Date.now() });
  return product;
}

function buildIwakCartContext(cartItems, productsById, missingIds = []) {
  const lines = [];
  let total = 0;
  let hasTotal = true;

  cartItems.forEach((item) => {
    const product = productsById.get(item.id);
    if (!product) return;
    const title = [product.brand, product.name].filter(Boolean).join(' — ') || `Товар ID ${item.id}`;
    const priceText = formatCartPrice(product.price);
    const numericPrice = normalizeCartPriceValue(product.price);
    if (numericPrice === null) {
      hasTotal = false;
    } else {
      total += numericPrice;
    }
    lines.push(`${lines.length + 1}. ${title}, размер ${item.size}${priceText ? `, цена ${priceText}` : ''}`);
  });

  if (!lines.length) return '';

  const context = [
    'Контекст корзины клиента:',
    'Клиент отправил ссылку на корзину IWAK.',
    'Состав корзины:',
    ...lines,
    '',
    missingIds.length ? `Товаров определено: ${lines.length} из ${cartItems.length}` : `Товаров: ${lines.length}`,
    hasTotal ? `Итого по найденным товарам: ${formatCartPrice(total)}` : '',
    missingIds.length ? `Часть товаров из корзины не удалось определить: ${missingIds.map((id) => `ID ${id}`).join(', ')}.` : '',
    '',
    'Важно: размеры уже известны из ссылки корзины. Не спрашивай размер повторно по товарам из корзины.',
    'Если в диалоге уже был другой товар/другая цена, свежая корзина важнее старой памяти.',
    'Фразы клиента рядом со свежей корзиной вроде "давайте эти", "вот эти", "лучше эти", "не, давайте вот эти" означают смену товара на эту корзину.',
    'Не продолжай старый товар, старый размер или старую цену, если клиент прислал новую корзину и выбирает её.',
    'Не выдумывай товары, цены или размеры, которых нет в этом контексте.',
  ].filter((line) => line !== '');

  return context.join('\n');
}

function buildIwakCartOrderDetails(cartItems, productsById) {
  const lines = [];
  let total = 0;
  let hasTotal = true;
  const sizes = [];

  cartItems.forEach((item) => {
    const product = productsById.get(item.id);
    if (!product) return;
    const title = [product.brand, product.name].filter(Boolean).join(' — ') || `Товар ID ${item.id}`;
    const price = normalizeCartPriceValue(product.price);
    if (price === null) hasTotal = false;
    else total += price;
    sizes.push(item.size);
    lines.push(`${title}, размер ${item.size}${price === null ? '' : `, цена ${formatCartPrice(price)}`}`);
  });

  if (!lines.length) return null;
  return {
    product: lines.length === 1 ? lines[0] : `Корзина IWAK: ${lines.join('; ')}`,
    size: Array.from(new Set(sizes.filter(Boolean))).join(', '),
    price: hasTotal ? Math.round(total) : '',
    itemCount: lines.length,
  };
}

async function enrichIwakCartContext(input) {
  const startedAt = Date.now();
  const cartItems = getIwakCartItemsFromText(input.text);
  if (!cartItems.length) return null;

  const uniqueIds = Array.from(new Set(cartItems.map((item) => item.id))).slice(0, IWAK_CART_MAX_ITEMS);
  const productsById = new Map();
  const errors = [];

  const results = await Promise.allSettled(uniqueIds.map(async (id) => {
    const product = await fetchIwakProduct(id);
    return { id, product };
  }));

  results.forEach((result, index) => {
    const id = uniqueIds[index];
    if (result.status === 'fulfilled') {
      productsById.set(id, result.value.product);
    } else {
      errors.push({ id, message: result.reason?.message || String(result.reason || 'unknown_error') });
    }
  });

  const foundIds = Array.from(productsById.keys());
  const missingIds = uniqueIds.filter((id) => !productsById.has(id));
  const summary = buildIwakCartContext(cartItems, productsById, missingIds);
  const orderDetails = buildIwakCartOrderDetails(cartItems, productsById);
  const baseLog = {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    productIds: uniqueIds,
    foundProductIds: foundIds,
    itemCount: cartItems.length,
    foundCount: foundIds.length,
    durationMs: Date.now() - startedAt,
  };

  if (!summary) {
    logEvent('CART_CONTEXT_FAILED', {
      ...baseLog,
      error: errors.map((item) => `${item.id}:${item.message}`).join('; ') || 'no_products_found',
      status: 'error',
    });
    return null;
  }

  logEvent(foundIds.length === uniqueIds.length ? 'CART_CONTEXT_OK' : 'CART_CONTEXT_PARTIAL', {
    ...baseLog,
    error: errors.map((item) => `${item.id}:${item.message}`).join('; '),
    status: foundIds.length === uniqueIds.length ? 'ok' : 'partial',
  });

  return {
    summary,
    items: cartItems,
    productIds: uniqueIds,
    foundProductIds: foundIds,
    missingProductIds: missingIds,
    orderDetails,
  };
}

function appendCartContextToMemory(input, cartContext) {
  if (!cartContext?.summary) return;
  input.cartContext = cartContext;
  input.memoryContext = input.memoryContext || { summary: '', history: [], facts: {}, state: null };
  input.memoryContext.summary = [input.memoryContext.summary, cartContext.summary]
    .filter((part) => String(part || '').trim())
    .join('\n\n');

  const chatId = getMemoryChatId(input);
  const details = cartContext.orderDetails;
  if (!chatId || !details?.product) return;

  upsertMemoryFact(chatId, 'currentCart', details.product, input.text || cartContext.summary);
  upsertMemoryFact(chatId, 'lastProduct', details.product, input.text || cartContext.summary);
  if (details.size) upsertMemoryFact(chatId, 'size', details.size, input.text || cartContext.summary);

  safeCustomerStoreCall('customer.order.cart', (store) => store.upsertOrder(chatId, {
    product: details.product,
    size: details.size || '',
    price: details.price || '',
    status: 'draft',
  }));
}

async function processInputBatch(inputs) {
  if (!inputs.length) return;

  const preparedInputs = await absorbPendingOrderContextInputs(inputs);
  if (!preparedInputs.length) return;

  const batchInput = buildBatchInput(preparedInputs);
  batchInput.batchStartedAt = new Date().toISOString();
  try {
    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
      currentInput: batchInput,
    }) : { summary: '', history: [], facts: {}, state: null };


    batchInput.memoryContext = parseConfigBoolean(batchInput.config.memory_enabled, true) ? buildMemoryContext(batchInput.chatId, {
      excludeTraceIds: batchInput.batchTraceIds,
      limit: getConfigMemoryLimit(batchInput.config),
      currentInput: batchInput,
    }) : { summary: '', history: [], facts: {}, state: null };

    const cartContext = await enrichIwakCartContext(batchInput);
    appendCartContextToMemory(batchInput, cartContext);

    preparedInputs.forEach((input) => logMessageDelivered(input));
    await waitAndMarkBatchRead(batchInput.config, preparedInputs);

    logEvent('BATCH', {
      traceId: batchInput.traceId,
      userId: batchInput.userId,
      chatId: batchInput.chatId,
      updateType: batchInput.updateType || '',
      businessConnectionId: batchInput.businessConnectionId || '',
      messageType: batchInput.messageType,
      batchSize: batchInput.batchSize,
      batchTraceIds: batchInput.batchTraceIds,
      batchMessageIds: batchInput.batchMessageIds,
      replyToMessageId: batchInput.replyToMessageId || '',
      status: 'ok',
    });

    const stopTyping = startTypingLoop(batchInput.config, batchInput);
    try {
      const reply = await requestAi(batchInput);
      if (typeof reply === 'string') {
        const finalReply = finalizeAiReply(batchInput, reply);
        batchInput.aiDecisionTrace = {
          ...batchInput.aiDecisionTrace,
          finalReply,
          finalizeChanged: String(reply || '').trim() !== finalReply,
        };
        if (!finalReply) {
          logAiDecisionTrace(batchInput, {
            status: 'skipped',
            skippedReason: 'empty_final_reply',
          });
          return;
        }
        const dialogState = getDialogState(batchInput.chatId);
        const managerLastMessageAt = dialogState?.managerLastMessageAt
          ? new Date(dialogState.managerLastMessageAt).getTime()
          : 0;
        const batchStartedAt = new Date(batchInput.batchStartedAt).getTime();
        if (
          parseConfigBoolean(batchInput.config.manager_takeover_enabled, true)
          && dialogState?.aiMode === 'passive_manager'
          && managerLastMessageAt >= batchStartedAt
        ) {
          logEvent('MESSAGE_STATUS', {
            traceId: batchInput.traceId,
            userId: batchInput.userId,
            chatId: batchInput.chatId,
            updateType: batchInput.updateType || '',
            businessConnectionId: batchInput.businessConnectionId || '',
            messageType: batchInput.messageType,
            messageStatus: 'ai_reply_skipped_manager_takeover',
            status: 'ok',
          });
          logAiDecisionTrace(batchInput, {
            status: 'skipped',
            skippedReason: 'manager_takeover',
            finalReply,
          });
          return;
        }
        const sent = await sendHumanizedTelegramReply(batchInput.config, batchInput, finalReply);
        if (!sent) {
          logEvent('MESSAGE_STATUS', {
            traceId: batchInput.traceId,
            userId: batchInput.userId,
            chatId: batchInput.chatId,
            updateType: batchInput.updateType || '',
            businessConnectionId: batchInput.businessConnectionId || '',
            messageType: batchInput.messageType,
            messageStatus: 'ai_reply_skipped_newer_client_input',
            status: 'ok',
          });
          logAiDecisionTrace(batchInput, {
            status: 'skipped',
            skippedReason: 'newer_client_input',
            finalReply,
          });
          return;
        }
        logAiDecisionTrace(batchInput, {
          status: 'ok',
          finalReply,
          sentReply: finalReply,
        });
        appendMemoryMessage(batchInput, 'assistant', finalReply);
        setDialogAiMode(batchInput.chatId, 'active', 'ai_reply');
      }
    } finally {
      stopTyping();
    }
  } catch (e) {
    logEvent('ERROR', {
      traceId: batchInput.traceId,
      userId: batchInput.userId,
      scope: 'batch.process',
      chatId: batchInput.chatId,
      updateType: batchInput.updateType || '',
      businessConnectionId: batchInput.businessConnectionId || '',
      status: 'error',
      error: e.message,
    });
  }
}

function flushChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch || batch.processing) return;

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);

  processInputBatch(batch.inputs);
}

function cancelChatBatch(chatId) {
  const key = getMemoryChatId(chatId);
  const batch = chatBatches.get(key);
  if (!batch) return false;
  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  if (batch.maxTimer) clearTimeout(batch.maxTimer);
  chatBatches.delete(key);
  return true;
}

function cancelManagerReturnTimer(chatId) {
  const key = getMemoryChatId(chatId);
  const timer = managerReturnTimers.get(key);
  if (timer) clearTimeout(timer);
  managerReturnTimers.delete(key);
  managerPendingInputs.delete(key);
}

function scheduleManagerReturn(input) {
  const key = getMemoryChatId(input);
  if (!key) return;

  const existing = managerPendingInputs.get(key) || [];
  existing.push(input);
  managerPendingInputs.set(key, existing);

  const delayMs = getConfigManagerReturnDelayMs(input.config);
  const now = new Date();
  memoryStore.states[key] = {
    ...(memoryStore.states[key] || {}),
    aiMode: 'passive_manager',
    pendingSince: now.toISOString(),
    autoTakeoverAt: new Date(now.getTime() + delayMs).toISOString(),
    lastClientTraceId: input.traceId || '',
    updatedAt: now.toISOString(),
  };
  safeCustomerStoreCall('customer.state.manager_wait', (store) => store.setDialogState(key, memoryStore.states[key]));
  persistMemoryStore();

  const previousTimer = managerReturnTimers.get(key);
  if (previousTimer) clearTimeout(previousTimer);

  managerReturnTimers.set(key, setTimeout(() => {
    const pending = managerPendingInputs.get(key) || [];
    managerPendingInputs.delete(key);
    managerReturnTimers.delete(key);
    if (!pending.length) return;

    const state = getDialogState(key);
    if (state?.aiMode !== 'passive_manager') return;

    setDialogAiMode(key, 'active', 'manager_return_timeout');
    logEvent('MESSAGE_STATUS', {
      traceId: pending[pending.length - 1]?.traceId || createTraceId(),
      userId: pending[pending.length - 1]?.userId || key,
      chatId: key,
      messageStatus: 'ai_auto_takeover',
      batchSize: pending.length,
      status: 'ok',
    });
    processInputBatch(pending);
  }, delayMs));

  logEvent('MESSAGE_STATUS', {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageId: input.messageId || '',
    messageType: input.messageType,
    messageStatus: 'manager_passive_wait',
    autoTakeoverMs: delayMs,
    status: 'ok',
  });
}

function enqueueInputForBatch(input) {
  const key = getMemoryChatId(input);
  if (!key) {
    processInputBatch([input]);
    return;
  }

  let batch = chatBatches.get(key);
  if (batch && shouldSplitSemanticBatchForInput(batch, input)) {
    flushChatBatch(key);
    batch = null;
  }
  if (!batch) {
    batch = {
      inputs: [],
      startedAt: Date.now(),
      lastInputAt: 0,
      debounceTimer: null,
      maxTimer: null,
      processing: false,
    };
    chatBatches.set(key, batch);
  }

  batch.inputs.push(input);
  batch.lastInputAt = Date.now();
  scheduleBatchMaxTimer(key, batch, input);

  if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
  batch.debounceTimer = setTimeout(() => flushChatBatch(key), getBatchDebounceDelayMs(batch, input));
}

function clearMemoryForChat(chatId) {
  const cleanChatId = getMemoryChatId(chatId);
  if (!cleanChatId) return false;
  safeCustomerStoreCall('customer.clear', (store) => store.clearCustomer(cleanChatId));
  memoryStore.messages = memoryStore.messages.filter((message) => message.chatId !== cleanChatId);
  delete memoryStore.facts[cleanChatId];
  delete memoryStore.states[cleanChatId];
  persistMemoryStore();
  return true;
}

cleanupMemoryStore();
persistMemoryStore();
setInterval(() => persistMemoryStore(), 24 * 60 * 60 * 1000).unref();

function parseCookies(cookieHeader) {
  return String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) return acc;
      const key = part.slice(0, index).trim();
      const value = decodeURIComponent(part.slice(index + 1).trim());
      acc[key] = value;
      return acc;
    }, {});
}

function isAuthorized(req) {
  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) return false;
  const cookies = parseCookies(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] === AUTH_COOKIE_VALUE;
}

function setAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE_NAME}=${AUTH_COOKIE_VALUE}; Path=/; HttpOnly; SameSite=Lax${secure}`);
}

function clearAuthCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', [
    `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
    `${AUTH_COOKIE_NAME}=; Path=/login; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`,
  ]);
}

function requireAuth(req, res, next) {
  if (req.path === '/api/telegram/webhook') {
    next();
    return;
  }

  if (isAuthorized(req)) {
    next();
    return;
  }

  if (req.method === 'GET' && (req.headers.accept || '').includes('text/html')) {
    res.redirect('/login');
    return;
  }

  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function markSaiRuntimeError(scope, message) {
  lastSaiRuntimeError = {
    scope,
    message,
    at: Date.now(),
  };
}

function getSaiStatus() {
  const requiredFields = ['telegram_token', 'ai_key', 'ai_url', 'model'];
  const missing = requiredFields.filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (lastSaiRuntimeError) {
    return {
      status: 'error',
      missing,
    };
  }

  if (missing.length) {
    return {
      status: 'warning',
      missing,
    };
  }

  return {
    status: 'ok',
    missing: [],
  };
}

function buildTelegramHealth({ tokenValid, webhookInfo }) {
  if (!runtimeConfig.telegram_token) {
    return {
      status: 'warning',
      label: 'Токен не задан',
    };
  }

  if (!tokenValid) {
    return {
      status: 'error',
      label: 'Ошибка Telegram',
    };
  }

  if (!runtimeConfig.webhook_url) {
    return {
      status: 'warning',
      label: 'Webhook не задан',
    };
  }

  if (!webhookInfo) {
    return {
      status: 'error',
      label: 'Webhook с ошибкой',
    };
  }

  const lastErrorTs = Number(webhookInfo.last_error_date || 0) * 1000;
  const hasRecentWebhookError = Number.isFinite(lastErrorTs)
    && lastErrorTs > 0
    && (Date.now() - lastErrorTs) < WEBHOOK_ERROR_GRACE_MS;

  if (!webhookInfo.url && webhookInfo.last_error_message) {
    return {
      status: 'error',
      label: 'Webhook с ошибкой',
    };
  }

  if (webhookInfo.url !== runtimeConfig.webhook_url) {
    return {
      status: 'warning',
      label: 'Webhook не совпадает',
    };
  }

  if (Number(webhookInfo.pending_update_count || 0) > 0) {
    return {
      status: hasRecentWebhookError ? 'error' : 'warning',
      label: hasRecentWebhookError ? 'Webhook с ошибкой' : 'Есть pending updates',
    };
  }

  if (hasRecentWebhookError) {
    return {
      status: 'warning',
      label: 'Были недавние ошибки webhook',
    };
  }

  return {
    status: 'ok',
    label: 'Webhook активен',
  };
}

function buildAiHealth({ providerReachable }) {
  const missing = ['ai_key', 'ai_url', 'model']
    .filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (missing.length) {
    return {
      status: 'warning',
      label: 'AI не настроен',
    };
  }

  if (!providerReachable) {
    return {
      status: 'error',
      label: 'Провайдер недоступен',
    };
  }

  return {
    status: 'ok',
    label: 'Провайдер доступен',
  };
}

function buildSttHealth({ providerReachable }) {
  const missing = ['stt_api_key', 'stt_base_url', 'stt_model']
    .filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (missing.length) {
    return {
      status: 'warning',
      label: 'STT не настроен',
    };
  }

  if (!providerReachable) {
    return {
      status: 'error',
      label: 'STT недоступен',
    };
  }

  return {
    status: 'ok',
    label: 'STT доступен',
  };
}

function buildSaiGptHealth({ providerReachable }) {
  const missing = ['sai_gpt_key', 'sai_gpt_url', 'sai_gpt_model']
    .filter((field) => !runtimeConfig[field] || !String(runtimeConfig[field]).trim());

  if (missing.length) {
    return {
      status: 'warning',
      label: 'S.AI GPT не настроен',
    };
  }

  if (!providerReachable) {
    return {
      status: 'error',
      label: 'S.AI GPT API недоступен',
    };
  }

  return {
    status: 'ok',
    label: 'S.AI GPT API доступен',
  };
}

function getSaiStatusLabel(saiStatus) {
  if (saiStatus.status === 'error') {
    return 'Runtime error';
  }

  if (saiStatus.status === 'warning') {
    return saiStatus.missing?.length ? 'Конфиг неполный' : 'Нужно внимание';
  }

  return 'Система готова';
}

function getRuntimeSnapshot() {
  return {
    telegram_token: runtimeConfig.telegram_token,
    ai_key: runtimeConfig.ai_key,
    ai_url: runtimeConfig.ai_url,
    model: runtimeConfig.model,
    sai_gpt_key: runtimeConfig.sai_gpt_key,
    sai_gpt_url: runtimeConfig.sai_gpt_url,
    sai_gpt_model: runtimeConfig.sai_gpt_model,
    stt_api_key: runtimeConfig.stt_api_key,
    stt_base_url: runtimeConfig.stt_base_url,
    stt_model: runtimeConfig.stt_model,
    instruction: runtimeConfig.instruction,
    core_hot_lead_enabled: parseConfigBoolean(runtimeConfig.core_hot_lead_enabled, true),
    core_published_available_enabled: parseConfigBoolean(runtimeConfig.core_published_available_enabled, true),
    core_no_stock_check_enabled: parseConfigBoolean(runtimeConfig.core_no_stock_check_enabled, true),
    core_no_catalog_return_enabled: parseConfigBoolean(runtimeConfig.core_no_catalog_return_enabled, true),
    core_no_resell_enabled: parseConfigBoolean(runtimeConfig.core_no_resell_enabled, true),
    core_rules_text: runtimeConfig.core_rules_text,
    facts_no_invent_enabled: parseConfigBoolean(runtimeConfig.facts_no_invent_enabled, true),
    facts_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_payment_enabled, true),
    facts_no_fake_delivery_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_enabled, true),
    facts_no_fake_discounts_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_discounts_enabled, true),
    facts_no_final_payment_confirm_enabled: parseConfigBoolean(runtimeConfig.facts_no_final_payment_confirm_enabled, true),
    facts_no_fake_delivery_time_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_time_enabled, true),
    facts_rules_text: runtimeConfig.facts_rules_text,
    smalltalk_enabled: parseConfigBoolean(runtimeConfig.smalltalk_enabled, true),
    smalltalk_style_enabled: parseConfigBoolean(runtimeConfig.smalltalk_style_enabled, true),
    smalltalk_outfit_advice_enabled: parseConfigBoolean(runtimeConfig.smalltalk_outfit_advice_enabled, true),
    smalltalk_weather_enabled: parseConfigBoolean(runtimeConfig.smalltalk_weather_enabled, true),
    smalltalk_soft_product_link_enabled: parseConfigBoolean(runtimeConfig.smalltalk_soft_product_link_enabled, true),
    smalltalk_rules_text: runtimeConfig.smalltalk_rules_text,
    order_path_enabled: parseConfigBoolean(runtimeConfig.order_path_enabled, true),
    order_collect_size_enabled: parseConfigBoolean(runtimeConfig.order_collect_size_enabled, true),
    order_collect_insole_enabled: parseConfigBoolean(runtimeConfig.order_collect_insole_enabled, true),
    order_collect_full_name_enabled: parseConfigBoolean(runtimeConfig.order_collect_full_name_enabled, true),
    order_collect_phone_enabled: parseConfigBoolean(runtimeConfig.order_collect_phone_enabled, true),
    order_collect_city_enabled: parseConfigBoolean(runtimeConfig.order_collect_city_enabled, true),
    order_collect_delivery_service_enabled: parseConfigBoolean(runtimeConfig.order_collect_delivery_service_enabled, true),
    order_collect_pickup_enabled: parseConfigBoolean(runtimeConfig.order_collect_pickup_enabled, true),
    order_collect_payment_enabled: parseConfigBoolean(runtimeConfig.order_collect_payment_enabled, true),
    order_collect_receipt_enabled: parseConfigBoolean(runtimeConfig.order_collect_receipt_enabled, true),
    order_step_mode: runtimeConfig.order_step_mode,
    order_rules_text: runtimeConfig.order_rules_text,
    response_guard_enabled: parseConfigBoolean(runtimeConfig.response_guard_enabled, true),
    response_guard_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_fake_payment_enabled, true),
    response_guard_no_repeat_known_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_repeat_known_enabled, true),
    response_guard_human_tone_enabled: parseConfigBoolean(runtimeConfig.response_guard_human_tone_enabled, true),
    response_guard_next_step_enabled: parseConfigBoolean(runtimeConfig.response_guard_next_step_enabled, true),
    response_guard_no_final_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_final_payment_enabled, true),
    response_guard_rules_text: runtimeConfig.response_guard_rules_text,
    receipt_check_enabled: parseConfigBoolean(runtimeConfig.receipt_check_enabled, true),
    receipt_check_amount_enabled: parseConfigBoolean(runtimeConfig.receipt_check_amount_enabled, true),
    receipt_check_bank_enabled: parseConfigBoolean(runtimeConfig.receipt_check_bank_enabled, true),
    receipt_check_recipient_enabled: parseConfigBoolean(runtimeConfig.receipt_check_recipient_enabled, true),
    receipt_check_datetime_enabled: parseConfigBoolean(runtimeConfig.receipt_check_datetime_enabled, true),
    receipt_check_mismatch_enabled: parseConfigBoolean(runtimeConfig.receipt_check_mismatch_enabled, true),
    receipt_check_no_final_confirm_enabled: parseConfigBoolean(runtimeConfig.receipt_check_no_final_confirm_enabled, true),
    receipt_check_success_text: runtimeConfig.receipt_check_success_text,
    receipt_check_mismatch_text: runtimeConfig.receipt_check_mismatch_text,
    receipt_check_rules_text: runtimeConfig.receipt_check_rules_text,
    quality_replica_honesty_enabled: parseConfigBoolean(runtimeConfig.quality_replica_honesty_enabled, true),
    quality_no_original_claims_enabled: parseConfigBoolean(runtimeConfig.quality_no_original_claims_enabled, true),
    quality_calm_explanation_enabled: parseConfigBoolean(runtimeConfig.quality_calm_explanation_enabled, true),
    quality_no_extra_photos_enabled: parseConfigBoolean(runtimeConfig.quality_no_extra_photos_enabled, true),
    quality_return_soft_enabled: parseConfigBoolean(runtimeConfig.quality_return_soft_enabled, true),
    quality_return_no_dates_enabled: parseConfigBoolean(runtimeConfig.quality_return_no_dates_enabled, true),
    quality_return_inspect_enabled: parseConfigBoolean(runtimeConfig.quality_return_inspect_enabled, true),
    quality_return_text: runtimeConfig.quality_return_text || DEFAULT_QUALITY_RETURN_TEXT,
    quality_rules_text: runtimeConfig.quality_rules_text,
    store_trust_enabled: parseConfigBoolean(runtimeConfig.store_trust_enabled, true),
    store_trust_online_only_enabled: parseConfigBoolean(runtimeConfig.store_trust_online_only_enabled, true),
    store_trust_sadovod_history_enabled: parseConfigBoolean(runtimeConfig.store_trust_sadovod_history_enabled, true),
    store_trust_cost_reason_enabled: parseConfigBoolean(runtimeConfig.store_trust_cost_reason_enabled, true),
    store_trust_no_address_enabled: parseConfigBoolean(runtimeConfig.store_trust_no_address_enabled, true),
    store_trust_safe_purchase_enabled: parseConfigBoolean(runtimeConfig.store_trust_safe_purchase_enabled, true),
    store_trust_text: runtimeConfig.store_trust_text || DEFAULT_STORE_TRUST_TEXT,
    contacts_enabled: parseConfigBoolean(runtimeConfig.contacts_enabled, true),
    contacts_website: runtimeConfig.contacts_website || DEFAULT_CONTACTS_WEBSITE,
    contacts_telegram: runtimeConfig.contacts_telegram || '',
    contacts_manager: runtimeConfig.contacts_manager || '',
    contacts_phone: runtimeConfig.contacts_phone || '',
    contacts_whatsapp: runtimeConfig.contacts_whatsapp || '',
    contacts_instagram_enabled: parseConfigBoolean(runtimeConfig.contacts_instagram_enabled, false),
    contacts_instagram: runtimeConfig.contacts_instagram || '',
    contacts_anti_scam_enabled: parseConfigBoolean(runtimeConfig.contacts_anti_scam_enabled, true),
    contacts_about_text: runtimeConfig.contacts_about_text || '',
    contacts_rules_text: runtimeConfig.contacts_rules_text || '',
    dialog_examples_enabled: parseConfigBoolean(runtimeConfig.dialog_examples_enabled, false),
    dialog_examples_text: runtimeConfig.dialog_examples_text,
    tone: runtimeConfig.tone,
    response_length: runtimeConfig.response_length,
    creativity: runtimeConfig.creativity,
    persona_style: runtimeConfig.persona_style,
    persona_age: runtimeConfig.persona_age,
    conversation_mode: runtimeConfig.conversation_mode,
    media_behavior: runtimeConfig.media_behavior,
    auto_reply_enabled: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
    memory_enabled: parseConfigBoolean(runtimeConfig.memory_enabled, true),
    memory_recent_limit: getConfigMemoryLimit(runtimeConfig),
    batch_debounce_ms: getConfigBatchDebounceMs(runtimeConfig),
    reply_mode: normalizeReplyMode(runtimeConfig.reply_mode),
    human_typing_mode: normalizeHumanTypingMode(runtimeConfig.human_typing_mode),
    manager_takeover_enabled: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
    manager_return_delay_ms: getConfigManagerReturnDelayMs(runtimeConfig),
    listen_wait_enabled: parseConfigBoolean(runtimeConfig.listen_wait_enabled, true),
    listen_wait_debounce_ms: getConfigListenWaitDebounceMs(runtimeConfig),
    listen_wait_max_window_ms: getConfigListenWaitMaxWindowMs(runtimeConfig),
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method,
    payment_card_number: runtimeConfig.payment_card_number,
    payment_recipient_name: runtimeConfig.payment_recipient_name,
    payment_bank: runtimeConfig.payment_bank,
    payment_comment: runtimeConfig.payment_comment,
    payment_style_text: runtimeConfig.payment_style_text,
    payment_layout_text: runtimeConfig.payment_layout_text,
    payment_bold_mode: runtimeConfig.payment_bold_mode,
    payment_example_text: runtimeConfig.payment_example_text,
    delivery_rules_enabled: parseConfigBoolean(runtimeConfig.delivery_rules_enabled, true),
    delivery_rules_text: runtimeConfig.delivery_rules_text,
    delivery_style_text: runtimeConfig.delivery_style_text,
    delivery_layout_text: runtimeConfig.delivery_layout_text,
    delivery_bold_mode: runtimeConfig.delivery_bold_mode,
    delivery_example_text: runtimeConfig.delivery_example_text,
    delivery_tracking_enabled: parseConfigBoolean(runtimeConfig.delivery_tracking_enabled, true),
    delivery_tracking_text: runtimeConfig.delivery_tracking_text || DEFAULT_DELIVERY_TRACKING_TEXT,
    followup_master_enabled: parseConfigBoolean(runtimeConfig.followup_master_enabled, false),
    followup_worker_enabled: parseConfigBoolean(runtimeConfig.followup_worker_enabled, false),
    followup_auto_send_enabled: parseConfigBoolean(runtimeConfig.followup_auto_send_enabled, false),
    followup_repeat_sales_enabled: parseConfigBoolean(runtimeConfig.followup_repeat_sales_enabled, false),
    followup_mode: runtimeConfig.followup_mode,
    followup_quiet_start: runtimeConfig.followup_quiet_start,
    followup_quiet_end: runtimeConfig.followup_quiet_end,
    followup_min_interval_hours: runtimeConfig.followup_min_interval_hours,
    followup_daily_limit: runtimeConfig.followup_daily_limit,
    followup_repeat_sales_days: runtimeConfig.followup_repeat_sales_days,
    followup_worker_interval_seconds: runtimeConfig.followup_worker_interval_seconds,
    followup_wait_data_enabled: parseConfigBoolean(runtimeConfig.followup_wait_data_enabled, true),
    followup_wait_data_hours: runtimeConfig.followup_wait_data_hours,
    followup_wait_data_max: runtimeConfig.followup_wait_data_max,
    followup_wait_payment_enabled: parseConfigBoolean(runtimeConfig.followup_wait_payment_enabled, true),
    followup_wait_payment_hours: runtimeConfig.followup_wait_payment_hours,
    followup_wait_payment_max: runtimeConfig.followup_wait_payment_max,
    followup_wait_receipt_enabled: parseConfigBoolean(runtimeConfig.followup_wait_receipt_enabled, true),
    followup_wait_receipt_hours: runtimeConfig.followup_wait_receipt_hours,
    followup_wait_receipt_max: runtimeConfig.followup_wait_receipt_max,
    followup_promised_later_enabled: parseConfigBoolean(runtimeConfig.followup_promised_later_enabled, true),
    followup_promised_later_hours: runtimeConfig.followup_promised_later_hours,
    followup_promised_later_max: runtimeConfig.followup_promised_later_max,
    followup_choosing_enabled: parseConfigBoolean(runtimeConfig.followup_choosing_enabled, true),
    followup_choosing_hours: runtimeConfig.followup_choosing_hours,
    followup_choosing_max: runtimeConfig.followup_choosing_max,
    webhook_url: runtimeConfig.webhook_url,
  };
}

function normalizeWebhookUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const clean = raw.replace(/\/+$/, '');
  return clean.endsWith('/api/telegram/webhook') ? clean : `${clean}/api/telegram/webhook`;
}

function loadPersistedConfig() {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return;

  try {
    const persisted = JSON.parse(fs.readFileSync(CONFIG_FILE_PATH, 'utf8'));
    const allowedKeys = Object.keys(runtimeConfig);
    let shouldRewrite = false;
    if (Object.keys(persisted).some((key) => !allowedKeys.includes(key))) {
      shouldRewrite = true;
    }
    allowedKeys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(persisted, key)) {
        const value = key === 'webhook_url'
          ? normalizeWebhookUrl(persisted[key] || '')
          : persisted[key];
        runtimeConfig[key] = value;
        if (key === 'webhook_url' && value !== persisted[key]) {
          shouldRewrite = true;
        }
      } else {
        shouldRewrite = true;
      }
    });

    const normalizedInstruction = normalizeInstructionConfigValue(runtimeConfig.instruction);
    if (normalizedInstruction !== runtimeConfig.instruction) {
      runtimeConfig.instruction = normalizedInstruction;
      shouldRewrite = true;
    }

    [
      ['conversation_mode', 'retail'],
    ].forEach(([key, nextValue]) => {
      if (runtimeConfig[key] !== nextValue) {
        runtimeConfig[key] = nextValue;
        shouldRewrite = true;
      }
    });

    if (shouldRewrite) {
      savePersistedConfig();
    }
  } catch (error) {
    logEvent('ERROR', {
      scope: 'config.load',
      status: 'error',
      error: error.message,
    });
    try {
      const corruptPath = `${CONFIG_FILE_PATH}.corrupt-${Date.now()}`;
      fs.renameSync(CONFIG_FILE_PATH, corruptPath);
      savePersistedConfig();
    } catch (secondaryError) {
      logEvent('ERROR', {
        scope: 'config.load.recover',
        status: 'error',
        error: secondaryError.message,
      });
    }
  }
}

function savePersistedConfig() {
  const tempPath = `${CONFIG_FILE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(getRuntimeSnapshot(), null, 2));
  fs.renameSync(tempPath, CONFIG_FILE_PATH);
}

function applyBooleanConfig(body, key, envKey, fallback = true) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return;
  runtimeConfig[key] = parseConfigBoolean(body[key], fallback);
  process.env[envKey] = String(runtimeConfig[key]);
}

function applyStringConfig(body, key, envKey, fallback = '') {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return;
  runtimeConfig[key] = String(body[key] || fallback);
  process.env[envKey] = runtimeConfig[key];
}

function applyConfigUpdate(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'telegram_token')) {
    runtimeConfig.telegram_token = body.telegram_token || '';
    process.env.TELEGRAM_TOKEN = runtimeConfig.telegram_token;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_key')) {
    runtimeConfig.ai_key = body.ai_key || '';
    process.env.AI_API_KEY = runtimeConfig.ai_key;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'ai_url')) {
    runtimeConfig.ai_url = body.ai_url || '';
    process.env.AI_BASE_URL = runtimeConfig.ai_url;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'model')) {
    runtimeConfig.model = body.model || '';
    process.env.MODEL = runtimeConfig.model;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sai_gpt_key')) {
    runtimeConfig.sai_gpt_key = body.sai_gpt_key || '';
    process.env.SAI_GPT_API_KEY = runtimeConfig.sai_gpt_key;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sai_gpt_url')) {
    runtimeConfig.sai_gpt_url = body.sai_gpt_url || '';
    process.env.SAI_GPT_BASE_URL = runtimeConfig.sai_gpt_url;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'sai_gpt_model')) {
    runtimeConfig.sai_gpt_model = body.sai_gpt_model || '';
    process.env.SAI_GPT_MODEL = runtimeConfig.sai_gpt_model;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_api_key')) {
    runtimeConfig.stt_api_key = body.stt_api_key || '';
    process.env.STT_API_KEY = runtimeConfig.stt_api_key;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_base_url')) {
    runtimeConfig.stt_base_url = body.stt_base_url || '';
    process.env.STT_BASE_URL = runtimeConfig.stt_base_url;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'stt_model')) {
    runtimeConfig.stt_model = body.stt_model || 'gpt-4o-mini-transcribe';
    process.env.STT_MODEL = runtimeConfig.stt_model;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'instruction')) {
    runtimeConfig.instruction = normalizeInstructionConfigValue(body.instruction || '');
    process.env.INSTRUCTION = runtimeConfig.instruction;
  }

  [
    ['core_hot_lead_enabled', 'CORE_HOT_LEAD_ENABLED'],
    ['core_published_available_enabled', 'CORE_PUBLISHED_AVAILABLE_ENABLED'],
    ['core_no_stock_check_enabled', 'CORE_NO_STOCK_CHECK_ENABLED'],
    ['core_no_catalog_return_enabled', 'CORE_NO_CATALOG_RETURN_ENABLED'],
    ['core_no_resell_enabled', 'CORE_NO_RESELL_ENABLED'],
    ['facts_no_invent_enabled', 'FACTS_NO_INVENT_ENABLED'],
    ['facts_no_fake_payment_enabled', 'FACTS_NO_FAKE_PAYMENT_ENABLED'],
    ['facts_no_fake_delivery_enabled', 'FACTS_NO_FAKE_DELIVERY_ENABLED'],
    ['facts_no_fake_discounts_enabled', 'FACTS_NO_FAKE_DISCOUNTS_ENABLED'],
    ['facts_no_final_payment_confirm_enabled', 'FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED'],
    ['facts_no_fake_delivery_time_enabled', 'FACTS_NO_FAKE_DELIVERY_TIME_ENABLED'],
    ['smalltalk_enabled', 'SMALLTALK_ENABLED'],
    ['smalltalk_style_enabled', 'SMALLTALK_STYLE_ENABLED'],
    ['smalltalk_outfit_advice_enabled', 'SMALLTALK_OUTFIT_ADVICE_ENABLED'],
    ['smalltalk_weather_enabled', 'SMALLTALK_WEATHER_ENABLED'],
    ['smalltalk_soft_product_link_enabled', 'SMALLTALK_SOFT_PRODUCT_LINK_ENABLED'],
    ['order_path_enabled', 'ORDER_PATH_ENABLED'],
    ['order_collect_size_enabled', 'ORDER_COLLECT_SIZE_ENABLED'],
    ['order_collect_insole_enabled', 'ORDER_COLLECT_INSOLE_ENABLED'],
    ['order_collect_full_name_enabled', 'ORDER_COLLECT_FULL_NAME_ENABLED'],
    ['order_collect_phone_enabled', 'ORDER_COLLECT_PHONE_ENABLED'],
    ['order_collect_city_enabled', 'ORDER_COLLECT_CITY_ENABLED'],
    ['order_collect_delivery_service_enabled', 'ORDER_COLLECT_DELIVERY_SERVICE_ENABLED'],
    ['order_collect_pickup_enabled', 'ORDER_COLLECT_PICKUP_ENABLED'],
    ['order_collect_payment_enabled', 'ORDER_COLLECT_PAYMENT_ENABLED'],
    ['order_collect_receipt_enabled', 'ORDER_COLLECT_RECEIPT_ENABLED'],
    ['response_guard_enabled', 'RESPONSE_GUARD_ENABLED'],
    ['response_guard_no_fake_payment_enabled', 'RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED'],
    ['response_guard_no_repeat_known_enabled', 'RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED'],
    ['response_guard_human_tone_enabled', 'RESPONSE_GUARD_HUMAN_TONE_ENABLED'],
    ['response_guard_next_step_enabled', 'RESPONSE_GUARD_NEXT_STEP_ENABLED'],
    ['response_guard_no_final_payment_enabled', 'RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED'],
    ['receipt_check_enabled', 'RECEIPT_CHECK_ENABLED'],
    ['receipt_check_amount_enabled', 'RECEIPT_CHECK_AMOUNT_ENABLED'],
    ['receipt_check_bank_enabled', 'RECEIPT_CHECK_BANK_ENABLED'],
    ['receipt_check_recipient_enabled', 'RECEIPT_CHECK_RECIPIENT_ENABLED'],
    ['receipt_check_datetime_enabled', 'RECEIPT_CHECK_DATETIME_ENABLED'],
    ['receipt_check_mismatch_enabled', 'RECEIPT_CHECK_MISMATCH_ENABLED'],
    ['receipt_check_no_final_confirm_enabled', 'RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED'],
    ['quality_replica_honesty_enabled', 'QUALITY_REPLICA_HONESTY_ENABLED'],
    ['quality_no_original_claims_enabled', 'QUALITY_NO_ORIGINAL_CLAIMS_ENABLED'],
    ['quality_calm_explanation_enabled', 'QUALITY_CALM_EXPLANATION_ENABLED'],
    ['quality_no_extra_photos_enabled', 'QUALITY_NO_EXTRA_PHOTOS_ENABLED'],
    ['quality_return_soft_enabled', 'QUALITY_RETURN_SOFT_ENABLED'],
    ['quality_return_no_dates_enabled', 'QUALITY_RETURN_NO_DATES_ENABLED'],
    ['quality_return_inspect_enabled', 'QUALITY_RETURN_INSPECT_ENABLED'],
    ['store_trust_enabled', 'STORE_TRUST_ENABLED'],
    ['store_trust_online_only_enabled', 'STORE_TRUST_ONLINE_ONLY_ENABLED'],
    ['store_trust_sadovod_history_enabled', 'STORE_TRUST_SADOVOD_HISTORY_ENABLED'],
    ['store_trust_cost_reason_enabled', 'STORE_TRUST_COST_REASON_ENABLED'],
    ['store_trust_no_address_enabled', 'STORE_TRUST_NO_ADDRESS_ENABLED'],
    ['store_trust_safe_purchase_enabled', 'STORE_TRUST_SAFE_PURCHASE_ENABLED'],
    ['contacts_enabled', 'CONTACTS_ENABLED'],
    ['contacts_anti_scam_enabled', 'CONTACTS_ANTI_SCAM_ENABLED'],
    ['delivery_tracking_enabled', 'DELIVERY_TRACKING_ENABLED'],
  ].forEach(([key, envKey]) => applyBooleanConfig(body, key, envKey, true));

  applyBooleanConfig(body, 'contacts_instagram_enabled', 'CONTACTS_INSTAGRAM_ENABLED', false);

  [
    ['core_rules_text', 'CORE_RULES_TEXT'],
    ['facts_rules_text', 'FACTS_RULES_TEXT'],
    ['smalltalk_rules_text', 'SMALLTALK_RULES_TEXT'],
    ['order_rules_text', 'ORDER_RULES_TEXT'],
    ['response_guard_rules_text', 'RESPONSE_GUARD_RULES_TEXT'],
    ['receipt_check_success_text', 'RECEIPT_CHECK_SUCCESS_TEXT'],
    ['receipt_check_mismatch_text', 'RECEIPT_CHECK_MISMATCH_TEXT'],
    ['receipt_check_rules_text', 'RECEIPT_CHECK_RULES_TEXT'],
    ['quality_return_text', 'QUALITY_RETURN_TEXT'],
    ['quality_rules_text', 'QUALITY_RULES_TEXT'],
    ['store_trust_text', 'STORE_TRUST_TEXT'],
    ['contacts_website', 'CONTACTS_WEBSITE'],
    ['contacts_telegram', 'CONTACTS_TELEGRAM'],
    ['contacts_manager', 'CONTACTS_MANAGER'],
    ['contacts_phone', 'CONTACTS_PHONE'],
    ['contacts_whatsapp', 'CONTACTS_WHATSAPP'],
    ['contacts_instagram', 'CONTACTS_INSTAGRAM'],
    ['contacts_about_text', 'CONTACTS_ABOUT_TEXT'],
    ['contacts_rules_text', 'CONTACTS_RULES_TEXT'],
    ['payment_style_text', 'PAYMENT_STYLE_TEXT'],
    ['payment_layout_text', 'PAYMENT_LAYOUT_TEXT'],
    ['payment_example_text', 'PAYMENT_EXAMPLE_TEXT'],
    ['delivery_style_text', 'DELIVERY_STYLE_TEXT'],
    ['delivery_layout_text', 'DELIVERY_LAYOUT_TEXT'],
    ['delivery_example_text', 'DELIVERY_EXAMPLE_TEXT'],
    ['delivery_tracking_text', 'DELIVERY_TRACKING_TEXT'],
  ].forEach(([key, envKey]) => applyStringConfig(body, key, envKey));

  applyBooleanConfig(body, 'dialog_examples_enabled', 'DIALOG_EXAMPLES_ENABLED', false);
  applyStringConfig(body, 'dialog_examples_text', 'DIALOG_EXAMPLES_TEXT');

  [
    ['followup_master_enabled', 'FOLLOWUP_MASTER_ENABLED', false],
    ['followup_worker_enabled', 'FOLLOWUP_WORKER_ENABLED', false],
    ['followup_auto_send_enabled', 'FOLLOWUP_AUTO_SEND_ENABLED', false],
    ['followup_repeat_sales_enabled', 'FOLLOWUP_REPEAT_SALES_ENABLED', false],
    ['followup_wait_data_enabled', 'FOLLOWUP_WAIT_DATA_ENABLED', true],
    ['followup_wait_payment_enabled', 'FOLLOWUP_WAIT_PAYMENT_ENABLED', true],
    ['followup_wait_receipt_enabled', 'FOLLOWUP_WAIT_RECEIPT_ENABLED', true],
    ['followup_promised_later_enabled', 'FOLLOWUP_PROMISED_LATER_ENABLED', true],
    ['followup_choosing_enabled', 'FOLLOWUP_CHOOSING_ENABLED', true],
  ].forEach(([key, envKey, fallback]) => applyBooleanConfig(body, key, envKey, fallback));

  [
    ['followup_quiet_start', 'FOLLOWUP_QUIET_START', '22:00'],
    ['followup_quiet_end', 'FOLLOWUP_QUIET_END', '10:00'],
    ['followup_min_interval_hours', 'FOLLOWUP_MIN_INTERVAL_HOURS', '24'],
    ['followup_daily_limit', 'FOLLOWUP_DAILY_LIMIT', '20'],
    ['followup_repeat_sales_days', 'FOLLOWUP_REPEAT_SALES_DAYS', '30'],
    ['followup_worker_interval_seconds', 'FOLLOWUP_WORKER_INTERVAL_SECONDS', '300'],
    ['followup_wait_data_hours', 'FOLLOWUP_WAIT_DATA_HOURS', '2'],
    ['followup_wait_data_max', 'FOLLOWUP_WAIT_DATA_MAX', '2'],
    ['followup_wait_payment_hours', 'FOLLOWUP_WAIT_PAYMENT_HOURS', '3'],
    ['followup_wait_payment_max', 'FOLLOWUP_WAIT_PAYMENT_MAX', '2'],
    ['followup_wait_receipt_hours', 'FOLLOWUP_WAIT_RECEIPT_HOURS', '1'],
    ['followup_wait_receipt_max', 'FOLLOWUP_WAIT_RECEIPT_MAX', '1'],
    ['followup_promised_later_hours', 'FOLLOWUP_PROMISED_LATER_HOURS', '4'],
    ['followup_promised_later_max', 'FOLLOWUP_PROMISED_LATER_MAX', '2'],
    ['followup_choosing_hours', 'FOLLOWUP_CHOOSING_HOURS', '24'],
    ['followup_choosing_max', 'FOLLOWUP_CHOOSING_MAX', '1'],
  ].forEach(([key, envKey, fallback]) => applyStringConfig(body, key, envKey, fallback));

  if (Object.prototype.hasOwnProperty.call(body, 'followup_mode')) {
    runtimeConfig.followup_mode = ['off', 'drafts', 'auto'].includes(body.followup_mode) ? body.followup_mode : 'off';
    process.env.FOLLOWUP_MODE = runtimeConfig.followup_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'order_step_mode')) {
    runtimeConfig.order_step_mode = body.order_step_mode || 'natural';
    process.env.ORDER_STEP_MODE = runtimeConfig.order_step_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_bold_mode')) {
    runtimeConfig.payment_bold_mode = body.payment_bold_mode || 'off';
    process.env.PAYMENT_BOLD_MODE = runtimeConfig.payment_bold_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'delivery_bold_mode')) {
    runtimeConfig.delivery_bold_mode = body.delivery_bold_mode || 'off';
    process.env.DELIVERY_BOLD_MODE = runtimeConfig.delivery_bold_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tone')) {
    runtimeConfig.tone = body.tone || 'neutral';
    process.env.TONE = runtimeConfig.tone;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'response_length')) {
    runtimeConfig.response_length = body.response_length || 'medium';
    process.env.RESPONSE_LENGTH = runtimeConfig.response_length;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'creativity')) {
    runtimeConfig.creativity = body.creativity || 'balanced';
    process.env.CREATIVITY = runtimeConfig.creativity;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'persona_style')) {
    runtimeConfig.persona_style = body.persona_style || 'calm';
    process.env.PERSONA_STYLE = runtimeConfig.persona_style;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'persona_age')) {
    runtimeConfig.persona_age = String(body.persona_age || '27');
    process.env.PERSONA_AGE = runtimeConfig.persona_age;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'conversation_mode')) {
    runtimeConfig.conversation_mode = body.conversation_mode || 'retail';
    process.env.CONVERSATION_MODE = runtimeConfig.conversation_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'media_behavior')) {
    runtimeConfig.media_behavior = body.media_behavior || 'answer_from_media';
    process.env.MEDIA_BEHAVIOR = runtimeConfig.media_behavior;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'auto_reply_enabled')) {
    runtimeConfig.auto_reply_enabled = parseConfigBoolean(body.auto_reply_enabled, true);
    process.env.AUTO_REPLY_ENABLED = String(runtimeConfig.auto_reply_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'memory_enabled')) {
    runtimeConfig.memory_enabled = parseConfigBoolean(body.memory_enabled, true);
    process.env.MEMORY_ENABLED = String(runtimeConfig.memory_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'memory_recent_limit')) {
    runtimeConfig.memory_recent_limit = getConfigMemoryLimit({ memory_recent_limit: body.memory_recent_limit });
    process.env.MEMORY_RECENT_LIMIT = String(runtimeConfig.memory_recent_limit);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'batch_debounce_ms')) {
    runtimeConfig.batch_debounce_ms = getConfigBatchDebounceMs({ batch_debounce_ms: body.batch_debounce_ms });
    process.env.BATCH_DEBOUNCE_MS = String(runtimeConfig.batch_debounce_ms);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'reply_mode')) {
    runtimeConfig.reply_mode = normalizeReplyMode(body.reply_mode || 'smart');
    process.env.REPLY_MODE = runtimeConfig.reply_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'human_typing_mode')) {
    runtimeConfig.human_typing_mode = normalizeHumanTypingMode(body.human_typing_mode || 'natural');
    process.env.HUMAN_TYPING_MODE = runtimeConfig.human_typing_mode;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'manager_takeover_enabled')) {
    runtimeConfig.manager_takeover_enabled = parseConfigBoolean(body.manager_takeover_enabled, true);
    process.env.MANAGER_TAKEOVER_ENABLED = String(runtimeConfig.manager_takeover_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'manager_return_delay_ms')) {
    runtimeConfig.manager_return_delay_ms = getConfigManagerReturnDelayMs({ manager_return_delay_ms: body.manager_return_delay_ms });
    process.env.MANAGER_RETURN_DELAY_MS = String(runtimeConfig.manager_return_delay_ms);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'listen_wait_enabled')) {
    runtimeConfig.listen_wait_enabled = parseConfigBoolean(body.listen_wait_enabled, true);
    process.env.LISTEN_WAIT_ENABLED = String(runtimeConfig.listen_wait_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'listen_wait_debounce_ms')) {
    runtimeConfig.listen_wait_debounce_ms = getConfigListenWaitDebounceMs({ listen_wait_debounce_ms: body.listen_wait_debounce_ms });
    process.env.LISTEN_WAIT_DEBOUNCE_MS = String(runtimeConfig.listen_wait_debounce_ms);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'listen_wait_max_window_ms')) {
    runtimeConfig.listen_wait_max_window_ms = getConfigListenWaitMaxWindowMs({ listen_wait_max_window_ms: body.listen_wait_max_window_ms });
    process.env.LISTEN_WAIT_MAX_WINDOW_MS = String(runtimeConfig.listen_wait_max_window_ms);
  }


  if (Object.prototype.hasOwnProperty.call(body, 'payment_enabled')) {
    runtimeConfig.payment_enabled = parseConfigBoolean(body.payment_enabled, false);
    process.env.PAYMENT_ENABLED = String(runtimeConfig.payment_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_method')) {
    runtimeConfig.payment_method = body.payment_method || 'card';
    process.env.PAYMENT_METHOD = runtimeConfig.payment_method;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_card_number')) {
    runtimeConfig.payment_card_number = body.payment_card_number || '';
    process.env.PAYMENT_CARD_NUMBER = runtimeConfig.payment_card_number;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_recipient_name')) {
    runtimeConfig.payment_recipient_name = body.payment_recipient_name || '';
    process.env.PAYMENT_RECIPIENT_NAME = runtimeConfig.payment_recipient_name;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_bank')) {
    runtimeConfig.payment_bank = body.payment_bank || '';
    process.env.PAYMENT_BANK = runtimeConfig.payment_bank;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'payment_comment')) {
    runtimeConfig.payment_comment = body.payment_comment || '';
    process.env.PAYMENT_COMMENT = runtimeConfig.payment_comment;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'delivery_rules_enabled')) {
    runtimeConfig.delivery_rules_enabled = parseConfigBoolean(body.delivery_rules_enabled, true);
    process.env.DELIVERY_RULES_ENABLED = String(runtimeConfig.delivery_rules_enabled);
  }

  if (Object.prototype.hasOwnProperty.call(body, 'delivery_rules_text')) {
    runtimeConfig.delivery_rules_text = String(body.delivery_rules_text || '');
    process.env.DELIVERY_RULES_TEXT = runtimeConfig.delivery_rules_text;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'webhook_url')) {
    runtimeConfig.webhook_url = normalizeWebhookUrl(body.webhook_url || '');
    process.env.WEBHOOK_URL = runtimeConfig.webhook_url;
  }

  savePersistedConfig();
}

function getTelegramApiUrl(config, method) {
  return `https://api.telegram.org/bot${config.telegram_token}/${method}`;
}

function getTelegramRequestError(e) {
  const data = e?.response?.data;
  const description = data?.description || e?.message || 'unknown error';
  const code = data?.error_code || e?.response?.status || '';
  return {
    message: code ? `${description} (${code})` : description,
    description,
    code,
  };
}

function isTelegramInitiationForbidden(error = {}) {
  const text = `${error.message || ''} ${error.description || ''}`.toLowerCase();
  return String(error.code || '') === '403'
    && (
      text.includes("can't initiate conversation")
      || text.includes('bot can\'t initiate conversation')
    );
}

function getFollowupTelegramErrorMessage(error = {}, context = {}) {
  if (isTelegramInitiationForbidden(error)) {
    return [
      'Telegram не разрешил отправить это напоминание из S.AI.',
      'Так бывает у старых диалогов или клиентов без сохранённой Telegram Business-связи.',
      'Готовый текст можно скопировать и отправить вручную в Telegram; когда клиент напишет снова, S.AI запомнит связь для следующих отправок.',
    ].join(' ');
  }

  if (!context.businessConnectionId) {
    return [
      'Telegram не принял сообщение: для этого клиента нет сохранённой Telegram Business-связи.',
      'Скопируйте готовый текст и отправьте его вручную в Telegram.',
    ].join(' ');
  }

  return error.message
    ? `Telegram не принял сообщение: ${error.message}`
    : 'Telegram не принял сообщение';
}

async function fetchTelegramBusinessConnection(config, businessConnectionId) {
  const id = String(businessConnectionId || '').trim();
  if (!config.telegram_token || !id) return null;

  try {
    const response = await httpClient.get(getTelegramApiUrl(config, 'getBusinessConnection'), {
      params: {
        business_connection_id: id,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    if (response.data?.ok && response.data.result) {
      return upsertBusinessConnection(response.data.result);
    }
  } catch (e) {
    logEvent('ERROR', {
      scope: 'telegram.getBusinessConnection',
      businessConnectionId: id,
      status: 'error',
      error: e.message,
    });
  }

  return null;
}

function detectMessageType(message) {
  if (message.text) return 'text';
  if (message.photo) return 'photo';
  if (message.sticker) return 'sticker';
  if (message.voice) return 'voice';
  if (message.video) return 'video';
  if (message.video_note) return 'video_note';
  if (message.animation) return 'animation';
  if (message.document) return 'document';
  if (message.audio) return 'audio';
  if (message.contact) return 'contact';
  if (message.location) return 'location';
  if (message.venue) return 'venue';
  if (message.poll) return 'poll';
  return 'unknown';
}

function getTelegramMessageContext(update) {
  if (update.business_message) {
    return {
      message: update.business_message,
      updateType: 'business_message',
      businessConnectionId: update.business_message.business_connection_id || '',
      messageId: update.business_message.message_id || '',
    };
  }

  if (update.edited_business_message) {
    return {
      message: update.edited_business_message,
      updateType: 'edited_business_message',
      businessConnectionId: update.edited_business_message.business_connection_id || '',
      messageId: update.edited_business_message.message_id || '',
    };
  }

  if (update.message) {
    return {
      message: update.message,
      updateType: 'message',
      businessConnectionId: '',
      messageId: update.message.message_id || '',
    };
  }

  if (update.edited_message) {
    return {
      message: update.edited_message,
      updateType: 'edited_message',
      businessConnectionId: '',
      messageId: update.edited_message.message_id || '',
    };
  }

  if (update.channel_post) {
    return {
      message: update.channel_post,
      updateType: 'channel_post',
      businessConnectionId: '',
    };
  }

  if (update.edited_channel_post) {
    return {
      message: update.edited_channel_post,
      updateType: 'edited_channel_post',
      businessConnectionId: '',
    };
  }

  return {
    message: null,
    updateType: getTelegramUpdateType(update),
    businessConnectionId: update.business_connection?.id || update.deleted_business_messages?.business_connection_id || '',
  };
}

function getTelegramUpdateType(update) {
  if (!update || typeof update !== 'object') return 'unknown';
  return [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'callback_query',
    'business_connection',
    'business_message',
    'edited_business_message',
  ].find((key) => update[key]) || 'unknown';
}

async function classifyTelegramMessageSource(config, context, message) {
  if (!context.businessConnectionId || !String(context.updateType || '').includes('business_message')) {
    return {
      source: 'client',
      businessConnection: null,
    };
  }

  if (message.sender_business_bot) {
    return {
      source: 'bot',
      businessConnection: getBusinessConnectionById(context.businessConnectionId),
    };
  }

  let businessConnection = getBusinessConnectionById(context.businessConnectionId);
  if (!businessConnection) {
    businessConnection = await fetchTelegramBusinessConnection(config, context.businessConnectionId);
  }

  const fromId = String(message.from?.id || '').trim();
  const chatId = String(message.chat?.id || '').trim();
  const businessUserId = String(businessConnection?.userId || '').trim();
  if (fromId && businessUserId && fromId === businessUserId) {
    return {
      source: message.is_from_offline ? 'manager_auto' : 'manager',
      businessConnection,
    };
  }

  if (!businessUserId && fromId && chatId && fromId !== chatId) {
    return {
      source: message.is_from_offline ? 'manager_auto' : 'manager',
      businessConnection,
    };
  }

  return {
    source: 'client',
    businessConnection,
  };
}

function truncateText(text) {
  return String(text || '').slice(0, MAX_INPUT_TEXT_LENGTH);
}

function containsLink(text) {
  return /(https?:\/\/\S+|www\.\S+|t\.me\/\S+)/i.test(String(text || ''));
}

function hasRequiredConfig(config, fields) {
  return fields.every((field) => typeof config[field] === 'string' && config[field].trim());
}

function logMissingConfig(scope, config, fields, meta = {}) {
  const missing = fields.filter((field) => !config[field] || !String(config[field]).trim());
  if (missing.length) {
    logEvent('ERROR', {
      traceId: meta.traceId || null,
      scope: 'config.missing',
      target: scope,
      missing,
      status: 'error',
      ...meta,
    });
    return true;
  }
  return false;
}

function isTimeoutError(error) {
  return error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '');
}

function isRateLimitError(error) {
  return error.response?.status === 429;
}

function getProviderErrorDetail(error) {
  return (
    error.response?.data?.error?.message ||
    error.response?.data?.message ||
    error.response?.data?.error ||
    error.response?.statusText ||
    error.message ||
    ''
  );
}

function getSaiGptProviderErrorMessage(error) {
  const status = Number(error.response?.status || 0);
  const detail = String(getProviderErrorDetail(error) || '').trim();
  if (status === 400) return `S.AI GPT API отклонил запрос. Проверь Base URL, формат API и модель.${detail ? ` Деталь: ${detail}` : ''}`;
  if (status === 401) return 'S.AI GPT API не принял ключ. Проверь API Key или создай новый ключ у провайдера.';
  if (status === 402) return 'S.AI GPT API просит оплату: закончился баланс, квота или тариф у провайдера. Пополни баланс либо выбери другую модель/API.';
  if (status === 403) return 'S.AI GPT API запретил доступ. Обычно модель недоступна для этого ключа или аккаунта.';
  if (status === 404) return 'S.AI GPT API не нашёл модель или endpoint. Проверь Base URL и выбранную модель.';
  if (status === 429) return 'S.AI GPT API упёрся в лимит запросов. Подожди немного или выбери другой ключ/модель.';
  if (status >= 500) return 'S.AI GPT API сейчас отвечает ошибкой на стороне провайдера. Попробуй позже или выбери другой provider.';
  if (isTimeoutError(error)) return 'S.AI GPT API слишком долго не отвечает. Проверь Base URL или выбери более быстрый provider.';
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(error.code || error.message || '')) {
    return 'S.AI GPT API недоступен по сети. Проверь Base URL.';
  }
  return detail || 'S.AI GPT не ответил.';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseConfigBoolean(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function parseConfigNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeReplyMode(value) {
  return ['smart', 'last', 'media', 'off'].includes(value) ? value : 'smart';
}

function normalizeHumanTypingMode(value) {
  return ['fast', 'natural', 'slow'].includes(value) ? value : 'natural';
}

function getConfigManagerReturnDelayMs(config = runtimeConfig) {
  return clampNumber(
    config.manager_return_delay_ms,
    MANAGER_RETURN_DELAY_MS,
    MIN_MANAGER_RETURN_DELAY_MS,
    MAX_MANAGER_RETURN_DELAY_MS,
  );
}

function getConfigMemoryLimit(config = runtimeConfig) {
  return clampNumber(config.memory_recent_limit, MEMORY_RECENT_LIMIT, MIN_MEMORY_RECENT_LIMIT, MAX_MEMORY_RECENT_LIMIT);
}

function getConfigBatchDebounceMs(config = runtimeConfig) {
  return clampNumber(config.batch_debounce_ms, BATCH_DEBOUNCE_MS, MIN_BATCH_DEBOUNCE_MS, MAX_BATCH_DEBOUNCE_MS);
}

function getConfigListenWaitDebounceMs(config = runtimeConfig) {
  return clampNumber(
    config.listen_wait_debounce_ms,
    MULTIPART_RESPONSE_DEBOUNCE_MS,
    MIN_MULTIPART_RESPONSE_DEBOUNCE_MS,
    MAX_MULTIPART_RESPONSE_DEBOUNCE_MS,
  );
}

function getConfigListenWaitMaxWindowMs(config = runtimeConfig) {
  return clampNumber(
    config.listen_wait_max_window_ms,
    MULTIPART_RESPONSE_MAX_WINDOW_MS,
    MIN_MULTIPART_RESPONSE_MAX_WINDOW_MS,
    MAX_MULTIPART_RESPONSE_MAX_WINDOW_MS,
  );
}

function getHumanTypingDelayMs(text, config = runtimeConfig) {
  const length = String(text || '').length;
  const cps = randomBetween(HUMAN_TYPING_MIN_CPS, HUMAN_TYPING_MAX_CPS);
  const typingTime = Math.round((length / cps) * 1000);
  const thinkingTime = length <= 100
    ? randomBetween(250, 800)
    : length <= 300
      ? randomBetween(500, 1400)
      : randomBetween(900, 2200);
  const baseDelay = Math.min(
    7000,
    Math.max(900, typingTime + thinkingTime + randomBetween(250, 900)),
  );
  const mode = normalizeHumanTypingMode(config.human_typing_mode);
  if (mode === 'fast') return Math.round(baseDelay * 0.65);
  if (mode === 'slow') return Math.round(baseDelay * 1.25);
  return baseDelay;
}

function splitReplyForTelegram(reply) {
  const text = String(reply || '').trim();
  if (!text || text.length <= LONG_REPLY_PART_LIMIT) return text ? [text] : [];

  const parts = [];
  let current = '';
  const chunks = text
    .split(/(\n{2,})/)
    .reduce((acc, chunk) => {
      if (!chunk) return acc;
      if (/^\n{2,}$/.test(chunk) && acc.length) {
        acc[acc.length - 1] += chunk;
      } else {
        acc.push(chunk);
      }
      return acc;
    }, []);

  chunks.forEach((chunk) => {
    if ((current + chunk).length <= LONG_REPLY_PART_LIMIT) {
      current += chunk;
      return;
    }

    if (current.trim()) {
      parts.push(current.trim());
      current = '';
    }

    if (chunk.length <= LONG_REPLY_PART_LIMIT) {
      current = chunk;
      return;
    }

    for (let index = 0; index < chunk.length; index += LONG_REPLY_PART_LIMIT) {
      parts.push(chunk.slice(index, index + LONG_REPLY_PART_LIMIT).trim());
    }
  });

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function escapeTelegramHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function isTelegramBoldEnabled(config = runtimeConfig) {
  const paymentBold = parseConfigBoolean(config.payment_enabled, false)
    && config.payment_bold_mode
    && config.payment_bold_mode !== 'off';
  const deliveryBold = parseConfigBoolean(config.delivery_rules_enabled, true)
    && config.delivery_bold_mode
    && config.delivery_bold_mode !== 'off';
  return Boolean(paymentBold || deliveryBold);
}

function renderTelegramHtml(text, config = runtimeConfig) {
  const raw = String(text || '');
  if (!isTelegramBoldEnabled(config)) return escapeTelegramHtml(raw);

  return raw
    .split(/(\*\*[\s\S]+?\*\*)/g)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return `<b>${escapeTelegramHtml(part.slice(2, -2))}</b>`;
      }
      return escapeTelegramHtml(part);
    })
    .join('');
}

function formatTelegramOutgoingText(text) {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function markTelegramBusinessMessageRead(config, context) {
  if (!config.telegram_token || !context.businessConnectionId || !context.messageId) {
    return false;
  }

  const payload = {
    business_connection_id: context.businessConnectionId,
    chat_id: context.chatId,
    message_id: context.messageId,
  };

  try {
    await httpClient.post(getTelegramApiUrl(config, 'readBusinessMessage'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    logEvent('TG_READ', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageId: context.messageId,
      messageType: context.messageType,
      status: 'ok',
    });
    return true;
  } catch (e) {
    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.readBusinessMessage',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageId: context.messageId,
      messageType: context.messageType,
      status: 'error',
      error: e.message,
    });
    return false;
  }
}

function logMessageDelivered(context) {
  logEvent('MESSAGE_STATUS', {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageId: context.messageId || '',
    messageType: context.messageType,
    messageStatus: 'delivered',
    status: 'ok',
  });
}

async function waitAndMarkMessageRead(config, context) {
  await wait(randomBetween(READ_DELAY_MIN_MS, READ_DELAY_MAX_MS));
  const telegramRead = await markTelegramBusinessMessageRead(config, context);
  logEvent('MESSAGE_STATUS', {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageId: context.messageId || '',
    messageType: context.messageType,
    messageStatus: 'read',
    telegramRead,
    status: 'ok',
  });
}

async function waitAndMarkBatchRead(config, inputs) {
  await wait(randomBetween(READ_DELAY_MIN_MS, READ_DELAY_MAX_MS));

  for (const input of inputs) {
    const telegramRead = await markTelegramBusinessMessageRead(config, input);
    logEvent('MESSAGE_STATUS', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageId: input.messageId || '',
      messageType: input.messageType,
      messageStatus: 'read',
      telegramRead,
      status: 'ok',
    });
  }
}

async function waitForSlot(type, chatId, messageType, getActiveCount, limit, timeoutMs) {
  if (getActiveCount() < limit) {
    return true;
  }

  logEvent(`${type}.wait_start`, {
    status: 'process',
    chatId,
    messageType,
    active: getActiveCount(),
    limit,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await wait(SLOT_WAIT_INTERVAL_MS);
    if (getActiveCount() < limit) {
      logEvent(`${type}.wait_acquired`, {
        status: 'ok',
        chatId,
        messageType,
        active: getActiveCount(),
        limit,
        waitedMs: Date.now() - startedAt,
      });
      return true;
    }
  }

  logEvent(`${type}.wait_timeout`, {
    status: 'error',
    chatId,
    messageType,
    active: getActiveCount(),
    limit,
    waitedMs: Date.now() - startedAt,
  });
  return false;
}

async function getTelegramFileUrl(config, chatId, messageType, fileId) {
  if (logMissingConfig('telegram.getFile', config, ['telegram_token'], { chatId, messageType })) {
    return null;
  }

  const acquired = await waitForSlot(
    'getfile',
    chatId,
    messageType,
    () => activeGetFileRequests,
    GETFILE_CONCURRENCY_LIMIT,
    SLOT_WAIT_TIMEOUT_MS
  );

  if (!acquired) {
    return null;
  }

  activeGetFileRequests += 1;

  try {
    const response = await httpClient.get(getTelegramApiUrl(config, 'getFile'), {
      params: { file_id: fileId },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const filePath = response.data?.result?.file_path;
    if (!filePath) return null;
    return `https://api.telegram.org/file/bot${config.telegram_token}/${filePath}`;
  } finally {
    activeGetFileRequests -= 1;
  }
}

async function downloadTelegramFile(config, chatId, messageType, fileId) {
  const fileUrl = await getTelegramFileUrl(config, chatId, messageType, fileId);
  if (!fileUrl) return null;

  const response = await httpClient.get(fileUrl, {
    responseType: 'arraybuffer',
    timeout: REQUEST_TIMEOUT_MS,
  });

  return Buffer.from(response.data);
}

function getSttRuntimeConfig(config) {
  return {
    apiKey: String(config.stt_api_key || config.ai_key || '').trim(),
    baseUrl: String(config.stt_base_url || config.ai_url || '').trim(),
    model: String(config.stt_model || 'gpt-4o-mini-transcribe').trim(),
  };
}

function isOpenAiAudioApi(baseUrl) {
  return /api\.openai\.com\/v1\/?$/i.test(String(baseUrl || '').trim());
}

function isOpenAiChatApi(baseUrl) {
  return /api\.openai\.com\/v1\/?$/i.test(String(baseUrl || '').trim());
}

async function transcribeTelegramMedia(config, context, fileId, options = {}) {
  const sttConfig = getSttRuntimeConfig(config);

  if (logMissingConfig('stt.request', { ai_key: sttConfig.apiKey, ai_url: sttConfig.baseUrl }, ['ai_key', 'ai_url'], {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    messageType: context.messageType,
  })) {
    return null;
  }

  if (!isOpenAiAudioApi(sttConfig.baseUrl)) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      error: 'Current STT provider does not support built-in OpenAI STT path',
    });
    return null;
  }

  if (options.fileSize && options.fileSize > MAX_STT_FILE_BYTES) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      error: 'Audio file exceeds STT size limit',
      fileSize: options.fileSize,
    });
    return null;
  }

  const startedAt = Date.now();

  try {
    logEvent('STT_REQUEST', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'process',
      fileSize: options.fileSize || 0,
      mimeType: options.mimeType || '',
      model: sttConfig.model,
      sttBaseUrl: sttConfig.baseUrl,
    });

    const fileBuffer = await downloadTelegramFile(config, context.chatId, context.messageType, fileId);
    if (!fileBuffer || !fileBuffer.length) {
      throw new Error('Failed to download media for STT');
    }

    const form = new FormData();
    form.append('model', sttConfig.model);
    form.append(
      'file',
      new Blob([fileBuffer], { type: options.mimeType || 'application/octet-stream' }),
      options.fileName || `${context.messageType}.bin`
    );

    const response = await httpClient.post(
      `${sttConfig.baseUrl.replace(/\/$/, '')}/audio/transcriptions`,
      form,
      {
        headers: {
          Authorization: `Bearer ${sttConfig.apiKey}`,
        },
        timeout: STT_TIMEOUT_MS,
      }
    );

    const text = String(response.data?.text || '').trim();
    if (!text) {
      throw new Error('STT returned empty transcript');
    }

    logEvent('STT_REPLY', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'ok',
      duration: Date.now() - startedAt,
      text,
    });

    return text;
  } catch (error) {
    logEvent('STT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      duration: Date.now() - startedAt,
      error: error.message,
    });
    return null;
  }
}

function decodePdfLiteralString(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const next = value[index + 1];
    if (!next) continue;
    index += 1;
    if (next === 'n') result += '\n';
    else if (next === 'r') result += '\r';
    else if (next === 't') result += '\t';
    else if (next === 'b') result += '\b';
    else if (next === 'f') result += '\f';
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let offset = 0; offset < 2 && /[0-7]/.test(value[index + 1]); offset += 1) {
        octal += value[index + 1];
        index += 1;
      }
      result += String.fromCharCode(parseInt(octal, 8));
    } else {
      result += next;
    }
  }
  return result;
}

function decodePdfHexString(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '');
  if (clean.length < 2) return '';
  const even = clean.length % 2 === 0 ? clean : `${clean}0`;
  const bytes = Buffer.from(even, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(bytes.readUInt16BE(index));
    }
    return text;
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    let text = '';
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(bytes.readUInt16LE(index));
    }
    return text;
  }
  return bytes.toString('utf8');
}

function normalizePdfExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isReadablePdfReceiptText(text) {
  const source = normalizePdfExtractedText(text);
  if (source.length < 20) return false;
  const chars = Array.from(source);
  const readableChars = chars.filter((char) => /[\p{L}\p{N}\s.,:;!?№#"'()\-+*/\\₽$€%]/u.test(char)).length;
  const controlChars = chars.filter((char) => /[\u0000-\u001f\u007f-\u009f]/.test(char)).length;
  const readableRatio = readableChars / Math.max(chars.length, 1);
  const controlRatio = controlChars / Math.max(chars.length, 1);
  const hasReceiptSignal = /(итого|сумма|сколько|банк|получател|карта|куда|перевод|квитанц|чек|руб|₽|t-?bank|tinkoff|тинькофф|сбер|дата|успешно|\d[\d\s.,]{2,}\s*(?:₽|руб))/i.test(source);
  const hasHumanText = /[\p{L}]{3,}/u.test(source);
  return readableRatio >= 0.82 && controlRatio <= 0.02 && hasReceiptSignal && hasHumanText;
}

function extractReadablePdfTextFromSource(source) {
  const fragments = [];
  const textOperators = /(?:\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|'|"|TJ)/g;
  let match;
  while ((match = textOperators.exec(source)) !== null) {
    const token = match[0].trim();
    const literal = token.match(/^\(([\s\S]*)\)\s*(?:Tj|'|"|TJ)$/);
    if (literal) {
      fragments.push(decodePdfLiteralString(literal[1]));
      continue;
    }
    const hex = token.match(/^<([\da-fA-F\s]+)>\s*(?:Tj|'|"|TJ)$/);
    if (hex) {
      fragments.push(decodePdfHexString(hex[1]));
    }
  }

  const fallbackStrings = source.match(/\((?:\\.|[^\\()]){2,}\)/g) || [];
  fallbackStrings.slice(0, 160).forEach((item) => {
    fragments.push(decodePdfLiteralString(item.slice(1, -1)));
  });

  return normalizePdfExtractedText(fragments.join('\n'));
}

function extractTextFromPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  const latin = buffer.toString('latin1');
  const sources = [latin];
  const streamRegex = /<<([\s\S]*?)>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let streamMatch;
  while ((streamMatch = streamRegex.exec(latin)) !== null) {
    const dictionary = streamMatch[1] || '';
    const streamBody = Buffer.from(streamMatch[2] || '', 'latin1');
    if (/FlateDecode/i.test(dictionary)) {
      try {
        sources.push(zlib.inflateSync(streamBody).toString('latin1'));
      } catch (error) {
        try {
          sources.push(zlib.inflateRawSync(streamBody).toString('latin1'));
        } catch (_) {
          // Some PDFs keep image streams compressed in a way we cannot safely read without extra dependencies.
        }
      }
    } else if (!/DCTDecode|JPXDecode|CCITTFaxDecode/i.test(dictionary)) {
      sources.push(streamBody.toString('latin1'));
    }
  }

  const extractedText = normalizePdfExtractedText(
    sources
      .map(extractReadablePdfTextFromSource)
      .filter(Boolean)
      .join('\n')
  );
  return isReadablePdfReceiptText(extractedText)
    ? extractedText.slice(0, PDF_RECEIPT_TEXT_LIMIT)
    : '';
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function withTempDir(prefix, action) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await action(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function tryRenderPdfWithPdftoppm(inputPath, outputPath) {
  const outputPrefix = outputPath.replace(/\.png$/i, '');
  await execFilePromise('pdftoppm', [
    '-f', '1',
    '-l', '1',
    '-singlefile',
    '-png',
    '-r', String(PDF_RENDER_DPI),
    inputPath,
    outputPrefix,
  ], { timeout: PDF_RENDER_TIMEOUT_MS });
  return fs.existsSync(outputPath) ? outputPath : '';
}

async function tryRenderPdfWithImageMagick(inputPath, outputPath) {
  await execFilePromise('magick', [
    '-density', String(PDF_RENDER_DPI),
    `${inputPath}[0]`,
    '-background', 'white',
    '-alpha', 'remove',
    '-alpha', 'off',
    outputPath,
  ], { timeout: PDF_RENDER_TIMEOUT_MS });
  return fs.existsSync(outputPath) ? outputPath : '';
}

async function tryRenderPdfWithConvert(inputPath, outputPath) {
  await execFilePromise('convert', [
    '-density', String(PDF_RENDER_DPI),
    `${inputPath}[0]`,
    '-background', 'white',
    '-alpha', 'remove',
    '-alpha', 'off',
    outputPath,
  ], { timeout: PDF_RENDER_TIMEOUT_MS });
  return fs.existsSync(outputPath) ? outputPath : '';
}

async function renderPdfFirstPageToDataUrl(buffer, context) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return '';
  return withTempDir('iwak-pdf-', async (dir) => {
    const inputPath = path.join(dir, 'receipt.pdf');
    const outputPath = path.join(dir, 'receipt.png');
    await fs.promises.writeFile(inputPath, buffer);

    const renderers = [
      ['pdftoppm', tryRenderPdfWithPdftoppm],
      ['magick', tryRenderPdfWithImageMagick],
      ['convert', tryRenderPdfWithConvert],
    ];

    for (const [name, renderer] of renderers) {
      try {
        const renderedPath = await renderer(inputPath, outputPath);
        if (!renderedPath) continue;
        const imageBuffer = await fs.promises.readFile(renderedPath);
        if (!imageBuffer.length) continue;
        logEvent('PDF_RECEIPT_RENDER', {
          traceId: context.traceId,
          userId: context.userId,
          chatId: context.chatId,
          messageType: context.messageType,
          status: 'ok',
          renderer: name,
          bytes: imageBuffer.length,
        });
        return `data:image/png;base64,${imageBuffer.toString('base64')}`;
      } catch (error) {
        logEvent('PDF_RECEIPT_RENDER_SKIP', {
          traceId: context.traceId,
          userId: context.userId,
          chatId: context.chatId,
          messageType: context.messageType,
          status: 'error',
          renderer: name,
          error: error.code || error.message,
        });
      }
    }

    return '';
  });
}

async function readTelegramPdfReceipt(config, context, document) {
  if (!document?.file_id) return { text: '', imageDataUrl: '' };
  if (document.file_size && document.file_size > MAX_PDF_RECEIPT_BYTES) {
    logEvent('PDF_RECEIPT_SKIP', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      reason: 'pdf_too_large',
      fileSize: document.file_size,
    });
    return { text: '', imageDataUrl: '' };
  }

  try {
    const fileBuffer = await downloadTelegramFile(config, context.chatId, context.messageType, document.file_id);
    const text = extractTextFromPdfBuffer(fileBuffer);
    const imageDataUrl = await renderPdfFirstPageToDataUrl(fileBuffer, context);
    logEvent('PDF_RECEIPT_READ', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: text || imageDataUrl ? 'ok' : 'error',
      extractedChars: text.length,
      renderedImage: Boolean(imageDataUrl),
    });
    return { text, imageDataUrl };
  } catch (error) {
    logEvent('PDF_RECEIPT_ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      messageType: context.messageType,
      status: 'error',
      error: error.message,
    });
    return { text: '', imageDataUrl: '' };
  }
}

async function normalizeTelegramMessage(config, context, message) {
  const images = [];
  const media = [];
  let text = message.text || message.caption || '';
  const messageType = detectMessageType(message);
  let hasMedia = false;
  let hasLinkInput = containsLink(text);

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1];
    hasMedia = true;
    media.push({
      type: 'photo',
      fileId: photo.file_id || '',
      uniqueId: photo.file_unique_id || '',
      width: photo.width || 0,
      height: photo.height || 0,
    });
    try {
      const imageUrl = await getTelegramFileUrl(config, context.chatId, messageType, photo.file_id);
      if (imageUrl) images.push(imageUrl);
    } catch (e) {
      logEvent('ERROR', { scope: 'telegram.getFile', message: e.message, messageType });
    }
  }

  if (message.document) {
    const documentName = String(message.document.file_name || '').trim();
    const documentMimeType = String(message.document.mime_type || '').trim();
    const isPdfDocument =
      /pdf/i.test(documentMimeType) ||
      /\.pdf$/i.test(documentName);
    const isImageLikeDocument =
      documentMimeType.startsWith('image/') ||
      /\.(png|jpe?g|webp|gif|bmp)$/i.test(documentName);

    if (isImageLikeDocument) {
      hasMedia = true;
      media.push({
        type: 'image_document',
        fileId: message.document.file_id || '',
        uniqueId: message.document.file_unique_id || '',
        mimeType: documentMimeType,
        fileName: documentName,
      });
      try {
        const imageUrl = await getTelegramFileUrl(config, context.chatId, 'document', message.document.file_id);
        if (imageUrl) images.push(imageUrl);
      } catch (e) {
        logEvent('ERROR', { scope: 'telegram.getFile', message: e.message, messageType: 'document' });
      }

    }

    if (!text && isPdfDocument) {
      media.push({
        type: 'pdf',
        fileId: message.document.file_id || '',
        uniqueId: message.document.file_unique_id || '',
        mimeType: documentMimeType,
        fileName: documentName,
      });
      const pdfReceipt = await readTelegramPdfReceipt(config, context, message.document);
      if (pdfReceipt.imageDataUrl) {
        images.push(pdfReceipt.imageDataUrl);
      }
      text = pdfReceipt.text
        ? [
          'Клиент прислал PDF-файл с чеком/квитанцией. PDF обработан автоматически.',
          'Receipt OCR summary из PDF:',
          pdfReceipt.text,
          pdfReceipt.imageDataUrl && 'Первая страница PDF также конвертирована в изображение и приложена к этому запросу для визуальной проверки.',
          'Сверь сумму, банк, получателя/карту и дату с контекстом заказа и правилами AI Control. Не подтверждай оплату финально.',
        ].filter(Boolean).join('\n')
        : pdfReceipt.imageDataUrl
          ? [
            'Клиент прислал PDF-файл с чеком/квитанцией.',
            'Текстовый слой PDF не читается, но первая страница PDF конвертирована в изображение и приложена к этому запросу.',
            'Визуально прочитай чек с изображения: сумма, банк, получатель/карта и дата. Сверь с заказом и правилами AI Control. Не подтверждай оплату финально.',
          ].join('\n')
        : [
          'Клиент прислал PDF-файл с чеком/квитанцией.',
          'Содержимое PDF автоматически не прочитано: сумма, банк, получатель и дата не подтверждены.',
          'Не подтверждать оплату финально и не писать, что чек корректный. Нужно мягко сказать, что PDF проверим вручную, либо попросить скрин/фото чека.',
          documentName && `Имя файла: ${documentName}.`,
        ].filter(Boolean).join(' ');
      hasMedia = true;
    }
  }

  if (!text && message.sticker) {
    text = `пользователь отправил стикер${message.sticker.emoji ? ` ${message.sticker.emoji}` : ''}`;
  }

  if (!text && message.voice) {
    media.push({
      type: 'voice',
      fileId: message.voice.file_id || '',
      uniqueId: message.voice.file_unique_id || '',
      mimeType: message.voice.mime_type || 'audio/ogg',
    });
    text = await transcribeTelegramMedia(config, context, message.voice.file_id, {
      fileSize: message.voice.file_size,
      mimeType: message.voice.mime_type || 'audio/ogg',
      fileName: `voice-${context.chatId}.ogg`,
    }) || 'пользователь отправил голосовое сообщение';
  }

  if (!text && message.video) {
    media.push({
      type: 'video',
      fileId: message.video.file_id || '',
      uniqueId: message.video.file_unique_id || '',
      mimeType: message.video.mime_type || 'video/mp4',
    });
    text = 'пользователь отправил видео';
  }

  if (!text && message.video_note) {
    media.push({
      type: 'video_note',
      fileId: message.video_note.file_id || '',
      uniqueId: message.video_note.file_unique_id || '',
      mimeType: 'video/mp4',
    });
    text = await transcribeTelegramMedia(config, context, message.video_note.file_id, {
      fileSize: message.video_note.file_size,
      mimeType: 'video/mp4',
      fileName: `video-note-${context.chatId}.mp4`,
    }) || 'пользователь отправил видео-сообщение';
  }

  if (!text && message.animation) {
    text = 'пользователь отправил анимацию';
  }

  if (!text && message.document) {
    media.push({
      type: 'document',
      fileId: message.document.file_id || '',
      uniqueId: message.document.file_unique_id || '',
      mimeType: message.document.mime_type || '',
      fileName: message.document.file_name || '',
    });
    text = 'Клиент прислал файл. Если это чек или квитанция, содержимое файла автоматически не прочитано: не подтверждать оплату финально, попросить скрин/фото чека или ручную проверку.';
    hasMedia = true;
  }

  if (!text && message.audio) {
    text = 'пользователь отправил аудио';
  }

  if (!text && message.contact) {
    text = 'пользователь отправил контакт';
  }

  if (!text && message.location) {
    text = `пользователь отправил геолокацию ${message.location.latitude}, ${message.location.longitude}`;
  }

  if (!text && message.venue) {
    text = `пользователь отправил место ${message.venue.title || ''}`.trim();
  }

  if (!text && message.poll) {
    text = `пользователь отправил опрос ${message.poll.question || ''}`.trim();
  }

  if (!text && !images.length) {
    text = 'пользователь отправил сообщение без текста';
  }

  hasLinkInput = hasLinkInput || containsLink(text);

  return {
    text: truncateText(text),
    images,
    media,
    messageType,
    hasMedia,
    hasLinkInput,
  };
}

function extractAiReply(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => item && typeof item.text === 'string' ? item.text : '')
      .join('')
      .trim();
  }
  return '';
}

function parseAiJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch (error) {
      return {};
    }
  }
}

async function explainTrainingAnswer(input = {}) {
  const config = input.config || getRuntimeSnapshot();
  if (logMissingConfig('training.explain', config, ['ai_key', 'ai_url', 'model'], {
    chatId: input.chatId || '',
  })) {
    throw new Error('AI не настроен');
  }

  const contextText = normalizeTrainingBlock(input.contextText, 2200);
  const clientText = normalizeTrainingText(input.clientText, 900);
  const aiText = normalizeTrainingText(input.aiText, 1200);
  const correctedText = normalizeTrainingText(input.correctedText, 1200);
  const note = normalizeTrainingText(input.note, 600);
  if (!contextText && (!clientText || !aiText)) {
    throw new Error('Нужен фрагмент диалога или пара клиент + AI');
  }

  const categories = Object.entries(TRAINING_CATEGORIES)
    .map(([key, meta]) => `${key}: ${meta.label} — ${meta.rule}`)
    .join('\n');
  const controlPrompt = buildSystemPrompt(config, null, clientText || contextText).slice(0, 7000);
  const messages = [
    {
      role: 'system',
      content: [
        'Ты ревизор качества ответов S.AI для магазина IWAK.',
        'Задача: объяснить, почему AI/менеджер мог так ответить, найти риск ошибки и предложить урок для будущих ответов.',
        'Не выдумывай факты за пределами фрагмента и AI Control. Если причины не видно, так и напиши.',
        'Верни только JSON без markdown.',
        'Формат: {"explanation":"...","category":"...","note":"...","correctedText":"..."}',
        'category должен быть одним из ключей ниже.',
        categories,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `AI Control, который мог влиять на ответ:\n${controlPrompt}`,
        contextText && `Фрагмент диалога:\n${contextText}`,
        clientText && `Сообщение клиента:\n${clientText}`,
        aiText && `Ответ AI/менеджера:\n${aiText}`,
        correctedText && `Черновик правильного ответа от пользователя:\n${correctedText}`,
        note && `Комментарий пользователя:\n${note}`,
        '',
        'Объясни коротко по делу. Если ответ плохой, correctedText должен быть готовым вариантом ответа по смыслу. Если ответ хороший, correctedText может быть пустым, а note объясняет, что сохранить как хороший паттерн.',
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const response = await httpClient.post(
    `${config.ai_url.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: isOpenAiChatApi(config.ai_url) ? { type: 'json_object' } : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${config.ai_key}`,
        'Content-Type': 'application/json',
      },
      timeout: AI_REQUEST_TIMEOUT_MS,
    }
  );
  const parsed = parseAiJsonObject(extractAiReply(response.data?.choices?.[0]?.message?.content));
  const category = getTrainingCategory(String(parsed.category || input.category || '').trim());
  return {
    explanation: normalizeTrainingText(parsed.explanation || '', 900),
    category,
    note: normalizeTrainingText(parsed.note || '', 600),
    correctedText: normalizeTrainingText(parsed.correctedText || '', 1200),
  };
}

async function coachTrainingAnswer(input = {}) {
  const config = input.config || getRuntimeSnapshot();
  if (logMissingConfig('training.coach', config, ['ai_key', 'ai_url', 'model'], {
    chatId: input.chatId || '',
  })) {
    throw new Error('AI не настроен');
  }

  const contextText = normalizeTrainingBlock(input.contextText, 2200);
  const clientText = normalizeTrainingText(input.clientText, 900);
  const aiText = normalizeTrainingText(input.aiText, 1200);
  const correctedText = normalizeTrainingText(input.correctedText, 1200);
  const note = normalizeTrainingText(input.note, 600);
  const userMessage = normalizeTrainingText(input.message, 900);
  const coachMessages = Array.isArray(input.coachMessages)
    ? input.coachMessages.slice(-8).map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: normalizeTrainingText(message?.text, 900),
    })).filter((message) => message.text)
    : [];

  if (!contextText && (!clientText || !aiText)) {
    throw new Error('Нужен фрагмент диалога или пара клиент + AI');
  }
  if (!userMessage) {
    throw new Error('Напишите, что именно объяснить или как надо отвечать');
  }

  const categories = Object.entries(TRAINING_CATEGORIES)
    .map(([key, meta]) => `${key}: ${meta.label} — ${meta.rule}`)
    .join('\n');
  const controlPrompt = buildSystemPrompt(config, null, clientText || contextText).slice(0, 7000);
  const messages = [
    {
      role: 'system',
      content: [
        'Ты внутренний ученик S.AI, которого менеджер обучает на конкретном диалоге.',
        'Отвечай как ученик: коротко признай, что понял, сформулируй вывод и как будешь отвечать в будущем.',
        'Не спорь с менеджером. Не сохраняй факты, которых нет в диалоге, AI Control или сообщении менеджера.',
        'Верни только JSON без markdown.',
        'Формат: {"reply":"...","category":"...","note":"...","correctedText":"..."}',
        'reply — живой ответ менеджеру от первого лица: "Понял..."',
        'note — короткая причина/правило урока.',
        'correctedText — правильный вариант ответа клиенту по смыслу, если он нужен.',
        'category должен быть одним из ключей ниже.',
        categories,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `AI Control:\n${controlPrompt}`,
        contextText && `Фрагмент диалога:\n${contextText}`,
        clientText && `Сообщение клиента:\n${clientText}`,
        aiText && `Ответ AI/менеджера:\n${aiText}`,
        correctedText && `Текущий черновик правильного ответа:\n${correctedText}`,
        note && `Текущая причина урока:\n${note}`,
        coachMessages.length && `Предыдущий диалог обучения:\n${coachMessages.map((message) => `${message.role === 'assistant' ? 'S.AI' : 'Менеджер'}: ${message.text}`).join('\n')}`,
        `Новое наставление менеджера:\n${userMessage}`,
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const response = await httpClient.post(
    `${config.ai_url.replace(/\/$/, '')}/chat/completions`,
    {
      model: config.model,
      messages,
      temperature: 0.2,
      response_format: isOpenAiChatApi(config.ai_url) ? { type: 'json_object' } : undefined,
    },
    {
      headers: {
        Authorization: `Bearer ${config.ai_key}`,
        'Content-Type': 'application/json',
      },
      timeout: AI_REQUEST_TIMEOUT_MS,
    }
  );
  const parsed = parseAiJsonObject(extractAiReply(response.data?.choices?.[0]?.message?.content));
  const category = getTrainingCategory(String(parsed.category || input.category || '').trim());
  return {
    reply: normalizeTrainingText(parsed.reply || parsed.explanation || 'Понял. Сформировал вывод для урока.', 900),
    category,
    note: normalizeTrainingText(parsed.note || '', 600),
    correctedText: normalizeTrainingText(parsed.correctedText || '', 1200),
  };
}

function getCreativityTemperature(creativity) {
  const map = {
    precise: 0.2,
    balanced: 0.5,
    creative: 0.8,
  };
  return map[creativity] ?? map.balanced;
}

function getToneGuidance(tone) {
  const map = {
    neutral: 'тон: нейтрально, ясно, без лишней эмоциональности',
    friendly: 'тон: дружелюбно, тепло, по-человечески',
    sales: 'тон: уверенно и закрывающе, но без давления',
    concise: 'тон: очень коротко и прямо',
  };
  return map[tone] || map.neutral;
}

function getResponseLengthGuidance(responseLength) {
  const map = {
    short: 'длина ответа: коротко, без простыней',
    medium: 'длина ответа: средне, только нужные детали',
    long: 'длина ответа: можно подробнее, если клиенту реально нужно объяснение',
  };
  return map[responseLength] || map.medium;
}

function getPersonaGuidance(config) {
  const styleMap = {
    calm: 'манера: спокойная',
    conversational: 'манера: разговорная',
    reserved: 'манера: сдержанная',
  };
  const age = String(config.persona_age || '').trim();
  return [styleMap[config.persona_style] || styleMap.calm, age && `возрастной ритм: примерно ${age}`]
    .filter(Boolean)
    .join(', ');
}

function getMediaBehaviorGuidance(mediaBehavior) {
  const map = {
    describe_media: 'медиа: если есть фото/скрин/PDF, сначала распознать содержимое: товар, кроссовки, корзина, ПВЗ/адрес, карта доставки, чек оплаты или другое. Не считать любое фото чеком.',
    answer_from_media: 'медиа: если есть фото/скрин/PDF, использовать его как главный контекст ответа: распознать, что на нём, и ответить по смыслу. Не считать любое фото чеком.',
    text_first: 'медиа: сначала опираться на текст клиента, фото/скрин/PDF использовать как дополнительный контекст. Не считать любое фото чеком.',
  };
  return map[mediaBehavior] || map.answer_from_media;
}

function buildGuidanceSection(title, rows, freeText = '') {
  const body = rows.filter(Boolean);
  const text = String(freeText || '').trim();
  if (text) body.push(text);
  if (!body.length) return '';
  return [title, ...body.map((row) => `- ${row}`)].join('\n');
}

function getIwakCoreGuidance(config) {
  return buildGuidanceSection('Ядро IWAK:', [
    parseConfigBoolean(config.core_hot_lead_enabled, true)
      && 'Клиент из Telegram/сайта обычно уже тёплый и пришёл к покупке, поэтому не продавать с нуля.',
    parseConfigBoolean(config.core_published_available_enabled, true)
      && 'Опубликованный товар считается доступным к заказу.',
    parseConfigBoolean(config.core_no_stock_check_enabled, true)
      && 'Не проверять склад, остатки или базу товаров и не писать, что нужно уточнить наличие.',
    parseConfigBoolean(config.core_no_catalog_return_enabled, true)
      && 'Не возвращать клиента в каталог, если он уже прислал товар или размер.',
    parseConfigBoolean(config.core_no_resell_enabled, true)
      && 'Работать как closing-менеджер: принять заказ, уточнить недостающее, довести до оплаты и чека.',
  ], config.core_rules_text);
}

function getFactBoundaryGuidance(config) {
  return buildGuidanceSection('Границы фактов:', [
    parseConfigBoolean(config.facts_no_invent_enabled, true)
      && 'Свободно формулировать, но не выдумывать факты, цены, наличие, сроки, службы, реквизиты или скидки.',
    parseConfigBoolean(config.facts_no_fake_payment_enabled, true)
      && 'Реквизиты брать только из раздела Оплата. Если их нет, не придумывать.',
    parseConfigBoolean(config.facts_no_fake_delivery_enabled, true)
      && 'Условия доставки брать только из раздела Доставка.',
    parseConfigBoolean(config.facts_no_fake_discounts_enabled, true)
      && 'Если клиент просит скидку, не обещать её от себя: текущая цена финальная, акции бывают только если они явно указаны.',
    parseConfigBoolean(config.facts_no_final_payment_confirm_enabled, true)
      && 'После чека не подтверждать финально оплату: чек получен, дальше проверка вручную.',
    parseConfigBoolean(config.facts_no_fake_delivery_time_enabled, true)
      && 'Не обещать точные сроки отправки или доставки, если они не указаны в AI Control.',
  ], config.facts_rules_text);
}

function getSmalltalkGuidance(config) {
  if (!parseConfigBoolean(config.smalltalk_enabled, true)) return '';
  return buildGuidanceSection('Живость общения:', [
    'Можно отвечать живо, естественно и по-человечески, без канцелярита и ощущения анкеты.',
    'Если клиент пишет "ты AI/робот/бот?", никогда не спорить, не оправдываться, не доказывать, что ты не бот, не писать "я на связи от IWAK" и не объяснять внутреннюю роль. Лучше ответить коротким встречным вопросом: "Почему так решили?" или "С чего взяли?"',
    parseConfigBoolean(config.smalltalk_style_enabled, true)
      && 'Можно поддержать лёгкий разговор, если клиент хочет поболтать.',
    parseConfigBoolean(config.smalltalk_outfit_advice_enabled, true)
      && 'Можно советовать, что надеть и с чем сочетать товары IWAK, не выдумывая конкретные остатки сверх присланного товара.',
    parseConfigBoolean(config.smalltalk_weather_enabled, true)
      && 'Если клиент спрашивает про погоду, можно ответить общими словами или честно сказать, что точной онлайн-погоды нет, если она не передана в диалог.',
    parseConfigBoolean(config.smalltalk_soft_product_link_enabled, true)
      && 'Если разговор уместно связан со стилем, можно мягко привязать его к товару IWAK без давления.',
  ], config.smalltalk_rules_text);
}

function getOrderPathGuidance(config) {
  if (!parseConfigBoolean(config.order_path_enabled, true)) return '';
  const stepMode = config.order_step_mode === 'single'
    ? 'Собирать данные максимально по одному шагу, чтобы клиенту было легко отвечать.'
    : 'Собирать данные естественно: не повторять уже полученное, можно объединять близкие вопросы в одно сообщение.';
  return buildGuidanceSection('Путь заказа:', [
    stepMode,
    parseConfigBoolean(config.order_collect_size_enabled, true)
      && 'Если размер уже указан, записать его и не спрашивать повторно.',
    parseConfigBoolean(config.order_collect_insole_enabled, true)
      && 'Для обуви уточнить длину стельки в сантиметрах, если её ещё нет.',
    'Для обуви проверять связку размера и стельки: если размер и сантиметры выглядят несоответствием, не продолжать оформление, а мягко переспросить. Например, 44 размер и 29 см по стельке выглядят подозрительно: 29 см ближе к 45-46.',
    'Если менеджер в диалоге написал остатки по модели, например "остались 42-26,5 43-27,5", считать это главным фактом по наличию. Если размер или стелька клиента не попадает в эти остатки, не оформлять заказ и не спрашивать доставку/ФИО/телефон; коротко сказать, какие размеры остались, и предложить другую модель или размер.',
    parseConfigBoolean(config.order_collect_full_name_enabled, true)
      && 'Для оформления собрать ФИО получателя.',
    parseConfigBoolean(config.order_collect_phone_enabled, true)
      && 'Собрать телефон получателя для накладной и уведомлений доставки.',
    parseConfigBoolean(config.order_collect_city_enabled, true)
      && 'Собрать город доставки.',
    parseConfigBoolean(config.order_collect_delivery_service_enabled, true)
      && 'Уточнить удобную службу доставки из разрешённых в разделе Доставка.',
    parseConfigBoolean(config.order_collect_pickup_enabled, true)
      && 'Для ПВЗ собрать адрес/название пункта или ориентир; для курьера собрать адрес.',
    parseConfigBoolean(config.order_collect_payment_enabled, true)
      && 'Когда основные данные собраны, аккуратно отправить реквизиты из раздела Оплата.',
    parseConfigBoolean(config.order_collect_receipt_enabled, true)
      && 'После оплаты попросить чек или скрин и сверить видимые данные с заказом настолько, насколько возможно по сообщению/изображению.',
    'Не отправлять клиенту полную анкету оформления, если он просто уточняет наличие, размер или стельку. В таком случае ответить только по вопросу.',
    'Если клиент уже хочет оформлять, спрашивать только ближайшие 1-2 недостающих поля из контекста оформления, а не весь список ФИО/телефон/город/служба/ПВЗ сразу.',
  ], config.order_rules_text);
}

function getResponseGuardGuidance(config) {
  if (!parseConfigBoolean(config.response_guard_enabled, true)) return '';
  return buildGuidanceSection('Проверка ответа:', [
    'Перед финальным ответом клиенту молча проверь черновик по этим пунктам. Не показывай клиенту сам чек-лист.',
    parseConfigBoolean(config.response_guard_no_fake_payment_enabled, true)
      && 'Не выдуманы ли реквизиты, банк, получатель или способ оплаты.',
    parseConfigBoolean(config.response_guard_no_repeat_known_enabled, true)
      && 'Не спрашиваются ли повторно данные, которые уже есть в памяти, текущем сообщении или контексте заказа.',
    parseConfigBoolean(config.response_guard_human_tone_enabled, true)
      && 'Не звучит ли ответ как робот, анкета, CRM или сухой сценарий.',
    parseConfigBoolean(config.response_guard_next_step_enabled, true)
      && 'Есть ли в ответе понятный следующий шаг для клиента, если диалог ещё не завершён.',
    parseConfigBoolean(config.response_guard_no_final_payment_enabled, true)
      && 'Нет ли финального подтверждения оплаты, поступления денег или отправки без ручной проверки.',
    'Если вход содержит фото/скрин/PDF, сначала распознать тип вложения. Только чек/квитанция/оплата включает короткий ответ "Чек получил, спасибо."; товар, ПВЗ, адрес, карта доставки или скрин каталога не являются чеком.',
    parseConfigBoolean(config.quality_no_extra_photos_enabled, true)
      && 'Если клиент просит дополнительные/живые фото, не обещан ли в ответе показ или отправка новых фото.',
    'Не обещать прислать фото, ссылки, подборку или варианты товаров, если точные товары/ссылки уже не переданы в текущем диалоге. Не придумывать альтернативные модели списком.',
    parseConfigBoolean(config.quality_return_no_dates_enabled, true)
      && 'Если упоминается возврат/обмен, не названы ли сроки или юридические обещания, которых нет в AI Control.',
  ], config.response_guard_rules_text);
}

function getReceiptCheckGuidance(config) {
  if (!parseConfigBoolean(config.receipt_check_enabled, true)) return '';
  return buildGuidanceSection('Проверка чека:', [
    'Любое фото/скрин/PDF сначала распознать по содержимому и только потом выбирать сценарий ответа.',
    'Не считать любое вложение чеком автоматически: фото товара, скрин кроссовок, корзина, ПВЗ, карта доставки, адрес или геолокация — это не чек.',
    'Если после распознавания содержимого это чек, квитанция, скрин оплаты или фото оплаты, ответ клиенту должен состоять только из одной фразы: "Чек получил, спасибо."',
    'Не комментировать клиенту сумму, банк, получателя, карту, дату, статус оплаты, сборку, отправку или доставку после чека.',
    'Если после распознавания содержимого это не чек, ответить по смыслу фото/файла: товар, размер, ПВЗ, адрес, доставка или другой вопрос клиента.',
    'Если клиент прислал PDF/документ с чеком, а содержимое файла не извлечено в текст/изображение, не подтверждай чек как корректный: попроси прислать скрин/фото чека или напиши, что PDF проверим вручную.',
    parseConfigBoolean(config.receipt_check_amount_enabled, true)
      && 'Данные чека можно сверить внутренне, если они видны, но клиенту не писать результат сверки.',
    parseConfigBoolean(config.receipt_check_bank_enabled, true)
      && 'Банк можно сверить внутренне, если он виден, но клиенту не писать банк.',
    parseConfigBoolean(config.receipt_check_recipient_enabled, true)
      && 'Получателя, карту или последние цифры можно сверить внутренне, если они видны, но клиенту не писать эти данные.',
    parseConfigBoolean(config.receipt_check_datetime_enabled, true)
      && 'Дату и время перевода можно посмотреть внутренне, если они видны, но клиенту не писать эти данные.',
    parseConfigBoolean(config.receipt_check_mismatch_enabled, true)
      && 'Если сумма, реквизиты, банк или получатель не сходятся, зафиксировать внутренне. Разбор делает менеджер вручную, клиенту всё равно ответить только "Чек получил, спасибо."',
    parseConfigBoolean(config.receipt_check_no_final_confirm_enabled, true)
      && 'Даже если визуально всё выглядит нормально, не писать, что оплата подтверждена финально или деньги поступили. Финальная проверка вручную.',
    String(config.receipt_check_success_text || '').trim()
      && `Ориентир ответа, если видимых расхождений нет: ${String(config.receipt_check_success_text).trim()}`,
    String(config.receipt_check_mismatch_text || '').trim()
      && `Ориентир ответа, если есть расхождение: ${String(config.receipt_check_mismatch_text).trim()}`,
  ], config.receipt_check_rules_text);
}

function getQualityGuidance(config) {
  return buildGuidanceSection('Товар и качество:', [
    parseConfigBoolean(config.quality_replica_honesty_enabled, true)
      && 'Если клиент спрашивает про оригинальность, честно говорить: это хорошая фабричная реплика.',
    parseConfigBoolean(config.quality_no_original_claims_enabled, true)
      && 'Не использовать слово "оригинал" и не создавать впечатление оригинала, если товар не оригинальный.',
    parseConfigBoolean(config.quality_calm_explanation_enabled, true)
      && 'Объяснять качество спокойно, уверенно и без оправданий.',
    parseConfigBoolean(config.quality_no_extra_photos_enabled, true)
      && 'Если клиент просит дополнительные или живые фото, не обещать "сейчас скину/отправлю/найду фото". Мягко объяснить, что все актуальные фото уже есть в карточке, посте или каталоге.',
    parseConfigBoolean(config.quality_return_soft_enabled, true)
      && 'Если клиент сомневается по фото или качеству, мягко подвести к возврату/обмену без давления и без юридического тона.',
    parseConfigBoolean(config.quality_return_inspect_enabled, true)
      && 'Просить при получении спокойно осмотреть товар, чтобы сразу убедиться, что всё подходит.',
    parseConfigBoolean(config.quality_return_no_dates_enabled, true)
      && 'Не называть сроки возврата/обмена, если срок не указан вручную в AI Control. Не писать "14 дней", "всегда можете" или "политика возврата".',
    parseConfigBoolean(config.quality_return_soft_enabled, true)
      && String(config.quality_return_text || DEFAULT_QUALITY_RETURN_TEXT).trim()
      && `Мягкая формулировка возврата/обмена: ${String(config.quality_return_text || DEFAULT_QUALITY_RETURN_TEXT).trim()}`,
  ], config.quality_rules_text);
}

function getStoreTrustGuidance(config) {
  if (!parseConfigBoolean(config.store_trust_enabled, true)) return '';
  return buildGuidanceSection('Магазин и доверие:', [
    parseConfigBoolean(config.store_trust_online_only_enabled, true)
      && 'Если клиент спрашивает про офлайн-магазин, адрес, где посмотреть или можно ли приехать: спокойно объяснить, что сейчас работаем только онлайн.',
    parseConfigBoolean(config.store_trust_sadovod_history_enabled, true)
      && 'Если клиент спрашивает про Садовод: можно сказать, что раньше действительно работали на Садоводе, но сейчас уже нет.',
    parseConfigBoolean(config.store_trust_cost_reason_enabled, true)
      && 'Причину объяснять без оправданий: содержание павильона, склада и сотрудников сильно выросло, а офлайн-расходы отражались бы на цене товара.',
    parseConfigBoolean(config.store_trust_no_address_enabled, true)
      && 'Не выдумывать адрес, павильон, точку выдачи или возможность приехать. Не писать "приезжайте", "можно подъехать" или "адрес такой-то".',
    parseConfigBoolean(config.store_trust_safe_purchase_enabled, true)
      && 'После объяснения онлайн-формата мягко вернуть к безопасной покупке: заказ оформляем в диалоге, доставка бесплатная, перед отправкой товар проверяем, при получении можно спокойно осмотреть.',
    String(config.store_trust_text || DEFAULT_STORE_TRUST_TEXT).trim()
      && `Базовая формулировка. Не копировать дословно, использовать как смысл:\n${String(config.store_trust_text || DEFAULT_STORE_TRUST_TEXT).trim()}`,
  ]);
}

function getContactsGuidance(config) {
  if (!parseConfigBoolean(config.contacts_enabled, true)) return '';
  const website = String(config.contacts_website || DEFAULT_CONTACTS_WEBSITE).trim();
  const telegram = String(config.contacts_telegram || '').trim();
  const manager = String(config.contacts_manager || '').trim();
  const phone = String(config.contacts_phone || '').trim();
  const whatsapp = String(config.contacts_whatsapp || '').trim();
  const instagram = String(config.contacts_instagram || '').trim();
  const hasInstagram = parseConfigBoolean(config.contacts_instagram_enabled, false) && instagram;
  const antiScamEnabled = parseConfigBoolean(config.contacts_anti_scam_enabled, true);

  return buildGuidanceSection('Контакты и о нас:', [
    'На вопросы про контакты, соцсети, сайт и "о нас" отвечать только из этого блока. Не выдумывать Instagram, WhatsApp, телефон, адрес, шоурум или другие каналы связи.',
    antiScamEnabled
      && 'Если клиент спрашивает "это ваше?", "это вы?", "не мошенники?", "куда писать/оплачивать?", сразу спокойно предупредить: ориентироваться только на официальные контакты ниже, не переводить деньги и не писать в сторонние аккаунты, которые не указаны здесь.',
    website && `Сайт: ${website}`,
    telegram && `Telegram: ${telegram}`,
    manager && `Менеджер / официальный контакт: ${manager}`,
    phone && `Телефон: ${phone}`,
    whatsapp ? `WhatsApp: ${whatsapp}` : 'WhatsApp не указан: не предлагать WhatsApp как канал связи.',
    hasInstagram
      ? `Instagram: ${instagram}`
      : 'Instagram-аккаунта сейчас нет: если клиент спрашивает Instagram, честно сказать, что Instagram нет, и предложить сайт, Telegram или продолжить здесь в диалоге.',
    String(config.contacts_about_text || '').trim()
      && `О нас: ${String(config.contacts_about_text).trim()}`,
  ], config.contacts_rules_text);
}

function getDialogExamplesGuidance(config) {
  if (!parseConfigBoolean(config.dialog_examples_enabled, false)) return '';
  const text = String(config.dialog_examples_text || '').trim();
  if (!text) return '';
  return ['Примеры диалогов для стиля. Не копировать дословно, использовать как ориентир:', text].join('\n');
}

function getVisiblePaymentGuidance(config) {
  if (!parseConfigBoolean(config.payment_enabled, false)) {
    return 'Оплата в AI Control выключена: не отправляйте и не придумывайте реквизиты, номер карты/телефона, банк или получателя.';
  }

  const details = [
    `Способ оплаты: ${String(config.payment_method || 'card').trim()}`,
    String(config.payment_card_number || '').trim() && `Реквизиты: ${String(config.payment_card_number).trim()}`,
    String(config.payment_recipient_name || '').trim() && `Получатель: ${String(config.payment_recipient_name).trim()}`,
    String(config.payment_bank || '').trim() && `Банк: ${String(config.payment_bank).trim()}`,
    String(config.payment_comment || '').trim() && `Комментарий клиенту: ${String(config.payment_comment).trim()}`,
  ].filter(Boolean);

  if (details.length <= 1) {
    return 'Оплата в AI Control включена, но реквизиты не заполнены: не придумывайте реквизиты, попросите клиента подождать или уточнить их у менеджера.';
  }
  return [
    'Оплата в AI Control включена.',
    'Используйте только эти реквизиты. Не изменяйте и не придумывайте номер, банк или получателя.',
    ...details,
    String(config.payment_style_text || '').trim() && `Стиль сообщения оплаты: ${String(config.payment_style_text).trim()}`,
    String(config.payment_layout_text || '').trim() && `Расположение оплаты: ${String(config.payment_layout_text).trim()}`,
    getBoldModeGuidance('Жирный текст в оплате', config.payment_bold_mode),
    String(config.payment_example_text || '').trim() && `Пример оформления оплаты. Не копировать дословно, использовать как формат:\n${String(config.payment_example_text).trim()}`,
  ].filter(Boolean).join('\n');
}

function getBoldModeGuidance(title, mode) {
  const map = {
    off: `${title}: выключен. Не используй жирный текст.`,
    headings: `${title}: можно выделять только короткие заголовки через **текст**.`,
    details: `${title}: можно выделять важные реквизиты/ключевые данные через **текст**.`,
    free: `${title}: можно использовать через **текст** там, где это улучшает читаемость, без перебора.`,
  };
  return map[mode] || map.off;
}

function getVisibleDeliveryGuidance(config) {
  if (!parseConfigBoolean(config.delivery_rules_enabled, true)) {
    return 'Доставка в AI Control выключена: не придумывайте условия, службы, сроки или стоимость доставки.';
  }
  const text = String(config.delivery_rules_text || '').trim();
  const trackingText = parseConfigBoolean(config.delivery_tracking_enabled, true)
    ? String(config.delivery_tracking_text || DEFAULT_DELIVERY_TRACKING_TEXT).trim()
    : '';
  if (!text && !trackingText) return 'Доставка в AI Control включена, но правила пустые: не придумывайте условия доставки.';
  return [
    'Доставка из AI Control:',
    text && text,
    trackingText && `Отслеживание доставки:\n${trackingText}`,
    String(config.delivery_style_text || '').trim() && `Стиль сообщения доставки: ${String(config.delivery_style_text).trim()}`,
    String(config.delivery_layout_text || '').trim() && `Расположение доставки: ${String(config.delivery_layout_text).trim()}`,
    getBoldModeGuidance('Жирный текст в доставке', config.delivery_bold_mode),
    String(config.delivery_example_text || '').trim() && `Пример оформления доставки. Не копировать дословно, использовать как формат:\n${String(config.delivery_example_text).trim()}`,
  ].filter(Boolean).join('\n');
}

function getVisibleControlState(config, memoryContext = null) {
  return {
    core: Boolean(getIwakCoreGuidance(config)),
    facts: Boolean(getFactBoundaryGuidance(config)),
    smalltalk: Boolean(getSmalltalkGuidance(config)),
    orderPath: Boolean(getOrderPathGuidance(config)),
    responseGuard: Boolean(getResponseGuardGuidance(config)),
    receiptCheck: Boolean(getReceiptCheckGuidance(config)),
    quality: Boolean(getQualityGuidance(config)),
    storeTrust: Boolean(getStoreTrustGuidance(config)),
    contacts: Boolean(getContactsGuidance(config)),
    training: Boolean((trainingStore.items || []).length),
    examples: Boolean(getDialogExamplesGuidance(config)),
    instruction: !!String(config.instruction || '').trim(),
    behavior: true,
    media: true,
    persona: true,
    memory: parseConfigBoolean(config.memory_enabled, true) && !!memoryContext?.summary,
    payment: parseConfigBoolean(config.payment_enabled, false),
    delivery: parseConfigBoolean(config.delivery_rules_enabled, true)
      && !!String(config.delivery_rules_text || '').trim(),
  };
}

function getCapabilitySnapshot(config) {
  const model = String(config.model || '').toLowerCase();
  const hasAi = !!(config.ai_key && config.ai_url && config.model);
  const visionKnown = /gpt-4|gpt-5|vision|vl|qwen-vl|gemini|claude|pixtral|llava/i.test(model);
  return {
    textAi: hasAi ? 'available' : 'missing',
    vision: hasAi ? (visionKnown ? 'likely' : 'unknown') : 'missing',
    stt: config.stt_api_key && config.stt_base_url && config.stt_model ? 'available' : 'missing',
    telegramBusiness: config.telegram_token ? 'configured' : 'missing',
    aiTimeoutMs: AI_REQUEST_TIMEOUT_MS,
    model: config.model || '',
    sttModel: config.stt_model || '',
  };
}

function buildSystemPrompt(config, memoryContext = null, queryText = '') {
  const parts = [];
  const control = [
    'AI Control:',
    getToneGuidance(config.tone),
    getResponseLengthGuidance(config.response_length),
    getPersonaGuidance(config),
    getMediaBehaviorGuidance(config.media_behavior),
  ].filter(Boolean);

  [
    getIwakCoreGuidance(config),
    getFactBoundaryGuidance(config),
    getSmalltalkGuidance(config),
    getOrderPathGuidance(config),
    getResponseGuardGuidance(config),
    getReceiptCheckGuidance(config),
    getQualityGuidance(config),
    getStoreTrustGuidance(config),
    getContactsGuidance(config),
    getTrainingExamplesGuidance(queryText, memoryContext),
  ].forEach((section) => {
    if (section) control.push(section);
  });

  if (String(config.instruction || '').trim()) {
    control.push('Инструкция:', String(config.instruction).trim());
  }

  const paymentGuidance = getVisiblePaymentGuidance(config);
  if (paymentGuidance) control.push(paymentGuidance);
  const deliveryGuidance = getVisibleDeliveryGuidance(config);
  if (deliveryGuidance) control.push(deliveryGuidance);
  const examplesGuidance = getDialogExamplesGuidance(config);
  if (examplesGuidance) control.push(examplesGuidance);
  parts.push(control.join('\n'));
  return parts.filter((part) => String(part || '').trim()).join('\n\n');
}

function buildAiControlPreview(config = runtimeConfig) {
  return {
    systemPrompt: buildSystemPrompt(config),
    appliedControls: getVisibleControlState(config),
    capabilities: getCapabilitySnapshot(config),
  };
}

function sanitizeSaiGptText(value, limit = 4000) {
  return String(value || '').trim().slice(0, limit);
}

function sanitizeSaiGptImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .map((image) => String(image || '').trim())
    .filter((image) => /^data:image\/(?:png|jpe?g|webp);base64,/i.test(image) || /^https?:\/\//i.test(image))
    .map((image) => image.slice(0, 1600000))
    .slice(0, 3);
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/(Authorization:\s*Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/("?(?:api[_-]?key|token|password|secret|ai_key|telegram_token|sai_gpt_key)"?\s*[:=]\s*["']?)[^"',\n\r]+/gi, '$1[redacted]')
    .replace(/(DATABASE_URL\s*=\s*)[^\s\n\r]+/gi, '$1[redacted]');
}

function getSaiGptConfig(config = runtimeConfig) {
  return {
    key: String(config.sai_gpt_key || '').trim(),
    url: String(config.sai_gpt_url || 'https://api.openai.com/v1').trim().replace(/\/$/, ''),
    model: String(config.sai_gpt_model || 'gpt-4o-mini').trim(),
  };
}

function walkSaiGptProjectFiles(dir = __dirname, output = []) {
  if (output.length >= SAI_GPT_CODE_FILE_LIMIT) return output;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return output;
  }

  entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((entry) => {
      if (output.length >= SAI_GPT_CODE_FILE_LIMIT) return;
      if (entry.name.startsWith('.') && entry.name !== '.env.example') return;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SAI_GPT_CODE_EXCLUDE_DIRS.has(entry.name)) {
          walkSaiGptProjectFiles(fullPath, output);
        }
        return;
      }
      if (!entry.isFile()) return;
      if (entry.name === '.env' || entry.name.endsWith('.log')) return;
      if (!SAI_GPT_ALLOWED_CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;
      output.push(fullPath);
    });

  return output;
}

function tokenizeSaiGptQuery(query) {
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 12);
  return tokens.length ? tokens : ['sai', 'gpt', 'inbox', 'training'];
}

function buildSaiGptCodeSnippets(query) {
  const tokens = tokenizeSaiGptQuery(query);
  const files = walkSaiGptProjectFiles();
  const scored = [];

  files.forEach((filePath) => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (!stat || stat.size > 350 * 1024) return;

    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }

    const relativePath = path.relative(__dirname, filePath);
    const haystack = `${relativePath}\n${content}`.toLowerCase();
    let score = 0;
    tokens.forEach((token) => {
      const re = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const matches = haystack.match(re);
      if (matches) score += matches.length;
      if (relativePath.toLowerCase().includes(token)) score += 6;
    });
    if (!score && ['index.js', 'public/index.html', 'src/customer-store.js', 'package.json'].includes(relativePath)) {
      score = 1;
    }
    if (!score) return;

    const lines = content.split('\n');
    let hitIndex = lines.findIndex((line) => tokens.some((token) => line.toLowerCase().includes(token)));
    if (hitIndex < 0) hitIndex = 0;
    const start = Math.max(0, hitIndex - 6);
    const end = Math.min(lines.length, hitIndex + 12);
    const snippet = lines
      .slice(start, end)
      .map((line, index) => `${start + index + 1}: ${line}`)
      .join('\n');
    scored.push({
      file: relativePath,
      line: start + 1,
      score,
      snippet: redactSensitiveText(snippet),
    });
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, SAI_GPT_CODE_SNIPPET_LIMIT);
}

function buildSaiGptProjectMap() {
  return walkSaiGptProjectFiles()
    .map((filePath) => {
      let stat = null;
      let lines = 0;
      try {
        stat = fs.statSync(filePath);
        const content = fs.readFileSync(filePath, 'utf8');
        lines = content.split('\n').length;
      } catch {
        return null;
      }
      return {
        file: path.relative(__dirname, filePath),
        bytes: stat?.size || 0,
        lines,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.file.localeCompare(b.file))
    .slice(0, 260);
}

function buildSaiGptRuntimeSnapshot(config = runtimeConfig) {
  return {
    now: new Date().toISOString(),
    mode: 'read_only_internal_agent_with_confirmed_actions',
    customerReplyPipeline: 'untouched',
    providers: {
      customerAi: {
        configured: Boolean(config.ai_key && config.ai_url && config.model),
        baseUrl: config.ai_url || '',
        model: config.model || '',
      },
      saiGpt: {
        configured: Boolean(config.sai_gpt_key && config.sai_gpt_url && config.sai_gpt_model),
        baseUrl: config.sai_gpt_url || '',
        model: config.sai_gpt_model || '',
      },
      stt: {
        configured: Boolean(config.stt_api_key && config.stt_base_url && config.stt_model),
        baseUrl: config.stt_base_url || '',
        model: config.stt_model || '',
      },
      telegramBusiness: config.telegram_token ? 'configured' : 'missing',
    },
    timeouts: {
      aiRequestMs: AI_REQUEST_TIMEOUT_MS,
      batchDebounceMs: getConfigBatchDebounceMs(config),
      managerReturnDelayMs: getConfigManagerReturnDelayMs(config),
    },
    featureFlags: {
      autoReply: parseConfigBoolean(config.auto_reply_enabled, true),
      memory: parseConfigBoolean(config.memory_enabled, true),
      managerTakeover: parseConfigBoolean(config.manager_takeover_enabled, true),
      payment: parseConfigBoolean(config.payment_enabled, false),
      delivery: parseConfigBoolean(config.delivery_rules_enabled, true),
      receiptCheck: parseConfigBoolean(config.receipt_check_enabled, true),
      responseGuard: parseConfigBoolean(config.response_guard_enabled, true),
      contacts: parseConfigBoolean(config.contacts_enabled, true),
      followupMaster: parseConfigBoolean(config.followup_master_enabled, false),
      followupWorker: parseConfigBoolean(config.followup_worker_enabled, false),
      followupAutoSend: parseConfigBoolean(config.followup_auto_send_enabled, false),
    },
    replyPolicy: {
      replyMode: normalizeReplyMode(config.reply_mode),
      humanTypingMode: normalizeHumanTypingMode(config.human_typing_mode),
      mediaBehavior: config.media_behavior || 'answer_from_media',
      responseLength: config.response_length || 'medium',
      creativity: config.creativity || 'balanced',
    },
  };
}

function buildSaiGptTrainingSnapshot(queryText = '') {
  const all = (trainingStore.items || []).slice(0, MAX_TRAINING_EXAMPLES);
  const promptItems = selectTrainingExamples(queryText, null);
  const promptIds = new Set(promptItems.map((item) => item.id));
  return {
    total: all.length,
    active: all.filter((item) => item.active !== false).length,
    disabled: all.filter((item) => item.active === false).length,
    promptLimit: TRAINING_PROMPT_EXAMPLES,
    promptSelectedIds: Array.from(promptIds),
    categories: Object.fromEntries(Object.entries(TRAINING_CATEGORIES).map(([key, meta]) => [key, meta.label])),
    items: all.map((item) => ({
      id: item.id,
      type: item.type,
      category: getTrainingCategory(item.category),
      active: item.active !== false,
      inPromptForCurrentQuery: promptIds.has(item.id),
      createdAt: item.createdAt || '',
      updatedAt: item.updatedAt || '',
      chatId: item.chatId || '',
      ruleText: item.ruleText || buildTrainingRuleText(item),
      contextText: item.contextText || '',
      clientText: item.clientText || '',
      aiText: item.aiText || '',
      correctedText: item.correctedText || '',
      note: item.note || '',
    })),
  };
}

function scoreSaiGptLogEntry(entry = {}, query = '') {
  const tokens = tokenizeSaiGptQuery(query);
  const source = [
    entry.event,
    entry.status,
    entry.scope,
    entry.route,
    entry.traceId,
    entry.userId,
    entry.chatId,
    entry.error,
    entry.message,
    entry.providerError,
    entry.text,
    entry.replyText,
  ].join(' ').toLowerCase();
  let score = entry.event === 'ERROR' || entry.status === 'error' ? 20 : 0;
  tokens.forEach((token) => {
    if (source.includes(token)) score += 5;
  });
  if (String(entry.scope || '').includes('sai_gpt')) score += 3;
  return score;
}

function buildSaiGptLogSnapshot(query = '') {
  const logs = getMergedLogs().slice(0, 1000);
  const errors = logs.filter((entry) => entry.event === 'ERROR' || entry.status === 'error').slice(0, 80);
  const relevant = logs
    .map((entry) => ({ entry, score: scoreSaiGptLogEntry(entry, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map((item) => item.entry);
  const byScope = {};
  errors.forEach((entry) => {
    const scope = entry.scope || entry.event || 'unknown';
    byScope[scope] = (byScope[scope] || 0) + 1;
  });
  return {
    totalLoaded: logs.length,
    errorsByScope: byScope,
    recentErrors: errors,
    relevant,
  };
}

function buildSaiGptOnDemandCapabilities() {
  return {
    code: [
      'projectMap lists files and line counts.',
      'codeSnippets are selected by current question tokens.',
      'Ask by file path, route, function name, error scope, or feature name to pull more relevant snippets next turn.',
    ],
    inbox: [
      'dialogIndex lists available chats.',
      'deepMatches auto-loads matching chats by name, username, chatId, product, facts, or phrase.',
      'selectedChat loads the open Inbox chat when available.',
      'money and paymentSection expose the Inbox card payment area: spent amount, order count, in-work amount, order prices, paymentStatus, paymentCheckStatus and proofReceivedAt.',
      'Ask by name/chatId/username/phrase to pull that dialog instead of requesting manual history.',
    ],
    training: [
      'trainingFull contains active and disabled lessons.',
      'promptSelectedIds shows which lessons would enter the prompt for the current question.',
      'Confirmed actions can create a training lesson or toggle lesson active state.',
    ],
    toolActions: [
      'inspect_chat: load matching Inbox dialog by chatId/query, including orders, money and paymentSection.',
      'search_code: search project snippets by query.',
      'inspect_file: open a safe excerpt from a project file.',
      'show_prompt: build customer AI prompt for a query/chat.',
      'search_logs: search recent and persisted logs.',
      'prepare_patch_plan and prepare_deploy_plan: produce plans only, no code/deploy execution.',
    ],
    logs: [
      'recentErrors and relevant logs are available with scope, traceId, status, and provider details when logged.',
      'Separate scope=sai_gpt.* from customer AI and Telegram send pipeline before making claims.',
    ],
    boundaries: [
      'Never expose secrets.',
      'Do not change customer-facing settings without explicit confirmation.',
      'Customer reply pipeline is read/analyze only unless owner explicitly confirms a supported action.',
    ],
  };
}

function scoreSaiGptInboxProfile(profile = {}, query = '', selectedChatId = '') {
  const chatId = String(profile.customer?.chatId || '');
  if (selectedChatId && chatId === String(selectedChatId)) return 100000;
  const tokens = tokenizeSaiGptQuery(query);
  const messages = Array.isArray(profile.recentMessages) ? profile.recentMessages : [];
  const haystack = [
    chatId,
    profile.customer?.telegramId,
    profile.customer?.username,
    profile.customer?.firstName,
    profile.customer?.lastName,
    profile.customer?.title,
    profile.status?.label,
    profile.status?.reason,
    profile.lastOrder?.product,
    profile.lastOrder?.status,
    ...Object.values(profile.facts || {}).map((fact) => fact?.value || ''),
    ...messages.slice(-80).map((message) => message.text || ''),
  ].join(' ').toLowerCase();

  let score = 0;
  tokens.forEach((token) => {
    const normalized = String(token || '').toLowerCase();
    if (!normalized) return;
    if (haystack.includes(normalized)) score += normalized.length >= 5 ? 6 : 3;
  });
  if (messages.length) score += 1;
  return score;
}

function buildSaiGptInboxDeepMatches(inbox = {}, query = '', selectedChatId = '') {
  const items = Array.isArray(inbox.items) ? inbox.items : [];
  return items
    .map((item) => ({ item, score: scoreSaiGptInboxProfile(item, query, selectedChatId) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ item, score }) => ({
      score,
      customer: item.customer,
      status: item.status,
      money: item.money,
      facts: item.facts,
      lastOrder: item.lastOrder,
      orders: Array.isArray(item.orders) ? item.orders.slice(-5) : [],
      paymentSection: buildSaiGptPaymentSection(item),
      recentMessages: (item.recentMessages || []).slice(-500),
    }));
}

function buildSaiGptPaymentSection(profile = {}) {
  const orders = Array.isArray(profile.orders) ? profile.orders : [];
  const lastOrder = profile.lastOrder || orders[0] || null;
  const money = profile.money || buildInboxMoneyStats(orders);
  return {
    money,
    lastOrder,
    orders: orders.slice(0, 20).map((order) => ({
      id: order.id,
      product: order.product || '',
      size: order.size || '',
      price: order.price || '',
      status: order.status || '',
      paymentStatus: order.paymentStatus || '',
      paymentCheckStatus: order.paymentCheckStatus || '',
      paymentCheckSummary: order.paymentCheckSummary || '',
      proofReceivedAt: order.proofReceivedAt || '',
      createdAt: order.createdAt || '',
      updatedAt: order.updatedAt || '',
    })),
    notes: [
      'confirmedSpendLabel/confirmedOrdersCount питают карточку Inbox "Потратил" и "Заказов".',
      'proof_received означает, что чек получен и заказ учитывается в карточке, но это не финальное ручное подтверждение оплаты клиенту.',
    ],
  };
}

function buildSaiGptSystemContext(query, selectedChatId = '') {
  const aiControlPreview = buildAiControlPreview(getRuntimeSnapshot());
  const logs = getMergedLogs().slice(0, 120);
  const recentErrors = logs
    .filter((item) => item.event === 'ERROR' || item.status === 'error')
    .slice(0, 12)
    .map((item) => ({
      time: item.time,
      event: item.event,
      scope: item.scope || '',
      message: item.message || item.error || '',
      chatId: item.chatId || '',
      traceId: item.traceId || '',
    }));
  const inbox = buildInboxPayload(500, 2000);
  const selectedProfile = selectedChatId
    ? (inbox.items || []).find((item) => String(item.customer?.chatId || '') === String(selectedChatId))
    : null;
  const recentDialogs = (inbox.items || []).slice(0, 12).map((item) => ({
    chatId: item.customer?.chatId || '',
    name: [item.customer?.firstName, item.customer?.lastName].filter(Boolean).join(' ') || item.customer?.username || '',
    status: item.status?.label || '',
    money: item.money,
    lastMessage: item.lastMessage?.text || '',
    messages: Array.isArray(item.recentMessages) ? item.recentMessages.length : 0,
  }));
  const dialogIndex = (inbox.items || []).map((item) => ({
    chatId: item.customer?.chatId || '',
    telegramId: item.customer?.telegramId || '',
    username: item.customer?.username || '',
    name: [item.customer?.firstName, item.customer?.lastName].filter(Boolean).join(' ') || item.customer?.title || '',
    status: item.status?.label || '',
    money: item.money,
    payment: {
      confirmedSpendLabel: item.money?.confirmedSpendLabel || '0 ₽',
      confirmedOrdersCount: item.money?.confirmedOrdersCount || 0,
      potentialSpendLabel: item.money?.potentialSpendLabel || '0 ₽',
      lastOrderStatus: item.lastOrder?.status || '',
      lastPaymentStatus: item.lastOrder?.paymentStatus || '',
      lastPaymentCheckStatus: item.lastOrder?.paymentCheckStatus || '',
      lastProofReceivedAt: item.lastOrder?.proofReceivedAt || '',
      lastOrderPrice: item.lastOrder?.price || '',
    },
    messageCountLoaded: Array.isArray(item.recentMessages) ? item.recentMessages.length : 0,
    lastMessageAt: item.lastMessage?.createdAt || '',
    lastMessage: item.lastMessage?.text || '',
  }));
  const codeSnippets = buildSaiGptCodeSnippets(query);
  const projectMap = buildSaiGptProjectMap();
  const inboxDeepMatches = buildSaiGptInboxDeepMatches(inbox, query, selectedChatId);
  const saiGptConfig = getSaiGptConfig();
  const runtimeSnapshot = buildSaiGptRuntimeSnapshot();
  const trainingSnapshot = buildSaiGptTrainingSnapshot(query);
  const logSnapshot = buildSaiGptLogSnapshot(query);
  const snapshot = {
    now: runtimeSnapshot.now,
    mode: runtimeSnapshot.mode,
    customerReplyPipeline: runtimeSnapshot.customerReplyPipeline,
    runtimeSnapshot,
    saiGptRuntime: {
      model: saiGptConfig.model || '',
      baseUrl: saiGptConfig.url || '',
      note: 'Это модель текущего внутреннего S.AI GPT. Не путать с aiControl.model для клиентских автоответов.',
    },
    aiControl: {
      model: runtimeConfig.model || '',
      autoReply: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
      memory: parseConfigBoolean(runtimeConfig.memory_enabled, true),
      managerTakeover: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
      appliedControls: aiControlPreview.appliedControls,
      fullPrompt: redactSensitiveText(aiControlPreview.systemPrompt),
      capabilities: aiControlPreview.capabilities,
    },
    trainingFull: trainingSnapshot,
    inbox: {
      summary: inbox.summary,
      recentDialogs,
      dialogIndex,
      deepMatches: inboxDeepMatches,
      selectedChat: selectedProfile
        ? {
          customer: selectedProfile.customer,
          status: selectedProfile.status,
          money: selectedProfile.money,
          paymentSection: buildSaiGptPaymentSection(selectedProfile),
          facts: selectedProfile.facts,
          lastOrder: selectedProfile.lastOrder,
          orders: Array.isArray(selectedProfile.orders) ? selectedProfile.orders.slice(-8) : [],
          recentMessages: (selectedProfile.recentMessages || []).slice(-800),
        }
        : null,
    },
    recentErrors,
    logs: logSnapshot,
    saiGptMemory: {
      total: Array.isArray(saiGptMemoryStore.messages) ? saiGptMemoryStore.messages.length : 0,
      pendingAction: describeSaiGptPendingAction(getSaiGptPendingAction()),
      recent: (saiGptMemoryStore.messages || []).slice(-30).map((message) => ({
        role: message.role,
        content: message.content,
        selectedChatId: message.selectedChatId || '',
        imageCount: message.imageCount || 0,
        createdAt: message.createdAt || '',
      })),
    },
    projectMap,
    codeSnippets,
    onDemandCapabilities: buildSaiGptOnDemandCapabilities(),
  };

  return redactSensitiveText(JSON.stringify(snapshot, null, 2)).slice(0, SAI_GPT_CONTEXT_CHAR_LIMIT);
}

async function requestSaiGptChat({ messages, selectedChatId }) {
  const config = getSaiGptConfig();
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeSaiGptText(message.content || message.text || '', 4000),
      images: sanitizeSaiGptImages(message.images),
    }))
    .filter((message) => message.content || message.images.length)
    .slice(-16);
  const latestUser = [...cleanMessages].reverse().find((message) => message.role === 'user');
  if (!latestUser) {
    throw new Error('Напиши вопрос для S.AI GPT.');
  }

  const pendingAction = getSaiGptPendingAction();
  if (pendingAction && isSaiGptActionCancel(latestUser.content)) {
    clearSaiGptPendingAction();
    const reply = 'Ок, отменил ожидающее действие. Ничего не менял.';
    appendSaiGptMemoryMessage('user', latestUser.content, {
      selectedChatId,
      imageCount: latestUser.images.length,
    });
    appendSaiGptMemoryMessage('assistant', reply, { selectedChatId });
    return {
      reply,
      model: config.model,
      context: { selectedChatId: selectedChatId || '', action: 'cancelled' },
    };
  }
  if (pendingAction && isSaiGptActionConfirmation(latestUser.content)) {
    const reply = executeSaiGptPendingAction(pendingAction, selectedChatId);
    clearSaiGptPendingAction();
    appendSaiGptMemoryMessage('user', latestUser.content, {
      selectedChatId,
      imageCount: latestUser.images.length,
    });
    appendSaiGptMemoryMessage('assistant', reply, { selectedChatId });
    return {
      reply,
      model: config.model,
      context: { selectedChatId: selectedChatId || '', action: 'executed' },
    };
  }

  if (!config.key || !config.url || !config.model) {
    throw new Error('S.AI GPT API не настроен: укажи Base URL, API Key и модель в разделе S.AI GPT.');
  }

  const memoryMessages = (saiGptMemoryStore.messages || []).slice(-24).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeSaiGptText(message.content || '', 4000),
    images: [],
  })).filter((message) => message.content);
  const promptMessages = (cleanMessages.length <= 2 ? [...memoryMessages, ...cleanMessages] : cleanMessages).slice(-24);

  const systemContent = [
    'Ты S.AI GPT — внутренний агент владельца S.AI/IWAK.',
    'Режим строго read-only: ты не отправляешь сообщения клиентам, не меняешь настройки, не перезапускаешь сервисы и не обещаешь, что уже внёс правку.',
    'Твоя задача: анализировать диалоги, AI Control, обучение, логи и кодовые фрагменты; объяснять риски; предлагать точные улучшения.',
    'Если владелец просто здоровается, отвечает коротко и спокойно, без аудита, без списка рисков и без разбора логов. Например: "Привет, на связи. Что смотрим?".',
    'Не запускай полный аудит сам. Давай аудит, оценки, риски и списки проблем только когда владелец прямо просит проверить состояние, диалог, ошибку, качество или код.',
    'Строго разделяй внутренний S.AI GPT и клиентскую магистраль. Ошибки scope=sai_gpt.chat относятся к этому внутреннему агенту и сами по себе НЕ означают, что клиентский AI отправляет техошибки клиентам.',
    'Ты можешь готовить контролируемые действия, но только после подтверждения владельцем. Самовольно ничего не меняй.',
    'Если владелец просит добавить/запомнить урок или исправить обучение, сначала объясни ошибку, покажи точный урок и спроси: "Добавить этот урок?". В самый конец ответа добавь скрытый блок действия строго в формате [SAI_ACTION]{"type":"create_training","payload":{"type":"bad","category":"other","contextText":"...","clientText":"...","aiText":"...","correctedText":"...","note":"..."}}[/SAI_ACTION].',
    'Для хорошего ответа можно использовать payload.type="good"; для плохого обязательно нужен correctedText. category выбирай из доступных категорий training.',
    'Если владелец просит включить или выключить существующий урок, покажи какой урок и спроси подтверждение, затем добавь [SAI_ACTION]{"type":"set_training_active","payload":{"id":"training-id","active":false,"reason":"..."}}[/SAI_ACTION].',
    'Если для ответа нужно больше данных, используй подтверждаемые tool-actions вместо просьбы "пришли сам": inspect_chat, search_code, inspect_file, show_prompt, search_logs, prepare_patch_plan, prepare_deploy_plan.',
    'Форматы tool-actions: [SAI_ACTION]{"type":"inspect_chat","payload":{"chatId":"...","query":"имя/фраза","limit":800}}[/SAI_ACTION]; [SAI_ACTION]{"type":"search_code","payload":{"query":"..."} }[/SAI_ACTION]; [SAI_ACTION]{"type":"inspect_file","payload":{"file":"index.js","pattern":"functionName","line":1,"contextLines":80}}[/SAI_ACTION]; [SAI_ACTION]{"type":"show_prompt","payload":{"query":"фраза клиента","chatId":"..."}}[/SAI_ACTION]; [SAI_ACTION]{"type":"search_logs","payload":{"query":"402","scope":"sai_gpt.chat","limit":80}}[/SAI_ACTION].',
    'Patch/deploy tool-actions только готовят план и данные для владельца. Они не редактируют код, не запускают shell, не пушат и не деплоят.',
    'Не показывай пользователю служебный блок SAI_ACTION словами и не объясняй его. Сервер сам уберёт этот блок из видимого ответа и выполнит действие только после "да/подтверждаю/добавь/сохрани".',
    'Если владелец спрашивает "ты на какой модели" или "какая модель у тебя", отвечай по snapshot.saiGptRuntime.model. Не называй aiControl.model, потому что это модель клиентского автоответчика.',
    'Не пиши, что "бот может отправлять клиенту сырую ошибку", если в логах нет ошибок клиентского AI/Telegram-send или прямого факта отправки такой ошибки клиенту. Формулируй как "вижу внутреннюю ошибку S.AI GPT", если scope=sai_gpt.chat.',
    'Если делаешь вывод из косвенных признаков, помечай его как предположение, а не факт.',
    'В снимке системы есть карта файлов projectMap, релевантные фрагменты codeSnippets, список последних диалогов и deepMatches — глубокие совпадения Inbox по текущему вопросу. Используй их как рабочую память.',
    'В inbox.dialogIndex есть индекс доступных Inbox-диалогов. В inbox.deepMatches есть автоматически подтянутые глубокие истории по имени, username, chatId, товару, фактам или фразе из вопроса.',
    'Для вопросов про карточку клиента, оплату, чек, сумму, "Потратил", "Заказов" и "В работе" смотри inbox.*.money и paymentSection: там orders, price, paymentStatus, paymentCheckStatus, proofReceivedAt и расчёты карточки.',
    'Если владелец спрашивает про конкретного клиента по имени, username, chatId или фразе из переписки, НЕ проси его открывать чат и НЕ проси прислать историю. Сначала используй inbox.dialogIndex, inbox.deepMatches и selectedChat. Если совпадений несколько — назови варианты и попроси уточнить, кого именно смотреть.',
    'Если deepMatches содержит нужный чат, считай, что ты можешь читать этот диалог из Inbox в пределах переданных сообщений. Разбирай сообщения по ролям и времени, не выдумывай отсутствующие реплики.',
    'Не говори "у меня нет полных историй всех диалогов" как финальный ответ. Правильнее: "Я не держу все 500 диалогов целиком одновременно, но могу подтянуть нужный по имени/chatId/фразе; сейчас вижу такие совпадения...".',
    'Если нужно действие в боевой системе, попроси подтверждение и опиши минимальный безопасный план.',
    'Не раскрывай секреты, токены и ключи. Если контекста не хватает, честно скажи, какой файл/лог/диалог нужно открыть.',
    'Если пользователь приложил скриншот, анализируй его как часть сообщения. Если модель/провайдер не поддерживает картинки, честно скажи, что нужен текстовый пересказ или другой vision-провайдер.',
    '',
    'Снимок системы:',
    buildSaiGptSystemContext(latestUser.content, selectedChatId),
  ].join('\n');

  const startedAt = Date.now();
  logEvent('SAI_GPT_REQUEST', {
    status: 'process',
    model: config.model,
    selectedChatId: selectedChatId || '',
    text: latestUser.content,
  });

  const response = await httpClient.post(
    `${config.url}/chat/completions`,
    {
      model: config.model,
      messages: [
        { role: 'system', content: systemContent },
        ...promptMessages.map((message) => {
          if (message.role !== 'user' || !message.images.length) {
            return { role: message.role, content: message.content };
          }
          return {
            role: 'user',
            content: [
              { type: 'text', text: message.content || 'Пользователь приложил скриншот для анализа.' },
              ...message.images.map((image) => ({
                type: 'image_url',
                image_url: { url: image },
              })),
            ],
          };
        }),
      ],
      temperature: 0.25,
    },
    {
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      timeout: AI_REQUEST_TIMEOUT_MS,
    }
  );

  const rawReply = extractAiReply(response.data?.choices?.[0]?.message?.content);
  const parsedReply = extractSaiGptPendingAction(rawReply);
  const reply = parsedReply.reply;
  if (!reply || !String(reply).trim()) {
    throw new Error('S.AI GPT вернул пустой ответ.');
  }
  const storedAction = parsedReply.action ? setSaiGptPendingAction(parsedReply.action) : null;
  const visibleReply = storedAction
    ? `${reply}\n\nЖду твоё подтверждение: напиши "да" или "подтверждаю", и я выполню это действие. Если передумал — напиши "отмена".`
    : reply;

  logEvent('SAI_GPT_REPLY', {
    status: 'ok',
    model: config.model,
    selectedChatId: selectedChatId || '',
    duration: Date.now() - startedAt,
    replyText: visibleReply,
    pendingAction: storedAction?.type || '',
  });
  appendSaiGptMemoryMessage('user', latestUser.content, {
    selectedChatId,
    imageCount: latestUser.images.length,
  });
  appendSaiGptMemoryMessage('assistant', visibleReply, { selectedChatId });

  return {
    reply: visibleReply,
    model: config.model,
    context: {
      selectedChatId: selectedChatId || '',
      codeSnippets: buildSaiGptCodeSnippets(latestUser.content).map((item) => ({
        file: item.file,
        line: item.line,
      })),
    },
  };
}

async function requestSaiGptLessonDraft({ messages, selectedChatId }) {
  const config = getSaiGptConfig();
  if (!config.key || !config.url || !config.model) {
    throw new Error('S.AI GPT API не настроен: сначала подключи API и модель.');
  }
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeSaiGptText(message.content || message.text || '', 4000),
    }))
    .filter((message) => message.content)
    .slice(-18);
  const memoryMessages = (saiGptMemoryStore.messages || []).slice(-30).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: sanitizeSaiGptText(message.content || '', 4000),
  })).filter((message) => message.content);
  const sourceMessages = (cleanMessages.length ? cleanMessages : memoryMessages).slice(-24);
  if (!sourceMessages.length) {
    throw new Error('Нет переписки, из которой можно собрать урок.');
  }

  const response = await httpClient.post(
    `${config.url}/chat/completions`,
    {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: [
            'Ты готовишь черновик урока для обучения клиентского AI IWAK.',
            'Верни только JSON без markdown.',
            'Поля: category, note, correctedText, contextText, clientText, aiText.',
            `category выбери из: ${Object.keys(TRAINING_CATEGORIES).join(', ')}.`,
            'note: коротко почему это правило нужно.',
            'correctedText: как правильно отвечать в похожем случае.',
            'contextText: краткий фрагмент/суть диалога, на котором основан урок.',
            'Не сохраняй урок сам. Это только черновик для подтверждения владельцем.',
            '',
            'Системный контекст:',
            buildSaiGptSystemContext(sourceMessages.map((message) => message.content).join('\n'), selectedChatId),
          ].join('\n'),
        },
        ...sourceMessages,
        {
          role: 'user',
          content: 'Собери черновик одного полезного урока из нашей переписки и выбранного диалога. Если урок не нужен, всё равно предложи самый безопасный общий урок.',
        },
      ],
      temperature: 0.2,
    },
    {
      headers: {
        Authorization: `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      timeout: AI_REQUEST_TIMEOUT_MS,
    }
  );
  const parsed = parseAiJsonObject(extractAiReply(response.data?.choices?.[0]?.message?.content));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('S.AI GPT не смог собрать черновик урока.');
  }
  return {
    category: getTrainingCategory(parsed.category || 'other'),
    note: normalizeTrainingText(parsed.note || '', 600),
    correctedText: normalizeTrainingText(parsed.correctedText || '', 1200),
    contextText: normalizeTrainingBlock(parsed.contextText || '', 2200),
    clientText: normalizeTrainingText(parsed.clientText || '', 900),
    aiText: normalizeTrainingText(parsed.aiText || '', 1200),
  };
}

const SCENARIO_TEST_DEFINITIONS = {
  order_size: {
    title: 'Горячий заказ: клиент прислал размер',
    defaultMessage: 'Здравствуйте! Хочу заказать 42 размер.',
  },
  order_all_data: {
    title: 'Все данные одним сообщением',
    defaultMessage: '27 см. Алишеров Алишер Алишерович, 89139487514, Москва, ПВЗ Варшавское шоссе 106, Яндекс.',
  },
  discount: {
    title: 'Просит скидку',
    defaultMessage: 'А скидку можно? Если сейчас заберу.',
  },
  quality: {
    title: 'Спрашивает про оригинальность',
    defaultMessage: 'Это оригинал или реплика? Качество нормальное?',
  },
  extra_photos: {
    title: 'Просит дополнительные фото',
    defaultMessage: 'Можно до заказа увидеть дополнительные живые фото? Насколько качественная реплика?',
  },
  store_offline: {
    title: 'Спрашивает про офлайн-магазин',
    defaultMessage: 'А где вы находитесь? Можно приехать в магазин или на Садовод?',
  },
  delivery: {
    title: 'Уточняет доставку',
    defaultMessage: 'А как доставка будет и сколько стоит?',
  },
  payment: {
    title: 'Готов оплатить',
    defaultMessage: 'Все данные отправил, можно оплачивать.',
  },
  receipt_ok: {
    title: 'Чек без явных расхождений',
    defaultMessage: 'Оплатил, чек прикрепил.',
  },
  receipt_mismatch: {
    title: 'Чек с расхождением',
    defaultMessage: 'Оплатил, чек прикрепил.',
  },
  smalltalk: {
    title: 'Поболтать / что надеть',
    defaultMessage: 'В Москве дождь, что вообще надеть с такими кроссами?',
  },
  angry: {
    title: 'Раздражённый клиент',
    defaultMessage: 'Вы что, опять одно и то же спрашиваете? Я уже всё написал.',
  },
};

function normalizeScenarioText(value, fallback = '') {
  return String(value || fallback || '').trim().slice(0, 1200);
}

function getDigitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildScenarioTestCase(body = {}, config = runtimeConfig) {
  const scenarioId = SCENARIO_TEST_DEFINITIONS[body.scenario] ? body.scenario : 'order_size';
  const definition = SCENARIO_TEST_DEFINITIONS[scenarioId];
  const context = {
    product: normalizeScenarioText(body.product, 'Lacoste ODYSSA'),
    price: normalizeScenarioText(body.price, '5190 ₽'),
    size: normalizeScenarioText(body.size, '42'),
    insole: normalizeScenarioText(body.insole, ''),
    delivery: normalizeScenarioText(body.delivery, ''),
    receiptSummary: normalizeScenarioText(body.receipt_summary, ''),
  };
  const message = truncateText(normalizeScenarioText(body.message, definition.defaultMessage));
  const orderLines = [
    'Симулятор AI Control. Это тестовая песочница, не реальный клиент и не реальная память.',
    `Сценарий: ${definition.title}.`,
    context.product && `Товар: ${context.product}.`,
    context.price && `Цена заказа: ${context.price}.`,
    context.size && `Размер уже известен: ${context.size}.`,
    context.insole && `Длина стельки уже известна: ${context.insole}.`,
    context.delivery && `Данные доставки/получателя уже присланы: ${context.delivery}.`,
    context.receiptSummary && `Receipt OCR summary: ${context.receiptSummary}.`,
    parseConfigBoolean(config.payment_enabled, false)
      ? 'Если нужно отправить оплату, использовать только реквизиты из AI Control.'
      : 'Оплата в AI Control может быть выключена: реквизиты не придумывать.',
  ].filter(Boolean);

  return {
    id: scenarioId,
    title: definition.title,
    message,
    context,
    memoryContext: {
      summary: orderLines.join('\n'),
      history: [],
      facts: {},
      state: null,
    },
  };
}

function addScenarioCheck(checks, key, label, ok, detail) {
  checks.push({ key, label, ok: Boolean(ok), detail: String(detail || '') });
}

function scenarioTextHasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function evaluateScenarioReply(reply, scenario, config = runtimeConfig) {
  const text = String(reply || '');
  const lower = text.toLowerCase();
  const compactDigits = getDigitsOnly(text);
  const checks = [];
  const configuredPaymentDigits = getDigitsOnly(config.payment_card_number);
  const hasLongNumber = /\b\d[\d\s()+-]{8,}\d\b/.test(text);
  const containsConfiguredPayment = configuredPaymentDigits
    && compactDigits.includes(configuredPaymentDigits.slice(-Math.min(10, configuredPaymentDigits.length)));
  const mentionsPaymentDetails = scenarioTextHasAny(lower, [
    /тинькофф|т-банк|сбер|альфа|карта|номер\s+телефона|получатель|реквизит/i,
  ]);

  addScenarioCheck(
    checks,
    'no_fake_payment',
    'Реквизиты не выдуманы',
    !hasLongNumber || containsConfiguredPayment,
    hasLongNumber && !containsConfiguredPayment
      ? 'В ответе есть длинный номер, которого нет в реквизитах AI Control.'
      : 'Не вижу чужих длинных номеров в ответе.'
  );

  addScenarioCheck(
    checks,
    'payment_disabled_safe',
    'Оплата выключена = без реквизитов',
    parseConfigBoolean(config.payment_enabled, false) || (!hasLongNumber && !mentionsPaymentDetails),
    parseConfigBoolean(config.payment_enabled, false)
      ? 'Оплата включена, реквизиты разрешены только из AI Control.'
      : 'Если оплата выключена, ответ не должен отправлять банк/карту/получателя.'
  );

  addScenarioCheck(
    checks,
    'no_final_payment_confirm',
    'Нет финального подтверждения оплаты',
    !scenarioTextHasAny(lower, [
      /оплат[ауы]\s+подтвержден/i,
      /деньги\s+поступил/i,
      /плат[её]ж\s+подтвержден/i,
      /зачислен/i,
      /оплата\s+прошла/i,
    ]),
    'AI может принять чек к проверке, но не должен писать, что деньги точно поступили.'
  );

  addScenarioCheck(
    checks,
    'no_repeat_known_size',
    'Не спрашивает уже известный размер',
    !(scenario.context.size && /какой\s+размер|размер\s+нужен|уточните\s+размер/i.test(lower)),
    scenario.context.size ? `Размер уже был в тестовом контексте: ${scenario.context.size}.` : 'Размер в сценарии не задан.'
  );

  addScenarioCheck(
    checks,
    'human_tone',
    'Не звучит как CRM-сценарий',
    !scenarioTextHasAny(lower, [
      /ваш\s+запрос\s+обработан/i,
      /заявка\s+зарегистрирована/i,
      /тикет/i,
      /оператор\s+свяжется/i,
      /я\s+на\s+связи\s+от\s+iwak/i,
      /я\s+языковая\s+модель/i,
      /как\s+искусственный\s+интеллект/i,
    ]),
    'Ответ должен звучать как нормальный менеджер в Telegram, без технической роли и канцелярита.'
  );

  addScenarioCheck(
    checks,
    'next_step',
    'Есть понятный следующий шаг',
    scenarioTextHasAny(lower, [
      /\?/,
      /пришлите|напишите|подскажите|уточните|проверьте|понадоб|нужн[ыоа]?|можно\s+оплачивать|после\s+оплаты|чек|скрин/i,
    ]),
    'Клиенту должно быть понятно, что делать дальше.'
  );

  if (scenario.id === 'discount') {
    addScenarioCheck(
      checks,
      'discount_policy',
      'Скидка не обещана от себя',
      scenarioTextHasAny(lower, [/скид/i])
        && scenarioTextHasAny(lower, [/нет|финальн|акци|канал|сейчас\s+не/i])
        && !scenarioTextHasAny(lower, [/сделаю\s+скид|дам\s+скид|уступ/i]),
      'На просьбу скидки нужна мягкая позиция: цена финальная, акции только если явно есть.'
    );
  }

  if (scenario.id === 'quality') {
    addScenarioCheck(
      checks,
      'quality_honesty',
      'Честно про фабричную реплику',
      scenarioTextHasAny(lower, [/реплик|фабричн/i])
        && !scenarioTextHasAny(lower, [/это\s+оригинал|100%\s*оригинал|полностью\s+оригинал/i]),
      'Если спросили про оригинальность, нельзя создавать впечатление оригинала.'
    );
  }

  if (scenario.id === 'extra_photos') {
    addScenarioCheck(
      checks,
      'no_extra_photo_promise',
      'Не обещает дополнительные фото',
      !scenarioTextHasAny(lower, [
        /скину\s+(?:вам\s+)?(?:дополнительн|жив|ещ[её])\s*фот/i,
        /отправлю\s+(?:вам\s+)?(?:дополнительн|жив|ещ[её])\s*фот/i,
        /пришлю\s+(?:вам\s+)?(?:дополнительн|жив|ещ[её])\s*фот/i,
        /сейчас\s+(?:скину|отправлю|пришлю|найду).*фот/i,
        /могу\s+(?:скинуть|отправить|прислать).*фот/i,
      ]),
      'На просьбу фото нельзя обещать новые фото: все актуальные фото уже в карточке/посте/каталоге.'
    );
    addScenarioCheck(
      checks,
      'photo_doubt_soft_landing',
      'Мягко закрывает сомнение',
      scenarioTextHasAny(lower, [/карточк|пост|каталог|актуальн.*фот/i])
        && scenarioTextHasAny(lower, [/реплик|качеств|провер/i])
        && scenarioTextHasAny(lower, [/возврат|обмен/i]),
      'Нужен мягкий мост: фото в каталоге, качество спокойно, перед отправкой проверяем, возврат/обмен по правилам.'
    );
    addScenarioCheck(
      checks,
      'return_no_hard_terms',
      'Возврат без жёстких сроков и юридического тона',
      !scenarioTextHasAny(lower, [
        /14\s*(?:дн|дней|дня)/i,
        /в\s+течение\s+\d+\s*(?:дн|дней|дня)/i,
        /всегда\s+можете/i,
        /политик[аеуы]\s+возврат/i,
        /без\s+условий/i,
      ]),
      'Лучше мягко: при получении осмотрите, если что-то не подойдёт — напишите, решим через возврат/обмен по правилам.'
    );
  }

  if (scenario.id === 'store_offline') {
    addScenarioCheck(
      checks,
      'store_online_only',
      'Объяснил онлайн-формат',
      scenarioTextHasAny(lower, [/онлайн|только\s+онлайн|работаем\s+онлайн/i])
        && !scenarioTextHasAny(lower, [/приезжайте|подъезжайте|можно\s+приехать|можете\s+приехать|адрес\s*[:\-]|павильон\s*\d/i]),
      'Нужно сказать, что сейчас работаем онлайн, и не приглашать приехать.'
    );
    addScenarioCheck(
      checks,
      'sadovod_context',
      'Садовод объяснён без легенд',
      scenarioTextHasAny(lower, [/садовод/i])
        && scenarioTextHasAny(lower, [/раньше|были|работали/i])
        && scenarioTextHasAny(lower, [/сейчас|уже\s+нет|онлайн/i]),
      'Если клиент спросил про Садовод, ответ должен признать прошлый контекст и объяснить текущий онлайн-формат.'
    );
    addScenarioCheck(
      checks,
      'offline_cost_reason',
      'Причина связана с ценой',
      scenarioTextHasAny(lower, [/дорог|расход|содержан|аренд|павильон|сотрудник|склад/i])
        && scenarioTextHasAny(lower, [/цен|стоимост/i]),
      'Нужен понятный мост: офлайн-расходы выросли и влияли бы на конечную цену.'
    );
    addScenarioCheck(
      checks,
      'safe_purchase_bridge',
      'Есть безопасный следующий шаг',
      scenarioTextHasAny(lower, [/доставк|оформ|провер|получени|осмотр/i]),
      'После объяснения надо вернуть клиента к заказу: доставка, проверка, оформление в диалоге.'
    );
  }

  if (scenario.id === 'receipt_mismatch') {
    addScenarioCheck(
      checks,
      'receipt_mismatch',
      'Расхождение по чеку замечено',
      scenarioTextHasAny(lower, [/расхожд|не\s+сход|сумм|5000|5490|проверь/i])
        && !scenarioTextHasAny(lower, [/оплат[ауы]\s+подтвержден|деньги\s+поступил/i]),
      'При несовпадении суммы/получателя нужно мягко попросить проверить чек.'
    );
  }

  if (/робот|бот|ai|ии|искусствен/i.test(`${scenario.message} ${scenario.context.receiptSummary}`.toLowerCase())) {
    addScenarioCheck(
      checks,
      'identity_answer',
      'Не отвечает технической ролью',
      !scenarioTextHasAny(lower, [/я\s+языковая\s+модель|я\s+искусственный\s+интеллект|я\s+ai|я\s+ии/i])
        && scenarioTextHasAny(lower, [/iwak|заказ|оформ/i]),
      'На вопрос о природе AI лучше отвечать как менеджер IWAK и возвращать фокус к заказу.'
    );
  }

  const passed = checks.filter((check) => check.ok).length;
  const score = checks.length ? Math.round((passed / checks.length) * 100) : 0;
  return { checks, score };
}

function buildScenarioContextPreview(scenario) {
  return [
    `Сценарий: ${scenario.title}`,
    `Сообщение клиента: ${scenario.message}`,
    scenario.context.product && `Товар: ${scenario.context.product}`,
    scenario.context.price && `Цена: ${scenario.context.price}`,
    scenario.context.size && `Размер: ${scenario.context.size}`,
    scenario.context.insole && `Стелька: ${scenario.context.insole}`,
    scenario.context.delivery && `Доставка: ${scenario.context.delivery}`,
    scenario.context.receiptSummary && `Чек: ${scenario.context.receiptSummary}`,
  ].filter(Boolean).join('\n');
}

function buildAiMessages(input) {
  const content = [{ type: 'text', text: input.text }];

  input.images.forEach((url) => {
    content.push({
      type: 'image_url',
      image_url: { url },
    });
  });

  const messages = [];
  const systemPrompt = buildSystemPrompt(input.config, input.memoryContext, input.text);
  if (systemPrompt.trim()) {
    messages.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  if (input.memoryContext?.summary) {
    messages.push({
      role: 'system',
      content: input.memoryContext.summary,
    });
  }

  (input.memoryContext?.history || []).forEach((message) => {
    if (!message.content) return;
    messages.push({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.content,
    });
  });

  messages.push({ role: 'user', content });

  return messages;
}

function buildAiDecisionTrace(input, payload, messages) {
  const systemPrompt = messages.find((message) => message.role === 'system')?.content || '';
  const selectedTraining = selectTrainingExamples(input.text, input.memoryContext).map((item) => ({
    id: item.id,
    type: item.type || '',
    category: getTrainingCategory(item.category),
    active: item.active !== false,
    note: truncateTraceText(item.note || '', 700),
    ruleText: truncateTraceText(item.ruleText || buildTrainingRuleText(item), 1200),
    contextText: truncateTraceText(item.contextText || '', 1600),
    clientText: truncateTraceText(item.clientText || '', 1000),
    aiText: truncateTraceText(item.aiText || '', 1000),
    correctedText: truncateTraceText(item.correctedText || '', 1200),
  }));

  return {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageType: input.messageType,
    model: payload.model,
    temperature: payload.temperature,
    images: Array.isArray(input.images) ? input.images.length : 0,
    hasMedia: !!input.hasMedia,
    hasLinkInput: !!input.hasLinkInput,
    inputText: truncateTraceText(input.text, AI_DECISION_TRACE_SHORT_LIMIT),
    promptHash: hashTraceText(systemPrompt),
    systemPromptPreview: truncateTraceText(systemPrompt),
    memorySummaryPreview: truncateTraceText(input.memoryContext?.summary || '', 5000),
    memoryHistoryCount: input.memoryContext?.history?.length || 0,
    memoryFacts: input.memoryContext?.facts || {},
    memoryStage: input.memoryContext?.state?.stage || '',
    closedSlots: input.memoryContext?.slotSnapshot?.closedSlots || [],
    nextBlockingSlot: input.memoryContext?.slotSnapshot?.nextBlockingSlot || '',
    selectedTraining,
    appliedControls: getVisibleControlState(input.config, input.memoryContext),
    status: 'process',
  };
}

function logAiDecisionTrace(input, patch = {}) {
  if (!input?.traceId) return;
  const base = input.aiDecisionTrace || {};
  const entry = {
    ...base,
    ...patch,
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageType: input.messageType,
  };
  if (entry.rawAiReply) entry.rawAiReply = truncateTraceText(entry.rawAiReply, AI_DECISION_TRACE_SHORT_LIMIT);
  if (entry.finalReply) entry.finalReply = truncateTraceText(entry.finalReply, AI_DECISION_TRACE_SHORT_LIMIT);
  if (entry.sentReply) entry.sentReply = truncateTraceText(entry.sentReply, AI_DECISION_TRACE_SHORT_LIMIT);
  if (entry.error) entry.error = truncateTraceText(entry.error, LOG_TEXT_LIMIT);
  input.aiDecisionTrace = entry;
  logEvent('AI_DECISION_TRACE', entry);
}

async function requestAi(input) {
  if (logMissingConfig('ai.request', input.config, ['ai_key', 'ai_url', 'model'], {
    traceId: input.traceId,
    userId: input.userId,
    chatId: input.chatId,
    updateType: input.updateType || '',
    businessConnectionId: input.businessConnectionId || '',
    messageType: input.messageType,
  })) {
    return null;
  }

  const acquired = await waitForSlot(
    'ai',
    input.chatId,
    input.messageType,
    () => activeAiRequests,
    AI_CONCURRENCY_LIMIT,
    SLOT_WAIT_TIMEOUT_MS
  );

  if (!acquired) {
    logEvent('ERROR', {
      traceId: input.traceId,
      userId: input.userId,
      scope: 'ai.wait_timeout',
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      status: 'error',
      active: activeAiRequests,
      limit: AI_CONCURRENCY_LIMIT,
    });
    return null;
  }

  const messages = buildAiMessages(input);
  const payload = {
    model: input.config.model,
    messages,
    temperature: getCreativityTemperature(input.config.creativity),
  };
  input.aiDecisionTrace = buildAiDecisionTrace(input, payload, messages);

    logEvent('AI_REQUEST', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      model: input.config.model,
      images: input.images.length,
      hasMedia: !!input.hasMedia,
      hasLinkInput: !!input.hasLinkInput,
      text: input.text,
      instructionPreview: truncateLogText(input.config.instruction || ''),
      memoryHistory: input.memoryContext?.history?.length || 0,
      memoryStage: input.memoryContext?.state?.stage ? 'set' : '',
      memoryFacts: Object.keys(input.memoryContext?.facts || {}),
      closedSlots: input.memoryContext?.slotSnapshot?.closedSlots || [],
      nextBlockingSlot: input.memoryContext?.slotSnapshot?.nextBlockingSlot || '',
      shoeContext: !!input.memoryContext?.slotSnapshot?.shoeContext,
      appliedControls: getVisibleControlState(input.config, input.memoryContext),
    tone: input.config.tone,
    responseLength: input.config.response_length,
    creativity: input.config.creativity,
    personaStyle: input.config.persona_style,
    personaAge: input.config.persona_age,
    conversationMode: input.config.conversation_mode,
    mediaBehavior: input.config.media_behavior,
    autoReplyEnabled: parseConfigBoolean(input.config.auto_reply_enabled, true),
    memoryEnabled: parseConfigBoolean(input.config.memory_enabled, true),
    memoryRecentLimit: getConfigMemoryLimit(input.config),
    batchDebounceMs: getConfigBatchDebounceMs(input.config),
    replyMode: normalizeReplyMode(input.config.reply_mode),
    humanTypingMode: normalizeHumanTypingMode(input.config.human_typing_mode),
    managerTakeoverEnabled: parseConfigBoolean(input.config.manager_takeover_enabled, true),
    managerReturnDelayMs: getConfigManagerReturnDelayMs(input.config),
    paymentEnabled: parseConfigBoolean(input.config.payment_enabled, false),
    paymentMethod: input.config.payment_method || '',
    temperature: payload.temperature,
    status: 'process',
  });

  activeAiRequests += 1;
  const startedAt = Date.now();

  try {
    const aiResponse = await httpClient.post(
      `${input.config.ai_url.replace(/\/$/, '')}/chat/completions`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${input.config.ai_key}`,
          'Content-Type': 'application/json',
        },
        timeout: AI_REQUEST_TIMEOUT_MS,
      }
    );

    const reply = extractAiReply(aiResponse.data?.choices?.[0]?.message?.content);
    if (typeof reply !== 'string' || !reply.trim()) {
      logAiDecisionTrace(input, {
        status: 'error',
        error: 'AI returned empty or invalid reply',
        duration: Date.now() - startedAt,
      });
      logEvent('ERROR', {
        traceId: input.traceId,
        userId: input.userId,
        scope: 'ai.reply',
        chatId: input.chatId,
        updateType: input.updateType || '',
        businessConnectionId: input.businessConnectionId || '',
        messageType: input.messageType,
        status: 'error',
        message: 'AI returned empty or invalid reply',
      });
      return null;
    }

    input.aiDecisionTrace = {
      ...input.aiDecisionTrace,
      rawAiReply: reply,
      duration: Date.now() - startedAt,
      status: 'process',
    };

    logEvent('AI_REPLY', {
      traceId: input.traceId,
      userId: input.userId,
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      duration: Date.now() - startedAt,
      replyText: reply,
      status: 'ok',
    });
    return reply;
  } catch (e) {
    logAiDecisionTrace(input, {
      status: 'error',
      error: e.message,
      duration: Date.now() - startedAt,
    });
    logEvent('ERROR', {
      traceId: input.traceId,
      userId: input.userId,
      scope: isRateLimitError(e)
        ? 'ai.rate_limit'
        : isTimeoutError(e)
          ? 'ai.timeout'
          : 'ai.request',
      chatId: input.chatId,
      updateType: input.updateType || '',
      businessConnectionId: input.businessConnectionId || '',
      messageType: input.messageType,
      duration: Date.now() - startedAt,
      status: 'error',
      error: e.message,
    });
    return null;
  } finally {
    activeAiRequests -= 1;
  }
}

async function sendTelegramMessage(config, context, text) {
  if (logMissingConfig('telegram.sendMessage', config, ['telegram_token'], {
    traceId: context.traceId,
    userId: context.userId,
    chatId: context.chatId,
    updateType: context.updateType || '',
    businessConnectionId: context.businessConnectionId || '',
    messageType: context.messageType,
  })) {
    context.telegramError = 'Telegram token не настроен';
    return;
  }

  const startedAt = Date.now();
  const replyToMessageId = context.useReply && context.replyToMessageId
    ? context.replyToMessageId
    : '';
  const outgoingText = formatTelegramOutgoingText(text);
  const htmlText = renderTelegramHtml(outgoingText, config);

  try {
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      text: outgoingText,
      status: 'process',
    });
    const payload = {
      chat_id: context.chatId,
      text: htmlText,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    };
    if (context.businessConnectionId) {
      payload.business_connection_id = context.businessConnectionId;
    }
    if (replyToMessageId) {
      payload.reply_to_message_id = replyToMessageId;
    }

    const response = await httpClient.post(getTelegramApiUrl(config, 'sendMessage'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    const result = response.data?.result || null;
    logEvent('TG_SEND', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      replyToMessageId,
      telegramMessageId: result?.message_id || '',
      duration: Date.now() - startedAt,
      status: 'ok',
    });
    return result;
  } catch (e) {
    const telegramError = getTelegramRequestError(e);
    context.telegramError = telegramError.message;
    context.telegramErrorInfo = telegramError;
    if (replyToMessageId) {
      logEvent('ERROR', {
        traceId: context.traceId,
        userId: context.userId,
        scope: 'telegram.sendMessage.reply',
        chatId: context.chatId,
        updateType: context.updateType || '',
        businessConnectionId: context.businessConnectionId || '',
        messageType: context.messageType,
        replyToMessageId,
        duration: Date.now() - startedAt,
        status: 'error',
        error: telegramError.message,
        telegramDescription: telegramError.description,
        telegramErrorCode: telegramError.code,
      });

      return sendTelegramMessage(config, { ...context, useReply: false }, text);
    }

    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.sendMessage',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      duration: Date.now() - startedAt,
      status: 'error',
      error: telegramError.message,
      telegramDescription: telegramError.description,
      telegramErrorCode: telegramError.code,
    });
  return null;
  }
}

async function sendTelegramChatAction(config, context, action = 'typing') {
  if (!config.telegram_token) return;

  const payload = {
    chat_id: context.chatId,
    action,
  };
  if (context.businessConnectionId) {
    payload.business_connection_id = context.businessConnectionId;
  }

  try {
    await httpClient.post(getTelegramApiUrl(config, 'sendChatAction'), payload, {
      timeout: REQUEST_TIMEOUT_MS,
    });
    logEvent('TG_ACTION', {
      traceId: context.traceId,
      userId: context.userId,
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      action,
      status: 'ok',
    });
  } catch (e) {
    logEvent('ERROR', {
      traceId: context.traceId,
      userId: context.userId,
      scope: 'telegram.sendChatAction',
      chatId: context.chatId,
      updateType: context.updateType || '',
      businessConnectionId: context.businessConnectionId || '',
      messageType: context.messageType,
      status: 'error',
      error: e.message,
    });
  }
}

function startTypingLoop(config, context) {
  let stopped = false;
  let timer = null;

  const tick = async () => {
    if (stopped) return;
    await sendTelegramChatAction(config, context, 'typing');
    if (!stopped) {
      timer = setTimeout(tick, TYPING_REFRESH_MS);
    }
  };

  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

async function sendHumanizedTelegramReply(config, context, reply) {
  const settled = await waitForPendingOrderReplySettle(context);
  if (!settled) return false;
  const parts = splitReplyForTelegram(reply);
  for (let index = 0; index < parts.length; index += 1) {
    if (hasNewerClientFollowup(context)) return false;
    await sendTelegramChatAction(config, context, 'typing');
    await wait(getHumanTypingDelayMs(parts[index], config));
    if (hasNewerClientFollowup(context)) return false;
    await sendTelegramMessage(config, {
      ...context,
      useReply: index === 0 && !!context.replyToMessageId,
    }, parts[index]);
    if (index < parts.length - 1) {
      await wait(randomBetween(700, 1500));
    }
  }
  return true;
}

function isTruthyStatus(value, patterns) {
  const normalized = String(value || '').trim().toLowerCase();
  return !!normalized && patterns.some((pattern) => pattern.test(normalized));
}

async function setTelegramWebhook(config) {
  if (logMissingConfig('telegram.setWebhook', config, ['telegram_token', 'webhook_url'])) {
    return { ok: false, description: 'Missing telegram_token or webhook_url' };
  }

  try {
    const response = await httpClient.post(getTelegramApiUrl(config, 'setWebhook'), {
      url: config.webhook_url,
      allowed_updates: TELEGRAM_ALLOWED_UPDATES,
    }, {
      timeout: REQUEST_TIMEOUT_MS,
    });

    return {
      ok: !!response.data?.ok,
      description: response.data?.description || '',
    };
  } catch (e) {
    logEvent('ERROR', {
      scope: 'telegram.setWebhook',
      message: e.response?.data?.description || e.message,
    });
    return {
      ok: false,
      description: e.response?.data?.description || e.message,
    };
  }
}

app.get('/login', (req, res) => {
  if (isAuthorized(req)) {
    res.redirect('/');
    return;
  }

  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const login = String(req.body?.login || '');
  const password = String(req.body?.password || '');

  if (!ADMIN_LOGIN || !ADMIN_PASSWORD) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    setAuthCookie(res);
    res.json({ success: true });
    return;
  }

  res.status(401).json({ success: false });
});

app.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  clearAuthCookie(res);
  res.redirect('/login');
});

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/config/status', async (req, res) => {
  const aiControlPreview = buildAiControlPreview(runtimeConfig);
  const status = {
    telegram: runtimeConfig.telegram_token ? 'подключен' : 'нет',
    ai: runtimeConfig.ai_key ? 'подключен' : 'нет',
    stt: runtimeConfig.stt_api_key ? 'подключен' : 'нет',
    model: runtimeConfig.model || '',
    base_url: runtimeConfig.ai_url || '',
    sai_gpt: runtimeConfig.sai_gpt_key ? 'подключен' : 'нет',
    sai_gpt_url: runtimeConfig.sai_gpt_url || 'https://api.openai.com/v1',
    sai_gpt_model: runtimeConfig.sai_gpt_model || 'gpt-4o-mini',
    stt_api_key: runtimeConfig.stt_api_key || '',
    stt_base_url: runtimeConfig.stt_base_url || '',
    stt_model: runtimeConfig.stt_model || 'gpt-4o-mini-transcribe',
    instruction: runtimeConfig.instruction || '',
    core_hot_lead_enabled: parseConfigBoolean(runtimeConfig.core_hot_lead_enabled, true),
    core_published_available_enabled: parseConfigBoolean(runtimeConfig.core_published_available_enabled, true),
    core_no_stock_check_enabled: parseConfigBoolean(runtimeConfig.core_no_stock_check_enabled, true),
    core_no_catalog_return_enabled: parseConfigBoolean(runtimeConfig.core_no_catalog_return_enabled, true),
    core_no_resell_enabled: parseConfigBoolean(runtimeConfig.core_no_resell_enabled, true),
    core_rules_text: runtimeConfig.core_rules_text || '',
    facts_no_invent_enabled: parseConfigBoolean(runtimeConfig.facts_no_invent_enabled, true),
    facts_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_payment_enabled, true),
    facts_no_fake_delivery_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_enabled, true),
    facts_no_fake_discounts_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_discounts_enabled, true),
    facts_no_final_payment_confirm_enabled: parseConfigBoolean(runtimeConfig.facts_no_final_payment_confirm_enabled, true),
    facts_no_fake_delivery_time_enabled: parseConfigBoolean(runtimeConfig.facts_no_fake_delivery_time_enabled, true),
    facts_rules_text: runtimeConfig.facts_rules_text || '',
    smalltalk_enabled: parseConfigBoolean(runtimeConfig.smalltalk_enabled, true),
    smalltalk_style_enabled: parseConfigBoolean(runtimeConfig.smalltalk_style_enabled, true),
    smalltalk_outfit_advice_enabled: parseConfigBoolean(runtimeConfig.smalltalk_outfit_advice_enabled, true),
    smalltalk_weather_enabled: parseConfigBoolean(runtimeConfig.smalltalk_weather_enabled, true),
    smalltalk_soft_product_link_enabled: parseConfigBoolean(runtimeConfig.smalltalk_soft_product_link_enabled, true),
    smalltalk_rules_text: runtimeConfig.smalltalk_rules_text || '',
    order_path_enabled: parseConfigBoolean(runtimeConfig.order_path_enabled, true),
    order_collect_size_enabled: parseConfigBoolean(runtimeConfig.order_collect_size_enabled, true),
    order_collect_insole_enabled: parseConfigBoolean(runtimeConfig.order_collect_insole_enabled, true),
    order_collect_full_name_enabled: parseConfigBoolean(runtimeConfig.order_collect_full_name_enabled, true),
    order_collect_phone_enabled: parseConfigBoolean(runtimeConfig.order_collect_phone_enabled, true),
    order_collect_city_enabled: parseConfigBoolean(runtimeConfig.order_collect_city_enabled, true),
    order_collect_delivery_service_enabled: parseConfigBoolean(runtimeConfig.order_collect_delivery_service_enabled, true),
    order_collect_pickup_enabled: parseConfigBoolean(runtimeConfig.order_collect_pickup_enabled, true),
    order_collect_payment_enabled: parseConfigBoolean(runtimeConfig.order_collect_payment_enabled, true),
    order_collect_receipt_enabled: parseConfigBoolean(runtimeConfig.order_collect_receipt_enabled, true),
    order_step_mode: runtimeConfig.order_step_mode || 'natural',
    order_rules_text: runtimeConfig.order_rules_text || '',
    response_guard_enabled: parseConfigBoolean(runtimeConfig.response_guard_enabled, true),
    response_guard_no_fake_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_fake_payment_enabled, true),
    response_guard_no_repeat_known_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_repeat_known_enabled, true),
    response_guard_human_tone_enabled: parseConfigBoolean(runtimeConfig.response_guard_human_tone_enabled, true),
    response_guard_next_step_enabled: parseConfigBoolean(runtimeConfig.response_guard_next_step_enabled, true),
    response_guard_no_final_payment_enabled: parseConfigBoolean(runtimeConfig.response_guard_no_final_payment_enabled, true),
    response_guard_rules_text: runtimeConfig.response_guard_rules_text || '',
    receipt_check_enabled: parseConfigBoolean(runtimeConfig.receipt_check_enabled, true),
    receipt_check_amount_enabled: parseConfigBoolean(runtimeConfig.receipt_check_amount_enabled, true),
    receipt_check_bank_enabled: parseConfigBoolean(runtimeConfig.receipt_check_bank_enabled, true),
    receipt_check_recipient_enabled: parseConfigBoolean(runtimeConfig.receipt_check_recipient_enabled, true),
    receipt_check_datetime_enabled: parseConfigBoolean(runtimeConfig.receipt_check_datetime_enabled, true),
    receipt_check_mismatch_enabled: parseConfigBoolean(runtimeConfig.receipt_check_mismatch_enabled, true),
    receipt_check_no_final_confirm_enabled: parseConfigBoolean(runtimeConfig.receipt_check_no_final_confirm_enabled, true),
    receipt_check_success_text: runtimeConfig.receipt_check_success_text || '',
    receipt_check_mismatch_text: runtimeConfig.receipt_check_mismatch_text || '',
    receipt_check_rules_text: runtimeConfig.receipt_check_rules_text || '',
    quality_replica_honesty_enabled: parseConfigBoolean(runtimeConfig.quality_replica_honesty_enabled, true),
    quality_no_original_claims_enabled: parseConfigBoolean(runtimeConfig.quality_no_original_claims_enabled, true),
    quality_calm_explanation_enabled: parseConfigBoolean(runtimeConfig.quality_calm_explanation_enabled, true),
    quality_no_extra_photos_enabled: parseConfigBoolean(runtimeConfig.quality_no_extra_photos_enabled, true),
    quality_return_soft_enabled: parseConfigBoolean(runtimeConfig.quality_return_soft_enabled, true),
    quality_return_no_dates_enabled: parseConfigBoolean(runtimeConfig.quality_return_no_dates_enabled, true),
    quality_return_inspect_enabled: parseConfigBoolean(runtimeConfig.quality_return_inspect_enabled, true),
    quality_return_text: runtimeConfig.quality_return_text || DEFAULT_QUALITY_RETURN_TEXT,
    quality_rules_text: runtimeConfig.quality_rules_text || '',
    store_trust_enabled: parseConfigBoolean(runtimeConfig.store_trust_enabled, true),
    store_trust_online_only_enabled: parseConfigBoolean(runtimeConfig.store_trust_online_only_enabled, true),
    store_trust_sadovod_history_enabled: parseConfigBoolean(runtimeConfig.store_trust_sadovod_history_enabled, true),
    store_trust_cost_reason_enabled: parseConfigBoolean(runtimeConfig.store_trust_cost_reason_enabled, true),
    store_trust_no_address_enabled: parseConfigBoolean(runtimeConfig.store_trust_no_address_enabled, true),
    store_trust_safe_purchase_enabled: parseConfigBoolean(runtimeConfig.store_trust_safe_purchase_enabled, true),
    store_trust_text: runtimeConfig.store_trust_text || DEFAULT_STORE_TRUST_TEXT,
    contacts_enabled: parseConfigBoolean(runtimeConfig.contacts_enabled, true),
    contacts_website: runtimeConfig.contacts_website || DEFAULT_CONTACTS_WEBSITE,
    contacts_telegram: runtimeConfig.contacts_telegram || '',
    contacts_manager: runtimeConfig.contacts_manager || '',
    contacts_phone: runtimeConfig.contacts_phone || '',
    contacts_whatsapp: runtimeConfig.contacts_whatsapp || '',
    contacts_instagram_enabled: parseConfigBoolean(runtimeConfig.contacts_instagram_enabled, false),
    contacts_instagram: runtimeConfig.contacts_instagram || '',
    contacts_anti_scam_enabled: parseConfigBoolean(runtimeConfig.contacts_anti_scam_enabled, true),
    contacts_about_text: runtimeConfig.contacts_about_text || '',
    contacts_rules_text: runtimeConfig.contacts_rules_text || '',
    dialog_examples_enabled: parseConfigBoolean(runtimeConfig.dialog_examples_enabled, false),
    dialog_examples_text: runtimeConfig.dialog_examples_text || '',
    tone: runtimeConfig.tone || 'neutral',
    response_length: runtimeConfig.response_length || 'medium',
    creativity: runtimeConfig.creativity || 'balanced',
    persona_style: runtimeConfig.persona_style || 'calm',
    persona_age: runtimeConfig.persona_age || '27',
    conversation_mode: runtimeConfig.conversation_mode || 'retail',
    media_behavior: runtimeConfig.media_behavior || 'answer_from_media',
    auto_reply_enabled: parseConfigBoolean(runtimeConfig.auto_reply_enabled, true),
    memory_enabled: parseConfigBoolean(runtimeConfig.memory_enabled, true),
    memory_recent_limit: getConfigMemoryLimit(runtimeConfig),
    batch_debounce_ms: getConfigBatchDebounceMs(runtimeConfig),
    reply_mode: normalizeReplyMode(runtimeConfig.reply_mode),
    human_typing_mode: normalizeHumanTypingMode(runtimeConfig.human_typing_mode),
    manager_takeover_enabled: parseConfigBoolean(runtimeConfig.manager_takeover_enabled, true),
    manager_return_delay_ms: getConfigManagerReturnDelayMs(runtimeConfig),
    payment_enabled: parseConfigBoolean(runtimeConfig.payment_enabled, false),
    payment_method: runtimeConfig.payment_method || 'card',
    payment_card_number: runtimeConfig.payment_card_number || '',
    payment_recipient_name: runtimeConfig.payment_recipient_name || '',
    payment_bank: runtimeConfig.payment_bank || '',
    payment_comment: runtimeConfig.payment_comment || '',
    payment_style_text: runtimeConfig.payment_style_text || '',
    payment_layout_text: runtimeConfig.payment_layout_text || '',
    payment_bold_mode: runtimeConfig.payment_bold_mode || 'off',
    payment_example_text: runtimeConfig.payment_example_text || '',
    ai_control_context: aiControlPreview.systemPrompt,
    applied_controls: aiControlPreview.appliedControls,
    capabilities: getCapabilitySnapshot(runtimeConfig),
    delivery_rules_enabled: parseConfigBoolean(runtimeConfig.delivery_rules_enabled, true),
    delivery_rules_text: runtimeConfig.delivery_rules_text || '',
    delivery_style_text: runtimeConfig.delivery_style_text || '',
    delivery_layout_text: runtimeConfig.delivery_layout_text || '',
    delivery_bold_mode: runtimeConfig.delivery_bold_mode || 'off',
    delivery_example_text: runtimeConfig.delivery_example_text || '',
    delivery_tracking_enabled: parseConfigBoolean(runtimeConfig.delivery_tracking_enabled, true),
    delivery_tracking_text: runtimeConfig.delivery_tracking_text || DEFAULT_DELIVERY_TRACKING_TEXT,
    followup_master_enabled: parseConfigBoolean(runtimeConfig.followup_master_enabled, false),
    followup_worker_enabled: parseConfigBoolean(runtimeConfig.followup_worker_enabled, false),
    followup_auto_send_enabled: parseConfigBoolean(runtimeConfig.followup_auto_send_enabled, false),
    followup_repeat_sales_enabled: parseConfigBoolean(runtimeConfig.followup_repeat_sales_enabled, false),
    followup_mode: runtimeConfig.followup_mode || 'off',
    followup_quiet_start: runtimeConfig.followup_quiet_start || '22:00',
    followup_quiet_end: runtimeConfig.followup_quiet_end || '10:00',
    followup_min_interval_hours: runtimeConfig.followup_min_interval_hours || '24',
    followup_daily_limit: runtimeConfig.followup_daily_limit || '20',
    followup_repeat_sales_days: runtimeConfig.followup_repeat_sales_days || '30',
    followup_worker_interval_seconds: runtimeConfig.followup_worker_interval_seconds || '300',
    followup_wait_data_enabled: parseConfigBoolean(runtimeConfig.followup_wait_data_enabled, true),
    followup_wait_data_hours: runtimeConfig.followup_wait_data_hours || '2',
    followup_wait_data_max: runtimeConfig.followup_wait_data_max || '2',
    followup_wait_payment_enabled: parseConfigBoolean(runtimeConfig.followup_wait_payment_enabled, true),
    followup_wait_payment_hours: runtimeConfig.followup_wait_payment_hours || '3',
    followup_wait_payment_max: runtimeConfig.followup_wait_payment_max || '2',
    followup_wait_receipt_enabled: parseConfigBoolean(runtimeConfig.followup_wait_receipt_enabled, true),
    followup_wait_receipt_hours: runtimeConfig.followup_wait_receipt_hours || '1',
    followup_wait_receipt_max: runtimeConfig.followup_wait_receipt_max || '1',
    followup_promised_later_enabled: parseConfigBoolean(runtimeConfig.followup_promised_later_enabled, true),
    followup_promised_later_hours: runtimeConfig.followup_promised_later_hours || '4',
    followup_promised_later_max: runtimeConfig.followup_promised_later_max || '2',
    followup_choosing_enabled: parseConfigBoolean(runtimeConfig.followup_choosing_enabled, true),
    followup_choosing_hours: runtimeConfig.followup_choosing_hours || '24',
    followup_choosing_max: runtimeConfig.followup_choosing_max || '1',
    webhook_url: runtimeConfig.webhook_url || '',
    sai: getSaiStatus(),
  };
  let telegramTokenValid = false;
  let aiProviderReachable = false;
  let sttProviderReachable = false;
  let saiGptProviderReachable = false;

  if (runtimeConfig.telegram_token) {
    try {
      await httpClient.get(`https://api.telegram.org/bot${runtimeConfig.telegram_token}/getMe`, {
        timeout: REQUEST_TIMEOUT_MS,
      });
      telegramTokenValid = true;
    } catch (e) {
      status.telegram = e.response?.data?.description || e.message;
    }
  }

  if (runtimeConfig.telegram_token && runtimeConfig.webhook_url) {
    try {
      const response = await httpClient.get(getTelegramApiUrl(runtimeConfig, 'getWebhookInfo'), {
        timeout: REQUEST_TIMEOUT_MS,
      });
      status.webhook = {
        url: response.data?.result?.url || '',
        pending_update_count: response.data?.result?.pending_update_count || 0,
        last_error_date: response.data?.result?.last_error_date || 0,
        last_error_message: response.data?.result?.last_error_message || '',
      };
    } catch (e) {
      status.webhook = {
        url: '',
        pending_update_count: 0,
        last_error_date: Math.floor(Date.now() / 1000),
        last_error_message: e.response?.data?.description || e.message,
      };
    }
  } else {
    status.webhook = {
      url: runtimeConfig.webhook_url || '',
      pending_update_count: 0,
      last_error_date: 0,
      last_error_message: '',
    };
  }

  if (runtimeConfig.ai_key && runtimeConfig.ai_url) {
    try {
      await httpClient.get(`${runtimeConfig.ai_url.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${runtimeConfig.ai_key}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      aiProviderReachable = true;
    } catch (e) {
      status.ai = e.response?.data?.error?.message || e.message;
    }
  }

  if (runtimeConfig.stt_api_key && runtimeConfig.stt_base_url) {
    try {
      await httpClient.get(`${runtimeConfig.stt_base_url.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${runtimeConfig.stt_api_key}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      sttProviderReachable = true;
    } catch (e) {
      status.stt = e.response?.data?.error?.message || e.message;
    }
  }

  if (runtimeConfig.sai_gpt_key && runtimeConfig.sai_gpt_url) {
    try {
      await httpClient.get(`${runtimeConfig.sai_gpt_url.replace(/\/$/, '')}/models`, {
        headers: {
          Authorization: `Bearer ${runtimeConfig.sai_gpt_key}`,
        },
        timeout: REQUEST_TIMEOUT_MS,
      });
      saiGptProviderReachable = true;
    } catch (e) {
      status.sai_gpt = e.response?.data?.error?.message || e.message;
    }
  }

  const telegramHealth = buildTelegramHealth({
    tokenValid: telegramTokenValid,
    webhookInfo: status.webhook,
  });
  const aiHealth = buildAiHealth({
    providerReachable: aiProviderReachable,
  });
  const sttHealth = buildSttHealth({
    providerReachable: sttProviderReachable,
  });
  const saiGptHealth = buildSaiGptHealth({
    providerReachable: saiGptProviderReachable,
  });

  status.telegram_status = telegramHealth.status;
  status.telegram_label = telegramHealth.label;
  status.ai_status = aiHealth.status;
  status.ai_label = aiHealth.label;
  status.stt_status = sttHealth.status;
  status.stt_label = sttHealth.label;
  status.sai_gpt_status = saiGptHealth.status;
  status.sai_gpt_label = saiGptHealth.label;
  status.sai_label = getSaiStatusLabel(status.sai);

  res.json(status);
});

app.get('/config/ai-control-preview', (req, res) => {
  res.json(buildAiControlPreview(getRuntimeSnapshot()));
});

app.get('/logs', (req, res) => {
  const items = filterLogs(getMergedLogs(), req.query || {});
  res.json({ items });
});

app.get('/logs/:traceId', (req, res) => {
  const traceId = String(req.params.traceId || '').trim();
  const items = getMergedLogs()
    .filter((item) => item.traceId === traceId)
    .sort((a, b) => new Date(a.time) - new Date(b.time));

  res.json({
    traceId,
    items,
  });
});

app.get('/training', (req, res) => {
  const items = (trainingStore.items || []).slice(0, MAX_TRAINING_EXAMPLES);
  res.json({
    items,
    promptItems: Math.min(items.filter((item) => item.active !== false).length, TRAINING_PROMPT_EXAMPLES),
    summary: {
      total: items.length,
      active: items.filter((item) => item.active !== false).length,
      disabled: items.filter((item) => item.active === false).length,
      good: items.filter((item) => item.type === 'good').length,
      bad: items.filter((item) => item.type !== 'good').length,
    },
    categories: Object.entries(TRAINING_CATEGORIES).map(([key, meta]) => ({
      key,
      label: meta.label,
      rule: meta.rule,
    })),
  });
});

app.post('/training/preview', (req, res) => {
  const queryText = normalizeTrainingText(req.body?.queryText, 1200);
  const selected = selectTrainingExamples(queryText, null);
  res.json({
    items: selected,
    promptItems: selected.length,
    queryText,
  });
});

app.post('/training/explain', async (req, res) => {
  try {
    const result = await explainTrainingAnswer({
      ...(req.body || {}),
      config: getRuntimeSnapshot(),
    });
    logEvent('TRAINING_EXPLAIN', {
      status: 'ok',
      chatId: req.body?.chatId || '',
      category: result.category,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logEvent('ERROR', {
      scope: 'training.explain',
      status: 'error',
      error: error.message,
    });
    res.status(400).json({ success: false, error: error.message || 'Не удалось разобрать ответ' });
  }
});

app.post('/training/coach', async (req, res) => {
  try {
    const result = await coachTrainingAnswer({
      ...(req.body || {}),
      config: getRuntimeSnapshot(),
    });
    logEvent('TRAINING_COACH', {
      status: 'ok',
      chatId: req.body?.chatId || '',
      category: result.category,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logEvent('ERROR', {
      scope: 'training.coach',
      status: 'error',
      error: error.message,
    });
    res.status(400).json({ success: false, error: error.message || 'Не удалось продолжить обучение' });
  }
});

app.post('/sai-gpt/chat', async (req, res) => {
  try {
    const result = await requestSaiGptChat({
      messages: req.body?.messages || [],
      selectedChatId: sanitizeSaiGptText(req.body?.selectedChatId || '', 120),
    });
    res.json({ success: true, ...result });
  } catch (error) {
    const friendlyError = getSaiGptProviderErrorMessage(error);
    logEvent('ERROR', {
      scope: 'sai_gpt.chat',
      status: 'error',
      httpStatus: error.response?.status || '',
      error: friendlyError,
      providerError: getProviderErrorDetail(error),
    });
    res.status(400).json({ success: false, error: friendlyError });
  }
});

app.get('/sai-gpt/history', (req, res) => {
  res.json({
    success: true,
    messages: (saiGptMemoryStore.messages || []).slice(-SAI_GPT_MEMORY_MAX_MESSAGES),
    pendingAction: describeSaiGptPendingAction(getSaiGptPendingAction()),
  });
});

app.delete('/sai-gpt/history', (req, res) => {
  saiGptMemoryStore = createEmptySaiGptMemoryStore();
  saveSaiGptMemoryStore();
  res.json({ success: true });
});

app.post('/sai-gpt/lesson-draft', async (req, res) => {
  try {
    const draft = await requestSaiGptLessonDraft({
      messages: req.body?.messages || [],
      selectedChatId: sanitizeSaiGptText(req.body?.selectedChatId || '', 120),
    });
    res.json({ success: true, draft });
  } catch (error) {
    const friendlyError = getSaiGptProviderErrorMessage(error);
    logEvent('ERROR', {
      scope: 'sai_gpt.lesson_draft',
      status: 'error',
      httpStatus: error.response?.status || '',
      error: friendlyError,
      providerError: getProviderErrorDetail(error),
    });
    res.status(400).json({ success: false, error: friendlyError });
  }
});

app.post('/training', (req, res) => {
  try {
    const item = addTrainingExample(req.body || {});
    logEvent('TRAINING_EXAMPLE', {
      status: 'ok',
      type: item.type,
      category: item.category,
      chatId: item.chatId,
      id: item.id,
    });
    res.json({ success: true, item });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message || 'Не удалось сохранить урок' });
  }
});

app.patch('/training/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const item = updateTrainingExample(id, req.body || {});
  if (!item) {
    res.status(404).json({ success: false, error: 'Урок не найден' });
    return;
  }
  logEvent('TRAINING_EXAMPLE_UPDATE', {
    status: 'ok',
    type: item.type,
    category: item.category,
    active: item.active !== false,
    id: item.id,
  });
  res.json({ success: true, item });
});

app.delete('/training/:id', (req, res) => {
  const id = String(req.params.id || '').trim();
  const before = trainingStore.items.length;
  trainingStore.items = trainingStore.items.filter((item) => item.id !== id);
  if (trainingStore.items.length !== before) saveTrainingStore();
  res.json({ success: true });
});

app.get('/media/telegram/:fileId', async (req, res) => {
  const fileId = String(req.params.fileId || '').trim();
  if (!fileId) {
    res.status(400).send('Missing file id');
    return;
  }
  try {
    const fileUrl = await getTelegramFileUrl(getRuntimeSnapshot(), 'media', 'media', fileId);
    if (!fileUrl) {
      res.status(404).send('File not found');
      return;
    }
    const response = await axios.get(fileUrl, {
      responseType: 'stream',
      timeout: REQUEST_TIMEOUT_MS,
    });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    response.data.pipe(res);
  } catch (error) {
    logEvent('ERROR', {
      scope: 'telegram.media.proxy',
      status: 'error',
      error: error.message,
    });
    res.status(502).send('Could not load Telegram media');
  }
});

function parseMoneyAmount(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  const match = raw.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return 0;
  return Number(match[1].replace(',', '.')) || 0;
}

function formatMoneyAmount(value) {
  const amount = Math.round(Number(value) || 0);
  if (!amount) return '0 ₽';
  return `${new Intl.NumberFormat('ru-RU').format(amount)} ₽`;
}

function hoursBetweenNow(dateValue) {
  const date = dateValue ? new Date(dateValue) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return Math.max(0, (Date.now() - date.getTime()) / 3600000);
}

function getLastMessageByRole(messages = [], roles = []) {
  const allowed = new Set(roles);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (allowed.has(messages[index]?.role)) return messages[index];
  }
  return null;
}

function isConfirmedOrder(order = {}) {
  const values = [
    order.status,
    order.paymentStatus,
    order.paymentCheckStatus,
  ].map((value) => String(value || '').toLowerCase());
  return values.some((value) => /paid|confirmed|оплачен|подтвержден|подтверждён|shipped|done|completed/.test(value));
}

function isPaidOrProofReceivedOrder(order = {}) {
  if (isConfirmedOrder(order)) return true;
  const values = [
    order.status,
    order.paymentStatus,
    order.paymentCheckStatus,
  ].map((value) => String(value || '').toLowerCase());
  return Boolean(order.proofReceivedAt) || values.some((value) => /proof_received|waiting_payment_check|check_received|receipt/.test(value));
}

function buildInboxMoneyStats(orders = []) {
  const confirmedOrders = orders.filter(isPaidOrProofReceivedOrder);
  const confirmedSpend = confirmedOrders.reduce((sum, order) => sum + parseMoneyAmount(order.price), 0);
  const potentialSpend = orders.reduce((sum, order) => sum + parseMoneyAmount(order.price), 0);
  return {
    ordersCount: orders.length,
    confirmedOrdersCount: confirmedOrders.length,
    confirmedSpend,
    confirmedSpendLabel: formatMoneyAmount(confirmedSpend),
    potentialSpend,
    potentialSpendLabel: formatMoneyAmount(potentialSpend),
    averageCheck: confirmedOrders.length ? Math.round(confirmedSpend / confirmedOrders.length) : 0,
    averageCheckLabel: confirmedOrders.length ? formatMoneyAmount(confirmedSpend / confirmedOrders.length) : '0 ₽',
  };
}

function getInboxRuleConfig(statusKey, config = runtimeConfig) {
  const map = {
    waiting_data: ['followup_wait_data_enabled', 'followup_wait_data_hours', 'followup_wait_data_max'],
    waiting_payment: ['followup_wait_payment_enabled', 'followup_wait_payment_hours', 'followup_wait_payment_max'],
    waiting_receipt: ['followup_wait_receipt_enabled', 'followup_wait_receipt_hours', 'followup_wait_receipt_max'],
    promised_later: ['followup_promised_later_enabled', 'followup_promised_later_hours', 'followup_promised_later_max'],
    choosing: ['followup_choosing_enabled', 'followup_choosing_hours', 'followup_choosing_max'],
  };
  const keys = map[statusKey];
  if (!keys) return null;
  return {
    enabled: parseConfigBoolean(config[keys[0]], true),
    hours: Math.max(0.25, Number(config[keys[1]]) || 1),
    maxTouches: Math.max(1, Number(config[keys[2]]) || 1),
  };
}

function detectInboxStatus(profile = {}) {
  const messages = Array.isArray(profile.recentMessages) ? profile.recentMessages : [];
  const lastClient = getLastMessageByRole(messages, ['user']);
  const lastAny = messages[messages.length - 1] || null;
  const lastText = String(lastClient?.text || lastAny?.text || '').toLowerCase();
  const stateStage = String(profile.state?.stage || '').toLowerCase();
  const aiMode = String(profile.state?.aiMode || '').toLowerCase();
  const order = profile.lastOrder || {};
  const orderStatus = String(order.status || '').toLowerCase();
  const paymentStatus = String(order.paymentStatus || '').toLowerCase();
  const checkStatus = String(order.paymentCheckStatus || '').toLowerCase();

  if (aiMode === 'passive_manager') {
    return { key: 'manager', label: 'Вручную', tone: 'neutral', reason: 'менеджер ведёт диалог' };
  }
  if (/не актуально|передумал|отмена|не надо|откажусь|отказ/.test(lastText)) {
    return { key: 'closed', label: 'Закрыт', tone: 'muted', reason: 'клиент отказался или отложил без продолжения' };
  }
  if (isConfirmedOrder(order)) {
    return { key: 'paid', label: 'Оплачен', tone: 'good', reason: 'есть признаки подтверждённого заказа' };
  }
  if (order.proofReceivedAt || /proof_received|waiting_payment_check|check_received|receipt/.test(checkStatus)) {
    return { key: 'waiting_receipt', label: 'Чек на проверке', tone: 'warn', reason: 'чек получен, нужна ручная сверка' };
  }
  if (/через час|позже|вечером|завтра|оплачу|напишу|вернусь|подумаю|определюсь|пока думаю/.test(lastText)) {
    return { key: 'promised_later', label: 'Обещал вернуться', tone: 'warn', reason: 'клиент обещал написать/оплатить позже' };
  }
  if (/waiting_payment|payment_details_sent/.test(`${orderStatus} ${paymentStatus}`)) {
    return { key: 'waiting_payment', label: 'Ждём оплату', tone: 'hot', reason: 'реквизиты уже отправлены' };
  }
  if (/collecting|ready_to_buy|draft|order/.test(`${stateStage} ${orderStatus}`)) {
    return { key: 'waiting_data', label: 'Ждём данные', tone: 'hot', reason: 'заказ начат, не хватает данных' };
  }
  if (lastClient) {
    return { key: 'choosing', label: 'Выбирает', tone: 'neutral', reason: 'клиент интересовался товаром' };
  }
  return { key: 'new', label: 'Новый', tone: 'neutral', reason: 'диалог только появился' };
}

function buildInboxDraft(profile = {}, status = {}) {
  const facts = profile.facts || {};
  const order = profile.lastOrder || {};
  const name = facts.firstName?.value || profile.customer?.firstName || '';
  const product = order.product ? `по ${order.product}` : 'по заказу';
  const appeal = name ? `${name}, ` : '';
  if (status.key === 'waiting_payment') {
    return `${appeal}подскажите, пожалуйста, получилось оплатить ${product}? Если удобно, пришлите чек — я сразу передам на проверку.`;
  }
  if (status.key === 'waiting_data') {
    return `${appeal}чтобы спокойно оформить заказ, пришлите, пожалуйста, ФИО, телефон и удобный пункт выдачи. Доставка у нас бесплатная.`;
  }
  if (status.key === 'waiting_receipt') {
    return `${appeal}чек получил, спасибо. Передал на проверку, как сверим — напишу по заказу.`;
  }
  if (status.key === 'promised_later') {
    return `${appeal}напомню аккуратно ${product}. Если ещё актуально — я на связи, быстро оформим.`;
  }
  if (status.key === 'choosing') {
    return `${appeal}если по модели остались вопросы — пишите, помогу спокойно определиться.`;
  }
  return '';
}

function buildInboxFollowup(profile = {}, status = {}, config = runtimeConfig) {
  const masterEnabled = parseConfigBoolean(config.followup_master_enabled, false);
  const mode = ['off', 'drafts', 'auto'].includes(config.followup_mode) ? config.followup_mode : 'off';
  const rule = getInboxRuleConfig(status.key, config);
  const messages = Array.isArray(profile.recentMessages) ? profile.recentMessages : [];
  const lastClient = getLastMessageByRole(messages, ['user']);
  const lastOutgoing = getLastMessageByRole(messages, ['assistant', 'manager']);
  const anchorTime = lastClient?.createdAt || profile.customer?.lastSeenAt || profile.customer?.updatedAt || '';
  const idleHours = hoursBetweenNow(anchorTime);
  const lastOutgoingHours = hoursBetweenNow(lastOutgoing?.createdAt);
  const minInterval = Math.max(0, parseConfigNumber(config.followup_min_interval_hours, 24));
  const blocked = [];

  if (!masterEnabled) blocked.push('главный тумблер автоматики выключен');
  if (mode === 'off') blocked.push('режим follow-up выключен');
  if (!rule) blocked.push('для этого статуса нет правила');
  if (rule && !rule.enabled) blocked.push('правило для статуса выключено');
  if (lastOutgoingHours !== null && lastOutgoingHours < minInterval) blocked.push(`последнее исходящее было ${lastOutgoingHours.toFixed(1)} ч назад`);

  const dueByTime = Boolean(rule && idleHours !== null && idleHours >= rule.hours);
  const canPrepare = rule?.enabled && dueByTime && !blocked.length;
  const needsAttention = dueByTime || ['waiting_payment', 'waiting_data', 'promised_later', 'waiting_receipt'].includes(status.key);
  const draft = buildInboxDraft(profile, status);

  return {
    masterEnabled,
    mode,
    rule,
    idleHours,
    idleLabel: idleHours === null ? 'нет данных' : `${idleHours.toFixed(1)} ч`,
    dueByTime,
    needsAttention,
    canPrepare,
    canSendAuto: canPrepare && mode === 'auto',
    draft: canPrepare || needsAttention ? draft : '',
    blocked,
    quietHours: {
      start: config.followup_quiet_start || '22:00',
      end: config.followup_quiet_end || '10:00',
    },
  };
}

function getFollowupMode(config = runtimeConfig) {
  return ['off', 'drafts', 'auto'].includes(config.followup_mode) ? config.followup_mode : 'off';
}

function getLastClientAndOutgoing(profile = {}) {
  const messages = Array.isArray(profile.recentMessages) ? profile.recentMessages : [];
  return {
    lastClient: getLastMessageByRole(messages, ['user']),
    lastOutgoing: getLastMessageByRole(messages, ['assistant', 'manager']),
  };
}

function isWithinQuietHours(config = runtimeConfig, now = new Date()) {
  const toMinutes = (value, fallback) => {
    const match = String(value || fallback).match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return toMinutes(fallback, '00:00');
    return Math.max(0, Math.min(1439, Number(match[1]) * 60 + Number(match[2])));
  };
  const start = toMinutes(config.followup_quiet_start, '22:00');
  const end = toMinutes(config.followup_quiet_end, '10:00');
  const current = now.getHours() * 60 + now.getMinutes();
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function addHoursIso(dateValue, hours) {
  const base = dateValue ? new Date(dateValue) : new Date();
  const safeBase = Number.isNaN(base.getTime()) ? new Date() : base;
  return new Date(safeBase.getTime() + (Number(hours) || 0) * 3600000).toISOString();
}

function shouldOfferRepeatSale(profile = {}, config = runtimeConfig) {
  if (!parseConfigBoolean(config.followup_repeat_sales_enabled, false)) return false;
  const money = buildInboxMoneyStats(profile.orders || []);
  if (!money.confirmedOrdersCount) return false;
  const status = detectInboxStatus(profile);
  if (!['paid', 'closed', 'new'].includes(status.key)) return false;
  const messages = Array.isArray(profile.recentMessages) ? profile.recentMessages : [];
  const lastAny = messages[messages.length - 1] || null;
  const idleHours = hoursBetweenNow(lastAny?.createdAt || profile.customer?.lastSeenAt);
  const days = Math.max(1, Number(config.followup_repeat_sales_days) || 30);
  return idleHours !== null && idleHours >= days * 24;
}

function buildRepeatSaleStatus(profile = {}, config = runtimeConfig) {
  const days = Math.max(1, Number(config.followup_repeat_sales_days) || 30);
  return {
    key: 'repeat_sale',
    label: 'Повторная продажа',
    tone: 'good',
    reason: `клиент уже покупал, можно мягко предложить новинки через ${days} дн.`,
  };
}

function buildRepeatSaleDraft(profile = {}) {
  const facts = profile.facts || {};
  const order = profile.lastOrder || {};
  const name = facts.firstName?.value || profile.customer?.firstName || '';
  const size = facts.shoeSize?.value || order.size || '';
  const appeal = name ? `${name}, ` : '';
  const sizeText = size ? `в вашем размере ${size}` : 'под ваш размер';
  return `${appeal}если актуально, могу показать свежие варианты ${sizeText}. По стилю подберу близко к тому, что вы уже смотрели/брали.`;
}

function buildFollowupDraft(profile = {}, status = {}, kind = 'order_followup') {
  if (kind === 'repeat_sale' || status.key === 'repeat_sale') return buildRepeatSaleDraft(profile);
  return buildInboxDraft(profile, status);
}

function buildFollowupJobCandidate(profile = {}, config = runtimeConfig) {
  let status = detectInboxStatus(profile);
  let kind = 'order_followup';
  let rule = getInboxRuleConfig(status.key, config);
  const followup = buildInboxFollowup(profile, status, config);

  if ((!rule || !followup.dueByTime) && shouldOfferRepeatSale(profile, config)) {
    status = buildRepeatSaleStatus(profile, config);
    kind = 'repeat_sale';
    rule = {
      enabled: true,
      hours: Math.max(1, Number(config.followup_repeat_sales_days) || 30) * 24,
      maxTouches: 1,
    };
  }

  const { lastClient, lastOutgoing } = getLastClientAndOutgoing(profile);
  const anchorTime = lastClient?.createdAt || profile.customer?.lastSeenAt || profile.customer?.updatedAt || '';
  const dueAt = addHoursIso(anchorTime, rule?.hours || 1);
  const draftText = buildFollowupDraft(profile, status, kind);

  return {
    profile,
    status,
    kind,
    rule,
    followup: buildInboxFollowup(profile, status, config),
    draftText,
    dueAt,
    lastClient,
    lastOutgoing,
  };
}

function buildFollowupSafety(candidate = {}, config = runtimeConfig, job = null, action = 'prepare') {
  const blocked = [];
  const mode = getFollowupMode(config);
  const manualPrepare = action === 'manual_prepare';
  const statusKey = candidate.status?.key || '';
  const rule = candidate.rule || getInboxRuleConfig(statusKey, config);
  const lastOutgoingHours = hoursBetweenNow(candidate.lastOutgoing?.createdAt);
  const minInterval = Math.max(0, parseConfigNumber(config.followup_min_interval_hours, 24));
  const profile = candidate.profile || {};

  if (!parseConfigBoolean(config.followup_master_enabled, false)) blocked.push('главный тумблер выключен');
  if (!manualPrepare && !parseConfigBoolean(config.followup_worker_enabled, false)) blocked.push('автоматика Inbox выключена');
  if (mode === 'off') blocked.push('режим follow-up выключен');
  if (action === 'auto_send' && !parseConfigBoolean(config.followup_auto_send_enabled, false)) blocked.push('автоотправка выключена отдельным тумблером');
  if (!rule) blocked.push('для статуса нет правила');
  if (rule && !rule.enabled) blocked.push('правило статуса выключено');
  if (profile.state?.aiMode === 'passive_manager') blocked.push('диалог ведёт менеджер вручную');
  if (['paid', 'closed', 'manager', 'new'].includes(statusKey) && candidate.kind !== 'repeat_sale') blocked.push('статус не требует напоминания');
  if (!candidate.draftText) blocked.push('нет текста черновика');
  if (lastOutgoingHours !== null && lastOutgoingHours < minInterval) blocked.push(`последнее исходящее было ${lastOutgoingHours.toFixed(1)} ч назад`);
  if (action === 'auto_send' && isWithinQuietHours(config)) blocked.push('сейчас тихие часы');
  if (action === 'auto_send') {
    const today = new Date().toISOString().slice(0, 10);
    const sentToday = (safeCustomerStoreCall('followup.jobs.daily_limit', (store) => store.listFollowupJobs({ limit: 500 })) || [])
      .filter((item) => String(item.sentAt || '').startsWith(today)).length;
    const dailyLimit = Math.max(1, Number(config.followup_daily_limit) || 20);
    if (sentToday >= dailyLimit) blocked.push(`дневной лимит ${dailyLimit} уже достигнут`);
  }
  if (job?.lastClientMessageAt && candidate.lastClient?.createdAt && job.lastClientMessageAt !== candidate.lastClient.createdAt) {
    blocked.push('клиент уже ответил после создания черновика');
  }
  if (job && Number(job.attempts || 0) >= Math.max(1, Number(job.maxAttempts || rule?.maxTouches) || 1)) {
    blocked.push('лимит касаний исчерпан');
  }

  return {
    ok: blocked.length === 0,
    blocked,
    mode,
    rule,
  };
}

async function generateFollowupDraftWithAi(candidate = {}, config = runtimeConfig) {
  const fallback = candidate.draftText || buildFollowupDraft(candidate.profile, candidate.status, candidate.kind);
  if (!config.ai_key || !config.ai_url || !config.model) return fallback;

  const profile = candidate.profile || {};
  const money = buildInboxMoneyStats(profile.orders || []);
  const messages = (profile.recentMessages || []).slice(-8).map((message) => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: message.text,
  }));
  const facts = profile.facts || {};
  const order = profile.lastOrder || {};
  const prompt = [
    'Сгенерируй один короткий follow-up для клиента IWAK.',
    'Это НЕ массовая рассылка. Пиши как живой менеджер, мягко, без давления.',
    'Не выдумывай товары, цены, скидки, сроки, реквизиты.',
    'Если это повторная продажа — предложи показать варианты под размер/стиль, без конкретных моделей.',
    'Если это незавершенный заказ — дай один понятный следующий шаг.',
    'Не пиши ночью, не упоминай автоматику и AI.',
    '',
    `Статус: ${candidate.status?.label || candidate.status?.key || '—'}`,
    `Причина: ${candidate.status?.reason || ''}`,
    `Имя: ${facts.firstName?.value || profile.customer?.firstName || ''}`,
    `Размер: ${facts.shoeSize?.value || order.size || ''}`,
    `Последний товар: ${facts.lastProduct?.value || order.product || ''}`,
    `Потратил: ${money.confirmedSpendLabel}`,
    `Заказов: ${money.confirmedOrdersCount}`,
  ].filter(Boolean).join('\n');

  const reply = await requestAi({
    traceId: createTraceId(),
    chatId: `followup:${profile.customer?.chatId || 'unknown'}`,
    userId: 'followup',
    messageType: 'followup_draft',
    updateType: 'followup',
    text: prompt,
    images: [],
    hasMedia: false,
    hasLinkInput: false,
    config,
    memoryContext: {
      summary: profile.summary || '',
      history: messages,
      facts,
      state: profile.state || null,
    },
  });

  return normalizeMemoryText(finalizeAiReply({ messageType: 'followup_draft', config }, reply || '') || fallback).slice(0, 900);
}

async function prepareFollowupJob(profile = {}, config = runtimeConfig, options = {}) {
  const candidate = buildFollowupJobCandidate(profile, config);
  const chatId = profile.customer?.chatId || '';
  const existing = safeCustomerStoreCall('followup.job.get_open', (store) => store.getOpenFollowupJobByChat(chatId));
  const action = options.manualRun === true ? 'manual_prepare' : 'prepare';
  const safety = buildFollowupSafety(candidate, config, existing, action);
  const shouldForce = options.force === true;
  const dueTimeReached = !candidate.dueAt || new Date(candidate.dueAt).getTime() <= Date.now();
  const existingIsFresh = existing?.draftText
    && existing.lastClientMessageAt
    && candidate.lastClient?.createdAt
    && existing.lastClientMessageAt === candidate.lastClient.createdAt;
  if (!shouldForce && existingIsFresh) {
    return { job: existing, candidate, safety, created: false };
  }
  if (!shouldForce && (!safety.ok || !dueTimeReached)) {
    return { job: existing, candidate, safety, created: false };
  }

  const draftText = await generateFollowupDraftWithAi(candidate, config);
  const job = safeCustomerStoreCall('followup.job.upsert', (store) => store.upsertFollowupJob({
    id: existing?.id,
    chatId,
    userId: profile.customer?.userId || chatId,
    kind: candidate.kind,
    statusKey: candidate.status.key,
    statusLabel: candidate.status.label,
    mode: getFollowupMode(config),
    state: safety.ok ? 'ready' : 'blocked',
    draftText,
    reason: candidate.status.reason || '',
    dueAt: candidate.dueAt,
    attempts: existing?.attempts || 0,
    maxAttempts: candidate.rule?.maxTouches || existing?.maxAttempts || 1,
    lastClientMessageAt: candidate.lastClient?.createdAt || '',
    lastOutgoingMessageAt: candidate.lastOutgoing?.createdAt || '',
    safety,
  }));

  safeCustomerStoreCall('followup.event.prepare', (store) => store.insertFollowupEvent({
    jobId: job?.id,
    customerId: job?.customerId,
    chatId,
    event: safety.ok ? 'DRAFT_READY' : 'DRAFT_BLOCKED',
    message: draftText,
    metadata: { statusKey: candidate.status.key, blocked: safety.blocked },
  }));
  logEvent(safety.ok ? 'FOLLOWUP_DRAFT_READY' : 'FOLLOWUP_DRAFT_BLOCKED', {
    chatId,
    jobId: job?.id || '',
    statusKey: candidate.status.key,
    blocked: safety.blocked,
    status: safety.ok ? 'ok' : 'process',
  });
  return { job, candidate, safety, created: true };
}

async function sendFollowupJob(jobId, options = {}) {
  const config = getRuntimeSnapshot();
  const job = safeCustomerStoreCall('followup.job.get', (store) => store.getFollowupJob(jobId));
  if (!job) return { ok: false, error: 'Черновик не найден' };
  const profile = safeCustomerStoreCall('followup.profile.get', (store) => store.getCustomerProfile(job.chatId));
  if (!profile) return { ok: false, error: 'Клиент не найден' };

  const candidate = buildFollowupJobCandidate(profile, config);
  candidate.draftText = job.draftText || candidate.draftText;
  const action = options.auto ? 'auto_send' : 'manual_send';
  const safety = buildFollowupSafety(candidate, config, job, action);
  if (!safety.ok && !options.forceManual) {
    safeCustomerStoreCall('followup.event.blocked_send', (store) => store.insertFollowupEvent({
      jobId: job.id,
      customerId: job.customerId,
      chatId: job.chatId,
      event: 'SEND_BLOCKED',
      message: safety.blocked.join(' · '),
      metadata: safety,
    }));
    return { ok: false, error: safety.blocked.join(' · '), safety };
  }

  const connection = getBusinessConnectionForFollowupChat(job.chatId);
  const context = {
    traceId: createTraceId(),
    chatId: job.chatId,
    userId: profile.customer?.userId || job.chatId,
    updateType: 'followup',
    messageType: 'followup',
    businessConnectionId: connection?.id || '',
    useReply: false,
  };
  const sent = await sendTelegramMessage(config, context, job.draftText);
  if (!sent) {
    const telegramError = context.telegramErrorInfo || { message: context.telegramError || '' };
    const friendlyError = getFollowupTelegramErrorMessage(telegramError, context);
    safeCustomerStoreCall('followup.event.telegram_failed', (store) => store.insertFollowupEvent({
      jobId: job.id,
      customerId: job.customerId,
      chatId: job.chatId,
      event: 'SEND_FAILED',
      message: friendlyError,
      metadata: {
        telegramError,
        businessConnectionId: context.businessConnectionId || '',
      },
    }));
    return {
      ok: false,
      error: friendlyError,
      reason: isTelegramInitiationForbidden(telegramError)
        ? 'telegram_business_connection_required'
        : 'telegram_send_failed',
      businessConnectionRequired: isTelegramInitiationForbidden(telegramError) || !context.businessConnectionId,
    };
  }

  appendMemoryMessage(context, 'assistant', job.draftText);
  const updated = safeCustomerStoreCall('followup.job.sent', (store) => store.upsertFollowupJob({
    ...job,
    chatId: job.chatId,
    userId: profile.customer?.userId || job.chatId,
    state: 'sent',
    sentAt: new Date().toISOString(),
    attempts: Number(job.attempts || 0) + 1,
    safety,
  }));
  safeCustomerStoreCall('followup.event.sent', (store) => store.insertFollowupEvent({
    jobId: job.id,
    customerId: job.customerId,
    chatId: job.chatId,
    event: options.auto ? 'AUTO_SENT' : 'MANUAL_SENT',
    message: job.draftText,
    metadata: { telegramMessageId: sent.message_id || '', businessConnectionId: context.businessConnectionId },
  }));
  logEvent(options.auto ? 'FOLLOWUP_AUTO_SENT' : 'FOLLOWUP_MANUAL_SENT', {
    chatId: job.chatId,
    jobId: job.id,
    telegramMessageId: sent.message_id || '',
    status: 'ok',
  });
  return { ok: true, job: updated || job, telegramMessageId: sent.message_id || '' };
}

async function runFollowupWorker(options = {}) {
  const config = getRuntimeSnapshot();
  const startedAt = Date.now();
  const result = { scanned: 0, created: 0, sent: 0, blocked: 0, skipped: 0 };
  const manualRun = options.manualRun === true;
  if (!parseConfigBoolean(config.followup_master_enabled, false)) {
    return { ...result, disabled: true };
  }
  if (!manualRun && !parseConfigBoolean(config.followup_worker_enabled, false)) {
    return { ...result, disabled: true };
  }
  const mode = getFollowupMode(config);
  if (mode === 'off') return { ...result, disabled: true };

  const profiles = safeCustomerStoreCall('followup.worker.inbox', (store) => store.getInboxCustomers({ limit: 300 })) || [];
  const dailyLimit = Math.max(1, Number(config.followup_daily_limit) || 20);
  for (const profile of profiles) {
    if (!manualRun && result.created >= dailyLimit) {
      result.skipped += 1;
      break;
    }
    result.scanned += 1;
    try {
      const prepared = await prepareFollowupJob(profile, config, {
        force: options.forceDrafts === true,
        manualRun,
      });
      if (prepared.created) result.created += 1;
      if (!prepared.safety?.ok) {
        result.blocked += 1;
        continue;
      }
      if (mode === 'auto' && parseConfigBoolean(config.followup_auto_send_enabled, false) && prepared.job?.id) {
        const sent = await sendFollowupJob(prepared.job.id, { auto: true });
        if (sent.ok) result.sent += 1;
        else result.blocked += 1;
      }
    } catch (error) {
      result.blocked += 1;
      logEvent('ERROR', {
        scope: 'followup.worker.profile',
        chatId: profile.customer?.chatId || '',
        status: 'error',
        error: error.message,
      });
    }
  }

  logEvent('FOLLOWUP_WORKER_RUN', {
    ...result,
    duration: Date.now() - startedAt,
    status: 'ok',
  });
  return result;
}

function buildInboxPayload(limit, messageLimit = 1000) {
  const rows = safeCustomerStoreCall('customer.inbox.list', (store) => store.getInboxCustomers({ limit, messageLimit })) || [];
  const items = rows.map((profile) => {
    const status = detectInboxStatus(profile);
    const money = buildInboxMoneyStats(profile.orders || []);
    const followup = buildInboxFollowup(profile, status);
    const followupJob = safeCustomerStoreCall('followup.job.open', (store) => store.getOpenFollowupJobByChat(profile.customer?.chatId || ''));
    const lastMessage = (profile.recentMessages || [])[profile.recentMessages.length - 1] || null;
    return {
      ...profile,
      status,
      money,
      followup,
      followupJob,
      lastMessage,
    };
  });
  const summary = items.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status?.key || 'unknown'] = (acc[item.status?.key || 'unknown'] || 0) + 1;
    if (item.followup?.needsAttention) acc.needsAttention += 1;
    return acc;
  }, { total: 0, needsAttention: 0 });
  return { items, summary };
}

function startFollowupWorkerLoop() {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    runFollowupWorker().catch((error) => {
      logEvent('ERROR', {
        scope: 'followup.worker.loop',
        status: 'error',
        error: error.message,
      });
    }).finally(() => {
      if (stopped) return;
      const intervalSeconds = Math.max(60, Math.min(3600, Number(runtimeConfig.followup_worker_interval_seconds) || 300));
      const timer = setTimeout(tick, intervalSeconds * 1000);
      if (typeof timer.unref === 'function') timer.unref();
    });
  };
  const firstTimer = setTimeout(tick, 10000);
  if (typeof firstTimer.unref === 'function') firstTimer.unref();
  return () => {
    stopped = true;
    clearTimeout(firstTimer);
  };
}

app.get('/inbox', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const messageLimit = Math.max(50, Math.min(2000, Number(req.query.messageLimit) || 1000));
  res.json(buildInboxPayload(limit, messageLimit));
});

app.get('/followups', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 100));
  const jobs = safeCustomerStoreCall('followup.jobs.list', (store) => store.listFollowupJobs({ limit })) || [];
  res.json({ jobs });
});

app.post('/followups/run', async (req, res) => {
  const result = await runFollowupWorker({
    forceDrafts: req.body?.forceDrafts === true,
    manualRun: req.body?.manualRun === true,
  });
  res.json({ ok: true, result });
});

app.post('/followups/generate', async (req, res) => {
  const chatId = String(req.body?.chatId || '').trim();
  if (!chatId) {
    res.status(400).json({ ok: false, error: 'chatId is required' });
    return;
  }
  const config = getRuntimeSnapshot();
  const profile = safeCustomerStoreCall('followup.profile.generate', (store) => store.getCustomerProfile(chatId));
  if (!profile) {
    res.status(404).json({ ok: false, error: 'Клиент не найден' });
    return;
  }
  const prepared = await prepareFollowupJob(profile, config, { force: true, manualRun: true });
  res.json({ ok: !!prepared.job, job: prepared.job, safety: prepared.safety });
});

app.post('/followups/:id/send', async (req, res) => {
  const id = Number(req.params.id) || 0;
  const result = await sendFollowupJob(id, { forceManual: req.body?.forceManual === true });
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/followups/:id/skip', (req, res) => {
  const id = Number(req.params.id) || 0;
  const job = safeCustomerStoreCall('followup.job.get_skip', (store) => store.getFollowupJob(id));
  if (!job) {
    res.status(404).json({ ok: false, error: 'Черновик не найден' });
    return;
  }
  const updated = safeCustomerStoreCall('followup.job.skip', (store) => store.upsertFollowupJob({
    ...job,
    chatId: job.chatId,
    state: 'skipped',
    skippedAt: new Date().toISOString(),
  }));
  safeCustomerStoreCall('followup.event.skip', (store) => store.insertFollowupEvent({
    jobId: job.id,
    customerId: job.customerId,
    chatId: job.chatId,
    event: 'SKIPPED',
    message: req.body?.reason || 'Пропущено вручную',
  }));
  res.json({ ok: true, job: updated });
});

app.get('/memory/:chatId', (req, res) => {
  const chatId = String(req.params.chatId || '').trim();
  const profile = safeCustomerStoreCall('customer.profile.get', (store) => store.getCustomerProfile(chatId));
  if (profile) {
    res.json({
      chatId,
      customer: profile.customer,
      facts: profile.facts || {},
      state: profile.state || null,
      lastOrder: profile.lastOrder || null,
      recentMessages: profile.recentMessages || [],
    });
    return;
  }
  const context = buildMemoryContext(chatId);
  res.json({
    chatId,
    facts: context.facts || {},
    state: context.state || null,
    recentMessages: getRecentMemoryMessages(chatId),
  });
});

app.delete('/memory/:chatId', (req, res) => {
  const chatId = String(req.params.chatId || '').trim();
  const ok = clearMemoryForChat(chatId);
  res.json({ ok });
});

app.delete('/logs', (req, res) => {
  runtimeLogs.length = 0;
  fs.writeFileSync(LOG_FILE_PATH, '');
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    markSaiRuntimeError('body.too_large', err.message);
    logEvent('ERROR', {
      scope: 'body.too_large',
      path: req.originalUrl || req.url,
    });
    res.sendStatus(200);
    return;
  }

  if (err) {
    markSaiRuntimeError('express', err.message);
    logEvent('ERROR', {
      scope: 'express',
      message: err.message,
      path: req.originalUrl || req.url,
    });
    res.sendStatus(200);
    return;
  }

  next();
});

app.post('/config', (req, res) => {
  const body = req.body || {};
  applyConfigUpdate(body);

  const shouldApplyWebhook =
    Object.prototype.hasOwnProperty.call(body, 'telegram_token') ||
    Object.prototype.hasOwnProperty.call(body, 'webhook_url');

  if (!shouldApplyWebhook) {
    res.json({ ok: true, webhook: null });
    return;
  }

  const snapshot = getRuntimeSnapshot();
  if (!snapshot.telegram_token || !snapshot.webhook_url) {
    res.json({
      ok: true,
      webhook: {
        ok: false,
        description: 'Webhook не применён: укажите токен бота и адрес webhook.',
      },
    });
    return;
  }

  setTelegramWebhook(snapshot)
    .then((webhook) => res.json({ ok: true, webhook }))
    .catch((error) => {
      res.json({
        ok: true,
        webhook: {
          ok: false,
          description: error.message,
        },
      });
    });
});

app.post('/config/models', async (req, res) => {
  const aiKey = req.body.ai_key || runtimeConfig.ai_key || '';
  const aiUrl = req.body.ai_url || runtimeConfig.ai_url || '';

  if (!aiKey || !aiUrl) {
    res.json([]);
    return;
  }

  try {
    const response = await httpClient.get(`${aiUrl.replace(/\/$/, '')}/models`, {
      headers: {
        Authorization: `Bearer ${aiKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });

    res.json(Array.isArray(response.data?.data) ? response.data.data.map((item) => item.id).filter(Boolean) : []);
  } catch (e) {
    res.json([]);
  }
});

app.post('/sai-gpt/models', async (req, res) => {
  const aiKey = req.body.sai_gpt_key || req.body.ai_key || runtimeConfig.sai_gpt_key || '';
  const aiUrl = req.body.sai_gpt_url || req.body.ai_url || runtimeConfig.sai_gpt_url || '';

  if (!aiKey || !aiUrl) {
    res.json({
      success: false,
      status: 'warning',
      label: 'Нужен API key и Base URL',
      models: [],
    });
    return;
  }

  try {
    const response = await httpClient.get(`${String(aiUrl).replace(/\/$/, '')}/models`, {
      headers: {
        Authorization: `Bearer ${aiKey}`,
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const models = Array.isArray(response.data?.data)
      ? response.data.data.map((item) => item.id).filter(Boolean)
      : [];
    res.json({
      success: true,
      status: 'ok',
      label: models.length ? 'API доступен, модели загружены' : 'API доступен, но список моделей пустой',
      models,
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      status: 'error',
      label: getSaiGptProviderErrorMessage(e),
      error: getSaiGptProviderErrorMessage(e),
      models: [],
    });
  }
});

app.post('/config/test-ai', async (req, res) => {
  const config = getRuntimeSnapshot();
  const text = truncateText(req.body.message || '');
  const chatId = getMemoryChatId(req.body.chatId || 'test') || 'test';
  const userId = getMemoryChatId(req.body.userId || chatId) || chatId;
  const images = Array.isArray(req.body.images)
    ? req.body.images.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const messageType = String(req.body.messageType || (images.length ? 'photo' : 'test')).trim() || 'test';
  const traceId = createTraceId();

  if (!text && !images.length) {
    res.json({ ok: false, reply: '', error: 'Message is required' });
    return;
  }

  const input = {
    traceId,
    chatId,
    userId,
    messageType,
    text,
    images,
    hasMedia: images.length > 0,
    hasLinkInput: /https?:\/\//i.test(text),
    config,
  };

  logEvent('IN', {
    traceId,
    status: 'ok',
    scope: 'test.ai',
    userId,
    chatId,
    firstName: 'Test',
    username: 'test_user',
    messageType,
    text,
    images: images.length,
    hasMedia: images.length > 0,
  });

  input.memoryContext = { summary: '', history: [], facts: {}, state: null };

  const reply = await requestAi(input);

  if (typeof reply !== 'string') {
    res.json({ ok: false, reply: '', error: 'AI did not return a reply' });
    return;
  }

  const finalReply = finalizeAiReply(input, reply);
  if (!finalReply) {
    logAiDecisionTrace(input, {
      status: 'skipped',
      skippedReason: 'empty_final_reply',
      finalReply,
    });
    res.json({ ok: false, reply: '', error: 'AI returned empty reply after normalization' });
    return;
  }

  logAiDecisionTrace(input, {
    status: 'ok',
    finalReply,
    sentReply: '',
    skippedReason: 'test_only_not_sent',
  });
  res.json({ ok: true, reply: finalReply });
});

app.post('/config/scenario-test', async (req, res) => {
  const config = getRuntimeSnapshot();
  const scenario = buildScenarioTestCase(req.body || {}, config);
  const traceId = createTraceId();
  const input = {
    traceId,
    chatId: `scenario:${scenario.id}`,
    userId: 'scenario',
    messageType: 'scenario_test',
    text: scenario.message,
    images: [],
    hasMedia: false,
    hasLinkInput: /https?:\/\//i.test(scenario.message),
    config,
    memoryContext: scenario.memoryContext,
  };

  if (!scenario.message) {
    res.json({ ok: false, reply: '', error: 'Message is required', checks: [], score: 0 });
    return;
  }

  logEvent('IN', {
    traceId,
    status: 'ok',
    scope: 'scenario.test',
    userId: input.userId,
    chatId: input.chatId,
    firstName: 'Scenario',
    username: 'ai_control_simulator',
    messageType: input.messageType,
    text: input.text,
    scenario: scenario.id,
    hasMedia: false,
  });

  const reply = await requestAi(input);

  if (typeof reply !== 'string') {
    res.json({
      ok: false,
      reply: '',
      error: 'AI did not return a reply',
      checks: [],
      score: 0,
      context_preview: buildScenarioContextPreview(scenario),
    });
    return;
  }

  const finalReply = finalizeAiReply(input, reply);
  if (!finalReply) {
    logAiDecisionTrace(input, {
      status: 'skipped',
      skippedReason: 'empty_final_reply',
      finalReply,
    });
    res.json({
      ok: false,
      reply: '',
      error: 'AI returned empty reply after normalization',
      checks: [],
      score: 0,
      context_preview: buildScenarioContextPreview(scenario),
    });
    return;
  }

  const diagnostic = evaluateScenarioReply(finalReply, scenario, config);
  logAiDecisionTrace(input, {
    status: 'ok',
    finalReply,
    sentReply: '',
    skippedReason: 'scenario_test_not_sent',
  });
  res.json({
    ok: true,
    reply: finalReply,
    scenario: {
      id: scenario.id,
      title: scenario.title,
    },
    checks: diagnostic.checks,
    score: diagnostic.score,
    context_preview: buildScenarioContextPreview(scenario),
    applied_controls: getVisibleControlState(config, scenario.memoryContext),
  });
});

app.delete('/config', (req, res) => {
  runtimeConfig.telegram_token = '';
  runtimeConfig.ai_key = '';
  runtimeConfig.ai_url = '';
  runtimeConfig.model = '';
  runtimeConfig.sai_gpt_key = '';
  runtimeConfig.sai_gpt_url = 'https://api.openai.com/v1';
  runtimeConfig.sai_gpt_model = 'gpt-4o-mini';
  runtimeConfig.stt_api_key = '';
  runtimeConfig.stt_base_url = 'https://api.openai.com/v1';
  runtimeConfig.stt_model = 'gpt-4o-mini-transcribe';
  runtimeConfig.instruction = '';
  runtimeConfig.core_hot_lead_enabled = true;
  runtimeConfig.core_published_available_enabled = true;
  runtimeConfig.core_no_stock_check_enabled = true;
  runtimeConfig.core_no_catalog_return_enabled = true;
  runtimeConfig.core_no_resell_enabled = true;
  runtimeConfig.core_rules_text = '';
  runtimeConfig.facts_no_invent_enabled = true;
  runtimeConfig.facts_no_fake_payment_enabled = true;
  runtimeConfig.facts_no_fake_delivery_enabled = true;
  runtimeConfig.facts_no_fake_discounts_enabled = true;
  runtimeConfig.facts_no_final_payment_confirm_enabled = true;
  runtimeConfig.facts_no_fake_delivery_time_enabled = true;
  runtimeConfig.facts_rules_text = '';
  runtimeConfig.smalltalk_enabled = true;
  runtimeConfig.smalltalk_style_enabled = true;
  runtimeConfig.smalltalk_outfit_advice_enabled = true;
  runtimeConfig.smalltalk_weather_enabled = true;
  runtimeConfig.smalltalk_soft_product_link_enabled = true;
  runtimeConfig.smalltalk_rules_text = '';
  runtimeConfig.order_path_enabled = true;
  runtimeConfig.order_collect_size_enabled = true;
  runtimeConfig.order_collect_insole_enabled = true;
  runtimeConfig.order_collect_full_name_enabled = true;
  runtimeConfig.order_collect_phone_enabled = true;
  runtimeConfig.order_collect_city_enabled = true;
  runtimeConfig.order_collect_delivery_service_enabled = true;
  runtimeConfig.order_collect_pickup_enabled = true;
  runtimeConfig.order_collect_payment_enabled = true;
  runtimeConfig.order_collect_receipt_enabled = true;
  runtimeConfig.order_step_mode = 'natural';
  runtimeConfig.order_rules_text = '';
  runtimeConfig.response_guard_enabled = true;
  runtimeConfig.response_guard_no_fake_payment_enabled = true;
  runtimeConfig.response_guard_no_repeat_known_enabled = true;
  runtimeConfig.response_guard_human_tone_enabled = true;
  runtimeConfig.response_guard_next_step_enabled = true;
  runtimeConfig.response_guard_no_final_payment_enabled = true;
  runtimeConfig.response_guard_rules_text = '';
  runtimeConfig.receipt_check_enabled = true;
  runtimeConfig.receipt_check_amount_enabled = true;
  runtimeConfig.receipt_check_bank_enabled = true;
  runtimeConfig.receipt_check_recipient_enabled = true;
  runtimeConfig.receipt_check_datetime_enabled = true;
  runtimeConfig.receipt_check_mismatch_enabled = true;
  runtimeConfig.receipt_check_no_final_confirm_enabled = true;
  runtimeConfig.receipt_check_success_text = RECEIPT_ACK_REPLY;
  runtimeConfig.receipt_check_mismatch_text = 'Чек получил, но вижу расхождение с заказом. Проверьте, пожалуйста, сумму или реквизиты и пришлите корректный чек.';
  runtimeConfig.receipt_check_rules_text = '';
  runtimeConfig.quality_replica_honesty_enabled = true;
  runtimeConfig.quality_no_original_claims_enabled = true;
  runtimeConfig.quality_calm_explanation_enabled = true;
  runtimeConfig.quality_no_extra_photos_enabled = true;
  runtimeConfig.quality_return_soft_enabled = true;
  runtimeConfig.quality_return_no_dates_enabled = true;
  runtimeConfig.quality_return_inspect_enabled = true;
  runtimeConfig.quality_return_text = DEFAULT_QUALITY_RETURN_TEXT;
  runtimeConfig.quality_rules_text = '';
  runtimeConfig.store_trust_enabled = true;
  runtimeConfig.store_trust_online_only_enabled = true;
  runtimeConfig.store_trust_sadovod_history_enabled = true;
  runtimeConfig.store_trust_cost_reason_enabled = true;
  runtimeConfig.store_trust_no_address_enabled = true;
  runtimeConfig.store_trust_safe_purchase_enabled = true;
  runtimeConfig.store_trust_text = DEFAULT_STORE_TRUST_TEXT;
  runtimeConfig.contacts_enabled = true;
  runtimeConfig.contacts_website = DEFAULT_CONTACTS_WEBSITE;
  runtimeConfig.contacts_telegram = '';
  runtimeConfig.contacts_manager = '';
  runtimeConfig.contacts_phone = '';
  runtimeConfig.contacts_whatsapp = '';
  runtimeConfig.contacts_instagram_enabled = false;
  runtimeConfig.contacts_instagram = '';
  runtimeConfig.contacts_anti_scam_enabled = true;
  runtimeConfig.contacts_about_text = '';
  runtimeConfig.contacts_rules_text = '';
  runtimeConfig.dialog_examples_enabled = false;
  runtimeConfig.dialog_examples_text = '';
  runtimeConfig.tone = 'neutral';
  runtimeConfig.response_length = 'medium';
  runtimeConfig.creativity = 'balanced';
  runtimeConfig.persona_style = 'calm';
  runtimeConfig.persona_age = '27';
  runtimeConfig.conversation_mode = 'retail';
  runtimeConfig.media_behavior = 'answer_from_media';
  runtimeConfig.auto_reply_enabled = true;
  runtimeConfig.memory_enabled = false;
  runtimeConfig.memory_recent_limit = MEMORY_RECENT_LIMIT;
  runtimeConfig.batch_debounce_ms = BATCH_DEBOUNCE_MS;
  runtimeConfig.reply_mode = 'smart';
  runtimeConfig.human_typing_mode = 'natural';
  runtimeConfig.manager_takeover_enabled = true;
  runtimeConfig.manager_return_delay_ms = MANAGER_RETURN_DELAY_MS;
  runtimeConfig.listen_wait_enabled = true;
  runtimeConfig.listen_wait_debounce_ms = MULTIPART_RESPONSE_DEBOUNCE_MS;
  runtimeConfig.listen_wait_max_window_ms = MULTIPART_RESPONSE_MAX_WINDOW_MS;
  runtimeConfig.payment_enabled = false;
  runtimeConfig.payment_method = 'card';
  runtimeConfig.payment_card_number = '';
  runtimeConfig.payment_recipient_name = '';
  runtimeConfig.payment_bank = '';
  runtimeConfig.payment_comment = '';
  runtimeConfig.payment_style_text = '';
  runtimeConfig.payment_layout_text = '';
  runtimeConfig.payment_bold_mode = 'off';
  runtimeConfig.payment_example_text = '';
  runtimeConfig.delivery_rules_enabled = false;
  runtimeConfig.delivery_rules_text = '';
  runtimeConfig.delivery_style_text = '';
  runtimeConfig.delivery_layout_text = '';
  runtimeConfig.delivery_bold_mode = 'off';
  runtimeConfig.delivery_example_text = '';
  runtimeConfig.delivery_tracking_enabled = true;
  runtimeConfig.delivery_tracking_text = DEFAULT_DELIVERY_TRACKING_TEXT;
  runtimeConfig.webhook_url = '';

  process.env.TELEGRAM_TOKEN = '';
  process.env.AI_API_KEY = '';
  process.env.AI_BASE_URL = '';
  process.env.MODEL = '';
  process.env.SAI_GPT_API_KEY = '';
  process.env.SAI_GPT_BASE_URL = 'https://api.openai.com/v1';
  process.env.SAI_GPT_MODEL = 'gpt-4o-mini';
  process.env.STT_API_KEY = '';
  process.env.STT_BASE_URL = 'https://api.openai.com/v1';
  process.env.STT_MODEL = 'gpt-4o-mini-transcribe';
  process.env.INSTRUCTION = '';
  process.env.CORE_HOT_LEAD_ENABLED = 'true';
  process.env.CORE_PUBLISHED_AVAILABLE_ENABLED = 'true';
  process.env.CORE_NO_STOCK_CHECK_ENABLED = 'true';
  process.env.CORE_NO_CATALOG_RETURN_ENABLED = 'true';
  process.env.CORE_NO_RESELL_ENABLED = 'true';
  process.env.CORE_RULES_TEXT = '';
  process.env.FACTS_NO_INVENT_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_PAYMENT_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DELIVERY_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DISCOUNTS_ENABLED = 'true';
  process.env.FACTS_NO_FINAL_PAYMENT_CONFIRM_ENABLED = 'true';
  process.env.FACTS_NO_FAKE_DELIVERY_TIME_ENABLED = 'true';
  process.env.FACTS_RULES_TEXT = '';
  process.env.SMALLTALK_ENABLED = 'true';
  process.env.SMALLTALK_STYLE_ENABLED = 'true';
  process.env.SMALLTALK_OUTFIT_ADVICE_ENABLED = 'true';
  process.env.SMALLTALK_WEATHER_ENABLED = 'true';
  process.env.SMALLTALK_SOFT_PRODUCT_LINK_ENABLED = 'true';
  process.env.SMALLTALK_RULES_TEXT = '';
  process.env.ORDER_PATH_ENABLED = 'true';
  process.env.ORDER_COLLECT_SIZE_ENABLED = 'true';
  process.env.ORDER_COLLECT_INSOLE_ENABLED = 'true';
  process.env.ORDER_COLLECT_FULL_NAME_ENABLED = 'true';
  process.env.ORDER_COLLECT_PHONE_ENABLED = 'true';
  process.env.ORDER_COLLECT_CITY_ENABLED = 'true';
  process.env.ORDER_COLLECT_DELIVERY_SERVICE_ENABLED = 'true';
  process.env.ORDER_COLLECT_PICKUP_ENABLED = 'true';
  process.env.ORDER_COLLECT_PAYMENT_ENABLED = 'true';
  process.env.ORDER_COLLECT_RECEIPT_ENABLED = 'true';
  process.env.ORDER_STEP_MODE = 'natural';
  process.env.ORDER_RULES_TEXT = '';
  process.env.RESPONSE_GUARD_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_FAKE_PAYMENT_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_REPEAT_KNOWN_ENABLED = 'true';
  process.env.RESPONSE_GUARD_HUMAN_TONE_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NEXT_STEP_ENABLED = 'true';
  process.env.RESPONSE_GUARD_NO_FINAL_PAYMENT_ENABLED = 'true';
  process.env.RESPONSE_GUARD_RULES_TEXT = '';
  process.env.RECEIPT_CHECK_ENABLED = 'true';
  process.env.RECEIPT_CHECK_AMOUNT_ENABLED = 'true';
  process.env.RECEIPT_CHECK_BANK_ENABLED = 'true';
  process.env.RECEIPT_CHECK_RECIPIENT_ENABLED = 'true';
  process.env.RECEIPT_CHECK_DATETIME_ENABLED = 'true';
  process.env.RECEIPT_CHECK_MISMATCH_ENABLED = 'true';
  process.env.RECEIPT_CHECK_NO_FINAL_CONFIRM_ENABLED = 'true';
  process.env.RECEIPT_CHECK_SUCCESS_TEXT = runtimeConfig.receipt_check_success_text;
  process.env.RECEIPT_CHECK_MISMATCH_TEXT = runtimeConfig.receipt_check_mismatch_text;
  process.env.RECEIPT_CHECK_RULES_TEXT = '';
  process.env.QUALITY_REPLICA_HONESTY_ENABLED = 'true';
  process.env.QUALITY_NO_ORIGINAL_CLAIMS_ENABLED = 'true';
  process.env.QUALITY_CALM_EXPLANATION_ENABLED = 'true';
  process.env.QUALITY_RULES_TEXT = '';
  process.env.DIALOG_EXAMPLES_ENABLED = 'false';
  process.env.DIALOG_EXAMPLES_TEXT = '';
  process.env.TONE = 'neutral';
  process.env.RESPONSE_LENGTH = 'medium';
  process.env.CREATIVITY = 'balanced';
  process.env.PERSONA_STYLE = 'calm';
  process.env.PERSONA_AGE = '27';
  process.env.CONVERSATION_MODE = 'retail';
  process.env.MEDIA_BEHAVIOR = 'answer_from_media';
  process.env.AUTO_REPLY_ENABLED = 'true';
  process.env.MEMORY_ENABLED = 'false';
  process.env.MEMORY_RECENT_LIMIT = String(MEMORY_RECENT_LIMIT);
  process.env.BATCH_DEBOUNCE_MS = String(BATCH_DEBOUNCE_MS);
  process.env.REPLY_MODE = 'smart';
  process.env.HUMAN_TYPING_MODE = 'natural';
  process.env.MANAGER_TAKEOVER_ENABLED = 'true';
  process.env.MANAGER_RETURN_DELAY_MS = String(MANAGER_RETURN_DELAY_MS);
  process.env.LISTEN_WAIT_ENABLED = 'true';
  process.env.LISTEN_WAIT_DEBOUNCE_MS = String(MULTIPART_RESPONSE_DEBOUNCE_MS);
  process.env.LISTEN_WAIT_MAX_WINDOW_MS = String(MULTIPART_RESPONSE_MAX_WINDOW_MS);
  process.env.PAYMENT_ENABLED = 'false';
  process.env.PAYMENT_METHOD = 'card';
  process.env.PAYMENT_CARD_NUMBER = '';
  process.env.PAYMENT_RECIPIENT_NAME = '';
  process.env.PAYMENT_BANK = '';
  process.env.PAYMENT_COMMENT = '';
  process.env.PAYMENT_STYLE_TEXT = '';
  process.env.PAYMENT_LAYOUT_TEXT = '';
  process.env.PAYMENT_BOLD_MODE = 'off';
  process.env.PAYMENT_EXAMPLE_TEXT = '';
  process.env.DELIVERY_RULES_ENABLED = 'false';
  process.env.DELIVERY_STYLE_TEXT = '';
  process.env.DELIVERY_LAYOUT_TEXT = '';
  process.env.DELIVERY_BOLD_MODE = 'off';
  process.env.DELIVERY_EXAMPLE_TEXT = '';
  process.env.DELIVERY_RULES_TEXT = '';
  process.env.DELIVERY_TRACKING_ENABLED = 'true';
  process.env.DELIVERY_TRACKING_TEXT = DEFAULT_DELIVERY_TRACKING_TEXT;
  process.env.WEBHOOK_URL = '';

  savePersistedConfig();

  res.json({ ok: true });
});

app.post('/api/telegram/webhook', async (req, res) => {
  const updateContext = getTelegramMessageContext(req.body || {});
  const message = updateContext.message;
  const chatId = message && message.chat && message.chat.id;

  if (!message || !chatId) {
    if (updateContext.updateType === 'business_connection') {
      const connection = upsertBusinessConnection(req.body.business_connection || {});
      logEvent('IN', {
        traceId: createTraceId(),
        status: 'ok',
        scope: 'telegram.business_connection',
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        userId: connection?.userId || req.body.business_connection?.user?.id || '',
        chatId: connection?.userChatId || req.body.business_connection?.user_chat_id || '',
        isEnabled: connection?.isEnabled ?? '',
        text: 'Telegram Business connection update',
      });
    }
    res.sendStatus(200);
    return;
  }

  const config = getRuntimeSnapshot();
  const traceId = createTraceId();
  const userId = message.from?.id || chatId;
  const firstName = String(message.from?.first_name || message.chat?.first_name || '').trim();
  const lastName = String(message.from?.last_name || message.chat?.last_name || '').trim();
  const username = String(message.from?.username || message.chat?.username || '').trim();
  const phoneNumber = String(message.contact?.phone_number || '').trim();

  res.sendStatus(200);

  setImmediate(async () => {
    try {
      if (updateContext.businessConnectionId) {
        rememberBusinessConnectionChat(updateContext.businessConnectionId, chatId);
      }
      const sourceInfo = await classifyTelegramMessageSource(config, updateContext, message);
      const input = await normalizeTelegramMessage(config, {
        traceId,
        userId,
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        messageId: updateContext.messageId,
        messageType: detectMessageType(message),
      }, message);
      input.chatId = chatId;
      input.userId = userId;
      input.traceId = traceId;
      input.config = config;
      input.updateType = updateContext.updateType;
      input.businessConnectionId = updateContext.businessConnectionId;
      input.messageId = updateContext.messageId;
      input.messageSource = sourceInfo.source;
      input.firstName = firstName;
      input.lastName = lastName;
      input.username = username;
      input.phoneNumber = phoneNumber;
      input.receivedAt = Date.now();
      safeCustomerStoreCall('customer.upsert', (store) => store.getOrCreateByTelegram(input));
      logEvent('IN', {
        traceId,
        received: true,
        userId,
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        messageSource: sourceInfo.source,
        businessUserId: sourceInfo.businessConnection?.userId || '',
        messageId: updateContext.messageId,
        firstName,
        lastName,
        username,
        phoneNumber,
        messageType: input.messageType,
        text: input.text,
        textLength: input.text.length,
        images: input.images.length,
        hasMedia: !!input.hasMedia,
        hasLinkInput: !!input.hasLinkInput,
        status: 'ok',
      });

      const memoryText = getMemoryMessageText(input);
      const memoryEnabled = parseConfigBoolean(config.memory_enabled, true);
      const managerTakeoverEnabled = parseConfigBoolean(config.manager_takeover_enabled, true);

      if (sourceInfo.source !== 'client') {
        if (['manager', 'manager_auto'].includes(sourceInfo.source)) {
          appendMemoryMessage(input, 'manager', memoryText);
        }

        if (sourceInfo.source === 'manager') {
          applyManagerStageHints(input);
        }

        if (sourceInfo.source === 'manager' && managerTakeoverEnabled) {
          cancelChatBatch(chatId);
          cancelManagerReturnTimer(chatId);
          setManagerActive(chatId, input, 'manager_message');
          logEvent('MESSAGE_STATUS', {
            traceId,
            userId,
            chatId,
            updateType: updateContext.updateType,
            businessConnectionId: updateContext.businessConnectionId,
            messageId: updateContext.messageId,
            messageType: input.messageType,
            messageStatus: 'manager_takeover',
            status: 'ok',
          });
        } else {
          logEvent('MESSAGE_STATUS', {
            traceId,
            userId,
            chatId,
            updateType: updateContext.updateType,
            businessConnectionId: updateContext.businessConnectionId,
            messageId: updateContext.messageId,
            messageType: input.messageType,
            messageStatus: `${sourceInfo.source}_ignored`,
            status: 'ok',
          });
        }
        return;
      }

      if (memoryEnabled) {
        updateCustomerMemoryFromInput(input);
      }
      appendMemoryMessage(input, 'user', memoryText);
      markLatestClientTrace(input);

      if (!parseConfigBoolean(config.auto_reply_enabled, true)) {
        logEvent('MESSAGE_STATUS', {
          traceId,
          userId,
          chatId,
          updateType: updateContext.updateType,
          businessConnectionId: updateContext.businessConnectionId,
          messageId: updateContext.messageId,
          messageType: input.messageType,
          messageStatus: 'auto_reply_disabled',
          status: 'ok',
        });
        return;
      }

      const dialogState = getDialogState(chatId);
      if (managerTakeoverEnabled && dialogState?.aiMode === 'passive_manager') {
        scheduleManagerReturn(input);
        return;
      }

      enqueueInputForBatch(input);
    } catch (e) {
      logEvent('ERROR', {
        traceId,
        userId,
        scope: 'webhook',
        chatId,
        updateType: updateContext.updateType,
        businessConnectionId: updateContext.businessConnectionId,
        status: 'error',
        error: e.message,
      });
    }
  });
});

const server = app.listen(PORT, HOST);
server.requestTimeout = 20000;
server.headersTimeout = 22000;
server.keepAliveTimeout = 5000;

console.log(`[BOOT] S.AI listening on http://${HOST}:${PORT}`);
startFollowupWorkerLoop();

process.on('unhandledRejection', (error) => {
  markSaiRuntimeError('process.unhandledRejection', error && error.message ? error.message : String(error));
  logEvent('ERROR', {
    scope: 'process.unhandledRejection',
    message: error && error.message ? error.message : String(error),
  });
});

process.on('uncaughtException', (error) => {
  markSaiRuntimeError('process.uncaughtException', error && error.message ? error.message : String(error));
  logEvent('ERROR', {
    scope: 'process.uncaughtException',
    message: error && error.message ? error.message : String(error),
  });
});
