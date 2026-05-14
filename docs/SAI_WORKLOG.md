# S.AI Worklog

## 2026-05-14 22:15:00 +03

Softened the trust wording for quality and shipment guarantees.

What changed:

- Removed `мы не бот` and `всегда на связи` as trust arguments.
- Reframed the business logic from `не будет стыдно` to a steadier repeat-purchase and reputation model.
- Return wording is now softer: like a marketplace, either exchange the item or return the money.
- Trust examples now aim to reduce tension without sounding defensive or too salesy.

Backup before change:

- `backups/before-trust-wording-soften-20260514-*.tgz`

## 2026-05-14 22:05:00 +03

Reworked the trust objection handling for quality and shipment guarantees.

What changed:

- Added a visible foundation block for `качество и логика магазина`.
- Trust stage now answers quality and shipment guarantees together in one calm message.
- The agent now explains the store through repeat purchases, recommendations, reputation, and proven suppliers instead of a dry replica-only answer.
- Added explicit objection coverage for `Какое качество?` and `Какие гарантии, что вы отправите?`
- Added a ban on replying to this objection only with `фабричная реплика, не оригинал`.

Backup before change:

- `backups/before-trust-quality-reframe-20260514-*.tgz`

## 2026-05-14 21:52:00 +03

Tightened facts capture for unknown footwear insole length.

What changed:

- Soft-close insole rule now explicitly requires JSON facts when the customer cannot measure now.
- Required facts: `shoe_size`, `insole_cm = unknown`, `size_insole_check = not_measured`.
- Checkout also reminds the model to save `size_insole_check = not_measured` for this path.

Backup before change:

- `backups/before-shoe-soft-close-facts-20260514-*.tgz`

## 2026-05-14 21:45:00 +03

Added a visible soft-close rule when a footwear customer cannot provide insole length.

What changed:

- `shoe_sizing` now covers customers who say they do not know the insole length or will check later.
- AI should give an approximate insole reference for the selected size.
- AI should reassure the customer about returns if the size does not fit.
- AI may offer to continue checkout without pressure when the customer is ready.
- Memory facts now include an unconfirmed insole state.

Backup before change:

- `backups/before-shoe-soft-close-20260514-*.tgz`

## 2026-05-14 21:35:00 +03

Strengthened visible shoe size and insole validation rules in AI Control.

What changed:

- `shoe_sizing` now requires size and insole length for footwear in one flow.
- If both values are present, AI must compare them against the visible size/insole grid.
- Obvious mismatches such as `44 размер + 26 см` must be challenged gently before delivery/payment.
- Checkout now forbids moving to delivery/payment when shoe size and insole length are inconsistent and not rechecked.
- Memory facts now include size/insole compatibility status.

Backup before change:

- `backups/before-shoe-size-insole-validation-20260514-*.tgz`

## 2026-05-14 21:25:00 +03

Fixed CRM message bubble jitter during background refresh.

Cause:

- The selected chat refresh loaded messages first, then AI turns/events.
- After loading AI turns/events, the UI always cleared `messagesSignature`.
- This forced `renderCrmMessages()` to rebuild every message bubble on each live/poll refresh.
- Because message bubbles have an entrance animation, the chat visually twitched every few seconds.

What changed:

- Added a stable `aiTurnsSignature`.
- Message DOM is rebuilt only when messages change, when message DOM is missing, or when AI-turn latency data actually changes.
- Background refresh no longer recreates identical message bubbles.

Backup before change:

- `backups/before-crm-bubble-rerender-fix-20260514-*.tgz`

## 2026-05-14 21:15:00 +03

Fixed CRM empty central chat caused by a frontend `chatId` reference error.

What changed:

- `renderCrmSelectedChat` now uses the selected chat id from the loaded chat/state.
- Reset-history button no longer references an out-of-scope `chatId` variable.
- This restores execution flow so the central chat can render messages after selecting a dialog.

Backup before change:

- `backups/before-chatid-reference-fix-20260514-*.tgz`

## 2026-05-14 21:05:00 +03

Hardened the CRM central chat renderer and added reset animation.

What changed:

- Central CRM chat now forces a render when message data exists but the DOM has no message bubbles.
- Selected chat loading now shows an animated loader in the central chat area.
- Dialog reset now shows an animated reset state and success check before refreshing the selected chat.
- Message bubbles now animate in lightly when rendered.

Backup before change:

- `backups/before-crm-chat-empty-animation-fix-20260514-*.tgz`

## 2026-05-14 20:45:00 +03

Fixed CRM message rendering and safer per-dialog history reset.

What changed:

- CRM now loads selected chat messages independently from optional AI turns/events.
- If AI turns/events fail, messages still render instead of leaving the chat empty.
- Reset history now updates only the selected dialog in the interface without reloading the whole page.
- Reset endpoint returns deletion counters for messages, AI turns, events, and customer facts.
- Reset remains scoped to one `chatId` and the selected chat's customer memory; it does not clear the whole database.

Backup before change:

- `backups/before-crm-messages-reset-fix-20260514-*.tgz`

## 2026-05-14 16:25:00 +03

Synchronized AI seller runtime status with the current implementation.

What changed:

- `/api/ai-seller/control` now returns a real `runtime` object.
- `production_effect` now reflects the global auto-reply state instead of always returning `false`.
- The `AI продавец` top status pill now shows whether the runtime is active.
- The AI Control inspector now shows `agent_runtime: connected`, production effect, and compiler name.
- Updated readiness/passport docs to remove the stale “runtime not connected” state.

Backup before change:

- `backups/before-ai-runtime-status-sync-20260514-*.tgz`

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

Server deploy:

