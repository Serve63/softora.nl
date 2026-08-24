-- Accepted provider evidence is a durable fallback while an IMAP Sent index is
-- catching up. A real mailbox row always wins once the same Message-ID arrives.
-- mailbox-send-provenance-visibility-fence:start

alter table public.softora_mailbox_send_provenance
  add column if not exists transition_token uuid;

create index if not exists softora_mailbox_send_provenance_contact_timeline_idx
  on public.softora_mailbox_send_provenance (
    account_email,
    recipient_email,
    accepted_at desc,
    intent_id
  )
  where status = 'accepted' and sent_message_id is not null;

-- Prepared/provider-dispatch writes are intentionally outside the campaign
-- fence. Only a row that is, or was, visible accepted evidence participates in
-- the same transaction boundary as hide/restore.
create or replace function public.softora_lock_mailbox_send_provenance_visible_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_old_visible boolean := false;
  v_new_visible boolean := false;
begin
  v_old_visible := tg_op in ('UPDATE', 'DELETE')
    and old.status = 'accepted'
    and old.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(old.sent_message_id) is not null;
  v_new_visible := tg_op in ('INSERT', 'UPDATE')
    and new.status = 'accepted'
    and new.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(new.sent_message_id) is not null;
  if v_old_visible or v_new_visible then
    insert into public.softora_mailbox_campaign_consistency (scope, content_version)
    values ('campaign', 0) on conflict (scope) do nothing;
    perform 1 from public.softora_mailbox_campaign_consistency
    where scope = 'campaign' for update;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

drop trigger if exists softora_lock_mailbox_send_provenance_consistency_before_write
  on public.softora_mailbox_send_provenance;
create trigger softora_lock_mailbox_send_provenance_consistency_before_write
before insert or update or delete
on public.softora_mailbox_send_provenance
for each row
execute function public.softora_lock_mailbox_send_provenance_visible_change();

drop trigger if exists softora_lock_mailbox_send_provenance_consistency_before_truncate
  on public.softora_mailbox_send_provenance;
create trigger softora_lock_mailbox_send_provenance_consistency_before_truncate
before truncate on public.softora_mailbox_send_provenance
for each statement
execute function public.softora_lock_mailbox_campaign_consistency_before_write();

create or replace function public.softora_track_mailbox_send_provenance_change()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_old_visible jsonb := null;
  v_new_visible jsonb := null;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'accepted'
    and old.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(old.sent_message_id) is not null then
    v_old_visible := pg_catalog.jsonb_build_array(
      pg_catalog.lower(pg_catalog.btrim(old.account_email)),
      pg_catalog.lower(pg_catalog.btrim(old.recipient_email)),
      public.softora_normalize_mailbox_message_id(old.sent_message_id),
      old.accepted_at, old.sender_name, old.subject, old.body_text,
      old.cc_text, old.bcc_text, old.provider, old.provider_message_id,
      old.provider_thread_id, old.conversation_id, old.reply_target_message_id,
      old.references_text, old.mode, old.owner
    );
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'accepted'
    and new.accepted_at is not null
    and public.softora_normalize_mailbox_message_id(new.sent_message_id) is not null then
    v_new_visible := pg_catalog.jsonb_build_array(
      pg_catalog.lower(pg_catalog.btrim(new.account_email)),
      pg_catalog.lower(pg_catalog.btrim(new.recipient_email)),
      public.softora_normalize_mailbox_message_id(new.sent_message_id),
      new.accepted_at, new.sender_name, new.subject, new.body_text,
      new.cc_text, new.bcc_text, new.provider, new.provider_message_id,
      new.provider_thread_id, new.conversation_id, new.reply_target_message_id,
      new.references_text, new.mode, new.owner
    );
  end if;
  if v_old_visible is distinct from v_new_visible then
    update public.softora_mailbox_campaign_consistency as consistency
    set content_version = consistency.content_version + 1,
        updated_at = pg_catalog.clock_timestamp()
    where consistency.scope = 'campaign';
    if not found then
      raise exception using errcode = '55000',
        message = 'MAILBOX_CAMPAIGN_FENCE_MISSING';
    end if;
  end if;
  return null;
end;
$function$;

drop trigger if exists softora_track_mailbox_send_provenance_change
  on public.softora_mailbox_send_provenance;
create trigger softora_track_mailbox_send_provenance_change
after insert or update or delete
on public.softora_mailbox_send_provenance
for each row
execute function public.softora_track_mailbox_send_provenance_change();

revoke all on function public.softora_track_mailbox_send_provenance_change()
  from public, anon, authenticated;
revoke all on function public.softora_lock_mailbox_send_provenance_visible_change()
  from public, anon, authenticated;
grant execute on function public.softora_track_mailbox_send_provenance_change()
  to service_role;
