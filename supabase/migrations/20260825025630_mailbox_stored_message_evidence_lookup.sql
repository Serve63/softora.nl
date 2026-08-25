-- mailbox-stored-message-evidence-lookup:start
create or replace function public.softora_list_stored_mailbox_message_ids(
  p_account_emails text[],
  p_folder text,
  p_message_ids text[]
)
returns table(message_id text)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.cardinality(p_account_emails), 0) > 20
    or coalesce(pg_catalog.cardinality(p_message_ids), 0) > 200 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_STORED_MESSAGE_EVIDENCE_INPUT_TOO_LARGE';
  end if;

  return query
  with accounts as materialized (
    select distinct pg_catalog.lower(pg_catalog.btrim(account.value)) as account_email
    from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) account(value)
    where pg_catalog.btrim(account.value) <> ''
  ), targets as materialized (
    select distinct public.softora_normalize_mailbox_message_id(target.value) as message_id
    from pg_catalog.unnest(coalesce(p_message_ids, array[]::text[])) target(value)
    where public.softora_normalize_mailbox_message_id(target.value) is not null
  ), evidence as materialized (
    select public.softora_normalize_mailbox_message_id(message.message_id) as message_id
    from public.softora_mailbox_messages message
    join accounts on accounts.account_email = pg_catalog.lower(pg_catalog.btrim(message.account_email))
    join targets on targets.message_id = public.softora_normalize_mailbox_message_id(message.message_id)
    where pg_catalog.lower(pg_catalog.btrim(message.folder))
      = pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, 'sent')))

    union all

    select tombstone.normalized_message_id
    from public.softora_mailbox_message_tombstones tombstone
    join accounts on accounts.account_email = tombstone.account_email
    join targets on targets.message_id = tombstone.normalized_message_id
  )
  select distinct evidence.message_id
  from evidence
  where evidence.message_id is not null
  order by evidence.message_id;
end;
$function$;

revoke all on function public.softora_list_stored_mailbox_message_ids(text[], text, text[])
  from public, anon, authenticated, service_role;
grant execute on function public.softora_list_stored_mailbox_message_ids(text[], text, text[])
  to service_role;

notify pgrst, 'reload schema';
-- mailbox-stored-message-evidence-lookup:end
