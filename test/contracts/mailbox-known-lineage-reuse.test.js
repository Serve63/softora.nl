const test = require('node:test');
const assert = require('node:assert/strict');
const { listExactSentDescendants } = require('../../server/services/mailbox-campaign-replies');
const accountEmail = 'serve@example.test';
const mail = (id, parent, account = accountEmail) => ({
  id, messageId: `<${id}@example.test>`, inReplyTo: parent ? `<${parent}@example.test>` : '',
  accountEmail: account, folder: 'sent', direction: 'sent', date: '2026-09-09T12:00:00Z',
});

test('known exact Sent chains are proved in memory but every tip is still checked for unseen replies', async () => {
  const chain = [mail('one', 'root'), mail('two', 'one'), mail('three', 'two'), mail('four', 'three')];
  const calls = [];
  const result = await listExactSentDescendants({
    seedMessages: [mail('root')], knownSentMessages: chain, allowedAccountEmails: [accountEmail],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async (args) => { calls.push(args); return chain; } },
  });
  assert.deepEqual(result.map((row) => row.id).sort(), chain.map((row) => row.id).sort());
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].messageIds.sort(), ['root', 'one', 'two', 'three', 'four'].map((id) => `${id}@example.test`).sort());
});

test('unknown descendants beyond the known tip are still discovered and traversed', async () => {
  const calls = [];
  const result = await listExactSentDescendants({
    seedMessages: [mail('root')], knownSentMessages: [mail('one', 'root')], allowedAccountEmails: [accountEmail],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async (args) => {
      calls.push(args);
      if (args.messageIds.includes('two@example.test')) return [];
      if (args.messageIds.includes('one@example.test')) return [mail('two', 'one')];
      return [mail('one', 'root')];
    } },
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.map((row) => row.id).sort(), ['one', 'two']);
});

test('known unrelated mail, other-account copies, substrings and cycles do not broaden thread ownership', async () => {
  const result = await listExactSentDescendants({
    seedMessages: [mail('root')], allowedAccountEmails: [accountEmail],
    knownSentMessages: [mail('one', 'root'), mail('root', 'one'), mail('wrong-account', 'root', 'martijn@example.test'), mail('unrelated', 'other'), mail('substring', 'prefix-root')],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async () => [] },
  });
  assert.deepEqual(result.map((row) => row.id).sort(), ['one', 'root']);
});

test('a failed tip check never turns known history into a complete answer', async () => {
  await assert.rejects(listExactSentDescendants({
    seedMessages: [mail('root')], knownSentMessages: [mail('one', 'root')], allowedAccountEmails: [accountEmail],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async () => null },
  }), { status: 503 });
});

test('wide frontiers are split without dropping references at the repository ID cap', async () => {
  const queried = [];
  await listExactSentDescendants({
    seedMessages: Array.from({ length: 2100 }, (_, index) => mail(`root-${index}`)),
    allowedAccountEmails: [accountEmail],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async ({ messageIds }) => {
      assert.ok(messageIds.length <= 1000); queried.push(...messageIds); return [];
    } },
  });
  assert.equal(new Set(queried).size, 2100);
});

test('unknown chain depth and total known-history limits remain bounded', async () => {
  let count = 0;
  await assert.rejects(listExactSentDescendants({
    seedMessages: [mail('root')], allowedAccountEmails: [accountEmail],
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async ({ messageIds }) => [mail(`next-${count++}`, messageIds[0].split('@')[0])] },
  }), /maximale ketendiepte/);
  assert.equal(count, 20);
  await assert.rejects(listExactSentDescendants({
    seedMessages: [mail('root')], allowedAccountEmails: [accountEmail],
    knownSentMessages: Array.from({ length: 2001 }, (_, index) => mail(`reply-${index}`, 'root')),
    mailboxIndexStore: { listMessagesReferencingMessageIdsForAccounts: async () => [] },
  }), /veilige limiet/);
});
