-- Full-history mailbox discovery remains service-role only. The browser never
-- receives direct table or RPC access; server-side owner scope is mandatory.

create or replace function public.softora_mailbox_search_normalize(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          normalize(coalesce(p_value, ''), NFD),
          U&'[\0300-\036f]',
          '',
          'g'
        )
      ),
      '\s+',
      ' ',
      'g'
    )
  );
$function$;

create or replace function public.softora_mailbox_participant_emails(p_value text)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.array_agg(distinct pg_catalog.lower(matches[1])),
    array[]::text[]
  )
  from pg_catalog.regexp_matches(
    pg_catalog.lower(coalesce(p_value, '')),
    '([a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9.-]+[.][a-z]{2,})',
    'g'
  ) as matches;
$function$;

create or replace function public.softora_mailbox_search_document(
  p_sender_name text,
  p_sender_email text,
  p_recipients_text text,
  p_subject text,
  p_preview text,
  p_body_text text,
  p_payload jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
    ' ',
    p_sender_name,
    p_sender_email,
    p_recipients_text,
    p_subject,
    p_preview,
    p_body_text,
    p_payload->>'toDisplay',
    p_payload->>'cc',
    p_payload->>'bcc',
    p_payload->>'replyTo',
    p_payload->>'deliveredTo',
    p_payload->>'providerAccountEmail'
  ));
$function$;

create or replace function public.softora_mailbox_message_participants(
  p_sender_email text,
  p_recipients_text text,
  p_payload jsonb
)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select coalesce(
    pg_catalog.array_agg(distinct email),
    array[]::text[]
  )
  from pg_catalog.unnest(public.softora_mailbox_participant_emails(pg_catalog.concat_ws(
    ' ',
    p_sender_email,
    p_recipients_text,
    p_payload->>'toDisplay',
    p_payload->>'cc',
    p_payload->>'bcc',
    p_payload->>'replyTo',
    p_payload->>'deliveredTo'
  ))) as participants(email);
$function$;

