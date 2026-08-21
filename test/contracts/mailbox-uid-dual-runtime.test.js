'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  createMailboxSyncService,
} = require('../../server/services/mailbox-campaign-sync');
const {
  createMailboxImapFetcher,
  runMailboxImapOperationWithDeadline,
} = require('../../server/services/mailbox-imap-fetch');
const {
  createMailboxIndexStore,
} = require('../../server/services/mailbox-index-store');
const {
  MAILBOX_UID_SELECTION_POLICY,
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
} = require('../../server/services/mailbox-uid-validity');

const GENERATION_A = '11111111-1111-4111-8111-111111111111';
const GENERATION_B = '22222222-2222-4222-8222-222222222222';

function futureLeaseExpiry() {
  return new Date(Date.now() + 120_000).toISOString();
}

function createSyncPass(messages = [], overrides = {}) {
  const highestUid = messages.reduce(
    (highest, message) => Math.max(highest, Number(message?.uid) || 0),
    0
  );
  return {
    messages,
    syncPass: {
      mode: 'steady',
      resetDetected: false,
      resumed: false,
      baselineConfirmed: false,
      activeGenerationId: GENERATION_A,
      targetGenerationId: GENERATION_A,
      uidValidity: 700,
      uidNext: highestUid + 1,
      scanUpperUid: highestUid,
      scannedFromUid: highestUid ? 1 : 0,
      scannedThroughUid: highestUid,
      scanComplete: true,
      leaseExpiresAt: futureLeaseExpiry(),
      selectionPolicy: MAILBOX_UID_SELECTION_POLICY,
      targetReferenceIds: [],
      targetUidManifest: [],
      ...overrides,
    },
  };
}

function createRawSyncService({ store, fetcher, accountEmail = 'serve@softora.nl' }) {
  const selected = {
    email: accountEmail,
    imapHost: 'imap.example.test',
    imapConfigured: true,
  };
  return createMailboxSyncService({
    mailboxIndexStore: store,
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: fetcher,
    getSafeLimit: (value) => Number(value) || 30,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });
}

test('echte index-store wiret dual runtime zonder legacy rij-identiteit te wijzigen', () => {
  const store = createMailboxIndexStore({
    now: () => new Date('2026-08-21T20:00:00.000Z'),
  });
  [
    'acquireSyncLockForProtocol',
    'getUidGenerationProtocol',
    'prepareUidGeneration',
    'confirmUidBaseline',
    'listLegacyUidIdentities',
    'commitSyncPass',
    'commitTargetedSyncPass',
    'skipSync',
    'failSync',
  ].forEach((method) => assert.equal(typeof store[method], 'function', method));

  const legacy = store.buildMessageRow(
    { uid: 42, id: 'inbox:42', subject: 'Legacy' },
    'Serve@Softora.nl',
    'INBOX'
  );
  assert.equal(legacy.message_key, 'serve@softora.nl|inbox|42');
  assert.equal(Object.hasOwn(legacy, 'uid_validity'), false);
  assert.equal(Object.hasOwn(legacy, 'uid_generation_id'), false);

  const generated = store.buildMessageRow(
    { uid: 42, id: 'inbox:42', subject: 'V2' },
    'serve@softora.nl',
    'inbox',
    0,
    { uidValidity: 700, generationId: GENERATION_A }
  );
  assert.equal(generated.message_key, `serve@softora.nl|inbox|gen:${GENERATION_A}|42`);
  assert.equal(generated.uid_validity, 700);
  assert.equal(generated.uid_generation_id, GENERATION_A);
});

test('dezelfde UID blijft voor Servé en Martijn in iedere generatie accountgescheiden', () => {
  const store = createMailboxIndexStore();
  const serveLegacy = store.buildMessageKey('serve@softora.nl', 'inbox', 91);
  const martijnLegacy = store.buildMessageKey('martijn@softora.nl', 'inbox', 91);
  const serveV2 = store.buildMessageKey('serve@softora.nl', 'inbox', 91, GENERATION_A);
  const martijnV2 = store.buildMessageKey('martijn@softora.nl', 'inbox', 91, GENERATION_A);
  const serveReset = store.buildMessageKey('serve@softora.nl', 'inbox', 91, GENERATION_B);

  assert.notEqual(serveLegacy, martijnLegacy);
  assert.notEqual(serveV2, martijnV2);
  assert.notEqual(serveV2, serveReset);
  assert.match(serveV2, /^serve@softora\.nl\|inbox\|gen:/);
  assert.match(martijnV2, /^martijn@softora\.nl\|inbox\|gen:/);
});

