/**
 * AI Safety Gate — единый слой защиты между AI и клиентом.
 *
 * Ни один AI-ответ не уходит в Telegram без прохождения этого модуля.
 *
 * Порядок:
 *   1. sanitize()     — очистка от артефактов, markdown, JSON, кода
 *   2. detect()       — обнаружение AI-сигнатур, технических фраз, мусора
 *   3. enforce()      — единая точка: sanitize → detect → pass / block + fallback
 *   4. circuitBreaker — если AI стабильно ошибается, отключаем его временно
 */

const log = require('../logger');

// ═══════════════════════════════════════
// 1. OUTPUT SANITIZER
// ═══════════════════════════════════════

/**
 * Очистить текст от технических артефактов перед отправкой клиенту.
 */
function sanitize(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;

  // Убрать markdown заголовки (# ## ###)
  t = t.replace(/^#{1,6}\s+/gm, '');

  // Убрать markdown bold/italic артефакты, но сохранить текст
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1');
  t = t.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1');
  t = t.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1');

  // Убрать блоки кода ```...```
  t = t.replace(/```[\s\S]*?```/g, '');

  // Убрать inline code `...`
  t = t.replace(/`([^`]+)`/g, '$1');

  // Убрать markdown ссылки [text](url) → оставить text
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // Убрать HTML-теги (кроме уже ожидаемых для Telegram)
  t = t.replace(/<\/?(?!b|i|u|s|code|pre|a\b)[^>]+>/gi, '');

  // Убрать JSON-объекты {...} и массивы [...]  которые выглядят как код
  t = t.replace(/\{["\s]*[\w]+["\s]*:[\s\S]*?\}/g, '');
  t = t.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '');

  // Убрать обрывки промптов / системных инструкций
  t = t.replace(/^(system|user|assistant)\s*:/gim, '');
  t = t.replace(/\[INST\].*?\[\/INST\]/gs, '');
  t = t.replace(/<\|.*?\|>/g, '');

  // Убрать множественные пробелы и пустые строки
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');

  // Trim
  t = t.trim();

  return t;
}

// ═══════════════════════════════════════
// 2. SAFETY DETECTOR
// ═══════════════════════════════════════

// Паттерны, которых не должно быть в ответе клиенту.
// Каждый — повод заблокировать ответ.

const BLOCKED_PATTERNS = [
  // AI-выдача себя
  /я\s*(?:—|-)?\s*(?:искусственный интеллект|ии|ai|бот|робот|языковая модель|нейросет|chatgpt|gpt|assistant)/i,
  /как\s+(?:искусственный интеллект|ии|ai|бот|языковая модель|нейросет)/i,
  /я\s+не\s+(?:могу|умею|способен)\s+(?:чувствовать|думать|иметь эмоции|испытывать)/i,
  /я\s+(?:всего лишь|просто)\s+(?:программа|бот|алгоритм|модель)/i,
  /я\s+(?:виртуальный|цифровой)\s+(?:помощник|ассистент)/i,
  /(?:могу\s+ошибаться|не\s+уверен|не\s+могу\s+гарантировать)/i,

  // Технический мусор
  /\b(?:api|json|endpoint|server|error|exception|stack\s*trace|null|undefined|NaN|TypeError|SyntaxError)\b/i,
  /\b(?:token|bearer|authorization|header|payload|webhook|callback)\b/i,
  /\b(?:database|query|sql|insert|select|update|delete\s+from)\b/i,
  /\b(?:console\.log|require|import|export|function|const|let|var)\b/,
  /\b(?:openrouter|openai|anthropic|claude|gpt-4|gpt-3|llama|mistral)\b/i,
  /\bprocess\.env\b/i,
  /\b(?:prompt|system message|instruction|generate|completion)\b/i,

  // Debug / internal
  /\b(?:fallback|retry|timeout|circuit.?breaker|queue|worker|task)\b/i,
  /\b(?:debug|log|trace|verbose|monitoring)\b/i,

  // Ошибочные формулировки для клиента
  /произошла\s+(?:ошибк|сбой)/i,
  /внутренн[яи][яй]\s+(?:ошибк|сбой)/i,
  /(?:попробуйте|попробуй)\s+позже/i,
  /техническ[\u0430-\u044f]+\s+(?:ошибк|сбо|неполадк|проблем)/i,
  /системн[\u0430-\u044f]+\s+(?:ошибк|сбо|неполадк|проблем)/i,
  /обрат(?:итесь|ись)\s+в\s+(?:поддержку|тех)/i,
  /что-то\s+пошло\s+не\s+так/i,

  // Промпт-инъекции / обрывки промпта
  /---\s*(?:КОНЕЦ|END|СИСТЕМА|SYSTEM|PROMPT|КАТАЛОГ)/i,
  /ПРАВИЛА?\s+РАБОТЫ/i,
  /СТРОГИЕ\s+ПРАВИЛА/i,
  /\bСЕЙЧАС:/,
  /\bРЕКОМЕНДАЦИЯ:/,
];

// Мягкие паттерны (подозрительные, но не 100% блокировка)
const SUSPICIOUS_PATTERNS = [
  /не\s+(?:могу|удалось)\s+(?:найти|определить|обработать|распознать)/i,
  /к\s+сожалению/i,
  /у\s+нас\s+(?:такого\s+)?нет/i,
  /нет\s+в\s+(?:наличии|каталоге|продаже)/i,
  /(?:отсутствует|закончил(?:ся|ась|ись|ось))/i,
  /извини(?:те)?,?\s+(?:но|я)/i,
];

/**
 * Проверить текст на безопасность для отправки клиенту.
 * @returns {{ safe: boolean, reason?: string }}
 */
function detect(text) {
  if (!text || typeof text !== 'string') {
    return { safe: false, reason: 'empty' };
  }

  const t = text.trim();

  // Пустой или слишком короткий
  if (t.length === 0) return { safe: false, reason: 'empty' };
  if (t.length < 2) return { safe: false, reason: 'too_short' };

  // Слишком длинный (больше 2000 символов даже после truncate — что-то не так)
  if (t.length > 2000) return { safe: false, reason: 'too_long' };

  // Проверка на JSON-мусор
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    return { safe: false, reason: 'json_artifact' };
  }

  // Жёсткие паттерны — однозначная блокировка
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(t)) {
      return { safe: false, reason: 'blocked_pattern' };
    }
  }

  // Мягкие паттерны — блокируем для ai-ответов (не для шаблонных)
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(t)) {
      return { safe: false, reason: 'suspicious_pattern' };
    }
  }

  return { safe: true };
}

// ═══════════════════════════════════════
// 3. SAFE FALLBACK RESPONSES
// ═══════════════════════════════════════

const FALLBACKS = {
  // Общие нейтральные ответы — как живой менеджер
  general: [
    'Секунду, уточню и вернусь с ответом 👌',
    'Проверяю, сейчас подскажу 😊',
    'Сейчас гляну, минутку ⏳',
    'Ща уточню, подожди 🤙',
  ],

  // Когда AI вообще не смог ответить
  ai_down: [
    'Сейчас уточню у коллег и вернусь 👌',
    'Передал менеджеру — скоро ответим 😊',
    'Минутку, переспрошу и напишу 🤙',
  ],

  // Когда ответ заблокирован safety gate
  blocked: [
    'Подскажи подробнее что ищешь — помогу 😉',
    'Расскажи чуть больше, подберём лучший вариант 👟',
    'Чё присматриваешь? Помогу выбрать 😊',
  ],

  // Для состояний воронки
  waiting_size: [
    'Какой размер носишь? Подберу 👟',
    'Подскажи размер — посмотрю что есть 😊',
  ],
  waiting_form: [
    'Скинь ФИО, город и телефон — и оформим 🚀',
  ],
  waiting_payment: [
    'Заказ ждёт оплаты — переведи и скинь скрин 💳',
  ],
};

/**
 * Получить безопасный fallback по категории и состоянию пользователя.
 */
function getFallback(category, userState) {
  // Сначала пробуем state-specific fallback
  if (userState) {
    const stateKey = userState.toLowerCase();
    if (FALLBACKS[stateKey] && FALLBACKS[stateKey].length > 0) {
      return _pick(FALLBACKS[stateKey]);
    }
  }
  // Потом по категории
  const list = FALLBACKS[category] || FALLBACKS.general;
  return _pick(list);
}

function _pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ═══════════════════════════════════════
// 4. CIRCUIT BREAKER
// ═══════════════════════════════════════

const _cb = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',       // CLOSED = ok, OPEN = broken, HALF_OPEN = trying
  threshold: 5,           // после 5 ошибок подряд — открываем
  resetTimeout: 60_000,   // через 60 секунд пробуем снова
  halfOpenAt: 0,
};

function cbRecord(success) {
  if (success) {
    if (_cb.state === 'HALF_OPEN') {
      log.info('Circuit breaker: recovered, closing', { failures: _cb.failures });
    }
    _cb.failures = 0;
    _cb.state = 'CLOSED';
  } else {
    _cb.failures++;
    _cb.lastFailure = Date.now();
    if (_cb.failures >= _cb.threshold) {
      _cb.state = 'OPEN';
      _cb.halfOpenAt = Date.now() + _cb.resetTimeout;
      log.warn('Circuit breaker: OPEN — AI disabled temporarily', {
        failures: _cb.failures,
        resetIn: _cb.resetTimeout,
      });
    }
  }
}

function cbAllowRequest() {
  if (_cb.state === 'CLOSED') return true;
  if (_cb.state === 'OPEN' && Date.now() >= _cb.halfOpenAt) {
    _cb.state = 'HALF_OPEN';
    log.info('Circuit breaker: HALF_OPEN — testing AI');
    return true;
  }
  return _cb.state === 'HALF_OPEN';
}

function cbGetState() {
  return { state: _cb.state, failures: _cb.failures, lastFailure: _cb.lastFailure };
}

function cbReset() {
  _cb.failures = 0;
  _cb.state = 'CLOSED';
  _cb.lastFailure = 0;
  _cb.halfOpenAt = 0;
}

// ═══════════════════════════════════════
// 5. ENFORCE — ЕДИНАЯ ТОЧКА ВХОДА
// ═══════════════════════════════════════

/**
 * Пропустить AI-ответ через safety gate.
 *
 * @param {string} rawResponse — сырой ответ AI
 * @param {object} opts — { userState, isScheduled }
 * @returns {{ text: string, passed: boolean, reason?: string }}
 *
 * - text   — чистый текст для отправки (или fallback)
 * - passed — true если оригинал прошёл проверку
 * - reason — причина блокировки (если blocked)
 */
function enforce(rawResponse, opts = {}) {
  const { userState, isScheduled } = opts;

  // Шаг 1: Sanitize
  const cleaned = sanitize(rawResponse);

  // Шаг 2: Detect
  const result = detect(cleaned);

  if (result.safe) {
    cbRecord(true);
    return { text: cleaned, passed: true };
  }

  // Заблокировано — берём fallback
  cbRecord(false);
  const category = isScheduled ? 'ai_down' : 'blocked';
  const fallback = getFallback(category, userState);

  log.warn('Safety gate: blocked AI response', {
    reason: result.reason,
    userState,
    responseLength: rawResponse?.length || 0,
    preview: (rawResponse || '').substring(0, 80),
  });

  return { text: fallback, passed: false, reason: result.reason };
}

/**
 * Проверить, разрешён ли AI-запрос (circuit breaker).
 * Если нет — вернуть fallback сразу, не вызывая AI.
 */
function shouldCallAI(userState) {
  if (cbAllowRequest()) return { allowed: true };
  const fallback = getFallback('ai_down', userState);
  log.warn('Circuit breaker: AI request blocked', { state: _cb.state, userState });
  return { allowed: false, fallback };
}

module.exports = {
  sanitize,
  detect,
  enforce,
  getFallback,
  shouldCallAI,
  cbRecord,
  cbGetState,
  cbReset,
  // Expose for testing
  BLOCKED_PATTERNS,
  SUSPICIOUS_PATTERNS,
  FALLBACKS,
};