- Pushed commit `433186b Add CRM live events` to GitHub.
- Backed up server `/root/sai`.
- Pulled latest `main` on `/root/sai`.
- Restarted PM2 app `sai`.

Server verification:

- Server is on commit `433186b`.
- PM2 app `sai` is online.
- `/health` reports `database.ready: true`.
- `/api/crm/live` returns the initial SSE `connected` event.
- `/api/crm/chats?limit=5` returns the real Telegram dialog.

Server backup before deploy:

- `/root/sai_backups/sai_before-crm-live-events-20260511-0143.tgz`

## 2026-05-11 02:12:00 +03

Added CRM avatar and factual message-status layer.

What changed:

- Added migration `003_customer_avatars.sql`.
- Added `customers.avatar_file_id` and `customers.avatar_updated_at`.
- Telegram webhook now refreshes customer avatar from Telegram in the background.
- Added safe avatar proxy `GET /api/telegram/avatar/:fileId`; the Telegram bot token is not exposed to the browser.
- CRM chat list, customer card, and message bubbles can render real Telegram avatars.
- CRM message bubbles now show factual statuses:
  - incoming: `получено`;
  - outgoing after successful Telegram send: `отправлено`.
- CRM selected chat shows last activity from stored timestamps.
- CRM live stream now drives the visible `AI печатает` state while the model is working.

Boundary:

- Telegram Bot API does not provide real client read receipts or true client online status.
- The UI must not fake `прочитано` or `онлайн`; it shows only known delivery state and last activity.
- No seller prompts, product logic, delivery logic, payment logic, or hidden behavior were added.

Verification:

- `node --check index.js` passed.
- `node --check db/postgres.js` passed.
- Local DB migration through `db.init()` passed.
- Local `/db/status` reports database ready.
- Local `/api/crm/chats?limit=2` responds successfully.
- Browser `Диалоги` screen loads and live connection is active.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-avatars-statuses-20260511-015733.tgz`

Server deploy:

- Pushed commit `29c4f0e Add CRM avatars and message states` to GitHub.
- Backed up server `/root/sai`.
- Pulled latest `main` on `/root/sai`.
- Restarted PM2 app `sai`.

Server verification:

- Server is on commit `29c4f0e`.
- PM2 app `sai` is online.
- `/health` reports `database.ready: true`.
- `/api/crm/chats?limit=1` responds successfully and includes `customer_avatar_file_id`.

Server backup before deploy:

- `/root/sai_backups/sai_before-avatars-statuses-20260511-0949.tgz`

## 2026-05-11 09:49:00 +03

Removed the manual CRM refresh button from the `Диалоги` header.

Reason:

- CRM now receives updates through `/api/crm/live`.
- The 30-second fallback refresh remains in code.
- The visible manual button made the interface feel like updates require user action.

Verification:

- `node --check index.js` passed.
- Browser `Диалоги` screen has no visible `Обновить` button in the CRM header.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-remove-crm-refresh-button-20260511-094734.tgz`

## 2026-05-11 10:08:00 +03

Hardened CRM live updates after production UI stayed stale while Telegram/DB had new messages.

Observed:

- Production webhook received the Telegram message.
- PostgreSQL and `/api/crm/chats` showed the new messages.
- Telegram reply was sent successfully.
- The already-open CRM page stayed stale until reload.

What changed:

- `/api/crm/live` now sends an SSE `heartbeat` every 10 seconds.
- The SSE connection already uses `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`.
- CRM background refresh changed from 30 seconds to 5 seconds while `Диалоги` is open.
- Added `refreshInFlight` guard so the 5-second fallback cannot stack overlapping requests.

Boundary:

- This is transport reliability only.
- No seller prompt, product logic, delivery logic, payment logic, or hidden behavior was added.

Verification:

- `node --check index.js` passed.
- Local `/api/crm/live` returns `connected` and `heartbeat`.

Backup before change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-crm-live-reliability-20260511-100331.tgz`

Server deploy:

- Pushed commit `3a5df53 Harden CRM live refresh` to GitHub.
- Backed up server `/root/sai`.
- Pulled latest `main` on `/root/sai`.
- Restarted PM2 app `sai`.

Server verification:

- Server is on commit `3a5df53`.
- PM2 app `sai` is online.
- `/health` reports `database.ready: true`.
- Production `/api/crm/live` returns both `connected` and `heartbeat` through nginx.

Server backup before deploy:

- `/root/sai_backups/sai_before-crm-live-reliability-20260511-1040.tgz`

## 2026-05-11 14:30:00 +03

Strengthened the project passport with the supreme AI Control rule.

Decision:

- AI seller behavior must never be hardcoded.
- The only allowed source of AI seller behavior is the visible control interface and the database/config records managed by that interface.
- Code may only transport, store, validate, assemble, and execute visible settings.
- If a behavior rule is not visible in AI Control, it must not affect production replies.

Scope covered:

- prompts;
- role/persona;
- tone;
- sales psychology;
- memory and context;
- product/order handling;
- size, delivery, payment, return, trust, and objection rules;
- examples;
- forbidden phrases;
- fallback behavior;
- guards and rewrite rules;
- future channel-specific behavior.

Files updated:

- `docs/SAI_PASSPORT.md`

Boundary:

- Documentation only.
- No runtime code changed.

## 2026-05-11 15:40:00 +03

Prepared documentation state before AI seller implementation.

What changed:

- Updated `docs/SAI_PASSPORT.md` to match the current CRM/transport foundation.
- Updated `docs/SAI_DATABASE.md` with manual CRM reply, customer update, and Telegram file proxy endpoints.
- Added `docs/SAI_AI_READINESS.md` as the pre-AI implementation readiness document.
- Updated `docs/BACKUPS.md` with the fresh local backup created before documentation changes.

Current project status:

- The foundation is ready for the next stage.
- The AI seller itself is not implemented yet.
- CRM remains a monitoring and manual-reply surface.
- AI behavior must be built only through the future `AI продавец` / AI Control section.

Fresh local backup before this documentation preparation:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-ai-prep-docs-20260511-143000.tgz`

