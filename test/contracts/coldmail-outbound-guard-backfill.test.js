const assert = require('assert');
const test = require('node:test');
const { buildChunkedStatePatch } = require('../../server/services/data-ops-serialization');

const {
  BACKFILL_SOURCE,
  buildCustomerIndexes,
  buildCustomerSentEvents,
  buildLegacyCustomerRowsFromUiState,
  buildMailboxSentEvents,
  buildMailboxWebdesignContactEvents,
  buildReport,
  buildSendGuardEvents,
  extractRecipientEmails,
  findMissingGuardKeys,
  groupMissingRowsForInsert,
  isInitialWebdesignMail,
  parseArgs,
  summarizeMailboxCoverage,
  summarizeConsolidatedDuplicateRiskEmails,
  summarizeMultiProviderGuards,
  summarizeMultiProviderGuardCompanies,
  summarizeMultiProviderGuardDomains,
  summarizeSoftoraDuplicateCompanies,
  summarizeSoftoraDuplicateDomains,
  summarizeSoftoraDuplicateRecipients,
  summarizeWebdesignContactDuplicateDomains,
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
      'domain:bakkerijzon-nl',
      'company:bakkerij-zon',
      'id:customer-123',
    ]
  );

  const missing = findMissingGuardKeys(events, [
    { guard_key: 'email:info@bakkerijzon.nl' },
  ]);
  assert.deepEqual(
    missing.map((item) => item.guardKey),
    ['email:info@bakkerijzon.nl', 'domain:bakkerijzon-nl', 'company:bakkerij-zon', 'id:customer-123']
  );

  const insertRows = groupMissingRowsForInsert(missing);
  assert.equal(insertRows.length, 4);
  assert.equal(insertRows[0].provider, 'softora');
  assert.equal(insertRows[0].channel, 'coldmail');
  assert.equal(insertRows[0].permanent, true);
  assert.equal(insertRows[0].source, BACKFILL_SOURCE);
  assert.equal(insertRows[0].payload.events[0].messageId, '<message-1@example.test>');
});

test('coldmail outbound guard backfill treats non-permanent reservations as missing protection', () => {
  const customers = [
    {
      customer_id: 'customer-reserved',
      company: 'Van den Broek Witgoed',
      email: 'info@vandenbroekwitgoed.nl',
      website: 'vandenbroekwitgoed.nl',
      payload: {},
    },
  ];
  const messages = [
    {
      message_key: 'martijn:sent:reserved',
      account_email: 'martijn@softora.nl',
      folder: 'sent',
      uid: 87,
      message_id: '<historical@example.test>',
      recipients_text: 'info@vandenbroekwitgoed.nl',
      subject: 'Kleine vraag over jullie website',
      body_text: 'Afgelopen week kwam ik jullie website tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
      date: '2026-06-05T13:49:14.000Z',
      payload: {},
    },
  ];

  const events = buildMailboxSentEvents(messages, buildCustomerIndexes(customers));
  assert.deepEqual(
    events[0].keyRows.map((row) => row.guardKey),
    [
      'email:info@vandenbroekwitgoed.nl',
      'domain:vandenbroekwitgoed-nl',
      'company:van-den-broek-witgoed',
      'id:customer-reserved',
    ]
  );

  const missing = findMissingGuardKeys(events, [
    {
      guard_key: 'email:info@vandenbroekwitgoed.nl',
      permanent: false,
      status: 'reserved',
    },
    {
      guard_key: 'domain:vandenbroekwitgoed-nl',
      permanent: true,
      status: 'sent',
    },
  ]);

  assert.deepEqual(
    missing.map((item) => item.guardKey),
    ['email:info@vandenbroekwitgoed.nl', 'company:van-den-broek-witgoed', 'id:customer-reserved']
  );

  const rows = groupMissingRowsForInsert(missing);
  const emailRow = rows.find((row) => row.guard_key === 'email:info@vandenbroekwitgoed.nl');
  assert.equal(emailRow.status, 'sent');
  assert.equal(emailRow.permanent, true);
  assert.equal(emailRow.expires_at, null);
});

