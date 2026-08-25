-- mailbox-final-activation-scale:start
--
-- Final UID-generation activation must stay comfortably below the mailbox
-- client's fixed deadline even when a Sent snapshot, several historical
-- generations and many logical tombstones are involved. Preserve the exact
-- activation semantics while making its remaining hot paths index/set based:
-- canonical Message-ID lookup, prior-state inheritance, campaign-lineage
-- resolution and stale retirement.

do $preflight$
declare
  v_protocol text;
  v_definition text;
  v_oid pg_catalog.oid;
  v_signature text;
  v_resolver_calls integer;
begin
  select consistency.uid_generation_protocol into v_protocol
  from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign';
  if not found or v_protocol is distinct from 'v2' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REQUIRES_V2';
  end if;

  if pg_catalog.to_regclass('public.softora_mailbox_messages') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generations') is null
    or pg_catalog.to_regclass('public.softora_mailbox_uid_generation_staging') is null
    or pg_catalog.to_regclass(
      'public.softora_mailbox_campaign_lineage_discoveries'
    ) is null
    or pg_catalog.to_regclass(
      'public.softora_mailbox_campaign_lineage_members'
    ) is null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_TABLE_MISSING';
  end if;

  if pg_catalog.to_regclass(
      'public.softora_mailbox_messages_prior_state_active_idx'
    ) is not null then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_INDEX_DRIFT';
  end if;

  if pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ) is not null then
    v_definition := pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ));
    if v_definition is distinct from
      'CREATE INDEX softora_mailbox_message_id_exact_lookup_idx ON public.softora_mailbox_messages USING btree (account_email, softora_normalize_mailbox_message_id(message_id)) WHERE ((deleted_at IS NULL) AND (NULLIF(btrim(message_id), ''''::text) IS NOT NULL))' then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_DRIFT';
    end if;
  end if;

  foreach v_signature in array array[
    'public.softora_normalize_mailbox_message_id(text)',
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
    'public.softora_mailbox_lineage_activation_row_matches_v2(text,text,text,uuid,timestamptz,text,text,uuid,timestamptz)',
    'public.softora_refresh_mailbox_activation_lineage_v2(text,text,uuid,text[])',
    'public.softora_resolve_mailbox_campaign_lineage(text,text[])',
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'
  ] loop
    v_oid := pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_FUNCTION_MISSING',
        detail = v_signature;
    end if;
    if exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid = v_oid
        and procedure.prosecdef
    ) then
      raise exception using errcode = '55000',
        message = 'MAILBOX_FINAL_ACTIVATION_SCALE_SECURITY_DRIFT',
        detail = v_signature;
    end if;
  end loop;

  select procedure.provolatile into strict v_protocol
  from pg_catalog.pg_proc as procedure
  where procedure.oid =
    'public.softora_normalize_mailbox_message_id(text)'::pg_catalog.regprocedure;
  if v_protocol is distinct from 'i' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_NORMALIZER_NOT_IMMUTABLE';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, 'v_retired_message_keys text[]') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationId''') = 0
    or (
      pg_catalog.char_length(v_definition)
      - pg_catalog.char_length(pg_catalog.replace(
        pg_catalog.lower(v_definition), 'left join ' || 'lateral (', ''
      ))
    ) / pg_catalog.char_length('left join ' || 'lateral (') <> 1
    or pg_catalog.strpos(
      v_definition,
      'softora.mailbox_lineage_batch_activation_v2'
    ) = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_COMMIT_DRIFT';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_mailbox_lineage_activation_row_matches_v2(text,text,text,uuid,timestamptz,text,text,uuid,timestamptz)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, '''oldGenerationId''') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationIds''') > 0
    or pg_catalog.strpos(v_definition, 'v_scope_key_count <> 5') = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_SCOPE_DRIFT';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
  );
  v_resolver_calls := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v_definition,
      'public.softora_resolve_mailbox_campaign_lineage(',
      ''
    ))
  ) / pg_catalog.char_length(
    'public.softora_resolve_mailbox_campaign_lineage('
  );
  if v_resolver_calls <> 2
    or pg_catalog.strpos(
      v_definition,
      'on conflict (message_key, root_message_key) do update set'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'first_discovered_at = case'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'when coalesce(p_previous_roots'
    ) = 0
    or pg_catalog.strpos(
      v_definition,
      'on conflict (message_key) do update set'
    ) = 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REBUILD_DRIFT';
  end if;
