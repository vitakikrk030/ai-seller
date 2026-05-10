# S.AI Project Passport

Updated: 2026-05-10 21:00:00 +03

## Project Rule

Everything that changes AI behavior must be visible and controllable from the interface before it is used in production.

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
- Server sends the exact user message to the AI model.
- AI model returns a reply.
- Server sends the reply back to Telegram.
- PostgreSQL records Telegram customers, chats, messages, events, and AI turns when `DATABASE_URL` is configured.

No business behavior is active in this foundation.

## Active Runtime Files

- `index.js`
- `package.json`
- `package-lock.json`
- `.env.example`
- `.gitignore`
- `db/postgres.js`
- `db/migrations/001_foundation.sql`
- `node_modules/`
- `data/runtime-config.json`
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

Current visible section:

- `Подключение`

Planned screens inside `Подключение`:

- `Telegram`
- `AI-модель` with operator model list loaded from `/models`
- `База`
- `Логи`
- `Тест-чат`

## Change Discipline

For every meaningful change:

1. Create a backup before editing or deploying.
2. Record the change in `docs/SAI_WORKLOG.md`.
3. Record backup path in `docs/BACKUPS.md`.
4. Keep runtime behavior visible and explainable.
