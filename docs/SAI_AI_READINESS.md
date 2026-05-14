# S.AI AI Seller Readiness

Updated: 2026-05-14 16:25 +03

## Purpose

This document fixes the clean state before building the AI seller.

The current project is a transport, database, CRM, and AI seller runtime foundation.
The AI seller control screen is visible in the sidebar.
The AI seller behavior layer is connected through the visible AI Control compiler path.

## Supreme Rule

AI seller behavior must never be hardcoded.

Everything that affects how the AI seller answers must be visible and editable from AI Control before it can affect production replies.

Code may only:

- receive messages;
- store messages;
- read visible settings;
- validate visible settings;
- assemble the AI request from visible settings;
- send the request to the selected model;
- store the result;
- send the answer back to the channel.

Code must not secretly contain:

- sales prompts;
- psychology rules;
- examples;
- delivery/payment/return scripts;
- hidden fallback phrases;
- rewrite filters;
- response guards;
- product logic;
- memory rules.

## Ready Foundation

The following foundation is ready for the next stage:

- Telegram webhook input;
- Telegram reply output;
- AI provider connection;
- model selection from the connection screen;
- PostgreSQL storage;
- customers;
- chats;
- messages;
- events;
- AI turns;
- CRM dialog list;
- CRM selected chat;
- CRM customer card;
- manual CRM reply to Telegram;
- Telegram avatar proxy;
- Telegram file/media proxy;
- live CRM updates through Server-Sent Events;
- fallback CRM refresh;
- runtime JSONL logs;
- local and server backup discipline.

## Not Built Yet

The following must not be assumed to exist:

- order entity management;
- delivery tracking entity management;
- payment confirmation entity management;
- full editable memory/facts UI;
- production QA suite for seller behavior;
- channel-specific MAX/VK runtime.

## Required AI Seller Section

The new sidebar section `AI продавец` now exists as a visible control screen.

It should become the only control center for AI behavior after storage, compiler, inspector, and visible behavior modules are implemented.

The first visible seller settings are now stored in `data/ai-seller-control.json` and edited through `/api/ai-seller/control`.

The settings are organized as a sales funnel, not as a flat prompt list:

- `foundation` — rules that always apply to the personal-manager agent;
- `funnel` — editable sales stages from first touch to return/conflict;
- `memory` — visible customer memory policy;
- `objections` — shared objection handling;
- `polygon` — visible test cases.

These settings are the future source of truth for seller behavior.
They are connected to production Telegram replies through the runtime compiler when global auto-reply is enabled.
Behavior-changing settings must come only from this visible control path.

Recommended first blocks:

- `Ядро продавца` — role, goal, language, tone, response length.
- `Память и контекст` — how much history to use, what facts to remember, what must be shown in the request.
- `Скилы` — visible toggles for behavior modules.
- `Этапы продажи` — first contact, qualification, order data, delivery, payment, confirmation.
- `Правила` — must-do and forbidden behavior.
- `Примеры` — editable examples that the seller can follow.
- `Инспектор` — exact model request, active blocks, response, latency, and trace.
- `Полигон` — test chat using the exact same AI request compiler as Telegram.

## First Implementation Gate

Before the first real AI seller skill is enabled:

1. Create a visible AI seller section.
2. Store every rule through visible interface-controlled data.
3. Build a prompt/request compiler that reads only visible settings.
4. Store the compiled request in `ai_turns`.
5. Show the compiled request in the interface inspector.
6. Add a toggle for any behavior module before it can affect replies.
7. Verify that disabling a module removes its behavior from the AI request.

## Current Boundary

CRM is not the AI brain.

CRM is only:

- monitor;
- manual reply surface;
- client view;
- conversation view.

AI behavior belongs to `AI продавец` / AI Control only.

The current `AI продавец` screen saves visible seller-agent rules. The runtime compiler reads those rules, injects visible customer memory and chat history, stores the trace in `ai_turns`, and controls production Telegram replies when auto-reply is enabled.
