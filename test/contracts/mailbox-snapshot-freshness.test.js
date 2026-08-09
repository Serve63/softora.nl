const test = require('node:test');
const assert = require('node:assert/strict');

const freshness = require('../../assets/premium-mailbox-snapshot-freshness.js');
const requestDeadline = require('../../assets/premium-mailbox-request-deadline.js');

const NOW = Date.parse('2026-08-09T19:30:00.000Z');

function message(id, uid = 0) {
  return { id, mailboxId: id, uid, folder: 'inbox', accountEmail: 'serve@softora.nl' };
}

function snapshot(contentAt, messages, options = {}) {
  return {
    ok: true,
    contentAt,
    messages,
    origin: options.origin || 'live-api',
    degraded: options.degraded === true,
    sync: { stale: options.degraded === true, contentAt },
  };
}

test('snapshot zonder contentAt of ouder dan vijftien minuten wordt nooit vertrouwd', () => {
  assert.equal(freshness.normalizeSnapshot({ messages: [message('unknown')] }, { now: NOW }), null);
  assert.equal(freshness.normalizeSnapshot(
    snapshot('2026-08-09T19:14:59.999Z', [message('old')]),
    { now: NOW }
  ), null);
});

test('nieuwere complete snapshot vervangt en kan een lege mailbox gezaghebbend maken', () => {
  const current = snapshot('2026-08-09T19:25:00.000Z', [message('old')]);
  const incoming = snapshot('2026-08-09T19:29:00.000Z', []);
  assert.equal(freshness.decideSnapshotUpdate(current, incoming, { now: NOW }), 'replace');
  assert.deepEqual(
    freshness.decideSnapshotUpdate({ current, incoming, now: NOW }),
    { action: 'replace' }
  );
});

test('nieuwere gedegradeerde response blijft additief bij een zichtbare mailbox ouder dan de cachelimiet', () => {
  const current = snapshot('2026-08-09T19:00:00.000Z', [message('keep', 1)]);
  const incoming = snapshot('2026-08-09T19:29:00.000Z', [message('new', 2)], { degraded: true });
  assert.equal(freshness.decideSnapshotUpdate(current, incoming, { now: NOW }), 'merge-additive');
  assert.deepEqual(
    freshness.mergeMessagesAdditively(current.messages, incoming.messages).map((item) => item.id),
    ['new', 'keep']
  );
});

test('oudere snapshot wordt afgewezen, ongeacht bronprioriteit', () => {
  const current = snapshot('2026-08-09T19:29:00.000Z', [message('current')], { origin: 'session-cache' });
  const incoming = snapshot('2026-08-09T19:28:00.000Z', [message('old')], { origin: 'live-api' });
  assert.equal(freshness.decideSnapshotUpdate(current, incoming, { now: NOW }), 'reject');
});

test('een nieuwere authoritative lege mailbox kan nooit door oudere cache worden herbevolkt', () => {
  const current = snapshot('2026-08-09T19:29:00.000Z', []);
  const incoming = snapshot('2026-08-09T19:28:00.000Z', [message('verouderd')], {
    origin: 'session-cache',
  });
  assert.equal(freshness.decideSnapshotUpdate(current, incoming, { now: NOW }), 'reject');
});

test('bootstrap en tabcache worden op contentAt gekozen en gedegradeerde data blijft additief', () => {
  const page = snapshot('2026-08-09T19:25:00.000Z', [message('page', 1)], { origin: 'server-bootstrap' });
  const session = snapshot('2026-08-09T19:29:00.000Z', [message('session', 2)], {
    origin: 'session-cache',
    degraded: true,
  });
  const selected = freshness.selectSnapshot(page, session, { now: NOW });
  assert.equal(selected.contentAt, '2026-08-09T19:29:00.000Z');
  assert.deepEqual(selected.messages.map((item) => item.id), ['session', 'page']);
});

