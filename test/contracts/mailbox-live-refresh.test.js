const test = require('node:test');
const assert = require('node:assert/strict');

const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const {
  createMailboxSyncService: createRawMailboxSyncService,
  INCREMENTAL_LOCK_RETRY_ATTEMPTS,
  MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS,
  REGULAR_CRON_LOCK_RETRY_ATTEMPTS,
  normalizeMailboxSyncOwner,
  selectMailboxSyncAccounts,
  syncMailboxRequest,
} = require('../../server/services/mailbox-campaign-sync');
const {
  syncInstantlyMailboxResponse,
} = require('../../server/services/mailbox-instantly-integration');
const {
  createMailboxSyncLegacyStore,
} = require('../testlib/mailbox-sync-legacy');

const SERVE_ACCOUNTS = [
  'serve@softora.nl',
  'servecreusen@softora.nl',
  'servec321@gmail.com',
  'serve290@gmail.com',
  'servecreusen7@gmail.com',
];
const MARTIJN_ACCOUNTS = [
  'martijn@softora.nl',
  'martijnvandeven@softora.nl',
  'martijnven123@gmail.com',
  'contact.venvisuals@gmail.com',
];

function account(email) {
  return {
    email,
    imapConfigured: true,
    imapHost: email.endsWith('@gmail.com') ? 'imap.gmail.com' : 'imap.example.test',
  };
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
}

function successfulResponse(body = { ok: true }) {
  return { ok: true, status: 200, json: async () => body };
}

function createMailboxSyncService(options = {}) {
  return createRawMailboxSyncService({
    ...options,
    mailboxIndexStore: createMailboxSyncLegacyStore(options.mailboxIndexStore),
  });
}

test('fast campaign refresh selects only the exact owner accounts and never a legacy mailbox', () => {
  const accounts = [...SERVE_ACCOUNTS, ...MARTIJN_ACCOUNTS, 'zakelijk@theimpactbox.co'].map(account);
  const options = {
    accounts,
    assertReadableAccount() { throw new Error('single account lookup is not expected'); },
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    campaignOnly: true,
  };

  assert.deepEqual(
    selectMailboxSyncAccounts({ ...options, owner: 'serve' }).map((item) => item.email),
    SERVE_ACCOUNTS
  );
  assert.deepEqual(
    selectMailboxSyncAccounts({ ...options, owner: 'martijn' }).map((item) => item.email),
    MARTIJN_ACCOUNTS
  );
  assert.deepEqual(
    selectMailboxSyncAccounts({ ...options, owner: 'both' }).map((item) => item.email),
    [...SERVE_ACCOUNTS, ...MARTIJN_ACCOUNTS]
  );
});

test('fast refresh request remains owner-scoped, incremental and bounded', async () => {
  const calls = [];
  await syncMailboxRequest({
    method: 'POST',
    body: {
      owner: 'servé',
      folder: 'inbox',
      limit: 4,
      campaignOnly: true,
      incrementalOnly: true,
      fastRefresh: true,
    },
    query: {},
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    syncMailbox: async (input) => { calls.push(input); return { ok: true, results: [] }; },
  });

  assert.deepEqual(calls, [{
    accountEmail: '',
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    force: false,
    campaignOnly: true,
    incrementalOnly: true,
    maxConcurrentAccounts: 2,
  }]);
  assert.equal(normalizeMailboxSyncOwner('ALL'), 'both');
  await assert.rejects(
    syncMailboxRequest({
      method: 'POST',
      body: { owner: 'serve', account: 'serve@softora.nl', campaignOnly: true },
      normalizeFolder: String,
      syncMailbox: async () => ({ ok: true, results: [] }),
    }),
    (error) => error.status === 400
  );
  await assert.rejects(
    syncMailboxRequest({
      method: 'POST',
      body: { owner: 'serve', campaignOnly: false },
      normalizeFolder: String,
      syncMailbox: async () => ({ ok: true, results: [] }),
    }),
    (error) => error.status === 400
  );
});

