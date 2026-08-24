-- mailbox-final-activation-lineage-batch:start
--
-- A staged UID rebuild writes only a few rows per pass, but its final pass
-- atomically materializes the complete generation and retires the previous
-- snapshot. The lineage row trigger used to rebuild the same impacted graph
-- once for every inserted and retired copy. Keep its exact root/edge updates,
-- suppress only those repeated graph rebuilds during the fenced activation,
-- and rebuild the union of affected keys once before the generation pointer
-- becomes visible.

do $preflight$
declare
  v_protocol text;
  v_trigger_enabled "char";
  v_signature text;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_REQUIRES_V2';
  end if;

  foreach v_signature in array array[
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_refresh_mailbox_message_lineage()',
    'public.softora_refresh_mailbox_campaign_lineage_impacts(text,text,text[])',
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'
  ] loop
    if pg_catalog.to_regprocedure(v_signature) is null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_FUNCTION_MISSING',
        detail = v_signature;
    end if;
  end loop;

  if pg_catalog.to_regclass('public.softora_mailbox_messages') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generations') is null
    or pg_catalog.to_regclass('public.softora_mailbox_message_lineage_edges') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_roots') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_members') is null
    or pg_catalog.to_regclass('public.softora_mailbox_campaign_lineage_discoveries') is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_TABLE_MISSING';
  end if;

  select trigger_row.tgenabled into v_trigger_enabled
  from pg_catalog.pg_trigger as trigger_row
  where trigger_row.tgrelid = 'public.softora_mailbox_messages'::pg_catalog.regclass
    and trigger_row.tgname = 'softora_refresh_mailbox_message_lineage'
    and not trigger_row.tgisinternal;
  if not found or v_trigger_enabled = 'D' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_TRIGGER_MISSING';
  end if;
end;
$preflight$;

create or replace function pg_temp.softora_replace_final_activation_fragment(
  p_signature text,
  p_old text,
  p_new text,
  p_label text
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
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_PATCH_TARGET_INVALID',
      detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

-- A transaction-local setting is trusted only after every identity carried by
-- the affected row matches its exact activation scope. Invalid JSON, extra or
-- missing keys, and unrelated message writes abort instead of silently
-- suppressing lineage work.
create or replace function public.softora_mailbox_lineage_activation_row_matches_v2(
  p_operation text,
  p_old_account_email text,
  p_old_folder text,
  p_old_generation_id uuid,
  p_old_superseded_at timestamptz,
  p_new_account_email text,
  p_new_folder text,
  p_new_generation_id uuid,
  p_new_superseded_at timestamptz
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_raw_scope text := coalesce(pg_catalog.current_setting(
    'softora.mailbox_lineage_batch_activation_v2', true
  ), '');
  v_scope jsonb;
  v_scope_key_count integer := 0;
  v_operation text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_operation, '')));
  v_sync_key text;
  v_account_email text;
  v_folder text;
  v_old_generation_id text;
  v_new_generation_id text;
  v_old_generation_is_null boolean;
  v_old_generation_uuid uuid;
  v_new_generation_uuid uuid;
