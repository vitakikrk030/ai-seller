#!/usr/bin/env node

require('dotenv').config();

const db = require('../db/postgres');

function normalizePhoneValue(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[^\d+]/g, '');
  if (!compact) return '';
  if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
  return compact.replace(/\D/g, '');
}

function extractPhoneFromText(text = '') {
  const match = String(text || '').match(/(\+?\d[\d()\-\s]{8,}\d)/);
  return match ? normalizePhoneValue(match[1]) : '';
}

function parsePaymentAmount(text = '') {
  const match = String(text || '').match(/сумма\s+к\s+оплате\s*:\s*([\d\s]+)\s*₽/i);
  if (!match) return null;
  const digits = Number(String(match[1] || '').replace(/[^\d]/g, ''));
  return Number.isFinite(digits) && digits > 0 ? digits : null;
}

function isPaymentTemplateText(text = '') {
  const joined = String(text || '').toLowerCase();
  return joined.includes('сумма к оплате')
    && joined.includes('реквизиты')
    && joined.includes('получатель');
}

function isReceiptLikeMessage(message = {}) {
  const text = String(message.text || '');
  if (/(перевел|перевела|оплатил|оплатила|чек|оплата прошла|сделал оплату|сделала оплату)/i.test(text)) {
    return true;
  }
  const raw = message.raw || {};
  const documentName = String(raw.document?.file_name || '').toLowerCase();
  return /(receipt|чек|pdf)/i.test(documentName);
}

function summarizeOrderSnapshot(snapshot = {}) {
  const parts = [];
  if (snapshot.product_interest) parts.push(snapshot.product_interest);
  if (snapshot.shoe_size) parts.push(`${snapshot.shoe_size} размер`);
  if (snapshot.clothing_size) parts.push(`${snapshot.clothing_size} размер`);
  if (snapshot.city) parts.push(snapshot.city);
  return parts.join(' · ').slice(0, 500);
}

async function backfillPhones() {
  const stats = { fromFacts: 0, fromMessages: 0 };

  const factRows = await db.query(`
    select customer_id, value
    from customer_facts
    where key in ('phone', 'phone_number', 'customer_phone')
      and coalesce(value, '') <> ''
  `);
  for (const row of factRows.rows) {
    const phone = normalizePhoneValue(row.value);
    if (!phone) continue;
    const updated = await db.updateCrmCustomer(row.customer_id, { phone });
    if (updated) stats.fromFacts += 1;
  }

  const messageRows = await db.query(`
    select distinct on (m.customer_id)
      m.customer_id,
      m.text,
      m.raw
    from messages m
    join customers c on c.id = m.customer_id
    where m.customer_id is not null
      and m.direction = 'in'
      and coalesce(c.phone, '') = ''
    order by m.customer_id, m.created_at desc, m.id desc
  `);

  for (const row of messageRows.rows) {
    const raw = row.raw || {};
    const phone = normalizePhoneValue(raw.contact?.phone_number || extractPhoneFromText(row.text));
    if (!phone) continue;
    const updated = await db.updateCrmCustomer(row.customer_id, { phone });
    if (updated) {
      await db.upsertCustomerFact(row.customer_id, 'phone', phone, 'backfill');
      stats.fromMessages += 1;
    }
  }

  return stats;
}

async function backfillOrders() {
  const chats = await db.query(`
    select id, customer_id, source
    from chats
    where customer_id is not null
    order by created_at asc, id asc
  `);

  const stats = {
    chats: chats.rowCount,
    drafts: 0,
    paid: 0,
  };

  for (const chat of chats.rows) {
    const messages = await db.query(`
      select id, chat_id, customer_id, direction, role, text, telegram_message_id, trace_id, raw, created_at
      from messages
      where chat_id = $1
      order by created_at asc, id asc
    `, [chat.id]);

    for (const message of messages.rows) {
      if ((message.direction === 'out' || message.role === 'operator') && isPaymentTemplateText(message.text)) {
        const snapshot = await db.getCustomerSnapshot(chat.customer_id);
        const orderId = await db.upsertOrderDraft({
          customerId: chat.customer_id,
          chatId: chat.id,
          source: chat.source || 'telegram',
          traceId: message.trace_id || null,
          totalAmount: parsePaymentAmount(message.text),
          currency: 'RUB',
          summary: summarizeOrderSnapshot(snapshot),
          snapshot,
          paymentMessageId: message.telegram_message_id || null,
        });
        if (orderId) stats.drafts += 1;
        continue;
      }

      if (message.direction === 'in' && isReceiptLikeMessage(message)) {
        const snapshot = await db.getCustomerSnapshot(chat.customer_id);
        const orderId = await db.markLatestOrderPaid({
          customerId: chat.customer_id,
          chatId: chat.id,
          traceId: message.trace_id || null,
          receiptMessageId: message.telegram_message_id || null,
          snapshotPatch: {
            ...snapshot,
            paid_confirmation_text: message.text || '',
          },
        });
        if (orderId) stats.paid += 1;
      }
    }
  }

  return stats;
}

async function main() {
  const init = await db.init();
  if (!init.ok) {
    throw new Error(init.error || 'DB init failed');
  }

  const phones = await backfillPhones();
  const orders = await backfillOrders();

  console.log(JSON.stringify({
    ok: true,
    phones,
    orders,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
  }, null, 2));
  process.exit(1);
});
