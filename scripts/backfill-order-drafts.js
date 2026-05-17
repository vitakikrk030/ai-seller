#!/usr/bin/env node

require('dotenv').config();

const db = require('../db/postgres');
const { buildOrderDraftPayload } = require('../lib/order-draft-state');

function factMap(rows = []) {
  return Object.fromEntries((rows || []).map((row) => [String(row.key || ''), String(row.value || '')]));
}

async function backfillOrderDrafts() {
  const chats = await db.query(`
    select id, customer_id, source
    from chats
    where customer_id is not null
    order by updated_at desc nulls last, created_at desc
  `);

  let scanned = 0;
  let createdOrUpdated = 0;
  let skippedPaid = 0;

  for (const chat of chats.rows) {
    scanned += 1;
    const [facts, orders] = await Promise.all([
      db.getCustomerFacts(chat.customer_id),
      db.listCustomerOrders(chat.customer_id, 5),
    ]);
    const latestOrder = orders[0] || null;
    if (latestOrder?.status === 'paid') {
      skippedPaid += 1;
      continue;
    }

    const factsObject = factMap(facts);
    if (latestOrder?.total_amount && !factsObject.payment_amount) {
      factsObject.payment_amount = String(latestOrder.total_amount);
    }
    if (latestOrder?.status && !factsObject.order_status) {
      factsObject.order_status = latestOrder.status;
    }

    const payload = buildOrderDraftPayload({
      facts: factsObject,
      currentStage: factsObject.funnel_stage || '',
      paymentTemplateSent: latestOrder?.status === 'awaiting_payment',
      paymentAmount: latestOrder?.total_amount || null,
      paymentConfirmed: false,
    });

    const hasAnyData = Object.keys(payload.intentData).length || Object.keys(payload.deliveryData).length || Object.keys(payload.paymentData).length;
    if (!hasAnyData) continue;

    await db.upsertOrderDraftState({
      customerId: chat.customer_id,
      chatId: chat.id,
      source: chat.source || 'telegram',
      status: payload.status,
      currentStep: payload.currentStep,
      intentDataPatch: payload.intentData,
      deliveryDataPatch: payload.deliveryData,
      paymentDataPatch: payload.paymentData,
      metaPatch: payload.meta,
      lockedAfterPayment: payload.status === 'paid',
    });
    createdOrUpdated += 1;
  }

  return { scanned, createdOrUpdated, skippedPaid };
}

async function main() {
  const init = await db.init();
  if (!init.ok) throw new Error(init.error || 'DB init failed');
  const result = await backfillOrderDrafts();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
