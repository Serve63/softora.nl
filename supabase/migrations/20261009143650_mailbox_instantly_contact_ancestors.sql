-- Provider thread IDs are independent proof when an Instantly contact replies
-- from another address without RFC reference headers. Keep timeline and atomic
-- hide/restore on the same scope, and preserve the existing function's ACL.
do $migration$
declare
  definition text;
  cte_anchor constant text := '  ), allowed_alias_origins as materialized (';
  union_anchor constant text := '    select * from referenced_own_physical';
  ancestry_cte constant text := $cte$
  ), instantly_own_ancestors as materialized (
    select distinct
      ancestor.message_key, seed.account_email, seed.thread_key,
      seed.canonical_owner
    from direct_seeds seed
    join public.softora_mailbox_messages received
      on received.message_key = seed.message_key
      and received.account_email = seed.account_email
      and received.folder = 'instantly'
      and received.generation_superseded_at is null
      and received.payload->>'provider' = 'instantly'
      and received.payload->>'direction' = 'received'
      and pg_catalog.lower(pg_catalog.btrim(received.payload->>'providerAccountEmail')) = seed.account_email
      and pg_catalog.lower(pg_catalog.btrim(received.payload->>'providerOwner')) = seed.canonical_owner
      and nullif(pg_catalog.btrim(received.payload->>'providerThreadId'), '') is not null
      and nullif(pg_catalog.btrim(received.payload->>'providerMessageId'), '') is not null
      and received.date is not null
    join public.softora_mailbox_messages ancestor
      on ancestor.account_email = received.account_email
      and ancestor.folder = 'instantly'
      and ancestor.generation_superseded_at is null
      and ancestor.payload->>'provider' = 'instantly'
      and ancestor.payload->>'direction' = 'sent'
      -- Opaque provider IDs must stay case-sensitive; a normalized technical
      -- thread key alone cannot authorize an alternate contact's history.
      and ancestor.payload->>'providerThreadId' = received.payload->>'providerThreadId'
      and nullif(pg_catalog.btrim(ancestor.payload->>'providerMessageId'), '') is not null
      and pg_catalog.lower(pg_catalog.btrim(ancestor.payload->>'providerAccountEmail')) = seed.account_email
      and pg_catalog.lower(pg_catalog.btrim(ancestor.payload->>'providerOwner')) = seed.canonical_owner
      and pg_catalog.lower(pg_catalog.btrim(ancestor.sender_email)) = seed.account_email
      and ancestor.date <= received.date
    where seed.canonical_owner is not null
      and not public.softora_has_proven_automated_reply(received.payload)
      and not public.softora_has_proven_automated_reply(ancestor.payload)
      and pg_catalog.lower(pg_catalog.btrim(coalesce(received.payload->>'automatedReplyEvidence', ''))) <> 'true'
      and pg_catalog.lower(pg_catalog.btrim(coalesce(ancestor.payload->>'automatedReplyEvidence', ''))) <> 'true'
      and not exists (
        select 1 from public.softora_mailbox_campaign_lineage_members automated_member
        where automated_member.account_email = seed.account_email
          and automated_member.message_key in (received.message_key, ancestor.message_key)
          and automated_member.is_proven_automated
      )
$cte$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.softora_mailbox_contact_scope(text[],text)'::pg_catalog.regprocedure
  ) into definition;
  if pg_catalog.strpos(definition, 'instantly_own_ancestors as materialized (') > 0 then
    return;
  end if;
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, cte_anchor, '')))
       / pg_catalog.length(cte_anchor) <> 1
    or (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, union_anchor, '')))
       / pg_catalog.length(union_anchor) <> 1 then
    raise exception 'Mailbox contact scope changed: Instantly ancestry anchors do not match';
  end if;
  definition := pg_catalog.replace(definition, cte_anchor, ancestry_cte || cte_anchor);
  definition := pg_catalog.replace(definition, union_anchor,
    union_anchor || E'\n    union all\n    select * from instantly_own_ancestors');
  execute definition;
end;
$migration$;