test('coldmail outbound guard backfill includes customer sent state as outbound evidence', () => {
  const customers = [
    {
      customer_id: 'manual-import-avdwouw-nl-0522',
      company: 'Ad van de Wouw',
      email: 'info@avdwouw.nl',
      website: 'https://avdwouw.nl/',
      database_status: 'gemaild',
      lifecycle_status: 'gemaild',
      payload: {
        lastColdmailSentAt: '2026-06-08T08:16:59.251Z',
        lastMailSentAt: '2026-06-08T08:16:59.251Z',
        outreachSentAt: '2026-06-08T08:16:59.251Z',
        lastColdmailSenderEmail: 'serve290@gmail.com',
        coldmailSentMessageId: '<message-avdwouw@gmail.com>',
        coldmailSpecialAction: 'webdesign',
        hist: [{ date: '2026-06-08', type: 'gemaild', actor: 'Coldmail Autopilot Cron', label: 'Mail verstuurd' }],
      },
    },
  ];

  const events = buildCustomerSentEvents(customers);
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'customer_sent');
  assert.equal(events[0].datePrecision, 'exact');
  assert.equal(events[0].accountEmail, 'serve290@gmail.com');
  assert.deepEqual(
    events[0].keyRows.map((row) => row.guardKey),
    [
      'email:info@avdwouw.nl',
      'domain:avdwouw-nl',
      'company:ad-van-de-wouw',
      'id:manual-import-avdwouw-nl-0522',
    ]
  );

  const missing = findMissingGuardKeys(events, [
    {
      guard_key: 'email:info@avdwouw.nl',
      permanent: false,
      status: 'reserved',
      source: 'softora-coldmail-pre-send',
    },
  ]);

  assert.deepEqual(
    missing.map((item) => item.guardKey),
    [
      'email:info@avdwouw.nl',
      'domain:avdwouw-nl',
      'company:ad-van-de-wouw',
      'id:manual-import-avdwouw-nl-0522',
    ]
  );
});

test('coldmail outbound guard duplicate summary ignores day-only customer status as hard duplicate proof', () => {
  const customers = [
    {
      customer_id: 'date-only-row',
      company: 'Date Only BV',
      email: 'info@date-only.example',
      website: 'date-only.example',
      database_status: 'gemaild',
      lifecycle_status: 'gemaild',
      payload: {
        hist: [{ date: '2026-05-22', type: 'gemaild', label: 'Mail verstuurd' }],
      },
    },
  ];
  const mailboxEvents = buildMailboxSentEvents(
    [
      {
        message_key: 'serve:sent:date-only',
        account_email: 'serve@softora.nl',
        folder: 'sent',
        uid: 99,
        recipients_text: 'info@date-only.example',
        subject: 'Nieuw webdesign gemaakt!',
        body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
        date: '2026-05-22T08:00:00.000Z',
        payload: {},
      },
    ],
    buildCustomerIndexes(customers)
  );
  const customerEvents = buildCustomerSentEvents(customers);

  assert.equal(customerEvents[0].datePrecision, 'day');
  assert.deepEqual(summarizeSoftoraDuplicateRecipients([...mailboxEvents, ...customerEvents]), []);
});

