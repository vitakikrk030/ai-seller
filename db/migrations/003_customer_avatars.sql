alter table customers
  add column if not exists avatar_file_id text,
  add column if not exists avatar_updated_at timestamptz;

create index if not exists idx_customers_avatar_updated
  on customers (avatar_updated_at desc)
  where avatar_file_id is not null;
