'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CAMPAIGN_HISTORY_SINCE,
} = require('../../server/services/mailbox-campaign-history-sync');
const {
  MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP,
  MAILBOX_TARGET_MANIFEST_HEADERS,
  MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW,
  scanMailboxTargetUidManifestWindow,
} = require('../../server/services/mailbox-target-manifest-scan');

function headers(lines = []) {
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

function createClient({ candidateUids = [], messages = [], fetchError = null } = {}) {
  const calls = { search: [], fetch: [] };
  return {
    calls,
    async search(query, options) {
      calls.search.push({ query, options });
      return candidateUids;
    },
    async *fetch(uids, query, options) {
      calls.fetch.push({ uids, query, options });
      if (fetchError) throw fetchError;
      for (const message of messages) yield message;
    },
  };
}

test('gerichte manifestscan matcht uitsluitend exacte tokens uit de drie toegestane headers', async () => {
  const client = createClient({
    candidateUids: [6, 1, 2, 3, 4, 5],
    messages: [
      {
        uid: 1,
        headers: headers(['Message-ID: <ROOT@Example.test>']),
      },
      {
        uid: 2,
        headers: headers([
          'In-Reply-To: <unrelated@example.test>',
          ' <reply@example.test>, <another@example.test>',
        ]),
      },
      {
        uid: 3,
        headers: headers([
          'References: <unrelated@example.test> bare@example.test,',
          ' <chain@example.test>',
        ]),
      },
      {
        uid: 4,
        headers: headers([
          'Subject: root@example.test reply@example.test chain@example.test',
          'Message-ID: <root@example.test.invalid>',
        ]),
      },
      {
        uid: 5,
        headers: headers(['Message-ID: <outside@example.test>']),
      },
      {
        uid: 6,
        headers: headers(['X-References: <chain@example.test>']),
      },
    ],
  });

  const result = await scanMailboxTargetUidManifestWindow({
    client,
    fromUid: 1,
    scanUpperUid: 6_000,
    targetReferenceIds: [
      'root@example.test',
      '<REPLY@example.test>',
      'chain@example.test',
    ],
  });

  assert.deepEqual(result, {
    foundUids: [1, 2, 3],
    scannedThroughUid: MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW,
    scanComplete: false,
  });
  assert.deepEqual(client.calls.search, [{
    query: {
      since: CAMPAIGN_HISTORY_SINCE,
      uid: `1:${MAILBOX_TARGET_MANIFEST_UID_SEARCH_WINDOW}`,
    },
    options: { uid: true },
  }]);
  assert.deepEqual(client.calls.fetch, [{
    uids: [1, 2, 3, 4, 5, 6],
    query: {
      uid: true,
      headers: MAILBOX_TARGET_MANIFEST_HEADERS,
    },
    options: { uid: true },
  }]);
});

test('gerichte manifestscan begrenst headerfetch en hervat na de laatste bewezen kandidaat-UID', async () => {
  const candidateUids = Array.from({ length: 75 }, (_value, index) => index + 101);
  const selectedUids = candidateUids.slice(0, MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP);
  const client = createClient({
    candidateUids,
    messages: selectedUids.map((uid) => ({
      uid,
      headers: headers([`Message-ID: <message-${uid}@example.test>`]),
    })),
  });

  const result = await scanMailboxTargetUidManifestWindow({
    client,
    fromUid: 100,
    scanUpperUid: 10_000,
    targetReferenceIds: ['message-125@example.test'],
  });

  assert.deepEqual(result, {
    foundUids: [125],
    scannedThroughUid: selectedUids[selectedUids.length - 1],
    scanComplete: false,
  });
  assert.deepEqual(client.calls.fetch[0].uids, selectedUids);
});

test('gerichte manifestscan bewaakt de 49/50/51-capgrens zonder UID-gap of overlap', async (t) => {
  for (const candidateCount of [49, 50, 51]) {
    await t.test(`${candidateCount} kandidaten`, async () => {
      const candidateUids = Array.from({ length: candidateCount }, (_value, index) => index + 101);
      const selectedUids = candidateUids.slice(0, MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP);
      const windowThroughUid = 5_000;
      const client = createClient({
        candidateUids,
        messages: selectedUids.map((uid) => ({
          uid,
          headers: headers([`Message-ID: <message-${uid}@example.test>`]),
        })),
      });

      const result = await scanMailboxTargetUidManifestWindow({
        client,
        fromUid: 1,
        scanUpperUid: windowThroughUid,
        targetReferenceIds: ['message-125@example.test'],
      });

      assert.equal(
        result.scannedThroughUid,
        candidateCount <= MAILBOX_TARGET_MANIFEST_HEADER_FETCH_CAP
          ? windowThroughUid
          : selectedUids[selectedUids.length - 1]
      );
      assert.deepEqual(client.calls.fetch[0].uids, selectedUids);
      assert.deepEqual(client.calls.fetch[0].query, {
        uid: true,
        headers: MAILBOX_TARGET_MANIFEST_HEADERS,
      });
      assert.equal(Object.hasOwn(client.calls.fetch[0].query, 'internalDate'), false);
      if (candidateCount === 51) {
        assert.equal(result.scannedThroughUid + 1, candidateUids[50]);
      }
    });
  }
});

test('gerichte manifestscan slaat lege UID-gebieden over en rondt uitsluitend de bovengrens af', async () => {
  const client = createClient();
  const result = await scanMailboxTargetUidManifestWindow({
    client,
    fromUid: 5_001,
    scanUpperUid: 5_400,
    targetReferenceIds: ['root@example.test'],
  });

  assert.deepEqual(result, {
    foundUids: [],
    scannedThroughUid: 5_400,
    scanComplete: true,
  });
  assert.equal(client.calls.fetch.length, 0);
  assert.equal(client.calls.search[0].query.uid, '5001:5400');
});

test('gerichte manifestscan weigert elk onvolledig of dubbelzinnig headerbewijs voor checkpointing', async (t) => {
  const baseMessages = [
    {
      uid: 1,
      headers: headers(['Message-ID: <root@example.test>']),
    },
    {
      uid: 2,
      headers: headers(['Message-ID: <other@example.test>']),
    },
  ];
  const cases = [
    { name: 'ontbrekende kandidaat', messages: baseMessages.slice(0, 1) },
    {
      name: 'ontbrekende headers',
      messages: [baseMessages[0], { ...baseMessages[1], headers: undefined }],
    },
    {
      name: 'dubbele kandidaat',
      messages: [baseMessages[0], baseMessages[0], baseMessages[1]],
    },
    {
      name: 'onverwachte kandidaat',
      messages: [baseMessages[0], { ...baseMessages[1], uid: 3 }],
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const client = createClient({ candidateUids: [1, 2], messages: scenario.messages });
      await assert.rejects(
        scanMailboxTargetUidManifestWindow({
          client,
          fromUid: 1,
          scanUpperUid: 2,
          targetReferenceIds: ['root@example.test'],
        }),
        { code: 'MAILBOX_UID_TARGET_MANIFEST_SCAN_INVALID' }
      );
    });
  }

  await t.test('fetchfout', async () => {
    const client = createClient({
      candidateUids: [1],
      fetchError: new Error('imap fetch stopte'),
    });
    await assert.rejects(
      scanMailboxTargetUidManifestWindow({
        client,
        fromUid: 1,
        scanUpperUid: 1,
        targetReferenceIds: ['root@example.test'],
      }),
      /imap fetch stopte/
    );
  });

  await t.test('ongeldige zoekuitkomst', async () => {
    const client = createClient({ candidateUids: null });
    await assert.rejects(
      scanMailboxTargetUidManifestWindow({
        client,
        fromUid: 1,
        scanUpperUid: 1,
        targetReferenceIds: ['root@example.test'],
      }),
      { code: 'MAILBOX_UID_TARGET_MANIFEST_SCAN_INVALID' }
    );
    assert.equal(client.calls.fetch.length, 0);
  });

  for (const scenario of [
    { name: 'niet-numerieke UID', candidateUids: [1, '2'] },
    { name: 'dubbele UID', candidateUids: [1, 1] },
    { name: 'UID onder window', candidateUids: [0, 1] },
    { name: 'UID boven window', candidateUids: [1, 3] },
  ]) {
    await t.test(scenario.name, async () => {
      const client = createClient({ candidateUids: scenario.candidateUids });
      await assert.rejects(
        scanMailboxTargetUidManifestWindow({
          client,
          fromUid: 1,
          scanUpperUid: 2,
          targetReferenceIds: ['root@example.test'],
        }),
        { code: 'MAILBOX_UID_TARGET_MANIFEST_SCAN_INVALID' }
      );
      assert.equal(client.calls.fetch.length, 0);
    });
  }
});
