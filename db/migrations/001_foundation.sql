create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'telegram',
  telegram_user_id text,
  telegram_username text,
  first_name text,
  last_name text,
  display_name text,
  phone text,
  notes text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, telegram_user_id)
);

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'telegram',
  external_chat_id text not null,
  customer_id uuid references customers(id) on delete set null,
  business_connection_id text,
  title text,
  status text not null default 'open',
  ai_enabled boolean not null default true,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_chat_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  role text not null check (role in ('customer', 'assistant', 'operator', 'system')),
  text text not null,
  telegram_message_id text,
  trace_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_chat_telegram_message_id_idx
  on messages(chat_id, telegram_message_id)
  where telegram_message_id is not null;

create index if not exists messages_chat_created_at_idx on messages(chat_id, created_at);
create index if not exists messages_trace_id_idx on messages(trace_id);

create table if not exists events (
  id bigserial primary key,
  trace_id text,
  event_type text not null,
  source text not null default 'server',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_created_at_idx on events(created_at);
create index if not exists events_trace_id_idx on events(trace_id);
create index if not exists events_event_type_idx on events(event_type);

create table if not exists ai_turns (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete set null,
  trace_id text not null,
  model text not null,
  request_messages jsonb not null default '[]'::jsonb,
  response_text text,
  latency_ms integer,
  ok boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists ai_turns_chat_created_at_idx on ai_turns(chat_id, created_at);
create index if not exists ai_turns_trace_id_idx on ai_turns(trace_id);
