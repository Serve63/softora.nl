-- Keep broad full-history mailbox searches below the API statement deadline.
-- The previous expression index found candidate rows quickly, but PostgreSQL
-- still rebuilt the combined search document for every heap recheck and moved
-- complete bodies through the message/thread dedupe windows.

alter table public.softora_mailbox_messages
  add column if not exists search_document text generated always as (
    public.softora_mailbox_search_document(
      sender_name,
      sender_email,
      recipients_text,
      subject,
      preview,
      body_text,
      payload
    )
  ) stored;

create index if not exists softora_mailbox_messages_search_document_idx
on public.softora_mailbox_messages
using gin (search_document extensions.gin_trgm_ops)
where deleted_at is null and generation_superseded_at is null;

drop index if exists public.softora_mailbox_messages_full_history_search_idx;

create or replace function public.softora_search_mailbox_messages(
  p_account_emails text[],
  p_query text,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  message_key text,
  account_email text,
  folder text,
  uid bigint,
  provider_id text,
  message_id text,
  in_reply_to text,
  references_text text,
  sender_name text,
  sender_email text,
  recipients_text text,
  subject text,
  preview text,
  date timestamptz,
  internal_date timestamptz,
  unread boolean,
  softora_read_at timestamptz,
  state_revision bigint,
  state_mutation_key text,
  state_mutation_at timestamptz,
  starred boolean,
  reply_dismissed_at timestamptz,
  has_body boolean,
  body_truncated boolean,
  payload jsonb,
  technical_thread_key text,
  external_contact_email text,
  match_field text,
  match_snippet text,
  match_message_key text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select
      public.softora_mailbox_search_normalize(p_query) as query,
      ('%' || pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(public.softora_mailbox_search_normalize(p_query), E'\\', E'\\\\'),
          '%', E'\\%'
        ),
        '_', E'\\_'
      ) || '%') as query_pattern,
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), matched_keys as materialized (
    select
      m.message_key,
      m.date,
      coalesce(
        nullif(pg_catalog.lower(pg_catalog.btrim(m.message_id)), ''),
        nullif(pg_catalog.lower(pg_catalog.btrim(m.provider_id)), ''),
        pg_catalog.md5(pg_catalog.concat_ws('|',
          pg_catalog.lower(m.account_email),
          pg_catalog.lower(m.sender_email),
          pg_catalog.lower(m.recipients_text),
          pg_catalog.lower(m.subject),
          m.date::text
        ))
      ) as duplicate_key,
      public.softora_mailbox_technical_thread_key(
        m.account_email,
        m.provider_id,
        m.message_id,
        m.in_reply_to,
        m.references_text,
        m.payload
      ) as thread_key
    from public.softora_mailbox_messages m
    cross join params p
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.lower(m.account_email) = any(p_account_emails)
      and pg_catalog.length(p.query) >= 2
      and m.search_document like p.query_pattern escape E'\\'
  ), unique_messages as materialized (
    select distinct on (matched_keys.duplicate_key)
      matched_keys.message_key,
      matched_keys.date,
      matched_keys.thread_key
    from matched_keys
    order by matched_keys.duplicate_key, matched_keys.date desc, matched_keys.message_key desc
  ), thread_matches as materialized (
    select distinct on (unique_messages.thread_key)
      unique_messages.message_key,
      unique_messages.date,
      unique_messages.thread_key
    from unique_messages
    order by unique_messages.thread_key, unique_messages.date desc, unique_messages.message_key desc
  ), paged as (
    select thread_matches.*, pg_catalog.count(*) over () as result_count
    from thread_matches
    order by thread_matches.date desc, thread_matches.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  ), hydrated as (
    select
      m.*,
      paged.thread_key,
      paged.result_count,
      public.softora_mailbox_message_participants(m.sender_email, m.recipients_text, m.payload) as participant_emails,
      public.softora_mailbox_search_normalize(m.sender_name) as sender_name_search,
      public.softora_mailbox_search_normalize(m.sender_email) as sender_email_search,
      public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc', m.payload->>'bcc', m.payload->>'replyTo'
      )) as recipients_search,
      public.softora_mailbox_search_normalize(m.subject) as subject_search,
      public.softora_mailbox_search_normalize(m.preview) as preview_search,
      public.softora_mailbox_search_normalize(m.body_text) as body_search
    from paged
    join public.softora_mailbox_messages m on m.message_key = paged.message_key
  ), resolved as (
    select
      hydrated.*,
      case
        when hydrated.sender_name_search like p.query_pattern escape E'\\' then 'afzender'
        when hydrated.sender_email_search like p.query_pattern escape E'\\' then 'afzender'
        when hydrated.recipients_search like p.query_pattern escape E'\\' then 'ontvanger'
        when hydrated.subject_search like p.query_pattern escape E'\\' then 'onderwerp'
        when hydrated.preview_search like p.query_pattern escape E'\\' then 'inhoud'
        else 'inhoud'
      end as resolved_match_field,
      case
        when hydrated.sender_name_search like p.query_pattern escape E'\\'
          or hydrated.sender_email_search like p.query_pattern escape E'\\'
          then pg_catalog.left(pg_catalog.concat_ws(' · ', hydrated.sender_name, hydrated.sender_email), 240)
        when hydrated.recipients_search like p.query_pattern escape E'\\'
          then pg_catalog.left(pg_catalog.concat_ws(' ', hydrated.recipients_text, hydrated.payload->>'toDisplay', hydrated.payload->>'cc'), 240)
        when hydrated.subject_search like p.query_pattern escape E'\\'
          then pg_catalog.left(hydrated.subject, 240)
        when hydrated.preview_search like p.query_pattern escape E'\\'
          then pg_catalog.left(hydrated.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(hydrated.body_text, ''), '\\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(hydrated.body_search, p.query) - 70),
          240
        )
      end as resolved_match_snippet,
      case
        when pg_catalog.lower(hydrated.sender_email) <> all(p_account_emails)
          and pg_catalog.lower(hydrated.sender_email) = any(hydrated.participant_emails)
          then pg_catalog.lower(hydrated.sender_email)
        else (
          select participant
          from pg_catalog.unnest(hydrated.participant_emails) as participants(participant)
          where participant <> all(p_account_emails)
          order by participant
          limit 1
        )
      end as resolved_external_contact
    from hydrated
    cross join params p
  )
  select
    resolved.message_key,
    resolved.account_email,
    resolved.folder,
    resolved.uid,
    resolved.provider_id,
    resolved.message_id,
    resolved.in_reply_to,
    resolved.references_text,
    resolved.sender_name,
    resolved.sender_email,
    resolved.recipients_text,
    resolved.subject,
    resolved.preview,
    resolved.date,
    resolved.internal_date,
    resolved.unread,
    resolved.softora_read_at,
    resolved.state_revision,
    resolved.state_mutation_key,
    resolved.state_mutation_at,
    resolved.starred,
    resolved.reply_dismissed_at,
    resolved.has_body,
    resolved.body_truncated,
    resolved.payload,
    resolved.thread_key,
    resolved.resolved_external_contact,
    resolved.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(coalesce(resolved.resolved_match_snippet, ''), '\\s+', ' ', 'g'), 240),
    resolved.message_key,
    resolved.result_count
  from resolved
  order by resolved.date desc, resolved.message_key desc;
$function$;

revoke all on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  to service_role;
