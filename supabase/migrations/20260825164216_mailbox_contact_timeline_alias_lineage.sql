-- A reply may legitimately arrive from a personal/alias address even though
-- the campaign root was sent to a role address. Keep the existing outreach
-- contact gate as the seed, then expand only across durable campaign lineage
-- whose root and exact technical thread key both agree.

create or replace function public.softora_mailbox_account_owner(
  p_account_email text
)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  with normalized as (
    select pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))) as email
  ), canonical as (
    select case
      when pg_catalog.split_part(email, '@', 2)
        = any(array['gmail.com', 'googlemail.com']::text[])
      then pg_catalog.regexp_replace(
        pg_catalog.split_part(pg_catalog.split_part(email, '@', 1), '+', 1),
        '[.]', '', 'g'
      ) || '@gmail.com'
      else email
    end as email
    from normalized
  )
  select case
    when canonical.email = any(array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'serve@websoftora.com',
      'servecreusen@websoftora.com'
    ]::text[]) then 'serve'
    when canonical.email = any(array[
      'martijn@softora.nl', 'martijnvandeven@softora.nl',
      'martijnven123@gmail.com', 'contactvenvisuals@gmail.com',
      'martijn@websoftora.com', 'martijnven@websoftora.com',
      'martijnvandeven@websoftora.com'
    ]::text[]) then 'martijn'
    else null
  end
  from canonical;
$function$;

