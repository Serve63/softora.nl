-- mailbox-uid-generation-epoch-v2:start
-- UIDVALIDITY identifies one IMAP epoch but is not itself a durable epoch ID:
-- a provider can expose A -> B -> A over time. UUID generations keep those two
-- A epochs distinct and keep a rebuilt snapshot invisible until activation.

-- The protocol-gate migration must already have put the runtime in draining
-- mode. Hold the shared advisory and campaign-consistency locks for this whole
-- migration transaction, then fail closed unless every old writer is gone.
do $uid_protocol_preflight$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_relevant_relations pg_catalog.oid[] := array[
    pg_catalog.to_regclass('public.softora_mailbox_campaign_consistency')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_sync_state')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_messages')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generations')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generation_staging')::pg_catalog.oid,
    pg_catalog.to_regclass('public.softora_mailbox_uid_generation_commits')::pg_catalog.oid
  ];
begin
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_FENCE_MISSING';
  end if;
  if v_consistency.uid_generation_protocol is distinct from 'draining'
    or v_consistency.uid_generation_drain_started_at is null
    or v_consistency.uid_generation_drain_ready_at is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_REQUIRED';
  end if;
  if v_consistency.uid_generation_drain_ready_at > pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_NOT_READY';
  end if;
  if exists (
    select 1
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVE_LEASES';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_locks as waiting_lock
    left join pg_catalog.pg_stat_activity as activity
      on activity.pid = waiting_lock.pid
    where waiting_lock.granted is false
      and waiting_lock.pid <> pg_catalog.pg_backend_pid()
      and (
        (
          waiting_lock.locktype = 'advisory'
          and waiting_lock.database = (
            select database.oid
            from pg_catalog.pg_database as database
            where database.datname = pg_catalog.current_database()
          )
          and waiting_lock.classid = 824031::pg_catalog.oid
          and waiting_lock.objid = 3::pg_catalog.oid
          and waiting_lock.objsubid = 2
        )
        or waiting_lock.relation = any (v_relevant_relations)
        or coalesce(activity.query, '') ilike '%softora_mailbox%'
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_WAITING_WRITERS';
  end if;
end;
$uid_protocol_preflight$;

create table if not exists public.softora_mailbox_uid_generations (
  generation_id uuid primary key default pg_catalog.gen_random_uuid(),
  sync_key text not null,
  account_email text not null,
  folder text not null,
  uid_validity bigint not null,
  selection_policy text not null,
  selection_targets jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(selection_targets) = 'array'
    and pg_catalog.jsonb_array_length(selection_targets) <= 2000
  ),
  selection_targets_digest text check (
    selection_targets_digest is null or selection_targets_digest ~ '^[a-f0-9]{64}$'
  ),
  selection_uid_manifest jsonb check (
    selection_uid_manifest is null or (
      pg_catalog.jsonb_typeof(selection_uid_manifest) = 'array'
      and pg_catalog.jsonb_array_length(selection_uid_manifest) <= 2000
    )
  ),
  selection_uid_manifest_digest text check (
    selection_uid_manifest_digest is null
      or selection_uid_manifest_digest ~ '^[a-f0-9]{64}$'
  ),
  status text not null check (
    status in ('staging', 'active', 'superseded', 'abandoned')
  ),
  scan_upper_uid bigint not null default 0 check (scan_upper_uid >= 0),
  scanned_through_uid bigint not null default 0 check (scanned_through_uid >= 0),
  scan_complete boolean not null default false,
  snapshot_message_count integer check (snapshot_message_count >= 0),
  snapshot_digest text check (
    snapshot_digest is null or snapshot_digest ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default pg_catalog.now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  abandoned_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint softora_mailbox_uid_generations_uid_validity_check
    check (uid_validity between 1 and 4294967295),
  constraint softora_mailbox_uid_generations_identity_check check (
    sync_key = account_email || '|' || folder
    and account_email = pg_catalog.lower(pg_catalog.btrim(account_email))
    and folder = pg_catalog.lower(pg_catalog.btrim(folder))
    and account_email <> '' and folder <> ''
    and position('|' in account_email) = 0
    and position('|' in folder) = 0
    and pg_catalog.char_length(account_email) <= 320
    and pg_catalog.char_length(folder) <= 200
  ),
  constraint softora_mailbox_uid_generations_scan_check check (
    (
      selection_policy = 'targeted-sparse-v2'
      and scanned_through_uid <= coalesce(
        pg_catalog.jsonb_array_length(selection_uid_manifest), 0
      )
      and (
        not scan_complete
        or selection_uid_manifest is not null
          and scanned_through_uid = pg_catalog.jsonb_array_length(selection_uid_manifest)
      )
    ) or (
      selection_policy <> 'targeted-sparse-v2'
      and scanned_through_uid <= scan_upper_uid
      and (not scan_complete or scanned_through_uid = scan_upper_uid)
    )
  ),
  constraint softora_mailbox_uid_generations_status_time_check check (
    (status = 'staging' and activated_at is null and superseded_at is null and abandoned_at is null)
    or (status = 'active' and activated_at is not null and superseded_at is null and abandoned_at is null)
    or (status = 'superseded' and activated_at is not null and superseded_at is not null and abandoned_at is null)
    or (status = 'abandoned' and activated_at is null and superseded_at is null and abandoned_at is not null)
  )
);

create unique index if not exists softora_mailbox_uid_generations_one_active_idx
  on public.softora_mailbox_uid_generations (sync_key)
  where status = 'active';
create unique index if not exists softora_mailbox_uid_generations_one_staging_idx
  on public.softora_mailbox_uid_generations (sync_key)
  where status = 'staging';
create index if not exists softora_mailbox_uid_generations_history_idx
  on public.softora_mailbox_uid_generations (sync_key, created_at desc, generation_id);

create table if not exists public.softora_mailbox_uid_generation_staging (
  generation_id uuid not null
    references public.softora_mailbox_uid_generations (generation_id)
    on update restrict on delete cascade,
  uid bigint not null check (uid > 0),
  row_data jsonb not null check (pg_catalog.jsonb_typeof(row_data) = 'object'),
  row_digest text not null check (row_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (generation_id, uid)
);

create table if not exists public.softora_mailbox_uid_generation_commits (
  commit_id text primary key check (
    pg_catalog.char_length(pg_catalog.btrim(commit_id)) between 1 and 200
    and commit_id = pg_catalog.btrim(commit_id)
  ),
  operation text not null check (operation in ('commit', 'fail', 'skip')),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  sync_key text not null,
  generation_id uuid references public.softora_mailbox_uid_generations (generation_id)
    on update restrict on delete restrict,
  uid_validity bigint check (uid_validity is null or uid_validity between 1 and 4294967295),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint softora_mailbox_uid_generation_commits_completion_check check (
    (status = 'pending' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  )
);

create index if not exists softora_mailbox_uid_generation_commits_sync_idx
  on public.softora_mailbox_uid_generation_commits (sync_key, created_at desc);

alter table public.softora_mailbox_messages
  add column if not exists uid_generation_id uuid;
alter table public.softora_mailbox_sync_state
  add column if not exists active_uid_generation_id uuid;
alter table public.softora_mailbox_sync_state
  add column if not exists pending_uid_generation_id uuid;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_account_email_folder_uid_key;
drop index if exists public.softora_mailbox_messages_generation_uid_key;
create unique index if not exists softora_mailbox_messages_uid_generation_uid_key
  on public.softora_mailbox_messages (uid_generation_id, uid)
  where uid_generation_id is not null;
create index if not exists softora_mailbox_messages_active_generation_idx
  on public.softora_mailbox_messages (account_email, folder, uid_generation_id, date desc)
  where generation_superseded_at is null;
create index if not exists softora_mailbox_sync_state_active_uid_generation_idx
  on public.softora_mailbox_sync_state (active_uid_generation_id)
  where active_uid_generation_id is not null;
create index if not exists softora_mailbox_sync_state_pending_uid_generation_idx
  on public.softora_mailbox_sync_state (pending_uid_generation_id)
  where pending_uid_generation_id is not null;

do $constraints$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_messages_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_messages
      add constraint softora_mailbox_messages_uid_generation_id_fkey
      foreign key (uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_active_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_active_uid_generation_id_fkey
      foreign key (active_uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_pending_uid_generation_id_fkey'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_pending_uid_generation_id_fkey
      foreign key (pending_uid_generation_id)
      references public.softora_mailbox_uid_generations (generation_id)
      on update restrict on delete restrict not valid;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'softora_mailbox_sync_state_uid_generation_distinct_check'
      and conrelid = 'public.softora_mailbox_sync_state'::pg_catalog.regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_uid_generation_distinct_check
      check (
        active_uid_generation_id is null
        or pending_uid_generation_id is null
        or active_uid_generation_id <> pending_uid_generation_id
      ) not valid;
  end if;
end;
$constraints$;

-- Permit exactly one legacy/v1 identity adoption into a UUID generation while
-- continuing to reject account, folder, UID and provider identity rewrites.
create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(old.account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(old.folder, '')));
  v_uuid_adoption boolean := false;
begin
  v_uuid_adoption :=
    coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') = '1'
    and old.uid_generation_id is null
    and new.uid_generation_id is not null
    and new.uid_validity between 1 and 4294967295
    and pg_catalog.lower(pg_catalog.btrim(new.account_email)) = v_account_email
    and pg_catalog.lower(pg_catalog.btrim(new.folder)) = v_folder
    and new.uid is not distinct from old.uid
    and new.provider_id is not distinct from old.provider_id
    and old.message_key = any(array[
      v_account_email || '|' || v_folder || '|' || old.uid::text,
      v_account_email || '|' || v_folder || '|uv:'
        || coalesce(old.uid_validity::text, '') || '|' || old.uid::text
    ]::text[])
    and new.message_key = v_account_email || '|' || v_folder || '|gen:'
      || new.uid_generation_id::text || '|' || old.uid::text;

  if old.message_key is distinct from new.message_key
    or pg_catalog.lower(pg_catalog.btrim(old.account_email))
      is distinct from pg_catalog.lower(pg_catalog.btrim(new.account_email))
    or pg_catalog.lower(pg_catalog.btrim(old.folder))
      is distinct from pg_catalog.lower(pg_catalog.btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.uid_validity is distinct from new.uid_validity
    or old.uid_generation_id is distinct from new.uid_generation_id
    or old.provider_id is distinct from new.provider_id then
    if not v_uuid_adoption then
      raise exception using errcode = '23505',
        message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.softora_confirm_mailbox_uid_baseline_v2(
  p_sync_key text,
  p_lock_token text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_evidence jsonb
)
returns table (
  confirmed boolean,
  lock_lost boolean,
  active_generation_id uuid,
  current_uid_validity bigint,
  resume_after_uid bigint,
  adopted_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_evidence_count integer := 0;
  v_legacy_count integer := 0;
  v_adopted integer := 0;
  v_snapshot jsonb := '[]'::jsonb;
  v_digest text;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or pg_catalog.jsonb_typeof(p_evidence) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_evidence) > 100000 then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_BASELINE_INVALID';
  end if;

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
    return query select false, true, v_sync.active_uid_generation_id,
      v_sync.uid_validity, 0::bigint, 0;
    return;
  end if;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
  for update;
  if not found or v_generation.sync_key is distinct from v_sync.sync_key
    or v_generation.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_BASELINE_GENERATION_INVALID';
  end if;

  -- Lost-response replay: adoption keeps this lease alive for the following
  -- steady commit, so the same proof can be repeated without rewriting rows.
  if v_sync.active_uid_generation_id = p_generation_id
    and v_sync.pending_uid_generation_id is null
    and v_sync.uid_validity = p_uid_validity
    and v_generation.status = 'active' then
    return query select true, false, p_generation_id, p_uid_validity,
      0::bigint, coalesce(v_generation.snapshot_message_count, 0);
    return;
  end if;

  if v_sync.uid_validity is not null
    or v_sync.active_uid_generation_id is not null
    or v_sync.pending_uid_generation_id is distinct from p_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy <> 'staged-rebuild-v2' then
    return query select false, false, v_sync.active_uid_generation_id,
      v_sync.uid_validity, 0::bigint, 0;
    return;
  end if;

  -- Evidence is deliberately strict: canonical Message-ID spelling, positive
  -- unique UID and one object for every currently visible legacy row.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data)
    where pg_catalog.jsonb_typeof(evidence.row_data) is distinct from 'object'
      or (case
        when coalesce(evidence.row_data->>'uid', '') ~ '^[0-9]+$'
          then (evidence.row_data->>'uid')::numeric between 1 and 9223372036854775807
        else false
      end) is not true
      or public.softora_normalize_mailbox_message_id(
        evidence.row_data->>'messageId'
      ) is null
      or evidence.row_data->>'messageId' is distinct from
        public.softora_normalize_mailbox_message_id(evidence.row_data->>'messageId')
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  select pg_catalog.count(*)::integer,
    coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'uid', (evidence.row_data->>'uid')::bigint,
        'messageId', evidence.row_data->>'messageId'
      ) order by (evidence.row_data->>'uid')::bigint
    ), '[]'::jsonb)
  into v_evidence_count, v_snapshot
  from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data);

  if v_evidence_count <> (
    select pg_catalog.count(distinct (evidence.row_data->>'uid')::bigint)::integer
    from pg_catalog.jsonb_array_elements(p_evidence) as evidence(row_data)
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_legacy_count
  from public.softora_mailbox_messages as message
  where message.account_email = v_sync.account_email
    and message.folder = v_sync.folder
    and message.uid_validity is null
    and message.uid_generation_id is null
    and message.generation_superseded_at is null
    and message.deleted_at is null;

  if exists (
    select 1 from public.softora_mailbox_messages as message
    where message.account_email = v_sync.account_email
      and message.folder = v_sync.folder
      and message.generation_superseded_at is null
      and message.deleted_at is null
      and not (
        message.uid_validity is null and message.uid_generation_id is null
      )
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  if v_legacy_count <> v_evidence_count or exists (
    with evidence as (
      select (entry.row_data->>'uid')::bigint as uid,
        entry.row_data->>'messageId' as message_id
      from pg_catalog.jsonb_array_elements(p_evidence) as entry(row_data)
    ), legacy as (
      select message.message_key, message.uid,
        public.softora_normalize_mailbox_message_id(message.message_id) as message_id
      from public.softora_mailbox_messages as message
      where message.account_email = v_sync.account_email
        and message.folder = v_sync.folder
        and message.uid_validity is null
        and message.uid_generation_id is null
        and message.generation_superseded_at is null
        and message.deleted_at is null
    )
    select 1
    from legacy full join evidence using (uid)
    where legacy.message_key is null
      or evidence.uid is null
      or legacy.message_id is null
      or legacy.message_id is distinct from evidence.message_id
  ) then
    return query select false, false, null::uuid, null::bigint, 0::bigint, 0;
    return;
  end if;

  v_digest := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  update public.softora_mailbox_messages as message
  set uid_validity = p_uid_validity,
      uid_generation_id = p_generation_id,
      message_key = v_sync.account_email || '|' || v_sync.folder || '|gen:'
        || p_generation_id::text || '|' || message.uid::text,
      updated_at = pg_catalog.clock_timestamp()
  where message.account_email = v_sync.account_email
    and message.folder = v_sync.folder
    and message.uid_validity is null
    and message.uid_generation_id is null
    and message.generation_superseded_at is null
    and message.deleted_at is null;
  get diagnostics v_adopted = row_count;
  if v_adopted <> v_legacy_count then
    raise exception using errcode = '40001', message = 'MAILBOX_UID_BASELINE_CHANGED';
  end if;

  -- Hidden legacy rows were intentionally excluded from baseline evidence.
  -- Retire them atomically so a later restore cannot resurrect a generation-
  -- less duplicate beside the newly active UUID generation.
  update public.softora_mailbox_messages as hidden_legacy
  set generation_superseded_at = coalesce(
        hidden_legacy.generation_superseded_at, pg_catalog.clock_timestamp()
      ),
      deleted_at = coalesce(hidden_legacy.deleted_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where hidden_legacy.account_email = v_sync.account_email
    and hidden_legacy.folder = v_sync.folder
    and hidden_legacy.uid_validity is null
    and hidden_legacy.uid_generation_id is null
    and hidden_legacy.generation_superseded_at is null;

  update public.softora_mailbox_uid_generations as generation
  set status = 'active', scan_complete = true,
      scanned_through_uid = generation.scan_upper_uid,
      snapshot_message_count = v_adopted,
      snapshot_digest = v_digest,
      activated_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  where generation.generation_id = p_generation_id;

  update public.softora_mailbox_sync_state as state
  set active_uid_generation_id = p_generation_id,
      pending_uid_generation_id = null,
      uid_validity = p_uid_validity,
      -- The legacy rows prove their own identities, not that the IMAP server
      -- contains no additional UIDs. Resume from zero so every extra server
      -- row is fetched without hiding the safely adopted visible baseline.
      last_uid = 0,
      updated_at = pg_catalog.clock_timestamp()
  where state.sync_key = v_sync.sync_key;

  return query select true, false, p_generation_id, p_uid_validity,
    0::bigint, v_adopted;
end;
$function$;

-- Every IMAP row for an existing sync-state is accepted only inside a fenced
-- v2 transition. Provider rows without any sync-state retain their legacy path.
create or replace function public.softora_coerce_mailbox_uid_generation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.folder, '')));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
begin
  if v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0 then
    raise exception using errcode = '22023', message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  select sync_state.* into v_sync
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder;

  if new.uid_generation_id is not null then
    select generation.* into v_generation
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = new.uid_generation_id;
    if coalesce(pg_catalog.current_setting(
        'softora.mailbox_uid_generation_v2_transition', true
      ), '') <> '1'
      or coalesce(new.uid, 0) <= 0
      or not found
      or v_generation.sync_key is distinct from v_account_email || '|' || v_folder
      or v_generation.uid_validity is distinct from new.uid_validity
      or v_generation.status not in ('staging', 'active')
      or v_sync.sync_key is null
      or new.uid_generation_id is distinct from v_sync.active_uid_generation_id
        and new.uid_generation_id is distinct from v_sync.pending_uid_generation_id then
      raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_STALE';
    end if;
    new.account_email := v_account_email;
    new.folder := v_folder;
    new.uid_validity := v_generation.uid_validity;
    new.message_key := v_account_email || '|' || v_folder || '|gen:'
      || v_generation.generation_id::text || '|' || new.uid::text;
    return new;
  end if;

  if v_sync.sync_key is not null then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_REQUIRED';
  end if;
  return new;
end;
$function$;

-- Backfill every known UIDVALIDITY state, including empty folders, with one
-- active UUID epoch. NULL states and legacy rows intentionally stay untouched.
create or replace function public.softora_guard_mailbox_uid_generation_v2_state()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') <> '1'
    and (
      old.uid_validity is distinct from new.uid_validity
      or old.active_uid_generation_id is distinct from new.active_uid_generation_id
      or old.pending_uid_generation_id is distinct from new.pending_uid_generation_id
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_V2_TRANSITION_REQUIRED';
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_guard_mailbox_uid_generation_v2_state
  on public.softora_mailbox_sync_state;
create trigger softora_guard_mailbox_uid_generation_v2_state
before update of uid_validity, active_uid_generation_id, pending_uid_generation_id
on public.softora_mailbox_sync_state
for each row execute function public.softora_guard_mailbox_uid_generation_v2_state();

select pg_catalog.set_config(
  'softora.mailbox_uid_generation_v2_transition', '1', true
);
insert into public.softora_mailbox_uid_generations (
  generation_id, sync_key, account_email, folder, uid_validity,
  selection_policy, status, scan_upper_uid, scanned_through_uid,
  scan_complete, snapshot_message_count, activated_at, updated_at
)
select
  pg_catalog.gen_random_uuid(), state.sync_key,
  pg_catalog.lower(pg_catalog.btrim(state.account_email)),
  pg_catalog.lower(pg_catalog.btrim(state.folder)), state.uid_validity,
  'backfill-v2', 'active', greatest(coalesce(state.last_uid, 0), 0),
  greatest(coalesce(state.last_uid, 0), 0), true,
  greatest(coalesce(state.message_count, 0), 0), pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
from public.softora_mailbox_sync_state as state
where state.uid_validity is not null
  and state.active_uid_generation_id is null
  and not exists (
    select 1 from public.softora_mailbox_uid_generations as generation
    where generation.sync_key = state.sync_key and generation.status = 'active'
  );

update public.softora_mailbox_sync_state as state
set active_uid_generation_id = generation.generation_id,
    updated_at = pg_catalog.clock_timestamp()
from public.softora_mailbox_uid_generations as generation
where state.uid_validity is not null
  and state.active_uid_generation_id is null
  and generation.sync_key = state.sync_key
  and generation.uid_validity = state.uid_validity
  and generation.status = 'active';

update public.softora_mailbox_messages as message
set uid_generation_id = state.active_uid_generation_id,
    message_key = state.account_email || '|' || state.folder || '|gen:'
      || state.active_uid_generation_id::text || '|' || message.uid::text,
    updated_at = pg_catalog.clock_timestamp()
from public.softora_mailbox_sync_state as state
where state.active_uid_generation_id is not null
  and message.account_email = state.account_email
  and message.folder = state.folder
  and message.uid_validity = state.uid_validity
  and message.uid_generation_id is null
  and message.generation_superseded_at is null;

alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_messages_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_active_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_pending_uid_generation_id_fkey;
alter table public.softora_mailbox_sync_state
  validate constraint softora_mailbox_sync_state_uid_generation_distinct_check;

-- A mailbox-state mutation may target only the currently visible generation.
-- This is essential when a provider later reuses both UIDVALIDITY and UID:
-- superseded A/B rows must never win the UID/provider lookup for a new A epoch.
create or replace function public.softora_apply_mailbox_state_mutation(
  p_account_email text,
  p_folder text,
  p_uid bigint,
  p_provider_id text,
  p_mutation_key text,
  p_revision bigint,
  p_unread boolean default false,
  p_dismiss_reply boolean default false
)
returns table (
  message_key text,
  applied boolean,
  replayed boolean,
  superseded boolean,
  current_revision bigint,
  current_mutation_key text,
  unread boolean,
  softora_read_at timestamptz,
  reply_dismissed_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_row public.softora_mailbox_messages%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_account_email, ''))) < 3
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_folder, ''))) < 1
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_mutation_key, ''))) <> 64
    or pg_catalog.btrim(coalesce(p_mutation_key, '')) !~ '^[a-f0-9]{64}$'
    or coalesce(p_revision, 0) < 1
    or (coalesce(p_uid, 0) < 1
      and pg_catalog.char_length(pg_catalog.btrim(coalesce(p_provider_id, ''))) < 1) then
    raise exception using errcode = '22023',
      message = 'Ongeldige mailbox-state-mutatie';
  end if;

  -- Keep the production write order campaign -> message. Generation commits
  -- use the same global fence, so a state mutation can never land on the old
  -- row after its UI state was copied into a newly activated generation.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select message.*
  into v_row
  from public.softora_mailbox_messages as message
  where pg_catalog.lower(pg_catalog.btrim(message.account_email))
      = pg_catalog.lower(pg_catalog.btrim(p_account_email))
    and pg_catalog.lower(pg_catalog.btrim(message.folder))
      = pg_catalog.lower(pg_catalog.btrim(p_folder))
    and message.generation_superseded_at is null
    and message.deleted_at is null
    and (
      (coalesce(p_uid, 0) > 0 and message.uid = p_uid)
      or (coalesce(p_uid, 0) < 1
        and message.provider_id = pg_catalog.btrim(p_provider_id))
    )
  order by message.updated_at desc, message.message_key
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Mailboxbericht niet gevonden';
  end if;

  if v_row.state_revision > p_revision
    or (v_row.state_revision = p_revision
      and v_row.state_mutation_key is distinct from pg_catalog.btrim(p_mutation_key)) then
    return query select v_row.message_key, false, false, true,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  if v_row.state_revision = p_revision
    and v_row.state_mutation_key = pg_catalog.btrim(p_mutation_key) then
    return query select v_row.message_key, false, true, false,
      v_row.state_revision, v_row.state_mutation_key,
      v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
    return;
  end if;

  update public.softora_mailbox_messages as message
  set unread = coalesce(p_unread, false),
      softora_read_at = case
        when coalesce(p_unread, false) then null
        else coalesce(message.softora_read_at, v_now)
      end,
      reply_dismissed_at = case
        when coalesce(p_dismiss_reply, false)
          then coalesce(message.reply_dismissed_at, v_now)
        when coalesce(p_unread, false) then null
        else message.reply_dismissed_at
      end,
      state_revision = p_revision,
      state_mutation_key = pg_catalog.btrim(p_mutation_key),
      state_mutation_at = v_now,
      updated_at = v_now
  where message.message_key = v_row.message_key
  returning message.* into v_row;

  return query select v_row.message_key, true, false, false,
    v_row.state_revision, v_row.state_mutation_key,
    v_row.unread, v_row.softora_read_at, v_row.reply_dismissed_at;
