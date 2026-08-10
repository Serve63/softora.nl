-- mailbox-uidvalidity-generation:start
alter table public.softora_mailbox_messages
  add column if not exists uid_validity bigint;
alter table public.softora_mailbox_messages
  add column if not exists generation_superseded_at timestamptz;
alter table public.softora_mailbox_sync_state
  add column if not exists uid_validity bigint;
alter table public.softora_mailbox_sync_state
  add column if not exists uid_validity_reset_at timestamptz;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_messages_account_email_folder_uid_key;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_mailbox_messages_uid_validity_check'
      and conrelid = 'public.softora_mailbox_messages'::regclass
  ) then
    alter table public.softora_mailbox_messages
      add constraint softora_mailbox_messages_uid_validity_check
      check (uid_validity is null or uid_validity between 1 and 4294967295);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'softora_mailbox_sync_state_uid_validity_check'
      and conrelid = 'public.softora_mailbox_sync_state'::regclass
  ) then
    alter table public.softora_mailbox_sync_state
      add constraint softora_mailbox_sync_state_uid_validity_check
      check (uid_validity is null or uid_validity between 1 and 4294967295);
  end if;
end;
$$;

create unique index if not exists softora_mailbox_messages_generation_uid_key
  on public.softora_mailbox_messages (account_email, folder, uid_validity, uid)
  where uid_validity is not null;
create index if not exists softora_mailbox_messages_generation_superseded_idx
  on public.softora_mailbox_messages (generation_superseded_at)
  where generation_superseded_at is not null;

-- Rolling-deploy compatibility for an old runtime that still inserts the
-- legacy account|folder|uid key. Before the first real generation reset, the
-- database can safely coerce that row into the adopted generation. After a
-- reset, a generation-less row is ambiguous and must fail closed rather than
-- overwrite a reused UID in the new mailbox generation.
create or replace function public.softora_coerce_mailbox_uid_generation()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(new.account_email, '')));
  v_folder text := lower(btrim(coalesce(new.folder, '')));
  v_current_uid_validity bigint;
  v_reset_at timestamptz;
begin
  if coalesce(new.uid, 0) <= 0 then
    return new;
  end if;
  if v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  select sync_state.uid_validity, sync_state.uid_validity_reset_at
    into v_current_uid_validity, v_reset_at
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder;
  if not found or v_current_uid_validity is null then
    return new;
  end if;

  if new.uid_validity is null then
    if v_reset_at is not null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UIDVALIDITY_REQUIRED';
    end if;
    new.uid_validity := v_current_uid_validity;
  elsif new.uid_validity is distinct from v_current_uid_validity then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UIDVALIDITY_STALE_GENERATION';
  end if;

  new.account_email := v_account_email;
  new.folder := v_folder;
  new.message_key := v_account_email || '|' || v_folder || '|uv:'
    || v_current_uid_validity::text || '|' || new.uid::text;
  return new;
end;
$$;

drop trigger if exists softora_mailbox_messages_coerce_uid_generation
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_coerce_uid_generation
before insert on public.softora_mailbox_messages
for each row execute function public.softora_coerce_mailbox_uid_generation();