end;
$preflight$;

-- The existing exact-lookup index used a raw non-empty predicate that the
-- planner could not infer from normalized equality, so canonical lookups
-- ignored it. Rebuild the same physical index with the resolver's exact
-- predicate instead of keeping a redundant parallel index.
drop index if exists public.softora_mailbox_message_id_exact_lookup_idx;
create index softora_mailbox_message_id_exact_lookup_idx
on public.softora_mailbox_messages (
  account_email,
  public.softora_normalize_mailbox_message_id(message_id)
)
where deleted_at is null
  and public.softora_normalize_mailbox_message_id(message_id) is not null;

create index if not exists softora_mailbox_messages_prior_state_active_idx
on public.softora_mailbox_messages (
  account_email,
  folder,
  public.softora_normalize_mailbox_message_id(message_id),
  updated_at desc,
  message_key
)
include (
  uid_generation_id,
  softora_read_at,
  state_revision,
  state_mutation_key,
  state_mutation_at,
  starred,
  reply_dismissed_at,
  deleted_at
)
where generation_superseded_at is null
  and public.softora_normalize_mailbox_message_id(message_id) is not null;

create or replace function pg_temp.softora_replace_final_activation_scale_fragment(
  p_signature text,
  p_old text,
  p_new text,
  p_label text
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_oid pg_catalog.oid := pg_catalog.to_regprocedure(p_signature);
  v_definition text;
  v_matches integer;
begin
  if v_oid is null or coalesce(p_old, '') = '' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_PATCH_TARGET_INVALID',
      detail = p_label;
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_oid);
  v_matches := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(v_definition, p_old, ''))
  ) / pg_catalog.char_length(p_old);
  if v_matches <> 1 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_PATCH_DRIFT',
      detail = p_label || ': expected one fragment, found ' || v_matches::text;
  end if;
  execute pg_catalog.replace(v_definition, p_old, p_new);
end;
$function$;

