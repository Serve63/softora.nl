'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
  collectAnchoredCampaignThreadReferenceIds,
  createMailboxSyncService,
} = require('../../server/services/mailbox-campaign-sync');
const {
  createMailboxImapFetcher,
} = require('../../server/services/mailbox-imap-fetch');
const {
  createMailboxSyncFinalizer,
} = require('../../server/services/mailbox-sync-finalizer');
const {
  MAILBOX_UID_TARGETED_SELECTION_POLICY,
} = require('../../server/services/mailbox-uid-validity');

const ACTIVE_GENERATION = '11111111-1111-4111-8111-111111111111';
const PENDING_GENERATION = '22222222-2222-4222-8222-222222222222';

function futureLeaseExpiry() {
  return new Date(Date.now() + 120_000).toISOString();
}

function createTargetedPrepared(overrides = {}) {
  return {
    ok: true,
    prepared: true,
    mode: 'rebuild',
    resetDetected: true,
    resumed: true,
    activeGenerationId: ACTIVE_GENERATION,
    targetGenerationId: PENDING_GENERATION,
    currentUidValidity: 700,
    observedUidValidity: 701,
    scanUpperUid: 9,
    scannedThroughUid: 1,
    leaseExpiresAt: futureLeaseExpiry(),
    selectionPolicy: MAILBOX_UID_TARGETED_SELECTION_POLICY,
    selectionTargets: ['root@example.test'],
    targetManifestScannedThroughUid: 9,
    targetUidManifest: [7, 8, 9],
    targetManifestComplete: true,
    ...overrides,
  };
}

function createTargetedFetcher({
  prepared,
  fetchSelectedMessages,
  search,
} = {}) {
  const client = {
    mailbox: {
      uidValidity: BigInt(prepared.observedUidValidity),
      uidNext: prepared.scanUpperUid + 1,
    },
    usable: true,
    async connect() {},
    async getMailboxLock() { return { release() {} }; },
    async search(query) {
      if (typeof search === 'function') return search(query);
      throw new Error('legacy of onverwachte SEARCH gebruikt');
    },
    async *fetch() {
      throw new Error('onverwachte headerfetch gebruikt');
    },
    async logout() { this.usable = false; },
  };
  return createMailboxImapFetcher({
    buildMailboxBodyImages: () => [],
    createClient: () => client,
    fetchSelectedMessages,
    getSafeLimit: (value) => Number(value) || 8,
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    parseMailSource: async () => ({}),
    resolveMailboxName: async () => '[Gmail]/All Mail',
    resolveMailboxSyncUids: async () => {
      throw new Error('legacy targeted SEARCH gebruikt');
    },
    runWithDeadline: async ({ operation }) => operation(),
    sanitizeMailboxDisplayText: (value) => value,
    toClientMessage: (value) => value,
  });
}

function campaignSeedMessages(accountEmail = 'martijnven123@gmail.com') {
  return [{
    folder: 'inbox',
    accountEmail,
    email: 'klant@example.nl',
    messageId: '<root@example.test>',
  }, {
    folder: 'sent',
    accountEmail,
    email: accountEmail,
    to: 'klant@example.nl',
    messageId: '<sent@example.test>',
    inReplyTo: '<root@example.test>',
  }];
}

function createRawSyncService({ store, fetcher, accountEmail }) {
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
    getSafeLimit: (value) => Number(value) || 8,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    logger: { error() {} },
  });
}

test('geankerde targetselectie gebruikt exact dezelfde UTF-8-bytevolgorde als de RPC', () => {
  const references = [
    'a_b@test.nl',
    'a-b@test.nl',
    'a.b@test.nl',
    'a+b@test.nl',
    'x==v8@test.nl',
    'x=6b@test.nl',
  ];
  const selected = collectAnchoredCampaignThreadReferenceIds(
    references.map((messageId) => ({ folder: 'coldmail', messageId }))
  );
  assert.deepEqual(selected, [
    'a+b@test.nl',
    'a-b@test.nl',
    'a.b@test.nl',
    'a_b@test.nl',
    'x=6b@test.nl',
    'x==v8@test.nl',
  ]);
});

