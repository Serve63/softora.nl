const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const databaseUrl = String(process.env.MAILBOX_POSTGRES_TEST_URL || '').trim();
const destructiveAllowed = process.env.MAILBOX_POSTGRES_TEST_ALLOW_DESTRUCTIVE === '1';
const postgresContainerId = String(process.env.MAILBOX_POSTGRES_TEST_CONTAINER_ID || '').trim();

if (!databaseUrl) {
  test('echte PostgreSQL UID-generation-v2-tests vereisen MAILBOX_POSTGRES_TEST_URL', {
    skip: 'geen expliciete lokale PostgreSQL-testdatabase opgegeven',
  }, () => {});
} else {
  const parsedUrl = new URL(databaseUrl);
  if (
    !destructiveAllowed
    || !/^\/softora_mailbox_(?:uid_generation|lock)_test(?:_|$)/.test(parsedUrl.pathname)
    || !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsedUrl.hostname)
  ) {
    throw new Error('Weiger destructieve UID-generation-test buiten een expliciete lokale testdatabase.');
  }

  const { Client } = require('pg');
  const migration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260821202054_mailbox_uid_generation_epoch_v2.sql'
  ), 'utf8');
  const perKeyRepairMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824120423_mailbox_sync_per_key_finalizer_repair.sql'
  ), 'utf8');
  const targetOrderRepairMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824180221_fix_mailbox_uid_target_binary_order.sql'
  ), 'utf8');
  const anchorOptimizationMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824190410_optimize_mailbox_target_anchor_validation.sql'
  ), 'utf8');
  const targetManifestCheckpointMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824193645_checkpoint_mailbox_uid_target_manifest.sql'
  ), 'utf8');
  const finalActivationLineageMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824224810_optimize_mailbox_final_activation_lineage.sql'
  ), 'utf8');
  const strongIdentityMutationMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260825145746_mailbox_state_mutation_strong_identity.sql'
  ), 'utf8');
  const duplicateStateConvergenceMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260826075552_mailbox_duplicate_state_convergence.sql'
  ), 'utf8');
  const sendProvenanceFoundation = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260805200344_add_mailbox_send_provenance.sql'
  ), 'utf8');
  const providerOutcomeMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260810012150_mailbox_send_provider_outcome_state.sql'
  ), 'utf8');
  const sendProvenanceTimelineMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260824120230_mailbox_contact_timeline_send_provenance.sql'
  ), 'utf8');
  const provenanceFenceStart = sendProvenanceTimelineMigration.indexOf(
    '-- mailbox-send-provenance-visibility-fence:start'
  );
  const provenanceFenceEndMarker = '-- mailbox-send-provenance-visibility-fence:end';
  const provenanceFenceEnd = sendProvenanceTimelineMigration.indexOf(
    provenanceFenceEndMarker,
    provenanceFenceStart
  );
  if (provenanceFenceStart < 0 || provenanceFenceEnd <= provenanceFenceStart) {
    throw new Error('Getrackte provenance-visibilityfence mist het verwachte bereik.');
  }
  const sendProvenanceVisibilityFenceMigration = sendProvenanceTimelineMigration.slice(
    provenanceFenceStart,
    provenanceFenceEnd + provenanceFenceEndMarker.length
  );
  const clients = new Set();
  const martijnCompatibilityGeneration = '4eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  async function applyTrackedSql(client, sql) {
    const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
    const username = decodeURIComponent(parsedUrl.username || 'postgres');
    const password = decodeURIComponent(parsedUrl.password || '');
    let command = 'psql';
    let args = [
      '--single-transaction', '-v', 'ON_ERROR_STOP=1', '-h', parsedUrl.hostname,
      '-p', parsedUrl.port || '5432', '-U', username, '-d', databaseName,
    ];
    if (postgresContainerId) {
      if (!/^[a-f0-9]{12,64}$/i.test(postgresContainerId)) {
        throw new Error('Ongeldig PostgreSQL-servicecontainer-id voor UID-generation-test.');
      }
      command = 'docker';
      args = [
        'exec', '-i', '-e', `PGPASSWORD=${password}`, postgresContainerId,
        'psql', '--single-transaction', '-v', 'ON_ERROR_STOP=1',
        '-U', username, '-d', databaseName,
      ];
    }
    const result = spawnSync(command, args, {
      input: sql,
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: password },
      maxBuffer: 1024 * 1024,
    });
    if (result.error?.code === 'ENOENT' && !postgresContainerId) {
      // Keep tracked migration contents as a bound value; never concatenate them into a client query.
      await client.query(`
        create or replace function pg_temp.softora_apply_tracked_test_sql(p_sql text)
        returns void
        language plpgsql
        as $function$
        begin
          execute p_sql;
        end;
        $function$;
      `);
      await client.query(
        'select pg_temp.softora_apply_tracked_test_sql($1::text)',
        [sql]
      );
      return;
    }
    if (result.error || result.status !== 0) {
      const detail = String(result.stderr || result.error?.message || 'onbekende fout').trim();
      throw new Error(`Kon getrackte UID-generation-migratie niet toepassen: ${detail}`);
    }
  }

  async function connect() {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("set statement_timeout='10s'; set lock_timeout='7s';");
    clients.add(client);
    return client;
  }

  async function waitForBackendWait(client, pid, expectedWaitEvent, timeoutMs = 3_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const activity = (await client.query(`
        select wait_event_type,wait_event
        from pg_catalog.pg_stat_activity where pid=$1
      `, [pid])).rows[0];
      if (activity?.wait_event === expectedWaitEvent) return activity;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  function messageRow(uid, suffix, overrides = {}) {
    return {
      uid,
      provider_id: `imap:${suffix}:${uid}`,
      message_id: `${suffix}-${uid}@test.softora.nl`,
      sender_name: 'Prospect',
      sender_email: 'prospect@example.org',
      recipients_text: overrides.account_email || 'serve@softora.nl',
      subject: `Re: ${suffix}`,
      preview: suffix,
      body_text: `Body ${suffix}`,
      body_truncated: false,
      has_body: true,
      date: '2026-08-21T10:00:00.000Z',
      internal_date: '2026-08-21T10:00:00.000Z',
      unread: true,
      starred: false,
      payload: { source: 'imap-sync' },
      updated_at: '2026-08-21T10:00:00.000Z',
      ...overrides,
    };
  }

  async function lease(client, syncKey, token) {
    await client.query(`
      update public.softora_mailbox_sync_state
      set status='syncing',sync_started_at=clock_timestamp(),lock_token=$2,
          lock_expires_at=clock_timestamp()+interval '5 minutes',last_error=null
      where sync_key=$1
    `, [syncKey, token]);
  }

  async function prepare(
    client,
    syncKey,
    token,
    uidValidity,
    uidNext,
    selectionPolicy = 'staged-rebuild-v2',
    selectionTargets = []
  ) {
    return (await client.query(`
      select * from public.softora_prepare_mailbox_uid_generation_v3(
        $1,$2,$3::bigint,$4::bigint,$5,$6::jsonb
      )
    `, [
      syncKey, token, uidValidity, uidNext, selectionPolicy,
      JSON.stringify(selectionTargets),
    ])).rows[0];
  }

  async function commit(client, {
    syncKey, token, commitId, generationId, uidValidity, rows,
    fromUid, throughUid, complete, messageCount = rows.length, lastUid = throughUid,
    selectionPolicy = 'staged-rebuild-v2', targetReferenceIds = [],
    targetUidManifest = [],
  }) {
    return (await client.query(`
      select * from public.softora_commit_mailbox_sync_pass_v2(
        $1,$2,$3,$4::uuid,$5::bigint,$6,$7::jsonb,$8::jsonb,$9::jsonb,
        $10::bigint,$11::bigint,$12::boolean,$13::integer,$14::bigint
      )
    `, [
      syncKey, token, commitId, generationId, uidValidity, selectionPolicy,
      JSON.stringify(targetReferenceIds), JSON.stringify(targetUidManifest),
      JSON.stringify(rows), fromUid, throughUid, complete, messageCount, lastUid,
    ])).rows[0];
  }

  async function checkpointTargetManifest(client, {
    syncKey, token, checkpointId, generationId, uidValidity,
    expectedScannedThroughUid, scannedThroughUid, foundUids, scanComplete,
  }) {
    return (await client.query(`
      select * from public.softora_checkpoint_mailbox_uid_target_manifest_v2(
        $1,$2,$3,$4::uuid,$5::bigint,$6::bigint,$7::bigint,$8::jsonb,$9::boolean
      )
    `, [
      syncKey, token, checkpointId, generationId, uidValidity,
      expectedScannedThroughUid, scannedThroughUid,
      JSON.stringify(foundUids), scanComplete,
    ])).rows[0];
  }

  async function invalidateTargetManifest(client, {
    syncKey, token, invalidationId, generationId, uidValidity,
    expectedStagedCount, missingUids,
  }) {
    return (await client.query(`
      select * from public.softora_invalidate_mailbox_uid_target_manifest_v2(
        $1,$2,$3,$4::uuid,$5::bigint,$6::integer,$7::jsonb
      )
    `, [
      syncKey, token, invalidationId, generationId, uidValidity,
      expectedStagedCount, JSON.stringify(missingUids),
    ])).rows[0];
  }

  async function rejectsInSavepoint(client, operation, expected) {
    await client.query('savepoint expected_failure');
    try {
      await assert.rejects(operation(), expected);
    } finally {
      await client.query('rollback to savepoint expected_failure');
      await client.query('release savepoint expected_failure');
    }
  }

  async function createTargetedAllMailActiveFixture(client, {
    mutationPrefix,
    syncKey = 'servecreusen@softora.nl|allmail',
    accountEmail = 'servecreusen@softora.nl',
    targetReference = 'legacy-visible@test',
    uidValidity = 700,
    scanUpperUid = 4,
    targetUidManifest = [4],
  }) {
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,'allmail','idle',0,0,null)
    `, [syncKey, accountEmail]);
    const token = `${mutationPrefix}-lease`;
    await lease(client, syncKey, token);
    const prepared = await prepare(
      client,
      syncKey,
      token,
      uidValidity,
      scanUpperUid + 1,
      'targeted-sparse-v2',
      [targetReference]
    );
    const checkpoint = await checkpointTargetManifest(client, {
      syncKey,
      token,
      checkpointId: `${mutationPrefix}-checkpoint`,
      generationId: prepared.target_generation_id,
      uidValidity,
      expectedScannedThroughUid: 0,
      scannedThroughUid: scanUpperUid,
      foundUids: targetUidManifest,
      scanComplete: true,
    });
    assert.equal(checkpoint.checkpointed, true);
    const committed = await commit(client, {
      syncKey,
      token,
      commitId: `${mutationPrefix}-commit`,
      generationId: prepared.target_generation_id,
      uidValidity,
      selectionPolicy: 'targeted-sparse-v2',
      targetReferenceIds: [targetReference],
      targetUidManifest,
      rows: targetUidManifest.map((uid) => messageRow(uid, `${mutationPrefix}-${uid}`, {
        account_email: accountEmail,
        folder: 'allmail',
        in_reply_to: targetReference,
      })),
      fromUid: 1,
      throughUid: targetUidManifest.length,
      complete: true,
      messageCount: targetUidManifest.length,
      lastUid: 0,
    });
    assert.equal(committed.activated, true);
    return {
      accountEmail,
      generationId: prepared.target_generation_id,
      scanUpperUid,
      syncKey,
      targetReference,
      targetUidManifest,
      uidValidity,
    };
  }

  async function skipSync(client, {
    syncKey, token, commitId, reason = 'folder_missing',
  }) {
    return (await client.query(`
      select * from public.softora_skip_mailbox_sync_v2($1,$2,$3,$4)
    `, [syncKey, token, commitId, reason])).rows[0];
  }

  function lineageSnapshotRows(accountEmail, prefix, count) {
    const rootMessageId = `${prefix}-root@test.softora.nl`;
    return Array.from({ length: count }, (_, index) => {
      const uid = index + 1;
      return messageRow(uid, `${prefix}-${uid}`, {
        account_email: accountEmail,
        recipients_text: accountEmail,
        message_id: uid === 1
          ? rootMessageId
          : `${prefix}-child-${uid}@test.softora.nl`,
        in_reply_to: uid === 1 ? null : rootMessageId,
      });
    });
  }

  async function resetLineageMetrics(client) {
    await client.query(`
      update public.softora_mailbox_lineage_test_metrics set call_count=0
    `);
  }

  async function lineageMetrics(client) {
    return Object.fromEntries((await client.query(`
      select operation,call_count
      from public.softora_mailbox_lineage_test_metrics order by operation
    `)).rows.map((row) => [row.operation, row.call_count]));
  }

  async function activateSnapshot(client, {
    syncKey, token, commitId, uidValidity, rows,
  }) {
    await lease(client, syncKey, token);
    const prepared = await prepare(
      client, syncKey, token, uidValidity, rows.length + 1
    );
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.mode, 'rebuild');
    const committed = await commit(client, {
      syncKey, token, commitId,
      generationId: prepared.target_generation_id,
      uidValidity, rows,
      fromUid: 1, throughUid: rows.length, complete: true,
      messageCount: rows.length, lastUid: rows.length,
    });
    assert.equal(committed.activated, true);
    return { committed, prepared };
  }

  async function activateDuplicateStateFolder(client, {
    accountEmail,
    folder,
    prefix,
    rows,
    uidValidity,
  }) {
    const syncKey = `${accountEmail}|${folder}`;
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,$3,'idle',0,0,null)
    `, [syncKey, accountEmail, folder]);
    const normalizedRows = rows.map((row, index) => messageRow(
      Number(row.uid) || index + 1,
      `${prefix}-${index + 1}`,
      {
        account_email: accountEmail,
        folder,
        recipients_text: accountEmail,
        ...row,
      }
    ));
    const activated = await activateSnapshot(client, {
      syncKey,
      token: `${prefix}-token`,
      commitId: `${prefix}-commit`,
      uidValidity,
      rows: normalizedRows,
    });
    return {
      ...activated,
      accountEmail,
      folder,
      messageKeys: normalizedRows.map((row) => (
        `${syncKey}|gen:${activated.prepared.target_generation_id}|${row.uid}`
      )),
      rows: normalizedRows,
      syncKey,
    };
  }

  test.before(async () => {
    const client = await connect();
    await client.query(`
      do $roles$
      begin
        if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
      end;
      $roles$;
      drop schema public cascade;
      create schema public;
      grant usage on schema public to public, anon, authenticated, service_role;
      create schema if not exists extensions;
      create extension if not exists pgcrypto with schema extensions;

      create table public.softora_mailbox_messages (
        message_key text primary key,
        account_email text not null,
        folder text not null,
        uid bigint not null,
        provider_id text not null,
        message_id text,
        in_reply_to text,
        references_text text,
        sender_name text,
        sender_email text,
        recipients_text text,
        subject text,
        preview text,
        body_text text,
        body_truncated boolean not null default false,
        has_body boolean not null default false,
        date timestamptz not null,
        internal_date timestamptz,
        unread boolean not null default false,
        softora_read_at timestamptz,
        state_revision bigint not null default 0,
        state_mutation_key text,
        state_mutation_at timestamptz,
        starred boolean not null default false,
        reply_dismissed_at timestamptz,
        payload jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
        uid_validity bigint,
        generation_superseded_at timestamptz,
        constraint softora_mailbox_messages_account_email_folder_uid_key
          unique (account_email, folder, uid)
      );
      create table public.softora_mailbox_sync_state (
        sync_key text primary key,
        account_email text not null,
        folder text not null,
        status text not null default 'idle' check (status in ('idle','syncing','ok','error')),
        last_synced_at timestamptz,
        sync_started_at timestamptz,
        lock_token text,
        lock_expires_at timestamptz,
        last_uid bigint,
        message_count integer not null default 0,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        uid_validity bigint,
        uid_validity_reset_at timestamptz
      );
      create table public.softora_mailbox_campaign_consistency (
        scope text primary key check (scope='campaign'),
        content_version bigint not null default 0,
        uid_generation_protocol text not null default 'legacy',
        uid_generation_protocol_changed_at timestamptz not null default clock_timestamp(),
        uid_generation_drain_started_at timestamptz,
        uid_generation_drain_ready_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.softora_mailbox_campaign_lineage_roots (
        message_key text primary key
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        account_email text not null,
        message_id text not null,
        created_at timestamptz not null default clock_timestamp()
      );
      create table public.softora_mailbox_message_lineage_edges (
        child_message_key text not null
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        account_email text not null,
        child_message_id text,
        parent_message_id text not null,
        created_at timestamptz not null default clock_timestamp(),
        primary key(child_message_key,parent_message_id)
      );
      create table public.softora_mailbox_campaign_lineage_members (
        message_key text primary key
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        account_email text not null,
        message_id text,
        root_message_key text not null
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        root_message_id text not null,
        parent_message_key text
          references public.softora_mailbox_campaign_lineage_members(message_key)
          on update cascade on delete cascade deferrable initially deferred,
        lineage_depth integer not null,
        created_at timestamptz not null default clock_timestamp(),
        constraint softora_mailbox_campaign_lineage_members_check check (
          (lineage_depth = 0 and parent_message_key is null
            and root_message_key = message_key)
          or (lineage_depth > 0 and parent_message_key is not null)
        )
      );
      create table public.softora_mailbox_campaign_lineage_discoveries (
        account_email text not null,
        message_key text not null
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        root_message_key text not null
          references public.softora_mailbox_messages(message_key)
          on update cascade on delete cascade,
        active boolean not null default true,
        first_discovered_at timestamptz not null default clock_timestamp(),
        last_connected_at timestamptz not null default clock_timestamp(),
        last_disconnected_at timestamptz,
        primary key(account_email,message_key,root_message_key)
      );
      create table public.softora_mailbox_lineage_test_metrics (
        operation text primary key,
        call_count integer not null default 0
      );
      insert into public.softora_mailbox_lineage_test_metrics(operation)
      values('impact'),('rebuild');
      create table public.softora_mailbox_message_tombstones (
        account_email text not null,
        normalized_message_id text not null,
        deleted_at timestamptz not null default clock_timestamp(),
        updated_at timestamptz not null default clock_timestamp(),
        primary key(account_email,normalized_message_id)
      );
      insert into public.softora_mailbox_campaign_consistency(
        scope,uid_generation_protocol,uid_generation_protocol_changed_at,
        uid_generation_drain_started_at,uid_generation_drain_ready_at
      ) values(
        'campaign','draining',clock_timestamp()-interval '10 minutes',
        clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes'
      );

      create or replace function public.softora_lock_mailbox_sync_capacity()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        perform pg_catalog.pg_advisory_xact_lock(824031, 3);
        return null;
      end;
      $function$;
      create trigger softora_mailbox_sync_capacity_lock
      before insert or update or delete on public.softora_mailbox_sync_state
      for each statement execute function public.softora_lock_mailbox_sync_capacity();

      create or replace function public.softora_claim_mailbox_sync_lock(
        p_sync_key text,
        p_account_email text,
        p_folder text,
        p_lock_token text,
        p_lock_ttl_seconds integer default 90,
        p_force boolean default false,
        p_protocol text default 'legacy'
      )
      returns table (
        acquired boolean,
        locked boolean,
        claimed_lock_token text,
        lock_expires_at timestamptz
      )
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $function$
      declare
        v_sync_key text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_sync_key, '')));
        v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email, '')));
        v_folder text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder, '')));
        v_lock_token text := pg_catalog.btrim(coalesce(p_lock_token, ''));
        v_protocol text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_protocol, '')));
        v_consistency public.softora_mailbox_campaign_consistency%rowtype;
        v_current public.softora_mailbox_sync_state%rowtype;
        v_active_count integer := 0;
        v_blocked_until timestamptz;
      begin
        if v_sync_key = '' or pg_catalog.char_length(v_sync_key) > 600
          or v_account_email = '' or pg_catalog.char_length(v_account_email) > 320
          or v_folder = '' or pg_catalog.char_length(v_folder) > 200
          or v_lock_token = '' or pg_catalog.char_length(v_lock_token) > 200
          or position('|' in v_account_email) > 0
          or position('|' in v_folder) > 0
          or v_sync_key is distinct from (v_account_email || '|' || v_folder)
          or v_protocol not in ('legacy', 'v2') then
          raise exception using errcode = '22023',
            message = 'MAILBOX_SYNC_LOCK_IDENTITY_INVALID';
        end if;

        perform pg_catalog.pg_advisory_xact_lock(824031, 3);
        select consistency.* into strict v_consistency
        from public.softora_mailbox_campaign_consistency as consistency
  where consistency.scope = 'campaign'
  for update;

        if v_consistency.uid_generation_protocol = 'draining'
          or v_consistency.uid_generation_protocol is distinct from v_protocol then
          v_blocked_until := greatest(
            coalesce(v_consistency.uid_generation_drain_ready_at,
              pg_catalog.clock_timestamp()),
            pg_catalog.clock_timestamp() + interval '30 seconds'
          );
          return query select false, true, null::text, v_blocked_until;
          return;
        end if;

        select current_sync.* into v_current
        from public.softora_mailbox_sync_state as current_sync
        where current_sync.sync_key = v_sync_key
        for update;

        if found
          and v_current.status = 'syncing'
          and nullif(pg_catalog.btrim(v_current.lock_token), '') is not null
          and v_current.lock_expires_at > pg_catalog.clock_timestamp() then
          if pg_catalog.btrim(v_current.lock_token) = v_lock_token then
            return query select true, false, v_lock_token, v_current.lock_expires_at;
          else
            return query select false, true, null::text, v_current.lock_expires_at;
          end if;
          return;
        end if;

        select pg_catalog.count(*)::integer into v_active_count
        from public.softora_mailbox_sync_state as active_sync
        where active_sync.status = 'syncing'
          and nullif(pg_catalog.btrim(active_sync.lock_token), '') is not null
          and active_sync.lock_expires_at > pg_catalog.clock_timestamp()
          and active_sync.sync_key <> v_sync_key;
        if v_active_count >= 3 then
          return query select false, true, null::text, null::timestamptz;
          return;
        end if;

        insert into public.softora_mailbox_sync_state as stored_sync (
          sync_key, account_email, folder, status, sync_started_at,
          lock_token, lock_expires_at, last_error, updated_at
        ) values (
          v_sync_key, v_account_email, v_folder, 'syncing', pg_catalog.clock_timestamp(),
          v_lock_token,
          pg_catalog.clock_timestamp() + pg_catalog.make_interval(
            secs => greatest(10, least(
              300, coalesce(p_lock_ttl_seconds, 90)
            ))
          ),
          null, pg_catalog.clock_timestamp()
        )
        on conflict (sync_key) do update set
          account_email = excluded.account_email,
          folder = excluded.folder,
          status = excluded.status,
          sync_started_at = excluded.sync_started_at,
          lock_token = excluded.lock_token,
          lock_expires_at = excluded.lock_expires_at,
          last_error = null,
          updated_at = excluded.updated_at
        returning stored_sync.* into v_current;

        return query select true, false, v_lock_token, v_current.lock_expires_at;
      end;
      $function$;

      create or replace function public.softora_lock_mailbox_campaign_consistency_before_write()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        insert into public.softora_mailbox_campaign_consistency(scope,content_version)
        values('campaign',0) on conflict(scope) do nothing;
        perform 1 from public.softora_mailbox_campaign_consistency
        where scope='campaign' for update;
        return null;
      end;
      $function$;
      create trigger softora_lock_mailbox_campaign_consistency_before_write
      before insert or update or delete or truncate
      on public.softora_mailbox_messages for each statement
      execute function public.softora_lock_mailbox_campaign_consistency_before_write();

      create or replace function public.softora_guard_mailbox_uid_generation_protocol()
      returns trigger language plpgsql security invoker set search_path=''
      as $function$
      begin
        if old.uid_generation_protocol is distinct from new.uid_generation_protocol
          and (
            coalesce(current_setting('softora.mailbox_uid_protocol_transition',true),'') <> '1'
            or old.uid_generation_protocol <> 'draining'
            or new.uid_generation_protocol <> 'v2'
          ) then
          raise exception using errcode='55000',
            message='MAILBOX_UID_PROTOCOL_TRANSITION_REQUIRED';
        end if;
        return new;
      end;
      $function$;
      create trigger softora_guard_mailbox_uid_generation_protocol
      before update of uid_generation_protocol
      on public.softora_mailbox_campaign_consistency for each row
      execute function public.softora_guard_mailbox_uid_generation_protocol();

      create or replace function public.softora_normalize_mailbox_message_id(p_value text)
      returns text language sql immutable set search_path=''
      as $function$
        select nullif(lower(regexp_replace(btrim(coalesce(p_value,'')),
          '^[<>,[:space:]]+|[<>,[:space:]]+$','','g')),'');
      $function$;
      create index softora_mailbox_messages_logical_message_active_idx
      on public.softora_mailbox_messages(
        (pg_catalog.lower(pg_catalog.btrim(account_email))),
        (public.softora_normalize_mailbox_message_id(message_id))
      )
      where generation_superseded_at is null
        and public.softora_normalize_mailbox_message_id(message_id) is not null;
      create or replace function public.softora_mailbox_message_participants(
        p_sender_email text,p_recipients_text text,p_payload jsonb
      ) returns text[] language sql immutable security invoker set search_path=''
      as $function$
        select array_remove(array[
          nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email,''))),''),
          nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_recipients_text,''))),'' )
        ],null);
      $function$;
      create or replace function public.softora_inherit_mailbox_message_tombstone()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      declare
        v_account_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email,'')));
        v_deleted_at timestamptz;
        v_message_id text := public.softora_normalize_mailbox_message_id(new.message_id);
      begin
        if v_account_email='' or v_message_id is null then return new; end if;
        if tg_op='INSERT' then
          perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtext(v_account_email),
            pg_catalog.hashtext(v_message_id)
          );
        end if;
        select tombstone.deleted_at into v_deleted_at
        from public.softora_mailbox_message_tombstones as tombstone
        where tombstone.account_email=v_account_email
          and tombstone.normalized_message_id=v_message_id;
        if found then new.deleted_at:=v_deleted_at; end if;
        return new;
      end;
      $function$;
      create trigger softora_mailbox_messages_inherit_logical_tombstone
      before insert or update of account_email,message_id,deleted_at
      on public.softora_mailbox_messages for each row
      execute function public.softora_inherit_mailbox_message_tombstone();

      create or replace function public.softora_set_mailbox_message_visibility(
        p_account_email text,p_folder text,p_uid bigint,p_provider_id text,p_hidden boolean
      ) returns table(
        message_key text,account_email text,folder text,uid bigint,
        provider_id text,message_id text
      ) language plpgsql volatile security invoker set search_path=''
      as $function$
      declare
        v_anchor public.softora_mailbox_messages%rowtype;
        v_message_id text;
        v_changed_at timestamptz:=pg_catalog.clock_timestamp();
      begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;
        perform 1 from public.softora_mailbox_campaign_consistency
        where scope='campaign' for update;
        select m.* into v_anchor from public.softora_mailbox_messages as m
        where m.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and m.folder=pg_catalog.lower(pg_catalog.btrim(p_folder))
          and m.uid=p_uid and m.provider_id=p_provider_id
          and m.generation_superseded_at is null
        limit 1 for update;
        if not found then return; end if;
        v_message_id:=public.softora_normalize_mailbox_message_id(v_anchor.message_id);
        if v_message_id is not null and p_hidden then
          insert into public.softora_mailbox_message_tombstones(
            account_email,normalized_message_id,deleted_at,updated_at
          ) values(v_anchor.account_email,v_message_id,v_changed_at,v_changed_at)
          on conflict on constraint softora_mailbox_message_tombstones_pkey do update
          set deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
        elsif v_message_id is not null then
          delete from public.softora_mailbox_message_tombstones as tombstone
          where tombstone.account_email=v_anchor.account_email
            and tombstone.normalized_message_id=v_message_id;
        end if;
        return query update public.softora_mailbox_messages as m
        set deleted_at=case when p_hidden then v_changed_at else null end,
            updated_at=v_changed_at
        where m.account_email=v_anchor.account_email
          and m.generation_superseded_at is null
          and (v_message_id is null and m.message_key=v_anchor.message_key
            or v_message_id is not null
              and public.softora_normalize_mailbox_message_id(m.message_id)=v_message_id)
        returning m.message_key,m.account_email,m.folder,m.uid,m.provider_id,m.message_id;
      end;
      $function$;

      create or replace function public.softora_set_mailbox_contact_visibility(
        p_owner_accounts text[],p_contact_email text,p_anchor_account_email text,
        p_anchor_folder text,p_anchor_uid bigint,p_anchor_provider_id text,
        p_expected_message_count integer,p_hidden boolean
      ) returns table(
        message_key text,account_email text,folder text,uid bigint,
        provider_id text,message_id text
      ) language plpgsql volatile security invoker set search_path=''
      as $function$
      declare
        v_owner_accounts text[]:=p_owner_accounts;
        v_contact_email text:=pg_catalog.lower(pg_catalog.btrim(p_contact_email));
        v_message_ids text[];
        v_changed_at timestamptz:=pg_catalog.clock_timestamp();
      begin
  insert into public.softora_mailbox_campaign_consistency (scope, content_version)
  values ('campaign', 0)
  on conflict (scope) do nothing;
        perform 1 from public.softora_mailbox_campaign_consistency
        where scope='campaign' for update;
        select pg_catalog.array_agg(distinct public.softora_normalize_mailbox_message_id(m.message_id))
        into v_message_ids
        from public.softora_mailbox_messages as m
        where m.account_email=any(v_owner_accounts)
          and m.generation_superseded_at is null
          and v_contact_email=any(public.softora_mailbox_message_participants(
            m.sender_email,m.recipients_text,m.payload
          ));
        if coalesce(pg_catalog.cardinality(v_message_ids),0)=0 then return; end if;
        perform 1 from public.softora_mailbox_messages as m
        where m.account_email=any(v_owner_accounts)
          and m.generation_superseded_at is null
          and v_contact_email=any(public.softora_mailbox_message_participants(
            m.sender_email,m.recipients_text,m.payload
          )) for update;
        if p_hidden then
          insert into public.softora_mailbox_message_tombstones(
            account_email,normalized_message_id,deleted_at,updated_at
          ) select owner_account,normalized_message_id,v_changed_at,v_changed_at
          from pg_catalog.unnest(v_owner_accounts) as owner(owner_account)
          cross join pg_catalog.unnest(v_message_ids) as ids(normalized_message_id)
          on conflict on constraint softora_mailbox_message_tombstones_pkey do update
          set deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
        else
          delete from public.softora_mailbox_message_tombstones as tombstone
          where tombstone.account_email=any(v_owner_accounts)
            and tombstone.normalized_message_id=any(v_message_ids);
        end if;
        return query update public.softora_mailbox_messages as m
        set deleted_at=case when p_hidden then v_changed_at else null end,
            updated_at=v_changed_at
        where m.account_email=any(v_owner_accounts)
          and m.generation_superseded_at is null
          and v_contact_email=any(public.softora_mailbox_message_participants(
            m.sender_email,m.recipients_text,m.payload
          ))
        returning m.message_key,m.account_email,m.folder,m.uid,m.provider_id,m.message_id;
      end;
      $function$;

      create or replace function public.softora_apply_mailbox_uid_validity(
        p_account_email text,p_folder text,p_uid_validity bigint,p_lock_token text
      ) returns table(
        previous_uid_validity bigint,current_uid_validity bigint,
        reset_detected boolean,adopted_legacy boolean,superseded_count integer
      ) language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
  perform pg_advisory_xact_lock(824031, 3);
        perform 1 from public.softora_mailbox_campaign_consistency
        where scope='campaign' for update;
        return query select null::bigint,p_uid_validity,false,false,0;
      end;
      $function$;

      create or replace function public.softora_commit_mailbox_campaign_messages(
        p_mutation_id uuid,p_request_key text,p_rows jsonb,p_result jsonb default '{}'::jsonb
      ) returns table(
        mutation_id uuid,mutation_status text,started_content_version bigint,
        completed_content_version bigint,current_content_version bigint,
        upserted_count integer,replayed boolean
      ) language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
  perform pg_advisory_xact_lock(824031, 3);
        perform 1 from public.softora_mailbox_campaign_consistency
        where scope='campaign' for update;
        return query select p_mutation_id,'completed'::text,0::bigint,0::bigint,
          0::bigint,0,false;
      end;
      $function$;
      create or replace function public.softora_is_campaign_mailbox_message(
        p_account_email text,p_folder text,p_payload jsonb
      ) returns boolean language sql immutable security invoker set search_path=''
      as $function$
        select lower(btrim(coalesce(p_account_email,''))) like '%@softora.nl'
          and lower(btrim(coalesce(p_folder,''))) in ('inbox','sent','coldmail');
      $function$;
      create or replace function public.softora_track_mailbox_campaign_message_change()
      returns trigger
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $function$
      declare
        v_affects_campaign boolean := false;
begin
  if coalesce(current_setting('softora.mailbox_campaign_version_bumped', true), '') = '1' then
          return null;
        elsif tg_op = 'TRUNCATE' then
          v_affects_campaign := true;
        elsif tg_op = 'INSERT' then
          select exists (
            select 1 from softora_mailbox_campaign_new_rows as new_row
            where public.softora_is_campaign_mailbox_message(
              new_row.account_email, new_row.folder, new_row.payload
            )
          ) into v_affects_campaign;
        elsif tg_op = 'DELETE' then
          select exists (
            select 1 from softora_mailbox_campaign_old_rows as old_row
            where public.softora_is_campaign_mailbox_message(
              old_row.account_email, old_row.folder, old_row.payload
            )
          ) into v_affects_campaign;
        else
          select exists (
            select 1
            from softora_mailbox_campaign_old_rows as old_row
            full join softora_mailbox_campaign_new_rows as new_row
              on new_row.message_key = old_row.message_key
            where (
              public.softora_is_campaign_mailbox_message(
                old_row.account_email, old_row.folder, old_row.payload
              ) or public.softora_is_campaign_mailbox_message(
                new_row.account_email, new_row.folder, new_row.payload
              )
            ) and row(
              old_row.message_key, old_row.account_email, old_row.folder, old_row.uid,
              old_row.provider_id, old_row.message_id, old_row.in_reply_to, old_row.references_text,
              old_row.sender_name, old_row.sender_email, old_row.recipients_text, old_row.subject,
              old_row.preview, old_row.body_text, old_row.body_truncated, old_row.has_body,
              old_row.date, old_row.internal_date, old_row.unread, old_row.softora_read_at,
              old_row.starred, old_row.reply_dismissed_at, old_row.payload, old_row.deleted_at
            ) is distinct from row(
              new_row.message_key, new_row.account_email, new_row.folder, new_row.uid,
              new_row.provider_id, new_row.message_id, new_row.in_reply_to, new_row.references_text,
              new_row.sender_name, new_row.sender_email, new_row.recipients_text, new_row.subject,
              new_row.preview, new_row.body_text, new_row.body_truncated, new_row.has_body,
              new_row.date, new_row.internal_date, new_row.unread, new_row.softora_read_at,
              new_row.starred, new_row.reply_dismissed_at, new_row.payload, new_row.deleted_at
            )
          ) into v_affects_campaign;
        end if;

        if v_affects_campaign then
          perform set_config('softora.mailbox_campaign_version_bumped', '1', true);
          insert into public.softora_mailbox_campaign_consistency (
            scope, content_version, created_at, updated_at
          ) values ('campaign', 1, clock_timestamp(), clock_timestamp())
          on conflict (scope) do update set
            content_version = public.softora_mailbox_campaign_consistency.content_version + 1,
            updated_at = clock_timestamp();
        end if;
        return null;
      end;
      $function$;
      create trigger softora_track_mailbox_campaign_message_insert
      after insert on public.softora_mailbox_messages
      referencing new table as softora_mailbox_campaign_new_rows
      for each statement execute function public.softora_track_mailbox_campaign_message_change();
      create trigger softora_track_mailbox_campaign_message_update
      after update on public.softora_mailbox_messages
      referencing old table as softora_mailbox_campaign_old_rows
        new table as softora_mailbox_campaign_new_rows
      for each statement execute function public.softora_track_mailbox_campaign_message_change();
      create trigger softora_track_mailbox_campaign_message_delete
      after delete on public.softora_mailbox_messages
      referencing old table as softora_mailbox_campaign_old_rows
      for each statement execute function public.softora_track_mailbox_campaign_message_change();
      create trigger softora_track_mailbox_campaign_message_truncate
      after truncate on public.softora_mailbox_messages
      for each statement execute function public.softora_track_mailbox_campaign_message_change();

      create or replace function public.softora_rebuild_mailbox_campaign_lineage(
        p_account_email text,
        p_start_keys text[],
        p_full_rebuild boolean,
        p_previous_roots jsonb
      )
      returns void
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $function$
      begin
        update public.softora_mailbox_lineage_test_metrics
        set call_count=call_count+1 where operation='rebuild';

        insert into public.softora_mailbox_campaign_lineage_members(
          message_key,account_email,message_id,root_message_key,root_message_id,
          parent_message_key,lineage_depth
        )
        select root.message_key,root.account_email,root.message_id,
          root.message_key,root.message_id,null,0
        from public.softora_mailbox_campaign_lineage_roots as root
        join public.softora_mailbox_messages as message
          on message.message_key=root.message_key
        where root.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and message.deleted_at is null
          and message.generation_superseded_at is null
          and (
            p_full_rebuild
            or root.message_key=any(coalesce(p_start_keys,'{}'::text[]))
          )
        on conflict(message_key) do update set
          account_email=excluded.account_email,
          message_id=excluded.message_id,
          root_message_key=excluded.root_message_key,
          root_message_id=excluded.root_message_id,
          parent_message_key=null,
          lineage_depth=0;

        with recursive descendants as (
          select member.message_key,member.account_email,member.message_id,
            member.root_message_key,member.root_message_id,
            member.parent_message_key,member.lineage_depth,
            array[member.message_key]::text[] as visited
          from public.softora_mailbox_campaign_lineage_members as member
          where member.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
            and member.lineage_depth=0
          union all
          select child.message_key,child.account_email,
            public.softora_normalize_mailbox_message_id(child.message_id),
            descendants.root_message_key,descendants.root_message_id,
            descendants.message_key,descendants.lineage_depth+1,
            descendants.visited||child.message_key
          from descendants
          join public.softora_mailbox_message_lineage_edges as edge
            on edge.account_email=descendants.account_email
            and edge.parent_message_id=descendants.message_id
          join public.softora_mailbox_messages as child
            on child.message_key=edge.child_message_key
            and child.account_email=descendants.account_email
            and child.deleted_at is null
            and child.generation_superseded_at is null
          where not child.message_key=any(descendants.visited)
            and (
              p_full_rebuild
              or child.message_key=any(coalesce(p_start_keys,'{}'::text[]))
            )
            and not exists (
              select 1 from public.softora_mailbox_campaign_lineage_roots as child_root
              where child_root.message_key=child.message_key
            )
        ), resolved as (
          select distinct on (descendants.message_key)
            descendants.message_key,descendants.account_email,descendants.message_id,
            descendants.root_message_key,descendants.root_message_id,
            descendants.parent_message_key,descendants.lineage_depth
          from descendants
          where descendants.lineage_depth>0
          order by descendants.message_key,descendants.lineage_depth,
            descendants.root_message_key
        )
        insert into public.softora_mailbox_campaign_lineage_members(
          message_key,account_email,message_id,root_message_key,root_message_id,
          parent_message_key,lineage_depth
        )
        select resolved.message_key,resolved.account_email,resolved.message_id,
          resolved.root_message_key,resolved.root_message_id,
          resolved.parent_message_key,resolved.lineage_depth
        from resolved
        on conflict(message_key) do update set
          account_email=excluded.account_email,
          message_id=excluded.message_id,
          root_message_key=excluded.root_message_key,
          root_message_id=excluded.root_message_id,
          parent_message_key=excluded.parent_message_key,
          lineage_depth=excluded.lineage_depth;

        insert into public.softora_mailbox_campaign_lineage_discoveries(
          account_email,message_key,root_message_key,active,
          first_discovered_at,last_connected_at,last_disconnected_at
        )
        select member.account_email,member.message_key,member.root_message_key,true,
          pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp(),null
        from public.softora_mailbox_campaign_lineage_members as member
        where member.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and (
            p_full_rebuild
            or member.message_key=any(coalesce(p_start_keys,'{}'::text[]))
          )
        on conflict(account_email,message_key,root_message_key) do update set
          active=true,last_connected_at=excluded.last_connected_at,
          last_disconnected_at=null;
      end;
      $function$;

      create or replace function public.softora_refresh_mailbox_campaign_lineage_impacts(
        p_account_email text,
        p_message_key text,
        p_message_ids text[]
      )
      returns void
      language plpgsql
      volatile
      security invoker
      set search_path = ''
      as $function$
      declare
        v_keys text[];
        v_previous_roots jsonb;
      begin
        update public.softora_mailbox_lineage_test_metrics
        set call_count=call_count+1 where operation='impact';

        with recursive direct_keys as (
          select p_message_key as message_key
          union
          select message.message_key
          from public.softora_mailbox_messages as message
          where message.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
            and public.softora_normalize_mailbox_message_id(message.message_id)
              = any(coalesce(p_message_ids,'{}'::text[]))
          union
          select edge.child_message_key
          from public.softora_mailbox_message_lineage_edges as edge
          where edge.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
            and edge.parent_message_id=any(coalesce(p_message_ids,'{}'::text[]))
          union
          select root.message_key
          from public.softora_mailbox_campaign_lineage_roots as root
          where root.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
            and root.message_id=any(coalesce(p_message_ids,'{}'::text[]))
        ), impacted as (
          select direct.message_key from direct_keys as direct
          union
          select child.message_key
          from impacted
          join public.softora_mailbox_campaign_lineage_members as child
            on child.parent_message_key=impacted.message_key
        )
        select coalesce(pg_catalog.array_agg(distinct impacted.message_key),'{}'::text[])
        into v_keys from impacted;

        select coalesce(pg_catalog.jsonb_object_agg(
          member.message_key,member.root_message_key
        ),'{}'::jsonb) into v_previous_roots
        from public.softora_mailbox_campaign_lineage_members as member
        where member.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and member.message_key=any(v_keys);

        delete from public.softora_mailbox_campaign_lineage_members as member
        where member.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and member.message_key=any(v_keys);
        perform public.softora_rebuild_mailbox_campaign_lineage(
          p_account_email,v_keys,false,v_previous_roots
        );
        update public.softora_mailbox_campaign_lineage_discoveries as discovery
        set active=false,last_disconnected_at=pg_catalog.clock_timestamp()
        where discovery.account_email=pg_catalog.lower(pg_catalog.btrim(p_account_email))
          and discovery.message_key=any(v_keys)
          and discovery.active
          and not exists (
            select 1 from public.softora_mailbox_campaign_lineage_members as member
            where member.message_key=discovery.message_key
              and member.root_message_key=discovery.root_message_key
          );
      end;
      $function$;

      create or replace function public.softora_refresh_mailbox_message_lineage()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      declare
        v_message_key text := case when tg_op='DELETE' then old.message_key else new.message_key end;
        v_old_account text := case when tg_op='INSERT' then '' else
          pg_catalog.lower(pg_catalog.btrim(coalesce(old.account_email,''))) end;
        v_new_account text := case when tg_op='DELETE' then '' else
          pg_catalog.lower(pg_catalog.btrim(coalesce(new.account_email,''))) end;
        v_old_message_id text := case when tg_op='INSERT' then null else
          public.softora_normalize_mailbox_message_id(old.message_id) end;
        v_new_message_id text := case when tg_op='DELETE' then null else
          public.softora_normalize_mailbox_message_id(new.message_id) end;
        v_parent_message_id text;
      begin
        if tg_op <> 'INSERT' then
          delete from public.softora_mailbox_message_lineage_edges
          where child_message_key=old.message_key;
          delete from public.softora_mailbox_campaign_lineage_roots
          where message_key=old.message_key;
        end if;

        if tg_op <> 'DELETE'
          and new.deleted_at is null
          and new.generation_superseded_at is null
          and public.softora_is_campaign_mailbox_message(
            new.account_email,new.folder,new.payload
          ) then
          v_parent_message_id := public.softora_normalize_mailbox_message_id(
            new.in_reply_to
          );
          if v_parent_message_id is null then
            insert into public.softora_mailbox_campaign_lineage_roots(
              message_key,account_email,message_id
            ) values(new.message_key,v_new_account,v_new_message_id)
            on conflict(message_key) do update set
              account_email=excluded.account_email,message_id=excluded.message_id;
          else
            insert into public.softora_mailbox_message_lineage_edges(
              child_message_key,account_email,child_message_id,parent_message_id
            ) values(new.message_key,v_new_account,v_new_message_id,v_parent_message_id)
            on conflict(child_message_key,parent_message_id) do update set
              account_email=excluded.account_email,
              child_message_id=excluded.child_message_id;
          end if;
        end if;

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
        if tg_op='DELETE' then return old; end if;
        return new;
      end;
      $function$;
      create trigger softora_refresh_mailbox_message_lineage
      after insert or update or delete on public.softora_mailbox_messages
      for each row execute function public.softora_refresh_mailbox_message_lineage();
      create or replace function public.softora_preserve_mailbox_read_state()
      returns trigger language plpgsql security invoker set search_path=''
      as $function$
      begin
        if new.state_revision > old.state_revision then
          if new.unread then new.softora_read_at:=null;
          elsif new.softora_read_at is null then new.softora_read_at:=clock_timestamp(); end if;
        elsif old.softora_read_at is not null then
          new.softora_read_at:=old.softora_read_at; new.unread:=false;
        elsif new.softora_read_at is not null then new.unread:=false;
        end if;
        return new;
      end;
      $function$;
      create trigger softora_mailbox_messages_preserve_read_state
      before update on public.softora_mailbox_messages for each row
      execute function public.softora_preserve_mailbox_read_state();
      create or replace function public.softora_enforce_mailbox_message_identity_immutable()
      returns trigger language plpgsql security invoker set search_path=''
      as $function$ begin return new; end; $function$;
      create trigger softora_enforce_mailbox_message_identity_immutable
      before update on public.softora_mailbox_messages for each row
      execute function public.softora_enforce_mailbox_message_identity_immutable();
      create or replace function public.softora_coerce_mailbox_uid_generation()
      returns trigger language plpgsql security invoker set search_path=''
      as $function$ begin return new; end; $function$;
      create trigger softora_mailbox_messages_coerce_uid_generation
      before insert on public.softora_mailbox_messages for each row
      execute function public.softora_coerce_mailbox_uid_generation();

      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values
        ('serve@softora.nl|inbox','serve@softora.nl','inbox','ok',1,1,100),
        ('serve@softora.nl|allmail','serve@softora.nl','allmail','ok',6,2,900),
        ('martijn@softora.nl|inbox','martijn@softora.nl','inbox','ok',0,0,300),
        ('martijn@softora.nl|allmail','martijn@softora.nl','allmail','ok',4,1,910),
        ('servecreusen@softora.nl|inbox','servecreusen@softora.nl','inbox','ok',2,2,null);
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,
        subject,date,unread,starred,payload,uid_validity
      ) values
        ('serve@softora.nl|inbox|uv:100|1','serve@softora.nl','inbox',1,'seed:1',
          'seed-a@test',null,'A',now(),true,false,'{"source":"imap-sync"}',100),
        ('serve@softora.nl|allmail|uv:900|5','serve@softora.nl','allmail',5,
          'serve-allmail:personal','personal-only@test',null,'Personal',now(),true,
          false,'{"source":"imap-sync"}',900),
        ('serve@softora.nl|allmail|uv:900|6','serve@softora.nl','allmail',6,
          'serve-allmail:reply','serve-reply@test','seed-a@test','Serve reply',now(),
          false,true,'{"source":"imap-sync"}',900),
        ('martijn@softora.nl|inbox|uv:300|1','martijn@softora.nl','inbox',1,
          'martijn-anchor','martijn-anchor@test',null,'Martijn anchor',now(),false,
          false,'{"source":"imap-sync"}',300),
        ('martijn@softora.nl|allmail|uv:910|4','martijn@softora.nl','allmail',4,
          'martijn-allmail:reply','martijn-reply@test','martijn-anchor@test',
          'Martijn reply',now(),false,true,'{"source":"imap-sync"}',910),
        ('martijn@softora.nl|coldmail|11','martijn@softora.nl','coldmail',11,
          'martijn-binary-anchor:1','x=6b@test.nl',null,'Binary anchor 1',now(),
          false,false,'{"source":"imap-sync"}',null),
        ('martijn@softora.nl|coldmail|12','martijn@softora.nl','coldmail',12,
          'martijn-binary-anchor:2','x==v8@test.nl',null,'Binary anchor 2',now(),
          false,false,'{"source":"imap-sync"}',null),
        ('servecreusen@softora.nl|inbox|1','servecreusen@softora.nl','inbox',1,
          'legacy:1','legacy-visible@test',null,'Legacy visible',now(),false,true,
          '{"source":"imap-sync"}',null),
        ('servecreusen@softora.nl|inbox|2','servecreusen@softora.nl','inbox',2,
          'legacy:2','legacy-hidden@test',null,'Legacy hidden',now(),false,false,
          '{"source":"imap-sync"}',null);
      update public.softora_mailbox_messages
      set in_reply_to='martijn-parent@test',
          references_text='<martijn-chain-a@test>, <martijn-chain-b@test>'
      where provider_id='martijn-anchor';
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,
        references_text,subject,date,unread,starred,payload
      )
      select
        'anchor-perf:' || seed::text,
        'martijn@softora.nl',
        'coldmail',
        10000 + seed,
        'anchor-perf:' || seed::text,
        'anchor-perf-' || seed::text || '@test',
        'anchor-parent-' || seed::text || '@test',
        '<anchor-chain-' || seed::text || '@test>',
        'Anchor performance seed',
        now(),
        false,
        false,
        '{"source":"imap-sync"}'::jsonb
      from pg_catalog.generate_series(1, 900) as seed;
      update public.softora_mailbox_messages
      set softora_read_at=clock_timestamp(),reply_dismissed_at=clock_timestamp()
      where provider_id in ('legacy:1','serve-allmail:reply');
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp() where provider_id='legacy:2';
    `);
    // The lineage trigger was introduced after the original UID-generation
    // migration. Keep the local fixture in that historical order so the
    // earlier provenance backfills cannot create pre-migration lineage rows
    // whose two cascading keys would violate the immediate shape check.
    await client.query(`
      alter table public.softora_mailbox_messages
        disable trigger softora_refresh_mailbox_message_lineage
    `);
    await applyTrackedSql(client, sendProvenanceFoundation);
    await applyTrackedSql(client, providerOutcomeMigration);
    await client.query(`
      truncate table public.softora_mailbox_campaign_lineage_discoveries,
        public.softora_mailbox_campaign_lineage_members,
        public.softora_mailbox_message_lineage_edges,
        public.softora_mailbox_campaign_lineage_roots
    `);
    await applyTrackedSql(client, migration);
    await client.query(`
      alter table public.softora_mailbox_messages
        enable trigger softora_refresh_mailbox_message_lineage
    `);
    await client.query(`
      insert into public.softora_mailbox_campaign_lineage_roots(
        message_key,account_email,message_id
      )
      select message.message_key,message.account_email,
        public.softora_normalize_mailbox_message_id(message.message_id)
      from public.softora_mailbox_messages as message
      where public.softora_is_campaign_mailbox_message(
        message.account_email, message.folder, message.payload
      )
        and message.deleted_at is null
        and message.generation_superseded_at is null
        and public.softora_normalize_mailbox_message_id(message.message_id) is not null
        and public.softora_normalize_mailbox_message_id(message.in_reply_to) is null
      on conflict(message_key) do nothing;

      insert into public.softora_mailbox_message_lineage_edges(
        child_message_key,account_email,child_message_id,parent_message_id
      )
      select message.message_key,message.account_email,
        public.softora_normalize_mailbox_message_id(message.message_id),
        public.softora_normalize_mailbox_message_id(message.in_reply_to)
      from public.softora_mailbox_messages as message
      where public.softora_is_campaign_mailbox_message(
        message.account_email, message.folder, message.payload
      )
        and message.deleted_at is null
        and message.generation_superseded_at is null
        and public.softora_normalize_mailbox_message_id(message.in_reply_to) is not null
      on conflict(child_message_key,parent_message_id) do nothing;

      select public.softora_rebuild_mailbox_campaign_lineage(
        account.account_email,'{}'::text[],true,'{}'::jsonb
      )
      from (
        select distinct message.account_email
        from public.softora_mailbox_messages as message
        where public.softora_is_campaign_mailbox_message(
          message.account_email,message.folder,message.payload
        )
      ) as account
    `);
    await applyTrackedSql(client, sendProvenanceVisibilityFenceMigration);
    await applyTrackedSql(client, perKeyRepairMigration);
    await applyTrackedSql(client, targetOrderRepairMigration);
    await applyTrackedSql(client, anchorOptimizationMigration);
    await client.query(
      "select pg_catalog.set_config('softora.mailbox_uid_generation_v2_transition','1',false)"
    );
    await client.query(`
      with selected_targets as (
        select public.softora_normalize_mailbox_message_id(message.message_id)
          as reference_id
        from public.softora_mailbox_messages as message
        where message.account_email='martijn@softora.nl'
          and message.folder='coldmail'
          and message.provider_id like 'anchor-perf:%'
        order by message.uid
        limit 370
      ), target_set as (
        select pg_catalog.jsonb_agg(
          selected.reference_id
          order by pg_catalog.convert_to(selected.reference_id, 'UTF8')
        ) as selection_targets
        from selected_targets as selected
      )
      insert into public.softora_mailbox_uid_generations(
        generation_id,sync_key,account_email,folder,uid_validity,
        selection_policy,selection_targets,selection_targets_digest,
        selection_uid_manifest,status,scan_upper_uid,scanned_through_uid,
        scan_complete,updated_at
      )
      select $1::uuid,'martijn@softora.nl|allmail','martijn@softora.nl',
        'allmail',910,'targeted-sparse-v2',target_set.selection_targets,
        pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
          target_set.selection_targets::text, 'UTF8'
        ), 'sha256'), 'hex'),null,'staging',43869,0,false,
        pg_catalog.clock_timestamp()
      from target_set;
    `, [martijnCompatibilityGeneration]);
    await client.query(`
      update public.softora_mailbox_sync_state
      set pending_uid_generation_id=$1::uuid,updated_at=pg_catalog.clock_timestamp()
      where sync_key='martijn@softora.nl|allmail'
    `, [martijnCompatibilityGeneration]);
    await applyTrackedSql(client, targetManifestCheckpointMigration);
    await applyTrackedSql(client, finalActivationLineageMigration);
    await applyTrackedSql(client, strongIdentityMutationMigration);
    await client.query(`
      update public.softora_mailbox_lineage_test_metrics set call_count=0
    `);
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
  });

  test('legacy NULL-generation activeert atomair met rollback, replay en volledige lineage', async () => {
    const client = await connect();
    const accountEmail = 'legacy-activation@softora.nl';
    const syncKey = `${accountEmail}|inbox`;
    const legacyRootKey = `${syncKey}|1`;
    const legacyChildKey = `${syncKey}|2`;
    const staleGenerationId = '5eeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const staleMessageKey = `${syncKey}|gen:${staleGenerationId}|3`;
    const rows = lineageSnapshotRows(accountEmail, 'legacy-activation-new', 2);
    rows[0].message_id = 'legacy-activation-root@test.softora.nl';
    rows[1].message_id = 'legacy-activation-child@test.softora.nl';
    rows[1].in_reply_to = rows[0].message_id;
    let rejectionInstalled = false;
    await client.query('begin');
    try {
      // Seed messages before their sync-state exists: this is the exact legacy
      // NULL-generation shape that a final staged activation must retire.
      await client.query(`
        insert into public.softora_mailbox_messages(
          message_key,account_email,folder,uid,provider_id,message_id,in_reply_to,
          recipients_text,subject,date,payload,uid_validity
        ) values
          ($1,$3,'inbox',1,'legacy-activation:1',$4,null,$3,'Legacy root',
            clock_timestamp(),'{}'::jsonb,null),
          ($2,$3,'inbox',2,'legacy-activation:2',$5,$4,$3,'Legacy child',
            clock_timestamp(),'{}'::jsonb,null)
      `, [
        legacyRootKey, legacyChildKey, accountEmail,
        'legacy-activation-root@test.softora.nl',
        'legacy-activation-child@test.softora.nl',
      ]);
      await client.query(`
        insert into public.softora_mailbox_sync_state(
          sync_key,account_email,folder,status,last_uid,message_count,uid_validity
        ) values($1,$2,'inbox','idle',2,2,null)
      `, [syncKey, accountEmail]);
      await client.query(`
        insert into public.softora_mailbox_uid_generations(
          generation_id,sync_key,account_email,folder,uid_validity,
          selection_policy,status,scan_upper_uid,scanned_through_uid,
          scan_complete,snapshot_message_count,activated_at,superseded_at
        ) values(
          $1::uuid,$2,$3,'inbox',699,'staged-rebuild-v2','superseded',
          3,3,true,1,clock_timestamp()-interval '2 minutes',
          clock_timestamp()-interval '1 minute'
        )
      `, [staleGenerationId, syncKey, accountEmail]);
      await client.query(`
        alter table public.softora_mailbox_messages
          disable trigger softora_mailbox_messages_coerce_uid_generation
      `);
      await client.query(`
        insert into public.softora_mailbox_messages(
          message_key,account_email,folder,uid,uid_validity,uid_generation_id,
          provider_id,message_id,recipients_text,subject,date,payload
        ) values(
          $2,$3,'inbox',3,699,$1::uuid,'legacy-activation:stale',
          'legacy-activation-stale@test.softora.nl',$3,'Stale generation',
          clock_timestamp(),'{}'::jsonb
        )
      `, [staleGenerationId, staleMessageKey, accountEmail]);
      await client.query(`
        alter table public.softora_mailbox_messages
          enable trigger softora_mailbox_messages_coerce_uid_generation
      `);
      assert.deepEqual((await client.query(`
        select message_key,root_message_key,lineage_depth
        from public.softora_mailbox_campaign_lineage_members
        where account_email=$1 order by lineage_depth,message_key
      `, [accountEmail])).rows, [
        { message_key: legacyRootKey, root_message_key: legacyRootKey, lineage_depth: 0 },
        { message_key: staleMessageKey, root_message_key: staleMessageKey, lineage_depth: 0 },
        { message_key: legacyChildKey, root_message_key: legacyRootKey, lineage_depth: 1 },
      ]);

      const token = 'legacy-activation-token';
      await lease(client, syncKey, token);
      const prepared = await prepare(client, syncKey, token, 701, 3);
      assert.equal(prepared.mode, 'rebuild');
      assert.equal(prepared.active_generation_id, null);
      const args = {
        syncKey, token, commitId: 'legacy-null-final-activation',
        generationId: prepared.target_generation_id, uidValidity: 701, rows,
        fromUid: 1, throughUid: 2, complete: true, messageCount: 2, lastUid: 2,
      };

      await client.query(`
        create or replace function public.test_reject_final_lineage_activation()
        returns trigger language plpgsql set search_path=''
        as $function$
        begin
          if old.active_uid_generation_id is distinct from new.active_uid_generation_id then
            raise exception using errcode='55000',message='TEST_FINAL_ACTIVATION_ROLLBACK';
          end if;
          return new;
        end;
        $function$;
        create trigger test_reject_final_lineage_activation
        before update of active_uid_generation_id on public.softora_mailbox_sync_state
        for each row execute function public.test_reject_final_lineage_activation();
      `);
      rejectionInstalled = true;
      await resetLineageMetrics(client);
      await rejectsInSavepoint(
        client,
        () => commit(client, args),
        /TEST_FINAL_ACTIVATION_ROLLBACK/
      );
      assert.deepEqual(await lineageMetrics(client), { impact: 0, rebuild: 0 });
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_messages
        where account_email=$1 and generation_superseded_at is null
          and uid_generation_id is null
      `, [accountEmail])).rows[0].count, 2);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_members
        where message_key=any($1::text[])
      `, [[legacyRootKey, legacyChildKey, staleMessageKey]])).rows[0].count, 3);

      await client.query(`
        drop trigger test_reject_final_lineage_activation
          on public.softora_mailbox_sync_state;
        drop function public.test_reject_final_lineage_activation();
      `);
      rejectionInstalled = false;
      await resetLineageMetrics(client);
      const activated = await commit(client, args);
      assert.equal(activated.activated, true);
      assert.deepEqual(await lineageMetrics(client), { impact: 1, rebuild: 2 });
      assert.equal((await client.query(`
        select pg_catalog.current_setting(
          'softora.mailbox_lineage_batch_activation_v2',true
        ) as batch_scope
      `)).rows[0].batch_scope, '');

      const newRootKey = `${syncKey}|gen:${prepared.target_generation_id}|1`;
      const newChildKey = `${syncKey}|gen:${prepared.target_generation_id}|2`;
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_roots
        where message_key=any($1::text[])
      `, [[legacyRootKey, legacyChildKey, staleMessageKey]])).rows[0].count, 0);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_message_lineage_edges
        where child_message_key=any($1::text[])
      `, [[legacyRootKey, legacyChildKey, staleMessageKey]])).rows[0].count, 0);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_members
        where message_key=any($1::text[])
      `, [[legacyRootKey, legacyChildKey, staleMessageKey]])).rows[0].count, 0);
      assert.deepEqual((await client.query(`
        select generation_superseded_at is not null as superseded,
          deleted_at is not null as deleted
        from public.softora_mailbox_messages where message_key=$1
      `, [staleMessageKey])).rows[0], { superseded: true, deleted: true });
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_discoveries
        where message_key=$1 and active
      `, [staleMessageKey])).rows[0].count, 0);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_discoveries as discovery
        where discovery.message_key=any($1::text[])
          and discovery.active
          and not exists (
            select 1
            from public.softora_mailbox_campaign_lineage_members as member
            where member.message_key=discovery.message_key
              and member.root_message_key=discovery.root_message_key
          )
      `, [[legacyRootKey, legacyChildKey, staleMessageKey]])).rows[0].count, 0);
      assert.deepEqual((await client.query(`
        select message_key,root_message_key,parent_message_key,lineage_depth
        from public.softora_mailbox_campaign_lineage_members
        where account_email=$1 order by lineage_depth,message_key
      `, [accountEmail])).rows, [
        {
          message_key: newRootKey,
          root_message_key: newRootKey,
          parent_message_key: null,
          lineage_depth: 0,
        },
        {
          message_key: newChildKey,
          root_message_key: newRootKey,
          parent_message_key: newRootKey,
          lineage_depth: 1,
        },
      ]);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_campaign_lineage_discoveries
        where account_email=$1 and active
      `, [accountEmail])).rows[0].count, 2);

      const replayed = await commit(client, args);
      assert.equal(replayed.replayed, true);
      assert.deepEqual(await lineageMetrics(client), { impact: 1, rebuild: 2 });

      await lease(client, syncKey, 'legacy-steady-token');
      const steady = await prepare(client, syncKey, 'legacy-steady-token', 701, 3);
      assert.equal(steady.mode, 'steady');
      await resetLineageMetrics(client);
      const steadyResult = await commit(client, {
        syncKey, token: 'legacy-steady-token', commitId: 'legacy-steady-row-impact',
        generationId: steady.target_generation_id, uidValidity: 701,
        rows: [{ ...rows[1], starred: true }],
        fromUid: 3, throughUid: 2, complete: true, messageCount: 2, lastUid: 2,
      });
      assert.equal(steadyResult.activated, false);
      assert.ok((await lineageMetrics(client)).impact >= 1);

      await resetLineageMetrics(client);
      await client.query(`
        update public.softora_mailbox_messages
        set subject='Direct lineage row-impact'
        where message_key=$1
      `, [newChildKey]);
      assert.ok((await lineageMetrics(client)).impact >= 1);
    } finally {
      if (rejectionInstalled) {
        await client.query(`
          drop trigger if exists test_reject_final_lineage_activation
            on public.softora_mailbox_sync_state;
          drop function if exists public.test_reject_final_lineage_activation();
        `).catch(() => null);
      }
      await client.query('rollback');
    }
  });

  test('verkeerde en DELETE batchscope falen dicht zonder lineage- of berichtdrift', async () => {
    const client = await connect();
    await client.query('begin');
    try {
      const messageSnapshot = async (messageKey) => (await client.query(`
        select message_key,account_email,folder,uid_generation_id,
          generation_superseded_at,subject
        from public.softora_mailbox_messages
        where message_key=$1
      `, [messageKey])).rows[0];
      const lineageSnapshot = async (accountEmail) => ({
        roots: (await client.query(`
          select message_key,account_email,message_id,created_at
          from public.softora_mailbox_campaign_lineage_roots
          where account_email=$1 order by message_key
        `, [accountEmail])).rows,
        edges: (await client.query(`
          select child_message_key,account_email,child_message_id,parent_message_id,
            created_at
          from public.softora_mailbox_message_lineage_edges
          where account_email=$1 order by child_message_key,parent_message_id
        `, [accountEmail])).rows,
        members: (await client.query(`
          select message_key,account_email,message_id,root_message_key,
            root_message_id,parent_message_key,lineage_depth,created_at
          from public.softora_mailbox_campaign_lineage_members
          where account_email=$1 order by message_key
        `, [accountEmail])).rows,
        discoveries: (await client.query(`
          select account_email,message_key,root_message_key,active,
            first_discovered_at,last_connected_at,last_disconnected_at
          from public.softora_mailbox_campaign_lineage_discoveries
          where account_email=$1 order by message_key,root_message_key
        `, [accountEmail])).rows,
      });
      const state = (await client.query(`
        select sync_key,account_email,folder,active_uid_generation_id
        from public.softora_mailbox_sync_state
        where sync_key='serve@softora.nl|inbox'
      `)).rows[0];
      const message = (await client.query(`
        select message_key,subject
        from public.softora_mailbox_messages
        where account_email=$1 and folder=$2
          and generation_superseded_at is null
        order by uid limit 1
      `, [state.account_email, state.folder])).rows[0];
      const messageBefore = await messageSnapshot(message.message_key);
      const artifactsBefore = await lineageSnapshot(state.account_email);
      await client.query(`
        select pg_catalog.set_config('softora.mailbox_sync_per_key_v2','1',true),
          pg_catalog.set_config('softora.mailbox_uid_generation_v2_transition','1',true),
          pg_catalog.set_config(
            'softora.mailbox_lineage_batch_activation_v2',$1,true
          )
      `, [JSON.stringify({
        syncKey: 'martijn@softora.nl|inbox',
        accountEmail: 'martijn@softora.nl',
        folder: 'inbox',
        oldGenerationId: null,
        newGenerationId: state.active_uid_generation_id,
      })]);
      await rejectsInSavepoint(
        client,
        () => client.query(`
          update public.softora_mailbox_messages set subject='scope must reject'
          where message_key=$1
        `, [message.message_key]),
        /MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH/
      );
      assert.deepEqual(await messageSnapshot(message.message_key), messageBefore);
      assert.deepEqual(await lineageSnapshot(state.account_email), artifactsBefore);

      await client.query(`
        select pg_catalog.set_config(
          'softora.mailbox_lineage_batch_activation_v2',$1,true
        )
      `, [JSON.stringify({
        syncKey: state.sync_key,
        accountEmail: state.account_email,
        folder: state.folder,
        oldGenerationId: state.active_uid_generation_id,
        newGenerationId: '99999999-9999-4999-8999-999999999999',
      })]);
      await rejectsInSavepoint(
        client,
        () => client.query(`
          update public.softora_mailbox_messages
          set subject='wrong generation must reject'
          where message_key=$1
        `, [message.message_key]),
        /MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH/
      );
      assert.deepEqual(await messageSnapshot(message.message_key), messageBefore);
      assert.deepEqual(await lineageSnapshot(state.account_email), artifactsBefore);

      const nullGenerationState = (await client.query(`
        select sync_key,account_email,folder
        from public.softora_mailbox_sync_state
        where sync_key='servecreusen@softora.nl|inbox'
      `)).rows[0];
      const nullGenerationMessage = (await client.query(`
        select message_key
        from public.softora_mailbox_messages
        where account_email=$1 and folder=$2
          and uid_generation_id is null
          and generation_superseded_at is null
          and deleted_at is null
        order by uid limit 1
      `, [
        nullGenerationState.account_email,
        nullGenerationState.folder,
      ])).rows[0];
      assert.ok(nullGenerationMessage, 'NULL-generation testbericht ontbreekt');
      const nullMessageBefore = await messageSnapshot(nullGenerationMessage.message_key);
      const nullArtifactsBefore = await lineageSnapshot(
        nullGenerationState.account_email
      );
      await client.query(`
        select pg_catalog.set_config(
          'softora.mailbox_lineage_batch_activation_v2',$1,true
        )
      `, [JSON.stringify({
        syncKey: nullGenerationState.sync_key,
        accountEmail: nullGenerationState.account_email,
        folder: nullGenerationState.folder,
        oldGenerationId: null,
        newGenerationId: state.active_uid_generation_id,
      })]);
      await rejectsInSavepoint(
        client,
        () => client.query(`
          update public.softora_mailbox_messages
          set subject='NULL generation must reject'
          where message_key=$1
        `, [nullGenerationMessage.message_key]),
        /MAILBOX_LINEAGE_ACTIVATION_ROW_SCOPE_MISMATCH/
      );
      assert.deepEqual(
        await messageSnapshot(nullGenerationMessage.message_key),
        nullMessageBefore
      );
      assert.deepEqual(
        await lineageSnapshot(nullGenerationState.account_email),
        nullArtifactsBefore
      );

      await client.query(`
        select pg_catalog.set_config(
          'softora.mailbox_lineage_batch_activation_v2',$1,true
        )
      `, [JSON.stringify({
        syncKey: state.sync_key,
        accountEmail: state.account_email,
        folder: state.folder,
        oldGenerationId: state.active_uid_generation_id,
        newGenerationId: state.active_uid_generation_id,
      })]);
      await rejectsInSavepoint(
        client,
        () => client.query(`
          delete from public.softora_mailbox_messages where message_key=$1
        `, [message.message_key]),
        /MAILBOX_LINEAGE_ACTIVATION_ROW_OPERATION_INVALID/
      );
      assert.deepEqual(await messageSnapshot(message.message_key), messageBefore);
      assert.deepEqual(await lineageSnapshot(state.account_email), artifactsBefore);
    } finally {
      await client.query('rollback');
    }
  });

  for (const messageCount of [300, 750]) {
    test(`${messageCount}-rij finale lineage-activatie blijft binnen 8s en retireert schoon`, async () => {
      const client = await connect();
      const accountEmail = `lineage-scale-${messageCount}@softora.nl`;
      const syncKey = `${accountEmail}|inbox`;
      const firstRows = lineageSnapshotRows(accountEmail, `scale-${messageCount}-old`, messageCount);
      const nextRows = lineageSnapshotRows(accountEmail, `scale-${messageCount}-new`, messageCount);
      await client.query('begin');
      try {
        await client.query(`
          insert into public.softora_mailbox_sync_state(
            sync_key,account_email,folder,status,last_uid,message_count,uid_validity
          ) values($1,$2,'inbox','idle',0,0,null)
        `, [syncKey, accountEmail]);
        const first = await activateSnapshot(client, {
          syncKey,
          token: `scale-${messageCount}-first-token`,
          commitId: `scale-${messageCount}-first-commit`,
          uidValidity: 800 + messageCount,
          rows: firstRows,
        });
        const oldGenerationId = first.prepared.target_generation_id;
        await lease(client, syncKey, `scale-${messageCount}-final-token`);
        const prepared = await prepare(
          client, syncKey, `scale-${messageCount}-final-token`,
          801 + messageCount, messageCount + 1
        );
        assert.equal(prepared.mode, 'rebuild');
        await resetLineageMetrics(client);
        await client.query("set local statement_timeout='8s'");
        const startedAt = Date.now();
        const activated = await commit(client, {
          syncKey,
          token: `scale-${messageCount}-final-token`,
          commitId: `scale-${messageCount}-final-commit`,
          generationId: prepared.target_generation_id,
          uidValidity: 801 + messageCount,
          rows: nextRows,
          fromUid: 1,
          throughUid: messageCount,
          complete: true,
          messageCount,
          lastUid: messageCount,
        });
        const elapsedMs = Date.now() - startedAt;
        assert.equal(activated.activated, true);
        assert.ok(elapsedMs < 8_000, `${messageCount} rijen duurden ${elapsedMs} ms`);
        assert.deepEqual(await lineageMetrics(client), { impact: 0, rebuild: 1 });
        assert.deepEqual((await client.query(`
          select
            (select count(*)::integer
              from public.softora_mailbox_campaign_lineage_roots
              where account_email=$1) as roots,
            (select count(*)::integer
              from public.softora_mailbox_message_lineage_edges
              where account_email=$1) as edges,
            (select count(*)::integer
              from public.softora_mailbox_campaign_lineage_members
              where account_email=$1) as members,
            (select count(*)::integer
              from public.softora_mailbox_campaign_lineage_discoveries
              where account_email=$1 and active) as active_discoveries
        `, [accountEmail])).rows[0], {
          roots: 1,
          edges: messageCount - 1,
          members: messageCount,
          active_discoveries: messageCount,
        });
        assert.equal((await client.query(`
          select count(*)::integer as count
          from public.softora_mailbox_messages as message
          where message.uid_generation_id=$1::uuid
            and message.generation_superseded_at is not null
            and not message.deleted_at is null
        `, [oldGenerationId])).rows[0].count, messageCount);
        assert.equal((await client.query(`
          select count(*)::integer as count
          from public.softora_mailbox_messages as message
          where message.uid_generation_id=$1::uuid
            and (
              exists(select 1 from public.softora_mailbox_campaign_lineage_roots as root
                where root.message_key=message.message_key)
              or exists(select 1 from public.softora_mailbox_message_lineage_edges as edge
                where edge.child_message_key=message.message_key)
              or exists(select 1 from public.softora_mailbox_campaign_lineage_members as member
                where member.message_key=message.message_key)
            )
        `, [oldGenerationId])).rows[0].count, 0);
      } finally {
        await client.query("set local statement_timeout='10s'").catch(() => null);
        await client.query('rollback');
      }
    });
  }

  test('checkpointmigratie hervat Martijns bestaande lege 370-target pending generatie exact', async () => {
    const client = await connect();
    const before = (await client.query(`
      select generation.generation_id,generation.status,generation.uid_validity,
        generation.scan_upper_uid,generation.scanned_through_uid,
        generation.selection_manifest_scanned_through_uid,
        generation.selection_manifest_partial_uids,
        generation.selection_uid_manifest,
        pg_catalog.jsonb_array_length(generation.selection_targets)::integer
          as target_count,
        state.pending_uid_generation_id
      from public.softora_mailbox_uid_generations as generation
      join public.softora_mailbox_sync_state as state using(sync_key)
      where generation.generation_id=$1::uuid
    `, [martijnCompatibilityGeneration])).rows[0];
    assert.deepEqual(before, {
      generation_id: martijnCompatibilityGeneration,
      status: 'staging',
      uid_validity: '910',
      scan_upper_uid: '43869',
      scanned_through_uid: '0',
      selection_manifest_scanned_through_uid: '0',
      selection_manifest_partial_uids: [],
      selection_uid_manifest: null,
      target_count: 370,
      pending_uid_generation_id: martijnCompatibilityGeneration,
    });

    await client.query('begin');
    try {
      const targets = (await client.query(`
        select selection_targets
        from public.softora_mailbox_uid_generations
        where generation_id=$1::uuid
      `, [martijnCompatibilityGeneration])).rows[0].selection_targets;
      await lease(client, 'martijn@softora.nl|allmail', 'compatibility-resume-lease');
      const resumed = await prepare(
        client, 'martijn@softora.nl|allmail', 'compatibility-resume-lease',
        910, 43870, 'targeted-sparse-v2', targets
      );
      assert.equal(resumed.prepared, true);
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.mode, 'rebuild');
      assert.equal(resumed.target_generation_id, martijnCompatibilityGeneration);
      assert.equal(resumed.scan_upper_uid, '43869');
      assert.equal(resumed.selection_manifest_scanned_through_uid, '0');
      assert.deepEqual(resumed.target_uid_manifest, []);
      assert.equal(resumed.target_manifest_complete, false);

      const resumedFromEmptyCurrentTargets = await prepare(
        client, 'martijn@softora.nl|allmail', 'compatibility-resume-lease',
        910, 43870, 'targeted-sparse-v2', []
      );
      assert.equal(resumedFromEmptyCurrentTargets.resumed, true);
      assert.equal(
        resumedFromEmptyCurrentTargets.target_generation_id,
        martijnCompatibilityGeneration
      );
      assert.deepEqual(
        resumedFromEmptyCurrentTargets.selection_targets,
        targets
      );
    } finally {
      await client.query('rollback');
    }
  });

  test('v2 prepare-wrapper blijft exact de oude 13-koloms returnshape houden', async () => {
    const client = await connect();
    await client.query('begin');
    try {
      await lease(
        client,
        'martijn@softora.nl|allmail',
        'compatibility-v2-wrapper-lease'
      );
      const row = (await client.query(`
        select * from public.softora_prepare_mailbox_uid_generation_v2(
          'martijn@softora.nl|allmail',
          'compatibility-v2-wrapper-lease',910,43870,
          'targeted-sparse-v2','[]'::jsonb
        )
      `)).rows[0];
      assert.deepEqual(Object.keys(row), [
        'prepared', 'lock_lost', 'mode', 'reset_detected', 'resumed',
        'active_generation_id', 'target_generation_id',
        'current_uid_validity', 'observed_uid_validity', 'scan_upper_uid',
        'scanned_through_uid', 'lease_expires_at', 'selection_targets',
      ]);
      assert.equal(row.prepared, true);
      assert.equal(row.target_generation_id, martijnCompatibilityGeneration);
      assert.equal(row.selection_targets.length, 370);
    } finally {
      await client.query('rollback');
    }
  });

  test('oude v2-runtime kan een seeded steady-delta volledig SEARCHen en committen', async () => {
    const client = await connect();
    const syncKey = 'servecreusen@softora.nl|allmail';
    const accountEmail = 'servecreusen@softora.nl';
    const targetReference = 'legacy-visible@test';
    const token = 'compatibility-v2-seeded-delta-lease';
    await client.query('begin');
    try {
      await client.query(`
        insert into public.softora_mailbox_sync_state(
          sync_key,account_email,folder,status,last_uid,message_count,uid_validity
        ) values($1,$2,'allmail','idle',0,0,null)
      `, [syncKey, accountEmail]);
      await lease(client, syncKey, 'compatibility-v3-active-seed-lease');
      const initialPrepared = await prepare(
        client,
        syncKey,
        'compatibility-v3-active-seed-lease',
        700,
        5,
        'targeted-sparse-v2',
        [targetReference]
      );
      const initialCheckpoint = await checkpointTargetManifest(client, {
        syncKey,
        token: 'compatibility-v3-active-seed-lease',
        checkpointId: 'compatibility-v3-active-seed-checkpoint',
        generationId: initialPrepared.target_generation_id,
        uidValidity: 700,
        expectedScannedThroughUid: 0,
        scannedThroughUid: 4,
        foundUids: [4],
        scanComplete: true,
      });
      assert.equal(initialCheckpoint.checkpointed, true);
      const initialCommit = await commit(client, {
        syncKey,
        token: 'compatibility-v3-active-seed-lease',
        commitId: 'compatibility-v3-active-seed-commit',
        generationId: initialPrepared.target_generation_id,
        uidValidity: 700,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: [targetReference],
        targetUidManifest: [4],
        rows: [messageRow(4, 'compatibility-v3-active-seed', {
          account_email: accountEmail,
          folder: 'allmail',
          in_reply_to: targetReference,
        })],
        fromUid: 1,
        throughUid: 1,
        complete: true,
        messageCount: 1,
        lastUid: 0,
      });
      assert.equal(initialCommit.activated, true);

      const active = (await client.query(`
        select state.uid_validity,generation.scan_upper_uid,
          generation.selection_targets,generation.selection_uid_manifest
        from public.softora_mailbox_sync_state as state
        join public.softora_mailbox_uid_generations as generation
          on generation.generation_id=state.active_uid_generation_id
        where state.sync_key=$1 and generation.status='active'
          and generation.selection_policy='targeted-sparse-v2'
      `, [syncKey])).rows[0];
      assert.ok(active);
      assert.ok(active.selection_targets.length > 0);
      assert.ok(active.selection_uid_manifest.length > 0);
      const uidValidity = Number(active.uid_validity);
      const newScanUpperUid = Number(active.scan_upper_uid) + 2;
      const targetUidManifest = [
        ...active.selection_uid_manifest.map(Number),
        newScanUpperUid,
      ];

      await lease(client, syncKey, token);
      const prepared = (await client.query(`
        select * from public.softora_prepare_mailbox_uid_generation_v2(
          $1,$2,$3::bigint,$4::bigint,'targeted-sparse-v2',$5::jsonb
        )
      `, [
        syncKey, token, uidValidity, newScanUpperUid + 1,
        JSON.stringify(active.selection_targets),
      ])).rows[0];
      assert.equal(prepared.prepared, true);
      assert.equal(prepared.mode, 'rebuild');
      assert.deepEqual(prepared.selection_targets, active.selection_targets);

      const pending = (await client.query(`
        select selection_manifest_scanned_through_uid,
          selection_manifest_partial_uids,selection_uid_manifest,
          scanned_through_uid,scan_upper_uid
        from public.softora_mailbox_uid_generations
        where generation_id=$1::uuid
      `, [prepared.target_generation_id])).rows[0];
      assert.deepEqual(pending, {
        selection_manifest_scanned_through_uid: '0',
        selection_manifest_partial_uids: [],
        selection_uid_manifest: null,
        scanned_through_uid: '0',
        scan_upper_uid: String(newScanUpperUid),
      });

      const committed = await commit(client, {
        syncKey,
        token,
        commitId: 'compatibility-v2-seeded-delta-commit',
        generationId: prepared.target_generation_id,
        uidValidity,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: active.selection_targets,
        targetUidManifest,
        rows: targetUidManifest.map((uid) => messageRow(
          uid,
          `compatibility-v2-seeded-delta-${uid}`,
          {
            account_email: accountEmail,
            folder: 'allmail',
            in_reply_to: targetReference,
          }
        )),
        fromUid: 1,
        throughUid: targetUidManifest.length,
        complete: true,
        messageCount: targetUidManifest.length,
        lastUid: 0,
      });
      assert.equal(committed.committed, true);
      assert.equal(committed.activated, true);
      assert.deepEqual((await client.query(`
        select selection_manifest_scanned_through_uid,
          selection_manifest_partial_uids,selection_uid_manifest,scan_complete
        from public.softora_mailbox_uid_generations
        where generation_id=$1::uuid
      `, [prepared.target_generation_id])).rows[0], {
        selection_manifest_scanned_through_uid: String(newScanUpperUid),
        selection_manifest_partial_uids: targetUidManifest,
        selection_uid_manifest: targetUidManifest,
        scan_complete: true,
      });
    } finally {
      await client.query('rollback');
    }
  });

  test('pending expunge na partial staging is fenced, idempotent en bewaart active zichtbaarheid', async () => {
    const client = await connect();
    await client.query('begin');
    try {
      const fixture = await createTargetedAllMailActiveFixture(client, {
        mutationPrefix: 'pending-expunge-active',
      });
      const token = 'pending-expunge-rebuild-lease';
      await lease(client, fixture.syncKey, token);
      const prepared = await prepare(
        client,
        fixture.syncKey,
        token,
        fixture.uidValidity,
        9,
        'targeted-sparse-v2',
        [fixture.targetReference]
      );
      assert.equal(prepared.mode, 'rebuild');
      assert.equal(prepared.selection_manifest_scanned_through_uid, '4');
      assert.deepEqual(prepared.target_uid_manifest, [4]);
      const checkpoint = await checkpointTargetManifest(client, {
        syncKey: fixture.syncKey,
        token,
        checkpointId: 'pending-expunge-final-checkpoint',
        generationId: prepared.target_generation_id,
        uidValidity: fixture.uidValidity,
        expectedScannedThroughUid: 4,
        scannedThroughUid: 8,
        foundUids: [7],
        scanComplete: true,
      });
      assert.deepEqual(checkpoint.target_uid_manifest, [4, 7]);
      const staged = await commit(client, {
        syncKey: fixture.syncKey,
        token,
        commitId: 'pending-expunge-partial-commit',
        generationId: prepared.target_generation_id,
        uidValidity: fixture.uidValidity,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: [fixture.targetReference],
        targetUidManifest: [4, 7],
        rows: [messageRow(4, 'pending-expunge-partial', {
          account_email: fixture.accountEmail,
          folder: 'allmail',
          in_reply_to: fixture.targetReference,
        })],
        fromUid: 1,
        throughUid: 1,
        complete: false,
        messageCount: 1,
        lastUid: 0,
      });
      assert.equal(staged.rebuild_pending, true);

      await lease(client, fixture.syncKey, 'pending-expunge-invalidation-lease');
      const invalidationInput = {
        syncKey: fixture.syncKey,
        token: 'pending-expunge-invalidation-lease',
        invalidationId: 'pending-expunge-invalidation',
        generationId: prepared.target_generation_id,
        uidValidity: fixture.uidValidity,
        expectedStagedCount: 1,
        missingUids: [7],
      };
      const invalidated = await invalidateTargetManifest(client, invalidationInput);
      assert.deepEqual(invalidated, {
        invalidated: true,
        lock_lost: false,
        replayed: false,
        generation_role: 'pending',
        pending_abandoned: true,
        active_manifest_invalidated: true,
        lock_released: true,
      });
      assert.deepEqual((await client.query(`
        select state.status,state.active_uid_generation_id,
          state.pending_uid_generation_id,generation.status as pending_status,
          (select count(*)::integer
           from public.softora_mailbox_uid_generation_staging as staged
           where staged.generation_id=$2::uuid) as staged_count,
          (select count(*)::integer
           from public.softora_mailbox_messages as message
           where message.uid_generation_id=$3::uuid
             and message.generation_superseded_at is null
             and message.deleted_at is null) as active_visible
        from public.softora_mailbox_sync_state as state
        join public.softora_mailbox_uid_generations as generation
          on generation.generation_id=$2::uuid
        where state.sync_key=$1
      `, [
        fixture.syncKey,
        prepared.target_generation_id,
        fixture.generationId,
      ])).rows[0], {
        status: 'idle',
        active_uid_generation_id: fixture.generationId,
        pending_uid_generation_id: null,
        pending_status: 'abandoned',
        staged_count: 0,
        active_visible: 1,
      });

      const replayed = await invalidateTargetManifest(client, invalidationInput);
      assert.equal(replayed.invalidated, true);
      assert.equal(replayed.replayed, true);
      await rejectsInSavepoint(
        client,
        () => invalidateTargetManifest(client, {
          ...invalidationInput,
          missingUids: [4],
        }),
        /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/
      );
      const wrongLease = await invalidateTargetManifest(client, {
        ...invalidationInput,
        token: 'wrong-pending-expunge-lease',
        invalidationId: 'pending-expunge-wrong-lease',
      });
      assert.equal(wrongLease.invalidated, false);
      assert.equal(wrongLease.lock_lost, true);

      await lease(client, fixture.syncKey, 'pending-expunge-conflict-lease');
      await rejectsInSavepoint(
        client,
        () => invalidateTargetManifest(client, {
          ...invalidationInput,
          token: 'pending-expunge-conflict-lease',
          invalidationId: 'pending-expunge-wrong-generation',
          generationId: '99999999-9999-4999-8999-999999999999',
        }),
        /MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT/
      );
      await rejectsInSavepoint(
        client,
        () => invalidateTargetManifest(client, {
          ...invalidationInput,
          token: 'pending-expunge-conflict-lease',
          invalidationId: 'pending-expunge-wrong-validity',
          generationId: fixture.generationId,
          uidValidity: fixture.uidValidity + 1,
          expectedStagedCount: 0,
          missingUids: [4],
        }),
        /MAILBOX_UID_TARGET_MANIFEST_INVALIDATION_CONFLICT/
      );
    } finally {
      await client.query('rollback');
    }
  });

  test('active steady expunge houdt inhoud zichtbaar en forceert een nieuwe frozen generatie', async () => {
    const client = await connect();
    await client.query('begin');
    try {
      const fixture = await createTargetedAllMailActiveFixture(client, {
        mutationPrefix: 'active-expunge-seed',
      });
      await lease(client, fixture.syncKey, 'active-expunge-invalidation-lease');
      const invalidationInput = {
        syncKey: fixture.syncKey,
        token: 'active-expunge-invalidation-lease',
        invalidationId: 'active-expunge-invalidation',
        generationId: fixture.generationId,
        uidValidity: fixture.uidValidity,
        expectedStagedCount: 0,
        missingUids: [4],
      };
      const invalidated = await invalidateTargetManifest(client, invalidationInput);
      assert.deepEqual(invalidated, {
        invalidated: true,
        lock_lost: false,
        replayed: false,
        generation_role: 'active',
        pending_abandoned: false,
        active_manifest_invalidated: true,
        lock_released: true,
      });
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_messages
        where uid_generation_id=$1::uuid
          and generation_superseded_at is null and deleted_at is null
      `, [fixture.generationId])).rows[0].count, 1);
      const replayed = await invalidateTargetManifest(client, invalidationInput);
      assert.equal(replayed.replayed, true);

      await lease(client, fixture.syncKey, 'active-expunge-rebuild-lease');
      const rebuilt = await prepare(
        client,
        fixture.syncKey,
        'active-expunge-rebuild-lease',
        fixture.uidValidity,
        fixture.scanUpperUid + 1,
        'targeted-sparse-v2',
        [fixture.targetReference]
      );
      assert.equal(rebuilt.mode, 'rebuild');
      assert.notEqual(rebuilt.target_generation_id, fixture.generationId);
      assert.equal(rebuilt.selection_manifest_scanned_through_uid, '0');
      assert.deepEqual(rebuilt.target_uid_manifest, []);
    } finally {
      await client.query('rollback');
    }
  });

  test('verdwenen anchor na prepare verandert het frozen commitbewijs niet', async () => {
    const client = await connect();
    const syncKey = 'servecreusen@softora.nl|allmail';
    const targetReference = 'legacy-visible@test';
    await client.query('begin');
    try {
      await client.query(`
        insert into public.softora_mailbox_sync_state(
          sync_key,account_email,folder,status,last_uid,message_count,uid_validity
        ) values($1,'servecreusen@softora.nl','allmail','idle',0,0,null)
      `, [syncKey]);
      await lease(client, syncKey, 'anchor-disappears-lease');
      const prepared = await prepare(
        client,
        syncKey,
        'anchor-disappears-lease',
        700,
        5,
        'targeted-sparse-v2',
        [targetReference]
      );
      const checkpoint = await checkpointTargetManifest(client, {
        syncKey,
        token: 'anchor-disappears-lease',
        checkpointId: 'anchor-disappears-checkpoint',
        generationId: prepared.target_generation_id,
        uidValidity: 700,
        expectedScannedThroughUid: 0,
        scannedThroughUid: 4,
        foundUids: [4],
        scanComplete: true,
      });
      assert.equal(checkpoint.checkpointed, true);
      await client.query(`
        update public.softora_mailbox_messages
        set deleted_at=pg_catalog.clock_timestamp()
        where account_email='servecreusen@softora.nl'
          and provider_id='legacy:1'
      `);
      assert.equal((await client.query(`
        select public.softora_mailbox_target_references_are_anchored(
          'servecreusen@softora.nl',$1::jsonb
        ) as anchored
      `, [JSON.stringify([targetReference])])).rows[0].anchored, false);

      const committed = await commit(client, {
        syncKey,
        token: 'anchor-disappears-lease',
        commitId: 'anchor-disappears-commit',
        generationId: prepared.target_generation_id,
        uidValidity: 700,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: [targetReference],
        targetUidManifest: [4],
        rows: [messageRow(4, 'anchor-disappears', {
          account_email: 'servecreusen@softora.nl',
          folder: 'allmail',
          in_reply_to: targetReference,
        })],
        fromUid: 1,
        throughUid: 1,
        complete: true,
        messageCount: 1,
        lastUid: 0,
      });
      assert.equal(committed.committed, true);
      assert.equal(committed.activated, true);
    } finally {
      await client.query('rollback');
    }
  });

  test('targetmanifest checkpoint doorloopt partial, resume, final, replay en drift fail-closed', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|allmail';
    const targetReferenceIds = ['seed-a@test'];
    await client.query('begin');
    try {
      await client.query(`
        insert into public.softora_mailbox_messages(
          message_key,account_email,folder,uid,provider_id,message_id,
          subject,date,unread,starred,payload
        ) values(
          'serve-checkpoint-anchor','serve@softora.nl','coldmail',99001,
          'serve-checkpoint-anchor','seed-b@test','Checkpoint anchor',
          pg_catalog.clock_timestamp(),false,false,'{"source":"imap-sync"}'::jsonb
        )
      `);
      await lease(client, syncKey, 'checkpoint-partial-lease');
      const prepared = await prepare(
        client, syncKey, 'checkpoint-partial-lease', 900, 21,
        'targeted-sparse-v2', targetReferenceIds
      );
      assert.equal(prepared.mode, 'rebuild');
      assert.equal(prepared.selection_manifest_scanned_through_uid, '0');
      assert.deepEqual(prepared.target_uid_manifest, []);
      assert.equal(prepared.target_manifest_complete, false);

      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        syncKey, token: 'checkpoint-partial-lease', checkpointId: 'checkpoint-unsorted',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 0, scannedThroughUid: 10,
        foundUids: [7, 3], scanComplete: false,
      }), /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID/);
      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        syncKey, token: 'checkpoint-partial-lease', checkpointId: 'checkpoint-duplicate',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 0, scannedThroughUid: 10,
        foundUids: [3, 3], scanComplete: false,
      }), /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_INVALID/);
      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        syncKey, token: 'checkpoint-partial-lease', checkpointId: 'checkpoint-outside-window',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 0, scannedThroughUid: 10,
        foundUids: [11], scanComplete: false,
      }), /MAILBOX_UID_TARGET_MANIFEST_UID_OUT_OF_WINDOW/);
      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        syncKey, token: 'checkpoint-partial-lease', checkpointId: 'checkpoint-false-complete',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 0, scannedThroughUid: 10,
        foundUids: [3], scanComplete: true,
      }), /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_CONFLICT/);

      const partialInput = {
        syncKey, token: 'checkpoint-partial-lease', checkpointId: 'checkpoint-partial',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 0, scannedThroughUid: 10,
        foundUids: [3, 7], scanComplete: false,
      };
      const partial = await checkpointTargetManifest(client, partialInput);
      assert.deepEqual(partial, {
        checkpointed: true,
        lock_lost: false,
        replayed: false,
        scanned_through_uid: '10',
        target_uid_manifest: [3, 7],
        scan_complete: false,
        lock_released: true,
      });
      assert.deepEqual((await client.query(`
        select state.status,state.lock_token,state.pending_uid_generation_id,
          generation.selection_manifest_scanned_through_uid,
          generation.selection_manifest_partial_uids,
          generation.selection_uid_manifest
        from public.softora_mailbox_sync_state as state
        join public.softora_mailbox_uid_generations as generation
          on generation.generation_id=state.pending_uid_generation_id
        where state.sync_key=$1
      `, [syncKey])).rows[0], {
        status: 'idle',
        lock_token: null,
        pending_uid_generation_id: prepared.target_generation_id,
        selection_manifest_scanned_through_uid: '10',
        selection_manifest_partial_uids: [3, 7],
        selection_uid_manifest: null,
      });

      const partialReplay = await checkpointTargetManifest(client, partialInput);
      assert.equal(partialReplay.checkpointed, true);
      assert.equal(partialReplay.replayed, true);
      assert.equal(partialReplay.lock_released, true);
      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        ...partialInput, foundUids: [3, 8],
      }), /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);
      await rejectsInSavepoint(client, () => client.query(`
        update public.softora_mailbox_uid_generations
        set selection_uid_manifest='[3,7]'::jsonb
        where generation_id=$1::uuid
      `, [prepared.target_generation_id]),
      /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_REQUIRED/);

      await lease(client, syncKey, 'checkpoint-final-lease');
      const resumed = await prepare(
        client, syncKey, 'checkpoint-final-lease', 900, 21,
        'targeted-sparse-v2', targetReferenceIds
      );
      assert.equal(resumed.resumed, true);
      assert.equal(resumed.target_generation_id, prepared.target_generation_id);
      assert.equal(resumed.selection_manifest_scanned_through_uid, '10');
      assert.deepEqual(resumed.target_uid_manifest, [3, 7]);
      assert.equal(resumed.target_manifest_complete, false);

      const finalInput = {
        syncKey, token: 'checkpoint-final-lease', checkpointId: 'checkpoint-final',
        generationId: prepared.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 10, scannedThroughUid: 20,
        foundUids: [12, 18], scanComplete: true,
      };
      const final = await checkpointTargetManifest(client, finalInput);
      assert.deepEqual(final, {
        checkpointed: true,
        lock_lost: false,
        replayed: false,
        scanned_through_uid: '20',
        target_uid_manifest: [3, 7, 12, 18],
        scan_complete: true,
        lock_released: false,
      });
      assert.deepEqual((await client.query(`
        select state.status,state.lock_token,
          generation.selection_manifest_scanned_through_uid,
          generation.selection_manifest_partial_uids,
          generation.selection_uid_manifest
        from public.softora_mailbox_sync_state as state
        join public.softora_mailbox_uid_generations as generation
          on generation.generation_id=state.pending_uid_generation_id
        where state.sync_key=$1
      `, [syncKey])).rows[0], {
        status: 'syncing',
        lock_token: 'checkpoint-final-lease',
        selection_manifest_scanned_through_uid: '20',
        selection_manifest_partial_uids: [3, 7, 12, 18],
        selection_uid_manifest: [3, 7, 12, 18],
      });
      await rejectsInSavepoint(client, () => checkpointTargetManifest(client, {
        ...finalInput, checkpointId: 'checkpoint-stale-cursor',
        expectedScannedThroughUid: 10,
      }), /MAILBOX_UID_TARGET_MANIFEST_CHECKPOINT_CONFLICT/);

      const activated = await commit(client, {
        syncKey, token: 'checkpoint-final-lease', commitId: 'checkpoint-activate',
        generationId: prepared.target_generation_id, uidValidity: 900,
        selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
        targetUidManifest: [3, 7, 12, 18],
        rows: [3, 7, 12, 18].map((uid) => messageRow(uid, `checkpoint-${uid}`, {
          account_email: 'serve@softora.nl', folder: 'allmail',
          in_reply_to: 'seed-a@test',
        })),
        fromUid: 1, throughUid: 4, complete: true,
        messageCount: 4, lastUid: 0,
      });
      assert.equal(activated.activated, true);
      const finalReplay = await checkpointTargetManifest(client, finalInput);
      assert.equal(finalReplay.replayed, true);
      assert.deepEqual(finalReplay.target_uid_manifest, [3, 7, 12, 18]);

      await lease(client, syncKey, 'checkpoint-upper-drift-lease');
      const upperDrift = await prepare(
        client, syncKey, 'checkpoint-upper-drift-lease', 900, 26,
        'targeted-sparse-v2', targetReferenceIds
      );
      assert.equal(upperDrift.mode, 'rebuild');
      assert.notEqual(upperDrift.target_generation_id, prepared.target_generation_id);
      assert.equal(upperDrift.scan_upper_uid, '25');
      assert.equal(upperDrift.selection_manifest_scanned_through_uid, '20');
      assert.deepEqual(upperDrift.target_uid_manifest, [3, 7, 12, 18]);
      assert.equal(upperDrift.target_manifest_complete, false);

      const frozenTargetResume = await prepare(
        client, syncKey, 'checkpoint-upper-drift-lease', 900, 26,
        'targeted-sparse-v2', ['seed-b@test']
      );
      assert.equal(frozenTargetResume.mode, 'rebuild');
      assert.equal(frozenTargetResume.resumed, true);
      assert.equal(frozenTargetResume.target_generation_id, upperDrift.target_generation_id);
      assert.equal(frozenTargetResume.scan_upper_uid, '25');
      assert.deepEqual(frozenTargetResume.selection_targets, targetReferenceIds);
      assert.equal(frozenTargetResume.selection_manifest_scanned_through_uid, '20');
      assert.deepEqual(frozenTargetResume.target_uid_manifest, [3, 7, 12, 18]);

      const upperFinal = await checkpointTargetManifest(client, {
        syncKey, token: 'checkpoint-upper-drift-lease',
        checkpointId: 'checkpoint-upper-final',
        generationId: upperDrift.target_generation_id, uidValidity: 900,
        expectedScannedThroughUid: 20, scannedThroughUid: 25,
        foundUids: [], scanComplete: true,
      });
      assert.deepEqual(upperFinal.target_uid_manifest, [3, 7, 12, 18]);
      assert.equal(upperFinal.scan_complete, true);
      const upperActivated = await commit(client, {
        syncKey, token: 'checkpoint-upper-drift-lease',
        commitId: 'checkpoint-upper-activate',
        generationId: upperDrift.target_generation_id, uidValidity: 900,
        selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
        targetUidManifest: [3, 7, 12, 18],
        rows: [3, 7, 12, 18].map((uid) => messageRow(uid, `checkpoint-upper-${uid}`, {
          account_email: 'serve@softora.nl', folder: 'allmail',
          in_reply_to: 'seed-a@test',
        })),
        fromUid: 1, throughUid: 4, complete: true,
        messageCount: 4, lastUid: 0,
      });
      assert.equal(upperActivated.activated, true);

      await lease(client, syncKey, 'checkpoint-target-drift-lease');
      const nextTargetGeneration = await prepare(
        client, syncKey, 'checkpoint-target-drift-lease', 900, 26,
        'targeted-sparse-v2', ['seed-b@test']
      );
      assert.equal(nextTargetGeneration.mode, 'rebuild');
      assert.notEqual(nextTargetGeneration.target_generation_id, upperDrift.target_generation_id);
      assert.deepEqual(nextTargetGeneration.selection_targets, ['seed-b@test']);
      assert.equal(nextTargetGeneration.selection_manifest_scanned_through_uid, '0');
      assert.deepEqual(nextTargetGeneration.target_uid_manifest, []);
    } finally {
      await client.query('rollback');
    }
  });

  test('lege targeted selectie checkpoint en activeert zonder SEARCH- of warninglus', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|allmail';
    await client.query('begin');
    try {
      await lease(client, syncKey, 'empty-target-prepare-lease');
      const prepared = await prepare(
        client, syncKey, 'empty-target-prepare-lease', 902, 1,
        'targeted-sparse-v2', []
      );
      assert.equal(prepared.mode, 'rebuild');
      assert.deepEqual(prepared.selection_targets, []);
      assert.deepEqual(prepared.target_uid_manifest, []);
      assert.equal(prepared.target_manifest_complete, false);

      const checkpointed = await checkpointTargetManifest(client, {
        syncKey,
        token: 'empty-target-prepare-lease',
        checkpointId: 'empty-target-checkpoint',
        generationId: prepared.target_generation_id,
        uidValidity: 902,
        expectedScannedThroughUid: 0,
        scannedThroughUid: 0,
        foundUids: [],
        scanComplete: true,
      });
      assert.equal(checkpointed.checkpointed, true);
      assert.equal(checkpointed.scan_complete, true);
      assert.deepEqual(checkpointed.target_uid_manifest, []);

      const activated = await commit(client, {
        syncKey,
        token: 'empty-target-prepare-lease',
        commitId: 'empty-target-activate',
        generationId: prepared.target_generation_id,
        uidValidity: 902,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: [],
        targetUidManifest: [],
        rows: [],
        fromUid: 1,
        throughUid: 0,
        complete: true,
        messageCount: 0,
        lastUid: 0,
      });
      assert.equal(activated.activated, true);
      assert.equal(activated.rebuild_pending, false);
      assert.deepEqual((await client.query(`
        select active_uid_generation_id,pending_uid_generation_id,
          message_count,status,lock_token
        from public.softora_mailbox_sync_state where sync_key=$1
      `, [syncKey])).rows[0], {
        active_uid_generation_id: prepared.target_generation_id,
        pending_uid_generation_id: null,
        message_count: 0,
        status: 'ok',
        lock_token: null,
      });

      await lease(client, syncKey, 'empty-target-steady-lease');
      const steady = await prepare(
        client, syncKey, 'empty-target-steady-lease', 902, 1,
        'targeted-sparse-v2', []
      );
      assert.equal(steady.mode, 'steady');
      assert.equal(steady.target_manifest_complete, true);
      assert.deepEqual(steady.target_uid_manifest, []);
      const steadyCommit = await commit(client, {
        syncKey,
        token: 'empty-target-steady-lease',
        commitId: 'empty-target-steady',
        generationId: steady.target_generation_id,
        uidValidity: 902,
        selectionPolicy: 'targeted-sparse-v2',
        targetReferenceIds: [],
        targetUidManifest: [],
        rows: [],
        fromUid: 0,
        throughUid: 0,
        complete: true,
        messageCount: 0,
        lastUid: 0,
      });
      assert.equal(steadyCommit.activated, false);
      assert.equal(steadyCommit.rebuild_pending, false);
    } finally {
      await client.query('rollback');
    }
  });

  test('per-key reparatie behoudt lineage en stelt alleen de shape-regel uit', async () => {
    const client = await connect();
    const triggerState = (await client.query(`
      select tgname,tgenabled
      from pg_catalog.pg_trigger
      where tgrelid='public.softora_mailbox_messages'::pg_catalog.regclass
        and tgname='softora_refresh_mailbox_message_lineage'
        and not tgisinternal
    `)).rows[0];
    assert.deepEqual(triggerState, {
      tgname: 'softora_refresh_mailbox_message_lineage', tgenabled: 'O',
    });
    assert.equal((await client.query(`
      select count(*)::integer as count
      from pg_catalog.pg_constraint
      where conrelid='public.softora_mailbox_campaign_lineage_members'::pg_catalog.regclass
        and conname='softora_mailbox_campaign_lineage_members_check'
    `)).rows[0].count, 0);
    const deferred = (await client.query(`
      select tgdeferrable,tginitdeferred,tgenabled
      from pg_catalog.pg_trigger
      where tgrelid='public.softora_mailbox_campaign_lineage_members'::pg_catalog.regclass
        and tgname='softora_mailbox_campaign_lineage_member_shape_deferred'
        and not tgisinternal
    `)).rows[0];
    assert.deepEqual(deferred, {
      tgdeferrable: true, tginitdeferred: true, tgenabled: 'O',
    });
    const capacity = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_lock_mailbox_sync_capacity()'::pg_catalog.regprocedure
      ) as definition
    `)).rows[0].definition;
    assert.match(capacity, /mailbox_sync_per_key_v2/);
    assert.match(capacity, /pg_advisory_xact_lock\(824031, 3\)/);
  });

  test('actieve sync blokkeert alleen accepted-zichtbaarheid en nooit sendvoorbereiding of herstel', async () => {
    const syncClient = await connect();
    const writerClient = await connect();
    const observerClient = await connect();
    const writerPid = (await writerClient.query('select pg_backend_pid() as pid')).rows[0].pid;
    let syncOpen = false;
    let acceptedPromise = null;
    const insertPrepared = (intentId, marker) => writerClient.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,owner,account_email,recipient_email,mode,
        conversation_id,provider,subject,body_text,status,send_identity_key,
        send_scope_key,payload_fingerprint,dispatch_state
      ) values ($1,$1,'serve','serve@softora.nl',$2,'new-message',$1,'smtp',
        'Kleine vraag','Exact bericht','prepared',$3,$4,$5,'reserved')
    `, [
      intentId,
      `${marker}@provenance-fence.example`,
      `new-message:${marker.repeat(64)}`,
      `smtp-new-message-scope:${marker.repeat(64)}`,
      marker.repeat(64),
    ]);

    try {
      await syncClient.query('begin');
      syncOpen = true;
      await syncClient.query(
        "select public.softora_lock_mailbox_sync_key_v2('active-sync@softora.nl|sent')"
      );
      await writerClient.query("set lock_timeout='250ms'");

      await insertPrepared('coldmail:provenance-fence-accepted', 'a');
      await writerClient.query(`
        update public.softora_mailbox_send_provenance
        set dispatch_state='started',dispatch_started_at=clock_timestamp()
        where intent_id='coldmail:provenance-fence-accepted'
      `);
      await insertPrepared('coldmail:provenance-fence-failed', 'b');
      await writerClient.query(`
        update public.softora_mailbox_send_provenance
        set status='failed',dispatch_state='finished',error_text='provider weigerde'
        where intent_id='coldmail:provenance-fence-failed'
      `);
      await insertPrepared('coldmail:provenance-fence-unknown', 'c');
      await writerClient.query(`
        update public.softora_mailbox_send_provenance
        set status='unknown',dispatch_state='started',sent_reconcile_required=true
        where intent_id='coldmail:provenance-fence-unknown'
      `);

      const versionBefore = Number((await observerClient.query(`
        select content_version from public.softora_mailbox_campaign_consistency
        where scope='campaign'
      `)).rows[0].content_version);
      await assert.rejects(writerClient.query(`
        update public.softora_mailbox_send_provenance
        set status='accepted',dispatch_state='finished',
          sent_message_id='<provenance-fence@test.softora.nl>',
          accepted_at=clock_timestamp()
        where intent_id='coldmail:provenance-fence-accepted'
      `), (error) => error?.code === '55P03');
      await writerClient.query(`
        update public.softora_mailbox_send_provenance
        set status='unknown',sent_message_id='<provenance-fence@test.softora.nl>',
          sent_reconcile_required=true,error_text='duurzame herstelmarkering bevestigd'
        where intent_id='coldmail:provenance-fence-accepted'
      `);

      await writerClient.query("set lock_timeout='7s'");
      acceptedPromise = writerClient.query(`
        update public.softora_mailbox_send_provenance
        set status='accepted',dispatch_state='finished',
          sent_message_id='<provenance-fence@test.softora.nl>',
          accepted_at=clock_timestamp()
        where intent_id='coldmail:provenance-fence-accepted'
      `);
      void acceptedPromise.catch(() => null);
      assert.ok(
        await waitForBackendWait(observerClient, writerPid, 'advisory'),
        'accepted provenance wachtte niet op de actieve syncfence'
      );
      assert.equal(Number((await observerClient.query(`
        select content_version from public.softora_mailbox_campaign_consistency
        where scope='campaign'
      `)).rows[0].content_version), versionBefore);

      await syncClient.query('commit');
      syncOpen = false;
      assert.equal((await acceptedPromise).rowCount, 1);
      acceptedPromise = null;
      assert.deepEqual((await observerClient.query(`
        select status,dispatch_state,sent_message_id
        from public.softora_mailbox_send_provenance
        where intent_id='coldmail:provenance-fence-accepted'
      `)).rows[0], {
        status: 'accepted',
        dispatch_state: 'finished',
        sent_message_id: '<provenance-fence@test.softora.nl>',
      });
      assert.equal(Number((await observerClient.query(`
        select content_version from public.softora_mailbox_campaign_consistency
        where scope='campaign'
      `)).rows[0].content_version), versionBefore + 1);
    } finally {
      if (syncOpen) await syncClient.query('rollback').catch(() => null);
      if (acceptedPromise) await acceptedPromise.catch(() => null);
    }
  });

  test('backfill geeft bekende states UUID-generaties en laat NULL-legacy ongemoeid', async () => {
    const client = await connect();
    const states = (await client.query(`
      select sync_key,uid_validity,active_uid_generation_id is not null as active
      from public.softora_mailbox_sync_state order by sync_key
    `)).rows;
    assert.deepEqual(states, [
      { sync_key: 'martijn@softora.nl|allmail', uid_validity: '910', active: true },
      { sync_key: 'martijn@softora.nl|inbox', uid_validity: '300', active: true },
      { sync_key: 'serve@softora.nl|allmail', uid_validity: '900', active: true },
      { sync_key: 'serve@softora.nl|inbox', uid_validity: '100', active: true },
      { sync_key: 'servecreusen@softora.nl|inbox', uid_validity: null, active: false },
    ]);
    const legacy = (await client.query(`
      select count(*)::integer as count from public.softora_mailbox_messages
      where account_email='servecreusen@softora.nl' and uid_generation_id is null
    `)).rows[0].count;
    assert.equal(legacy, 2);
    assert.equal((await client.query(`
      select count(*)::integer as count from public.softora_mailbox_uid_generations
      where sync_key='martijn@softora.nl|inbox' and status='active'
    `)).rows[0].count, 1);
  });

  test('prepare en commit voltooien met UTF-8-binaire targets onder een geldige lease', async () => {
    const client = await connect();
    const syncKey = 'martijn@softora.nl|allmail';
    const token = 'binary-order-valid-lease';
    const targetReferenceIds = ['x=6b@test.nl', 'x==v8@test.nl'];
    await lease(client, syncKey, token);
    const prepared = await prepare(
      client, syncKey, token, 911, 7,
      'targeted-sparse-v2', targetReferenceIds
    );
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.mode, 'rebuild');
    assert.deepEqual(prepared.selection_targets, targetReferenceIds);

    const committed = await commit(client, {
      syncKey, token, commitId: 'binary-order-valid-commit',
      generationId: prepared.target_generation_id, uidValidity: 911,
      selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
      targetUidManifest: [5, 6],
      rows: [
        messageRow(5, 'binary-order-1', {
          account_email: 'martijn@softora.nl', folder: 'allmail',
          in_reply_to: targetReferenceIds[0],
        }),
        messageRow(6, 'binary-order-2', {
          account_email: 'martijn@softora.nl', folder: 'allmail',
          in_reply_to: targetReferenceIds[1],
        }),
      ],
      fromUid: 1, throughUid: 2, complete: true,
      messageCount: 2, lastUid: 0,
    });
    assert.equal(committed.committed, true);
    assert.equal(committed.activated, true);
    assert.deepEqual((await client.query(`
      select uid_validity,message_count,status,lock_token
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0], {
      uid_validity: '911', message_count: 2, status: 'ok', lock_token: null,
    });
  });

  test('set-based ankervalidatie dekt alle headers en blijft ruim binnen de RPC-grens', async () => {
    const client = await connect();
    const semantic = (await client.query(`
      select
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '["martijn-anchor@test"]'::jsonb
        ) as message_id,
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '["martijn-parent@test"]'::jsonb
        ) as in_reply_to,
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '["martijn-chain-a@test","martijn-chain-b@test"]'::jsonb
        ) as references_text,
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '["<martijn-chain-a@test>"]'::jsonb
        ) as decorated_references_text,
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '["missing-anchor@test"]'::jsonb
        ) as missing,
        public.softora_mailbox_target_references_are_anchored(
          'serve@softora.nl', '["martijn-anchor@test"]'::jsonb
        ) as cross_account,
        public.softora_mailbox_target_references_are_anchored(
          'martijn@softora.nl', '{"not":"an-array"}'::jsonb
        ) as invalid_shape
    `)).rows[0];
    assert.deepEqual(semantic, {
      message_id: true,
      in_reply_to: true,
      references_text: true,
      decorated_references_text: true,
      missing: false,
      cross_account: false,
      invalid_shape: false,
    });

    await client.query("set statement_timeout='3s'");
    try {
      const result = (await client.query(`
        with selected as (
          select public.softora_normalize_mailbox_message_id(message_id)
            as reference_id
          from public.softora_mailbox_messages
          where account_email='martijn@softora.nl'
            and folder='coldmail'
            and provider_id like 'anchor-perf:%'
          order by uid
          limit 300
        ), targets as (
          select pg_catalog.jsonb_agg(
            reference_id order by pg_catalog.convert_to(reference_id, 'UTF8')
          ) as value
          from selected
        )
        select pg_catalog.jsonb_array_length(targets.value)::integer as target_count,
          public.softora_mailbox_target_references_are_anchored(
            'martijn@softora.nl', targets.value
          ) as anchored
        from targets
      `)).rows[0];
      assert.deepEqual(result, { target_count: 300, anchored: true });
    } finally {
      await client.query("set statement_timeout='10s'");
    }
  });

  test('All Mail reset accepteert alleen accountgeankerde sparse targets en bewaart state', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|allmail';
    const targetReferenceIds = ['seed-a@test'];
    const before = (await client.query(`
      select active_uid_generation_id,uid_validity,last_uid,message_count
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    const martijnBefore = (await client.query(`
      select active_uid_generation_id,uid_validity,last_uid,message_count
      from public.softora_mailbox_sync_state
      where sync_key='martijn@softora.nl|allmail'
    `)).rows[0];

    assert.equal((await client.query(`
      select uid_generation_protocol
      from public.softora_mailbox_campaign_consistency where scope='campaign'
    `)).rows[0].uid_generation_protocol, 'v2');

    await lease(client, syncKey, 'allmail-generic');
    await assert.rejects(
      prepare(client, syncKey, 'allmail-generic', 901, 11),
      /MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED/
    );
    await assert.rejects(commit(client, {
      syncKey, token: 'allmail-generic', commitId: 'allmail-generic-commit',
      generationId: before.active_uid_generation_id,
      uidValidity: Number(before.uid_validity), rows: [],
      fromUid: Number(before.last_uid) + 1,
      throughUid: Number(before.last_uid), complete: true,
      messageCount: before.message_count, lastUid: Number(before.last_uid),
    }), /MAILBOX_UID_ALLMAIL_SELECTION_POLICY_REQUIRED/);

    await lease(client, syncKey, 'allmail-cross-account');
    await assert.rejects(
      prepare(
        client, syncKey, 'allmail-cross-account', 901, 11,
        'targeted-sparse-v2', ['martijn-anchor@test']
      ),
      /MAILBOX_UID_TARGET_REFERENCES_UNANCHORED/
    );
    await assert.rejects(
      prepare(
        client, syncKey, 'allmail-cross-account', 901, 11,
        'targeted-sparse-v2', ['unrelated-personal@test']
      ),
      /MAILBOX_UID_TARGET_REFERENCES_UNANCHORED/
    );

    const prepared = await prepare(
      client, syncKey, 'allmail-cross-account', 901, 11,
      'targeted-sparse-v2', targetReferenceIds
    );
    assert.equal(prepared.mode, 'rebuild');
    assert.deepEqual(prepared.selection_targets, targetReferenceIds);

    await assert.rejects(commit(client, {
      syncKey, token: 'allmail-cross-account', commitId: 'allmail-unrelated-row',
      generationId: prepared.target_generation_id, uidValidity: 901,
      selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
      targetUidManifest: [10],
      rows: [messageRow(10, 'unrelated', {
        message_id: 'unrelated-personal@test',
        in_reply_to: 'not-a-campaign-anchor@test',
      })],
      fromUid: 1, throughUid: 1, complete: true, messageCount: 1, lastUid: 0,
    }), /MAILBOX_UID_GENERATION_ROW_IDENTITY_MISMATCH/);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_staging
      where generation_id=$1::uuid
    `, [prepared.target_generation_id])).rows[0].count, 0);

    const staged = await commit(client, {
      syncKey, token: 'allmail-cross-account', commitId: 'allmail-targeted-stage',
      generationId: prepared.target_generation_id, uidValidity: 901,
      selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
      targetUidManifest: [10], rows: [],
      fromUid: 1, throughUid: 0, complete: false, messageCount: 0, lastUid: 0,
    });
    assert.equal(staged.rebuild_pending, true);
    assert.equal(staged.last_uid, before.last_uid);
    assert.deepEqual((await client.query(`
      select active_uid_generation_id,pending_uid_generation_id,uid_validity,
        last_uid,message_count,status
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0], {
      active_uid_generation_id: before.active_uid_generation_id,
      pending_uid_generation_id: prepared.target_generation_id,
      uid_validity: before.uid_validity,
      last_uid: before.last_uid,
      message_count: before.message_count,
      status: 'idle',
    });

    await lease(client, syncKey, 'allmail-targeted-activate');

    const committed = await commit(client, {
      syncKey, token: 'allmail-targeted-activate', commitId: 'allmail-targeted-row',
      generationId: prepared.target_generation_id, uidValidity: 901,
      selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
      targetUidManifest: [10],
      rows: [messageRow(10, 'targeted', {
        message_id: 'serve-reply@test', in_reply_to: 'seed-a@test',
        unread: true, starred: false,
      })],
      fromUid: 1, throughUid: 1, complete: true, messageCount: 1, lastUid: 0,
    });
    assert.equal(committed.activated, true);
    assert.equal(committed.last_uid, before.last_uid);
    assert.deepEqual((await client.query(`
      select uid_validity,last_uid,message_count,active_uid_generation_id,
        pending_uid_generation_id
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0], {
      uid_validity: '901', last_uid: before.last_uid, message_count: 1,
      active_uid_generation_id: prepared.target_generation_id,
      pending_uid_generation_id: null,
    });

    await lease(client, syncKey, 'allmail-targeted-steady');
    const steady = await prepare(
      client, syncKey, 'allmail-targeted-steady', 901, 11,
      'targeted-sparse-v2', targetReferenceIds
    );
    assert.equal(steady.mode, 'steady');
    const steadyCommitted = await commit(client, {
      syncKey, token: 'allmail-targeted-steady', commitId: 'allmail-targeted-steady-row',
      generationId: steady.target_generation_id, uidValidity: 901,
      selectionPolicy: 'targeted-sparse-v2', targetReferenceIds,
      targetUidManifest: [10],
      rows: [messageRow(10, 'targeted', {
        message_id: 'serve-reply@test', in_reply_to: 'seed-a@test',
        starred: true,
      })],
      fromUid: 0, throughUid: 0, complete: true, messageCount: 1, lastUid: 0,
    });
    assert.equal(steadyCommitted.activated, false);
    assert.equal(steadyCommitted.last_uid, before.last_uid);
    assert.deepEqual((await client.query(`
      select last_uid,message_count from public.softora_mailbox_sync_state
      where sync_key=$1
    `, [syncKey])).rows[0], {
      last_uid: before.last_uid,
      message_count: 1,
    });
    assert.deepEqual((await client.query(`
      select uid,message_id,unread,starred,softora_read_at is not null as read,
        reply_dismissed_at is not null as dismissed
      from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='allmail'
        and generation_superseded_at is null and deleted_at is null
      order by uid
    `)).rows, [{
      uid: '10', message_id: 'serve-reply@test', unread: false, starred: true,
      read: true, dismissed: true,
    }]);
    assert.deepEqual((await client.query(`
      select active_uid_generation_id,uid_validity,last_uid,message_count
      from public.softora_mailbox_sync_state
      where sync_key='martijn@softora.nl|allmail'
    `)).rows[0], martijnBefore);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
      where commit_id in ('allmail-generic-commit','allmail-unrelated-row')
    `)).rows[0].count, 0);
  });

  test('NULL-baseline vereist exacte evidence, adopteert zichtbaar en retireert verborgen legacy', async () => {
    const client = await connect();
    const syncKey = 'servecreusen@softora.nl|inbox';
    await lease(client, syncKey, 'baseline-token');
    const prepared = await prepare(client, syncKey, 'baseline-token', 700, 3);
    assert.equal(prepared.mode, 'rebuild');
    const mismatch = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,700,$4::jsonb
      )
    `, [syncKey, 'baseline-token', prepared.target_generation_id,
      JSON.stringify([{ uid: 1, messageId: 'wrong@test' }])])).rows[0];
    assert.equal(mismatch.confirmed, false);
    assert.equal(mismatch.resume_after_uid, '0');
    const lockLost = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,'wrong-baseline-token',$2::uuid,700,'[]'::jsonb
      )
    `, [syncKey, prepared.target_generation_id])).rows[0];
    assert.equal(lockLost.confirmed, false);
    assert.equal(lockLost.lock_lost, true);
    assert.equal(lockLost.resume_after_uid, '0');
    const confirmed = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,700,$4::jsonb
      )
    `, [syncKey, 'baseline-token', prepared.target_generation_id,
      JSON.stringify([{ uid: 1, messageId: 'legacy-visible@test' }])])).rows[0];
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.resume_after_uid, '0');
    assert.equal(confirmed.adopted_count, 1);
    assert.equal((await client.query(`
      select last_uid from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0].last_uid, '0');
    const rows = (await client.query(`
      select provider_id,uid_generation_id is not null as adopted,
        generation_superseded_at is not null as superseded,unread,starred,
        softora_read_at is not null as read,reply_dismissed_at is not null as dismissed
      from public.softora_mailbox_messages
      where account_email='servecreusen@softora.nl' order by uid
    `)).rows;
    assert.deepEqual(rows, [
      { provider_id: 'legacy:1', adopted: true, superseded: false,
        unread: false, starred: true, read: true, dismissed: true },
      { provider_id: 'legacy:2', adopted: false, superseded: true,
        unread: false, starred: false, read: false, dismissed: false },
    ]);
    const adoptedMessageKey = `${syncKey}|gen:${prepared.target_generation_id}|1`;
    assert.deepEqual((await client.query(`
      select message_key,root_message_key,parent_message_key,lineage_depth
      from public.softora_mailbox_campaign_lineage_members
      where message_key=$1
    `, [adoptedMessageKey])).rows[0], {
      message_key: adoptedMessageKey,
      root_message_key: adoptedMessageKey,
      parent_message_key: null,
      lineage_depth: 0,
    });
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_campaign_lineage_roots where message_key=$1
    `, [adoptedMessageKey])).rows[0].count, 1);
    const replay = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,700,$4::jsonb
      )
    `, [syncKey, 'baseline-token', prepared.target_generation_id,
      JSON.stringify([{ uid: 1, messageId: 'legacy-visible@test' }])])).rows[0];
    assert.equal(replay.confirmed, true);
    assert.equal(replay.resume_after_uid, '0');

    const resumed = await prepare(client, syncKey, 'baseline-token', 700, 3);
    assert.equal(resumed.mode, 'steady');
    assert.equal(resumed.scanned_through_uid, '0');
    const refetched = await commit(client, {
      syncKey, token: 'baseline-token', commitId: 'baseline-rescan-commit',
      generationId: resumed.target_generation_id, uidValidity: 700,
      rows: [
        messageRow(1, 'legacy-rescan', {
          provider_id: 'legacy:1', message_id: 'legacy-visible@test', starred: true,
        }),
        messageRow(2, 'extra-server-row'),
      ],
      fromUid: 1, throughUid: 2, complete: true, messageCount: 2, lastUid: 2,
    });
    assert.equal(refetched.committed, true);
    assert.deepEqual((await client.query(`
      select uid,provider_id,softora_read_at is not null as read,
        reply_dismissed_at is not null as dismissed
      from public.softora_mailbox_messages
      where account_email='servecreusen@softora.nl'
        and generation_superseded_at is null and deleted_at is null
      order by uid
    `)).rows, [
      { uid: '1', provider_id: 'legacy:1', read: true, dismissed: true },
      { uid: '2', provider_id: 'imap:extra-server-row:2', read: false, dismissed: false },
    ]);
    const newMessageKey = `servecreusen@softora.nl|inbox|gen:${prepared.target_generation_id}|2`;
    assert.deepEqual((await client.query(`
      select message_key,root_message_key,parent_message_key,lineage_depth
      from public.softora_mailbox_campaign_lineage_members
      where message_key=$1
    `, [newMessageKey])).rows[0], {
      message_key: newMessageKey,
      root_message_key: newMessageKey,
      parent_message_key: null,
      lineage_depth: 0,
    });
  });

  test('uitgestelde lineage-shape-regel weigert een ongeldige eindtoestand bij commit', async () => {
    const client = await connect();
    await client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,date,payload
      ) values('external@test|archive|99','external@test','archive',99,
        'external-invalid-lineage',clock_timestamp(),'{}'::jsonb)
    `);
    const validRoot = (await client.query(`
      select message_key from public.softora_mailbox_campaign_lineage_members
      where lineage_depth=0 order by message_key limit 1
    `)).rows[0].message_key;
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_campaign_lineage_members(
        message_key,account_email,message_id,root_message_key,root_message_id,
        parent_message_key,lineage_depth
      ) values($1,'external@test','external-invalid@test',$2,'wrong-root@test',null,0)
    `, ['external@test|archive|99', validRoot]),
    /softora_mailbox_campaign_lineage_members_shape_check/);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_campaign_lineage_members
      where message_key='external@test|archive|99'
    `)).rows[0].count, 0);
  });

  test('lege NULL-baseline activeert exact één lege UUID-generatie', async () => {
    const client = await connect();
    const syncKey = 'empty-baseline@softora.nl|inbox';
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,'empty-baseline@softora.nl','inbox','idle',0,0,null)
    `, [syncKey]);
    await lease(client, syncKey, 'empty-baseline-token');
    const prepared = await prepare(client, syncKey, 'empty-baseline-token', 800, 1);
    assert.equal(prepared.mode, 'rebuild');
    const confirmed = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,800,'[]'::jsonb
      )
    `, [syncKey, 'empty-baseline-token', prepared.target_generation_id])).rows[0];
    assert.deepEqual(confirmed, {
      confirmed: true,
      lock_lost: false,
      active_generation_id: prepared.target_generation_id,
      current_uid_validity: '800',
      resume_after_uid: '0',
      adopted_count: 0,
    });
    const state = (await client.query(`
      select active_uid_generation_id,pending_uid_generation_id,uid_validity,last_uid,message_count
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    assert.deepEqual(state, {
      active_uid_generation_id: prepared.target_generation_id,
      pending_uid_generation_id: null,
      uid_validity: '800',
      last_uid: '0',
      message_count: 0,
    });
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_messages
      where account_email='empty-baseline@softora.nl' and folder='inbox'
    `)).rows[0].count, 0);
  });

  test('A naar B naar A gebruikt drie UUID-generaties ondanks hergebruikte UID', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    const initial = (await client.query(`
      select active_uid_generation_id from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0].active_uid_generation_id;

    await lease(client, syncKey, 'to-b');
    const toB = await prepare(client, syncKey, 'to-b', 200, 2);
    const b = await commit(client, {
      syncKey, token: 'to-b', commitId: 'commit-to-b',
      generationId: toB.target_generation_id, uidValidity: 200,
      rows: [messageRow(1, 'b')], fromUid: 1, throughUid: 1,
      complete: true, lastUid: 1,
    });
    assert.equal(b.activated, true);

    await lease(client, syncKey, 'back-to-a');
    const backToA = await prepare(client, syncKey, 'back-to-a', 100, 2);
    assert.notEqual(backToA.target_generation_id, initial);
    assert.notEqual(backToA.target_generation_id, toB.target_generation_id);
    const a2 = await commit(client, {
      syncKey, token: 'back-to-a', commitId: 'commit-back-to-a',
      generationId: backToA.target_generation_id, uidValidity: 100,
      rows: [messageRow(1, 'a2')], fromUid: 1, throughUid: 1,
      complete: true, lastUid: 1,
    });
    assert.equal(a2.activated, true);
    const generations = (await client.query(`
      select generation_id,status,uid_validity from public.softora_mailbox_uid_generations
      where sync_key=$1 order by created_at,generation_id
    `, [syncKey])).rows;
    assert.equal(generations.length, 3);
    assert.equal(generations.filter((row) => row.status === 'active').length, 1);
    assert.deepEqual(generations.map((row) => row.uid_validity), ['100', '200', '100']);
    const activeRows = (await client.query(`
      select message_key,subject,uid_validity from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox'
        and generation_superseded_at is null and deleted_at is null
    `)).rows;
    assert.deepEqual(activeRows, [{
      message_key: `serve@softora.nl|inbox|gen:${backToA.target_generation_id}|1`,
      subject: 'Re: a2', uid_validity: '100',
    }]);

    const mutationKey = 'a'.repeat(64);
    const mutation = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation(
        'serve@softora.nl','inbox',1,'',$1,7,false,true
      )
    `, [mutationKey])).rows[0];
    assert.equal(mutation.applied, true);
    assert.equal(mutation.message_key, activeRows[0].message_key);

    const serveEpochRows = (await client.query(`
      select uid_generation_id,state_revision,
        generation_superseded_at is null as active
      from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox' and uid=1
      order by created_at,uid_generation_id
    `)).rows;
    assert.equal(serveEpochRows.length, 3);
    assert.deepEqual(
      serveEpochRows.filter((row) => Number(row.state_revision) === 7),
      [{
        uid_generation_id: backToA.target_generation_id,
        state_revision: '7',
        active: true,
      }]
    );
    assert.ok(serveEpochRows.filter((row) => !row.active).every(
      (row) => Number(row.state_revision) === 0
    ));
    assert.equal((await client.query(`
      select state_revision from public.softora_mailbox_messages
      where account_email='martijn@softora.nl' and folder='inbox' and uid=1
        and generation_superseded_at is null
    `)).rows[0].state_revision, '0');
  });

  test('v2 state-mutatie weigert generation-A messageKey na UID-hergebruik en muteert alleen actieve B', async () => {
    const client = await connect();
    const accountEmail = 'state-identity@softora.nl';
    const syncKey = `${accountEmail}|inbox`;
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,'inbox','idle',0,0,null)
    `, [syncKey, accountEmail]);

    const generationA = await activateSnapshot(client, {
      syncKey,
      token: 'state-identity-a-token',
      commitId: 'state-identity-a-commit',
      uidValidity: 1100,
      rows: [messageRow(1, 'state-identity-a')],
    });
    const keyA = `${syncKey}|gen:${generationA.prepared.target_generation_id}|1`;

    const generationB = await activateSnapshot(client, {
      syncKey,
      token: 'state-identity-b-token',
      commitId: 'state-identity-b-commit',
      uidValidity: 1200,
      rows: [messageRow(1, 'state-identity-b')],
    });
    const keyB = `${syncKey}|gen:${generationB.prepared.target_generation_id}|1`;

    await assert.rejects(
      () => client.query(`
        select * from public.softora_apply_mailbox_state_mutation_v2(
          $1,'inbox',1,'',$2,$3,$4,31,false,true
        )
      `, [accountEmail, keyA, 'state-identity-a-1@test.softora.nl', 'c'.repeat(64)]),
      /MAILBOX_STATE_MESSAGE_IDENTITY_MISMATCH/
    );
    const beforeRows = (await client.query(`
      select message_key,state_revision,unread,reply_dismissed_at
      from public.softora_mailbox_messages
      where account_email=$1 and folder='inbox' and uid=1
    `, [accountEmail])).rows;
    assert.equal(beforeRows.length, 2);
    const beforeByKey = new Map(beforeRows.map((row) => [row.message_key, row]));
    assert.deepEqual(beforeByKey.get(keyA), {
      message_key: keyA, state_revision: '0', unread: true, reply_dismissed_at: null,
    });
    assert.deepEqual(beforeByKey.get(keyB), {
      message_key: keyB, state_revision: '0', unread: true, reply_dismissed_at: null,
    });

    const applied = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,32,false,true
      )
    `, [accountEmail, keyB, 'state-identity-b-1@test.softora.nl', 'd'.repeat(64)])).rows[0];
    assert.equal(applied.applied, true);
    assert.equal(applied.message_key, keyB);
    const afterRows = (await client.query(`
      select message_key,state_revision,unread,
        reply_dismissed_at is not null as dismissed
      from public.softora_mailbox_messages
      where account_email=$1 and folder='inbox' and uid=1
    `, [accountEmail])).rows;
    assert.equal(afterRows.length, 2);
    const afterByKey = new Map(afterRows.map((row) => [row.message_key, row]));
    assert.deepEqual(afterByKey.get(keyA), {
      message_key: keyA, state_revision: '0', unread: true, dismissed: false,
    });
    assert.deepEqual(afterByKey.get(keyB), {
      message_key: keyB, state_revision: '32', unread: false, dismissed: true,
    });
  });

  test('incomplete stage en crash veranderen actieve zichtbaarheid niet; resume activeert atomisch', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    const oldSubject = (await client.query(`
      select subject from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and generation_superseded_at is null
    `)).rows[0].subject;
    await lease(client, syncKey, 'stage-one');
    const prepared = await prepare(client, syncKey, 'stage-one', 400, 3);
    const staged = await commit(client, {
      syncKey, token: 'stage-one', commitId: 'stage-one-commit',
      generationId: prepared.target_generation_id, uidValidity: 400,
      rows: [messageRow(1, 'stage-1')], fromUid: 1, throughUid: 1,
      complete: false, lastUid: 1,
    });
    assert.equal(staged.rebuild_pending, true);
    assert.equal((await client.query(`
      select subject from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and generation_superseded_at is null
    `)).rows[0].subject, oldSubject);
    await lease(client, syncKey, 'stage-two');
    const resumed = await prepare(client, syncKey, 'stage-two', 400, 3);
    assert.equal(resumed.resumed, true);
    const activated = await commit(client, {
      syncKey, token: 'stage-two', commitId: 'stage-two-commit',
      generationId: resumed.target_generation_id, uidValidity: 400,
      rows: [messageRow(2, 'stage-2')], fromUid: 2, throughUid: 2,
      complete: true, messageCount: 1, lastUid: 2,
    });
    assert.equal(activated.activated, true);
    assert.equal((await client.query(`
      select message_count from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0].message_count, 2);
  });

  test('generation-activatie en state-mutatie volgen production lockorder zonder verloren UI-state', async () => {
    const activationClient = await connect();
    const mutationClient = await connect();
    const syncKey = 'servecreusen@softora.nl|sent';
    let activationPromise = null;
    let mutationPromise = null;

    await activationClient.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,'servecreusen@softora.nl','sent','idle',0,0,null)
    `, [syncKey]);
    await lease(activationClient, syncKey, 'race-baseline-token');
    const baseline = await prepare(
      activationClient, syncKey, 'race-baseline-token', 100, 1
    );
    const confirmed = (await activationClient.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,100,'[]'::jsonb
      )
    `, [syncKey, 'race-baseline-token', baseline.target_generation_id])).rows[0];
    assert.equal(confirmed.confirmed, true);
    const initialSteady = await prepare(
      activationClient, syncKey, 'race-baseline-token', 100, 2
    );
    await commit(activationClient, {
      syncKey, token: 'race-baseline-token', commitId: 'race-initial-row',
      generationId: initialSteady.target_generation_id, uidValidity: 100,
      rows: [messageRow(1, 'race-initial', { message_id: 'race-shared@test' })],
      fromUid: 1, throughUid: 1, complete: true,
      messageCount: 1, lastUid: 1,
    });

    await lease(activationClient, syncKey, 'race-activation-token');
    const pending = await prepare(
      activationClient, syncKey, 'race-activation-token', 200, 2
    );
    const activationPid = (await activationClient.query(
      'select pg_backend_pid() as pid'
    )).rows[0].pid;

    await activationClient.query(`
      create or replace function public.test_pause_after_uid_generation_insert()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        perform pg_catalog.pg_sleep(1.5);
        return null;
      end;
      $function$;
      create trigger test_pause_after_uid_generation_insert
      after insert on public.softora_mailbox_messages for each statement
      execute function public.test_pause_after_uid_generation_insert();
    `);

    try {
      activationPromise = commit(activationClient, {
        syncKey, token: 'race-activation-token', commitId: 'race-activation-row',
        generationId: pending.target_generation_id, uidValidity: 200,
        rows: [messageRow(1, 'race-reset', { message_id: 'race-shared@test' })],
        fromUid: 1, throughUid: 1, complete: true,
        messageCount: 1, lastUid: 1,
      });

      let activationPaused = false;
      const pauseDeadline = Date.now() + 3_000;
      while (!activationPaused && Date.now() < pauseDeadline) {
        const activity = (await mutationClient.query(`
          select wait_event from pg_catalog.pg_stat_activity where pid=$1
        `, [activationPid])).rows[0];
        activationPaused = activity?.wait_event === 'PgSleep';
        if (!activationPaused) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      assert.equal(activationPaused, true, 'activatie bereikte testvenster niet');

      let mutationSettled = false;
      mutationPromise = mutationClient.query(`
        select * from public.softora_apply_mailbox_state_mutation(
          'servecreusen@softora.nl','sent',1,'',$1,11,false,true
        )
      `, ['b'.repeat(64)]).then((result) => result.rows[0]).finally(() => {
        mutationSettled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      assert.equal(
        mutationSettled,
        false,
        'state-mutatie omzeilde de advisory/campaign generatie-fence'
      );

      const [activated, mutation] = await Promise.all([
        activationPromise, mutationPromise,
      ]);
      assert.equal(activated.activated, true);
      assert.equal(mutation.applied, true);
      assert.equal(
        mutation.message_key,
        `servecreusen@softora.nl|sent|gen:${pending.target_generation_id}|1`
      );
      assert.deepEqual((await mutationClient.query(`
        select uid_generation_id,state_revision,unread,
          reply_dismissed_at is not null as dismissed
        from public.softora_mailbox_messages
        where account_email='servecreusen@softora.nl' and folder='sent'
          and generation_superseded_at is null and deleted_at is null
      `)).rows, [{
        uid_generation_id: pending.target_generation_id,
        state_revision: '11',
        unread: false,
        dismissed: true,
      }]);
      assert.equal((await mutationClient.query(`
        select state_revision from public.softora_mailbox_messages
        where account_email='servecreusen@softora.nl' and folder='sent'
          and generation_superseded_at is not null
      `)).rows[0].state_revision, '0');
    } finally {
      await Promise.allSettled([activationPromise, mutationPromise].filter(Boolean));
      await mutationClient.query(`
        drop trigger if exists test_pause_after_uid_generation_insert
          on public.softora_mailbox_messages;
        drop function if exists public.test_pause_after_uid_generation_insert();
      `);
    }
  });

  test('contact- en berichtzichtbaarheid sluiten UID-activatie wederzijds uit zonder hide/restore-miss', async () => {
    const syncClient = await connect();
    const visibilityClient = await connect();
    const observerClient = await connect();
    const sharedFenceClient = await connect();
    const syncKey = 'servecreusen@softora.nl|coldmail';
    const accountEmail = 'servecreusen@softora.nl';
    const folder = 'coldmail';
    const contactEmail = 'visibility-race@example.org';
    const providerId = 'visibility-race-provider';
    const messageId = 'visibility-race@test.softora.nl';
    let syncPromise = null;
    let visibilityPromise = null;
    let sharedFenceOpen = false;

    const raceRow = (suffix) => messageRow(1, suffix, {
      provider_id: providerId,
      message_id: messageId,
      sender_email: contactEmail,
      recipients_text: accountEmail,
      subject: 'Re: Kleine vraag over jullie website',
    });
    const activeMessage = async () => (await observerClient.query(`
      select message_key,uid,provider_id,uid_generation_id,deleted_at
      from public.softora_mailbox_messages
      where account_email=$1 and folder=$2 and uid=1
        and generation_superseded_at is null
    `, [accountEmail, folder])).rows[0];
    const tombstoneCount = async () => Number((await observerClient.query(`
      select count(*)::integer as count
      from public.softora_mailbox_message_tombstones
      where account_email=$1
        and normalized_message_id=public.softora_normalize_mailbox_message_id($2)
    `, [accountEmail, messageId])).rows[0].count);

    await syncClient.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,$3,'idle',0,0,null)
    `, [syncKey, accountEmail, folder]);
    await lease(syncClient, syncKey, 'visibility-baseline-token');
    const baseline = await prepare(
      syncClient, syncKey, 'visibility-baseline-token', 500, 1
    );
    const confirmed = (await syncClient.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,500,'[]'::jsonb
      )
    `, [syncKey, 'visibility-baseline-token', baseline.target_generation_id])).rows[0];
    assert.equal(confirmed.confirmed, true);

    await lease(syncClient, syncKey, 'visibility-initial-token');
    const initial = await prepare(
      syncClient, syncKey, 'visibility-initial-token', 500, 2
    );
    const initialCommit = await commit(syncClient, {
      syncKey,
      token: 'visibility-initial-token',
      commitId: 'visibility-initial-commit',
      generationId: initial.target_generation_id,
      uidValidity: 500,
      rows: [raceRow('visibility-initial')],
      fromUid: 1,
      throughUid: 1,
      complete: true,
      messageCount: 1,
      lastUid: 1,
    });
    assert.equal(initialCommit.committed, true);

    await lease(syncClient, syncKey, 'visibility-hide-token');
    const hideGeneration = await prepare(
      syncClient, syncKey, 'visibility-hide-token', 501, 2
    );
    const syncPid = (await syncClient.query(
      'select pg_backend_pid() as pid'
    )).rows[0].pid;
    const visibilityPid = (await visibilityClient.query(
      'select pg_backend_pid() as pid'
    )).rows[0].pid;

    await syncClient.query(`
      create or replace function public.test_pause_visibility_uid_insert()
      returns trigger language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        perform pg_catalog.pg_sleep(1.5);
        return null;
      end;
      $function$;
      create trigger test_pause_visibility_uid_insert
      after insert on public.softora_mailbox_messages for each statement
      execute function public.test_pause_visibility_uid_insert();
    `);

    try {
      syncPromise = commit(syncClient, {
        syncKey,
        token: 'visibility-hide-token',
        commitId: 'visibility-hide-commit',
        generationId: hideGeneration.target_generation_id,
        uidValidity: 501,
        rows: [raceRow('visibility-hide-generation')],
        fromUid: 1,
        throughUid: 1,
        complete: true,
        messageCount: 1,
        lastUid: 1,
      });
      assert.ok(
        await waitForBackendWait(observerClient, syncPid, 'PgSleep'),
        'UID-activatie bereikte het hide-racevenster niet'
      );

      let hideSettled = false;
      visibilityPromise = visibilityClient.query(`
        select * from public.softora_set_mailbox_contact_visibility(
          array[$1]::text[],$2,$1,$3,1,$4,1,true
        )
      `, [accountEmail, contactEmail, folder, providerId]).then((result) => result.rows)
        .finally(() => { hideSettled = true; });
      const hideWait = await waitForBackendWait(observerClient, visibilityPid, 'advisory');
      assert.ok(hideWait, 'contact-hide wachtte niet op de gedeelde UID-fence');
      assert.equal(hideSettled, false);

      const [activated, hiddenRows] = await Promise.all([syncPromise, visibilityPromise]);
      assert.equal(activated.activated, true);
      assert.equal(hiddenRows.length, 1);
      assert.equal((await activeMessage()).uid_generation_id, hideGeneration.target_generation_id);
      assert.ok((await activeMessage()).deleted_at);
      assert.equal(await tombstoneCount(), 1);

      await syncClient.query(`
        drop trigger if exists test_pause_visibility_uid_insert
          on public.softora_mailbox_messages;
        drop function if exists public.test_pause_visibility_uid_insert();
      `);
      syncPromise = null;
      visibilityPromise = null;

      await lease(syncClient, syncKey, 'visibility-restore-token');
      const restoreGeneration = await prepare(
        syncClient, syncKey, 'visibility-restore-token', 502, 2
      );
      await visibilityClient.query(`
        create or replace function public.test_pause_visibility_tombstone_delete()
        returns trigger language plpgsql volatile security invoker set search_path=''
        as $function$
        begin
          perform pg_catalog.pg_sleep(1.5);
          return old;
        end;
        $function$;
        create trigger test_pause_visibility_tombstone_delete
        before delete on public.softora_mailbox_message_tombstones for each statement
        execute function public.test_pause_visibility_tombstone_delete();
      `);

      let restoreSettled = false;
      visibilityPromise = visibilityClient.query(`
        select * from public.softora_set_mailbox_contact_visibility(
          array[$1]::text[],$2,$1,$3,1,$4,0,false
        )
      `, [accountEmail, contactEmail, folder, providerId]).then((result) => result.rows)
        .finally(() => { restoreSettled = true; });
      assert.ok(
        await waitForBackendWait(observerClient, visibilityPid, 'PgSleep'),
        'contact-restore bereikte het commit-racevenster niet'
      );

      let restoreCommitSettled = false;
      syncPromise = commit(syncClient, {
        syncKey,
        token: 'visibility-restore-token',
        commitId: 'visibility-restore-commit',
        generationId: restoreGeneration.target_generation_id,
        uidValidity: 502,
        rows: [raceRow('visibility-restore-generation')],
        fromUid: 1,
        throughUid: 1,
        complete: true,
        messageCount: 1,
        lastUid: 1,
      }).finally(() => { restoreCommitSettled = true; });
      const commitWait = await waitForBackendWait(observerClient, syncPid, 'advisory');
      assert.ok(commitWait, 'UID-commit wachtte niet op de exclusieve restore-fence');
      assert.equal(restoreCommitSettled, false);
      assert.equal(restoreSettled, false);

      const [restoredRows, restoredCommit] = await Promise.all([
        visibilityPromise, syncPromise,
      ]);
      assert.equal(restoredRows.length, 1);
      assert.equal(restoredCommit.activated, true);
      const restoredActive = await activeMessage();
      assert.equal(restoredActive.uid_generation_id, restoreGeneration.target_generation_id);
      assert.equal(restoredActive.deleted_at, null);
      assert.equal(await tombstoneCount(), 0);

      await visibilityClient.query(`
        drop trigger if exists test_pause_visibility_tombstone_delete
          on public.softora_mailbox_message_tombstones;
        drop function if exists public.test_pause_visibility_tombstone_delete();
      `);
      syncPromise = null;
      visibilityPromise = null;

      for (const hidden of [true, false]) {
        await sharedFenceClient.query('begin');
        sharedFenceOpen = true;
        await sharedFenceClient.query(
          'select public.softora_lock_mailbox_visibility_shared_v2()'
        );
        let messageVisibilitySettled = false;
        visibilityPromise = visibilityClient.query(`
          select * from public.softora_set_mailbox_message_visibility(
            $1,$2,1,$3,$4
          )
        `, [accountEmail, folder, providerId, hidden]).then((result) => result.rows)
          .finally(() => { messageVisibilitySettled = true; });
        const messageWait = await waitForBackendWait(
          observerClient, visibilityPid, 'advisory'
        );
        assert.ok(messageWait, `bericht-${hidden ? 'hide' : 'restore'} wachtte niet op shared fence`);
        assert.equal(messageVisibilitySettled, false);
        await sharedFenceClient.query('commit');
        sharedFenceOpen = false;
        const changedRows = await visibilityPromise;
        visibilityPromise = null;
        assert.equal(changedRows.length, 1);
        assert.equal(Boolean((await activeMessage()).deleted_at), hidden);
        assert.equal(await tombstoneCount(), hidden ? 1 : 0);
      }
    } finally {
      if (sharedFenceOpen) await sharedFenceClient.query('rollback').catch(() => null);
      await Promise.allSettled([syncPromise, visibilityPromise].filter(Boolean));
      await observerClient.query(`
        drop trigger if exists test_pause_visibility_uid_insert
          on public.softora_mailbox_messages;
        drop trigger if exists test_pause_visibility_tombstone_delete
          on public.softora_mailbox_message_tombstones;
        drop function if exists public.test_pause_visibility_uid_insert();
        drop function if exists public.test_pause_visibility_tombstone_delete();
      `);
    }
  });

  test('steady commit is atomisch, replay is idempotent en digest-mismatch faalt dicht', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    const state = (await client.query(`
      select active_uid_generation_id,uid_validity,last_uid
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    const activeUidOne = (await client.query(`
      select provider_id from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox' and uid=1
        and uid_generation_id=$1::uuid
    `, [state.active_uid_generation_id])).rows[0];
    await lease(client, syncKey, 'steady-token');
    const prepared = await prepare(client, syncKey, 'steady-token', Number(state.uid_validity), 4);
    assert.equal(prepared.mode, 'steady');
    const args = {
      syncKey, token: 'steady-token', commitId: 'steady-commit',
      generationId: state.active_uid_generation_id,
      uidValidity: Number(state.uid_validity),
      rows: [
        messageRow(1, 'targeted-old', { provider_id: activeUidOne.provider_id }),
        messageRow(3, 'steady-new'),
      ],
      fromUid: 3, throughUid: 3, complete: true, messageCount: 3, lastUid: 3,
    };
    const first = await commit(client, args);
    assert.equal(first.committed, true);
    assert.equal(first.replayed, false);
    const finalized = (await client.query(`
      select status,last_uid,message_count,lock_token,lock_expires_at
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    assert.deepEqual(finalized, {
      status: 'ok', last_uid: '3', message_count: 3,
      lock_token: null, lock_expires_at: null,
    });
    const replay = await commit(client, args);
    assert.equal(replay.replayed, true);
    await assert.rejects(
      commit(client, { ...args, rows: [messageRow(3, 'different')] }),
      /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/
    );
  });

  test('fout tijdens activatie rolt staging, zichtbaarheid en state atomisch terug', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    await lease(client, syncKey, 'rollback-token');
    const prepared = await prepare(client, syncKey, 'rollback-token', 500, 2);
    assert.equal(prepared.mode, 'rebuild');
    const stateBefore = (await client.query(`
      select status,last_uid,message_count,uid_validity,active_uid_generation_id,
        pending_uid_generation_id,lock_token,lock_expires_at
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    const visibleBefore = (await client.query(`
      select message_key,subject,uid_validity,uid_generation_id
      from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox'
        and generation_superseded_at is null and deleted_at is null
      order by message_key
    `)).rows;
    const commitCountBefore = (await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count;

    await client.query(`
      create or replace function public.test_reject_mailbox_generation_activation()
      returns trigger language plpgsql security invoker set search_path=''
      as $function$
      begin
        raise exception using errcode='40001', message='TEST_ACTIVATION_ROLLBACK';
      end;
      $function$;
      create trigger test_reject_mailbox_generation_activation
      before update on public.softora_mailbox_sync_state
      for each row
      when (old.active_uid_generation_id is distinct from new.active_uid_generation_id)
      execute function public.test_reject_mailbox_generation_activation();
    `);
    try {
      await assert.rejects(commit(client, {
        syncKey, token: 'rollback-token', commitId: 'rollback-commit',
        generationId: prepared.target_generation_id, uidValidity: 500,
        rows: [messageRow(1, 'rollback')],
        fromUid: 1, throughUid: 1, complete: true, lastUid: 1,
      }), /TEST_ACTIVATION_ROLLBACK/);

      const stateAfter = (await client.query(`
        select status,last_uid,message_count,uid_validity,active_uid_generation_id,
          pending_uid_generation_id,lock_token,lock_expires_at
        from public.softora_mailbox_sync_state where sync_key=$1
      `, [syncKey])).rows[0];
      assert.deepEqual(stateAfter, stateBefore);
      const visibleAfter = (await client.query(`
        select message_key,subject,uid_validity,uid_generation_id
        from public.softora_mailbox_messages
        where account_email='serve@softora.nl' and folder='inbox'
          and generation_superseded_at is null and deleted_at is null
        order by message_key
      `)).rows;
      assert.deepEqual(visibleAfter, visibleBefore);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_uid_generation_staging
        where generation_id=$1::uuid
      `, [prepared.target_generation_id])).rows[0].count, 0);
      assert.equal((await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_uid_generation_commits
      `)).rows[0].count, commitCountBefore);
      const generations = (await client.query(`
        select generation_id,status from public.softora_mailbox_uid_generations
        where generation_id=$1::uuid or generation_id=$2::uuid
        order by generation_id
      `, [stateBefore.active_uid_generation_id, prepared.target_generation_id])).rows;
      assert.equal(generations.find((row) => (
        row.generation_id === stateBefore.active_uid_generation_id
      )).status, 'active');
      assert.equal(generations.find((row) => (
        row.generation_id === prepared.target_generation_id
      )).status, 'staging');
    } finally {
      await client.query(`
        drop trigger if exists test_reject_mailbox_generation_activation
          on public.softora_mailbox_sync_state;
        drop function if exists public.test_reject_mailbox_generation_activation();
      `);
      await client.query(`
        update public.softora_mailbox_sync_state
        set status='ok',sync_started_at=null,lock_token=null,lock_expires_at=null
        where sync_key=$1
      `, [syncKey]);
    }
  });

  test('ongeldige commit-token laat state, berichten en commitlog volledig ongemoeid', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    const stateBefore = (await client.query(`
      select status,last_uid,message_count,uid_validity,active_uid_generation_id,
        pending_uid_generation_id,lock_token,lock_expires_at
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    const messagesBefore = (await client.query(`
      select message_key,provider_id,subject,generation_superseded_at,deleted_at
      from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox'
      order by message_key
    `)).rows;
    const commitCountBefore = (await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count;

    await assert.rejects(commit(client, {
      syncKey, token: 'not-the-live-token', commitId: 'invalid-token-commit',
      generationId: stateBefore.active_uid_generation_id,
      uidValidity: Number(stateBefore.uid_validity), rows: [],
      fromUid: Number(stateBefore.last_uid) + 1,
      throughUid: Number(stateBefore.last_uid), complete: true,
      messageCount: stateBefore.message_count, lastUid: Number(stateBefore.last_uid),
    }), /MAILBOX_UID_GENERATION_LEASE_INVALID/);

    assert.deepEqual((await client.query(`
      select status,last_uid,message_count,uid_validity,active_uid_generation_id,
        pending_uid_generation_id,lock_token,lock_expires_at
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0], stateBefore);
    assert.deepEqual((await client.query(`
      select message_key,provider_id,subject,generation_superseded_at,deleted_at
      from public.softora_mailbox_messages
      where account_email='serve@softora.nl' and folder='inbox'
      order by message_key
    `)).rows, messagesBefore);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count, commitCountBefore);
  });

  test('verlopen token schrijft niets en fail_v2 bewaart cursor en generatie', async () => {
    const client = await connect();
    const syncKey = 'serve@softora.nl|inbox';
    const before = (await client.query(`
      select last_uid,active_uid_generation_id,pending_uid_generation_id
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    const commitCount = (await client.query(`
      select count(*)::integer as count from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count;
    const lost = (await client.query(`
      select * from public.softora_fail_mailbox_sync_v2($1,'wrong','fail-wrong','wrong token')
    `, [syncKey])).rows[0];
    assert.equal(lost.lock_lost, true);
    assert.equal((await client.query(`
      select count(*)::integer as count from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count, commitCount);

    await lease(client, syncKey, 'fail-valid');
    const failed = (await client.query(`
      select * from public.softora_fail_mailbox_sync_v2($1,$2,'fail-valid-id','provider failure')
    `, [syncKey, 'fail-valid'])).rows[0];
    assert.equal(failed.applied, true);
    const after = (await client.query(`
      select last_uid,active_uid_generation_id,pending_uid_generation_id,status
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    assert.equal(after.last_uid, before.last_uid);
    assert.equal(after.active_uid_generation_id, before.active_uid_generation_id);
    assert.equal(after.pending_uid_generation_id, before.pending_uid_generation_id);
    assert.equal(after.status, 'error');
  });

  test('folder_missing skip is lease-fenced, idempotent en bewaart de volledige UID-state', async () => {
    const client = await connect();
    const syncKey = 'martijn@softora.nl|sent';
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,'martijn@softora.nl','sent','idle',0,0,null)
    `, [syncKey]);
    await lease(client, syncKey, 'skip-stage-token');
    const baseline = await prepare(client, syncKey, 'skip-stage-token', 100, 1);
    const confirmed = (await client.query(`
      select * from public.softora_confirm_mailbox_uid_baseline_v2(
        $1,$2,$3::uuid,100,'[]'::jsonb
      )
    `, [syncKey, 'skip-stage-token', baseline.target_generation_id])).rows[0];
    assert.equal(confirmed.confirmed, true);
    const pending = await prepare(client, syncKey, 'skip-stage-token', 200, 3);
    const partial = await commit(client, {
      syncKey, token: 'skip-stage-token', commitId: 'skip-partial-stage',
      generationId: pending.target_generation_id, uidValidity: 200,
      rows: [messageRow(1, 'skip-pending')],
      fromUid: 1, throughUid: 1, complete: false,
      messageCount: 1, lastUid: 1,
    });
    assert.equal(partial.rebuild_pending, true);
    const invariantSql = `
      select last_uid,message_count,uid_validity,uid_validity_reset_at,
        active_uid_generation_id,pending_uid_generation_id
      from public.softora_mailbox_sync_state where sync_key=$1
    `;
    const fullStateSql = `
      select status,last_synced_at,sync_started_at,lock_token,lock_expires_at,
        last_uid,message_count,last_error,uid_validity,uid_validity_reset_at,
        active_uid_generation_id,pending_uid_generation_id,updated_at
      from public.softora_mailbox_sync_state where sync_key=$1
    `;
    const invariantsBefore = (await client.query(invariantSql, [syncKey])).rows[0];
    assert.equal(invariantsBefore.pending_uid_generation_id, pending.target_generation_id);
    const stagingBefore = (await client.query(`
      select generation_id,uid,row_data,row_digest,created_at,updated_at
      from public.softora_mailbox_uid_generation_staging
      where generation_id=$1::uuid order by uid
    `, [pending.target_generation_id])).rows;
    assert.equal(stagingBefore.length, 1);
    const countCommits = async () => (await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
    `)).rows[0].count;

    const wrongBefore = (await client.query(fullStateSql, [syncKey])).rows[0];
    const wrongCommitCount = await countCommits();
    const wrong = await skipSync(client, {
      syncKey, token: 'not-the-live-skip-token', commitId: 'skip-wrong-token',
    });
    assert.deepEqual(wrong, { skipped: false, replayed: false, lock_lost: true });
    assert.deepEqual((await client.query(fullStateSql, [syncKey])).rows[0], wrongBefore);
    assert.equal(await countCommits(), wrongCommitCount);

    await assert.rejects(skipSync(client, {
      syncKey, token: 'unused-token', commitId: 'skip-invalid-reason',
      reason: 'maintenance',
    }), /MAILBOX_UID_GENERATION_SKIP_INVALID/);

    await lease(client, syncKey, 'skip-valid-token');
    const skipped = await skipSync(client, {
      syncKey, token: 'skip-valid-token', commitId: 'skip-valid-id',
    });
    assert.deepEqual(skipped, { skipped: true, replayed: false, lock_lost: false });
    const after = (await client.query(`
      select status,last_synced_at is not null as synced,lock_token,lock_expires_at,
        last_uid,message_count,uid_validity,uid_validity_reset_at,
        active_uid_generation_id,pending_uid_generation_id
      from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    assert.equal(after.status, 'ok');
    assert.equal(after.synced, true);
    assert.equal(after.lock_token, null);
    assert.equal(after.lock_expires_at, null);
    assert.deepEqual({
      last_uid: after.last_uid,
      message_count: after.message_count,
      uid_validity: after.uid_validity,
      uid_validity_reset_at: after.uid_validity_reset_at,
      active_uid_generation_id: after.active_uid_generation_id,
      pending_uid_generation_id: after.pending_uid_generation_id,
    }, invariantsBefore);
    assert.deepEqual((await client.query(`
      select generation_id,uid,row_data,row_digest,created_at,updated_at
      from public.softora_mailbox_uid_generation_staging
      where generation_id=$1::uuid order by uid
    `, [pending.target_generation_id])).rows, stagingBefore);

    const replay = await skipSync(client, {
      syncKey, token: 'skip-valid-token', commitId: 'skip-valid-id',
    });
    assert.deepEqual(replay, { skipped: true, replayed: true, lock_lost: false });
    await assert.rejects(skipSync(client, {
      syncKey, token: 'different-token', commitId: 'skip-valid-id',
    }), /MAILBOX_UID_GENERATION_REPLAY_MISMATCH/);

    const secondClient = await connect();
    await lease(client, syncKey, 'skip-concurrent-token');
    const concurrentResults = await Promise.all([
      skipSync(client, {
        syncKey, token: 'skip-concurrent-token', commitId: 'skip-concurrent-id',
      }),
      skipSync(secondClient, {
        syncKey, token: 'skip-concurrent-token', commitId: 'skip-concurrent-id',
      }),
    ]);
    assert.deepEqual(
      concurrentResults.map((row) => row.replayed).sort(),
      [false, true]
    );
    assert.ok(concurrentResults.every((row) => row.skipped && !row.lock_lost));

    await lease(client, syncKey, 'skip-expired-token');
    await client.query(`
      update public.softora_mailbox_sync_state
      set lock_expires_at=clock_timestamp()-interval '1 second'
      where sync_key=$1
    `, [syncKey]);
    const expiredBefore = (await client.query(fullStateSql, [syncKey])).rows[0];
    const expiredCommitCount = await countCommits();
    const expired = await skipSync(client, {
      syncKey, token: 'skip-expired-token', commitId: 'skip-expired-id',
    });
    assert.deepEqual(expired, { skipped: false, replayed: false, lock_lost: true });
    assert.deepEqual((await client.query(fullStateSql, [syncKey])).rows[0], expiredBefore);
    assert.equal(await countCommits(), expiredCommitCount);
    assert.deepEqual((await client.query(`
      select generation_id,uid,row_data,row_digest,created_at,updated_at
      from public.softora_mailbox_uid_generation_staging
      where generation_id=$1::uuid order by uid
    `, [pending.target_generation_id])).rows, stagingBefore);

    await client.query(`
      update public.softora_mailbox_sync_state
      set status='ok',sync_started_at=null,lock_token=null,lock_expires_at=null,
          last_error=null
      where sync_key=$1
    `, [syncKey]);
  });

  test('twee gelijke finalizers leveren één winnaar en één replay zonder deadlock', async () => {
    const firstClient = await connect();
    const secondClient = await connect();
    const syncKey = 'martijn@softora.nl|inbox';
    const state = (await firstClient.query(`
      select active_uid_generation_id from public.softora_mailbox_sync_state where sync_key=$1
    `, [syncKey])).rows[0];
    await lease(firstClient, syncKey, 'concurrent-token');
    const prepared = await prepare(firstClient, syncKey, 'concurrent-token', 300, 1);
    assert.equal(prepared.mode, 'steady');
    const args = {
      syncKey, token: 'concurrent-token', commitId: 'concurrent-commit',
      generationId: state.active_uid_generation_id, uidValidity: 300,
      rows: [], fromUid: 1, throughUid: 0, complete: true,
      messageCount: 0, lastUid: 0,
    };
    const results = await Promise.all([
      commit(firstClient, args), commit(secondClient, args),
    ]);
    assert.deepEqual(results.map((row) => row.replayed).sort(), [false, true]);
  });

  test('alle bestaande sync-states weigeren ongefencete messagewrites en v1 statewissels', async () => {
    const client = await connect();
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,date,payload,uid_validity
      ) values('legacy-null','martijn@softora.nl','inbox',51,'legacy-null',now(),
        '{"source":"imap-sync"}'::jsonb,null)
    `), /MAILBOX_UID_GENERATION_REQUIRED/);
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,date,payload,uid_validity
      ) values('legacy-explicit','martijn@softora.nl','inbox',52,'legacy-explicit',now(),
        '{"source":"imap-sync"}'::jsonb,300)
    `), /MAILBOX_UID_GENERATION_REQUIRED/);
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,date,payload,uid_validity
      ) values('legacy-mismatch','martijn@softora.nl','inbox',53,'legacy-mismatch',now(),
        '{"source":"imap-sync"}'::jsonb,301)
    `), /MAILBOX_UID_GENERATION_REQUIRED/);

    const activeGenerationId = (await client.query(`
      select active_uid_generation_id from public.softora_mailbox_sync_state
      where sync_key='martijn@softora.nl|inbox'
    `)).rows[0].active_uid_generation_id;
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,uid_generation_id,provider_id,date,payload,uid_validity
      ) values('explicit-active','martijn@softora.nl','inbox',54,$1::uuid,
        'explicit-active',now(),'{"source":"imap-sync"}'::jsonb,300)
    `, [activeGenerationId]), /MAILBOX_UID_GENERATION_STALE/);

    await lease(client, 'martijn@softora.nl|inbox', 'pending-write-probe');
    const pending = await prepare(
      client, 'martijn@softora.nl|inbox', 'pending-write-probe', 301, 2
    );
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,uid_generation_id,provider_id,date,payload,uid_validity
      ) values('explicit-pending','martijn@softora.nl','inbox',1,$1::uuid,
        'explicit-pending',now(),'{"source":"imap-sync"}'::jsonb,301)
    `, [pending.target_generation_id]), /MAILBOX_UID_GENERATION_STALE/);

    await client.query(`
      insert into public.softora_mailbox_messages(
        message_key,account_email,folder,uid,provider_id,date,payload
      ) values('provider-no-state','external-provider@test','instantly',0,
        'provider-no-state',now(),'{"providerOwner":"serve"}'::jsonb)
    `);

    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,message_count
      ) values('serve@softora.nl|sent','serve@softora.nl','sent','idle',0)
    `);
    await assert.rejects(client.query(`
      update public.softora_mailbox_sync_state set uid_validity=999
      where sync_key='serve@softora.nl|sent'
    `), /MAILBOX_UID_GENERATION_V2_TRANSITION_REQUIRED/);
    await client.query(`
      update public.softora_mailbox_sync_state set status='error',last_error='allowed'
      where sync_key='serve@softora.nl|sent'
    `);
  });

  test('RLS en ACL sluiten tabellen en RPCs voor publieke rollen', async () => {
    const client = await connect();
    const rls = (await client.query(`
      select relname,relrowsecurity,
        has_table_privilege('anon',c.oid,'select,insert,update,delete') as anon_access,
        has_table_privilege('authenticated',c.oid,'select,insert,update,delete') as auth_access,
        has_table_privilege('service_role',c.oid,'select,insert,update,delete') as service_access
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and relname like 'softora_mailbox_uid_generation%'
        and c.relkind='r'
      order by relname
    `)).rows;
    assert.deepEqual(rls.map((row) => row.relname), [
      'softora_mailbox_uid_generation_commits',
      'softora_mailbox_uid_generation_staging',
      'softora_mailbox_uid_generations',
    ]);
    assert.ok(rls.every((row) => (
      row.relrowsecurity
      && !row.anon_access
      && !row.auth_access
      && row.service_access
    )));

    const rpcAcl = (await client.query(`
      select procedure.proname,procedure.prosecdef,
        has_function_privilege('anon',procedure.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',procedure.oid,'execute') as auth_execute,
        has_function_privilege('service_role',procedure.oid,'execute') as service_execute
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname=any($1::text[])
      order by procedure.proname
    `, [[
      'softora_prepare_mailbox_uid_generation_v2',
      'softora_checkpoint_mailbox_uid_target_manifest_v2',
      'softora_confirm_mailbox_uid_baseline_v2',
      'softora_commit_mailbox_sync_pass_v2',
      'softora_skip_mailbox_sync_v2',
      'softora_fail_mailbox_sync_v2',
      'softora_apply_mailbox_state_mutation',
      'softora_apply_mailbox_state_mutation_v2',
    ]])).rows;
    assert.equal(rpcAcl.length, 8);
    assert.ok(rpcAcl.every((row) => (
      !row.prosecdef
      && !row.anon_execute
      && !row.auth_execute
      && row.service_execute
    )));
  });

  test('sync-state generation-FKs hebben partial referencing-side indexes', async () => {
    const client = await connect();
    const indexes = (await client.query(`
      select indexname,indexdef from pg_catalog.pg_indexes
      where schemaname='public' and indexname=any($1::text[])
      order by indexname
    `, [[
      'softora_mailbox_sync_state_active_uid_generation_idx',
      'softora_mailbox_sync_state_pending_uid_generation_idx',
    ]])).rows;
    assert.equal(indexes.length, 2);
    assert.match(indexes[0].indexdef, /\(active_uid_generation_id\).*WHERE \(active_uid_generation_id IS NOT NULL\)/i);
    assert.match(indexes[1].indexdef, /\(pending_uid_generation_id\).*WHERE \(pending_uid_generation_id IS NOT NULL\)/i);
  });

  test('duplicate-state migratie repareert exact, is tweemaal idempotent en blijft invoker-secured', async () => {
    const client = await connect();
    const mailboxMessageSecuritySnapshot = async () => (await client.query(`
      select class.relrowsecurity,class.relforcerowsecurity,class.relacl::text,
        has_table_privilege('anon',class.oid,'select,insert,update,delete') as anon_access,
        has_table_privilege('authenticated',class.oid,'select,insert,update,delete') as auth_access,
        has_table_privilege('service_role',class.oid,'select,insert,update,delete') as service_access
      from pg_catalog.pg_class as class
      where class.oid='public.softora_mailbox_messages'::pg_catalog.regclass
    `)).rows[0];
    const functionSecuritySnapshot = async (signatures) => (await client.query(`
      select requested.signature,procedure.prosecdef,procedure.provolatile,
        procedure.proconfig,procedure.proacl::text,
        pg_catalog.pg_get_userbyid(procedure.proowner) as owner,
        has_function_privilege('anon',procedure.oid,'execute') as anon_execute,
        has_function_privilege('authenticated',procedure.oid,'execute') as auth_execute,
        has_function_privilege('service_role',procedure.oid,'execute') as service_execute
      from pg_catalog.unnest($1::text[]) as requested(signature)
      join pg_catalog.pg_proc as procedure
        on procedure.oid=pg_catalog.to_regprocedure(requested.signature)
      order by requested.signature
    `, [signatures])).rows;
    const accountEmail = 'duplicate-repair@softora.nl';
    const messageId = 'duplicate-repair-shared@test.softora.nl';
    const inbox = await activateDuplicateStateFolder(client, {
      accountEmail,
      folder: 'inbox',
      prefix: 'duplicate-repair-inbox',
      uidValidity: 9301,
      rows: [{ uid: 1, message_id: messageId, unread: true }],
    });
    const sent = await activateDuplicateStateFolder(client, {
      accountEmail,
      folder: 'sent',
      prefix: 'duplicate-repair-sent',
      uidValidity: 9302,
      rows: [{ uid: 1, message_id: ` <${messageId.toUpperCase()}> `, unread: true }],
    });
    const deleted = await activateDuplicateStateFolder(client, {
      accountEmail,
      folder: 'trash',
      prefix: 'duplicate-repair-deleted',
      uidValidity: 9303,
      rows: [{ uid: 1, message_id: messageId, unread: true }],
    });
    const superseded = await activateDuplicateStateFolder(client, {
      accountEmail,
      folder: 'archive',
      prefix: 'duplicate-repair-superseded',
      uidValidity: 9304,
      rows: [{ uid: 1, message_id: `<${messageId.toUpperCase()}>`, unread: true }],
    });
    const canonicalReadAt = '2026-08-26T07:40:00.000Z';
    const canonicalMutationAt = '2026-08-26T07:40:01.000Z';
    const canonicalMutationKey = '1'.repeat(64);
    await client.query(`
      update public.softora_mailbox_messages
      set unread=false,
          softora_read_at=$2::timestamptz,
          reply_dismissed_at=$2::timestamptz,
          state_revision=10,
          state_mutation_key=$3,
          state_mutation_at=$4::timestamptz,
          updated_at=$4::timestamptz
      where message_key=$1
    `, [inbox.messageKeys[0], canonicalReadAt, canonicalMutationKey, canonicalMutationAt]);
    await client.query(`
      update public.softora_mailbox_messages
      set unread=true,
          softora_read_at=null,
          reply_dismissed_at=null,
          state_revision=5,
          state_mutation_key=$2,
          state_mutation_at='2026-08-26T07:39:00.000Z'::timestamptz,
          updated_at='2026-08-26T07:39:00.000Z'::timestamptz
      where message_key=$1
    `, [sent.messageKeys[0], '2'.repeat(64)]);
    await client.query(`
      update public.softora_mailbox_messages
      set unread=true,
          softora_read_at=null,
          reply_dismissed_at=null,
          state_revision=100,
          state_mutation_key=$2,
          state_mutation_at='2026-08-26T07:49:00.000Z'::timestamptz,
          deleted_at='2026-08-26T07:49:01.000Z'::timestamptz,
          updated_at='2026-08-26T07:49:01.000Z'::timestamptz
      where message_key=$1
    `, [deleted.messageKeys[0], '3'.repeat(64)]);
    await client.query(`
      update public.softora_mailbox_messages
      set unread=true,
          softora_read_at=null,
          reply_dismissed_at=null,
          state_revision=200,
          state_mutation_key=$2,
          state_mutation_at='2026-08-26T07:50:00.000Z'::timestamptz,
          generation_superseded_at='2026-08-26T07:50:01.000Z'::timestamptz,
          updated_at='2026-08-26T07:50:01.000Z'::timestamptz
      where message_key=$1
    `, [superseded.messageKeys[0], '4'.repeat(64)]);

    // Match the production ACL posture before proving that CREATE OR REPLACE
    // and the one-time repair preserve both table and trigger-helper security.
    await client.query(`
      revoke all privileges on table public.softora_mailbox_messages
        from public,anon,authenticated,service_role;
      grant select,insert,update,delete on table public.softora_mailbox_messages
        to service_role;
      grant select,insert,update on table public.softora_mailbox_campaign_consistency
        to service_role;
      grant select,insert,update,delete on table public.softora_mailbox_sync_state,
        public.softora_mailbox_message_tombstones,
        public.softora_mailbox_campaign_lineage_roots,
        public.softora_mailbox_message_lineage_edges,
        public.softora_mailbox_campaign_lineage_members,
        public.softora_mailbox_campaign_lineage_discoveries
        to service_role;
      grant select,update on table public.softora_mailbox_lineage_test_metrics
        to service_role;
      revoke execute on function public.softora_preserve_mailbox_read_state()
        from public,anon,authenticated,service_role;
      grant execute on function public.softora_preserve_mailbox_read_state()
        to service_role;
    `);
    const securityBefore = await mailboxMessageSecuritySnapshot();
    const preserveSecurityBefore = (await functionSecuritySnapshot([
      'public.softora_preserve_mailbox_read_state()',
    ]))[0];

    await applyTrackedSql(client, duplicateStateConvergenceMigration);
    const repaired = (await client.query(`
      select folder,unread,softora_read_at,reply_dismissed_at,
        state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where account_email=$1
        and generation_superseded_at is null
        and deleted_at is null
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by folder
    `, [accountEmail, messageId])).rows;
    assert.equal(repaired.length, 2);
    assert.ok(repaired.every((row) => row.unread === false));
    assert.ok(repaired.every((row) => row.softora_read_at.toISOString() === canonicalReadAt));
    assert.ok(repaired.every((row) => row.reply_dismissed_at.toISOString() === canonicalReadAt));
    assert.ok(repaired.every((row) => Number(row.state_revision) === 10));
    assert.ok(repaired.every((row) => row.state_mutation_key === canonicalMutationKey));
    assert.ok(repaired.every((row) => row.state_mutation_at.toISOString() === canonicalMutationAt));
    const excludedRepairRows = (await client.query(`
      select message_key,deleted_at,generation_superseded_at,state_revision,
        state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where message_key=any($1::text[])
      order by message_key
    `, [[deleted.messageKeys[0], superseded.messageKeys[0]]])).rows;
    assert.equal(excludedRepairRows.length, 2);
    const deletedAfterRepair = excludedRepairRows.find((row) => (
      row.message_key === deleted.messageKeys[0]
    ));
    assert.ok(deletedAfterRepair.deleted_at);
    assert.equal(Number(deletedAfterRepair.state_revision), 100);
    assert.equal(deletedAfterRepair.state_mutation_key, '3'.repeat(64));
    assert.equal(
      deletedAfterRepair.state_mutation_at.toISOString(),
      '2026-08-26T07:49:00.000Z'
    );
    const supersededAfterRepair = excludedRepairRows.find((row) => (
      row.message_key === superseded.messageKeys[0]
    ));
    assert.ok(supersededAfterRepair.generation_superseded_at);
    assert.equal(Number(supersededAfterRepair.state_revision), 200);
    assert.equal(supersededAfterRepair.state_mutation_key, '4'.repeat(64));
    assert.equal(
      supersededAfterRepair.state_mutation_at.toISOString(),
      '2026-08-26T07:50:00.000Z'
    );

    const stableSnapshot = repaired.map((row) => ({
      ...row,
      softora_read_at: row.softora_read_at.toISOString(),
      reply_dismissed_at: row.reply_dismissed_at.toISOString(),
      state_mutation_at: row.state_mutation_at.toISOString(),
    }));
    const versionAfterFirstApply = (await client.query(`
      select content_version from public.softora_mailbox_campaign_consistency
      where scope='campaign'
    `)).rows[0].content_version;
    await applyTrackedSql(client, duplicateStateConvergenceMigration);
    const afterSecondApply = (await client.query(`
      select folder,unread,softora_read_at,reply_dismissed_at,
        state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where account_email=$1
        and generation_superseded_at is null
        and deleted_at is null
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by folder
    `, [accountEmail, messageId])).rows.map((row) => ({
      ...row,
      softora_read_at: row.softora_read_at.toISOString(),
      reply_dismissed_at: row.reply_dismissed_at.toISOString(),
      state_mutation_at: row.state_mutation_at.toISOString(),
    }));
    assert.deepEqual(afterSecondApply, stableSnapshot);
    assert.equal((await client.query(`
      select content_version from public.softora_mailbox_campaign_consistency
      where scope='campaign'
    `)).rows[0].content_version, versionAfterFirstApply);

    const triggerRows = (await client.query(`
      select trigger.tgname,trigger.tgenabled,
        pg_catalog.pg_get_triggerdef(trigger.oid) as definition
      from pg_catalog.pg_trigger as trigger
      where trigger.tgrelid='public.softora_mailbox_messages'::pg_catalog.regclass
        and not trigger.tgisinternal
        and trigger.tgname=any($1::text[])
      order by trigger.tgname
    `, [[
      'softora_mailbox_messages_inherit_duplicate_state',
      'softora_mailbox_messages_inherit_logical_tombstone',
      'softora_mailbox_messages_inherit_state_from_duplicate',
    ]])).rows;
    assert.deepEqual(triggerRows.map((row) => row.tgname), [
      'softora_mailbox_messages_inherit_logical_tombstone',
      'softora_mailbox_messages_inherit_state_from_duplicate',
    ]);
    assert.ok(triggerRows.every((row) => row.tgenabled === 'O'));
    assert.match(
      triggerRows[0].definition,
      /BEFORE INSERT OR UPDATE OF account_email, message_id, deleted_at ON public\.softora_mailbox_messages.*EXECUTE FUNCTION softora_inherit_mailbox_message_tombstone\(\)/i
    );
    assert.match(
      triggerRows[1].definition,
      /BEFORE INSERT ON public\.softora_mailbox_messages.*EXECUTE FUNCTION softora_inherit_mailbox_duplicate_state\(\)/i
    );

    const functionSecurity = await functionSecuritySnapshot([
      'public.softora_apply_mailbox_state_mutation_v2(text,text,bigint,text,text,text,text,bigint,boolean,boolean)',
      'public.softora_inherit_mailbox_duplicate_state()',
      'public.softora_preserve_mailbox_read_state()',
    ]);
    assert.equal(functionSecurity.length, 3);
    assert.ok(functionSecurity.every((row) => (
      !row.prosecdef
      && row.provolatile === 'v'
      && !row.anon_execute
      && !row.auth_execute
      && row.service_execute
      && Array.isArray(row.proconfig)
      && row.proconfig.some((setting) => /^search_path=(?:""|)$/.test(setting))
    )));
    const preserveSecurityAfter = functionSecurity.find((row) => (
      row.signature === 'public.softora_preserve_mailbox_read_state()'
    ));
    assert.deepEqual(preserveSecurityAfter, preserveSecurityBefore);
    assert.deepEqual(await mailboxMessageSecuritySnapshot(), securityBefore);

    const roleMutationSql = `
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,11,false,false
      )
    `;
    const roleMutationParams = [
      accountEmail, inbox.messageKeys[0], messageId, 'f'.repeat(64),
    ];
    const executeMutationAsRole = async (role) => {
      await client.query('begin');
      try {
        await client.query(`set local role ${role}`);
        return await client.query(roleMutationSql, roleMutationParams);
      } finally {
        await client.query('rollback');
      }
    };
    const serviceMutation = (await executeMutationAsRole('service_role')).rows[0];
    assert.equal(serviceMutation.applied, true);
    for (const browserRole of ['anon', 'authenticated']) {
      await assert.rejects(
        executeMutationAsRole(browserRole),
        /permission denied for function softora_apply_mailbox_state_mutation_v2/i
      );
    }

    const definitions = (await client.query(`
      select pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.softora_apply_mailbox_state_mutation_v2(text,text,bigint,text,text,text,text,bigint,boolean,boolean)'
      )) as state_definition,
      pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(
        'public.softora_inherit_mailbox_duplicate_state()'
      )) as trigger_definition
    `)).rows[0];
    assert.doesNotMatch(definitions.state_definition, /pg_advisory_xact_lock\(824031, 3\)/i);
    assert.doesNotMatch(definitions.trigger_definition, /824031|softora_mailbox_campaign_consistency/i);
  });

  test('late duplicates, group-supersession en gelijke revisions convergeren account-exact', async () => {
    const client = await connect();
    const setExactState = async ({
      messageKey,
      mutationKey,
      revision,
      unread,
      readAt = null,
      dismissedAt = null,
      mutationAt,
    }) => client.query(`
      update public.softora_mailbox_messages
      set unread=$2,
          softora_read_at=$3::timestamptz,
          reply_dismissed_at=$4::timestamptz,
          state_revision=$5,
          state_mutation_key=$6,
          state_mutation_at=$7::timestamptz,
          updated_at=$7::timestamptz
      where message_key=$1
    `, [
      messageKey, unread, readAt, dismissedAt, revision, mutationKey, mutationAt,
    ]);

    const lateAccount = 'duplicate-late@softora.nl';
    const lateMessageId = 'duplicate-late-shared@test.softora.nl';
    const lateInbox = await activateDuplicateStateFolder(client, {
      accountEmail: lateAccount,
      folder: 'inbox',
      prefix: 'duplicate-late-inbox',
      uidValidity: 9311,
      rows: [{ uid: 1, message_id: lateMessageId, unread: true }],
    });
    const lateApplied = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,101,false,true
      )
    `, [
      lateAccount, lateInbox.messageKeys[0], lateMessageId, '3'.repeat(64),
    ])).rows[0];
    assert.equal(lateApplied.applied, true);
    const lateReadAt = lateApplied.softora_read_at.toISOString();
    const lateDismissedAt = lateApplied.reply_dismissed_at.toISOString();

    const lateSent = await activateDuplicateStateFolder(client, {
      accountEmail: lateAccount,
      folder: 'sent',
      prefix: 'duplicate-late-sent',
      uidValidity: 9312,
      rows: [
        { uid: 1, message_id: ` <${lateMessageId.toUpperCase()}> `, unread: true },
        { uid: 2, message_id: 'duplicate-late-different@test.softora.nl', unread: true },
      ],
    });
    const otherAccount = 'duplicate-late-other@softora.nl';
    const otherSent = await activateDuplicateStateFolder(client, {
      accountEmail: otherAccount,
      folder: 'sent',
      prefix: 'duplicate-late-other-sent',
      uidValidity: 9313,
      rows: [{ uid: 1, message_id: lateMessageId, unread: true }],
    });
    const lateRows = (await client.query(`
      select message_key,account_email,folder,uid,message_id,unread,softora_read_at,
        reply_dismissed_at,state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where message_key=any($1::text[])
      order by account_email,folder,uid
    `, [[
      lateInbox.messageKeys[0],
      ...lateSent.messageKeys,
      otherSent.messageKeys[0],
    ]])).rows;
    const inheritedLate = lateRows.find((row) => (
      row.account_email === lateAccount && row.folder === 'sent' && Number(row.uid) === 1
    ));
    assert.equal(inheritedLate.unread, false);
    assert.equal(inheritedLate.softora_read_at.toISOString(), lateReadAt);
    assert.equal(inheritedLate.reply_dismissed_at.toISOString(), lateDismissedAt);
    assert.equal(Number(inheritedLate.state_revision), 101);
    assert.equal(inheritedLate.state_mutation_key, '3'.repeat(64));
    assert.ok(inheritedLate.state_mutation_at);
    const lateCanonicalMutationAt = inheritedLate.state_mutation_at.toISOString();
    const originalLate = lateRows.find((row) => row.message_key === lateInbox.messageKeys[0]);
    assert.equal(originalLate.state_mutation_at.toISOString(), lateCanonicalMutationAt);
    const differentMessage = lateRows.find((row) => (
      row.account_email === lateAccount && row.folder === 'sent' && Number(row.uid) === 2
    ));
    assert.equal(differentMessage.unread, true);
    assert.equal(differentMessage.softora_read_at, null);
    assert.equal(differentMessage.reply_dismissed_at, null);
    assert.equal(Number(differentMessage.state_revision), 0);
    assert.equal(differentMessage.state_mutation_key, null);
    const isolatedAccount = lateRows.find((row) => row.account_email === otherAccount);
    assert.equal(isolatedAccount.unread, true);
    assert.equal(isolatedAccount.softora_read_at, null);
    assert.equal(isolatedAccount.reply_dismissed_at, null);
    assert.equal(Number(isolatedAccount.state_revision), 0);
    assert.equal(isolatedAccount.state_mutation_key, null);

    const generationAccount = 'duplicate-next-generation@softora.nl';
    const generationMessageId = 'duplicate-next-generation@test.softora.nl';
    const generationFirst = await activateDuplicateStateFolder(client, {
      accountEmail: generationAccount,
      folder: 'inbox',
      prefix: 'duplicate-next-generation-first',
      uidValidity: 9314,
      rows: [{ uid: 1, message_id: generationMessageId, unread: true }],
    });
    const generationApplied = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,111,false,true
      )
    `, [
      generationAccount,
      generationFirst.messageKeys[0],
      generationMessageId,
      '0'.repeat(64),
    ])).rows[0];
    assert.equal(generationApplied.applied, true);
    const generationStateBefore = (await client.query(`
      select softora_read_at,reply_dismissed_at,state_mutation_at
      from public.softora_mailbox_messages where message_key=$1
    `, [generationFirst.messageKeys[0]])).rows[0];
    const nextGenerationToken = 'duplicate-next-generation-token';
    await lease(client, generationFirst.syncKey, nextGenerationToken);
    const nextGenerationPrepared = await prepare(
      client, generationFirst.syncKey, nextGenerationToken, 9315, 2
    );
    assert.equal(nextGenerationPrepared.mode, 'rebuild');
    const nextGenerationRow = messageRow(1, 'duplicate-next-generation-second', {
      account_email: generationAccount,
      folder: 'inbox',
      recipients_text: generationAccount,
      message_id: `<${generationMessageId.toUpperCase()}>`,
      unread: true,
    });
    const nextGenerationCommit = await commit(client, {
      syncKey: generationFirst.syncKey,
      token: nextGenerationToken,
      commitId: 'duplicate-next-generation-commit',
      generationId: nextGenerationPrepared.target_generation_id,
      uidValidity: 9315,
      rows: [nextGenerationRow],
      fromUid: 1,
      throughUid: 1,
      complete: true,
      messageCount: 1,
      lastUid: 1,
    });
    assert.equal(nextGenerationCommit.activated, true);
    const nextGenerationKey = (
      `${generationFirst.syncKey}|gen:${nextGenerationPrepared.target_generation_id}|1`
    );
    const nextGenerationState = (await client.query(`
      select unread,softora_read_at,reply_dismissed_at,state_revision,
        state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages where message_key=$1
    `, [nextGenerationKey])).rows[0];
    assert.equal(nextGenerationState.unread, false);
    assert.equal(
      nextGenerationState.softora_read_at.toISOString(),
      generationStateBefore.softora_read_at.toISOString()
    );
    assert.equal(
      nextGenerationState.reply_dismissed_at.toISOString(),
      generationStateBefore.reply_dismissed_at.toISOString()
    );
    assert.equal(Number(nextGenerationState.state_revision), 111);
    assert.equal(nextGenerationState.state_mutation_key, '0'.repeat(64));
    assert.equal(
      nextGenerationState.state_mutation_at.toISOString(),
      generationStateBefore.state_mutation_at.toISOString()
    );

    // A retired generation with an artificially newer state must never win
    // canonical selection over the exact active generation.
    await setExactState({
      messageKey: generationFirst.messageKeys[0],
      mutationKey: '1'.repeat(64),
      revision: 999,
      unread: true,
      mutationAt: '2026-08-26T07:59:59.000Z',
    });
    const activeAfterRetiredDrift = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,112,false,true
      )
    `, [
      generationAccount,
      nextGenerationKey,
      generationMessageId,
      '2'.repeat(64),
    ])).rows[0];
    assert.equal(activeAfterRetiredDrift.applied, true);
    assert.equal(Number(activeAfterRetiredDrift.current_revision), 112);

    const tombstoneAccount = 'duplicate-tombstone-late@softora.nl';
    const tombstoneMessageId = 'duplicate-tombstone-late@test.softora.nl';
    const tombstoneInbox = await activateDuplicateStateFolder(client, {
      accountEmail: tombstoneAccount,
      folder: 'inbox',
      prefix: 'duplicate-tombstone-late-inbox',
      uidValidity: 9316,
      rows: [{ uid: 1, message_id: tombstoneMessageId, unread: true }],
    });
    const tombstoneApplied = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,121,false,true
      )
    `, [
      tombstoneAccount,
      tombstoneInbox.messageKeys[0],
      tombstoneMessageId,
      '3'.repeat(64),
    ])).rows[0];
    assert.equal(tombstoneApplied.applied, true);
    const hiddenRows = (await client.query(`
      select * from public.softora_set_mailbox_message_visibility(
        $1,'inbox',1,$2,true
      )
    `, [tombstoneAccount, tombstoneInbox.rows[0].provider_id])).rows;
    assert.equal(hiddenRows.length, 1);
    const tombstoneSent = await activateDuplicateStateFolder(client, {
      accountEmail: tombstoneAccount,
      folder: 'sent',
      prefix: 'duplicate-tombstone-late-sent',
      uidValidity: 9317,
      rows: [{
        uid: 1,
        message_id: ` <${tombstoneMessageId.toUpperCase()}> `,
        unread: true,
      }],
    });
    const hiddenLateCopy = (await client.query(`
      select deleted_at,unread,softora_read_at,reply_dismissed_at,
        state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages where message_key=$1
    `, [tombstoneSent.messageKeys[0]])).rows[0];
    assert.ok(hiddenLateCopy.deleted_at);
    assert.equal(hiddenLateCopy.unread, true);
    assert.equal(hiddenLateCopy.softora_read_at, null);
    assert.equal(hiddenLateCopy.reply_dismissed_at, null);
    assert.equal(Number(hiddenLateCopy.state_revision), 0);
    assert.equal(hiddenLateCopy.state_mutation_key, null);
    assert.equal(hiddenLateCopy.state_mutation_at, null);

    const supersessionAccount = 'duplicate-supersession@softora.nl';
    const supersessionMessageId = 'duplicate-supersession-shared@test.softora.nl';
    const supersessionInbox = await activateDuplicateStateFolder(client, {
      accountEmail: supersessionAccount,
      folder: 'inbox',
      prefix: 'duplicate-supersession-inbox',
      uidValidity: 9321,
      rows: [{ uid: 1, message_id: supersessionMessageId, unread: true }],
    });
    const supersessionSent = await activateDuplicateStateFolder(client, {
      accountEmail: supersessionAccount,
      folder: 'sent',
      prefix: 'duplicate-supersession-sent',
      uidValidity: 9322,
      rows: [{ uid: 1, message_id: supersessionMessageId, unread: true }],
    });
    await setExactState({
      messageKey: supersessionInbox.messageKeys[0],
      mutationKey: '4'.repeat(64),
      revision: 5,
      unread: true,
      mutationAt: '2026-08-26T08:00:05.000Z',
    });
    const supersessionReadAt = '2026-08-26T08:00:10.000Z';
    await setExactState({
      messageKey: supersessionSent.messageKeys[0],
      mutationKey: '5'.repeat(64),
      revision: 10,
      unread: false,
      readAt: supersessionReadAt,
      dismissedAt: supersessionReadAt,
      mutationAt: '2026-08-26T08:00:11.000Z',
    });
    const superseded = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,7,true,false
      )
    `, [
      supersessionAccount,
      supersessionInbox.messageKeys[0],
      supersessionMessageId,
      '6'.repeat(64),
    ])).rows[0];
    assert.equal(superseded.applied, false);
    assert.equal(superseded.superseded, true);
    assert.equal(Number(superseded.current_revision), 10);
    assert.equal(superseded.current_mutation_key, '5'.repeat(64));
    const supersessionRows = (await client.query(`
      select folder,unread,softora_read_at,reply_dismissed_at,
        state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where account_email=$1 and generation_superseded_at is null
        and deleted_at is null
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by folder
    `, [supersessionAccount, supersessionMessageId])).rows;
    assert.equal(supersessionRows.length, 2);
    assert.ok(supersessionRows.every((row) => row.unread === false));
    assert.ok(supersessionRows.every((row) => row.softora_read_at.toISOString() === supersessionReadAt));
    assert.ok(supersessionRows.every((row) => row.reply_dismissed_at.toISOString() === supersessionReadAt));
    assert.ok(supersessionRows.every((row) => Number(row.state_revision) === 10));
    assert.ok(supersessionRows.every((row) => row.state_mutation_key === '5'.repeat(64)));
    assert.ok(supersessionRows.every((row) => (
      row.state_mutation_at.toISOString() === '2026-08-26T08:00:11.000Z'
    )));

    const equalReadAccount = 'duplicate-equal-read@softora.nl';
    const equalReadMessageId = 'duplicate-equal-read@test.softora.nl';
    const equalReadInbox = await activateDuplicateStateFolder(client, {
      accountEmail: equalReadAccount,
      folder: 'inbox',
      prefix: 'duplicate-equal-read-inbox',
      uidValidity: 9331,
      rows: [{ uid: 1, message_id: equalReadMessageId, unread: true }],
    });
    const equalReadSent = await activateDuplicateStateFolder(client, {
      accountEmail: equalReadAccount,
      folder: 'sent',
      prefix: 'duplicate-equal-read-sent',
      uidValidity: 9332,
      rows: [{ uid: 1, message_id: equalReadMessageId, unread: true }],
    });
    const equalReadAt = '2026-08-26T08:10:00.000Z';
    await setExactState({
      messageKey: equalReadInbox.messageKeys[0],
      mutationKey: '7'.repeat(64),
      revision: 20,
      unread: false,
      readAt: equalReadAt,
      mutationAt: '2026-08-26T08:10:03.000Z',
    });
    await setExactState({
      messageKey: equalReadSent.messageKeys[0],
      mutationKey: '8'.repeat(64),
      revision: 20,
      unread: true,
      mutationAt: '2026-08-26T08:10:02.000Z',
    });
    const equalReadReplay = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,20,false,false
      )
    `, [
      equalReadAccount,
      equalReadInbox.messageKeys[0],
      equalReadMessageId,
      '7'.repeat(64),
    ])).rows[0];
    assert.equal(equalReadReplay.replayed, true);
    const equalReadRows = (await client.query(`
      select unread,softora_read_at,state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where account_email=$1 and generation_superseded_at is null
        and deleted_at is null
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by folder
    `, [equalReadAccount, equalReadMessageId])).rows;
    assert.ok(equalReadRows.every((row) => row.unread === false));
    assert.ok(equalReadRows.every((row) => row.softora_read_at.toISOString() === equalReadAt));
    assert.ok(equalReadRows.every((row) => Number(row.state_revision) === 20));
    assert.ok(equalReadRows.every((row) => row.state_mutation_key === '7'.repeat(64)));
    assert.ok(equalReadRows.every((row) => (
      row.state_mutation_at.toISOString() === '2026-08-26T08:10:03.000Z'
    )));

    const equalUnreadAccount = 'duplicate-equal-unread@softora.nl';
    const equalUnreadMessageId = 'duplicate-equal-unread@test.softora.nl';
    const equalUnreadInbox = await activateDuplicateStateFolder(client, {
      accountEmail: equalUnreadAccount,
      folder: 'inbox',
      prefix: 'duplicate-equal-unread-inbox',
      uidValidity: 9341,
      rows: [{ uid: 1, message_id: equalUnreadMessageId, unread: true }],
    });
    const equalUnreadSent = await activateDuplicateStateFolder(client, {
      accountEmail: equalUnreadAccount,
      folder: 'sent',
      prefix: 'duplicate-equal-unread-sent',
      uidValidity: 9342,
      rows: [{ uid: 1, message_id: equalUnreadMessageId, unread: true }],
    });
    const equalUnreadDismissedAt = '2026-08-26T08:20:00.000Z';
    await setExactState({
      messageKey: equalUnreadInbox.messageKeys[0],
      mutationKey: '9'.repeat(64),
      revision: 30,
      unread: true,
      dismissedAt: equalUnreadDismissedAt,
      mutationAt: '2026-08-26T08:20:02.000Z',
    });
    await setExactState({
      messageKey: equalUnreadSent.messageKeys[0],
      mutationKey: 'a'.repeat(64),
      revision: 30,
      unread: false,
      readAt: '2026-08-26T08:20:01.000Z',
      mutationAt: '2026-08-26T08:20:01.000Z',
    });
    const equalUnreadReplay = (await client.query(`
      select * from public.softora_apply_mailbox_state_mutation_v2(
        $1,'inbox',1,'',$2,$3,$4,30,true,true
      )
    `, [
      equalUnreadAccount,
      equalUnreadInbox.messageKeys[0],
      equalUnreadMessageId,
      '9'.repeat(64),
    ])).rows[0];
    assert.equal(equalUnreadReplay.replayed, true);
    const equalUnreadRows = (await client.query(`
      select unread,softora_read_at,reply_dismissed_at,
        state_revision,state_mutation_key,state_mutation_at
      from public.softora_mailbox_messages
      where account_email=$1 and generation_superseded_at is null
        and deleted_at is null
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by folder
    `, [equalUnreadAccount, equalUnreadMessageId])).rows;
    assert.ok(equalUnreadRows.every((row) => row.unread === true));
    assert.ok(equalUnreadRows.every((row) => row.softora_read_at === null));
    assert.ok(equalUnreadRows.every((row) => (
      row.reply_dismissed_at.toISOString() === equalUnreadDismissedAt
    )));
    assert.ok(equalUnreadRows.every((row) => Number(row.state_revision) === 30));
    assert.ok(equalUnreadRows.every((row) => row.state_mutation_key === '9'.repeat(64)));
    assert.ok(equalUnreadRows.every((row) => (
      row.state_mutation_at.toISOString() === '2026-08-26T08:20:02.000Z'
    )));
  });

  test('duplicate-state locking blokkeert alleen dezelfde folder of exacte RFC-identiteit', async () => {
    const observerClient = await connect();
    const globalBlocker = await connect();
    const globalMutationClient = await connect();
    const globalAccount = 'duplicate-global-independent@softora.nl';
    const globalMessageId = 'duplicate-global-independent@test.softora.nl';
    const globalFixture = await activateDuplicateStateFolder(globalMutationClient, {
      accountEmail: globalAccount,
      folder: 'inbox',
      prefix: 'duplicate-global-independent',
      uidValidity: 9351,
      rows: [{ uid: 1, message_id: globalMessageId, unread: true }],
    });
    await globalMutationClient.query("set lock_timeout='900ms'");
    await globalBlocker.query('begin');
    try {
      await globalBlocker.query('select pg_catalog.pg_advisory_xact_lock(824031,3)');
      const result = (await globalMutationClient.query(`
        select * from public.softora_apply_mailbox_state_mutation_v2(
          $1,'inbox',1,'',$2,$3,$4,1,false,false
        )
      `, [
        globalAccount,
        globalFixture.messageKeys[0],
        globalMessageId,
        'b'.repeat(64),
      ])).rows[0];
      assert.equal(result.applied, true);
    } finally {
      await globalBlocker.query('rollback');
    }

    const sameFolderBlocker = await connect();
    const sameFolderMutationClient = await connect();
    const sameFolderAccount = 'duplicate-same-folder-lock@softora.nl';
    const sameFolderMessageId = 'duplicate-same-folder-lock@test.softora.nl';
    const sameFolderFixture = await activateDuplicateStateFolder(sameFolderMutationClient, {
      accountEmail: sameFolderAccount,
      folder: 'inbox',
      prefix: 'duplicate-same-folder-lock',
      uidValidity: 9352,
      rows: [{ uid: 1, message_id: sameFolderMessageId, unread: true }],
    });
    const sameFolderPid = (await sameFolderMutationClient.query(
      'select pg_catalog.pg_backend_pid() as pid'
    )).rows[0].pid;
    let sameFolderMutationPromise;
    await sameFolderBlocker.query('begin');
    try {
      await sameFolderBlocker.query(
        'select public.softora_lock_mailbox_sync_key_v2($1)',
        [sameFolderFixture.syncKey]
      );
      sameFolderMutationPromise = sameFolderMutationClient.query(`
        select * from public.softora_apply_mailbox_state_mutation_v2(
          $1,'inbox',1,'',$2,$3,$4,1,false,true
        )
      `, [
        sameFolderAccount,
        sameFolderFixture.messageKeys[0],
        sameFolderMessageId,
        'c'.repeat(64),
      ]);
      const wait = await waitForBackendWait(
        observerClient, sameFolderPid, 'advisory'
      );
      assert.ok(wait, 'de state-wrapper omzeilde de per-folder sync-key lock');
      await sameFolderBlocker.query('commit');
      const result = (await sameFolderMutationPromise).rows[0];
      assert.equal(result.applied, true);
    } finally {
      if (sameFolderBlocker) await sameFolderBlocker.query('rollback').catch(() => null);
      await Promise.allSettled([sameFolderMutationPromise].filter(Boolean));
    }

    const syncClient = await connect();
    const stateClient = await connect();
    const parallelClient = await connect();
    const barrierClient = await connect();
    await parallelClient.query("set lock_timeout='900ms'");
    const raceAccount = 'duplicate-cross-folder-race@softora.nl';
    const raceMessageId = 'duplicate-cross-folder-race@test.softora.nl';
    const raceInbox = await activateDuplicateStateFolder(stateClient, {
      accountEmail: raceAccount,
      folder: 'inbox',
      prefix: 'duplicate-cross-folder-race-inbox',
      uidValidity: 9361,
      rows: [{ uid: 1, message_id: raceMessageId, unread: true }],
    });
    const parallelMessageId = 'duplicate-parallel-folder@test.softora.nl';
    const parallelFixture = await activateDuplicateStateFolder(parallelClient, {
      accountEmail: raceAccount,
      folder: 'coldmail',
      prefix: 'duplicate-parallel-folder',
      uidValidity: 9362,
      rows: [{ uid: 1, message_id: parallelMessageId, unread: true }],
    });
    const raceSentSyncKey = `${raceAccount}|sent`;
    await syncClient.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,'sent','idle',0,0,null)
    `, [raceSentSyncKey, raceAccount]);
    await lease(syncClient, raceSentSyncKey, 'duplicate-cross-folder-race-sent-token');
    const raceSentPrepared = await prepare(
      syncClient,
      raceSentSyncKey,
      'duplicate-cross-folder-race-sent-token',
      9363,
      2
    );
    const syncPid = (await syncClient.query(
      'select pg_catalog.pg_backend_pid() as pid'
    )).rows[0].pid;
    const statePid = (await stateClient.query(
      'select pg_catalog.pg_backend_pid() as pid'
    )).rows[0].pid;
    let syncPromise;
    let statePromise;
    let barrierOpen = false;
    try {
      await barrierClient.query('begin');
      barrierOpen = true;
      await barrierClient.query(
        'select pg_catalog.pg_advisory_xact_lock(824099,7)'
      );
      await observerClient.query(`
        create or replace function public.test_pause_after_duplicate_state_lock()
        returns trigger language plpgsql volatile security invoker set search_path=''
        as $function$
        begin
          if new.account_email='duplicate-cross-folder-race@softora.nl'
            and new.folder='sent' then
            perform pg_catalog.pg_advisory_xact_lock(824099,7);
          end if;
          return new;
        end;
        $function$;
        create trigger zz_test_pause_after_duplicate_state_lock
        before insert on public.softora_mailbox_messages
        for each row execute function public.test_pause_after_duplicate_state_lock();
      `);
      syncPromise = commit(syncClient, {
        syncKey: raceSentSyncKey,
        token: 'duplicate-cross-folder-race-sent-token',
        commitId: 'duplicate-cross-folder-race-sent-commit',
        generationId: raceSentPrepared.target_generation_id,
        uidValidity: 9363,
        rows: [messageRow(1, 'duplicate-cross-folder-race-sent', {
          account_email: raceAccount,
          folder: 'sent',
          recipients_text: raceAccount,
          message_id: raceMessageId,
          unread: true,
        })],
        fromUid: 1,
        throughUid: 1,
        complete: true,
        messageCount: 1,
        lastUid: 1,
      });
      const syncPaused = await waitForBackendWait(
        observerClient, syncPid, 'advisory'
      );
      assert.ok(syncPaused, 'cross-folder sync bereikte de testtrigger niet');

      const parallelOutcome = (await parallelClient.query(`
        select * from public.softora_apply_mailbox_state_mutation_v2(
          $1,'coldmail',1,'',$2,$3,$4,1,false,false
        )
      `, [
        raceAccount,
        parallelFixture.messageKeys[0],
        parallelMessageId,
        'd'.repeat(64),
      ])).rows[0];
      assert.equal(
        parallelOutcome?.applied,
        true,
        'een andere folder/Message-ID binnen hetzelfde account werd onnodig geserialiseerd'
      );

      statePromise = stateClient.query(`
        select * from public.softora_apply_mailbox_state_mutation_v2(
          $1,'inbox',1,'',$2,$3,$4,77,false,true
        )
      `, [
        raceAccount,
        raceInbox.messageKeys[0],
        raceMessageId,
        'e'.repeat(64),
      ]);
      const logicalWait = await waitForBackendWait(
        observerClient, statePid, 'advisory'
      );
      assert.ok(
        logicalWait,
        'Inbox-state omzeilde de exacte account+Message-ID lock van de Sent-sync'
      );
      await barrierClient.query('commit');
      barrierOpen = false;
      const [syncResult, stateResult] = await Promise.all([
        syncPromise,
        statePromise.then((result) => result.rows[0]),
      ]);
      assert.equal(syncResult.activated, true);
      assert.equal(stateResult.applied, true);
      const raceRows = (await observerClient.query(`
        select folder,unread,softora_read_at,reply_dismissed_at,
          state_revision,state_mutation_key,state_mutation_at
        from public.softora_mailbox_messages
        where account_email=$1 and generation_superseded_at is null
          and deleted_at is null
          and public.softora_normalize_mailbox_message_id(message_id)=$2
        order by folder
      `, [raceAccount, raceMessageId])).rows;
      assert.equal(raceRows.length, 2);
      assert.ok(raceRows.every((row) => row.unread === false));
      assert.ok(raceRows.every((row) => row.softora_read_at));
      assert.ok(raceRows.every((row) => row.reply_dismissed_at));
      assert.ok(raceRows.every((row) => Number(row.state_revision) === 77));
      assert.ok(raceRows.every((row) => row.state_mutation_key === 'e'.repeat(64)));
      assert.ok(raceRows.every((row) => row.state_mutation_at));
      assert.equal(new Set(raceRows.map((row) => (
        row.state_mutation_at.toISOString()
      ))).size, 1);
    } finally {
      if (barrierOpen) await barrierClient.query('rollback').catch(() => null);
      await Promise.allSettled([syncPromise, statePromise].filter(Boolean));
      await observerClient.query(`
        drop trigger if exists zz_test_pause_after_duplicate_state_lock
          on public.softora_mailbox_messages;
        drop function if exists public.test_pause_after_duplicate_state_lock();
      `);
    }
  });