-- The scope now carries every visible old generation captured before the
-- activation starts. A JSON null is the intentional identity of legacy rows;
-- arbitrary values, duplicates, non-canonical UUIDs and extra keys fail closed.
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
  v_new_generation_id text;
  v_new_generation_uuid uuid;
  v_old_generation_ids jsonb;
  v_old_generation_uuids uuid[] := '{}'::uuid[];
  v_old_generation_includes_null boolean := false;
  v_generation_item jsonb;
  v_generation_text text;
  v_generation_uuid uuid;
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
      'oldGenerationIds', 'newGenerationId'
    ]::text[])
    or pg_catalog.jsonb_typeof(v_scope->'syncKey') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'accountEmail') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'folder') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'newGenerationId') is distinct from 'string'
    or pg_catalog.jsonb_typeof(v_scope->'oldGenerationIds')
      is distinct from 'array' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  v_sync_key := pg_catalog.lower(pg_catalog.btrim(v_scope->>'syncKey'));
  v_account_email := pg_catalog.lower(pg_catalog.btrim(v_scope->>'accountEmail'));
  v_folder := pg_catalog.lower(pg_catalog.btrim(v_scope->>'folder'));
  v_new_generation_id := pg_catalog.lower(pg_catalog.btrim(coalesce(
    v_scope->>'newGenerationId', ''
  )));
  v_old_generation_ids := v_scope->'oldGenerationIds';

  if pg_catalog.jsonb_array_length(v_old_generation_ids) <> (
    select pg_catalog.count(distinct generation.value)::integer
    from pg_catalog.jsonb_array_elements(v_old_generation_ids)
      as generation(value)
  ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end if;

  begin
    v_new_generation_uuid := v_new_generation_id::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '55000',
      message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
  end;

  for v_generation_item in
    select generation.value
    from pg_catalog.jsonb_array_elements(v_old_generation_ids)
      as generation(value)
  loop
    if v_generation_item = 'null'::jsonb then
      v_old_generation_includes_null := true;
    elsif pg_catalog.jsonb_typeof(v_generation_item) = 'string' then
      v_generation_text := v_generation_item #>> '{}';
      begin
        v_generation_uuid := v_generation_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '55000',
          message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
      end;
      if v_generation_text is distinct from v_generation_uuid::text then
        raise exception using errcode = '55000',
          message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
      end if;
      v_old_generation_uuids := pg_catalog.array_append(
        v_old_generation_uuids, v_generation_uuid
      );
    else
      raise exception using errcode = '55000',
        message = 'MAILBOX_LINEAGE_ACTIVATION_SCOPE_INVALID';
    end if;
  end loop;

  if v_new_generation_uuid = any (v_old_generation_uuids)
    or coalesce(pg_catalog.current_setting(
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
    or v_new_generation_id is distinct from v_new_generation_uuid::text then
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
        -- One of the exact visible generations captured before activation.
        p_new_generation_id is not distinct from p_old_generation_id
          and p_old_superseded_at is null
          and p_new_superseded_at is not null
          and (
            p_old_generation_id is null
              and v_old_generation_includes_null
            or p_old_generation_id = any (v_old_generation_uuids)
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

-- Resolve once, then feed both upserts from that materialized result. The
-- discovery upsert returns its conflict-adjusted timestamp directly to the
-- member upsert, preserving backfill and previous-root semantics exactly.
create or replace function public.softora_rebuild_mailbox_campaign_lineage(
  p_account_email text,
  p_start_keys text[],
  p_backfill boolean default false,
  p_previous_roots jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
begin
  with resolved_lineage as materialized (
    select resolved.*
    from public.softora_resolve_mailbox_campaign_lineage(
      p_account_email, p_start_keys
    ) as resolved
  ), upserted_discoveries as (
    insert into public.softora_mailbox_campaign_lineage_discoveries (
      message_key, root_message_key, account_email,
      first_discovered_at, last_confirmed_at
    )
    select
      resolved.message_key,
      resolved.root_message_key,
      resolved.account_email,
      case when p_backfill
        then coalesce(messages.created_at, pg_catalog.clock_timestamp())
        else pg_catalog.clock_timestamp()
      end,
      pg_catalog.clock_timestamp()
    from resolved_lineage as resolved
    join public.softora_mailbox_messages as messages
      on messages.message_key = resolved.message_key
    on conflict (message_key, root_message_key) do update set
      account_email = excluded.account_email,
      first_discovered_at = case
        when coalesce(p_previous_roots->>excluded.message_key, '')
          = excluded.root_message_key
          then public.softora_mailbox_campaign_lineage_discoveries.first_discovered_at
        else excluded.first_discovered_at
      end,
      last_confirmed_at = excluded.last_confirmed_at,
      active = true,
      last_disconnected_at = null
    returning message_key, root_message_key, first_discovered_at
  )
  insert into public.softora_mailbox_campaign_lineage_members (
    message_key, account_email, message_id, parent_message_key,
    root_message_key, root_message_id, lineage_depth, message_date,
    is_incoming, is_proven_automated, lineage_discovered_at,
    created_at, updated_at
  )
  select
    resolved.message_key,
    resolved.account_email,
    resolved.message_id,
    resolved.parent_message_key,
    resolved.root_message_key,
    resolved.root_message_id,
    resolved.lineage_depth,
    messages.date,
    public.softora_is_mailbox_incoming_message(
      messages.account_email,
      messages.folder,
      messages.sender_email,
      messages.recipients_text,
      messages.payload
    ),
    public.softora_has_proven_automated_reply(messages.payload),
    discoveries.first_discovered_at,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  from resolved_lineage as resolved
  join upserted_discoveries as discoveries
    on discoveries.message_key = resolved.message_key
    and discoveries.root_message_key = resolved.root_message_key
  join public.softora_mailbox_messages as messages
    on messages.message_key = resolved.message_key
  on conflict (message_key) do update set
    account_email = excluded.account_email,
    message_id = excluded.message_id,
    parent_message_key = excluded.parent_message_key,
    root_message_key = excluded.root_message_key,
    root_message_id = excluded.root_message_id,
    lineage_depth = excluded.lineage_depth,
    message_date = excluded.message_date,
    is_incoming = excluded.is_incoming,
    is_proven_automated = excluded.is_proven_automated,
    lineage_discovered_at = excluded.lineage_discovered_at,
    updated_at = excluded.updated_at;
end;
$function$;

select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
begin$old$,
  $new$  v_result jsonb;
  v_retired_message_keys text[] := '{}'::text[];
  v_retired_generation_ids jsonb := '[]'::jsonb;
begin$new$,
  'commit activation: declare every retired generation identity'
);

select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  select coalesce(
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
  );$old$,
  $new$  select
    coalesce(
      pg_catalog.array_agg(
        old_message.message_key order by old_message.message_key
      ),
      '{}'::text[]
    ),
    coalesce(
      pg_catalog.jsonb_agg(
        distinct old_message.uid_generation_id
        order by old_message.uid_generation_id
      ),
      '[]'::jsonb
    )
  into v_retired_message_keys, v_retired_generation_ids
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
      'oldGenerationIds', v_retired_generation_ids,
      'newGenerationId', p_generation_id
    )::text,
    true
  );$new$,
  'commit activation: capture all visible old generation identities'
);

-- Parse the staged payload once and rank every eligible old state once. The
-- DISTINCT ON order is byte-for-byte equivalent to the former lateral LIMIT 1.
select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, incoming.provider_id, incoming.message_id,
    incoming.in_reply_to, incoming.references_text, incoming.sender_name,
    incoming.sender_email, incoming.recipients_text, incoming.subject,
    incoming.preview, incoming.body_text, coalesce(incoming.body_truncated, false),
    coalesce(incoming.has_body, false), incoming.date, incoming.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(incoming.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, incoming.starred, false),
    prior.reply_dismissed_at, coalesce(incoming.payload, '{}'::jsonb),
    coalesce(incoming.updated_at, v_now), prior.deleted_at
  from public.softora_mailbox_uid_generation_staging as staged
  cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
    provider_id text, message_id text, in_reply_to text, references_text text,
    sender_name text, sender_email text, recipients_text text, subject text,
    preview text, body_text text, body_truncated boolean, has_body boolean,
    date timestamptz, internal_date timestamptz, unread boolean,
    starred boolean, payload jsonb, updated_at timestamptz
  )
  left join lateral (
    select old_message.softora_read_at, old_message.state_revision,
      old_message.state_mutation_key, old_message.state_mutation_at,
      old_message.starred, old_message.reply_dismissed_at,
      old_message.deleted_at
    from public.softora_mailbox_messages as old_message
    where old_message.account_email = v_sync.account_email
      and old_message.folder = v_sync.folder
      and old_message.generation_superseded_at is null
      and old_message.uid_generation_id is distinct from p_generation_id
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        is not null
      and public.softora_normalize_mailbox_message_id(old_message.message_id)
        = public.softora_normalize_mailbox_message_id(incoming.message_id)
    order by old_message.updated_at desc, old_message.message_key
    limit 1
  ) as prior on true
  where staged.generation_id = p_generation_id
  order by staged.uid$old$,
  $new$  with staged_rows as materialized (
    select
      staged.uid,
      incoming.provider_id,
      incoming.message_id,
      incoming.in_reply_to,
      incoming.references_text,
      incoming.sender_name,
      incoming.sender_email,
      incoming.recipients_text,
      incoming.subject,
      incoming.preview,
      incoming.body_text,
      incoming.body_truncated,
      incoming.has_body,
      incoming.date,
      incoming.internal_date,
      incoming.unread,
      incoming.starred,
      incoming.payload,
      incoming.updated_at,
      public.softora_normalize_mailbox_message_id(incoming.message_id)
        as normalized_message_id
    from public.softora_mailbox_uid_generation_staging as staged
    cross join lateral pg_catalog.jsonb_to_record(staged.row_data) as incoming(
      provider_id text, message_id text, in_reply_to text, references_text text,
      sender_name text, sender_email text, recipients_text text, subject text,
      preview text, body_text text, body_truncated boolean, has_body boolean,
      date timestamptz, internal_date timestamptz, unread boolean,
      starred boolean, payload jsonb, updated_at timestamptz
    )
    where staged.generation_id = p_generation_id
  ), prior_state as materialized (
    select distinct on (candidate.normalized_message_id)
      candidate.normalized_message_id,
      candidate.softora_read_at,
      candidate.state_revision,
      candidate.state_mutation_key,
      candidate.state_mutation_at,
      candidate.starred,
      candidate.reply_dismissed_at,
      candidate.deleted_at
    from (
      select
        public.softora_normalize_mailbox_message_id(old_message.message_id)
          as normalized_message_id,
        old_message.softora_read_at,
        old_message.state_revision,
        old_message.state_mutation_key,
        old_message.state_mutation_at,
        old_message.starred,
        old_message.reply_dismissed_at,
        old_message.deleted_at,
        old_message.updated_at,
        old_message.message_key
      from public.softora_mailbox_messages as old_message
      where old_message.account_email = v_sync.account_email
        and old_message.folder = v_sync.folder
        and old_message.generation_superseded_at is null
        and old_message.uid_generation_id is distinct from p_generation_id
    ) as candidate
    where candidate.normalized_message_id is not null
    order by
      candidate.normalized_message_id,
      candidate.updated_at desc,
      candidate.message_key
  )
  insert into public.softora_mailbox_messages as stored_message (
    message_key, account_email, folder, uid, uid_validity, uid_generation_id,
    provider_id, message_id, in_reply_to, references_text, sender_name,
    sender_email, recipients_text, subject, preview, body_text,
    body_truncated, has_body, date, internal_date, unread, softora_read_at,
    state_revision, state_mutation_key, state_mutation_at, starred,
    reply_dismissed_at, payload, updated_at, deleted_at
  )
  select
    v_sync.account_email || '|' || v_sync.folder || '|gen:'
      || p_generation_id::text || '|' || staged.uid::text,
    v_sync.account_email, v_sync.folder, staged.uid, p_uid_validity,
    p_generation_id, staged.provider_id, staged.message_id,
    staged.in_reply_to, staged.references_text, staged.sender_name,
    staged.sender_email, staged.recipients_text, staged.subject,
    staged.preview, staged.body_text, coalesce(staged.body_truncated, false),
    coalesce(staged.has_body, false), staged.date, staged.internal_date,
    case when prior.softora_read_at is not null then false
      else coalesce(staged.unread, false) end,
    prior.softora_read_at, coalesce(prior.state_revision, 0),
    prior.state_mutation_key, prior.state_mutation_at,
    coalesce(prior.starred, staged.starred, false),
    prior.reply_dismissed_at, coalesce(staged.payload, '{}'::jsonb),
    coalesce(staged.updated_at, v_now), prior.deleted_at
  from staged_rows as staged
  left join prior_state as prior
    on prior.normalized_message_id = staged.normalized_message_id
  order by staged.uid$new$,
  'commit activation: inherit prior state set based'
);