create or replace function public.softora_apply_mailbox_uid_validity(
  p_account_email text,
  p_folder text,
  p_uid_validity bigint,
  p_lock_token text
)
returns table (
  previous_uid_validity bigint,
  current_uid_validity bigint,
  reset_detected boolean,
  adopted_legacy boolean,
  superseded_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(p_account_email, '')));
  v_folder text := lower(btrim(coalesce(p_folder, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_previous bigint;
  v_adopted integer := 0;
  v_superseded integer := 0;
  v_changed integer := 0;
begin
  if v_account_email = '' or char_length(v_account_email) > 320
    or v_folder = '' or char_length(v_folder) > 200
    or position('|' in v_account_email) > 0
    or position('|' in v_folder) > 0
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select sync_state.uid_validity into v_previous
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_account_email || '|' || v_folder
    and sync_state.account_email = v_account_email
    and sync_state.folder = v_folder
    and sync_state.status = 'syncing'
    and sync_state.lock_token = v_lock_token
    and sync_state.lock_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UIDVALIDITY_LEASE_INVALID';
  end if;

  if v_previous is not null and v_previous is distinct from p_uid_validity then
    update public.softora_mailbox_messages as old_generation set
      deleted_at = coalesce(old_generation.deleted_at, clock_timestamp()),
      generation_superseded_at = coalesce(
        old_generation.generation_superseded_at,
        clock_timestamp()
      ),
      updated_at = clock_timestamp()
    where old_generation.account_email = v_account_email
      and old_generation.folder = v_folder
      and old_generation.uid_validity is distinct from p_uid_validity
      and old_generation.generation_superseded_at is null;
    get diagnostics v_superseded = row_count;

    update public.softora_mailbox_sync_state as sync_state set
      uid_validity = p_uid_validity,
      uid_validity_reset_at = coalesce(
        sync_state.uid_validity_reset_at,
        clock_timestamp()
      ),
      last_uid = 0,
      message_count = 0,
      last_synced_at = null,
      updated_at = clock_timestamp()
    where sync_state.sync_key = v_account_email || '|' || v_folder;
  else
    -- During a rolling deploy an old runtime may still have written a legacy
    -- key. If the generation row already exists, retire the legacy duplicate;
    -- otherwise rekey it into the proven current generation while preserving
    -- its read and user-tombstone state.
    update public.softora_mailbox_messages as legacy set
      deleted_at = coalesce(legacy.deleted_at, clock_timestamp()),
      generation_superseded_at = coalesce(
        legacy.generation_superseded_at,
        clock_timestamp()
      ),
      updated_at = clock_timestamp()
    where legacy.account_email = v_account_email
      and legacy.folder = v_folder
      and legacy.uid_validity is null
      and legacy.generation_superseded_at is null
      and exists (
        select 1 from public.softora_mailbox_messages as current_generation
        where current_generation.account_email = legacy.account_email
          and current_generation.folder = legacy.folder
          and current_generation.uid = legacy.uid
          and current_generation.uid_validity = p_uid_validity
      );
    get diagnostics v_changed = row_count;
    v_superseded := v_superseded + v_changed;

    update public.softora_mailbox_messages as legacy set
      uid_validity = p_uid_validity,
      message_key = v_account_email || '|' || v_folder || '|uv:'
        || p_uid_validity::text || '|' || legacy.uid::text,
      updated_at = clock_timestamp()
    where legacy.account_email = v_account_email
      and legacy.folder = v_folder
      and legacy.uid_validity is null
      and legacy.generation_superseded_at is null;
    get diagnostics v_adopted = row_count;

    update public.softora_mailbox_sync_state as sync_state set
      uid_validity = p_uid_validity,
      updated_at = clock_timestamp()
    where sync_state.sync_key = v_account_email || '|' || v_folder;
  end if;

  return query select v_previous, p_uid_validity,
    v_previous is not null and v_previous is distinct from p_uid_validity,
    v_adopted > 0, v_superseded;
end;
$$;

create or replace function public.softora_prepare_mailbox_uid_validity(
  p_sync_key text,
  p_lock_token text,
  p_uid_validity bigint
)
returns table (
  applied boolean,
  lock_lost boolean,
  previous_uid_validity bigint,
  current_uid_validity bigint,
  reset_detected boolean,
  adopted_legacy boolean,
  superseded_count integer
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_sync_key text := lower(btrim(coalesce(p_sync_key, '')));
  v_lock_token text := btrim(coalesce(p_lock_token, ''));
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_result record;
begin
  if v_sync_key = '' or char_length(v_sync_key) > 600
    or v_lock_token = '' or char_length(v_lock_token) > 200
    or coalesce(p_uid_validity, 0) not between 1 and 4294967295 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_UIDVALIDITY_INVALID';
  end if;

  perform pg_advisory_xact_lock(824031, 3);
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1 from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into v_sync
  from public.softora_mailbox_sync_state as sync_state
  where sync_state.sync_key = v_sync_key
    and sync_state.status = 'syncing'
    and sync_state.lock_token = v_lock_token
    and sync_state.lock_expires_at > clock_timestamp()
  for update;
  if not found then
    return query select false, true, null::bigint, null::bigint,
      false, false, 0;
    return;
  end if;

  select * into strict v_result
  from public.softora_apply_mailbox_uid_validity(
    v_sync.account_email, v_sync.folder, p_uid_validity, v_lock_token
  );
  return query select true, false,
    v_result.previous_uid_validity,
    v_result.current_uid_validity,
    v_result.reset_detected,
    v_result.adopted_legacy,
    v_result.superseded_count;
end;
$$;

-- UID-aware replacement of the currently deployed atomic commit. Legacy
-- callers remain compatible until a generation has been adopted; new callers
-- prove the exact sync lease and prepare/reset the generation in this same
-- message+journal transaction, including when the provider folder is empty.
create or replace function public.softora_commit_mailbox_campaign_messages(
  p_mutation_id uuid,
  p_request_key text,
  p_rows jsonb,
  p_result jsonb default '{}'::jsonb
)
returns table (
  mutation_id uuid, mutation_status text, started_content_version bigint,
  completed_content_version bigint, current_content_version bigint,
  upserted_count integer, replayed boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_state public.softora_mailbox_campaign_consistency%rowtype;
  v_mutation public.softora_mailbox_campaign_mutations%rowtype;
  v_sync public.softora_mailbox_sync_state%rowtype;
  v_uid_result record;
  v_upserted integer := 0;
  v_uid_validity bigint := 0;
  v_sync_lock_token text := btrim(coalesce(p_result->>'syncLockToken', ''));
  v_uid_requested boolean := false;
begin
  if p_mutation_id is null
    or char_length(btrim(coalesce(p_request_key, ''))) not between 1 and 200
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) > 2000 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;
  v_uid_requested := coalesce(p_result, '{}'::jsonb) ? 'uidValidity'
    or exists (
      select 1 from jsonb_array_elements(p_rows) as candidate(row_data)
      where candidate.row_data ? 'uid_validity'
    );

  -- Always enter through the same global lock as lease transitions. Whether
  -- this is an IMAP mutation is durable journal state, so lock ordering must
  -- never depend on caller-controlled result metadata.
  perform pg_advisory_xact_lock(824031, 3);
  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  select * into strict v_mutation
  from public.softora_mailbox_campaign_mutations as selected_mutation
  where selected_mutation.mutation_id = p_mutation_id for update;

  if v_mutation.request_key is distinct from btrim(p_request_key) then
    raise exception using errcode = '22023',
      message = 'mutation_id en request_key horen niet bij elkaar';
  elsif v_mutation.status = 'completed' then
    return query select
      v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
      v_mutation.completed_content_version, v_state.content_version,
      case when coalesce(v_mutation.result->>'upserted', '') ~ '^\d+$'
        then least((v_mutation.result->>'upserted')::bigint, 2147483647)::integer
        else 0 end,
      true;
    return;
  elsif v_mutation.status <> 'pending' then
    raise exception using errcode = '55000',
      message = 'Mailboxmutatie is niet meer schrijfbaar';
  end if;

  if v_mutation.mutation_kind = 'imap-sync' then
    select * into v_sync
    from public.softora_mailbox_sync_state as sync_state
    where sync_state.sync_key = v_mutation.account_email || '|' || v_mutation.folder
    for update;
    if v_uid_requested then
      if (case when coalesce(p_result->>'uidValidity', '') ~ '^\d+$'
          then (p_result->>'uidValidity')::numeric between 1 and 4294967295
          else false end) is not true
        or v_sync_lock_token = '' or char_length(v_sync_lock_token) > 200
        or not found
        or v_sync.status <> 'syncing'
        or v_sync.lock_token is distinct from v_sync_lock_token
        or v_sync.lock_expires_at <= clock_timestamp() then
        raise exception using errcode = '55000',
          message = 'MAILBOX_UIDVALIDITY_LEASE_INVALID';
      end if;
      v_uid_validity := (p_result->>'uidValidity')::bigint;
      if exists (
        select 1 from jsonb_array_elements(p_rows) as candidate(row_data)
        where (case when coalesce(candidate.row_data->>'uid_validity', '') ~ '^\d+$'
            then (candidate.row_data->>'uid_validity')::numeric = v_uid_validity::numeric
            else false end) is not true
          or (case when coalesce(candidate.row_data->>'uid', '') ~ '^\d+$'
            then (candidate.row_data->>'uid')::numeric between 1 and 9223372036854775807
            else false end) is not true
          or candidate.row_data->>'message_key' is distinct from
            v_mutation.account_email || '|' || v_mutation.folder || '|uv:'
            || v_uid_validity::text || '|' || candidate.row_data->>'uid'
      ) then
        raise exception using errcode = '22023',
          message = 'MAILBOX_UIDVALIDITY_ROW_MISMATCH';
      end if;
      select * into strict v_uid_result
      from public.softora_apply_mailbox_uid_validity(
        v_mutation.account_email, v_mutation.folder, v_uid_validity,
        v_sync_lock_token
      );
    -- A warm pre-UIDVALIDITY runtime is safe to coerce only while this folder
    -- has never experienced a real generation reset. The BEFORE INSERT row
    -- trigger rewrites those legacy keys to the adopted current generation.
    -- After the first reset, generation-less provider data is ambiguous.
    elsif not found or (
      v_sync.uid_validity is not null
      and v_sync.uid_validity_reset_at is not null
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_UIDVALIDITY_REQUIRED';
    end if;
  elsif jsonb_array_length(p_rows) = 0 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as candidate(row_data)
    where jsonb_typeof(candidate.row_data) is distinct from 'object'
      or not public.softora_is_campaign_mailbox_message(
        candidate.row_data->>'account_email',
        candidate.row_data->>'folder',
        candidate.row_data->'payload'
      )
      or (
        v_mutation.mutation_kind = 'imap-sync'
        and (
          lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(candidate.row_data->>'folder', '')))
            is distinct from v_mutation.folder
        )
      )
      or (
        v_mutation.mutation_kind = 'instantly-upsert'
        and (
          lower(btrim(coalesce(candidate.row_data->>'folder', ''))) <> 'instantly'
          or lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
            is distinct from v_mutation.account_email
          or lower(btrim(coalesce(
            candidate.row_data->'payload'->>'providerAccountEmail', ''
          ))) is distinct from lower(btrim(coalesce(
            candidate.row_data->>'account_email', ''
          )))
        )
      )
  ) or v_mutation.mutation_kind not in ('imap-sync', 'instantly-upsert') then
    raise exception using errcode = '22023',
      message = 'Mailboxrijen horen niet bij de gereserveerde mutatie';
  end if;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, provider_id, message_id,
    in_reply_to, references_text, sender_name, sender_email, recipients_text,
    subject, preview, body_text, body_truncated, has_body, date, internal_date,
    unread, starred, payload, updated_at
  )
  select
    incoming.message_key, incoming.account_email, incoming.folder, incoming.uid,
    incoming.uid_validity, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, incoming.body_truncated,
    incoming.has_body, incoming.date, incoming.internal_date, incoming.unread,
    incoming.starred, incoming.payload, incoming.updated_at
  from jsonb_to_recordset(p_rows) as incoming(
    message_key text, account_email text, folder text, uid bigint,
    uid_validity bigint, provider_id text, message_id text, in_reply_to text,
    references_text text, sender_name text, sender_email text,
    recipients_text text, subject text, preview text, body_text text,
    body_truncated boolean, has_body boolean, date timestamptz,
    internal_date timestamptz, unread boolean, starred boolean, payload jsonb,
    updated_at timestamptz
  )
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    uid = excluded.uid,
    uid_validity = excluded.uid_validity,
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

  select * into strict v_state
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign';
  update public.softora_mailbox_campaign_mutations as pending_mutation set
    status = 'completed',
    completed_content_version = v_state.content_version,
    completed_at = clock_timestamp(),
    result = (coalesce(p_result, '{}'::jsonb) - 'syncLockToken')
      || jsonb_build_object('ok', true, 'upserted', v_upserted),
    updated_at = clock_timestamp()
  where pending_mutation.mutation_id = p_mutation_id
    and pending_mutation.status = 'pending'
  returning * into strict v_mutation;

  return query select
    v_mutation.mutation_id, v_mutation.status, v_mutation.started_content_version,
    v_mutation.completed_content_version, v_state.content_version, v_upserted, false;
end;
$$;

revoke all on function public.softora_apply_mailbox_uid_validity(text, text, bigint, text)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_coerce_mailbox_uid_generation()
  from public, anon, authenticated, service_role;
revoke all on function public.softora_prepare_mailbox_uid_validity(text, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_apply_mailbox_uid_validity(text, text, bigint, text)
  to service_role;
grant execute on function public.softora_coerce_mailbox_uid_generation()
  to service_role;
grant execute on function public.softora_prepare_mailbox_uid_validity(text, text, bigint)
  to service_role;
grant execute on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  to service_role;
-- mailbox-uidvalidity-generation:end
