-- mailbox-uid-generation-protocol-gate:start
-- Rolling-release gate for the UID-generation v2 cutover. The existing
-- campaign-consistency singleton is already part of every mailbox mutation's
-- lock order, so it is also the database-authoritative protocol switch.
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_protocol text not null default 'legacy';
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_protocol_changed_at timestamptz
    not null default pg_catalog.clock_timestamp();
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_drain_started_at timestamptz;
alter table public.softora_mailbox_campaign_consistency
  add column if not exists uid_generation_drain_ready_at timestamptz;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_campaign_uid_protocol_check'
      and conrelid = 'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_campaign_consistency
      add constraint softora_mailbox_campaign_uid_protocol_check check (
        uid_generation_protocol = any (array['legacy', 'draining', 'v2']::text[])
      );
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_campaign_uid_drain_check'
      and conrelid = 'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_campaign_consistency
      add constraint softora_mailbox_campaign_uid_drain_check check (
        (
          uid_generation_protocol = 'legacy'
          and uid_generation_drain_started_at is null
          and uid_generation_drain_ready_at is null
        ) or (
          uid_generation_protocol in ('draining', 'v2')
          and uid_generation_drain_started_at is not null
          and uid_generation_drain_ready_at is not null
          and uid_generation_drain_ready_at >= uid_generation_drain_started_at
        )
      );
  end if;
end;
$constraints$;

insert into public.softora_mailbox_campaign_consistency (
  scope, content_version, uid_generation_protocol
) values ('campaign', 0, 'legacy')
on conflict (scope) do nothing;

create or replace function public.softora_guard_mailbox_uid_generation_protocol()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_transition_allowed boolean := coalesce(pg_catalog.current_setting(
    'softora.mailbox_uid_protocol_transition', true
  ), '') = '1';
begin
  if row(
    old.uid_generation_protocol,
    old.uid_generation_protocol_changed_at,
    old.uid_generation_drain_started_at,
    old.uid_generation_drain_ready_at
  ) is not distinct from row(
    new.uid_generation_protocol,
    new.uid_generation_protocol_changed_at,
    new.uid_generation_drain_started_at,
    new.uid_generation_drain_ready_at
  ) then
    return new;
  end if;
  if not v_transition_allowed then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_TRANSITION_REQUIRED';
  end if;
  if not (
    (old.uid_generation_protocol = 'legacy' and new.uid_generation_protocol = 'draining')
    or (old.uid_generation_protocol = 'draining' and new.uid_generation_protocol = 'v2')
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_TRANSITION_INVALID';
  end if;
  if new.uid_generation_protocol_changed_at <= old.uid_generation_protocol_changed_at then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_PROTOCOL_TIMESTAMP_INVALID';
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_guard_mailbox_uid_generation_protocol
  on public.softora_mailbox_campaign_consistency;
create trigger softora_guard_mailbox_uid_generation_protocol
before update of uid_generation_protocol, uid_generation_protocol_changed_at,
  uid_generation_drain_started_at, uid_generation_drain_ready_at
on public.softora_mailbox_campaign_consistency
for each row execute function public.softora_guard_mailbox_uid_generation_protocol();

create or replace function public.softora_get_mailbox_uid_generation_protocol()
returns table (
  protocol text,
  protocol_changed_at timestamptz,
  drain_started_at timestamptz,
  drain_ready_at timestamptz,
  drain_ready boolean
)
language sql
stable
security invoker
set search_path = ''
as $function$
  select consistency.uid_generation_protocol,
    consistency.uid_generation_protocol_changed_at,
    consistency.uid_generation_drain_started_at,
    consistency.uid_generation_drain_ready_at,
    consistency.uid_generation_protocol = 'draining'
      and consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp()
      and not exists (
        select 1 from public.softora_mailbox_sync_state as active_sync
        where active_sync.status = 'syncing'
          and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
          and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
      )
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
$function$;

create or replace function public.softora_begin_mailbox_uid_generation_v2_drain(
  p_drain_seconds integer default 180
)
returns table (
  protocol text,
  protocol_changed_at timestamptz,
  drain_started_at timestamptz,
  drain_ready_at timestamptz,
  active_lease_count integer,
  latest_lease_expiry timestamptz,
  drain_ready boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_active_count integer := 0;
  v_latest_expiry timestamptz;
begin
  if coalesce(p_drain_seconds, 0) not between 180 and 900 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into strict v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if v_consistency.uid_generation_protocol = 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ALREADY_V2';
  elsif v_consistency.uid_generation_protocol = 'legacy' then
    perform pg_catalog.set_config(
      'softora.mailbox_uid_protocol_transition', '1', true
    );
    update public.softora_mailbox_campaign_consistency as consistency
    set uid_generation_protocol = 'draining',
        uid_generation_protocol_changed_at = v_now,
        uid_generation_drain_started_at = v_now,
        uid_generation_drain_ready_at = v_now + pg_catalog.make_interval(
          secs => p_drain_seconds
        ),
        updated_at = v_now
    where consistency.scope = 'campaign'
    returning consistency.* into strict v_consistency;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.max(active_sync.lock_expires_at)
  into v_active_count, v_latest_expiry
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > pg_catalog.clock_timestamp();

  return query select v_consistency.uid_generation_protocol,
    v_consistency.uid_generation_protocol_changed_at,
    v_consistency.uid_generation_drain_started_at,
    v_consistency.uid_generation_drain_ready_at,
    v_active_count,
    v_latest_expiry,
    v_consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp()
      and v_active_count = 0;
end;
$function$;

-- Replace the stable six-argument lock RPC with one additional trailing
-- default argument. Existing runtimes still resolve their unchanged call to
-- protocol "legacy"; dual runtimes pass the database-reported protocol.
revoke all on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean
) from public, anon, authenticated, service_role;
drop function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean
);

