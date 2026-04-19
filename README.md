# S.AI

S.AI is a minimal control layer between Telegram and AI:

`Telegram -> S.AI -> AI -> S.AI -> Telegram`

The system is intentionally simple:
- Telegram webhook intake
- unified input normalization
- AI control layer
- reply back to Telegram
- trace logging
- lightweight admin panel

No queues, no database, no retry engine, no complex orchestration.

## What is included

- Telegram webhook: `POST /api/telegram/webhook`
- Admin auth: `/login`
- Control panel:
  - `AI Control`
  - `Integrations`
  - `Logs`
- Runtime config persistence in `data/runtime-config.json`
- Trace logs in `logs/runtime.jsonl`
- Voice and video note support through STT -> text normalization

## Requirements

- Node.js 20+ recommended
- Public HTTPS domain for Telegram webhook
- Telegram bot token
- AI API key

## Environment

Copy the example file and fill in real values:

```bash
cp .env.example .env
```

Main variables:

```env
HOST=0.0.0.0
PORT=3001
NODE_ENV=production
TRUST_PROXY=true

TELEGRAM_TOKEN=
AI_API_KEY=
AI_BASE_URL=https://api.openai.com/v1
MODEL=gpt-4o-mini
STT_API_KEY=
STT_BASE_URL=https://api.openai.com/v1
STT_MODEL=gpt-4o-mini-transcribe

ADMIN_LOGIN=
ADMIN_PASSWORD=
```

Optional control defaults:

```env
INSTRUCTION=
TONE=neutral
RESPONSE_LENGTH=medium
CREATIVITY=balanced
PERSONA_STYLE=calm
PERSONA_AGE=27
CONVERSATION_MODE=general
MEDIA_BEHAVIOR=describe_media
WEBHOOK_URL=
LOG_LEVEL=info
```

## Local start

```bash
npm install
npm run check
npm start
```

Open:

- Login: `http://localhost:3001/login`
- Health: `http://localhost:3001/health`

## Production start

1. Install dependencies:

```bash
npm install --omit=dev
```

2. Create `.env` from `.env.example`

3. Start the service with PM2:

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
```

4. Put the app behind HTTPS reverse proxy.

Example Nginx location:

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

5. In `Integrations -> Telegram`, set:
- bot token
- webhook domain or full webhook URL

S.AI will normalize it to:

```text
https://your-domain.com/api/telegram/webhook
```

## Health check

Public endpoint:

```text
GET /health
```

Example response:

```json
{
  "ok": true,
  "service": "s.ai",
  "uptime": 42,
  "webhook_open": true
}
```

## Important runtime files

- Config persistence: `data/runtime-config.json`
- Trace logs: `logs/runtime.jsonl`

These files are runtime state and should not be committed with production secrets.

## Deployment notes

- Keep `TRUST_PROXY=true` if you run behind Nginx, Caddy, Traefik, Render, Railway or similar proxy
- Keep `NODE_ENV=production` in production
- Make sure the public domain has valid HTTPS
- Telegram webhook is intentionally open and does not require admin auth
- The admin panel remains protected by login/password
- Voice and video note STT can use a separate backend via `STT_API_KEY` and `STT_BASE_URL`

## First live check

After deploy, verify:

1. `GET /health` returns `ok: true`
2. `/login` opens
3. `/config/status` works after login
4. Telegram webhook is set
5. One text message reaches:
   - `IN`
   - `AI_REQUEST`
   - `AI_REPLY`
   - `TG_SEND`
6. One photo and one voice message also pass through end-to-end

## Useful PM2 commands

```bash
pm2 status
pm2 logs sai
pm2 restart sai
pm2 stop sai
```
