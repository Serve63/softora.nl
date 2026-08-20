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
  const contactSearchAndLogicalTombstonesMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260820171023_mailbox_contact_search_and_logical_tombstones.sql'
  ), 'utf8');
  const fullHistorySearchMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260817102256_mailbox_full_history_search.sql'
  ), 'utf8');
  const participantHelpersMarker =
    'create or replace function public.softora_mailbox_search_normalize(';
  const participantHelpersEndMarker =
    'create or replace function public.softora_mailbox_technical_thread_key(';
  const participantHelpersStart = fullHistorySearchMigration.indexOf(participantHelpersMarker);
  const participantHelpersEnd = fullHistorySearchMigration.indexOf(
    participantHelpersEndMarker,
    participantHelpersStart
  );
  if (participantHelpersStart < 0 || participantHelpersEnd <= participantHelpersStart) {
    throw new Error('Getrackte mailbox-participanthelpers missen het verwachte bereik.');
  }
  const participantHelpersMigration = fullHistorySearchMigration.slice(
    participantHelpersStart,
    participantHelpersEnd
  );
  const contactAtomicVisibilityMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260820174711_mailbox_contact_atomic_visibility.sql'
  ), 'utf8');
  const outreachEligibilityMigration = fs.readFileSync(path.resolve(
    __dirname,
    '../../supabase/migrations/20260817145600_mailbox_outreach_eligibility_set.sql'
  ), 'utf8');
  const outreachEligibilityMarker =
    'create or replace function public.softora_mailbox_outreach_contacts(';
  const outreachEligibilityEndMarker =
    'create or replace function public.softora_filter_mailbox_outreach_contacts(';
  const outreachEligibilityStart = outreachEligibilityMigration.indexOf(
    outreachEligibilityMarker
  );
  const outreachEligibilityEnd = outreachEligibilityMigration.indexOf(
    outreachEligibilityEndMarker,
    outreachEligibilityStart
  );
  if (outreachEligibilityStart < 0 || outreachEligibilityEnd <= outreachEligibilityStart) {
    throw new Error('Getrackte mailbox-outreachpredicate mist het verwachte bereik.');
  }
  const outreachEligibilityHelpersMigration = outreachEligibilityMigration.slice(
    outreachEligibilityStart,
    outreachEligibilityEnd
  );
  const logicalTombstoneMarker =
    'create or replace function public.softora_normalize_mailbox_message_id(';
  const logicalTombstoneStart = contactSearchAndLogicalTombstonesMigration.indexOf(
    logicalTombstoneMarker
  );
  if (logicalTombstoneStart < 0) {
    throw new Error('Logische mailbox-tombstonemigratie mist het verwachte startpunt.');
  }
  const logicalTombstoneMigration = contactSearchAndLogicalTombstonesMigration.slice(
    logicalTombstoneStart
  );
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

  function logicalMessageFixture(suffix) {
    const accountEmail = 'serve@softora.nl';
    const messageId = `<logical-lock-${suffix}@test.softora.nl>`;
    return {
      accountEmail,
      messageId,
      normalizedMessageId: messageId.slice(1, -1),
      anchor: {
        messageKey: `logical-lock-${suffix}-inbox`,
        folder: 'inbox',
        uid: 800_000 + suffix,
        providerId: `logical-provider-${suffix}-inbox`,
      },
      copy: {
        messageKey: `logical-lock-${suffix}-coldmail`,
        folder: 'coldmail',
        uid: 810_000 + suffix,
        providerId: `logical-provider-${suffix}-coldmail`,
      },
      newCopy: {
        messageKey: `logical-lock-${suffix}-sent`,
        folder: 'sent',
        uid: 820_000 + suffix,
        providerId: `logical-provider-${suffix}-sent`,
      },
    };
  }

  async function seedLogicalMessageCopies(client, fixture) {
    await client.query(`
      insert into public.softora_mailbox_messages (
        message_key,account_email,folder,uid,provider_id,message_id,sender_email,
        recipients_text,subject,body_text,date,unread,payload
      ) values
        ($1,$2,$3,$4,$5,$6,'prospect@example.org',$2,'Seed inbox','Seed inbox',now(),true,'{"source":"imap-sync"}'::jsonb),
        ($7,$2,$8,$9,$10,$6,'prospect@example.org',$2,'Seed coldmail','Seed coldmail',now(),true,'{"source":"imap-sync"}'::jsonb)
    `, [
      fixture.anchor.messageKey,
      fixture.accountEmail,
      fixture.anchor.folder,
      fixture.anchor.uid,
      fixture.anchor.providerId,
      fixture.messageId,
      fixture.copy.messageKey,
      fixture.copy.folder,
      fixture.copy.uid,
      fixture.copy.providerId,
    ]);
  }

  function setLogicalMessageVisibility(client, fixture, hidden) {
    return client.query(
      `select * from public.softora_set_mailbox_message_visibility($1,$2,$3,$4,$5)`,
      [
        fixture.accountEmail,
        fixture.anchor.folder,
        fixture.anchor.uid,
        fixture.anchor.providerId,
        hidden,
      ]
    );
  }

  function syncUpsertLogicalMessage(client, fixture, label) {
    return client.query(`
      insert into public.softora_mailbox_messages (
        message_key,account_email,folder,uid,provider_id,message_id,sender_email,
        recipients_text,subject,body_text,date,unread,payload,deleted_at
      ) values (
        $1,$2,$3,$4,$5,$6,'prospect@example.org',$2,$7,$8,now(),true,$9::jsonb,null
      )
      on conflict (message_key) do update set
        account_email=excluded.account_email,
        folder=excluded.folder,
        uid=excluded.uid,
        provider_id=excluded.provider_id,
        message_id=excluded.message_id,
        subject=excluded.subject,
        body_text=excluded.body_text,
        payload=excluded.payload,
        deleted_at=excluded.deleted_at,
        updated_at=clock_timestamp()
      returning message_key,subject,deleted_at
    `, [
      fixture.anchor.messageKey,
      fixture.accountEmail,
      fixture.anchor.folder,
      fixture.anchor.uid,
      fixture.anchor.providerId,
      fixture.messageId,
      label,
      `${label} body`,
      JSON.stringify({ source: 'imap-sync' }),
    ]);
  }

  function syncInsertLogicalMessageCopy(client, fixture, label) {
    return client.query(`
      insert into public.softora_mailbox_messages (
        message_key,account_email,folder,uid,provider_id,message_id,sender_email,
        recipients_text,subject,body_text,date,unread,payload,deleted_at
      ) values (
        $1,$2,$3,$4,$5,$6,'prospect@example.org',$2,$7,$8,now(),true,$9::jsonb,null
      )
      returning message_key,subject,deleted_at
    `, [
      fixture.newCopy.messageKey,
      fixture.accountEmail,
      fixture.newCopy.folder,
      fixture.newCopy.uid,
      fixture.newCopy.providerId,
      fixture.messageId,
      label,
      `${label} body`,
      JSON.stringify({ source: 'imap-sync', lockOrderProbe: 'pause-before-tombstone' }),
    ]);
  }

  async function assertLogicalMessageVisibility(client, fixture, {
    hidden,
    syncLabel,
    syncMessageKey = fixture.anchor.messageKey,
    expectedCopies = 2,
  }) {
    const rows = (await client.query(`
      select message_key,subject,deleted_at::text as deleted_at
      from public.softora_mailbox_messages
      where account_email=$1
        and public.softora_normalize_mailbox_message_id(message_id)=$2
      order by message_key
    `, [fixture.accountEmail, fixture.normalizedMessageId])).rows;
    assert.equal(rows.length, expectedCopies);
    assert.equal(
      rows.find((row) => row.message_key === syncMessageKey)?.subject,
      syncLabel
    );
    const tombstones = (await client.query(`
      select deleted_at::text as deleted_at
      from public.softora_mailbox_message_tombstones
      where account_email=$1 and normalized_message_id=$2
    `, [fixture.accountEmail, fixture.normalizedMessageId])).rows;
    if (hidden) {
      assert.equal(tombstones.length, 1);
      assert.ok(rows.every((row) => row.deleted_at === tombstones[0].deleted_at));
    } else {
      assert.equal(tombstones.length, 0);
      assert.ok(rows.every((row) => row.deleted_at === null));
    }
  }

  async function seedContactRows(client, rows) {
    await client.query(`
      insert into public.softora_mailbox_messages (
        message_key,account_email,folder,uid,provider_id,message_id,sender_name,
        sender_email,recipients_text,subject,preview,body_text,date,internal_date,
        unread,payload
      )
      select
        incoming.message_key,incoming.account_email,incoming.folder,incoming.uid,
        incoming.provider_id,incoming.message_id,'Contact',incoming.sender_email,
        incoming.recipients_text,incoming.subject,incoming.subject,incoming.subject,
        incoming.date,incoming.date,true,incoming.payload
      from pg_catalog.jsonb_to_recordset($1::jsonb) as incoming(
        message_key text,account_email text,folder text,uid bigint,provider_id text,
        message_id text,sender_email text,recipients_text text,subject text,
        date timestamptz,payload jsonb
      )
    `, [JSON.stringify(rows)]);
  }

  function contactRow({
    prefix,
    accountEmail,
    contactEmail,
    logicalNumber,
    copyNumber = 1,
    uidBase,
    folder = 'inbox',
    messageId = `<${prefix}-${logicalNumber}@contact.test>`,
  }) {
    const uid = uidBase + (logicalNumber * 10) + copyNumber;
    return {
      message_key: `${prefix}|${accountEmail}|${logicalNumber}|${copyNumber}`,
      account_email: accountEmail,
      folder,
      uid,
      provider_id: `${folder}:${uid}:${prefix}`,
      message_id: messageId,
      sender_email: contactEmail,
      recipients_text: accountEmail,
      subject: `${prefix} logisch bericht ${logicalNumber}`,
      date: new Date(Date.UTC(2026, 7, 20, 8, logicalNumber, copyNumber)).toISOString(),
      payload: { source: 'imap-sync' },
    };
  }

  function setContactVisibility(client, {
    ownerAccounts,
    contactEmail,
    anchor,
    expectedMessageCount,
    hidden,
  }) {
    return client.query(`
      select * from public.softora_set_mailbox_contact_visibility(
        $1::text[],$2,$3,$4,$5,$6,$7,$8
      )
    `, [
      ownerAccounts,
      contactEmail,
      anchor.account_email,
      anchor.folder,
      anchor.uid,
      anchor.provider_id,
      expectedMessageCount,
      hidden,
    ]);
  }

  async function contactVisibilityState(client, { ownerAccounts, contactEmail }) {
    const messages = (await client.query(`
      select message_key,account_email,message_id,deleted_at::text as deleted_at,
        updated_at::text as updated_at
      from public.softora_mailbox_messages m
      where pg_catalog.lower(pg_catalog.btrim(m.account_email)) = any($1::text[])
        and $2 = any(public.softora_mailbox_message_participants(
          m.sender_email,m.recipients_text,m.payload
        ))
        and m.generation_superseded_at is null
      order by message_key
    `, [ownerAccounts, contactEmail])).rows;
    const messageIds = Array.from(new Set(messages.map((row) =>
      String(row.message_id || '').replace(/^<|>$/g, '').toLowerCase()
    ))).filter(Boolean).sort();
    const tombstones = (await client.query(`
      select account_email,normalized_message_id,deleted_at::text as deleted_at,
        updated_at::text as updated_at
      from public.softora_mailbox_message_tombstones
      where account_email = any($1::text[])
        and normalized_message_id = any($2::text[])
      order by account_email,normalized_message_id
    `, [ownerAccounts, messageIds])).rows;
    return { messages, tombstones };
  }

  async function waitForBackendPgSleep(observer, backendPid, label) {
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      const state = (await observer.query(`
        select state,wait_event_type,wait_event
        from pg_catalog.pg_stat_activity where pid=$1
      `, [backendPid])).rows[0];
      if (state?.state === 'active' && state?.wait_event === 'PgSleep') return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.fail(`${label} bereikte het gecontroleerde rowlock-venster niet`);
  }

  async function assertLogicalTombstoneLockProtocol(client) {
    const triggerDefinition = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_inherit_mailbox_message_tombstone()'::regprocedure
      ) as definition
    `)).rows[0].definition.toLowerCase();
    const advisoryMatches = triggerDefinition.match(/pg_advisory_xact_lock/g) || [];
    const insertBranch = triggerDefinition.indexOf("if tg_op = 'insert' then");
    const advisoryLock = triggerDefinition.indexOf('pg_advisory_xact_lock', insertBranch);
    const insertBranchEnd = triggerDefinition.indexOf('end if;', advisoryLock);
    assert.equal(advisoryMatches.length, 1);
    assert.ok(insertBranch >= 0 && advisoryLock > insertBranch && insertBranchEnd > advisoryLock);

    const visibilityDefinition = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_set_mailbox_message_visibility(text,text,bigint,text,boolean)'::regprocedure
      ) as definition
    `)).rows[0].definition.toLowerCase();
    const visibilityAdvisory = visibilityDefinition.indexOf('pg_advisory_xact_lock');
    const logicalRowLock = visibilityDefinition.indexOf('for update', visibilityAdvisory);
    assert.ok(visibilityAdvisory >= 0 && logicalRowLock > visibilityAdvisory);

    const contactVisibilityDefinition = (await client.query(`
      select pg_catalog.pg_get_functiondef(
        'public.softora_set_mailbox_contact_visibility(text[],text,text,text,bigint,text,integer,boolean)'::regprocedure
      ) as definition
    `)).rows[0].definition.toLowerCase();
    const globalConsistencyLock = contactVisibilityDefinition.indexOf(
      'from public.softora_mailbox_campaign_consistency'
    );
    const globalForUpdate = contactVisibilityDefinition.indexOf(
      'for update',
      globalConsistencyLock
    );
    const sortedLogicalPairs = contactVisibilityDefinition.indexOf(
      'order by owner_account, normalized_message_id'
    );
    const contactAdvisory = contactVisibilityDefinition.indexOf(
      'pg_advisory_xact_lock',
      sortedLogicalPairs
    );
    const concreteRows = contactVisibilityDefinition.indexOf(
      'order by m.message_key',
      contactAdvisory
    );
    const concreteForUpdate = contactVisibilityDefinition.indexOf(
      'for update',
      concreteRows
    );
    const outreachCheck = contactVisibilityDefinition.indexOf(
      'softora_mailbox_is_outreach_contact'
    );
    const tombstoneWrite = contactVisibilityDefinition.indexOf(
      'insert into public.softora_mailbox_message_tombstones'
    );
    assert.ok(globalConsistencyLock >= 0 && globalForUpdate > globalConsistencyLock);
    assert.ok(sortedLogicalPairs > globalForUpdate && contactAdvisory > sortedLogicalPairs);
    assert.ok(concreteRows > contactAdvisory && concreteForUpdate > concreteRows);
    assert.ok(outreachCheck > concreteForUpdate && tombstoneWrite > outreachCheck);
  }

  async function installTombstonePauseTrigger(client) {
    await client.query(`
      create or replace function public.softora_test_pause_before_tombstone()
      returns trigger
      language plpgsql
      set search_path = ''
      as $function$
      begin
        if new.payload->>'lockOrderProbe' = 'pause-before-tombstone' then
          perform pg_catalog.pg_sleep(1.5);
        end if;
        return new;
      end;
      $function$;
      drop trigger if exists aaa_softora_test_pause_before_tombstone
        on public.softora_mailbox_messages;
      create trigger aaa_softora_test_pause_before_tombstone
      before insert
      on public.softora_mailbox_messages
      for each row execute function public.softora_test_pause_before_tombstone();
    `);
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
        uid_validity bigint, generation_superseded_at timestamptz,
        unique (account_email, folder, uid)
      );
      create table public.softora_mailbox_sync_state (
        sync_key text primary key,
        account_email text not null,
        folder text not null,
        status text not null default 'idle'
          check (status in ('idle', 'syncing', 'ok', 'error')),
        last_synced_at timestamptz,
        sync_started_at timestamptz,
        lock_token text,
        lock_expires_at timestamptz,
        last_uid bigint,
        message_count integer not null default 0,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create table public.softora_outbound_recipient_guards (
        key_type text not null,
        key_value text not null,
        recipient_email text,
        sender_email text not null,
        channel text not null,
        provider text not null,
        permanent boolean not null default true
      );
      create or replace function public.softora_normalize_mailbox_message_id(p_value text)
      returns text
      language sql
      immutable
      set search_path = ''
      as $function$
        select nullif(
          lower(
            regexp_replace(
              btrim(coalesce(p_value, '')),
              '^[<>,[:space:]]+|[<>,[:space:]]+$',
              '',
              'g'
            )
          ),
          ''
        );
      $function$;
      create or replace function public.softora_mailbox_direct_parent_ids(
        p_in_reply_to text,
        p_references_text text
      )
      returns text[]
      language plpgsql
      immutable
      set search_path = ''
      as $function$
      declare
        v_source text;
        v_token text;
        v_normalized text;
        v_ids text[] := '{}'::text[];
        v_uses_references boolean := nullif(btrim(coalesce(p_in_reply_to, '')), '') is null;
      begin
        v_source := case
          when v_uses_references then coalesce(p_references_text, '')
          else coalesce(p_in_reply_to, '')
        end;
        foreach v_token in array regexp_split_to_array(
          regexp_replace(v_source, ',', ' ', 'g'),
          '[[:space:]]+'
        ) loop
          v_normalized := public.softora_normalize_mailbox_message_id(v_token);
          if v_normalized is not null and not v_normalized = any (v_ids) then
            v_ids := array_append(v_ids, v_normalized);
          end if;
        end loop;
        if v_uses_references and cardinality(v_ids) > 1 then
          return array[v_ids[cardinality(v_ids)]];
        end if;
        return v_ids;
      end;
      $function$;
      revoke all on function public.softora_normalize_mailbox_message_id(text)
        from public, anon, authenticated;
      revoke all on function public.softora_mailbox_direct_parent_ids(text, text)
        from public, anon, authenticated;
      grant execute on function public.softora_normalize_mailbox_message_id(text)
        to service_role;
      grant execute on function public.softora_mailbox_direct_parent_ids(text, text)
        to service_role;
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
      `\n${sendProvenanceFoundation}\n${legacySendSeedSql}\n${providerOutcomeMigration}` +
      `\n${participantHelpersMigration}\n${logicalTombstoneMigration}` +
      `\n${outreachEligibilityHelpersMigration}\n${contactAtomicVisibilityMigration}`
    );
  });

  test.after(async () => {
    await Promise.all(Array.from(clients, (client) => client.end().catch(() => null)));
  });

  test('logische tombstonemigratie behoudt het live Message-ID-normalizercontract', async () => {
    const client = await connect();
    const normalizer = (await client.query(`
      select
        p.proargnames,
        p.proparallel,
        public.softora_normalize_mailbox_message_id(null) is null as null_stays_null,
        public.softora_normalize_mailbox_message_id('') is null as empty_stays_null,
        public.softora_normalize_mailbox_message_id(' <>, ') is null as punctuation_stays_null,
        public.softora_normalize_mailbox_message_id(' <<Mixed@Id.COM>>, ')
          = 'mixed@id.com' as valid_id_normalized,
        public.softora_mailbox_direct_parent_ids('', ' <>, ,  ') as empty_parent_ids
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'softora_normalize_mailbox_message_id'
    `)).rows[0];
    assert.deepEqual(normalizer, {
      proargnames: ['p_value'],
      proparallel: 'u',
      null_stays_null: true,
      empty_stays_null: true,
      punctuation_stays_null: true,
      valid_id_normalized: true,
      empty_parent_ids: [],
    });
  });

  test('UIDVALIDITY-retirement maakt geen logische verwijdertombstone', async () => {
    const client = await connect();
    await client.query(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        date, payload, uid_validity
      ) values (
        'uidvalidity-old', 'serve@softora.nl', 'inbox', 9801,
        'inbox:9801', '<uidvalidity-retirement@test>', now(), '{}', 111
      );
      update public.softora_mailbox_messages
      set
        deleted_at = clock_timestamp(),
        generation_superseded_at = clock_timestamp(),
        updated_at = clock_timestamp()
      where message_key = 'uidvalidity-old';
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        date, payload, uid_validity
      ) values (
        'uidvalidity-new', 'serve@softora.nl', 'inbox', 9802,
        'inbox:9802', '<UIDVALIDITY-RETIREMENT@TEST>', now(), '{}', 222
      );
    `);
    const states = (await client.query(`
      select message_key, deleted_at is not null as deleted,
        generation_superseded_at is not null as generation_superseded
      from public.softora_mailbox_messages
      where message_key in ('uidvalidity-old', 'uidvalidity-new')
      order by message_key
    `)).rows;
    assert.deepEqual(states, [
      { message_key: 'uidvalidity-new', deleted: false, generation_superseded: false },
      { message_key: 'uidvalidity-old', deleted: true, generation_superseded: true },
    ]);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_message_tombstones
      where account_email = 'serve@softora.nl'
        and normalized_message_id = 'uidvalidity-retirement@test'
    `)).rows[0].count, 0);
  });

  test('logische hide en restore muteren nooit een UIDVALIDITY-retired kopie', async () => {
    const client = await connect();
    await client.query(`
      insert into public.softora_mailbox_messages (
        message_key, account_email, folder, uid, provider_id, message_id,
        date, payload, deleted_at, uid_validity, generation_superseded_at
      ) values
        (
          'visibility-retired', 'serve@softora.nl', 'inbox', 9811,
          'inbox:9811', '<visibility-generation@test>', now(), '{}',
          clock_timestamp(), 111, clock_timestamp()
        ),
        (
          'visibility-current', 'serve@softora.nl', 'allmail', 9812,
          'allmail:9812', '<VISIBILITY-GENERATION@TEST>', now(), '{}',
          null, 222, null
        );
    `);
    const retiredBefore = (await client.query(`
      select deleted_at::text as deleted_at
      from public.softora_mailbox_messages
      where message_key = 'visibility-retired'
    `)).rows[0].deleted_at;
    const hidden = await client.query(`
      select * from public.softora_set_mailbox_message_visibility(
        'serve@softora.nl', 'allmail', 9812, 'allmail:9812', true
      )
    `);
    assert.equal(hidden.rowCount, 1);
    const retiredAfterHide = (await client.query(`
      select deleted_at::text as deleted_at
      from public.softora_mailbox_messages
      where message_key = 'visibility-retired'
    `)).rows[0].deleted_at;
    assert.equal(retiredAfterHide, retiredBefore);

    const restored = await client.query(`
      select * from public.softora_set_mailbox_message_visibility(
        'serve@softora.nl', 'allmail', 9812, 'allmail:9812', false
      )
    `);
    assert.equal(restored.rowCount, 1);
    const states = (await client.query(`
      select message_key, deleted_at is not null as deleted,
        generation_superseded_at is not null as generation_superseded
      from public.softora_mailbox_messages
      where message_key in ('visibility-retired', 'visibility-current')
      order by message_key
    `)).rows;
    assert.deepEqual(states, [
      { message_key: 'visibility-current', deleted: false, generation_superseded: false },
      { message_key: 'visibility-retired', deleted: true, generation_superseded: true },
    ]);
    assert.equal((await client.query(`
      select deleted_at::text as deleted_at
      from public.softora_mailbox_messages
      where message_key = 'visibility-retired'
    `)).rows[0].deleted_at, retiredBefore);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_message_tombstones
      where account_email = 'serve@softora.nl'
        and normalized_message_id = 'visibility-generation@test'
    `)).rows[0].count, 0);
    const staleTarget = await client.query(`
      select * from public.softora_set_mailbox_message_visibility(
        'serve@softora.nl', 'inbox', 9811, 'inbox:9811', true
      )
    `);
    assert.equal(staleTarget.rowCount, 0);
  });

  test('Grow-analogie verbergt 10 logische en 14 fysieke Serve-kopieën volledig, duurzaam en retry-idempotent', async () => {
    const client = await connect();
    const ownerAccounts = ['servec321@gmail.com', 'serve@softora.nl'];
    const contactEmail = 'serve@growsocialmedia.nl';
    const rows = [];
    for (let logicalNumber = 1; logicalNumber <= 10; logicalNumber += 1) {
      rows.push(contactRow({
        prefix: 'grow-analogy',
        accountEmail: ownerAccounts[0],
        contactEmail,
        logicalNumber,
        uidBase: 1_000_000,
        folder: logicalNumber === 1 ? 'coldmail' : (logicalNumber % 2 ? 'inbox' : 'sent'),
      }));
    }
    for (let logicalNumber = 1; logicalNumber <= 4; logicalNumber += 1) {
      rows.push(contactRow({
        prefix: 'grow-analogy',
        accountEmail: ownerAccounts[1],
        contactEmail,
        logicalNumber,
        copyNumber: 2,
        uidBase: 1_100_000,
        folder: logicalNumber % 2 ? 'inbox' : 'sent',
      }));
    }
    const martijnCopy = contactRow({
      prefix: 'grow-analogy',
      accountEmail: 'martijn@softora.nl',
      contactEmail,
      logicalNumber: 1,
      copyNumber: 3,
      uidBase: 1_200_000,
      folder: 'inbox',
    });
    await seedContactRows(client, [...rows, martijnCopy]);
    const anchor = rows[0];

    const hidden = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail,
      anchor,
      expectedMessageCount: 10,
      hidden: true,
    });
    assert.equal(hidden.rowCount, 14);
    const hiddenState = await contactVisibilityState(client, { ownerAccounts, contactEmail });
    assert.equal(hiddenState.messages.length, 14);
    assert.ok(hiddenState.messages.every((row) => row.deleted_at));
    assert.equal(hiddenState.tombstones.length, 20);
    assert.equal((await client.query(`
      select deleted_at is null as visible
      from public.softora_mailbox_messages where message_key=$1
    `, [martijnCopy.message_key])).rows[0].visible, true);
    assert.equal((await client.query(`
      select count(*)::integer as count
      from public.softora_mailbox_message_tombstones
      where account_email='martijn@softora.nl'
        and normalized_message_id like 'grow-analogy-%@contact.test'
    `)).rows[0].count, 0);

    const hideReplay = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail,
      anchor,
      expectedMessageCount: 10,
      hidden: true,
    });
    assert.equal(hideReplay.rowCount, 14);
    assert.deepEqual(
      await contactVisibilityState(client, { ownerAccounts, contactEmail }),
      hiddenState,
      'ambiguous timeout-retry mag hidden/tombstone timestamps niet herschrijven'
    );

    const laterCopy = contactRow({
      prefix: 'grow-analogy',
      accountEmail: ownerAccounts[1],
      contactEmail,
      logicalNumber: 10,
      copyNumber: 2,
      uidBase: 1_100_000,
      folder: 'inbox',
    });
    await seedContactRows(client, [laterCopy]);
    const inherited = (await client.query(`
      select deleted_at::text as deleted_at
      from public.softora_mailbox_messages where message_key=$1
    `, [laterCopy.message_key])).rows[0];
    assert.ok(inherited.deleted_at, 'latere kopie op tweede Serve-account erft tombstone');

    const restored = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail,
      anchor,
      expectedMessageCount: 0,
      hidden: false,
    });
    assert.equal(restored.rowCount, 15);
    const restoredState = await contactVisibilityState(client, { ownerAccounts, contactEmail });
    assert.equal(restoredState.messages.length, 15);
    assert.ok(restoredState.messages.every((row) => row.deleted_at === null));
    assert.equal(restoredState.tombstones.length, 0);

    const restoreReplay = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail,
      anchor,
      expectedMessageCount: 0,
      hidden: false,
    });
    assert.equal(restoreReplay.rowCount, 15);
    assert.deepEqual(
      await contactVisibilityState(client, { ownerAccounts, contactEmail }),
      restoredState,
      'ambiguous restore-retry mag zichtbare rows niet opnieuw muteren'
    );
  });

  test('contact-RPC vult legacy partial hide aan en normaliseert partial restore zonder andere eigenaar', async () => {
    const client = await connect();
    const ownerAccounts = ['serve@softora.nl', 'servec321@gmail.com'];
    const hideContact = 'partial-hide@example.org';
    const hideRows = [1, 2, 3].map((logicalNumber) => contactRow({
      prefix: 'partial-hide',
      accountEmail: ownerAccounts[0],
      contactEmail: hideContact,
      logicalNumber,
      uidBase: 1_300_000,
      folder: logicalNumber === 1 ? 'coldmail' : 'inbox',
    }));
    await seedContactRows(client, hideRows);
    await client.query(`
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
      where message_key=$1
    `, [hideRows[2].message_key]);
    const partialBefore = await contactVisibilityState(client, {
      ownerAccounts,
      contactEmail: hideContact,
    });
    assert.equal(partialBefore.messages.filter((row) => row.deleted_at).length, 1);
    assert.equal(partialBefore.tombstones.length, 1);

    const completedHide = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail: hideContact,
      anchor: hideRows[0],
      expectedMessageCount: 2,
      hidden: true,
    });
    assert.equal(completedHide.rowCount, 3);
    const completedState = await contactVisibilityState(client, {
      ownerAccounts,
      contactEmail: hideContact,
    });
    assert.ok(completedState.messages.every((row) => row.deleted_at));
    assert.equal(completedState.tombstones.length, 6);

    const restoreContact = 'partial-restore@example.org';
    const restoreRows = [1, 2, 3].map((logicalNumber) => contactRow({
      prefix: 'partial-restore',
      accountEmail: ownerAccounts[0],
      contactEmail: restoreContact,
      logicalNumber,
      uidBase: 1_400_000,
      folder: logicalNumber === 1 ? 'coldmail' : 'inbox',
    }));
    await seedContactRows(client, restoreRows);
    await client.query(`
      update public.softora_mailbox_messages
      set deleted_at=clock_timestamp(),updated_at=clock_timestamp()
      where message_key=$1
    `, [restoreRows[1].message_key]);
    const repairedRestore = await setContactVisibility(client, {
      ownerAccounts,
      contactEmail: restoreContact,
      anchor: restoreRows[0],
      expectedMessageCount: 0,
      hidden: false,
    });
    assert.equal(repairedRestore.rowCount, 3);
    const repairedState = await contactVisibilityState(client, {
      ownerAccounts,
      contactEmail: restoreContact,
    });
    assert.ok(repairedState.messages.every((row) => row.deleted_at === null));
    assert.equal(repairedState.tombstones.length, 0);
  });

  test('contact-RPC weigert count-drift, 101 logische berichten en ontbrekende RFC-ID vóór writes', async () => {
    const client = await connect();
    const ownerAccounts = ['serve@softora.nl', 'servec321@gmail.com'];
    const mismatchContact = 'count-mismatch@example.org';
    const mismatchRows = [1, 2].map((logicalNumber) => contactRow({
      prefix: 'count-mismatch',
      accountEmail: ownerAccounts[0],
      contactEmail: mismatchContact,
      logicalNumber,
      uidBase: 1_500_000,
      folder: logicalNumber === 1 ? 'coldmail' : 'inbox',
    }));
    await seedContactRows(client, mismatchRows);
    await assert.rejects(setContactVisibility(client, {
      ownerAccounts,
      contactEmail: mismatchContact,
      anchor: mismatchRows[0],
      expectedMessageCount: 1,
      hidden: true,
    }), (error) => error.code === '22023');

    const capContact = 'over-cap@example.org';
    const capRows = Array.from({ length: 101 }, (_, index) => contactRow({
      prefix: 'over-cap',
      accountEmail: ownerAccounts[0],
      contactEmail: capContact,
      logicalNumber: index + 1,
      uidBase: 1_600_000,
      folder: index === 0 ? 'coldmail' : 'inbox',
    }));
    await seedContactRows(client, capRows);
    await assert.rejects(setContactVisibility(client, {
      ownerAccounts,
      contactEmail: capContact,
      anchor: capRows[0],
      expectedMessageCount: 100,
      hidden: true,
    }), (error) => error.code === '22023');

    const noRfcContact = 'no-rfc@example.org';
    const noRfcRow = contactRow({
      prefix: 'no-rfc',
      accountEmail: ownerAccounts[0],
      contactEmail: noRfcContact,
      logicalNumber: 1,
      uidBase: 1_700_000,
      folder: 'coldmail',
      messageId: '',
    });
    await seedContactRows(client, [noRfcRow]);
    await assert.rejects(setContactVisibility(client, {
      ownerAccounts,
      contactEmail: noRfcContact,
      anchor: noRfcRow,
      expectedMessageCount: 1,
      hidden: true,
    }), (error) => error.code === '22023');

    for (const [contactEmail, expectedRows] of [
      [mismatchContact, 2],
      [capContact, 101],
      [noRfcContact, 1],
    ]) {
      const state = await contactVisibilityState(client, { ownerAccounts, contactEmail });
      assert.equal(state.messages.length, expectedRows);
      assert.ok(state.messages.every((row) => row.deleted_at === null));
      assert.equal(state.tombstones.length, 0);
    }
  });

  test('contact-RPC weigert verkeerde anchor, eigenaar en contact zonder enige mutatie', async () => {
    const client = await connect();
    const ownerAccounts = ['serve@softora.nl', 'servec321@gmail.com'];
    const contactEmail = 'anchor-scope@example.org';
    const anchor = contactRow({
      prefix: 'anchor-scope',
      accountEmail: ownerAccounts[0],
      contactEmail,
      logicalNumber: 1,
      uidBase: 1_800_000,
      folder: 'coldmail',
    });
    await seedContactRows(client, [anchor]);
    const attempts = [
      { ownerAccounts, contactEmail, anchor: { ...anchor, provider_id: 'wrong-provider' } },
      { ownerAccounts: ['martijn@softora.nl'], contactEmail, anchor },
      { ownerAccounts, contactEmail: 'other-contact@example.org', anchor },
      { ownerAccounts, contactEmail, anchor: { ...anchor, uid: anchor.uid + 1 } },
    ];
    for (const attempt of attempts) {
      await assert.rejects(setContactVisibility(client, {
        ...attempt,
        expectedMessageCount: 1,
        hidden: true,
      }), (error) => error.code === '22023');
    }
    const state = await contactVisibilityState(client, { ownerAccounts, contactEmail });
    assert.equal(state.messages.length, 1);
    assert.equal(state.messages[0].deleted_at, null);
    assert.equal(state.tombstones.length, 0);
  });

  test('contact-hide rolt cartesiaanse tombstones terug als message-update halverwege faalt', async () => {
    const client = await connect();
    const ownerAccounts = ['serve@softora.nl', 'servec321@gmail.com'];
    const contactEmail = 'rollback-after-tombstones@example.org';
    const anchor = {
      ...contactRow({
        prefix: 'rollback-after-tombstones',
        accountEmail: ownerAccounts[0],
        contactEmail,
        logicalNumber: 1,
        uidBase: 1_850_000,
        folder: 'coldmail',
      }),
      payload: { source: 'imap-sync', contactVisibilityRollbackProbe: '1' },
    };
    await seedContactRows(client, [anchor]);
    await client.query(`
      create or replace function public.softora_test_reject_contact_visibility_update()
      returns trigger
      language plpgsql
      set search_path = ''
      as $function$
      begin
        if new.payload->>'contactVisibilityRollbackProbe' = '1'
          and old.deleted_at is null
          and new.deleted_at is not null then
          raise exception 'gecontroleerde message-updatefout na tombstonewrites';
        end if;
        return new;
      end;
      $function$;
      drop trigger if exists zzz_softora_test_reject_contact_visibility_update
        on public.softora_mailbox_messages;
      create trigger zzz_softora_test_reject_contact_visibility_update
      before update of deleted_at
      on public.softora_mailbox_messages
      for each row execute function public.softora_test_reject_contact_visibility_update();
    `);
    try {
      await assert.rejects(setContactVisibility(client, {
        ownerAccounts,
        contactEmail,
        anchor,
        expectedMessageCount: 1,
        hidden: true,
      }), (error) => error.code === 'P0001');
      const state = await contactVisibilityState(client, { ownerAccounts, contactEmail });
      assert.equal(state.messages.length, 1);
      assert.equal(state.messages[0].deleted_at, null);
      assert.equal(state.tombstones.length, 0);
    } finally {
      await client.query(`
        drop trigger if exists zzz_softora_test_reject_contact_visibility_update
          on public.softora_mailbox_messages;
        drop function if exists public.softora_test_reject_contact_visibility_update();
      `);
    }
  });

  test('contact-hide versus nieuwe cross-account synckopie eindigt zonder deadlock volledig hidden', { timeout: 10_000 }, async () => {
    const setup = await connect();
    const sync = await connect();
    const visibility = await connect();
    const ownerAccounts = ['serve@softora.nl', 'servec321@gmail.com'];
    const contactEmail = 'contact-race@example.org';
    const rows = [1, 2].map((logicalNumber) => contactRow({
      prefix: 'contact-race',
      accountEmail: ownerAccounts[0],
      contactEmail,
      logicalNumber,
      uidBase: 1_900_000,
      folder: logicalNumber === 1 ? 'coldmail' : 'inbox',
    }));
    await seedContactRows(setup, rows);
    await installTombstonePauseTrigger(setup);
    const newCopy = {
      ...contactRow({
        prefix: 'contact-race',
        accountEmail: ownerAccounts[1],
        contactEmail,
        logicalNumber: 1,
        copyNumber: 2,
        uidBase: 2_000_000,
        folder: 'inbox',
      }),
      payload: { source: 'imap-sync', lockOrderProbe: 'pause-before-tombstone' },
    };
    const backendPid = (await sync.query(
      'select pg_catalog.pg_backend_pid()::integer as pid'
    )).rows[0].pid;
    let syncTransactionOpen = false;
    let insertPromise = null;
    let hidePromise = null;
    try {
      await sync.query('begin');
      syncTransactionOpen = true;
      insertPromise = seedContactRows(sync, [newCopy]);
      void insertPromise.catch(() => null);
      await waitForBackendPgSleep(visibility, backendPid, 'contact-sync vóór hide');
      hidePromise = setContactVisibility(visibility, {
        ownerAccounts,
        contactEmail,
        anchor: rows[0],
        expectedMessageCount: 2,
        hidden: true,
      });
      void hidePromise.catch(() => null);
      await assertBlocked(hidePromise, 'contact-hide achter sync-global lock');
      await insertPromise;
      insertPromise = null;
      await sync.query('commit');
      syncTransactionOpen = false;
      const hidden = await hidePromise;
      hidePromise = null;
      assert.equal(hidden.rowCount, 3);
      const state = await contactVisibilityState(visibility, { ownerAccounts, contactEmail });
      assert.equal(state.messages.length, 3);
      assert.ok(state.messages.every((row) => row.deleted_at));
      assert.equal(state.tombstones.length, 4);
    } finally {
      if (syncTransactionOpen) await sync.query('rollback').catch(() => null);
      if (insertPromise) await insertPromise.catch(() => null);
      if (hidePromise) await hidePromise.catch(() => null);
    }
  });

  test('nieuwe-copy INSERT versus hide en restore vermijdt de global/logical-deadlock', async (t) => {
    const cases = [
      { operation: 'hide', hidden: true, suffix: 691 },
      { operation: 'restore', hidden: false, suffix: 692 },
    ];
    for (const [index, entry] of cases.entries()) {
      await t.test(entry.operation, { timeout: 10_000 }, async () => {
        const sync = await connect();
        const visibility = await connect();
        const fixture = logicalMessageFixture(entry.suffix);
        if (index === 0) {
          await assertLogicalTombstoneLockProtocol(sync);
          const settings = (await sync.query(`
            select current_setting('statement_timeout') as statement_timeout,
              current_setting('lock_timeout') as lock_timeout
          `)).rows[0];
          assert.deepEqual(settings, { statement_timeout: '8s', lock_timeout: '6s' });
        }
        await installTombstonePauseTrigger(sync);
        await seedLogicalMessageCopies(sync, fixture);
        if (!entry.hidden) {
          const hiddenSeed = await setLogicalMessageVisibility(sync, fixture, true);
          assert.equal(hiddenSeed.rowCount, 2);
        }

        const backendPid = (await sync.query(
          'select pg_catalog.pg_backend_pid()::integer as pid'
        )).rows[0].pid;
        const syncLabel = `Nieuwe sync-kopie tijdens ${entry.operation}`;
        let syncTransactionOpen = false;
        let insertPromise = null;
        let visibilityPromise = null;
        try {
          await sync.query('begin');
          syncTransactionOpen = true;
          // BEFORE STATEMENT owns the global consistency row; the probe pauses
          // the new row before the production INSERT trigger takes its logical lock.
          insertPromise = syncInsertLogicalMessageCopy(sync, fixture, syncLabel);
          void insertPromise.catch(() => null);
          await waitForBackendPgSleep(
            visibility,
            backendPid,
            `nieuwe-copy INSERT vóór ${entry.operation}`
          );

          // The fixed RPC waits on sync's global consistency lock before taking
          // the logical lock; the old order held logical here and formed a cycle.
          visibilityPromise = setLogicalMessageVisibility(visibility, fixture, entry.hidden);
          void visibilityPromise.catch(() => null);
          await assertBlocked(
            visibilityPromise,
            `${entry.operation}-RPC achter INSERT statement-global lock`
          );

          const firstCompleted = await Promise.race([
            insertPromise.then((result) => ({ operation: 'insert', result })),
            visibilityPromise.then((result) => ({ operation: 'visibility', result })),
          ]);
          let insertResult;
          let visibilityResult;
          if (firstCompleted.operation === 'insert') {
            insertResult = firstCompleted.result;
            insertPromise = null;
            await sync.query('commit');
            syncTransactionOpen = false;
            visibilityResult = await visibilityPromise;
            visibilityPromise = null;
          } else {
            visibilityResult = firstCompleted.result;
            visibilityPromise = null;
            insertResult = await insertPromise;
            insertPromise = null;
            await sync.query('commit');
            syncTransactionOpen = false;
          }

          assert.equal(insertResult.rowCount, 1);
          assert.ok([2, 3].includes(visibilityResult.rowCount));
          await assertLogicalMessageVisibility(visibility, fixture, {
            hidden: entry.hidden,
            syncLabel,
            syncMessageKey: fixture.newCopy.messageKey,
            expectedCopies: 3,
          });
        } finally {
          if (syncTransactionOpen) await sync.query('rollback').catch(() => null);
          if (insertPromise) await insertPromise.catch(() => null);
          if (visibilityPromise) await visibilityPromise.catch(() => null);
        }
      });
    }
  });

  test('gecommitteerde hide en restore blijven correct na een wachtende sync-upsert UPDATE', async (t) => {
    const cases = [
      { operation: 'hide', hidden: true, suffix: 711 },
      { operation: 'restore', hidden: false, suffix: 712 },
    ];
    for (const entry of cases) {
      await t.test(entry.operation, { timeout: 10_000 }, async () => {
        const visibility = await connect();
        const sync = await connect();
        const fixture = logicalMessageFixture(entry.suffix);
        await seedLogicalMessageCopies(visibility, fixture);
        if (!entry.hidden) {
          const hiddenSeed = await setLogicalMessageVisibility(visibility, fixture, true);
          assert.equal(hiddenSeed.rowCount, 2);
        }

        const syncLabel = `Sync na ${entry.operation}`;
        let visibilityTransactionOpen = false;
        let syncPromise = null;
        try {
          await visibility.query('begin');
          visibilityTransactionOpen = true;
          const visibilityResult = await setLogicalMessageVisibility(
            visibility,
            fixture,
            entry.hidden
          );
          assert.equal(visibilityResult.rowCount, 2);

          syncPromise = syncUpsertLogicalMessage(sync, fixture, syncLabel);
          await assertBlocked(syncPromise, `sync-upsert achter ${entry.operation}-rowlock`);
          await visibility.query('commit');
          visibilityTransactionOpen = false;

          const syncResult = await syncPromise;
          syncPromise = null;
          assert.equal(syncResult.rowCount, 1);
          await assertLogicalMessageVisibility(sync, fixture, {
            hidden: entry.hidden,
            syncLabel,
          });
        } finally {
          if (visibilityTransactionOpen) await visibility.query('rollback').catch(() => null);
          if (syncPromise) await syncPromise.catch(() => null);
        }
      });
    }
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

    const tombstonePrivileges = (await client.query(`
      select
        c.relrowsecurity as rls_enabled,
        has_table_privilege('service_role','public.softora_mailbox_message_tombstones','SELECT') as service_select,
        has_table_privilege('service_role','public.softora_mailbox_message_tombstones','INSERT') as service_insert,
        has_table_privilege('service_role','public.softora_mailbox_message_tombstones','UPDATE') as service_update,
        has_table_privilege('service_role','public.softora_mailbox_message_tombstones','DELETE') as service_delete,
        has_table_privilege('service_role','public.softora_mailbox_message_tombstones','TRUNCATE') as service_truncate,
        has_table_privilege('anon','public.softora_mailbox_message_tombstones','SELECT') as anon_select,
        has_table_privilege('authenticated','public.softora_mailbox_message_tombstones','SELECT') as authenticated_select
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = 'softora_mailbox_message_tombstones'
    `)).rows[0];
    assert.deepEqual(tombstonePrivileges, {
      rls_enabled: true,
      service_select: true,
      service_insert: true,
      service_update: true,
      service_delete: true,
      service_truncate: false,
      anon_select: false,
      authenticated_select: false,
    });

    const logicalFunctions = (await client.query(`
      select
        p.proname,
        p.prosecdef as security_definer,
        coalesce(pg_catalog.array_to_string(p.proconfig, ','), '')
          ~ '^search_path=(""|)$' as empty_search_path,
        has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = any(array[
          'softora_normalize_mailbox_message_id',
          'softora_inherit_mailbox_message_tombstone',
          'softora_set_mailbox_message_visibility',
          'softora_set_mailbox_contact_visibility'
        ]::text[])
      order by p.proname
    `)).rows;
    assert.equal(logicalFunctions.length, 4);
    for (const functionAcl of logicalFunctions) {
      assert.equal(functionAcl.security_definer, false, functionAcl.proname);
      assert.equal(functionAcl.empty_search_path, true, functionAcl.proname);
      assert.equal(functionAcl.service_execute, true, functionAcl.proname);
      assert.equal(functionAcl.anon_execute, false, functionAcl.proname);
      assert.equal(functionAcl.authenticated_execute, false, functionAcl.proname);
    }
  });
}
