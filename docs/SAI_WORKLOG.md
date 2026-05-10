# S.AI Worklog

## 2026-05-10 14:17:48 +03

Established the clean S.AI foundation after removing the old seller behavior.

What changed:

- Local project was cleaned to transport-only runtime.
- Server `/root/sai` was cleaned to transport-only runtime.
- Interface direction changed to Apple-like minimal UI.
- Current UI section is `Подключение`.
- Added four planned connection screens locally:
  - `Telegram`
  - `AI-модель`
  - `Логи`
  - `Тест-чат`
- Added local test-chat endpoint: `/api/test-chat`.
- Confirmed transport sends only the user message to the AI model.

Important decision:

- Project history, backups, and decisions must be tracked in repo files from now on.
- Every meaningful change should have a backup entry before deploy.

Verification:

- Local server runs on `http://127.0.0.1:3001/`.
- Server health previously verified as `mode: trunk`.

## 2026-05-10 16:43:00 +03

Added model loading for the `AI-модель` connection screen.

What changed:

- Added backend endpoint `GET /config/models`.
- Endpoint calls the configured operator `/models` API using current `ai_url` and `ai_key`.
- UI model field is now a select control.
- Added `Загрузить` button to fetch available models from the operator.
- Verified locally that the operator returns model ids, including `gemini-2.5-flash`.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-model-loader-20260510-164300.tgz`

## 2026-05-10 16:50:00 +03

Simplified the `Подключение` interface.

What changed:

- Removed the decorative transport diagram from the right side.
- Removed the duplicate connection summary block.
- Kept only the functional screen content for the selected tab.

Reason:

- These blocks did not carry real function at this stage and made the foundation screen heavier.

## 2026-05-10 16:58:57 +03

Polished the `Подключение` interface.

What changed:

- Panels no longer stretch to fill the whole page height.
- `Telegram` screen now shows current token status and webhook clearly.
- `Логи` screen has an internal scroll area.
- `Тест-чат` was redesigned as a simple readable chat for checking the AI transport.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-connect-ui-polish-20260510-165857.tgz`

## 2026-05-10 17:05:50 +03

Restyled the local `Подключение` interface using the provided visual reference.

What changed:

- Added a dark vertical icon rail.
- Added a secondary gray navigation sidebar.
- Moved Connect screens into the sidebar navigation.
- Restyled the main content area with gray translucent Apple-like panels.
- Kept the functional screens: Telegram, AI-модель, Логи, Тест-чат.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-reference-connect-layout-20260510-170550.tgz`

## 2026-05-10 17:34:48 +03

Simplified the local `Подключение` interface after the reference pass.

What changed:

- Removed non-working decorative controls from the left rail.
- Removed the decorative traffic dots.
- Removed unused future/sidebar sections.
- Tightened the layout so the interface is less scattered.
- Kept only the working sections:
  - `Telegram`
  - `AI-модель`
  - `Логи`
  - `Тест-чат`

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-connect-ui-simplify-20260510-172737.tgz`

## 2026-05-10 17:41:38 +03

Flattened the local `Подключение` interface one more step.

What changed:

- Removed one visual container level from the main workspace.
- Removed heavy shadows from the content area.
- Made the left rail and secondary sidebar narrower.
- Kept the same working sections and behavior.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-connect-ui-flat-20260510-174023.tgz`

## 2026-05-10 17:43:42 +03

Removed duplicate explanatory text from the local `Подключение` panels.

What changed:

- Removed repeated panel titles under the main page title.
- Removed non-functional panel descriptions.
- Kept the working fields, actions, logs, and test chat untouched.

## 2026-05-10 17:49:12 +03

Converted the local `Подключение` interface from section navigation to one compact page.

What changed:

- Removed the second sidebar completely.
- Removed tab switching for `Telegram`, `AI-модель`, `Логи`, and `Тест-чат`.
- Placed the four working connection blocks on one screen.
- Kept the left icon rail as the only global navigation.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-one-page-connect-20260510-174606.tgz`

