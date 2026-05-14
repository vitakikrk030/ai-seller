# S.AI Project Passport

Updated: 2026-05-13 00:05:00 +03

## Project Rule

Everything that changes AI behavior must be visible and controllable from the interface before it is used in production.

`AI продавец` / AI Control is the source of truth for the AI seller.

## Supreme AI Control Rule

AI seller behavior must never be hardcoded.

The only allowed source of AI seller behavior is `AI продавец` / AI Control and the database/config records managed by that interface.

This rule applies to:

- system prompts;
- role/persona text;
- tone of voice;
- sales psychology;
- memory and context rules;
- product/order handling rules;
- size, delivery, payment, return, trust, and objection rules;
- examples and training snippets;
- forbidden phrases;
- fallback behavior;
- response guards and rewrite rules;
- any future channel-specific behavior.

Code may only transport, store, validate, assemble, and execute visible settings.
Code must not secretly decide how the AI seller sells, persuades, greets, remembers, filters, rewrites, or answers.

When the AI seller is connected to production, every behavior-changing setting from AI Control must affect the compiled AI request exactly through the visible compiler/inspector path.

If a behavior rule is not visible in AI Control, it must not affect production replies.

Current state is intentionally minimal: this project is only the transport foundation.

## Current Foundation

Runtime mode: `trunk`

Active path:

- Local: `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5`
- Server: `/root/sai`
- PM2 app: `sai`
- Port: `3001`

Current transport:

- Telegram webhook receives client messages.
- Prompt compiler reads visible AI Control settings, customer memory, and chat history (50 messages) to build the AI request.
- AI model returns structured JSON response: reply[], facts, stage, decision, needs_human.
- Server handles decision: reply / wait / skip / escalate.
- Extracted facts are saved to customer_facts table.
- Funnel stage is tracked per customer.
- Reply messages are sent via humanized sending: read delay, typing simulation (proportional to text length), pauses between messages.
- PostgreSQL records channel customers, chats, messages, events, AI turns, and customer facts when `DATABASE_URL` is configured.
- CRM API exposes conversations for the hybrid chat/CRM interface.
- CRM live events push chat updates to the interface through Server-Sent Events.
- CRM can show Telegram customer avatars through a safe server proxy.
- CRM can show Telegram media through a safe server proxy.
- CRM message bubbles show factual delivery state: `получено` for incoming, `отправлено` for outgoing after Telegram accepts the send.
- CRM shows `AI печатает` from the real AI request lifecycle and last client activity from stored chat timestamps.
- CRM can send manual Telegram replies from the interface.
- CRM manual replies are stored as operator messages in PostgreSQL.
- Test chat (Polygon) uses the same compiler as production Telegram webhook.

AI agent behavior is compiled ONLY from visible AI Control settings.

## Active Runtime Files

- `index.js`
- `package.json`
- `package-lock.json`
- `.env.example`
- `.gitignore`
- `db/postgres.js`
- `db/migrations/001_foundation.sql`
- `db/migrations/002_crm_api.sql`
- `db/migrations/003_customer_avatars.sql`
- `db/migrations/004_customer_facts.sql`
- `node_modules/`
- `data/runtime-config.json`
- `data/ai-seller-control.json`
- `data/postgres/` local runtime database directory, ignored by git
- `logs/runtime.jsonl`
- `public/index.html`

## Runtime Config Keys

Only transport keys are allowed in `data/runtime-config.json`:

- `telegram_token`
- `webhook_url`
- `ai_key`
- `ai_url`
- `model`
- `auto_reply_enabled`
- `read_delay_ms` (humanized sending, default: 1500)
- `typing_speed_cps` (humanized sending, default: 30)
- `between_messages_delay_ms` (humanized sending, default: 2000)

## Database Foundation

Primary database: PostgreSQL.

Current database scope:

- `customers`;
- `chats`;
- `messages`;
- `events`;
- `ai_turns`.

Visible status:

- `/db/status`;
- `/api/crm/overview`;
- `/api/crm/chats`;
- `/api/crm/chats/:chatId`;
- `/api/crm/chats/:chatId/messages`;
- `/api/crm/chats/:chatId/ai-turns`;
- `/api/crm/chats/:chatId/events`;
- `/api/crm/live`;
- `/api/telegram/avatar/:fileId`;
- `/api/telegram/file/:fileId`;
- `База` block in the local interface.

Full database passport:

- `docs/SAI_DATABASE.md`

## Disabled / Removed By Design

The current foundation must not contain hidden behavior layers:

- no sales logic
- no system prompts
- no memory layer
- no response guards
- no order flow
- no delivery flow
- no payment flow
- no training examples
- no hidden rewrite filters

## Interface Direction

UI style: Apple-like minimal interface.

Current visible sections:

- `Подключение`
- `Диалоги`
- `AI продавец`

Working screens inside `Подключение`:

- `Telegram`
- `AI-модель` with operator model list loaded from `/models`
- `База`
- `Логи`
- `Тест-чат`

Working screen `Диалоги`:

- conversation list from `/api/crm/chats`;
- channel filters for `Все`, `Telegram`, `VK`, `MAX`;
- search by customer and message text;
- selected chat messages from `/api/crm/chats/:chatId/messages`;
- selected customer card with visible Telegram/customer identity fields;
- editable customer phone through `/api/crm/customers/:customerId`;
- manual reply to Telegram through `/api/crm/chats/:chatId/send`;
- compact emoji picker for manual replies;
- media rendering for Telegram photo, video, audio, voice, sticker, and document files;
- live updates from `/api/crm/live`.

Working screen `AI продавец`:

- visible AI Control screen structured by the classic sales funnel;
- edits and saves seller-agent rules from `data/ai-seller-control.json` version 2;
- exposes those rules through `/api/ai-seller/control`;
- visible tabs: `Воронка`, `Основа агента`, `Память`, `Возражения`, `Инспектор`, `Полигон`;
- visible funnel stages: first touch, interest, trust, decision, checkout, post-payment support, return/conflict;
- each funnel stage has editable goal, actions, questions, objections, forbidden behavior, examples, and human handoff rules;
- visible foundation blocks for store model, live-manager style, replica honesty, prepayment, and return;
- visible memory, objection, inspector, and polygon blocks;
- production status now shows the real runtime state from `/api/ai-seller/control`;
- AI seller runtime/compiler is connected to production Telegram replies when global auto-reply is enabled;
- Test chat (Polygon) uses the same visible AI Control compiler path;
- compiled prompts, memory summary, input text, structured response, latency, and history length are stored in `ai_turns`;
- AI seller behavior must continue to come only from visible AI Control settings and database/config records managed by the interface.

Removed from CRM by design:

- deal block;
- notes block;
- event timeline block;
- AI control block;
- manual refresh button;
- take-over button;
- extra filter toolbar.

Reason:

- CRM is now a monitoring and manual-reply surface.
- AI seller behavior must be managed only from the future `AI продавец` / AI Control section.

## AI Seller Readiness

Current status: foundation ready, AI seller control screen visible, editable seller rules saved, AI seller behavior not yet implemented.

Ready:

- Telegram transport;
- AI connector;
- PostgreSQL conversation memory storage;
- CRM monitoring;
- manual Telegram reply from CRM;
- live CRM updates;
- runtime event logging;
- backup discipline.

Not active yet:

- AI seller saved settings;
- prompt compiler;
- visible behavior modules;
- DB history injection into AI requests;
- sales psychology;
- product/order rules;
- delivery, payment, return, size, trust, and objection rules.

Full AI readiness document:

- `docs/SAI_AI_READINESS.md`

Seller brain design source:

- `docs/SAI_SELLER_BRAIN.md`

## Change Discipline

For every meaningful change:

1. Create a backup before editing or deploying.
2. Record the change in `docs/SAI_WORKLOG.md`.
3. Record backup path in `docs/BACKUPS.md`.
4. Keep runtime behavior visible and explainable.
