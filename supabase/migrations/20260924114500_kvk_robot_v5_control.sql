alter table public.softora_kvk_api_budget
  add column if not exists robot_enabled boolean not null default false,
  add column if not exists robot_requested_at timestamptz,
  add column if not exists robot_heartbeat_at timestamptz,
  add column if not exists robot_message text not null default '',
  add column if not exists robot_batch text not null default '';
