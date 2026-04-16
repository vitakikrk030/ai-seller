const axios = require('axios');
const config = require('../config');
const log = require('../logger');

async function sendText(text) {
  const payload = {
    model: config.MODEL,
    messages: [{ role: 'user', content: String(text || '') }],
    max_tokens: config.AI_MAX_TOKENS,
  };

  log.debug('ai.client.request_payload', {
    provider: config.AI_BASE_URL,
    payload,
  });

  const response = await axios.post(
    `${config.AI_BASE_URL.replace(/\/$/, '')}/chat/completions`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${config.AI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: config.AI_TIMEOUT_MS,
    }
  );

  const reply = String(response.data?.choices?.[0]?.message?.content || '').trim();
  if (!reply) {
    throw new Error('AI returned empty response');
  }
  return reply;
}

module.exports = { sendText };
