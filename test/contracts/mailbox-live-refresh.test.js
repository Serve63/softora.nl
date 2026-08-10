const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const {
  CAMPAIGN_SYNC_FAST_FETCH_LIMIT,
  MAILBOX_SYNC_FAST_MUTATION_LEASE_SECONDS,
  createMailboxSyncService,
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

function withSyncReadHealth(messages = []) {
  const uids = messages.map((message) => Number(message?.uid) || 0).filter(Boolean);
  Object.defineProperty(messages, 'syncReadHealth', {
    value: {
      uidValidity: 777,
      folderMissing: false,
      parseFailures: [],
      selectedUids: uids,
      yieldedUids: uids,
      missingUids: [],
      selectedCount: uids.length,
      yieldedCount: uids.length,
    },
  });
  return messages;
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

  assert.equal(calls.length, 1);
  assert.deepEqual({
    ...calls[0],
    deadlineAt: 0,
    runId: '',
  }, {
    accountEmail: '',
    owner: 'serve',
    folders: ['inbox'],
    limit: 4,
    force: false,
    campaignOnly: true,
    incrementalOnly: true,
    fastRefresh: true,
    maxConcurrentAccounts: 3,
    folderTimeoutMs: 15_000,
    runTimeoutMs: 22_000,
    deadlineAt: 0,
    runId: '',
  });
  assert.equal(typeof calls[0].runId, 'string');
  assert.ok(calls[0].deadlineAt > Date.now());
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

test('incremental IMAP refresh skips expensive history scans but retains exact UID dedupe', async () => {
  const fetches = [];
  let historyCalls = 0;
  const selected = account('serve@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [91, 92],
      listMatchingMessagesForAccounts: async () => { historyCalls += 1; return []; },
      listAllMessagesForAccounts: async () => { historyCalls += 1; return []; },
      getOldestMatchingMessageUid: async () => { historyCalls += 1; return 0; },
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => {
      fetches.push(input);
      return withSyncReadHealth([]);
    },
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'inbox',
    limit: 4,
    campaignOnly: true,
    incrementalOnly: true,
  });

  assert.equal(result.ok, true);
  assert.equal(historyCalls, 0);
  assert.deepEqual(fetches[0].indexedUids, [91, 92]);
  assert.equal(fetches[0].campaignHistory, false);
  assert.equal(result.historyBackfill, false);
  assert.equal(result.incrementalOnly, true);
});

test('fast refresh bounds an uncertain mutation lease to the recovery window', async () => {
  const mutationRuns = [];
  const selected = account('serve@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      finishSync: async () => ({ ok: true }),
      getSyncState: async () => ({
        last_uid: 50,
        uid_validity: 777,
        last_synced_at: '2026-08-10T18:00:00.000Z',
      }),
      listMessageUidSyncStateForAccount: async () => ({
        indexedUids: [50], deferredQuarantineUids: [], retryDueQuarantineUids: [],
      }),
      upsertMessages: async () => ({ ok: true, upserted: 0 }),
    },
    campaignMutationRunner: {
      isAvailable: () => true,
      async run(options, task) {
        mutationRuns.push(options);
        const controller = new AbortController();
        return task({
          signal: controller.signal,
          mutationId: '11111111-1111-4111-8111-111111111111',
          requestKey: options.requestKey,
          assertActive() {},
        });
      },
    },
    requireCampaignMutationJournal: true,
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async () => withSyncReadHealth([]),
    getSafeLimit: (value) => Number(value) || 50,
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: selected.email,
    folder: 'inbox',
    campaignOnly: true,
    incrementalOnly: true,
    fastRefresh: true,
    folderTimeoutMs: 15_000,
  });

  assert.equal(result.complete, true);
  assert.equal(mutationRuns.length, 1);
  assert.equal(mutationRuns[0].leaseSeconds, MAILBOX_SYNC_FAST_MUTATION_LEASE_SECONDS);
  assert.equal(MAILBOX_SYNC_FAST_MUTATION_LEASE_SECONDS, 30);
});