end;
$function$;

create or replace function public.softora_mailbox_header_contains_message_id(
  p_value text,
  p_target text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select public.softora_normalize_mailbox_message_id(p_target) is not null
    and exists (
      select 1
      from pg_catalog.regexp_split_to_table(
        coalesce(p_value, ''), '[[:space:],]+'
      ) as token(value)
      where public.softora_normalize_mailbox_message_id(token.value)
        = public.softora_normalize_mailbox_message_id(p_target)
    );
$function$;

create or replace function public.softora_mailbox_row_matches_target_references(
  p_row jsonb,
  p_target_reference_ids jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(coalesce(p_row, '{}'::jsonb)) = 'object'
    and pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb)) = 'array'
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_reference_ids)
        as target(reference_id)
      where public.softora_normalize_mailbox_message_id(p_row->>'message_id')
          = target.reference_id
        or public.softora_normalize_mailbox_message_id(p_row->>'in_reply_to')
          = target.reference_id
        or public.softora_mailbox_header_contains_message_id(
          p_row->>'references_text', target.reference_id
        )
    );
$function$;

create or replace function public.softora_mailbox_target_references_are_anchored(
  p_account_email text,
  p_target_reference_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb)) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_reference_ids)
        as target(reference_id)
      where not exists (
        select 1
        from public.softora_mailbox_messages as anchor
        where anchor.account_email = pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and anchor.folder = any (array['inbox', 'sent', 'coldmail']::text[])
          and anchor.generation_superseded_at is null
          and anchor.deleted_at is null
          and public.softora_is_campaign_mailbox_message(
            anchor.account_email, anchor.folder, anchor.payload
          )
          and (
            public.softora_normalize_mailbox_message_id(anchor.message_id)
              = target.reference_id
            or public.softora_normalize_mailbox_message_id(anchor.in_reply_to)
              = target.reference_id
            or public.softora_mailbox_header_contains_message_id(
              anchor.references_text, target.reference_id
            )
          )
      )
    );
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
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_scan_upper bigint := greatest(coalesce(p_uid_next, 0) - 1, 0);
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_pending public.softora_mailbox_uid_generations%rowtype;
  v_target public.softora_mailbox_uid_generations%rowtype;
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
        order by target.value #>> '{}'), '[]'::jsonb)
      from pg_catalog.jsonb_array_elements(p_selection_targets) as target(value)
    )
    or (p_selection_policy = 'staged-rebuild-v2'
      and pg_catalog.jsonb_array_length(p_selection_targets) <> 0)
    or (p_selection_policy = 'targeted-sparse-v2'
      and pg_catalog.jsonb_array_length(p_selection_targets) = 0) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_PREPARE_INVALID';
  end if;

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
      p_selection_targets;
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
      or v_active.selection_policy = 'targeted-sparse-v2'
    )
    and v_scan_upper >= greatest(coalesce(v_sync.last_uid, 0), 0) then
    return query select true, false, 'steady'::text, false, false,
      v_active.generation_id, v_active.generation_id, v_active.uid_validity,
      p_uid_validity, v_scan_upper, greatest(coalesce(v_sync.last_uid, 0), 0),
      v_sync.lock_expires_at, p_selection_targets;
    return;
  end if;

  v_reset := v_active.generation_id is not null;
  if v_pending.generation_id is not null
    and v_pending.uid_validity = p_uid_validity
    and v_pending.selection_policy = p_selection_policy
    and v_pending.scan_upper_uid <= v_scan_upper then
    v_target := v_pending;
    return query select true, false, 'rebuild'::text, v_reset, true,
      v_active.generation_id, v_target.generation_id, v_active.uid_validity,
      p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
      v_sync.lock_expires_at, v_target.selection_targets;
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

  insert into public.softora_mailbox_uid_generations (
    generation_id, sync_key, account_email, folder, uid_validity,
    selection_policy, selection_targets, selection_targets_digest,
    status, scan_upper_uid, scanned_through_uid,
    scan_complete, updated_at
  ) values (
    pg_catalog.gen_random_uuid(), v_sync.sync_key, v_sync.account_email,
    v_sync.folder, p_uid_validity, p_selection_policy, p_selection_targets,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(p_selection_targets::text, 'UTF8'), 'sha256'
    ), 'hex'), 'staging',
    v_scan_upper, 0, false, pg_catalog.clock_timestamp()
  ) returning * into v_target;

  update public.softora_mailbox_sync_state as state
  set pending_uid_generation_id = v_target.generation_id,
      updated_at = pg_catalog.clock_timestamp()
  where state.sync_key = v_sync.sync_key;

  return query select true, false, 'rebuild'::text, v_reset, false,
    v_active.generation_id, v_target.generation_id, v_active.uid_validity,
    p_uid_validity, v_target.scan_upper_uid, v_target.scanned_through_uid,
    v_sync.lock_expires_at, v_target.selection_targets;
