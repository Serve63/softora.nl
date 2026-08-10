-- Deploy order: apply after the durable lineage foundation and before the
-- application reader. Exact provider replicas become one logical message.
-- Conflicting rows that reuse a Message-ID remain fail-closed and invisible.
-- Rollback order: roll application readers back before changing this resolver.

create index if not exists softora_mailbox_campaign_lineage_discovery_root_idx
  on public.softora_mailbox_campaign_lineage_discoveries (
    root_message_key, message_key
  );
create index if not exists softora_mailbox_campaign_lineage_member_root_idx
  on public.softora_mailbox_campaign_lineage_members (
    root_message_key, message_key
  );

-- Hold mailbox writes across resolver replacement and the one-time rebuild.
-- Queued writes resume through the existing lineage trigger after commit.
lock table public.softora_mailbox_messages in share row exclusive mode;

create or replace function public.softora_canonical_mailbox_message_key(
  p_account_email text,
  p_message_id text
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      messages.message_key,
      jsonb_build_array(
        lower(btrim(coalesce(messages.sender_email, ''))),
        lower(btrim(coalesce(messages.recipients_text, ''))),
        lower(btrim(coalesce(messages.subject, ''))),
        messages.date,
        public.softora_normalize_mailbox_message_id(messages.in_reply_to),
        lower(btrim(coalesce(messages.references_text, '')))
      )::text as replica_signature,
      case
        when public.softora_is_mailbox_campaign_root(
          messages.folder,
          messages.subject,
          messages.in_reply_to,
          messages.references_text,
          messages.payload
        ) then 0
        when lower(btrim(messages.folder)) = 'sent' then 1
        when lower(btrim(messages.folder)) = 'instantly'
          and lower(btrim(coalesce(messages.payload->>'direction', ''))) = 'sent'
          then 1
        when lower(btrim(messages.folder)) = 'coldmail' then 2
        else 3
      end as source_priority,
      case
        when messages.has_body and not messages.body_truncated then 0
        when messages.has_body then 1
        else 2
      end as body_priority
    from public.softora_mailbox_messages as messages
    where messages.account_email = lower(btrim(coalesce(p_account_email, '')))
      and messages.deleted_at is null
      and public.softora_normalize_mailbox_message_id(messages.message_id)
        = public.softora_normalize_mailbox_message_id(p_message_id)
  ), resolved as (
    select
      count(distinct candidates.replica_signature) as signature_count,
      (
        array_agg(
          candidates.message_key
          order by
            candidates.source_priority,
            candidates.body_priority,
            candidates.message_key
        )
      )[1] as canonical_message_key
    from candidates
  )
  select case
    when resolved.signature_count = 1 then resolved.canonical_message_key
    else null
  end
  from resolved;
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
    select coalesce(array_agg(distinct resolved.message_key), '{}'::text[]) as message_keys
    from (
      select case
        when public.softora_normalize_mailbox_message_id(start_message.message_id) is null
          then start_message.message_key
        else public.softora_canonical_mailbox_message_key(
          start_message.account_email,
          start_message.message_id
        )
      end as message_key
      from unnest(coalesce(p_start_keys, '{}'::text[])) as requested(message_key)
      join public.softora_mailbox_messages as start_message
        on start_message.message_key = requested.message_key
        and start_message.account_email = lower(btrim(p_account_email))
        and start_message.deleted_at is null
      where nullif(btrim(requested.message_key), '') is not null
    ) as resolved
    where resolved.message_key is not null
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
      on exact_parent.message_key = public.softora_canonical_mailbox_message_key(
        child.account_email,
        edge.parent_message_id
      )
      and exact_parent.account_email = child.account_email
      and exact_parent.deleted_at is null
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
      and (
        public.softora_normalize_mailbox_message_id(child.message_id) is null
        or child.message_key = public.softora_canonical_mailbox_message_key(
          child.account_email,
          child.message_id
        )
      )
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

-- Rebuild every account from all known roots. Existing discovery timestamps
-- survive when the canonical message key and root remain the same. Newly
-- connected historical replicas keep their original database creation time.
do $$
declare
  v_account_email text;
  v_root_keys text[];
  v_previous_roots jsonb;
begin
  for v_account_email in
    select distinct roots.account_email
    from public.softora_mailbox_campaign_lineage_roots as roots
    order by roots.account_email
  loop
    select coalesce(
      jsonb_object_agg(members.message_key, members.root_message_key),
      '{}'::jsonb
    )
    into v_previous_roots
    from public.softora_mailbox_campaign_lineage_members as members
    where members.account_email = v_account_email;

    select coalesce(array_agg(roots.message_key order by roots.message_key), '{}'::text[])
    into v_root_keys
    from public.softora_mailbox_campaign_lineage_roots as roots
    where roots.account_email = v_account_email;

    delete from public.softora_mailbox_campaign_lineage_members
    where account_email = v_account_email;

    perform public.softora_rebuild_mailbox_campaign_lineage(
      v_account_email,
      v_root_keys,
      true,
      v_previous_roots
    );

    update public.softora_mailbox_campaign_lineage_discoveries as discoveries
    set
      active = false,
      last_disconnected_at = clock_timestamp()
    where discoveries.account_email = v_account_email
      and discoveries.active
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_members as current_member
        where current_member.message_key = discoveries.message_key
          and current_member.root_message_key = discoveries.root_message_key
      );
  end loop;
end;
$$;

revoke all on function public.softora_canonical_mailbox_message_key(text, text)
  from public, anon, authenticated;
grant execute on function public.softora_canonical_mailbox_message_key(text, text)
  to service_role;
