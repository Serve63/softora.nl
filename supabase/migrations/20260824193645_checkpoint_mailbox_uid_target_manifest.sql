-- Persist targeted All Mail manifest discovery independently from message
-- staging so a bounded header scan can resume after the IMAP lease is released.

alter table public.softora_mailbox_uid_generations
  add column if not exists selection_manifest_scanned_through_uid bigint;
alter table public.softora_mailbox_uid_generations
  add column if not exists selection_manifest_partial_uids jsonb;
alter table public.softora_mailbox_uid_generations
  add column if not exists selection_manifest_seed_invalidated_at timestamptz;

update public.softora_mailbox_uid_generations as generation
set selection_manifest_scanned_through_uid = case
      when generation.selection_policy = 'targeted-sparse-v2'
        and generation.selection_uid_manifest is not null
        then generation.scan_upper_uid
      else 0
    end,
    selection_manifest_partial_uids = case
      when generation.selection_policy = 'targeted-sparse-v2'
        then coalesce(generation.selection_uid_manifest, '[]'::jsonb)
      else '[]'::jsonb
    end
where generation.selection_manifest_scanned_through_uid is null
   or generation.selection_manifest_partial_uids is null;

alter table public.softora_mailbox_uid_generations
  alter column selection_manifest_scanned_through_uid set default 0,
  alter column selection_manifest_scanned_through_uid set not null,
  alter column selection_manifest_partial_uids set default '[]'::jsonb,
  alter column selection_manifest_partial_uids set not null;

alter table public.softora_mailbox_uid_generations
  drop constraint if exists softora_mailbox_uid_generations_manifest_scan_check;
alter table public.softora_mailbox_uid_generations
  add constraint softora_mailbox_uid_generations_manifest_scan_check check (
    selection_manifest_scanned_through_uid between 0 and scan_upper_uid
    and pg_catalog.jsonb_typeof(selection_manifest_partial_uids) = 'array'
    and pg_catalog.jsonb_array_length(selection_manifest_partial_uids) <= 2000
    and (
      selection_policy = 'targeted-sparse-v2'
      or selection_manifest_scanned_through_uid = 0
        and selection_manifest_partial_uids = '[]'::jsonb
    )
    and (
      selection_uid_manifest is null
      or selection_policy = 'targeted-sparse-v2'
        and selection_manifest_scanned_through_uid = scan_upper_uid
        and selection_manifest_partial_uids = selection_uid_manifest
    )
  );

alter table public.softora_mailbox_uid_generation_commits
  drop constraint if exists softora_mailbox_uid_generation_commits_operation_check;
alter table public.softora_mailbox_uid_generation_commits
  add constraint softora_mailbox_uid_generation_commits_operation_check check (
    operation in ('commit', 'fail', 'skip', 'checkpoint', 'invalidate')
  );

-- Compatibility fence for the short database-before-runtime rollout window.
-- The old runtime can still provide a complete sparse manifest in its first
-- commit; that single transition freezes the new cursor and partial proof.
create or replace function public.softora_freeze_legacy_mailbox_target_manifest()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if new.selection_policy = 'targeted-sparse-v2'
    and old.selection_uid_manifest is null
    and new.selection_uid_manifest is not null then
    if old.selection_manifest_scanned_through_uid = 0
      and old.selection_manifest_partial_uids = '[]'::jsonb then
      new.selection_manifest_scanned_through_uid := new.scan_upper_uid;
      new.selection_manifest_partial_uids := new.selection_uid_manifest;
    elsif new.selection_manifest_scanned_through_uid < new.scan_upper_uid then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_REQUIRED';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_freeze_legacy_mailbox_target_manifest_trigger
  on public.softora_mailbox_uid_generations;
create trigger softora_freeze_legacy_mailbox_target_manifest_trigger
before update of selection_uid_manifest
on public.softora_mailbox_uid_generations
for each row execute function public.softora_freeze_legacy_mailbox_target_manifest();

