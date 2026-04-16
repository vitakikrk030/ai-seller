const aiClient = require('../ai/client');
const prompts = require('../db/prompts');
const log = require('../logger');

const EMPTY_COLLECTED_DATA = {
  product_ref: null,
  product_name: null,
  size: null,
  full_name: null,
  phone: null,
  address: null,
};

async function buildSystemPrompt(context = {}) {
  const corePrompt = await prompts.get('core_prompt').catch(() => '');
  const promptBase = (corePrompt || 'Ты AI-продавец в Telegram.').trim();
  const contextHints = [];

  if (context.scenario) {
    contextHints.push(`Scenario: ${String(context.scenario)}`);
  }
  if (context.order) {
    contextHints.push(`Order context: ${JSON.stringify(context.order)}`);
  }
  if (context.sensors) {
    contextHints.push(`Message context: ${JSON.stringify(context.sensors)}`);
  }

  return [
    promptBase,
    'Отвечай клиенту обычным человеческим сообщением.',
    'Не возвращай JSON, markdown, служебные пометки или объяснения для backend.',
    'Нужен только готовый текст ответа клиенту.',
    contextHints.length > 0 ? contextHints.join('\n') : null,
  ].filter(Boolean).join('\n\n');
}

function mapHistory(history = []) {
  return history
    .filter((message) => message?.text)
    .map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
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
  const systemPrompt = await buildSystemPrompt(context);
  const history = mapHistory(context.history || []);
  const messages = [{ role: 'system', content: systemPrompt }, ...history];
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
