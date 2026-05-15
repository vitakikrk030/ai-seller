create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  chat_id uuid references chats(id) on delete set null,
  source text not null default 'telegram',
  trace_id text,
  status text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'cancelled', 'refunded')),
  total_amount integer,
  currency text not null default 'RUB',
  summary text,
  snapshot jsonb not null default '{}'::jsonb,
  payment_message_id text,
  receipt_message_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_customer_created_at_idx on orders(customer_id, created_at desc);
create index if not exists orders_chat_created_at_idx on orders(chat_id, created_at desc);
create index if not exists orders_status_created_at_idx on orders(status, created_at desc);
create index if not exists orders_trace_id_idx on orders(trace_id);
