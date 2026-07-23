const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
  resolveMailboxSyncUids,
  selectMailboxSyncUids,
} = require('../../server/services/mailbox-campaign-history-sync');

test('campaign history sync reserves capacity for newest and older campaign mail', () => {
  const selected = selectMailboxSyncUids({
    allUids: Array.from({ length: 120 }, (_item, index) => index + 1),
    campaignUids: Array.from({ length: 120 }, (_item, index) => index + 1),
    oldestIndexedCampaignUid: 91,
    limit: 30,
  });

  assert.deepEqual(selected.slice(0, 10), [120, 119, 118, 117, 116, 115, 114, 113, 112, 111]);
  assert.deepEqual(selected.slice(10), [
    90, 89, 88, 87, 86, 85, 84, 83, 82, 81,
    80, 79, 78, 77, 76, 75, 74, 73, 72, 71,
  ]);
});

test('campaign history sync searches both coldmail subjects from campaign start', async () => {
  const queries = [];
  const options = [];
  const client = {
    async search(query, searchOptions) {
      queries.push(query);
      options.push(searchOptions);
      return Array.from({ length: 20 }, (_item, index) => index + 1);
    },
  };

  const selected = await resolveMailboxSyncUids({
    client,
    limit: 9,
    campaignHistory: true,
    oldestIndexedCampaignUid: 10,
  });

  assert.equal(selected.length, 9);
  assert.deepEqual(queries, [
    { all: true },
    { since: CAMPAIGN_HISTORY_SINCE, subject: CAMPAIGN_HISTORY_SUBJECT_TERMS[0] },
    { since: CAMPAIGN_HISTORY_SINCE, subject: CAMPAIGN_HISTORY_SUBJECT_TERMS[1] },
  ]);
  assert.deepEqual(options, [{ uid: true }, { uid: true }, { uid: true }]);
});