create or replace function public.softora_mailbox_technical_thread_key(
  p_account_email text,
  p_provider_id text,
  p_message_id text,
  p_in_reply_to text,
  p_references_text text,
  p_payload jsonb
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select case
    when pg_catalog.lower(coalesce(p_payload->>'provider', p_payload->>'source', 'imap')) = 'instantly'
      and nullif(pg_catalog.btrim(p_payload->>'providerThreadId'), '') is not null
      then pg_catalog.concat(
        'instantly:',
        pg_catalog.lower(coalesce(p_account_email, '')),
        ':',
        pg_catalog.lower(pg_catalog.btrim(p_payload->>'providerThreadId'))
      )
    else pg_catalog.concat(
      'imap:',
      pg_catalog.lower(coalesce(p_account_email, '')),
      ':',
      pg_catalog.lower(coalesce(
        pg_catalog.substring(coalesce(p_references_text, ''), '(<[^>]+>)'),
        nullif(pg_catalog.btrim(p_in_reply_to), ''),
        nullif(pg_catalog.btrim(p_message_id), ''),
        nullif(pg_catalog.btrim(p_provider_id), ''),
        'unknown'
      ))
    )
  end;
$function$;

create index if not exists softora_mailbox_messages_full_history_search_idx
on public.softora_mailbox_messages
using gin ((public.softora_mailbox_search_document(
  sender_name,
  sender_email,
  recipients_text,
  subject,
  preview,
  body_text,
  payload
)) extensions.gin_trgm_ops)
where deleted_at is null and generation_superseded_at is null;

create index if not exists softora_mailbox_messages_scope_date_active_idx
on public.softora_mailbox_messages (account_email, date desc, message_key)
where deleted_at is null and generation_superseded_at is null;

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
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), candidates as (
    select
      m.*,
      public.softora_mailbox_technical_thread_key(
        m.account_email,
        m.provider_id,
        m.message_id,
        m.in_reply_to,
        m.references_text,
        m.payload
      ) as thread_key,
      public.softora_mailbox_message_participants(m.sender_email, m.recipients_text, m.payload) as participant_emails,
      public.softora_mailbox_search_normalize(m.sender_name) as sender_name_search,
      public.softora_mailbox_search_normalize(m.sender_email) as sender_email_search,
      public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc', m.payload->>'bcc', m.payload->>'replyTo'
      )) as recipients_search,
      public.softora_mailbox_search_normalize(m.subject) as subject_search,
      public.softora_mailbox_search_normalize(m.preview) as preview_search,
      public.softora_mailbox_search_normalize(m.body_text) as body_search
    from public.softora_mailbox_messages m
    cross join params p
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.lower(m.account_email) = any(p_account_emails)
      and pg_catalog.length(p.query) >= 2
      and public.softora_mailbox_search_document(
        m.sender_name, m.sender_email, m.recipients_text, m.subject, m.preview, m.body_text, m.payload
      ) like ('%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(p.query, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%') escape E'\\'
  ), deduped as (
    select candidate.*
    from (
      select
        candidates.*,
        pg_catalog.row_number() over (
          partition by coalesce(
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.message_id)), ''),
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.provider_id)), ''),
            pg_catalog.md5(pg_catalog.concat_ws('|',
              pg_catalog.lower(candidates.account_email),
              pg_catalog.lower(candidates.sender_email),
              pg_catalog.lower(candidates.recipients_text),
              pg_catalog.lower(candidates.subject),
              candidates.date::text
            ))
          )
          order by candidates.date desc, candidates.message_key desc
        ) as duplicate_rank
      from candidates
    ) candidate
    where candidate.duplicate_rank = 1
  ), threaded as (
    select
      deduped.*,
      pg_catalog.row_number() over (
        partition by deduped.thread_key
        order by deduped.date desc, deduped.message_key desc
      ) as thread_rank
    from deduped
  ), representatives as (
    select
      threaded.*,
      case
        when threaded.sender_name_search like ('%' || p.query || '%') then 'afzender'
        when threaded.sender_email_search like ('%' || p.query || '%') then 'afzender'
        when threaded.recipients_search like ('%' || p.query || '%') then 'ontvanger'
        when threaded.subject_search like ('%' || p.query || '%') then 'onderwerp'
        when threaded.preview_search like ('%' || p.query || '%') then 'inhoud'
        else 'inhoud'
      end as resolved_match_field,
      case
        when threaded.sender_name_search like ('%' || p.query || '%')
          or threaded.sender_email_search like ('%' || p.query || '%')
          then pg_catalog.left(pg_catalog.concat_ws(' · ', threaded.sender_name, threaded.sender_email), 240)
        when threaded.recipients_search like ('%' || p.query || '%')
          then pg_catalog.left(pg_catalog.concat_ws(' ', threaded.recipients_text, threaded.payload->>'toDisplay', threaded.payload->>'cc'), 240)
        when threaded.subject_search like ('%' || p.query || '%')
          then pg_catalog.left(threaded.subject, 240)
        when threaded.preview_search like ('%' || p.query || '%')
          then pg_catalog.left(threaded.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(threaded.body_text, ''), '\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(threaded.body_search, p.query) - 70),
          240
        )
      end as resolved_match_snippet,
      case
        when pg_catalog.lower(threaded.sender_email) <> all(p_account_emails)
          and pg_catalog.lower(threaded.sender_email) = any(threaded.participant_emails)
          then pg_catalog.lower(threaded.sender_email)
        else (
          select participant
          from pg_catalog.unnest(threaded.participant_emails) as participants(participant)
          where participant <> all(p_account_emails)
          order by participant
          limit 1
        )
      end as resolved_external_contact
    from threaded
    cross join params p
    where threaded.thread_rank = 1
  ), paged as (
    select representatives.*, pg_catalog.count(*) over () as result_count
    from representatives
    order by representatives.date desc, representatives.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  )
  select
    paged.message_key,
    paged.account_email,
    paged.folder,
    paged.uid,
    paged.provider_id,
    paged.message_id,
    paged.in_reply_to,
    paged.references_text,
    paged.sender_name,
    paged.sender_email,
    paged.recipients_text,
    paged.subject,
    paged.preview,
    paged.date,
    paged.internal_date,
    paged.unread,
    paged.softora_read_at,
    paged.state_revision,
    paged.state_mutation_key,
    paged.state_mutation_at,
    paged.starred,
    paged.reply_dismissed_at,
    paged.has_body,
    paged.body_truncated,
    paged.payload,
    paged.thread_key,
    paged.resolved_external_contact,
    paged.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(coalesce(paged.resolved_match_snippet, ''), '\s+', ' ', 'g'), 240),
    paged.message_key,
    paged.result_count
  from paged
  order by paged.date desc, paged.message_key desc;
