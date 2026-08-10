-- Deploy order (fail closed): apply this migration and verify the lineage
-- tables, refresh trigger, bounded RPC and ACLs before deploying the reader.
-- Rollback order: roll application code back first; then drop the RPC, trigger,
-- lineage tables and helpers after confirming no reader still requires them.

create table if not exists public.softora_mailbox_message_lineage_edges (
  account_email text not null,
  child_message_key text not null
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  child_message_id text,
  parent_message_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (child_message_key, parent_message_id),
  check (account_email = lower(btrim(account_email))),
  check (char_length(parent_message_id) between 1 and 1000)
);

create table if not exists public.softora_mailbox_campaign_lineage_roots (
  message_key text primary key
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  account_email text not null,
  message_id text not null,
  message_date timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (account_email = lower(btrim(account_email))),
  check (char_length(message_id) between 1 and 1000)
);

create table if not exists public.softora_mailbox_campaign_lineage_discoveries (
  message_key text not null
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  root_message_key text not null
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  account_email text not null,
  first_discovered_at timestamptz not null default clock_timestamp(),
  last_confirmed_at timestamptz not null default clock_timestamp(),
  active boolean not null default true,
  last_disconnected_at timestamptz,
  primary key (message_key, root_message_key),
  check (account_email = lower(btrim(account_email)))
);

create table if not exists public.softora_mailbox_campaign_lineage_members (
  message_key text primary key
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  account_email text not null,
  message_id text,
  parent_message_key text
    references public.softora_mailbox_campaign_lineage_members (message_key)
    on update cascade on delete cascade deferrable initially deferred,
  root_message_key text not null
    references public.softora_mailbox_messages (message_key)
    on update cascade on delete cascade,
  root_message_id text not null,
  lineage_depth integer not null,
  message_date timestamptz not null,
  is_incoming boolean not null,
  is_proven_automated boolean not null,
  lineage_discovered_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (account_email = lower(btrim(account_email))),
  check (lineage_depth >= 0),
  check (char_length(root_message_id) between 1 and 1000),
  check (
    (lineage_depth = 0 and parent_message_key is null and root_message_key = message_key)
    or (lineage_depth > 0 and parent_message_key is not null)
  )
);

create index if not exists softora_mailbox_lineage_parent_lookup_idx
  on public.softora_mailbox_message_lineage_edges (
    account_email, parent_message_id, child_message_key
  );
create index if not exists softora_mailbox_lineage_child_message_lookup_idx
  on public.softora_mailbox_message_lineage_edges (
    account_email, child_message_id, child_message_key
  ) where child_message_id is not null;
create index if not exists softora_mailbox_campaign_lineage_root_id_idx
  on public.softora_mailbox_campaign_lineage_roots (
    account_email, message_id, message_key
  );
create index if not exists softora_mailbox_campaign_lineage_discovery_idx
  on public.softora_mailbox_campaign_lineage_discoveries (
    account_email, first_discovered_at desc, message_key desc
  );
create index if not exists softora_mailbox_campaign_lineage_latest_idx
  on public.softora_mailbox_campaign_lineage_members (
    account_email, lineage_discovered_at desc, message_key desc
  ) where lineage_depth > 0 and is_incoming and not is_proven_automated;
create index if not exists softora_mailbox_campaign_lineage_message_date_idx
  on public.softora_mailbox_campaign_lineage_members (
    account_email, message_date desc, message_key desc
  ) where lineage_depth > 0 and is_incoming and not is_proven_automated;
create index if not exists softora_mailbox_campaign_lineage_parent_member_idx
  on public.softora_mailbox_campaign_lineage_members (parent_message_key)
  where parent_message_key is not null;

-- Enable RLS before any lineage backfill creates deferred foreign-key events;
-- PostgreSQL rejects ALTER TABLE while those events are pending in the transaction.
alter table public.softora_mailbox_message_lineage_edges enable row level security;
alter table public.softora_mailbox_campaign_lineage_roots enable row level security;
alter table public.softora_mailbox_campaign_lineage_discoveries enable row level security;
alter table public.softora_mailbox_campaign_lineage_members enable row level security;

create or replace function public.softora_normalize_mailbox_message_id(p_value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    lower(
      regexp_replace(
        btrim(coalesce(p_value, '')),
        '^[<>,[:space:]]+|[<>,[:space:]]+$',
        '',
        'g'
      )
    ),
    ''
  );
$$;

create index if not exists softora_mailbox_message_id_exact_lookup_idx
  on public.softora_mailbox_messages (
    account_email,
    public.softora_normalize_mailbox_message_id(message_id)
  ) where deleted_at is null and nullif(btrim(message_id), '') is not null;

create or replace function public.softora_mailbox_direct_parent_ids(
  p_in_reply_to text,
  p_references_text text
)
returns text[]
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_source text;
  v_token text;
  v_normalized text;
  v_ids text[] := '{}'::text[];
  v_uses_references boolean := nullif(btrim(coalesce(p_in_reply_to, '')), '') is null;