test('mailbox cron houdt normale sync binnen runtime en voegt campaign-inboxrecovery toe', async () => {
  const calls = [];
  const result = await syncMailboxRequest({
    method: 'GET',
    body: {},
    query: {},
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    syncMailbox: async (input) => {
      calls.push(input);
      return { ok: true, results: [{ folders: input.folders }] };
    },
  });

  assert.deepEqual(calls, [
    {
      folders: ['sent'],
      limit: 30,
      force: false,
      campaignOnly: false,
      incrementalOnly: false,
      retryContention: true,
      maxConcurrentAccounts: 2,
    },
    {
      folders: ['inbox'],
      limit: 30,
      force: false,
      campaignOnly: false,
      incrementalOnly: false,
      maxConcurrentAccounts: 2,
    },
    {
      folders: ['inbox', 'coldmail'],
      limit: 30,
      force: false,
      campaignOnly: true,
      incrementalOnly: true,
      maxConcurrentAccounts: 2,
    },
  ]);
  assert.equal(result.results.length, 3);
});

test('mailbox cron waits for sent capacity before starting lower-priority work', async () => {
  const selected = account('martijnven123@gmail.com');
  const waits = [];
  let lockAttempts = 0;
  let fetches = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockAttempts += 1;
        if (lockAttempts < 3) return { ok: false, locked: true, contention: 'capacity' };
        return { ok: true, lockToken: 'sent-cron-lock' };
      },
      finishSync: async () => ({ ok: true }),
      getSyncState: async () => ({ status: 'error', last_uid: 715 }),
      upsertMessages: async () => ({ ok: true, upserted: 1 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => {
      fetches += 1;
      return [{ uid: 715 }];
    },
    getSafeLimit: (value) => Number(value) || 30,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    waitForIncrementalLockRetry: async (delayMs) => waits.push(delayMs),
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    folders: ['sent'],
    retryContention: true,
    maxConcurrentAccounts: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(lockAttempts, 3);
  assert.deepEqual(waits, [500, 500]);
  assert.equal(fetches, 1);
  assert.equal(REGULAR_CRON_LOCK_RETRY_ATTEMPTS, 150);
});

test('incremental IMAP refresh skips expensive history scans but retains exact UID dedupe', async () => {
  const fetches = [];
  const uidReadOptions = [];
  let historyCalls = 0;
  const selected = account('serve@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async (options) => {
        uidReadOptions.push(options);
        return [91, 92];
      },
      listMatchingMessagesForAccounts: async () => { historyCalls += 1; return []; },
      listAllMessagesForAccounts: async () => { historyCalls += 1; return []; },
      getOldestMatchingMessageUid: async () => { historyCalls += 1; return 0; },
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => { fetches.push(input); return []; },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
    maxConcurrentAccounts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(historyCalls, 0);
  assert.equal(uidReadOptions[0].priorityRead, true);
  assert.deepEqual(fetches[0].indexedUids, [91, 92]);
  assert.equal(fetches[0].campaignHistory, false);
  assert.equal(result.results[0].historyBackfill, false);
  assert.equal(result.results[0].incrementalOnly, true);
});

test('incremental campaign refresh carries known contact participants and headers into IMAP search', async () => {
  const fetches = [];
  const campaignSeedReadOptions = [];
  const selected = account('martijn@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [90, 91],
      listCampaignSeedMessagesForAccount: async (options) => {
        campaignSeedReadOptions.push(options);
        return [{
          folder: 'inbox',
          accountEmail: selected.email,
          email: 'info@praktijkkaroena.nl',
          subject: 'Re: Nieuw webdesign',
          messageId: '<karoena-inbound@example.nl>',
        }, {
          folder: 'sent',
          accountEmail: selected.email,
          email: selected.email,
          to: 'info@praktijkkaroena.nl',
          subject: 'Nieuw webdesign',
          messageId: '<karoena-outbound@example.nl>',
          inReplyTo: '<karoena-missing@example.nl>',
          references: '<karoena-inbound@example.nl> <karoena-missing@example.nl>',
        }];
      },
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => { fetches.push(input); return []; },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  await service.syncMailbox({
    owner: 'martijn',
    folders: ['inbox'],
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
    maxConcurrentAccounts: 1,
  });

  assert.equal(fetches.length, 1);
  assert.equal(campaignSeedReadOptions[0].priorityRead, true);
  assert.equal(fetches[0].campaignHistory, false);
  assert.deepEqual(fetches[0].threadRecipientTerms, [
    'info@praktijkkaroena.nl',
    'praktijkkaroena.nl',
  ]);
  assert.deepEqual(fetches[0].threadReferenceIds, [
    '<karoena-missing@example.nl>',
  ]);
  assert.equal(fetches[0].includeThreadReferenceSearch, true);
});

test('incremental campaign refresh blijft fail-closed als priority-seeds ontbreken', async () => {
  const selected = account('serve@softora.nl');
  const seedReads = [];
  const finalizerErrors = [];
  let fetches = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async (options) => {
        finalizerErrors.push(options.error);
        return { ok: true };
      },
      listMessageUidsForAccount: async () => [],
      listCampaignSeedMessagesForAccount: async (options) => {
        seedReads.push(options);
        return null;
      },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => {
      fetches += 1;
      return [];
    },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    accountEmail: selected.email,
    folders: ['inbox'],
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.ok, false);
  assert.equal(seedReads[0].priorityRead, true);
  assert.equal(result.results[0].error, 'Mailbox-index voor campagnecontacten kon niet worden gelezen.');
  assert.deepEqual(finalizerErrors, ['Mailbox-index voor campagnecontacten kon niet worden gelezen.']);
  assert.equal(fetches, 0);
});

test('complete campaign sync gebruikt priority-read voor beide veilige legacy fallbacks', async () => {
  const selected = account('serve@softora.nl');
  for (const fallback of ['matching', 'all']) {
    const oldestReads = [];
    const uidReads = [];
    const fallbackReads = [];
    const mailboxIndexStore = {
      acquireSyncLock: async () => ({ ok: true, lockToken: `lock-${fallback}` }),
      finishSync: async () => ({ ok: true }),
      getOldestMatchingMessageUid: async (options) => {
        oldestReads.push(options);
        return 17;
      },
      listMessageUidsForAccount: async (options) => {
        uidReads.push(options);
        return [18, 19];
      },
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
      ...(fallback === 'matching'
        ? {
            listMatchingMessagesForAccounts: async (options) => {
              fallbackReads.push(options);
              return [];
            },
          }
        : {
            listAllMessagesForAccounts: async (options) => {
              fallbackReads.push(options);
              return [];
            },
          }),
    };
    const service = createMailboxSyncService({
      mailboxIndexStore,
      assertReadableAccount: () => selected,
      canUseMailboxIndex: () => true,
      fetchMessagesFromImap: async () => [],
      getSafeLimit: (value) => Number(value) || 50,
      getAccounts: () => [selected],
      normalizeEmail: (value) => String(value || '').toLowerCase(),
      normalizeFolder: (value) => String(value || '').toLowerCase(),
      logger: { error() {} },
    });

    const result = await service.syncMailboxFolder({
      accountEmail: selected.email,
      folder: 'sent',
      campaignOnly: true,
      incrementalOnly: false,
    });

    assert.equal(result.ok, true);
    assert.equal(oldestReads[0].priorityRead, true);
    assert.equal(uidReads[0].priorityRead, true);
    assert.equal(fallbackReads.every((options) => options.priorityRead === true), true);
    assert.deepEqual(
      fallbackReads.map((options) => options.folder),
      fallback === 'matching' ? ['inbox'] : ['inbox', 'sent']
    );
  }
});

test('incremental campaign refresh bounds participant fallback before IMAP', async () => {
  const fetches = [];
  const selected = account('martijn@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [],
      listCampaignSeedMessagesForAccount: async () => Array.from(
        { length: 100 },
        (_item, index) => ({
          folder: 'inbox',
          accountEmail: selected.email,
          email: `contact-${index}@example-${index}.nl`,
          messageId: `<campaign-${index}@example.test>`,
        })
      ),
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => { fetches.push(input); return []; },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'inbox',
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(fetches[0].threadRecipientTerms.length, MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS);
});

test('incremental refresh waits for transient mailbox lock contention instead of silently skipping', async () => {
  const selected = account('serve@softora.nl');
  const waits = [];
  let lockAttempts = 0;
  let fetches = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockAttempts += 1;
        if (lockAttempts < 3) {
          return {
            ok: false,
            locked: false,
            error: new Error('MAILBOX_SYNC_GLOBAL_CAP_REACHED'),
          };
        }
        return { ok: true, lockToken: 'lock-after-contention' };
      },
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async () => ({ ok: true, upserted: 1 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => {
      fetches += 1;
      return [{ uid: 93 }];
    },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    waitForIncrementalLockRetry: async (delayMs) => waits.push(delayMs),
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
    maxConcurrentAccounts: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(lockAttempts, 3);
  assert.deepEqual(waits, [500, 500]);
  assert.equal(fetches, 1);
});

test('incremental refresh reports persistent lock contention as retryable and incomplete', async () => {
  const selected = account('serve@softora.nl');
  let lockAttempts = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockAttempts += 1;
        return { ok: false, locked: true };
      },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => {
      throw new Error('provider fetch must not run without a lock');
    },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    waitForIncrementalLockRetry: async () => {},
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.ok, false);
  assert.equal(lockAttempts, INCREMENTAL_LOCK_RETRY_ATTEMPTS);
  assert.deepEqual(result.results[0], {
    ok: false,
    skipped: true,
    reason: 'locked',
    retryable: true,
  });
});

test('incremental refresh coalesces an already-running sync for the same mailbox folder', async () => {
  const selected = account('serve@softora.nl');
  let lockAttempts = 0;
  let fetches = 0;
  let waits = 0;
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => {
        lockAttempts += 1;
        return { ok: false, locked: true, contention: 'active_lock' };
      },
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => {
      fetches += 1;
      return [];
    },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    waitForIncrementalLockRetry: async () => { waits += 1; },
    logger: { error() {} },
  });

  const result = await service.syncMailbox({
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.ok, true);
  assert.equal(lockAttempts, 1);
  assert.equal(fetches, 0);
  assert.equal(waits, 0);
  assert.deepEqual(result.results, [
    { ok: true, skipped: true, reason: 'coalesced' },
  ]);
});