test('coldmail outbound guard backfill ignores open-tracking history as customer send proof', () => {
  const customers = [
    {
      customer_id: 'open-tracking-row',
      company: 'Koks B-I',
      email: 'info@koks-b-i.nl',
      website: 'koks-b-i.nl',
      database_status: 'gemaild',
      lifecycle_status: 'gemaild',
      payload: {
        statusUpdatedAt: '2026-05-31T17:12:00.000Z',
        updatedAt: '2026-05-31T17:12:00.000Z',
        hist: [
          { at: '2026-05-31T17:12:00.000Z', type: 'mail_geopend', label: 'Mail geopend' },
        ],
      },
    },
  ];
  const mailboxEvents = buildMailboxSentEvents(
    [
      {
        message_key: 'martijn:sent:koks',
        account_email: 'martijn@softora.nl',
        folder: 'sent',
        uid: 101,
        recipients_text: 'info@koks-b-i.nl',
        subject: 'Nieuw webdesign gemaakt!',
        body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
        date: '2026-05-22T10:47:00.000Z',
        payload: {},
      },
    ],
    buildCustomerIndexes(customers)
  );
  const customerEvents = buildCustomerSentEvents(customers);

  assert.equal(customerEvents.length, 0);
  assert.deepEqual(summarizeSoftoraDuplicateRecipients([...mailboxEvents, ...customerEvents]), []);
});

test('coldmail outbound guard backfill detects duplicates across mailbox and customer evidence', () => {
  const customers = [
    {
      customer_id: 'import-339-db-mohsau65-o4xbci',
      company: 'Van den Broek Witgoed',
      email: 'info@vandenbroekwitgoed.nl',
      website: 'vandenbroekwitgoed.nl',
      database_status: 'gemaild',
      lifecycle_status: 'gemaild',
      payload: {
        lastColdmailSentAt: '2026-06-08T06:32:23.412Z',
        lastMailSentAt: '2026-06-08T06:32:23.412Z',
        outreachSentAt: '2026-06-08T06:32:23.412Z',
        lastColdmailSenderEmail: 'servecreusen7@gmail.com',
        coldmailSentMessageId: '<message-vdb@gmail.com>',
        coldmailSpecialAction: 'webdesign',
      },
    },
  ];
  const mailboxEvents = buildMailboxSentEvents(
    [
      {
        message_key: 'martijn:sent:vdb',
        account_email: 'martijn@softora.nl',
        folder: 'sent',
        uid: 88,
        message_id: '<historical-vdb@example.test>',
        recipients_text: 'info@vandenbroekwitgoed.nl',
        subject: 'Kleine vraag over jullie website',
        body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
        date: '2026-06-05T13:49:14.000Z',
        payload: {},
      },
    ],
    buildCustomerIndexes(customers)
  );
  const customerEvents = buildCustomerSentEvents(customers);
  const duplicates = summarizeSoftoraDuplicateRecipients([...mailboxEvents, ...customerEvents]);

  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].email, 'info@vandenbroekwitgoed.nl');
  assert.equal(duplicates[0].count, 2);
  const report = buildReport({
    events: [...mailboxEvents, ...customerEvents],
    contactEvents: [],
    guards: [],
    missing: [],
    insertedRows: [],
    options: parseArgs([]),
  });
  const risk = report.consolidatedDuplicateRiskEmails.find((item) => item.email === 'info@vandenbroekwitgoed.nl');
  assert.ok(risk);
  assert.deepEqual(risk.riskTypes, ['hard_softora_duplicate']);
  assert.equal(report.summary.consolidatedDuplicateRiskEmails, 1);
});