$function$;

create or replace function public.softora_mailbox_contact_timeline(
  p_account_emails text[],
  p_contact_email text,
  p_limit integer default 30,
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
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select
      pg_catalog.lower(pg_catalog.btrim(p_contact_email)) as contact_email,
      greatest(1, least(50, coalesce(p_limit, 30))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), candidates as (
    select
      m.*,
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
      and public.softora_mailbox_search_document(
        m.sender_name, m.sender_email, m.recipients_text, m.subject, m.preview, m.body_text, m.payload
      ) like ('%' || p.contact_email || '%')
      and (
        pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
        or p.contact_email = any(public.softora_mailbox_message_participants(m.sender_email, m.recipients_text, m.payload))
      )
  ), deduped as (
    select candidate.*
    from (
      select
        candidates.*,
        pg_catalog.row_number() over (
          partition by coalesce(
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.message_id)), ''),
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.provider_id)), ''),
            pg_catalog.md5(pg_catalog.concat_ws('|',
              pg_catalog.lower(candidates.sender_email),
              pg_catalog.lower(candidates.recipients_text),
              pg_catalog.lower(candidates.subject),
              candidates.date::text
            ))
          )
          order by candidates.date desc, candidates.message_key desc
        ) as duplicate_rank
      from candidates
    ) candidate
    where candidate.duplicate_rank = 1
  ), paged as (
    select deduped.*, pg_catalog.count(*) over () as result_count
    from deduped
    order by deduped.date desc, deduped.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  )
  select
    paged.message_key,
    paged.account_email,
    paged.folder,
    paged.uid,
    paged.provider_id,
    paged.message_id,
    paged.in_reply_to,
    paged.references_text,
    paged.sender_name,
    paged.sender_email,
    paged.recipients_text,
    paged.subject,
    paged.preview,
    paged.date,
    paged.internal_date,
    paged.unread,
    paged.softora_read_at,
    paged.state_revision,
    paged.state_mutation_key,
    paged.state_mutation_at,
    paged.starred,
    paged.reply_dismissed_at,
    paged.has_body,
    paged.body_truncated,
    paged.payload,
    paged.thread_key,
    (select contact_email from params),
    paged.result_count
  from paged
  order by paged.date desc, paged.message_key desc;
$function$;

revoke all on function public.softora_mailbox_search_normalize(text) from public, anon, authenticated;
revoke all on function public.softora_mailbox_participant_emails(text) from public, anon, authenticated;
revoke all on function public.softora_mailbox_search_document(text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.softora_mailbox_message_participants(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.softora_mailbox_technical_thread_key(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.softora_search_mailbox_messages(text[], text, integer, integer) from public, anon, authenticated;
revoke all on function public.softora_mailbox_contact_timeline(text[], text, integer, integer) from public, anon, authenticated;

grant execute on function public.softora_mailbox_search_normalize(text) to service_role;
grant execute on function public.softora_mailbox_participant_emails(text) to service_role;
grant execute on function public.softora_mailbox_search_document(text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.softora_mailbox_message_participants(text, text, jsonb) to service_role;
grant execute on function public.softora_mailbox_technical_thread_key(text, text, text, text, text, jsonb) to service_role;
grant execute on function public.softora_search_mailbox_messages(text[], text, integer, integer) to service_role;
grant execute on function public.softora_mailbox_contact_timeline(text[], text, integer, integer) to service_role;
