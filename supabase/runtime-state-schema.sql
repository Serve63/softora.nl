create table if not exists public.softora_runtime_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_softora_runtime_state_updated_at
  on public.softora_runtime_state (updated_at desc);

comment on table public.softora_runtime_state is
  'Centrale Supabase-opslag voor Softora runtime state, UI-state en premium auth state.';

create table if not exists public.softora_sportschool_logbook (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.softora_sportschool_logbook_history (
  history_id bigserial primary key,
  logbook_id text not null,
  payload jsonb not null default '{}'::jsonb,
  next_payload jsonb not null default '{}'::jsonb,
  previous_updated_at timestamptz,
  saved_at timestamptz not null default now(),
  source text not null default 'unknown',
  actor text,
  meta jsonb not null default '{}'::jsonb
);

alter table public.softora_sportschool_logbook enable row level security;
alter table public.softora_sportschool_logbook_history enable row level security;

create index if not exists idx_softora_sportschool_logbook_history_logbook_saved_at
  on public.softora_sportschool_logbook_history (logbook_id, saved_at desc);

comment on table public.softora_sportschool_logbook is
  'Formele opslag voor Serve sportschool logboek.';

comment on table public.softora_sportschool_logbook_history is
  'Herstelgeschiedenis voor sportschool logboek snapshots voor iedere overwrite.';