begin
  v_source := case
    when v_uses_references then coalesce(p_references_text, '')
    else coalesce(p_in_reply_to, '')
  end;
  foreach v_token in array regexp_split_to_array(
    regexp_replace(v_source, ',', ' ', 'g'),
    '[[:space:]]+'
  ) loop
    v_normalized := public.softora_normalize_mailbox_message_id(v_token);
    if v_normalized is not null and not v_normalized = any (v_ids) then
      v_ids := array_append(v_ids, v_normalized);
    end if;
  end loop;
  if v_uses_references and cardinality(v_ids) > 1 then
    return array[v_ids[cardinality(v_ids)]];
  end if;
  return v_ids;
end;
$$;

create or replace function public.softora_is_mailbox_campaign_root(
  p_folder text,
  p_subject text,
  p_in_reply_to text,
  p_references_text text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(p_folder, ''))) = 'sent'
    or (
      lower(btrim(coalesce(p_folder, ''))) = 'instantly'
      and lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'direction', ''))) = 'sent'
    )
  ) and (
    lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'originalCampaignOutbound', ''))) = 'true'
    or (
      nullif(btrim(coalesce(p_in_reply_to, '')), '') is null
      and nullif(btrim(coalesce(p_references_text, '')), '') is null
      and regexp_replace(
        lower(btrim(coalesce(p_subject, ''))),
        '^\s*((re|fw|fwd)\s*:\s*)+',
        '',
        'i'
      ) in ('kleine vraag over jullie website', 'nieuw webdesign')
    )
  );
$$;

create or replace function public.softora_is_mailbox_incoming_message(
  p_account_email text,
  p_folder text,
  p_sender_email text,
  p_recipients_text text,
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'direction', ''))) = 'sent'
      then false
    when lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'direction', ''))) = 'received'
      then lower(btrim(coalesce(p_folder, ''))) in ('coldmail', 'inbox', 'spam', 'instantly')
    when lower(btrim(coalesce(p_folder, ''))) = 'instantly'
      then false
    when lower(btrim(coalesce(p_folder, ''))) in ('coldmail', 'inbox', 'spam')
      then
        nullif(lower(btrim(coalesce(p_sender_email, ''))), '') is not null
        and lower(btrim(p_sender_email)) <> all (array[
          'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
          'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
          'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
          'contact.venvisuals@gmail.com'
        ]::text[])
    else false
  end;
$$;

create or replace function public.softora_has_proven_automated_reply(
  p_payload jsonb
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select (
    lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidenceKnown', ''))) = 'true'
    and lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidence', ''))) = 'true'
    and nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'automatedReplyEvidenceSource', '')), '') is not null
  ) or (
    nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'autoSubmitted', '')), '') is not null
    and lower(btrim(coalesce(p_payload, '{}'::jsonb)->>'autoSubmitted')) <> 'no'
  ) or lower(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'precedence', ''))) in (
    'auto_reply', 'auto-reply', 'bulk', 'junk', 'list'
  ) or (
    nullif(btrim(coalesce(coalesce(p_payload, '{}'::jsonb)->>'autoResponseSuppress', '')), '') is not null
    and lower(btrim(coalesce(p_payload, '{}'::jsonb)->>'autoResponseSuppress')) not in (
      '0', 'false', 'no', 'none', 'off'
    )
  );
$$;

create or replace function public.softora_preserve_mailbox_automated_reply_evidence()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_old_source text := btrim(coalesce(old.payload->>'automatedReplyEvidenceSource', ''));
  v_new_source text := btrim(coalesce(new.payload->>'automatedReplyEvidenceSource', ''));
  v_old_known boolean := lower(btrim(coalesce(old.payload->>'automatedReplyEvidenceKnown', ''))) = 'true'
    and v_old_source <> '';
  v_new_known boolean := lower(btrim(coalesce(new.payload->>'automatedReplyEvidenceKnown', ''))) = 'true'
    and v_new_source <> '';
  v_evidence boolean;
  v_source text;
begin
  if not v_old_known then return new; end if;

  v_evidence := lower(btrim(coalesce(old.payload->>'automatedReplyEvidence', ''))) = 'true'
    or (
      v_new_known
      and lower(btrim(coalesce(new.payload->>'automatedReplyEvidence', ''))) = 'true'
    );
  v_source := case
    when not v_new_known then v_old_source
    when position(v_old_source in v_new_source) > 0 then v_new_source
    when position(v_new_source in v_old_source) > 0 then v_old_source
    else v_old_source || '+' || v_new_source
  end;
  new.payload := jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(new.payload, '{}'::jsonb),
        '{automatedReplyEvidenceKnown}',
        'true'::jsonb,
        true
      ),
      '{automatedReplyEvidence}',
      to_jsonb(v_evidence),
      true
    ),
    '{automatedReplyEvidenceSource}',
    to_jsonb(v_source),
    true
  );
  return new;
end;
$$;

