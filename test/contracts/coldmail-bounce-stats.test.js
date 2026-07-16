const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeBounceRecords,
  summarizeMailboxBounceStats,
} = require('../../server/services/coldmail-bounce-stats');

const CURRENT_DAY_KEY = '2026-07-16';

function summarize(messages, sentEmails = []) {
  return summarizeMailboxBounceStats(messages, {
    currentDayKey: CURRENT_DAY_KEY,
    getDayKey: (date) => date.toISOString().slice(0, 10),
    ownMailboxEmails: ['serve@softora.nl', 'martijn@softora.nl'],
    sentRecipientCounts: Object.fromEntries(sentEmails.map((email) => [`email:${email}`, 1])),
    requireSentRecipientMatch: true,
  });
}

test('mailbox bounce stats count one recipient once and keep the strongest outcome', () => {
  const stats = summarize([
    {
      folder: 'inbox',
      account_email: 'serve@softora.nl',
      sender_email: 'mailer-daemon@example.net',
      subject: 'Warning: could not send message for past 1 hour',
      body_text: 'The following recipient is affected:\nlead@example.test\nStatus: 4.2.0\nDelivery delayed, will keep trying.',
      date: '2026-07-16T08:00:00.000Z',
    },
    {
      folder: 'inbox',
      account_email: 'serve@softora.nl',
      sender_email: 'mailer-daemon@example.net',
      subject: 'Mail delivery failed: returning message to sender',
      body_text: 'Mail delivery to the following recipient has finally failed:\nlead@example.test\nDiagnostic-Code: smtp; 5.1.1 user unknown',
      date: '2026-07-16T09:00:00.000Z',
    },
  ], ['lead@example.test']);

  assert.equal(stats.totalBounces, 1);
  assert.equal(stats.bouncesToday, 1);
  assert.deepEqual(stats.bounceTypes, { hard: 1, soft: 0, instantly: 0, unknown: 0 });
  assert.equal(stats.bounceItems[0].email, 'lead@example.test');
  assert.equal(stats.bounceItems[0].type, 'hard');
  assert.equal(stats.bounceMessages, 2);
  assert.equal(stats.matchedMessages, 2);
  assert.equal(stats.unresolvedMessages, 0);
  assert.equal(stats.duplicateNotices, 1);
});

test('mailbox bounce stats exclude DSNs that cannot be matched to a sent recipient', () => {
  const stats = summarize([
    {
      folder: 'inbox',
      account_email: 'serve@softora.nl',
      sender_email: 'postmaster@example.net',
      subject: 'Delivery Status Notification (Failure)',
      body_text: 'Final-Recipient: rfc822; unrelated@example.test\nDiagnostic-Code: smtp; 5.1.1 user unknown',
      date: '2026-07-16T09:00:00.000Z',
    },
  ], ['actual-send@example.test']);

  assert.equal(stats.totalBounces, 0);
  assert.equal(stats.bounceMessages, 1);
  assert.equal(stats.matchedMessages, 0);
  assert.equal(stats.unresolvedMessages, 1);
});

test('mailbox bounce stats do not infer a recipient from loose quoted addresses', () => {
  const stats = summarize([
    {
      folder: 'inbox',
      account_email: 'serve@softora.nl',
      sender_email: 'postmaster@example.net',
      subject: 'Delivery Status Notification (Failure)',
      body_text: 'The server rejected a message. Quoted contact: actual-send@example.test',
      date: '2026-07-16T09:00:00.000Z',
    },
  ], ['actual-send@example.test']);

  assert.equal(stats.totalBounces, 0);
  assert.equal(stats.unresolvedMessages, 1);
});

test('mailbox bounce stats support multiple failed recipients in one DSN', () => {
  const stats = summarize([
    {
      folder: 'inbox',
      account_email: 'martijn@softora.nl',
      sender_email: 'postmaster@example.net',
      subject: 'Delivery Status Notification (Failure)',
      body_text: [
        'Final-Recipient: rfc822; first@example.test',
        'Final-Recipient: rfc822; second@example.test',
        'Diagnostic-Code: smtp; 5.1.1 user unknown',
      ].join('\n'),
      date: '2026-07-15T09:00:00.000Z',
    },
  ], ['first@example.test', 'second@example.test']);

  assert.equal(stats.totalBounces, 2);
  assert.equal(stats.bouncesToday, 0);
  assert.equal(stats.matchedMessages, 1);
  assert.equal(stats.duplicateNotices, 0);
});

test('bounce record merge deduplicates database and mailbox signals by recipient', () => {
  const records = mergeBounceRecords(
    [{ email: 'lead@example.test', type: 'soft', at: '2026-07-15T08:00:00.000Z' }],
    [
      { email: 'lead@example.test', type: 'hard', at: '2026-07-16T08:00:00.000Z' },
      { email: 'other@example.test', type: 'unknown', at: '2026-07-16T09:00:00.000Z' },
    ]
  );

  assert.equal(records.length, 2);
  assert.equal(records.find((record) => record.email === 'lead@example.test').type, 'hard');
});
