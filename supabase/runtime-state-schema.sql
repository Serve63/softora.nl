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