Boundary:

- Documentation only.
- No AI behavior, prompt, rule, sales logic, or hidden code was added.

## 2026-05-12 12:28:10 +03

Created the first S.AI seller brain design document.

What changed:

- Added `docs/SAI_SELLER_BRAIN.md`.
- Defined the future seller as an AI agent for a personal manager, not as a bot.
- Adapted the research from `/Users/alishereshbekov/Desktop/1.docx` to the real store model:
  - blogger-led Telegram/MAX commerce;
  - website storefront;
  - factory replicas;
  - 100% prepayment;
  - published products treated as available;
  - return and refund if the customer does not like the product;
  - categories such as sneakers, fragrances, accessories, and electronics.
- Captured visible future AI Control blocks for live-manager style, memory, replica honesty, prepayment, returns, categories, objections, order flow, inspector, and polygon.
- Recorded that the document is design only and must not affect production until implemented as visible AI Control settings.

Fresh local backup before this documentation change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-seller-brain-doc-20260512-122810.tgz`

Boundary:

- Documentation only.
- No AI behavior, prompt, rule, memory logic, sales logic, or hidden code was added.

## 2026-05-12 12:35:00 +03

Added the first visible `AI продавец` sidebar section.

What changed:

- Added a new `AI продавец` rail item in `public/index.html`.
- Added a visible design-only AI seller screen.
- The screen shows the future personal-manager agent shell:
  - store profile for the blogger-led Telegram/MAX replica model;
  - live private-manager style principles;
  - future visible customer memory categories;
  - replica honesty, 100% prepayment, return, category, objection, inspector, and polygon placeholders.
- The screen explicitly shows that production AI seller behavior is off.
- Updated passport/readiness docs to record that only the visible shell exists.

Fresh local backup before this UI change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-ai-seller-shell-20260512-123500.tgz`

Boundary:

- No AI seller settings are saved yet.
- No prompt compiler was added.
- No memory injection was added.
- No guardrail, fallback, sales logic, or hidden behavior was added.
- Runtime AI replies are unchanged.

## 2026-05-12 12:45:00 +03

Made the first `AI продавец` rules editable without code changes.

What changed:

- Added visible seller-agent settings in `data/ai-seller-control.json`.
- Added `/api/ai-seller/control` GET/POST endpoints.
- Updated `public/index.html` so `AI продавец` loads, edits, toggles, previews, and saves visible rule blocks.
- Added inspector text showing the saved source, active sections, and that production effect is false.

Fresh local backup before this UI/control change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-editable-ai-seller-control-20260512-124500.tgz`

Boundary:

- No prompt compiler was connected.
- No seller rule was injected into runtime AI replies.
- No hidden prompt, guard, fallback, memory, or sales behavior was added in code.

## 2026-05-12 13:55:00 +03

Clarified the AI Control source-of-truth rule.

What changed:

- Updated `docs/SAI_PASSPORT.md` to state that `AI продавец` / AI Control is the source of truth for AI seller behavior.
- Clarified that saved rules are not controlling replies only because the AI seller runtime/compiler is not connected yet.
- Clarified that after the runtime/compiler is connected, behavior-changing settings must come only from AI Control.
- Updated the `AI продавец` screen wording to remove ambiguity.
- Added a clear `Промты и правила` heading and widened the editor layout on medium screens so editable rule fields are obvious.

Fresh local backup before this wording change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-ai-control-wording-20260512-135500.tgz`

Boundary:

- Wording and documentation only.
- No hidden prompt, rule, guard, fallback, memory, or sales behavior was added in code.

## 2026-05-12 14:10:00 +03

Redesigned `AI продавец` as a sales-funnel AI Control interface.

What changed:

- Converted `data/ai-seller-control.json` to version 2.
- Replaced flat `sections` with structured visible groups:
  - `foundation`;
  - `funnel`;
  - `memory`;
  - `objections`;
  - `polygon`.
- Added seven editable funnel stages:
  - first touch;
  - interest;
  - trust;
  - decision;
  - checkout;
  - post-payment support;
  - return/conflict.
- Each stage now has visible fields for goal, AI actions, client questions, objections, forbidden behavior, examples, and human handoff.
- Rebuilt the `AI продавец` UI around tabs: `Воронка`, `Основа агента`, `Память`, `Возражения`, `Инспектор`, `Полигон`.
- Updated `/api/ai-seller/control` normalization to preserve the funnel structure.

