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

-- Legacy schema catch-up: add missing base columns if database was created
-- before the current initial schema existed.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='state') THEN
    ALTER TABLE users ADD COLUMN state VARCHAR(50) DEFAULT 'NEW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='ai_enabled') THEN
    ALTER TABLE users ADD COLUMN ai_enabled BOOLEAN DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='last_seen') THEN
    ALTER TABLE users ADD COLUMN last_seen TIMESTAMPTZ DEFAULT NOW();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='created_at') THEN
    ALTER TABLE users ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='role') THEN
    ALTER TABLE messages ADD COLUMN role VARCHAR(10) DEFAULT 'user';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='text') THEN
    ALTER TABLE messages ADD COLUMN text TEXT DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='messages' AND column_name='created_at') THEN
    ALTER TABLE messages ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_role') THEN
    ALTER TABLE messages DROP CONSTRAINT chk_messages_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_messages_role') THEN
    ALTER TABLE messages ADD CONSTRAINT chk_messages_role CHECK (role IN ('user', 'ai', 'admin'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='product') THEN
    ALTER TABLE orders ADD COLUMN product VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='size') THEN
    ALTER TABLE orders ADD COLUMN size VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='price') THEN
    ALTER TABLE orders ADD COLUMN price NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='full_name') THEN
    ALTER TABLE orders ADD COLUMN full_name VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='phone') THEN
    ALTER TABLE orders ADD COLUMN phone VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='address') THEN
    ALTER TABLE orders ADD COLUMN address TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='status') THEN
    ALTER TABLE orders ADD COLUMN status VARCHAR(50) DEFAULT 'NEW';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='created_at') THEN
    ALTER TABLE orders ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='prompt_settings' AND column_name='updated_at') THEN
    ALTER TABLE prompt_settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='updated_at') THEN
    ALTER TABLE settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

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

-- AI handoff: dialogs where the AI decided a human should step in
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='needs_manager') THEN
    ALTER TABLE users ADD COLUMN needs_manager BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='handoff_reason') THEN
    ALTER TABLE users ADD COLUMN handoff_reason VARCHAR(50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='handoff_summary') THEN
    ALTER TABLE users ADD COLUMN handoff_summary TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='handoff_at') THEN
    ALTER TABLE users ADD COLUMN handoff_at TIMESTAMPTZ;
  END IF;
END $$;

-- Customer memory: create before memory upgrade columns below
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
CREATE INDEX IF NOT EXISTS idx_users_needs_manager ON users(needs_manager, handoff_at DESC) WHERE needs_manager = true;

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

async function migrate() {
  try {
    await pool.query(schema);
    await pool.query(migrations);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
