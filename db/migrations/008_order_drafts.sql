create table if not exists order_drafts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  chat_id uuid references chats(id) on delete cascade,
  source text not null default 'telegram',
  status text not null default 'active' check (status in ('active', 'paid', 'closed', 'cancelled')),
  current_step text not null default 'intent' check (current_step in ('intent', 'delivery', 'payment', 'support', 'done')),
  intent_data jsonb not null default '{}'::jsonb,
  delivery_data jsonb not null default '{}'::jsonb,
  payment_data jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  locked_after_payment boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_drafts_customer_updated_idx on order_drafts(customer_id, updated_at desc);
create index if not exists order_drafts_chat_updated_idx on order_drafts(chat_id, updated_at desc);
create index if not exists order_drafts_status_updated_idx on order_drafts(status, updated_at desc);

create unique index if not exists order_drafts_active_chat_uidx
  on order_drafts(chat_id)
  where status = 'active' and chat_id is not null;

create unique index if not exists order_drafts_active_customer_uidx
  on order_drafts(customer_id)
  where status = 'active' and customer_id is not null;
