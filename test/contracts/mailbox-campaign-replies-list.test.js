const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxCampaignRepliesList,
} = require('../../server/services/mailbox-campaign-replies-list');

function reply(id = 'imap-reply-1') {
  return {
    id,
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-09T12:00:00.000Z',
    threadMessages: [],
  };
}

function createCoordinator({ fences, getFence, persist } = {}) {
  const reads = [];
  const persists = [];
  let fenceIndex = 0;
  const snapshotStore = {
    getFence: getFence || (async () => {
      const selected = fences?.[Math.min(fenceIndex, fences.length - 1)] || {
        contentVersion: '12', pendingCount: 0, ready: true,
      };
      fenceIndex += 1;
      return selected;
    }),
    persist: async (...args) => {
      persists.push(args);
      return persist ? persist(...args) : { ok: true, contentVersion: '12' };
    },
    readDegraded: async () => null,
    invalidate: async () => ({ ok: true }),
  };
  const coordinator = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: {
      listReplies: async (options) => {
        reads.push(options);
        return [reply()];
      },
    },
    instantlyMailboxService: { isConfigured: () => false },
    filterVisibleMailboxMessages: (messages) => messages,
    mailboxCampaignSnapshotStore: snapshotStore,
    logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength) => String(value || '').slice(0, maxLength),
  });
  return { ...coordinator, persists, reads };
}

test('campaign replies koppelt één stabiele DB-contentversie aan response en durable snapshot', async () => {
  const { listCampaignReplies, persists, reads } = createCoordinator();
  const result = await listCampaignReplies({
    limit: 7,
    owner: '',
    includeSnapshotMessages: true,
  });

  assert.deepEqual(reads, [{ limit: 7, owner: '' }]);
  assert.deepEqual(result.messages.map((message) => message.id), ['imap-reply-1']);
  assert.deepEqual(result.snapshotMessages.map((message) => message.id), ['imap-reply-1']);
  assert.equal(result.contentVersion, '12');
  assert.equal(result.degraded, false);
  assert.equal(result.sync.stale, false);
  assert.equal(result.sync.contentVersion, '12');
  assert.equal(result.sync.consistency.authoritative, true);
  assert.equal(result.sync.consistency.beforeContentVersion, '12');
  assert.equal(result.sync.consistency.currentContentVersion, '12');
  assert.equal(persists.length, 1);
  assert.equal(persists[0][0].contentVersion, '12');
  assert.equal(persists[0][1].contentVersion, '12');
});

test('multi-instance versionwissel tijdens read degradeert en schrijft geen snapshot', async () => {
  const { listCampaignReplies, persists } = createCoordinator({
    fences: [
      { contentVersion: '12', pendingCount: 0, ready: true },
      { contentVersion: '13', pendingCount: 0, ready: true },
    ],
  });
  const result = await listCampaignReplies();
  assert.equal(result.degraded, true);
  assert.equal(result.sync.stale, true);
  assert.equal(result.sync.degradedReason, 'content_version_changed_during_read');
  assert.equal(result.sync.consistency.authoritative, false);
  assert.equal(result.contentVersion, '13');
  assert.equal(persists.length, 0);
});

test('pending mutation voorkomt live-claim en snapshotpersist', async () => {
  const { listCampaignReplies, persists } = createCoordinator({
    fences: [
      { contentVersion: '12', pendingCount: 1, ready: false },
      { contentVersion: '12', pendingCount: 1, ready: false },
    ],
  });
  const result = await listCampaignReplies();
  assert.equal(result.degraded, true);
  assert.equal(result.sync.degradedReason, 'campaign_mutation_pending');
  assert.equal(result.sync.consistency.pendingCount, 1);
  assert.equal(persists.length, 0);
});

test('repositoryfout behoudt beschikbare inhoud alleen additive/non-authoritative', async () => {
  const { listCampaignReplies, persists } = createCoordinator({
    getFence: async () => { throw new Error('Supabase timeout'); },
  });
  const result = await listCampaignReplies();
  assert.deepEqual(result.messages.map((message) => message.id), ['imap-reply-1']);
  assert.equal(result.degraded, true);
  assert.equal(result.sync.stale, true);
  assert.equal(result.sync.degradedReason, 'campaign_consistency_unavailable');
  assert.equal(result.sync.consistency.authoritative, false);
  assert.equal(persists.length, 0);
});

test('persist-race degradeert de response ook na een aanvankelijk stabiele read', async () => {
  const { listCampaignReplies, persists } = createCoordinator({
    persist: async () => ({ ok: false, reason: 'consistency_changed_after_write' }),
  });
  const result = await listCampaignReplies();
  assert.equal(persists.length, 1);
  assert.equal(result.degraded, true);
  assert.equal(result.sync.degradedReason, 'consistency_changed_after_write');
});

test('CRM-waarschuwing behoudt replies maar verhindert een autoritatieve snapshotclaim', async () => {
  const persists = [];
  const coordinator = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: {
      listRepliesWithSnapshot: async () => ({
        messages: [reply('direct-reply')],
        snapshotMessages: [reply('direct-reply')],
        warnings: ['campaign_customer_link_unavailable'],
      }),
    },
    instantlyMailboxService: { isConfigured: () => false },
    filterVisibleMailboxMessages: (messages) => messages,
    mailboxCampaignSnapshotStore: {
      getFence: async () => ({ contentVersion: '12', pendingCount: 0, ready: true }),
      persist: async (...args) => { persists.push(args); return { ok: true }; },
      readDegraded: async () => null,
      invalidate: async () => ({ ok: true }),
    },
    logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength) => String(value || '').slice(0, maxLength),
  });

  const result = await coordinator.listCampaignReplies({ owner: 'serve' });

  assert.deepEqual(result.messages.map((message) => message.id), ['direct-reply']);
  assert.equal(result.degraded, true);
  assert.equal(result.sync.degradedReason, 'campaign_customer_link_unavailable');
  assert.deepEqual(result.sync.warnings, ['campaign_customer_link_unavailable']);
  assert.equal(persists.length, 0);
});
