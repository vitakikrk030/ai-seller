/**
 * Moscow timezone (UTC+3) formatting utilities.
 * Single source of truth for all time formatting across the system.
 */

const MOSCOW_TZ = 'Europe/Moscow';

/**
 * Format a date as Moscow time string: "2026-04-13 15:30:45 MSK"
 * @param {Date|string|number} [date] - Date to format (defaults to now)
 * @returns {string}
 */
function formatMoscowTime(date) {
  const d = date ? new Date(date) : new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * Format a date as ISO-like Moscow time: "2026-04-13T15:30:45+03:00"
 * Suitable for API responses and storage.
 * @param {Date|string|number} [date] - Date to format (defaults to now)
 * @returns {string}
 */
function moscowISO(date) {
  const d = date ? new Date(date) : new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MOSCOW_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const get = (type) => parts.find(p => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+03:00`;
}

/**
 * Get current Moscow time as a Date-like ISO string for timestamps.
 * @returns {string}
 */
function nowMoscow() {
  return moscowISO();
}

/**
 * Get current Moscow time parts: { h, m, s, dateStr }
 * @param {Date|string|number} [date]
 * @returns {{ h: number, m: number, s: number, dateStr: string, totalMin: number }}
 */
function getMoscowTime(date) {
  const d = date ? new Date(date) : new Date();
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: MOSCOW_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parseInt(parts.find(p => p.type === type)?.value || '0');
  const h = get('hour'), m = get('minute'), s = get('second');
  const year = parts.find(p => p.type === 'year')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  return { h, m, s, dateStr: `${year}-${month}-${day}`, totalMin: h * 60 + m };
}

/**
 * Get current Moscow date string: "YYYY-MM-DD"
 * @returns {string}
 */
function getMoscowDateStr(date) {
  return getMoscowTime(date).dateStr;
}

/**
 * Check if current Moscow time is within a HH:MM–HH:MM range.
 * Supports overnight ranges (e.g. 22:00–06:00).
 * @param {string} start - "HH:MM"
 * @param {string} end   - "HH:MM"
 * @param {Date} [date]
 * @returns {boolean}
 */
function isMoscowInRange(start, end, date) {
  const { totalMin } = getMoscowTime(date);
  const parseHHMM = (t) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s <= e) return totalMin >= s && totalMin < e;
  // Overnight: e.g. 22:00–06:00
  return totalMin >= s || totalMin < e;
}

module.exports = { formatMoscowTime, moscowISO, nowMoscow, getMoscowTime, getMoscowDateStr, isMoscowInRange, MOSCOW_TZ };
