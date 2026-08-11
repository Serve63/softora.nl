const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_HISTORY_SINCE,
  CAMPAIGN_HISTORY_SUBJECT_TERMS,
  resolveMailboxSyncUids,
  selectMailboxSyncUids,
} = require('../../server/services/mailbox-campaign-history-sync');
const {
  collectMissingCampaignThreadReferenceIds,
  collectCampaignThreadRecipientTerms,
} = require('../../server/services/mailbox-campaign-sync');
const {
  createMailboxIndexTargetedLookups,
  selectCampaignSeedMessages,
} = require('../../server/repositories/mailbox-index-targeted-lookups');

test('campaign history seed bewaart oude deelnemers uit elke map en onderwerpstroom binnen de cap', () => {
  const recentQuestionMessages = Array.from({ length: 140 }, (_item, index) => ({
    id: `inbox:question-${index}`,
    messageId: `<question-${index}@example.nl>`,
    date: new Date(Date.UTC(2026, 7, 11, 12, 0, -index)).toISOString(),
  }));
  const olderWebdesignMessages = Array.from({ length: 75 }, (_item, index) => ({
    id: `inbox:webdesign-${index}`,
    messageId: index === 68
      ? '<karoena-history-seed@praktijkkaroena.nl>'
      : `<webdesign-${index}@example.nl>`,
    date: new Date(Date.UTC(2026, 3, 30, 12, 0, -index)).toISOString(),
  }));

  const selected = selectCampaignSeedMessages({
    batches: [recentQuestionMessages, olderWebdesignMessages],
    limit: 150,
    normalizeString: (value) => String(value || '').trim(),
  });

  assert.equal(selected.length, 150);
  assert.ok(selected.some((message) =>
    message.messageId === '<karoena-history-seed@praktijkkaroena.nl>'
  ));
  assert.deepEqual(
    selected.filter((message) => message.id.startsWith('inbox:question-')).map((message) => message.id),
    recentQuestionMessages.slice(0, 75).map((message) => message.id)
  );
  assert.deepEqual(
    selected.filter((message) => message.id.startsWith('inbox:webdesign-')).map((message) => message.id),
    olderWebdesignMessages.map((message) => message.id)
  );
});

test('campaign history seed leest iedere map en onderwerpstroom als eigen begrensde bron', async () => {
  const calls = [];
  const lookups = createMailboxIndexTargetedLookups({
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    normalizeFolder: (value) => String(value || '').trim().toLowerCase(),
    normalizeString: (value) => String(value || '').trim(),
    listMatchingMessagesForAccounts: async (options) => {
      calls.push(options);
      return [{
        id: `${options.folder}:${options.subjectTerms[0]}`,
        messageId: `<${options.folder}-${options.subjectTerms[0]}@example.nl>`,
        date: '2026-05-01T12:00:00.000Z',
      }];
    },
  });

  const selected = await lookups.listCampaignSeedMessagesForAccount({
    accountEmail: 'martijnven123@gmail.com',
    folders: ['inbox', 'sent'],
    subjectTerms: ['Kleine vraag', 'Nieuw webdesign'],
    limit: 4,
  });

  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((call) => [call.folder, call.subjectTerms]), [
    ['inbox', ['Kleine vraag']],
    ['inbox', ['Nieuw webdesign']],
    ['sent', ['Kleine vraag']],
    ['sent', ['Nieuw webdesign']],
  ]);
  assert.equal(selected.length, 4);
  assert.ok(selected.some((message) => message.id === 'inbox:Nieuw webdesign'));
});

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
      {
        folder: 'sent',
        email: 'martijn@softora.nl',
        to: 'Praktijk Karoena <info@praktijkkaroena.nl>',
        subject: 'Nieuw webdesign',
      },
    ]),
    [
      'info@joeyscardetailing.nl',
      'joeyscardetailing.nl',
      'contact@gmail.com',
      'info@praktijkkaroena.nl',
      'praktijkkaroena.nl',
    ]
  );
});

