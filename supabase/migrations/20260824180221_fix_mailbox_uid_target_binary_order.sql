-- mailbox-uid-target-binary-order-repair:start
--
-- Node canonicalizes sparse All Mail Message-ID targets by their UTF-8 bytes.
-- The database previously revalidated that array with the database's locale
-- collation. On en_US.UTF-8, punctuation sequences can sort in a different
-- order, so a valid canonical payload failed before its lease was
-- inspected. Patch only the reviewed validation fragment and fail on drift.

do $preflight$
declare
  v_protocol text;
  v_prepare_signature text :=
    'public.softora_prepare_mailbox_uid_generation_v2(text,text,bigint,bigint,text,jsonb)';
  v_commit_signature text :=
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)';
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_ORDER_REPAIR_REQUIRES_V2';
  end if;
  if pg_catalog.to_regprocedure(v_prepare_signature) is null
    or pg_catalog.to_regprocedure(v_commit_signature) is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_ORDER_REPAIR_FUNCTION_MISSING';
  end if;
end;
$preflight$;

create or replace function pg_temp.softora_replace_mailbox_uid_target_order(
  p_signature text,
  p_old text,
  p_new text
)
returns void
language plpgsql
volatile
set search_path = ''
as $function$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(p_signature);
  v_definition text;
  v_matches integer;
begin
  if v_oid is null or coalesce(p_old, '') = '' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_ORDER_PATCH_TARGET_INVALID';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_UID_TARGET_ORDER_PATCH_DRIFT',
      detail = 'expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

select pg_temp.softora_replace_mailbox_uid_target_order(
  'public.softora_prepare_mailbox_uid_generation_v2(text,text,bigint,bigint,text,jsonb)',
  $old$order by target.value #>> '{}'$old$,
  $new$order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')$new$
);

select pg_temp.softora_replace_mailbox_uid_target_order(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$order by target.value #>> '{}'$old$,
  $new$order by pg_catalog.convert_to(target.value #>> '{}', 'UTF8')$new$
);

revoke all on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) from public, anon, authenticated;
grant execute on function public.softora_prepare_mailbox_uid_generation_v2(
  text, text, bigint, bigint, text, jsonb
) to service_role;
revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;

notify pgrst, 'reload schema';
-- mailbox-uid-target-binary-order-repair:end