create or replace function public.softora_resolve_mailbox_campaign_lineage(
  p_account_email text,
  p_start_keys text[]
)
returns table (
  message_key text,
  account_email text,
  message_id text,
  parent_message_key text,
  root_message_key text,
  root_message_id text,
  lineage_depth integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive normalized_start as (
    select coalesce(array_agg(distinct message_key), '{}'::text[]) as message_keys
    from unnest(coalesce(p_start_keys, '{}'::text[])) as message_key
    where nullif(btrim(message_key), '') is not null
  ), seeds as (
    select
      messages.message_key,
      roots.account_email,
      public.softora_normalize_mailbox_message_id(messages.message_id) as message_id,
      null::text as parent_message_key,
      roots.message_key as root_message_key,
      roots.message_id as root_message_id,
      0::integer as lineage_depth,
      array[messages.message_key]::text[] as visited_keys
    from normalized_start
    join public.softora_mailbox_messages as messages
      on messages.message_key = any (normalized_start.message_keys)
      and messages.account_email = lower(btrim(p_account_email))
      and messages.deleted_at is null
    join public.softora_mailbox_campaign_lineage_roots as roots
      on roots.message_key = messages.message_key
      and roots.account_email = messages.account_email
    where (
      select count(*)
      from public.softora_mailbox_messages as exact_root
      where exact_root.account_email = roots.account_email
        and exact_root.deleted_at is null
        and public.softora_normalize_mailbox_message_id(exact_root.message_id) = roots.message_id
    ) = 1

    union all

    select
      child.message_key,
      child.account_email,
      public.softora_normalize_mailbox_message_id(child.message_id),
      parent_member.message_key,
      parent_member.root_message_key,
      parent_member.root_message_id,
      parent_member.lineage_depth + 1,
      array[parent_member.message_key, child.message_key]::text[]
    from normalized_start
    join public.softora_mailbox_messages as child
      on child.message_key = any (normalized_start.message_keys)
      and child.account_email = lower(btrim(p_account_email))
      and child.deleted_at is null
    join public.softora_mailbox_message_lineage_edges as edge
      on edge.child_message_key = child.message_key
      and edge.account_email = child.account_email
    join public.softora_mailbox_messages as exact_parent
      on exact_parent.account_email = child.account_email
      and exact_parent.deleted_at is null
      and public.softora_normalize_mailbox_message_id(exact_parent.message_id) = edge.parent_message_id
    join public.softora_mailbox_campaign_lineage_members as parent_member
      on parent_member.message_key = exact_parent.message_key
      and parent_member.account_email = child.account_email
    where not exists (
      select 1
      from public.softora_mailbox_campaign_lineage_roots as child_root
      where child_root.message_key = child.message_key
    )
      and (
        select count(*)
        from public.softora_mailbox_message_lineage_edges as child_edges
        where child_edges.child_message_key = child.message_key
      ) = 1
      and (
        select count(*)
        from public.softora_mailbox_messages as parent_candidates
        where parent_candidates.account_email = child.account_email
          and parent_candidates.deleted_at is null
          and public.softora_normalize_mailbox_message_id(parent_candidates.message_id) = edge.parent_message_id
      ) = 1
  ), lineage as (
    select seeds.* from seeds
    union all
    select
      child.message_key,
      child.account_email,
      public.softora_normalize_mailbox_message_id(child.message_id),
      lineage.message_key,
      lineage.root_message_key,
      lineage.root_message_id,
      lineage.lineage_depth + 1,
      lineage.visited_keys || child.message_key
    from lineage
    join public.softora_mailbox_message_lineage_edges as edge
      on edge.account_email = lineage.account_email
      and edge.parent_message_id = lineage.message_id
    join public.softora_mailbox_messages as child
      on child.message_key = edge.child_message_key
      and child.account_email = lineage.account_email
      and child.deleted_at is null
    where lineage.message_id is not null
      and not child.message_key = any (lineage.visited_keys)
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_roots as child_root
        where child_root.message_key = child.message_key
      )
      and (
        select count(*)
        from public.softora_mailbox_message_lineage_edges as child_edges
        where child_edges.child_message_key = child.message_key
      ) = 1
      and (
        select count(*)
        from public.softora_mailbox_messages as exact_parent
        where exact_parent.account_email = lineage.account_email
          and exact_parent.deleted_at is null
          and public.softora_normalize_mailbox_message_id(exact_parent.message_id) = lineage.message_id
      ) = 1
  )
  select
    lineage.message_key,
    lineage.account_email,
    lineage.message_id,
    lineage.parent_message_key,
    lineage.root_message_key,
    lineage.root_message_id,
    lineage.lineage_depth
  from lineage;
$$;