grant execute on function public.softora_lock_mailbox_send_provenance_visible_change()
  to service_role;

-- mailbox-send-provenance-visibility-fence:end

-- One exact predicate is shared by the visible contact timeline and its
-- hide/restore completeness scan. Contact-level outreach eligibility is never
-- sufficient: each physical message needs its own campaign lineage or a
-- Message-ID bridge to accepted/permanent outbound evidence.
create or replace function public.softora_mailbox_reference_matches_message_id(
  p_in_reply_to text,
  p_references_text text,
  p_expected_message_id text
)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = ''
as $function$
  with expected as (
    select public.softora_normalize_mailbox_message_id(
      p_expected_message_id
    ) as message_id
  )
  select coalesce((
    select expected.message_id is not null and (
      public.softora_normalize_mailbox_message_id(p_in_reply_to) = expected.message_id
      or exists (
        select 1
        from pg_catalog.regexp_split_to_table(
          coalesce(p_references_text, ''), '[,[:space:]]+'
        ) as reference_token(value)
        where public.softora_normalize_mailbox_message_id(reference_token.value)
          = expected.message_id
      )
    )
    from expected
  ), false);
$function$;

create or replace function public.softora_mailbox_message_has_campaign_proof(
  p_message_key text,
  p_account_email text,
  p_folder text,
  p_message_id text,
  p_in_reply_to text,
  p_references_text text,
  p_sender_name text,
  p_sender_email text,
  p_recipients_text text,
  p_subject text,
  p_payload jsonb,
  p_contact_email text,
  p_canonical_owner text default null
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with params as (
    select
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, ''))) as account_email,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_contact_email, ''))) as contact_email,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_canonical_owner, ''))) as canonical_owner,
      coalesce(p_payload, '{}'::jsonb) as payload
  )
  select coalesce((
    select
      params.account_email <> ''
      and params.contact_email <> ''
      and params.contact_email = any(public.softora_mailbox_message_participants(
        p_sender_email, p_recipients_text, params.payload
      ))
      and not public.softora_has_proven_automated_reply(params.payload)
      and pg_catalog.lower(pg_catalog.btrim(coalesce(
        params.payload->>'automatedReplyEvidence', ''
      ))) <> 'true'
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_members automated_member
        where automated_member.message_key = p_message_key
          and automated_member.account_email = params.account_email
          and automated_member.is_proven_automated
      )
      and not (
        pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email, ''))) ~
          '(^|[<[:space:]])(mailer-daemon|postmaster|[^@[:space:]]*(no-?reply|noreply)[^@[:space:]]*)@'
        or pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email, ''))) ~
          '@([a-z0-9-]+[.])*linkedin[.]com>?$'
        or pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email, ''))) ~
          '@([a-z0-9-]+[.])*strato[.](nl|de|com)>?$'
        or public.softora_mailbox_search_normalize(p_sender_name) ~
          '(^|[^a-z0-9])(mail delivery|delivery subsystem|strato mailserver|linkedin)([^a-z0-9]|$)'
        or public.softora_mailbox_search_normalize(p_subject) ~
          '(^|[^a-z0-9])(automatisch antwoord|automatic reply|auto reply|out of office|afwezigheidsbericht|ontvangstbevestiging|returned mail|undeliverable|undelivered mail|mail delivery failed|mail delivery failure|delivery status notification|failure notice|unzustellbar|niet bezorgd|onbestelbaar|bezorging mislukt|final-recipient|diagnostic-code)([^a-z0-9]|$)'
      )
      and (
        exists (
          select 1
          from public.softora_mailbox_campaign_lineage_roots root
          where root.message_key = p_message_key
            and root.account_email = params.account_email
        )
        or exists (
          select 1
          from public.softora_mailbox_campaign_lineage_members member
          where member.message_key = p_message_key
            and member.account_email = params.account_email
            and not member.is_proven_automated
        )
        or pg_catalog.lower(pg_catalog.btrim(coalesce(
          params.payload->>'originalCampaignOutbound', ''
        ))) = 'true'
        or (
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, ''))) = 'instantly'
          and pg_catalog.lower(pg_catalog.btrim(coalesce(
            params.payload->>'provider', params.payload->>'source', ''
          ))) = 'instantly'
          and pg_catalog.lower(pg_catalog.btrim(coalesce(
            params.payload->>'providerAccountEmail', ''
          ))) = params.account_email
          and pg_catalog.lower(pg_catalog.btrim(coalesce(
            params.payload->>'providerOwner', ''
          ))) = any(array['serve', 'martijn']::text[])
          and (
            params.canonical_owner = ''
            or pg_catalog.lower(pg_catalog.btrim(params.payload->>'providerOwner'))
              = params.canonical_owner
          )
          and nullif(pg_catalog.btrim(params.payload->>'providerThreadId'), '') is not null
          and nullif(pg_catalog.btrim(params.payload->>'providerCampaignId'), '') is not null
        )
        or exists (
          select 1
          from public.softora_mailbox_send_provenance provenance
          where provenance.status = 'accepted'
            and provenance.accepted_at is not null
            and public.softora_normalize_mailbox_message_id(
              provenance.sent_message_id
            ) is not null
            and pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
              = params.account_email
            and pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email))
              = params.contact_email
            and pg_catalog.lower(pg_catalog.btrim(provenance.owner))
              = any(array['serve', 'martijn']::text[])
            and (
              params.canonical_owner = ''
              or pg_catalog.lower(pg_catalog.btrim(provenance.owner))
                = params.canonical_owner
            )
            and pg_catalog.lower(pg_catalog.btrim(provenance.provider))
              = any(array['smtp', 'instantly']::text[])
            and (
              public.softora_normalize_mailbox_message_id(p_message_id)
                = public.softora_normalize_mailbox_message_id(provenance.sent_message_id)
              or public.softora_mailbox_reference_matches_message_id(
                p_in_reply_to, p_references_text, provenance.sent_message_id
              )
            )
        )
        or exists (
          select 1
          from public.softora_outbound_recipient_guards outbound_guard
          cross join lateral (
            select direct_evidence.message_id
            from (values (
              coalesce(
                nullif(outbound_guard.payload->>'messageId', ''),
                nullif(outbound_guard.payload->>'sentMessageId', ''),
                nullif(outbound_guard.payload->>'coldmailSentMessageId', ''),
                nullif(outbound_guard.payload->>'outreachMessageId', '')
              )
            )) direct_evidence(message_id)
            where public.softora_normalize_mailbox_message_id(
              direct_evidence.message_id
            ) is not null
            union all
            select historical_event.value->>'messageId'
            from pg_catalog.jsonb_array_elements(
              case
                when pg_catalog.jsonb_typeof(outbound_guard.payload->'events') = 'array'
                  then outbound_guard.payload->'events'
                else '[]'::jsonb
              end
            ) historical_event(value)
            where public.softora_normalize_mailbox_message_id(
              historical_event.value->>'messageId'
            ) is not null
          ) guard_evidence
          where outbound_guard.key_type = 'email'
            and outbound_guard.permanent = true
            and pg_catalog.lower(pg_catalog.btrim(outbound_guard.status)) = 'sent'
            and pg_catalog.lower(pg_catalog.btrim(outbound_guard.provider))
              = any(array['softora', 'instantly']::text[])
            and pg_catalog.lower(pg_catalog.btrim(outbound_guard.channel))
              = any(array['coldmail', 'instantly']::text[])
            and pg_catalog.lower(pg_catalog.btrim(outbound_guard.sender_email))
              = params.account_email
            and pg_catalog.lower(pg_catalog.btrim(coalesce(
              outbound_guard.recipient_email, outbound_guard.key_value, ''
            ))) = params.contact_email
            and (
              public.softora_normalize_mailbox_message_id(p_message_id)
                = public.softora_normalize_mailbox_message_id(guard_evidence.message_id)
              or public.softora_mailbox_reference_matches_message_id(
                p_in_reply_to, p_references_text, guard_evidence.message_id
              )
            )
        )
      )
    from params
  ), false);
