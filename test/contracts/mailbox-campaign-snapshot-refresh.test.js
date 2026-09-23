const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createMailboxCampaignSnapshotRefresh,
  getSyncContentRevision,
  REVISION_KEY,
  REVISION_SCOPE,
  MAX_REBUILD_INTERVAL_MS,
} = require('../../server/services/mailbox-campaign-snapshot-refresh');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
} = require('../../server/services/mailbox-campaign-snapshot');
const {
  getMailboxProviderContentRevision,
} = require('../../server/services/mailbox-provider-content-revision');
const { hasNewCampaignRelevantMail } = require('../../server/services/mailbox-campaign-refresh-signal');
const { syncMailboxRequest } = require('../../server/services/mailbox-campaign-sync');

const results = [
  { owner: 'serve', contentRevision: 'serve-v1' },
  { owner: 'martijn', contentRevision: 'martijn-v1' },
];

function fixture({ missingSnapshot = false, failBuild = false, failMarker = false, ageMs = 0 } = {}) {
  const nowMs = Date.parse('2026-09-23T16:00:00.000Z');
  let snapshotRevision = missingSnapshot ? 0 : 5;
  let marker = {
    version: 1,
    contentRevision: getSyncContentRevision(results),
    snapshotRevision,
    builtAt: new Date(nowMs - ageMs).toISOString(),
  };
  const calls = [];
  const refresh = createMailboxCampaignSnapshotRefresh({
    now: () => nowMs,
    async getUiStateValues(scope, options) {
      calls.push(`read:${scope}:${options.metadataOnly === true ? 'meta' : 'data'}`);
      if (scope === MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE) return {
        source: 'supabase', exists: snapshotRevision > 0, revision: snapshotRevision,
      };
      return { source: 'supabase', exists: true, values: { [REVISION_KEY]: JSON.stringify(marker) } };
    },
    async setUiStateValues(scope, values) {
      calls.push(`write:${scope}`);
      assert.equal(scope, REVISION_SCOPE);
      assert.ok(snapshotRevision > 0);
      if (failMarker) return null;
      marker = JSON.parse(values[REVISION_KEY]);
      return { source: 'supabase' };
    },
    async rebuild() {
      calls.push('rebuild');
      if (failBuild) throw new Error('snapshot write failed');
      snapshotRevision += 1;
    },
  });
  return { refresh, calls, getMarker: () => marker, getSnapshotRevision: () => snapshotRevision };
}

test('ongewijzigde complete Instantly-sync slaat de dure snapshotopbouw over', async () => {
  const run = fixture();
  assert.deepEqual(await run.refresh({ results }), { skipped: true, reason: 'unchanged-content' });
  assert.equal(run.calls.includes('rebuild'), false);
  assert.equal(run.calls.some((call) => call.startsWith('write:')), false);
});

test('gewijzigde inhoud en ontbrekend snapshot bouwen opnieuw en publiceren daarna pas de revisie', async () => {
  for (const input of [{ results: [{ ...results[0], contentRevision: 'serve-v2' }, results[1]] }, { results, missingSnapshot: true }]) {
    const run = fixture({ missingSnapshot: input.missingSnapshot });
    assert.deepEqual(await run.refresh({ results: input.results }), { skipped: false, reason: 'rebuilt' });
    assert.ok(run.calls.indexOf('rebuild') < run.calls.indexOf(`write:${REVISION_SCOPE}`));
    assert.equal(run.getMarker().snapshotRevision, run.getSnapshotRevision());
  }
});

test('mislukte snapshotopbouw of revisieopslag kan een latere retry niet overslaan', async () => {
  for (const failure of [{ failBuild: true }, { failMarker: true }]) {
    const run = fixture(failure);
    const changed = [{ ...results[0], contentRevision: 'serve-v2' }, results[1]];
    await assert.rejects(run.refresh({ results: changed }));
    assert.equal(run.getMarker().contentRevision, getSyncContentRevision(results));
    await assert.rejects(run.refresh({ results: changed }));
    assert.equal(run.calls.filter((call) => call === 'rebuild').length, 2);
  }
});