test('nieuwere degraded bootstrap kan een bevestigde verwijdering nooit terugbrengen', () => {
  const deleted = message('inbox:42', 42);
  const session = {
    ...snapshot('2026-08-09T19:25:00.000Z', [deleted], { origin: 'session-cache' }),
    tombstones: freshness.addTombstone([], deleted, '2026-08-09T19:26:00.000Z'),
  };
  const page = snapshot('2026-08-09T19:29:00.000Z', [], {
    origin: 'server-bootstrap',
    degraded: true,
  });

  assert.deepEqual(freshness.selectSnapshot(page, session, { now: NOW }).messages, []);
});

test('degraded duplicate bewaart bestaande velden en voegt alleen ontbrekende threadberichten toe', () => {
  const current = [{
    ...message('conversation', 44), unread: false,
    threadMessages: [{ id: 't1', body: 'volledig' }, { id: 't2', body: 'blijft staan' }],
  }];
  const incoming = [{
    ...message('conversation', 44), unread: true,
    threadMessages: [{ id: 't1', body: 'afgekapt' }, { id: 't3', body: 'nieuw' }],
  }];
  const merged = freshness.mergeAdditiveMessages(current, incoming);

  assert.equal(merged[0].unread, false);
  assert.deepEqual(merged[0].threadMessages.map((item) => [item.id, item.body]), [
    ['t1', 'volledig'], ['t3', 'nieuw'], ['t2', 'blijft staan'],
  ]);
});

test('lokale verwijdering is een tombstone en verandert contentAt niet', () => {
  const contentAt = '2026-08-09T19:25:00.000Z';
  const deleted = message('delete', 42);
  const tombstones = freshness.addTombstone([], deleted, '2026-08-09T19:26:00.000Z');
  assert.deepEqual(
    freshness.applyTombstones([deleted, message('keep', 43)], tombstones, contentAt).map((item) => item.id),
    ['keep']
  );
  assert.deepEqual(
    freshness.applyTombstones([deleted], tombstones, '2026-08-09T19:27:00.000Z').map((item) => item.id),
    ['delete']
  );
});

test('Instantly tombstones gebruiken de storagefolder en blijven exact', () => {
  const stored = {
    id: 'instantly:reply-1',
    mailboxId: 'instantly:reply-1',
    accountEmail: 'serve@websoftora.com',
    folder: 'inbox',
    storageFolder: 'instantly',
  };
  const tombstones = freshness.addTombstone([], stored, '2026-08-09T19:26:00.000Z');
  assert.deepEqual(freshness.applyTombstones(
    [stored], tombstones, '2026-08-09T19:25:00.000Z'
  ), []);
});

test('campaign cache bewaart huidige mails wanneer een nieuwere API-response degraded is', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrap = globalThis.SoftoraPageBootstrapSession;
  const previousCampaign = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  const currentAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const incomingAt = new Date(Date.now() - 60 * 1000).toISOString();
  const restored = message('restored', 3);
  let cached = {
    ...snapshot(currentAt, [message('keep', 1), restored], { origin: 'session-cache' }),
    tombstones: freshness.addTombstone([], restored, new Date(Date.now() - 90 * 1000).toISOString()),
  };
  globalThis.document = { getElementById() { return null; } };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'freshness-test' }; },
    cache: {
      read() { return cached; },
      write(_key, value) { cached = value; return true; },
    },
  };
  delete require.cache[modulePath];
  const campaign = require(modulePath);
  try {
    const result = await campaign.load('outreach', (value) => value, async (url) => {
      assert.match(String(url), /refreshInstantly=0/);
      return {
        ok: true,
        json: async () => snapshot(incomingAt, [message('new', 2)], { degraded: true }),
      };
    }, { owner: 'serve', skipBootstrap: true });
    assert.equal(result.complete, false);
    assert.equal(result.fromCache, true);
    assert.deepEqual(cached.messages.map((item) => item.id), ['new', 'keep']);
    assert.equal(cached.contentAt, incomingAt);
    assert.equal(cached.tombstones.length, 1);

    const completeAt = new Date().toISOString();
    await campaign.load('outreach', (value) => value, async () => ({
      ok: true,
      json: async () => snapshot(completeAt, [message('new', 2), message('keep', 1), restored]),
    }), { owner: 'serve', skipBootstrap: true });
    assert.deepEqual(cached.messages.map((item) => item.id), ['new', 'keep', 'restored']);
    assert.deepEqual(cached.tombstones, []);
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrap;
    globalThis.SoftoraMailboxCampaignInbox = previousCampaign;
  }
});

