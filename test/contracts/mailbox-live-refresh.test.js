const test = require('node:test');
const assert = require('node:assert/strict');

const refreshModule = require('../../assets/premium-mailbox-refresh.js');
const {
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
    maxConcurrentAccounts: 3,
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

test('Instantly fast refresh supports exact owners and both owners without mixing', async () => {
  const calls = [];
  const service = {
    getStatus: () => ({ configured: true, missing: [] }),
    syncOwner: async (owner) => { calls.push(owner); return { ok: true, owner }; },
  };
  const response = responseRecorder();
  await syncInstantlyMailboxResponse({
    instantlyMailboxService: service,
    req: { body: { owner: 'both' }, query: {} },
    res: response,
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, ['serve', 'martijn']);
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