## 2026-05-10 18:55:27 +03

Made the local `Подключение` interface responsive.

What changed:

- Added adaptive layout rules for desktop, low-height laptop screens, tablets, and phones.
- Desktop keeps two columns when space allows.
- Tablets switch to one column with scroll.
- Phones switch the left rail into a compact top bar.
- Chat and logs now resize by viewport instead of using one fixed desktop height.

Verification:

- Checked visually at `1280x720`, `834x1112`, `390x844`, and `320x740`.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-responsive-connect-20260510-184722.tgz`

## 2026-05-10 18:58:39 +03

Reordered blocks on the local `Подключение` screen.

What changed:

- Swapped `AI-модель` and `Тест-чат`.
- The top row is now `Telegram` + `Тест-чат`.
- The second row is now `AI-модель` + `Логи`.
- No backend behavior changed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-reorder-connect-blocks-20260510-185708.tgz`

## 2026-05-10 19:03:31 +03

Simplified secret fields on the local `Подключение` screen.

What changed:

- `Telegram` now has one `Токен Telegram` field instead of current/new token fields.
- `AI-модель` now has one `Ключ AI` field instead of current/new key fields.
- Clearing the field and saving removes the saved secret.
- Entering a new value and saving overwrites the saved secret.
- An unchanged redacted preview is not sent back, so saving other fields does not erase the secret.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-single-secret-fields-20260510-190005.tgz`

## 2026-05-10 19:07:44 +03

Removed the local screen header and connection indicator.

What changed:

- Removed the `Подключение` header text from the interface and code.
- Removed the top connection status pill from the interface and code.
- Removed JS writes to the deleted status element.
- Kept only the working blocks: `Telegram`, `Тест-чат`, `AI-модель`, `Логи`.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-remove-connect-header-20260510-190516.tgz`

## 2026-05-10 19:24:52 +03

Rebalanced the local foundation layout around the test chat.

What changed:

- Moved `Логи` under `AI-модель` in the left settings column.
- Made `Тест-чат` the large right-side working area.
- Kept `Telegram`, `AI-модель`, and `Логи` visually aligned as one left column.
- Kept responsive behavior for narrow screens.

Verification:

- Checked desktop and low-height desktop visually.
- Checked mobile layout visually.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-chat-dominant-layout-20260510-191640.tgz`

## 2026-05-10 19:31:16 +03

Tuned the local layout for MacBook Air 13.

What changed:

- Treated `1440x900` and `1280x720` as primary desktop targets.
- Made logs fill the remaining space under `AI-модель` instead of using a fixed height.
- Kept log action buttons visible on MacBook Air height.
- Preserved the large right-side test chat.

Verification:

- Checked visually at `1440x900`.
- Checked visually at `1280x720`.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-macbook-air-fit-20260510-192725.tgz`

## 2026-05-10 19:39:51 +03

Aligned the bottom controls of `Тест-чат` and `Логи`.

What changed:

- Added shared control height for chat input and log action row.
- Added shared gap between content boxes and their bottom controls.
- Kept chat input visible on MacBook Air height.
- Rechecked symmetry at `1440x900` and `1280x720`.

Verification:

- Checked visually at `1440x900`.
- Checked visually at `1280x720`.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-align-chat-log-footers-20260510-193630.tgz`

## 2026-05-10 19:50:07 +03

Made the lower bars of `Логи` and `Тест-чат` visually symmetrical.

What changed:

- Converted log actions into a full-width two-column bottom bar.
- Kept the chat input row on the same control height and gap system.
- Rechecked the layout at `1440x900` and `1280x720`.

Verification:

- Checked visually at `1440x900`.
- Checked visually at `1280x720`.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-symmetric-bottom-bars-20260510-194742.tgz`

## 2026-05-10 19:55:44 +03

Mirrored the lower controls of `Логи` against `Тест-чат`.

What changed:

- `Логи` bottom row now uses the same structure as chat: wide light control plus compact dark action.
- `Очистить` is now visually paired with `Отправить`.
- `Обновить` fills the remaining width like the chat input.

Verification:

- Checked visually in the local browser.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-mirror-log-chat-controls-20260510-195404.tgz`

## 2026-05-10 19:59:55 +03

Added minimal node status lights to the local foundation screen.

What changed:

- Added a small status light next to `Telegram`.
- Added a small status light next to `AI-модель`.
- Green means the node is configured.
- Red means the node is not configured.
- Status updates from `/config/status` without adding a separate status panel.

Verification:

- Checked visually in the local browser.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-node-status-indicators-20260510-195740.tgz`

## 2026-05-10 20:06:41 +03

Made `Telegram` and `AI-модель` settings collapsible.

What changed:

- `Telegram` settings are hidden by default and open from the node title.
- `AI-модель` settings are hidden by default and open from the node title.
- Status lights remain visible while settings are collapsed.
- `Логи` now get more reading space by default.

Verification:

- Checked collapsed state visually.
- Checked Telegram expand behavior visually.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-collapsible-settings-20260510-200236.tgz`

## 2026-05-10 20:20:22 +03

Upgraded the local test chat into a real session chat.

What changed:

- Added browser-side test session history.
- `/api/test-chat` now accepts recent history and sends it to the AI model.
- Test history is limited to the latest 20 messages.
- Added `Очистить` for the test chat session.
- Redesigned message bubbles with `Клиент` and `AI` labels.
- Added a temporary `Печатает...` bubble while waiting for AI.

Important boundary:

- This is test-chat session memory only.
- It is not seller memory and does not add hidden sales behavior.

Verification:

- Sent a name in the test chat.
- Asked the model to recall the name in the next message.
- The model answered using the previous test-chat context.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-test-chat-session-memory-20260510-201054.tgz`

## 2026-05-10 20:25:49 +03

Added micro metadata to test chat messages.

What changed:

- Each test chat bubble now shows date and time in small text.
- AI replies also show response latency in seconds.
- Pending AI bubbles keep metadata while waiting.

Verification:

- Sent a test message.
- Confirmed the user bubble shows time.
- Confirmed the AI bubble shows time and seconds.
- `node --check index.js` passed.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-test-chat-message-meta-20260510-202243.tgz`

## 2026-05-10 20:36:43 +03

Replaced text role labels in the test chat with compact avatars.

What changed:

- Removed visible `Клиент` and `AI` role text from message bubbles.
- Added compact circular avatars: `К` for client messages and `AI` for model replies.
- Kept accessible labels through `aria-label` and hover titles.
- Preserved micro date/time metadata and AI response latency.

Verification:

- Reloaded `http://127.0.0.1:3001/`.
- Sent a test message in the test chat.
- Confirmed two avatars and two metadata rows render in the chat.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-test-chat-avatars-20260510-203110.tgz`

## 2026-05-10 20:43:01 +03

Persisted the local test chat across page reloads.

What changed:

- Test chat messages are now saved in browser `localStorage`.
- Reloading `http://127.0.0.1:3001/` restores the last test chat session.
- The `Очистить` button clears both the visible chat and the saved local session.
- This is UI persistence for the testing polygon only, not hidden seller memory.

Verification:

- Sent a test message.
- Reloaded the page.
- Confirmed the chat still had two bubbles and the client message was visible.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-test-chat-local-persistence-20260510-203957.tgz`

## 2026-05-10 20:49:38 +03

Updated the left rail branding.

What changed:

- Replaced the placeholder `*` logo with compact `S.AI`.
- Replaced the home icon with a minimal connection/link icon.
- Updated the rail button accessible label to `Соединение`.

Verification:

- Reloaded `http://127.0.0.1:3001/`.
- Confirmed `S.AI` appears once and the connection button exists.
- Visually checked the rail in the browser.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-rail-brand-connection-icon-20260510-204533.tgz`

## 2026-05-10 21:00:00 +03

Added the PostgreSQL database foundation for Telegram conversations.

What changed:

- Added PostgreSQL dependency `pg`.
- Added local PostgreSQL cluster under `data/postgres/` on port `55432`.
- Added `.env` with local `DATABASE_URL`.
- Added `.gitignore` so `.env`, local database files, local PostgreSQL logs, and `node_modules/` are not tracked.
- Added migration `db/migrations/001_foundation.sql`.
- Added database module `db/postgres.js`.
- Added tables: `customers`, `chats`, `messages`, `events`, `ai_turns`, `schema_migrations`.
- Startup now connects to PostgreSQL when `DATABASE_URL` exists and applies migrations automatically.
- Telegram webhook now records customers, chats, incoming messages, outgoing messages, technical events, and AI turns when DB is ready.
- Added `/db/status`.
- Added visible `База` block in the local interface.
- Added database passport `docs/SAI_DATABASE.md`.
- Added a safe `{}` fallback for message raw payloads so DB writes do not fail when raw Telegram data is absent.
- Ran `npm audit fix` to clear the high-severity Axios advisory without `--force`.

Boundary:

- No seller prompts, products, orders, delivery, payments, or hidden AI behavior were added.
- This is the conversation/database foundation only.

Verification:

- `node --check index.js` passed.
- `require('./db/postgres')` loaded successfully.
- Local PostgreSQL started on `127.0.0.1:55432`.
- Database `sai` created.
- Migration `001_foundation` applied.
- `/health` reports `database.ready: true`.
- `/db/status` reports all foundation tables exist.
- Browser interface shows `База` as connected.
- Smoke-tested customer, chat, message, and AI-turn writes, then deleted the temporary test rows.
- `npm audit --omit=dev` reports `0` vulnerabilities.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-postgres-foundation-20260510-210133.tgz`

## 2026-05-10 23:25:00 +03

Deployed the PostgreSQL conversation foundation to the server.

What changed:

- Pushed commit `1dc32a2 Add PostgreSQL conversation foundation` to GitHub.
- Backed up server `/root/sai` before replacing it.
- Cloned the fresh repository into `/root/sai_new`.
- Preserved the live server `data/runtime-config.json`.
- Created PostgreSQL role/database for S.AI on the server.
- Added server-only `.env` with `DATABASE_URL`.
- Installed production dependencies on the server.
- Switched `/root/sai` to the new code.
- Restarted PM2 app `sai`.

Verification:

- PM2 app `sai` is online.
- Server `/health` reports `database.ready: true`.
- Server `/db/status` reports foundation tables exist.
- Server `/config/status` still shows Telegram and AI configured.
- Server migration table contains `001_foundation`.

Server backup before deploy:

- `/root/sai_backups/sai_before-postgres-foundation-20260510-2227.tgz`
- `/root/sai_backups/runtime-config-before-postgres-foundation-20260510-2227.json`

## 2026-05-11 00:08:00 +03

Added the CRM API foundation for the future hybrid AI chat/CRM.

What changed:

- Added migration `002_crm_api.sql`.
- Added visible chat-control fields to `chats`: `notes`, `priority`, `assigned_to`, `last_read_at`.
- Added CRM API endpoints:
  - `GET /api/crm/overview`
  - `GET /api/crm/chats`
  - `GET /api/crm/chats/:chatId`
  - `GET /api/crm/chats/:chatId/messages`
  - `GET /api/crm/chats/:chatId/ai-turns`
  - `GET /api/crm/chats/:chatId/events`
  - `PATCH /api/crm/chats/:chatId`
- Added pagination, filters, search, and AI/chat status controls for future CRM screens.

Boundary:

- No seller prompts, product logic, delivery logic, payment logic, or hidden AI behavior were added.
- This is API infrastructure for the future CRM/chat interface only.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-crm-api-20260511-000147.tgz`

Server deploy:

- Pushed commit `1343b16 Add CRM API foundation` to GitHub.
- Backed up server `/root/sai` before deploy.
- Pulled latest `main` on `/root/sai`.
- Restarted PM2 app `sai`.
- Confirmed migration `002_crm_api` is applied.

Server verification:

- `/health` reports `database.ready: true`.
- `/db/status` reports `customers`, `chats`, `messages`, `events`, and `ai_turns` exist.
- `/api/crm/overview` returns the real Telegram conversation totals.
- `/api/crm/chats?limit=5` returns the real Telegram chat.
- `/api/crm/chats/:chatId/messages`, `/ai-turns`, and `/events` return the recorded real dialog, AI turn, and trace events.

Server backup before deploy:

- `/root/sai_backups/sai_before-crm-api-20260511-0008.tgz`

## 2026-05-11 01:08:00 +03

Added the first `Диалоги` UI screen from the approved AI-inbox reference.

What changed:

- Added a second rail section: `Диалоги`.
- Kept `Соединение` as the transport settings section.
- Added a three-column hybrid CRM/chat layout:
  - left: dialog list with search and channel chips;
  - center: selected conversation;
  - right: client card, AI control, deal summary, notes, and events.
- Connected the screen to the CRM API:
  - `/api/crm/chats`;
  - `/api/crm/chats/:chatId`;
  - `/api/crm/chats/:chatId/messages`;
  - `/api/crm/chats/:chatId/ai-turns`;
  - `/api/crm/chats/:chatId/events`;
  - `PATCH /api/crm/chats/:chatId`.
- Added AI on/off control and notes saving for the selected chat.

Boundary:

- Manual reply is intentionally not active yet.
- No seller prompts, product logic, delivery logic, payment logic, or hidden AI behavior were added.

Verification:

- Reloaded `http://127.0.0.1:3001/`.
- Opened `Диалоги` from the rail.
- Confirmed no browser console errors.
- Confirmed empty-state layout is stable on the visible desktop viewport.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-dialogs-ui-20260511-005959.tgz`

Server deploy:

- Pushed commit `2e838fe Add dialogs CRM screen` to GitHub.
- Backed up server `/root/sai`.
- Pulled latest `main` on `/root/sai`.
- Restarted PM2 app `sai`.

Server verification:

- Server is on commit `2e838fe`.
- PM2 app `sai` is online.
- `/health` reports `database.ready: true`.
- `/api/crm/chats?limit=5` returns the real Telegram dialog.

Server backup before deploy:

- `/root/sai_backups/sai_before-dialogs-ui-20260511-0108.tgz`

## 2026-05-11 01:43:00 +03

Added live CRM updates through Server-Sent Events.

What changed:

- Added `GET /api/crm/live`.
- Added a lightweight in-memory SSE client list on the server.
- Server now emits live events for:
  - `message.created`;
  - `chat.updated`;
  - `ai.requested`;
  - `ai.replied`;
  - `ai.error`;
  - `telegram.sent`;
  - `error`.
- Telegram webhook emits live updates after incoming message recording.
- AI request/reply lifecycle emits live updates.
- Telegram outgoing message recording emits live updates.
- `PATCH /api/crm/chats/:chatId` emits `chat.updated`.
- The `Диалоги` screen subscribes to `/api/crm/live` through `EventSource`.
- The `Диалоги` screen shows a small live status pill and refreshes list/chat after live events.
- A slow 30-second fallback refresh remains as a safety net.

Boundary:

- This does not add seller prompts, product logic, delivery logic, payment logic, or hidden AI behavior.
- This only makes the CRM interface react immediately to transport events.

Verification:

- `node --check index.js` passed.
- Local `/health` reports ok.
- Local `/api/crm/live` returns the initial SSE `connected` event.
- Browser `Диалоги` screen shows live connection active.
- Browser console has no reported errors during the live check.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-crm-live-events-20260511-013036.tgz`