create or replace function public.softora_rebuild_mailbox_campaign_lineage(
  p_account_email text,
  p_start_keys text[],
  p_backfill boolean default false,
  p_previous_roots jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  insert into public.softora_mailbox_campaign_lineage_discoveries (
    message_key,
    root_message_key,
    account_email,
    first_discovered_at,
    last_confirmed_at
  )
  select
    resolved.message_key,
    resolved.root_message_key,
    resolved.account_email,
    case
      when p_backfill then coalesce(messages.created_at, clock_timestamp())
      else clock_timestamp()
    end,
    clock_timestamp()
  from public.softora_resolve_mailbox_campaign_lineage(
    p_account_email,
    p_start_keys
  ) as resolved
  join public.softora_mailbox_messages as messages
    on messages.message_key = resolved.message_key
  on conflict (message_key, root_message_key) do update set
    account_email = excluded.account_email,
    first_discovered_at = case
      when coalesce(p_previous_roots->>excluded.message_key, '') = excluded.root_message_key
        then softora_mailbox_campaign_lineage_discoveries.first_discovered_at
      else excluded.first_discovered_at
    end,
    last_confirmed_at = excluded.last_confirmed_at,
    active = true,
    last_disconnected_at = null;

  insert into public.softora_mailbox_campaign_lineage_members (
    message_key,
    account_email,
    message_id,
    parent_message_key,
    root_message_key,
    root_message_id,
    lineage_depth,
    message_date,
    is_incoming,
    is_proven_automated,
    lineage_discovered_at,
    created_at,
    updated_at
  )
  select
    resolved.message_key,
    resolved.account_email,
    resolved.message_id,
    resolved.parent_message_key,
    resolved.root_message_key,
    resolved.root_message_id,
    resolved.lineage_depth,
    messages.date,
    public.softora_is_mailbox_incoming_message(
      messages.account_email,
      messages.folder,
      messages.sender_email,
      messages.recipients_text,
      messages.payload
    ),
    public.softora_has_proven_automated_reply(messages.payload),
    discoveries.first_discovered_at,
    clock_timestamp(),
    clock_timestamp()
  from public.softora_resolve_mailbox_campaign_lineage(
    p_account_email,
    p_start_keys
  ) as resolved
  join public.softora_mailbox_campaign_lineage_discoveries as discoveries
    on discoveries.message_key = resolved.message_key
    and discoveries.root_message_key = resolved.root_message_key
  join public.softora_mailbox_messages as messages
    on messages.message_key = resolved.message_key
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    message_id = excluded.message_id,
    parent_message_key = excluded.parent_message_key,
    root_message_key = excluded.root_message_key,
    root_message_id = excluded.root_message_id,
    lineage_depth = excluded.lineage_depth,
    message_date = excluded.message_date,
    is_incoming = excluded.is_incoming,
    is_proven_automated = excluded.is_proven_automated,
    lineage_discovered_at = excluded.lineage_discovered_at,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.softora_refresh_mailbox_campaign_lineage_impacts(
  p_account_email text,
  p_message_key text,
  p_message_ids text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_account_email text := lower(btrim(coalesce(p_account_email, '')));
  v_message_ids text[];
  v_direct_keys text[];
  v_rebuild_keys text[];
  v_previous_roots jsonb;
begin
  if v_account_email = '' then return; end if;

  select coalesce(array_agg(distinct message_id), '{}'::text[])
  into v_message_ids
  from unnest(coalesce(p_message_ids, '{}'::text[])) as message_id
  where public.softora_normalize_mailbox_message_id(message_id) is not null;

  select coalesce(array_agg(distinct impacted.message_key), '{}'::text[])
  into v_direct_keys
  from (
    select p_message_key as message_key
    where nullif(btrim(coalesce(p_message_key, '')), '') is not null
    union
    select edges.child_message_key
    from public.softora_mailbox_message_lineage_edges as edges
    where edges.account_email = v_account_email
      and edges.parent_message_id = any (v_message_ids)
    union
    select roots.message_key
    from public.softora_mailbox_campaign_lineage_roots as roots
    where roots.account_email = v_account_email
      and roots.message_id = any (v_message_ids)
  ) as impacted;

  with recursive impacted_members as (
    select members.message_key
    from public.softora_mailbox_campaign_lineage_members as members
    where members.account_email = v_account_email
      and members.message_key = any (v_direct_keys)
    union
    select child.message_key
    from impacted_members
    join public.softora_mailbox_campaign_lineage_members as child
      on child.parent_message_key = impacted_members.message_key
  )
  select coalesce(array_agg(distinct message_key), '{}'::text[])
  into v_rebuild_keys
  from (
    select unnest(v_direct_keys) as message_key
    union
    select impacted_members.message_key from impacted_members
  ) as rebuild;

  select coalesce(jsonb_object_agg(members.message_key, members.root_message_key), '{}'::jsonb)
  into v_previous_roots
  from public.softora_mailbox_campaign_lineage_members as members
  where members.account_email = v_account_email
    and members.message_key = any (v_rebuild_keys);

  delete from public.softora_mailbox_campaign_lineage_members
  where account_email = v_account_email
    and message_key = any (v_rebuild_keys);

  perform public.softora_rebuild_mailbox_campaign_lineage(
    v_account_email,
    v_rebuild_keys,
    false,
    v_previous_roots
  );

  update public.softora_mailbox_campaign_lineage_discoveries as discoveries
  set
    active = false,
    last_disconnected_at = clock_timestamp()
  where discoveries.account_email = v_account_email
    and discoveries.message_key = any (v_rebuild_keys)
    and discoveries.active
    and not exists (
      select 1
      from public.softora_mailbox_campaign_lineage_members as current_member
      where current_member.message_key = discoveries.message_key
        and current_member.root_message_key = discoveries.root_message_key
    );
end;
$$;

create or replace function public.softora_refresh_mailbox_message_lineage()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_message_key text;
  v_old_account text;
  v_new_account text;
  v_old_message_id text;
  v_new_message_id text;
begin
  v_message_key := case when tg_op = 'DELETE' then old.message_key else new.message_key end;
  if tg_op = 'UPDATE'
    and old.account_email is not distinct from new.account_email
    and old.folder is not distinct from new.folder
    and old.message_id is not distinct from new.message_id
    and old.in_reply_to is not distinct from new.in_reply_to
    and old.references_text is not distinct from new.references_text
    and old.subject is not distinct from new.subject
    and old.sender_email is not distinct from new.sender_email
    and old.recipients_text is not distinct from new.recipients_text
    and old.deleted_at is not distinct from new.deleted_at
    and coalesce(old.payload->>'direction', '') is not distinct from coalesce(new.payload->>'direction', '')
    and coalesce(old.payload->>'originalCampaignOutbound', '') is not distinct from coalesce(new.payload->>'originalCampaignOutbound', '')
  then
    update public.softora_mailbox_campaign_lineage_members
    set
      message_date = new.date,
      is_incoming = public.softora_is_mailbox_incoming_message(
        new.account_email,
        new.folder,
        new.sender_email,
        new.recipients_text,
        new.payload
      ),
      is_proven_automated = public.softora_has_proven_automated_reply(new.payload),
      updated_at = clock_timestamp()
    where message_key = new.message_key
      and (
        message_date is distinct from new.date
        or is_incoming is distinct from public.softora_is_mailbox_incoming_message(
          new.account_email,
          new.folder,
          new.sender_email,
          new.recipients_text,
          new.payload
        )
        or is_proven_automated is distinct from public.softora_has_proven_automated_reply(new.payload)
      );
    if old.date is distinct from new.date then
      update public.softora_mailbox_campaign_lineage_roots
      set message_date = new.date, updated_at = clock_timestamp()
      where message_key = new.message_key;
    end if;
    return null;
  end if;
  v_old_account := case
    when tg_op = 'INSERT' then ''
    else lower(btrim(coalesce(old.account_email, '')))
  end;
  v_new_account := case
    when tg_op = 'DELETE' then ''
    else lower(btrim(coalesce(new.account_email, '')))
  end;
  v_old_message_id := case
    when tg_op = 'INSERT' then null
    else public.softora_normalize_mailbox_message_id(old.message_id)
  end;
  v_new_message_id := case
    when tg_op = 'DELETE' then null
    else public.softora_normalize_mailbox_message_id(new.message_id)
  end;

  delete from public.softora_mailbox_campaign_lineage_roots
  where message_key = v_message_key;
  delete from public.softora_mailbox_message_lineage_edges
  where child_message_key = v_message_key;

  if tg_op <> 'DELETE' and new.deleted_at is null then
    insert into public.softora_mailbox_message_lineage_edges (
      account_email,
      child_message_key,
      child_message_id,
      parent_message_id,
      created_at,
      updated_at
    )
    select
      v_new_account,
      new.message_key,
      v_new_message_id,
      parent_message_id,
      clock_timestamp(),
      clock_timestamp()
    from unnest(
      public.softora_mailbox_direct_parent_ids(new.in_reply_to, new.references_text)
    ) as parent_message_id
    where v_new_account <> ''
    on conflict (child_message_key, parent_message_id) do update set
      account_email = excluded.account_email,
      child_message_id = excluded.child_message_id,
      updated_at = clock_timestamp();

    if v_new_message_id is not null and public.softora_is_mailbox_campaign_root(
      new.folder, new.subject, new.in_reply_to, new.references_text, new.payload
    ) then
      insert into public.softora_mailbox_campaign_lineage_roots (
        message_key, account_email, message_id, message_date, created_at, updated_at
      ) values (
        new.message_key,
        v_new_account,
        v_new_message_id,
        new.date,
        clock_timestamp(),
        clock_timestamp()
      )
      on conflict (message_key) do update set
        account_email = excluded.account_email,
        message_id = excluded.message_id,
        message_date = excluded.message_date,
        updated_at = clock_timestamp();
    end if;
  end if;

  if v_old_account <> '' and v_old_account = v_new_account then
    perform public.softora_refresh_mailbox_campaign_lineage_impacts(
      v_old_account,
      v_message_key,
      array[v_old_message_id, v_new_message_id]
    );
  else
    if v_old_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_old_account,
        v_message_key,
        array[v_old_message_id]
      );
    end if;
    if v_new_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_new_account,
        v_message_key,
        array[v_new_message_id]
      );
    end if;
  end if;
  return null;
