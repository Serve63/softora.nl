-- Production migration version 20260820171023.
-- Mailbox search has two distinct identity layers:
--   1. a contact dossier is canonical owner + exact external email;
--   2. a logical message is exact mailbox account + normalized RFC Message-ID.
-- Keep the existing technical-thread search RPC intact for compatibility and
-- add owner-aware contact search plus durable logical visibility tombstones.

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
        '[^a-z0-9]+',
        ' ',
        'g'
      )) as query_lexemes,
      greatest(1, least(40, coalesce(p_limit, 20))) as page_limit,
      greatest(0, least(5000, coalesce(p_offset, 0))) as page_offset
  ), owner_account_values as materialized (
    select
      pg_catalog.lower(pg_catalog.btrim(owner_entry.key)) as canonical_owner,
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_value))
        from pg_catalog.jsonb_array_elements_text(
          case
            when pg_catalog.jsonb_typeof(owner_entry.value) = 'array' then owner_entry.value
            else '[]'::jsonb
          end
        ) as account(account_value)
        where nullif(pg_catalog.btrim(account_value), '') is not null
      ) as account_emails
    from pg_catalog.jsonb_each(
      case
        when pg_catalog.jsonb_typeof(coalesce(p_owner_accounts, '{}'::jsonb)) = 'object'
          then coalesce(p_owner_accounts, '{}'::jsonb)
        else '{}'::jsonb
      end
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
  ), candidates as materialized (
    select
      owners.canonical_owner,
      owners.account_emails,
      m.message_key,
      m.date,
      m.sender_name,
      m.sender_email,
      pg_catalog.concat_ws(
        ' ', m.recipients_text, m.payload->>'toDisplay', m.payload->>'cc',
        m.payload->>'bcc', m.payload->>'replyTo'
      ) as recipient_names,
      m.subject,
      m.preview,
      m.body_text,
      public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ) as participant_emails,
      public.softora_mailbox_technical_thread_key(
        m.account_email, m.provider_id, m.message_id, m.in_reply_to,
        m.references_text, m.payload
      ) as thread_key
    from public.softora_mailbox_messages m
    join owner_accounts owners
      on pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(owners.account_emails)
    cross join params p
    where m.deleted_at is null
      and m.generation_superseded_at is null
      and pg_catalog.length(p.query_lexemes) >= 2
      and m.search_document ~ (
        '(^|[^a-z0-9])'
        || pg_catalog.replace(p.query_lexemes, ' ', '[^a-z0-9]+')
      )
  ), eligible_matches as materialized (
    select
      candidates.*,
      participant.contact_email,
      case
        when public.softora_mailbox_search_word_prefix(candidates.sender_email, p.query) then 600
        when public.softora_mailbox_search_word_prefix(candidates.recipient_names, p.query) then 550
        when public.softora_mailbox_search_word_prefix(candidates.sender_name, p.query) then 500
        when public.softora_mailbox_search_word_prefix(candidates.subject, p.query) then 400
        when public.softora_mailbox_search_word_prefix(candidates.preview, p.query) then 200
        else 100
      end as match_rank
    from candidates
    cross join params p
    cross join lateral pg_catalog.unnest(candidates.participant_emails)
      as participant(contact_email)
    join eligible_contacts eligible
      on eligible.canonical_owner = candidates.canonical_owner
      and eligible.contact_email = participant.contact_email
    where participant.contact_email <> all(candidates.account_emails)
  ), contact_matches as materialized (
    select distinct on (
      eligible_matches.canonical_owner,
      eligible_matches.contact_email
    ) eligible_matches.*
    from eligible_matches
    order by
      eligible_matches.canonical_owner,
      eligible_matches.contact_email,
      eligible_matches.match_rank desc,
      eligible_matches.date desc,
      eligible_matches.message_key desc
  ), paged as materialized (
    select contact_matches.*, pg_catalog.count(*) over () as result_count
    from contact_matches
    order by contact_matches.match_rank desc, contact_matches.date desc,
      contact_matches.message_key desc
    limit (select page_limit from params)
    offset (select page_offset from params)
  ), hydrated as (
    select
      m.*,
      paged.canonical_owner,
      paged.thread_key,
      paged.contact_email,
      paged.match_rank,
      paged.result_count
    from paged
    join public.softora_mailbox_messages m on m.message_key = paged.message_key
  ), resolved as (
    select
      hydrated.*,
      case
        when public.softora_mailbox_search_word_prefix(hydrated.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(hydrated.sender_name, p.query)
          then 'afzender'
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', hydrated.recipients_text, hydrated.payload->>'toDisplay', hydrated.payload->>'cc'
        ), p.query) then 'ontvanger'
        when public.softora_mailbox_search_word_prefix(hydrated.subject, p.query) then 'onderwerp'
        else 'inhoud'
      end as resolved_match_field,
      case
        when public.softora_mailbox_search_word_prefix(hydrated.sender_email, p.query)
          or public.softora_mailbox_search_word_prefix(hydrated.sender_name, p.query)
          then pg_catalog.left(pg_catalog.concat_ws(
            ' · ', hydrated.sender_name, hydrated.sender_email
          ), 240)
        when public.softora_mailbox_search_word_prefix(pg_catalog.concat_ws(
          ' ', hydrated.recipients_text, hydrated.payload->>'toDisplay', hydrated.payload->>'cc'
        ), p.query)
          then pg_catalog.left(pg_catalog.concat_ws(
            ' ', hydrated.recipients_text, hydrated.payload->>'toDisplay', hydrated.payload->>'cc'
          ), 240)
        when public.softora_mailbox_search_word_prefix(hydrated.subject, p.query)
          then pg_catalog.left(hydrated.subject, 240)
        when public.softora_mailbox_search_word_prefix(hydrated.preview, p.query)
          then pg_catalog.left(hydrated.preview, 240)
        else pg_catalog.substr(
          pg_catalog.regexp_replace(coalesce(hydrated.body_text, ''), '\\s+', ' ', 'g'),
          greatest(1, pg_catalog.strpos(
            public.softora_mailbox_search_normalize(hydrated.body_text), p.query
          ) - 70),
          240
        )
      end as resolved_match_snippet
    from hydrated
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
      coalesce(resolved.resolved_match_snippet, ''), '\\s+', ' ', 'g'
    ), 240),
    resolved.message_key, resolved.result_count
  from resolved
  order by resolved.match_rank desc, resolved.date desc, resolved.message_key desc;
