const test = require('node:test');
const assert = require('node:assert/strict');
const { loadMatchedColdmailBounceStats } = require('../../server/services/coldmail-bounce-recipient-proof');
const candidates = { available: true, messages: Array.from({ length: 101 }, (_, i) => ({
  subject: 'Returned Mail', sender_email: 'mailer-daemon@example.test',
  body_text: `Final-Recipient: rfc822; lead${i}@example.test\nDiagnostic-Code: smtp; 5.1.1 user unknown`,
})) };
const summarizeSentGroups = (groups) => ({ recipientCounts: Object.fromEntries(groups.map(row => ['email:' + row.recipient_email, 1])) });

test('bounce proof uses complete targeted batches independent of the global sent history limit', async () => {
  const calls = [];
  const result = await loadMatchedColdmailBounceStats(candidates, { summarizeSentGroups, store: {
    async listSentRecipientGroups(options) {
      calls.push(options);
      assert.equal(options.maxRows, undefined);
      return options.recipientEmails.filter(email => email !== 'lead100@example.test').map(recipient_email => ({ recipient_email }));
    },
  } });
  assert.equal(result.reliable, true);
  assert.equal(result.bounceTypes.hard, 100);
  assert.deepEqual(calls.map(call => call.recipientEmails.length), [100, 1]);
});

test('a failed or incomplete proof batch never turns a partial bounce match into a reliable total', async () => {
  for (const throws of [false, true]) {
    let calls = 0;
    const result = await loadMatchedColdmailBounceStats(candidates, { summarizeSentGroups, store: {
      async listSentRecipientGroups(options) {
        if (++calls === 2) { if (throws) throw new Error('timeout'); return null; }
        return options.recipientEmails.map(recipient_email => ({ recipient_email }));
      },
    } });
    assert.equal(result.available, false); assert.equal(result.reliable, false);
    assert.equal(result.bounceTypes, undefined);
  }
});