create or replace function public.softora_mailbox_contact_scope(
  p_account_emails text[],
  p_contact_email text
)
returns table (
  source_rank integer,
  message_key text,
  account_email text,
  provenance_intent_id text,
  technical_thread_key text,
  canonical_owner text
)
language sql
stable
security invoker
set search_path = ''
as $function$
  with recursive params as (
    select
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
        from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) accounts(account_email)
        where nullif(pg_catalog.btrim(account_email), '') is not null
      ) as account_emails,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, ''))) as contact_email
  ), provenance_rows as materialized (
    select
      provenance.intent_id,
      pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) as account_email,
      pg_catalog.lower(pg_catalog.btrim(provenance.owner)) as canonical_owner,
      pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) as recipient_email,
      normalized.normalized_message_id,
      provenance_thread.thread_key
    from public.softora_mailbox_send_provenance provenance
    join params p
      on pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
        = any(p.account_emails)
    cross join lateral (
      select public.softora_normalize_mailbox_message_id(
        provenance.sent_message_id
      ) as normalized_message_id
    ) normalized
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        provenance.account_email,
        'accepted-sent:' || provenance.intent_id,
        provenance.sent_message_id,
        provenance.reply_target_message_id,
        provenance.references_text,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'source', 'send-provenance',
          'provider', provenance.provider,
          'providerThreadId', provenance.provider_thread_id
        ))
      ) as thread_key
    ) provenance_thread
    where provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and normalized.normalized_message_id is not null
      and pg_catalog.lower(pg_catalog.btrim(provenance.provider))
        = any(array['smtp', 'imap', 'instantly']::text[])
      and public.softora_mailbox_account_owner(provenance.account_email) is not null
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner))
        = public.softora_mailbox_account_owner(provenance.account_email)
  ), base_direct as materialized (
    select distinct
      m.message_key,
      pg_catalog.lower(pg_catalog.btrim(m.account_email)) as account_email,
      message_thread.thread_key,
      public.softora_mailbox_account_owner(m.account_email) as canonical_owner
    from params p
    join public.softora_mailbox_messages m
      on pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(p.account_emails)
      and m.generation_superseded_at is null
      and m.search_document like ('%' || p.contact_email || '%')
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key
    ) message_thread
    where p.contact_email <> ''
      and p.contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
      and public.softora_mailbox_message_has_campaign_proof(
        m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
        m.references_text, m.sender_name, m.sender_email, m.recipients_text,
        m.subject, m.payload, p.contact_email, null
      )
  ), provenance_alias_matches as materialized (
    select distinct
      m.message_key,
      pg_catalog.lower(pg_catalog.btrim(m.account_email)) as account_email,
      provenance.intent_id,
      provenance.canonical_owner,
      provenance.recipient_email as origin_contact_email,
      message_thread.thread_key
    from params p
    join public.softora_mailbox_messages m
      on pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(p.account_emails)
      and m.generation_superseded_at is null
      and m.search_document like ('%' || p.contact_email || '%')
    join provenance_rows provenance
      on provenance.account_email = pg_catalog.lower(pg_catalog.btrim(m.account_email))
      and provenance.normalized_message_id
        = public.softora_normalize_mailbox_message_id(m.in_reply_to)
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key
    ) message_thread
    where p.contact_email <> ''
      and pg_catalog.lower(pg_catalog.btrim(m.folder)) <> 'sent'
      and pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
      and p.contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
      and pg_catalog.lower(pg_catalog.btrim(m.account_email))
        = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
      and provenance.thread_key = message_thread.thread_key
      and provenance.recipient_email <> p.contact_email
      and provenance.recipient_email <> all(p.account_emails)
      and public.softora_mailbox_is_outreach_contact(
        p.account_emails, provenance.recipient_email
      )
      and not public.softora_has_proven_automated_reply(m.payload)
      and pg_catalog.lower(pg_catalog.btrim(coalesce(
        m.payload->>'automatedReplyEvidence', ''
      ))) <> 'true'
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_members automated_member
        where automated_member.message_key = m.message_key
          and automated_member.account_email = m.account_email
          and automated_member.is_proven_automated
      )
      and not (
        pg_catalog.lower(pg_catalog.btrim(coalesce(m.sender_email, ''))) ~
          '(^|[<[:space:]])(mailer-daemon|postmaster|[^@[:space:]]*(no-?reply|noreply)[^@[:space:]]*)@'
        or pg_catalog.lower(pg_catalog.btrim(coalesce(m.sender_email, ''))) ~
          '@([a-z0-9-]+[.])*linkedin[.]com>?$'
        or pg_catalog.lower(pg_catalog.btrim(coalesce(m.sender_email, ''))) ~
          '@([a-z0-9-]+[.])*strato[.](nl|de|com)>?$'
        or public.softora_mailbox_search_normalize(m.sender_name) ~
          '(^|[^a-z0-9])(mail delivery|delivery subsystem|strato mailserver|linkedin)([^a-z0-9]|$)'
        or public.softora_mailbox_search_normalize(m.subject) ~
          '(^|[^a-z0-9])(automatisch antwoord|automatic reply|auto reply|out of office|afwezigheidsbericht|ontvangstbevestiging|returned mail|undeliverable|undelivered mail|mail delivery failed|mail delivery failure|delivery status notification|failure notice|unzustellbar|niet bezorgd|onbestelbaar|bezorging mislukt|final-recipient|diagnostic-code)([^a-z0-9]|$)'
      )
  ), direct_seeds as materialized (
    select
      direct.message_key, direct.account_email, direct.thread_key,
      direct.canonical_owner
    from base_direct direct
    union
    select
      alias_match.message_key, alias_match.account_email,
      alias_match.thread_key, alias_match.canonical_owner
    from provenance_alias_matches alias_match
  ), ancestor_walk (
    seed_message_key, account_email, seed_thread_key, canonical_owner,
    message_key, parent_message_key, root_message_key, visited_keys
  ) as (
    select
      seed.message_key,
      seed.account_email,
      seed.thread_key,
      seed.canonical_owner,
      member.message_key,
      member.parent_message_key,
      member.root_message_key,
      array[member.message_key]::text[]
    from direct_seeds seed
    join public.softora_mailbox_campaign_lineage_members member
      on member.message_key = seed.message_key
      and member.account_email = seed.account_email
      and not member.is_proven_automated
    join public.softora_mailbox_campaign_lineage_roots campaign_root
      on campaign_root.message_key = member.root_message_key
      and campaign_root.account_email = member.account_email
    join public.softora_mailbox_messages root_message
      on root_message.message_key = campaign_root.message_key
      and root_message.account_email = campaign_root.account_email
      and root_message.generation_superseded_at is null
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        root_message.account_email, root_message.provider_id,
        root_message.message_id, root_message.in_reply_to,
        root_message.references_text, root_message.payload
      ) as thread_key
    ) root_thread
    where member.root_message_key is not null
      and seed.thread_key = root_thread.thread_key

    union all

    select
      ancestor.seed_message_key,
      ancestor.account_email,
      ancestor.seed_thread_key,
      ancestor.canonical_owner,
      parent_member.message_key,
      parent_member.parent_message_key,
      parent_member.root_message_key,
      ancestor.visited_keys || parent_member.message_key
    from ancestor_walk ancestor
    join public.softora_mailbox_campaign_lineage_members parent_member
      on parent_member.message_key = ancestor.parent_message_key
      and parent_member.account_email = ancestor.account_email
      and parent_member.root_message_key = ancestor.root_message_key
      and not parent_member.is_proven_automated
    join public.softora_mailbox_messages parent_message
      on parent_message.message_key = parent_member.message_key
      and parent_message.account_email = parent_member.account_email
      and parent_message.generation_superseded_at is null
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        parent_message.account_email, parent_message.provider_id,
        parent_message.message_id, parent_message.in_reply_to,
        parent_message.references_text, parent_message.payload
      ) as thread_key
    ) parent_thread
    where ancestor.parent_message_key is not null
      and not parent_member.message_key = any(ancestor.visited_keys)
      and parent_thread.thread_key = ancestor.seed_thread_key
  ), own_ancestor_physical as materialized (
    select distinct
      ancestor.message_key,
      ancestor.account_email,
      ancestor.seed_thread_key as thread_key,
      ancestor.canonical_owner
    from ancestor_walk ancestor
    join public.softora_mailbox_messages m
      on m.message_key = ancestor.message_key
      and m.account_email = ancestor.account_email
      and m.generation_superseded_at is null
    where ancestor.canonical_owner is not null
      and public.softora_mailbox_account_owner(m.sender_email)
        = ancestor.canonical_owner
  ), allowed_alias_origins as materialized (
    select distinct
      alias_match.account_email,
      alias_match.thread_key,
      alias_match.canonical_owner,
      alias_match.origin_contact_email as contact_email
    from provenance_alias_matches alias_match
  ), scoped_provenance as materialized (
    select distinct
      provenance.intent_id,
      provenance.account_email,
      provenance.thread_key,
      provenance.canonical_owner,
      provenance.normalized_message_id
    from provenance_rows provenance
    cross join params p
    where provenance.recipient_email = p.contact_email
      or exists (
        select 1
        from allowed_alias_origins allowed
        where allowed.account_email = provenance.account_email
          and allowed.thread_key = provenance.thread_key
          and allowed.canonical_owner = provenance.canonical_owner
          and allowed.contact_email = provenance.recipient_email
      )
  ), provenance_physical_copies as materialized (
    select distinct
      m.message_key,
      provenance.account_email,
      provenance.thread_key,
      provenance.canonical_owner
    from scoped_provenance provenance
    join public.softora_mailbox_messages m
      on pg_catalog.lower(pg_catalog.btrim(m.account_email)) = provenance.account_email
      and m.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(m.message_id)
        = provenance.normalized_message_id
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key
    ) message_thread
    where message_thread.thread_key = provenance.thread_key
  ), physical_scope_raw as (
    select * from direct_seeds
    union all
    select * from own_ancestor_physical
    union all
    select * from provenance_physical_copies
  ), physical_scope as (
    select
      physical.message_key,
      physical.account_email,
      pg_catalog.min(physical.thread_key) as thread_key,
      pg_catalog.min(physical.canonical_owner) as canonical_owner
    from physical_scope_raw physical
    group by physical.message_key, physical.account_email
    having pg_catalog.count(distinct physical.thread_key) = 1
      and pg_catalog.count(distinct physical.canonical_owner)
        filter (where physical.canonical_owner is not null) <= 1
  )
  select
    0 as source_rank,
    physical.message_key,
    physical.account_email,
    null::text as provenance_intent_id,
    physical.thread_key as technical_thread_key,
    physical.canonical_owner
  from physical_scope physical
  union all
  select
    1 as source_rank,
    'accepted-send|' || provenance.intent_id as message_key,
    provenance.account_email,
    provenance.intent_id as provenance_intent_id,
    provenance.thread_key as technical_thread_key,
    provenance.canonical_owner
  from scoped_provenance provenance;