-- Retire every captured visible old row in one statement while the strict
-- batch scope is active. Clear the scope immediately after that statement,
-- then rebuild the combined old/new lineage impact exactly once.
select pg_temp.softora_replace_final_activation_scale_fragment(
  'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)',
  $old$  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
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
  );$old$,
  $new$  update public.softora_mailbox_messages as old_message
  set generation_superseded_at = coalesce(
        old_message.generation_superseded_at, v_now
      ),
      deleted_at = coalesce(old_message.deleted_at, v_now),
      updated_at = v_now
  where old_message.account_email = v_sync.account_email
    and old_message.folder = v_sync.folder
    and old_message.uid_generation_id is distinct from p_generation_id
    and old_message.generation_superseded_at is null;

  perform pg_catalog.set_config(
    'softora.mailbox_lineage_batch_activation_v2', '', true
  );

  perform public.softora_refresh_mailbox_activation_lineage_v2(
    v_sync.account_email,
    v_sync.folder,
    p_generation_id,
    v_retired_message_keys
  );$new$,
  'commit activation: retire all stale generations in one batch'
);

revoke all on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.softora_commit_mailbox_sync_pass_v2(
  text, text, text, uuid, bigint, text, jsonb, jsonb, jsonb,
  bigint, bigint, boolean, integer, bigint
) to service_role;
revoke all on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) to service_role;
revoke all on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) to service_role;