$function$;

revoke all on function public.softora_search_mailbox_contact_dossiers(
  jsonb, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.softora_search_mailbox_contact_dossiers(
  jsonb, text, integer, integer
) to service_role;

create or replace function public.softora_normalize_mailbox_message_id(
  p_value text
)
returns text
language sql
immutable
set search_path = ''
as $function$
  select nullif(
    pg_catalog.lower(
      pg_catalog.regexp_replace(
        pg_catalog.btrim(coalesce(p_value, '')),
        '^[<>,[:space:]]+|[<>,[:space:]]+$',
        '',
        'g'
      )
    ),
    ''
  );
$function$;

create table if not exists public.softora_mailbox_message_tombstones (
  account_email text not null,
  normalized_message_id text not null,
  deleted_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (account_email, normalized_message_id),
  constraint softora_mailbox_message_tombstones_account_normalized_check
    check (
      account_email <> ''
      and account_email = pg_catalog.lower(pg_catalog.btrim(account_email))
    ),
  constraint softora_mailbox_message_tombstones_message_id_normalized_check
    check (
      public.softora_normalize_mailbox_message_id(normalized_message_id) is not null
      and normalized_message_id
        = public.softora_normalize_mailbox_message_id(normalized_message_id)
    )
);

alter table public.softora_mailbox_message_tombstones enable row level security;

revoke all privileges on table public.softora_mailbox_message_tombstones
  from public, anon, authenticated;
grant select, insert, update, delete on table public.softora_mailbox_message_tombstones
  to service_role;

create index if not exists softora_mailbox_messages_logical_message_active_idx
on public.softora_mailbox_messages (
  (pg_catalog.lower(pg_catalog.btrim(account_email))),
  (public.softora_normalize_mailbox_message_id(message_id))
)
where generation_superseded_at is null
  and public.softora_normalize_mailbox_message_id(message_id) is not null;

create or replace function public.softora_inherit_mailbox_message_tombstone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_email text;
  v_message_id text;
  v_deleted_at timestamptz;
begin
  v_account_email := pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email, '')));
  v_message_id := public.softora_normalize_mailbox_message_id(new.message_id);
  if v_account_email = '' or v_message_id is null then
    return new;
  end if;

  -- INSERT has not acquired a message-row lock yet, so it can safely take the
  -- same logical lock as the visibility RPC. UPDATE already owns its row lock;
  -- taking the advisory lock there would invert the RPC order and can deadlock.
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(v_account_email),
      pg_catalog.hashtext(v_message_id)
    );
  end if;
  select tombstone.deleted_at
  into v_deleted_at
  from public.softora_mailbox_message_tombstones tombstone
  where tombstone.account_email = v_account_email
    and tombstone.normalized_message_id = v_message_id;

  if v_deleted_at is not null then
    new.deleted_at := v_deleted_at;
  elsif tg_op = 'UPDATE'
    and old.deleted_at is null
    and new.deleted_at is not null
    and old.generation_superseded_at is null
    and new.generation_superseded_at is null then
    -- Compatibility for the production version that predates the visibility
    -- RPC: a legacy direct hide must still create durable logical intent. The
    -- statement-level campaign lock is already held before this row trigger,
    -- so this keeps the global -> row/tombstone order without adding the
    -- advisory lock after a row lock. A direct NULL update never removes the
    -- tombstone; only the serialized visibility RPC may restore a message.
    -- UIDVALIDITY retirement also sets deleted_at, but is system lifecycle
    -- state rather than user deletion intent and must never mint a tombstone.
    insert into public.softora_mailbox_message_tombstones as tombstone (
      account_email, normalized_message_id, deleted_at, updated_at
    ) values (
      v_account_email, v_message_id, new.deleted_at, pg_catalog.now()
    )
    on conflict on constraint softora_mailbox_message_tombstones_pkey do update
    set
      deleted_at = least(tombstone.deleted_at, excluded.deleted_at),
      updated_at = excluded.updated_at
    returning deleted_at into v_deleted_at;
    new.deleted_at := v_deleted_at;
  end if;
  return new;
