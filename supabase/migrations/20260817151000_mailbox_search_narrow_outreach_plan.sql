-- Do not materialize thousands of complete message bodies while ranking a
-- broad outreach query. Page narrow keys first and hydrate only the result set.

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
      pg_catalog.btrim(pg_catalog.regexp_replace(
        public.softora_mailbox_search_normalize(p_query),
        '[^a-z0-9]+',
        ' ',
        'g'
      )) as query_lexemes,
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), eligible_contacts as materialized (
    select contact_email
    from public.softora_mailbox_outreach_contacts(p_account_emails)
  ), candidates as materialized (
    select
      m.message_key,
      m.date,
      public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ) as participant_emails,
      public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key,
      coalesce(
        nullif(pg_catalog.lower(pg_catalog.btrim(m.message_id)), ''),
        nullif(pg_catalog.lower(pg_catalog.btrim(m.provider_id)), ''),
        pg_catalog.md5(pg_catalog.concat_ws('|',
          pg_catalog.lower(m.account_email), pg_catalog.lower(m.sender_email),
          pg_catalog.lower(m.recipients_text), pg_catalog.lower(m.subject), m.date::text
        ))
      ) as duplicate_key,
      case
        when public.softora_mailbox_search_word_prefix(m.sender_email, p.query) then 600
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
          m.payload->>'bcc', m.payload->>'replyTo'
        ), p.query) then 550
        when public.softora_mailbox_search_word_prefix(m.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(m.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(m.preview, p.query) then 200
        else 100
      end as match_rank,
      case
        when public.softora_mailbox_search_word_prefix(m.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(m.sender_name, p.query) then 'afzender'
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc'
        ), p.query) then 'ontvanger'
        when public.softora_mailbox_search_word_prefix(m.subject, p.query) then 'onderwerp'
        else 'inhoud'
      end as resolved_match_field,
      case
        when public.softora_mailbox_search_word_prefix(m.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(m.sender_name, p.query)
          then pg_catalog.left(pg_catalog.concat_ws(' · ', m.sender_name, m.sender_email), 240)
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc'
        ), p.query)
          then pg_catalog.left(pg_catalog.concat_ws(
            ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc'
          ), 240)
        when public.softora_mailbox_search_word_prefix(m.subject, p.query)
          then pg_catalog.left(m.subject, 240)
        when public.softora_mailbox_search_word_prefix(m.preview, p.query)
          then pg_catalog.left(m.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(m.body_text, ''), '\\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(
            public.softora_mailbox_search_normalize(m.body_text), p.query
          ) - 70),
          240
        )
      end as resolved_match_snippet
    from public.softora_mailbox_messages m
    cross join params p
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and m.account_email = any(p_account_emails)
      and pg_catalog.length(p.query_lexemes) >= 2
      and m.search_document ~ (
        '(^|[^a-z0-9])'
        || pg_catalog.replace(p.query_lexemes, ' ', '[^a-z0-9]+')
      )
  ), expanded as materialized (
    select candidates.*, participant.contact_email
    from candidates
    cross join lateral pg_catalog.unnest(candidates.participant_emails)
      as participant(contact_email)
    where participant.contact_email <> all(p_account_emails)
  ), eligible as materialized (
    select distinct on (expanded.message_key) expanded.*
    from expanded
    join eligible_contacts using (contact_email)
    order by expanded.message_key, expanded.contact_email
  ), unique_messages as materialized (
    select distinct on (eligible.duplicate_key) eligible.*
    from eligible
    order by eligible.duplicate_key, eligible.match_rank desc,
      eligible.date desc, eligible.message_key desc
  ), thread_matches as materialized (
    select distinct on (unique_messages.thread_key) unique_messages.*
    from unique_messages
    order by unique_messages.thread_key, unique_messages.match_rank desc,
      unique_messages.date desc, unique_messages.message_key desc
  ), paged as materialized (
    select thread_matches.*, pg_catalog.count(*) over () as result_count
    from thread_matches
    order by thread_matches.match_rank desc, thread_matches.date desc, thread_matches.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  ), hydrated as (
    select m.*, paged.thread_key, paged.contact_email, paged.resolved_match_field,
      paged.resolved_match_snippet, paged.result_count, paged.match_rank
    from paged
    join public.softora_mailbox_messages m on m.message_key = paged.message_key
  )
  select
    hydrated.message_key, hydrated.account_email, hydrated.folder, hydrated.uid,
    hydrated.provider_id, hydrated.message_id, hydrated.in_reply_to, hydrated.references_text,
    hydrated.sender_name, hydrated.sender_email, hydrated.recipients_text, hydrated.subject,
    hydrated.preview, hydrated.date, hydrated.internal_date, hydrated.unread,
    hydrated.softora_read_at, hydrated.state_revision, hydrated.state_mutation_key,
    hydrated.state_mutation_at, hydrated.starred, hydrated.reply_dismissed_at,
    hydrated.has_body, hydrated.body_truncated, hydrated.payload, hydrated.thread_key,
    hydrated.contact_email, hydrated.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(
      coalesce(hydrated.resolved_match_snippet, ''), '\\s+', ' ', 'g'
    ), 240),
    hydrated.message_key, hydrated.result_count
  from hydrated
  order by hydrated.match_rank desc, hydrated.date desc, hydrated.message_key desc;
$function$;

revoke all on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  to service_role;