test('verdwenen UID in pending manifest invalideert exact de ontbrekende delta', async () => {
  const prepared = createTargetedPrepared();
  const selectedWindows = [];
  const invalidations = [];
  const fetcher = createTargetedFetcher({
    prepared,
    fetchSelectedMessages: async ({ selectedUids }) => {
      selectedWindows.push([...selectedUids]);
      return [{ uid: 8, id: 'allmail:8' }];
    },
  });

  const fetched = await fetcher({
    account: { email: 'martijnven123@gmail.com' },
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    limit: 8,
    targetedOnly: true,
    prepareUidGeneration: async () => prepared,
    checkpointTargetUidManifest: async () => {
      throw new Error('manifestcheckpoint niet verwacht');
    },
    invalidateTargetUidManifest: async (options) => {
      invalidations.push(options);
      return {
        ok: true,
        invalidated: true,
        lockLost: false,
        generationRole: 'pending',
        pendingAbandoned: true,
        activeManifestInvalidated: true,
        lockReleased: true,
        replayed: false,
      };
    },
    returnSyncPass: true,
  });

  assert.deepEqual(selectedWindows, [[8, 9]]);
  assert.deepEqual(invalidations, [{
    generationId: PENDING_GENERATION,
    uidValidity: 701,
    expectedStagedCount: 1,
    missingUids: [9],
  }]);
  assert.deepEqual(fetched.messages, []);
  assert.equal(fetched.syncPass, null);
  assert.deepEqual(fetched.manifestInvalidation, {
    generationId: PENDING_GENERATION,
    uidValidity: 701,
    resetDetected: true,
    generationRole: 'pending',
    pendingAbandoned: true,
    activeManifestInvalidated: true,
    lockReleased: true,
    replayed: false,
    missingUids: [9],
  });
});

test('verdwenen UID in active steady manifest bewaart de active rol en forceert vervanging', async () => {
  const prepared = createTargetedPrepared({
    mode: 'steady',
    resetDetected: false,
    resumed: false,
    activeGenerationId: ACTIVE_GENERATION,
    targetGenerationId: ACTIVE_GENERATION,
    currentUidValidity: 701,
    scannedThroughUid: 0,
    targetUidManifest: [7, 8],
  });
  const invalidations = [];
  const fetcher = createTargetedFetcher({
    prepared,
    fetchSelectedMessages: async () => [{ uid: 7, id: 'allmail:7' }],
  });

  const fetched = await fetcher({
    account: { email: 'serve290@gmail.com' },
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    targetedOnly: true,
    prepareUidGeneration: async () => prepared,
    checkpointTargetUidManifest: async () => {
      throw new Error('manifestcheckpoint niet verwacht');
    },
    invalidateTargetUidManifest: async (options) => {
      invalidations.push(options);
      return {
        ok: true,
        invalidated: true,
        lockLost: false,
        generationRole: 'active',
        pendingAbandoned: false,
        activeManifestInvalidated: true,
        lockReleased: true,
        replayed: true,
      };
    },
    returnSyncPass: true,
  });

  assert.deepEqual(invalidations, [{
    generationId: ACTIVE_GENERATION,
    uidValidity: 701,
    expectedStagedCount: 0,
    missingUids: [8],
  }]);
  assert.equal(fetched.manifestInvalidation.generationRole, 'active');
  assert.equal(fetched.manifestInvalidation.pendingAbandoned, false);
  assert.equal(fetched.manifestInvalidation.activeManifestInvalidated, true);
  assert.equal(fetched.manifestInvalidation.replayed, true);
});

