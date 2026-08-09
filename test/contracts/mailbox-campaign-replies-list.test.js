const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxCampaignRepliesList,
} = require('../../server/services/mailbox-campaign-replies-list');
const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
} = require('../../server/services/mailbox-campaign-snapshot');

test('campaign replies coordinator behoudt response en durable snapshot contract na extractie', async () => {
  const reply = {
    id: 'imap-reply-1',
    accountEmail: 'serve@softora.nl',
    receivedAt: '2026-08-09T12:00:00.000Z',
    threadMessages: [],
  };
  const reads = [];
  const writes = [];
  const listCampaignReplies = createMailboxCampaignRepliesList({
    mailboxCampaignRepliesService: {
      listReplies: async (options) => {
        reads.push(options);
        return [reply];
      },
    },
    instantlyMailboxService: { isConfigured: () => false },
    filterVisibleMailboxMessages: (messages) => messages,
    setUiStateValues: async (...args) => { writes.push(args); },
    logger: { warn() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength) => String(value || '').slice(0, maxLength),
  });

  const result = await listCampaignReplies({
    limit: 7,
    owner: '',
    includeSnapshotMessages: true,
  });

  assert.deepEqual(reads, [{ limit: 7, owner: '' }]);
  assert.deepEqual(result.messages.map((message) => message.id), ['imap-reply-1']);
  assert.deepEqual(result.snapshotMessages.map((message) => message.id), ['imap-reply-1']);
  assert.deepEqual(result.sync, {
    indexed: true,
    stale: false,
    source: 'campaign-replies-index',
    refreshRecommended: false,
    warming: false,
    instantly: null,
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE);
  assert.deepEqual(
    parseMailboxCampaignSnapshot(writes[0][1][MAILBOX_CAMPAIGN_SNAPSHOT_KEY]).messages.map((message) => message.id),
    ['imap-reply-1']
  );
  assert.deepEqual(writes[0][2], {
    source: 'mailbox-campaign-replies',
    actor: 'Mailbox index',
  });
});
