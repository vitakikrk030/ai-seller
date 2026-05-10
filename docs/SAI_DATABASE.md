# S.AI Database Foundation

Updated: 2026-05-11 00:08 +03

## Decision

Primary database: PostgreSQL.

Purpose right now: store channel conversations, AI turns, and transport diagnostics only.

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

- `customers` — people who write to S.AI through any supported channel. Telegram fields exist because Telegram is the first transport.
- `chats` — channel conversations, AI toggle per chat, status, priority, notes, last activity.
- `messages` — incoming and outgoing message history.
- `events` — technical event stream: webhook, AI request, send, errors.
- `ai_turns` — exact model turn: request messages, response, latency, success/error.
- `schema_migrations` — applied migration versions.

## CRM API Foundation

The CRM API is read-first and channel-neutral. It exists so the future hybrid chat/CRM interface can read the same data no matter which transport produced it.

Endpoints:

- `GET /api/crm/overview` — totals for chats, messages, AI turns, and channels.
- `GET /api/crm/chats` — paginated chat list with filters: `status`, `source`, `ai_enabled`, `q`, `limit`, `cursor`.
- `GET /api/crm/chats/:chatId` — one chat with customer summary.
- `GET /api/crm/chats/:chatId/messages` — paginated message history with filters: `direction`, `role`, `limit`, `cursor`.
- `GET /api/crm/chats/:chatId/ai-turns` — model turns for this chat.
- `GET /api/crm/chats/:chatId/events` — technical events connected through the chat trace ids.
- `PATCH /api/crm/chats/:chatId` — update visible chat controls: `status`, `ai_enabled`, `notes`, `priority`, `assigned_to`, `mark_read`.

Current allowed chat statuses:

- `open`
- `paused`
- `needs_human`
- `closed`
- `archived`

All list endpoints return:

```json
{
  "ok": true,
  "data": [],
  "page": {
    "limit": 30,
    "hasMore": false,
    "nextCursor": null
  }
}
```

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
