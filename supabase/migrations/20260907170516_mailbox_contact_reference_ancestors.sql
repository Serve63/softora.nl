-- Preserve real sent history when an alias reply references a campaign root
-- through a forwarded message that is absent from the owner mailbox. No data
-- is rewritten: timeline and atomic hide/restore keep sharing the same scope.

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
  ), contact_reference_ids as materialized (
    -- Expand headers once for this contact, then use the existing exact-ID
    -- index (account, folder, normalized message ID) for each ancestor lookup.
    select distinct m.message_key, m.account_email,
      public.softora_normalize_mailbox_message_id(reference_token.value) as reference_id
    from params p
    join public.softora_mailbox_messages m
      on m.account_email = any(p.account_emails)
      and m.generation_superseded_at is null
      and m.search_document like ('%' || p.contact_email || '%')
    cross join lateral pg_catalog.regexp_split_to_table(
      pg_catalog.concat_ws(' ', m.in_reply_to, m.references_text), '[,[:space:]]+'
    ) reference_token(value)
    where p.contact_email <> ''
      and pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
      and public.softora_normalize_mailbox_message_id(reference_token.value) is not null
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
    join contact_reference_ids reference
      on reference.message_key = m.message_key and reference.account_email = m.account_email
    join provenance_rows provenance
      on provenance.account_email = reference.account_email
      and provenance.normalized_message_id = reference.reference_id
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
  ), physical_reference_matches as materialized (
    -- Legacy replies can skip an unavailable forwarded parent. The original
    -- campaign root must still exist in this account and match an exact RFC
    -- reference AND the technical thread. A contact/domain match is not proof.
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
    join contact_reference_ids reference
      on reference.message_key = m.message_key and reference.account_email = m.account_email
    join public.softora_mailbox_messages root_message
      on root_message.account_email = reference.account_email
      and root_message.folder = 'sent'
      and root_message.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(root_message.message_id) = reference.reference_id
      and public.softora_mailbox_account_owner(root_message.sender_email)
        = public.softora_mailbox_account_owner(m.account_email)
    join public.softora_mailbox_campaign_lineage_roots campaign_root
      on campaign_root.message_key = root_message.message_key
      and campaign_root.account_email = root_message.account_email
    cross join lateral (
      select public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key
    ) message_thread
    where p.contact_email <> ''
      and pg_catalog.lower(pg_catalog.btrim(m.folder)) <> 'sent'
      and pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
      and pg_catalog.lower(pg_catalog.btrim(m.account_email))
        = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
      and message_thread.thread_key = public.softora_mailbox_technical_thread_key(
        root_message.account_email, root_message.provider_id,
        root_message.message_id, root_message.in_reply_to,
        root_message.references_text, root_message.payload
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
    union
    select matched.message_key, matched.account_email, matched.thread_key,
      matched.canonical_owner
    from physical_reference_matches matched
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
  ), seed_reference_ids as materialized (
    select distinct seed.account_email, seed.thread_key, seed.canonical_owner,
      public.softora_normalize_mailbox_message_id(reference_token.value) as reference_id
    from direct_seeds seed
    join public.softora_mailbox_messages seed_message
      on seed_message.message_key = seed.message_key
      and seed_message.account_email = seed.account_email
    cross join lateral pg_catalog.regexp_split_to_table(
      pg_catalog.concat_ws(' ', seed_message.in_reply_to, seed_message.references_text), '[,[:space:]]+'
    ) reference_token(value)
    where public.softora_normalize_mailbox_message_id(reference_token.value) is not null
  ), referenced_own_physical as materialized (
    -- Supplement materialized lineage with exact, directional ancestors only.
    -- This also survives a sync generation change before lineage catches up.
    select distinct
      ancestor.message_key, seed.account_email, seed.thread_key,
      seed.canonical_owner
    from seed_reference_ids seed
    join public.softora_mailbox_messages ancestor
      on ancestor.account_email = seed.account_email
      and ancestor.folder = 'sent'
      and ancestor.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(ancestor.message_id) = seed.reference_id
      and public.softora_mailbox_account_owner(ancestor.sender_email) = seed.canonical_owner
      and seed.thread_key = public.softora_mailbox_technical_thread_key(
        ancestor.account_email, ancestor.provider_id, ancestor.message_id,
        ancestor.in_reply_to, ancestor.references_text, ancestor.payload
      )
    where not public.softora_has_proven_automated_reply(ancestor.payload)
      and not exists (
        select 1 from public.softora_mailbox_campaign_lineage_members automated_member
        where automated_member.message_key = ancestor.message_key
          and automated_member.account_email = ancestor.account_email
          and automated_member.is_proven_automated
      )
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
    select * from referenced_own_physical
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

revoke all on function public.softora_mailbox_contact_scope(text[], text)
  from public, anon, authenticated;
grant execute on function public.softora_mailbox_contact_scope(text[], text)
  to service_role;
