create table if not exists crm_dialog_state (
  chat_id uuid primary key references chats(id) on delete cascade,
  stage text not null default 'none',
  expected_action text not null default 'none',
  expected_since timestamptz,
  drop_stage text not null default 'none',
  drop_detected_at timestamptz,
  confidence numeric(4,3) not null default 0,
  reason text not null default '',
  evidence jsonb not null default '{}'::jsonb,
  blocked_reason text not null default '',
  followup_attempted boolean not null default false,
  last_customer_message_at timestamptz,
  last_outbound_message_at timestamptz,
  last_followup_at timestamptz,
  followup_actor text not null default '',
  calculated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_dialog_state_drop_stage_idx on crm_dialog_state(drop_stage, calculated_at desc);
create index if not exists crm_dialog_state_expected_action_idx on crm_dialog_state(expected_action, expected_since desc);