test('A naar B naar A leest bij gelijke UID uitsluitend de actieve generatie', async () => {
  const rows = [{
    message_key: `serve@softora.nl|inbox|gen:${GENERATION_A}|42`,
    account_email: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    subject: 'oude A-generatie',
    deleted_at: null,
    generation_superseded_at: '2026-08-21T18:00:00.000Z',
  }, {
    message_key: `serve@softora.nl|inbox|gen:${GENERATION_B}|42`,
    account_email: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    subject: 'oude B-generatie',
    deleted_at: '2026-08-21T19:00:00.000Z',
    generation_superseded_at: '2026-08-21T19:00:00.000Z',
  }, {
    message_key: 'serve@softora.nl|inbox|gen:33333333-3333-4333-8333-333333333333|42',
    account_email: 'serve@softora.nl',
    folder: 'inbox',
    uid: 42,
    subject: 'actieve tweede A-generatie',
    deleted_at: null,
    generation_superseded_at: null,
  }];

  function createQuery() {
    const predicates = [];
    const query = {
      select() { return this; },
      eq(column, value) {
        predicates.push((row) => row[column] === value);
        return this;
      },
      is(column, value) {
        predicates.push((row) => row[column] === value);
        return this;
      },
      order() { return this; },
      limit() { return this; },
      filtered() { return rows.filter((row) => predicates.every((predicate) => predicate(row))); },
      maybeSingle() { return Promise.resolve({ data: this.filtered()[0] || null, error: null }); },
      then(resolve, reject) {
        return Promise.resolve({ data: this.filtered(), error: null }).then(resolve, reject);
      },
    };
    return query;
  }

  const store = createMailboxIndexStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({ from: () => createQuery() }),
    logger: { error() {}, warn() {} },
  });
  const exact = await store.getMessage({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:42',
  });
  const proof = await store.getMessageForReplyProof({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    id: 'inbox:42',
  });
  const listed = await store.listMessages({
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    limit: 50,
  });

  assert.equal(exact.subject, 'actieve tweede A-generatie');
  assert.equal(proof.subject, 'actieve tweede A-generatie');
  assert.deepEqual(listed.map((message) => message.subject), ['actieve tweede A-generatie']);
});

test('protocolread faalt dicht vóór IMAP, legacyclaim of indexwrite', async () => {
  let effects = 0;
  const protocolError = new Error('protocol RPC niet beschikbaar');
  const store = {
    getUidGenerationProtocol: async () => ({ ok: false, error: protocolError }),
    acquireSyncLockForProtocol: async () => {
      effects += 1;
      return { ok: true, protocolMode: 'legacy' };
    },
    acquireSyncLock: async () => { effects += 1; },
    upsertMessages: async () => { effects += 1; },
    finishSync: async () => { effects += 1; },
    failSync: async () => { effects += 1; },
  };
  const service = createRawSyncService({
    store,
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async () => { effects += 1; return []; },
  });

  await assert.rejects(service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  }), /protocol RPC niet beschikbaar/);
  assert.equal(effects, 0);

  store.getUidGenerationProtocol = async () => ({ ok: true, protocol: 'legacy' });
  store.acquireSyncLockForProtocol = async () => ({
    ok: false,
    locked: false,
    protocolMode: '',
    error: protocolError,
  });
  await assert.rejects(service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: 'sent',
  }), /protocol RPC niet beschikbaar/);
  assert.equal(effects, 0);
});

test('ontbrekende v2-failwiring stopt vóór protocolread, lockclaim en IMAP', async () => {
  const effects = [];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => {
        effects.push('protocol');
        return { ok: true, protocol: 'legacy' };
      },
      acquireSyncLockForProtocol: async () => {
        effects.push('claim');
        return { ok: true, protocolMode: 'legacy' };
      },
    },
    fetcher: async () => {
      effects.push('fetch');
      return [];
    },
  });

  await assert.rejects(service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  }), (error) => error.code === 'MAILBOX_SYNC_V2_UNAVAILABLE');
  assert.deepEqual(effects, []);
});

