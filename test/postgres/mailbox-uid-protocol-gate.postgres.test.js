const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const databaseUrl = String(process.env.MAILBOX_POSTGRES_TEST_URL || '').trim();
const destructiveAllowed = process.env.MAILBOX_POSTGRES_TEST_ALLOW_DESTRUCTIVE === '1';

if (!databaseUrl) {
  test('echte PostgreSQL UID-protocolgatetests vereisen MAILBOX_POSTGRES_TEST_URL', {
    skip: 'geen expliciete lokale PostgreSQL-testdatabase opgegeven',
  }, () => {});
} else {
  const parsedUrl = new URL(databaseUrl);
  if (
    !destructiveAllowed
    || !/^\/softora_mailbox_(?:uid_protocol|lock)_test(?:_|$)/.test(parsedUrl.pathname)
    || !new Set(['localhost', '127.0.0.1', '[::1]', '::1']).has(parsedUrl.hostname)
  ) {
    throw new Error('Weiger destructieve UID-protocolgatetest buiten een expliciete lokale testdatabase.');
  }

  const { Client } = require('pg');
  const migration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260821174321_mailbox_uid_generation_protocol_gate.sql'
  ), 'utf8');
  const dataOpsSchema = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/data-ops-schema.sql'
  ), 'utf8');
  const v2Migration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260821174844_mailbox_uid_generation_epoch_v2.sql'
  ), 'utf8');
  const clients = new Set();

  function extractMarkedBlock(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    if (start < 0 || end <= start) {
      throw new Error(`SQL-markerblok ontbreekt: ${startMarker}`);
    }
    return source.slice(start, end + endMarker.length);
  }

  const bootstrapSentinelSql = extractMarkedBlock(
    dataOpsSchema,
    '-- mailbox-uid-generation-bootstrap-sentinel:start',
    '-- mailbox-uid-generation-bootstrap-sentinel:end'
  );
  const bootstrapDrainSql = extractMarkedBlock(
    dataOpsSchema,
    '-- mailbox-uid-generation-bootstrap-drain:start',
    '-- mailbox-uid-generation-bootstrap-drain:end'
  );
  const preflightEndMarker = '$uid_protocol_preflight$;';
  const preflightEnd = v2Migration.indexOf(preflightEndMarker);
  if (preflightEnd < 0) throw new Error('UID-v2 preflightblok ontbreekt.');
  const uidProtocolPreflightSql = v2Migration.slice(
    0,
    preflightEnd + preflightEndMarker.length
  );

  async function connect() {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("set statement_timeout='10s'; set lock_timeout='7s';");
    clients.add(client);
    return client;
  }

  async function claim(client, {
    accountEmail,
    folder = 'inbox',
    token,
    protocol,
    oldCaller = false,
  }) {
    const syncKey = `${accountEmail}|${folder}`;
    const sql = oldCaller
      ? `select * from public.softora_claim_mailbox_sync_lock(
          $1::text,$2::text,$3::text,$4::text,$5::integer,$6::boolean
        )`
      : `select * from public.softora_claim_mailbox_sync_lock(
          $1::text,$2::text,$3::text,$4::text,$5::integer,$6::boolean,$7::text
        )`;
    const params = [syncKey, accountEmail, folder, token, 90, false];
    if (!oldCaller) params.push(protocol);
    return (await client.query(sql, params)).rows[0];
  }

  async function expectTransitionFailure(client, sql, expectedMessage) {
    await client.query('begin');
    try {
      await client.query("select pg_catalog.set_config('softora.mailbox_uid_protocol_transition','1',true)");
      await assert.rejects(client.query(sql), (error) => {
        assert.match(String(error?.message || error), expectedMessage);
        return true;
      });
    } finally {
      await client.query('rollback').catch(() => null);
    }
  }

  async function activateThroughTrustedMigrationPath(client) {
    await client.query('begin');
    try {
      await client.query('select pg_catalog.pg_advisory_xact_lock(824031,3)');
      const state = (await client.query(`
        select uid_generation_protocol,uid_generation_drain_ready_at
        from public.softora_mailbox_campaign_consistency
        where scope='campaign'
        for update
      `)).rows[0];
      assert.equal(state.uid_generation_protocol, 'draining');
      assert.ok(new Date(state.uid_generation_drain_ready_at).getTime() <= Date.now());
      const activeLeaseCount = (await client.query(`
        select count(*)::integer as count
        from public.softora_mailbox_sync_state
        where status='syncing'
          and nullif(pg_catalog.btrim(lock_token),'') is not null
          and lock_expires_at > pg_catalog.clock_timestamp()
      `)).rows[0].count;
      assert.equal(activeLeaseCount, 0);
      await client.query("select pg_catalog.set_config('softora.mailbox_uid_protocol_transition','1',true)");
      await client.query(`
        update public.softora_mailbox_campaign_consistency
        set uid_generation_protocol='v2',
            uid_generation_protocol_changed_at=pg_catalog.clock_timestamp(),
            updated_at=pg_catalog.clock_timestamp()
        where scope='campaign'
      `);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => null);
      throw error;
    }
  }

  async function resetBootstrapProtocolBase(client, { fresh }) {
    await client.query(`
      drop schema public cascade;
      create schema public;
      grant usage on schema public to public, anon, authenticated, service_role;
    `);
    if (fresh) await client.query(bootstrapSentinelSql);
    await client.query(`
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
        created_at timestamptz not null default pg_catalog.clock_timestamp(),
        updated_at timestamptz not null default pg_catalog.clock_timestamp()
      );
      create table public.softora_mailbox_messages (
        message_key text primary key
      );
      create table public.softora_mailbox_campaign_mutations (
        mutation_id text primary key
      );
      create table public.softora_mailbox_campaign_consistency (
        scope text primary key check (scope='campaign'),
        content_version bigint not null default 0,
        created_at timestamptz not null default pg_catalog.clock_timestamp(),
        updated_at timestamptz not null default pg_catalog.clock_timestamp()
      );
      insert into public.softora_mailbox_campaign_consistency(scope) values('campaign');
      grant select,insert,update,delete on public.softora_mailbox_sync_state to service_role;
      grant select,insert,update,delete on public.softora_mailbox_messages to service_role;
      grant select,insert,update,delete on public.softora_mailbox_campaign_mutations to service_role;
      grant select,insert,update on public.softora_mailbox_campaign_consistency to service_role;

      create or replace function public.softora_claim_mailbox_sync_lock(
        p_sync_key text,
        p_account_email text,
        p_folder text,
        p_lock_token text,
        p_lock_ttl_seconds integer default 90,
        p_force boolean default false
      )
      returns table (
        acquired boolean,
        locked boolean,
        claimed_lock_token text,
        lock_expires_at timestamptz
      )
      language sql
      security invoker
      set search_path=''
      as $old_function$
        select false,false,null::text,null::timestamptz;
      $old_function$;
      grant execute on function public.softora_claim_mailbox_sync_lock(
        text,text,text,text,integer,boolean
      ) to service_role;
    `);
    if (!fresh) await client.query(bootstrapSentinelSql);
    await client.query(migration);
  }

  test.before(async () => {
    const client = await connect();
    await client.query(`
      do $roles$
      begin
        if not exists (select 1 from pg_catalog.pg_roles where rolname='anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_catalog.pg_roles where rolname='authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_catalog.pg_roles where rolname='service_role') then
          create role service_role nologin;
        end if;
      end;
      $roles$;

      drop schema public cascade;
      create schema public;
      grant usage on schema public to public, anon, authenticated, service_role;

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
        created_at timestamptz not null default pg_catalog.clock_timestamp(),
        updated_at timestamptz not null default pg_catalog.clock_timestamp()
      );
      create table public.softora_mailbox_campaign_consistency (
        scope text primary key check (scope='campaign'),
        content_version bigint not null default 0,
        created_at timestamptz not null default pg_catalog.clock_timestamp(),
        updated_at timestamptz not null default pg_catalog.clock_timestamp()
      );
      insert into public.softora_mailbox_campaign_consistency(scope) values('campaign');
      grant select,insert,update,delete on public.softora_mailbox_sync_state to service_role;
      grant select,insert,update on public.softora_mailbox_campaign_consistency to service_role;

      create or replace function public.softora_claim_mailbox_sync_lock(
        p_sync_key text,
        p_account_email text,
        p_folder text,
        p_lock_token text,
        p_lock_ttl_seconds integer default 90,
        p_force boolean default false
      )
      returns table (
        acquired boolean,
        locked boolean,
        claimed_lock_token text,
        lock_expires_at timestamptz
      )
      language sql
      security invoker
      set search_path=''
      as $old_function$
        select false,false,null::text,null::timestamptz;
      $old_function$;
      grant execute on function public.softora_claim_mailbox_sync_lock(
        text,text,text,text,integer,boolean
      ) to service_role;
    `);
    await client.query(migration);
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
  });

  test('oude zes-argumentencaller en expliciete dual legacy-caller werken in legacy', async () => {
    const client = await connect();
    const oldClaim = await claim(client, {
      accountEmail: 'old@softora.nl', token: 'old-legacy-token', oldCaller: true,
    });
    const dualClaim = await claim(client, {
      accountEmail: 'dual@softora.nl', token: 'dual-legacy-token', protocol: 'legacy',
    });
    assert.equal(oldClaim.acquired, true);
    assert.equal(oldClaim.locked, false);
    assert.equal(oldClaim.claimed_lock_token, 'old-legacy-token');
    assert.equal(dualClaim.acquired, true);
    assert.equal(dualClaim.locked, false);
    assert.equal(dualClaim.claimed_lock_token, 'dual-legacy-token');

    const prematureV2 = await claim(client, {
      accountEmail: 'premature-v2@softora.nl', token: 'premature-v2-token', protocol: 'v2',
    });
    assert.equal(prematureV2.acquired, false);
    assert.equal(prematureV2.locked, true);
  });

  test('directe of verkeerde identiteit en directe protocolsprong worden geweigerd', async () => {
    const client = await connect();
    await assert.rejects(
      client.query(`select * from public.softora_claim_mailbox_sync_lock(
        'serve@softora.nl|inbox','martijn@softora.nl','inbox','wrong-identity',90,false,'legacy'
      )`),
      /MAILBOX_SYNC_LOCK_IDENTITY_INVALID/
    );
    await expectTransitionFailure(client, `
      update public.softora_mailbox_campaign_consistency
      set uid_generation_protocol='v2',
          uid_generation_protocol_changed_at=pg_catalog.clock_timestamp(),
          uid_generation_drain_started_at=pg_catalog.clock_timestamp(),
          uid_generation_drain_ready_at=pg_catalog.clock_timestamp()+interval '3 minutes'
      where scope='campaign'
    `, /MAILBOX_UID_PROTOCOL_TRANSITION_INVALID/);
  });

  test('legacy -> draining -> v2 blokkeert beide caller-generaties tijdens drain', async () => {
    const client = await connect();
    const drain = (await client.query(
      'select * from public.softora_begin_mailbox_uid_generation_v2_drain(180)'
    )).rows[0];
    assert.equal(drain.protocol, 'draining');
    assert.equal(drain.drain_ready, false);
    assert.ok(Number(drain.active_lease_count) >= 2);

    for (const candidate of [
      { accountEmail: 'blocked-old@softora.nl', token: 'blocked-old', oldCaller: true },
      { accountEmail: 'blocked-dual@softora.nl', token: 'blocked-dual', protocol: 'legacy' },
      { accountEmail: 'blocked-v2@softora.nl', token: 'blocked-v2', protocol: 'v2' },
    ]) {
      const blocked = await claim(client, candidate);
      assert.equal(blocked.acquired, false);
      assert.equal(blocked.locked, true);
      assert.equal(blocked.claimed_lock_token, null);
    }
    assert.equal((await client.query(`
      select count(*)::integer as count from public.softora_mailbox_sync_state
      where account_email like 'blocked-%'
    `)).rows[0].count, 0);
  });

  test('dual v2-caller werkt pas na migratie-eigen activatie en oude caller blijft dicht', async () => {
    const client = await connect();
    await client.query(`
      update public.softora_mailbox_sync_state
      set status='idle',lock_token=null,lock_expires_at=null,updated_at=pg_catalog.clock_timestamp()
      where status='syncing'
    `);

    // Test-only clock travel: production must wait for the recorded drain floor.
    await client.query(`
      alter table public.softora_mailbox_campaign_consistency
        disable trigger softora_guard_mailbox_uid_generation_protocol;
      update public.softora_mailbox_campaign_consistency
      set uid_generation_protocol_changed_at=pg_catalog.clock_timestamp()-interval '4 minutes',
          uid_generation_drain_started_at=pg_catalog.clock_timestamp()-interval '4 minutes',
          uid_generation_drain_ready_at=pg_catalog.clock_timestamp()-interval '1 minute'
      where scope='campaign';
      alter table public.softora_mailbox_campaign_consistency
        enable trigger softora_guard_mailbox_uid_generation_protocol;
    `);
    await activateThroughTrustedMigrationPath(client);

    const v2Claim = await claim(client, {
      accountEmail: 'dual-v2@softora.nl', token: 'dual-v2-token', protocol: 'v2',
    });
    assert.equal(v2Claim.acquired, true);
    assert.equal(v2Claim.locked, false);

    const oldClaim = await claim(client, {
      accountEmail: 'old-after-v2@softora.nl', token: 'old-after-v2-token', oldCaller: true,
    });
    assert.equal(oldClaim.acquired, false);
    assert.equal(oldClaim.locked, true);

    await expectTransitionFailure(client, `
      update public.softora_mailbox_campaign_consistency
      set uid_generation_protocol='legacy',
          uid_generation_protocol_changed_at=pg_catalog.clock_timestamp(),
          uid_generation_drain_started_at=null,
          uid_generation_drain_ready_at=null
      where scope='campaign'
    `, /MAILBOX_UID_PROTOCOL_TRANSITION_INVALID/);
  });

  test('protocolfuncties zijn alleen uitvoerbaar door service_role', async () => {
    const client = await connect();
    const privileges = (await client.query(`
      select role_name,signature,
        pg_catalog.has_function_privilege(role_name,signature,'execute') as can_execute
      from (values
        ('anon','public.softora_get_mailbox_uid_generation_protocol()'),
        ('authenticated','public.softora_get_mailbox_uid_generation_protocol()'),
        ('service_role','public.softora_get_mailbox_uid_generation_protocol()'),
        ('anon','public.softora_begin_mailbox_uid_generation_v2_drain(integer)'),
        ('authenticated','public.softora_begin_mailbox_uid_generation_v2_drain(integer)'),
        ('service_role','public.softora_begin_mailbox_uid_generation_v2_drain(integer)'),
        ('anon','public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean,text)'),
        ('authenticated','public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean,text)'),
        ('service_role','public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean,text)'),
        ('service_role','public.softora_guard_mailbox_uid_generation_protocol()')
      ) as checked(role_name,signature)
      order by signature,role_name
    `)).rows;
    for (const row of privileges) {
      assert.equal(row.can_execute, row.role_name === 'service_role'
        && row.signature !== 'public.softora_guard_mailbox_uid_generation_protocol()');
    }
    assert.equal((await client.query(`
      select pg_catalog.to_regprocedure(
        'public.softora_claim_mailbox_sync_lock(text,text,text,text,integer,boolean)'
      ) is null as old_overload_removed
    `)).rows[0].old_overload_removed, true);
  });

  test('verse data-ops UID-bootstrap doorloopt aantoonbaar de verstreken drain', async () => {
    const client = await connect();
    await resetBootstrapProtocolBase(client, { fresh: true });
    await client.query(bootstrapDrainSql);
    const protocol = (await client.query(`
      select uid_generation_protocol,
        uid_generation_drain_started_at is not null as drain_started,
        uid_generation_drain_ready_at is not null as drain_recorded,
        uid_generation_drain_ready_at <= pg_catalog.clock_timestamp() as drain_elapsed,
        coalesce(pg_catalog.current_setting(
          'softora.mailbox_uid_fresh_bootstrap', true
        ), '') as fresh_sentinel
      from public.softora_mailbox_campaign_consistency
      where scope='campaign'
    `)).rows[0];
    assert.deepEqual(protocol, {
      uid_generation_protocol: 'draining',
      drain_started: true,
      drain_recorded: true,
      drain_elapsed: true,
      fresh_sentinel: '',
    });
    await client.query(uidProtocolPreflightSql);
  });

  test('verse UID-bootstrap weigert onverwacht gevulde mailboxstate', async () => {
    const client = await connect();
    await resetBootstrapProtocolBase(client, { fresh: true });
    await client.query(`
      insert into public.softora_mailbox_messages(message_key)
      values('unexpected-message')
    `);
    await assert.rejects(
      client.query(bootstrapDrainSql),
      /MAILBOX_UID_FRESH_BOOTSTRAP_NOT_EMPTY/
    );
    await client.query(`
      select pg_catalog.set_config('softora.mailbox_uid_fresh_bootstrap','',false)
    `);
  });

  test('bestaande legacy data-ops herstart kan de verplichte drain nooit omzeilen', async () => {
    const client = await connect();
    await resetBootstrapProtocolBase(client, { fresh: false });
    await client.query(bootstrapDrainSql);
    assert.deepEqual((await client.query(`
      select uid_generation_protocol,
        coalesce(pg_catalog.current_setting(
          'softora.mailbox_uid_fresh_bootstrap', true
        ), '') as fresh_sentinel
      from public.softora_mailbox_campaign_consistency
      where scope='campaign'
    `)).rows[0], {
      uid_generation_protocol: 'legacy',
      fresh_sentinel: '',
    });
    await assert.rejects(
      client.query(uidProtocolPreflightSql),
      /MAILBOX_UID_PROTOCOL_DRAIN_REQUIRED/
    );
  });

  test('bestaande gevulde legacy data-ops herstart blijft eveneens fail-closed', async () => {
    const client = await connect();
    await resetBootstrapProtocolBase(client, { fresh: false });
    await client.query(`
      insert into public.softora_mailbox_campaign_mutations(mutation_id)
      values('existing-mutation')
    `);
    await client.query(bootstrapDrainSql);
    assert.equal((await client.query(`
      select uid_generation_protocol
      from public.softora_mailbox_campaign_consistency
      where scope='campaign'
    `)).rows[0].uid_generation_protocol, 'legacy');
    await assert.rejects(
      client.query(uidProtocolPreflightSql),
      /MAILBOX_UID_PROTOCOL_DRAIN_REQUIRED/
    );
  });
}
