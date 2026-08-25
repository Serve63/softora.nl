-- mailbox-accepted-provenance-evidence-lookup:start
create index if not exists softora_mailbox_send_provenance_accepted_message_id_idx
on public.softora_mailbox_send_provenance (
  (pg_catalog.lower(pg_catalog.btrim(account_email))),
  (public.softora_normalize_mailbox_message_id(sent_message_id)),
  accepted_at desc,
  intent_id
)
where status = 'accepted'
  and public.softora_normalize_mailbox_message_id(sent_message_id) is not null;

create or replace function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  p_account_emails text[],
  p_message_ids text[],
  p_max_rows integer default 500
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if coalesce(pg_catalog.cardinality(p_account_emails), 0) > 20
    or coalesce(pg_catalog.cardinality(p_message_ids), 0) > 200
    or coalesce(p_max_rows, 0) not between 1 and 2000 then
    raise exception using errcode = '22023',
      message = 'MAILBOX_ACCEPTED_PROVENANCE_EVIDENCE_INPUT_TOO_LARGE';
  end if;

  return (
    with accounts as materialized (
      select distinct pg_catalog.lower(pg_catalog.btrim(account.value)) as account_email
      from pg_catalog.unnest(coalesce(p_account_emails, array[]::text[])) account(value)
      where pg_catalog.btrim(account.value) <> ''
    ), targets as materialized (
      select distinct public.softora_normalize_mailbox_message_id(target.value) as message_id
      from pg_catalog.unnest(coalesce(p_message_ids, array[]::text[])) target(value)
      where public.softora_normalize_mailbox_message_id(target.value) is not null
    ), bounded as materialized (
      select provenance.*, targets.message_id as canonical_message_id
      from public.softora_mailbox_send_provenance provenance
      join accounts
        on accounts.account_email = pg_catalog.lower(pg_catalog.btrim(provenance.account_email))
      join targets
        on targets.message_id = public.softora_normalize_mailbox_message_id(
          provenance.sent_message_id
        )
      where provenance.status = 'accepted'
      order by provenance.accepted_at desc nulls last,
        provenance.updated_at desc nulls last,
        provenance.created_at desc nulls last,
        provenance.intent_id
      limit (p_max_rows + 1)
    )
    select pg_catalog.jsonb_build_object(
      'rows', coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.to_jsonb(evidence)
          order by evidence.accepted_at desc nulls last,
            evidence.updated_at desc nulls last,
            evidence.created_at desc nulls last,
            evidence.intent_id
        )
        from bounded evidence
      ), '[]'::jsonb),
      'complete', (select pg_catalog.count(*) <= p_max_rows from bounded),
      'overflow', (select pg_catalog.count(*) > p_max_rows from bounded),
      'returned_count', (select pg_catalog.count(*) from bounded),
      'max_rows', p_max_rows
    )
  );
end;
$function$;

revoke all on function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  text[], text[], integer
) from public, anon, authenticated, service_role;
grant execute on function public.softora_list_accepted_mailbox_send_provenance_by_message_ids(
  text[], text[], integer
) to service_role;

notify pgrst, 'reload schema';
-- mailbox-accepted-provenance-evidence-lookup:end