end;
$function$;

drop trigger if exists softora_mailbox_messages_inherit_logical_tombstone
  on public.softora_mailbox_messages;
create trigger softora_mailbox_messages_inherit_logical_tombstone
before insert or update of account_email, message_id, deleted_at
on public.softora_mailbox_messages
for each row execute function public.softora_inherit_mailbox_message_tombstone();

-- Deliberately do not backfill tombstones from historical deleted_at rows here.
-- Old deletes can be ambiguous and a broad migration-time update could hide
-- unrelated mailbox copies. Only an explicit visibility action after this
-- migration creates durable logical intent; known legacy incidents are repaired
-- separately by exact account + RFC Message-ID through the same RPC.

create or replace function public.softora_set_mailbox_message_visibility(
  p_account_email text,
  p_folder text,
  p_uid bigint,
  p_provider_id text,
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
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, 'inbox')));
  v_provider_id text := pg_catalog.btrim(coalesce(p_provider_id, ''));
  v_message_id text;
  v_changed_at timestamptz := pg_catalog.now();
  v_anchor public.softora_mailbox_messages%rowtype;
begin
  -- Every mailbox-message write already takes this campaign lock through the
  -- statement trigger. Taking it here first keeps one global lock order:
  -- campaign consistency -> logical RFC ID -> concrete message row.
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;

  select m.*
  into v_anchor
  from public.softora_mailbox_messages m
  where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_account_email
    and pg_catalog.lower(pg_catalog.btrim(m.folder)) = v_folder
    and m.generation_superseded_at is null
    and (
      (coalesce(p_uid, 0) > 0 and m.uid = p_uid)
      or (
        coalesce(p_uid, 0) <= 0
        and v_provider_id <> ''
        and m.provider_id = v_provider_id
      )
    )
  order by m.updated_at desc nulls last, m.message_key
  limit 1;

  if not found then
    return;
  end if;

  v_message_id := public.softora_normalize_mailbox_message_id(v_anchor.message_id);
  if v_message_id is null then
    select m.*
    into v_anchor
    from public.softora_mailbox_messages m
    where m.message_key = v_anchor.message_key
      and m.generation_superseded_at is null
    for update;
    if not found then
      return;
    end if;
    if public.softora_normalize_mailbox_message_id(v_anchor.message_id) is not null then
      raise exception using
        errcode = '40001',
        message = 'Mailbox Message-ID veranderde tijdens zichtbaarheidstransactie.';
    end if;
    return query
      update public.softora_mailbox_messages as m
      set
        deleted_at = case when p_hidden then v_changed_at else null end,
        updated_at = v_changed_at
      where m.message_key = v_anchor.message_key
      returning m.message_key, m.account_email, m.folder, m.uid,
        m.provider_id, m.message_id;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_account_email),
    pg_catalog.hashtext(v_message_id)
  );

  select m.*
  into v_anchor
  from public.softora_mailbox_messages m
  where m.message_key = v_anchor.message_key
    and m.generation_superseded_at is null
  for update;
  if not found then
    return;
  end if;
  if public.softora_normalize_mailbox_message_id(v_anchor.message_id)
    is distinct from v_message_id then
    raise exception using
      errcode = '40001',
      message = 'Mailbox Message-ID veranderde tijdens zichtbaarheidstransactie.';
  end if;

  if p_hidden then
    insert into public.softora_mailbox_message_tombstones as tombstone (
      account_email, normalized_message_id, deleted_at, updated_at
    ) values (
      v_account_email, v_message_id, v_changed_at, v_changed_at
    )
    on conflict on constraint softora_mailbox_message_tombstones_pkey do update
    set deleted_at = excluded.deleted_at, updated_at = excluded.updated_at;
  else
    delete from public.softora_mailbox_message_tombstones tombstone
    where tombstone.account_email = v_account_email
      and tombstone.normalized_message_id = v_message_id;
  end if;

  return query
    update public.softora_mailbox_messages as m
    set
      deleted_at = case when p_hidden then v_changed_at else null end,
      updated_at = v_changed_at
    where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_account_email
      and m.generation_superseded_at is null
      and public.softora_normalize_mailbox_message_id(m.message_id) = v_message_id
    returning m.message_key, m.account_email, m.folder, m.uid,
      m.provider_id, m.message_id;
end;
$function$;

revoke all on function public.softora_normalize_mailbox_message_id(text)
  from public, anon, authenticated;
revoke all on function public.softora_inherit_mailbox_message_tombstone()
  from public, anon, authenticated;
revoke all on function public.softora_set_mailbox_message_visibility(
  text, text, bigint, text, boolean
) from public, anon, authenticated;
grant execute on function public.softora_normalize_mailbox_message_id(text)
  to service_role;
grant execute on function public.softora_inherit_mailbox_message_tombstone()
  to service_role;
grant execute on function public.softora_set_mailbox_message_visibility(
  text, text, bigint, text, boolean
) to service_role;