test('Instantly fast refresh supports exact owners and both owners without mixing', async () => {
  const calls = [];
  let activeSyncs = 0;
  let peakActiveSyncs = 0;
  const service = {
    getStatus: () => ({ configured: true, missing: [] }),
    syncOwner: async (owner, options) => {
      calls.push({ owner, options });
      activeSyncs += 1;
      peakActiveSyncs = Math.max(peakActiveSyncs, activeSyncs);
      await new Promise((resolve) => setImmediate(resolve));
      activeSyncs -= 1;
      return { ok: true, owner };
    },
  };
  const response = responseRecorder();
  await syncInstantlyMailboxResponse({
    instantlyMailboxService: service,
    req: { body: { owner: 'both', fastRefresh: true }, query: {} },
    res: response,
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [
    { owner: 'serve', options: { minIntervalMs: 3 * 60 * 1000 } },
    { owner: 'martijn', options: { minIntervalMs: 3 * 60 * 1000 } },
  ]);
  assert.equal(peakActiveSyncs, 1);
  assert.deepEqual(response.body.owners, ['serve', 'martijn']);

  const rejected = responseRecorder();
  await syncInstantlyMailboxResponse({
    instantlyMailboxService: service,
    req: { body: { owner: 'someone-else' }, query: {} },
    res: rejected,
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, 'INSTANTLY_MAILBOX_OWNER_INVALID');
});

test('scope change cancels stale owner refresh before it can overwrite the list', async () => {
  let owner = 'serve';
  const pending = [];
  const loads = [];
  const controller = refreshModule.create({
    autoStart: false,
    getFolder: () => 'outreach',
    getOwner: () => owner,
    fetch: (url) => new Promise((resolve) => pending.push({ url, resolve })),
    loadMessages: async (options) => loads.push(options),
    setTimeout: () => 1,
    clearTimeout() {},
  });

  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(pending.length, 1);
  owner = 'martijn';
  controller.scopeChanged();
  pending.forEach(({ resolve }) => resolve(successfulResponse()));
  assert.equal(await refresh, false);
  assert.deepEqual(loads, []);
  controller.destroy();
});

test('temporary provider failures retry once and then update the list in place', async () => {
  const attempts = new Map();
  const loads = [];
  const controller = refreshModule.create({
    autoStart: false,
    getFolder: () => 'outreach',
    getOwner: () => 'martijn',
    fetch: async (url) => {
      const attempt = (attempts.get(url) || 0) + 1;
      attempts.set(url, attempt);
      if (attempt === 1) {
        return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) };
      }
      return successfulResponse();
    },
    loadMessages: async (options) => loads.push(options),
    wait: async () => {},
    setTimeout: () => 1,
    clearTimeout() {},
  });

  assert.equal(await controller.refresh(), true);
  assert.equal(attempts.get('/api/mailbox/sync'), 2);
  assert.equal(attempts.get('/api/mailbox/instantly/sync'), 2);
  assert.equal(loads.length, 2);
  loads.forEach((options) => {
    assert.equal(options.skipProviderRefresh, true);
    assert.equal(options.skipPageBootstrap, true);
    assert.equal(options.preserveOnError, true);
  });
  controller.destroy();
});

