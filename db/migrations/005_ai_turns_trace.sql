-- Extend ai_turns with full trace data for Inspector UI
alter table ai_turns add column if not exists compiled_prompt text;
alter table ai_turns add column if not exists memory_summary text;
alter table ai_turns add column if not exists input_text text;
alter table ai_turns add column if not exists history_length integer;
alter table ai_turns add column if not exists structured_response jsonb;