test('gerichte steady bodyfetch volgt altijd de oplopende frozen UID-manifestvolgorde', async () => {
  const prepared = createTargetedPrepared({
    mode: 'steady',
    resetDetected: false,
    resumed: false,
    activeGenerationId: ACTIVE_GENERATION,
    targetGenerationId: ACTIVE_GENERATION,
    currentUidValidity: 701,
    scannedThroughUid: 0,
    targetUidManifest: [7, 8, 9],
  });
  const fetcher = createTargetedFetcher({
    prepared,
    fetchSelectedMessages: async () => [
      { uid: 9, id: 'allmail:9', date: '2026-08-24T12:09:00.000Z' },
      { uid: 8, id: 'allmail:8', date: '2026-08-24T12:08:00.000Z' },
      { uid: 7, id: 'allmail:7', date: '2026-08-24T12:07:00.000Z' },
    ],
  });

  const fetched = await fetcher({
    account: { email: 'serve290@gmail.com' },
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    targetedOnly: true,
    prepareUidGeneration: async () => prepared,
    checkpointTargetUidManifest: async () => {
      throw new Error('manifestcheckpoint niet verwacht');
    },
    invalidateTargetUidManifest: async () => {
      throw new Error('manifestinvalidatie niet verwacht');
    },
    returnSyncPass: true,
  });

  assert.deepEqual(fetched.messages.map((message) => message.uid), [7, 8, 9]);
  assert.deepEqual(fetched.syncPass.targetUidManifest, [7, 8, 9]);
});