end;
$$;

-- Transactional cutover: block concurrent mailbox writes, install both write
-- guards, then backfill while the lock remains held until migration commit.
-- Writes queued during the backfill resume through the installed triggers.
lock table public.softora_mailbox_messages in share row exclusive mode;

drop trigger if exists softora_preserve_mailbox_automated_reply_evidence
  on public.softora_mailbox_messages;
create trigger softora_preserve_mailbox_automated_reply_evidence
before update of payload on public.softora_mailbox_messages
for each row execute function public.softora_preserve_mailbox_automated_reply_evidence();

drop trigger if exists softora_refresh_mailbox_message_lineage
  on public.softora_mailbox_messages;
create trigger softora_refresh_mailbox_message_lineage
after insert or update of account_email, folder, message_id, in_reply_to,
  references_text, sender_email, recipients_text, subject, date, payload, deleted_at
or delete on public.softora_mailbox_messages
for each row execute function public.softora_refresh_mailbox_message_lineage();

-- mailbox-campaign-lineage-backfill:start
insert into public.softora_mailbox_message_lineage_edges (
  account_email,
  child_message_key,
  child_message_id,
  parent_message_id,
  created_at,
  updated_at
)
select
  lower(btrim(messages.account_email)),
  messages.message_key,
  public.softora_normalize_mailbox_message_id(messages.message_id),
  parent_message_id,
  clock_timestamp(),
  clock_timestamp()