$function$;

revoke all on function public.softora_mailbox_reference_matches_message_id(text, text, text)
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_message_has_campaign_proof(
  text, text, text, text, text, text, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.softora_mailbox_reference_matches_message_id(text, text, text)
  to service_role;
grant execute on function public.softora_mailbox_message_has_campaign_proof(
  text, text, text, text, text, text, text, text, text, text, jsonb, text, text
) to service_role;

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
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
        from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) accounts(account_email)
        where nullif(pg_catalog.btrim(account_email), '') is not null
      ) as account_emails,
      pg_catalog.lower(pg_catalog.btrim(p_contact_email)) as contact_email,
      public.softora_mailbox_is_outreach_contact(
        p_account_emails,
        pg_catalog.lower(pg_catalog.btrim(p_contact_email))
      ) as eligible,
      greatest(1, least(50, coalesce(p_limit, 30))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), indexed_candidates as (
    select
      m.message_key, m.account_email, m.folder, m.uid, m.provider_id,
      m.message_id, m.in_reply_to, m.references_text, m.sender_name,
      m.sender_email, m.recipients_text, m.subject, m.preview, m.date,
      m.internal_date, m.unread, m.softora_read_at, m.state_revision,
      m.state_mutation_key, m.state_mutation_at, m.starred,
      m.reply_dismissed_at, m.has_body, m.body_truncated, m.payload,
      public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key,
      p.contact_email,
      0 as source_rank
    from public.softora_mailbox_messages m
    cross join params p
    where p.eligible
      and m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(p.account_emails)
      and m.search_document like ('%' || p.contact_email || '%')
      and (
        pg_catalog.lower(pg_catalog.btrim(m.sender_email)) = p.contact_email
        or p.contact_email = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
      )
      and public.softora_mailbox_message_has_campaign_proof(
        m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
        m.references_text, m.sender_name, m.sender_email, m.recipients_text,
        m.subject, m.payload, p.contact_email, null
      )
  ), provenance_candidates as (
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
      public.softora_mailbox_technical_thread_key(
        provenance.account_email,
        'accepted-sent:' || provenance.intent_id,
        provenance.sent_message_id,
        provenance.reply_target_message_id,
        provenance.references_text,
        timeline_payload.value
      ) as thread_key,
      p.contact_email,
      1 as source_rank
    from public.softora_mailbox_send_provenance provenance
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
    where p.eligible
      and provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and public.softora_normalize_mailbox_message_id(provenance.sent_message_id) is not null
      and pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = any(p.account_emails)
      and pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) = p.contact_email
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner))
        = any(array['serve', 'martijn']::text[])
      and not exists (
        select 1
        from public.softora_mailbox_message_tombstones tombstone
        where tombstone.account_email = pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
          and tombstone.normalized_message_id =
            public.softora_normalize_mailbox_message_id(provenance.sent_message_id)
      )
  ), candidates as materialized (
    select * from indexed_candidates
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

-- The contact visibility RPC predates accepted-send fallback rows. Replace its
-- single physical-candidate scan with one logical set that also contains exact
-- accepted provider evidence. This keeps the UI completeness count, atomic hide
-- and durable tombstones aligned without inventing a physical mailbox row.
do $patch_contact_visibility$
declare
  v_signature text :=
    'public.softora_set_mailbox_contact_visibility(text[],text,text,text,bigint,text,integer,boolean)';
  v_definition text;
  v_old text := $old$  with candidates as materialized (
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
      ) as logical_message_key
    from public.softora_mailbox_messages m
    where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
      and v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
  )
  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(distinct logical_message_key)::integer,
    pg_catalog.count(distinct logical_message_key)
      filter (where deleted_at is null)::integer,
    pg_catalog.count(*) filter (where deleted_at is not null)::integer,
    pg_catalog.count(*) filter (where normalized_message_id is null)::integer,
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
  from candidates;$old$;
  v_new text := $new$  with physical_candidates as materialized (
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
    where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
      and v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
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
    where provenance.status = 'accepted'
      and provenance.accepted_at is not null
      and normalized.normalized_message_id is not null
      and pg_catalog.lower(pg_catalog.btrim(provenance.account_email)) = any(v_owner_accounts)
      and pg_catalog.lower(pg_catalog.btrim(provenance.recipient_email)) = v_contact_email
      and pg_catalog.lower(pg_catalog.btrim(provenance.owner))
        = any(array['serve', 'martijn']::text[])
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
  from candidates;$new$;
  v_scope_pattern text := $pattern$v_contact_email = any\(public[.]softora_mailbox_message_participants\([[:space:]]*m[.]sender_email,[[:space:]]*m[.]recipients_text,[[:space:]]*m[.]payload[[:space:]]*\)\)$pattern$;
  v_scope_replacement text := $scope$v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
      and public.softora_mailbox_message_has_campaign_proof(
        m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
        m.references_text, m.sender_name, m.sender_email, m.recipients_text,
        m.subject, m.payload, v_contact_email, null
      )$scope$;
  v_matches integer;
  v_scope_matches integer;
begin
  if pg_catalog.to_regprocedure(v_signature) is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CONTACT_VISIBILITY_FUNCTION_MISSING';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(
    pg_catalog.to_regprocedure(v_signature)
  );
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, v_old, ''))
  ) / pg_catalog.char_length(v_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CONTACT_VISIBILITY_PROVENANCE_PATCH_DRIFT',
      detail = 'expected one candidate scan, found ' || v_matches::text;
  end if;
  v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  select pg_catalog.count(*)::integer
  into v_scope_matches
  from pg_catalog.regexp_matches(v_definition, v_scope_pattern, 'g');
  if v_scope_matches <> 8 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_CONTACT_VISIBILITY_CAMPAIGN_SCOPE_PATCH_DRIFT',
      detail = 'expected eight physical contact selectors, found '
        || v_scope_matches::text;
  end if;
  execute pg_catalog.regexp_replace(
    v_definition, v_scope_pattern, v_scope_replacement, 'g'
  );
end;
$patch_contact_visibility$;
