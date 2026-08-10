const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
  resolveMailboxSyncUids,
  selectMailboxSyncUids,
} = require('../../server/services/mailbox-campaign-history-sync');
const {
  collectCampaignThreadRecipientTerms,
} = require('../../server/services/mailbox-campaign-sync');

test('campaign history sync derives sent-recipient searches from normalized indexed messages', () => {
  assert.deepEqual(
    collectCampaignThreadRecipientTerms([
      {
        email: 'info@joeyscardetailing.nl',
        subject: 'Re: Kleine vraag over jullie website',
      },
      {
        email: 'contact@gmail.com',
        subject: 'Re: Nieuw webdesign',
      },
    ]),
    [
      'info@joeyscardetailing.nl',
      'joeyscardetailing.nl',
      'contact@gmail.com',
    ]
  );
});

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

test('campaign history sync bounds each run and imports the newest missing targeted replies first', () => {
  const selected = selectMailboxSyncUids({
    allUids: Array.from({ length: 300 }, (_item, index) => index + 1),
    priorityUids: Array.from({ length: 200 }, (_item, index) => index + 1),
    indexedUids: [200],
    limit: 20,
  });

  assert.equal(selected.includes(200), false);
  assert.equal(selected.includes(199), true);
  assert.equal(selected.includes(187), true);
  assert.equal(selected.includes(186), false);
  assert.equal(selected.length, 20);
  assert.ok(selected.indexOf(199) < selected.indexOf(187));
});

test('incremental sync geeft een due quarantine voorrang zonder gezonde indexrijen over te slaan', async () => {
  const fetches = [];
  const client = {
    async search() { return [39, 40, 41, 42]; },
  };
  const selected = await resolveMailboxSyncUids({
    client,
    limit: 2,
    campaignHistory: false,
    indexedUids: [39, 40, 41],
    priorityUids: [40],
  });
  fetches.push(...selected);

  assert.deepEqual(fetches, [42]);

  const retrySelected = await resolveMailboxSyncUids({
    client,
    limit: 2,
    campaignHistory: false,
    indexedUids: [39, 41],
    priorityUids: [40],
  });
  assert.deepEqual(retrySelected, [42, 40]);
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

test('narrow Gmail label sync advances through unindexed messages without campaign-wide searches', async () => {
  const queries = [];
  const client = {
    async search(query, options) {
      queries.push({ query, options });
      return [1, 2, 3, 4, 5, 6];
    },
  };

  const selected = await resolveMailboxSyncUids({
    client,
    limit: 2,
    campaignHistory: false,
    indexedUids: [5, 6],
  });

  assert.deepEqual(selected, [4, 3]);
  assert.deepEqual(queries, [{ query: { all: true }, options: { uid: true } }]);
});

test('ordinary IMAP selection advances past a full newest window without ever claiming it is complete', () => {
  const allUids = Array.from({ length: 31 }, (_item, index) => index + 1);
  const first = selectMailboxSyncUids({ allUids, indexedUids: [], limit: 30 });
  const second = selectMailboxSyncUids({ allUids, indexedUids: first, limit: 30 });

  assert.deepEqual(first, Array.from({ length: 30 }, (_item, index) => 31 - index));
  assert.equal(first.syncSelectionHealth.truncated, true);
  assert.equal(first.syncSelectionHealth.remainingUidCount, 1);
  assert.deepEqual(second, [1]);
  assert.equal(second.syncSelectionHealth.truncated, false);
  assert.equal(second.syncSelectionHealth.remainingUidCount, 0);
});

test('campaign history sync prioritizes missing sent replies linked by thread headers', async () => {
  const queries = [];
  const client = {
    async search(query) {
      queries.push(query);
      if (query.all) return Array.from({ length: 120 }, (_item, index) => index + 1);
      if (query.or) return [42, 115];
      return Array.from({ length: 120 }, (_item, index) => index + 1);
    },
  };

  const selected = await resolveMailboxSyncUids({
    client,
    limit: 20,
    campaignHistory: true,
    oldestIndexedCampaignUid: 91,
    threadReferenceIds: [
      '<BF12953B-A9DE-4A85-8F2D-F94926245967@vangestelsteigerbouw.nl>',
    ],
    threadRecipientTerms: ['info@vangestelsteigerbouw.nl', 'vangestelsteigerbouw.nl'],
    indexedUids: [115],
  });

  assert.equal(selected[7], 42);
  assert.deepEqual(queries[3], {
    since: CAMPAIGN_HISTORY_SINCE,
    or: [
      {
        header: {
          references: '<BF12953B-A9DE-4A85-8F2D-F94926245967@vangestelsteigerbouw.nl>',
        },
      },
      {
        header: {
          'in-reply-to': '<BF12953B-A9DE-4A85-8F2D-F94926245967@vangestelsteigerbouw.nl>',
        },
      },
    ],
  });
  assert.equal(selected.filter((uid) => uid === 42).length, 1);
  assert.equal(selected.filter((uid) => uid === 115).length, 0);
  assert.deepEqual(queries[4], {
    since: CAMPAIGN_HISTORY_SINCE,
    or: [
      { to: 'info@vangestelsteigerbouw.nl' },
      { to: 'vangestelsteigerbouw.nl' },
    ],
  });
});
