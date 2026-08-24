-- mailbox-target-anchor-validation-optimization:start
--
-- The previous validator correlated every target Message-ID with a fresh scan
-- of every campaign anchor row. Large Gmail All Mail selections therefore did
-- hundreds of thousands of repeated normalize/regexp checks and exceeded the
-- bounded RPC timeout. Materialize the permitted anchors once, normalize their
-- references once, and compare the two finite sets without changing which
-- folders, campaign rows, or reference headers are accepted.

do $preflight$
declare
  v_protocol text;
  v_signature text :=
    'public.softora_mailbox_target_references_are_anchored(text,jsonb)';
  v_oid pg_catalog.oid;
  v_body text;
  v_expected_body text := $expected$
  select pg_catalog.jsonb_typeof(coalesce(p_target_reference_ids, 'null'::jsonb)) = 'array'
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements_text(p_target_reference_ids)
        as target(reference_id)
      where not exists (
        select 1
        from public.softora_mailbox_messages as anchor
        where anchor.account_email = pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and anchor.folder = any (array['inbox', 'sent', 'coldmail']::text[])
          and anchor.generation_superseded_at is null
          and anchor.deleted_at is null
          and public.softora_is_campaign_mailbox_message(
            anchor.account_email, anchor.folder, anchor.payload
          )
          and (
            public.softora_normalize_mailbox_message_id(anchor.message_id)
              = target.reference_id
            or public.softora_normalize_mailbox_message_id(anchor.in_reply_to)
              = target.reference_id
            or public.softora_mailbox_header_contains_message_id(
              anchor.references_text, target.reference_id
            )
          )
      )
    );
$expected$;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
  v_language name;
  v_owner pg_catalog.oid;
  v_unexpected_execute integer;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_TARGET_ANCHOR_OPTIMIZATION_REQUIRES_V2';
  end if;

  v_oid := pg_catalog.to_regprocedure(v_signature);
  if v_oid is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_TARGET_ANCHOR_FUNCTION_MISSING';
  end if;

  select procedure.prosrc, procedure.provolatile, procedure.prosecdef,
    procedure.proconfig, language.lanname, procedure.proowner
  into v_body, v_volatility, v_security_definer, v_config, v_language, v_owner
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where procedure.oid = v_oid;
  select pg_catalog.count(*)::integer into v_unexpected_execute
  from pg_catalog.aclexplode(
    coalesce(
      (select procedure.proacl from pg_catalog.pg_proc as procedure
       where procedure.oid = v_oid),
      pg_catalog.acldefault('f', v_owner)
    )
  ) as acl
  where acl.privilege_type = 'EXECUTE'
    and acl.grantee not in (
      v_owner,
      (select role.oid from pg_catalog.pg_roles as role
       where role.rolname = 'service_role')
    );

  if v_body is distinct from v_expected_body
    or v_volatility is distinct from 's'
    or v_security_definer is distinct from false
    or v_language is distinct from 'sql'
    or not ('search_path=""' = any(coalesce(v_config, '{}'::text[])))
    or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    or v_unexpected_execute <> 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_TARGET_ANCHOR_OPTIMIZATION_DRIFT';
  end if;
end;
$preflight$;