test('coldmail outbound guard backfill summarizes hard duplicates by domain and company', () => {
  const customers = [
    {
      customer_id: 'import-339-db-mohsau65-o4xbci',
      company: 'Van den Broek Witgoed',
      email: 'info@vandenbroekwitgoed.nl',
      website: 'vandenbroekwitgoed.nl',
      database_status: 'gemaild',
      lifecycle_status: 'gemaild',
      payload: {
        lastColdmailSentAt: '2026-06-08T06:32:23.412Z',
        lastColdmailSenderEmail: 'servecreusen7@gmail.com',
        coldmailSentMessageId: '<message-vdb@gmail.com>',
        coldmailSpecialAction: 'webdesign',
      },
    },
  ];
  const mailboxEvents = buildMailboxSentEvents(
    [
      {
        message_key: 'martijn:sent:vdb-domain',
        account_email: 'martijn@softora.nl',
        folder: 'sent',
        uid: 89,
        message_id: '<historical-vdb-domain@example.test>',
        recipients_text: 'info@vandenbroekwitgoed.nl',
        subject: 'Kleine vraag over jullie website',
        body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
        date: '2026-06-05T13:49:14.000Z',
        payload: {},
      },
    ],
    buildCustomerIndexes(customers)
  );
  const events = [...mailboxEvents, ...buildCustomerSentEvents(customers)];

  const domainDuplicates = summarizeSoftoraDuplicateDomains(events);
  assert.equal(domainDuplicates.length, 1);
  assert.equal(domainDuplicates[0].domain, 'vandenbroekwitgoed-nl');
  assert.equal(domainDuplicates[0].count, 2);
  assert.deepEqual(domainDuplicates[0].sends[0].recipients, ['info@vandenbroekwitgoed.nl']);

  const companyDuplicates = summarizeSoftoraDuplicateCompanies(events);
  assert.equal(companyDuplicates.length, 1);
  assert.equal(companyDuplicates[0].companyKey, 'van-den-broek-witgoed');
  assert.equal(companyDuplicates[0].count, 2);
});

test('coldmail outbound guard backfill reports cross-provider overlaps by domain and company', () => {
  const guards = [
    {
      guard_key: 'email:info@tractorbumper.com',
      provider: 'softora',
      recipient_email: 'info@tractorbumper.com',
      recipient_domain: 'tractorbumper-com',
      recipient_company_key: 'tractor-bumper',
      recipient_company: 'Tractor Bumper',
      status: 'sent',
      source: 'mailbox-sent-webdesign-backfill-2026-06-08',
      permanent: true,
      last_seen_at: '2026-06-04T12:52:18.196Z',
    },
    {
      guard_key: 'domain:tractorbumper-com',
      provider: 'instantly',
      recipient_email: 'info@tractorbumper.com',
      recipient_domain: 'tractorbumper-com',
      recipient_company_key: 'tractor-bumper',
      recipient_company: 'Tractor Bumper',
      status: 'sent',
      source: 'instantly-manual-upload-2026-06-04-codex-safety-guard',
      permanent: true,
      last_seen_at: '2026-06-04T14:24:01.889Z',
    },
    {
      guard_key: 'domain:temporary-only.example',
      provider: 'instantly',
      recipient_email: 'info@temporary-only.example',
      recipient_domain: 'temporary-only.example',
      recipient_company_key: 'Temporary Only',
      recipient_company: 'Temporary Only',
      status: 'reserved',
      source: 'temporary-test',
      permanent: false,
      last_seen_at: '2026-06-04T14:24:01.889Z',
    },
  ];

  const domainOverlaps = summarizeMultiProviderGuardDomains(guards);
  assert.equal(domainOverlaps.length, 1);
  assert.equal(domainOverlaps[0].domain, 'tractorbumper-com');
  assert.deepEqual(domainOverlaps[0].providers, ['instantly', 'softora']);

  const companyOverlaps = summarizeMultiProviderGuardCompanies(guards);
  assert.equal(companyOverlaps.length, 1);
  assert.equal(companyOverlaps[0].companyKey, 'tractor-bumper');
  assert.deepEqual(companyOverlaps[0].emails, ['info@tractorbumper.com']);

  const consolidated = summarizeConsolidatedDuplicateRiskEmails({
    multiProviderGuardRecipients: summarizeMultiProviderGuards(guards),
    multiProviderGuardDomains: domainOverlaps,
    multiProviderGuardCompanies: companyOverlaps,
  });
  assert.equal(consolidated.length, 1);
  assert.equal(consolidated[0].email, 'info@tractorbumper.com');
  assert.deepEqual(consolidated[0].riskTypes, ['cross_provider_overlap']);
});

