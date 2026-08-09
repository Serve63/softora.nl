const test = require('node:test');
const assert = require('node:assert/strict');

const freshness = require('../../assets/premium-mailbox-snapshot-freshness.js');

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
  let cached = snapshot(currentAt, [message('keep', 1)], { origin: 'session-cache' });
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
  } finally {
    delete require.cache[modulePath];
    globalThis.document = previousDocument;
    globalThis.SoftoraPageBootstrapSession = previousBootstrap;
    globalThis.SoftoraMailboxCampaignInbox = previousCampaign;
  }
});