begin
  if v_raw_scope = '' then
    return false;
  end if;
  begin
    v_scope := v_raw_scope::jsonb;
  exception when others then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  if pg_catalog.jsonb_typeof(v_scope) is distinct from 'object' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;
  select pg_catalog.count(*)::integer into v_scope_key_count
  from pg_catalog.jsonb_object_keys(v_scope) as scope_key(value);
  if v_scope_key_count <> 5
    or not (v_scope ?& array[
      'syncKey', 'accountEmail', 'folder',
      'oldGenerationId', 'newGenerationId'
    ]::text[])
    or pg_catalog.jsonb_typeof(v_scope->'syncKey') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'accountEmail') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'folder') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'newGenerationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'oldGenerationId')
      not in ('string', 'null') then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  v_sync_key := pg_catalog.lower(pg_catalog.btrim(v_scope->>'syncKey'));
  v_account_email := pg_catalog.lower(pg_catalog.btrim(v_scope->>'accountEmail'));
  v_folder := pg_catalog.lower(pg_catalog.btrim(v_scope->>'folder'));
  v_old_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'oldGenerationId', ''
  )));
  v_new_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'newGenerationId', ''
  )));
  v_old_generation_is_null := v_scope->'oldGenerationId' = 'null'::jsonb;

  begin
    v_new_generation_uuid := v_new_generation_id::uuid;
    if not v_old_generation_is_null then
      v_old_generation_uuid := v_old_generation_id::uuid;
    end if;
  exception when invalid_text_representation then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  if coalesce(pg_catalog.current_setting(
      'softora.mailbox_sync_per_key_v2', true
    ), '') is distinct from '1'
    or coalesce(pg_catalog.current_setting(
      'softora.mailbox_uid_generation_v2_transition', true
    ), '') is distinct from '1'
    or v_sync_key = ''
    or pg_catalog.char_length(v_sync_key) > 600
    or v_sync_key <> v_scope->>'syncKey'
    or v_account_email = ''
    or pg_catalog.char_length(v_account_email) > 320
    or v_account_email <> v_scope->>'accountEmail'
    or v_folder = ''
    or pg_catalog.char_length(v_folder) > 200
    or v_folder <> v_scope->>'folder'
    or v_sync_key is distinct from (v_account_email || '|' || v_folder)
    or v_new_generation_id = ''
    or v_new_generation_id is distinct from v_new_generation_uuid::text
    or (
      not v_old_generation_is_null
      and v_old_generation_id is distinct from v_old_generation_uuid::text
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  if v_operation = 'INSERT' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or p_new_generation_id is distinct from v_new_generation_uuid
      or p_new_superseded_at is not null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  elsif v_operation = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_old_folder, '')))
        <> v_folder
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_account_email, '')))
        <> v_account_email
      or pg_catalog.lower(pg_catalog.btrim(coalesce(p_new_folder, '')))
        <> v_folder
      or (
        -- ON CONFLICT on a row already belonging to the new generation.
        p_old_generation_id is not distinct from v_new_generation_uuid
          and p_new_generation_id is not distinct from v_new_generation_uuid
          and p_old_superseded_at is null
          and p_new_superseded_at is null
        or
        -- Exact retirement of the previous active/legacy generation.
        p_new_generation_id is not distinct from p_old_generation_id
          and p_old_superseded_at is null
          and p_new_superseded_at is not null
          and (
            v_old_generation_is_null and p_old_generation_id is null
            or not v_old_generation_is_null
              and p_old_generation_id is not distinct from v_old_generation_uuid
          )
      ) is not true then
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH';
    end if;
  else
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_ROW_OPERATION_INVALID';
  end if;
  return true;
end;
$function$;