test('een oude snapshot en een onvolledige inhoudsrevisie worden opnieuw opgebouwd', async () => {
  const aged = fixture({ ageMs: MAX_REBUILD_INTERVAL_MS });
  assert.equal((await aged.refresh({ results })).skipped, false);
  const incomplete = fixture();
  assert.equal((await incomplete.refresh({ results: [{ owner: 'serve' }, results[1]] })).skipped, false);
});

test('IMAP-wijziging maakt de revisie eerst ongeldig en herstelt die pas na een volledig snapshot', async () => {
  const run = fixture();
  assert.equal((await run.refresh({ force: true })).skipped, false);
  assert.ok(run.calls.indexOf(`write:${REVISION_SCOPE}`) < run.calls.indexOf('rebuild'));
  assert.equal(run.getMarker().dirty, undefined);
  assert.equal(run.getMarker().contentRevision, getSyncContentRevision(results));
  assert.deepEqual(await run.refresh({ results }), { skipped: true, reason: 'unchanged-content' });

  const failed = fixture({ failBuild: true });
  await assert.rejects(failed.refresh({ force: true }));
  assert.equal(failed.getMarker().dirty, true);
  await assert.rejects(failed.refresh({ results }));
  assert.equal(failed.calls.filter((call) => call === 'rebuild').length, 2);
});

test('IMAP-cron ververst alleen na een complete sync met nieuwe relevante mail', async () => {
  const calls = [];
  const syncMailbox = async ({ folders }) => {
    calls.push(folders.join(','));
    return { ok: true, results: [{ ok: true, folder: folders[0], campaignChanged: folders[0] === 'inbox' }] };
  };
  let refreshes = 0;
  const result = await syncMailboxRequest({
    syncMailbox, method: 'GET', normalizeFolder: (value) => value,
    afterSync: async () => { refreshes += 1; },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['sent', 'inbox', 'inbox,coldmail']);
  assert.equal(refreshes, 1);

  const incomplete = await syncMailboxRequest({
    syncMailbox: async () => ({ ok: true, results: [{ ok: true, campaignChanged: true, rebuildPending: true }] }),
    method: 'GET', normalizeFolder: (value) => value,
    afterSync: async () => { refreshes += 1; },
  });
  assert.equal(incomplete.ok, true);
  assert.equal(refreshes, 1);
});

test('IMAP-signaal negeert overlap en nieuwe gewone uitgaande coldmail', () => {
  assert.equal(hasNewCampaignRelevantMail({ messages: [{ uid: 11 }], folder: 'inbox', lastSyncedUid: 10 }), true);
  assert.equal(hasNewCampaignRelevantMail({ messages: [{ uid: 10 }], folder: 'inbox', lastSyncedUid: 10 }), false);
  assert.equal(hasNewCampaignRelevantMail({ messages: [{ uid: 11 }], folder: 'sent', lastSyncedUid: 10 }), false);
  assert.equal(hasNewCampaignRelevantMail({ messages: [{ uid: 11, inReplyTo: '<original>' }], folder: 'sent', lastSyncedUid: 10 }), true);
});

test('providerrevisie negeert volgorde en gewijzigde opslagtijd maar ziet nieuwe berichten en bodybewijs', () => {
  const first = { messageKey: 'm1', providerThreadId: 'thread', preview: 'Hallo', hasBody: true };
  const second = { messageKey: 'm2', providerThreadId: 'thread', preview: 'Antwoord', hasBody: false };
  const base = getMailboxProviderContentRevision({ indexed: [first, second], activeAudit: [] });
  assert.equal(base, getMailboxProviderContentRevision({ indexed: [{ ...second, updatedAt: 'later' }, first], activeAudit: [] }));
  assert.notEqual(base, getMailboxProviderContentRevision({ indexed: [first, { ...second, hasBody: true }], activeAudit: [] }));
  assert.notEqual(base, getMailboxProviderContentRevision({ indexed: [first], activeAudit: [] }));
  assert.equal(getMailboxProviderContentRevision({ indexed: [first, second], activeAudit: null }), '');
  assert.equal(getMailboxProviderContentRevision({ indexed: [first, second], activeAudit: [] }).length, 64);
});
