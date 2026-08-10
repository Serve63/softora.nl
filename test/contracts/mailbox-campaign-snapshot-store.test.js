const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');
const {
  createMailboxCampaignSnapshotStore,
} = require('../../server/services/mailbox-campaign-snapshot-store');

function message(id = 'inbox:42') {
  return {
    id,
    uid: 42,
    folder: 'inbox',
    accountEmail: 'serve@softora.nl',
    subject: 'Re: Kleine vraag',
    date: '2026-08-09T20:00:00.000Z',
  };
}

function createStateHarness({ fence = null, getFence, casOverride } = {}) {
  const scopes = new Map();
  const records = new Map();
  const calls = [];
  const consistencyStore = {
    isAvailable: () => true,
    getFence: getFence || (async () => fence || {
      contentVersion: '7', pendingCount: 0, ready: true, reapedCount: 0,
      checkedAt: '2026-08-09T20:01:00.000Z',
    }),
  };
  async function getUiStateValues(scope) {
    const record = records.get(scope) || { revision: 0, updatedAt: null, exists: false };
    return {
      values: scopes.get(scope) || {},
      source: 'supabase',
      revision: record.revision,
      updatedAt: record.updatedAt,
      exists: record.exists,
    };
  }
  async function compareAndSwapUiStateValues(scope, values, meta) {
    calls.push({ type: 'cas', scope, values, meta });
    if (casOverride) return casOverride({ scope, values, meta, scopes, records, calls });
    const current = records.get(scope) || { revision: 0, updatedAt: null, exists: false };
    if (current.revision !== meta.expectedRevision) {
      return { ok: false, conflict: true, revision: current.revision };
    }
    const revision = current.revision + 1;
    const updatedAt = '2026-08-09T20:01:01.000Z';
    scopes.set(scope, values);
    records.set(scope, { revision, updatedAt, exists: true });
    return { ok: true, revision, updatedAt, values, source: 'supabase' };
  }
  async function setUiStateValues(scope, values, meta) {
    calls.push({ type: 'set', scope, values, meta });
    scopes.set(scope, values);
    return { values, source: 'supabase' };
  }
  const store = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:01:02.003Z'),
    getUiStateValues,
    setUiStateValues,
    compareAndSwapUiStateValues,
    mailboxCampaignConsistencyStore: consistencyStore,
    logger: { warn() {} },
  });
  return { calls, records, scopes, store };
}

test('campaign snapshot store bewaart contenttijd en monotone contentVersion via CAS', async () => {
  const harness = createStateHarness();
  const contentAt = '2026-08-09T20:01:02.003Z';
  const result = await harness.store.persist({
    ok: true,
    messages: [message()],
    contentAt,
    contentVersion: '7',
  }, { savedAt: contentAt, contentAt, contentVersion: '7' });
  const write = harness.calls.find((call) => call.type === 'cas');
  const parsed = parseMailboxCampaignSnapshot(write.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]);

  assert.equal(result.ok, true);
  assert.equal(result.contentVersion, '7');
  assert.equal(write.scope, MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
  assert.equal(write.meta.expectedRevision, 0);
  assert.equal(parsed.savedAt, contentAt);
  assert.equal(parsed.contentAt, contentAt);
  assert.equal(parsed.contentVersion, '7');
});

test('pending mutation blokkeert authoritative persist en maakt fallback zichtbaar degraded', async () => {
  const harness = createStateHarness({
    fence: {
      contentVersion: '7', pendingCount: 1, ready: false, reapedCount: 0,
      checkedAt: '2026-08-09T20:01:00.000Z',
    },
  });
  const raw = serializeMailboxCampaignSnapshot({
    ok: true, messages: [message()], contentVersion: '7',
  }, {
    savedAt: '2026-08-09T20:01:00.000Z',
    contentAt: '2026-08-09T20:01:00.000Z',
    contentVersion: '7',
  });
  harness.scopes.set(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
    [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: raw,
  });

  const persisted = await harness.store.persist({
    ok: true, messages: [message()], contentVersion: '7',
  }, { contentVersion: '7' });
  const degraded = await harness.store.readDegraded();

  assert.equal(persisted.ok, false);
  assert.equal(persisted.reason, 'mutation_pending');
  assert.equal(harness.calls.filter((call) => call.type === 'cas').length, 0);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.sync.degradedReason, 'campaign_mutation_pending');
  assert.equal(degraded.sync.consistency.pendingCount, 1);
});