test('coldmail outbound guard backfill reports repeated webdesign contacts without hard duplicate classification', () => {
  const messages = [
    {
      message_key: 'serve:thread:admin-1',
      account_email: 'serve@softora.nl',
      sender_email: 'martijnven123@gmail.com',
      folder: 'inbox',
      uid: 201,
      message_id: '<admin-1@example.test>',
      recipients_text: 'marco@administratieportaal.nl',
      subject: 'Re: Nieuw webdesign gemaakt voor jullie website!',
      body_text: 'Zoals besproken ontwerpen we een nieuwe website voor jullie administratieportaal.',
      date: '2026-05-08T17:41:37.000Z',
      payload: {},
    },
    {
      message_key: 'serve:thread:admin-2',
      account_email: 'serve@softora.nl',
      sender_email: 'martijnven123@gmail.com',
      folder: 'inbox',
      uid: 202,
      message_id: '<admin-2@example.test>',
      recipients_text: 'marco@administratieportaal.nl',
      subject: 'Re: Nieuw webdesign gemaakt voor jullie website!',
      body_text: 'Bedankt voor het gesprek van vandaag over de nieuwe website.',
      date: '2026-06-03T15:06:19.000Z',
      payload: {},
    },
  ];

  assert.deepEqual(buildMailboxSentEvents(messages, buildCustomerIndexes([])), []);

  const contactEvents = buildMailboxWebdesignContactEvents(messages, buildCustomerIndexes([]));
  const contactDuplicates = summarizeWebdesignContactDuplicateDomains(contactEvents);
  assert.equal(contactDuplicates.length, 1);
  assert.equal(contactDuplicates[0].domain, 'administratieportaal-nl');
  assert.equal(contactDuplicates[0].count, 2);
  assert.equal(contactDuplicates[0].hasReplyOrFollowup, true);
  assert.deepEqual(
    contactEvents[0].keyRows.map((row) => row.guardKey),
    ['email:marco@administratieportaal.nl', 'domain:administratieportaal-nl']
  );

  const missing = findMissingGuardKeys(contactEvents, []);
  assert.deepEqual(
    [...new Set(missing.map((item) => item.guardKey))],
    ['email:marco@administratieportaal.nl', 'domain:administratieportaal-nl']
  );

  const report = buildReport({
    events: [],
    contactEvents,
    guards: [],
    missing,
    insertedRows: [],
    options: parseArgs([]),
  });
  assert.equal(report.ok, false);
  assert.equal(report.summary.missingGuardKeys, 4);
  assert.equal(report.summary.webdesignContactDuplicateDomains, 1);
  assert.equal(report.summary.softoraDuplicateRecipients, 0);
  const contactRisk = report.consolidatedDuplicateRiskEmails.find((item) => item.email === 'marco@administratieportaal.nl');
  assert.ok(contactRisk);
  assert.deepEqual(contactRisk.riskTypes, ['webdesign_contact_repeat']);
  assert.equal(report.summary.consolidatedDuplicateRiskEmails, 1);
});