$function$;

-- Final timeline definition consumes the same fail-closed candidate scope as
-- contact hide/restore. The earlier definition above is replaced in this same
-- transaction before execution privileges are restored.
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
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, ''))) as contact_email,
      greatest(1, least(50, coalesce(p_limit, 30))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), scope_candidates as materialized (
    select scope.*
    from public.softora_mailbox_contact_scope(
      p_account_emails,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, '')))
    ) scope
  ), physical_candidates as materialized (
    select
      m.message_key, m.account_email, m.folder, m.uid, m.provider_id,
      m.message_id, m.in_reply_to, m.references_text, m.sender_name,
      m.sender_email, m.recipients_text, m.subject, m.preview, m.date,
      m.internal_date, m.unread, m.softora_read_at, m.state_revision,
      m.state_mutation_key, m.state_mutation_at, m.starred,
      m.reply_dismissed_at, m.has_body, m.body_truncated, m.payload,
      scope.technical_thread_key as thread_key,
      p.contact_email,
      0 as source_rank
    from scope_candidates scope
    join public.softora_mailbox_messages m
      on m.message_key = scope.message_key
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = scope.account_email
    cross join params p
    where scope.source_rank = 0
      and m.deleted_at is null
      and m.generation_superseded_at is null
  ), provenance_candidates as materialized (
    select
      scope.message_key,
      scope.account_email,
      'sent'::text as folder,
      0::bigint as uid,
      'accepted-sent:' || provenance.intent_id as provider_id,
      provenance.sent_message_id as message_id,
      coalesce(provenance.reply_target_message_id, '') as in_reply_to,
      coalesce(provenance.references_text, '') as references_text,
      coalesce(nullif(provenance.sender_name, ''), provenance.account_email) as sender_name,
      scope.account_email as sender_email,
      pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) as recipients_text,
      provenance.subject,
      pg_catalog.left(pg_catalog.regexp_replace(coalesce(provenance.body_text, ''), '\s+', ' ', 'g'), 500) as preview,
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
      scope.technical_thread_key as thread_key,
      p.contact_email,
      1 as source_rank
    from scope_candidates scope
    join public.softora_mailbox_send_provenance provenance
      on provenance.intent_id = scope.provenance_intent_id
      and pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = scope.account_email
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner)) = scope.canonical_owner
    cross join params p
    cross join lateral (
      select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'source', 'send-provenance',
        'direction', 'sent',
        'provider', provenance.provider,
        'providerMessageId', provenance.provider_message_id,
        'providerThreadId', provenance.provider_thread_id,
        'providerAccountEmail', provenance.account_email,
        'providerOwner', provenance.owner,
        'originalCampaignOutbound', provenance.mode = 'new-message',
        'embeddedImageCount', 0,
        'recipientRoutingEvidenceKnown', true,
        'toDisplay', provenance.recipient_email,
        'cc', provenance.cc_text,
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
    where scope.source_rank = 1
      and provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and public.softora_normalize_mailbox_message_id(provenance.sent_message_id) is not null
      and not exists (
        select 1
        from public.softora_mailbox_message_tombstones tombstone
        where tombstone.account_email = scope.account_email
          and tombstone.normalized_message_id =
            public.softora_normalize_mailbox_message_id(provenance.sent_message_id)
      )
  ), candidates as materialized (
    select * from physical_candidates
    union all
    select * from provenance_candidates
  ), deduped as (
    select candidate.*
    from (
      select
        candidates.*,
        pg_catalog.row_number() over (
          partition by coalesce(
            public.softora_normalize_mailbox_message_id(candidates.message_id),
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.payload->>'softoraSendIntentId')), ''),
            nullif(pg_catalog.lower(pg_catalog.btrim(candidates.provider_id)), ''),
            pg_catalog.md5(pg_catalog.concat_ws('|',
              pg_catalog.lower(candidates.sender_email),
              pg_catalog.lower(candidates.recipients_text),
              pg_catalog.lower(candidates.subject),
              candidates.date::text
            ))
          )
          order by candidates.source_rank, candidates.date desc, candidates.message_key desc
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
    paged.message_key, paged.account_email, paged.folder, paged.uid,
    paged.provider_id, paged.message_id, paged.in_reply_to,
    paged.references_text, paged.sender_name, paged.sender_email,
    paged.recipients_text, paged.subject, paged.preview, paged.date,
    paged.internal_date, paged.unread, paged.softora_read_at,
    paged.state_revision, paged.state_mutation_key, paged.state_mutation_at,
    paged.starred, paged.reply_dismissed_at, paged.has_body,
    paged.body_truncated, paged.payload, paged.thread_key,
    paged.contact_email, paged.result_count
  from paged
  order by paged.date desc, paged.message_key desc;
