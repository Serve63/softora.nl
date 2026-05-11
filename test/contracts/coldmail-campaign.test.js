const test = require('node:test');
const assert = require('node:assert/strict');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function createService(overrides = {}) {
  const sentMessages = [];
  let savedState = null;
  const savedStates = [];
  let replyState = overrides.replyState || { processed: {} };
  let sendGuardState = overrides.sendGuardState || { entries: [] };
  const rows = overrides.rows || [
    {
      id: 'prospect-1',
      bedrijf: 'Bakkerij Zon',
      naam: 'Ruben',
      email: 'ruben@example.test',
      telefoon: '+31 6 12345678',
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
      coldmailCampaignSendLimit: overrides.coldmailCampaignSendLimit,
      coldmailDailySendLimit: overrides.coldmailDailySendLimit,
      coldmailPackageDailySendLimit: overrides.coldmailPackageDailySendLimit,
      coldmailBlockPersonalMailboxDomains: overrides.coldmailBlockPersonalMailboxDomains,
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: overrides.photoValues || {
            softora_database_photos_v1: JSON.stringify(overrides.photoMap || {}),
          },
        };
      }
      if (scope === 'coldcalling') {
        return {
          values: {
            softora_coldcalling_lead_rows_json: JSON.stringify(overrides.leadRows || []),
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
      if (scope === 'premium_coldmail_send_guard') {
        return {
          values: {
            softora_coldmail_send_guard_v1: JSON.stringify(sendGuardState),
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
      savedStates.push(savedState);
      if (scope === 'premium_coldmail_auto_replies') {
        replyState = JSON.parse(values.softora_coldmail_auto_replies_v1);
      }
      if (scope === 'premium_coldmail_send_guard') {
        sendGuardState = JSON.parse(values.softora_coldmail_send_guard_v1);
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
    getOpenAiApiKey: () => overrides.openAiApiKey || '',
    fetchJsonWithTimeout: overrides.fetchJsonWithTimeout,
    extractOpenAiTextContent: (content) =>
      Array.isArray(content) ? content.map((item) => item.text || '').join('\n') : String(content || ''),
    openAiApiBaseUrl: 'https://api.openai.test/v1',
    coldmailAutoReplyModel: 'gpt-5.5-pro',
    coldmailAutoReplyEnabled: Boolean(overrides.coldmailAutoReplyEnabled),
    resolveEmailDomain: async (domain) => {
      if (overrides.invalidDomains && overrides.invalidDomains.includes(domain)) return false;
      return true;
    },
    now: () => new Date('2026-04-24T12:00:00.000Z'),
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  return {
    service,
    sentMessages,
    getSavedState: () => savedState,
    getSavedStates: () => savedStates,
    getReplyState: () => replyState,
    getSendGuardState: () => sendGuardState,
  };
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
  assert.match(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].text, /Referentie: SF-/);
  assert.match(sentMessages[0].html, /font-family:Arial,sans-serif/);
  assert.match(sentMessages[0].html, /<p>Goedemorgen Ruben,<\/p>/);
  assert.match(sentMessages[0].html, /<!-- Softora referentie SF-20260424-PROSPECT/);
  assert.doesNotMatch(sentMessages[0].html, />Referentie: SF-/);

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].lastColdmailSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailCampaignDurationDays, 14);
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '2026-05-08T12:00:00.000Z');
  assert.equal(savedRows[1].status, 'klant');
});

test('coldmail campaign replaces city variable with the recipient database location', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        stad: 'Dorpsstraat 1, 5061 AA Oisterwijk',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}\n\n📍 {{stad}}',
    senderEmail: 'info@softora.nl',
    specialAction: '',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /📍 Oisterwijk/);
  assert.doesNotMatch(sentMessages[0].text, /\{\{stad\}\}/);
  assert.doesNotMatch(sentMessages[0].text, /Haaren/);
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
  assert.match(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].html, /<p>Geen interesse\? Reageer met/);
  assert.match(
    sentMessages[0].html,
    /font-size:11px;line-height:1\.35;color:#9ca3af;">Geen interesse\? Reageer met &quot;stop&quot; of &quot;afmelden&quot;/
  );
  assert.ok(
    sentMessages[0].html.indexOf('Geen interesse? Reageer met &quot;stop&quot;') >
      sentMessages[0].html.indexOf('<img src="cid:webdesign-prospect-1@softora"')
  );
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-prospect-1@softora');
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[0].contentType, 'image/png');
});

