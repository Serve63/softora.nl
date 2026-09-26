-- Real replies a sender wrote in coldmail conversations, paired with the customer
-- mail they answered. The mailbox "Voorgestelde reactie" uses the most similar
-- pairs as style examples, so suggestions follow how Servé and Martijn reply.
-- Read-only: scope is the canonical outreach contact list, never support or
-- private mail.
create or replace function public.softora_mailbox_reply_examples(
  p_account_emails text[],
  p_limit integer default 300
)
returns table (
  reply_message_key text,
  account_email text,
  reply_date timestamptz,
  subject text,
  inbound_body text,
  reply_body text
)
language sql
stable
set search_path to ''
as $function$
  with accounts as materialized (
    select array(
      select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as source(account_email)
      where nullif(pg_catalog.btrim(account_email), '') is not null
    ) as emails
  ),
  contacts as materialized (
    select eligible.contact_email
    from accounts
    cross join public.softora_mailbox_outreach_contacts(accounts.emails) eligible
  ),
  pairs as (
    select distinct on (pg_catalog.md5(reply.body_text))
      reply.message_key as reply_message_key,
      reply.account_email,
      reply.date as reply_date,
      reply.subject,
      pg_catalog.left(inbound.body_text, 3000) as inbound_body,
      pg_catalog.left(reply.body_text, 3000) as reply_body
    from public.softora_mailbox_messages reply
    cross join accounts
    cross join lateral (
      select candidate.body_text, candidate.sender_email
      from public.softora_mailbox_messages candidate
      where candidate.message_id = reply.in_reply_to
        and candidate.account_email = reply.account_email
        and candidate.folder = any(array['inbox', 'allmail']::text[])
        and candidate.deleted_at is null
        and candidate.generation_superseded_at is null
        and nullif(pg_catalog.btrim(candidate.body_text), '') is not null
      order by (candidate.folder = 'inbox') desc
      limit 1
    ) inbound
    where reply.folder = 'sent'
      and reply.account_email = any(accounts.emails)
      and reply.deleted_at is null
      and reply.generation_superseded_at is null
      and nullif(pg_catalog.btrim(reply.in_reply_to), '') is not null
      and nullif(pg_catalog.btrim(reply.body_text), '') is not null
      and pg_catalog.lower(pg_catalog.btrim(inbound.sender_email)) in (select contact_email from contacts)
      -- Only the coldmail conversations themselves, never support or supplier mail.
      and (
        pg_catalog.lower(reply.subject) like '%kleine vraag over jullie website%'
        or pg_catalog.lower(reply.subject) like '%nieuw webdesign%'
      )
    order by pg_catalog.md5(reply.body_text), reply.date desc
  )
  select pairs.*
  from pairs
  order by pairs.reply_date desc
  limit greatest(1, least(coalesce(p_limit, 300), 500));
$function$;

revoke all on function public.softora_mailbox_reply_examples(text[], integer)
  from public, anon, authenticated;
grant execute on function public.softora_mailbox_reply_examples(text[], integer) to service_role;