comment on index public.softora_mailbox_messages_prior_state_active_idx is
  'Covers tombstone-inclusive prior mailbox state handoff for active UID generations.';
comment on index public.softora_mailbox_message_id_exact_lookup_idx is
  'Supports canonical mailbox Message-ID resolution with the exact visible-row predicate.';
comment on function public.softora_mailbox_lineage_activation_row_matches_v2(
  text, text, text, uuid, timestamptz, text, text, uuid, timestamptz
) is 'Fails closed unless a mailbox row belongs to the exact new generation or any captured old generation in one activation batch.';
comment on function public.softora_rebuild_mailbox_campaign_lineage(
  text, text[], boolean, jsonb
) is 'Materializes the canonical lineage resolver once and reuses its rows for discovery and member upserts.';

do $postcondition$
declare
  v_definition text;
  v_resolver_calls integer;
begin
  v_definition := case
    when pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ) is null then null
    else pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
      'public.softora_mailbox_message_id_exact_lookup_idx'
    ))
  end;
  if v_definition is distinct from
    'CREATE INDEX softora_mailbox_message_id_exact_lookup_idx ON public.softora_mailbox_messages USING btree (account_email, softora_normalize_mailbox_message_id(message_id)) WHERE ((deleted_at IS NULL) AND (softora_normalize_mailbox_message_id(message_id) IS NOT NULL))' then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_POSTCONDITION_FAILED';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'::pg_catalog.regprocedure
  );
  if pg_catalog.strpos(v_definition, 'with staged_rows as materialized') = 0
    or pg_catalog.strpos(v_definition, 'prior_state as materialized') = 0
    or pg_catalog.strpos(v_definition, '''oldGenerationIds''') = 0
    or pg_catalog.strpos(
      v_definition, 'left join ' || 'lateral ('
    ) > 0
    or pg_catalog.strpos(v_definition, 'stale_message') > 0 then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_COMMIT_POSTCONDITION_FAILED';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(
    'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
  );
  v_resolver_calls := (
    pg_catalog.char_length(v_definition)
    - pg_catalog.char_length(pg_catalog.replace(
      v_definition,
      'public.softora_resolve_mailbox_campaign_lineage(',
      ''
    ))
  ) / pg_catalog.char_length(
    'public.softora_resolve_mailbox_campaign_lineage('
  );
  if v_resolver_calls <> 1
    or pg_catalog.strpos(v_definition, 'resolved_lineage as materialized') = 0
    or pg_catalog.strpos(v_definition, 'returning message_key') = 0
    or exists (
      select 1
      from pg_catalog.pg_proc as procedure
      where procedure.oid =
        'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'::pg_catalog.regprocedure
        and procedure.prosecdef
    ) then
    raise exception using errcode = '55000',
      message = 'MAILBOX_FINAL_ACTIVATION_SCALE_REBUILD_POSTCONDITION_FAILED';
  end if;
end;
$postcondition$;

notify pgrst, 'reload schema';
-- mailbox-final-activation-scale:end
