create table if not exists public.softora_health_whoop_connections (
  owner_key text primary key,
  whoop_user_id bigint unique,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connected', 'error')),
  encrypted_tokens text,
  oauth_state_hash text,
  oauth_state_expires_at timestamptz,
  scopes text[] not null default '{}',
  profile jsonb not null default '{}'::jsonb,
  body_measurement jsonb not null default '{}'::jsonb,
  connected_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  last_synced_day date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.softora_health_whoop_records (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null references public.softora_health_whoop_connections(owner_key) on delete cascade,
  whoop_user_id bigint not null,
  source_type text not null check (source_type in ('cycle', 'recovery', 'sleep', 'workout')),
  source_id text not null,
  local_day date not null,
  start_at timestamptz,
  end_at timestamptz,
  score_state text,
  summary jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_key, source_type, source_id)
);

create index if not exists softora_health_whoop_records_owner_day_idx
  on public.softora_health_whoop_records (owner_key, local_day desc);

create index if not exists softora_health_whoop_records_owner_type_day_idx
  on public.softora_health_whoop_records (owner_key, source_type, local_day desc);

create table if not exists public.softora_health_sync_runs (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null references public.softora_health_whoop_connections(owner_key) on delete cascade,
  target_day date,
  mode text not null check (mode in ('daily', 'backfill', 'manual')),
  status text not null check (status in ('running', 'completed', 'failed', 'skipped')),
  records_seen integer not null default 0,
  records_upserted integer not null default 0,
  sheet_status text,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists softora_health_sync_runs_owner_started_idx
  on public.softora_health_sync_runs (owner_key, started_at desc);

alter table public.softora_health_whoop_connections enable row level security;
alter table public.softora_health_whoop_records enable row level security;
alter table public.softora_health_sync_runs enable row level security;

revoke all on table public.softora_health_whoop_connections from public, anon, authenticated;
revoke all on table public.softora_health_whoop_records from public, anon, authenticated;
revoke all on table public.softora_health_sync_runs from public, anon, authenticated;

grant select, insert, update, delete on table public.softora_health_whoop_connections to service_role;
grant select, insert, update, delete on table public.softora_health_whoop_records to service_role;
grant select, insert, update, delete on table public.softora_health_sync_runs to service_role;
