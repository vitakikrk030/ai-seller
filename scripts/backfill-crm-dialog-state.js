#!/usr/bin/env node

require('dotenv').config();

const db = require('../db/postgres');
const detector = require('../lib/crm-dialog-detector');

async function backfillDialogState() {
  const chatIds = await db.listChatIdsForDetection(10000);
  let scanned = 0;
  let updated = 0;
  const byDropStage = {};

  for (const chatId of chatIds) {
    scanned += 1;
    const input = await db.getDialogDetectionInput(chatId);
    if (!input) continue;
    const state = detector.buildState(input);
    await db.upsertDialogState(chatId, state);
    updated += 1;
    const key = state.drop_stage || 'none';
    byDropStage[key] = (byDropStage[key] || 0) + 1;
  }

  return { scanned, updated, byDropStage };
}

async function main() {
  const init = await db.init();
  if (!init.ok) throw new Error(init.error || 'DB init failed');
  const result = await backfillDialogState();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
