const aiClient = require('../ai/client');
const { buildPolicyPrompt } = require('./prompt');
const { parsePolicyJson, validateDecision } = require('./schema');
const log = require('../logger');

async function runPolicy(user, userMessage, context, options = {}) {
  const systemPrompt = await buildPolicyPrompt(user, context);
  const history = (context.history || []).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.text,
  }));
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
    messages.push({ role: 'user', content: userMessage });
  }

  const response = await aiClient.sendMessage({
    messages,
    temperature: options.temperature ?? 0.2,
    maxTokens: options.maxTokens ?? 600,
  });
  const rawOutput = response.text || '';
  const parsed = parsePolicyJson(rawOutput);
  const validation = validateDecision(parsed, context);
  log.debug('policy.runPolicy: completed', {
    userId: user.id,
    rawLength: rawOutput.length,
    parsed: !!parsed,
    validationStatus: validation.valid ? 'passed' : 'failed',
    validationErrors: validation.errors,
    actionType: validation.decision?.action?.type || 'none',
    nextStep: validation.decision?.next_step || null,
    replyLength: (validation.decision?.reply || '').length,
  });

  return {
    rawOutput,
    parsed,
    decision: validation.decision,
    validation,
  };
}

async function generateResponse(user, userMessage, context = {}) {
  const run = await runPolicy(user, userMessage, context);
  return run.decision.reply;
}

async function previewResponse(testMessage, scenario, userState = 'NEW') {
  const fakeUser = { id: 0, state: userState, name: 'Тест', telegram_id: 0 };
  const context = {
    scenario,
    history: [],
    catalog: { products: [] },
    order: {
      user_state: userState,
      status: null,
      known: {},
      missing: ['product', 'size', 'full_name', 'phone', 'address'],
      next_operational_step: 'clarify_need',
      can_send_payment: false,
    },
    sensors: {
      intent: 'unknown',
      intent_confidence: 'low',
      extracted: {},
    },
  };
  const run = await runPolicy(fakeUser, testMessage, context);
  return run.decision.reply;
}

module.exports = {
  runPolicy,
  generateResponse,
  previewResponse,
};
