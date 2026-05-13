create table customer_facts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  key text not null,
  value text not null,
  confidence real not null default 1.0,
  source text not null default 'ai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, key)
);

create index idx_customer_facts_customer on customer_facts(customer_id);