create or replace function public.softora_prepare_mailbox_uid_generation_v3(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint,
  p_uid_next bigint,
  p_selection_policy text,
  p_selection_targets jsonb
)
returns table (
  prepared boolean,
  lock_lost boolean,
  mode text,
  reset_detected boolean,
  resumed boolean,
  active_generation_id uuid,
  target_generation_id uuid,
  current_uid_validity bigint,
  observed_uid_validity bigint,
  scan_upper_uid bigint,
  scanned_through_uid bigint,
  lease_expires_at timestamptz,
  selection_targets jsonb,
  selection_manifest_scanned_through_uid bigint,
  target_uid_manifest jsonb,
  target_manifest_complete boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_scan_upper bigint := greatest(coalesce(p_uid_next, 0) - 1, 0);
  v_target_digest text;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_pending public.softora_mailbox_uid_generations%rowtype;
  v_target public.softora_mailbox_uid_generations%rowtype;
  v_seed_cursor bigint := 0;
  v_seed_manifest jsonb := '[]'::jsonb;
  v_reset boolean := false;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_uid_next, 0) not between 1 and 9223372036854775807
    or p_selection_policy not in ('staged-rebuild-v2', 'targeted-sparse-v2')
    or pg_catalog.jsonb_typeof(coalesce(p_selection_targets, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_selection_targets) > 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
      where pg_catalog.jsonb_typeof(target.value) is distinct from 'string'
        or public.softora_normalize_mailbox_message_id(target.value #>> '{}') is null
        or target.value #>> '{}' is distinct from
          public.softora_normalize_mailbox_message_id(target.value #>> '{}')
    )
    or pg_catalog.jsonb_array_length(p_selection_targets) <> (
      select pg_catalog.count(distinct target.value #>> '{}')::integer
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
    )
    or p_selection_targets is distinct from (
      select coalesce(pg_catalog.jsonb_agg(target.value #>> '{}'
        order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
    )
    or (p_selection_policy = 'staged-rebuild-v2'
      and pg_catalog.jsonb_array_length(p_selection_targets) <> 0)
    then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_PREPARE_INVALID';
  end if;

  v_target_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_selection_targets::text, 'UTF8'), 'sha256'
  ), 'hex');

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, null::text, false, false,
      v_sync.active_uid_generation_id, null::uuid, v_sync.uid_validity,
      p_uid_validity, v_scan_upper, 0::bigint, v_sync.lock_expires_at,
      p_selection_targets, 0::bigint, '[]'::jsonb, false;
    return;
  end if;

  if v_sync.folder = 'allmail'
    and p_selection_policy <> 'targeted-sparse-v2' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or not public.softora_mailbox_target_references_are_anchored(
      v_sync.account_email, p_selection_targets
    )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_UNANCHORED';
  end if;

  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id
    for update;
    if not found or v_active.sync_key is distinct from v_sync.sync_key
      or v_active.status <> 'active'
      or v_active.uid_validity is distinct from v_sync.uid_validity then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_ACTIVE_INCONSISTENT';
    end if;
  elsif v_sync.uid_validity is not null then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_ACTIVE_MISSING';
  end if;

  if v_sync.pending_uid_generation_id is not null then
    select generation.* into v_pending
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.pending_uid_generation_id
    for update;
    if not found or v_pending.sync_key is distinct from v_sync.sync_key
      or v_pending.status <> 'staging' then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_PENDING_INCONSISTENT';
    end if;
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  if v_active.generation_id is not null
    and v_active.uid_validity = p_uid_validity
    and v_pending.generation_id is null
    and (
      p_selection_policy = 'staged-rebuild-v2'
        and v_scan_upper >= greatest(coalesce(v_sync.last_uid, 0), 0)
      or p_selection_policy = 'targeted-sparse-v2'
        and v_active.selection_policy = 'targeted-sparse-v2'
        and v_active.selection_targets_digest = v_target_digest
        and v_active.selection_targets = p_selection_targets
        and v_active.scan_upper_uid = v_scan_upper
        and v_active.selection_manifest_scanned_through_uid = v_scan_upper
        and v_active.selection_uid_manifest is not null
        and v_active.selection_manifest_seed_invalidated_at is null
        and v_active.scan_complete
    ) then
    return query select true, false, 'steady'::text, false, false,
      v_active.generation_id, v_active.generation_id, v_active.uid_validity,
      p_uid_validity, v_scan_upper,
      case when p_selection_policy = 'targeted-sparse-v2'
        then 0::bigint else greatest(coalesce(v_sync.last_uid, 0), 0) end,
      v_sync.lock_expires_at, p_selection_targets,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_active.selection_manifest_scanned_through_uid else 0::bigint end,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_active.selection_uid_manifest else '[]'::jsonb end,
      p_selection_policy = 'targeted-sparse-v2';
    return;
  end if;

  v_reset := v_active.generation_id is not null;
  if v_pending.generation_id is not null
    and v_pending.uid_validity = p_uid_validity
    and v_pending.selection_policy = p_selection_policy
    and v_pending.scan_upper_uid <= v_scan_upper
    and (
      p_selection_policy = 'targeted-sparse-v2'
      or v_pending.selection_targets_digest = v_target_digest
        and v_pending.selection_targets = p_selection_targets
    ) then
    v_target := v_pending;
    return query select true, false, 'rebuild'::text, v_reset, true,
      v_active.generation_id, v_target.generation_id, v_active.uid_validity,
      p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
      v_sync.lock_expires_at, v_target.selection_targets,
      case when p_selection_policy = 'targeted-sparse-v2'
        then v_target.selection_manifest_scanned_through_uid else 0::bigint end,
      case when p_selection_policy = 'targeted-sparse-v2'
        then coalesce(v_target.selection_uid_manifest,
          v_target.selection_manifest_partial_uids, '[]'::jsonb)
        else '[]'::jsonb end,
      p_selection_policy = 'targeted-sparse-v2'
        and v_target.selection_uid_manifest is not null
        and v_target.selection_manifest_scanned_through_uid = v_target.scan_upper_uid;
    return;
  end if;

  if v_pending.generation_id is not null then
    delete from public.softora_mailbox_uid_generation_staging as staged
    where staged.generation_id = v_pending.generation_id;
    update public.softora_mailbox_uid_generations as generation
    set status = 'abandoned', abandoned_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    where generation.generation_id = v_pending.generation_id;
  end if;

  if p_selection_policy = 'targeted-sparse-v2'
    and v_active.generation_id is not null
    and v_active.uid_validity = p_uid_validity
    and v_active.selection_policy = 'targeted-sparse-v2'
    and v_active.selection_targets_digest = v_target_digest
    and v_active.selection_targets = p_selection_targets
    and v_active.selection_uid_manifest is not null
    and v_active.selection_manifest_scanned_through_uid = v_active.scan_upper_uid
    and v_active.selection_manifest_seed_invalidated_at is null
    and v_active.scan_upper_uid <= v_scan_upper then
    v_seed_cursor := v_active.scan_upper_uid;
    v_seed_manifest := v_active.selection_uid_manifest;
  end if;

  insert into public.softora_mailbox_uid_generations (
    generation_id, sync_key, account_email, folder, uid_validity,
    selection_policy, selection_targets, selection_targets_digest,
    selection_manifest_scanned_through_uid,
    selection_manifest_partial_uids,
    status, scan_upper_uid, scanned_through_uid,
    scan_complete, updated_at
  ) values (
    pg_catalog.gen_random_uuid(), v_sync.sync_key, v_sync.account_email,
    v_sync.folder, p_uid_validity, p_selection_policy, p_selection_targets,
    v_target_digest,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_seed_cursor else 0 end,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_seed_manifest else '[]'::jsonb end,
    'staging', v_scan_upper, 0, false, pg_catalog.clock_timestamp()
  ) returning * into v_target;

  update public.softora_mailbox_sync_state as state
  set pending_uid_generation_id = v_target.generation_id,
      updated_at = pg_catalog.clock_timestamp()
  where state.sync_key = v_sync.sync_key;

  return query select true, false, 'rebuild'::text, v_reset, false,
    v_active.generation_id, v_target.generation_id, v_active.uid_validity,
    p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
    v_sync.lock_expires_at, v_target.selection_targets,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_target.selection_manifest_scanned_through_uid else 0::bigint end,
    case when p_selection_policy = 'targeted-sparse-v2'
      then v_target.selection_manifest_partial_uids else '[]'::jsonb end,
    p_selection_policy = 'targeted-sparse-v2'
      and v_target.selection_uid_manifest is not null
      and v_target.selection_manifest_scanned_through_uid = v_target.scan_upper_uid;
end;
$function$;

create or replace function public.softora_prepare_mailbox_uid_generation_v2(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint,
  p_uid_next bigint,
  p_selection_policy text,
  p_selection_targets jsonb
)
returns table (
  prepared boolean,
  lock_lost boolean,
  mode text,
  reset_detected boolean,
  resumed boolean,
  active_generation_id uuid,
  target_generation_id uuid,
  current_uid_validity bigint,
  observed_uid_validity bigint,
  scan_upper_uid bigint,
  scanned_through_uid bigint,
  lease_expires_at timestamptz,
  selection_targets jsonb
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_prepared record;
begin
  select * into strict v_prepared
  from public.softora_prepare_mailbox_uid_generation_v3(
    p_sync_key,
    p_lock_token,
    p_uid_validity,
    p_uid_next,
    p_selection_policy,
    p_selection_targets
  ) as prepared_v3;

  -- The pre-checkpoint runtime only understands a complete SEARCH result. If
  -- v3 seeded an incomplete manifest from the active generation, discard only
  -- that resumable header proof while no message bodies have been staged. The
  -- old runtime can then safely freeze its full SEARCH manifest on commit.
  if v_prepared.prepared is true
    and v_prepared.lock_lost is false
    and v_prepared.mode = 'rebuild'
    and v_prepared.target_generation_id is not null
    and p_selection_policy = 'targeted-sparse-v2'
    and v_prepared.target_manifest_complete is false then
    update public.softora_mailbox_uid_generations as generation
    set selection_manifest_scanned_through_uid = 0,
        selection_manifest_partial_uids = '[]'::jsonb,
        updated_at = pg_catalog.clock_timestamp()
    where generation.generation_id = v_prepared.target_generation_id
      and generation.sync_key = pg_catalog.lower(pg_catalog.btrim(p_sync_key))
      and generation.status = 'staging'
      and generation.selection_policy = 'targeted-sparse-v2'
      and generation.selection_uid_manifest is null
      and generation.scanned_through_uid = 0
      and not exists (
        select 1
        from public.softora_mailbox_uid_generation_staging as staged
        where staged.generation_id = generation.generation_id
      );

    if exists (
      select 1
      from public.softora_mailbox_uid_generations as generation
      where generation.generation_id = v_prepared.target_generation_id
        and generation.selection_uid_manifest is null
        and (
          generation.selection_manifest_scanned_through_uid <> 0
          or generation.selection_manifest_partial_uids <> '[]'::jsonb
        )
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_LEGACY_TARGET_MANIFEST_INCOMPATIBLE';
    end if;
  end if;

  return query select
    v_prepared.prepared,
    v_prepared.lock_lost,
    v_prepared.mode,
    v_prepared.reset_detected,
    v_prepared.resumed,
    v_prepared.active_generation_id,
    v_prepared.target_generation_id,
    v_prepared.current_uid_validity,
    v_prepared.observed_uid_validity,
    v_prepared.scan_upper_uid,
    v_prepared.scanned_through_uid,
    v_prepared.lease_expires_at,
    v_prepared.selection_targets;
end;
$function$;

create or replace function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  p_sync_key text,
  p_lock_token text,
  p_checkpoint_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_expected_scanned_through_uid bigint,
  p_scanned_through_uid bigint,
  p_found_uids jsonb,
  p_scan_complete boolean
)
returns table (
  checkpointed boolean,
  lock_lost boolean,
  replayed boolean,
  scanned_through_uid bigint,
  target_uid_manifest jsonb,
  scan_complete boolean,
  lock_released boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_checkpoint_id text := pg_catalog.btrim(coalesce(p_checkpoint_id, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_checkpoint public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_next_manifest jsonb := '[]'::jsonb;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_checkpoint_id = '' or pg_catalog.char_length(v_checkpoint_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_expected_scanned_through_uid, -1) < 0
    or coalesce(p_scanned_through_uid, -1) < p_expected_scanned_through_uid
    or p_scan_complete is null
    or pg_catalog.jsonb_typeof(coalesce(p_found_uids, 'null'::jsonb))
      is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_found_uids) > 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
      where pg_catalog.jsonb_typeof(found.value) is distinct from 'number'
        or found.value #>> '{}' !~ '^[0-9]+$'
        or (found.value #>> '{}')::numeric not between 1 and 9223372036854775807
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  if p_found_uids is distinct from (
    select coalesce(pg_catalog.jsonb_agg(valid.uid order by valid.uid), '[]'::jsonb)
    from (
      select distinct (found.value #>> '{}')::bigint as uid
      from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
    ) as valid
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'checkpoint', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'generationId', p_generation_id,
      'uidValidity', p_uid_validity,
      'expectedScannedThroughUid', p_expected_scanned_through_uid,
      'scannedThroughUid', p_scanned_through_uid,
      'foundUids', p_found_uids, 'scanComplete', p_scan_complete
    )::text, 'UTF8'), 'sha256'), 'hex');

  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_checkpoint_id;
  if found and (
    v_existing.operation <> 'checkpoint'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
    or v_existing.generation_id is distinct from p_generation_id
    or v_existing.uid_validity is distinct from p_uid_validity
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true,
      coalesce((v_existing.result->>'scannedThroughUid')::bigint, 0),
      coalesce(v_existing.result->'targetUidManifest', '[]'::jsonb),
      coalesce((v_existing.result->>'scanComplete')::boolean, false),
      coalesce((v_existing.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false, 0::bigint,
      '[]'::jsonb, false, false;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, generation_id,
    uid_validity, status, updated_at
  ) values (
    v_checkpoint_id, 'checkpoint', v_payload_digest, v_sync_key,
    p_generation_id, p_uid_validity, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_checkpoint
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_checkpoint_id
  for update;
  if v_checkpoint.operation <> 'checkpoint'
    or v_checkpoint.payload_digest <> v_payload_digest
    or v_checkpoint.sync_key <> v_sync_key
    or v_checkpoint.generation_id is distinct from p_generation_id
    or v_checkpoint.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_checkpoint.status = 'completed' then
    return query select true, false, true,
      coalesce((v_checkpoint.result->>'scannedThroughUid')::bigint, 0),
      coalesce(v_checkpoint.result->'targetUidManifest', '[]'::jsonb),
      coalesce((v_checkpoint.result->>'scanComplete')::boolean, false),
      coalesce((v_checkpoint.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key <> v_sync.sync_key
    or v_generation.account_email <> v_sync.account_email
    or v_generation.folder <> v_sync.folder
    or v_generation.generation_id is distinct from v_sync.pending_uid_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.uid_validity <> p_uid_validity
    or v_generation.selection_uid_manifest is not null
    or v_generation.selection_manifest_scanned_through_uid
      <> p_expected_scanned_through_uid
    or p_scanned_through_uid > v_generation.scan_upper_uid
    or p_scan_complete is distinct from
      (p_scanned_through_uid = v_generation.scan_upper_uid)
    or (
      p_scanned_through_uid = p_expected_scanned_through_uid
      and not (p_scan_complete and p_scanned_through_uid = 0)
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_CONFLICT';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
    where (found.value #>> '{}')::bigint
      not between p_expected_scanned_through_uid + 1 and p_scanned_through_uid
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_UID_OUT_OF_WINDOW';
  end if;

  if exists (
    with manifest as (
      select (entry.value #>> '{}')::numeric as uid, entry.ordinality
      from pg_catalog.jsonb_array_elements(
        v_generation.selection_manifest_partial_uids
      ) with ordinality as entry(value, ordinality)
      where pg_catalog.jsonb_typeof(entry.value) = 'number'
        and entry.value #>> '{}' ~ '^[0-9]+$'
    )
    select 1
    from pg_catalog.jsonb_array_elements(
      v_generation.selection_manifest_partial_uids
    ) with ordinality as candidate(value, ordinality)
    left join manifest using (ordinality)
    where manifest.uid is null
      or manifest.uid not between 1 and p_expected_scanned_through_uid
      or exists (
        select 1 from manifest as previous
        where previous.ordinality = manifest.ordinality - 1
          and previous.uid >= manifest.uid
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_MANIFEST_STORED_INVALID';
  end if;

  select coalesce(pg_catalog.jsonb_agg(uid order by uid), '[]'::jsonb)
  into v_next_manifest
  from (
    select (stored.value #>> '{}')::bigint as uid
    from pg_catalog.jsonb_array_elements(
      v_generation.selection_manifest_partial_uids
    ) as stored(value)
    union
    select (found.value #>> '{}')::bigint as uid
    from pg_catalog.jsonb_array_elements(p_found_uids) as found(value)
  ) as combined;

  if pg_catalog.jsonb_array_length(v_next_manifest) > 2000 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_LIMIT';
  end if;

  update public.softora_mailbox_uid_generations as generation
  set selection_manifest_scanned_through_uid = p_scanned_through_uid,
      selection_manifest_partial_uids = v_next_manifest,
      selection_uid_manifest = case when p_scan_complete
        then v_next_manifest else null end,
      selection_uid_manifest_digest = case when p_scan_complete then
        pg_catalog.encode(extensions.digest(
          pg_catalog.convert_to(v_next_manifest::text, 'UTF8'), 'sha256'
        ), 'hex') else null end,
      updated_at = v_now
  where generation.generation_id = p_generation_id;

  if not p_scan_complete then
    update public.softora_mailbox_sync_state as state
    set status = 'idle', sync_started_at = null, lock_token = null,
        lock_expires_at = null, last_error = null, updated_at = v_now
    where state.sync_key = v_sync.sync_key
      and state.status = 'syncing'
      and state.lock_token is not distinct from v_lock_token;
    if not found then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
    end if;
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'checkpointed', true, 'lockLost', false,
    'scannedThroughUid', p_scanned_through_uid,
    'targetUidManifest', v_next_manifest,
    'scanComplete', p_scan_complete,
    'lockReleased', not p_scan_complete
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_checkpoint_id;

  return query select true, false, false, p_scanned_through_uid,
    v_next_manifest, p_scan_complete, not p_scan_complete;
end;
$function$;

create or replace function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  p_sync_key text,
  p_lock_token text,
  p_invalidation_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_expected_staged_count integer,
  p_missing_uids jsonb
)
returns table (
  invalidated boolean,
  lock_lost boolean,
  replayed boolean,
  generation_role text,
  pending_abandoned boolean,
  active_manifest_invalidated boolean,
  lock_released boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_invalidation_id text := pg_catalog.btrim(coalesce(p_invalidation_id, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_invalidation public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_generation_role text;
  v_staged_count integer := 0;
  v_deleted_count integer := 0;
  v_active_manifest_invalidated boolean := false;
  v_result jsonb;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_invalidation_id = ''
    or pg_catalog.char_length(v_invalidation_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or coalesce(p_expected_staged_count, -1) not between 0 and 2000
    or pg_catalog.jsonb_typeof(coalesce(p_missing_uids, 'null'::jsonb))
      is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_missing_uids) not between 1 and 2000
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      where pg_catalog.jsonb_typeof(missing.value) is distinct from 'number'
        or missing.value #>> '{}' !~ '^[0-9]+$'
        or (missing.value #>> '{}')::numeric not between 1 and 9223372036854775807
    )
    or p_missing_uids is distinct from (
      select coalesce(pg_catalog.jsonb_agg(valid.uid order by valid.uid), '[]'::jsonb)
      from (
        select distinct (missing.value #>> '{}')::bigint as uid
        from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      ) as valid
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'invalidate', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'generationId', p_generation_id,
      'uidValidity', p_uid_validity,
      'expectedStagedCount', p_expected_staged_count,
      'missingUids', p_missing_uids
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- A completed lost-response replay is immutable and no longer needs a lease.
  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_invalidation_id;
  if found and (
    v_existing.operation <> 'invalidate'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
    or v_existing.generation_id is distinct from p_generation_id
    or v_existing.uid_validity is distinct from p_uid_validity
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true,
      nullif(v_existing.result->>'generationRole', ''),
      coalesce((v_existing.result->>'pendingAbandoned')::boolean, false),
      coalesce((v_existing.result->>'activeManifestInvalidated')::boolean, false),
      coalesce((v_existing.result->>'lockReleased')::boolean, false);
    return;
  end if;

  -- Reject an already-lost lease without creating an idempotency mutation.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false, null::text,
      false, false, false;
    return;
  end if;

  -- Shared mutation order: advisory -> campaign -> idempotency -> sync state
  -- -> generation rows -> staging. This matches commit/fail/checkpoint.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  begin
    insert into public.softora_mailbox_uid_generation_commits (
      commit_id, operation, payload_digest, sync_key, generation_id,
      uid_validity, status, updated_at
    ) values (
      v_invalidation_id, 'invalidate', v_payload_digest, v_sync_key,
      p_generation_id, p_uid_validity, 'pending', v_now
    ) on conflict (commit_id) do nothing;
  exception
    when foreign_key_violation then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end;

  select mutation.* into strict v_invalidation
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_invalidation_id
  for update;
  if v_invalidation.operation <> 'invalidate'
    or v_invalidation.payload_digest <> v_payload_digest
    or v_invalidation.sync_key <> v_sync_key
    or v_invalidation.generation_id is distinct from p_generation_id
    or v_invalidation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_invalidation.status = 'completed' then
    return query select true, false, true,
      nullif(v_invalidation.result->>'generationRole', ''),
      coalesce((v_invalidation.result->>'pendingAbandoned')::boolean, false),
      coalesce((v_invalidation.result->>'activeManifestInvalidated')::boolean, false),
      coalesce((v_invalidation.result->>'lockReleased')::boolean, false);
    return;
  end if;

  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key
  for update;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key is distinct from v_sync.sync_key
    or v_generation.account_email is distinct from v_sync.account_email
    or v_generation.folder is distinct from v_sync.folder
    or v_generation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if p_generation_id = v_sync.pending_uid_generation_id
    and v_generation.status = 'staging' then
    v_generation_role := 'pending';
  elsif p_generation_id = v_sync.active_uid_generation_id
    and v_generation.status = 'active' then
    v_generation_role := 'active';
  else
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.selection_uid_manifest is null
    or v_generation.selection_manifest_scanned_through_uid
      <> v_generation.scan_upper_uid
    or v_generation.selection_manifest_partial_uids
      is distinct from v_generation.selection_uid_manifest
    or (v_generation_role = 'active'
      and v_generation.selection_manifest_seed_invalidated_at is not null)
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
      where not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          v_generation.selection_uid_manifest
        ) with ordinality as manifest(value, ordinality)
        where (manifest.value #>> '{}')::bigint
          = (missing.value #>> '{}')::bigint
          and (
            v_generation_role = 'active'
            or manifest.ordinality > v_generation.scanned_through_uid
          )
      )
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  select pg_catalog.count(*)::integer into v_staged_count
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  if v_generation_role = 'active' then
    if p_expected_staged_count <> 0 then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
    end if;
  elsif p_expected_staged_count <> v_generation.scanned_through_uid
    or v_staged_count <> p_expected_staged_count
    or exists (
      select 1
      from public.softora_mailbox_uid_generation_staging as staged
      where staged.generation_id = p_generation_id
        and (
          exists (
            select 1
            from pg_catalog.jsonb_array_elements(p_missing_uids) as missing(value)
            where (missing.value #>> '{}')::bigint = staged.uid
          )
          or not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_generation.selection_uid_manifest
            ) with ordinality as manifest(value, ordinality)
            where manifest.ordinality <= v_generation.scanned_through_uid
              and (manifest.value #>> '{}')::bigint = staged.uid
          )
        )
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT';
  end if;

  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id;
    if not found or v_active.sync_key is distinct from v_sync.sync_key
      or v_active.status <> 'active'
      or v_active.uid_validity is distinct from v_sync.uid_validity then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_GENERATION_ACTIVE_INCONSISTENT';
    end if;
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  if v_generation_role = 'pending' then
    delete from public.softora_mailbox_uid_generation_staging as staged
    where staged.generation_id = p_generation_id;
    get diagnostics v_deleted_count = row_count;
    if v_deleted_count <> p_expected_staged_count then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;

    update public.softora_mailbox_uid_generations as generation
    set status = 'abandoned', abandoned_at = v_now, updated_at = v_now
    where generation.generation_id = p_generation_id
      and generation.status = 'staging';
    if not found then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;
  end if;

  if v_sync.active_uid_generation_id is not null then
    update public.softora_mailbox_uid_generations as generation
    set selection_manifest_seed_invalidated_at = coalesce(
          generation.selection_manifest_seed_invalidated_at, v_now
        ),
        updated_at = v_now
    where generation.generation_id = v_sync.active_uid_generation_id
      and generation.status = 'active';
    if not found then
      raise exception using errcode = '40001',
        message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
    end if;
    v_active_manifest_invalidated := true;
  end if;

  update public.softora_mailbox_sync_state as state
  set pending_uid_generation_id = case when v_generation_role = 'pending'
        then null else state.pending_uid_generation_id end,
      status = 'idle', sync_started_at = null, lock_token = null,
      lock_expires_at = null, last_error = null, updated_at = v_now
  where state.sync_key = v_sync.sync_key
    and state.status = 'syncing'
    and state.lock_token is not distinct from v_lock_token;
  if not found then
    raise exception using errcode = '40001',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CHANGED';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'invalidated', true, 'lockLost', false,
    'generationRole', v_generation_role,
    'pendingAbandoned', v_generation_role = 'pending',
    'activeManifestInvalidated', v_active_manifest_invalidated,
    'lockReleased', true
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_invalidation_id;

  return query select true, false, false, v_generation_role,
    v_generation_role = 'pending', v_active_manifest_invalidated, true;
end;
$function$;

-- Keep the existing commit RPC return type intact while replacing only three
-- byte-exact policy fragments. PostgreSQL cannot alter OUT columns through
-- CREATE OR REPLACE, and a drifted predecessor must abort instead of being
-- patched heuristically.
do $patch_frozen_target_commit$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'
  );
  v_definition text;
  v_occurrences integer;
  v_old_fragment text;
  v_old_empty text := $old_empty$    or (p_selection_policy = 'targeted-sparse-v2' and (
      pg_catalog.jsonb_array_length(p_target_reference_ids) = 0
      or p_last_uid <> 0
    )) then$old_empty$;
  v_new_empty text := $new_empty$    or (p_selection_policy = 'targeted-sparse-v2' and p_last_uid <> 0) then$new_empty$;
  v_old_anchor text := $old_anchor$  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or not public.softora_mailbox_target_references_are_anchored(
      v_sync.account_email, p_target_reference_ids
    )
    or exists ($old_anchor$;
  v_new_anchor text := $new_anchor$  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or v_generation.selection_targets is distinct from p_target_reference_ids
    or not (
      v_generation.selection_uid_manifest is not null
        and v_generation.selection_manifest_scanned_through_uid
          = v_generation.scan_upper_uid
        and v_generation.selection_manifest_partial_uids
          = v_generation.selection_uid_manifest
      or v_generation.generation_id = v_sync.pending_uid_generation_id
        and v_generation.status = 'staging'
        and v_generation.selection_uid_manifest is null
        and v_generation.selection_manifest_scanned_through_uid = 0
        and v_generation.selection_manifest_partial_uids = '[]'::jsonb
    )
    or v_generation.selection_manifest_seed_invalidated_at is not null
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or exists ($new_anchor$;
  v_old_steady text := $old_steady$        or p_last_uid <> 0
        or p_target_uid_manifest is distinct from ($old_steady$;
  v_new_steady text := $new_steady$        or p_last_uid <> 0
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
            as selected(value)
          where not exists (
            select 1
            from pg_catalog.jsonb_array_elements(
              v_generation.selection_uid_manifest
            ) as manifest(value)
            where (manifest.value #>> '{}')::bigint
              = (selected.value #>> '{}')::bigint
          )
        )
        or p_target_uid_manifest is distinct from ($new_steady$;
begin
  if v_oid is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_FROZEN_TARGET_COMMIT_PATCH_MISSING';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  foreach v_old_fragment in array array[v_old_empty, v_old_anchor, v_old_steady]
  loop
    v_occurrences := (
      pg_catalog.length(v_definition)
      - pg_catalog.length(pg_catalog.replace(v_definition, v_old_fragment, ''))
    ) / pg_catalog.length(v_old_fragment);
    if v_occurrences <> 1 then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UID_FROZEN_TARGET_COMMIT_PATCH_DRIFT';
    end if;
  end loop;

  v_definition := pg_catalog.replace(v_definition, v_old_empty, v_new_empty);
  v_definition := pg_catalog.replace(v_definition, v_old_anchor, v_new_anchor);
  v_definition := pg_catalog.replace(v_definition, v_old_steady, v_new_steady);
  execute v_definition;

  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  if pg_catalog.strpos(v_definition, v_new_empty) = 0
    or pg_catalog.strpos(v_definition, v_new_anchor) = 0
    or pg_catalog.strpos(v_definition, v_new_steady) = 0
    or pg_catalog.strpos(v_definition, v_old_empty) <> 0
    or pg_catalog.strpos(v_definition, v_old_anchor) <> 0
    or pg_catalog.strpos(v_definition, v_old_steady) <> 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_FROZEN_TARGET_COMMIT_PATCH_DRIFT';
  end if;
end;
$patch_frozen_target_commit$;

revoke all on function public.softora_freeze_legacy_mailbox_target_manifest()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) to service_role;
grant execute on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) to service_role;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;
grant execute on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) to service_role;
grant execute on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) to service_role;

comment on function public.softora_prepare_mailbox_uid_generation_v3(
  text, text, bigint, bigint, text, jsonb
) is 'Fenced prepare/resume for full-window and anchored sparse UUID generations, including durable target-manifest progress, frozen pending targets and post-activation drift detection.';
comment on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) is 'Backward-compatible 13-column projection of mailbox UID generation prepare v3 for safe database-before-runtime rollout and rollback.';
comment on function public.softora_checkpoint_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, bigint, bigint, jsonb, boolean
) is 'Idempotently checkpoints a lease-fenced bounded All Mail UID header scan, freezes the complete sparse manifest, and releases incomplete leases.';
comment on function public.softora_invalidate_mailbox_uid_target_manifest_v2(
  text, text, text, uuid, bigint, integer, jsonb
) is 'Idempotently abandons only a fenced pending sparse generation, or invalidates only active manifest reuse, after an exact missing-UID proof while retaining visible active content.';

notify pgrst, 'reload schema';