test('campaign GET breekt hard af en valt terug zonder de refreshlus te blokkeren', async () => {
  const previousDocument = globalThis.document;
  const previousBootstrap = globalThis.SoftoraPageBootstrapSession;
  const previousCampaign = globalThis.SoftoraMailboxCampaignInbox;
  const modulePath = require.resolve('../../assets/premium-mailbox-campaign-inbox.js');
  let cached = snapshot(new Date().toISOString(), [message('cached', 1)], {
    origin: 'session-cache',
    degraded: true,
  });
  let requestedSignal = null;
  let timeoutDelay = 0;
  globalThis.document = { getElementById() { return null; } };
  globalThis.SoftoraPageBootstrapSession = {
    get() { return { authenticated: true, userId: 'timeout-test' }; },
    cache: {
      read() { return cached; },
      write(_key, value) { cached = value; return true; },
    },
  };
  delete require.cache[modulePath];
  const campaign = require(modulePath);
  const fetchNeverSettles = async (_url, init) => {
    requestedSignal = init.signal;
    return new Promise(() => {});
  };
  const timeoutOptions = {
    owner: 'serve',
    skipBootstrap: true,
    setTimeout(handler, delay) {
      timeoutDelay = delay;
      queueMicrotask(handler);
      return 1;
    },
    clearTimeout() {},
  };
  try {
    const fallback = await campaign.load(
      'outreach',
      (value) => value,
      fetchNeverSettles,
      timeoutOptions
    );
    assert.equal(timeoutDelay, requestDeadline.DEFAULT_REQUEST_TIMEOUT_MS);
    assert.equal(requestedSignal.aborted, true);
    assert.equal(fallback.complete, false);
    assert.equal(fallback.fromCache, true);
    assert.deepEqual(fallback.messages.map((item) => item.id), ['cached']);

    cached = null;
    await assert.rejects(
      campaign.load('outreach', (value) => value, fetchNeverSettles, timeoutOptions),
      (error) => error.code === 'MAILBOX_CAMPAIGN_REPLIES_TIMEOUT'
    );
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrap;
    globalThis.SoftoraMailboxCampaignInbox = previousCampaign;
  }
});

test('auth- en accountinitialisatie gebruiken dezelfde harde achtseconden-grens', async () => {
  let requestedUrl = '';
  let requestedInit = null;
  let timeoutDelay = 0;
  await assert.rejects(
    requestDeadline.requestInitJson('/api/auth/session', 'MAILBOX_AUTH_SESSION_TIMEOUT', {
      request(url, init) {
        requestedUrl = url;
        requestedInit = init;
        return new Promise(() => {});
      },
      setTimeout(handler, delay) {
        timeoutDelay = delay;
        queueMicrotask(handler);
        return 1;
      },
      clearTimeout() {},
    }),
    (error) => error.code === 'MAILBOX_AUTH_SESSION_TIMEOUT'
  );
  assert.equal(requestedUrl, '/api/auth/session');
  assert.equal(requestedInit.credentials, 'same-origin');
  assert.equal(requestedInit.cache, 'no-store');
  assert.equal(requestedInit.signal.aborted, true);
  assert.equal(timeoutDelay, requestDeadline.DEFAULT_REQUEST_TIMEOUT_MS);
});
