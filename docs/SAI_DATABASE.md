# S.AI Database Foundation

Updated: 2026-05-10 21:00 +03

## Decision

Primary database: PostgreSQL.

Purpose right now: store Telegram conversations and transport diagnostics only.

Not included yet:

- products;
- orders;
- delivery logic;
- payment logic;
- seller prompts;
- hidden AI memory.

## Local Database

Local PostgreSQL cluster:

- data directory: `data/postgres/`
- port: `55432`
- database: `sai`
- user: `sai`
- connection string: `DATABASE_URL=postgres://sai@127.0.0.1:55432/sai`

The local data directory is ignored by git.

Commands:

- start: `npm run db:start`
- stop: `npm run db:stop`
- status: `npm run db:status`

## Schema

Migration file:

- `db/migrations/001_foundation.sql`

Tables:

- `customers` — Telegram people who write to S.AI.
- `chats` — Telegram conversations, AI toggle per chat, status, last activity.
- `messages` — incoming and outgoing message history.
- `events` — technical event stream: webhook, AI request, send, errors.
- `ai_turns` — exact model turn: request messages, response, latency, success/error.
- `schema_migrations` — applied migration versions.

## Runtime Behavior

On server startup:

1. `index.js` loads `.env`.
2. If `DATABASE_URL` exists, `db/postgres.js` connects to PostgreSQL.
3. Missing migrations are applied automatically.
4. `/health`, `/config/status`, and `/db/status` expose database status.

On Telegram webhook:

1. Customer is upserted into `customers`.
2. Chat is upserted into `chats`.
3. Incoming message is recorded in `messages`.
4. AI turn is recorded in `ai_turns`.
5. Outgoing Telegram reply is recorded in `messages`.
6. Technical events are mirrored into `events`.

If PostgreSQL is not configured or not ready, the transport still works and file logs remain active.