test('draining stopt vóór leaseclaim, IMAP en mailboxwrites', async () => {
  let effects = 0;
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => ({
        ok: true,
        protocol: 'draining',
        drainReady: false,
      }),
      acquireSyncLockForProtocol: async () => { effects += 1; },
      upsertMessages: async () => { effects += 1; },
      finishSync: async () => { effects += 1; },
      failSync: async () => { effects += 1; },
    },
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async () => { effects += 1; return []; },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  });
  assert.deepEqual(result, { ok: true, skipped: true, reason: 'uid_protocol_draining' });
  assert.equal(effects, 0);
});

test('gewone Inbox en Sent stoppen na exact één atomische draining-claim', async () => {
  const protocolReads = [];
  const protocolClaims = [];
  const effects = [];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => {
        protocolReads.push('read');
        return { ok: true, protocol: 'draining' };
      },
      acquireSyncLockForProtocol: async ({ folder }) => {
        protocolClaims.push(folder);
        return {
          ok: false,
          locked: false,
          protocolMode: 'draining',
        };
      },
      upsertMessages: async () => { effects.push('upsert'); },
      finishSync: async () => { effects.push('finish'); },
      failSync: async () => { effects.push('fail'); },
    },
    fetcher: async () => { effects.push('fetch'); return []; },
  });

  for (const folder of ['inbox', 'sent']) {
    const claimsBefore = protocolClaims.length;
    const result = await service.syncMailboxFolder({
      accountEmail: 'serve@softora.nl',
      folder,
    });
    assert.deepEqual(result, { ok: true, skipped: true, reason: 'uid_protocol_draining' });
    assert.equal(protocolClaims.length - claimsBefore, 1);
  }

  assert.deepEqual(protocolClaims, ['inbox', 'sent']);
  assert.deepEqual(protocolReads, []);
  assert.deepEqual(effects, []);
});

test('Gmail All Mail volgt claim-v2 wanneer de eerdere preflight nog legacy las', async () => {
  const calls = [];
  const fetchOptions = [];
  const seedMessages = [{
    folder: 'inbox',
    accountEmail: 'martijnven123@gmail.com',
    email: 'klant@example.nl',
    messageId: '<known-inbound@example.nl>',
  }, {
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    email: 'martijnven123@gmail.com',
    to: 'klant@example.nl',
    messageId: '<known-outbound@example.nl>',
    inReplyTo: '<missing-inbound@example.nl>',
  }];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => {
        calls.push('preflight-legacy');
        return { ok: true, protocol: 'legacy' };
      },
      acquireSyncLockForProtocol: async () => {
        calls.push('claim-v2');
        return {
          ok: true,
          protocolMode: 'v2',
          lockToken: 'legacy-to-v2-lock',
          lockExpiresAt: futureLeaseExpiry(),
        };
      },
      listMessageUidsForAccount: async () => [],
      listCampaignSeedMessagesForAccount: async () => seedMessages,
      prepareUidGeneration: async () => {
        calls.push('prepare-v2');
        return { ok: true, prepared: true };
      },
      confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
      listLegacyUidIdentities: async () => [],
      commitSyncPass: async () => { throw new Error('algemene commit niet verwacht'); },
      commitTargetedSyncPass: async (options) => {
        calls.push('commit-v2');
        assert.equal(options.lockToken, 'legacy-to-v2-lock');
        return { ok: true, committed: true, upserted: 1 };
      },
      skipSync: async () => { throw new Error('skip niet verwacht'); },
      failSync: async () => ({ ok: true, applied: true }),
      upsertMessages: async () => { throw new Error('legacy upsert gebruikt'); },
      finishSync: async () => { throw new Error('legacy finalizer gebruikt'); },
    },
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async (options) => {
      calls.push('fetch-v2');
      fetchOptions.push(options);
      await options.prepareUidGeneration({ uidValidity: 701, uidNext: 8 });
      return createSyncPass([{ uid: 7, id: 'all:7' }], {
        uidValidity: 701,
        uidNext: 8,
        scanUpperUid: 7,
        scannedFromUid: 0,
        scannedThroughUid: 0,
        selectionPolicy: MAILBOX_UID_TARGETED_SELECTION_POLICY,
        targetReferenceIds: ['missing-inbound@example.nl'],
        targetUidManifest: [7],
      });
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.uidProtocol, 'v2');
  assert.equal(fetchOptions.length, 1);
  assert.equal(fetchOptions[0].targetedOnly, true);
  assert.deepEqual(calls, [
    'preflight-legacy',
    'claim-v2',
    'fetch-v2',
    'prepare-v2',
    'commit-v2',
  ]);
});