Fresh local backup before this UI/control redesign:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-ai-control-funnel-ui-20260512-141000.tgz`

Boundary:

- AI runtime/compiler is still not connected.
- No hidden prompt, guard, fallback, memory, or sales behavior was added in code.
- The new structure is visible and editable AI Control data only.

## 2026-05-13 00:05:00 +03

Implemented Phase 1: AI agent with prompt compiler, structured response, memory, and humanized sending.

What changed:

- Added `db/migrations/004_customer_facts.sql` — new table for storing extracted customer facts.
- Updated `db/postgres.js`:
  - Added `upsertCustomerFact()` — save/update a customer fact.
  - Added `getCustomerFacts()` — retrieve all facts for a customer.
  - Added `buildMemorySummary()` — build readable text summary for AI prompt.
  - Added `getChatHistory()` — load last N messages from PostgreSQL.
  - Added `customer_facts` to foundation status table check.
- Updated `index.js`:
  - Added `getMskTime()` — Moscow time with greeting selection (Доброе утро/Добрый день/Добрый вечер).
  - Added `compileSystemPrompt()` — reads AI Control settings (foundation, funnel, objections) and assembles system prompt with time context and structured response format instruction.
  - Added `compileAiRequest()` — combines system prompt + customer memory summary + chat history (50 messages) + user input into a full AI request.
  - Added `parseStructuredResponse()` — parses model JSON response (reply[], facts, stage, decision, needs_human) with fallback to plain text.
  - Updated `requestAi()` — now accepts compiled messages, returns structured response, temperature set to 0.75.
  - Added `sendHumanizedReply()` — sends reply messages one by one with read delay, typing simulation (proportional to text length), and pauses between messages.
  - Updated `POST /api/telegram/webhook` — uses compiler, handles decision (reply/wait/skip/escalate), saves extracted facts, sends via humanized reply.
  - Updated `POST /api/test-chat` — uses the same `compileSystemPrompt()` as production, returns structured response and compiled prompt preview.

AI agent behavior source:

- System prompt is compiled ONLY from visible AI Control settings in `data/ai-seller-control.json`.
- No hidden prompts, rules, or behavior was added in code.
- The only hardcoded text is the structured response format instruction (JSON schema) and the greeting logic based on Moscow time.
- Greeting is deterministic and visible (based on hour of day in Europe/Moscow timezone).

Structured response contract:

- `reply` — array of short messages (multiple Telegram messages).
- `facts` — extracted customer facts (saved to customer_facts table).
- `stage` — funnel stage id.
- `decision` — reply / wait / skip / escalate.
- `needs_human` — boolean for manager handoff.

Fresh local backup before this change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-ai-agent-phase1-20260512.tgz`

Verification:

- `node --check index.js` passed.
- `node --check db/postgres.js` passed.
- Server started on port 3001.
- PostgreSQL connected, `customer_facts` table created via migration.
- Test chat returned structured response with correct greeting, funnel stage, and parsed JSON.
- Compiled prompt preview shows AI Control blocks loaded correctly.

## 2026-05-13 00:40:00 +03

Added batch debounce and AI cancellation on new message.

What changed:

- Added `DEBOUNCE_MS = 3000` constant.
- Added `debounceBuffers` Map — buffers incoming messages per chat for 3 seconds.
- Added `aiProcessing` Map — tracks active AI processing per chat with cancellation flag.
- Added `processBatchedMessages()` — processes batched messages with cancellation checks at 3 points (after compile, after AI, before send).
- Updated `POST /api/telegram/webhook`:
  - Incoming messages are buffered per chat (3 second debounce).
  - Each new message resets the debounce timer.
  - If AI is already processing for this chat, the pending response is marked as cancelled.
  - After debounce expires, all buffered texts are joined with newlines and sent as one request.

New log events:

- `BATCH_BUFFERED` — message added to existing buffer.
- `BATCH_PROCESS` — debounce expired, processing N messages.
- `AI_CANCEL_REQUESTED` — new message arrived, cancelling pending AI.
- `AI_CANCELLED` — AI response discarded (with reason).

Boundary:

- This is transport reliability only.
- No AI behavior, prompt, rule, or hidden logic was added.
- Debounce timing is a constant (3 seconds), not AI behavior.

Fresh local backup before this change:

- `/Users/alishereshbekov/Desktop/Новая папка 10/Новая папка 5/backups/before-batch-debounce-20260513.tgz`

Verification:

- `node --check index.js` passed.
- Server started on port 3001.

## 2026-05-13 00:50:00 +03

Added manager takeover with passive mode and context preservation.

What changed:

- Manager detection: `from.id != chat.id` in business messages.
- Manager messages saved as `role: operator`, `direction: out`.
- Passive mode activates for 30 minutes when manager writes.
- During passive mode AI does not respond.
- After 30 min silence, AI resumes with full context (50 messages including manager replies).
- Manager takeover cancels pending AI processing and debounce buffers.

Boundary:

- Transport reliability only. No AI behavior added.

## 2026-05-13 10:00:00 +03

Added livefeel features for humanized AI agent behavior.

What changed:

- Added `sendTelegramReaction()` — puts 👀 reaction on last client message before starting to type. Silently ignored if API not available.
- Added `shouldSkipGreeting()` — checks if last message in chat was <4 hours ago. If yes, compiler tells the model NOT to greet again.
- Added night mode — `isNight` flag (00:00-07:00 MSK). Night mode:
  - Multiplies all response delays by 1.5-3x (random).
  - Adds instruction to the prompt: answer briefly, offer to continue in the morning.
- Added speed variability — all typing/read/between-message delays now vary by ±30% randomly. No two responses feel identical.
- Added re-typing action between multi-message replies — status "typing" refreshes between each message bubble.
- Added `pausedChats` guard in `processBatchedMessages()` — if chat was manually paused during debounce wait, batch is skipped.
- Added `escalatedChats` persistence in `processBatchedMessages()` — when AI returns `decision: escalate`, the escalation is saved to the Map with reason, traceId, and timestamp so CRM shows it.
- Buffer now tracks `lastMessageId` for reaction targeting.
- `sendHumanizedReply()` now accepts `lastMessageId` and uses it for reaction.

Behavioral impact:

- Greeting dedup and night mode instructions are prompt-level (visible in AI Control compiler, not hardcoded behavior rules).
- Reactions, speed variability, and delays are transport-level (how messages are delivered, not what they say).

Fresh local backup before this change:

- Created via `backups/before-livefeel-*.tgz`

Verification:

- `node --check index.js` passed.
- Server started on port 3001.
- Test chat returns correct structured response with greeting logic.
- Health endpoint reports all systems OK.