test('fast IMAP refresh drains a burst larger than four messages in one cycle', async () => {
  let fetchInput = null;
  const selected = account('serve@softora.nl');
  const service = createMailboxSyncService({
    mailboxIndexStore: {
      acquireSyncLock: async () => ({ ok: true, lockToken: 'lock' }),
      prepareUidValidity: async () => ({ ok: true, uidValidity: 777 }),
      finishSync: async () => ({ ok: true }),
      listMessageUidsForAccount: async () => [],
      upsertMessages: async ({ messages }) => ({ ok: true, upserted: messages.length }),
    },
    assertReadableAccount: () => selected,
    canUseMailboxIndex: () => true,
    fetchMessagesFromImap: async (input) => {
      fetchInput = input;
      return withSyncReadHealth(
        Array.from({ length: 8 }, (_item, index) => ({ uid: 100 + index }))
      );
    },
    getSafeLimit: (value) => Math.min(100, Math.max(1, Number(value) || 50)),
    getAccounts: () => [selected],
    normalizeEmail: (value) => String(value || '').toLowerCase(),
    normalizeFolder: (value) => String(value || '').toLowerCase(),
    logger: { error() {} },
  });

  const result = await service.syncMailboxFolder({
    accountEmail: selected.email, folder: 'inbox', limit: 4,
    campaignOnly: true, incrementalOnly: true, fastRefresh: true,
  });

  assert.equal(fetchInput.limit, CAMPAIGN_SYNC_FAST_FETCH_LIMIT + 1);
  assert.equal(result.synced, 8);
  assert.equal(result.complete, true);
});

