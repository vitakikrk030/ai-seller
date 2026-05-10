alter table chats
  add column if not exists notes text,
  add column if not exists priority integer not null default 0,
  add column if not exists assigned_to text,
  add column if not exists last_read_at timestamptz;

create index if not exists chats_status_updated_at_idx on chats(status, updated_at desc);
create index if not exists chats_source_updated_at_idx on chats(source, updated_at desc);
create index if not exists chats_ai_enabled_updated_at_idx on chats(ai_enabled, updated_at desc);
create index if not exists customers_display_name_idx on customers(display_name);