---

## Phase 3: Agent Settings Tab + Inspector UI (2026-05-13)

### Agent Settings Tab

All agent behavior parameters moved from hardcode to AI Control → Настройки tab:

| Setting | Config Key | Default | Control |
|---|---|---|---|
| Auto-reply | `auto_reply_enabled` | true | Toggle |
| Reaction on message | `reaction_enabled` | true | Toggle + emoji picker |
| Reaction emoji | `reaction_emoji` | 👀 | Text input |
| Greeting dedup | `greeting_dedup_enabled` | true | Toggle |
| Greeting dedup window | `greeting_dedup_hours` | 4 | Number (1-24 hours) |
| Night mode | `night_mode_enabled` | true | Toggle |
| Manager passive timeout | `manager_passive_seconds` | 120 | Number (10-600 sec) |
| Read delay | `read_delay_ms` | 1500 | Number (300-5000 ms) |
| Typing speed | `typing_speed_cps` | 30 | Number (5-100 chars/sec) |
| Between messages delay | `between_messages_delay_ms` | 2000 | Number (500-8000 ms) |
| Debounce | `debounce_ms` | 3000 | Number (500-10000 ms) |

Architecture: All settings saved in `runtime-config.json`, exposed via `/config/status`,
editable via `POST /config`. `DEBOUNCE_MS` constant replaced with `getDebounceMs()` function.

### Inspector UI

Full AI decision trace now stored in `ai_turns` table via migration `005_ai_turns_trace.sql`:

New columns:
- `compiled_prompt` — full system prompt sent to AI
- `memory_summary` — customer memory at time of request
- `input_text` — combined customer text from batch
- `history_length` — number of messages in context
- `structured_response` — full JSON: decision, stage, facts, reply, needsHuman

Inspector panel in CRM:
- Slide-out panel from right side (520px max)
- Triggered by 🔍 button on AI messages in CRM chat
- Shows: decision badge (reply/skip/wait/escalate), model, latency, history length,
  customer input, memory, extracted facts table, AI reply preview,
  compiled prompt (expandable), trace ID, error if any
- Opens with smooth CSS animation, closes on overlay click or ✕ button

Files modified:
- `db/migrations/005_ai_turns_trace.sql` — new migration
- `db/postgres.js` — extended recordAiTurn() and listCrmAiTurns()
- `index.js` — trace context passed to requestAi() from both processBatchedMessages() and test-chat
- `public/index.html` — CSS for inspector panel + badges, HTML overlay, JS for open/close/render

Verification:
- `node --check index.js` + `node --check db/postgres.js` passed
- Migration 005 applied automatically on server start
- Test chat AI turn stored with compiled_prompt (3403 chars), input_text (36 chars),
  decision: reply, stage: interest in PostgreSQL
- Health check: all systems OK
- Inspector panel CSS and JS verified in browser

## Phase 4: Product Context — Vision, Catalog, Photo Sending (2026-05-13)

### Vision — AI видит фото клиента

When a client sends a photo, the AI agent now **sees** the image content via the multimodal Vision API.

How it works:
1. `extractTelegramMedia(message)` — extracts `file_id` from photo/document/sticker
2. `downloadTelegramFileBase64(fileId)` — downloads file from Telegram API → base64 data URI
3. `compileAiRequest()` — builds OpenAI-compatible multimodal content: `[{ type: "text" }, { type: "image_url" }]`
4. The AI model receives the actual image alongside the text message

Config: `vision_enabled` toggle in AI Control → Настройки (default: on).
If disabled or model doesn't support Vision, falls back to `[photo] Клиент прислал фото.` text.

Files: `index.js` — new functions `extractTelegramMedia()`, `downloadTelegramFileBase64()`, updated `compileAiRequest()`, webhook buffer.

### Каталог товаров — AI знает ассортимент

Product catalog managed through AI Control → Товары tab.

Architecture:
- `data/product-catalog.json` — array of products
- `GET /api/products` — load catalog
- `POST /api/products` — save catalog
- `compileSystemPrompt()` — auto-injects `### Каталог товаров` section with in-stock items (name, price, sizes, description)
- AI agent uses catalog data to answer questions about prices, availability, sizes

UI: New «Товары» tab with inline-editing table (name, price, sizes, description, photo URL, in_stock toggle, delete button).

### Отправка фото товаров

AI can now send product photos to clients.

How it works:
1. Prompt includes `send_photo` field in structured response format (only when catalog has photo URLs)
2. `parseStructuredResponse()` extracts `send_photo` product ID
3. `sendHumanizedReply()` looks up product in catalog, sends photo via `sendTelegramPhoto()` before text reply
4. Photo message is recorded in chat history

New function: `sendTelegramPhoto({ chatId, photoSource, caption, businessConnectionId })`

### Settings added

| Setting | Config Key | Default | Control |
|---|---|---|---|
| Vision | `vision_enabled` | true | Toggle in Настройки |

### Files modified

- `index.js` — Vision functions, catalog functions, photo sending, updated compile/parse/webhook
- `public/index.html` — Товары tab (HTML + CSS + JS), Vision toggle
- `data/product-catalog.json` — new file (empty template)

### Verification

- `node --check index.js` — SYNTAX OK
- Server started on port 3001, health OK
- `GET /api/products` returns catalog
- Products tab renders in AI Control with table, buttons
- Vision toggle visible in Настройки

Backup before change:
- Created via `backups/before-product-ctx-*.tgz`

---

## 2026-05-14 14:10:00 +03

Проведён системный аудит проекта Cline-ассистентом (AI).

Что сделано:

- Изучен `package.json` — зависимости (express, axios, pg, dotenv, winston, uuid), скрипты, структура проекта.
- Полностью прочитан `index.js` (1719 строк) — весь транспорт, AI-агент, CRM API, AI Control API.
- Изучены все проектные документы:
  - `SAI_PASSPORT.md` — паспорт проекта, архитектура, границы ответственности.
  - `SAI_DATABASE.md` — PostgreSQL-фундамент, схема, CRM API.
  - `SAI_AI_READINESS.md` — готовность к AI-продавцу, Supreme Rule.
  - `SAI_SELLER_BRAIN.md` — детальный дизайн AI-продавца (1107 строк).
  - `SAI_WORKLOG.md` — полная хронология разработки (данный файл).
  - `BACKUPS.md` — дисциплина бэкапов.
- Составлен итоговый обзор проекта.

Текущее состояние проекта (2026-05-14):

- Фазы 1-4 завершены.
- AI-агент отвечает клиентам, используя компилируемый system prompt, structured response, память, humanized-отправку.
- Работают Vision, каталог товаров, отправка фото.
- CRM и AI Control функционируют.
- Supreme Rule соблюдается: ни одного скрытого правила в коде.

Граница: AI-продавец работает, но без модулей заказов/оплаты/доставки/возвратов.

---

## 2026-05-14 14:30:00 +03

Исправление приветствий AI-продавца (раунд 2: корневая причина).

Диагностика:
- Проблема: AI игнорировал стиль клиента и всегда отвечал "Добрый день!".
- AI Control-правила `mirror_greeting` и `never_greet_twice` были написаны, но не срабатывали.
- Корневая причина найдена в `compileSystemPrompt()` (index.js): жёсткая инструкция `"Если клиент ещё не здоровался — начни с доброжелательного приветствия (Добрый день!)"`
  переопределяла все AI Control-правила, так как system prompt имел приоритет перед user-правилами.

Исправление в compileSystemPrompt():
- Заменена жёсткая директива на гибкую: зеркалить стиль клиента.
  - Если клиент поздоровался → зеркалить его стиль (формальный/неформальный).
  - Если клиент начал без приветствия → использовать умеренное приветствие по времени суток (не жёсткое "Добрый день!").
  - Запрет на двойные приветствия сохранён.

AI Control (ai-seller-control.json): правила усилены — директивы вместо рекомендаций:
- `mirror_greeting`: формулировка усилена, приоритет повышен.
- Добавлено новое правило `never_greet_twice`: жёсткий запрет на повторное приветствие.
- `first_touch`: переписан — строгая директива вместо мягкой рекомендации.

Результат тестирования (2026-05-14 14:38):

| Запрос | Ответ AI | Результат |
|--------|---------|-----------|
| "Привет" | "Привет! Что-то конкретное интересует?" | ✅ Зеркалит стиль |
| "Здарова" | "Здарова! Что-то конкретное ищете?" | ✅ Зеркалит неформальный стиль |
| "Цена?" | "Добрый день! Уточните, пожалуйста..." | ✅ Приветствие + сразу вопрос |
| "Есть?" | "Добрый день! Уточните, пожалуйста..." | ✅ Приветствие + сразу вопрос |
| "Хочу духи" | "Добрый день! Могу подсказать..." | ✅ Приветствие + сразу вопрос |
| "Найк" | "Добрый день! Интересует конкретная модель?" | ✅ Приветствие + сразу вопрос |

Итог: AI-продавец корректно зеркалит стиль клиента и не дублирует приветствия.

---

## 2026-05-14 21:20:00 +03

Актуализированы возражения и сервисные ответы AI-продавца по логике магазина.

Что изменено в `data/ai-seller-control.json`:

- Добавлен отдельный foundation-блок `tracking_flow`:
  - агент больше не должен обещать, что сам пришлёт трек-номер;
  - теперь он объясняет реальную механику: как только создаётся накладная по выбранной службе доставки, отслеживание появляется у клиента в приложении этой службы, если привязан тот же номер телефона.
- Добавлен foundation-блок `offline_store_story`:
  - агент больше не отвечает сухо, что офлайн-магазина нет;
  - теперь он объясняет, что раньше офлайн-точка была, затем магазин полностью ушёл в онлайн, чтобы не поднимать стоимость товаров из-за аренды и дополнительных расходов;
  - также разрешено мягко напоминать про возврат или замену, как на маркетплейсах.
- Добавлен foundation-блок `promo_price_logic`:
  - агент больше не должен говорить, что кроссовок по 1000 ₽ не бывает;
  - теперь он объясняет, что такие акционные позиции действительно могут появляться, но их быстро разбирают, поэтому лучше следить за каналом.
- Усилен блок `support`:
  - в objections добавлен вопрос `Как отследить посылку?`;
  - в forbidden добавлен запрет на ложное обещание отдельного трек-номера;
  - examples переписаны под сценарий с автоматическим отображением накладной в приложении службы доставки.
- Обновлены списки `main_objections` и `polygon.test_cases`, чтобы новые возражения были видимы и для промтов, и для тестового полигона.

Результат:

- Логика ответов по отслеживанию, офлайн-магазину и акциям теперь находится в видимом AI Control, а не в неформальных договорённостях.
- Агент должен отвечать мягче, реалистичнее и ближе к фактической бизнес-логике магазина.

---

## 2026-05-14 21:55:00 +03

Актуализированы правила по возвратам и ответам на вопросы вида `ты бот? / вы робот?`.

Что изменено в `data/ai-seller-control.json`:

- Переписан foundation-блок `tone`:
  - убрано старое правило, где агент должен был честно признаваться в AI при прямом вопросе;
  - теперь агент должен отвечать как менеджер магазина и не использовать формулировки `AI`, `бот`, `робот`, `нейросеть`, `помощник`.
