const test = require('node:test');
const assert = require('node:assert/strict');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createService(overrides = {}) {
  const sentMessages = [];
  let savedState = null;
  let replyState = overrides.replyState || { processed: {} };
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
      imapHost: overrides.imapHost || '',
      imapPort: 993,
      imapSecure: true,
      imapUser: overrides.imapUser || '',
      imapPass: overrides.imapPass || '',
      imapMailbox: 'INBOX',
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: overrides.photoValues || {
            softora_database_photos_v1: JSON.stringify(overrides.photoMap || {}),
          },
        };
      }
      if (scope === 'premium_coldmail_auto_replies') {
        return {
          values: {
            softora_coldmail_auto_replies_v1: JSON.stringify(replyState),
          },
        };
      }
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify(rows),
        },
      };
    },
    setUiStateValues: async (scope, values, meta) => {
      savedState = { scope, values, meta };
      if (scope === 'premium_coldmail_auto_replies') {
        replyState = JSON.parse(values.softora_coldmail_auto_replies_v1);
      }
      return { ok: true };
    },
    createTransport: () => ({
      sendMail: async (message) => {
        if (overrides.sendMailError) throw new Error(overrides.sendMailError);
        sentMessages.push(message);
        return { messageId: `msg-${sentMessages.length}`, response: '250 ok' };
      },
    }),
    createImapClient: overrides.createImapClient,
    parseMailSource: overrides.parseMailSource,
    getAnthropicApiKey: () => overrides.anthropicApiKey || '',
    fetchJsonWithTimeout: overrides.fetchJsonWithTimeout,
    extractAnthropicTextContent: (content) =>
      Array.isArray(content) ? content.map((item) => item.text || '').join('\n') : String(content || ''),
    anthropicApiBaseUrl: 'https://anthropic.example.test/v1',
    coldmailAutoReplyModel: 'claude-sonnet-4-6',
    resolveEmailDomain: async (domain) => {
      if (overrides.invalidDomains && overrides.invalidDomains.includes(domain)) return false;
      return true;
    },
    now: () => new Date('2026-04-24T12:00:00.000Z'),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  return { service, sentMessages, getSavedState: () => savedState, getReplyState: () => replyState };
}

test('coldmail campaign sends only eligible database rows and marks them as mailed', async () => {
  const { service, sentMessages, getSavedState } = createService();

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}},\n\nZou u openstaan voor webdesign?',
    senderEmail: 'info@softora.nl',
    branch: 'Horeca & Restaurants',
    specialAction: '',
    actor: 'Servé',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
  assert.equal(sentMessages[0].bcc, undefined);
  assert.equal(sentMessages[0].subject, 'Nieuwe website voor Bakkerij Zon');
  assert.match(sentMessages[0].text, /Goedemorgen Ruben/);
  assert.match(sentMessages[0].text, /Referentie: SF-20260424-PROSPECT/);
  assert.match(sentMessages[0].html, /font-family:Arial,sans-serif/);
  assert.match(sentMessages[0].html, /<p>Goedemorgen Ruben,<\/p>/);

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].lastColdmailSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailCampaignDurationDays, 14);
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '2026-05-08T12:00:00.000Z');
  assert.equal(savedRows[1].status, 'klant');
});

test('coldmail campaign attaches webdesign photo inline and as attachment', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Bakkerij Zon webdesign',
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-prospect-1@softora"/);
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-prospect-1@softora');
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[0].contentType, 'image/png');
});

test('coldmail campaign refuses webdesign action when photo is missing', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'prospect-no-photo',
        bedrijf: 'Bakkerij Zonder Foto',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Nieuwe website voor {{bedrijf}}',
        body: 'Goedemorgen {{naam}}',
        senderEmail: 'info@softora.nl',
        specialAction: 'webdesign',
      }),
    (error) => {
      assert.equal(error.code, 'SMTP_SEND_FAILED');
      assert.match(error.message, /Geen webdesign-foto gevonden voor Bakkerij Zonder Foto/);
      assert.equal(error.failedItems[0].email, 'ruben@example.test');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedState(), null);
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

test('coldmail auto-reply answers inbound campaign replies with Sonnet 4.6', async () => {
  const parsedInbound = {
    messageId: '<incoming-1@example.test>',
    subject: 'Re: Nieuw webdesign gemaakt!',
    text: 'Hoi Servé, klinkt interessant. Wat zou dit ongeveer inhouden?',
    from: { value: [{ address: 'servec321@gmail.com', name: 'Servec Test' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
    references: '<sent-1@softora>',
  };
  let requestedModel = '';
  const { service, sentMessages, getReplyState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    anthropicApiKey: 'anthropic-secret',
    rows: [
      {
        id: 'test-recipient',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'servec321@gmail.com',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    createImapClient: () => ({
      usable: true,
      connect: async () => {},
      logout: async () => {},
      getMailboxLock: async () => ({ release: () => {} }),
      search: async () => [1],
      fetch: async function* () {
        yield { uid: 1, source: 'raw-message', flags: new Set() };
      },
      messageFlagsAdd: async () => {},
    }),
    parseMailSource: async () => parsedInbound,
    fetchJsonWithTimeout: async (_url, request) => {
      requestedModel = JSON.parse(request.body).model;
      return {
        response: { ok: true, status: 200 },
        data: {
          model: requestedModel,
          content: [{ type: 'text', text: 'Hoi, leuk dat je reageert. Zullen we kort bellen?' }],
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      };
    },
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

  assert.equal(result.replied, 1);
  assert.equal(requestedModel, 'claude-sonnet-4-6');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(sentMessages[0].subject, 'Re: Nieuw webdesign gemaakt!');
  assert.equal(sentMessages[0].inReplyTo, '<incoming-1@example.test>');
  assert.match(sentMessages[0].text, /Zullen we kort bellen/);
  assert.equal(Object.keys(getReplyState().processed).length, 1);
});

test('coldmail campaign keeps MCV E-commerce reusable even after earlier mailed status', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'mcv-test-company',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'mcv-test@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-04-24T12:00:00.000Z',
        mail: true,
      },
    ],
  });

  const preview = await service.getColdmailCampaignRecipients({ count: 1 });
  assert.equal(preview.selected, 1);
  assert.equal(preview.recipients[0].email, 'mcv-test@example.test');

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.persisted, 0);
  assert.equal(sentMessages[0].to, 'mcv-test@example.test');
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

test('coldmail campaign uses personal sender name for Serve mailbox', async () => {
  const { service, sentMessages } = createService();

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test',
    body: 'Test',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
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
  assert.equal(sentMessages[0].bcc, undefined);

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