test('coldmail outbound guard audit keeps legacy dashboard sends visible without adding false duplicates', () => {
  const legacyRows = [
    {
      id: 'import-339-db-mohsau65-o4xbci',
      bedrijf: 'Van den Broek Witgoed',
      email: 'info@vandenbroekwitgoed.nl',
      website: 'vandenbroekwitgoed.nl',
      status: 'gemaild',
      lastColdmailSentAt: '2026-06-08T06:32:23.412Z',
      lastColdmailSenderEmail: 'servecreusen7@gmail.com',
      coldmailSentMessageId: '<message-vdb@gmail.com>',
      coldmailSpecialAction: 'webdesign',
    },
  ];
  const legacyState = {
    payload: {
      values: buildChunkedStatePatch('softora_customers_premium_v1', JSON.stringify(legacyRows), 80),
    },
  };
  const legacyCustomers = buildLegacyCustomerRowsFromUiState(legacyState);
  const legacyEvents = buildCustomerSentEvents(legacyCustomers);
  const mailboxEvents = buildMailboxSentEvents(
    [
      {
        message_key: 'martijn:sent:vdb-legacy',
        account_email: 'martijn@softora.nl',
        folder: 'sent',
        uid: 90,
        recipients_text: 'info@vandenbroekwitgoed.nl',
        subject: 'Kleine vraag over jullie website',
        body_text: 'Vanuit enthousiasme heb ik een fris webdesign gemaakt.',
        date: '2026-06-05T13:49:14.000Z',
        payload: {},
      },
    ],
    buildCustomerIndexes(legacyCustomers)
  );

  assert.equal(legacyEvents.length, 1);
  assert.equal(legacyEvents[0].recipientEmail, 'info@vandenbroekwitgoed.nl');
  const report = buildReport({
    events: mailboxEvents,
    contactEvents: [],
    guards: [],
    missing: [],
    insertedRows: [],
    legacyEvents,
    options: parseArgs([]),
  });

  assert.equal(report.summary.legacyCustomerSentEvents, 1);
  assert.equal(report.summary.legacyCombinedSoftoraDuplicateRecipients, 1);
  assert.equal(report.legacyCombinedSoftoraDuplicateRecipients[0].email, 'info@vandenbroekwitgoed.nl');
  assert.equal(report.consolidatedDuplicateRiskEmails[0].email, 'info@vandenbroekwitgoed.nl');
  assert.deepEqual(report.consolidatedDuplicateRiskEmails[0].riskTypes, ['legacy_softora_duplicate']);
});

test('coldmail outbound guard audit reports mailbox sent-index coverage gaps per sender', () => {
  const coverage = summarizeMailboxCoverage(
    [
      {
        account_email: 'serve@softora.nl',
        folder: 'sent',
        uid: 87,
        date: '2026-06-08T09:30:29.000Z',
      },
    ],
    [
      {
        account_email: 'serve@softora.nl',
        folder: 'sent',
        status: 'ok',
        last_synced_at: '2026-06-08T14:28:13.412Z',
        last_uid: 87,
        message_count: 50,
      },
      {
        account_email: 'servecreusen7@gmail.com',
        folder: 'sent',
        status: 'ok',
        last_synced_at: '2026-06-08T14:30:53.338Z',
        last_uid: 0,
        message_count: 0,
      },
    ]
  );

  const serve = coverage.find((item) => item.accountEmail === 'serve@softora.nl');
  assert.equal(serve.sentIndexedRows, 1);
  assert.ok(serve.warnings.includes('sent_sync_limit_reached'));

  const gmail = coverage.find((item) => item.accountEmail === 'servecreusen7@gmail.com');
  assert.equal(gmail.sentIndexedRows, 0);
  assert.ok(gmail.warnings.includes('sent_index_empty'));

  const report = buildReport({
    events: [],
    contactEvents: [],
    guards: [],
    missing: [],
    insertedRows: [],
    mailboxCoverage: coverage,
    options: parseArgs([]),
  });
  assert.equal(report.summary.mailboxSentIndexEmpty >= 1, true);
  assert.equal(report.summary.mailboxSentSyncLimitReached, 1);
});

test('coldmail outbound guard backfill includes old send guard state as outbound evidence', () => {
  const customers = [
    {
      customer_id: 'old-row',
      company: 'Old Company',
      email: 'old@example.test',
      website: 'old.example.test',
      payload: {},
    },
  ];
  const events = buildSendGuardEvents(
    {
      entries: [
        {
          at: '2026-06-08T07:58:01.374Z',
          senderEmail: 'martijnven123@gmail.com',
          count: 1,
          recipientEmail: 'old@example.test',
          recipientDomain: 'old-example-test',
          recipientCompanyKey: 'old-company',
          recipientId: 'old-row',
          recipientCompany: 'Old Company',
        },
      ],
      recipientEntries: [],
    },
    buildCustomerIndexes(customers)
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'send_guard');
  assert.deepEqual(
    events[0].keyRows.map((row) => row.guardKey),
    [
      'email:old@example.test',
      'domain:old-example-test',
      'company:old-company',
      'id:old-row',
    ]
  );
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
