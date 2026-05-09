# S.AI Project Instructions

This repository is the S.AI sales system for IWAK.

Before changing behavior, architecture, database logic, Telegram flow, AI prompts, guards, training, order handling, media handling, or the S.AI Control interface, read:

- `docs/SAI_SYSTEM_AUDIT.md`
- `docs/SAI_PASSPORT_REVIEW.md`
- `docs/SAI_WORKLOG.md`

Treat that file as the project passport. It describes the real production nervous system and should be the source of truth for how the system is supposed to work.

Core rules:

- Do not treat S.AI as only `Telegram -> AI -> Telegram`. It is a sales system with Telegram Business, memory, SQLite, iwak.ru reader, prompt assembly, model calls, post-model guards, Inbox, order notifications, training lessons, followups, and manager takeover.
- Passport law: do not hide behavior only in code. If a rule, prompt, guard, schema, threshold, mode, template, delivery/payment condition, reader behavior, memory behavior, manager takeover behavior, order behavior, media behavior, or followup behavior can change what S.AI says or does, it must be visible in S.AI Control, grouped under the right node, and editable from the panel where feasible.
- If a setting cannot be safely edited live, it must still be visible in S.AI Control as read-only with the reason clearly shown. Do not leave it implicit.
- When adding a new `runtimeConfig` key, default prompt/rule text, guard, template, or system behavior, also add it to the visual passport/control surface in the same change.
- Preserve the live customer flow. Clients may be writing while changes are made.
- Do not touch production server, production database, order chat, or Telegram integration without explicit user intent and a backup/check plan.
- Prefer small, reversible changes over broad rewrites.
- When changing UI, keep the owner view visual and operational: map, status, diagnostics, trace, tests, and precise controls instead of long unstructured setting lists.
- When changing AI behavior, check the full chain: input normalization, memory, iwak.ru reader, media, prompt, training examples, model response, guards, Telegram send, and persistence.
- When bugs appear, diagnose by symptom and trace: what came in, what facts were extracted, what prompt saw, what the model returned, what guards changed, and what was sent.
- After meaningful changes, add a short entry to `docs/SAI_WORKLOG.md`: date/time, what changed, why, verification, and whether it is local or deployed.

Target direction:

- The S.AI Control UI should become a visual control center where every important system module is visible, testable, and configurable without editing code.
- Each node should eventually show: purpose, status, source of truth, last activation, recent failures, trace links, tests, and editable owner-safe settings.
