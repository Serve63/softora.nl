const test = require('node:test');
const assert = require('node:assert/strict');

const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const {
  createMailboxSyncService,
  INCREMENTAL_LOCK_RETRY_ATTEMPTS,
  MAX_INCREMENTAL_CAMPAIGN_RECIPIENT_TERMS,
  normalizeMailboxSyncOwner,
  selectMailboxSyncAccounts,
  syncMailboxRequest,
} = require('../../server/services/mailbox-campaign-sync');
const {
  syncInstantlyMailboxResponse,
} = require('../../server/services/mailbox-instantly-integration');

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
      accountEmail: '',
      owner: '',
      folders: ['inbox', 'sent'],
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
  assert.equal(result.results.length, 2);
});

test('incremental IMAP refresh skips expensive history scans but retains exact UID dedupe', async () => {
  const fetches = [];
  let historyCalls = 0;
  const selected = account('serve@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [91, 92],
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
  assert.deepEqual(fetches[0].indexedUids, [91, 92]);
  assert.equal(fetches[0].campaignHistory, false);
  assert.equal(result.results[0].historyBackfill, false);
  assert.equal(result.results[0].incrementalOnly, true);
});

test('incremental campaign refresh carries known contact participants and headers into IMAP search', async () => {
  const fetches = [];
  const selected = account('martijn@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [90, 91],
      listCampaignSeedMessagesForAccount: async () => [{
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
      }],
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

test('refresh status is exclusive while active, successful, partial and failed', async () => {
  const ageLabel = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  let mode = 'success';
  let releaseFirstRequest;
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
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

  assert.equal(await controller.refresh(), true);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.match(ageLabel.attributes.title, /^Laatste volledige providercontrole voor serve:/);

  mode = 'pending';
  const pendingRefresh = controller.refresh();
  await Promise.resolve();
  assert.equal(ageLabel.textContent, 'Controleren…');
  assert.doesNotMatch(ageLabel.textContent, /geleden|·/);
  assert.equal(ageLabel.attributes['aria-label'], 'Mailboxproviders worden gecontroleerd voor serve.');
  releaseFirstRequest(successfulResponse());
  assert.equal(await pendingRefresh, true);

  mode = 'partial';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
  assert.doesNotMatch(ageLabel.textContent, /geleden|·/);

  mode = 'error';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Zojuist gecontroleerd');
  assert.doesNotMatch(ageLabel.textContent, /geleden|·/);
  assert.match(ageLabel.attributes.title, /Tijdelijke verbindingsstoring/);
  assert.doesNotMatch(ageLabel.textContent, /mislukt/i);
  controller.destroy();
});

test('zichtbare mailbox herstelt na een storing binnen vijftien seconden', async () => {
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
  assert.equal(refreshModule.RECOVERY_REFRESH_INTERVAL_MS, 15_000);
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
  let requestSignal;
  const windowRef = {
    addEventListener(event, handler) { windowListeners.set(event, handler); },
    removeEventListener(event) { windowListeners.delete(event); },
  };
  const controller = refreshModule.create({
    autoStart: false,
    window: windowRef,
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById() { return null; } },
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: (_url, init) => new Promise((_resolve, reject) => {
      requestSignal = init.signal;
      init.signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
    }),
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  });
  controller.start();
  const refresh = controller.refresh();
  await Promise.resolve();
  windowListeners.get('softora:mailbox-detail-priority')();
  assert.equal(requestSignal.aborted, true);
  assert.equal(await refresh, false);
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
