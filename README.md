# AI Seller — Telegram CRM с AI-продавцом

Автоматический продавец в Telegram, который ведёт клиента от первого сообщения до оплаты.  
Интеграция с каталогом магазина, распознавание фото товаров, CRM-панель для менеджера.

## Возможности

- **AI-продавец** — генерирует живые ответы через OpenRouter (GPT-4o-mini)
- **6-этапная воронка продаж** — NEW → WAITING_SIZE → WAITING_FORM → WAITING_PAYMENT → PAID → DONE
- **4 режима AI** — AUTO, HYBRID, OBSERVE, AUTO_WITH_MANAGER_OVERRIDE
- **Распознавание фото** — определяет товар по изображению через Vision API
- **Soft Availability Mode** — AI никогда не говорит «нет в наличии», всегда предлагает альтернативы
- **CRM-панель** — список диалогов, чат, карточка клиента, управление заказами
- **Интеграция с каталогом** — fuzzy-поиск товаров, цены из API магазина
- **Автоматические follow-up** — напоминания, реактивация, подталкивание к покупке
- **Динамическая оплата** — реквизиты из настроек, inline-кнопка «Скопировать карту»
- **Тёмная/светлая тема** — адаптивный интерфейс

## Архитектура

```
backend/          Node.js + Express (порт 3001)
├── src/
│   ├── ai/         OpenRouter AI, валидатор, offtopic, vision
│   ├── api/        REST маршруты, JWT-авторизация
│   ├── db/         PostgreSQL: users, messages, orders, settings
│   ├── logic/      Стейт-машина продаж
│   ├── scheduler/  Cron: follow-up, nudge, manager timeout
│   ├── telegram/   Webhook, bot API, handler
│   └── shop.js     Клиент каталога магазина

frontend/         Next.js 14 (порт 3000)
├── app/            Страницы (login, main)
├── components/     ChatView, SettingsView, IntegrationsView
└── lib/            API-клиент, AuthContext, ThemeContext
```

## Быстрый старт

### 1. Требования

- Node.js 18+
- PostgreSQL 14+
- Telegram Bot Token ([@BotFather](https://t.me/BotFather))
- OpenRouter API Key ([openrouter.ai](https://openrouter.ai))

### 2. Установка

```bash
# Клонировать
git clone <repo-url>
cd ai-seller

# Backend
cd backend
cp .env.example .env
# Заполнить .env своими данными
npm install
npm run migrate
npm start

# Frontend (в отдельном терминале)
cd frontend
npm install
npm run dev
```

### 3. Настройка

1. Открыть `http://localhost:3000`
2. Войти с логином/паролем из `.env` (по умолчанию: `admin` / `admin123`)
3. Перейти в **Интеграции** → настроить Telegram Bot Token, OpenRouter API Key
4. Установить Webhook URL → нажать «Проверить»

### 4. Production

```bash
# Backend
cd backend
npm run start:prod

# Frontend
cd frontend
npm run build
npm start
```

**Важно:** В production обязательно измените `ADMIN_PASSWORD` и `JWT_SECRET` в `.env`.

## Тесты

```bash
cd backend
npm test
# 376 assertions, 48 test suites
```

## API

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/login` | JWT-авторизация |
| GET | `/api/users` | Список пользователей |
| GET | `/api/users/:id/messages` | История сообщений |
| POST | `/api/users/:id/messages` | Отправить сообщение от менеджера |
| PATCH | `/api/users/:id/ai` | Вкл/выкл AI для пользователя |
| PATCH | `/api/users/:id/ai-mode` | Режим AI (AUTO/HYBRID/OBSERVE/...) |
| GET | `/api/orders` | Список заказов |
| PATCH | `/api/orders/:id/status` | Обновить статус заказа |
| GET/POST | `/api/settings` | Настройки системы |
| GET/POST | `/api/prompts` | Управление промптами |
| POST | `/api/telegram/webhook` | Telegram webhook |

## Лицензия

MIT
