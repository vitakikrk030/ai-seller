/**
 * Universal AI Client — works with any OpenAI-compatible API.
 * Supports primary + secondary failover, retry, timeout, and failure logging.
 *
 * Config (env or DB settings):
 *   AI_BASE_URL / AI_API_KEY / AI_MODEL          — primary provider
 *   SECONDARY_AI_BASE_URL / _API_KEY / _MODEL    — failover provider
 *   AI_MAX_TOKENS / AI_TIMEOUT_MS
 */

const axios = require('axios');
const db = require('../db');
const log = require('../logger');

// Defaults — override via AI_BASE_URL / AI_MODEL env or DB settings
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = process.env.AI_MODEL || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_TIMEOUT = 10000; // 10s

/**
 * Estimate tokens from text length (≈4 chars per token).
 */
function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

/**
 * Get primary AI config.
 */
function getAIConfig() {
  const config = require('../config');
  return {
    baseUrl: process.env.AI_BASE_URL || config.get('AI_BASE_URL') || DEFAULT_BASE_URL,
    apiKey: process.env.AI_API_KEY || config.get('AI_API_KEY')
      || process.env.OPENROUTER_API_KEY || config.get('OPENROUTER_API_KEY') || '',
    model: process.env.AI_MODEL || config.get('AI_MODEL')
      || process.env.OPENROUTER_MODEL || config.get('OPENROUTER_MODEL') || DEFAULT_MODEL,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || DEFAULT_MAX_TOKENS),
    timeout: parseInt(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT),
  };
}

/**
 * Get secondary (failover) AI config. Returns null if not configured.
 */
function getSecondaryConfig() {
  const config = require('../config');
  const baseUrl = process.env.SECONDARY_AI_BASE_URL || config.get('SECONDARY_AI_BASE_URL') || '';
  const apiKey = process.env.SECONDARY_AI_API_KEY || config.get('SECONDARY_AI_API_KEY') || '';
  const model = process.env.SECONDARY_AI_MODEL || config.get('SECONDARY_AI_MODEL') || '';
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    apiKey,
    model: model || DEFAULT_MODEL,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS || DEFAULT_MAX_TOKENS),
    timeout: parseInt(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT),
  };
}

/**
 * Log AI failure to DB (non-blocking).
 */
async function logFailure({ provider, errorType, message, fallbackUsed = false }) {
  try {
    await db.query(
      `INSERT INTO ai_failures (provider, error_type, message, fallback_used, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [provider || 'unknown', errorType || 'unknown', (message || '').slice(0, 500), fallbackUsed]
    );
  } catch (e) { /* non-blocking */ }
}

/**
 * Save usage record to DB (non-blocking).
 */
async function saveUsage({ tokensIn, tokensOut, model, provider }) {
  try {
    await db.query(
      `INSERT INTO ai_usage (tokens_in, tokens_out, total_tokens, model, provider, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [tokensIn, tokensOut, tokensIn + tokensOut, model, provider]
    );
  } catch (e) { /* non-blocking */ }
}

/**
 * Make a single AI request to a given config.
 * @returns {{ text: string, tokensIn: number, tokensOut: number }}
 */
async function _request(cfg, messages, { maxTokens, temperature = 0.3 }) {
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const resolvedModel = cfg.model;
  const resolvedMaxTokens = maxTokens || cfg.maxTokens;

  const start = Date.now();
  const response = await axios.post(
    url,
    { model: resolvedModel, messages, max_tokens: resolvedMaxTokens, temperature },
    {
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://ai-seller',
        'X-Title': 'AI Seller',
      },
      timeout: cfg.timeout,
    }
  );

  const latency = Date.now() - start;
  const text = (response.data.choices?.[0]?.message?.content || '').trim();
  const usage = response.data.usage || {};
  const tokensIn = usage.prompt_tokens || estimateTokens(messages.map(m => m.content).join(' '));
  const tokensOut = usage.completion_tokens || estimateTokens(text);
  const provider = new URL(cfg.baseUrl).hostname.replace('www.', '');

  saveUsage({ tokensIn, tokensOut, model: resolvedModel, provider }).catch(() => {});
  try { require('../monitoring').recordSuccess('ai', latency); } catch (e) {}

  return { text, tokensIn, tokensOut };
}

/**
 * Send messages to AI with failover: primary → secondary → DB fallback.
 * Retries primary once before switching to secondary.
 *
 * @param {{ messages: Array, model?: string, maxTokens?: number, temperature?: number }} opts
 * @returns {Promise<{ text: string, tokensIn: number, tokensOut: number }>}
 */
async function sendMessage({ messages, model, maxTokens, temperature = 0.3 }) {
  const primary = getAIConfig();
  const secondary = getSecondaryConfig();
  const opts = { maxTokens, temperature };
  if (model) primary.model = model;

  // ── Primary (with 1 retry) ──────────────────────────────────────────────
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await _request(primary, messages, opts);
      if (result.text) return result;
      // Empty response — retry once
    } catch (err) {
      const provider = new URL(primary.baseUrl).hostname;
      log.warn(`AI primary error (attempt ${attempt + 1}): ${err.message}`, { provider });
      if (attempt === 0) {
        // Retry after short delay
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      // Both attempts failed — log and try secondary
      await logFailure({ provider, errorType: 'request_failed', message: err.message, fallbackUsed: !!secondary });
      try { require('../monitoring').recordError('ai', err.message || 'AI primary failed', 'warning'); } catch (e) {}
    }
  }

  // ── Secondary failover ──────────────────────────────────────────────────
  if (secondary) {
    try {
      log.info('AI failover: switching to secondary provider', { url: secondary.baseUrl });
      const result = await _request(secondary, messages, opts);
      if (result.text) {
        await logFailure({ provider: new URL(primary.baseUrl).hostname, errorType: 'failover_used', message: 'Switched to secondary', fallbackUsed: true });
        return result;
      }
    } catch (err) {
      const provider = new URL(secondary.baseUrl).hostname;
      log.warn(`AI secondary error: ${err.message}`, { provider });
      await logFailure({ provider, errorType: 'secondary_failed', message: err.message, fallbackUsed: true });
      try { require('../monitoring').recordError('ai', 'AI secondary failed', 'warning'); } catch (e) {}
    }
  }

  // ── No scripted fallback replies: propagate hard failure upstream ───────
  await logFailure({ provider: 'all', errorType: 'all_failed', message: 'All providers failed', fallbackUsed: true });
  try { require('../monitoring').recordError('ai', 'All AI providers failed', 'critical'); } catch (e) {}
  throw new Error('AI providers unavailable');
}

/**
 * Get usage stats from DB.
 */
async function getUsageStats({ days = 30 } = {}) {
  try {
    const result = await db.query(
      `SELECT
         COALESCE(SUM(total_tokens), 0) as used,
         COALESCE(SUM(tokens_in), 0) as tokens_in,
         COALESCE(SUM(tokens_out), 0) as tokens_out,
         COUNT(*) as requests,
         MAX(created_at) as last_request
       FROM ai_usage
       WHERE created_at > NOW() - INTERVAL '${parseInt(days)} days'`
    );
    return result.rows[0] || { used: 0, tokens_in: 0, tokens_out: 0, requests: 0 };
  } catch (e) {
    return { used: 0, tokens_in: 0, tokens_out: 0, requests: 0 };
  }
}

module.exports = { sendMessage, getUsageStats, getAIConfig, estimateTokens };
