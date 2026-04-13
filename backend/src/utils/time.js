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

module.exports = { formatMoscowTime, moscowISO, nowMoscow, MOSCOW_TZ };