test('Gmail All Mail stopt wanneer claim-draining volgt op een v2-preflight', async () => {
  const calls = [];
  const effects = [];
  const seedMessages = [{
    folder: 'inbox',
    accountEmail: 'martijnven123@gmail.com',
    email: 'klant@example.nl',
    messageId: '<known-inbound@example.nl>',
  }, {
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    email: 'martijnven123@gmail.com',
    to: 'klant@example.nl',
    messageId: '<known-outbound@example.nl>',
    inReplyTo: '<missing-inbound@example.nl>',
  }];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => {
        calls.push('preflight-v2');
        return { ok: true, protocol: 'v2' };
      },
      listCampaignSeedMessagesForAccount: async () => {
        calls.push('seed-read');
        return seedMessages;
      },
      acquireSyncLockForProtocol: async () => {
        calls.push('claim-draining');
        return {
          ok: false,
          locked: false,
          protocolMode: 'draining',
        };
      },
      upsertMessages: async () => { effects.push('upsert'); },
      finishSync: async () => { effects.push('finish'); },
      failSync: async () => { effects.push('fail'); },
      commitSyncPass: async () => { effects.push('commit'); },
      commitTargetedSyncPass: async () => { effects.push('targeted-commit'); },
    },
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async () => { effects.push('fetch'); return []; },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.deepEqual(result, { ok: true, skipped: true, reason: 'uid_protocol_draining' });
  assert.deepEqual(calls, ['preflight-v2', 'seed-read', 'claim-draining']);
  assert.deepEqual(effects, []);
});

test('protocolbewuste lock-RPC-fout wordt nooit als geslaagde sync gemaskeerd', async () => {
  let effects = 0;
  const result = await createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'legacy' }),
      acquireSyncLockForProtocol: async () => ({
        ok: false,
        locked: false,
        protocolMode: 'legacy',
        error: new Error('lock RPC niet beschikbaar'),
      }),
      failSync: async () => { effects += 1; },
      upsertMessages: async () => { effects += 1; },
      finishSync: async () => { effects += 1; },
    },
    fetcher: async () => { effects += 1; return []; },
  }).syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  });

  assert.deepEqual(result, {
    ok: false,
    skipped: true,
    reason: 'lock_failed',
  });
  assert.equal(effects, 0);
});

test('legacy gebruikt alleen fetch, upsert en eigen leasefinalizer', async () => {
  const calls = [];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'legacy' }),
      acquireSyncLockForProtocol: async () => ({
        ok: true,
        protocolMode: 'legacy',
        lockToken: 'legacy-lock',
        lockExpiresAt: futureLeaseExpiry(),
      }),
      upsertMessages: async (options) => {
        calls.push(['upsert', options]);
        return { ok: true, upserted: 1 };
      },
      finishSync: async (options) => {
        calls.push(['finish', options]);
        return { ok: true };
      },
      failSync: async () => { throw new Error('v2-fail gebruikt'); },
    },
    fetcher: async (options) => {
      calls.push(['fetch', options]);
      assert.equal(Object.hasOwn(options, 'prepareUidGeneration'), false);
      assert.equal(Object.hasOwn(options, 'returnSyncPass'), false);
      assert.equal(Object.hasOwn(options, 'targetedOnly'), false);
      assert.equal(Object.hasOwn(options, 'deadlineAtMs'), false);
      return [{ uid: 7, id: 'sent:7' }];
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  });
  assert.equal(result.uidProtocol, 'legacy');
  assert.deepEqual(calls.map(([name]) => name), ['fetch', 'upsert', 'finish']);
  assert.equal(Object.hasOwn(calls[1][1], 'deadlineAtMs'), false);
  assert.equal(calls[2][1].lockToken, 'legacy-lock');
  assert.equal(calls[2][1].lastUid, 7);
});

