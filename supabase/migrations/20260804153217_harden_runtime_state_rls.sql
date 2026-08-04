create table if not exists public.softora_runtime_state (
  state_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.softora_runtime_state
  add column if not exists revision bigint not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'softora_runtime_state_revision_nonnegative'
      and conrelid = 'public.softora_runtime_state'::regclass
  ) then
    alter table public.softora_runtime_state
      add constraint softora_runtime_state_revision_nonnegative
      check (revision >= 0) not valid;
  end if;
end
$$;

alter table public.softora_runtime_state
  validate constraint softora_runtime_state_revision_nonnegative;

create index if not exists idx_softora_runtime_state_updated_at
  on public.softora_runtime_state (updated_at desc);

comment on table public.softora_runtime_state is
  'Centrale Supabase-opslag voor Softora runtime state, UI-state en premium auth state.';

alter table public.softora_runtime_state enable row level security;
alter table public.softora_runtime_state force row level security;

revoke all privileges on table public.softora_runtime_state from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_runtime_state to service_role;

drop policy if exists softora_runtime_state_service_role_all
  on public.softora_runtime_state;

create policy softora_runtime_state_service_role_all
  on public.softora_runtime_state
  for all
  to service_role
  using (true)
  with check (true);