create or replace function public.softora_mailbox_target_references_are_anchored(
  p_account_email text,
  p_target_reference_ids jsonb
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with target_references as materialized (
    select target.reference_id,
      public.softora_normalize_mailbox_message_id(target.reference_id)
        as normalized_reference_id
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(
          coalesce(p_target_reference_ids, 'null'::jsonb)
        ) = 'array' then p_target_reference_ids
        else '[]'::jsonb
      end
    ) as target(reference_id)
  ),
  anchor_rows as materialized (
    select anchor.message_id, anchor.in_reply_to, anchor.references_text
    from public.softora_mailbox_messages as anchor
    where anchor.account_email = pg_catalog.lower(pg_catalog.btrim(p_account_email))
      and anchor.folder = any (array['inbox', 'sent', 'coldmail']::text[])
      and anchor.generation_superseded_at is null
      and anchor.deleted_at is null
      and public.softora_is_campaign_mailbox_message(
        anchor.account_email, anchor.folder, anchor.payload
      )
  ),
  direct_anchor_references as materialized (
    select public.softora_normalize_mailbox_message_id(anchor.message_id)
      as reference_id
    from anchor_rows as anchor
    where public.softora_normalize_mailbox_message_id(anchor.message_id) is not null
    union
    select public.softora_normalize_mailbox_message_id(anchor.in_reply_to)
      as reference_id
    from anchor_rows as anchor
    where public.softora_normalize_mailbox_message_id(anchor.in_reply_to) is not null
  ),
  header_anchor_references as materialized (
    select public.softora_normalize_mailbox_message_id(token.value)
      as reference_id
    from anchor_rows as anchor
    cross join lateral pg_catalog.regexp_split_to_table(
      coalesce(anchor.references_text, ''), '[[:space:],]+'
    ) as token(value)
    where public.softora_normalize_mailbox_message_id(token.value) is not null
  ),
  matched_targets as materialized (
    select target.reference_id
    from target_references as target
    join direct_anchor_references as anchor
      on anchor.reference_id = target.reference_id
    union
    select target.reference_id
    from target_references as target
    join header_anchor_references as anchor
      on anchor.reference_id = target.normalized_reference_id
  )
  select pg_catalog.jsonb_typeof(
      coalesce(p_target_reference_ids, 'null'::jsonb)
    ) = 'array'
    and not exists (
      select target.reference_id
      from target_references as target
      except
      select matched.reference_id
      from matched_targets as matched
    );
$function$;

revoke all on function public.softora_mailbox_target_references_are_anchored(
  text, jsonb
) from public, anon, authenticated;
grant execute on function public.softora_mailbox_target_references_are_anchored(
  text, jsonb
) to service_role;

do $postflight$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(
    'public.softora_mailbox_target_references_are_anchored(text,jsonb)'
  );
  v_body text;
  v_volatility "char";
  v_security_definer boolean;
  v_config text[];
  v_language name;
  v_owner pg_catalog.oid;
  v_unexpected_execute integer;
  v_expected_body_md5 text := '7d3b3ff60d9219bb7508f6f4a883c59e';
begin
  select procedure.prosrc, procedure.provolatile, procedure.prosecdef,
    procedure.proconfig, language.lanname, procedure.proowner
  into v_body, v_volatility, v_security_definer, v_config, v_language, v_owner
  from pg_catalog.pg_proc as procedure
  join pg_catalog.pg_language as language on language.oid = procedure.prolang
  where procedure.oid = v_oid;
  select pg_catalog.count(*)::integer into v_unexpected_execute
  from pg_catalog.aclexplode(
    coalesce(
      (select procedure.proacl from pg_catalog.pg_proc as procedure
       where procedure.oid = v_oid),
      pg_catalog.acldefault('f', v_owner)
    )
  ) as acl
  where acl.privilege_type = 'EXECUTE'
    and acl.grantee not in (
      v_owner,
      (select role.oid from pg_catalog.pg_roles as role
       where role.rolname = 'service_role')
    );

  if v_oid is null
    or pg_catalog.md5(v_body) is distinct from v_expected_body_md5
    or v_volatility is distinct from 's'
    or v_security_definer is distinct from false
    or v_language is distinct from 'sql'
    or not ('search_path=""' = any(coalesce(v_config, '{}'::text[])))
    or not pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
    or v_unexpected_execute <> 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_TARGET_ANCHOR_OPTIMIZATION_POSTCHECK_FAILED';
  end if;
end;
$postflight$;

notify pgrst, 'reload schema';
-- mailbox-target-anchor-validation-optimization:end