create function public.softora_claim_mailbox_sync_lock(
  p_sync_key text,
  p_account_email text,
  p_folder text,
  p_lock_token text,
  p_lock_ttl_seconds integer default 90,
  p_force boolean default false,
  p_protocol text default 'legacy'
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
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_protocol text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_protocol, '')));
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_current public.softora_mailbox_sync_state%rowtype;
  v_active_count integer := 0;
  v_blocked_until timestamptz;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_sync_key is distinct from (v_account_email || '|' || v_folder)
    or v_protocol not in ('legacy', 'v2') then
    raise exception using errcode = '22023',
      message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
  end if;

  -- Shared order for old, dual and v2 callers: advisory -> protocol -> sync.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into strict v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if v_consistency.uid_generation_protocol = 'draining'
    or v_consistency.uid_generation_protocol is distinct from v_protocol then
    v_blocked_until := greatest(
      coalesce(v_consistency.uid_generation_drain_ready_at,
        pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp() + interval '30 seconds'
    );
    return query select false, true, null::text, v_blocked_until;
    return;
  end if;

  select current_sync.* into v_current
  from public.softora_mailbox_sync_state as current_sync
  where current_sync.sync_key = v_sync_key
  for update;

  if found
    and v_current.status = 'syncing'
    and nullif(pg_catalog.btrim(v_current.lock_token), '') is not null
    and v_current.lock_expires_at > pg_catalog.clock_timestamp() then
    if pg_catalog.btrim(v_current.lock_token) = v_lock_token then
      return query select true, false, v_lock_token, v_current.lock_expires_at;
    else
      return query select false, true, null::text, v_current.lock_expires_at;
    end if;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_active_count
  from public.softora_mailbox_sync_state as active_sync
  where active_sync.status = 'syncing'
    and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
    and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
    and active_sync.sync_key <> v_sync_key;
  if v_active_count >= 3 then
    return query select false, true, null::text, null::timestamptz;
    return;
  end if;

  insert into public.softora_mailbox_sync_state as stored_sync (
    sync_key, account_email, folder, status, sync_started_at,
    lock_token, lock_expires_at, last_error, updated_at
  ) values (
    v_sync_key, v_account_email, v_folder, 'syncing', pg_catalog.clock_timestamp(),
    v_lock_token,
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(
      secs => greatest(10, least(
        300, coalesce(p_lock_ttl_seconds, 90)
      ))
    ),
    null, pg_catalog.clock_timestamp()
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
$function$;

comment on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) is 'Claims a mailbox lease only when the caller protocol matches the database rollout protocol; omitted protocol remains legacy-compatible.';

revoke all on function public.softora_guard_mailbox_uid_generation_protocol()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_get_mailbox_uid_generation_protocol()
  from public, anon, authenticated;
revoke all on function public.softora_begin_mailbox_uid_generation_v2_drain(integer)
  from public, anon, authenticated;
revoke all on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) from public, anon, authenticated;
grant execute on function public.softora_get_mailbox_uid_generation_protocol()
  to service_role;
grant execute on function public.softora_begin_mailbox_uid_generation_v2_drain(integer)
  to service_role;
grant execute on function public.softora_claim_mailbox_sync_lock(
  text, text, text, text, integer, boolean, text
) to service_role;
-- mailbox-uid-generation-protocol-gate:end