end;
$function$;

create or replace function public.softora_commit_mailbox_sync_pass_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_generation_id uuid,
  p_uid_validity bigint,
  p_selection_policy text,
  p_target_reference_ids jsonb,
  p_target_uid_manifest jsonb,
  p_rows jsonb,
  p_scanned_from_uid bigint,
  p_scanned_through_uid bigint,
  p_scan_complete boolean,
  p_message_count integer,
  p_last_uid bigint
)
returns table (
  committed boolean,
  replayed boolean,
  activated boolean,
  rebuild_pending boolean,
  upserted_count integer,
  last_uid bigint,
  current_generation_id uuid,
  current_uid_validity bigint
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_payload_digest text;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_generation public.softora_mailbox_uid_generations%rowtype;
  v_active public.softora_mailbox_uid_generations%rowtype;
  v_upserted integer := 0;
  v_staged_count integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_snapshot_digest text;
  v_result jsonb;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or p_generation_id is null
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295
    or p_selection_policy not in ('staged-rebuild-v2', 'targeted-sparse-v2')
    or pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_target_reference_ids) > 2000
    or pg_catalog.jsonb_typeof(coalesce(p_target_uid_manifest, 'null'::jsonb))
      is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_target_uid_manifest) > 2000
    or pg_catalog.jsonb_typeof(p_rows) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_rows) > 2000
    or coalesce(p_scanned_from_uid, -1) < 0
    or coalesce(p_scanned_through_uid, -1) < 0
    or p_scanned_through_uid < p_scanned_from_uid - 1
    or p_scan_complete is null
    or coalesce(p_message_count, -1) < 0
    or coalesce(p_last_uid, -1) < 0
    or (p_selection_policy = 'staged-rebuild-v2' and (
      pg_catalog.jsonb_array_length(p_target_reference_ids) <> 0
      or pg_catalog.jsonb_array_length(p_target_uid_manifest) <> 0
      or p_scanned_from_uid < 1
    ))
    or (p_selection_policy = 'targeted-sparse-v2' and (
      pg_catalog.jsonb_array_length(p_target_reference_ids) = 0
      or p_last_uid <> 0
    )) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_COMMIT_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
    where pg_catalog.jsonb_typeof(target.value) is distinct from 'string'
      or public.softora_normalize_mailbox_message_id(target.value #>> '{}') is null
      or target.value #>> '{}' is distinct from
        public.softora_normalize_mailbox_message_id(target.value #>> '{}')
  ) or pg_catalog.jsonb_array_length(p_target_reference_ids) <> (
    select pg_catalog.count(distinct target.value #>> '{}')::integer
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
  ) or p_target_reference_ids is distinct from (
    select coalesce(pg_catalog.jsonb_agg(target.value #>> '{}'
      order by target.value #>> '{}'), '[]'::jsonb)
    from pg_catalog.jsonb_array_elements(p_target_reference_ids) as target(value)
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_INVALID';
  end if;

  if exists (
    with manifest as (
      select (entry.value #>> '{}')::numeric as uid, entry.ordinality
      from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
        with ordinality as entry(value, ordinality)
      where pg_catalog.jsonb_typeof(entry.value) = 'number'
        and entry.value #>> '{}' ~ '^[0-9]+$'
    )
    select 1
    from pg_catalog.jsonb_array_elements(p_target_uid_manifest)
      with ordinality as candidate(value, ordinality)
    left join manifest using (ordinality)
    where manifest.uid is null
      or manifest.uid not between 1 and 9223372036854775807
      or exists (
        select 1 from manifest as previous
        where previous.ordinality = manifest.ordinality - 1
          and previous.uid >= manifest.uid
      )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_MANIFEST_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
    where pg_catalog.jsonb_typeof(candidate.row_data) is distinct from 'object'
      or (case
        when coalesce(candidate.row_data->>'uid', '') ~ '^[0-9]+$'
          then (candidate.row_data->>'uid')::numeric between 1 and 9223372036854775807
        else false
      end) is not true
      or nullif(pg_catalog.btrim(candidate.row_data->>'provider_id'), '') is null
      or nullif(pg_catalog.btrim(candidate.row_data->>'date'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROW_INVALID';
  end if;

  if pg_catalog.jsonb_array_length(p_rows) <> (
    select pg_catalog.count(distinct (candidate.row_data->>'uid')::bigint)::integer
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROWS_DUPLICATE';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'commit', 'syncKey', v_sync_key, 'lockToken', v_lock_token,
      'generationId', p_generation_id, 'uidValidity', p_uid_validity,
      'selectionPolicy', p_selection_policy,
      'targetReferenceIds', p_target_reference_ids,
      'targetUidManifest', p_target_uid_manifest,
      'rows', p_rows, 'scannedFromUid', p_scanned_from_uid,
      'scannedThroughUid', p_scanned_through_uid,
      'scanComplete', p_scan_complete, 'messageCount', p_message_count,
      'lastUid', p_last_uid
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- Shared lock order: advisory -> campaign -> idempotency -> sync state ->
  -- generation rows. Every state-changing branch rechecks the live lease.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, generation_id,
    uid_validity, status, updated_at
  ) values (
    v_commit_id, 'commit', v_payload_digest, v_sync_key, p_generation_id,
    p_uid_validity, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if v_commit.operation <> 'commit'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key
    or v_commit.generation_id is distinct from p_generation_id
    or v_commit.uid_validity is distinct from p_uid_validity then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  end if;
  if v_commit.status = 'completed' then
    return query select true, true,
      coalesce((v_commit.result->>'activated')::boolean, false),
      coalesce((v_commit.result->>'rebuildPending')::boolean, false),
      coalesce((v_commit.result->>'upsertedCount')::integer, 0),
      coalesce((v_commit.result->>'lastUid')::bigint, 0),
      nullif(v_commit.result->>'currentGenerationId', '')::uuid,
      nullif(v_commit.result->>'currentUidValidity', '')::bigint;
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
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform pg_catalog.set_config(
    'softora.mailbox_uid_generation_v2_transition', '1', true
  );

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
    or generation.generation_id = v_sync.active_uid_generation_id
  order by generation.generation_id
  for update;

  select generation.* into v_generation
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id;
  if not found or v_generation.sync_key <> v_sync.sync_key
    or v_generation.uid_validity <> p_uid_validity then
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_TARGET_INVALID';
  end if;
  if v_sync.active_uid_generation_id is not null then
    select generation.* into v_active
    from public.softora_mailbox_uid_generations as generation
    where generation.generation_id = v_sync.active_uid_generation_id;
  end if;

  if v_sync.folder = 'allmail'
    and p_selection_policy <> 'targeted-sparse-v2' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' and (
    v_sync.folder <> 'allmail'
    or v_generation.selection_policy <> 'targeted-sparse-v2'
    or not public.softora_is_campaign_mailbox_message(
      v_sync.account_email, 'inbox', '{}'::jsonb
    )
    or not public.softora_mailbox_target_references_are_anchored(
      v_sync.account_email, p_target_reference_ids
    )
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_uid_manifest)
        as manifest(uid)
      where manifest.uid::bigint > v_generation.scan_upper_uid
    )
  ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_TARGET_REFERENCES_UNANCHORED';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
    where (candidate.row_data ? 'account_email' and
        pg_catalog.lower(pg_catalog.btrim(candidate.row_data->>'account_email'))
          is distinct from v_sync.account_email)
      or (candidate.row_data ? 'folder' and
        pg_catalog.lower(pg_catalog.btrim(candidate.row_data->>'folder'))
          is distinct from v_sync.folder)
      or (candidate.row_data ? 'uid_validity' and (case
        when coalesce(candidate.row_data->>'uid_validity', '') ~ '^[0-9]+$'
          then (candidate.row_data->>'uid_validity')::numeric = p_uid_validity::numeric
        else false end) is not true)
      or (candidate.row_data ? 'uid_generation_id' and
        pg_catalog.lower(candidate.row_data->>'uid_generation_id')
          is distinct from p_generation_id::text)
      or (candidate.row_data ? 'message_key' and candidate.row_data->>'message_key'
        is distinct from v_sync.account_email || '|' || v_sync.folder || '|gen:'
          || p_generation_id::text || '|' || (candidate.row_data->>'uid'))
      or (
        p_selection_policy = 'staged-rebuild-v2'
        and not public.softora_is_campaign_mailbox_message(
          v_sync.account_email, v_sync.folder, candidate.row_data->'payload'
        )
      )
      or (
        p_selection_policy = 'targeted-sparse-v2'
        and not public.softora_mailbox_row_matches_target_references(
          candidate.row_data, p_target_reference_ids
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_ROW_IDENTITY_MISMATCH';
  end if;

  if v_generation.generation_id = v_sync.active_uid_generation_id
    and v_generation.status = 'active' then
    if p_selection_policy = 'targeted-sparse-v2' then
      if p_scan_complete is not true
        or p_scanned_from_uid <> 0
        or p_scanned_through_uid <> 0
        or p_last_uid <> 0
        or p_target_uid_manifest is distinct from (
          select coalesce(pg_catalog.jsonb_agg(
            (candidate.row_data->>'uid')::bigint
            order by (candidate.row_data->>'uid')::bigint
          ), '[]'::jsonb)
          from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
        ) then
        raise exception using errcode = '22023',
          message = 'MAILBOX_UID_TARGETED_STEADY_COVERAGE_INVALID';
      end if;
    elsif p_scan_complete is not true
        or p_scanned_from_uid <> greatest(coalesce(v_sync.last_uid, 0), 0) + 1
        or p_last_uid <> greatest(
          greatest(coalesce(v_sync.last_uid, 0), 0), p_scanned_through_uid
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
          where (candidate.row_data->>'uid')::bigint not between 1 and p_scanned_through_uid
        ) then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_GENERATION_STEADY_COVERAGE_INVALID';
    end if;

    insert into public.softora_mailbox_messages as stored_message (
      message_key, account_email, folder, uid, uid_validity, uid_generation_id,
      provider_id, message_id, in_reply_to, references_text, sender_name,
      sender_email, recipients_text, subject, preview, body_text,
      body_truncated, has_body, date, internal_date, unread, starred,
      payload, updated_at
    )
    select
      v_sync.account_email || '|' || v_sync.folder || '|gen:'
        || p_generation_id::text || '|' || incoming.uid::text,
      v_sync.account_email, v_sync.folder, incoming.uid, p_uid_validity,
      p_generation_id, incoming.provider_id, incoming.message_id,
      incoming.in_reply_to, incoming.references_text, incoming.sender_name,
      incoming.sender_email, incoming.recipients_text, incoming.subject,
      incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
      coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
      coalesce(incoming.unread, false), coalesce(incoming.starred, false),
      coalesce(incoming.payload, '{}'::jsonb),
      coalesce(incoming.updated_at, pg_catalog.clock_timestamp())
    from pg_catalog.jsonb_to_recordset(p_rows) as incoming(
      uid bigint, provider_id text, message_id text, in_reply_to text,
      references_text text, sender_name text, sender_email text,
      recipients_text text, subject text, preview text, body_text text,
      body_truncated boolean, has_body boolean, date timestamptz,
      internal_date timestamptz, unread boolean, starred boolean,
      payload jsonb, updated_at timestamptz
    )
    on conflict (message_key) do update set
      provider_id = excluded.provider_id,
      message_id = excluded.message_id,
      in_reply_to = excluded.in_reply_to,
      references_text = excluded.references_text,
      sender_name = excluded.sender_name,
      sender_email = excluded.sender_email,
      recipients_text = excluded.recipients_text,
      subject = excluded.subject,
      preview = excluded.preview,
      body_text = excluded.body_text,
      body_truncated = excluded.body_truncated,
      has_body = excluded.has_body,
      date = excluded.date,
      internal_date = excluded.internal_date,
      unread = excluded.unread,
      starred = excluded.starred,
      payload = excluded.payload,
      updated_at = excluded.updated_at;
    get diagnostics v_upserted = row_count;

    if p_selection_policy = 'targeted-sparse-v2' then
      select pg_catalog.count(*)::integer into v_staged_count
      from public.softora_mailbox_messages as current_message
      where current_message.uid_generation_id = p_generation_id
        and current_message.generation_superseded_at is null
        and current_message.deleted_at is null;
      update public.softora_mailbox_sync_state as state
      set status = 'ok', last_synced_at = v_now, sync_started_at = null,
          lock_token = null, lock_expires_at = null,
          message_count = v_staged_count, last_error = null, updated_at = v_now
      where state.sync_key = v_sync.sync_key;
      if pg_catalog.jsonb_array_length(p_rows) > 0 then
        update public.softora_mailbox_campaign_consistency as consistency
        set content_version = consistency.content_version + 1,
            updated_at = v_now
        where consistency.scope = 'campaign';
      end if;
    else
      update public.softora_mailbox_sync_state as state
      set status = 'ok', last_synced_at = v_now, sync_started_at = null,
          lock_token = null, lock_expires_at = null, last_uid = p_last_uid,
          message_count = p_message_count, last_error = null, updated_at = v_now
      where state.sync_key = v_sync.sync_key;
    end if;

    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', false,
      'upsertedCount', v_upserted, 'lastUid',
        case when p_selection_policy = 'targeted-sparse-v2'
          then greatest(coalesce(v_sync.last_uid, 0), 0)
          else p_last_uid end,
      'currentGenerationId', p_generation_id,
      'currentUidValidity', p_uid_validity
    );
    update public.softora_mailbox_uid_generation_commits as mutation
    set status = 'completed', result = v_result, completed_at = v_now,
        updated_at = v_now
    where mutation.commit_id = v_commit_id;
    return query select true, false, false, false, v_upserted,
      case when p_selection_policy = 'targeted-sparse-v2'
        then greatest(coalesce(v_sync.last_uid, 0), 0)
        else p_last_uid end,
      p_generation_id, p_uid_validity;
    return;
  end if;

  if v_generation.generation_id is distinct from v_sync.pending_uid_generation_id
    or v_generation.status <> 'staging'
    or v_generation.selection_policy is distinct from p_selection_policy then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REBUILD_COVERAGE_INVALID';
  end if;

  if p_selection_policy = 'targeted-sparse-v2' then
    if v_generation.selection_targets is distinct from p_target_reference_ids
      or v_generation.selection_uid_manifest is not null
        and v_generation.selection_uid_manifest is distinct from p_target_uid_manifest
      or p_scanned_from_uid <> v_generation.scanned_through_uid + 1
      or p_scanned_through_uid <> v_generation.scanned_through_uid
        + pg_catalog.jsonb_array_length(p_rows)
      or p_scanned_through_uid > pg_catalog.jsonb_array_length(p_target_uid_manifest)
      or p_scan_complete is distinct from (
        p_scanned_through_uid = pg_catalog.jsonb_array_length(p_target_uid_manifest)
      )
      or (
        select coalesce(pg_catalog.jsonb_agg(
          (candidate.row_data->>'uid')::bigint order by candidate.ordinality
        ), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_rows) with ordinality
          as candidate(row_data, ordinality)
      ) is distinct from (
        select coalesce(pg_catalog.jsonb_agg(
          (manifest.value #>> '{}')::bigint order by manifest.ordinality
        ), '[]'::jsonb)
        from pg_catalog.jsonb_array_elements(p_target_uid_manifest) with ordinality
          as manifest(value, ordinality)
        where manifest.ordinality between p_scanned_from_uid and p_scanned_through_uid
      ) then
      raise exception using errcode = '22023',
        message = 'MAILBOX_UID_TARGETED_REBUILD_COVERAGE_INVALID';
    end if;
  elsif p_scanned_from_uid <> v_generation.scanned_through_uid + 1
    or p_scanned_through_uid > v_generation.scan_upper_uid
    or p_scan_complete is distinct from
      (p_scanned_through_uid = v_generation.scan_upper_uid)
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
      where (candidate.row_data->>'uid')::bigint not between
        p_scanned_from_uid and p_scanned_through_uid
    )
    or exists (
      with ordered as (
        select (candidate.row_data->>'uid')::bigint as uid, candidate.ordinality
        from pg_catalog.jsonb_array_elements(p_rows) with ordinality
          as candidate(row_data, ordinality)
      ), compared as (
        select uid, pg_catalog.lag(uid) over (order by ordinality) as previous_uid
        from ordered
      )
      select 1 from compared
      where previous_uid is not null and uid <= previous_uid
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REBUILD_COVERAGE_INVALID';
  end if;

  with canonical as (
    select (candidate.row_data->>'uid')::bigint as uid,
      ((((((candidate.row_data - 'message_key') - 'account_email') - 'folder')
        - 'uid_validity') - 'uid_generation_id') - 'uid')
        || pg_catalog.jsonb_build_object(
          'message_key', v_sync.account_email || '|' || v_sync.folder || '|gen:'
            || p_generation_id::text || '|' || (candidate.row_data->>'uid'),
          'account_email', v_sync.account_email,
          'folder', v_sync.folder,
          'uid', (candidate.row_data->>'uid')::bigint,
          'uid_validity', p_uid_validity,
          'uid_generation_id', p_generation_id
        ) as row_data
    from pg_catalog.jsonb_array_elements(p_rows) as candidate(row_data)
  )
  insert into public.softora_mailbox_uid_generation_staging as staged (
    generation_id, uid, row_data, row_digest, updated_at
  )
  select p_generation_id, canonical.uid, canonical.row_data,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(canonical.row_data::text, 'UTF8'), 'sha256'
    ), 'hex'), v_now
  from canonical
  on conflict (generation_id, uid) do update set
    row_data = excluded.row_data,
    row_digest = excluded.row_digest,
    updated_at = excluded.updated_at;
  get diagnostics v_upserted = row_count;

  update public.softora_mailbox_uid_generations as generation
  set scanned_through_uid = p_scanned_through_uid,
      scan_complete = p_scan_complete,
      selection_uid_manifest = case
        when p_selection_policy = 'targeted-sparse-v2'
          then coalesce(generation.selection_uid_manifest, p_target_uid_manifest)
        else generation.selection_uid_manifest
      end,
      selection_uid_manifest_digest = case
        when p_selection_policy = 'targeted-sparse-v2'
          then coalesce(generation.selection_uid_manifest_digest,
            pg_catalog.encode(extensions.digest(
              pg_catalog.convert_to(p_target_uid_manifest::text, 'UTF8'), 'sha256'
            ), 'hex'))
        else generation.selection_uid_manifest_digest
      end,
      updated_at = v_now
  where generation.generation_id = p_generation_id;

  if not p_scan_complete then
    update public.softora_mailbox_sync_state as state
    set status = 'idle', sync_started_at = null, lock_token = null,
        lock_expires_at = null, last_error = null, updated_at = v_now
    where state.sync_key = v_sync.sync_key;
    v_result := pg_catalog.jsonb_build_object(
      'activated', false, 'rebuildPending', true,
      'upsertedCount', v_upserted,
      'lastUid', greatest(coalesce(v_sync.last_uid, 0), 0),
      'currentGenerationId', v_sync.active_uid_generation_id,
      'currentUidValidity', v_sync.uid_validity
    );
    update public.softora_mailbox_uid_generation_commits as mutation
    set status = 'completed', result = v_result, completed_at = v_now,
        updated_at = v_now
    where mutation.commit_id = v_commit_id;
    return query select true, false, false, true, v_upserted,
      greatest(coalesce(v_sync.last_uid, 0), 0),
      v_sync.active_uid_generation_id, v_sync.uid_validity;
    return;
  end if;

  select pg_catalog.count(*)::integer into v_staged_count
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;
  if (
    p_selection_policy = 'targeted-sparse-v2'
    and (
      p_last_uid <> 0
      or v_staged_count <> pg_catalog.jsonb_array_length(p_target_uid_manifest)
    )
  ) or (
    p_selection_policy = 'staged-rebuild-v2'
    and p_last_uid <> v_generation.scan_upper_uid
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_SNAPSHOT_INCOMPLETE';
  end if;

  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(
    pg_catalog.string_agg(staged.uid::text || ':' || staged.row_digest, '|'
      order by staged.uid), ''
  ), 'UTF8'), 'sha256'), 'hex')
  into v_snapshot_digest
  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
    coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(incoming.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, incoming.starred, false),
    prior.reply_dismissed_at, coalesce(incoming.payload, '{}'::jsonb),
    coalesce(incoming.updated_at, v_now), prior.deleted_at
  from public.softora_mailbox_uid_generation_staging as staged
  cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
    provider_id text, message_id text, in_reply_to text, references_text text,
    sender_name text, sender_email text, recipients_text text, subject text,
    preview text, body_text text, body_truncated boolean, has_body boolean,
    date timestamptz, internal_date timestamptz, unread boolean,
    starred boolean, payload jsonb, updated_at timestamptz
  )
  left join lateral (
    select old_message.softora_read_at, old_message.state_revision,
      old_message.state_mutation_key, old_message.state_mutation_at,
      old_message.starred, old_message.reply_dismissed_at,
      old_message.deleted_at
    from public.softora_mailbox_messages as old_message
    where old_message.account_email = v_sync.account_email
      and old_message.folder = v_sync.folder
      and old_message.generation_superseded_at is null
      and old_message.uid_generation_id is distinct from p_generation_id
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        is not null
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        = public.softora_normalize_mailbox_message_id(incoming.message_id)
    order by old_message.updated_at desc, old_message.message_key
    limit 1
  ) as prior on true
  where staged.generation_id = p_generation_id
  order by staged.uid
  on conflict (message_key) do update set
    provider_id = excluded.provider_id,
    message_id = excluded.message_id,
    in_reply_to = excluded.in_reply_to,
    references_text = excluded.references_text,
    sender_name = excluded.sender_name,
    sender_email = excluded.sender_email,
    recipients_text = excluded.recipients_text,
    subject = excluded.subject,
    preview = excluded.preview,
    body_text = excluded.body_text,
    body_truncated = excluded.body_truncated,
    has_body = excluded.has_body,
    date = excluded.date,
    internal_date = excluded.internal_date,
    unread = excluded.unread,
    starred = excluded.starred,
    payload = excluded.payload,
    updated_at = excluded.updated_at,
    deleted_at = coalesce(stored_message.deleted_at, excluded.deleted_at);
  get diagnostics v_upserted = row_count;

  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  if v_active.generation_id is not null then
    update public.softora_mailbox_uid_generations as generation
    set status = 'superseded', superseded_at = v_now, updated_at = v_now
    where generation.generation_id = v_active.generation_id
      and generation.status = 'active';
  end if;
  update public.softora_mailbox_uid_generations as generation
  set status = 'active', activated_at = v_now,
      snapshot_message_count = v_staged_count,
      snapshot_digest = v_snapshot_digest, updated_at = v_now
  where generation.generation_id = p_generation_id
    and generation.status = 'staging';

  update public.softora_mailbox_sync_state as state
  set active_uid_generation_id = p_generation_id,
      pending_uid_generation_id = null,
      uid_validity = p_uid_validity,
      uid_validity_reset_at = case
        when state.active_uid_generation_id is not null
          and state.active_uid_generation_id is distinct from p_generation_id
          then v_now
        else state.uid_validity_reset_at
      end,
      status = 'ok', last_synced_at = v_now, sync_started_at = null,
      lock_token = null, lock_expires_at = null,
      last_uid = case when p_selection_policy = 'targeted-sparse-v2'
        then state.last_uid else p_last_uid end,
      message_count = v_staged_count, last_error = null, updated_at = v_now
  where state.sync_key = v_sync.sync_key;

  if p_selection_policy = 'targeted-sparse-v2' then
    update public.softora_mailbox_campaign_consistency as consistency
    set content_version = consistency.content_version + 1,
        updated_at = v_now
    where consistency.scope = 'campaign';
  end if;

  v_result := pg_catalog.jsonb_build_object(
    'activated', true, 'rebuildPending', false,
    'upsertedCount', v_upserted, 'lastUid',
      case when p_selection_policy = 'targeted-sparse-v2'
        then greatest(coalesce(v_sync.last_uid, 0), 0)
        else p_last_uid end,
    'currentGenerationId', p_generation_id,
    'currentUidValidity', p_uid_validity
  );
  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = v_result, completed_at = v_now,
      updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, true, false, v_upserted,
    case when p_selection_policy = 'targeted-sparse-v2'
      then greatest(coalesce(v_sync.last_uid, 0), 0)
      else p_last_uid end,
    p_generation_id, p_uid_validity;
end;
$function$;

create or replace function public.softora_skip_mailbox_sync_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_reason text
)
returns table (
  skipped boolean,
  replayed boolean,
  lock_lost boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_payload_digest text;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_lease_precheck_valid boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_updated integer := 0;
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or v_reason <> 'folder_missing' then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_SKIP_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'skip', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'reason', v_reason
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- Remember the cheap lease snapshot, but never return from it: a concurrent
  -- identical skip may commit between this read and the advisory lock. The
  -- idempotency row is therefore always re-read after the shared fence.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  v_lease_precheck_valid := found
    and v_sync.status = 'syncing'
    and v_sync.lock_token is not distinct from v_lock_token
    and v_sync.lock_expires_at is not null
    and v_sync.lock_expires_at > pg_catalog.clock_timestamp();

  -- Shared lock order: advisory -> campaign -> idempotency -> sync state ->
  -- generation rows. This matches commit/fail and prevents cross-finalizer
  -- deadlocks while making the lease token the only releasable ownership.
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  select mutation.* into v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if found and (v_commit.operation <> 'skip'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_commit.status = 'completed' then
    return query select true, true, false;
    return;
  end if;

  if not v_lease_precheck_valid then
    perform 1 from public.softora_mailbox_sync_state as state
    where state.sync_key = v_sync_key
    for update;
    return query select false, false, true;
    return;
  end if;

  if v_commit.commit_id is null then
    insert into public.softora_mailbox_uid_generation_commits (
      commit_id, operation, payload_digest, sync_key, status, updated_at
    ) values (
      v_commit_id, 'skip', v_payload_digest, v_sync_key, 'pending', v_now
    ) returning * into v_commit;
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

  -- Preserve last_uid, message_count, UIDVALIDITY/reset time and both UUID
  -- generation pointers. A missing optional IMAP folder is not a reset.
  update public.softora_mailbox_sync_state as state
  set status = 'ok', last_synced_at = v_now, sync_started_at = null,
      lock_token = null, lock_expires_at = null, last_error = null,
      updated_at = v_now
  where state.sync_key = v_sync.sync_key
    and state.status = 'syncing'
    and state.lock_token is not distinct from v_lock_token;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = pg_catalog.jsonb_build_object(
        'skipped', true, 'replayed', false, 'lockLost', false,
        'reason', v_reason
      ), completed_at = v_now, updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, false;
end;
$function$;

create or replace function public.softora_fail_mailbox_sync_v2(
  p_sync_key text,
  p_lock_token text,
  p_commit_id text,
  p_error text
)
returns table (
  applied boolean,
  lock_lost boolean,
  replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
  v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
  v_commit_id text := pg_catalog.btrim(coalesce(p_commit_id, ''));
  v_error text := pg_catalog.btrim(coalesce(p_error, ''));
  v_payload_digest text;
  v_existing public.softora_mailbox_uid_generation_commits%rowtype;
  v_commit public.softora_mailbox_uid_generation_commits%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
    or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
    or v_commit_id = '' or pg_catalog.char_length(v_commit_id) > 200
    or v_error = '' or pg_catalog.char_length(v_error) > 4000 then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_FAIL_INVALID';
  end if;

  v_payload_digest := pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'operation', 'fail', 'syncKey', v_sync_key,
      'lockToken', v_lock_token, 'error', v_error
    )::text, 'UTF8'), 'sha256'), 'hex');

  -- A completed lost-response replay is immutable and does not need a lease.
  select mutation.* into v_existing
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id;
  if found and (
    v_existing.operation <> 'fail'
    or v_existing.payload_digest <> v_payload_digest
    or v_existing.sync_key <> v_sync_key
  ) then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif found and v_existing.status = 'completed' then
    return query select true, false, true;
    return;
  end if;

  -- Cheap non-locking rejection keeps an already-invalid token at zero writes;
  -- the same lease is checked again under the mandated lock order below.
  select state.* into v_sync
  from public.softora_mailbox_sync_state as state
  where state.sync_key = v_sync_key;
  if not found or v_sync.status <> 'syncing'
    or v_sync.lock_token is distinct from v_lock_token
    or v_sync.lock_expires_at is null
    or v_sync.lock_expires_at <= pg_catalog.clock_timestamp() then
    return query select false, true, false;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  if not found then
    raise exception using errcode = '55000', message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
  end if;

  insert into public.softora_mailbox_uid_generation_commits (
    commit_id, operation, payload_digest, sync_key, status, updated_at
  ) values (
    v_commit_id, 'fail', v_payload_digest, v_sync_key, 'pending', v_now
  ) on conflict (commit_id) do nothing;

  select mutation.* into strict v_commit
  from public.softora_mailbox_uid_generation_commits as mutation
  where mutation.commit_id = v_commit_id
  for update;
  if v_commit.operation <> 'fail'
    or v_commit.payload_digest <> v_payload_digest
    or v_commit.sync_key <> v_sync_key then
    raise exception using errcode = '22023', message = 'MAILBOX_UID_GENERATION_REPLAY_MISMATCH';
  elsif v_commit.status = 'completed' then
    return query select true, false, true;
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
    raise exception using errcode = '55000', message = 'MAILBOX_UID_GENERATION_LEASE_INVALID';
  end if;

  perform generation.generation_id
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = v_sync.active_uid_generation_id
    or generation.generation_id = v_sync.pending_uid_generation_id
  order by generation.generation_id
  for update;

  -- Cursor and both generation pointers are deliberately absent here.
  update public.softora_mailbox_sync_state as state
  set status = 'error', sync_started_at = null, lock_token = null,
      lock_expires_at = null, last_error = v_error, updated_at = v_now
  where state.sync_key = v_sync.sync_key;

  update public.softora_mailbox_uid_generation_commits as mutation
  set status = 'completed', result = pg_catalog.jsonb_build_object(
        'applied', true, 'lockLost', false
      ), completed_at = v_now, updated_at = v_now
  where mutation.commit_id = v_commit_id;

  return query select true, false, false;
end;
$function$;

alter table public.softora_mailbox_uid_generations enable row level security;
alter table public.softora_mailbox_uid_generation_staging enable row level security;
alter table public.softora_mailbox_uid_generation_commits enable row level security;

revoke all privileges on table public.softora_mailbox_uid_generations
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_uid_generation_staging
  from public, anon, authenticated, service_role;
revoke all privileges on table public.softora_mailbox_uid_generation_commits
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generations
  to service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generation_staging
  to service_role;
grant select, insert, update, delete on table public.softora_mailbox_uid_generation_commits
  to service_role;

revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_coerce_mailbox_uid_generation()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_guard_mailbox_uid_generation_v2_state()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_header_contains_message_id(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_row_matches_target_references(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_mailbox_target_references_are_anchored(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
grant execute on function public.softora_coerce_mailbox_uid_generation()
  to service_role;
grant execute on function public.softora_guard_mailbox_uid_generation_v2_state()
  to service_role;
grant execute on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) to service_role;
grant execute on function public.softora_mailbox_header_contains_message_id(text, text)
  to service_role;
grant execute on function public.softora_mailbox_row_matches_target_references(jsonb, jsonb)
  to service_role;
grant execute on function public.softora_mailbox_target_references_are_anchored(text, jsonb)
  to service_role;
grant execute on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) to service_role;
grant execute on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) to service_role;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;
grant execute on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) to service_role;
grant execute on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) to service_role;

comment on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) is 'Fenced prepare/resume for full-window and anchored sparse UUID mailbox generations; staging never changes active visibility.';
comment on function public.softora_confirm_mailbox_uid_baseline_v2(
  text, text, uuid, bigint, jsonb
) is 'Atomically adopts an exactly proven legacy NULL-UIDVALIDITY baseline while retaining its lease.';
comment on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) is 'Idempotent fenced full-window or anchored sparse mailbox commit with atomic visibility and policy-specific cursor semantics.';
comment on function public.softora_skip_mailbox_sync_v2(
  text, text, text, text
) is 'Lease-fenced idempotent folder_missing finalizer that preserves cursor, UIDVALIDITY, message count and active/pending generation pointers.';
comment on function public.softora_fail_mailbox_sync_v2(
  text, text, text, text
) is 'Fenced idempotent failure finalizer that preserves mailbox cursor and generation state.';
comment on function public.softora_apply_mailbox_state_mutation(
  text, text, bigint, text, text, bigint, boolean, boolean
) is 'Applies idempotent mailbox UI state only to a non-deleted row in the currently visible UID generation.';

