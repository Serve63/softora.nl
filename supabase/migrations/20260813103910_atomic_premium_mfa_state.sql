create or replace function public.softora_replace_premium_auth_users(
  p_expected_revision bigint,
  p_allow_insert boolean,
  p_payload jsonb,
  p_meta jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_revision bigint;
  v_updated_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(p_payload) <> 'object'
    or jsonb_typeof(p_payload -> 'users') <> 'array'
    or jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) <> 'object'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select revision
    into v_revision
  from public.softora_runtime_state
  where state_key = 'premium_auth_users'
  for update;

  if not found then
    if not coalesce(p_allow_insert, false) or p_expected_revision <> -1 then
      return jsonb_build_object('ok', false, 'reason', 'state_conflict');
    end if;

    insert into public.softora_runtime_state (state_key, payload, meta, revision, updated_at)
    values ('premium_auth_users', p_payload, coalesce(p_meta, '{}'::jsonb), 0, v_updated_at)
    on conflict (state_key) do nothing;

    if not found then
      return jsonb_build_object('ok', false, 'reason', 'state_conflict');
    end if;

    return jsonb_build_object(
      'ok', true,
      'payload', p_payload,
      'revision', 0,
      'updatedAt', v_updated_at
    );
  end if;

  if p_expected_revision < 0 or v_revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'reason', 'state_conflict', 'revision', v_revision);
  end if;

  update public.softora_runtime_state
  set payload = p_payload,
      meta = coalesce(p_meta, '{}'::jsonb),
      revision = v_revision + 1,
      updated_at = v_updated_at
  where state_key = 'premium_auth_users';

  return jsonb_build_object(
    'ok', true,
    'payload', p_payload,
    'revision', v_revision + 1,
    'updatedAt', v_updated_at
  );
end;
$$;

comment on function public.softora_replace_premium_auth_users(bigint, boolean, jsonb, jsonb) is
  'Vervangt de centrale premium-gebruikerslijst alleen bij de verwachte rijrevision en voorkomt verloren updates.';