from public.softora_mailbox_messages as messages
cross join lateral unnest(
  public.softora_mailbox_direct_parent_ids(messages.in_reply_to, messages.references_text)
) as parent_message_id
where messages.deleted_at is null
  and nullif(lower(btrim(messages.account_email)), '') is not null
on conflict (child_message_key, parent_message_id) do update set
  account_email = excluded.account_email,
  child_message_id = excluded.child_message_id,
  updated_at = clock_timestamp();

insert into public.softora_mailbox_campaign_lineage_roots (
  message_key,
  account_email,
  message_id,
  message_date,
  created_at,
  updated_at
)
select
  messages.message_key,
  lower(btrim(messages.account_email)),
  public.softora_normalize_mailbox_message_id(messages.message_id),
  messages.date,
  clock_timestamp(),
  clock_timestamp()
from public.softora_mailbox_messages as messages
where messages.deleted_at is null
  and public.softora_normalize_mailbox_message_id(messages.message_id) is not null
  and public.softora_is_mailbox_campaign_root(
    messages.folder,
    messages.subject,
    messages.in_reply_to,
    messages.references_text,
    messages.payload
  )
on conflict (message_key) do update set
  account_email = excluded.account_email,
  message_id = excluded.message_id,
  message_date = excluded.message_date,
  updated_at = clock_timestamp();

do $$
declare
  v_account_email text;
  v_root_keys text[];
begin
  for v_account_email in
    select distinct roots.account_email
    from public.softora_mailbox_campaign_lineage_roots as roots
  loop
    select coalesce(array_agg(roots.message_key), '{}'::text[])
    into v_root_keys
    from public.softora_mailbox_campaign_lineage_roots as roots
    where roots.account_email = v_account_email;
    perform public.softora_rebuild_mailbox_campaign_lineage(
      v_account_email,
      v_root_keys,
      true
    );
  end loop;
end;
$$;

