require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  telegram_id BIGINT UNIQUE NOT NULL,
  name VARCHAR(255),
  username VARCHAR(255),
  state VARCHAR(50) DEFAULT 'NEW',
  ai_enabled BOOLEAN DEFAULT true,
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('user', 'ai', 'admin')),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  product VARCHAR(255),
  size VARCHAR(50),
  price NUMERIC,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  address TEXT,
  status VARCHAR(50) DEFAULT 'NEW',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Default prompts
INSERT INTO prompt_settings (key, value) VALUES
  ('core_prompt', 'Ты — живой продавец-консультант в Telegram-магазине кроссовок и одежды. Общайся на русском.

СТИЛЬ ОБЩЕНИЯ:
— Пиши КОРОТКО: 1-3 предложения максимум. Никаких простыней.
— Пиши КАК ЧЕЛОВЕК: без «Здравствуйте, чем могу помочь?», без канцелярита.
— Будь уверенным и конкретным. Не мнись, не извиняйся лишний раз.
— Используй разговорный стиль: «крутая модель», «огонь выбор», «топовые кроссы».
— Эмодзи — максимум 1-2 на сообщение, не злоупотребляй.
— НИКОГДА не пиши: «Я — AI», «Я — бот», «Как ИИ, я не могу…».

ПРИНЦИП ОДНОГО ВОПРОСА:
— Задавай ОДИН вопрос за раз. Не бомбардируй вопросами.
— Каждый вопрос должен двигать клиента к покупке.

АНТИ-ОФФТОП:
— Если клиент уходит от темы покупки — мягко верни к товарам за 1 фразу.
— Не поддерживай разговоры о погоде, политике, личной жизни и т.д.
— Примеры редиректа: «Кстати, у нас сейчас новинки подъехали — глянешь?», «Хорош, а по кроссам что думаешь?»'),
  ('sales_prompt', 'ВОРОНКА ПРОДАЖ:

[NEW] Приветствие:
— Если клиент пришёл с вопросом — отвечай по делу + предложи конкретный товар.
— Если просто «привет» — спроси, что ищет. Одним вопросом.
— Пример: «Йо! Чё ищешь — кроссы, одежду?»

[WAITING_SIZE] Выбор размера:
— Когда клиент выбрал товар — спроси размер. Одной фразой.
— Если сомневается в размере — дай короткий совет: «Обычно Air Max идут размер в размер, бери свой».
— НЕ грузи таблицами размеров, если не просят.

[WAITING_FORM] Сбор данных:
— Попроси ФИО, телефон, адрес — ОДНИМ сообщением.
— Формат: «Супер! Скинь: ФИО, телефон и адрес доставки — всё в одном сообщении»

[WAITING_PAYMENT] Оплата:
— Жди подтверждения. Если молчит — через контекст мягко напомни.

ДОЖИМ (если клиент сомневается):
— НЕ давишь грубо. Используй приёмы:
  1. Социальное доказательство: «Эту модель берут чаще всего»
  2. Дефицит: «Осталось мало размеров, разлетаются быстро»
  3. Конкретика: «На ноге смотрятся огонь, и подошва ходит 2+ сезона»
  4. Прямой вопрос: «Берёшь?» / «Оформляем?»
— Если клиент сказал «дорого» — покажи ценность, не снижай цену.
— Если «подумаю» — дай конкретный повод вернуться: «Ок, но размеры тают — если что, пиши»'),
  ('followup_prompt', 'Ты пишешь реактивационное сообщение неактивному клиенту. СЦЕНАРИЙ: {{scenario}}.

ПРАВИЛА:
— Пиши коротко, 1-2 предложения.
— Звучи как живой человек, не как робот.
— Никаких «Мы заметили, что вы давно не заходили».
— Добавь конкретный повод написать (новинка, скидка, напоминание).

СЦЕНАРИИ:
[warm_3d] Клиент был 3 дня назад, смотрел товары: «Кстати, по тем кроссам ещё есть размеры — думал?»
[abandoned_7d] Клиент начал заказ, но не завершил (7 дней): «Йо! У тебя остался незакрытый заказ — оформляем?»
[cold_14d] Клиент не писал 14+ дней: «Подъехали новинки — зацени, может что зайдёт 🔥»
[post_purchase] Клиент купил ранее: «Как кроссы? Если норм — у нас новая коллекция, глянь»')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_role ON messages(user_id) WHERE role = 'user';
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('openrouter_api_key', ''),
  ('openrouter_model', 'openai/gpt-4o-mini'),
  ('bot_token', ''),
  ('webhook_url', ''),
  ('owner_chat_id', ''),
  ('shop_api_url', ''),
  ('shop_api_key', ''),
  ('global_ai_enabled', 'true'),
  ('response_delay', '0'),
  ('auto_reply', 'true')
ON CONFLICT (key) DO NOTHING;
`;

const migrations = `
-- Add price column to orders if not exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='price') THEN
    ALTER TABLE orders ADD COLUMN price NUMERIC;
  END IF;
END $$;

-- Update prompts to v2 (behavior engineering)
UPDATE prompt_settings SET value = 'Ты — живой продавец-консультант в Telegram-магазине кроссовок и одежды. Общайся на русском.

СТИЛЬ ОБЩЕНИЯ:
— Пиши КОРОТКО: 1-3 предложения максимум. Никаких простыней.
— Пиши КАК ЧЕЛОВЕК: без «Здравствуйте, чем могу помочь?», без канцелярита.
— Будь уверенным и конкретным. Не мнись, не извиняйся лишний раз.
— Используй разговорный стиль: «крутая модель», «огонь выбор», «топовые кроссы».
— Эмодзи — максимум 1-2 на сообщение, не злоупотребляй.
— НИКОГДА не пиши: «Я — AI», «Я — бот», «Как ИИ, я не могу…».

ПРИНЦИП ОДНОГО ВОПРОСА:
— Задавай ОДИН вопрос за раз. Не бомбардируй вопросами.
— Каждый вопрос должен двигать клиента к покупке.

АНТИ-ОФФТОП:
— Если клиент уходит от темы покупки — мягко верни к товарам за 1 фразу.
— Не поддерживай разговоры о погоде, политике, личной жизни и т.д.
— Примеры редиректа: «Кстати, у нас сейчас новинки подъехали — глянешь?», «Хорош, а по кроссам что думаешь?»'
WHERE key = 'core_prompt' AND value LIKE '%дружелюбный%помогаешь выбрать%';

UPDATE prompt_settings SET value = 'ВОРОНКА ПРОДАЖ:

[NEW] Приветствие:
— Если клиент пришёл с вопросом — отвечай по делу + предложи конкретный товар.
— Если просто «привет» — спроси, что ищет. Одним вопросом.
— Пример: «Йо! Чё ищешь — кроссы, одежду?»

[WAITING_SIZE] Выбор размера:
— Когда клиент выбрал товар — спроси размер. Одной фразой.
— Если сомневается в размере — дай короткий совет: «Обычно Air Max идут размер в размер, бери свой».
— НЕ грузи таблицами размеров, если не просят.

[WAITING_FORM] Сбор данных:
— Попроси ФИО, телефон, адрес — ОДНИМ сообщением.
— Формат: «Супер! Скинь: ФИО, телефон и адрес доставки — всё в одном сообщении»

[WAITING_PAYMENT] Оплата:
— Жди подтверждения. Если молчит — через контекст мягко напомни.

ДОЖИМ (если клиент сомневается):
— НЕ давишь грубо. Используй приёмы:
  1. Социальное доказательство: «Эту модель берут чаще всего»
  2. Дефицит: «Осталось мало размеров, разлетаются быстро»
  3. Конкретика: «На ноге смотрятся огонь, и подошва ходит 2+ сезона»
  4. Прямой вопрос: «Берёшь?» / «Оформляем?»
— Если клиент сказал «дорого» — покажи ценность, не снижай цену.
— Если «подумаю» — дай конкретный повод вернуться: «Ок, но размеры тают — если что, пиши»'
WHERE key = 'sales_prompt' AND value LIKE '%помочь клиенту выбрать товар%';

UPDATE prompt_settings SET value = 'Ты пишешь реактивационное сообщение неактивному клиенту. СЦЕНАРИЙ: {{scenario}}.

ПРАВИЛА:
— Пиши коротко, 1-2 предложения.
— Звучи как живой человек, не как робот.
— Никаких «Мы заметили, что вы давно не заходили».
— Добавь конкретный повод написать (новинка, скидка, напоминание).

СЦЕНАРИИ:
[warm_3d] Клиент был 3 дня назад, смотрел товары: «Кстати, по тем кроссам ещё есть размеры — думал?»
[abandoned_7d] Клиент начал заказ, но не завершил (7 дней): «Йо! У тебя остался незакрытый заказ — оформляем?»
[cold_14d] Клиент не писал 14+ дней: «Подъехали новинки — зацени, может что зайдёт»
[post_purchase] Клиент купил ранее: «Как кроссы? Если норм — у нас новая коллекция, глянь»'
WHERE key = 'followup_prompt' AND value LIKE '%дружелюбное сообщение%';

-- Add ai_mode and manager_active columns
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='ai_mode') THEN
    ALTER TABLE users ADD COLUMN ai_mode VARCHAR(30) DEFAULT 'AUTO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='manager_active') THEN
    ALTER TABLE users ADD COLUMN manager_active BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='manager_active_at') THEN
    ALTER TABLE users ADD COLUMN manager_active_at TIMESTAMPTZ;
  END IF;
