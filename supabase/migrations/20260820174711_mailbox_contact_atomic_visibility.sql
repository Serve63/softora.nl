-- Hide or restore one complete outreach contact dossier across every mailbox
-- account that belongs to the server-selected canonical owner. The caller
-- proves the visible logical timeline count before a hide; PostgreSQL repeats
-- that count under the global mailbox write fence before changing anything.

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

  -- Every mailbox write takes this row first through the statement trigger.
  -- Waiting here therefore serializes sync inserts/upserts with this RPC before
  -- any logical or concrete message lock is acquired.
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;
  perform 1
  from public.softora_mailbox_campaign_consistency
  where scope = 'campaign'
  for update;

  select m.message_key
  into v_anchor_message_key
  from public.softora_mailbox_messages m
  where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_anchor_account_email
    and pg_catalog.lower(pg_catalog.btrim(m.folder)) = v_anchor_folder
    and m.provider_id = v_anchor_provider_id
    and (
      (coalesce(p_anchor_uid, 0) > 0 and m.uid = p_anchor_uid)
      or (coalesce(p_anchor_uid, 0) = 0 and m.uid >= 0)
    )
    and m.generation_superseded_at is null
    and v_contact_email = any(public.softora_mailbox_message_participants(
      m.sender_email, m.recipients_text, m.payload
    ))
  order by m.updated_at desc nulls last, m.message_key
  limit 1;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Mailbox-contactanker ontbreekt of valt buiten de gekozen eigenaar.';
  end if;

  with candidates as materialized (
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
  from candidates;

  -- A provider/fallback key makes the completeness count deterministic, but a
  -- durable future-copy tombstone requires a real RFC Message-ID. A hide fails
  -- closed when one is missing; restore remains able to repair legacy partial
  -- state because making a row visible needs no future-copy tombstone.
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

  -- Match the INSERT trigger's advisory key and acquire every owner/RFC pair
  -- in a deterministic order. Cartesian tombstones ensure that a later copy on
  -- another account of the same owner immediately inherits the hidden state.
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

  -- Lock every concrete non-superseded copy only after the global and logical
  -- locks. The global fence makes the set stable; this row lock also documents
  -- and enforces the concrete final step in the shared lock order.
  for v_lock in
    select m.message_key
    from public.softora_mailbox_messages m
    where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
      and v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
    order by m.message_key
    for update
  loop
    null;
  end loop;

  if not exists (
    select 1
    from public.softora_mailbox_messages m
    where m.message_key = v_anchor_message_key
      and pg_catalog.lower(pg_catalog.btrim(m.account_email)) = v_anchor_account_email
      and pg_catalog.lower(pg_catalog.btrim(m.folder)) = v_anchor_folder
      and m.provider_id = v_anchor_provider_id
      and (
        (coalesce(p_anchor_uid, 0) > 0 and m.uid = p_anchor_uid)
        or (coalesce(p_anchor_uid, 0) = 0 and m.uid >= 0)
      )
      and m.generation_superseded_at is null
      and v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
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
      -- Idempotent replay after the first transaction committed but its RPC
      -- response was lost. Return the same physical dossier without rewriting.
      return query
        select m.message_key, m.account_email, m.folder, m.uid,
          m.provider_id, m.message_id
        from public.softora_mailbox_messages m
        where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
          and m.generation_superseded_at is null
          and v_contact_email = any(public.softora_mailbox_message_participants(
            m.sender_email, m.recipients_text, m.payload
          ))
        order by m.date desc, m.message_key desc;
      return;
    end if;

    if v_active_logical_count <> p_expected_message_count then
      raise exception using
        errcode = '22023',
        message = 'Mailbox-contacttijdlijn veranderde tijdens de volledige controle.';
    end if;

    -- This broad RPC must never turn the deliberately narrow outreach view
    -- into a general inbox-deletion primitive. Existing fully hidden state is
    -- replayable above; every state-changing hide still needs current outreach
    -- evidence from the same owner-scoped predicate as discovery.
    if not public.softora_mailbox_is_outreach_contact(
      v_owner_accounts,
      v_contact_email
    ) then
      raise exception using
        errcode = '22023',
        message = 'Mailbox-contact hoort niet bij de gecontroleerde outreachscope.';
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
      where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
        and m.generation_superseded_at is null
        and v_contact_email = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
      returning m.message_key, m.account_email, m.folder, m.uid,
        m.provider_id, m.message_id;
    return;
  end if;

  if v_hidden_physical_count = 0 and v_tombstone_count = 0 then
    -- Idempotent restore replay: every physical copy is already visible and no
    -- owner/RFC tombstone remains. Again, return without changing timestamps.
    return query
      select m.message_key, m.account_email, m.folder, m.uid,
        m.provider_id, m.message_id
      from public.softora_mailbox_messages m
      where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
        and m.generation_superseded_at is null
        and v_contact_email = any(public.softora_mailbox_message_participants(
          m.sender_email, m.recipients_text, m.payload
        ))
      order by m.date desc, m.message_key desc;
    return;
  end if;

  delete from public.softora_mailbox_message_tombstones tombstone
  where tombstone.account_email = any(v_owner_accounts)
    and tombstone.normalized_message_id = any(v_message_ids);

  return query
    update public.softora_mailbox_messages as m
    set deleted_at = null, updated_at = v_changed_at
    where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any(v_owner_accounts)
      and m.generation_superseded_at is null
      and v_contact_email = any(public.softora_mailbox_message_participants(
        m.sender_email, m.recipients_text, m.payload
      ))
    returning m.message_key, m.account_email, m.folder, m.uid,
      m.provider_id, m.message_id;
end;
$function$;

revoke all on function public.softora_set_mailbox_contact_visibility(
  text[], text, text, text, bigint, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.softora_set_mailbox_contact_visibility(
  text[], text, text, text, bigint, text, integer, boolean
) to service_role;
