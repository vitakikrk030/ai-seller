#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const db = require('../db/postgres');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function loadTelegramToken() {
  const runtimeConfig = readJson(path.join(__dirname, '..', 'data', 'runtime-config.json'), {});
  return process.env.TELEGRAM_TOKEN
    || process.env.telegram_token
    || runtimeConfig.telegram_token
    || '';
}

const telegramToken = loadTelegramToken();

function telegramApi(method) {
  return `https://api.telegram.org/bot${telegramToken}/${method}`;
}

async function fetchTelegramAvatarFileId(userId) {
  if (!telegramToken || !userId) return { ok: false, fileId: '', reason: 'no_token_or_user' };
  try {
    const response = await axios.get(telegramApi('getUserProfilePhotos'), {
      timeout: 8000,
      params: {
        user_id: userId,
        limit: 1,
      },
    });
    const photoSizes = response.data?.result?.photos?.[0] || [];
    const bestPhoto = Array.isArray(photoSizes) ? photoSizes[photoSizes.length - 1] : null;
    return { ok: true, fileId: bestPhoto?.file_id || '' };
  } catch (error) {
    return { ok: false, fileId: '', reason: error.message };
  }
}

async function repairAvatars() {
  const customers = await db.query(`
    select id, telegram_user_id, display_name, avatar_file_id
    from customers
    where source = 'telegram'
      and telegram_user_id is not null
    order by updated_at desc
  `);

  let scanned = 0;
  let repaired = 0;
  let cleared = 0;
  let skipped = 0;

  for (const customer of customers.rows) {
    scanned += 1;
    const avatar = await fetchTelegramAvatarFileId(customer.telegram_user_id);
    if (!avatar.ok) {
      skipped += 1;
      continue;
    }
    const nextAvatar = avatar.fileId || '';
    const currentAvatar = String(customer.avatar_file_id || '');
    if (String(nextAvatar || '') === currentAvatar) continue;
    const updatedId = await db.setCustomerAvatar(customer.id, nextAvatar || null);
    if (!updatedId) continue;
    repaired += 1;
    if (!nextAvatar) cleared += 1;
  }

  return { scanned, repaired, cleared, skipped, token_loaded: Boolean(telegramToken) };
}

async function main() {
  const init = await db.init();
  if (!init.ok) throw new Error(init.error || 'DB init failed');
  const result = await repairAvatars();
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