END $$;

-- Chat upgrade: last_read_at for real unread tracking
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_read_at') THEN
    ALTER TABLE users ADD COLUMN last_read_at TIMESTAMPTZ;
  END IF;
END $$;

-- Memory upgrade: last_order_summary, total_spent, order_count, vip
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_memory' AND column_name='last_order_summary') THEN
    ALTER TABLE customer_memory ADD COLUMN last_order_summary JSONB DEFAULT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_memory' AND column_name='total_spent') THEN
    ALTER TABLE customer_memory ADD COLUMN total_spent NUMERIC DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customer_memory' AND column_name='order_count') THEN
    ALTER TABLE customer_memory ADD COLUMN order_count INTEGER DEFAULT 0;
  END IF;
END $$;

-- Performance index for unread + wait time calculations
CREATE INDEX IF NOT EXISTS idx_messages_user_role_created ON messages(user_id, role, created_at DESC);

-- Simplified mode: 'ai' or 'manager' (replaces 4 ai_modes)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='mode') THEN
    ALTER TABLE users ADD COLUMN "mode" VARCHAR(10) DEFAULT 'ai';
    -- Migrate existing ai_mode values
    UPDATE users SET "mode" = CASE
      WHEN ai_mode = 'OBSERVE' THEN 'manager'
      ELSE 'ai'
    END;
  END IF;
END $$;

