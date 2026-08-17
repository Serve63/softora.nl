-- Discovery is an outreach view, not a general personal inbox search. Keep one
-- exact-email eligibility predicate for the normal campaign list, search and
-- contact timeline. No mailbox row is rewritten by this migration.

create index if not exists softora_mailbox_send_provenance_recipient_accepted_idx
on public.softora_mailbox_send_provenance (recipient_email, account_email, accepted_at desc)
where status = 'accepted';

create or replace function public.softora_mailbox_search_word_prefix(
  p_value text,
  p_query text
)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $function$
  select (
    ' ' || pg_catalog.btrim(pg_catalog.regexp_replace(
      public.softora_mailbox_search_normalize(p_value),
      '[^a-z0-9]+',
      ' ',
      'g'
    ))
  ) like (
    '% ' || public.softora_mailbox_search_normalize(p_query) || '%'
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
  with params as (
    select
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
        from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as accounts(account_email)
        where nullif(pg_catalog.btrim(account_email), '') is not null
      ) as account_emails,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, ''))) as contact_email
  )
  select coalesce((
    select
      p.contact_email <> ''
      and p.contact_email <> all(p.account_emails)
      and (
        exists (
          select 1
          from public.softora_outbound_recipient_guards as guard
          where guard.key_type = 'email'
            and pg_catalog.lower(pg_catalog.btrim(coalesce(guard.recipient_email, guard.key_value, '')))
              = p.contact_email
            and guard.permanent = true
            and pg_catalog.lower(pg_catalog.btrim(guard.channel))
              = any(array['coldmail', 'instantly']::text[])
            and pg_catalog.lower(pg_catalog.btrim(guard.provider))
              = any(array['softora', 'instantly']::text[])
            and pg_catalog.lower(pg_catalog.btrim(guard.sender_email)) = any(p.account_emails)
        )
        or exists (
          select 1
          from public.softora_mailbox_send_provenance as provenance
          where pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) = p.contact_email
            and pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = any(p.account_emails)
            and provenance.status = 'accepted'
            and pg_catalog.lower(pg_catalog.btrim(provenance.provider))
              = any(array['smtp', 'imap', 'instantly']::text[])
        )
        or exists (
          select 1
          from public.softora_mailbox_messages as proof
          where proof.deleted_at is null
            and proof.generation_superseded_at is null
            and pg_catalog.lower(pg_catalog.btrim(proof.account_email)) = any(p.account_emails)
            and p.contact_email = any(public.softora_mailbox_message_participants(
              proof.sender_email,
              proof.recipients_text,
              proof.payload
            ))
            and (
              pg_catalog.lower(pg_catalog.btrim(proof.folder)) = 'coldmail'
              or (
                pg_catalog.lower(pg_catalog.btrim(proof.folder)) = 'instantly'
                and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerAccountEmail'))
                  = pg_catalog.lower(pg_catalog.btrim(proof.account_email))
                and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'providerOwner'))
                  = any(array['serve', 'martijn']::text[])
              )
              or (
                pg_catalog.lower(pg_catalog.btrim(proof.folder)) = 'sent'
                and pg_catalog.lower(pg_catalog.btrim(proof.payload->>'originalCampaignOutbound')) = 'true'
              )
              or pg_catalog.regexp_replace(
                public.softora_mailbox_search_normalize(proof.subject),
                '^((re|fw|fwd)[[:space:]]*:[[:space:]]*)+',
                ''
              ) = any(array['kleine vraag over jullie website', 'nieuw webdesign']::text[])
            )
        )
      )
    from params p
  ), false);
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
  select candidate.contact_email
  from (
    select distinct pg_catalog.lower(pg_catalog.btrim(raw_contact)) as contact_email
    from pg_catalog.unnest(coalesce(p_contact_emails, array[]::text[])) as contacts(raw_contact)
    where nullif(pg_catalog.btrim(raw_contact), '') is not null
    limit 500
  ) as candidate
  where public.softora_mailbox_is_outreach_contact(p_account_emails, candidate.contact_email)
  order by candidate.contact_email;
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
      ('%' || pg_catalog.replace(
        pg_catalog.replace(
          pg_catalog.replace(public.softora_mailbox_search_normalize(p_query), E'\\', E'\\\\'),
          '%', E'\\%'
        ),
        '_', E'\\_'
      ) || '%') as query_pattern,
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), field_matches as materialized (
    select
      m.*,
      public.softora_mailbox_search_normalize(m.sender_name) as sender_name_search,
      public.softora_mailbox_search_normalize(m.sender_email) as sender_email_search,
      public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
        m.payload->>'bcc', m.payload->>'replyTo'
      )) as recipients_search,
      public.softora_mailbox_search_normalize(m.subject) as subject_search,
      public.softora_mailbox_search_normalize(m.preview) as preview_search,
      public.softora_mailbox_search_normalize(m.body_text) as body_search,
      public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ) as participant_emails
    from public.softora_mailbox_messages m
    cross join params p
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.lower(m.account_email) = any(p_account_emails)
      and pg_catalog.length(p.query) >= 2
      and m.search_document like p.query_pattern escape E'\\'
      and (
        public.softora_mailbox_search_normalize(m.sender_email) like p.query_pattern escape E'\\'
        or public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
          ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
          m.payload->>'bcc', m.payload->>'replyTo'
        )) like p.query_pattern escape E'\\'
        or public.softora_mailbox_search_word_prefix(m.sender_name, p.query)
        or public.softora_mailbox_search_word_prefix(m.subject, p.query)
        or public.softora_mailbox_search_word_prefix(m.preview, p.query)
        or public.softora_mailbox_search_word_prefix(m.body_text, p.query)
      )
  ), matched_keys as materialized (
    select
      field_matches.message_key,
      field_matches.date,
      external_contact.contact_email,
      case
        when field_matches.sender_email_search like p.query_pattern escape E'\\' then 600
        when field_matches.recipients_search like p.query_pattern escape E'\\' then 550
        when public.softora_mailbox_search_word_prefix(field_matches.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(field_matches.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(field_matches.preview, p.query) then 200
        else 100
      end as match_rank,
      coalesce(
        nullif(pg_catalog.lower(pg_catalog.btrim(field_matches.message_id)), ''),
        nullif(pg_catalog.lower(pg_catalog.btrim(field_matches.provider_id)), ''),
        pg_catalog.md5(pg_catalog.concat_ws('|',
          pg_catalog.lower(field_matches.account_email),
          pg_catalog.lower(field_matches.sender_email),
          pg_catalog.lower(field_matches.recipients_text),
          pg_catalog.lower(field_matches.subject),
          field_matches.date::text
        ))
      ) as duplicate_key,
      public.softora_mailbox_technical_thread_key(
        field_matches.account_email,
        field_matches.provider_id,
        field_matches.message_id,
        field_matches.in_reply_to,
        field_matches.references_text,
        field_matches.payload
      ) as thread_key
    from field_matches
    cross join params p
    cross join lateral (
      select participant as contact_email
      from pg_catalog.unnest(field_matches.participant_emails) as participants(participant)
      where participant <> all(p_account_emails)
        and public.softora_mailbox_is_outreach_contact(p_account_emails, participant)
      order by participant
      limit 1
    ) as external_contact
  ), unique_messages as materialized (
    select distinct on (matched_keys.duplicate_key)
      matched_keys.message_key,
      matched_keys.date,
      matched_keys.contact_email,
      matched_keys.match_rank,
      matched_keys.thread_key
    from matched_keys
    order by matched_keys.duplicate_key, matched_keys.match_rank desc,
      matched_keys.date desc, matched_keys.message_key desc
  ), thread_matches as materialized (
    select distinct on (unique_messages.thread_key)
      unique_messages.message_key,
      unique_messages.date,
      unique_messages.contact_email,
      unique_messages.match_rank,
      unique_messages.thread_key
    from unique_messages
    order by unique_messages.thread_key, unique_messages.match_rank desc,
      unique_messages.date desc, unique_messages.message_key desc
  ), paged as (
    select thread_matches.*, pg_catalog.count(*) over () as result_count
    from thread_matches
    order by thread_matches.match_rank desc, thread_matches.date desc, thread_matches.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  ), hydrated as (
    select
      m.*,
      paged.thread_key,
      paged.contact_email,
      paged.match_rank,
      paged.result_count,
      public.softora_mailbox_search_normalize(m.sender_name) as sender_name_search,
      public.softora_mailbox_search_normalize(m.sender_email) as sender_email_search,
      public.softora_mailbox_search_normalize(pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
        m.payload->>'bcc', m.payload->>'replyTo'
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
        when hydrated.sender_email_search like p.query_pattern escape E'\\'
          or public.softora_mailbox_search_word_prefix(hydrated.sender_name, p.query) then 'afzender'
        when hydrated.recipients_search like p.query_pattern escape E'\\' then 'ontvanger'
        when public.softora_mailbox_search_word_prefix(hydrated.subject, p.query) then 'onderwerp'
        else 'inhoud'
      end as resolved_match_field,
      case
        when hydrated.sender_email_search like p.query_pattern escape E'\\'
          or public.softora_mailbox_search_word_prefix(hydrated.sender_name, p.query)
          then pg_catalog.left(pg_catalog.concat_ws(' · ', hydrated.sender_name, hydrated.sender_email), 240)
        when hydrated.recipients_search like p.query_pattern escape E'\\'
          then pg_catalog.left(pg_catalog.concat_ws(
            ' ', hydrated.recipients_text, hydrated.payload->>'toDisplay', hydrated.payload->>'cc'
          ), 240)
        when public.softora_mailbox_search_word_prefix(hydrated.subject, p.query)
          then pg_catalog.left(hydrated.subject, 240)
        when public.softora_mailbox_search_word_prefix(hydrated.preview, p.query)
          then pg_catalog.left(hydrated.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(hydrated.body_text, ''), '\\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(hydrated.body_search, p.query) - 70),
          240
        )
      end as resolved_match_snippet
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
    resolved.contact_email,
    resolved.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(
      coalesce(resolved.resolved_match_snippet, ''), '\\s+', ' ', 'g'
    ), 240),
    resolved.message_key,
    resolved.result_count
  from resolved
  order by resolved.match_rank desc, resolved.date desc, resolved.message_key desc;
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
      public.softora_mailbox_is_outreach_contact(
        p_account_emails,
        pg_catalog.lower(pg_catalog.btrim(p_contact_email))
      ) as eligible,
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
    where p.eligible
      and m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.lower(m.account_email) = any(p_account_emails)
      and m.search_document like ('%' || p.contact_email || '%')
      and (
        pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
        or p.contact_email = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
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

revoke all on function public.softora_mailbox_search_word_prefix(text, text)
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_is_outreach_contact(text[], text)
  from public, anon, authenticated;
revoke all on function public.softora_filter_mailbox_outreach_contacts(text[], text[])
  from public, anon, authenticated;
revoke all on function public.softora_search_mailbox_messages(text[], text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_contact_timeline(text[], text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.softora_mailbox_search_word_prefix(text, text) to service_role;
grant execute on function public.softora_mailbox_is_outreach_contact(text[], text) to service_role;
grant execute on function public.softora_filter_mailbox_outreach_contacts(text[], text[]) to service_role;
grant execute on function public.softora_search_mailbox_messages(text[], text, integer, integer) to service_role;
grant execute on function public.softora_mailbox_contact_timeline(text[], text, integer, integer) to service_role;