test('provider-success met bewaarde oude lijst blijft gedeeltelijk in plaats van verbindingsfout', async () => {
  const ageLabel = {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  let loadCalls = 0;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    getFolder: () => 'inbox',
    getAccount: () => 'serve@softora.nl',
    fetch: async () => successfulResponse(),
    loadMessages: async () => { loadCalls += 1; return false; },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  assert.equal(await controller.refresh(), false);
  assert.equal(loadCalls, 1);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
  assert.equal(ageLabel.attributes['aria-label'], 'Niet alle mailboxproviders konden worden bijgewerkt voor serve@softora.nl.');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'partial' });
  controller.destroy();
});

test('latere geslaagde outreach-lijstrefresh herstelt een eerdere tijdelijke cachefallback', async () => {
  const ageLabel = { textContent: '', setAttribute() {} };
  let loadCalls = 0;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async () => successfulResponse(),
    loadMessages: async () => {
      loadCalls += 1;
      return loadCalls === 2;
    },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  assert.equal(await controller.refresh(), true);
  assert.equal(loadCalls, 2);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'ok' });
  controller.destroy();
});

test('outreach refresh toont IMAP-mail voordat de Instantly-provider start', async () => {
  const events = [];
  let finishImap;
  let finishInstantly;
  const controller = refreshModule.create({
    autoStart: false,
    getFolder: () => 'outreach',
    getOwner: () => 'both',
    fetch: (url) => {
      events.push(`start:${url}`);
      return new Promise((resolve) => {
        if (url === '/api/mailbox/sync') finishImap = () => resolve(successfulResponse());
        else finishInstantly = () => resolve(successfulResponse());
      });
    },
    loadMessages: async () => { events.push('list:updated'); return true; },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  const refresh = controller.refresh();
  await Promise.resolve();
  assert.deepEqual(events, ['start:/api/mailbox/sync']);

  finishImap();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    'start:/api/mailbox/sync',
    'list:updated',
    'start:/api/mailbox/instantly/sync',
  ]);

  finishInstantly();
  assert.equal(await refresh, true);
  assert.equal(events.at(-1), 'list:updated');
  controller.destroy();
});

