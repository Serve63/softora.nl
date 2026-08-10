create or replace function public.softora_claim_whoop_sync_lock(
  p_owner_key text,
  p_lock_id text,
  p_lock_ttl_seconds integer default 900
)
returns table (
  acquired boolean,
  claimed_lock_id text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner_key text := lower(btrim(coalesce(p_owner_key, '')));
  v_lock_id text := btrim(coalesce(p_lock_id, ''));
  v_connection public.softora_health_whoop_connections%rowtype;
begin
  if v_owner_key = '' or char_length(v_owner_key) > 100
    or v_lock_id = '' or char_length(v_lock_id) > 200 then
    raise exception using errcode = '22023',
      message = 'WHOOP_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 5);

  select * into v_connection
  from public.softora_health_whoop_connections as connection
  where connection.owner_key = v_owner_key
  for update;

  if not found or v_connection.status <> 'connected' then
    return query select false, null::text, null::timestamptz;
    return;
  end if;

  if nullif(btrim(v_connection.sync_lock_id), '') is not null
    and v_connection.sync_lock_until > clock_timestamp() then
    return query select false, null::text, v_connection.sync_lock_until;
    return;
  end if;

  update public.softora_health_whoop_connections as connection
  set sync_lock_id = v_lock_id,
      sync_lock_until = clock_timestamp() + make_interval(
        secs => greatest(60, least(1800, coalesce(p_lock_ttl_seconds, 900)))
      ),
      updated_at = clock_timestamp()
  where connection.owner_key = v_owner_key
  returning connection.* into v_connection;

  return query select true, v_lock_id, v_connection.sync_lock_until;
end;
$$;

comment on function public.softora_claim_whoop_sync_lock(text, text, integer)
  is 'Atomically claims the single WHOOP sync lease without PostgREST timestamp filter ambiguity.';

revoke all on function public.softora_claim_whoop_sync_lock(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.softora_claim_whoop_sync_lock(text, text, integer)
  to service_role;