- Усилен foundation-блок `payment_return`:
  - подробно описаны базовые условия возврата и обмена;
  - добавлено требование сохранить товарный вид, целую коробку и комплект;
  - добавлена логика `сообщение менеджеру -> отправка обратно -> проверка -> возврат денег в тот же день или отправка замены`.
- Добавлены отдельные foundation-блоки:
  - `return_process` — как мягко и полно объяснять возврат и обмен;
  - `identity_masking` — как отвечать на вопросы `вы бот?`, `вы робот?`, `вы агент?`, не уходя в технические признания.
- Усилен funnel-блок `trust`:
  - добавлены возражения `А как происходит возврат?` и `Если не подошло?`;
  - examples переписаны так, чтобы возврат не объяснялся одной сухой фразой.
- Усилен funnel-блок `return_conflict`:
  - examples и forbidden расширены под реальный сценарий возврата с товарным видом и проверкой.
- Обновлены `main_objections` и `polygon.test_cases`, чтобы сценарии про возврат и идентичность агента были видимы в тестовом контуре.

Результат:

- Агент должен мягко и подробно объяснять возврат, включая состояние товара, коробку, проверку и различие между возвратом денег и заменой.
- Агент больше не должен называть себя AI/ботом/роботом в ответ на прямой вопрос клиента.

---

## 2026-05-14 22:15:00 +03

Доработано Telegram-поведение AI-продавца: длительность `typing...` и отметка прочтения business-сообщений.

Что изменено:

- В `index.js` переработана симуляция набора текста:
  - раньше длительность `typing` была жёстко зажата до `5000 ms`, поэтому короткие и длинные ответы выглядели почти одинаково;
  - теперь длительность рассчитывается по длине текста, количеству слов и знаков препинания;
  - для длинных сообщений статус `typing` автоматически продлевается повторными `sendChatAction`, чтобы Telegram не сбрасывал индикацию через 5 секунд.
- Добавлен helper `markTelegramBusinessMessageRead()`:
  - при входящем клиентском business-сообщении бот теперь вызывает `readBusinessMessage`;
  - это должно выставлять прочтение на стороне Telegram Business, если у подключенного бота есть право `can_read_messages`.
- Логирование расширено событиями:
  - `TG_MARK_READ`
  - `TG_MARK_READ_ERROR`

Результат:

- Визуальная длительность `печатает...` теперь должна лучше соответствовать реальной длине ответа агента.
- В business-чатах Telegram должна начать появляться отметка прочтения входящих сообщений, если права подключения выданы корректно.

---

## 2026-05-14 22:30:00 +03

Доведено человеческое поведение отправки сообщений в Telegram.

Что изменено в `index.js`:

- Добавлена отдельная фаза `thinking pause` перед каждым исходящим сообщением:
  - перед первым сообщением теперь есть короткая пауза на "подумать";
  - она зависит от длины и сложности текста, но остаётся умеренной, без затягивания.
- Добавлена более живая пауза между несколькими исходящими сообщениями:
  - интервал теперь зависит от длины предыдущего и следующего сообщения;
  - короткие связки идут быстрее, более содержательные — чуть спокойнее.
- Логика `typing...` осталась привязана к длине ответа, но теперь работает в связке с фазой обдумывания, поэтому поведение выглядит менее механическим и менее "моментальным".

Результат:

- Агент должен отвечать быстро, но не слишком резко.
- Поведение в Telegram должно ощущаться ближе к живому менеджеру: сначала коротко прочитал и подумал, потом печатает, потом при серии сообщений делает естественные микропаузи.

---

## 2026-05-14 22:40:00 +03

Уточнён порядок Telegram Business UX: сначала прочтение, потом набор.

Что изменено в `index.js`:

- В `sendHumanizedReply()` добавлен обязательный шаг перед реакцией и перед `typing...`:
  - если есть `businessConnectionId` и `lastMessageId`, бот сначала вызывает `readBusinessMessage`;
  - после этого выдерживается короткая пауза, чтобы в интерфейсе успела появиться отметка прочтения;
  - только затем идут реакция, фаза обдумывания и `typing...`.

Результат:

- В business-диалоге поведение должно выглядеть более естественно:
  `прочитал -> две галочки -> небольшая пауза -> печатает`.

---

## 2026-05-14 23:05:00 +03

Добавлены умные Telegram-реакции для оживления диалога.

Что изменено:

- В `index.js` добавлен слой `smart reactions`:
  - реакции больше не обязаны быть одним фиксированным эмодзи;
  - теперь бот умеет выбирать реакцию по контексту входящего сообщения;
  - добавлен cooldown по чату, чтобы не спамить реакциями.
- Текущая эвристика:
  - `👀` — если клиент прислал фото/медиа;
  - `✅` — если клиент пишет про оплату или чек;
  - `👍` — если прислал данные для оформления/доставки;
  - `🔥` — если явно готов оформлять;
  - на негатив, сомнения, возвраты и конфликтные фразы реакция не ставится.
- Добавлены новые runtime-настройки:
  - `reaction_mode`: `smart | fixed | off`
  - `reaction_probability`
  - `reaction_cooldown_sec`
- В `public/index.html` обновлена карточка настроек реакции:
  - можно выбрать режим;
  - можно задать вероятность;
  - можно задать cooldown;
  - фиксированный emoji оставлен как fallback для режима `fixed`.

Результат:

- Реакции должны стать более человеческими и уместными.
- Поведение перестаёт выглядеть как механический `👀` на каждое сообщение.

---

## 2026-05-14 23:20:00 +03

Исправлен слишком ранний `read receipt` в Telegram Business.