test('v2 gebruikt prepare en atomische commit en sluit een mislukking met v2-fail', async () => {
  const calls = [];
  let fetchAttempt = 0;
  const store = {
    getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
    acquireSyncLockForProtocol: async () => ({
      ok: true,
      protocolMode: 'v2',
      lockToken: `v2-lock-${fetchAttempt + 1}`,
      lockExpiresAt: futureLeaseExpiry(),
    }),
    prepareUidGeneration: async (options) => {
      calls.push(['prepare', options]);
      return { ok: true, prepared: true };
    },
    confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
    listLegacyUidIdentities: async () => [],
    commitSyncPass: async (options) => {
      calls.push(['commit', options]);
      return { ok: true, committed: true, upserted: 1 };
    },
    commitTargetedSyncPass: async () => { throw new Error('gerichte commit niet verwacht'); },
    skipSync: async () => { throw new Error('skip niet verwacht'); },
    failSync: async (options) => {
      calls.push(['fail', options]);
      return { ok: true, applied: true };
    },
    upsertMessages: async () => { throw new Error('legacy upsert gebruikt'); },
    finishSync: async () => { throw new Error('legacy finalizer gebruikt'); },
  };
  const service = createRawSyncService({
    store,
    fetcher: async (options) => {
      fetchAttempt += 1;
      calls.push(['fetch', options]);
      if (fetchAttempt === 2) throw new Error('provider tijdelijk onbereikbaar');
      await options.prepareUidGeneration({ uidValidity: 700, uidNext: 2 });
      return createSyncPass([{ uid: 1, id: 'sent:1' }]);
    },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  });
  assert.equal(result.uidProtocol, 'v2');
  assert.deepEqual(calls.map(([name]) => name), ['fetch', 'prepare', 'commit']);
  assert.equal(calls[2][1].accountEmail, 'serve@softora.nl');
  assert.equal(calls[2][1].generationId, GENERATION_A);

  await assert.rejects(service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  }), /provider tijdelijk onbereikbaar/);
  assert.deepEqual(calls.map(([name]) => name), [
    'fetch', 'prepare', 'commit', 'fetch', 'fail',
  ]);
  assert.equal(calls[4][1].accountEmail, 'serve@softora.nl');
});

test('gedeeltelijke v2-wiring geeft de geclaimde lease via v2-fail vrij', async () => {
  let fetches = 0;
  const failures = [];
  const service = createRawSyncService({
    store: {
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
      acquireSyncLockForProtocol: async () => ({
        ok: true,
        protocolMode: 'v2',
        lockToken: 'partial-v2-lock',
        lockExpiresAt: futureLeaseExpiry(),
      }),
      failSync: async (options) => {
        failures.push(options);
        return { ok: true, applied: true };
      },
    },
    fetcher: async () => { fetches += 1; return []; },
  });

  await assert.rejects(service.syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  }), (error) => error.code === 'MAILBOX_SYNC_V2_UNAVAILABLE');
  assert.equal(fetches, 0);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].lockToken, 'partial-v2-lock');
});

