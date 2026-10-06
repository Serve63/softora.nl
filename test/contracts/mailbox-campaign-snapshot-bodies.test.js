const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailboxCampaignSnapshotBodies } = require('../../server/services/mailbox-campaign-snapshot-bodies');

function resolved(reference, body, extra = {}) {
  return {
    id: reference.id, uid: reference.uid || 0, folder: reference.folder, accountEmail: reference.account,
    resolved: true, body, hasBody: true, bodyTruncated: false, recipientRoutingEvidenceKnown: true,
    to: 'marijn@example.test', aiPresentation: { version: 'mailbox-luna-v1', status: 'unavailable' }, ...extra,
  };
}

test('de mailbox-snapshot krijgt alle hoofd- en threadteksten vooraf mee', async () => {
  const calls = [];
  const hydrate = createMailboxCampaignSnapshotBodies({
    logger: { info() {} },
    getMessageBodies: async ({ messages }) => {
      calls.push(messages);
      return messages.map((reference) => resolved(reference, `Tekst ${reference.id}`));
    },
  });
  const source = [{
    id: 'inbox:128', uid: 128, folder: 'inbox', accountEmail: 'serve@softora.nl', hasBody: true, body: '',
    threadMessages: [
      { id: 'sent:5', uid: 5, folder: 'sent', hasBody: true, body: '' },
      { id: 'allmail:6', mailboxId: 'allmail:9', storageFolder: 'allmail', uid: 9, folder: 'sent', hasBody: true, body: '' },
      { id: 'sent:7', uid: 7, folder: 'sent', hasBody: true, body: 'Al aanwezig', aiPresentation: { status: 'unavailable' } },
      { id: 'sent:uidless', uid: 0, folder: 'sent', hasBody: true, body: '', messageId: '<x@example.test>' },
    ],
  }];
  const [conversation] = await hydrate(source);
  assert.deepEqual(calls, [[
    { account: 'serve@softora.nl', folder: 'inbox', id: 'inbox:128', uid: 128 },
    { account: 'serve@softora.nl', folder: 'sent', id: 'sent:5', uid: 5 },
    { account: 'serve@softora.nl', folder: 'allmail', id: 'allmail:9', uid: 9 },
  ]]);
  assert.equal(conversation.body, 'Tekst inbox:128');
  assert.equal(conversation.bodyLoaded, true);
  assert.deepEqual(conversation.aiPresentation, { version: 'mailbox-luna-v1', status: 'unavailable' });
  assert.equal(conversation.threadMessages[0].body, 'Tekst sent:5');
  assert.equal(conversation.threadMessages[1].body, 'Tekst allmail:9');
  assert.equal(conversation.threadMessages[2].body, 'Al aanwezig');
  // Uid-less provider lookups stay on demand instead of slowing every snapshot.
  assert.equal(conversation.threadMessages[3].body, '');
  assert.equal(source[0].body, '');
  assert.equal(source[0].threadMessages[0].body, '');
});

test('een onleesbare referentie houdt de rest van de snapshotteksten niet tegen', async () => {
  const hydrate = createMailboxCampaignSnapshotBodies({
    logger: { info() {} },
    getMessageBodies: async ({ messages }) => {
      if (messages.some((reference) => reference.account === 'onbekend@example.test')) throw new Error('Onbekend account');
      return messages.map((reference) => resolved(reference, `Tekst ${reference.id}`));
    },
  });
  const result = await hydrate([
    { id: 'inbox:1', uid: 1, folder: 'inbox', accountEmail: 'onbekend@example.test', hasBody: true, body: '' },
    { id: 'inbox:2', uid: 2, folder: 'inbox', accountEmail: 'serve@softora.nl', hasBody: true, body: '' },
  ]);
  assert.equal(result[0].body, '');
  assert.equal(result[1].body, 'Tekst inbox:2');
});

test('een onopgeloste of lege tekst wordt niet als geladen gemarkeerd', async () => {
  const hydrate = createMailboxCampaignSnapshotBodies({
    logger: { info() {} },
    getMessageBodies: async ({ messages }) => messages.map((reference) => ({ ...resolved(reference, ''), resolved: reference.uid === 1 })),
  });
  const result = await hydrate([
    { id: 'inbox:1', uid: 1, folder: 'inbox', accountEmail: 'serve@softora.nl', hasBody: true, body: '' },
    { id: 'inbox:2', uid: 2, folder: 'inbox', accountEmail: 'serve@softora.nl', hasBody: true, body: '' },
  ]);
  assert.equal(result[0].bodyLoaded, undefined);
  assert.equal(result[1].bodyLoaded, undefined);
});

test('een Instantly-gesprek met tekst maar zonder AI-weergave krijgt die vooraf mee', async () => {
  const calls = [];
  const hydrate = createMailboxCampaignSnapshotBodies({
    logger: { info() {} },
    getMessageBodies: async ({ messages }) => {
      calls.push(messages);
      return messages.map((reference) => resolved(reference, 'Tekst uit de index', {
        aiPresentation: { version: 'mailbox-luna-v1', status: 'ready', sourceBody: 'Tekst uit de index' },
      }));
    },
  });
  const [conversation] = await hydrate([{
    id: 'serve@websoftora.com|instantly-thread:7a-abc', mailboxId: 'instantly:01a10fe8-535d-709c-8cbf-d0f95c62f74e',
    folder: 'inbox', storageFolder: 'instantly', provider: 'instantly', uid: 0,
    accountEmail: 'serve@websoftora.com', hasBody: true, body: 'Tekst uit de index', bodyLoaded: true,
    threadMessages: [{ id: 'sent:4', uid: 4, folder: 'sent', hasBody: true, body: 'Klaar', aiPresentation: { status: 'unavailable' } }],
  }]);
  assert.deepEqual(calls, [[
    { account: 'serve@websoftora.com', folder: 'instantly', id: 'instantly:01a10fe8-535d-709c-8cbf-d0f95c62f74e' },
  ]]);
  assert.equal(conversation.aiPresentation.status, 'ready');
  assert.equal(conversation.body, 'Tekst uit de index');
  assert.equal(conversation.bodyLoaded, true);
});
