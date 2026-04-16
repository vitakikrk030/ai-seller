/**
 * AI Safety Gate — единый слой защиты между AI и клиентом.
 */

const log = require('../logger');

// ═══════════════════════════════════════
// 1. OUTPUT SANITIZER
// ═══════════════════════════════════════

function sanitize(text) {
  if (!text || typeof text !== 'string') return '';
  let t = text;
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  t = t.replace(/\*\*(.+?)\*\*/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1');
  t = t.replace(/(?<!\w)\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1');
  t = t.replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1');
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/<\/?(?!b|i|u|s|code|pre|a\b)[^>]+>/gi, '');
  t = t.replace(/\{["\s]*[\w]+["\s]*:[\s\S]*?\}/g, '');
  t = t.replace(/\[\s*\{[\s\S]*?\}\s*\]/g, '');
  t = t.replace(/^(system|user|assistant)\s*:/gim, '');
  t = t.replace(/\[INST\].*?\[\/INST\]/gs, '');
  t = t.replace(/<\|.*?\|>/g, '');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t.trim();
  return t;
}

// ═══════════════════════════════════════
// 2. SAFETY DETECTOR
// ═══════════════════════════════════════

const BLOCKED_PATTERNS = [
  /я\s*(?:—|-)?\s*(?:искусственный интеллект|ии|ai|бот|робот|языковая модель|нейросет|chatgpt|gpt|assistant)/i,
  /как\s+(?:искусственный интеллект|ии|ai|бот|языковая модель|нейросет)/i,
  /я\s+не\s+(?:могу|умею|способен)\s+(?:чувствовать|думать|иметь эмоции|испытывать)/i,
  /я\s+(?:всего лишь|просто)\s+(?:программа|бот|алгоритм|модель)/i,
  /я\s+(?:виртуальный|цифровой)\s+(?:помощник|ассистент)/i,
  /(?:могу\s+ошибаться|не\s+уверен|не\s+могу\s+гарантировать)/i,
  /\b(?:api|json|endpoint|server|error|exception|stack\s*trace|null|undefined|NaN|TypeError|SyntaxError)\b/i,
  /\b(?:token|bearer|authorization|header|payload|webhook|callback)\b/i,
  /\b(?:database|query|sql|insert|select|update|delete\s+from)\b/i,
  /\b(?:console\.log|require|import|export|function|const|let|var)\b/,
  /\b(?:openrouter|openai|anthropic|claude|gpt-4|gpt-3|llama|mistral)\b/i,
  /\bprocess\.env\b/i,
  /\b(?:prompt|system message|instruction|generate|completion)\b/i,
  /\b(?:fallback|retry|timeout|circuit.?breaker|queue|worker|task)\b/i,
  /\b(?:debug|log|trace|verbose|monitoring)\b/i,
  /произошла\s+(?:ошибк|сбой)/i,
  /внутренн[яи][яй]\s+(?:ошибк|сбой)/i,
  /(?:попробуйте|попробуй)\s+позже/i,
  /техническ[\u0430-\u044f]+\s+(?:ошибк|сбо|неполадк|проблем)/i,
  /системн[\u0430-\u044f]+\s+(?:ошибк|сбо|неполадк|проблем)/i,
  /обрат(?:итесь|ись)\s+в\s+(?:поддержку|тех)/i,
  /что-то\s+пошло\s+не\s+так/i,
  /---\s*(?:КОНЕЦ|END|СИСТЕМА|SYSTEM|PROMPT|КАТАЛОГ)/i,
  /ПРАВИЛА?\s+РАБОТЫ/i,
  /СТРОГИЕ\s+ПРАВИЛА/i,
  /\bСЕЙЧАС:/,
  /\bРЕКОМЕНДАЦИЯ:/,
];

const SUSPICIOUS_PATTERNS = [
  /не\s+(?:могу|удалось)\s+(?:найти|определить|обработать|распознать)/i,
  /к\s+сожалению/i,
  /у\s+нас\s+(?:такого\s+)?нет/i,
  /нет\s+в\s+(?:наличии|каталоге|продаже)/i,
  /(?:отсутствует|закончил(?:ся|ась|ись|ось))/i,
  /извини(?:те)?,?\s+(?:но|я)/i,
];

function detect(text) {
  if (!text || typeof text !== 'string') return { safe: false, reason: 'empty' };
  const t = text.trim();
  if (t.length === 0) return { safe: false, reason: 'empty' };
  if (t.length < 2) return { safe: false, reason: 'too_short' };
  if (t.length > 2000) return { safe: false, reason: 'too_long' };
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    return { safe: false, reason: 'json_artifact' };
  }
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(t)) return { safe: false, reason: 'blocked_pattern' };
  }
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(t)) return { safe: false, reason: 'suspicious_pattern' };
  }
  return { safe: true };
}

// ═══════════════════════════════════════
// 3. CIRCUIT BREAKER
// ═══════════════════════════════════════

const _cb = {
  failures: 0,
  lastFailure: 0,
  state: 'CLOSED',
  threshold: 5,
  resetTimeout: 60_000,
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
// 4. ENFORCE — ЕДИНАЯ ТОЧКА ВХОДА
// ═══════════════════════════════════════

/**
 * Пропустить AI-ответ через safety gate.
 *
 * @param {string} rawResponse
 * @param {object} opts — { userState, isScheduled }
 * @returns {Promise<{ text: string, passed: boolean, reason?: string }>}
 */
async function enforce(rawResponse, opts = {}) {
  const { userState, isScheduled } = opts;

  const cleaned = sanitize(rawResponse);
  const result = detect(cleaned);

  if (result.safe) {
    cbRecord(true);
    return { text: cleaned, passed: true };
  }

  cbRecord(false);

  log.warn('Safety gate: blocked AI response', {
    reason: result.reason,
    userState,
    responseLength: rawResponse?.length || 0,
    preview: (rawResponse || '').substring(0, 80),
  });

  return { text: '', passed: false, reason: result.reason };
}

/**
 * Проверить, разрешён ли AI-запрос (circuit breaker).
 */
async function shouldCallAI(userState) {
  if (cbAllowRequest()) return { allowed: true };
  log.warn('Circuit breaker: AI request blocked', { state: _cb.state, userState });
  return { allowed: false, fallback: null };
}

module.exports = {
  sanitize,
  detect,
  enforce,
  shouldCallAI,
  cbRecord,
  cbGetState,
  cbReset,
  BLOCKED_PATTERNS,
  SUSPICIOUS_PATTERNS,
};
