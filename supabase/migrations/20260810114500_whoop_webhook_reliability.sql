alter table public.softora_health_whoop_connections
  add column if not exists token_refresh_lock_id text,
  add column if not exists token_refresh_lock_until timestamptz;

create table if not exists public.softora_health_whoop_webhook_events (
  trace_id text primary key,
  whoop_user_id bigint not null,
  resource_id text not null default '',
  event_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text
);

create index if not exists softora_health_whoop_webhook_events_queue_idx
  on public.softora_health_whoop_webhook_events (status, next_attempt_at, received_at);

alter table public.softora_health_whoop_webhook_events enable row level security;
revoke all on table public.softora_health_whoop_webhook_events from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_health_whoop_webhook_events to service_role;
