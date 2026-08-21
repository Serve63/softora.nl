-- The initial UIDVALIDITY rollout exposed two production-only failures:
-- 1. PostgreSQL parsed the final JSON extraction after text concatenation as
--    `text ->> unknown`; parentheses keep the JSONB operand explicit.
-- 2. Legacy message-key adoption could not preserve durable lineage because
--    its foreign keys did not follow the intentional one-time key update.

alter table public.softora_mailbox_message_lineage_edges
  drop constraint if exists softora_mailbox_message_lineage_edges_child_message_key_fkey;
alter table public.softora_mailbox_message_lineage_edges
  add constraint softora_mailbox_message_lineage_edges_child_message_key_fkey
  foreign key (child_message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

alter table public.softora_mailbox_campaign_lineage_roots
  drop constraint if exists softora_mailbox_campaign_lineage_roots_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_roots
  add constraint softora_mailbox_campaign_lineage_roots_message_key_fkey
  foreign key (message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

alter table public.softora_mailbox_campaign_lineage_discoveries
  drop constraint if exists softora_mailbox_campaign_lineage_discoveries_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_discoveries
  add constraint softora_mailbox_campaign_lineage_discoveries_message_key_fkey
  foreign key (message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

alter table public.softora_mailbox_campaign_lineage_discoveries
  drop constraint if exists softora_mailbox_campaign_lineage_discover_root_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_discoveries
  add constraint softora_mailbox_campaign_lineage_discover_root_message_key_fkey
  foreign key (root_message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

alter table public.softora_mailbox_campaign_lineage_members
  drop constraint if exists softora_mailbox_campaign_lineage_members_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_members
  add constraint softora_mailbox_campaign_lineage_members_message_key_fkey
  foreign key (message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

alter table public.softora_mailbox_campaign_lineage_members
  drop constraint if exists softora_mailbox_campaign_lineage_member_parent_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_members
  add constraint softora_mailbox_campaign_lineage_member_parent_message_key_fkey
  foreign key (parent_message_key)
  references public.softora_mailbox_campaign_lineage_members (message_key)
  on update cascade on delete cascade
  deferrable initially deferred;

alter table public.softora_mailbox_campaign_lineage_members
  drop constraint if exists softora_mailbox_campaign_lineage_members_root_message_key_fkey;
alter table public.softora_mailbox_campaign_lineage_members
  add constraint softora_mailbox_campaign_lineage_members_root_message_key_fkey
  foreign key (root_message_key)
  references public.softora_mailbox_messages (message_key)
  on update cascade on delete cascade;

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
            || v_uid_validity::text || '|' || (candidate.row_data->>'uid')
      ) then
        raise exception using errcode = '22023',
          message = 'MAILBOX_UIDVALIDITY_ROW_MISMATCH';
      end if;
      select * into strict v_uid_result
      from public.softora_apply_mailbox_uid_validity(
        v_mutation.account_email, v_mutation.folder, v_uid_validity,
        v_sync_lock_token
      );
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

revoke all on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  to service_role;
