-- Per-table change counters for versioned read models (docs/platform-performance.md).
-- Every insert, update, delete or truncate bumps the counter of its table, no matter
-- which code or manual SQL made the change. A read model proves "unchanged" by
-- comparing counters instead of rebuilding its data.
--
-- Rollback:
--   drop trigger if exists softora_customers_table_version on public.softora_customers;
--   drop trigger if exists softora_customers_table_version_truncate on public.softora_customers;
--   drop trigger if exists softora_outbound_recipient_guards_table_version on public.softora_outbound_recipient_guards;
--   drop trigger if exists softora_outbound_recipient_guards_table_version_truncate on public.softora_outbound_recipient_guards;
--   drop function if exists public.softora_bump_table_version();
--   drop table if exists public.softora_table_versions;
-- Without the table, readTableVersions returns null and every read model falls
-- back to its full build, so the rollback needs no application change.

create table if not exists public.softora_table_versions (
  table_name text primary key,
  version bigint not null default 1,
  changed_at timestamptz not null default now()
);

alter table public.softora_table_versions enable row level security;
revoke all on table public.softora_table_versions from public, anon, authenticated;
grant select on table public.softora_table_versions to service_role;

-- Security definer: a write by any role must be able to bump the counter; the
-- function only touches softora_table_versions.
create or replace function public.softora_bump_table_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.softora_table_versions as versions (table_name, version, changed_at)
  values (tg_table_name, 1, clock_timestamp())
  on conflict (table_name) do update
    set version = versions.version + 1,
        changed_at = clock_timestamp();
  return null;
end;
$$;

revoke all on function public.softora_bump_table_version() from public, anon, authenticated;

insert into public.softora_table_versions (table_name)
values ('softora_customers'), ('softora_outbound_recipient_guards')
on conflict (table_name) do nothing;

drop trigger if exists softora_customers_table_version on public.softora_customers;
create trigger softora_customers_table_version
  after insert or update or delete on public.softora_customers
  for each statement execute function public.softora_bump_table_version();

drop trigger if exists softora_customers_table_version_truncate on public.softora_customers;
create trigger softora_customers_table_version_truncate
  after truncate on public.softora_customers
  for each statement execute function public.softora_bump_table_version();

drop trigger if exists softora_outbound_recipient_guards_table_version on public.softora_outbound_recipient_guards;
create trigger softora_outbound_recipient_guards_table_version
  after insert or update or delete on public.softora_outbound_recipient_guards
  for each statement execute function public.softora_bump_table_version();

drop trigger if exists softora_outbound_recipient_guards_table_version_truncate on public.softora_outbound_recipient_guards;
create trigger softora_outbound_recipient_guards_table_version_truncate
  after truncate on public.softora_outbound_recipient_guards
  for each statement execute function public.softora_bump_table_version();
