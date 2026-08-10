\set ON_ERROR_STOP on

-- Run with a privileged psql connection after the global mailbox-lock
-- migration and while mailbox sync is quiescent. The advisory lock prevents a
-- new claimant from entering during the probe; every probe row is rolled back.
begin;
select pg_advisory_xact_lock(824031, 3);

do $probe$
declare
  v_suffix text := txid_current()::text;
  v_account_1 text := 'lock-probe-1-' || txid_current()::text || '@softora.invalid';
  v_account_2 text := 'lock-probe-2-' || txid_current()::text || '@softora.invalid';
  v_account_3 text := 'lock-probe-3-' || txid_current()::text || '@softora.invalid';
  v_account_4 text := 'lock-probe-4-' || txid_current()::text || '@softora.invalid';
  v_key_1 text;
  v_key_2 text;
  v_key_3 text;
  v_key_4 text;
  v_claim record;
  v_active_count integer := 0;
  v_affected integer := 0;
  v_stored_token text;
begin
  v_key_1 := lower(v_account_1) || '|inbox';
  v_key_2 := lower(v_account_2) || '|inbox';
  v_key_3 := lower(v_account_3) || '|inbox';
  v_key_4 := lower(v_account_4) || '|inbox';

  select count(*)::integer into v_active_count
  from public.softora_mailbox_sync_state
  where status = 'syncing'
    and nullif(btrim(lock_token), '') is not null
    and lock_expires_at > clock_timestamp();
  if v_active_count <> 0 then
    raise exception 'PROBE_REQUIRES_NO_ACTIVE_MAILBOX_SYNCS';
  end if;

  begin
    perform * from public.softora_claim_mailbox_sync_lock(
      '', v_account_1, 'inbox', 'blank-key-' || v_suffix, 90, false
    );
    raise exception 'PROBE_BLANK_IDENTITY_WAS_ACCEPTED';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform * from public.softora_claim_mailbox_sync_lock(
      'wrong|' || v_key_1, v_account_1, 'inbox', 'wrong-key-' || v_suffix, 90, false
    );
    raise exception 'PROBE_MISMATCHED_IDENTITY_WAS_ACCEPTED';
  exception when sqlstate '22023' then
    null;
  end;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_1, v_account_1, 'inbox', 'token-1-' || v_suffix, 90, false
  );
  if v_claim.acquired is not true or v_claim.locked is not false
    or v_claim.claimed_lock_token <> 'token-1-' || v_suffix then
    raise exception 'PROBE_FIRST_CLAIM_FAILED';
  end if;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_2, v_account_2, 'inbox', 'token-2-' || v_suffix, 90, false
  );
  if v_claim.acquired is not true then
    raise exception 'PROBE_SECOND_CLAIM_FAILED';
  end if;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_3, v_account_3, 'inbox', 'token-3-' || v_suffix, 90, false
  );
  if v_claim.acquired is not true then
    raise exception 'PROBE_THIRD_CLAIM_FAILED';
  end if;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_4, v_account_4, 'inbox', 'token-4-' || v_suffix, 90, false
  );
  if v_claim.acquired is not false or v_claim.locked is not true
    or v_claim.claimed_lock_token is not null then
    raise exception 'PROBE_GLOBAL_CAP_DID_NOT_BLOCK_FOURTH';
  end if;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_1, v_account_1, 'inbox', 'forced-steal-' || v_suffix, 90, true
  );
  if v_claim.acquired is not false or v_claim.locked is not true then
    raise exception 'PROBE_FORCE_STOLE_ACTIVE_LEASE';
  end if;
  select lock_token into v_stored_token
  from public.softora_mailbox_sync_state where sync_key = v_key_1;
  if v_stored_token <> 'token-1-' || v_suffix then
    raise exception 'PROBE_FORCE_CHANGED_ACTIVE_TOKEN';
  end if;

  -- A same-token direct UPSERT proves SQL-first rollout stays compatible with
  -- an older runtime that still writes softora_mailbox_sync_state directly.
  insert into public.softora_mailbox_sync_state (
    sync_key, account_email, folder, status, sync_started_at,
    lock_token, lock_expires_at, updated_at
  ) values (
    v_key_1, v_account_1, 'inbox', 'syncing', clock_timestamp(),
    'token-1-' || v_suffix, clock_timestamp() + interval '90 seconds', clock_timestamp()
  )
  on conflict (sync_key) do update set
    status = excluded.status,
    sync_started_at = excluded.sync_started_at,
    lock_token = excluded.lock_token,
    lock_expires_at = excluded.lock_expires_at,
    updated_at = excluded.updated_at;

  begin
    insert into public.softora_mailbox_sync_state (
      sync_key, account_email, folder, status, sync_started_at,
      lock_token, lock_expires_at, updated_at
    ) values (
      v_key_1, v_account_1, 'inbox', 'syncing', clock_timestamp(),
      'old-runtime-steal-' || v_suffix,
      clock_timestamp() + interval '90 seconds', clock_timestamp()
    )
    on conflict (sync_key) do update set
      status = excluded.status,
      sync_started_at = excluded.sync_started_at,
      lock_token = excluded.lock_token,
      lock_expires_at = excluded.lock_expires_at,
      updated_at = excluded.updated_at;
    raise exception 'PROBE_OLD_RUNTIME_STOLE_ACTIVE_LEASE';
  exception when sqlstate 'P0001' then
    if position('MAILBOX_SYNC_ACTIVE_LOCK' in sqlerrm) = 0 then
      raise;
    end if;
  end;

  update public.softora_mailbox_sync_state set
    status = 'ok', lock_token = null, lock_expires_at = null,
    last_synced_at = clock_timestamp(), updated_at = clock_timestamp()
  where sync_key = v_key_1 and lock_token = 'token-1-' || v_suffix;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'PROBE_SAME_TOKEN_FINISH_FAILED';
  end if;

  -- Releasing one lease must make exactly one capacity slot claimable.
  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_4, v_account_4, 'inbox', 'token-4-' || v_suffix, 90, true
  );
  if v_claim.acquired is not true or v_claim.claimed_lock_token <> 'token-4-' || v_suffix then
    raise exception 'PROBE_RELEASED_SLOT_WAS_NOT_RECLAIMED';
  end if;

  update public.softora_mailbox_sync_state set
    status = 'ok', lock_token = null, lock_expires_at = null, updated_at = clock_timestamp()
  where sync_key = v_key_4 and lock_token = 'token-4-' || v_suffix;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'PROBE_RECLAIMED_SLOT_FINISH_FAILED';
  end if;

  select * into v_claim from public.softora_claim_mailbox_sync_lock(
    v_key_1, v_account_1, 'inbox', 'replacement-1-' || v_suffix, 90, false
  );
  if v_claim.acquired is not true then
    raise exception 'PROBE_REPLACEMENT_CLAIM_FAILED';
  end if;

  update public.softora_mailbox_sync_state set
    status = 'error', lock_token = null, lock_expires_at = null, updated_at = clock_timestamp()
  where sync_key = v_key_1 and lock_token = 'token-1-' || v_suffix;
  get diagnostics v_affected = row_count;
  if v_affected <> 0 then
    raise exception 'PROBE_STALE_FINISH_CHANGED_RECLAIMED_LEASE';
  end if;

  update public.softora_mailbox_sync_state set
    status = 'ok', lock_token = null, lock_expires_at = null, updated_at = clock_timestamp()
  where sync_key = v_key_1 and lock_token = 'replacement-1-' || v_suffix;
  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception 'PROBE_REPLACEMENT_TOKEN_FINISH_FAILED';
  end if;
end;
$probe$;

rollback;