test('campaign recovery keeps only stable referenced-but-unindexed Message-ID values', () => {
  const messages = [{
    messageId: '<known-root@example.test>',
    inReplyTo: '<missing-first@example.test>',
    references: '<known-root@example.test> <missing-first@example.test>',
  }, {
    messageId: '<known-sent@example.test>',
    inReplyTo: '<missing-second@example.test>',
    references: '<KNOWN-ROOT@example.test> <missing-first@example.test> <missing-second@example.test>',
  }];

  assert.deepEqual(collectMissingCampaignThreadReferenceIds(messages), [
    '<missing-first@example.test>',
    '<missing-second@example.test>',
  ]);
  assert.deepEqual(
    collectMissingCampaignThreadReferenceIds(messages, { limit: 1 }),
    ['<missing-first@example.test>']
  );
});

test('campaign recovery reduces hundreds of indexed headers to the small missing reference set', () => {
  const indexed = Array.from({ length: 410 }, (_item, index) => ({
    messageId: `<indexed-${index}@example.test>`,
  }));
  indexed[0].references = [
    ...indexed.map((message) => message.messageId),
    ...Array.from({ length: 8 }, (_item, index) => `<missing-${index}@example.test>`),
  ].join(' ');

  assert.deepEqual(
    collectMissingCampaignThreadReferenceIds(indexed),
    Array.from({ length: 8 }, (_item, index) => `<missing-${index}@example.test>`)
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

test('Gmail All Mail recovery gives exact missing references priority over unrelated recent mail', () => {
  const selected = selectMailboxSyncUids({
    allUids: Array.from({ length: 100 }, (_item, index) => index + 1),
    priorityUids: [42, 55],
    limit: 2,
    prioritizeTargetedUids: true,
  });

  assert.deepEqual(selected, [55, 42]);
});

test('Gmail All Mail participant fallback covers received and sent directions', async () => {
  const queries = [];
  await resolveMailboxSyncUids({
    client: {
      async search(query, options) {
        queries.push({ query, options });
        return query.all ? [1, 2] : [2];
      },
    },
    folder: 'allmail',
    limit: 1,
    threadRecipientTerms: ['info@praktijkkaroena.nl'],
  });

  assert.deepEqual(queries[1].query.or, [
    { from: 'info@praktijkkaroena.nl' },
    { to: 'info@praktijkkaroena.nl' },
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
      {
        header: {
          'message-id': '<BF12953B-A9DE-4A85-8F2D-F94926245967@vangestelsteigerbouw.nl>',
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

test('campaign incremental inbox sync searches known campaign participants by sender', async () => {
  const queries = [];
  const client = {
    async search(query, options) {
      queries.push({ query, options });
      if (query.all) return [1, 2, 3, 4];
      return [4];
    },
  };

  const selected = await resolveMailboxSyncUids({
    client,
    limit: 2,
    folder: 'inbox',
    campaignHistory: false,
    threadRecipientTerms: ['info@praktijkkaroena.nl', 'praktijkkaroena.nl'],
    indexedUids: [1, 2, 3],
  });

  assert.deepEqual(selected, [4]);
  assert.deepEqual(queries, [
    { query: { all: true }, options: { uid: true } },
    {
      query: {
        since: CAMPAIGN_HISTORY_SINCE,
        or: [
          { from: 'info@praktijkkaroena.nl' },
          { from: 'praktijkkaroena.nl' },
        ],
      },
      options: { uid: true },
    },
  ]);
});

test('campaign incremental inbox recovery bounds missing reference lookup before participant search', async () => {
  const queries = [];
  const client = {
    async search(query, options) {
      queries.push({ query, options });
      if (query.all) return [1, 2, 3, 4, 5];
      return [4, 5];
    },
  };

  const selected = await resolveMailboxSyncUids({
    client,
    limit: 4,
    folder: 'inbox',
    campaignHistory: false,
    includeThreadReferenceSearch: true,
    threadReferenceIds: Array.from(
      { length: 8 },
      (_item, index) => `<campaign-${index}@example.test>`
    ),
    threadRecipientTerms: ['info@praktijkkaroena.nl', 'praktijkkaroena.nl'],
    indexedUids: [1, 2, 3],
  });

  assert.deepEqual(selected, [5, 4]);
  assert.equal(queries.length, 3);
  assert.deepEqual(queries[0], { query: { all: true }, options: { uid: true } });
  assert.equal(queries[1].query.or.length, 24);
  assert.deepEqual(queries[2], {
    query: {
      since: CAMPAIGN_HISTORY_SINCE,
      or: [
        { from: 'info@praktijkkaroena.nl' },
        { from: 'praktijkkaroena.nl' },
      ],
    },
    options: { uid: true },
  });
});