-- This is the set-based counterpart of
-- softora_refresh_mailbox_campaign_lineage_impacts. It accepts every old and
-- new physical key involved in one activation, expands the existing edge/root
-- impact and descendants once, then preserves the existing discovery rules.
create or replace function public.softora_refresh_mailbox_activation_lineage_v2(
  p_account_email text,
  p_folder text,
  p_generation_id uuid,
  p_retired_message_keys text[]
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
  v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
  v_message_keys text[];
  v_message_ids text[];
  v_direct_keys text[];
  v_rebuild_keys text[];
  v_previous_roots jsonb;
begin
  if v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
    or v_folder = '' or pg_catalog.char_length(v_folder) > 200
    or p_generation_id is null
    or pg_catalog.strpos(v_account_email, '|') > 0
    or pg_catalog.strpos(v_folder, '|') > 0
    or exists (
      select 1
      from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
        as retired(message_key)
      where nullif(pg_catalog.btrim(retired.message_key), '') is null
    ) then
    raise exception using errcode = '22023',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_INPUT_INVALID';
  end if;

  perform 1
  from public.softora_mailbox_uid_generations as generation
  where generation.generation_id = p_generation_id
    and generation.account_email = v_account_email
    and generation.folder = v_folder
    and generation.status = 'staging';
  if not found then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_GENERATION_INVALID';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    left join public.softora_mailbox_messages as message
      on message.message_key = retired.message_key
    where message.message_key is null
      or message.account_email <> v_account_email
      or message.folder <> v_folder
      or message.generation_superseded_at is null
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_RETIRED_SCOPE_INVALID';
  end if;

  select coalesce(
    pg_catalog.array_agg(candidate.message_key order by candidate.message_key),
    '{}'::text[]
  ) into v_message_keys
  from (
    select distinct retired.message_key
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    union
    select message.message_key
    from public.softora_mailbox_messages as message
    where message.account_email = v_account_email
      and message.folder = v_folder
      and message.uid_generation_id = p_generation_id
  ) as candidate;

  select coalesce(
    pg_catalog.array_agg(distinct normalized.message_id),
    '{}'::text[]
  ) into v_message_ids
  from (
    select public.softora_normalize_mailbox_message_id(message.message_id)
      as message_id
    from public.softora_mailbox_messages as message
    where message.message_key = any (v_message_keys)
  ) as normalized
  where normalized.message_id is not null;

  select coalesce(
    pg_catalog.array_agg(distinct impacted.message_key),
    '{}'::text[]
  ) into v_direct_keys
  from (
    select changed.message_key
    from pg_catalog.unnest(v_message_keys) as changed(message_key)
    union
    select edge.child_message_key
    from public.softora_mailbox_message_lineage_edges as edge
    where edge.account_email = v_account_email
      and edge.parent_message_id = any (v_message_ids)
    union
    select root.message_key
    from public.softora_mailbox_campaign_lineage_roots as root
    where root.account_email = v_account_email
      and root.message_id = any (v_message_ids)
  ) as impacted;

  with recursive impacted_members as (
    select member.message_key
    from public.softora_mailbox_campaign_lineage_members as member
    where member.account_email = v_account_email
      and member.message_key = any (v_direct_keys)
    union
    select child.message_key
    from impacted_members
    join public.softora_mailbox_campaign_lineage_members as child
      on child.parent_message_key = impacted_members.message_key
  )
  select coalesce(
    pg_catalog.array_agg(distinct rebuild.message_key),
    '{}'::text[]
  ) into v_rebuild_keys
  from (
    select direct_key.message_key
    from pg_catalog.unnest(v_direct_keys) as direct_key(message_key)
    union
    select impacted_members.message_key from impacted_members
  ) as rebuild;

  select coalesce(
    pg_catalog.jsonb_object_agg(member.message_key, member.root_message_key),
    '{}'::jsonb
  ) into v_previous_roots
  from public.softora_mailbox_campaign_lineage_members as member
  where member.account_email = v_account_email
    and member.message_key = any (v_rebuild_keys);

  delete from public.softora_mailbox_campaign_lineage_members as member
  where member.account_email = v_account_email
    and member.message_key = any (v_rebuild_keys);

  perform public.softora_rebuild_mailbox_campaign_lineage(
    v_account_email,
    v_rebuild_keys,
    false,
    v_previous_roots
  );

  update public.softora_mailbox_campaign_lineage_discoveries as discovery
  set active = false,
      last_disconnected_at = pg_catalog.clock_timestamp()
  where discovery.account_email = v_account_email
    and discovery.message_key = any (v_rebuild_keys)
    and discovery.active
    and not exists (
      select 1
      from public.softora_mailbox_campaign_lineage_members as current_member
      where current_member.message_key = discovery.message_key
        and current_member.root_message_key = discovery.root_message_key
    );

  -- All directly changed physical copies have reached their final visibility
  -- state now. No retired/deleted copy may retain an edge, root or member, and
  -- every rebuilt artifact must agree with its visible source message.
  if exists (
    select 1
    from public.softora_mailbox_campaign_lineage_roots as root
    join public.softora_mailbox_messages as message
      on message.message_key = root.message_key
    where root.message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or root.account_email <> v_account_email
        or root.message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_message_lineage_edges as edge
    join public.softora_mailbox_messages as message
      on message.message_key = edge.child_message_key
    where edge.child_message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or edge.account_email <> v_account_email
        or edge.child_message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_campaign_lineage_members as member
    join public.softora_mailbox_messages as message
      on message.message_key = member.message_key
    join public.softora_mailbox_messages as root_message
      on root_message.message_key = member.root_message_key
    where member.message_key = any (v_rebuild_keys)
      and (
        message.deleted_at is not null
        or message.generation_superseded_at is not null
        or root_message.deleted_at is not null
        or root_message.generation_superseded_at is not null
        or message.account_email <> v_account_email
        or member.account_email <> v_account_email
        or member.message_id is distinct from
          public.softora_normalize_mailbox_message_id(message.message_id)
      )
  ) or exists (
    select 1
    from public.softora_mailbox_campaign_lineage_discoveries as discovery
    where discovery.account_email = v_account_email
      and discovery.message_key = any (v_rebuild_keys)
      and discovery.active
      and not exists (
        select 1
        from public.softora_mailbox_campaign_lineage_members as current_member
        where current_member.message_key = discovery.message_key
          and current_member.root_message_key = discovery.root_message_key
      )
  ) or exists (
    select 1
    from pg_catalog.unnest(coalesce(p_retired_message_keys, '{}'::text[]))
      as retired(message_key)
    where exists (
      select 1 from public.softora_mailbox_campaign_lineage_roots as root
      where root.message_key = retired.message_key
    ) or exists (
      select 1 from public.softora_mailbox_message_lineage_edges as edge
      where edge.child_message_key = retired.message_key
    ) or exists (
      select 1 from public.softora_mailbox_campaign_lineage_members as member
      where member.message_key = retired.message_key
    )
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_LINEAGE_POSTCONDITION_FAILED';
  end if;
end;
$function$;

-- The row trigger keeps maintaining roots and direct-parent edges. Only its
-- recursive impact refresh is coalesced while the finalizer owns the explicit
-- activation flag.
select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_refresh_mailbox_message_lineage()',
  $old$  if v_old_account <> '' and v_old_account = v_new_account then
    perform public.softora_refresh_mailbox_campaign_lineage_impacts(
      v_old_account,
      v_message_key,
      array[v_old_message_id, v_new_message_id]
    );
  else
    if v_old_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_old_account,
        v_message_key,
        array[v_old_message_id]
      );
    end if;
    if v_new_account <> '' then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_new_account,
        v_message_key,
        array[v_new_message_id]
      );
    end if;
  end if;$old$,
  $new$  if coalesce(pg_catalog.current_setting(
    'softora.mailbox_lineage_batch_activation_v2', true
  ), '') = '' or public.softora_mailbox_lineage_activation_row_matches_v2(
    tg_op,
    case when tg_op = 'INSERT' then null else old.account_email end,
    case when tg_op = 'INSERT' then null else old.folder end,
    case when tg_op = 'INSERT' then null else old.uid_generation_id end,
    case when tg_op = 'INSERT' then null else old.generation_superseded_at end,
    case when tg_op = 'DELETE' then null else new.account_email end,
    case when tg_op = 'DELETE' then null else new.folder end,
    case when tg_op = 'DELETE' then null else new.uid_generation_id end,
    case when tg_op = 'DELETE' then null else new.generation_superseded_at end
  ) is not true then
    if v_old_account <> '' and v_old_account = v_new_account then
      perform public.softora_refresh_mailbox_campaign_lineage_impacts(
        v_old_account,
        v_message_key,
        array[v_old_message_id, v_new_message_id]
      );
    else
      if v_old_account <> '' then
        perform public.softora_refresh_mailbox_campaign_lineage_impacts(
          v_old_account,
          v_message_key,
          array[v_old_message_id]
        );
      end if;
      if v_new_account <> '' then
        perform public.softora_refresh_mailbox_campaign_lineage_impacts(
          v_new_account,
          v_message_key,
          array[v_new_message_id]
        );
      end if;
    end if;
  end if;$new$,
  'lineage trigger: coalesce recursive impact refresh only during activation'
);

