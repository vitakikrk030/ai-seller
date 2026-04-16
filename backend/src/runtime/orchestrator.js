const messages = require('../db/messages');
const policyRuns = require('../db/policy_runs');
const { runPolicy } = require('../policy');
const log = require('../logger');

const CHAT_TEMPERATURE = 0.7;
const CHAT_MAX_TOKENS = 1000;

async function processTurn(user, incoming) {
  const userMessage = incoming.text || (incoming.hasPhoto ? '[фото]' : '[пустое сообщение]');
  const history = await messages.getHistory(user.id, 20).catch(() => []);
  const run = await runPolicy(
    user,
    userMessage,
    {
      history,
      sensors: {
        has_photo: !!incoming.hasPhoto,
        message_id: incoming.messageId || null,
      },
    },
    {
      temperature: CHAT_TEMPERATURE,
      maxTokens: CHAT_MAX_TOKENS,
    }
  );

  const reply = String(run.decision.reply || '').trim();
  if (!reply) {
    throw new Error('AI returned empty response');
  }

  const execution = {
    order: null,
    actions: [{ type: 'ai_reply' }],
    outbox: [{ kind: 'reply', text: reply }],
  };

  log.debug('runtime.processTurn: ai relay completed', {
    userId: user.id,
    replyLength: reply.length,
    outboxCount: execution.outbox.length,
  });

  await policyRuns.create({
    user_id: user.id,
    order_id: null,
    mode: 'direct_ai',
    input_json: {
      incoming,
      history_count: history.length,
    },
    raw_output: run.rawOutput,
    decision_json: run.decision,
    validation_status: 'passed',
    validation_errors: [],
    backend_actions: execution.actions,
  }).catch(() => {});

  return {
    mode: 'direct_ai',
    decision: run.decision,
    validation: run.validation,
    execution,
  };
}

module.exports = {
  processTurn,
  CHAT_TEMPERATURE,
  CHAT_MAX_TOKENS,
};