test('foreground refresh status is exclusive while active, successful, partial and failed', async () => {
  const ageLabel = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false,
    attributes: {},
    classList: { values: new Set(), toggle(name, active) { active ? this.values.add(name) : this.values.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  };
  let mode = 'success';
  let releaseFirstRequest;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    button,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async (url) => {
      if (mode === 'pending' && url === '/api/mailbox/sync') {
        return new Promise((resolve) => { releaseFirstRequest = resolve; });
      }
      if (mode === 'partial' && url === '/api/mailbox/instantly/sync') {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid' }) };
      }
      if (mode === 'error') {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid' }) };
      }
      return successfulResponse();
    },
    loadMessages: async () => true,
    setTimeout: () => 1,
    clearTimeout() {},
  });

  assert.equal(ageLabel.textContent, 'Nog niet gecontroleerd');
  assert.equal(button.attributes['aria-label'], 'Mailbox nu controleren voor serve');
  assert.equal(button.attributes.title, 'Mailbox nu controleren voor serve');
  assert.equal(await controller.refresh(), true);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.match(ageLabel.attributes.title, /^Laatste volledige providercontrole voor serve:/);
  assert.match(button.attributes['aria-label'], /^Mailbox opnieuw controleren voor serve; laatste volledige controle om /);

  mode = 'pending';
  const pendingRefresh = controller.refresh({ manual: true });
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.doesNotMatch(ageLabel.textContent, /geleden|·/);
  assert.equal(ageLabel.attributes['aria-label'], 'Mailboxproviders worden gecontroleerd voor serve.');
  assert.equal(button.attributes['aria-label'], 'Mailboxcontrole bezig voor serve');
  assert.equal(button.attributes.title, 'Mailboxcontrole bezig voor serve');
  assert.equal(button.attributes['aria-busy'], 'true');
  releaseFirstRequest(successfulResponse());
  assert.equal(await pendingRefresh, true);

  mode = 'partial';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
  assert.doesNotMatch(ageLabel.textContent, /geleden|·/);
  assert.equal(button.attributes['aria-label'], 'Mailbox deels bijgewerkt voor serve; opnieuw controleren');
  assert.equal(button.attributes['aria-busy'], 'false');

  mode = 'error';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Verbindingsfout · opnieuw proberen');
  assert.doesNotMatch(ageLabel.textContent, /geleden/);
  assert.match(ageLabel.attributes.title, /Verbindingsfout/);
  assert.match(ageLabel.attributes.title, /automatisch herstel blijft actief/);
  assert.equal(button.attributes['aria-label'], 'Verbindingsfout voor serve; mailbox opnieuw controleren');
  assert.equal(button.attributes.title, 'Verbindingsfout voor serve; mailbox opnieuw controleren');
  controller.destroy();
});

