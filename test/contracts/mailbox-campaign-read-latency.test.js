const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxCampaignRepliesService, listExactSentDescendants } = require('../../server/services/mailbox-campaign-replies');

test('recente en historische inboxscans starten onafhankelijk en behouden alle mappen', async () => {
  let releaseRecent;
  const recent = new Promise((resolve) => { releaseRecent = resolve; });
  const matchingFolders = [];
  const service = createMailboxCampaignRepliesService({
    mailboxIndexStore: {
      listMessagesForAccounts: () => recent,
      listMatchingMessagesForAccounts: async ({ folder }) => { matchingFolders.push(folder); return []; },
    },
    dataOpsStore: { listCustomersByEmails: async () => [] },
    logger: { info() {} },
  });
  const pending = service.listReplies({ owner: 'serve', hydrateBodies: false });
  assert.deepEqual(matchingFolders, ['coldmail', 'inbox', 'allmail']);
  releaseRecent([]);
  assert.deepEqual(await pending, []);
  assert.deepEqual(matchingFolders, ['coldmail', 'inbox', 'allmail', 'sent']);
});

test('exacte Sent-herstelketens lezen maximaal drie accounts tegelijk met stabiele accountisolatie', async () => {
  const accounts = Array.from({ length: 5 }, (_, i) => `account${i}@softora.nl`);
  const pendingReads = [];
  let inFlight = 0;
  let peak = 0;
  const promise = listExactSentDescendants({
    allowedAccountEmails: accounts,
    seedMessages: accounts.map((accountEmail, i) => ({
      id: `inbox:${i}`, accountEmail, folder: 'inbox', messageId: `<root-${i}@example.nl>`,
    })),
    mailboxIndexStore: {
      listMessagesReferencingMessageIdsForAccounts: async ({ accountEmails, messageIds }) => {
        assert.equal(accountEmails.length, 1);
        if (!messageIds[0].startsWith('root-')) return [];
        const accountEmail = accountEmails[0];
        inFlight += 1; peak = Math.max(peak, inFlight);
        await new Promise((resolve) => pendingReads.push(resolve));
        inFlight -= 1;
        const child = {
          id: 'sent:1', uid: 1, accountEmail, folder: 'sent',
          messageId: `<child-${accountEmail}>`, inReplyTo: `<${messageIds[0]}>`,
        };
        return [child, { ...child, accountEmail: 'wrong-owner@softora.nl' }];
      },
    },
  });
  assert.equal(pendingReads.length, 3);
  pendingReads.splice(0).reverse().forEach((release) => release());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(pendingReads.length, 2);
  pendingReads.splice(0).reverse().forEach((release) => release());
  const result = await promise;
  assert.equal(peak, 3);
  assert.deepEqual(result.map((message) => message.accountEmail), accounts);
});

test('een onvolledige parallelle Sent-lezing blijft een fout in plaats van een lege geslaagde lijst', async () => {
  await assert.rejects(listExactSentDescendants({
    allowedAccountEmails: ['serve@softora.nl'],
    seedMessages: [{ accountEmail: 'serve@softora.nl', messageId: '<root@example.nl>' }],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async () => null },
  }), /kon niet worden gelezen/);
});
