-- mailbox-recipient-batch-lookup:start
-- Campaign history passes many contact addresses at once. Keep the lookup
-- service-role only and let one expression-GIN query replace one REST request
-- per recipient without changing account, folder, visibility or result caps.

create or replace function public.softora_list_mailbox_messages_by_recipients(
  p_account_emails text[],
  p_folder text,
  p_recipient_emails text[],
  p_limit integer default 1000
)
returns jsonb
language sql
stable
parallel safe
security invoker
set search_path = ''
as $function$
  with normalized as (
    select
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(account_email))
        from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) as accounts(account_email)
        where nullif(pg_catalog.btrim(account_email), '') is not null
      ) as account_emails,
      pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, 'sent'))) as folder,
      array(
        select distinct pg_catalog.lower(pg_catalog.btrim(recipient_email))
        from pg_catalog.unnest(coalesce(p_recipient_emails, array[]::text[])) as recipients(recipient_email)
        where nullif(pg_catalog.btrim(recipient_email), '') is not null
      ) as recipient_emails,
      greatest(1, least(4000, coalesce(p_limit, 1000))) as row_limit
  ),
  active_keys as (
    select m.message_key, m.date
    from public.softora_mailbox_messages as m
    cross join normalized
    where m.account_email = any(normalized.account_emails)
      and m.folder = normalized.folder
      and m.deleted_at is null
      and m.generation_superseded_at is null
      and public.softora_mailbox_message_participants(
        m.sender_email,
        m.recipients_text,
        m.payload
      ) && normalized.recipient_emails
      and public.softora_mailbox_participant_emails(m.recipients_text)
        && normalized.recipient_emails
    order by m.date desc, m.message_key desc
    limit (select row_limit from normalized)
  ),
  superseded_keys as (
    select m.message_key, m.date
    from public.softora_mailbox_messages as m
    cross join normalized
    where m.account_email = any(normalized.account_emails)
      and m.folder = normalized.folder
      and m.deleted_at is null
      and m.generation_superseded_at is not null
      and public.softora_mailbox_message_participants(
        m.sender_email,
        m.recipients_text,
        m.payload
      ) && normalized.recipient_emails
      and public.softora_mailbox_participant_emails(m.recipients_text)
        && normalized.recipient_emails
    order by m.date desc, m.message_key desc
    limit (select row_limit from normalized)
  ),
  candidate_keys as (
    select active_keys.message_key, active_keys.date from active_keys
    union all
    select superseded_keys.message_key, superseded_keys.date from superseded_keys
  ),
  paged_keys as (
    select candidate_keys.message_key, candidate_keys.date
    from candidate_keys
    order by candidate_keys.date desc, candidate_keys.message_key desc
    limit (select row_limit from normalized)
  ),
  messages as (
    select
      paged_keys.date,
      paged_keys.message_key,
      pg_catalog.jsonb_build_object(
        'message_key', m.message_key,
        'account_email', m.account_email,
        'folder', m.folder,
        'uid', m.uid,
        'provider_id', m.provider_id,
        'message_id', m.message_id,
        'in_reply_to', m.in_reply_to,
        'references_text', m.references_text,
        'sender_name', m.sender_name,
        'sender_email', m.sender_email,
        'recipients_text', m.recipients_text,
        'subject', m.subject,
        'preview', m.preview,
        'date', m.date,
        'internal_date', m.internal_date,
        'unread', m.unread,
        'softora_read_at', m.softora_read_at,
        'state_revision', m.state_revision,
        'state_mutation_key', m.state_mutation_key,
        'state_mutation_at', m.state_mutation_at,
        'starred', m.starred,
        'reply_dismissed_at', m.reply_dismissed_at,
        'has_body', m.has_body,
        'body_truncated', m.body_truncated,
        'payload', m.payload
      ) as message
    from paged_keys
    join public.softora_mailbox_messages as m using (message_key)
  )
  select coalesce(
    pg_catalog.jsonb_agg(messages.message order by messages.date desc, messages.message_key desc),
    '[]'::jsonb
  )
  from messages;
$function$;

revoke all on function public.softora_list_mailbox_messages_by_recipients(text[], text, text[], integer)
  from public, anon, authenticated, service_role;

grant execute on function public.softora_list_mailbox_messages_by_recipients(text[], text, text[], integer)
  to service_role;
notify pgrst, 'reload schema';
-- mailbox-recipient-batch-lookup:end
