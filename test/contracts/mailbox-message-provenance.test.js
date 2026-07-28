const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getMailboxMessageDirection,
  isSameMailboxIdentity,
  normalizeMessageProvenance,
} = require('../../server/services/mailbox-message-provenance');

test('mailbox provenance treats Gmail dots as the same immutable sender identity', () => {
  assert.equal(isSameMailboxIdentity('serve.creusen7@gmail.com', 'servecreusen7@gmail.com'), true);
  assert.equal(getMailboxMessageDirection({
    accountEmail: 'servecreusen7@gmail.com',
    folder: 'coldmail',
    email: 'serve.creusen7@gmail.com',
    to: 'info@altiflexpersoneelsdiensten.nl',
    body: 'Een geciteerd antwoord mag richting nooit veranderen.',
  }), 'sent');
});

test('mailbox provenance preserves storage folder while exact Sent provenance controls direction', () => {
  assert.deepEqual(normalizeMessageProvenance({
    accountEmail: 'servecreusen7@gmail.com',
    folder: 'coldmail',
    sourceFolders: ['coldmail', 'sent'],
    email: 'klant@example.nl',
  }), {
    accountEmail: 'servecreusen7@gmail.com',
    folder: 'sent',
    storageFolder: 'coldmail',
    sourceFolders: ['coldmail', 'sent'],
    direction: 'sent',
    email: 'klant@example.nl',
  });
});