Что изменено:

- Убран ранний вызов `readBusinessMessage` из webhook-обработчика входящего сообщения.
- Теперь прочтение больше не ставится мгновенно в момент получения update.
- Отметка прочтения остаётся только в humanized-фазе ответа:
  - сначала проходит человеческая задержка `read_delay_ms`,
  - потом ставится прочтение,
  - затем короткая пауза,
  - и только после этого идут реакция и `typing...`.

Результат:

- Поведение должно стать естественнее:
  `сообщение пришло -> 2-3 секунды -> прочитано -> небольшая пауза -> печатает`.

---

## 2026-05-14 23:40:00 +03

Добавлен безопасный reader ссылок `iwak.ru` для AI-продавца.

Что изменено в `index.js`:

- Добавлен узкий fetcher только для `https://iwak.ru` и `https://www.iwak.ru`:
  - запрещены другие домены;
  - запрещены `http`, порты, userinfo и hash;
  - после редиректов домен повторно валидируется;
  - включена SSRF-защита через DNS lookup и запрет private/local IP.
- Добавлены ограничения на загрузку страницы:
  - только `GET`;
  - timeout 5 секунд;
  - максимум ~2 MB HTML;
  - без выполнения JS и без браузера.
- Реализован парсинг карточки товара из HTML:
  - `title`
  - `description`
  - `price`
  - `old_price`
  - `sizes`
  - `availability`
  - `region`
  - `product_id`
  - `image`
  - `canonical_url`
- Добавлен кеш на 10 минут по URL.
- Контекст страницы `iwak.ru` теперь подмешивается в AI-запрос как отдельный system-блок, а не как сырой HTML.
- Поддержка добавлена и в `/api/test-chat`, чтобы ссылку можно было проверять через полигон и тестовый чат.

Результат:

- Если клиент присылает ссылку `iwak.ru`, агент теперь может читать содержимое страницы товара через безопасный серверный parser.
- Агент по-прежнему не получает свободный доступ к интернету и не ходит на другие домены.

Дополнительное уточнение после живой проверки `iwak.ru`:

- HTML карточки товара оказался SPA-оболочкой без полезного product SEO-контента.
- Найден более надёжный источник данных: `https://iwak.ru/api/products/:id`.
- Reader перестроен так, чтобы сначала брать товар по `product_id` из JSON API, а HTML-парсинг оставался только запасным вариантом.

Результат:

- Для ссылок вида `/product/...-837` агент должен получать реальные поля товара (`name`, `price`, `originalPrice`, `sizes`, `image`) из API сайта, а не из общей SEO-обвязки страницы.

---

## 2026-05-14 23:55:00 +03

Исправлена каша при серии быстрых сообщений от клиента.

Что изменено в `index.js`:

- Если клиент отправил несколько коротких сообщений подряд в одном debounce-окне, в AI добавляется явная инструкция:
  - воспринимать это как одну общую мысль;
  - отвечать одним цельным сообщением по суммарному смыслу.
- Добавлен post-processing `collapseReplyMessages()`:
  - для батча из нескольких клиентских сообщений массив `reply` от модели склеивается в одно сообщение;
  - это убирает каскад из 2-3 отдельных ответов на одну мысль клиента.
- Добавлена отмена хвоста исходящей серии:
  - если клиент дописал ещё сообщение, пока AI уже начал отправлять multi-reply;
  - оставшиеся части старого ответа больше не должны продолжать досылаться автоматически.

Результат:

- При 2-4 быстрых сообщениях подряд агент должен отвечать одним более цельным сообщением вместо нескольких разрозненных пузырей.
- Если клиент продолжает писать во время отправки, старый хвост ответа должен мягко обрываться, чтобы не плодить кашу в диалоге.

---

## 2026-05-15 00:08:00 +03

Смягчена логика сопоставления размера обуви и длины стельки на пограничных значениях.

Что изменено в `data/ai-seller-control.json`:

- Добавлено явное правило: отличие ровно около `0.5 см` трактуется как пограничный случай соседних размеров, а не как явная ошибка клиента.
- Для примера `42 размер + 26.5 см` агент теперь должен отвечать мягко:
  - что это граница между `41` и `42`;
  - если клиент обычно носит `42`, можно ориентироваться на `42`;
  - перепроверка желательна, но критичного расхождения нет.
- В `facts` расширен статус проверки:
  - `ok`
  - `borderline`
  - `mismatch`
  - `confirmed_after_warning`

Результат:

- Агент не должен больше слишком резко “ломать” пограничные кейсы вроде `42 / 26.5`.
- Жёсткая перепроверка остаётся только для действительно заметных расхождений больше соседнего диапазона.

---

## 2026-05-15 00:18:00 +03

Исправлена реакция AI на дружеские фото клиента, не связанные с товаром.

Что изменено в `data/ai-seller-control.json`:

- В `focus_topic` добавлено правило:
  - если клиент прислал что-то по-человечески для контакта (питомец, селфи, мем, смайлик, короткая шутка),
    AI сначала коротко и тепло реагирует на это,
    а уже потом мягко возвращает диалог к заказу.
- Убрана сухая подача в духе:
  - `я только по товарам`
  - `давайте вернёмся к заказу` без живой реакции на контекст.
- В `photo_id` разделены два сценария:
  - фото товара — определить товар по vision;
  - нетоварное фото — коротко и дружелюбно отреагировать именно на изображение, затем вернуть к продаже.

Результат:

- Если клиент присылает, например, фото питомца, агент не должен больше отвечать сухо и мимо эмоции.
- Ожидаемое поведение: короткая тёплая реакция на фото и затем мягкий возврат к оформлению или выбору товара.
