const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createMailboxPayloadFingerprint,
  createMailboxSendIdentityKey,
  createMailboxSendScopeKey,
} = require('../../server/services/mailbox-send-provenance-store');

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
  const sendProvenanceFoundation = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260805200344_add_mailbox_send_provenance.sql'
  ), 'utf8');
  const providerOutcomeMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260810012150_mailbox_send_provider_outcome_state.sql'
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

  async function seedMessage(client, key) {
    const row = messageRow(key);
    await client.query(`
      insert into public.softora_mailbox_messages
        (message_key,account_email,folder,uid,provider_id,subject,body_text,date,unread,payload)
      values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9::jsonb)
      on conflict (message_key) do nothing
    `, [row.message_key, row.account_email, row.folder, row.uid, row.provider_id,
      'Seed', 'Seed body', row.date, JSON.stringify(row.payload)]);
  }

  async function prepareDirectOperation(client, key, operation) {
    if (operation !== 'restore') return;
    await client.query(`
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp(),reply_dismissed_at=clock_timestamp() where message_key=$1
    `, [key]);
  }

  async function runDirectOperation(client, key, operation, label) {
    const row = messageRow(key);
    if (operation === 'hydrate') return client.query(`
        insert into public.softora_mailbox_messages
          (message_key,account_email,folder,uid,provider_id,subject,body_text,date,unread,payload)
        values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9::jsonb)
        on conflict (message_key) do update set
          subject=excluded.subject,body_text=excluded.body_text,unread=excluded.unread,
          payload=excluded.payload,updated_at=clock_timestamp()
      `, [row.message_key, row.account_email, row.folder, row.uid, row.provider_id,
        `Direct ${label}`, `Direct hydration ${label}`, row.date, JSON.stringify(row.payload)]);
    if (operation === 'read') return client.query(`
      update public.softora_mailbox_messages set unread=false,softora_read_at=clock_timestamp()
      where message_key=$1
    `, [key]);
    if (operation === 'hide') return client.query(`
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp(),reply_dismissed_at=clock_timestamp() where message_key=$1
    `, [key]);
    return client.query(`
      update public.softora_mailbox_messages set deleted_at=null,reply_dismissed_at=null where message_key=$1
    `, [key]);
  }

  async function assertDirectEffect(client, key, operation, label) {
    const row = (await client.query(`
      select subject,body_text,unread,softora_read_at,deleted_at,reply_dismissed_at
      from public.softora_mailbox_messages where message_key=$1
    `, [key])).rows[0];
    if (operation === 'hydrate') {
      assert.equal(row.subject, `Direct ${label}`);
      assert.equal(row.body_text, `Direct hydration ${label}`);
    } else if (operation === 'read') {
      assert.equal(row.unread, false);
      assert.ok(row.softora_read_at);
    } else if (operation === 'hide') {
      assert.ok(row.deleted_at);
      assert.ok(row.reply_dismissed_at);
    } else {
      assert.equal(row.deleted_at, null);
      assert.equal(row.reply_dismissed_at, null);
    }
  }

  async function assertBlocked(promise, label) {
    const marker = Symbol(label);
    const early = await Promise.race([
      promise.then(() => 'resolved', () => 'rejected'),
      new Promise((resolve) => setTimeout(() => resolve(marker), 150)),
    ]);
    assert.equal(early, marker, `${label} blokkeerde niet zoals verwacht`);
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
    const legacySendSeedSql = `
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,owner,account_email,recipient_email,mode,conversation_id,
        reply_target_message_id,references_text,provider,subject,body_text,status
      ) values (
        'send:legacy-accepted','legacy-browser-key','serve','serve@softora.nl','legacy@example.org',
        'reply','conversation:legacy','<legacy-incoming@example.org>','<legacy-incoming@example.org>',
        'smtp','Re: Legacy','Legacy antwoord','accepted'
      );
    `;
    applyTrackedSql(
      `${bootstrapSql}\n${foundation}\n${forwardMigration}\n${globalLockMigration}\n${globalLockProbe}` +
      `\n${sendProvenanceFoundation}\n${legacySendSeedSql}\n${providerOutcomeMigration}`
    );
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
  });

  test('atomic-wint same-row matrix blokkeert iedere directe app-writeklasse afzonderlijk', async (t) => {
    for (const [index, operation] of ['hydrate', 'read', 'hide', 'restore'].entries()) {
      await t.test(operation, { timeout: 10_000 }, async () => {
        const setup = await connect();
        const atomic = await connect();
        const direct = await connect();
        const suffix = 101 + index;
        const mutationId = `10000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
        const requestKey = `postgres:atomic-wins:${operation}`;
        const key = `same-row-atomic-wins-${suffix}`;
        await seedMessage(setup, key);
        await prepareDirectOperation(setup, key, operation);
        await beginMutation(atomic, { mutationId, requestKey });
        await atomic.query('begin');
        await atomicCommit(atomic, mutationId, requestKey, [{
          ...messageRow(key), subject: `Atomic ${operation}`, body_text: `Atomic ${operation} body`,
        }]);
        await direct.query('begin');
        const directPromise = runDirectOperation(direct, key, operation, `after atomic ${operation}`);
        await assertBlocked(directPromise, `${operation} achter atomic op dezelfde row`);
        await atomic.query('commit');
        await directPromise;
        await assertDirectEffect(direct, key, operation, `after atomic ${operation}`);
        await direct.query('commit');
      });
    }
  });

  test('direct-wint same-row matrix laat atomic per app-writeklasse wachten zonder deadlock', async (t) => {
    for (const [index, operation] of ['hydrate', 'read', 'hide', 'restore'].entries()) {
      await t.test(operation, { timeout: 10_000 }, async () => {
        const setup = await connect();
        const direct = await connect();
        const atomic = await connect();
        const suffix = 201 + index;
        const mutationId = `20000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;
        const requestKey = `postgres:direct-wins:${operation}`;
        const key = `same-row-direct-wins-${suffix}`;
        await seedMessage(setup, key);
        await prepareDirectOperation(setup, key, operation);
        await beginMutation(atomic, { mutationId, requestKey });
        await direct.query('begin');
        await runDirectOperation(direct, key, operation, `before atomic ${operation}`);
        await assertDirectEffect(direct, key, operation, `before atomic ${operation}`);
        const atomicPromise = (async () => {
          await atomic.query('begin');
          const result = await atomicCommit(atomic, mutationId, requestKey, [{
            ...messageRow(key), subject: `Atomic last ${operation}`,
            body_text: `Atomic last ${operation} body`, unread: true,
          }]);
          await atomic.query('commit');
          return result;
        })();
        await assertBlocked(atomicPromise, `atomic achter ${operation} op dezelfde row`);
        await direct.query('commit');
        const result = await atomicPromise;
        assert.equal(result.rows[0].mutation_status, 'completed');
        const final = (await setup.query(
          'select subject,body_text from public.softora_mailbox_messages where message_key=$1', [key]
        )).rows[0];
        assert.equal(final.subject, `Atomic last ${operation}`);
        assert.equal(final.body_text, `Atomic last ${operation} body`);
      });
    }
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

  test('verschillende browserkeys voor één Instantly-sendidentiteit reserveren atomair maar één intent', { timeout: 10_000 }, async () => {
    const first = await connect();
    const second = await connect();
    const observer = await connect();
    const identity = 'instantly-reply:postgres-concurrent-identity';
    const values = (suffix) => [
      `send:postgres-${suffix}`, `browser-key-${suffix}`, identity, identity, 'serve',
      'serve@softora.nl', 'prospect@example.org', 'reply', 'instantly:thread-1',
      'incoming-1', 'incoming-1', 'instantly', 'thread-1', 'Re: Website', 'Exact antwoord',
      'payload:instantly-race',
    ];
    const insert = (client, suffix) => client.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,send_identity_key,send_scope_key,owner,account_email,recipient_email,
        mode,conversation_id,reply_target_message_id,references_text,provider,
        provider_thread_id,subject,body_text,payload_fingerprint,status
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'prepared')
    `, values(suffix));

    await first.query('begin');
    await insert(first, 'first');
    const competingInsert = insert(second, 'second');
    await assertBlocked(competingInsert, 'tweede send-identiteitsreservering');
    await first.query('commit');
    await assert.rejects(competingInsert, (error) => error.code === '23505');
    const count = await observer.query(
      'select count(*)::integer as count from public.softora_mailbox_send_provenance where send_identity_key=$1',
      [identity]
    );
    assert.equal(count.rows[0].count, 1);
  });

  test('new-message heeft blijvende exact-replay key en tijdelijke onbekende scope-lock', async () => {
    const client = await connect();
    const insert = ({ intent, idempotency, identity, scope, status }) => client.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,send_identity_key,send_scope_key,owner,account_email,
        recipient_email,mode,conversation_id,provider,subject,body_text,payload_fingerprint,
        dispatch_state,status
      ) values ($1,$2,$3,$4,'serve','serve@softora.nl','prospect@example.org',
        'new-message','draft:prospect','smtp','Vraag','Bericht',$5,
        case when $6='prepared' then 'reserved' else case when $6='unknown' then 'started' else 'finished' end end,$6)
    `, [intent, idempotency, identity, scope, `payload:${identity}`, status]);

    await insert({ intent: 'send:new-accepted', idempotency: 'key:new-accepted',
      identity: 'new:payload-one', scope: 'new:scope-one', status: 'accepted' });
    await assert.rejects(insert({ intent: 'send:new-exact-replay', idempotency: 'key:new-replay',
      identity: 'new:payload-one', scope: 'new:scope-one', status: 'prepared' }),
    (error) => error.code === '23505');
    await insert({ intent: 'send:new-real-next', idempotency: 'key:new-next',
      identity: 'new:payload-two', scope: 'new:scope-one', status: 'accepted' });

    await insert({ intent: 'send:new-unknown', idempotency: 'key:new-unknown',
      identity: 'new:payload-three', scope: 'new:scope-two', status: 'unknown' });
    await assert.rejects(insert({ intent: 'send:new-changed-while-unknown', idempotency: 'key:new-changed',
      identity: 'new:payload-four', scope: 'new:scope-two', status: 'prepared' }),
    (error) => error.code === '23505');
  });

  test('legacy accepted reply krijgt exact dezelfde semantische key als een nieuwe browserrequest', async () => {
    const client = await connect();
    const input = {
      owner: 'serve', accountEmail: 'serve@softora.nl', recipientEmail: 'legacy@example.org',
      mode: 'reply', conversationId: 'conversation:legacy', provider: 'smtp', providerThreadId: '',
      replyTargetMessageId: '<legacy-incoming@example.org>', subject: 'Re: Legacy',
      body: 'Legacy antwoord', cc: '', bcc: '', attachmentsFingerprint: '',
    };
    const expectedScope = createMailboxSendScopeKey(input);
    const expectedIdentity = createMailboxSendIdentityKey(input);
    const expectedPayload = createMailboxPayloadFingerprint(input);
    const legacy = (await client.query(`
      select send_scope_key,send_identity_key,payload_fingerprint,dispatch_state
      from public.softora_mailbox_send_provenance where intent_id='send:legacy-accepted'
    `)).rows[0];
    assert.deepEqual(legacy, {
      send_scope_key: expectedScope,
      send_identity_key: expectedIdentity,
      payload_fingerprint: expectedPayload,
      dispatch_state: 'finished',
    });
    await assert.rejects(client.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,send_identity_key,send_scope_key,payload_fingerprint,
        owner,account_email,recipient_email,mode,conversation_id,reply_target_message_id,
        references_text,provider,subject,body_text,status
      ) values (
        'send:legacy-replay','new-browser-key',$1,$2,$3,'serve','serve@softora.nl',
        'legacy@example.org','reply','conversation:legacy','<legacy-incoming@example.org>',
        '<legacy-incoming@example.org>','smtp','Re: Legacy gewijzigd','Nieuwe browsertekst','prepared'
      )
    `, [expectedIdentity, expectedScope, createMailboxPayloadFingerprint({
      ...input, subject: 'Re: Legacy gewijzigd', body: 'Nieuwe browsertekst',
    })]), (error) => error.code === '23505');
  });

  test('providerconstraint weigert client-verzonnen provideridentiteiten', async () => {
    const client = await connect();
    for (const provider of ['foo', 'bar']) {
      await assert.rejects(client.query(`
        insert into public.softora_mailbox_send_provenance (
          intent_id,idempotency_key,send_identity_key,send_scope_key,payload_fingerprint,
          owner,account_email,recipient_email,mode,conversation_id,provider,subject,body_text,status
        ) values ($1,$2,$3,$4,'payload','serve','serve@softora.nl','provider@example.org',
          'new-message','draft:provider',$5,'Provider','Body','prepared')
      `, [`send:provider:${provider}`, `key:provider:${provider}`, `identity:${provider}`, `scope:${provider}`, provider]),
      (error) => error.code === '23514');
    }
  });

  test('statusmachine houdt accepted terminaal en laat alleen unknown naar accepted herstellen', async () => {
    const client = await connect();
    const seed = async (suffix) => client.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,send_identity_key,send_scope_key,payload_fingerprint,
        owner,account_email,recipient_email,mode,conversation_id,provider,subject,body_text,
        dispatch_state,dispatch_started_at,reconcile_required,status
      ) values ($1,$2,$3,$4,'payload','serve','serve@softora.nl',$5,'new-message',$6,'smtp',
        'Statusrace','Body','started',clock_timestamp(),true,'prepared')
    `, [`send:status:${suffix}`, `key:status:${suffix}`, `identity:status:${suffix}`,
      `scope:status:${suffix}`, `${suffix}@example.org`, `draft:${suffix}`]);

    await seed('accept-first');
    await client.query("update public.softora_mailbox_send_provenance set status='accepted',dispatch_state='finished' where intent_id='send:status:accept-first'");
    await assert.rejects(client.query(
      "update public.softora_mailbox_send_provenance set status='unknown',dispatch_state='started' where intent_id='send:status:accept-first'"
    ), (error) => error.code === '23514');
    await assert.rejects(client.query(
      "update public.softora_mailbox_send_provenance set status='failed' where intent_id='send:status:accept-first'"
    ), (error) => error.code === '23514');

    await seed('unknown-first');
    await client.query("update public.softora_mailbox_send_provenance set status='unknown' where intent_id='send:status:unknown-first'");
    await client.query("update public.softora_mailbox_send_provenance set status='accepted',dispatch_state='finished' where intent_id='send:status:unknown-first'");
    const restored = (await client.query(
      "select status,dispatch_state from public.softora_mailbox_send_provenance where intent_id='send:status:unknown-first'"
    )).rows[0];
    assert.deepEqual(restored, { status: 'accepted', dispatch_state: 'finished' });

    await seed('failed-first');
    await client.query("update public.softora_mailbox_send_provenance set status='failed',dispatch_state='finished' where intent_id='send:status:failed-first'");
    await assert.rejects(client.query(
      "update public.softora_mailbox_send_provenance set status='accepted' where intent_id='send:status:failed-first'"
    ), (error) => error.code === '23514');
  });

  test('concurrent accepted wint van late unknown/failed en unknown kan nog naar accepted herstellen', { timeout: 10_000 }, async () => {
    const setup = await connect();
    const first = await connect();
    const second = await connect();
    const seed = (suffix) => setup.query(`
      insert into public.softora_mailbox_send_provenance (
        intent_id,idempotency_key,send_identity_key,send_scope_key,payload_fingerprint,
        owner,account_email,recipient_email,mode,conversation_id,provider,subject,body_text,
        dispatch_state,dispatch_started_at,reconcile_required,status
      ) values ($1,$2,$3,$4,'payload','serve','serve@softora.nl',$5,'new-message',$6,'smtp',
        'Concurrent status','Body','started',clock_timestamp(),true,'prepared')
    `, [`send:concurrent:${suffix}`, `key:concurrent:${suffix}`, `identity:concurrent:${suffix}`,
      `scope:concurrent:${suffix}`, `${suffix}@example.org`, `draft:concurrent:${suffix}`]);

    for (const lateStatus of ['unknown', 'failed']) {
      const suffix = `accepted-before-${lateStatus}`;
      await seed(suffix);
      await first.query('begin');
      await first.query(`
        update public.softora_mailbox_send_provenance
        set status='accepted',dispatch_state='finished' where intent_id=$1
      `, [`send:concurrent:${suffix}`]);
      const lateUpdate = second.query(`
        update public.softora_mailbox_send_provenance set status=$2,
          dispatch_state=case when $2='failed' then 'finished' else 'started' end
        where intent_id=$1
      `, [`send:concurrent:${suffix}`, lateStatus]);
      await assertBlocked(lateUpdate, `${lateStatus} achter accepted`);
      await first.query('commit');
      await assert.rejects(lateUpdate, (error) => error.code === '23514');
    }

    await seed('unknown-before-accepted');
    await first.query('begin');
    await first.query(`
      update public.softora_mailbox_send_provenance set status='unknown'
      where intent_id='send:concurrent:unknown-before-accepted'
    `);
    const acceptUpdate = second.query(`
      update public.softora_mailbox_send_provenance set status='accepted',dispatch_state='finished'
      where intent_id='send:concurrent:unknown-before-accepted'
    `);
    await assertBlocked(acceptUpdate, 'accepted achter unknown');
    await first.query('commit');
    await acceptUpdate;
    assert.equal((await setup.query(`
      select status from public.softora_mailbox_send_provenance
      where intent_id='send:concurrent:unknown-before-accepted'
    `)).rows[0].status, 'accepted');
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
        has_table_privilege('service_role','public.softora_mailbox_send_provenance','SELECT') as provenance_service_select,
        has_table_privilege('service_role','public.softora_mailbox_send_provenance','INSERT') as provenance_service_insert,
        has_table_privilege('service_role','public.softora_mailbox_send_provenance','UPDATE') as provenance_service_update,
        has_table_privilege('service_role','public.softora_mailbox_send_provenance','DELETE') as provenance_service_delete,
        has_table_privilege('service_role','public.softora_mailbox_send_provenance','TRUNCATE') as provenance_service_truncate,
        has_table_privilege('anon','public.softora_mailbox_send_provenance','SELECT') as provenance_anon_select,
        has_table_privilege('authenticated','public.softora_mailbox_send_provenance','SELECT') as provenance_authenticated_select,
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
      provenance_service_select: true,
      provenance_service_insert: true,
      provenance_service_update: true,
      provenance_service_delete: false,
      provenance_service_truncate: false,
      provenance_anon_select: false,
      provenance_authenticated_select: false,
      anon_commit: false,
      authenticated_commit: false,
      service_commit: true,
      anon_trigger: false,
      authenticated_trigger: false,
      service_trigger: true,
    });
  });
}