test('coldmail campaign can disable automatic campaign end date', async () => {
  const { service, getSavedState } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        telefoon: '+31 6 12345678',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
    durationDays: 'disabled',
  });

  assert.equal(result.sent, 1);
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].coldmailCampaignDurationDays, 0);
  assert.equal(savedRows[0].coldmailCampaignEndsAt, '');
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '');
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

test('coldmail auto-reply answers inbound campaign replies with GPT-5.5 Pro', async () => {
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
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
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
          choices: [{ message: { content: 'Hoi, leuk dat je reageert. Zullen we kort bellen?' } }],
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      };
    },
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

  assert.equal(result.replied, 1);
  assert.equal(requestedModel, 'gpt-5.5-pro');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(sentMessages[0].subject, 'Re: Nieuw webdesign gemaakt!');
  assert.equal(sentMessages[0].inReplyTo, '<incoming-1@example.test>');
  assert.match(sentMessages[0].text, /Zullen we kort bellen/);
  assert.equal(Object.keys(getReplyState().processed).length, 1);
});

test('coldmail auto-reply marks positive inbound replies as interested in the database', async () => {
  const parsedInbound = {
    messageId: '<incoming-interest@example.test>',
    subject: 'Re: Nieuwe website',
    text: 'Hoi Servé, dit klinkt interessant. Kun je meer informatie sturen?',
    from: { value: [{ address: 'ruben@example.test', name: 'Ruben' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
    references: '<sent-interest@softora>',
  };
  const { service, getSavedStates } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-04-24T12:00:00.000Z',
        mail: true,
        hist: [],
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
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        model: 'gpt-5.5-pro',
        choices: [{ message: { content: 'Hoi, leuk dat je reageert. Ik stuur je wat meer info.' } }],
      },
    }),
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const customerWrite = getSavedStates().find((item) => item.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerWrite.values.softora_customers_premium_v1);

  assert.equal(result.lifecycleUpdated, 1);
  assert.equal(savedRows[0].databaseStatus, 'interesse');
  assert.equal(savedRows[0].status, 'interesse');
  assert.equal(savedRows[0].coldmailReplyIntent, 'interested');
  assert.equal(savedRows[0].lastColdmailReplyMessageKey, 'message:incoming-interest@example.test');
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '');
  assert.equal(savedRows[0].hist[0].type, 'interesse');
});

test('coldmail auto-reply blocks opt-out replies without creating customer lifecycle data', async () => {
  const parsedInbound = {
    messageId: '<incoming-stop@example.test>',
    subject: 'Re: Nieuwe website',
    text: 'Geen interesse, graag afmelden en niet meer mailen.',
    from: { value: [{ address: 'ruben@example.test', name: 'Ruben' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
    references: '<sent-stop@softora>',
  };
  const { service, getSavedStates } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-04-24T12:00:00.000Z',
        mail: true,
        hist: [],
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
    fetchJsonWithTimeout: async () => ({
      response: { ok: true, status: 200 },
      data: {
        model: 'gpt-5.5-pro',
        choices: [{ message: { content: 'Helder, we halen u van de lijst.' } }],
      },
    }),
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const customerWrite = getSavedStates().find((item) => item.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerWrite.values.softora_customers_premium_v1);

  assert.equal(result.lifecycleUpdated, 1);
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailReplyIntent, 'opt_out');
  assert.equal(savedRows[0].hist[0].type, 'geblokkeerd');
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
      phone: '+31 6 12345678',
      distanceKm: null,
    },
  ]);
});

