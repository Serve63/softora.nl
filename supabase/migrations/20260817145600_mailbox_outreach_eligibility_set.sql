-- Build the authorized outreach population once per request. Broad searches
-- must not call the evidence predicate separately for thousands of rows.

create or replace function public.softora_mailbox_outreach_contacts(
  p_account_emails text[]
)
returns table (contact_email text)
language sql
stable
security invoker
set search_path = ''
as $function$
  with accounts as (
    select array(
      select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as source(account_email)
      where nullif(pg_catalog.btrim(account_email), '') is not null
    ) as values
  )
  select guard.key_value as contact_email
  from public.softora_outbound_recipient_guards guard
  cross join accounts
  where guard.key_type = 'email'
    and guard.permanent = true
    and guard.channel = any(array['coldmail', 'instantly']::text[])
    and guard.provider = any(array['softora', 'instantly']::text[])
    and guard.sender_email = any(accounts.values)
    and guard.key_value <> all(accounts.values)
  union
  select provenance.recipient_email
  from public.softora_mailbox_send_provenance provenance
  cross join accounts
  where provenance.account_email = any(accounts.values)
    and provenance.status = 'accepted'
    and provenance.provider = any(array['smtp', 'imap', 'instantly']::text[])
    and provenance.recipient_email <> all(accounts.values)
  union
  select participant.contact_email
  from public.softora_mailbox_messages proof
  cross join accounts
  cross join lateral pg_catalog.unnest(public.softora_mailbox_message_participants(
    proof.sender_email,
    proof.recipients_text,
    proof.payload
  )) as participant(contact_email)
  where proof.deleted_at is null
    and proof.generation_superseded_at is null
    and proof.account_email = any(accounts.values)
    and participant.contact_email <> all(accounts.values)
    and (
      proof.folder = 'coldmail'
      or (
        proof.folder = 'instantly'
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerAccountEmail'))
          = pg_catalog.lower(pg_catalog.btrim(proof.account_email))
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerOwner'))
          = any(array['serve', 'martijn']::text[])
      )
      or (
        proof.folder = 'sent'
        and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'originalCampaignOutbound')) = 'true'
      )
      or pg_catalog.regexp_replace(
        public.softora_mailbox_search_normalize(proof.subject),
        '^((re|fw|fwd)[[:space:]]*:[[:space:]]*)+',
        ''
      ) = any(array['kleine vraag over jullie website', 'nieuw webdesign']::text[])
    );
$function$;

create or replace function public.softora_mailbox_is_outreach_contact(
  p_account_emails text[],
  p_contact_email text
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.softora_mailbox_outreach_contacts(p_account_emails) eligible
    where eligible.contact_email = pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, '')))
  );
$function$;

create or replace function public.softora_filter_mailbox_outreach_contacts(
  p_account_emails text[],
  p_contact_emails text[]
)
returns table (contact_email text)
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested as materialized (
    select distinct pg_catalog.lower(pg_catalog.btrim(raw_contact)) as contact_email
    from pg_catalog.unnest(coalesce(p_contact_emails, array[]::text[])) as contacts(raw_contact)
    where nullif(pg_catalog.btrim(raw_contact), '') is not null
    limit 500
  )
  select requested.contact_email
  from requested
  join public.softora_mailbox_outreach_contacts(p_account_emails) eligible using (contact_email)
  order by requested.contact_email;
$function$;

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
      m.*,
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
      ) as duplicate_key
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
    select distinct on (expanded.message_key)
      expanded.*,
      case
        when public.softora_mailbox_search_word_prefix(expanded.sender_email, p.query) then 600
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', expanded.recipients_text, expanded.payload->>'toDisplay',
          expanded.payload->>'cc', expanded.payload->>'bcc', expanded.payload->>'replyTo'
        ), p.query) then 550
        when public.softora_mailbox_search_word_prefix(expanded.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(expanded.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(expanded.preview, p.query) then 200
        else 100
      end as match_rank
    from expanded
    join eligible_contacts using (contact_email)
    cross join params p
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
  ), resolved as (
    select
      paged.*,
      case
        when public.softora_mailbox_search_word_prefix(paged.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(paged.sender_name, p.query) then 'afzender'
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', paged.recipients_text, paged.payload->>'toDisplay', paged.payload->>'cc'
        ), p.query) then 'ontvanger'
        when public.softora_mailbox_search_word_prefix(paged.subject, p.query) then 'onderwerp'
        else 'inhoud'
      end as resolved_match_field,
      case
        when public.softora_mailbox_search_word_prefix(paged.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(paged.sender_name, p.query)
          then pg_catalog.left(pg_catalog.concat_ws(' · ', paged.sender_name, paged.sender_email), 240)
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', paged.recipients_text, paged.payload->>'toDisplay', paged.payload->>'cc'
        ), p.query)
          then pg_catalog.left(pg_catalog.concat_ws(
            ' ', paged.recipients_text, paged.payload->>'toDisplay', paged.payload->>'cc'
          ), 240)
        when public.softora_mailbox_search_word_prefix(paged.subject, p.query)
          then pg_catalog.left(paged.subject, 240)
        when public.softora_mailbox_search_word_prefix(paged.preview, p.query)
          then pg_catalog.left(paged.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(paged.body_text, ''), '\\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(
            public.softora_mailbox_search_normalize(paged.body_text), p.query
          ) - 70),
          240
        )
      end as resolved_match_snippet
    from paged
    cross join params p
  )
  select
    resolved.message_key, resolved.account_email, resolved.folder, resolved.uid,
    resolved.provider_id, resolved.message_id, resolved.in_reply_to, resolved.references_text,
    resolved.sender_name, resolved.sender_email, resolved.recipients_text, resolved.subject,
    resolved.preview, resolved.date, resolved.internal_date, resolved.unread,
    resolved.softora_read_at, resolved.state_revision, resolved.state_mutation_key,
    resolved.state_mutation_at, resolved.starred, resolved.reply_dismissed_at,
    resolved.has_body, resolved.body_truncated, resolved.payload, resolved.thread_key,
    resolved.contact_email, resolved.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(
      coalesce(resolved.resolved_match_snippet, ''), '\\s+', ' ', 'g'
    ), 240),
    resolved.message_key, resolved.result_count
  from resolved
  order by resolved.match_rank desc, resolved.date desc, resolved.message_key desc;
$function$;

revoke all on function public.softora_mailbox_outreach_contacts(text[])
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_is_outreach_contact(text[], text)
  from public, anon, authenticated;
revoke all on function public.softora_filter_mailbox_outreach_contacts(text[], text[])
  from public, anon, authenticated;
revoke all on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.softora_mailbox_outreach_contacts(text[]) to service_role;
grant execute on function public.softora_mailbox_is_outreach_contact(text[], text) to service_role;
grant execute on function public.softora_filter_mailbox_outreach_contacts(text[], text[]) to service_role;
grant execute on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  to service_role;