test('automatische initial background poll toont checking en een handmatige overlap coalescet', async () => {
  const ageLabel = {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false, attributes: {},
    classList: { values: new Set(), toggle(name, active) { active ? this.values.add(name) : this.values.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  };
  let release;
  let requestCount = 0;
  const timers = [];
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    button,
    getFolder: () => 'inbox',
    getAccount: () => 'martijn@softora.nl',
    fetch: () => {
      requestCount += 1;
      return new Promise((resolve) => { release = resolve; });
    },
    loadMessages: async () => true,
    setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });

  controller.start();
  assert.equal(timers[0].delay, 0);
  timers[0].handler();
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(ageLabel.attributes['aria-label'], 'Mailboxproviders worden gecontroleerd voor martijn@softora.nl.');
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.equal(button.attributes['aria-label'], 'Mailboxcontrole bezig voor martijn@softora.nl');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 1, status: 'checking' });

  const foreground = controller.refresh({ manual: true });
  assert.equal(requestCount, 1);
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.equal(controller.snapshot().foregroundInFlight, 1);

  release(successfulResponse());
  assert.equal(await foreground, true);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], 'false');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'ok' });
  controller.destroy();
});

test('eerste background failure toont expliciet herstel zonder eerdere succesvolle controle', async () => {
  const ageLabel = {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false, attributes: {},
    classList: { values: new Set(), toggle(name, active) { active ? this.values.add(name) : this.values.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  };
  let loadCalls = 0;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    button,
    getFolder: () => 'inbox',
    getAccount: () => 'serve@softora.nl',
    fetch: async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'provider niet bereikbaar' }),
    }),
    loadMessages: async () => { loadCalls += 1; return true; },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  const background = controller.refresh();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.equal(await background, false);
  assert.equal(ageLabel.textContent, 'Verbindingsfout · opnieuw proberen');
  assert.equal(ageLabel.attributes['aria-label'], 'Verbindingsfout voor serve@softora.nl; de huidige mailbox blijft zichtbaar. Klik om opnieuw te proberen; automatisch herstel blijft actief.');
  assert.equal(button.attributes['aria-label'], 'Verbindingsfout voor serve@softora.nl; mailbox opnieuw controleren');
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], 'false');
  assert.equal(loadCalls, 0);
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'recovering' });
  controller.destroy();
});

test('ownerwissel tijdens checking toont nooit de status van de oude owner', async () => {
  const ageLabel = {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false, attributes: {},
    classList: { values: new Set(), toggle(name, active) { active ? this.values.add(name) : this.values.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  };
  let owner = 'serve';
  let releaseOldOwner;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    button,
    getFolder: () => 'outreach',
    getOwner: () => owner,
    fetch: () => new Promise((resolve) => { releaseOldOwner = resolve; }),
    loadMessages: async () => true,
    setTimeout: () => 1,
    clearTimeout() {},
  });

  const oldOwnerRefresh = controller.refresh();
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(ageLabel.attributes['aria-label'], 'Mailboxproviders worden gecontroleerd voor serve.');

  owner = 'martijn';
  controller.scopeChanged();
  assert.equal(ageLabel.textContent, 'Nog niet gecontroleerd');
  assert.equal(ageLabel.attributes['aria-label'], 'Laatste volledige providercontrole voor martijn: nog niet voltooid');
  assert.equal(button.attributes['aria-label'], 'Mailbox nu controleren voor martijn');
  assert.equal(button.disabled, false);
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'idle' });

  releaseOldOwner(successfulResponse());
  assert.equal(await oldOwnerRefresh, false);
  assert.equal(ageLabel.textContent, 'Nog niet gecontroleerd');
  assert.equal(ageLabel.attributes['aria-label'], 'Laatste volledige providercontrole voor martijn: nog niet voltooid');
  assert.equal(button.attributes['aria-label'], 'Mailbox nu controleren voor martijn');
  assert.doesNotMatch(ageLabel.attributes['aria-label'], /serve/);
  assert.doesNotMatch(button.attributes['aria-label'], /serve/);
  controller.destroy();
});

