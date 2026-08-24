-- Discovery is a coldmail dossier search, not a general search across every
-- message ever exchanged with an outreach contact. Every physical match uses
-- the same per-message proof predicate as contact timeline visibility. Accepted
-- send provenance is searchable immediately and loses to a real IMAP copy with
-- the same normalized Message-ID.

create or replace function public.softora_search_mailbox_contact_dossiers(
  p_owner_accounts jsonb,
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
  canonical_owner text,
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
        '[^a-z0-9]+', ' ', 'g'
      )) as query_lexemes,
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), owner_account_values as materialized (
    select
      pg_catalog.lower(pg_catalog.btrim(owner_entry.key)) as canonical_owner,
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_value))
        from pg_catalog.jsonb_array_elements_text(
          case when pg_catalog.jsonb_typeof(owner_entry.value) = 'array'
            then owner_entry.value else '[]'::jsonb end
        ) as account(account_value)
        where nullif(pg_catalog.btrim(account_value), '') is not null
      ) as account_emails
    from pg_catalog.jsonb_each(
      case when pg_catalog.jsonb_typeof(coalesce(p_owner_accounts, '{}'::jsonb)) = 'object'
        then coalesce(p_owner_accounts, '{}'::jsonb) else '{}'::jsonb end
    ) as owner_entry
    where pg_catalog.lower(pg_catalog.btrim(owner_entry.key))
      = any(array['serve', 'martijn']::text[])
  ), owner_accounts as materialized (
    select canonical_owner, account_emails
    from owner_account_values
    where pg_catalog.cardinality(account_emails) > 0
  ), eligible_contacts as materialized (
    select owners.canonical_owner, eligible.contact_email
    from owner_accounts owners
    cross join lateral public.softora_mailbox_outreach_contacts(owners.account_emails)
      as eligible(contact_email)
  ), physical_candidates as materialized (
    select
      m.message_key, m.account_email, m.folder, m.uid, m.provider_id,
      m.message_id, m.in_reply_to, m.references_text, m.sender_name,
      m.sender_email, m.recipients_text, m.subject, m.preview, m.body_text,
      m.date, m.internal_date, m.unread, m.softora_read_at, m.state_revision,
      m.state_mutation_key, m.state_mutation_at, m.starred,
      m.reply_dismissed_at, m.has_body, m.body_truncated, m.payload,
      owners.canonical_owner,
      public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key,
      participant.contact_email,
      pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
        m.payload->>'bcc', m.payload->>'replyTo'
      ) as recipient_names,
      coalesce(
        public.softora_normalize_mailbox_message_id(m.message_id),
        'physical:' || m.message_key
      ) as logical_message_key,
      0 as source_rank,
      case
        when public.softora_mailbox_search_word_prefix(m.sender_email, p.query) then 600
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
          m.payload->>'bcc'
        ), p.query) then 550
        when public.softora_mailbox_search_word_prefix(m.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(m.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(m.preview, p.query) then 200
        else 100
      end as match_rank
    from public.softora_mailbox_messages m
    join owner_accounts owners
      on pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(owners.account_emails)
    cross join params p
    cross join lateral pg_catalog.unnest(public.softora_mailbox_message_participants(
      m.sender_email, m.recipients_text, m.payload
    )) as participant(contact_email)
    join eligible_contacts eligible
      on eligible.canonical_owner = owners.canonical_owner
      and eligible.contact_email = participant.contact_email
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.length(p.query_lexemes) >= 2
      and m.search_document ~ (
        '(^|[^a-z0-9])'
        || pg_catalog.replace(p.query_lexemes, ' ', '[^a-z0-9]+')
      )
      and participant.contact_email <> all(owners.account_emails)
      and public.softora_mailbox_message_has_campaign_proof(
        m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
        m.references_text, m.sender_name, m.sender_email, m.recipients_text,
        m.subject, m.payload, participant.contact_email, owners.canonical_owner
      )
  ), provenance_candidates as materialized (
    select
      'accepted-send|' || provenance.intent_id as message_key,
      pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) as account_email,
      'sent'::text as folder,
      0::bigint as uid,
      'accepted-sent:' || provenance.intent_id as provider_id,
      provenance.sent_message_id as message_id,
      coalesce(provenance.reply_target_message_id, '') as in_reply_to,
      coalesce(provenance.references_text, '') as references_text,
      coalesce(nullif(provenance.sender_name, ''), provenance.account_email) as sender_name,
      pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) as sender_email,
      pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) as recipients_text,
      provenance.subject,
      pg_catalog.left(pg_catalog.regexp_replace(
        coalesce(provenance.body_text, ''), '\s+', ' ', 'g'
      ), 500) as preview,
      provenance.body_text,
      provenance.accepted_at as date,
      provenance.accepted_at as internal_date,
      false as unread,
      null::timestamptz as softora_read_at,
      0::bigint as state_revision,
      ''::text as state_mutation_key,
      null::timestamptz as state_mutation_at,
      false as starred,
      null::timestamptz as reply_dismissed_at,
      coalesce(provenance.body_text, '') <> '' as has_body,
      false as body_truncated,
      timeline_payload.value as payload,
      owners.canonical_owner,
      public.softora_mailbox_technical_thread_key(
        provenance.account_email, 'accepted-sent:' || provenance.intent_id,
        provenance.sent_message_id, provenance.reply_target_message_id,
        provenance.references_text, timeline_payload.value
      ) as thread_key,
      pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) as contact_email,
      pg_catalog.concat_ws(
        ' ', provenance.recipient_email, provenance.cc_text, provenance.bcc_text
      ) as recipient_names,
      public.softora_normalize_mailbox_message_id(
        provenance.sent_message_id
      ) as logical_message_key,
      1 as source_rank,
      case
        when public.softora_mailbox_search_word_prefix(provenance.account_email, p.query) then 600
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', provenance.recipient_email, provenance.cc_text, provenance.bcc_text
        ), p.query) then 550
        when public.softora_mailbox_search_word_prefix(provenance.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(provenance.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(provenance.body_text, p.query) then 200
        else 100
      end as match_rank
    from public.softora_mailbox_send_provenance provenance
    join owner_accounts owners
      on pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = any(owners.account_emails)
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner)) = owners.canonical_owner
    join eligible_contacts eligible
      on eligible.canonical_owner = owners.canonical_owner
      and eligible.contact_email = pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email))
    cross join params p
    cross join lateral (
      select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'source', 'send-provenance', 'direction', 'sent',
        'provider', provenance.provider,
        'providerMessageId', provenance.provider_message_id,
        'providerThreadId', provenance.provider_thread_id,
        'providerAccountEmail', provenance.account_email,
        'providerOwner', provenance.owner,
        'originalCampaignOutbound', provenance.mode = 'new-message',
        'embeddedImageCount', 0, 'recipientRoutingEvidenceKnown', true,
        'toDisplay', provenance.recipient_email, 'cc', provenance.cc_text,
        'bcc', provenance.bcc_text,
        'softoraConversationId', provenance.conversation_id,
        'softoraSendIntentId', provenance.intent_id,
        'softoraSendMode', provenance.mode,
        'softoraReplyTargetMessageId', provenance.reply_target_message_id,
        'softoraThreadProvenanceKnown', true,
        'timelineBodyText', provenance.body_text,
        'timelineSource', 'send-provenance'
      )) as value
    ) timeline_payload
    where provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and public.softora_normalize_mailbox_message_id(
        provenance.sent_message_id
      ) is not null
      and pg_catalog.length(p.query_lexemes) >= 2
      and public.softora_mailbox_search_document(
        provenance.sender_name, provenance.account_email,
        pg_catalog.concat_ws(' ', provenance.recipient_email, provenance.cc_text, provenance.bcc_text),
        provenance.subject,
        pg_catalog.left(pg_catalog.regexp_replace(coalesce(provenance.body_text, ''), '\s+', ' ', 'g'), 500),
        provenance.body_text, timeline_payload.value
      ) ~ (
        '(^|[^a-z0-9])'
        || pg_catalog.replace(p.query_lexemes, ' ', '[^a-z0-9]+')
      )
      and not exists (
        select 1
        from public.softora_mailbox_message_tombstones tombstone
        where tombstone.account_email = pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
          and tombstone.normalized_message_id =
            public.softora_normalize_mailbox_message_id(provenance.sent_message_id)
      )
  ), candidate_matches as materialized (
    select * from physical_candidates
    union all
    select * from provenance_candidates
  ), deduped as materialized (
    select ranked.*
    from (
      select
        candidate_matches.*,
        pg_catalog.row_number() over (
          partition by candidate_matches.canonical_owner,
            candidate_matches.contact_email, candidate_matches.logical_message_key
          order by candidate_matches.source_rank,
            candidate_matches.date desc, candidate_matches.message_key desc
        ) as duplicate_rank
      from candidate_matches
    ) ranked
    where ranked.duplicate_rank = 1
  ), contact_matches as materialized (
    select distinct on (deduped.canonical_owner, deduped.contact_email) deduped.*
    from deduped
    order by deduped.canonical_owner, deduped.contact_email,
      deduped.match_rank desc, deduped.date desc, deduped.message_key desc
  ), paged as materialized (
    select contact_matches.*, pg_catalog.count(*) over () as result_count
    from contact_matches
    order by contact_matches.match_rank desc, contact_matches.date desc,
      contact_matches.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  ), resolved as (
    select
      paged.*,
      case
        when public.softora_mailbox_search_word_prefix(paged.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(paged.sender_name, p.query)
          then 'afzender'
        when public.softora_mailbox_search_word_prefix(paged.recipient_names, p.query)
          then 'ontvanger'
        when public.softora_mailbox_search_word_prefix(paged.subject, p.query)
          then 'onderwerp'
        else 'inhoud'
      end as resolved_match_field,
      case
        when public.softora_mailbox_search_word_prefix(paged.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(paged.sender_name, p.query)
          then pg_catalog.left(pg_catalog.concat_ws(
            ' · ', paged.sender_name, paged.sender_email
          ), 240)
        when public.softora_mailbox_search_word_prefix(paged.recipient_names, p.query)
          then pg_catalog.left(paged.recipient_names, 240)
        when public.softora_mailbox_search_word_prefix(paged.subject, p.query)
          then pg_catalog.left(paged.subject, 240)
        when public.softora_mailbox_search_word_prefix(paged.preview, p.query)
          then pg_catalog.left(paged.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(paged.body_text, ''), '\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(
            public.softora_mailbox_search_normalize(paged.body_text), p.query
          ) - 70), 240
        )
      end as resolved_match_snippet
    from paged
    cross join params p
  )
  select
    resolved.message_key, resolved.account_email, resolved.folder, resolved.uid,
    resolved.provider_id, resolved.message_id, resolved.in_reply_to,
    resolved.references_text, resolved.sender_name, resolved.sender_email,
    resolved.recipients_text, resolved.subject, resolved.preview, resolved.date,
    resolved.internal_date, resolved.unread, resolved.softora_read_at,
    resolved.state_revision, resolved.state_mutation_key, resolved.state_mutation_at,
    resolved.starred, resolved.reply_dismissed_at, resolved.has_body,
    resolved.body_truncated, resolved.payload, resolved.canonical_owner,
    resolved.thread_key, resolved.contact_email, resolved.resolved_match_field,
    pg_catalog.left(pg_catalog.regexp_replace(
      coalesce(resolved.resolved_match_snippet, ''), '\s+', ' ', 'g'
    ), 240), resolved.message_key, resolved.result_count
  from resolved
  order by resolved.match_rank desc, resolved.date desc, resolved.message_key desc;
$function$;

revoke all on function public.softora_search_mailbox_contact_dossiers(
  jsonb, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.softora_search_mailbox_contact_dossiers(
  jsonb, text, integer, integer
) to service_role;

comment on function public.softora_search_mailbox_contact_dossiers(
  jsonb, text, integer, integer
) is 'Searches only campaign-proven human coldmail dossier messages and accepted-send fallback within exact canonical-owner scope.';
