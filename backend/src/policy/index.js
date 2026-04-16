const aiClient = require('../ai/client');
const log = require('../logger');

const EMPTY_COLLECTED_DATA = {
  product_ref: null,
  product_name: null,
  size: null,
  full_name: null,
  phone: null,
  address: null,
};

function mapHistory(history = []) {
  return history
    .filter((message) => message?.text && message.role === 'user')
    .map((message) => ({
      role: 'user',
      content: message.text,
    }));
}

function wrapDecision(reply) {
  return {
    version: 'v1',
    reply,
    next_step: null,
    action: { type: 'none', payload: {} },
    collected_data: { ...EMPTY_COLLECTED_DATA },
    confidence: 'high',
  };
}

async function runPolicy(user, userMessage, context = {}, options = {}) {
  const history = mapHistory(context.history || []);
  const messages = [...history];
  const lastMessage = messages[messages.length - 1];

  if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await aiClient.sendMessage({
    messages,
    temperature: options.temperature ?? 0.3,
    maxTokens: options.maxTokens ?? 600,
  });

  const reply = String(response.text || '').trim();
  if (!reply) {
    throw new Error('AI returned empty response');
  }

  log.debug('policy.runPolicy: completed', {
    userId: user.id,
    replyLength: reply.length,
    historyCount: history.length,
  });

  return {
    rawOutput: reply,
    parsed: null,
    decision: wrapDecision(reply),
    validation: { valid: true, errors: [] },
  };
}

async function generateResponse(user, userMessage, context = {}) {
  const run = await runPolicy(user, userMessage, context);
  return run.decision.reply;
}

async function previewResponse(testMessage, scenario, userState = 'NEW') {
  const fakeUser = { id: 0, state: userState, name: 'Тест', telegram_id: 0 };
  return generateResponse(fakeUser, testMessage, { scenario, history: [] });
}

module.exports = {
  runPolicy,
  generateResponse,
  previewResponse,
};