test('uitgestelde mailboxboot toont direct controleren en houdt automatisch herstel bereikbaar', async () => {
  const ageLabel = {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const button = {
    disabled: false, attributes: {},
    classList: { values: new Set(), toggle(name, active) { active ? this.values.add(name) : this.values.delete(name); } },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener() {},
  };
  const timers = [];
  const releases = [];
  const controller = refreshModule.create({
    autoStart: false,
    initiallyChecking: true,
    ageLabel,
    button,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: () => new Promise((resolve) => { releases.push(resolve); }),
    loadMessages: async () => true,
    setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });

  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'checking' });

  controller.scopeChanged();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.equal(button.attributes['aria-busy'], 'true');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'checking' });

  controller.start();
  assert.equal(timers[0].delay, 0);
  timers[0].handler();
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 1, status: 'checking' });

  releases[0](successfulResponse());
  await new Promise((resolve) => setImmediate(resolve));
  releases[1](successfulResponse());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.equal(button.disabled, false);
  controller.destroy();
});

test('dubbele provider-timeout retryt exact eenmaal en ruimt foreground state op', async () => {
  const timeoutHandlers = [];
  let attempts = 0;
  const ageLabel = { textContent: '', setAttribute() {} };
  const button = {
    disabled: false,
    classList: { toggle() {} },
    setAttribute() {}, addEventListener() {},
  };
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    button,
    getFolder: () => 'inbox',
    getAccount: () => 'martijn@softora.nl',
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      attempts += 1;
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    setTimeout(handler, delay) {
      if (delay === refreshModule.REFRESH_REQUEST_TIMEOUT_MS) timeoutHandlers.push(handler);
      return timeoutHandlers.length || 1;
    },
    clearTimeout() {},
    wait: async () => {},
  });

  const pending = controller.refresh({ manual: true });
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.equal(button.disabled, true);
  assert.equal(timeoutHandlers.length, 1);
  timeoutHandlers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2);
  assert.equal(timeoutHandlers.length, 2);
  timeoutHandlers[1]();
  assert.equal(await pending, false);
  assert.equal(button.disabled, false);
  assert.equal(ageLabel.textContent, 'Verbindingsfout · opnieuw proberen');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'recovering' });
  controller.destroy();
});

test('eerste provider-timeout kan bij de tweede poging volledig herstellen', async () => {
  const timeoutHandlers = [];
  const ageLabel = { textContent: '', setAttribute() {} };
  let attempts = 0;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    getFolder: () => 'inbox',
    getAccount: () => 'serve@softora.nl',
    fetch: (_url, init) => {
      attempts += 1;
      if (attempts === 2) return Promise.resolve(successfulResponse());
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      });
    },
    loadMessages: async () => true,
    setTimeout(handler, delay) {
      if (delay === refreshModule.REFRESH_REQUEST_TIMEOUT_MS) timeoutHandlers.push(handler);
      return timeoutHandlers.length || 1;
    },
    clearTimeout() {},
    wait: async () => {},
  });

  const pending = controller.refresh();
  await Promise.resolve();
  assert.equal(timeoutHandlers.length, 1);
  timeoutHandlers[0]();
  assert.equal(await pending, true);
  assert.equal(attempts, 2);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'ok' });
  controller.destroy();
});

test('zichtbare mailbox geeft providerlocks na een storing een volle minuut herstelruimte', async () => {
  assert.equal(refreshModule.REFRESH_REQUEST_TIMEOUT_MS, 75_000);
  const timers = [];
  const controller = refreshModule.create({
    autoStart: false,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: 'tijdelijk' }) }),
    setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });

  controller.start();
  assert.equal(timers.at(-1).delay, 0);
  await timers.at(-1).handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.at(-1).delay, refreshModule.RECOVERY_REFRESH_INTERVAL_MS);
  assert.equal(refreshModule.RECOVERY_REFRESH_INTERVAL_MS, 60_000);
  controller.destroy();
});

test('visible, background, focus and reconnect scheduling keep refresh bounded', () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = [];
  const documentRef = {
    visibilityState: 'visible',
    getElementById() { return null; },
    addEventListener(event, handler) { documentListeners.set(event, handler); },
    removeEventListener(event) { documentListeners.delete(event); },
  };
  const windowRef = {
    addEventListener(event, handler) { windowListeners.set(event, handler); },
    removeEventListener(event) { windowListeners.delete(event); },
  };
  const controller = refreshModule.create({
    autoStart: false,
    document: documentRef,
    window: windowRef,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async () => successfulResponse(),
    setTimeout: (_handler, delay) => { timers.push(delay); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });

  controller.start();
  assert.equal(timers.at(-1), 0);
  documentRef.visibilityState = 'hidden';
  documentListeners.get('visibilitychange')();
  assert.equal(timers.at(-1), refreshModule.HIDDEN_REFRESH_INTERVAL_MS);
  documentRef.visibilityState = 'visible';
  documentListeners.get('visibilitychange')();
  assert.equal(timers.at(-1), 0);
  windowListeners.get('focus')();
  assert.equal(timers.at(-1), 0);
  windowListeners.get('online')();
  assert.equal(timers.at(-1), 0);
  controller.destroy();
});

