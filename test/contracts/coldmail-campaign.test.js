const test = require('node:test');
const assert = require('node:assert/strict');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');

function createService(overrides = {}) {
  const sentMessages = [];
  let savedState = null;
  const rows = overrides.rows || [
    {
      id: 'prospect-1',
      bedrijf: 'Bakkerij Zon',
      naam: 'Ruben',
      email: 'ruben@example.test',
      status: 'prospect',
      branche: 'Horeca & Restaurants',
      mail: true,
    },
    {
      id: 'customer-1',
      bedrijf: 'Klant BV',
      email: 'klant@example.test',
      status: 'klant',
      mail: true,
    },
  ];
  const service = createColdmailCampaignService({
    mailConfig: {
      smtpHost: overrides.smtpHost === undefined ? 'smtp.example.test' : overrides.smtpHost,
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'info@softora.nl',
      smtpPass: overrides.smtpPass === undefined ? 'secret' : overrides.smtpPass,
      mailFromAddress: 'info@softora.nl',
      mailFromName: 'Softora',
      mailReplyTo: 'reply@softora.nl',
    },
    getUiStateValues: async () => ({
      values: {
        softora_customers_premium_v1: JSON.stringify(rows),
      },
    }),
    setUiStateValues: async (scope, values, meta) => {
      savedState = { scope, values, meta };
      return { ok: true };
    },
    createTransport: () => ({
      sendMail: async (message) => {
        if (overrides.sendMailError) throw new Error(overrides.sendMailError);
        sentMessages.push(message);
        return { messageId: `msg-${sentMessages.length}`, response: '250 ok' };
      },
    }),
    resolveEmailDomain: async (domain) => {
      if (overrides.invalidDomains && overrides.invalidDomains.includes(domain)) return false;
      return true;
    },
    now: () => new Date('2026-04-24T12:00:00.000Z'),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  return { service, sentMessages, getSavedState: () => savedState };
}

test('coldmail campaign sends only eligible database rows and marks them as mailed', async () => {
  const { service, sentMessages, getSavedState } = createService();

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}},\n\nZou u openstaan voor webdesign?',
    senderEmail: 'info@softora.nl',
    branch: 'Horeca & Restaurants',
    specialAction: 'webdesign',
    actor: 'Servé',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
  assert.equal(sentMessages[0].bcc, 'info@softora.nl');
  assert.equal(sentMessages[0].subject, 'Nieuwe website voor Bakkerij Zon');
  assert.match(sentMessages[0].text, /Goedemorgen Ruben/);
  assert.match(sentMessages[0].html, /<p>Goedemorgen Ruben,<\/p>/);

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].lastColdmailSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailCampaignDurationDays, 14);
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '2026-05-08T12:00:00.000Z');
  assert.equal(savedRows[1].status, 'klant');
});

test('coldmail campaign sends test recipient without marking database row as mailed', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'test-recipient',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'servec321@gmail.com',
        status: 'benaderbaar',
        mail: true,
        hist: [],
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.persisted, 0);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(getSavedState(), null);
});

test('coldmail campaign previews selected recipients before sending', async () => {
  const { service } = createService();

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    branch: 'Horeca & Restaurants',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'prospect-1',
      bedrijf: 'Bakkerij Zon',
      email: 'ruben@example.test',
    },
  ]);
});

test('coldmail campaign previews invalid recipient domains', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'bad-domain',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'info@mcvecommerce.nl',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    invalidDomains: ['mcvecommerce.nl'],
  });

  const result = await service.getColdmailCampaignRecipients({ count: 1 });

  assert.equal(result.selected, 0);
  assert.equal(result.failedItems[0].email, 'info@mcvecommerce.nl');
  assert.match(result.failedItems[0].error, /mcvecommerce\.nl/);
});

test('coldmail campaign exposes the same sender accounts as mailbox', () => {
  const { service } = createService();

  assert.deepEqual(service.getAllowedSenderEmails(), [
    'info@softora.nl',
    'zakelijk@softora.nl',
    'ruben@softora.nl',
    'serve@softora.nl',
    'martijn@softora.nl',
  ]);
});

test('coldmail campaign refuses to send when SMTP is not configured', async () => {
  const { service } = createService({ smtpHost: '' });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Test',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'SMTP_NOT_CONFIGURED');
      assert.deepEqual(error.missing, ['MAIL_SMTP_HOST']);
      return true;
    }
  );
});

test('coldmail campaign refuses unconnected sender addresses', async () => {
  const { service } = createService();

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Test',
        senderEmail: 'sales@softora.nl',
      }),
    /afzenderadres/
  );
});

test('coldmail campaign reports SMTP failure when every selected mail fails', async () => {
  const { service, sentMessages, getSavedState } = createService({
    sendMailError: '535 Authentication failed',
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Test',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'SMTP_SEND_FAILED');
      assert.match(error.message, /535 Authentication failed/);
      assert.equal(error.failedItems.length, 1);
      assert.equal(error.failedItems[0].email, 'ruben@example.test');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedState(), null);
});

test('coldmail campaign skips recipients whose domain does not receive mail', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'bad-domain',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'info@mcvecommerce.nl',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'good-domain',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    invalidDomains: ['mcvecommerce.nl'],
  });

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failedItems[0].email, 'info@mcvecommerce.nl');
  assert.match(result.failedItems[0].error, /mcvecommerce\.nl/);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
  assert.equal(sentMessages[0].bcc, 'info@softora.nl');

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'benaderbaar');
  assert.equal(savedRows[1].status, 'gemaild');
});

test('coldmail campaign refuses to send when all recipient domains are invalid', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'bad-domain',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'info@mcvecommerce.nl',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    invalidDomains: ['mcvecommerce.nl'],
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Test',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'NO_VALID_RECIPIENT_DOMAINS');
      assert.match(error.message, /mcvecommerce\.nl/);
      assert.equal(error.failedItems[0].email, 'info@mcvecommerce.nl');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedState(), null);
});
