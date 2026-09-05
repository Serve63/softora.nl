-- The inbox must use the same per-message evidence as contact discovery.
-- An eligible contact (or a customer record) alone does not prove a reply.
create or replace function public.softora_filter_mailbox_campaign_messages(
  p_account_emails text[],
  p_messages jsonb
)
returns table (message_key text)
language sql
stable
security invoker
set search_path = ''
as $function$
  with requested as materialized (
    select distinct
      pg_catalog.btrim(request.message_key) as message_key,
      pg_catalog.lower(pg_catalog.btrim(request.contact_email)) as contact_email
    from pg_catalog.jsonb_to_recordset(p_messages)
      as request(message_key text, contact_email text)
    where nullif(pg_catalog.btrim(request.message_key), '') is not null
      and nullif(pg_catalog.btrim(request.contact_email), '') is not null
      and pg_catalog.jsonb_array_length(p_messages) <= 200
  ), accounts as (
    select array(
      select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
      from pg_catalog.unnest(p_account_emails) as source(account_email)
      where nullif(pg_catalog.btrim(account_email), '') is not null
    ) as allowed
  )
  select distinct m.message_key
  from requested r
  join public.softora_mailbox_messages m on m.message_key = r.message_key
  cross join accounts
  where m.account_email = any(accounts.allowed)
    and m.deleted_at is null
    and m.generation_superseded_at is null
    and public.softora_mailbox_message_has_campaign_proof(
      m.message_key, m.account_email, m.folder, m.message_id, m.in_reply_to,
      m.references_text, m.sender_name, m.sender_email, m.recipients_text,
      m.subject, m.payload, r.contact_email, null
    );
$function$;

revoke all on function public.softora_filter_mailbox_campaign_messages(text[], jsonb)
  from public, anon, authenticated;
grant execute on function public.softora_filter_mailbox_campaign_messages(text[], jsonb)
  to service_role;
