const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createMailboxImapAbortScope,
} = require('../../server/services/mailbox-imap-abort');

test('een vooraf geaborteerde IMAP-scope sluit hard zonder listenerlek', () => {
  const reason = new Error('deadline was al verstreken');
  reason.code = 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE';
  let listenersAdded = 0;
  let listenersRemoved = 0;
  let closes = 0;
  const signal = {
    aborted: true,
    reason,
    addEventListener() { listenersAdded += 1; },
    removeEventListener() { listenersRemoved += 1; },
  };

  assert.throws(() => createMailboxImapAbortScope({
    close() { closes += 1; },
  }, signal), { code: 'MAILBOX_CAMPAIGN_MUTATION_DEADLINE' });
  assert.equal(closes, 1);
  assert.equal(listenersAdded, 0);
  assert.equal(listenersRemoved, 0);
});