$function$;

revoke all on function public.softora_mailbox_contact_timeline(text[], text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.softora_mailbox_contact_timeline(text[], text, integer, integer)
  to service_role;

comment on function public.softora_mailbox_contact_timeline(text[], text, integer, integer)
  is 'Returns a campaign-scoped contact dossier and expands alias senders only through the same owner account, durable campaign root and exact technical thread key.';

create or replace function public.softora_set_mailbox_contact_visibility(
  p_owner_accounts text[],
  p_contact_email text,
  p_anchor_account_email text,
  p_anchor_folder text,
  p_anchor_uid bigint,
  p_anchor_provider_id text,
  p_expected_message_count integer,
  p_hidden boolean
)
returns table (
  message_key text,
  account_email text,
  folder text,
  uid bigint,
  provider_id text,
  message_id text
)
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_owner_accounts text[];
  v_contact_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, '')));
  v_anchor_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_anchor_account_email, '')));
  v_anchor_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_anchor_folder, '')));
  v_anchor_provider_id text := pg_catalog.btrim(coalesce(p_anchor_provider_id, ''));
  v_anchor_message_key text;
  v_physical_message_keys text[] := array[]::text[];
  v_provenance_intent_ids text[] := array[]::text[];
  v_message_ids text[];
  v_changed_at timestamptz := pg_catalog.clock_timestamp();
  v_physical_count integer := 0;
  v_total_logical_count integer := 0;
  v_active_logical_count integer := 0;
  v_hidden_physical_count integer := 0;
  v_missing_message_id_count integer := 0;
  v_tombstone_count integer := 0;
  v_expected_tombstone_count integer := 0;
  v_lock record;
