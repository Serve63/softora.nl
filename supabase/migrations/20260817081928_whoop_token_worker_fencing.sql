create or replace function public.softora_enforce_whoop_operation_fencing()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if new.sync_lock_id is distinct from old.sync_lock_id
    and nullif(btrim(coalesce(new.sync_lock_id, '')), '') is not null
    and nullif(btrim(coalesce(new.token_refresh_lock_id, '')), '') is not null
    and new.token_refresh_lock_until > v_now then
    raise exception using errcode = '55000', message = 'WHOOP_TOKEN_REFRESH_ACTIVE';
  end if;

  if new.token_refresh_lock_id is distinct from old.token_refresh_lock_id
    and nullif(btrim(coalesce(new.token_refresh_lock_id, '')), '') is not null
    and nullif(btrim(coalesce(new.sync_lock_id, '')), '') is not null
    and new.sync_lock_until > v_now then
    raise exception using errcode = '55000', message = 'WHOOP_SYNC_ACTIVE';
  end if;

  return new;
end;
$$;

drop trigger if exists softora_whoop_operation_fencing
  on public.softora_health_whoop_connections;

create trigger softora_whoop_operation_fencing
before update of sync_lock_id, sync_lock_until, token_refresh_lock_id, token_refresh_lock_until
on public.softora_health_whoop_connections
for each row
execute function public.softora_enforce_whoop_operation_fencing();

revoke all on function public.softora_enforce_whoop_operation_fencing()
  from public, anon, authenticated;

comment on function public.softora_enforce_whoop_operation_fencing()
  is 'Prevents a WHOOP data sync lease and rotating-token refresh lease from becoming active concurrently.';