test('ontbrekende optionele map gebruikt een atomische v2-skip en geen failure', async () => {
  let closeCalls = 0;
  let skipped = null;
  let failures = 0;
  const fetcher = createMailboxImapFetcher({
    buildMailboxBodyImages: () => [],
    createClient: () => ({
      usable: true,
      async connect() {},
      close() { closeCalls += 1; },
    }),
    getSafeLimit: (value) => Number(value) || 30,
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    parseMailSource: async () => ({}),
    resolveMailboxName: async () => null,
    resolveMailboxSyncUids: async () => { throw new Error('UID-selectie gebruikt'); },
    runWithDeadline: async ({ operation }) => operation(),
    sanitizeMailboxDisplayText: (value) => value,
    toClientMessage: (value) => value,
  });
  const store = {
    getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
    acquireSyncLockForProtocol: async () => ({
      ok: true,
      protocolMode: 'v2',
      lockToken: 'missing-folder-lock',
      lockExpiresAt: futureLeaseExpiry(),
    }),
    prepareUidGeneration: async () => { throw new Error('prepare gebruikt'); },
    confirmUidBaseline: async () => { throw new Error('baseline gebruikt'); },
    listLegacyUidIdentities: async () => { throw new Error('legacy-identiteiten gebruikt'); },
    commitSyncPass: async () => { throw new Error('commit gebruikt'); },
    commitTargetedSyncPass: async () => { throw new Error('gerichte commit gebruikt'); },
    skipSync: async (options) => {
      skipped = options;
      return { ok: true, skipped: true };
    },
    failSync: async () => { failures += 1; return { ok: true, applied: true }; },
  };
  const result = await createRawSyncService({ store, fetcher }).syncMailboxFolder({
    accountEmail: 'serve@softora.nl',
    folder: 'sent',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'folder_missing');
  assert.equal(result.uidProtocol, 'v2');
  assert.equal(skipped.accountEmail, 'serve@softora.nl');
  assert.equal(skipped.folder, 'sent');
  assert.equal(skipped.lockToken, 'missing-folder-lock');
  assert.equal(failures, 0);
  assert.equal(closeCalls, 1);
});

test('v2 commit houdt gelijke UIDs bij Servé en Martijn in afzonderlijke accounts', async () => {
  const commits = [];
  for (const accountEmail of ['serve@softora.nl', 'martijn@softora.nl']) {
    const store = {
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
      acquireSyncLockForProtocol: async () => ({
        ok: true,
        protocolMode: 'v2',
        lockToken: `lock-${accountEmail}`,
        lockExpiresAt: futureLeaseExpiry(),
      }),
      prepareUidGeneration: async () => ({ ok: true, prepared: true }),
      confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
      listLegacyUidIdentities: async () => [],
      commitSyncPass: async (options) => {
        commits.push(options);
        return { ok: true, committed: true, upserted: 1 };
      },
      commitTargetedSyncPass: async () => { throw new Error('gerichte commit gebruikt'); },
      skipSync: async () => { throw new Error('skip gebruikt'); },
      failSync: async () => ({ ok: true, applied: true }),
    };
    await createRawSyncService({
      store,
      accountEmail,
      fetcher: async () => createSyncPass([{ uid: 42, id: 'inbox:42' }]),
    }).syncMailboxFolder({ accountEmail, folder: 'inbox' });
  }

  assert.deepEqual(commits.map((commit) => commit.accountEmail), [
    'serve@softora.nl',
    'martijn@softora.nl',
  ]);
  assert.deepEqual(commits.map((commit) => commit.messages[0].uid), [42, 42]);
  assert.notEqual(commits[0].lockToken, commits[1].lockToken);
});

test('UID-reset bouwt vanaf UID 1 opnieuw op en adopteert geen ongeldige Message-ID-baseline', async () => {
  const selectedWindows = [];
  const client = {
    mailbox: { uidValidity: 901n, uidNext: 4 },
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search() { return [1, 2, 3]; },
    async logout() { this.usable = false; },
  };
  const fetcher = createMailboxImapFetcher({
    buildMailboxBodyImages: () => [],
    createClient: () => client,
    fetchSelectedMessages: async ({ selectedUids }) => {
      selectedWindows.push([...selectedUids]);
      return selectedUids.map((uid) => ({ uid, id: `inbox:${uid}` }));
    },
    getSafeLimit: (value) => Number(value) || 30,
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    parseMailSource: async () => ({}),
    resolveMailboxName: async () => 'INBOX',
    resolveMailboxSyncUids: async () => { throw new Error('oude cursorselectie gebruikt'); },
    runWithDeadline: async ({ operation }) => operation(),
    sanitizeMailboxDisplayText: (value) => value,
    toClientMessage: (value) => value,
  });
  let baselineConfirmations = 0;
  const fetched = await fetcher({
    account: { email: 'serve@softora.nl' },
    folder: 'inbox',
    limit: 3,
    prepareUidGeneration: async () => ({
      ok: true,
      prepared: true,
      mode: 'rebuild',
      resetDetected: true,
      resumed: false,
      activeGenerationId: GENERATION_A,
      targetGenerationId: GENERATION_B,
      currentUidValidity: 0,
      observedUidValidity: 901,
      scanUpperUid: 3,
      scannedThroughUid: 0,
      leaseExpiresAt: futureLeaseExpiry(),
      selectionPolicy: MAILBOX_UID_SELECTION_POLICY,
      selectionTargets: [],
    }),
    listLegacyUidIdentities: async () => [{
      uid: 2,
      messageId: 'ongeldige message id met spaties',
    }],
    confirmUidBaseline: async () => {
      baselineConfirmations += 1;
      return { ok: true, confirmed: true };
    },
    returnSyncPass: true,
  });

  assert.equal(baselineConfirmations, 0);
  assert.deepEqual(selectedWindows, [[1, 2, 3]]);
  assert.deepEqual(fetched.messages.map((message) => message.uid), [1, 2, 3]);
  assert.equal(fetched.syncPass.mode, 'rebuild');
  assert.equal(fetched.syncPass.resetDetected, true);
  assert.equal(fetched.syncPass.targetGenerationId, GENERATION_B);
  assert.equal(fetched.syncPass.scannedFromUid, 1);
  assert.equal(fetched.syncPass.scannedThroughUid, 3);
  assert.equal(fetched.syncPass.scanComplete, true);
});

test('exacte legacy Message-ID-baseline wordt veilig geadopteerd en scant daarna vanaf nul', async () => {
  const selectedWindows = [];
  const searchQueries = [];
  let confirmedEvidence = null;
  const client = {
    mailbox: { uidValidity: 700n, uidNext: 4 },
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) { searchQueries.push(query); return [1, 2, 3]; },
    async *fetch(uids) {
      for (const uid of uids) {
        if (uid === 2) yield { uid: 2, envelope: { messageId: '<LEGACY-2@test.softora.nl>' } };
      }
    },
    async logout() { this.usable = false; },
  };
  const fetcher = createMailboxImapFetcher({
    buildMailboxBodyImages: () => [],
    createClient: () => client,
    fetchSelectedMessages: async ({ selectedUids }) => {
      selectedWindows.push([...selectedUids]);
      return selectedUids.map((uid) => ({ uid, id: `inbox:${uid}` }));
    },
    getSafeLimit: (value) => Number(value) || 30,
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    parseMailSource: async () => ({}),
    resolveMailboxName: async () => 'INBOX',
    resolveMailboxSyncUids: async () => { throw new Error('oude cursorselectie gebruikt'); },
    runWithDeadline: async ({ operation }) => operation(),
    sanitizeMailboxDisplayText: (value) => value,
    toClientMessage: (value) => value,
  });
  const fetched = await fetcher({
    account: { email: 'serve@softora.nl' },
    folder: 'inbox',
    limit: 3,
    prepareUidGeneration: async () => ({
      ok: true,
      prepared: true,
      mode: 'rebuild',
      resetDetected: false,
      resumed: false,
      activeGenerationId: '',
      targetGenerationId: GENERATION_A,
      currentUidValidity: 0,
      observedUidValidity: 700,
      scanUpperUid: 3,
      scannedThroughUid: 0,
      leaseExpiresAt: futureLeaseExpiry(),
      selectionPolicy: MAILBOX_UID_SELECTION_POLICY,
      selectionTargets: [],
    }),
    listLegacyUidIdentities: async () => [{
      uid: 2,
      messageId: '<legacy-2@test.softora.nl>',
    }],
    confirmUidBaseline: async ({ evidence }) => {
      confirmedEvidence = evidence;
      return {
        ok: true,
        confirmed: true,
        activeGenerationId: GENERATION_A,
        currentUidValidity: 700,
        resumeAfterUid: 0,
      };
    },
    returnSyncPass: true,
  });

  assert.deepEqual(confirmedEvidence, [{ uid: 2, messageId: 'legacy-2@test.softora.nl' }]);
  assert.deepEqual(searchQueries, [{ uid: '1:3' }]);
  assert.deepEqual(selectedWindows, [[1, 2, 3]]);
  assert.equal(fetched.syncPass.baselineConfirmed, true);
  assert.equal(fetched.syncPass.mode, 'steady');
  assert.equal(fetched.syncPass.scannedFromUid, 1);
  assert.equal(fetched.syncPass.scannedThroughUid, 3);
});