-- Add one transaction-local key list to the reviewed finalizer and activate
-- batching only after every snapshot/coverage guard has passed.
select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  v_snapshot_digest text;
  v_result jsonb;
begin$old$,
  $new$  v_snapshot_digest text;
  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
begin$new$,
  'commit activation: declare exact retired-key set'
);

select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  insert into public.softora_mailbox_messages as stored_message ($old$,
  $new$  from public.softora_mailbox_uid_generation_staging as staged
  where staged.generation_id = p_generation_id;

  select coalesce(
    pg_catalog.array_agg(old_message.message_key order by old_message.message_key),
    '{}'::text[]
  ) into v_retired_message_keys
  from public.softora_mailbox_messages as old_message
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2',
    pg_catalog.jsonb_build_object(
      'syncKey', v_sync.sync_key,
      'accountEmail', v_sync.account_email,
      'folder', v_sync.folder,
      'oldGenerationId', v_sync.active_uid_generation_id,
      'newGenerationId', p_generation_id
    )::text,
    true
  );

  insert into public.softora_mailbox_messages as stored_message ($new$,
  'commit activation: capture old keys and enable batch lineage'
);

select pg_temp.softora_replace_final_activation_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  if v_active.generation_id is not null then$old$,
  $new$  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and (
      v_sync.active_uid_generation_id is null
        and old_message.uid_generation_id is null
      or v_sync.active_uid_generation_id is not null
        and old_message.uid_generation_id = v_sync.active_uid_generation_id
    )
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2', '', true
  );

  -- The healthy invariant has exactly one visible old generation. Preserve the
  -- former broad cleanup as a fail-safe for any historical stale generation,
  -- but run that exceptional remainder with ordinary per-row lineage impact.
  -- This keeps the batch scope exact without ever leaving stale visible rows.
  update public.softora_mailbox_messages as stale_message
  set generation_superseded_at = coalesce(
        stale_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(stale_message.deleted_at, v_now),
      updated_at = v_now
  where stale_message.account_email = v_sync.account_email
    and stale_message.folder = v_sync.folder
    and stale_message.uid_generation_id is distinct from p_generation_id
    and stale_message.generation_superseded_at is null;

  perform public.softora_refresh_mailbox_activation_lineage_v2(
    v_sync.account_email,
    v_sync.folder,
    p_generation_id,
    v_retired_message_keys
  );

  if v_active.generation_id is not null then$new$,
  'commit activation: rebuild the combined lineage impact once'
);

revoke all on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) to service_role;
revoke all on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) to service_role;

comment on function public.softora_refresh_mailbox_activation_lineage_v2(
  text, text, uuid, text[]
) is 'Rebuilds the combined old/new lineage impact exactly once inside a fenced final UID-generation activation.';
comment on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) is 'Fails closed unless a row belongs exactly to the transaction-local old/new UID-generation activation scope.';

notify pgrst, 'reload schema';
-- mailbox-final-activation-lineage-batch:end