test('stale persist wordt afgewezen zodra de DB-contentversie verder staat', async () => {
  const harness = createStateHarness({
    fence: {
      contentVersion: '9', pendingCount: 0, ready: true, reapedCount: 0,
      checkedAt: '2026-08-09T20:01:00.000Z',
    },
  });
  const result = await harness.store.persist({
    ok: true, messages: [message()], contentVersion: '8',
  }, { contentVersion: '8' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'content_version_mismatch');
  assert.equal(harness.calls.length, 0);
});

test('multi-instance CAS-race laat een oudere snapshot nooit later overschrijven', async () => {
  let first = true;
  const harness = createStateHarness({
    casOverride: async ({ scope, records, scopes }) => {
      if (first) {
        first = false;
        const newer = serializeMailboxCampaignSnapshot({
          ok: true,
          messages: [message('inbox:newer')],
          contentVersion: '7',
        }, {
          savedAt: '2026-08-09T20:01:02.000Z',
          contentAt: '2026-08-09T20:01:02.000Z',
          contentVersion: '7',
        });
        scopes.set(scope, { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: newer });
        records.set(scope, {
          revision: 1,
          updatedAt: '2026-08-09T20:01:02.000Z',
          exists: true,
        });
        return { ok: false, conflict: true, revision: 1 };
      }
      throw new Error('een oudere tweede CAS-poging mag nooit starten');
    },
  });

  const result = await harness.store.persist({
    ok: true,
    messages: [message('inbox:older')],
    contentVersion: '7',
  }, {
    savedAt: '2026-08-09T20:01:01.000Z',
    contentAt: '2026-08-09T20:01:01.000Z',
    contentVersion: '7',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stale_snapshot');
  assert.equal(harness.calls.filter((call) => call.type === 'cas').length, 1);
});

test('Supabase/fence-fout toont beschikbare cache uitsluitend non-authoritative', async () => {
  const harness = createStateHarness({
    getFence: async () => { throw new Error('Supabase timeout'); },
  });
  const raw = serializeMailboxCampaignSnapshot({
    ok: true, messages: [message()], contentVersion: '7',
  }, {
    savedAt: '2026-08-09T20:01:00.000Z',
    contentAt: '2026-08-09T20:01:00.000Z',
    contentVersion: '7',
  });
  harness.scopes.set(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
    [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: raw,
  });

  const degraded = await harness.store.readDegraded();
  assert.equal(degraded.messages.length, 1);
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.sync.degradedReason, 'campaign_consistency_unavailable');
  assert.equal(degraded.sync.consistency.verified, false);
});

test('rolling legacy snapshot zonder contentVersion faalt gesloten', async () => {
  const harness = createStateHarness();
  harness.scopes.set(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
    [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: JSON.stringify({
      version: 15,
      savedAt: '2026-08-09T20:01:00.000Z',
      contentAt: '2026-08-09T20:01:00.000Z',
      ok: true,
      messages: [message()],
    }),
  });
  assert.equal(await harness.store.readDegraded(), null);
});

test('timestamp-invalidatie blijft alleen als v2-compatwrite bestaan', async () => {
  const harness = createStateHarness();
  const invalidation = await harness.store.invalidate({ at: '2026-08-09T20:01:01.000Z' });
  assert.equal(invalidation.ok, true);
  assert.equal(
    harness.scopes.get(MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE)[MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY],
    '2026-08-09T20:01:01.000Z'
  );
});

test('snapshot-invalidatie stopt op abort en publiceert lokaal geen late freshness', async () => {
  const controller = new AbortController();
  let writes = 0;
  const oldInvalidation = '2026-08-09T20:00:00.000Z';
  const store = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:01:02.003Z'),
    getUiStateValues: async () => ({
      values: { [MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]: oldInvalidation },
    }),
    setUiStateValues: async () => {
      writes += 1;
      return new Promise(() => {});
    },
    mailboxCampaignConsistencyStore: { isAvailable: () => true },
    logger: { warn() {} },
  });
  const running = store.invalidate({
    at: '2026-08-09T20:01:01.000Z',
    signal: controller.signal,
    deadlineAt: Date.now() + 10_000,
  });
  const reason = Object.assign(new Error('folder timeout'), {
    code: 'MAILBOX_SYNC_FOLDER_TIMEOUT', timedOut: true,
  });
  controller.abort(reason);

  await assert.rejects(running, (error) => error === reason);
  assert.equal(writes, 1);
  assert.equal(await store.readInvalidatedAt(), oldInvalidation);
});

test('campaign snapshot fallback is hard begrensd en verbreedt nooit een ongeldige owner', async () => {
  const harness = createStateHarness();
  const tooOld = serializeMailboxCampaignSnapshot({
    ok: true, messages: [message()], contentVersion: '7',
  }, {
    savedAt: '2026-08-09T19:40:00.000Z',
    contentAt: '2026-08-09T19:40:00.000Z',
    contentVersion: '7',
  });
  harness.scopes.set(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
    [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: tooOld,
  });
  assert.equal(await harness.store.readDegraded(), null);
  assert.equal(await harness.store.readDegraded({ owner: 'aanvaller' }), null);
});