test('gerichte Gmail All Mail-selectie is uitsluitend onder protocol v2 actief', async () => {
  const fetchOptions = [];
  const seedMessages = [{
    folder: 'inbox',
    accountEmail: 'martijnven123@gmail.com',
    email: 'klant@example.nl',
    messageId: '<known-inbound@example.nl>',
  }, {
    folder: 'sent',
    accountEmail: 'martijnven123@gmail.com',
    email: 'martijnven123@gmail.com',
    to: 'klant@example.nl',
    messageId: '<known-outbound@example.nl>',
    inReplyTo: '<missing-inbound@example.nl>',
  }];
  const baseStore = {
    getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
    acquireSyncLockForProtocol: async () => ({
      ok: true,
      protocolMode: 'v2',
      lockToken: 'targeted-v2-lock',
      lockExpiresAt: futureLeaseExpiry(),
    }),
    listMessageUidsForAccount: async () => [],
    listCampaignSeedMessagesForAccount: async () => seedMessages,
    prepareUidGeneration: async () => ({ ok: true, prepared: true }),
    confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
    listLegacyUidIdentities: async () => [],
    commitSyncPass: async () => { throw new Error('algemene commit niet verwacht'); },
    commitTargetedSyncPass: async () => ({
      ok: true,
      committed: true,
      upserted: 1,
    }),
    skipSync: async () => { throw new Error('skip niet verwacht'); },
    failSync: async () => ({ ok: true, applied: true }),
  };
  const service = createRawSyncService({
    store: baseStore,
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async (options) => {
      fetchOptions.push(options);
      await options.prepareUidGeneration({ uidValidity: 701, uidNext: 8 });
      return createSyncPass([{ uid: 7, id: 'all:7' }], {
        uidValidity: 701,
        uidNext: 8,
        scanUpperUid: 7,
        scannedFromUid: 0,
        scannedThroughUid: 0,
        selectionPolicy: MAILBOX_UID_TARGETED_SELECTION_POLICY,
        targetReferenceIds: ['missing-inbound@example.nl'],
        targetUidManifest: [7],
      });
    },
  });
  const result = await service.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.uidProtocol, 'v2');
  assert.equal(fetchOptions.length, 1);
  assert.equal(fetchOptions[0].targetedOnly, true);
  assert.deepEqual(fetchOptions[0].threadReferenceIds, ['<missing-inbound@example.nl>']);
  assert.deepEqual(fetchOptions[0].threadRecipientTerms, []);

  const legacyFetchOptions = [];
  const legacyService = createRawSyncService({
    store: {
      ...baseStore,
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'legacy' }),
      acquireSyncLockForProtocol: async () => ({
        ok: true,
        protocolMode: 'legacy',
        lockToken: 'targeted-legacy-lock',
        lockExpiresAt: futureLeaseExpiry(),
      }),
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
      finishSync: async () => ({ ok: true }),
    },
    accountEmail: 'martijnven123@gmail.com',
    fetcher: async (options) => { legacyFetchOptions.push(options); return []; },
  });
  await legacyService.syncMailboxFolder({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    campaignOnly: true,
    incrementalOnly: true,
  });
  assert.equal(Object.hasOwn(legacyFetchOptions[0], 'targetedOnly'), false);
});

test('verstreken lease-deadline start geen IMAP-operatie meer', async () => {
  let operationCalls = 0;
  let closeCalls = 0;
  await assert.rejects(runMailboxImapOperationWithDeadline({
    client: { close() { closeCalls += 1; } },
    accountEmail: 'serve@softora.nl',
    folder: 'inbox',
    deadlineAtMs: Date.now() - 1,
    operation: () => { operationCalls += 1; },
  }), (error) => error.code === 'MAILBOX_IMAP_OPERATION_TIMEOUT');
  assert.equal(operationCalls, 0);
  assert.equal(closeCalls, 1);
});