// mailbox-final-activation-scale-regression:start
  test('800 Sent-rijen finaliseren met echte resolver, state-erfenis, outbound guards en timeoutreplay', async (t) => {
    const client = await connect();
    const scaleMigration = fs.readFileSync(path.resolve(
      __dirname,
      '../../supabase/migrations/20260825001646_scale_mailbox_final_activation.sql'
    ), 'utf8');
    const lineageResolverMigration = fs.readFileSync(path.resolve(
      __dirname,
      '../../supabase/migrations/20260817132639_deduplicate_mailbox_lineage_resolver_results.sql'
    ), 'utf8');
    const outboundGuardLedgerMigration = fs.readFileSync(path.resolve(
      __dirname,
      '../../supabase/migrations/20260818142317_mailbox_outbound_guard_ledger.sql'
    ), 'utf8');

    function sentSnapshotRows({
      accountEmail,
      count,
      messageNamespace,
      providerNamespace,
      recipientDomain,
      updatedAt,
    }) {
      const rootMessageId = `${messageNamespace}-1@test.softora.nl`;
      return Array.from({ length: count }, (_, index) => {
        const uid = index + 1;
        const recipient = `recipient-${uid}@${recipientDomain}`;
        return messageRow(uid, `${providerNamespace}-${uid}`, {
          account_email: accountEmail,
          folder: 'sent',
          message_id: `${messageNamespace}-${uid}@test.softora.nl`,
          in_reply_to: uid === 1 ? null : rootMessageId,
          references_text: uid === 1 ? null : `<${rootMessageId}>`,
          sender_name: 'Softora',
          sender_email: accountEmail,
          recipients_text: recipient,
          subject: uid === 1
            ? 'Kleine vraag over jullie website'
            : 'Re: Kleine vraag over jullie website',
          unread: true,
          starred: false,
          payload: {
            source: 'imap-sync',
            direction: 'sent',
            originalCampaignOutbound: true,
            toDisplay: recipient,
          },
          updated_at: updatedAt,
        });
      });
    }

    async function resolverCallCount() {
      return Number((await client.query(`
        select call_count from public.softora_mailbox_lineage_test_metrics
        where operation='resolver'
      `)).rows[0].call_count);
    }

    async function resetResolverCallCount() {
      await client.query(`
        update public.softora_mailbox_lineage_test_metrics
        set call_count=0 where operation='resolver'
      `);
    }

    async function finalizationSnapshot({
      syncKey,
      generationId,
      commitId,
      recipientEmail,
    }) {
      return (await client.query(`
        select
          state.active_uid_generation_id::text as active_generation_id,
          state.pending_uid_generation_id::text as pending_generation_id,
          state.status,
          state.lock_token,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_messages as message
            where message.uid_generation_id=$2::uuid) as generation_rows,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_uid_generation_commits as mutation
            where mutation.commit_id=$3) as commit_rows,
          (select pg_catalog.count(*)::integer
            from public.softora_outbound_recipient_guards as outbound_guard
            where outbound_guard.key_type='email'
              and outbound_guard.key_value=$4) as recipient_guards,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_campaign_lineage_roots as root
            where root.account_email=state.account_email) as roots,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_message_lineage_edges as edge
            where edge.account_email=state.account_email) as edges,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_campaign_lineage_members as member
            where member.account_email=state.account_email) as members,
          (select pg_catalog.count(*)::integer
            from public.softora_mailbox_campaign_lineage_discoveries as discovery
            where discovery.account_email=state.account_email
              and discovery.active) as active_discoveries
        from public.softora_mailbox_sync_state as state
        where state.sync_key=$1
      `, [syncKey, generationId, commitId, recipientEmail])).rows[0];
    }

    // The historical resolver migration contains the production SQL, while
    // the original compact fixture used an inlined approximation. Supply its
    // real dependencies and table shape before wrapping the resolver solely to
    // count actual calls made by the production rebuild path.
    await client.query(`
      alter table public.softora_mailbox_campaign_lineage_discoveries
        add column if not exists last_confirmed_at timestamptz
          not null default pg_catalog.clock_timestamp();
      create unique index if not exists
        softora_mailbox_campaign_lineage_discoveries_message_root_idx
        on public.softora_mailbox_campaign_lineage_discoveries(
          message_key,root_message_key
        );
      alter table public.softora_mailbox_campaign_lineage_members
        add column if not exists message_date timestamptz,
        add column if not exists is_incoming boolean not null default false,
        add column if not exists is_proven_automated boolean not null default false,
        add column if not exists lineage_discovered_at timestamptz,
        add column if not exists updated_at timestamptz
          not null default pg_catalog.clock_timestamp();

      create table public.softora_outbound_recipient_guards (
        guard_key text primary key,
        key_type text not null,
        key_value text not null,
        reservation_id text,
        provider text,
        channel text,
        sender_email text,
        recipient_email text,
        recipient_domain text,
        recipient_company_key text,
        recipient_id text,
        recipient_company text,
        status text not null default 'reserved',
        source text not null default 'unknown',
        actor text,
        permanent boolean not null default false,
        payload jsonb not null default '{}'::jsonb,
        expires_at timestamptz,
        last_seen_at timestamptz not null default pg_catalog.clock_timestamp(),
        created_at timestamptz not null default pg_catalog.clock_timestamp(),
        updated_at timestamptz not null default pg_catalog.clock_timestamp()
      );
      create unique index softora_outbound_recipient_guards_key_idx
        on public.softora_outbound_recipient_guards(key_type,key_value);
      alter table public.softora_outbound_recipient_guards enable row level security;
      revoke all on table public.softora_outbound_recipient_guards
        from public,anon,authenticated;
      grant select,insert,update,delete
        on public.softora_outbound_recipient_guards to service_role;

      create or replace function public.softora_is_mailbox_campaign_root(
        p_folder text,p_subject text,p_in_reply_to text,
        p_references_text text,p_payload jsonb
      ) returns boolean
      language sql immutable security invoker set search_path=''
      as $function$
        select (
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder,'')))='sent'
          or (
            pg_catalog.lower(pg_catalog.btrim(coalesce(p_folder,'')))='instantly'
            and pg_catalog.lower(pg_catalog.btrim(coalesce(
              coalesce(p_payload,'{}'::jsonb)->>'direction',''
            )))='sent'
          )
        ) and (
          pg_catalog.lower(pg_catalog.btrim(coalesce(
            coalesce(p_payload,'{}'::jsonb)->>'originalCampaignOutbound',''
          )))='true'
          or (
            nullif(pg_catalog.btrim(coalesce(p_in_reply_to,'')),'') is null
            and nullif(pg_catalog.btrim(coalesce(p_references_text,'')),'') is null
            and pg_catalog.regexp_replace(
              pg_catalog.lower(pg_catalog.btrim(coalesce(p_subject,''))),
              '^\\s*((re|fw|fwd)\\s*:\\s*)+','','i'
            ) in ('kleine vraag over jullie website','nieuw webdesign')
          )
        );
      $function$;

      create or replace function public.softora_is_mailbox_incoming_message(
        p_account_email text,p_folder text,p_sender_email text,
        p_recipients_text text,p_payload jsonb
      ) returns boolean
      language sql immutable security invoker set search_path=''
      as $function$
        select pg_catalog.lower(pg_catalog.btrim(coalesce(p_sender_email,'')))
          is distinct from
          pg_catalog.lower(pg_catalog.btrim(coalesce(p_account_email,'')));
      $function$;

      create or replace function public.softora_has_proven_automated_reply(
        p_payload jsonb
      ) returns boolean
      language sql immutable security invoker set search_path=''
      as $function$
        select pg_catalog.lower(pg_catalog.btrim(coalesce(
          coalesce(p_payload,'{}'::jsonb)->>'automatedReplyEvidence',''
        )))='true';
      $function$;

      create or replace function public.softora_canonical_mailbox_message_key(
        p_account_email text,p_message_id text
      ) returns text
      language sql stable security invoker set search_path=''
      as $function$
        with candidates as (
          select
            messages.message_key,
            pg_catalog.jsonb_build_array(
              pg_catalog.lower(pg_catalog.btrim(coalesce(messages.sender_email,''))),
              pg_catalog.lower(pg_catalog.btrim(coalesce(messages.recipients_text,''))),
              pg_catalog.lower(pg_catalog.btrim(coalesce(messages.subject,''))),
              public.softora_normalize_mailbox_message_id(messages.in_reply_to),
              pg_catalog.lower(pg_catalog.btrim(coalesce(messages.references_text,'')))
            )::text as envelope_signature,
            messages.date as message_date,
            case
              when public.softora_is_mailbox_campaign_root(
                messages.folder,messages.subject,messages.in_reply_to,
                messages.references_text,messages.payload
              ) then 0
              when pg_catalog.lower(pg_catalog.btrim(messages.folder))='sent' then 1
              when pg_catalog.lower(pg_catalog.btrim(messages.folder))='instantly'
                and pg_catalog.lower(pg_catalog.btrim(coalesce(
                  messages.payload->>'direction',''
                )))='sent' then 1
              when pg_catalog.lower(pg_catalog.btrim(messages.folder))='coldmail' then 2
              else 3
            end as source_priority,
            case
              when messages.has_body and not messages.body_truncated then 0
              when messages.has_body then 1
              else 2
            end as body_priority
          from public.softora_mailbox_messages as messages
          where messages.account_email=pg_catalog.lower(pg_catalog.btrim(
              coalesce(p_account_email,'')
            ))
            and messages.deleted_at is null
            and public.softora_normalize_mailbox_message_id(messages.message_id)
              =public.softora_normalize_mailbox_message_id(p_message_id)
        ), resolved as (
          select
            pg_catalog.count(distinct candidates.envelope_signature)
              as signature_count,
            pg_catalog.min(candidates.message_date) as earliest_message_date,
            pg_catalog.max(candidates.message_date) as latest_message_date,
            (pg_catalog.array_agg(
              candidates.message_key order by candidates.source_priority,
              candidates.body_priority,candidates.message_key
            ))[1] as canonical_message_key
          from candidates
        )
        select case
          when resolved.signature_count=1
            and resolved.latest_message_date-resolved.earliest_message_date
              <=interval '1 minute'
            then resolved.canonical_message_key
          else null
        end
        from resolved;
      $function$;
    `);
    await applyTrackedSql(client, lineageResolverMigration);
    await client.query(`
      alter function public.softora_resolve_mailbox_campaign_lineage(text,text[])
        rename to softora_resolve_mailbox_campaign_lineage_impl;
      insert into public.softora_mailbox_lineage_test_metrics(operation,call_count)
      values('resolver',0) on conflict(operation) do update set call_count=0;
      create or replace function public.softora_resolve_mailbox_campaign_lineage(
        p_account_email text,p_start_keys text[]
      ) returns table(
        message_key text,account_email text,message_id text,
        parent_message_key text,root_message_key text,root_message_id text,
        lineage_depth integer
      ) language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        update public.softora_mailbox_lineage_test_metrics
        set call_count=call_count+1 where operation='resolver';
        return query
        select resolved.message_key,resolved.account_email,resolved.message_id,
          resolved.parent_message_key,resolved.root_message_key,
          resolved.root_message_id,resolved.lineage_depth
        from public.softora_resolve_mailbox_campaign_lineage_impl(
          p_account_email,p_start_keys
        ) as resolved;
      end;
      $function$;

      drop function public.softora_rebuild_mailbox_campaign_lineage(
        text,text[],boolean,jsonb
      );
      create or replace function public.softora_rebuild_mailbox_campaign_lineage(
        p_account_email text,p_start_keys text[],
        p_backfill boolean default false,
        p_previous_roots jsonb default '{}'::jsonb
      ) returns void
      language plpgsql volatile security invoker set search_path=''
      as $function$
      begin
        insert into public.softora_mailbox_campaign_lineage_discoveries (
          message_key,root_message_key,account_email,
          first_discovered_at,last_confirmed_at
        )
        select
          resolved.message_key,resolved.root_message_key,resolved.account_email,
          case when p_backfill then coalesce(
            messages.created_at,pg_catalog.clock_timestamp()
          ) else pg_catalog.clock_timestamp() end,
          pg_catalog.clock_timestamp()
        from public.softora_resolve_mailbox_campaign_lineage(
          p_account_email,p_start_keys
        ) as resolved
        join public.softora_mailbox_messages as messages
          on messages.message_key=resolved.message_key
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
          last_disconnected_at = null;

        insert into public.softora_mailbox_campaign_lineage_members (
          message_key,account_email,message_id,parent_message_key,
          root_message_key,root_message_id,lineage_depth,message_date,
          is_incoming,is_proven_automated,lineage_discovered_at,
          created_at,updated_at
        )
        select
          resolved.message_key,resolved.account_email,resolved.message_id,
          resolved.parent_message_key,resolved.root_message_key,
          resolved.root_message_id,resolved.lineage_depth,messages.date,
          public.softora_is_mailbox_incoming_message(
            messages.account_email,messages.folder,messages.sender_email,
            messages.recipients_text,messages.payload
          ),
          public.softora_has_proven_automated_reply(messages.payload),
          discoveries.first_discovered_at,pg_catalog.clock_timestamp(),
          pg_catalog.clock_timestamp()
        from public.softora_resolve_mailbox_campaign_lineage(
          p_account_email,p_start_keys
        ) as resolved
        join public.softora_mailbox_campaign_lineage_discoveries as discoveries
          on discoveries.message_key=resolved.message_key
          and discoveries.root_message_key=resolved.root_message_key
        join public.softora_mailbox_messages as messages
          on messages.message_key=resolved.message_key
        on conflict (message_key) do update set
          account_email=excluded.account_email,message_id=excluded.message_id,
          parent_message_key=excluded.parent_message_key,
          root_message_key=excluded.root_message_key,
          root_message_id=excluded.root_message_id,
          lineage_depth=excluded.lineage_depth,
          message_date=excluded.message_date,is_incoming=excluded.is_incoming,
          is_proven_automated=excluded.is_proven_automated,
          lineage_discovered_at=excluded.lineage_discovered_at,
          updated_at=excluded.updated_at;
      end;
      $function$;
    `);

    await applyTrackedSql(client, outboundGuardLedgerMigration);
    const outboundTriggerDefinitionBefore = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_sync_mailbox_outbound_recipient_guards()'
          ::pg_catalog.regprocedure
      ) as definition
    `)).rows[0].definition;
    await client.query(`
      create index softora_mailbox_message_id_exact_lookup_idx
      on public.softora_mailbox_messages (
        account_email,
        public.softora_normalize_mailbox_message_id(message_id)
      )
      where deleted_at is null
    `);
    await assert.rejects(
      applyTrackedSql(client, scaleMigration),
      /MAILBOX_FINAL_ACTIVATION_SCALE_CANONICAL_INDEX_DRIFT/
    );
    await client.query(`
      drop index public.softora_mailbox_message_id_exact_lookup_idx
    `);
    await client.query(`
      create index softora_mailbox_message_id_exact_lookup_idx
      on public.softora_mailbox_messages (
        account_email,
        public.softora_normalize_mailbox_message_id(message_id)
      )
      where deleted_at is null
        and nullif(pg_catalog.btrim(message_id), '') is not null
    `);
    assert.match((await client.query(`
      select pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
        'public.softora_mailbox_message_id_exact_lookup_idx'
      )) as definition
    `)).rows[0].definition, /nullif\(btrim\(message_id\)/i);
    await applyTrackedSql(client, scaleMigration);
    const outboundTriggerDefinitionAfter = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_sync_mailbox_outbound_recipient_guards()'
          ::pg_catalog.regprocedure
      ) as definition
    `)).rows[0].definition;
    assert.equal(outboundTriggerDefinitionAfter, outboundTriggerDefinitionBefore);
    assert.match(outboundTriggerDefinitionAfter, /softora_record_mailbox_outbound_recipient_guards/);
    assert.deepEqual((await client.query(`
      select tgname,tgenabled
      from pg_catalog.pg_trigger
      where tgrelid='public.softora_mailbox_messages'::pg_catalog.regclass
        and tgname='softora_sync_mailbox_outbound_recipient_guards'
        and not tgisinternal
    `)).rows[0], {
      tgname: 'softora_sync_mailbox_outbound_recipient_guards',
      tgenabled: 'O',
    });

    const canonicalIndexDefinition = (await client.query(`
      select pg_catalog.pg_get_indexdef(pg_catalog.to_regclass(
        'public.softora_mailbox_message_id_exact_lookup_idx'
      )) as definition
    `)).rows[0].definition;
    assert.match(
      canonicalIndexDefinition,
      /\(account_email, softora_normalize_mailbox_message_id\(message_id\)\)/i
    );
    assert.match(
      canonicalIndexDefinition,
      /deleted_at is null[\s\S]*softora_normalize_mailbox_message_id\(message_id\) is not null/i
    );
    assert.doesNotMatch(canonicalIndexDefinition, /nullif\(btrim\(message_id\)/i);

    const finalizerDefinition = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_commit_mailbox_sync_pass_v2(text,text,text,uuid,bigint,text,jsonb,jsonb,jsonb,bigint,bigint,boolean,integer,bigint)'
          ::pg_catalog.regprocedure
      ) as definition
    `)).rows[0].definition;
    assert.match(finalizerDefinition, /prior_state as materialized/i);
    assert.doesNotMatch(finalizerDefinition, /left join lateral \(/i);
    const rebuildDefinition = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_rebuild_mailbox_campaign_lineage(text,text[],boolean,jsonb)'
          ::pg_catalog.regprocedure
      ) as definition
    `)).rows[0].definition;
    assert.equal(
      (rebuildDefinition.match(/public\.softora_resolve_mailbox_campaign_lineage\(/g) || []).length,
      1
    );
    assert.match(rebuildDefinition, /resolved_lineage as materialized/i);

    // Force a real statement timeout after the insert/retire/lineage work has
    // started. PostgreSQL must roll the entire RPC back; retrying the same
    // commit ID must then succeed once and its next invocation must replay.
    const rollbackAccount = 'finalizer-rollback@softora.nl';
    const rollbackSyncKey = `${rollbackAccount}|sent`;
    const rollbackOldRows = sentSnapshotRows({
      accountEmail: rollbackAccount,
      count: 8,
      messageNamespace: 'rollback-shared',
      providerNamespace: 'rollback-old',
      recipientDomain: 'rollback-old.example',
      updatedAt: '2026-08-24T08:00:00.000Z',
    });
    const rollbackNewRows = sentSnapshotRows({
      accountEmail: rollbackAccount,
      count: 8,
      messageNamespace: 'rollback-shared',
      providerNamespace: 'rollback-new',
      recipientDomain: 'rollback-new.example',
      updatedAt: '2026-08-25T08:00:00.000Z',
    });
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,'sent','idle',0,0,null)
    `, [rollbackSyncKey, rollbackAccount]);
    await activateSnapshot(client, {
      syncKey: rollbackSyncKey,
      token: 'rollback-first-token',
      commitId: 'rollback-first-commit',
      uidValidity: 9100,
      rows: rollbackOldRows,
    });
    await lease(client, rollbackSyncKey, 'rollback-final-token');
    const rollbackPrepared = await prepare(
      client, rollbackSyncKey, 'rollback-final-token', 9101, 9
    );
    const rollbackArgs = {
      syncKey: rollbackSyncKey,
      token: 'rollback-final-token',
      commitId: 'rollback-timeout-replay-commit',
      generationId: rollbackPrepared.target_generation_id,
      uidValidity: 9101,
      rows: rollbackNewRows,
      fromUid: 1,
      throughUid: 8,
      complete: true,
      messageCount: 8,
      lastUid: 8,
    };
    const rollbackRecipient = 'recipient-1@rollback-new.example';
    const beforeTimeout = await finalizationSnapshot({
      syncKey: rollbackSyncKey,
      generationId: rollbackPrepared.target_generation_id,
      commitId: rollbackArgs.commitId,
      recipientEmail: rollbackRecipient,
    });
    await client.query(`
      create or replace function public.test_delay_final_activation_for_timeout()
      returns trigger language plpgsql volatile set search_path=''
      as $function$
      begin
        if new.sync_key='finalizer-rollback@softora.nl|sent'
          and old.active_uid_generation_id
            is distinct from new.active_uid_generation_id then
          perform pg_catalog.pg_sleep(1);
        end if;
        return new;
      end;
      $function$;
      create trigger test_delay_final_activation_for_timeout
      before update of active_uid_generation_id
      on public.softora_mailbox_sync_state
      for each row execute function public.test_delay_final_activation_for_timeout();
    `);
    await resetResolverCallCount();
    await client.query('begin');
    try {
      await client.query("set local statement_timeout='250ms'");
      await assert.rejects(
        commit(client, rollbackArgs),
        (error) => error?.code === '57014'
          && /statement timeout/i.test(String(error?.message || ''))
      );
    } finally {
      await client.query('rollback');
    }
    await client.query(`
      drop trigger test_delay_final_activation_for_timeout
        on public.softora_mailbox_sync_state;
      drop function public.test_delay_final_activation_for_timeout();
    `);
    assert.deepEqual(await finalizationSnapshot({
      syncKey: rollbackSyncKey,
      generationId: rollbackPrepared.target_generation_id,
      commitId: rollbackArgs.commitId,
      recipientEmail: rollbackRecipient,
    }), beforeTimeout);
    assert.equal(await resolverCallCount(), 0);

    await client.query('begin');
    await client.query("set local statement_timeout='8s'");
    const rollbackRetry = await commit(client, rollbackArgs);
    await client.query('set constraints all immediate');
    await client.query('commit');
    assert.equal(rollbackRetry.activated, true);
    assert.equal(await resolverCallCount(), 1);
    const rollbackGuardCount = (await client.query(`
      select pg_catalog.count(*)::integer as count
      from public.softora_outbound_recipient_guards
      where key_type='email' and key_value=$1 and permanent and status='sent'
    `, [rollbackRecipient])).rows[0].count;
    assert.equal(rollbackGuardCount, 1);
    const rollbackReplay = await commit(client, rollbackArgs);
    assert.equal(rollbackReplay.replayed, true);
    assert.equal(await resolverCallCount(), 1);
    assert.equal((await client.query(`
      select pg_catalog.count(*)::integer as count
      from public.softora_outbound_recipient_guards
      where key_type='email' and key_value=$1 and permanent and status='sent'
    `, [rollbackRecipient])).rows[0].count, rollbackGuardCount);

    // The production-sized path uses Sent, 800 external recipients, a normal
    // active generation plus two independently stale visible generations.
    // State is deliberately split across those generations so ranking and
    // tombstone-inclusive inheritance cannot pass accidentally.
    const messageCount = 800;
    const scaleAccount = 'finalizer-scale-800@softora.nl';
    const scaleSyncKey = `${scaleAccount}|sent`;
    const scaleOldRows = sentSnapshotRows({
      accountEmail: scaleAccount,
      count: messageCount,
      messageNamespace: 'scale-800-shared',
      providerNamespace: 'scale-800-old',
      recipientDomain: 'scale-800.example',
      updatedAt: '2026-08-23T10:00:00.000Z',
    });
    const scaleNewRows = sentSnapshotRows({
      accountEmail: scaleAccount,
      count: messageCount,
      messageNamespace: 'scale-800-shared',
      providerNamespace: 'scale-800-new',
      recipientDomain: 'scale-800.example',
      updatedAt: '2026-08-25T10:00:00.000Z',
    });
    await client.query(`
      insert into public.softora_mailbox_sync_state(
        sync_key,account_email,folder,status,last_uid,message_count,uid_validity
      ) values($1,$2,'sent','idle',0,0,null)
    `, [scaleSyncKey, scaleAccount]);
    const scaleFirst = await activateSnapshot(client, {
      syncKey: scaleSyncKey,
      token: 'scale-800-first-token',
      commitId: 'scale-800-first-commit',
      uidValidity: 9200,
      rows: scaleOldRows,
    });
    const scaleActiveGeneration = scaleFirst.prepared.target_generation_id;
    const staleGenerationA = '81111111-1111-4111-8111-111111111111';
    const staleGenerationB = '82222222-2222-4222-8222-222222222222';
    const readAt = '2026-08-24T10:01:00.000Z';
    const dismissedAt = '2026-08-24T10:03:00.000Z';
    const mutationAt = '2026-08-24T10:04:00.000Z';
    const mutationKey = 'd'.repeat(64);
    const deletedAt = '2026-08-24T10:05:00.000Z';
    const logicalTombstoneAt = '2026-08-24T10:06:00.000Z';
    await client.query(`
      insert into public.softora_mailbox_uid_generations(
        generation_id,sync_key,account_email,folder,uid_validity,
        selection_policy,status,scan_upper_uid,scanned_through_uid,
        scan_complete,snapshot_message_count,activated_at,superseded_at
      ) values
        ($1::uuid,$3,$4,'sent',9198,'staged-rebuild-v2','superseded',
          3,3,true,3,clock_timestamp()-interval '3 minutes',
          clock_timestamp()-interval '2 minutes'),
        ($2::uuid,$3,$4,'sent',9199,'staged-rebuild-v2','superseded',
          6,6,true,3,clock_timestamp()-interval '2 minutes',
          clock_timestamp()-interval '1 minute')
    `, [staleGenerationA, staleGenerationB, scaleSyncKey, scaleAccount]);
    await client.query(`
      insert into public.softora_mailbox_message_tombstones(
        account_email,normalized_message_id,deleted_at,updated_at
      ) values($1,$2,$3::timestamptz,$3::timestamptz)
      on conflict(account_email,normalized_message_id) do update set
        deleted_at=excluded.deleted_at,updated_at=excluded.updated_at
    `, [
      scaleAccount,
      'scale-800-shared-6@test.softora.nl',
      logicalTombstoneAt,
    ]);
    await client.query(`
      alter table public.softora_mailbox_messages
        disable trigger softora_mailbox_messages_coerce_uid_generation;
      alter table public.softora_mailbox_messages
        disable trigger softora_refresh_mailbox_message_lineage
    `);
    try {
      await client.query(`
        insert into public.softora_mailbox_messages(
          message_key,account_email,folder,uid,uid_validity,uid_generation_id,
          provider_id,message_id,in_reply_to,references_text,sender_name,
          sender_email,recipients_text,subject,preview,body_text,
          body_truncated,has_body,date,internal_date,unread,softora_read_at,
          state_revision,state_mutation_key,state_mutation_at,starred,
          reply_dismissed_at,payload,updated_at,deleted_at
        )
        select
          $2||'|gen:'||$1::text||'|'||source.uid::text,
          source.account_email,source.folder,source.uid,9198,$1::uuid,
          'scale-stale-a:'||source.uid::text,source.message_id,
          source.in_reply_to,source.references_text,source.sender_name,
          source.sender_email,source.recipients_text,source.subject,
          source.preview,source.body_text,source.body_truncated,source.has_body,
          source.date,source.internal_date,
          case when source.uid=1 then false else source.unread end,
          case when source.uid=1 then $3::timestamptz else null end,
          0,null,null,source.uid=2,
          case when source.uid=3 then $4::timestamptz else null end,
          source.payload,'2026-08-24T11:00:00.000Z'::timestamptz,null
        from public.softora_mailbox_messages as source
        where source.uid_generation_id=$5::uuid and source.uid between 1 and 3
      `, [
        staleGenerationA, scaleSyncKey, readAt, dismissedAt,
        scaleActiveGeneration,
      ]);
      await client.query(`
        insert into public.softora_mailbox_messages(
          message_key,account_email,folder,uid,uid_validity,uid_generation_id,
          provider_id,message_id,in_reply_to,references_text,sender_name,
          sender_email,recipients_text,subject,preview,body_text,
          body_truncated,has_body,date,internal_date,unread,softora_read_at,
          state_revision,state_mutation_key,state_mutation_at,starred,
          reply_dismissed_at,payload,updated_at,deleted_at
        )
        select
          $2||'|gen:'||$1::text||'|'||source.uid::text,
          source.account_email,source.folder,source.uid,9199,$1::uuid,
          'scale-stale-b:'||source.uid::text,source.message_id,
          source.in_reply_to,source.references_text,source.sender_name,
          source.sender_email,source.recipients_text,source.subject,
          source.preview,source.body_text,source.body_truncated,source.has_body,
          source.date,source.internal_date,source.unread,null,
          case when source.uid=4 then 42 else 0 end,
          case when source.uid=4 then $3 else null end,
          case when source.uid=4 then $4::timestamptz else null end,
          source.starred,source.reply_dismissed_at,source.payload,
          '2026-08-24T12:00:00.000Z'::timestamptz,
          case when source.uid=5 then $5::timestamptz else null end
        from public.softora_mailbox_messages as source
        where source.uid_generation_id=$6::uuid and source.uid between 4 and 6
      `, [
        staleGenerationB, scaleSyncKey, mutationKey, mutationAt, deletedAt,
        scaleActiveGeneration,
      ]);
    } finally {
      await client.query(`
        alter table public.softora_mailbox_messages
          enable trigger softora_mailbox_messages_coerce_uid_generation;
        alter table public.softora_mailbox_messages
          enable trigger softora_refresh_mailbox_message_lineage
      `);
    }

    assert.equal((await client.query(`
      select pg_catalog.count(distinct uid_generation_id)::integer as count
      from public.softora_mailbox_messages
      where account_email=$1 and folder='sent'
        and generation_superseded_at is null
    `, [scaleAccount])).rows[0].count, 3);
    await lease(client, scaleSyncKey, 'scale-800-final-token');
    const scalePrepared = await prepare(
      client, scaleSyncKey, 'scale-800-final-token', 9201, messageCount + 1
    );
    const scaleArgs = {
      syncKey: scaleSyncKey,
      token: 'scale-800-final-token',
      commitId: 'scale-800-final-commit',
      generationId: scalePrepared.target_generation_id,
      uidValidity: 9201,
      rows: scaleNewRows,
      fromUid: 1,
      throughUid: messageCount,
      complete: true,
      messageCount,
      lastUid: messageCount,
    };
    await resetResolverCallCount();
    await client.query('begin');
    await client.query("set local statement_timeout='8s'");
    const scaleStartedAt = Date.now();
    const scaleActivated = await commit(client, scaleArgs);
    await client.query('set constraints all immediate');
    await client.query('commit');
    const scaleElapsedMs = Date.now() - scaleStartedAt;
    t.diagnostic(
      `finale RPC + SET CONSTRAINTS + COMMIT: ${scaleElapsedMs} ms`
    );
    assert.equal(scaleActivated.activated, true);
    assert.ok(
      scaleElapsedMs < 8_000,
      `800 Sent-rijen plus SET CONSTRAINTS/commit duurden ${scaleElapsedMs} ms`
    );
    assert.equal(await resolverCallCount(), 1);

    const inherited = (await client.query(`
      select uid,unread,softora_read_at,state_revision,state_mutation_key,
        state_mutation_at,starred,reply_dismissed_at,deleted_at
      from public.softora_mailbox_messages
      where uid_generation_id=$1::uuid and uid between 1 and 6
      order by uid
    `, [scalePrepared.target_generation_id])).rows;
    assert.equal(inherited[0].unread, false);
    assert.equal(inherited[0].softora_read_at.toISOString(), readAt);
    assert.equal(inherited[1].starred, true);
    assert.equal(inherited[2].reply_dismissed_at.toISOString(), dismissedAt);
    assert.equal(Number(inherited[3].state_revision), 42);
    assert.equal(inherited[3].state_mutation_key, mutationKey);
    assert.equal(inherited[3].state_mutation_at.toISOString(), mutationAt);
    assert.equal(inherited[4].deleted_at.toISOString(), deletedAt);
    assert.equal(inherited[5].deleted_at.toISOString(), logicalTombstoneAt);

    assert.equal((await client.query(`
      select pg_catalog.count(*)::integer as count
      from public.softora_mailbox_messages
      where account_email=$1 and folder='sent'
        and uid_generation_id=any($2::uuid[])
        and generation_superseded_at is not null
        and deleted_at is not null
    `, [
      scaleAccount,
      [scaleActiveGeneration, staleGenerationA, staleGenerationB],
    ])).rows[0].count, messageCount + 6);
    assert.deepEqual((await client.query(`
      select key_type,pg_catalog.count(*)::integer as count,
        pg_catalog.bool_and(permanent and status='sent') as durable
      from public.softora_outbound_recipient_guards
      where sender_email=$1 and recipient_domain='scale-800-example'
      group by key_type order by key_type
    `, [scaleAccount])).rows, [
      { key_type: 'domain', count: 1, durable: true },
      { key_type: 'email', count: messageCount, durable: true },
    ]);

    const scaleReplay = await commit(client, scaleArgs);
    assert.equal(scaleReplay.replayed, true);
    assert.equal(await resolverCallCount(), 1);
    assert.equal((await client.query(`
      select pg_catalog.count(*)::integer as count
      from public.softora_mailbox_uid_generation_commits
      where commit_id=$1
    `, [scaleArgs.commitId])).rows[0].count, 1);
  });
// mailbox-final-activation-scale-regression:end
}
