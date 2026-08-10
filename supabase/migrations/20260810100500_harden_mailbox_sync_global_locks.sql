-- Sequenced after the atomic mailbox message commit foundation.
-- mailbox-sync-lock-hardening:start
-- Serialize every mailbox lease transition across instances. The fixed
-- transaction advisory lock makes the active-count check one global decision.
create or replace function public.softora_lock_mailbox_sync_capacity()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  -- A statement trigger runs before UPDATE has row-locked a lease. This keeps
  -- old direct writes and the new RPC on the same advisory -> row lock order.
  perform pg_advisory_xact_lock(824031, 3);
  return null;
end;
$$;

drop trigger if exists softora_mailbox_sync_capacity_lock
  on public.softora_mailbox_sync_state;
create trigger softora_mailbox_sync_capacity_lock
before insert or update or delete on public.softora_mailbox_sync_state
for each statement execute function public.softora_lock_mailbox_sync_capacity();

create or replace function public.softora_guard_mailbox_sync_lock()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(new.sync_key, '')));
  v_account_email text := lower(btrim(coalesce(new.account_email, '')));
  v_folder text := lower(btrim(coalesce(new.folder, '')));
  v_lock_token text := btrim(coalesce(new.lock_token, ''));
  v_active_count integer := 0;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  new.sync_key := v_sync_key;
  new.account_email := v_account_email;
  new.folder := v_folder;

  if new.status = 'syncing' then
    if v_lock_token = '' or char_length(v_lock_token) > 200
      or new.lock_expires_at is null
      or new.lock_expires_at <= clock_timestamp() then
      raise exception using errcode = '22023',
        message = 'MAILBOX_SYNC_LOCK_LEASE_INVALID';
    end if;
    new.lock_token := v_lock_token;

    -- Old runtime versions used direct UPSERTs. They may renew the exact same
    -- lease, but force can never replace another still-active token.
    if tg_op = 'UPDATE'
      and old.status = 'syncing'
      and nullif(btrim(old.lock_token), '') is not null
      and old.lock_expires_at > clock_timestamp()
      and btrim(old.lock_token) is distinct from v_lock_token then
      raise exception 'MAILBOX_SYNC_ACTIVE_LOCK'
        using errcode = 'P0001', detail = 'een actieve mailboxlease kan niet worden overgenomen';
    end if;

    select count(*)::integer into v_active_count
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > clock_timestamp()
      and active_sync.sync_key <> v_sync_key;
    if v_active_count >= 3 then
      raise exception 'MAILBOX_SYNC_GLOBAL_CAP_REACHED'
        using errcode = 'P0001', detail = 'maximaal drie mailboxleases mogen tegelijk actief zijn';
    end if;
  elsif new.lock_token is not null or new.lock_expires_at is not null then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_RELEASE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists softora_mailbox_sync_lock_guard
  on public.softora_mailbox_sync_state;
create trigger softora_mailbox_sync_lock_guard
before insert or update of sync_key, account_email, folder, status, lock_token, lock_expires_at
on public.softora_mailbox_sync_state
for each row execute function public.softora_guard_mailbox_sync_lock();

-- New runtime versions claim through this RPC. p_force remains in the stable
-- API shape, but never bypasses an active lease or the global capacity limit.
create or replace function public.softora_claim_mailbox_sync_lock(
  p_sync_key text,
  p_account_email text,
  p_folder text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 90,
  p_force boolean default false
)
returns table (
  acquired boolean,
  locked boolean,
  claimed_lock_token text,
  lock_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(p_sync_key, '')));
  v_account_email text := lower(btrim(coalesce(p_account_email, '')));
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_current public.softora_mailbox_sync_state%rowtype;
  v_active_count integer := 0;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  select * into v_current
  from public.softora_mailbox_sync_state as current_sync
  where current_sync.sync_key = v_sync_key
  for update;

  if found
    and v_current.status = 'syncing'
    and nullif(btrim(v_current.lock_token), '') is not null
    and v_current.lock_expires_at > clock_timestamp() then
    if btrim(v_current.lock_token) = v_lock_token then
      return query select true, false, v_lock_token, v_current.lock_expires_at;
    else
      return query select false, true, null::text, v_current.lock_expires_at;
    end if;
    return;
  end if;

  select count(*)::integer into v_active_count
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > clock_timestamp()
    and active_sync.sync_key <> v_sync_key;
  if v_active_count >= 3 then
    return query select false, true, null::text, null::timestamptz;
    return;
  end if;

  insert into public.softora_mailbox_sync_state as stored_sync (
    sync_key, account_email, folder, status, sync_started_at,
    lock_token, lock_expires_at, last_error, updated_at
  ) values (
    v_sync_key, v_account_email, v_folder, 'syncing', clock_timestamp(),
    v_lock_token,
    clock_timestamp() + make_interval(
      secs => greatest(10, least(300, coalesce(p_lock_ttl_seconds, 90)))
    ),
    null, clock_timestamp()
  )
  on conflict (sync_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    status = excluded.status,
    sync_started_at = excluded.sync_started_at,
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    last_error = null,
    updated_at = excluded.updated_at
  returning stored_sync.* into v_current;

  return query select true, false, v_lock_token, v_current.lock_expires_at;
end;
$$;

comment on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  is 'Atomically claims one of at most three global mailbox sync leases; force never steals an active lease.';

revoke all on function public.softora_lock_mailbox_sync_capacity()
  from public, anon, authenticated;
revoke all on function public.softora_guard_mailbox_sync_lock()
  from public, anon, authenticated;
revoke all on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.softora_lock_mailbox_sync_capacity()
  to service_role;
grant execute on function public.softora_guard_mailbox_sync_lock()
  to service_role;
grant execute on function public.softora_claim_mailbox_sync_lock(text, text, text, text, integer, boolean)
  to service_role;
-- mailbox-sync-lock-hardening:end
