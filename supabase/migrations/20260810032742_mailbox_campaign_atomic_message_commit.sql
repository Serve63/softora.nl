-- mailbox-campaign-atomic-commit:start
-- Forward-only companion to the already deployed mailbox consistency foundation.
-- Every direct writer locks campaign state before touching message rows; the atomic RPC
-- keeps message rows, content-version and journal completion in one transaction.
create or replace function public.softora_is_campaign_mailbox_message(
  p_account_email text,
  p_folder text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(p_account_email, ''))) = any (array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
      'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
      'contact.venvisuals@gmail.com'
    ]::text[])
    and lower(btrim(coalesce(p_folder, '')))
      = any (array['inbox', 'sent', 'coldmail']::text[])
  ) or (
    lower(btrim(coalesce(p_folder, ''))) = 'instantly'
    and lower(btrim(coalesce(p_account_email, '')))
      = lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerAccountEmail', '')))
    and (
      (
        lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', ''))) = 'serve'
        and lower(btrim(coalesce(p_account_email, ''))) = any (array[
          'serve@websoftora.com', 'servecreusen@websoftora.com'
        ]::text[])
      ) or (
        lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'providerOwner', ''))) = 'martijn'
        and lower(btrim(coalesce(p_account_email, ''))) = any (array[
          'martijn@websoftora.com', 'martijnven@websoftora.com'
        ]::text[])
      )
    )
  );
$$;

alter table public.softora_mailbox_messages
  drop constraint if exists softora_mailbox_instantly_owner_account_check;
alter table public.softora_mailbox_messages
  add constraint softora_mailbox_instantly_owner_account_check
  check (
    lower(btrim(coalesce(folder, ''))) <> 'instantly'
    or public.softora_is_campaign_mailbox_message(account_email, folder, payload)
  ) not valid;
alter table public.softora_mailbox_messages
  validate constraint softora_mailbox_instantly_owner_account_check;

create or replace function public.softora_enforce_mailbox_message_identity_immutable()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if old.message_key is distinct from new.message_key
    or lower(btrim(old.account_email)) is distinct from lower(btrim(new.account_email))
    or lower(btrim(old.folder)) is distinct from lower(btrim(new.folder))
    or old.uid is distinct from new.uid
    or old.provider_id is distinct from new.provider_id then
    raise exception using errcode = '23505',
      message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
  end if;
  return new;
end;
$$;

drop trigger if exists softora_enforce_mailbox_message_identity_immutable
  on public.softora_mailbox_messages;
create trigger softora_enforce_mailbox_message_identity_immutable
before update on public.softora_mailbox_messages
for each row
execute function public.softora_enforce_mailbox_message_identity_immutable();

create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0) on conflict (scope) do nothing;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign' for update;
  return null;
end;
$$;

drop trigger if exists softora_lock_mailbox_campaign_consistency_before_write
  on public.softora_mailbox_messages;
create trigger softora_lock_mailbox_campaign_consistency_before_write
before insert or update or delete or truncate on public.softora_mailbox_messages
for each statement
execute function public.softora_lock_mailbox_campaign_consistency_before_write();

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
  v_upserted integer := 0;
begin
  if p_mutation_id is null
    or char_length(btrim(coalesce(p_request_key, ''))) not between 1 and 200
    or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;
  if jsonb_array_length(p_rows) not between 1 and 2000 then
    raise exception using errcode = '22023',
      message = 'Ongeldige atomische mailboxmutatie';
  end if;

  -- Keep the same lock order as begin, complete and fence: state first, mutation second.
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

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as candidate(row_data)
    join public.softora_mailbox_messages as existing_message
      on existing_message.message_key = candidate.row_data->>'message_key'
    where lower(btrim(existing_message.account_email))
        is distinct from lower(btrim(coalesce(candidate.row_data->>'account_email', '')))
      or lower(btrim(existing_message.folder))
        is distinct from lower(btrim(coalesce(candidate.row_data->>'folder', '')))
      or existing_message.provider_id
        is distinct from coalesce(candidate.row_data->>'provider_id', '')
  ) then
    raise exception using errcode = '23505',
      message = 'Bestaande mailboxidentiteit mag niet van account of provider wisselen';
  end if;

  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, provider_id, message_id,
    in_reply_to, references_text, sender_name, sender_email, recipients_text,
    subject, preview, body_text, body_truncated, has_body, date, internal_date,
    unread, starred, payload, updated_at
  )
  select
    incoming.message_key, incoming.account_email, incoming.folder, incoming.uid,
    incoming.provider_id, incoming.message_id, incoming.in_reply_to,
    incoming.references_text, incoming.sender_name, incoming.sender_email,
    incoming.recipients_text, incoming.subject, incoming.preview, incoming.body_text,
    incoming.body_truncated, incoming.has_body, incoming.date, incoming.internal_date,
    incoming.unread, incoming.starred, incoming.payload, incoming.updated_at
  from jsonb_to_recordset(p_rows) as incoming(
    message_key text, account_email text, folder text, uid bigint, provider_id text,
    message_id text, in_reply_to text, references_text text, sender_name text,
    sender_email text, recipients_text text, subject text, preview text, body_text text,
    body_truncated boolean, has_body boolean, date timestamptz,
    internal_date timestamptz, unread boolean, starred boolean, payload jsonb,
    updated_at timestamptz
  )
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    folder = excluded.folder,
    uid = excluded.uid,
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
    result = coalesce(p_result, '{}'::jsonb)
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

revoke all privileges on table public.softora_mailbox_messages
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.softora_mailbox_messages
  to service_role;
revoke all on function public.softora_lock_mailbox_campaign_consistency_before_write()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_lock_mailbox_campaign_consistency_before_write()
  to service_role;
revoke all on function public.softora_enforce_mailbox_message_identity_immutable()
  from public, anon, authenticated, service_role;
grant execute on function public.softora_enforce_mailbox_message_identity_immutable()
  to service_role;
revoke all on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_commit_mailbox_campaign_messages(uuid, text, jsonb, jsonb)
  to service_role;
-- mailbox-campaign-atomic-commit:end