begin
  select coalesce(
    pg_catalog.array_agg(
      distinct pg_catalog.lower(pg_catalog.btrim(owner_account))
      order by pg_catalog.lower(pg_catalog.btrim(owner_account))
    ),
    array[]::text[]
  )
  into v_owner_accounts
  from pg_catalog.unnest(coalesce(p_owner_accounts, array[]::text[]))
    as owner_accounts(owner_account)
  where nullif(pg_catalog.btrim(owner_account), '') is not null;

  if pg_catalog.cardinality(v_owner_accounts) not between 1 and 32
    or v_contact_email = ''
    or pg_catalog.length(v_contact_email) > 320
    or v_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or v_contact_email = any(v_owner_accounts)
    or v_anchor_account_email <> all(v_owner_accounts)
    or v_anchor_folder = ''
    or coalesce(p_anchor_uid, 0) < 0
    or v_anchor_provider_id = ''
    or p_expected_message_count is null
    or p_expected_message_count < 0
    or p_hidden is null
    or (p_hidden and p_expected_message_count not between 1 and 100)
    or (not p_hidden and p_expected_message_count <> 0) then
    raise exception using
      errcode = '22023',
      message = 'Ongeldige atomische mailbox-contactzichtbaarheid.';
  end if;

  perform public.softora_lock_mailbox_visibility_exclusive();

  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;

  select
    coalesce(pg_catalog.array_agg(distinct scope.message_key)
      filter (where scope.source_rank = 0), array[]::text[]),
    coalesce(pg_catalog.array_agg(distinct scope.provenance_intent_id)
      filter (where scope.source_rank = 1), array[]::text[])
  into v_physical_message_keys, v_provenance_intent_ids
  from public.softora_mailbox_contact_scope(
    v_owner_accounts, v_contact_email
  ) scope;

  if pg_catalog.cardinality(v_physical_message_keys) < 1 then
    raise exception using
      errcode = '22023',
      message = 'Mailbox-contactdossier heeft geen veilig fysiek anker.';
  end if;

  select m.message_key
  into v_anchor_message_key
  from public.softora_mailbox_messages m
  where m.message_key = any(v_physical_message_keys)
    and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_anchor_account_email
    and pg_catalog.lower(pg_catalog.btrim(m.folder)) = v_anchor_folder
    and m.provider_id = v_anchor_provider_id
    and (
      (coalesce(p_anchor_uid, 0) > 0 and m.uid = p_anchor_uid)
      or (coalesce(p_anchor_uid, 0) = 0 and m.uid >= 0)
    )
    and m.generation_superseded_at is null
  order by m.updated_at desc nulls last, m.message_key
  limit 1;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Mailbox-contactanker ontbreekt of valt buiten de gekozen eigenaar.';
  end if;

  with physical_candidates as materialized (
    select
      m.message_key,
      m.deleted_at,
      public.softora_normalize_mailbox_message_id(m.message_id) as normalized_message_id,
      coalesce(
        public.softora_normalize_mailbox_message_id(m.message_id),
        nullif(pg_catalog.lower(pg_catalog.btrim(m.provider_id)), ''),
        pg_catalog.md5(pg_catalog.concat_ws('|',
          pg_catalog.lower(m.sender_email),
          pg_catalog.lower(m.recipients_text),
          pg_catalog.lower(m.subject),
          m.date::text
        ))
      ) as logical_message_key,
      0 as source_rank
    from public.softora_mailbox_messages m
    where m.message_key = any(v_physical_message_keys)
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
  ), provenance_candidates as materialized (
    select
      'accepted-send|' || provenance.intent_id as message_key,
      tombstone.deleted_at,
      normalized.normalized_message_id,
      normalized.normalized_message_id as logical_message_key,
      1 as source_rank
    from public.softora_mailbox_send_provenance provenance
    cross join lateral (
      select public.softora_normalize_mailbox_message_id(
        provenance.sent_message_id
      ) as normalized_message_id
    ) normalized
    left join public.softora_mailbox_message_tombstones tombstone
      on tombstone.account_email = pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
      and tombstone.normalized_message_id = normalized.normalized_message_id
    where provenance.intent_id = any(v_provenance_intent_ids)
      and provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and normalized.normalized_message_id is not null
      and pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = any(v_owner_accounts)
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner))
        = public.softora_mailbox_account_owner(provenance.account_email)
  ), candidates as materialized (
    select * from physical_candidates
    union all
    select * from provenance_candidates
  )
  select
    pg_catalog.count(*) filter (where source_rank = 0)::integer,
    pg_catalog.count(distinct logical_message_key)::integer,
    pg_catalog.count(distinct logical_message_key)
      filter (where deleted_at is null)::integer,
    pg_catalog.count(*) filter (
      where source_rank = 0 and deleted_at is not null
    )::integer,
    pg_catalog.count(*) filter (
      where source_rank = 0 and normalized_message_id is null
    )::integer,
    coalesce(
      pg_catalog.array_agg(distinct normalized_message_id order by normalized_message_id)
        filter (where normalized_message_id is not null),
      array[]::text[]
    )
  into
    v_physical_count,
    v_total_logical_count,
    v_active_logical_count,
    v_hidden_physical_count,
    v_missing_message_id_count,
    v_message_ids
  from candidates;

  if v_physical_count < 1
    or v_total_logical_count < 1
    or v_total_logical_count > 100
    or (
      p_hidden
      and (
        v_missing_message_id_count > 0
        or pg_catalog.cardinality(v_message_ids) <> v_total_logical_count
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'Mailbox-contactdossier is niet duurzaam en volledig identificeerbaar.';
  end if;

  v_expected_tombstone_count :=
    pg_catalog.cardinality(v_owner_accounts) * pg_catalog.cardinality(v_message_ids);

  for v_lock in
    select owner_account, normalized_message_id
    from pg_catalog.unnest(v_owner_accounts) as owner_accounts(owner_account)
    cross join pg_catalog.unnest(v_message_ids) as message_ids(normalized_message_id)
    order by owner_account, normalized_message_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_lock.owner_account),
      pg_catalog.hashtext(v_lock.normalized_message_id)
    );
  end loop;

  for v_lock in
    select m.message_key
    from public.softora_mailbox_messages m
    where m.message_key = any(v_physical_message_keys)
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
    order by m.message_key
    for update
  loop
    null;
  end loop;

  if not exists (
    select 1
    from public.softora_mailbox_messages m
    where m.message_key = v_anchor_message_key
      and m.message_key = any(v_physical_message_keys)
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_anchor_account_email
      and pg_catalog.lower(pg_catalog.btrim(m.folder)) = v_anchor_folder
      and m.provider_id = v_anchor_provider_id
      and (
        (coalesce(p_anchor_uid, 0) > 0 and m.uid = p_anchor_uid)
        or (coalesce(p_anchor_uid, 0) = 0 and m.uid >= 0)
      )
      and m.generation_superseded_at is null
  ) then
    raise exception using
      errcode = '40001',
      message = 'Mailbox-contactanker veranderde tijdens zichtbaarheidstransactie.';
  end if;

  select pg_catalog.count(*)::integer
  into v_tombstone_count
  from pg_catalog.unnest(v_owner_accounts) as owner_accounts(owner_account)
  cross join pg_catalog.unnest(v_message_ids) as message_ids(normalized_message_id)
  join public.softora_mailbox_message_tombstones tombstone
    on tombstone.account_email = owner_accounts.owner_account
    and tombstone.normalized_message_id = message_ids.normalized_message_id;

  if p_hidden then
    if v_active_logical_count = 0
      and v_hidden_physical_count = v_physical_count
      and v_tombstone_count = v_expected_tombstone_count then
      return query
        select m.message_key, m.account_email, m.folder, m.uid,
          m.provider_id, m.message_id
        from public.softora_mailbox_messages m
        where m.message_key = any(v_physical_message_keys)
          and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
          and m.generation_superseded_at is null
        order by m.date desc, m.message_key desc;
      return;
    end if;

    if v_active_logical_count <> p_expected_message_count then
      raise exception using
        errcode = '22023',
        message = 'Mailbox-contacttijdlijn veranderde tijdens de volledige controle.';
    end if;

    insert into public.softora_mailbox_message_tombstones as tombstone (
      account_email, normalized_message_id, deleted_at, updated_at
    )
    select owner_account, normalized_message_id, v_changed_at, v_changed_at
    from pg_catalog.unnest(v_owner_accounts) as owner_accounts(owner_account)
    cross join pg_catalog.unnest(v_message_ids) as message_ids(normalized_message_id)
    on conflict on constraint softora_mailbox_message_tombstones_pkey do update
    set deleted_at = excluded.deleted_at, updated_at = excluded.updated_at;

    return query
      update public.softora_mailbox_messages as m
      set deleted_at = v_changed_at, updated_at = v_changed_at
      where m.message_key = any(v_physical_message_keys)
        and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
        and m.generation_superseded_at is null
      returning m.message_key, m.account_email, m.folder, m.uid,
        m.provider_id, m.message_id;
    return;
  end if;

  if v_hidden_physical_count = 0 and v_tombstone_count = 0 then
    return query
      select m.message_key, m.account_email, m.folder, m.uid,
        m.provider_id, m.message_id
      from public.softora_mailbox_messages m
      where m.message_key = any(v_physical_message_keys)
        and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
        and m.generation_superseded_at is null
      order by m.date desc, m.message_key desc;
    return;
  end if;

  delete from public.softora_mailbox_message_tombstones tombstone
  where tombstone.account_email = any(v_owner_accounts)
    and tombstone.normalized_message_id = any(v_message_ids);

  return query
    update public.softora_mailbox_messages as m
    set deleted_at = null, updated_at = v_changed_at
    where m.message_key = any(v_physical_message_keys)
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
    returning m.message_key, m.account_email, m.folder, m.uid,
      m.provider_id, m.message_id;
end;
$function$;

revoke all on function public.softora_mailbox_account_owner(text)
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_contact_scope(text[], text)
  from public, anon, authenticated;
revoke all on function public.softora_set_mailbox_contact_visibility(
  text[], text, text, text, bigint, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.softora_mailbox_account_owner(text)
  to service_role;
grant execute on function public.softora_mailbox_contact_scope(text[], text)
  to service_role;
grant execute on function public.softora_set_mailbox_contact_visibility(
  text[], text, text, text, bigint, text, integer, boolean
) to service_role;
