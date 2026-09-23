-- Per-row change sequence for ui-state read models (docs/platform-performance.md).
-- Every insert or update of a runtime-state row takes the next value of one
-- global sequence, whichever code or SQL writes it. A browser copy proves it is
-- current with a metadata-only read of this column instead of reading and
-- hashing the full payload. revision and updated_at keep their existing
-- meaning for compare-and-swap writes; this column is never written by the app.
-- A global sequence (not a per-row counter) means a deleted and re-created row
-- can never reuse an earlier value.
--
-- Rollback:
--   drop trigger if exists softora_runtime_state_change_seq on public.softora_runtime_state;
--   drop function if exists public.softora_runtime_state_next_change_seq();
--   alter table public.softora_runtime_state drop column if exists change_seq;
--   drop sequence if exists public.softora_runtime_state_change_seq;
-- Without the column the server falls back to content-hash versions.

create sequence if not exists public.softora_runtime_state_change_seq;
revoke all on sequence public.softora_runtime_state_change_seq from public, anon, authenticated;

alter table public.softora_runtime_state
  add column if not exists change_seq bigint not null default 0;

create or replace function public.softora_runtime_state_next_change_seq()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.change_seq := nextval('public.softora_runtime_state_change_seq');
  return new;
end;
$$;

revoke all on function public.softora_runtime_state_next_change_seq() from public, anon, authenticated;

drop trigger if exists softora_runtime_state_change_seq on public.softora_runtime_state;
create trigger softora_runtime_state_change_seq
  before insert or update on public.softora_runtime_state
  for each row execute function public.softora_runtime_state_next_change_seq();
