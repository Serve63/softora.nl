const assert = require('assert');
const test = require('node:test');

const {
  BACKFILL_SOURCE,
  buildCustomerIndexes,
  buildMailboxSentEvents,
  buildReport,
  extractRecipientEmails,
  findMissingGuardKeys,
  groupMissingRowsForInsert,
  isInitialWebdesignMail,
  parseArgs,
} = require('../../scripts/backfill-coldmail-outbound-guards');

test('coldmail outbound guard backfill detects initial mailbox-sent webdesign mails', () => {
  assert.equal(
    isInitialWebdesignMail({
      folder: 'sent',
      subject: 'Kleine vraag over jullie website',
      body_text: 'Mocht je er niks mee willen doen, hoor ik alsnog graag je mening.',
    }),
    true
  );
  assert.equal(
    isInitialWebdesignMail({
      folder: 'sent',
      subject: 'Re: Kleine vraag over jullie website',
      body_text: 'Dank voor je reactie.',
    }),
    false
  );
});

test('coldmail outbound guard backfill maps mailbox recipients to all central guard identities', () => {
  const customers = [
    {
      customer_id: 'customer-123',
      company: 'Bakkerij Zon',
      email: 'info@bakkerijzon.nl',
      website: 'https://www.bakkerijzon.nl',
      payload: {},
    },
  ];
  const messages = [
    {
      message_key: 'serve:sent:1',
      account_email: 'serve@softora.nl',
      folder: 'sent',
      uid: 1,
      message_id: '<message-1@example.test>',
      recipients_text: 'Bakkerij Zon <info@bakkerijzon.nl>',
      subject: 'Kleine vraag over jullie website',
      body_text: 'Afgelopen week kwam ik jullie website tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      date: '2026-06-08T05:02:00.000Z',
      payload: {},
    },
  ];

  assert.deepEqual(extractRecipientEmails(messages[0]), ['info@bakkerijzon.nl']);
  const events = buildMailboxSentEvents(messages, buildCustomerIndexes(customers));
  assert.equal(events.length, 1);
  assert.deepEqual(
    events[0].keyRows.map((row) => row.guardKey),
    [
      'email:info@bakkerijzon.nl',
      'domain:bakkerijzon.nl',
      'company:bakkerij-zon',
      'id:customer-123',
    ]
  );

  const missing = findMissingGuardKeys(events, [
    { guard_key: 'email:info@bakkerijzon.nl' },
  ]);
  assert.deepEqual(
    missing.map((item) => item.guardKey),
    ['domain:bakkerijzon.nl', 'company:bakkerij-zon', 'id:customer-123']
  );

  const insertRows = groupMissingRowsForInsert(missing);
  assert.equal(insertRows.length, 3);
  assert.equal(insertRows[0].provider, 'softora');
  assert.equal(insertRows[0].channel, 'coldmail');
  assert.equal(insertRows[0].permanent, true);
  assert.equal(insertRows[0].source, BACKFILL_SOURCE);
  assert.equal(insertRows[0].payload.events[0].messageId, '<message-1@example.test>');
});

test('coldmail outbound guard backfill never matches unrelated customers through shared mailbox domains', () => {
  const customers = [
    {
      customer_id: 'customer-gmail-one',
      company: 'Eerste Gmail Bedrijf',
      email: 'eerste@gmail.com',
      website: 'https://eerste-gmail-bedrijf.nl',
      payload: {},
    },
  ];
  const messages = [
    {
      message_key: 'serve:sent:gmail',
      account_email: 'serve@softora.nl',
      folder: 'sent',
      uid: 2,
      recipients_text: 'Tweede Bedrijf <tweede@gmail.com>',
      subject: 'Kleine vraag over jullie website',
      body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      date: '2026-06-08T05:02:00.000Z',
      payload: {},
    },
  ];

  const events = buildMailboxSentEvents(messages, buildCustomerIndexes(customers));
  assert.equal(events.length, 1);
  assert.deepEqual(
    events[0].keyRows.map((row) => row.guardKey),
    ['email:tweede@gmail.com']
  );
});

test('coldmail outbound guard backfill reports post-pause sends and defaults to check mode', () => {
  const options = parseArgs(['--post-pause-after=2026-06-08T08:27:00.000Z']);
  assert.equal(options.apply, false);

  const report = buildReport({
    events: [
      {
        recipientEmail: 'info@late-send.nl',
        accountEmail: 'serve@softora.nl',
        date: '2026-06-08T08:30:00.000Z',
        subject: 'Kleine vraag over jullie website',
        company: 'Late Send BV',
      },
    ],
    guards: [],
    missing: [],
    insertedRows: [],
    options,
  });

  assert.equal(report.ok, false);
  assert.equal(report.summary.postPauseInitialSends, 1);
  assert.equal(report.postPauseEvents[0].email, 'info@late-send.nl');
});