test('achtergrondrefresh wacht wanneer een user-detailrequest actief is', async () => {
  const previousState = global.SoftoraMailboxDetailState;
  const timers = [];
  let fetchCalls = 0;
  global.SoftoraMailboxDetailState = { snapshot: () => ({ inFlight: 1 }) };
  try {
    const controller = refreshModule.create({
      autoStart: false,
      getFolder: () => 'outreach',
      getOwner: () => 'both',
      fetch: async () => { fetchCalls += 1; return successfulResponse(); },
      setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
      clearTimeout() {},
    });
    controller.start();
    assert.equal(await controller.refresh(), false);
    assert.equal(fetchCalls, 0);
    assert.equal(timers.at(-1).delay, 1500);
    controller.destroy();
  } finally {
    global.SoftoraMailboxDetailState = previousState;
  }
});

test('nieuwe detailselectie onderbreekt lopende achtergrondproviderrefresh', async () => {
  const windowListeners = new Map();
  const timers = [];
  const ageLabel = { textContent: '', setAttribute() {} };
  let requestSignal;
  const windowRef = {
    addEventListener(event, handler) { windowListeners.set(event, handler); },
    removeEventListener(event) { windowListeners.delete(event); },
  };
  const controller = refreshModule.create({
    autoStart: false,
    window: windowRef,
    ageLabel,
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      requestSignal = init.signal;
      init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
    }),
    setTimeout: (_handler, delay) => { timers.push(delay); return timers.length; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });
  controller.start();
  timers.length = 0;
  const refresh = controller.refresh();
  await Promise.resolve();
  windowListeners.get('softora:mailbox-detail-priority')();
  assert.equal(requestSignal.aborted, true);
  assert.equal(await refresh, false);
  assert.equal(ageLabel.textContent, 'Nog niet gecontroleerd');
  assert.deepEqual(controller.snapshot(), { foregroundInFlight: 0, inFlight: 0, status: 'idle' });
  assert.equal(timers.includes(0), false);
  assert.equal(timers.at(-1), 1500);
  controller.destroy();
});

test('BFCache return resumes one immediate mailbox refresh instead of leaving the page stale', async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timeouts = new Map();
  const intervals = new Map();
  const requestSignals = [];
  let nextTimerId = 0;
  const documentRef = {
    visibilityState: 'visible',
    getElementById() { return null; },
    addEventListener(event, handler) { documentListeners.set(event, handler); },
    removeEventListener(event, handler) {
      if (documentListeners.get(event) === handler) documentListeners.delete(event);
    },
  };
  const windowRef = {
    addEventListener(event, handler) { windowListeners.set(event, handler); },
    removeEventListener(event, handler) {
      if (windowListeners.get(event) === handler) windowListeners.delete(event);
    },
  };
  const controller = refreshModule.create({
    autoStart: false,
    document: documentRef,
    window: windowRef,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      requestSignals.push(init.signal);
      init.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
    setTimeout(handler, delay) {
      const id = ++nextTimerId;
      timeouts.set(id, { handler, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      if (timeouts.has(id)) timeouts.get(id).active = false;
    },
    setInterval(handler, delay) {
      const id = ++nextTimerId;
      intervals.set(id, { handler, delay, active: true });
      return id;
    },
    clearInterval(id) {
      if (intervals.has(id)) intervals.get(id).active = false;
    },
  });

  controller.start();
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(requestSignals.length, 1);
  windowListeners.get('pagehide')({ persisted: true });
  assert.equal(requestSignals.every((signal) => signal.aborted), true);
  assert.equal(await refresh, false);
  assert.equal(Array.from(timeouts.values()).some((entry) => entry.active), false);

  windowListeners.get('pageshow')({ persisted: true });
  assert.deepEqual(
    Array.from(timeouts.values()).filter((entry) => entry.active).map((entry) => entry.delay),
    [0]
  );
  assert.equal(Array.from(intervals.values()).filter((entry) => entry.active).length, 1);
  controller.destroy();
});