-- Recheck the drain immediately before the forward-only switch. Writers can
-- start waiting while the DDL above runs; any such waiter aborts this whole
-- transaction instead of being allowed to cross the legacy/v2 boundary.
do $uid_protocol_activate$
declare
  v_consistency public.softora_mailbox_campaign_consistency%rowtype;
  v_relevant_relations pg_catalog.oid[] := array[
    'public.softora_mailbox_campaign_consistency'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_sync_state'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_messages'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generations'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generation_staging'::pg_catalog.regclass::pg_catalog.oid,
    'public.softora_mailbox_uid_generation_commits'::pg_catalog.regclass::pg_catalog.oid
  ];
  v_now timestamptz;
  v_updated integer := 0;
begin
  perform pg_catalog.pg_advisory_xact_lock(824031, 3);
  select consistency.* into v_consistency
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

  if not found
    or v_consistency.uid_generation_protocol is distinct from 'draining'
    or v_consistency.uid_generation_drain_started_at is null
    or v_consistency.uid_generation_drain_ready_at is null
    or v_consistency.uid_generation_drain_ready_at > pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_DRAIN_CHANGED';
  end if;
  if exists (
    select 1
    from public.softora_mailbox_sync_state as active_sync
    where active_sync.status = 'syncing'
      and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
      and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVE_LEASES';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_locks as waiting_lock
    left join pg_catalog.pg_stat_activity as activity
      on activity.pid = waiting_lock.pid
    where waiting_lock.granted is false
      and waiting_lock.pid <> pg_catalog.pg_backend_pid()
      and (
        (
          waiting_lock.locktype = 'advisory'
          and waiting_lock.database = (
            select database.oid
            from pg_catalog.pg_database as database
            where database.datname = pg_catalog.current_database()
          )
          and waiting_lock.classid = 824031::pg_catalog.oid
          and waiting_lock.objid = 3::pg_catalog.oid
          and waiting_lock.objsubid = 2
        )
        or waiting_lock.relation = any (v_relevant_relations)
        or coalesce(activity.query, '') ilike '%softora_mailbox%'
      )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_WAITING_WRITERS';
  end if;

  v_now := greatest(
    pg_catalog.clock_timestamp(),
    v_consistency.uid_generation_protocol_changed_at + interval '1 microsecond'
  );
  perform pg_catalog.set_config(
    'softora.mailbox_uid_protocol_transition', '1', true
  );
  update public.softora_mailbox_campaign_consistency as consistency
  set uid_generation_protocol = 'v2',
      uid_generation_protocol_changed_at = v_now,
      updated_at = v_now
  where consistency.scope = 'campaign'
    and consistency.uid_generation_protocol = 'draining'
    and consistency.uid_generation_drain_ready_at <= pg_catalog.clock_timestamp();
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_PROTOCOL_ACTIVATION_FAILED';
  end if;
end;
$uid_protocol_activate$;
notify pgrst, 'reload schema';
-- mailbox-uid-generation-epoch-v2:end
