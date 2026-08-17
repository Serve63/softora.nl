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
  select distinct on (lineage.message_key)
    lineage.message_key,
    lineage.account_email,
    lineage.message_id,
    lineage.parent_message_key,
    lineage.root_message_key,
    lineage.root_message_id,
    lineage.lineage_depth
  from lineage
  order by
    lineage.message_key,
    lineage.lineage_depth,
    lineage.root_message_key,
    lineage.parent_message_key nulls first;
$$;

comment on function public.softora_resolve_mailbox_campaign_lineage(text, text[])
  is 'Resolves one deterministic lineage row per mailbox message, including when requested start keys overlap.';
