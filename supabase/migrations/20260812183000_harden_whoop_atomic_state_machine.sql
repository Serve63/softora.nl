alter table public.softora_health_whoop_connections
  add column if not exists last_sync_run_id uuid,
  add column if not exists last_sync_error_code text,
  add column if not exists last_sync_attempt integer not null default 0,
  add column if not exists next_retry_at timestamptz;

alter table public.softora_health_sync_runs
  add column if not exists lock_id text,
  add column if not exists attempt integer not null default 1,
  add column if not exists error_code text,
  add column if not exists next_retry_at timestamptz;

create or replace function public.softora_claim_whoop_sync_run(
  p_owner_key text,
  p_lock_id text,
  p_lock_ttl_seconds integer,
  p_mode text,
  p_target_day date,
  p_attempt integer default 1
)
returns table (
  acquired boolean,
  claimed_lock_id text,
  lock_expires_at timestamptz,
  run_id uuid
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner_key text := lower(btrim(coalesce(p_owner_key, '')));
  v_lock_id text := btrim(coalesce(p_lock_id, ''));
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_connection public.softora_health_whoop_connections%rowtype;
  v_run_id uuid;
  v_started_at timestamptz := clock_timestamp();
begin
  if v_owner_key = '' or char_length(v_owner_key) > 100
    or v_lock_id = '' or char_length(v_lock_id) > 200
    or v_mode not in ('daily', 'backfill', 'manual', 'webhook', 'reconcile')
    or p_target_day is null then
    raise exception using errcode = '22023', message = 'WHOOP_SYNC_CLAIM_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 5);

  select * into v_connection
  from public.softora_health_whoop_connections as connection
  where connection.owner_key = v_owner_key
  for update;

  if not found or v_connection.status <> 'connected' then
    return query select false, null::text, null::timestamptz, null::uuid;
    return;
  end if;

  if nullif(btrim(v_connection.sync_lock_id), '') is not null
    and v_connection.sync_lock_until > v_started_at then
    return query select false, null::text, v_connection.sync_lock_until, null::uuid;
    return;
  end if;

  insert into public.softora_health_sync_runs (
    owner_key, target_day, mode, status, started_at, lock_id, attempt
  ) values (
    v_owner_key, p_target_day, v_mode, 'running', v_started_at, v_lock_id,
    greatest(1, coalesce(p_attempt, 1))
  )
  returning id into v_run_id;

  update public.softora_health_whoop_connections as connection
  set sync_lock_id = v_lock_id,
      sync_lock_until = v_started_at + make_interval(
        secs => greatest(60, least(1800, coalesce(p_lock_ttl_seconds, 900)))
      ),
      last_sync_run_id = v_run_id,
      last_sync_started_at = v_started_at,
      last_sync_status = 'running',
      last_sync_error = null,
      last_sync_error_code = null,
      last_sync_attempt = greatest(1, coalesce(p_attempt, 1)),
      next_retry_at = null,
      updated_at = v_started_at
  where connection.owner_key = v_owner_key
  returning connection.* into v_connection;

  return query select true, v_lock_id, v_connection.sync_lock_until, v_run_id;
end;
$$;

create or replace function public.softora_finish_whoop_sync_run(
  p_owner_key text,
  p_lock_id text,
  p_run_id uuid,
  p_status text,
  p_records_seen integer default 0,
  p_records_upserted integer default 0,
  p_error_code text default null,
  p_error_message text default null,
  p_next_retry_at timestamptz default null,
  p_last_synced_day date default null,
  p_whoop_user_id bigint default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner_key text := lower(btrim(coalesce(p_owner_key, '')));
  v_lock_id text := btrim(coalesce(p_lock_id, ''));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_completed_at timestamptz := clock_timestamp();
  v_connection public.softora_health_whoop_connections%rowtype;
begin
  if v_owner_key = '' or v_lock_id = '' or p_run_id is null
    or v_status not in ('completed', 'failed') then
    raise exception using errcode = '22023', message = 'WHOOP_SYNC_FINALIZE_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 5);

  select * into v_connection
  from public.softora_health_whoop_connections as connection
  where connection.owner_key = v_owner_key
  for update;

  if not found
    or v_connection.sync_lock_id is distinct from v_lock_id
    or v_connection.last_sync_run_id is distinct from p_run_id then
    return false;
  end if;

  update public.softora_health_sync_runs as run
  set status = v_status,
      records_seen = greatest(0, coalesce(p_records_seen, 0)),
      records_upserted = greatest(0, coalesce(p_records_upserted, 0)),
      error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      error = nullif(left(coalesce(p_error_message, ''), 1000), ''),
      next_retry_at = p_next_retry_at,
      completed_at = v_completed_at
  where run.id = p_run_id
    and run.owner_key = v_owner_key
    and run.lock_id = v_lock_id
    and run.status = 'running';

  if not found then
    return false;
  end if;

  update public.softora_health_whoop_connections as connection
  set sync_lock_id = null,
      sync_lock_until = null,
      last_sync_completed_at = case when v_status = 'completed' then v_completed_at else connection.last_sync_completed_at end,
      last_sync_status = v_status,
      last_sync_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      last_sync_error = nullif(left(coalesce(p_error_message, ''), 1000), ''),
      next_retry_at = p_next_retry_at,
      last_synced_day = case when v_status = 'completed' and p_last_synced_day is not null then p_last_synced_day else connection.last_synced_day end,
      whoop_user_id = coalesce(p_whoop_user_id, connection.whoop_user_id),
      updated_at = v_completed_at
  where connection.owner_key = v_owner_key;

  return true;
end;
$$;

create or replace function public.softora_claim_whoop_refresh_lock(
  p_owner_key text,
  p_lock_id text,
  p_lock_ttl_seconds integer default 60
)
returns table (
  acquired boolean,
  claimed_lock_id text,
  lock_expires_at timestamptz,
  encrypted_tokens text,
  connection_status text
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
  v_now timestamptz := clock_timestamp();
begin
  if v_owner_key = '' or char_length(v_owner_key) > 100
    or v_lock_id = '' or char_length(v_lock_id) > 200 then
    raise exception using errcode = '22023', message = 'WHOOP_REFRESH_CLAIM_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 6);

  select * into v_connection
  from public.softora_health_whoop_connections as connection
  where connection.owner_key = v_owner_key
  for update;

  if not found or v_connection.status <> 'connected' then
    return query select false, null::text, null::timestamptz, null::text,
      coalesce(v_connection.status, 'disconnected');
    return;
  end if;

  if nullif(btrim(v_connection.token_refresh_lock_id), '') is not null
    and v_connection.token_refresh_lock_until > v_now then
    return query select false, null::text, v_connection.token_refresh_lock_until,
      null::text, v_connection.status;
    return;
  end if;

  update public.softora_health_whoop_connections as connection
  set token_refresh_lock_id = v_lock_id,
      token_refresh_lock_until = v_now + make_interval(
        secs => greatest(30, least(300, coalesce(p_lock_ttl_seconds, 60)))
      ),
      updated_at = v_now
  where connection.owner_key = v_owner_key
  returning connection.* into v_connection;

  return query select true, v_lock_id, v_connection.token_refresh_lock_until,
    v_connection.encrypted_tokens, v_connection.status;
end;
$$;

create or replace function public.softora_finish_whoop_refresh(
  p_owner_key text,
  p_lock_id text,
  p_outcome text,
  p_encrypted_tokens text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_owner_key text := lower(btrim(coalesce(p_owner_key, '')));
  v_lock_id text := btrim(coalesce(p_lock_id, ''));
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
  v_connection public.softora_health_whoop_connections%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if v_owner_key = '' or v_lock_id = ''
    or v_outcome not in ('completed', 'reauthorization_required', 'refresh_uncertain', 'released') then
    raise exception using errcode = '22023', message = 'WHOOP_REFRESH_FINALIZE_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 6);

  select * into v_connection
  from public.softora_health_whoop_connections as connection
  where connection.owner_key = v_owner_key
  for update;

  if not found or v_connection.token_refresh_lock_id is distinct from v_lock_id then
    return false;
  end if;

  if v_outcome = 'completed' and (
    v_connection.token_refresh_lock_until <= v_now
    or nullif(btrim(coalesce(p_encrypted_tokens, '')), '') is null
  ) then
    return false;
  end if;

  update public.softora_health_whoop_connections as connection
  set encrypted_tokens = case when v_outcome = 'completed' then p_encrypted_tokens else connection.encrypted_tokens end,
      status = case
        when v_outcome = 'completed' then 'connected'
        when v_outcome = 'reauthorization_required' then 'reauthorization_required'
        when v_outcome = 'refresh_uncertain' then 'refresh_uncertain'
        else connection.status
      end,
      last_sync_error_code = nullif(left(coalesce(p_error_code, ''), 120), ''),
      last_sync_error = nullif(left(coalesce(p_error_message, ''), 1000), ''),
      token_refresh_lock_id = null,
      token_refresh_lock_until = null,
      updated_at = v_now
  where connection.owner_key = v_owner_key;

  return true;
end;
$$;

revoke all on function public.softora_claim_whoop_sync_run(text, text, integer, text, date, integer)
  from public, anon, authenticated;
revoke all on function public.softora_finish_whoop_sync_run(text, text, uuid, text, integer, integer, text, text, timestamptz, date, bigint)
  from public, anon, authenticated;
revoke all on function public.softora_claim_whoop_refresh_lock(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.softora_finish_whoop_refresh(text, text, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.softora_claim_whoop_sync_run(text, text, integer, text, date, integer)
  to service_role;
grant execute on function public.softora_finish_whoop_sync_run(text, text, uuid, text, integer, integer, text, text, timestamptz, date, bigint)
  to service_role;
grant execute on function public.softora_claim_whoop_refresh_lock(text, text, integer)
  to service_role;
grant execute on function public.softora_finish_whoop_refresh(text, text, text, text, text, text)
  to service_role;

update public.softora_health_whoop_webhook_events
set status = 'retry',
    attempts = 0,
    next_attempt_at = clock_timestamp(),
    processed_at = null
where status = 'dead'
  and event_type in ('recovery.updated', 'internal.backfill')
  and last_error in (
    'WHOOP-tokenvernieuwing had geen actieve lease meer; de sync probeert veilig opnieuw te claimen.',
    'WHOOP-tokenvernieuwing verloor de lease zonder bevestigde token; de sync probeert veilig opnieuw te claimen.'
  );

comment on function public.softora_claim_whoop_sync_run(text, text, integer, text, date, integer)
  is 'Atomically claims one WHOOP sync lease and creates its fenced run.';
comment on function public.softora_finish_whoop_sync_run(text, text, uuid, text, integer, integer, text, text, timestamptz, date, bigint)
  is 'Finalizes a WHOOP run and connection state only for the current fenced sync owner.';
comment on function public.softora_claim_whoop_refresh_lock(text, text, integer)
  is 'Atomically claims the single WHOOP rotating-token refresh lease.';
comment on function public.softora_finish_whoop_refresh(text, text, text, text, text, text)
  is 'Commits or fails a WHOOP token refresh only for the current fenced owner.';