test('Instantly fast refresh supports exact owners and both owners without mixing', async () => {
  const calls = [];
  const service = {
    getStatus: () => ({ configured: true, missing: [] }),
    syncOwner: async (owner, options) => { calls.push({ owner, options }); return { ok: true, owner }; },
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

test('Instantly both-owner sync wacht op de gezonde owner en meldt partiële uitval als 207', async () => {
  let releaseMartijn;
  let completed = false;
  const service = {
    getStatus: () => ({ configured: true, missing: [] }),
    syncOwner: async (owner) => {
      if (owner === 'serve') {
        const error = new Error('Serve faalt direct');
        error.code = 'INSTANTLY_SERVE_FAILED';
        error.status = 503;
        throw error;
      }
      return new Promise((resolve) => {
        releaseMartijn = () => resolve({ ok: true, owner: 'martijn' });
      });
    },
  };
  const response = responseRecorder();
  const pending = syncInstantlyMailboxResponse({
    instantlyMailboxService: service,
    req: { body: { owner: 'both' }, query: {} },
    res: response,
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
  }).then(() => { completed = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  releaseMartijn();
  await pending;

  assert.equal(response.statusCode, 207);
  assert.equal(response.body.ok, false);
  assert.deepEqual(response.body.results.map((result) => [result.owner, result.ok]), [
    ['serve', false],
    ['martijn', true],
  ]);
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
  assert.equal(pending.length, 2);
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
  assert.equal(loads.length, 1);
  assert.equal(loads[0].skipPageBootstrap, true);
  assert.equal(loads[0].preserveOnError, true);
  controller.destroy();
});

test('provider auth failures never block the read-only mailbox list recovery', async () => {
  const ageLabel = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const providerCalls = [];
  const loads = [];
  const controller = refreshModule.create({
    autoStart: false,
    ageLabel,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async (url) => {
      providerCalls.push(url);
      return {
        ok: false,
        status: 403,
        json: async () => ({ error: 'auth hydration unavailable' }),
      };
    },
    loadMessages: async (options) => {
      loads.push(options);
      return true;
    },
    setTimeout: () => 1,
    clearTimeout() {},
  });

  assert.equal(await controller.refresh(), false);
  assert.deepEqual(providerCalls.sort(), [
    '/api/mailbox/instantly/sync',
    '/api/mailbox/sync',
  ]);
  assert.equal(loads.length, 1);
  assert.equal(loads[0].skipProviderRefresh, true);
  assert.equal(loads[0].preserveOnError, true);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
  assert.match(ageLabel.attributes.title, /Niet alle mailboxproviders/);
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
      if (mode === 'partial-sync' && url === '/api/mailbox/sync') {
        return {
          ok: true,
          status: 207,
          json: async () => ({ ok: true, complete: false, freshnessConfirmed: false }),
        };
      }
      if (mode === 'skipped-sync' && url === '/api/mailbox/instantly/sync') {
        return successfulResponse({ ok: true, results: [{ ok: true, skipped: true, reason: 'sync-in-progress' }] });
      }
      if (mode === 'error') {
        return { ok: false, status: 400, json: async () => ({ error: 'invalid' }) };
      }
      return successfulResponse();
    },
    loadMessages: async () => mode !== 'read-error',
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

  mode = 'partial-sync';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');

  mode = 'skipped-sync';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');

  mode = 'error';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Deels bijgewerkt');
  assert.doesNotMatch(ageLabel.textContent, /gecontroleerd|geleden/);
  assert.match(ageLabel.attributes.title, /Niet alle mailboxproviders/);

  mode = 'read-error';
  assert.equal(await controller.refresh(), false);
  assert.equal(ageLabel.textContent, 'Niet live · herstellen…');
  assert.doesNotMatch(ageLabel.textContent, /gecontroleerd|geleden/);
  assert.match(ageLabel.attributes.title, /Tijdelijke verbindingsstoring/);
  assert.doesNotMatch(ageLabel.textContent, /mislukt/i);
  controller.destroy();
});

test('zichtbare mailbox herstelt na een storing binnen vijftien seconden', async () => {
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
    now: () => 1,
  });

  controller.start();
  assert.equal(timers.at(-1).delay, 0);
  await timers.at(-1).handler();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.at(-1).delay, refreshModule.RECOVERY_REFRESH_INTERVAL_MS);
  assert.equal(refreshModule.RECOVERY_REFRESH_INTERVAL_MS, 15_000);
  controller.destroy();
});

test('zichtbare polling blijft aan de startcadans verankerd en stapelt geen cyclustijd op', async () => {
  const timers = [];
  let now = 1_000;
  const controller = refreshModule.create({
    autoStart: false,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async () => {
      now = 21_000;
      return successfulResponse();
    },
    loadMessages: async () => true,
    now: () => now,
    setTimeout(handler, delay) { timers.push({ handler, delay }); return timers.length; },
    clearTimeout() {},
  });

  controller.start();
  assert.equal(await controller.refresh(), true);
  assert.equal(timers.at(-1).delay, refreshModule.VISIBLE_REFRESH_INTERVAL_MS - 20_000);
  controller.destroy();
});

test('mailbox start de herstelcontroller ook wanneer de eerste lijstload faalt', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
  const initStart = source.indexOf('(async function initMailboxAccount()');
  assert.notEqual(initStart, -1);
  const initSource = source.slice(initStart, source.indexOf('\n})();\n})();', initStart));
  assert.match(
    initSource,
    /finally\s*\{\s*mailboxRefreshController\?\.start\?\.\(\);\s*window\.SoftoraMailboxBoot\?\.markReady/
  );
});

test('mailbox begrenst initfallbacks en annuleert een lijstload bij BFCache-pauze', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../assets/premium-mailbox.js'), 'utf8');
  assert.match(source, /SoftoraMailboxRequestDeadline\.requestInitJson\('\/api\/auth\/session',\s*'MAILBOX_AUTH_SESSION_TIMEOUT'\)/);
  assert.match(source, /SoftoraMailboxRequestDeadline\.requestInitJson\(\s*'\/api\/mailbox\/accounts',\s*'MAILBOX_ACCOUNTS_TIMEOUT'\s*\)/);
  assert.match(
    source,
    /window\.addEventListener\('pagehide',[\s\S]*event\?\.persisted === true[\s\S]*mailboxOwnerView\?\.cancelActive\?\.\(\)/
  );
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

test('focus, visibility and reconnect events do not queue a duplicate active refresh', async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = new Map();
  let nextTimerId = 0;
  let fetchCalls = 0;
  let releaseRequests;
  const pendingResponse = new Promise((resolve) => {
    releaseRequests = () => resolve(successfulResponse());
  });
  const documentRef = {
    visibilityState: 'visible',
    getElementById() { return null; },
    addEventListener(event, handler) { documentListeners.set(event, handler); },
    removeEventListener(event) { documentListeners.delete(event); },
  };
  const windowRef = {
    AbortController,
    addEventListener(event, handler) { windowListeners.set(event, handler); },
    removeEventListener(event) { windowListeners.delete(event); },
  };
  const controller = refreshModule.create({
    autoStart: false,
    document: documentRef,
    window: windowRef,
    getFolder: () => 'outreach',
    getOwner: () => 'serve',
    fetch: async () => {
      fetchCalls += 1;
      return pendingResponse;
    },
    loadMessages: async () => true,
    now: () => 1_000,
    setTimeout(handler, delay) {
      const id = ++nextTimerId;
      timers.set(id, { handler, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      if (timers.has(id)) timers.get(id).active = false;
    },
    setInterval: () => ++nextTimerId,
    clearInterval() {},
  });

  controller.start();
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(fetchCalls, 2);

  windowListeners.get('focus')();
  windowListeners.get('online')();
  documentListeners.get('visibilitychange')();
  assert.equal(fetchCalls, 2);

  releaseRequests();
  assert.equal(await refresh, true);
  assert.deepEqual(
    Array.from(timers.values()).filter((entry) => entry.active).map((entry) => entry.delay),
    [refreshModule.VISIBLE_REFRESH_INTERVAL_MS]
  );
  controller.destroy();
});

test('BFCache pauzeert en annuleert zonder destroy en hervat met exact één verversing', async () => {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timeoutEntries = new Map();
  const intervalEntries = new Map();
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
    AbortController,
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
      timeoutEntries.set(id, { handler, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      if (timeoutEntries.has(id)) timeoutEntries.get(id).active = false;
    },
    setInterval(handler, delay) {
      const id = ++nextTimerId;
      intervalEntries.set(id, { handler, delay, active: true });
      return id;
    },
    clearInterval(id) {
      if (intervalEntries.has(id)) intervalEntries.get(id).active = false;
    },
  });

  controller.start();
  const refresh = controller.refresh();
  await Promise.resolve();
  assert.equal(requestSignals.length, 2);
  windowListeners.get('pagehide')({ persisted: true });
  assert.equal(requestSignals.every((signal) => signal.aborted), true);
  assert.equal(await refresh, false);
  assert.equal(windowListeners.has('pagehide'), true);
  assert.equal(windowListeners.has('pageshow'), true);
  assert.equal(Array.from(timeoutEntries.values()).filter((entry) => entry.active).length, 0);

  windowListeners.get('pageshow')({ persisted: true });
  assert.deepEqual(
    Array.from(timeoutEntries.values()).filter((entry) => entry.active).map((entry) => entry.delay),
    [0]
  );
  windowListeners.get('focus')();
  windowListeners.get('online')();
  assert.deepEqual(
    Array.from(timeoutEntries.values()).filter((entry) => entry.active).map((entry) => entry.delay),
    [0]
  );

  windowListeners.get('pagehide')({ persisted: false });
  assert.equal(windowListeners.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(Array.from(intervalEntries.values()).some((entry) => entry.active), false);
  const timerCount = timeoutEntries.size;
  controller.requestImmediateRefresh();
  assert.equal(timeoutEntries.size, timerCount);
});
