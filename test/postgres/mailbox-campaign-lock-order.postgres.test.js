const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const databaseUrl = String(process.env.MAILBOX_POSTGRES_TEST_URL || '').trim();
const destructiveAllowed = process.env.MAILBOX_POSTGRES_TEST_ALLOW_DESTRUCTIVE === '1';
const postgresContainerId = String(process.env.MAILBOX_POSTGRES_TEST_CONTAINER_ID || '').trim();

if (!databaseUrl) {
  test('echte PostgreSQL mailbox-lockordertest vereist MAILBOX_POSTGRES_TEST_URL', {
    skip: 'geen expliciete lokale PostgreSQL-testdatabase opgegeven',
  }, () => {});
} else {
  const parsedUrl = new URL(databaseUrl);
  if (!destructiveAllowed || !/^\/softora_mailbox_lock_test(?:_|$)/.test(parsedUrl.pathname)) {
    throw new Error('Weiger destructieve PostgreSQL-test buiten een expliciete softora_mailbox_lock_test database.');
  }
  const { Client } = require('pg');
  const foundation = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260809213000_mailbox_campaign_consistency_foundation.sql'
  ), 'utf8');
  const forwardMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260810032742_mailbox_campaign_atomic_message_commit.sql'
  ), 'utf8');
  const globalLockMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260810100500_harden_mailbox_sync_global_locks.sql'
  ), 'utf8');
  const globalLockProbe = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/mailbox-sync-global-lock-probe.sql'
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
        throw new Error('Ongeldig PostgreSQL-servicecontainer-id voor mailbox-lockordertest.');
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
      throw new Error(`Kon getrackte mailboxmigratie niet toepassen in testdatabase: ${detail}`);
    }
  }

  async function connect() {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("set statement_timeout = '8s'; set lock_timeout = '6s';");
    clients.add(client);
    return client;
  }

  function messageRow(key, accountEmail = 'serve@softora.nl', payload = { source: 'imap-sync' }) {
    const uid = Number(key.replace(/\D/g, '').slice(-8)) || 1;
    return {
      message_key: key,
      account_email: accountEmail,
      folder: payload.provider === 'instantly' ? 'instantly' : 'inbox',
      uid,
      provider_id: key,
      message_id: `<${key}@test.softora.nl>`,
      in_reply_to: '',
      references_text: '',
      sender_name: 'Prospect',
      sender_email: 'prospect@example.org',
      recipients_text: accountEmail,
      subject: 'Re: Website',
      preview: 'Test',
      body_text: 'Testbericht',
      body_truncated: false,
      has_body: true,
      date: '2026-08-10T00:00:00.000Z',
      internal_date: '2026-08-10T00:00:00.000Z',
      unread: true,
      starred: false,
      payload,
      updated_at: '2026-08-10T00:00:00.000Z',
    };
  }

  async function beginMutation(client, {
    mutationId, requestKey, kind = 'imap-sync', accountEmail = 'serve@softora.nl', folder = 'inbox',
  }) {
    return client.query(
      'select * from public.softora_begin_mailbox_campaign_mutation($1::uuid,$2,$3,$4,$5,120)',
      [mutationId, requestKey, kind, accountEmail, folder]
    );
  }

  function atomicCommit(client, mutationId, requestKey, rows) {
    return client.query(
      'select * from public.softora_commit_mailbox_campaign_messages($1::uuid,$2,$3::jsonb,$4::jsonb)',
      [mutationId, requestKey, JSON.stringify(rows), JSON.stringify({ test: true })]
    );
  }

  async function assertBlocked(promise, label) {
    const marker = Symbol(label);
    const early = await Promise.race([
      promise.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve(marker), 150)),
    ]);
    assert.equal(early, marker, `${label} blokkeerde niet op de gedeelde state-lock`);
  }

  test.before(() => {
    const bootstrapSql = `
      drop schema public cascade;
      create schema public;
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end;
      $$;
      create table public.softora_mailbox_messages (
        message_key text primary key, account_email text not null, folder text not null,
        uid bigint not null, provider_id text not null, message_id text, in_reply_to text,
        references_text text, sender_name text, sender_email text, recipients_text text,
        subject text, preview text, body_text text, body_truncated boolean not null default false,
        has_body boolean not null default false, date timestamptz not null, internal_date timestamptz,
        unread boolean not null default false, softora_read_at timestamptz,
        starred boolean not null default false, reply_dismissed_at timestamptz,
        payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(), deleted_at timestamptz,
        unique (account_email, folder, uid)
      );
    `;
    applyTrackedSql(
      `${bootstrapSql}\n${foundation}\n${forwardMigration}\n${globalLockMigration}\n${globalLockProbe}`
    );
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
  });

  test('atomic wint: reaper wacht en ziet uitsluitend committed data', { timeout: 10_000 }, async () => {
    const atomic = await connect();
    const reaper = await connect();
    const mutationId = '10000000-0000-4000-8000-000000000001';
    const requestKey = 'postgres:atomic-wins';
    await beginMutation(atomic, { mutationId, requestKey });
    await atomic.query('begin');
    await atomicCommit(atomic, mutationId, requestKey, [messageRow('atomic-wins-1')]);
    const fencePromise = reaper.query('select * from public.softora_get_mailbox_campaign_fence(true)');
    await assertBlocked(fencePromise, 'reaper achter atomic');
    await atomic.query('commit');
    const fence = (await fencePromise).rows[0];
    assert.equal(fence.ready, true);
    assert.equal(fence.reaped_count, '0');
    assert.equal((await reaper.query(
      "select count(*)::text as count from public.softora_mailbox_messages where message_key='atomic-wins-1'"
    )).rows[0].count, '1');
  });

  test('direct-write wint: atomic wacht zonder deadlock en commit daarna', { timeout: 10_000 }, async () => {
    const direct = await connect();
    const atomic = await connect();
    const mutationId = '20000000-0000-4000-8000-000000000002';
    const requestKey = 'postgres:direct-wins';
    await direct.query('begin');
    await direct.query(`
      insert into public.softora_mailbox_messages
        (message_key,account_email,folder,uid,provider_id,date,payload)
      values ('direct-wins-2','serve@softora.nl','inbox',2002,'direct-wins-2',now(),'{}'::jsonb)
    `);
    const atomicPromise = (async () => {
      await atomic.query('begin');
      await beginMutation(atomic, { mutationId, requestKey });
      const result = await atomicCommit(atomic, mutationId, requestKey, [messageRow('atomic-after-direct-3')]);
      await atomic.query('commit');
      return result;
    })();
    await assertBlocked(atomicPromise, 'atomic achter directe writer');
    await direct.query('commit');
    const result = await atomicPromise;
    assert.equal(result.rows[0].mutation_status, 'completed');
  });

  test('reaper wint: late atomic RPC weigert vóór iedere messagewrite', { timeout: 10_000 }, async () => {
    const setup = await connect();
    const reaper = await connect();
    const atomic = await connect();
    const mutationId = '30000000-0000-4000-8000-000000000003';
    const requestKey = 'postgres:reaper-wins';
    await beginMutation(setup, { mutationId, requestKey });
    await setup.query(
      "update public.softora_mailbox_campaign_mutations set lease_expires_at=clock_timestamp()-interval '1 second' where mutation_id=$1",
      [mutationId]
    );
    await reaper.query('begin');
    const fence = await reaper.query('select * from public.softora_get_mailbox_campaign_fence(true)');
    const atomicPromise = atomicCommit(atomic, mutationId, requestKey, [messageRow('reaper-wins-4')]);
    await assertBlocked(atomicPromise, 'atomic achter reaper');
    await reaper.query('commit');
    await assert.rejects(atomicPromise, (error) => error.code === '55000');
    assert.equal(fence.rows[0].ready, true);
    assert.equal(fence.rows[0].reaped_count, '1');
    assert.equal((await setup.query(
      "select count(*)::text as count from public.softora_mailbox_messages where message_key='reaper-wins-4'"
    )).rows[0].count, '0');
  });

  test('atomic rollback: reaper wacht, abandont daarna en er lekt geen data', { timeout: 10_000 }, async () => {
    const setup = await connect();
    const atomic = await connect();
    const reaper = await connect();
    const mutationId = '40000000-0000-4000-8000-000000000004';
    const requestKey = 'postgres:rollback';
    await beginMutation(setup, { mutationId, requestKey });
    await setup.query(
      "update public.softora_mailbox_campaign_mutations set lease_expires_at=clock_timestamp()-interval '1 second' where mutation_id=$1",
      [mutationId]
    );
    await atomic.query('begin');
    await atomicCommit(atomic, mutationId, requestKey, [messageRow('rollback-5')]);
    const fencePromise = reaper.query('select * from public.softora_get_mailbox_campaign_fence(true)');
    await assertBlocked(fencePromise, 'reaper achter rollback');
    await atomic.query('rollback');
    const fence = (await fencePromise).rows[0];
    assert.equal(fence.ready, true);
    assert.equal(fence.reaped_count, '1');
    assert.equal((await setup.query(
      "select count(*)::text as count from public.softora_mailbox_messages where message_key='rollback-5'"
    )).rows[0].count, '0');
  });

  test('SQL accepteert alleen de canonieke Instantly account-owner binding', async () => {
    const client = await connect();
    const mutationId = '45000000-0000-4000-8000-000000000001';
    const requestKey = 'postgres:instantly-owner-binding';
    await beginMutation(client, {
      mutationId,
      requestKey,
      kind: 'instantly-upsert',
      accountEmail: 'serve@websoftora.com',
      folder: 'instantly',
    });
    const result = await atomicCommit(client, mutationId, requestKey, [
      messageRow('owner-binding-valid-1', 'serve@websoftora.com', {
        provider: 'instantly',
        providerOwner: 'serve',
        providerAccountEmail: 'serve@websoftora.com',
      }),
    ]);
    assert.equal(result.rows[0].mutation_status, 'completed');

    await assert.rejects(
      client.query(
        `insert into public.softora_mailbox_messages
          (message_key,account_email,folder,uid,provider_id,date,payload)
         values ($1,$2,'instantly',$3,$1,now(),$4::jsonb)`,
        [
          'owner-binding-invalid-direct-2',
          'serve@websoftora.com',
          450002,
          JSON.stringify({
            provider: 'instantly',
            providerOwner: 'martijn',
            providerAccountEmail: 'serve@websoftora.com',
          }),
        ]
      ),
      (error) => error.code === '23514'
    );
  });

  test('globale provider-id collision kan een bestaand bericht nooit naar een ander account verplaatsen', async () => {
    const client = await connect();
    const originalMutationId = '46000000-0000-4000-8000-000000000001';
    const originalRequestKey = 'postgres:provider-collision:original';
    const collidingKey = 'instantly|globally-shared-provider-id-460001';
    await beginMutation(client, {
      mutationId: originalMutationId,
      requestKey: originalRequestKey,
      kind: 'instantly-upsert',
      accountEmail: 'serve@websoftora.com',
      folder: 'instantly',
    });
    await atomicCommit(client, originalMutationId, originalRequestKey, [
      messageRow(collidingKey, 'serve@websoftora.com', {
        provider: 'instantly',
        providerOwner: 'serve',
        providerAccountEmail: 'serve@websoftora.com',
      }),
    ]);

    const conflictingMutationId = '46000000-0000-4000-8000-000000000002';
    const conflictingRequestKey = 'postgres:provider-collision:cross-account';
    await beginMutation(client, {
      mutationId: conflictingMutationId,
      requestKey: conflictingRequestKey,
      kind: 'instantly-upsert',
      accountEmail: 'martijn@websoftora.com',
      folder: 'instantly',
    });
    await assert.rejects(
      atomicCommit(client, conflictingMutationId, conflictingRequestKey, [
        messageRow(collidingKey, 'martijn@websoftora.com', {
          provider: 'instantly',
          providerOwner: 'martijn',
          providerAccountEmail: 'martijn@websoftora.com',
        }),
      ]),
      (error) => error.code === '23505'
    );
    const stored = (await client.query(
      'select account_email, payload->>\'providerOwner\' as owner from public.softora_mailbox_messages where message_key=$1',
      [collidingKey]
    )).rows[0];
    assert.deepEqual(stored, { account_email: 'serve@websoftora.com', owner: 'serve' });

    const martijnPayload = JSON.stringify({
      provider: 'instantly',
      providerOwner: 'martijn',
      providerAccountEmail: 'martijn@websoftora.com',
    });
    await assert.rejects(
      client.query(
        `update public.softora_mailbox_messages
         set account_email='martijn@websoftora.com', payload=$2::jsonb
         where message_key=$1`,
        [collidingKey, martijnPayload]
      ),
      (error) => error.code === '23505'
    );
    await assert.rejects(
      client.query(
        `insert into public.softora_mailbox_messages
          (message_key,account_email,folder,uid,provider_id,date,payload)
         values ($1,'martijn@websoftora.com','instantly',460001,$1,now(),$2::jsonb)
         on conflict (message_key) do update set
           account_email=excluded.account_email,
           folder=excluded.folder,
           uid=excluded.uid,
           provider_id=excluded.provider_id,
           payload=excluded.payload`,
        [collidingKey, martijnPayload]
      ),
      (error) => error.code === '23505'
    );
    assert.deepEqual((await client.query(
      'select account_email, payload->>\'providerOwner\' as owner from public.softora_mailbox_messages where message_key=$1',
      [collidingKey]
    )).rows[0], { account_email: 'serve@websoftora.com', owner: 'serve' });
  });

  test('SQL weigert mixed account, payload-row drift, invalid owner en wrong kind', async () => {
    const client = await connect();
    const cases = [
      {
        suffix: 'mixed', kind: 'instantly-upsert', account: 'sender-a@example.com',
        rows: [
          messageRow('mixed-6', 'sender-a@example.com', {
            provider: 'instantly', providerOwner: 'serve', providerAccountEmail: 'sender-a@example.com',
          }),
          messageRow('mixed-7', 'sender-b@example.com', {
            provider: 'instantly', providerOwner: 'serve', providerAccountEmail: 'sender-b@example.com',
          }),
        ],
      },
      {
        suffix: 'drift', kind: 'instantly-upsert', account: 'sender-a@example.com',
        rows: [messageRow('drift-8', 'sender-a@example.com', {
          provider: 'instantly', providerOwner: 'serve', providerAccountEmail: 'sender-b@example.com',
        })],
      },
      {
        suffix: 'owner', kind: 'instantly-upsert', account: 'sender-a@example.com',
        rows: [messageRow('owner-9', 'sender-a@example.com', {
          provider: 'instantly', providerOwner: 'other', providerAccountEmail: 'sender-a@example.com',
        })],
      },
      {
        suffix: 'cross-owner', kind: 'instantly-upsert', account: 'serve@websoftora.com',
        rows: [messageRow('cross-owner-10', 'serve@websoftora.com', {
          provider: 'instantly', providerOwner: 'martijn', providerAccountEmail: 'serve@websoftora.com',
        })],
      },
      {
        suffix: 'kind', kind: 'other-kind', account: 'serve@softora.nl',
        rows: [messageRow('kind-11')],
      },
    ];
    for (const [index, entry] of cases.entries()) {
      const mutationId = `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const requestKey = `postgres:negative:${entry.suffix}`;
      await client.query('begin');
      await beginMutation(client, {
        mutationId, requestKey, kind: entry.kind, accountEmail: entry.account,
        folder: entry.kind === 'instantly-upsert' ? 'instantly' : 'inbox',
      });
      await assert.rejects(
        atomicCommit(client, mutationId, requestKey, entry.rows),
        (error) => error.code === '22023'
      );
      await client.query('rollback');
    }
  });

  test('forward migration kan veilig opnieuw draaien zonder constraint- of datadrift', async () => {
    const client = await connect();
    applyTrackedSql(forwardMigration);
    const constraintCount = (await client.query(`
      select count(*)::integer as count
      from pg_constraint
      where conrelid = 'public.softora_mailbox_messages'::regclass
        and conname = 'softora_mailbox_instantly_owner_account_check'
        and convalidated = true
    `)).rows[0].count;
    assert.equal(constraintCount, 1);
    assert.equal((await client.query(
      "select account_email from public.softora_mailbox_messages where message_key='instantly|globally-shared-provider-id-460001'"
    )).rows[0].account_email, 'serve@websoftora.com');
  });

  test('ACL geeft service_role geen TRUNCATE en publieke rollen geen tabel/RPC-toegang', async () => {
    const client = await connect();
    const privileges = (await client.query(`
      select
        has_table_privilege('service_role','public.softora_mailbox_messages','SELECT') as service_select,
        has_table_privilege('service_role','public.softora_mailbox_messages','INSERT') as service_insert,
        has_table_privilege('service_role','public.softora_mailbox_messages','UPDATE') as service_update,
        has_table_privilege('service_role','public.softora_mailbox_messages','DELETE') as service_delete,
        has_table_privilege('service_role','public.softora_mailbox_messages','TRUNCATE') as service_truncate,
        has_table_privilege('anon','public.softora_mailbox_messages','SELECT') as anon_select,
        has_table_privilege('authenticated','public.softora_mailbox_messages','SELECT') as authenticated_select,
        has_function_privilege('anon','public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)','EXECUTE') as anon_commit,
        has_function_privilege('authenticated','public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)','EXECUTE') as authenticated_commit,
        has_function_privilege('service_role','public.softora_commit_mailbox_campaign_messages(uuid,text,jsonb,jsonb)','EXECUTE') as service_commit,
        has_function_privilege('anon','public.softora_lock_mailbox_campaign_consistency_before_write()','EXECUTE') as anon_trigger,
        has_function_privilege('authenticated','public.softora_lock_mailbox_campaign_consistency_before_write()','EXECUTE') as authenticated_trigger,
        has_function_privilege('service_role','public.softora_lock_mailbox_campaign_consistency_before_write()','EXECUTE') as service_trigger
    `)).rows[0];
    assert.deepEqual(privileges, {
      service_select: true,
      service_insert: true,
      service_update: true,
      service_delete: true,
      service_truncate: false,
      anon_select: false,
      authenticated_select: false,
      anon_commit: false,
      authenticated_commit: false,
      service_commit: true,
      anon_trigger: false,
      authenticated_trigger: false,
      service_trigger: true,
    });
  });
}
