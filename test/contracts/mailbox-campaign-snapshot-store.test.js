const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
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

test('campaign snapshot store gebruikt exact dezelfde contenttijd voor response en durable snapshot', async () => {
  const writes = [];
  const store = createMailboxCampaignSnapshotStore({
    setUiStateValues: async (scope, values) => {
      writes.push({ scope, values });
      return { values, source: 'supabase' };
    },
  });
  const contentAt = '2026-08-09T20:01:02.003Z';

  const result = await store.persist({ ok: true, messages: [message()], contentAt }, {
    savedAt: contentAt,
    contentAt,
  });
  const parsed = parseMailboxCampaignSnapshot(
    writes[0].values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
  );

  assert.deepEqual(result, { ok: true, savedAt: contentAt });
  assert.equal(writes[0].scope, MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
  assert.equal(parsed.savedAt, contentAt);
  assert.equal(parsed.contentAt, contentAt);
});

test('campaign snapshot store behandelt een stille null-write als fout', async () => {
  const store = createMailboxCampaignSnapshotStore({
    setUiStateValues: async () => null,
  });
  const result = await store.persist({ ok: true, messages: [message()] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'write_failed');
});

test('campaign snapshot store weigert een snapshot die na indexupsert is geïnvalideerd', async () => {
  const snapshotAt = '2026-08-09T20:00:00.000Z';
  const valuesByScope = new Map();
  const store = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:01:00.000Z'),
    getUiStateValues: async (scope) => ({ values: valuesByScope.get(scope) || {}, source: 'supabase' }),
    setUiStateValues: async (scope, values) => {
      valuesByScope.set(scope, values);
      return { values, source: 'supabase' };
    },
  });
  await store.persist({ ok: true, messages: [message()], contentAt: snapshotAt }, {
    savedAt: snapshotAt,
    contentAt: snapshotAt,
  });
  assert.equal((await store.readDegraded()).messages.length, 1);
  assert.equal((await store.readDegraded({ owner: 'both' })).messages.length, 1);

  const invalidation = await store.invalidate({ at: '2026-08-09T20:00:00.001Z' });

  assert.equal(invalidation.ok, true);
  assert.equal(
    valuesByScope.get(MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE)[MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY],
    '2026-08-09T20:00:00.001Z'
  );
  assert.equal(await store.readDegraded(), null);
});

test('campaign snapshot fallback faalt dicht als de invalidatiecontrole niet leesbaar is', async () => {
  const contentAt = '2026-08-09T20:00:00.000Z';
  const persisted = JSON.stringify({
    version: 15,
    savedAt: contentAt,
    contentAt,
    ok: true,
    messages: [message()],
  });
  const store = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:00:10.000Z'),
    getUiStateValues: async (scope) => scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE
      ? { values: { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: persisted }, source: 'supabase' }
      : null,
    logger: { warn() {} },
  });

  assert.equal(await store.readDegraded(), null);
});

test('mislukte invalidatiewrite blijft binnen dezelfde runtime fail-closed', async () => {
  const contentAt = '2026-08-09T20:00:00.000Z';
  const persisted = JSON.stringify({
    version: 15,
    savedAt: contentAt,
    contentAt,
    ok: true,
    messages: [message()],
  });
  const store = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:00:10.000Z'),
    getUiStateValues: async (scope) => ({
      values: scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE
        ? { [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: persisted }
        : {},
      source: 'supabase',
    }),
    setUiStateValues: async () => null,
    logger: { warn() {} },
  });

  assert.equal((await store.invalidate({ at: '2026-08-09T20:00:00.001Z' })).ok, false);
  assert.equal(await store.readDegraded(), null);
});

test('campaign snapshot fallback is hard begrensd en verbreedt nooit een ongeldige owner', async () => {
  const contentAt = '2026-08-09T19:40:00.000Z';
  const snapshotStore = createMailboxCampaignSnapshotStore({
    now: () => new Date('2026-08-09T20:00:01.000Z'),
    getUiStateValues: async (scope) => scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE
      ? {
          values: {
            [MAILBOX_CAMPAIGN_SNAPSHOT_KEY]: JSON.stringify({
              version: 15,
              savedAt: contentAt,
              contentAt,
              ok: true,
              messages: [message()],
            }),
          },
          source: 'supabase',
        }
      : { values: {}, source: 'supabase' },
  });

  assert.equal(await snapshotStore.readDegraded(), null);
  assert.equal(await snapshotStore.readDegraded({ owner: 'aanvaller' }), null);
});