revoke all on function public.softora_replace_premium_auth_users(bigint, boolean, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_replace_premium_auth_users(bigint, boolean, jsonb, jsonb)
  to service_role;

create or replace function public.softora_mutate_premium_mfa_state(
  p_user_id text,
  p_expected_email text,
  p_expected_auth_version bigint,
  p_expected_last_totp_counter bigint,
  p_expected_encrypted_secret text,
  p_expected_recovery_code_hash text,
  p_action text,
  p_next_mfa jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_payload jsonb;
  v_meta jsonb;
  v_revision bigint;
  v_users jsonb;
  v_user jsonb;
  v_current_mfa jsonb;
  v_current_auth_version bigint;
  v_current_counter bigint;
  v_current_enabled boolean;
  v_next_enabled boolean;
  v_user_index integer;
  v_match_count integer;
  v_current_recovery_hashes jsonb;
  v_expected_recovery_hashes jsonb;
  v_next_counter bigint;
  v_next_auth_version bigint;
  v_next_user jsonb;
  v_next_users jsonb;
  v_updated_at timestamptz := clock_timestamp();
begin
  if coalesce(btrim(p_user_id), '') = ''
    or coalesce(lower(btrim(p_expected_email)), '') = ''
    or p_expected_auth_version < 1
    or p_expected_last_totp_counter < 0
    or p_action not in ('enrollment_start', 'enrollment_complete', 'totp', 'recovery')
    or jsonb_typeof(p_next_mfa) <> 'object'
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;

  select payload, meta, revision
    into v_payload, v_meta, v_revision
  from public.softora_runtime_state
  where state_key = 'premium_auth_users'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'state_missing');
  end if;

  v_users := v_payload -> 'users';
  if jsonb_typeof(v_users) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;

  select count(*)::integer, min(item.ordinality)::integer - 1
    into v_match_count, v_user_index
  from jsonb_array_elements(v_users) with ordinality as item(value, ordinality)
  where item.value ->> 'id' = p_user_id
    and lower(item.value ->> 'email') = lower(btrim(p_expected_email));

  if v_match_count <> 1 then
    return jsonb_build_object('ok', false, 'reason', 'user_conflict');
  end if;

  v_user := v_users -> v_user_index;
  v_current_mfa := case
    when jsonb_typeof(v_user -> 'mfa') = 'object' then v_user -> 'mfa'
    else '{}'::jsonb
  end;
  if coalesce(v_user ->> 'authVersion', '1') !~ '^[0-9]{1,18}$'
    or coalesce(v_current_mfa ->> 'lastTotpCounter', '0') !~ '^[0-9]{1,18}$'
    or coalesce(v_current_mfa ->> 'enabled', 'false') not in ('true', 'false')
    or coalesce(p_next_mfa ->> 'lastTotpCounter', '') !~ '^[0-9]{1,18}$'
    or coalesce(p_next_mfa ->> 'enabled', '') not in ('true', 'false')
  then
    return jsonb_build_object('ok', false, 'reason', 'invalid_state');
  end if;

  v_current_auth_version := greatest(1, coalesce(v_user ->> 'authVersion', '1')::bigint);
  v_current_counter := greatest(0, coalesce(v_current_mfa ->> 'lastTotpCounter', '0')::bigint);
  v_current_enabled := coalesce(v_current_mfa ->> 'enabled', 'false')::boolean;
  v_next_enabled := (p_next_mfa ->> 'enabled')::boolean;
  v_current_recovery_hashes := case
    when jsonb_typeof(v_current_mfa -> 'recoveryCodeHashes') = 'array'
      then v_current_mfa -> 'recoveryCodeHashes'
    else '[]'::jsonb
  end;
  v_next_counter := greatest(0, (p_next_mfa ->> 'lastTotpCounter')::bigint);

  if v_current_auth_version <> p_expected_auth_version
    or v_current_counter <> p_expected_last_totp_counter
    or coalesce(v_current_mfa ->> 'encryptedSecret', '') <> coalesce(p_expected_encrypted_secret, '')
  then
    return jsonb_build_object('ok', false, 'reason', 'stale_state');
  end if;

  if p_action = 'enrollment_start' then
    if v_current_enabled
      or v_next_enabled
      or coalesce(p_next_mfa ->> 'encryptedSecret', '') = ''
      or jsonb_typeof(p_next_mfa -> 'recoveryCodeHashes') <> 'array'
      or jsonb_array_length(p_next_mfa -> 'recoveryCodeHashes') <> 8
      or v_next_counter <> 0
      or coalesce(p_expected_recovery_code_hash, '') <> ''
    then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    end if;
    v_next_auth_version := v_current_auth_version;
  elsif p_action = 'enrollment_complete' then
    if v_current_enabled
      or not v_next_enabled
      or coalesce(v_current_mfa ->> 'encryptedSecret', '') = ''
      or p_next_mfa ->> 'encryptedSecret' <> v_current_mfa ->> 'encryptedSecret'
      or p_next_mfa -> 'recoveryCodeHashes' <> v_current_recovery_hashes
      or v_next_counter <= v_current_counter
      or coalesce(p_expected_recovery_code_hash, '') <> ''
    then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    end if;
    v_next_auth_version := v_current_auth_version + 1;
  elsif p_action = 'totp' then
    if not v_current_enabled
      or not v_next_enabled
      or p_next_mfa ->> 'encryptedSecret' <> v_current_mfa ->> 'encryptedSecret'
      or p_next_mfa -> 'recoveryCodeHashes' <> v_current_recovery_hashes
      or v_next_counter <= v_current_counter
      or coalesce(p_expected_recovery_code_hash, '') <> ''
    then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    end if;
    v_next_auth_version := v_current_auth_version;
  else
    select coalesce(jsonb_agg(entry.value order by entry.ordinality), '[]'::jsonb)
      into v_expected_recovery_hashes
    from jsonb_array_elements(v_current_recovery_hashes) with ordinality as entry(value, ordinality)
    where entry.value #>> '{}' <> coalesce(p_expected_recovery_code_hash, '');

    if not v_current_enabled
      or not v_next_enabled
      or coalesce(p_expected_recovery_code_hash, '') = ''
      or not (v_current_recovery_hashes ? p_expected_recovery_code_hash)
      or jsonb_array_length(v_expected_recovery_hashes) <> jsonb_array_length(v_current_recovery_hashes) - 1
      or p_next_mfa -> 'recoveryCodeHashes' <> v_expected_recovery_hashes
      or p_next_mfa ->> 'encryptedSecret' <> v_current_mfa ->> 'encryptedSecret'
      or v_next_counter <> v_current_counter
    then
      return jsonb_build_object('ok', false, 'reason', 'invalid_transition');
    end if;
    v_next_auth_version := v_current_auth_version;
  end if;

  v_next_user := v_user || jsonb_build_object(
    'mfa', p_next_mfa,
    'authVersion', v_next_auth_version,
    'updatedAt', to_char(v_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  v_next_users := jsonb_set(v_users, array[v_user_index::text], v_next_user, false);
  v_payload := jsonb_set(v_payload, '{users}', v_next_users, false);
  v_meta := coalesce(v_meta, '{}'::jsonb) || jsonb_build_object(
    'type', 'premium_auth_users',
    'source', 'premium_auth_mfa_atomic',
    'reason', p_action,
    'actorEmail', lower(btrim(p_expected_email))
  );

  update public.softora_runtime_state
  set payload = v_payload,
      meta = v_meta,
      revision = v_revision + 1,
      updated_at = v_updated_at
  where state_key = 'premium_auth_users';

  return jsonb_build_object(
    'ok', true,
    'action', p_action,
    'user', v_next_user,
    'payload', v_payload,
    'revision', v_revision + 1,
    'updatedAt', v_updated_at
  );
end;
$$;

comment on function public.softora_mutate_premium_mfa_state(text, text, bigint, bigint, text, text, text, jsonb) is
  'Serialiseert premium MFA-enrollment, TOTP-replaybeveiliging en eenmalige recoverycodes op de centrale auth-rij.';

revoke all on function public.softora_mutate_premium_mfa_state(text, text, bigint, bigint, text, text, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.softora_mutate_premium_mfa_state(text, text, bigint, bigint, text, text, text, jsonb)
  to service_role;