test('coldmail campaign recipient preview respects Oisterwijk radius', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'near-1',
        bedrijf: 'Oisterwijk Winkel',
        email: 'near@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Dorpsstraat 1, Oisterwijk',
        mail: true,
      },
      {
        id: 'far-1',
        bedrijf: 'Breda Winkel',
        email: 'far@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Markt 1, Breda',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    branch: 'Retail & Winkels',
    radiusKm: 20,
  });

  assert.equal(result.ok, true);
  assert.equal(result.radiusKm, 20);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, 'Oisterwijk Winkel');
  assert.equal(result.recipients[0].distanceKm, 0);
});

test('coldcalling recipient preview selects callable phone rows', async () => {
  const { service } = createService({
    rows: [],
    leadRows: [
      {
        id: 'no-phone',
        company: 'MCV E-commerce',
        telefoon: '—',
        status: 'prospect',
      },
      {
        id: 'callable-1',
        company: 'Belbare Lead',
        phone: '+31622223333',
        status: 'gemaild',
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'call');
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'callable-1',
      bedrijf: 'Belbare Lead',
      email: '',
      phone: '+31622223333',
      distanceKm: null,
    },
  ]);
});

test('coldcalling recipient preview skips phone numbers from the blocklist', async () => {
  const { service } = createService({
    rows: [],
    leadRows: [
      {
        id: 'blocked-1',
        company: 'Niet Bellen BV',
        phone: '+31 6 22 22 33 33',
        status: 'prospect',
      },
      {
        id: 'callable-1',
        company: 'Wel Bellen BV',
        phone: '+31 6 44 44 55 55',
        status: 'prospect',
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
    blockedPhones: '06 22 22 33 33',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'call');
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'callable-1',
      bedrijf: 'Wel Bellen BV',
      email: '',
      phone: '+31 6 44 44 55 55',
      distanceKm: null,
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

test('coldmail campaign caps preview volume to STRATO-safe campaign limit', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service } = createService({ rows });

  const result = await service.getColdmailCampaignRecipients({ count: 100 });

  assert.equal(result.selected, 30);
  assert.equal(result.safetyLimits.campaignSendLimit, 30);
});

test('coldmail campaign enforces daily sender guard across campaigns', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getSendGuardState } = createService({
    rows,
    coldmailCampaignSendLimit: 10,
    coldmailDailySendLimit: 2,
  });

  const firstResult = await service.sendColdmailCampaign({
    count: 2,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(firstResult.sent, 2);
  assert.equal(getSendGuardState().entries[0].count, 2);

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Hoi {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_DAILY_LIMIT_REACHED');
      assert.equal(error.quota.senderRemaining, 0);
      return true;
    }
  );
  assert.equal(sentMessages.length, 2);
});

test('coldmail campaign does not mark daily-limit skipped rows as mailed', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact${index + 1}@example.test`,
    status: 'prospect',
    databaseStatus: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getSavedState } = createService({
    rows,
    coldmailCampaignSendLimit: 10,
    coldmailDailySendLimit: 50,
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:00:00.000Z',
          senderEmail: 'info@softora.nl',
          count: 48,
        },
      ],
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 4,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 2);
  assert.equal(result.failed, 2);
  assert.equal(result.persisted, 2);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    ['contact1@example.test', 'contact2@example.test']
  );
  assert.match(result.failedItems[0].error, /Daglimiet/);
  assert.match(result.failedItems[1].error, /Daglimiet/);

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[1].status, 'gemaild');
  assert.equal(savedRows[2].status, 'prospect');
  assert.equal(savedRows[3].status, 'prospect');
});

test('coldmail campaign sends personal mailbox domains by default', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'personal-mailbox',
        bedrijf: 'Eenmanszaak Gmail',
        naam: 'Ruben',
        email: 'ruben@gmail.com',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'business-domain',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 2);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    ['ruben@gmail.com', 'ruben@example.test']
  );
});

test('coldmail campaign can still explicitly skip personal mailbox domains', async () => {
  const { service, sentMessages } = createService({
    coldmailBlockPersonalMailboxDomains: true,
    rows: [
      {
        id: 'personal-mailbox',
        bedrijf: 'Eenmanszaak Gmail',
        naam: 'Ruben',
        email: 'ruben@gmail.com',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'business-domain',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failedItems[0].email, 'ruben@gmail.com');
  assert.match(result.failedItems[0].error, /Persoonlijke mailbox/);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
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