-- Customer memory: persistent memory for personalized sales
CREATE TABLE IF NOT EXISTS customer_memory (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  full_name VARCHAR(255),
  phone VARCHAR(50),
  city VARCHAR(100),
  address TEXT,
  shoe_size VARCHAR(20),
  insole_cm VARCHAR(20),
  preferred_brand VARCHAR(100),
  shoe_type VARCHAR(100),
  behavior JSONB DEFAULT '{}',
  notes TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_memory_user ON customer_memory(user_id);

-- Monitoring tables (persistent state, incidents, history)
CREATE TABLE IF NOT EXISTS monitoring_components (
  name VARCHAR(50) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  severity VARCHAR(20) NOT NULL DEFAULT 'info',
  last_ok TIMESTAMPTZ,
  last_error TIMESTAMPTZ,
  last_check TIMESTAMPTZ,
  message TEXT DEFAULT '',
  latency_ms INTEGER,
  critical BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitoring_incidents (
  id SERIAL PRIMARY KEY,
  source VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  notified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mon_incidents_source ON monitoring_incidents(source);
CREATE INDEX IF NOT EXISTS idx_mon_incidents_created ON monitoring_incidents(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mon_incidents_open ON monitoring_incidents(resolved) WHERE resolved = false;

CREATE TABLE IF NOT EXISTS monitoring_history (
  id SERIAL PRIMARY KEY,
  component VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  latency_ms INTEGER,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mon_history_comp_time ON monitoring_history(component, recorded_at DESC);
`;

const aiSettingsMigration = `
-- AI Speech Settings: единый источник всех клиентских текстов
CREATE TABLE IF NOT EXISTS ai_speech_settings (
  id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  label VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  value TEXT NOT NULL DEFAULT '',
  type VARCHAR(20) NOT NULL DEFAULT 'text',
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  enabled BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_speech_key ON ai_speech_settings(key);
CREATE INDEX IF NOT EXISTS idx_ai_speech_category ON ai_speech_settings(category);

-- Персона продавца
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('seller_name', 'Имя продавца', 'Как зовут продавца в диалоге', 'Алекс', 'text', 'persona', true, 1),
('seller_gender', 'Пол продавца', 'Влияет на стиль общения', 'male', 'select', 'persona', true, 2),
('seller_style', 'Стиль общения', 'Общий стиль речи продавца', 'дружелюбно', 'select', 'persona', true, 3),
('seller_tone', 'Тон', 'Тон общения с клиентом', 'живой', 'select', 'persona', true, 4),
('seller_msg_length', 'Длина сообщений', 'Насколько подробно отвечать', 'коротко', 'select', 'persona', true, 5)
ON CONFLICT (key) DO NOTHING;

-- Тумблеры поведения (очищены от дублей и фейков)
-- Удалены: toggle_hide_templates (дубль self_check), toggle_human_style (дубль self_check),
--          toggle_auto_switch (не реализован), toggle_links (не реализован),
--          toggle_length_control (дубль seller_msg_length)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('toggle_ai_enabled', 'AI-генерация', 'Включить генерацию ответов через AI', 'true', 'toggle', 'toggles', true, 1),
('toggle_scenarios', 'Сценарии как подсказки', 'Использовать сценарии при генерации', 'true', 'toggle', 'toggles', true, 2),
('toggle_quick_replies', 'Быстрые ответы', 'Показывать кнопки быстрых ответов', 'true', 'toggle', 'toggles', true, 3),
('toggle_pushdown', 'Дожим', 'Включить сценарии дожима клиента', 'true', 'toggle', 'toggles', true, 4),
('toggle_reminders', 'Напоминания', 'Автоматические напоминания застрявшим клиентам', 'true', 'toggle', 'toggles', true, 5),
('toggle_repeat_sales', 'Повторные продажи', 'Реактивация старых клиентов', 'true', 'toggle', 'toggles', true, 6),
('toggle_memory', 'Персонализация по памяти', 'Использовать сохранённые данные клиента', 'true', 'toggle', 'toggles', true, 7),
('toggle_size_cm', 'Уточнение размера в см', 'Спрашивать длину стопы в сантиметрах', 'true', 'toggle', 'toggles', true, 8),
('toggle_clothing_params', 'Параметры одежды', 'Уточнять рост, вес, посадку для одежды', 'true', 'toggle', 'toggles', true, 9),
('toggle_photo', 'Обработка фото', 'Распознавать товары на фото', 'true', 'toggle', 'toggles', true, 10),
('toggle_objections', 'Работа с возражениями', 'Обрабатывать возражения клиента', 'true', 'toggle', 'toggles', true, 11),
('toggle_fallback', 'Fallback-ответы', 'Использовать запасные ответы при ошибках', 'true', 'toggle', 'toggles', true, 12),
('toggle_safety', 'Safety gate', 'Блокировать технические фразы в ответах', 'true', 'toggle', 'toggles', true, 13),
('toggle_anti_repeat', 'Anti-repeat', 'Не повторять одинаковые фразы', 'true', 'toggle', 'toggles', true, 14),
('toggle_anti_spam', 'Анти-спам напоминаний', 'Не слать напоминания слишком часто', 'true', 'toggle', 'toggles', true, 15),
('toggle_upsell', 'Upsell', 'Предлагать более дорогой товар если цена ниже порога', 'true', 'toggle', 'toggles', true, 16),
('toggle_schedule', 'Расписание AI', 'Ограничить работу AI по времени', 'false', 'toggle', 'toggles', false, 17),
('toggle_segments', 'Сегментация клиентов', 'Разные сценарии для новых/повторных/VIP', 'true', 'toggle', 'toggles', true, 18)
ON CONFLICT (key) DO NOTHING;

-- Память клиента — тумблеры
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('memory_use_name', 'Использовать имя', 'Обращаться к клиенту по имени', 'true', 'toggle', 'memory', true, 1),
('memory_use_size', 'Использовать прошлый размер', 'Не спрашивать размер повторно', 'true', 'toggle', 'memory', true, 2),
('memory_use_address', 'Использовать прошлый адрес', 'Предлагать сохранённый адрес', 'true', 'toggle', 'memory', true, 3),
('memory_use_phone', 'Использовать прошлый телефон', 'Предлагать сохранённый телефон', 'true', 'toggle', 'memory', true, 4),
('memory_use_last_order', 'Использовать последний заказ', 'Упоминать предыдущий заказ', 'true', 'toggle', 'memory', true, 5),
('memory_use_vip', 'VIP-статус', 'Особое обращение с VIP-клиентами', 'true', 'toggle', 'memory', true, 6),
('memory_use_behavior', 'Поведенческие признаки', 'Учитывать поведение клиента', 'true', 'toggle', 'memory', true, 7),
('memory_use_next_action', 'Рекомендации next_action', 'Использовать рекомендации системы', 'true', 'toggle', 'memory', true, 8),
('memory_use_brand_prefs', 'Предпочтения бренда', 'Учитывать любимые бренды клиента', 'true', 'toggle', 'memory', true, 9)
ON CONFLICT (key) DO NOTHING;

-- Сценарии речи
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('speech_greeting', 'Приветствие', 'Как AI приветствует нового клиента', 'Йо! Чё ищешь — кроссы, одежду?', 'textarea', 'scenarios', true, 1),
('speech_ask_size', 'Уточнение размера', 'Просьба назвать размер обуви', 'Какой размер носишь? Подберу 👟', 'textarea', 'scenarios', true, 2),
('speech_ask_insole', 'Уточнение стельки', 'Просьба измерить стопу в см', 'Скинь длину стопы в сантиметрах — точнее подберём 📏', 'textarea', 'scenarios', true, 3),
('speech_ask_clothing', 'Уточнение одежды', 'Уточнение параметров для одежды', 'Скажи рост и размер одежды — подберу что подойдёт 👕', 'textarea', 'scenarios', true, 4),
('speech_ask_address', 'Уточнение адреса', 'Просьба прислать адрес доставки', 'Скинь одним сообщением: ФИО, телефон и адрес доставки 📝', 'textarea', 'scenarios', true, 5),
('speech_ask_phone', 'Уточнение телефона', 'Просьба прислать телефон', 'Скинь телефон для связи 📞', 'textarea', 'scenarios', true, 6),
('speech_pushdown', 'Дожим', 'Фраза для дожима сомневающегося клиента', 'Размеры тают быстро — оформляем? 🔥', 'textarea', 'scenarios', true, 7),
('speech_reminder_size', 'Напоминание: размер', 'Напоминание клиенту, застрявшему на выборе размера', 'Определился с размером? Если что — подскажу 👟', 'textarea', 'scenarios', true, 8),
('speech_reminder_form', 'Напоминание: данные', 'Напоминание прислать данные для доставки', 'Осталось совсем чуть-чуть! Скинь ФИО, телефон и адрес — и оформим 🚀', 'textarea', 'scenarios', true, 9),
('speech_reminder_payment', 'Напоминание: оплата', 'Напоминание об ожидающей оплате', 'Напоминаю про заказ 💳 Переведи и скинь скрин — отправим сразу!', 'textarea', 'scenarios', true, 10),
('speech_repeat_sale', 'Повторная продажа', 'Сообщение для реактивации купившего клиента', 'Как кроссы? Если норм — у нас новая коллекция, глянь 🔥', 'textarea', 'scenarios', true, 11),
('speech_complaint', 'Работа с жалобой', 'Ответ на жалобу клиента', 'Понял, сейчас разберёмся. Опиши подробнее что случилось 🙏', 'textarea', 'scenarios', true, 12),
('speech_return', 'Работа с возвратом', 'Ответ на запрос возврата', 'Понял, помогу разобраться с возвратом. Скинь номер заказа 📋', 'textarea', 'scenarios', true, 13),
('speech_objection_price', 'Возражение: дорого', 'Ответ на возражение о цене', 'Понимаю 😊 Но это реально крутой выбор за эти деньги. Оформляем?', 'textarea', 'scenarios', true, 14),
('speech_objection_think', 'Возражение: подумаю', 'Ответ на "подумаю"', 'Ок, но размеры тают — если что, пиши 😉', 'textarea', 'scenarios', true, 15),
('speech_deal_close', 'Завершение сделки', 'Сообщение после оформления заказа', '✅ Отлично! Заказ оформлен! Проверим оплату и отправим как можно скорее. Спасибо! 🎉', 'textarea', 'scenarios', true, 16),
('speech_manager_joined', 'Менеджер подключился', 'Сообщение о подключении менеджера', 'Сейчас подключу менеджера — он поможет 😊', 'textarea', 'scenarios', true, 17),
('speech_payment_request', 'Запрос оплаты', 'Текст перед отправкой реквизитов', 'Спасибо! Данные записаны ✅ Сейчас отправлю реквизиты для оплаты 💳', 'textarea', 'scenarios', true, 18),
('speech_payment_confirm', 'Подтверждение оплаты', 'Текст после подтверждения оплаты', '✅ Отлично! Заказ оформлен! Мы проверим оплату и отправим заказ как можно скорее. Спасибо за покупку! 🎉', 'textarea', 'scenarios', true, 19),
('speech_size_measure_hint', 'Инструкция по измерению', 'Как измерить стопу, если клиент не знает размер', 'Встань на лист бумаги, обведи стопу и измерь длину от пятки до большого пальца в сантиметрах 📏', 'textarea', 'scenarios', true, 20),
('speech_waiting_response', 'Ожидание ответа', 'Сообщение пока AI думает', 'Секунду, подбираю варианты 👌', 'textarea', 'scenarios', true, 21)
ON CONFLICT (key) DO NOTHING;

-- Fallback-ответы
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('fallback_general_1', 'Fallback общий 1', 'Нейтральный ответ при ошибке', 'Секунду, уточню и вернусь с ответом 👌', 'textarea', 'fallback', true, 1),
('fallback_general_2', 'Fallback общий 2', 'Нейтральный ответ при ошибке', 'Проверяю, сейчас подскажу 😊', 'textarea', 'fallback', true, 2),
('fallback_general_3', 'Fallback общий 3', 'Нейтральный ответ при ошибке', 'Сейчас гляну, минутку ⏳', 'textarea', 'fallback', true, 3),
('fallback_ai_down_1', 'Fallback AI недоступен 1', 'Когда AI не отвечает', 'Сейчас уточню у коллег и вернусь 👌', 'textarea', 'fallback', true, 4),
('fallback_ai_down_2', 'Fallback AI недоступен 2', 'Когда AI не отвечает', 'Передал менеджеру — скоро ответим 😊', 'textarea', 'fallback', true, 5),
('fallback_blocked_1', 'Fallback заблокирован 1', 'Когда safety gate блокирует ответ', 'Подскажи подробнее что ищешь — помогу 😉', 'textarea', 'fallback', true, 6),
('fallback_blocked_2', 'Fallback заблокирован 2', 'Когда safety gate блокирует ответ', 'Расскажи чуть больше, подберём лучший вариант 👟', 'textarea', 'fallback', true, 7),
('fallback_waiting_size', 'Fallback: ожидание размера', 'Запасной ответ в состоянии выбора размера', 'Какой размер носишь? Подберу 👟', 'textarea', 'fallback', true, 8),
('fallback_waiting_form', 'Fallback: ожидание данных', 'Запасной ответ в состоянии сбора данных', 'Скинь ФИО, телефон и адрес — и оформим 🚀', 'textarea', 'fallback', true, 9),
('fallback_waiting_payment', 'Fallback: ожидание оплаты', 'Запасной ответ в состоянии ожидания оплаты', 'Заказ ждёт оплаты — переведи и скинь скрин 💳', 'textarea', 'fallback', true, 10),
('fallback_not_configured', 'Fallback: каталог не настроен', 'Когда каталог не подключён', 'Скинь что ищешь — менеджер подберёт лучший вариант 🙏', 'textarea', 'fallback', true, 11),
('fallback_api_error', 'Fallback: ошибка API', 'Когда API каталога недоступен', 'Скинь что интересует — менеджер поможет 🙏', 'textarea', 'fallback', true, 12),
('fallback_empty_catalog', 'Fallback: пустой каталог', 'Когда каталог пуст', 'Напиши что ищешь, менеджер подскажет 🙏', 'textarea', 'fallback', true, 13),
('fallback_robot_reveal', 'Fallback: AI раскрыл себя', 'Когда AI написал что он бот', 'Чё ищешь? Помогу подобрать 😊', 'textarea', 'fallback', true, 14),
('fallback_negative_avail', 'Fallback: сказал "нет в наличии"', 'Когда AI написал что товара нет', 'Сейчас гляну по наличию 👀 Если что — подберу похожие. Какой размер нужен?', 'textarea', 'fallback', true, 15),
('fallback_price_error', 'Fallback: неверная цена', 'Когда AI назвал неверную цену', 'Секунду, уточню актуальную цену. Что именно интересует? 🤔', 'textarea', 'fallback', true, 16)
ON CONFLICT (key) DO NOTHING;

-- Soft-ответы (мягкий режим наличия)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('soft_response_1', 'Soft-ответ 1', 'Мягкий ответ при отсутствии точного товара', 'Понял, сейчас гляну по наличию 👀 Если именно этой нет — подберу максимально похожие. Какой размер нужен?', 'textarea', 'soft', true, 1),
('soft_response_2', 'Soft-ответ 2', 'Мягкий ответ при отсутствии точного товара', 'Хороший выбор 👍 Сейчас проверю наличие. Если что — есть очень похожие варианты. Размер какой?', 'textarea', 'soft', true, 2),
('soft_response_3', 'Soft-ответ 3', 'Мягкий ответ при отсутствии точного товара', 'Норм модель 🔥 Гляну что есть. А пока скажи — какой размер носишь?', 'textarea', 'soft', true, 3)
ON CONFLICT (key) DO NOTHING;

-- Offtopic редиректы
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('offtopic_redirect_1', 'Редирект с оффтопа 1', 'Мягкий возврат к теме покупки', 'Кстати, у нас новинки подъехали — глянешь? 🔥', 'textarea', 'offtopic', true, 1),
('offtopic_redirect_2', 'Редирект с оффтопа 2', 'Мягкий возврат к теме покупки', 'Хорош) А по кроссам — что-нибудь ищешь?', 'textarea', 'offtopic', true, 2),
('offtopic_redirect_3', 'Редирект с оффтопа 3', 'Мягкий возврат к теме покупки', 'Ладно, а если по делу — чё присматриваешь? 👟', 'textarea', 'offtopic', true, 3),
('offtopic_redirect_4', 'Редирект с оффтопа 4', 'Мягкий возврат к теме покупки', 'Давай лучше тебе что-нибудь крутое подберём 😎', 'textarea', 'offtopic', true, 4),
('offtopic_redirect_5', 'Редирект с оффтопа 5', 'Мягкий возврат к теме покупки', 'Я по кроссам и одежде спец — давай помогу выбрать?', 'textarea', 'offtopic', true, 5)
ON CONFLICT (key) DO NOTHING;

-- Nudge-цепочки (напоминания)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('nudge_payment_1h', 'Напоминание оплата 1ч', 'Первое напоминание об оплате через 1 час', 'Привет! Всё ок? Заказ ждёт — если есть вопросы, пиши 😊', 'textarea', 'nudges', true, 1),
('nudge_payment_24h', 'Напоминание оплата 24ч', 'Второе напоминание об оплате через 24 часа', 'Напоминаю про заказ 💳 Переведи и скинь скрин — отправим сразу!', 'textarea', 'nudges', true, 2),
('nudge_payment_3d', 'Напоминание оплата 3д', 'Третье напоминание об оплате через 3 дня', 'Заказ всё ещё ждёт! Может, оформим? Если что-то смущает — скажи, решим 🤝', 'textarea', 'nudges', true, 3),
('nudge_form_1h', 'Напоминание данные 1ч', 'Первое напоминание прислать данные через 1 час', 'Осталось совсем чуть-чуть! Скинь ФИО, телефон и адрес — и оформим 🚀', 'textarea', 'nudges', true, 4),
('nudge_form_24h', 'Напоминание данные 24ч', 'Второе напоминание прислать данные через 24 часа', 'Привет! Заказ на паузе — жду данные для доставки. Скинь одним сообщением 📝', 'textarea', 'nudges', true, 5),
('nudge_form_3d', 'Напоминание данные 3д', 'Третье напоминание прислать данные через 3 дня', 'Заказ всё ещё можно оформить! Скинь ФИО, телефон и адрес — отправим 🎁', 'textarea', 'nudges', true, 6),
('nudge_size_1h', 'Напоминание размер 1ч', 'Первое напоминание выбрать размер через 1 час', 'Определился с размером? Если что — подскажу 👟', 'textarea', 'nudges', true, 7),
('nudge_size_24h', 'Напоминание размер 24ч', 'Второе напоминание выбрать размер через 24 часа', 'Привет! Ещё думаешь? Могу показать популярные размеры и модели 😉', 'textarea', 'nudges', true, 8)
ON CONFLICT (key) DO NOTHING;

-- Поведенческие правила (очищены от дублей)
-- Удалены: rule_no_long_messages (дубль seller_msg_length), rule_no_repeat (дубль toggle_anti_repeat)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('rule_no_ai_reveal', 'Не раскрывать AI', 'Никогда не говорить что это бот', 'true', 'toggle', 'rules', true, 1),
('rule_no_tech_phrases', 'Без технических фраз', 'Не использовать технические термины', 'true', 'toggle', 'rules', true, 2),
('rule_no_template_copy', 'Не копировать шаблон', 'Не воспроизводить шаблон дословно', 'true', 'toggle', 'rules', true, 3),
('rule_no_argue', 'Не спорить', 'Не спорить с клиентом', 'true', 'toggle', 'rules', true, 4),
('rule_no_internal_errors', 'Скрывать ошибки', 'Не сообщать о внутренних ошибках', 'true', 'toggle', 'rules', true, 5),
('rule_low_confidence_fallback', 'Fallback при низкой уверенности', 'При низкой уверенности — передавать менеджеру', 'true', 'toggle', 'rules', true, 6)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════
-- ДЕНЕЖНЫЕ МЕХАНИКИ — влияют на конверсию
-- ═══════════════════════════════════════

-- Дожим по цене
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('pushdown_price_threshold', 'Порог дожима (руб)', 'Усиливать дожим если цена товара выше этой суммы. 0 = всегда', '5000', 'text', 'sales', true, 1),
('upsell_threshold', 'Порог upsell (руб)', 'Предлагать более дорогой товар если цена ниже этой суммы', '8000', 'text', 'sales', true, 2),
('upsell_hint', 'Фраза upsell', 'Как предложить более дорогой вариант', 'Кстати, есть похожая модель чуть дороже — но качество заметно лучше. Показать?', 'textarea', 'sales', true, 3),
('manager_threshold_messages', 'Порог передачи менеджеру (сообщений)', 'Передать менеджеру если клиент задал больше N вопросов без покупки', '10', 'text', 'sales', true, 4),
('manager_threshold_keywords', 'Ключевые слова → менеджер', 'Слова через запятую — при их появлении передать менеджеру', 'жалоба,возврат,брак,обмен,сломал,порвал,менеджер,оператор,человек,проблема с доставк,не пришл,не получил,потерял', 'textarea', 'sales', true, 5),
('stop_words', 'Стоп-слова AI', 'Слова через запятую — AI никогда их не использует', '', 'textarea', 'sales', false, 6),
('ai_schedule_enabled', 'Расписание активно', 'Ограничить работу AI по времени суток', 'false', 'toggle', 'sales', false, 7),
('ai_schedule_start', 'Начало работы AI', 'Время начала работы AI (формат HH:MM)', '09:00', 'text', 'sales', false, 8),
('ai_schedule_end', 'Конец работы AI', 'Время окончания работы AI (формат HH:MM)', '22:00', 'text', 'sales', false, 9),
('ai_schedule_fallback', 'Ответ вне расписания', 'Что отвечать клиенту вне рабочего времени', 'Привет! Сейчас не рабочее время, но утром обязательно ответим. Напиши что интересует — разберёмся!', 'textarea', 'sales', false, 10)
ON CONFLICT (key) DO NOTHING;

-- Heat клиента
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('heat_hot_threshold', 'Порог "горячий" (сообщений)', 'Клиент считается горячим если написал N+ сообщений', '5', 'text', 'sales', true, 11),
('heat_cold_days', 'Порог "холодный" (дней)', 'Клиент считается холодным если не писал N+ дней', '7', 'text', 'sales', true, 12),
('heat_hot_hint', 'Подсказка AI: горячий клиент', 'Инструкция AI для горячего клиента', 'Клиент активный и заинтересованный. Дожимай мягко, предложи оформить прямо сейчас.', 'textarea', 'sales', true, 13),
('heat_warm_hint', 'Подсказка AI: тёплый клиент', 'Инструкция AI для тёплого клиента', 'Клиент думает. Помоги определиться, задай уточняющий вопрос.', 'textarea', 'sales', true, 14),
('heat_cold_hint', 'Подсказка AI: холодный клиент', 'Инструкция AI для холодного клиента', 'Клиент давно не писал. Напомни о себе, предложи новинки или скидку.', 'textarea', 'sales', true, 15)
ON CONFLICT (key) DO NOTHING;

-- Сегментация клиентов
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('segment_new_hint', 'Сценарий: новый клиент', 'Инструкция AI для нового клиента (первый контакт)', 'Клиент новый. Будь дружелюбным, узнай что ищет, не давай сразу. Один вопрос.', 'textarea', 'segments', true, 1),
('segment_returning_hint', 'Сценарий: повторный клиент', 'Инструкция AI для клиента который уже покупал', 'Клиент уже покупал у нас. Прими как старого знакомого, используй историю покупок.', 'textarea', 'segments', true, 2),
('segment_vip_hint', 'Сценарий: VIP клиент', 'Инструкция AI для VIP клиента (3+ заказа или сумма > 30000)', 'VIP клиент. Особое внимание, предложи эксклюзив, не торопи с оплатой.', 'textarea', 'segments', true, 3),
('segment_vip_threshold_orders', 'VIP: минимум заказов', 'Количество заказов для получения VIP статуса', '3', 'text', 'segments', true, 4),
('segment_vip_threshold_amount', 'VIP: минимальная сумма (руб)', 'Общая сумма покупок для VIP статуса', '30000', 'text', 'segments', true, 5),
('segment_new_greeting', 'Приветствие: новый клиент', 'Особое приветствие для нового клиента', '', 'textarea', 'segments', false, 6),
('segment_returning_greeting', 'Приветствие: повторный клиент', 'Особое приветствие для вернувшегося клиента', 'С возвращением! Рад снова тебя видеть. Что на этот раз?', 'textarea', 'segments', true, 7),
('segment_vip_greeting', 'Приветствие: VIP', 'Особое приветствие для VIP клиента', 'Привет! Всегда рад. Для тебя — лучшее из новинок. Что смотришь?', 'textarea', 'segments', true, 8)
ON CONFLICT (key) DO NOTHING;

-- State hints для AI (подсказки по состоянию)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('hint_new', 'Подсказка: NEW', 'Инструкция AI для нового клиента', 'Клиент новый. Узнай что ищет. Задай ОДИН вопрос.', 'textarea', 'hints', true, 1),
('hint_waiting_size', 'Подсказка: WAITING_SIZE', 'Инструкция AI при выборе размера', 'Клиент выбирает товар/размер. Помоги определиться. Один вопрос.', 'textarea', 'hints', true, 2),
('hint_waiting_form', 'Подсказка: WAITING_FORM', 'Инструкция AI при сборе данных', 'Клиент готов оформить. Попроси ФИО, телефон, адрес одним сообщением.', 'textarea', 'hints', true, 3),
('hint_waiting_payment', 'Подсказка: WAITING_PAYMENT', 'Инструкция AI при ожидании оплаты', 'Ждём оплату. Если клиент молчит — мягко напомни. Если сомневается — дожми.', 'textarea', 'hints', true, 4),
('hint_paid', 'Подсказка: PAID', 'Инструкция AI после оплаты', 'Клиент оплатил. Поблагодари, предложи что-то ещё если уместно.', 'textarea', 'hints', true, 5),
('hint_done', 'Подсказка: DONE', 'Инструкция AI для завершённого клиента', 'Завершённый клиент. Если вернулся — прими как старого знакомого.', 'textarea', 'hints', true, 6),
('hint_followup', 'Подсказка: FOLLOWUP', 'Инструкция AI для реактивации', 'Реактивация неактивного клиента. Пиши коротко, как живой человек.', 'textarea', 'hints', true, 7)
ON CONFLICT (key) DO NOTHING;
-- Промпты AI — перенесены в ai_speech_settings как категория 'prompts'
-- Значения синхронизируются из prompt_settings при первом запуске
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order)
SELECT
  'prompt_' || key,
  CASE key
    WHEN 'core_prompt' THEN 'Основной промпт (личность AI)'
    WHEN 'sales_prompt' THEN 'Промпт продаж (логика воронки)'
    WHEN 'followup_prompt' THEN 'Промпт реактивации (возврат клиентов)'
    ELSE key
  END,
  CASE key
    WHEN 'core_prompt' THEN 'Системная инструкция — кто такой AI, стиль, правила поведения'
    WHEN 'sales_prompt' THEN 'Логика воронки продаж по состояниям клиента'
    WHEN 'followup_prompt' THEN 'Сценарии реактивации неактивных клиентов'
    ELSE ''
  END,
  value,
  'textarea',
  'prompts',
  true,
  CASE key
    WHEN 'core_prompt' THEN 1
    WHEN 'sales_prompt' THEN 2
    WHEN 'followup_prompt' THEN 3
    ELSE 99
  END
FROM prompt_settings
ON CONFLICT (key) DO NOTHING;

-- Недостающие записи персоны (seller_address_format, sales_style_preset)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('seller_address_format', 'Формат обращения', 'На ты или на вы — строго соблюдается во всех ответах', 'ты', 'select', 'persona', true, 6),
('sales_style_preset', 'Пресет стиля продаж', 'Общий стиль поведения продавца', 'friendly', 'select', 'persona', true, 7)
ON CONFLICT (key) DO NOTHING;

-- Тумблеры self-check и anti-repeat (чувствительность)
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('toggle_self_check', 'Self-check перед отправкой', 'Проверять ответ на шаблонность, ты/вы, технические слова перед отправкой клиенту', 'true', 'toggle', 'toggles', true, 21),
('anti_repeat_sensitivity', 'Чувствительность anti-repeat', 'Порог схожести ответов (0.0–1.0). Чем выше — тем строже', '0.6', 'text', 'toggles', true, 22)
ON CONFLICT (key) DO NOTHING;

-- Хардкод-тексты из sales.js — перенесены в AI Settings
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('speech_size_recorded', 'Размер записан', 'Подтверждение записи размера + предложение выбрать из списка', 'Размер {{size}} — записал', 'textarea', 'scenarios', true, 22),
('speech_size_confirm_low', 'Уточнение товара (низкая уверенность)', 'Когда AI не уверен в товаре — уточняет', 'Размер {{size}} — отлично! Вы имеете в виду {{product}} за {{price}}? Подтвердите, и оформим заказ', 'textarea', 'scenarios', true, 23),
('speech_price_clarify', 'Уточнение цены', 'Когда у товара нет цены', '{{product}} — отличный выбор. Уточняю цену, скоро скину. Размер {{size}} — верно?', 'textarea', 'scenarios', true, 24),
('speech_stock_check', 'Проверка наличия', 'Когда товар может быть не в наличии', '{{product}} — огонь выбор. Сейчас уточню наличие. А пока глянь похожие:', 'textarea', 'scenarios', true, 25),
('speech_stock_check_no_alt', 'Проверка наличия без альтернатив', 'Когда нет альтернатив', '{{product}} — отличный вкус. Уточняю наличие, скоро отвечу. Какой размер нужен?', 'textarea', 'scenarios', true, 26),
('speech_order_summary', 'Итог заказа', 'Подтверждение заказа перед оплатой', 'Отлично! Записал:', 'textarea', 'scenarios', true, 27),
('speech_restart', 'Перезапуск диалога', 'Когда заказ не найден — предложить начать заново', 'Давай начнём заново — что хотите заказать?', 'textarea', 'scenarios', true, 28),
('speech_photo_recognized', 'Фото распознано', 'Когда AI распознал товар на фото', 'Понял, {{desc}}. Какой размер носишь?', 'textarea', 'scenarios', true, 29),
('speech_photo_not_recognized', 'Фото не распознано', 'Когда AI не смог распознать фото', 'Хороший выбор! Вот что сейчас есть:', 'textarea', 'scenarios', true, 30),
('speech_hesitation_pushdown', 'Дожим при колебании', 'Когда клиент сомневается в состоянии WAITING_PAYMENT', 'Понимаю. Но {{product}} — это реально крутой выбор.', 'textarea', 'scenarios', true, 31),
('speech_payment_card', 'Реквизиты оплаты', 'Текст сообщения с реквизитами для оплаты', 'Реквизиты для оплаты:\n\nКарта: {{cardNumber}}\nПолучатель: {{cardName}}{{amount}}\n\nПереведи и скинь скрин/чек — сразу отправим заказ', 'textarea', 'scenarios', true, 32),
('speech_start_bizchat', 'Подключение бизнес-чата', 'Ответ на /start bizChat', 'Подключение успешно', 'textarea', 'scenarios', true, 33),
('speech_waiting_fallback', 'Ожидание (fallback очереди)', 'Сообщение пока AI обрабатывает запрос в очереди', 'Секунду, подбираю варианты', 'textarea', 'scenarios', true, 34)
ON CONFLICT (key) DO NOTHING;

-- Quick replies — тексты из routes.js
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('qr_new_1', 'Быстрый ответ: новый клиент 1', 'Кнопка для нового клиента', 'Что ищете? Кроссовки, одежду?', 'textarea', 'quick_replies', true, 1),
('qr_new_2', 'Быстрый ответ: новый клиент 2', 'Кнопка для нового клиента', 'Показать популярные модели?', 'textarea', 'quick_replies', true, 2),
('qr_new_3', 'Быстрый ответ: новый клиент 3', 'Кнопка для нового клиента', 'Какой размер носите?', 'textarea', 'quick_replies', true, 3),
('qr_size_alt', 'Быстрый ответ: альтернативы', 'Кнопка при выборе размера', 'Показать похожие варианты?', 'textarea', 'quick_replies', true, 4),
('qr_form_delivery', 'Быстрый ответ: доставка', 'Кнопка при сборе данных', 'Доставка по всей России', 'textarea', 'quick_replies', true, 5),
('qr_payment_card', 'Быстрый ответ: реквизиты', 'Кнопка при ожидании оплаты', 'Скинуть реквизиты для оплаты?', 'textarea', 'quick_replies', true, 6),
('qr_payment_after', 'Быстрый ответ: после оплаты', 'Кнопка после оплаты', 'После оплаты скиньте скрин', 'textarea', 'quick_replies', true, 7),
('qr_done_feedback', 'Быстрый ответ: отзыв', 'Кнопка для завершённого клиента', 'Как вам товар?', 'textarea', 'quick_replies', true, 8),
('qr_done_welcome', 'Быстрый ответ: рады видеть', 'Кнопка для завершённого клиента', 'Рады видеть снова', 'textarea', 'quick_replies', true, 9)
ON CONFLICT (key) DO NOTHING;
`;

const errorTrackingMigration = `
CREATE TABLE IF NOT EXISTS ai_errors (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  state VARCHAR(50),
  intent VARCHAR(50),
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_errors_user ON ai_errors(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_errors_category ON ai_errors(category);
CREATE INDEX IF NOT EXISTS idx_ai_errors_created ON ai_errors(created_at DESC);
`;

const analyticsMigration = `
CREATE TABLE IF NOT EXISTS funnel_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  state VARCHAR(50),
  intent VARCHAR(50),
  ab_variant VARCHAR(100),
  response_key VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_user ON funnel_events(user_id);
CREATE INDEX IF NOT EXISTS idx_funnel_events_event ON funnel_events(event);
CREATE INDEX IF NOT EXISTS idx_funnel_events_created ON funnel_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_events_ab ON funnel_events(ab_variant) WHERE ab_variant IS NOT NULL;
`;

const abAndAnalyticsMigration = `
-- A/B тесты — варианты фраз
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('ab_pushdown_a', 'Дожим вариант A', 'Первый вариант фразы дожима для A/B теста', 'Размеры тают быстро — оформляем? 🔥', 'textarea', 'ab_tests', true, 1),
('ab_pushdown_b', 'Дожим вариант B', 'Второй вариант фразы дожима для A/B теста', 'Эту модель берут чаще всего — не упусти свой размер 👟', 'textarea', 'ab_tests', true, 2),
('ab_greeting_a', 'Приветствие вариант A', 'Первый вариант приветствия для A/B теста', 'Йо! Чё ищешь — кроссы, одежду?', 'textarea', 'ab_tests', true, 3),
('ab_greeting_b', 'Приветствие вариант B', 'Второй вариант приветствия для A/B теста', 'Привет! Помогу подобрать — что смотришь?', 'textarea', 'ab_tests', true, 4),
('ab_upsell_a', 'Upsell вариант A', 'Первый вариант upsell предложения', 'Кстати, есть похожая модель чуть дороже — но качество заметно лучше. Показать?', 'textarea', 'ab_tests', true, 5),
('ab_upsell_b', 'Upsell вариант B', 'Второй вариант upsell предложения', 'Есть вариант на ступень выше — носится дольше и смотрится круче. Интересно?', 'textarea', 'ab_tests', true, 6),
('toggle_ab_testing', 'A/B тестирование', 'Включить A/B тестирование фраз', 'true', 'toggle', 'ab_tests', true, 7)
ON CONFLICT (key) DO NOTHING;
`;

const messengerMigration = `
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS pinned BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_reason VARCHAR(100);
  ALTER TABLE users ADD COLUMN IF NOT EXISTS attention_override BOOLEAN DEFAULT FALSE;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
`;

const paidAtMigration = `
  ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
  CREATE INDEX IF NOT EXISTS idx_orders_paid_at ON orders(paid_at) WHERE paid_at IS NOT NULL;
`;

const aiUsageMigration = `
CREATE TABLE IF NOT EXISTS ai_usage (
  id SERIAL PRIMARY KEY,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  model VARCHAR(100),
  provider VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at DESC);
`;

const paymentSettingsMigration = `
INSERT INTO settings (key, value) VALUES
  ('payment_card_number', ''),
  ('payment_name', ''),
  ('payment_bank_name', ''),
  ('payment_receiver_name', '')
ON CONFLICT (key) DO NOTHING;
`;

async function migrate() {
  try {
    await pool.query(schema);
    await pool.query(migrations);
    await pool.query(aiSettingsMigration);
    await pool.query(errorTrackingMigration);
    await pool.query(analyticsMigration);
    await pool.query(abAndAnalyticsMigration);
    await pool.query(messengerMigration);
    await pool.query(paidAtMigration);
    await pool.query(aiUsageMigration);
    await pool.query(paymentSettingsMigration);
    await pool.query(`
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
-- Closer nudges (агрессивные дожимы при молчании)
('nudge_payment_closer_1h', 'Closer: дожим оплата 1ч', 'Напоминание об оплате через 1 час (closer стиль)', 'Всё ещё актуально? Заказ ждёт — могу зафиксировать за вами 👌', 'textarea', 'nudges', true, 21),
('nudge_payment_closer_24h', 'Closer: дожим оплата 24ч', 'Напоминание об оплате через 24 часа (closer стиль)', 'Последние пары этого размера — оформляем? 🔥', 'textarea', 'nudges', true, 22),
('nudge_form_closer_1h', 'Closer: дожим данные 1ч', 'Напоминание прислать данные через 1 час (closer стиль)', 'Осталось только скинуть данные — и сразу отправим 👌', 'textarea', 'nudges', true, 23),
-- Closer quick replies
('qr_closer_confirm', 'Closer: подтвердить наличие', 'Быстрый ответ для подтверждения наличия', 'Да, есть в наличии 👌', 'textarea', 'quick_replies', true, 21),
('qr_closer_close', 'Closer: закрыть сделку', 'Быстрый ответ для закрытия', 'Оформляем? Могу сразу отправить реквизиты', 'textarea', 'quick_replies', true, 22),
('qr_closer_urgency', 'Closer: срочность', 'Быстрый ответ для создания срочности', 'Последние пары — могу зафиксировать за вами 🔥', 'textarea', 'quick_replies', true, 23)
ON CONFLICT (key) DO NOTHING;
    `);
    await pool.query(`
INSERT INTO ai_speech_settings (key, label, description, value, type, category, enabled, sort_order) VALUES
('style_closer_hint', 'Closer: промпт', 'Инструкция для режима Closer — редактируется из веба, применяется сразу', 'Ты — опытный менеджер по продажам в личных сообщениях (Telegram/чат).
Твоя задача — быстро и уверенно закрыть клиента на оплату.

КРИТИЧЕСКИ ВАЖНО: Если клиент уже назвал размер — НЕ спрашивай размер снова. Сразу переходи к оформлению.

ПРАВИЛА:
1. Всегда подтверждай наличие. Никогда: "нет", "уточню", "проверю", "нет в наличии".
2. Пиши коротко — 1-2 предложения. Как живой человек, без формальностей.
3. Каждое сообщение = следующий шаг к оплате.
4. Ты уверен. Не сомневаешься. Товар есть.
5. Дефицит (умеренно): "последние пары", "быстро разбирают", "могу зафиксировать".
6. Социальное доказательство: "сейчас часто берут", "популярная модель".

СТРУКТУРА ДИАЛОГА:
- Клиент спрашивает о товаре → "Да, есть 👌 [усиление]. Какой размер нужен?"
- Клиент называет размер → "Ваш размер есть 👌 Оформляем? Могу сразу отправить реквизиты"
- Клиент называет товар И размер → "Есть 👌 Оформляем? Скинь ФИО, телефон и адрес"
- Клиент соглашается → сбор данных и оплата

ВОЗРАЖЕНИЯ (отвечай коротко и сразу возвращай к покупке):
- "скам/не отправите/не доверяю" → "Понимаю, это нормально 👌 Работаем давно, после оплаты сразу передаём на отправку. Оформляем?"
- "подумаю" → "Понимаю 👌 Последние пары этого размера — могу зафиксировать за вами прямо сейчас?"
- "дорого" → "Понимаю 👌 Зато оригинал, в магазинах дороже. Оформляем?"
- "наложенный платёж" → "Работаем по предоплате — стандарт онлайн. После оплаты сразу отправляем 👌"
- "долго думает/молчит" → "Всё ещё актуально? Могу зафиксировать за вами 👌"

ПОСЛЕ ОПЛАТЫ: "Спасибо за заказ ✅ Передаю на отправку"

ЗАПРЕЩЕНО: "нет", "уточню", "проверю", "к сожалению", длинные объяснения, задавать вопрос о размере если размер уже назван.', 'textarea', 'sales', true, 99),
('closer_mode_enabled', 'Режим Closer', 'Включить режим агрессивного закрытия (всегда подтверждает наличие)', 'false', 'toggle', 'sales', false, 100)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, description = EXCLUDED.description;
    `);
    await pool.query(`
CREATE TABLE IF NOT EXISTS ai_failures (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(100),
  error_type VARCHAR(50),
  message TEXT,
  fallback_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_failures_created ON ai_failures(created_at DESC);
    `);
    await pool.query(`
INSERT INTO settings (key, value) VALUES
  ('secondary_ai_base_url', ''),
  ('secondary_ai_api_key', ''),
  ('secondary_ai_model', '')
ON CONFLICT (key) DO NOTHING;
    `);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