create or replace function public.softora_find_mailbox_campaign_lineage(
  p_account_emails text[],
  p_reply_limit integer default 200,
  p_max_depth integer default 20,
  p_max_context_messages integer default 9000,
  p_deadline_ms integer default 2500,
  p_before_message_date timestamptz default null,
  p_before_message_key text default null,
  p_before_discovered_at timestamptz default null,
  p_before_discovered_key text default null
)
returns table (
  message jsonb,
  lineage_depth integer,
  campaign_root_message_id text,
  lineage_discovered_at timestamptz,
  lineage_selected_reply boolean,
  lineage_selection_source text,
  lineage_has_more boolean,
  lineage_context_truncated boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_accounts text[];
  v_reply_limit integer := greatest(1, least(coalesce(p_reply_limit, 200), 200));
  v_max_depth integer := greatest(1, least(coalesce(p_max_depth, 20), 20));
  v_max_context integer := greatest(1, least(coalesce(p_max_context_messages, 9000), 9000));
  v_deadline_ms integer := greatest(250, least(coalesce(p_deadline_ms, 2500), 8000));
begin
  select coalesce(array_agg(distinct lower(btrim(account_email))), '{}'::text[])
  into v_accounts
  from unnest(coalesce(p_account_emails, '{}'::text[])) as account_email
  where nullif(lower(btrim(account_email)), '') is not null;

  if cardinality(v_accounts) < 1 or cardinality(v_accounts) > 12 then
    raise exception using errcode = '22023',
      message = 'Ongeldig aantal mailboxaccounts voor campagne-lineage';
  end if;
  if exists (
    select 1
    from unnest(v_accounts) as account_email
    where account_email <> all (array[
      'serve@softora.nl', 'servecreusen@softora.nl', 'servec321@gmail.com',
      'serve290@gmail.com', 'servecreusen7@gmail.com', 'martijn@softora.nl',
      'martijnvandeven@softora.nl', 'martijnven123@gmail.com',
      'contact.venvisuals@gmail.com'
    ]::text[])
  ) then
    raise exception using errcode = '22023',
      message = 'Onbekend mailboxaccount voor campagne-lineage';
  end if;

  perform set_config('statement_timeout', v_deadline_ms::text || 'ms', true);

  return query
  with recursive message_date_ranked as (
    select
      members.message_key,
      row_number() over (
        order by members.message_date desc, members.message_key desc
      ) as feed_rank
    from public.softora_mailbox_campaign_lineage_members as members
    where members.account_email = any (v_accounts)
      and members.lineage_depth > 0
      and members.is_incoming
      and not members.is_proven_automated
      and (
        p_before_message_date is null
        or (members.message_date, members.message_key) < (
          p_before_message_date,
          coalesce(p_before_message_key, '')
        )
      )
    order by members.message_date desc, members.message_key desc
    limit v_reply_limit + 1
  ), discovery_ranked as (
    select
      members.message_key,
      row_number() over (
        order by members.lineage_discovered_at desc, members.message_key desc
      ) as feed_rank
    from public.softora_mailbox_campaign_lineage_members as members
    where members.account_email = any (v_accounts)
      and members.lineage_depth > 0
      and members.is_incoming
      and not members.is_proven_automated
      and (
        p_before_discovered_at is null
        or (members.lineage_discovered_at, members.message_key) < (
          p_before_discovered_at,
          coalesce(p_before_discovered_key, '')
        )
      )
    order by members.lineage_discovered_at desc, members.message_key desc
    limit v_reply_limit + 1
  ), candidate_sources as (
    select message_key, 'message-date'::text as selection_source
    from message_date_ranked
    where feed_rank <= v_reply_limit
    union all
    select message_key, 'lineage-discovered'::text
    from discovery_ranked
    where feed_rank <= v_reply_limit
  ), selected_replies as (
    select
      candidate_sources.message_key,
      case
        when count(distinct candidate_sources.selection_source) = 2 then 'message-date+lineage-discovered'
        else min(candidate_sources.selection_source)
      end as selection_source
    from candidate_sources
    group by candidate_sources.message_key
  ), ancestor_walk as (
    select
      members.message_key,
      members.parent_message_key,
      0::integer as hops,
      true as selected_reply,
      selected_replies.selection_source
    from selected_replies
    join public.softora_mailbox_campaign_lineage_members as members
      on members.message_key = selected_replies.message_key
    union all
    select
      parent.message_key,
      parent.parent_message_key,
      ancestor_walk.hops + 1,
      false,
      'ancestor'::text
    from ancestor_walk
    join public.softora_mailbox_campaign_lineage_members as parent
      on parent.message_key = ancestor_walk.parent_message_key
    where ancestor_walk.hops < v_max_depth
  ), descendant_walk as (
    select
      members.message_key,
      0::integer as hops,
      true as selected_reply,
      selected_replies.selection_source
    from selected_replies
    join public.softora_mailbox_campaign_lineage_members as members
      on members.message_key = selected_replies.message_key
    union all
    select
      child.message_key,
      descendant_walk.hops + 1,
      false,
      'descendant'::text
    from descendant_walk
    join public.softora_mailbox_campaign_lineage_members as child
      on child.parent_message_key = descendant_walk.message_key
    where descendant_walk.hops < v_max_depth
  ), root_context as (
    select
      roots.message_key,
      false as selected_reply,
      'root-context'::text as selection_source
    from selected_replies
    join public.softora_mailbox_campaign_lineage_members as selected_member
      on selected_member.message_key = selected_replies.message_key
    join public.softora_mailbox_campaign_lineage_members as roots
      on roots.message_key = selected_member.root_message_key
  ), context_candidates as (
    select
      ancestor_walk.message_key,
      ancestor_walk.selected_reply,
      ancestor_walk.selection_source
    from ancestor_walk
    union all
    select
      root_context.message_key,
      root_context.selected_reply,
      root_context.selection_source
    from root_context
    union all
    select
      descendant_walk.message_key,
      descendant_walk.selected_reply,
      descendant_walk.selection_source
    from descendant_walk
    where descendant_walk.hops > 0
  ), selected_context as (
    select
      context_candidates.message_key,
      bool_or(context_candidates.selected_reply) as selected_reply,
      case
        when bool_or(context_candidates.selected_reply)
          then min(context_candidates.selection_source) filter (where context_candidates.selected_reply)
        when bool_or(context_candidates.selection_source = 'root-context') then 'root-context'::text
        when bool_or(context_candidates.selection_source = 'ancestor') then 'ancestor'::text
        when bool_or(context_candidates.selection_source = 'descendant') then 'descendant'::text
        else 'context'::text
      end as selection_source
    from context_candidates
    group by context_candidates.message_key
  ), page_state as (
    select
      (
        exists (select 1 from message_date_ranked where feed_rank > v_reply_limit)
        or exists (select 1 from discovery_ranked where feed_rank > v_reply_limit)
      ) as has_more,
      (
        exists (
          select 1
          from selected_replies
          join public.softora_mailbox_campaign_lineage_members as selected_member
            on selected_member.message_key = selected_replies.message_key
          where selected_member.lineage_depth > v_max_depth
        )
        or exists (
          select 1
          from descendant_walk
          join public.softora_mailbox_campaign_lineage_members as next_descendant
            on next_descendant.parent_message_key = descendant_walk.message_key
          where descendant_walk.hops = v_max_depth
        )
        or (select count(*) from selected_context) > v_max_context
      ) as context_truncated
  ), capped_context as (
    select selected_context.*
    from selected_context
    order by
      selected_context.selected_reply desc,
      (selected_context.selection_source = 'root-context') desc,
      selected_context.message_key desc
    limit v_max_context
  )
  select
    to_jsonb(messages) as message,
    members.lineage_depth,
    members.root_message_id as campaign_root_message_id,
    members.lineage_discovered_at,
    capped_context.selected_reply as lineage_selected_reply,
    capped_context.selection_source as lineage_selection_source,
    page_state.has_more as lineage_has_more,
    page_state.context_truncated as lineage_context_truncated
  from capped_context
  join public.softora_mailbox_campaign_lineage_members as members
    on members.message_key = capped_context.message_key
  join public.softora_mailbox_messages as messages
    on messages.message_key = capped_context.message_key
    and messages.deleted_at is null
  cross join page_state
  order by capped_context.selected_reply desc, messages.date desc, messages.message_key desc;
end;
$$;

revoke all on table public.softora_mailbox_message_lineage_edges
  from public, anon, authenticated;
revoke all on table public.softora_mailbox_campaign_lineage_roots
  from public, anon, authenticated;
revoke all on table public.softora_mailbox_campaign_lineage_discoveries
  from public, anon, authenticated;
revoke all on table public.softora_mailbox_campaign_lineage_members
  from public, anon, authenticated;
revoke all on function public.softora_normalize_mailbox_message_id(text)
  from public, anon, authenticated;
revoke all on function public.softora_mailbox_direct_parent_ids(text, text)
  from public, anon, authenticated;
revoke all on function public.softora_is_mailbox_campaign_root(text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_is_mailbox_incoming_message(text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_has_proven_automated_reply(jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_preserve_mailbox_automated_reply_evidence()
  from public, anon, authenticated;
revoke all on function public.softora_resolve_mailbox_campaign_lineage(text, text[])
  from public, anon, authenticated;
revoke all on function public.softora_rebuild_mailbox_campaign_lineage(text, text[], boolean, jsonb)
  from public, anon, authenticated;
revoke all on function public.softora_refresh_mailbox_campaign_lineage_impacts(text, text, text[])
  from public, anon, authenticated;
revoke all on function public.softora_refresh_mailbox_message_lineage()
  from public, anon, authenticated;
revoke all on function public.softora_find_mailbox_campaign_lineage(
  text[], integer, integer, integer, integer, timestamptz, text, timestamptz, text
) from public, anon, authenticated;

grant select, insert, update, delete
  on table public.softora_mailbox_message_lineage_edges to service_role;
grant select, insert, update, delete
  on table public.softora_mailbox_campaign_lineage_roots to service_role;
grant select, insert, update, delete
  on table public.softora_mailbox_campaign_lineage_discoveries to service_role;
grant select, insert, update, delete
  on table public.softora_mailbox_campaign_lineage_members to service_role;
grant execute on function public.softora_normalize_mailbox_message_id(text)
  to service_role;
grant execute on function public.softora_mailbox_direct_parent_ids(text, text)
  to service_role;
grant execute on function public.softora_is_mailbox_campaign_root(text, text, text, text, jsonb)
  to service_role;
grant execute on function public.softora_is_mailbox_incoming_message(text, text, text, text, jsonb)
  to service_role;
grant execute on function public.softora_has_proven_automated_reply(jsonb)
  to service_role;
grant execute on function public.softora_preserve_mailbox_automated_reply_evidence()
  to service_role;
grant execute on function public.softora_resolve_mailbox_campaign_lineage(text, text[])
  to service_role;
grant execute on function public.softora_rebuild_mailbox_campaign_lineage(text, text[], boolean, jsonb)
  to service_role;
grant execute on function public.softora_refresh_mailbox_campaign_lineage_impacts(text, text, text[])
  to service_role;
grant execute on function public.softora_refresh_mailbox_message_lineage()
  to service_role;
grant execute on function public.softora_find_mailbox_campaign_lineage(
  text[], integer, integer, integer, integer, timestamptz, text, timestamptz, text
) to service_role;