test('bodyfetchfout, duplicate of onverwachte UID invalideert nooit een manifest', async (t) => {
  const prepared = createTargetedPrepared({
    scannedThroughUid: 0,
    targetUidManifest: [7, 8],
  });
  const scenarios = [{
    name: 'parserfout',
    fetchSelectedMessages: async () => { throw new Error('parser stopte'); },
    expected: /parser stopte/,
  }, {
    name: 'timeout',
    fetchSelectedMessages: async () => {
      const error = new Error('bodyfetch timeout');
      error.code = 'MAILBOX_IMAP_OPERATION_TIMEOUT';
      throw error;
    },
    expected: { code: 'MAILBOX_IMAP_OPERATION_TIMEOUT' },
  }, {
    name: 'niet-numerieke UID',
    fetchSelectedMessages: async () => [{ uid: '7' }, { uid: 8 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }, {
    name: 'duplicate UID',
    fetchSelectedMessages: async () => [{ uid: 7 }, { uid: 7 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }, {
    name: 'onverwachte UID',
    fetchSelectedMessages: async () => [{ uid: 7 }, { uid: 99 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let invalidationCalls = 0;
      let checkpointCalls = 0;
      const fetcher = createTargetedFetcher({
        prepared,
        fetchSelectedMessages: scenario.fetchSelectedMessages,
      });
      await assert.rejects(fetcher({
        account: { email: 'martijnven123@gmail.com' },
        folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
        targetedOnly: true,
        prepareUidGeneration: async () => prepared,
        checkpointTargetUidManifest: async () => { checkpointCalls += 1; },
        invalidateTargetUidManifest: async () => { invalidationCalls += 1; },
        returnSyncPass: true,
      }), scenario.expected);
      assert.equal(invalidationCalls, 0);
      assert.equal(checkpointCalls, 0);
    });
  }
});

test('onbetrouwbare bodyfetch gebruikt v2-fail en nooit invalidatie of commit', async (t) => {
  const accountEmail = 'martijnven123@gmail.com';
  const prepared = createTargetedPrepared({
    scannedThroughUid: 0,
    targetUidManifest: [7, 8],
  });
  const scenarios = [{
    name: 'parserfout',
    fetchSelectedMessages: async () => { throw new Error('parser stopte'); },
    expected: /parser stopte/,
  }, {
    name: 'timeout',
    fetchSelectedMessages: async () => {
      const error = new Error('bodyfetch timeout');
      error.code = 'MAILBOX_IMAP_OPERATION_TIMEOUT';
      throw error;
    },
    expected: { code: 'MAILBOX_IMAP_OPERATION_TIMEOUT' },
  }, {
    name: 'niet-numerieke UID',
    fetchSelectedMessages: async () => [{ uid: '7' }, { uid: 8 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }, {
    name: 'duplicate UID',
    fetchSelectedMessages: async () => [{ uid: 7 }, { uid: 7 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }, {
    name: 'onverwachte UID',
    fetchSelectedMessages: async () => [{ uid: 7 }, { uid: 99 }],
    expected: { code: 'MAILBOX_UID_GENERATION_PROTOCOL_INVALID' },
  }];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let invalidations = 0;
      let commits = 0;
      let failures = 0;
      const fetcher = createTargetedFetcher({
        prepared,
        fetchSelectedMessages: scenario.fetchSelectedMessages,
      });
      const store = {
        getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
        acquireSyncLockForProtocol: async () => ({
          ok: true,
          protocolMode: 'v2',
          lockToken: `body-failure-lock:${scenario.name}`,
          lockExpiresAt: futureLeaseExpiry(),
        }),
        listMessageUidsForAccount: async () => [],
        listCampaignSeedMessagesForAccount: async () => campaignSeedMessages(accountEmail),
        prepareUidGeneration: async () => prepared,
        checkpointTargetUidManifest: async () => {
          throw new Error('checkpoint niet verwacht');
        },
        invalidateTargetUidManifest: async () => {
          invalidations += 1;
          throw new Error('invalidatie niet verwacht');
        },
        confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
        listLegacyUidIdentities: async () => [],
        commitSyncPass: async () => { commits += 1; },
        commitTargetedSyncPass: async () => { commits += 1; },
        skipSync: async () => { throw new Error('skip niet verwacht'); },
        failSync: async () => {
          failures += 1;
          return { ok: true, applied: true };
        },
      };
      await assert.rejects(
        createRawSyncService({ store, fetcher, accountEmail }).syncMailboxFolder({
          accountEmail,
          folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
          campaignOnly: true,
          incrementalOnly: false,
        }),
        scenario.expected
      );
      assert.equal(invalidations, 0);
      assert.equal(commits, 0);
      assert.equal(failures, 1);
    });
  }
});

test('lege targetset checkpoint en activeert zonder SEARCH bij UIDNEXT 1 en hoger', async (t) => {
  for (const scanUpperUid of [0, 12]) {
    await t.test(`scanUpperUid ${scanUpperUid}`, async () => {
      const accountEmail = 'martijnven123@gmail.com';
      const prepared = createTargetedPrepared({
        activeGenerationId: '',
        currentUidValidity: 0,
        scanUpperUid,
        scannedThroughUid: 0,
        selectionTargets: [],
        targetManifestScannedThroughUid: 0,
        targetUidManifest: [],
        targetManifestComplete: false,
      });
      const checkpointCalls = [];
      const commits = [];
      let failures = 0;
      let searchCalls = 0;
      const fetcher = createTargetedFetcher({
        prepared,
        fetchSelectedMessages: async () => {
          throw new Error('lege targetset mag geen bodyfetch doen');
        },
        search: async () => {
          searchCalls += 1;
          throw new Error('lege targetset mag geen SEARCH doen');
        },
      });
      const store = {
        getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
        acquireSyncLockForProtocol: async () => ({
          ok: true,
          protocolMode: 'v2',
          lockToken: `empty-target-lock:${scanUpperUid}`,
          lockExpiresAt: futureLeaseExpiry(),
        }),
        listMessageUidsForAccount: async () => [],
        listCampaignSeedMessagesForAccount: async () => [],
        prepareUidGeneration: async () => prepared,
        checkpointTargetUidManifest: async (options) => {
          checkpointCalls.push(options);
          return {
            ok: true,
            checkpointed: true,
            lockLost: false,
            replayed: false,
            targetManifestScannedThroughUid: scanUpperUid,
            targetUidManifest: [],
            targetManifestComplete: true,
            lockReleased: false,
          };
        },
        invalidateTargetUidManifest: async () => {
          throw new Error('manifestinvalidatie niet verwacht');
        },
        confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
        listLegacyUidIdentities: async () => [],
        commitSyncPass: async () => { throw new Error('algemene commit niet verwacht'); },
        commitTargetedSyncPass: async (options) => {
          commits.push(options);
          return {
            ok: true,
            committed: true,
            activated: true,
            rebuildPending: false,
            upserted: 0,
          };
        },
        skipSync: async () => { throw new Error('skip niet verwacht'); },
        failSync: async () => { failures += 1; return { ok: true, applied: true }; },
      };
      const result = await createRawSyncService({ store, fetcher, accountEmail })
        .syncMailboxFolder({
          accountEmail,
          folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
          campaignOnly: true,
          incrementalOnly: false,
        });

      assert.equal(result.ok, true);
      assert.equal(result.synced, 0);
      assert.equal(result.activated, true);
      assert.equal(result.targetedThreadReferences, 0);
      assert.equal(searchCalls, 0);
      assert.equal(failures, 0);
      assert.equal(commits.length, 1);
      assert.deepEqual(commits[0].targetReferenceIds, []);
      assert.deepEqual(commits[0].messages, []);
      assert.deepEqual(commits[0].targetUidManifest, []);
      assert.equal(commits[0].scannedFromUid, 1);
      assert.equal(commits[0].scannedThroughUid, 0);
      assert.equal(commits[0].scanComplete, true);
      assert.equal(checkpointCalls.length, 1);
      assert.equal(checkpointCalls[0].expectedScannedThroughUid, 0);
      assert.equal(checkpointCalls[0].scannedThroughUid, scanUpperUid);
      assert.deepEqual(checkpointCalls[0].foundUids, []);
      assert.equal(checkpointCalls[0].scanComplete, true);
    });
  }
});

test('steady lege targetset blijft geldig zonder SEARCH, checkpoint of bodyfetch', async () => {
  const accountEmail = 'serve290@gmail.com';
  const prepared = createTargetedPrepared({
    mode: 'steady',
    resetDetected: false,
    resumed: false,
    activeGenerationId: ACTIVE_GENERATION,
    targetGenerationId: ACTIVE_GENERATION,
    currentUidValidity: 701,
    scanUpperUid: 12,
    scannedThroughUid: 0,
    selectionTargets: [],
    targetManifestScannedThroughUid: 12,
    targetUidManifest: [],
    targetManifestComplete: true,
  });
  let searches = 0;
  let checkpoints = 0;
  const commits = [];
  const fetcher = createTargetedFetcher({
    prepared,
    fetchSelectedMessages: async () => {
      throw new Error('steady lege targetset mag geen bodyfetch doen');
    },
    search: async () => {
      searches += 1;
      throw new Error('steady lege targetset mag geen SEARCH doen');
    },
  });
  const store = {
    getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
    acquireSyncLockForProtocol: async () => ({
      ok: true,
      protocolMode: 'v2',
      lockToken: 'steady-empty-lock',
      lockExpiresAt: futureLeaseExpiry(),
    }),
    listMessageUidsForAccount: async () => [],
    listCampaignSeedMessagesForAccount: async () => [],
    prepareUidGeneration: async () => prepared,
    checkpointTargetUidManifest: async () => { checkpoints += 1; },
    invalidateTargetUidManifest: async () => {
      throw new Error('manifestinvalidatie niet verwacht');
    },
    confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
    listLegacyUidIdentities: async () => [],
    commitSyncPass: async () => { throw new Error('algemene commit niet verwacht'); },
    commitTargetedSyncPass: async (options) => {
      commits.push(options);
      return {
        ok: true,
        committed: true,
        activated: false,
        rebuildPending: false,
        upserted: 0,
      };
    },
    skipSync: async () => { throw new Error('skip niet verwacht'); },
    failSync: async () => { throw new Error('fail niet verwacht'); },
  };

  const result = await createRawSyncService({ store, fetcher, accountEmail })
    .syncMailboxFolder({
      accountEmail,
      folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
      campaignOnly: true,
      incrementalOnly: true,
    });

  assert.equal(result.ok, true);
  assert.equal(result.activated, false);
  assert.equal(searches, 0);
  assert.equal(checkpoints, 0);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].targetReferenceIds, []);
  assert.deepEqual(commits[0].targetUidManifest, []);
  assert.deepEqual(commits[0].messages, []);
});

test('pending generatie hervat bevroren targets wanneer actuele targets leeg zijn', async () => {
  const accountEmail = 'martijnven123@gmail.com';
  const prepared = createTargetedPrepared({
    scannedThroughUid: 0,
    selectionTargets: ['frozen@example.test'],
    targetUidManifest: [7],
  });
  const prepareCalls = [];
  const selectedWindows = [];
  const commits = [];
  let searches = 0;
  const fetcher = createTargetedFetcher({
    prepared,
    fetchSelectedMessages: async ({ selectedUids }) => {
      selectedWindows.push([...selectedUids]);
      return selectedUids.map((uid) => ({ uid, id: `allmail:${uid}` }));
    },
    search: async () => {
      searches += 1;
      throw new Error('bevroren compleet manifest mag geen SEARCH doen');
    },
  });
  const store = {
    getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
    acquireSyncLockForProtocol: async () => ({
      ok: true,
      protocolMode: 'v2',
      lockToken: 'frozen-target-lock',
      lockExpiresAt: futureLeaseExpiry(),
    }),
    listMessageUidsForAccount: async () => [],
    listCampaignSeedMessagesForAccount: async () => [],
    prepareUidGeneration: async (options) => {
      prepareCalls.push(options);
      return prepared;
    },
    checkpointTargetUidManifest: async () => {
      throw new Error('manifestcheckpoint niet verwacht');
    },
    invalidateTargetUidManifest: async () => {
      throw new Error('manifestinvalidatie niet verwacht');
    },
    confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
    listLegacyUidIdentities: async () => [],
    commitSyncPass: async () => { throw new Error('algemene commit niet verwacht'); },
    commitTargetedSyncPass: async (options) => {
      commits.push(options);
      return {
        ok: true,
        committed: true,
        activated: true,
        rebuildPending: false,
        upserted: 1,
      };
    },
    skipSync: async () => { throw new Error('skip niet verwacht'); },
    failSync: async () => { throw new Error('fail niet verwacht'); },
  };

  const result = await createRawSyncService({ store, fetcher, accountEmail })
    .syncMailboxFolder({
      accountEmail,
      folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
      campaignOnly: true,
      incrementalOnly: true,
    });

  assert.equal(result.ok, true);
  assert.equal(result.activated, true);
  assert.equal(searches, 0);
  assert.equal(prepareCalls.length, 1);
  assert.deepEqual(prepareCalls[0].selectionTargets, []);
  assert.deepEqual(selectedWindows, [[7]]);
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0].targetReferenceIds, ['frozen@example.test']);
  assert.deepEqual(commits[0].targetUidManifest, [7]);
});

test('targeted finalizer accepteert een atomische lege snapshot', async () => {
  const rpcCalls = [];
  const finalizer = createMailboxSyncFinalizer({
    buildSyncKey: (accountEmail, folder) => `${accountEmail}|${folder}`,
    normalizeString: (value) => String(value || '').trim(),
    runDurableWrite: async (_operation, run) => {
      const response = await run({
        rpc: async (name, args) => {
          rpcCalls.push({ name, args });
          return {
            data: [{
              committed: true,
              replayed: false,
              activated: true,
              rebuild_pending: false,
              upserted_count: 0,
              last_uid: 0,
              current_generation_id: PENDING_GENERATION,
              current_uid_validity: 701,
            }],
            error: null,
          };
        },
      });
      return { ok: !response.error, data: response.data, error: response.error };
    },
  });

  const result = await finalizer.commitTargetedSyncPass({
    accountEmail: 'martijnven123@gmail.com',
    folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
    lockToken: 'empty-finalizer-lock',
    commitId: '33333333-3333-4333-8333-333333333333',
    generationId: PENDING_GENERATION,
    uidValidity: 701,
    targetReferenceIds: [],
    targetUidManifest: [],
    rows: [],
    scannedFromUid: 1,
    scannedThroughUid: 0,
    scanComplete: true,
    messageCount: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.activated, true);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, 'softora_commit_mailbox_sync_pass_v2');
  assert.deepEqual(rpcCalls[0].args.p_target_reference_ids, []);
  assert.deepEqual(rpcCalls[0].args.p_target_uid_manifest, []);
});

test('manifestinvalidatie bindt account, folder en lease en commit of failt niet', async () => {
  const run = async ({ accountEmail, replayed }) => {
    const invalidations = [];
    let commits = 0;
    let failures = 0;
    const lockToken = `lock:${accountEmail}`;
    const store = {
      getUidGenerationProtocol: async () => ({ ok: true, protocol: 'v2' }),
      acquireSyncLockForProtocol: async () => ({
        ok: true,
        protocolMode: 'v2',
        lockToken,
        lockExpiresAt: futureLeaseExpiry(),
      }),
      listMessageUidsForAccount: async () => [],
      listCampaignSeedMessagesForAccount: async () => campaignSeedMessages(accountEmail),
      prepareUidGeneration: async () => ({ ok: true, prepared: true }),
      checkpointTargetUidManifest: async () => {
        throw new Error('checkpoint niet verwacht');
      },
      invalidateTargetUidManifest: async (options) => {
        invalidations.push(options);
        return {
          ok: true,
          invalidated: true,
          lockLost: false,
          generationRole: 'pending',
          pendingAbandoned: true,
          activeManifestInvalidated: true,
          lockReleased: true,
          replayed,
        };
      },
      confirmUidBaseline: async () => ({ ok: true, confirmed: true }),
      listLegacyUidIdentities: async () => [],
      commitSyncPass: async () => { commits += 1; },
      commitTargetedSyncPass: async () => { commits += 1; },
      skipSync: async () => { throw new Error('skip niet verwacht'); },
      failSync: async () => { failures += 1; return { ok: true, applied: true }; },
    };
    const fetcher = async (options) => {
      const invalidation = await options.invalidateTargetUidManifest({
        generationId: PENDING_GENERATION,
        uidValidity: 701,
        expectedStagedCount: 1,
        missingUids: [9],
      });
      return {
        messages: [],
        syncPass: null,
        manifestInvalidation: {
          generationId: PENDING_GENERATION,
          uidValidity: 701,
          resetDetected: true,
          generationRole: 'pending',
          pendingAbandoned: true,
          activeManifestInvalidated: true,
          lockReleased: true,
          replayed: invalidation.replayed,
          missingUids: [9],
        },
      };
    };
    const result = await createRawSyncService({ store, fetcher, accountEmail })
      .syncMailboxFolder({
        accountEmail,
        folder: CAMPAIGN_GMAIL_ALL_MAIL_FOLDER,
        campaignOnly: true,
        incrementalOnly: false,
      });
    return { result, invalidations, commits, failures, lockToken };
  };

  const martijn = await run({ accountEmail: 'martijnven123@gmail.com', replayed: false });
  const serve = await run({ accountEmail: 'serve290@gmail.com', replayed: true });
  for (const recovery of [martijn, serve]) {
    assert.equal(recovery.result.ok, true);
    assert.equal(recovery.result.rebuildPending, false);
    assert.equal(recovery.result.rebuildRequired, true);
    assert.equal(recovery.result.targetManifestInvalidated, true);
    assert.equal(recovery.result.pendingAbandoned, true);
    assert.equal(recovery.result.activeManifestInvalidated, true);
    assert.equal(recovery.result.missingManifestUidCount, 1);
    assert.equal(recovery.commits, 0);
    assert.equal(recovery.failures, 0);
    assert.equal(recovery.invalidations.length, 1);
    assert.equal(recovery.invalidations[0].accountEmail, recovery.result.account);
    assert.equal(recovery.invalidations[0].folder, CAMPAIGN_GMAIL_ALL_MAIL_FOLDER);
    assert.equal(recovery.invalidations[0].lockToken, recovery.lockToken);
    assert.match(recovery.invalidations[0].invalidationId, /^[0-9a-f-]{36}$/);
  }
  assert.equal(martijn.result.manifestInvalidationReplayed, false);
  assert.equal(serve.result.manifestInvalidationReplayed, true);
  assert.notEqual(
    martijn.invalidations[0].invalidationId,
    serve.invalidations[0].invalidationId
  );
});
