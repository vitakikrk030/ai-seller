const messages = require('../db/messages');
const policyRuns = require('../db/policy_runs');
const settings = require('../db/settings');
const shop = require('../shop');
const { collectSensors } = require('../sensors');
const { runPolicy } = require('../policy');
const { buildOrderContext } = require('../domain/order_service');
const { reconcileInboundSignals, executeDecision } = require('../actuators');

async function processTurn(user, incoming) {
  const userMessage = incoming.text || (incoming.hasPhoto ? 'Клиент отправил фото' : '');
  const [history, catalog] = await Promise.all([
    messages.getHistory(user.id, 15).catch(() => []),
    shop.getCatalog().catch(() => ({ available: false, status: 'api_error', products: [] })),
  ]);

  const sensors = await collectSensors({
    user,
    text: userMessage,
    history,
    catalog,
    hasPhoto: incoming.hasPhoto,
  });

  let orderContext = await buildOrderContext(user, sensors);
  const preExecution = await reconcileInboundSignals(user, incoming, orderContext, sensors);
  orderContext = await buildOrderContext(user, sensors);

  const mode = await settings.get('policy_mode').catch(() => 'primary') || 'primary';
  const policyContext = {
    history,
    catalog,
    sensors,
    order: orderContext,
  };
  const run = await runPolicy(user, userMessage, policyContext, { mode });

  let execution = {
    order: preExecution.order || orderContext.order,
    actions: [...preExecution.actions],
    outbox: run.decision.reply ? [{ kind: 'reply', text: run.decision.reply }] : [],
  };

  if (mode === 'primary') {
    const primaryExecution = await executeDecision(user, run.decision, orderContext, sensors);
    execution = {
      order: primaryExecution.order || execution.order,
      actions: [...preExecution.actions, ...primaryExecution.actions],
      outbox: primaryExecution.outbox,
    };
  } else {
    execution.actions.push({ type: 'shadow_mode_no_actuators' });
  }

  const policyLoggingEnabled = (await settings.get('policy_logging_enabled').catch(() => 'true')) !== 'false';
  if (policyLoggingEnabled) {
    await policyRuns.create({
      user_id: user.id,
      order_id: execution.order?.id || orderContext.order_id || null,
      mode,
      input_json: {
        incoming,
        sensors,
        order: orderContext,
        catalog_status: catalog.status,
      },
      raw_output: run.rawOutput,
      decision_json: run.decision,
      validation_status: run.validation.valid ? 'passed' : 'failed',
      validation_errors: run.validation.errors,
      backend_actions: execution.actions,
    }).catch(() => {});
  }

  return {
    mode,
    sensors,
    orderContext,
    decision: run.decision,
    validation: run.validation,
    execution,
  };
}

module.exports = {
  processTurn,
};
