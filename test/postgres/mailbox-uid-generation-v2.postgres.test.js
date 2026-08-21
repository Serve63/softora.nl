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
  const clients = new Set();

  function applyTrackedSql(sql) {
    const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
    const username = decodeURIComponent(parsedUrl.username || 'postgres');
    const password = decodeURIComponent(parsedUrl.password || '');
    let command = 'psql';
    let args = [
      '-v', 'ON_ERROR_STOP=1', '-h', parsedUrl.hostname,
      '-p', parsedUrl.port || '5432', '-U', username, '-d', databaseName,
    ];
    if (postgresContainerId) {
      if (!/^[a-f0-9]{12,64}$/i.test(postgresContainerId)) {
        throw new Error('Ongeldig PostgreSQL-servicecontainer-id voor UID-generation-test.');
      }
      command = 'docker';
      args = [
        'exec', '-i', '-e', `PGPASSWORD=${password}`, postgresContainerId,
        'psql', '-v', 'ON_ERROR_STOP=1', '-U', username, '-d', databaseName,
      ];
    }
    const result = spawnSync(command, args, {
      input: sql,
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: password },
      maxBuffer: 1024 * 1024,
    });
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
      select * from public.softora_prepare_mailbox_uid_generation_v2(
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

  async function skipSync(client, {
    syncKey, token, commitId, reason = 'folder_missing',
  }) {
    return (await client.query(`
      select * from public.softora_skip_mailbox_sync_v2($1,$2,$3,$4)
    `, [syncKey, token, commitId, reason])).rows[0];
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
      insert into public.softora_mailbox_campaign_consistency(
        scope,uid_generation_protocol,uid_generation_protocol_changed_at,
        uid_generation_drain_started_at,uid_generation_drain_ready_at
      ) values(
        'campaign','draining',clock_timestamp()-interval '10 minutes',
        clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '5 minutes'
      );

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
      create or replace function public.softora_is_campaign_mailbox_message(
        p_account_email text,p_folder text,p_payload jsonb
      ) returns boolean language sql immutable security invoker set search_path=''
      as $function$
        select lower(btrim(coalesce(p_account_email,''))) = any(array[
          'serve@softora.nl','servecreusen@softora.nl','martijn@softora.nl'
        ]::text[]) and lower(btrim(coalesce(p_folder,''))) in ('inbox','sent','coldmail');
      $function$;
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
        ('servecreusen@softora.nl|inbox|1','servecreusen@softora.nl','inbox',1,
          'legacy:1','legacy-visible@test',null,'Legacy visible',now(),false,true,
          '{"source":"imap-sync"}',null),
        ('servecreusen@softora.nl|inbox|2','servecreusen@softora.nl','inbox',2,
          'legacy:2','legacy-hidden@test',null,'Legacy hidden',now(),false,false,
          '{"source":"imap-sync"}',null);
      update public.softora_mailbox_messages
      set softora_read_at=clock_timestamp(),reply_dismissed_at=clock_timestamp()
      where provider_id in ('legacy:1','serve-allmail:reply');
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp() where provider_id='legacy:2';
    `);
    applyTrackedSql(migration);
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
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
      'softora_confirm_mailbox_uid_baseline_v2',
      'softora_commit_mailbox_sync_pass_v2',
      'softora_skip_mailbox_sync_v2',
      'softora_fail_mailbox_sync_v2',
      'softora_apply_mailbox_state_mutation',
    ]])).rows;
    assert.equal(rpcAcl.length, 6);
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
}
