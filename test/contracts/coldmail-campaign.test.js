const test = require('node:test');
const assert = require('node:assert/strict');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');
const {
  buildChunkedStatePatch,
  readChunkedStateValue,
} = require('../../server/services/data-ops-serialization');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const CHUNKED_PNG_DATA_URL = 'data:image/png;base64,TQ==';

function createService(overrides = {}) {
  const sentMessages = [];
  const transportConfigs = [];
  const sleeps = [];
  let savedState = null;
  const savedStates = [];
  let replyState = overrides.replyState || { processed: {} };
  let sendGuardState = overrides.sendGuardState || { entries: [] };
  let autopilotState = overrides.autopilotState || {};
  let coldmailingSettings = overrides.coldmailingSettings || {};
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
    env: overrides.env || {},
    mailConfig: {
      smtpHost: overrides.smtpHost === undefined ? 'smtp.example.test' : overrides.smtpHost,
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: 'info@softora.nl',
      smtpPass: overrides.smtpPass === undefined ? 'secret' : overrides.smtpPass,
      mailFromAddress: 'info@softora.nl',
      mailFromName: 'Softora',
      mailReplyTo: 'reply@softora.nl',
      publicBaseUrl: overrides.publicBaseUrl || 'https://www.softora.nl',
      coldmailUnsubscribeSecret: overrides.coldmailUnsubscribeSecret || 'unsubscribe-secret',
      coldmailAuditBcc: overrides.coldmailAuditBcc,
      imapHost: overrides.imapHost || '',
      imapPort: 993,
      imapSecure: true,
      imapUser: overrides.imapUser || '',
      imapPass: overrides.imapPass || '',
      imapMailbox: 'INBOX',
      coldmailCampaignSendLimit: overrides.coldmailCampaignSendLimit,
      coldmailDailySendLimit: overrides.coldmailDailySendLimit,
      coldmailPackageDailySendLimit: overrides.coldmailPackageDailySendLimit,
      coldmailSendDelayMs: overrides.coldmailSendDelayMs === undefined ? 0 : overrides.coldmailSendDelayMs,
      coldmailSafetyPauseMs: overrides.coldmailSafetyPauseMs,
      coldmailPersonalMailboxDailyLimit: overrides.coldmailPersonalMailboxDailyLimit,
      coldmailPersonalMailboxSendDelayMs:
        overrides.coldmailPersonalMailboxSendDelayMs === undefined
          ? 0
          : overrides.coldmailPersonalMailboxSendDelayMs,
      coldmailBlockPersonalMailboxDomains: overrides.coldmailBlockPersonalMailboxDomains,
      coldmailBounceProcessingEnabled: overrides.coldmailBounceProcessingEnabled,
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
          values: overrides.leadValues || {
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
      if (scope === 'premium_coldmail_autopilot') {
        return {
          values: {
            softora_coldmail_autopilot_v1: JSON.stringify(autopilotState),
          },
        };
      }
      if (scope === 'premium_coldmailing_settings') {
        return {
          values: {
            softora_coldmailing_settings_v1: JSON.stringify(coldmailingSettings),
          },
        };
      }
      return {
        values: overrides.customerValues || {
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
      if (scope === 'premium_coldmail_autopilot') {
        autopilotState = JSON.parse(values.softora_coldmail_autopilot_v1);
      }
      if (scope === 'premium_coldmailing_settings') {
        coldmailingSettings = JSON.parse(values.softora_coldmailing_settings_v1);
      }
      return { ok: true };
    },
    createTransport: (config) => {
      transportConfigs.push(config);
      return {
        sendMail: async (message) => {
          if (overrides.sendMailError) throw new Error(overrides.sendMailError);
          sentMessages.push(message);
          return { messageId: `msg-${sentMessages.length}`, response: '250 ok' };
        },
      };
    },
    mailboxAccountsRaw: overrides.mailboxAccountsRaw || '',
    createImapClient:
      overrides.createImapClient ||
      (() => ({
        usable: false,
        async connect() {
          throw new Error('IMAP disabled in this contract test');
        },
      })),
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
    sleep: async (ms) => {
      sleeps.push(ms);
      if (typeof overrides.sleep === 'function') return overrides.sleep(ms);
      return undefined;
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  return {
    service,
    sentMessages,
    transportConfigs,
    sleeps,
    getSavedState: () => savedState,
    getSavedStates: () => savedStates,
    getReplyState: () => replyState,
    getSendGuardState: () => sendGuardState,
    getAutopilotState: () => autopilotState,
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
  assert.match(
    sentMessages[0].text,
    /Geen webdesign willen ontvangen\? Laat het me weten!: https:\/\/www\.softora\.nl\/afmelden\?t=/
  );
  assert.doesNotMatch(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].text, /Referentie: SF-/);
  assert.match(sentMessages[0].html, /font-family:Arial,sans-serif/);
  assert.match(sentMessages[0].html, /<p>Goedemorgen Ruben,<\/p>/);
  assert.match(
    sentMessages[0].html,
    /<a href="https:\/\/www\.softora\.nl\/afmelden\?t=[^"]+"[^>]*>Geen webdesign willen ontvangen\? Laat het me weten!<\/a>/
  );
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

test('coldmail autopilot stays idle until it is explicitly enabled', async () => {
  const { service, sentMessages, getAutopilotState } = createService();

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'contract-test',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(sentMessages.length, 0);
  assert.equal(getAutopilotState().lastResult.reason, 'disabled');
});

test('coldmail autopilot sends a small safe batch through the existing campaign service', async () => {
  const { service, sentMessages, getAutopilotState, getSendGuardState } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
      {
        id: 'prospect-2',
        bedrijf: 'Kapsalon Luna',
        naam: 'Luna',
        email: 'luna@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
    ],
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'serve@softora.nl': {
          subject: 'Korte vraag voor {{bedrijf}}',
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          aiInstructions: 'Houd het kort.',
          toneStyle: 'Vriendelijk & professioneel',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 2,
        senderEmails: ['serve@softora.nl'],
        branch: 'Horeca & Restaurants',
        service: "Website's",
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 12,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.reason, 'sent');
  assert.equal(result.sent, 2);
  assert.equal(result.senderEmail, 'serve@softora.nl');
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].subject, 'Korte vraag voor Bakkerij Zon');
  assert.equal(sentMessages[1].subject, 'Korte vraag voor Kapsalon Luna');
  assert.equal(getAutopilotState().lastResult.reason, 'sent');
  assert.equal(getAutopilotState().lock, null);
  assert.equal(getSendGuardState().entries.length, 2);
});

test('coldmail autopilot does not treat a full agenda as a mail safety stop', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
    ],
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'serve@softora.nl': {
          subject: 'Korte vraag voor {{bedrijf}}',
          body: 'Goedemorgen {{naam}}',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
    agendaCapacity: { full: true, availableSlots: 0 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'sent');
  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
});

test('coldmail campaign sends Martijn mail with the full sender display name', async () => {
  const { service, sentMessages } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'martijn@softora.nl',
        name: 'Martijn van de Ven',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'martijn-secret',
      },
    ]),
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemiddag {{naam}}',
    senderEmail: 'martijn@softora.nl',
    branch: 'Horeca & Restaurants',
    specialAction: '',
    actor: 'Martijn',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Martijn van de Ven <martijn@softora.nl>');
});

test('coldmail campaign unsubscribe link marks the database row as no interest', async () => {
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        telefoon: '+31 6 12345678',
        status: 'prospect',
        databaseStatus: 'prospect',
        mail: true,
      },
    ],
  });

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  const unsubscribeUrl = sentMessages[0].html.match(/href="([^"]+)"/)[1].replace(/&amp;/g, '&');
  const token = new URL(unsubscribeUrl).searchParams.get('t');
  const preview = await service.getColdmailUnsubscribePreview({ token });

  assert.equal(preview.ok, true);
  assert.equal(preview.email, 'ruben@example.test');
  assert.equal(preview.bedrijf, 'Bakkerij Zon');
  const previewRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.notEqual(previewRows[0].doNotMail, true);
  assert.notEqual(previewRows[0].mail, false);

  const result = await service.unsubscribeColdmailRecipient({ token });

  assert.equal(result.ok, true);
  assert.equal(result.unsubscribed, true);
  assert.equal(result.email, 'ruben@example.test');
  assert.equal(result.status, 'geblokkeerd');
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailReplyIntent, 'opt_out');
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '');
  assert.equal(savedRows[0].coldmailCampaignEndsAt, '');
  assert.equal(savedRows[0].hist[0].label, 'Afgemeld via afmeldlink');
  assert.equal(savedRows[0].hist[0].source, 'coldmail-unsubscribe-link');
});

test('coldmail campaign adds standards-friendly unsubscribe headers', async () => {
  const { service, sentMessages } = createService();

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.match(sentMessages[0].headers['List-Unsubscribe'], /mailto:reply@softora\.nl/);
  assert.match(sentMessages[0].headers['List-Unsubscribe'], /\/api\/coldmailing\/unsubscribe\?token=/);
  assert.equal(sentMessages[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
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

test('coldmail campaign keeps city variable to the place name when a place field contains an address', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        plaats: 'Reitselaan 45 Haaren (NB)',
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
  assert.match(sentMessages[0].text, /📍 Haaren/);
  assert.doesNotMatch(sentMessages[0].text, /Reitselaan/);
  assert.doesNotMatch(sentMessages[0].text, /\(NB\)/);
});

test('coldmail campaign replaces website variable from database website aliases', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        websiteUrl: 'https://www.bakkerijzon.nl/contact/',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{website}}',
    body: 'Ik kwam jullie website {{website}} tegen.',
    senderEmail: 'info@softora.nl',
    specialAction: '',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].subject, 'Nieuwe website voor bakkerijzon.nl');
  assert.match(sentMessages[0].text, /website bakkerijzon\.nl tegen/);
  assert.doesNotMatch(sentMessages[0].text, /\{\{website\}\}/);
});

test('coldmail campaign adds audit bcc when configured', async () => {
  const { service, sentMessages } = createService({
    coldmailAuditBcc: ' prive@example.nl ',
  });

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
  assert.equal(sentMessages[0].bcc, 'prive@example.nl');
  assert.equal(service.getColdmailSafetyLimits().auditBccConfigured, true);
});

test('coldmail campaign blocks private copies for Serve and Martijn senders', async () => {
  for (const senderEmail of ['serve@softora.nl', 'martijn@softora.nl']) {
    const { service, sentMessages } = createService({
      coldmailAuditBcc: 'servec321@gmail.com',
      mailReplyTo: 'servec321@gmail.com',
      mailboxAccountsRaw: JSON.stringify([
        {
          email: senderEmail,
          smtpHost: 'smtp.strato.com',
          smtpUser: senderEmail,
          smtpPass: `${senderEmail.split('@')[0]}-secret`,
        },
      ]),
    });

    await service.sendColdmailCampaign({
      count: 1,
      subject: 'Nieuwe website voor {{bedrijf}}',
      body: 'Goedemorgen {{naam}}',
      senderEmail,
    });

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].to, 'ruben@example.test');
    assert.equal(sentMessages[0].bcc, undefined);
    assert.equal(sentMessages[0].replyTo, senderEmail);
  }
});

test('coldmail campaign ignores invalid audit bcc configuration', async () => {
  const { service, sentMessages } = createService({
    coldmailAuditBcc: 'niet-een-email',
  });

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].bcc, undefined);
  assert.equal(service.getColdmailSafetyLimits().auditBccConfigured, false);
});

test('coldmail campaign attaches webdesign photo and device mockup inline and as attachments', async () => {
  const { service, sentMessages, getSavedState } = createService({
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
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Bakkerij Zon device mockup',
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
  assert.match(sentMessages[0].html, /Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇/);
  assert.match(sentMessages[0].html, /<table role="presentation" width="100%"/);
  assert.match(sentMessages[0].html, /<td style="[^"]*overflow:visible;"/);
  assert.match(
    sentMessages[0].html,
    /margin:24px 0 0 0;"><tr><td style="[^"]*"><img src="cid:webdesign-prospect-1@softora"/
  );
  assert.match(sentMessages[0].html, /width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:none;/);
  assert.match(sentMessages[0].html, /object-fit:contain;/);
  assert.match(
    sentMessages[0].html,
    /margin:0;"><tr><td style="[^"]*"><img src="cid:webdesign-mockup-prospect-1@softora"/
  );
  assert.ok(
    sentMessages[0].html.indexOf('<img src="cid:webdesign-prospect-1@softora"') <
      sentMessages[0].html.indexOf('Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇')
  );
  assert.ok(
    sentMessages[0].html.indexOf('Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇') <
      sentMessages[0].html.indexOf('<img src="cid:webdesign-mockup-prospect-1@softora"')
  );
  assert.doesNotMatch(sentMessages[0].html, /href="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.doesNotMatch(sentMessages[0].html, /target="_blank"[^>]*><img src="cid:webdesign/);
  assert.match(
    sentMessages[0].text,
    /Geen webdesign willen ontvangen\? Laat het me weten!: https:\/\/www\.softora\.nl\/afmelden\?t=/
  );
  assert.doesNotMatch(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].html, /<p>Geen interesse\? Reageer met/);
  assert.match(
    sentMessages[0].html,
    /font-size:11px;line-height:1\.35;color:#9ca3af;"><a href="https:\/\/www\.softora\.nl\/afmelden\?t=[^"]+"[^>]*>Geen webdesign willen ontvangen\? Laat het me weten!<\/a>/
  );
  assert.ok(
    sentMessages[0].html.indexOf('>Geen webdesign willen ontvangen? Laat het me weten!</a>') >
      sentMessages[0].html.indexOf('<img src="cid:webdesign-mockup-prospect-1@softora"')
  );
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-prospect-1@softora');
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[0].contentType, 'image/png');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-prospect-1@softora');
  assert.equal(sentMessages[0].attachments[1].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[1].contentType, 'image/png');
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].campaignType, 'webdesign');
  assert.equal(savedRows[0].outreachStatus, 'benaderd');
  assert.equal(savedRows[0].sentFromEmail, 'info@softora.nl');
  assert.equal(savedRows[0].outreachSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailSentMessageId, 'msg-1');
  assert.equal(savedRows[0].actionRequired, false);
});

test('coldmail campaign keeps the closing signature before webdesign photos', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        stad: 'Haaren',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuw webdesign gemaakt!',
    body: 'Goedemorgen {{naam}}\n\nIk ben benieuwd wat je ervan vindt.\n\nMet vriendelijke groeten:\nServé Creusen\n\n📍 {{stad}}\n\n0629917185',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  const html = sentMessages[0].html;
  const closingIndex = html.indexOf('Met vriendelijke groeten');
  const phoneIndex = html.indexOf('0629917185');
  const imageIndex = html.indexOf('<img src="cid:webdesign-prospect-1@softora"');
  const captionIndex = html.indexOf('Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇');
  const mockupIndex = html.indexOf('<img src="cid:webdesign-mockup-prospect-1@softora"');
  assert.ok(closingIndex > 0);
  assert.ok(phoneIndex > closingIndex);
  assert.ok(imageIndex > phoneIndex);
  assert.ok(captionIndex > imageIndex);
  assert.ok(mockupIndex > captionIndex);
  assert.doesNotMatch(html, /href="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
});

test('webdesign outreach reply is marked action required without auto-interest status', async () => {
  const parsedInbound = {
    messageId: '<incoming-webdesign@example.test>',
    subject: 'Re: Nieuwe website',
    text: 'Hoi Servé, dit klinkt interessant. Kun je meer informatie sturen?',
    from: { value: [{ address: 'ruben@example.test', name: 'Ruben' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
    references: '<sent-webdesign@softora>',
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
        campaignType: 'webdesign',
        outreachStatus: 'benaderd',
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
      search: async () => [7],
      fetch: async function* () {
        yield { uid: 7, source: 'raw-message', flags: new Set() };
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
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].outreachStatus, 'reactie_ontvangen');
  assert.equal(savedRows[0].actionRequired, true);
  assert.equal(savedRows[0].replyMailboxId, 'inbox:7');
  assert.equal(savedRows[0].replyMailboxAccount, 'serve@softora.nl');
  assert.equal(savedRows[0].hist[0].type, 'reactie_ontvangen');
});

test('webdesign outreach status action promotes lead and clears action required', async () => {
  const { service, getSavedState } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        campaignType: 'webdesign',
        outreachStatus: 'reactie_ontvangen',
        actionRequired: true,
        replyMailboxId: 'inbox:7',
        mail: true,
        hist: [],
      },
    ],
  });

  const result = await service.updateWebdesignOutreachStatus({
    mailboxId: 'inbox:7',
    status: 'geen_interesse',
    actor: 'Servé',
  });
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);

  assert.equal(result.ok, true);
  assert.equal(result.status, 'geen_interesse');
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].outreachStatus, 'geen_interesse');
  assert.equal(savedRows[0].actionRequired, false);
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].hist[0].source, 'webdesign-outreach-action');
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

test('coldmail campaign refuses webdesign action when no ready website-design is available', async () => {
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
      assert.equal(error.code, 'NO_WEBDESIGN_PHOTOS');
      assert.match(error.message, /Nog geen website-design klaar voor Bakkerij Zonder Foto/);
      assert.equal(error.failedItems[0].email, 'ruben@example.test');
      assert.match(error.failedItems[0].error, /Nog geen website-design klaar/i);
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedState(), null);
});

test('coldmail campaign preview only lists webdesign recipients with a generated photo', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'without-photo',
        bedrijf: 'Zonder Design',
        email: 'zonder@example.test',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'with-photo',
        bedrijf: 'Met Design',
        email: 'met@example.test',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    photoMap: {
      'with-photo': {
        id: 'with-photo',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Met Design webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    specialAction: 'webdesign',
  });

  assert.equal(result.selected, 1);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.id),
    ['with-photo']
  );
  assert.equal(result.failedItems[0].id, 'without-photo');
  assert.match(result.failedItems[0].error, /Nog geen website-design klaar voor Zonder Design/);
});

test('coldmail campaign does not treat stale row-index photos as ready webdesign', async () => {
  const { service } = createService({
    rows: [
      {
        bedrijf: 'Autobedrijf Den Breejen Almkerk B.V.',
        email: 'info@denbreejen.com',
        telefoon: '+31 18 340 25 21',
        status: 'benaderbaar',
        mail: true,
      },
      {
        bedrijf: 'Slijterij & Tapverzorging Van Sundert v.o.f.',
        email: 'info@slijterijvansundert.nl',
        telefoon: '016 149 13 19',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    photoMap: {
      'legacy-den-breejen': {
        id: 'legacy-den-breejen',
        identityKey:
          'autobedrijf den breejen almkerk b.v.|autobedrijf den breejen almkerk b.v.|+31 18 340 25 21',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Autobedrijf Den Breejen webdesign',
      },
      'row-1': {
        id: 'row-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Oude rijpositie webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    specialAction: 'webdesign',
  });

  assert.equal(result.selected, 1);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.bedrijf),
    ['Autobedrijf Den Breejen Almkerk B.V.']
  );
  assert.equal(result.failedItems.length, 1);
  assert.equal(result.failedItems[0].bedrijf, 'Slijterij & Tapverzorging Van Sundert v.o.f.');
  assert.match(result.failedItems[0].error, /Nog geen website-design klaar/i);
});

test('coldmail campaign send rejects legacy row-index chunks without a stable customer id', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        bedrijf: 'Slijterij & Tapverzorging Van Sundert v.o.f.',
        email: 'info@slijterijvansundert.nl',
        telefoon: '016 149 13 19',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    photoValues: {
      softora_database_photos_v1: '{}',
      'softora_database_photo_data_v1_row-0_0': TINY_PNG_DATA_URL,
    },
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Nieuw webdesign gemaakt',
        body: 'Goedemiddag, ik heb een nieuw webdesign gemaakt.',
        senderEmail: 'info@softora.nl',
        specialAction: 'webdesign',
      }),
    (error) => {
      assert.equal(error.code, 'NO_WEBDESIGN_PHOTOS');
      assert.match(error.message, /Nog geen website-design klaar/i);
      assert.equal(error.failedItems[0].bedrijf, 'Slijterij & Tapverzorging Van Sundert v.o.f.');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign uses chunked webdesign photo when websitePhoto is stale', async () => {
  const photoKey = 'photo-prospect-1';
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
        photoKey,
        chunkCount: 1,
        websitePhoto: TINY_PNG_DATA_URL,
      },
    },
    photoValues: {
      softora_database_photos_v1: JSON.stringify({
        'prospect-1': {
          id: 'prospect-1',
          photoKey,
          chunkCount: 1,
          websitePhoto: TINY_PNG_DATA_URL,
        },
      }),
      [`${photoKey}_0`]: CHUNKED_PNG_DATA_URL,
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
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].content.toString('base64'), 'TQ==');
});

test('coldmail campaign uses recovered webdesign chunks over stale inline photo', async () => {
  const photoKey = 'softora_database_photo_data_v1_prospect-1';
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
    photoValues: {
      softora_database_photos_v1: JSON.stringify({
        'prospect-1': {
          id: 'prospect-1',
          websitePhoto: TINY_PNG_DATA_URL,
          websitePhotoName: 'Oude webdesign mockup',
        },
      }),
      [`${photoKey}_0`]: CHUNKED_PNG_DATA_URL,
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
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].content.toString('base64'), 'TQ==');
});

test('coldmail campaign prefers fresh row mockup data over stale stored photo map data', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'softora-test-mode-recipient',
        bedrijf: 'Softora Testmodus',
        naam: 'Serve',
        email: 'servec321@gmail.com',
        website: 'softora.nl',
        dom: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Nieuw webdesign',
        websiteMockup: CHUNKED_PNG_DATA_URL,
        websiteMockupName: 'Nieuwe mockup achtergrond',
      },
    ],
    photoMap: {
      'softora-test-mode-recipient': {
        id: 'softora-test-mode-recipient',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Oude webdesign versie',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Oude mockup achtergrond',
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    testMode: true,
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].content.toString('base64'), TINY_PNG_DATA_URL.split(',')[1]);
  assert.equal(sentMessages[0].attachments[1].content.toString('base64'), 'TQ==');
  assert.equal(sentMessages[0].attachments[1].filename, 'Nieuwe-mockup-achtergrond.png');
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

test('coldmail campaign test mode sends only the safe test inbox', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    rows: [
      {
        id: 'real-prospect',
        bedrijf: 'Echte Klant BV',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const preview = await service.getColdmailCampaignRecipients({
    count: 10,
    testMode: true,
  });

  assert.equal(preview.testMode, true);
  assert.equal(preview.selected, 1);
  assert.equal(preview.recipients[0].email, 'servec321@gmail.com');
  assert.equal(preview.recipients[0].website, 'softora.nl');

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
    testMode: true,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 1);
  assert.equal(result.persisted, 0);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.match(sentMessages[0].subject, /Softora Testmodus/);
  assert.equal(sentMessages[0].attachments, undefined);
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign test mode infers webdesign assets from the mail content safely', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    rows: [
      {
        id: 'softora-test-mode-recipient',
        bedrijf: 'Softora Testmodus',
        naam: 'Servé',
        email: 'servec321@gmail.com',
        website: 'softora.nl',
        dom: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'real-prospect',
        bedrijf: 'Echte Klant BV',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'softora-test-mode-recipient': {
        id: 'softora-test-mode-recipient',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Softora test webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Softora test device mockup',
      },
    },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
  });

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Nieuw webdesign gemaakt!',
    body:
      'Afgelopen week kwam ik toevallig jullie website {{website}} tegen en vanuit enthousiasme heb ik een nieuw webdesign voor de site gemaakt.',
    senderEmail: 'serve@softora.nl',
    testMode: true,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 1);
  assert.equal(result.persisted, 0);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(sentMessages[0].subject, 'Nieuw webdesign gemaakt!');
  assert.doesNotMatch(sentMessages[0].subject, /\(test \d{8}T\d{6}Z\)/);
  assert.match(sentMessages[0].text, /website softora\.nl tegen/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-softora-test-mode-recipient@softora"/);
  assert.match(sentMessages[0].html, /Zo zal het design er ongeveer uit gaan zien op mobiel, tablet en laptop👇/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-softora-test-mode-recipient@softora"/);
  assert.doesNotMatch(sentMessages[0].html, /border-top\s*:\s*1px\s+dashed/i);
  assert.doesNotMatch(sentMessages[0].html, /detail-mail-section-signature/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-softora-test-mode-recipient@softora');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-softora-test-mode-recipient@softora');
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign test mode can send Softora webdesign attachment safely', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    rows: [
      {
        id: 'softora-test-mode-recipient',
        bedrijf: 'Softora Testmodus',
        naam: 'Servé',
        email: 'servec321@gmail.com',
        website: 'softora.nl',
        dom: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'real-prospect',
        bedrijf: 'Echte Klant BV',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'softora-test-mode-recipient': {
        id: 'softora-test-mode-recipient',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Softora test webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Softora test device mockup',
      },
    },
  });

  const preview = await service.getColdmailCampaignRecipients({
    count: 10,
    testMode: true,
    specialAction: 'webdesign',
  });

  assert.equal(preview.testMode, true);
  assert.equal(preview.selected, 1);
  assert.equal(preview.failedItems.length, 0);
  assert.equal(preview.recipients[0].id, 'softora-test-mode-recipient');
  assert.equal(preview.recipients[0].bedrijf, 'Softora Testmodus');
  assert.equal(preview.recipients[0].email, 'servec321@gmail.com');
  assert.equal(preview.recipients[0].website, 'softora.nl');

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test voor {{website}}',
    body: 'Hoi {{naam}}, dit is de test voor {{website}}.',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    testMode: true,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 1);
  assert.equal(result.persisted, 0);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(sentMessages[0].subject, 'Test voor softora.nl');
  assert.doesNotMatch(sentMessages[0].subject, /\(test \d{8}T\d{6}Z\)/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-softora-test-mode-recipient@softora"/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-softora-test-mode-recipient@softora"/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-softora-test-mode-recipient@softora');
  assert.equal(sentMessages[0].attachments[0].contentType, 'image/png');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-softora-test-mode-recipient@softora');
  assert.equal(sentMessages[0].attachments[1].contentType, 'image/png');
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign keeps the dedicated Softora test row out of normal campaigns', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'softora-test-mode-recipient',
        bedrijf: 'Softora Testmodus',
        naam: 'Servé',
        email: 'servec321@gmail.com',
        website: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'real-prospect',
        bedrijf: 'Echte Klant BV',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({ count: 10 });

  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].id, 'real-prospect');
  assert.equal(result.recipients[0].email, 'ruben@example.test');
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
  let capturedOpenAiHeaders = null;
  const { service, sentMessages, getReplyState } = createService({
    env: {
      OPENAI_ORGANIZATION_ID: 'org_softora',
      OPENAI_PROJECT_ID: 'proj_softora',
    },
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
      capturedOpenAiHeaders = request.headers;
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
  assert.equal(capturedOpenAiHeaders['OpenAI-Organization'], 'org_softora');
  assert.equal(capturedOpenAiHeaders['OpenAI-Project'], 'proj_softora');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.equal(sentMessages[0].subject, 'Re: Nieuw webdesign gemaakt!');
  assert.equal(sentMessages[0].inReplyTo, '<incoming-1@example.test>');
  assert.match(sentMessages[0].text, /Zullen we kort bellen/);
  assert.equal(Object.keys(getReplyState().processed).length, 1);
});

test('coldmail auto-reply uses the mailbox owner identity for Martijn replies', async () => {
  const parsedInbound = {
    messageId: '<incoming-martijn@example.test>',
    subject: 'Re: Nieuwe website',
    text: 'Hoi Martijn, klinkt interessant. Kun je meer sturen?',
    from: { value: [{ address: 'ruben@example.test', name: 'Ruben' }] },
    to: { value: [{ address: 'martijn@softora.nl', name: 'Martijn van de Ven' }] },
    cc: { value: [] },
    references: '<sent-martijn@softora>',
  };
  let requestPayload = null;
  const { service, sentMessages } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'martijn@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    rows: [
      {
        id: 'prospect-martijn',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-04-24T10:00:00.000Z',
        lastColdmailSenderEmail: 'martijn@softora.nl',
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
      requestPayload = JSON.parse(request.body);
      return {
        response: { ok: true, status: 200 },
        data: {
          model: requestPayload.model,
          choices: [{ message: { content: 'Hoi, ik stuur je graag wat meer informatie.' } }],
          usage: { input_tokens: 10, output_tokens: 12 },
        },
      };
    },
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const userPayload = JSON.parse(requestPayload.messages[1].content);

  assert.equal(result.replied, 1);
  assert.match(requestPayload.messages[0].content, /Je bent Martijn van de Ven van Softora/);
  assert.equal(userPayload.sender.name, 'Martijn van de Ven');
  assert.equal(userPayload.sender.email, 'martijn@softora.nl');
  assert.equal(sentMessages[0].from, 'Martijn van de Ven <martijn@softora.nl>');
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

test('coldmail campaign lists interested mail replies without using the leads inbox', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'mail-interest-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        telefoon: '+31 6 12345678',
        branche: 'Horeca & Restaurants',
        plaats: 'Oisterwijk',
        status: 'interesse',
        databaseStatus: 'interesse',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-24T12:00:00.000Z',
        lastColdmailReplySubject: 'Re: Nieuwe website',
        lastColdmailReplyPreview: 'Dit klinkt interessant. Kun je meer informatie sturen?',
        lastColdmailReplyMessageKey: 'message:incoming-interest@example.test',
      },
      {
        id: 'manual-interest',
        bedrijf: 'Handmatig BV',
        email: 'handmatig@example.test',
        status: 'interesse',
        databaseStatus: 'interesse',
      },
      {
        id: 'customer-after-interest',
        bedrijf: 'Klant BV',
        email: 'klant@example.test',
        status: 'klant',
        databaseStatus: 'klant',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-23T12:00:00.000Z',
      },
    ],
  });

  const result = await service.listColdmailReplyFollowUps({ limit: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'mail-interest-1');
  assert.equal(result.items[0].bedrijf, 'Bakkerij Zon');
  assert.equal(result.items[0].status, 'interesse');
  assert.equal(result.items[0].messageKey, 'message:incoming-interest@example.test');
  assert.match(result.items[0].preview, /interessant/);
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

test('coldmail campaign previews recipients from chunked customer database state', async () => {
  const rows = [
    {
      id: 'chunked-prospect',
      bedrijf: 'Chunked Winkel',
      email: 'chunked@example.test',
      status: 'prospect',
      branche: 'Retail & Winkels',
      mail: true,
    },
  ];
  const { service } = createService({
    rows: [],
    customerValues: buildChunkedStatePatch('softora_customers_premium_v1', JSON.stringify(rows), 80),
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    branch: 'Retail & Winkels',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, 'Chunked Winkel');
});

test('coldmail campaign marks mailed rows inside chunked customer database state', async () => {
  const rows = [
    {
      id: 'chunked-prospect',
      bedrijf: 'Chunked Winkel',
      naam: 'Romy',
      email: 'chunked@example.test',
      status: 'prospect',
      databaseStatus: 'prospect',
      branche: 'Retail & Winkels',
      mail: true,
    },
  ];
  const { service, getSavedStates } = createService({
    rows: [],
    customerValues: buildChunkedStatePatch('softora_customers_premium_v1', JSON.stringify(rows), 80),
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
    branch: 'Retail & Winkels',
    actor: 'Servé',
  });

  assert.equal(result.sent, 1);
  const customerSave = getSavedStates().find((state) => state.scope === 'premium_customers_database');
  assert.ok(customerSave);
  const savedRows = JSON.parse(
    readChunkedStateValue(customerSave.values, 'softora_customers_premium_v1')
  );
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].lastColdmailSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].hist[0].type, 'gemaild');
});

test('coldmail campaign normaliseert geplakte e-mailadressen voor ontvangerselectie', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'moon-meis',
        bedrijf: "Moon's & Meis",
        email: 'info@moonsenmeis.nl,',
        status: 'benaderbaar',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({ count: 10 });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, "Moon's & Meis");
  assert.equal(result.recipients[0].email, 'info@moonsenmeis.nl');
});

test('coldmail campaign vult de preview aan wanneer een eerdere kandidaat afvalt', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'bad-domain',
        bedrijf: 'Slechte Domein BV',
        email: 'info@ongeldig.test',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'good-1',
        bedrijf: 'Goede Ontvanger 1',
        email: 'goed1@example.test',
        status: 'benaderbaar',
        mail: true,
      },
      {
        id: 'good-2',
        bedrijf: 'Goede Ontvanger 2',
        email: 'goed2@example.test',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    invalidDomains: ['ongeldig.test'],
  });

  const result = await service.getColdmailCampaignRecipients({ count: 2 });

  assert.equal(result.selected, 2);
  assert.deepEqual(result.recipients.map((recipient) => recipient.email), ['goed1@example.test', 'goed2@example.test']);
  assert.equal(result.failedItems[0].email, 'info@ongeldig.test');
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

test('coldmail campaign radius includes real customer database places near Oisterwijk', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'chaam-1',
        bedrijf: 'Chaam Winkel',
        email: 'chaam@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Dorpsstraat 10, Chaam',
        mail: true,
      },
      {
        id: 'alphen-1',
        bedrijf: 'Alphen Studio',
        email: 'alphen@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Raadhuisstraat 1, Alphen',
        mail: true,
      },
      {
        id: 'roosendaal-1',
        bedrijf: 'Roosendaal Zaak',
        email: 'roosendaal@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Markt 1, Roosendaal',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    branch: 'Retail & Winkels',
    radiusKm: 40,
  });

  assert.equal(result.ok, true);
  assert.equal(result.radiusKm, 40);
  assert.equal(result.selected, 2);
  assert.deepEqual(result.recipients.map((recipient) => recipient.bedrijf), ['Chaam Winkel', 'Alphen Studio']);
  assert.ok(result.recipients.every((recipient) => recipient.distanceKm <= 40));
});

test('coldmail campaign recipient preview accepts nationwide 500km radius', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'far-north-1',
        bedrijf: 'Groningen Studio',
        email: 'groningen@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        lat: 53.2194,
        lng: 6.5665,
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    branch: 'Retail & Winkels',
    radiusKm: 500,
  });

  assert.equal(result.ok, true);
  assert.equal(result.radiusKm, 500);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, 'Groningen Studio');
  assert.ok(result.recipients[0].distanceKm < 500);
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
    service: 'Chatbots',
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

test('coldcalling recipient preview reads chunked lead database state', async () => {
  const rows = [
    {
      id: 'chunked-callable',
      company: 'Chunked Belbedrijf',
      phone: '+31655556666',
      status: 'prospect',
    },
  ];
  const { service } = createService({
    rows: [],
    leadValues: buildChunkedStatePatch('softora_coldcalling_lead_rows_json', JSON.stringify(rows), 80),
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
    service: 'Chatbots',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, 'Chunked Belbedrijf');
});

test('coldcalling recipient preview supplements sparse lead rows from chunked customer database state', async () => {
  const customerRows = [
    {
      id: 'customer-callable',
      bedrijf: 'Klant Prospect',
      telefoon: '+31 6 22 22 33 33',
      databaseStatus: 'benaderbaar',
    },
    {
      id: 'customer-duplicate',
      bedrijf: 'Dubbele Klant',
      telefoon: '+31 6 11 11 11 11',
      databaseStatus: 'benaderbaar',
    },
    {
      id: 'customer-closed',
      bedrijf: 'Gesloten Klant',
      telefoon: '+31 6 44 44 55 55',
      databaseStatus: 'klant',
    },
  ];
  const { service } = createService({
    rows: [],
    leadRows: [
      {
        id: 'manual-callable',
        company: 'Handmatige Lead',
        phone: '+31 6 11 11 11 11',
        status: 'prospect',
      },
    ],
    customerValues: buildChunkedStatePatch(
      'softora_customers_premium_v1',
      JSON.stringify(customerRows),
      80
    ),
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
    service: 'Chatbots',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 2);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.bedrijf),
    ['Handmatige Lead', 'Klant Prospect']
  );
});

test('coldcalling recipient preview accepts premium database telefoonnummer and place fields', async () => {
  const customerRows = [
    {
      id: 'premium-almkerk',
      bedrijf: 'Schutte Groen & Grond',
      telefoonnummer: '06 12 34 56 78',
      plaats: 'Almkerk',
      databaseStatus: 'benaderbaar',
    },
    {
      id: 'premium-no-phone',
      bedrijf: 'Alleen Website BV',
      plaats: 'Almkerk',
      website: 'alleenwebsite.example',
      databaseStatus: 'benaderbaar',
    },
  ];
  const { service } = createService({
    rows: [],
    leadRows: [],
    customerValues: buildChunkedStatePatch(
      'softora_customers_premium_v1',
      JSON.stringify(customerRows),
      80
    ),
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
    radiusKm: 40,
    service: 'Chatbots',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'premium-almkerk',
      bedrijf: 'Schutte Groen & Grond',
      email: '',
      phone: '06 12 34 56 78',
      distanceKm: 26.6,
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
    service: 'Chatbots',
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

test('coldmailing recipient preview skips email addresses from the blocklist', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'blocked-mail-1',
        bedrijf: 'Niet Mailen BV',
        naam: 'Ruben',
        email: 'blocked@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'mailable-1',
        bedrijf: 'Wel Mailen BV',
        naam: 'Servé',
        email: 'allowed@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    blockedEmails: 'BLOCKED@example.test',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'mail');
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'mailable-1',
      bedrijf: 'Wel Mailen BV',
      email: 'allowed@example.test',
      phone: '',
      distanceKm: null,
    },
  ]);
});

test('coldmail preview for websites service does not require a ready website-design', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'moon-meis',
        bedrijf: "Moon's & Meis",
        naam: 'Moon',
        email: 'info@moonsenmeis.nl',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    service: "Website's",
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.equal(result.recipients[0].bedrijf, "Moon's & Meis");
  assert.equal(result.recipients[0].email, 'info@moonsenmeis.nl');
  assert.equal(result.failedItems.length, 0);
});

test('coldmail preview for webdesign action only counts companies with a ready website-design', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'ready-1',
        bedrijf: 'Klaar Design BV',
        naam: 'Servé',
        email: 'klaar@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'missing-1',
        bedrijf: 'Nog Geen Design BV',
        naam: 'Martijn',
        email: 'mist@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'ready-1': {
        id: 'ready-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Klaar Design BV webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    service: "Website's",
    specialAction: 'webdesign',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'ready-1',
      bedrijf: 'Klaar Design BV',
      email: 'klaar@example.test',
      phone: '',
      distanceKm: null,
    },
  ]);
  assert.equal(result.failedItems.length, 1);
  assert.equal(result.failedItems[0].bedrijf, 'Nog Geen Design BV');
  assert.match(result.failedItems[0].error, /Nog geen website-design klaar/i);
});

test('coldmail preview for webdesign action fills from ready row-level website-designs', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'missing-1',
        bedrijf: 'Nog Geen Design BV',
        email: 'mist@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'stored-ready',
        bedrijf: 'Opgeslagen Design BV',
        email: 'stored@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'row-ready',
        bedrijf: 'Rij Design BV',
        email: 'row@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Rij Design BV webdesign',
      },
    ],
    photoMap: {
      'stored-ready': {
        id: 'stored-ready',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Opgeslagen Design BV webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 2,
    service: "Website's",
    specialAction: 'webdesign',
  });

  assert.equal(result.selected, 2);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.id),
    ['stored-ready', 'row-ready']
  );
  assert.equal(result.failedItems[0].id, 'missing-1');
});

test('coldmail preview matches stored webdesigns with normalized company identities', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'fresh-jaghthuijs-id',
        bedrijf: "'t Jaghthuijs",
        naam: "'t Jaghthuijs",
        telefoon: '076 565 69 56',
        email: 'info@jaghthuijs.nl',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'fresh-zon-id',
        bedrijf: 'Bakkerij De Zon',
        telefoon: '+31 13 555 00 00',
        email: 'info@bakkerijdezon.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'old-jaghthuijs-id': {
        id: 'old-jaghthuijs-id',
        identityKey: 't jaghthuijs|t jaghthuijs|0765656956',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: "'t Jaghthuijs webdesign",
      },
      'old-zon-id': {
        id: 'old-zon-id',
        identityKey: 'bakkerij de zon||0135550000',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Bakkerij De Zon webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 2,
    service: "Website's",
    specialAction: 'webdesign',
  });

  assert.equal(result.selected, 2);
  assert.deepEqual(
    result.recipients.map((recipient) => recipient.id),
    ['fresh-jaghthuijs-id', 'fresh-zon-id']
  );
  assert.equal(result.failedItems.length, 0);
});

test('coldmail webdesign action herkent opgeslagen website-design chunks zonder expliciete chunkCount', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'chunked-ready-1',
        bedrijf: 'Chunked Design BV',
        naam: 'Servé',
        email: 'chunked@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoValues: {
      softora_database_photos_v1: JSON.stringify({
        'chunked-ready-1': {
          id: 'chunked-ready-1',
          photoKey: 'softora_photo_chunked_ready_1',
          websitePhotoName: 'Chunked Design BV webdesign',
        },
      }),
      softora_photo_chunked_ready_1_0: TINY_PNG_DATA_URL,
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    service: "Website's",
    specialAction: 'webdesign',
  });

  assert.equal(result.ok, true);
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'chunked-ready-1',
      bedrijf: 'Chunked Design BV',
      email: 'chunked@example.test',
      phone: '',
      distanceKm: null,
    },
  ]);
  assert.equal(result.failedItems.length, 0);
});

test('coldcalling preview for webdesign action only includes leads with a ready website-design match', async () => {
  const customerRows = [
    {
      id: 'ready-customer',
      bedrijf: 'Klaar Belbedrijf',
      telefoon: '+31 6 11 11 22 22',
      databaseStatus: 'benaderbaar',
    },
    {
      id: 'missing-customer',
      bedrijf: 'Zonder Design Belbedrijf',
      telefoon: '+31 6 33 33 44 44',
      databaseStatus: 'benaderbaar',
    },
  ];
  const { service } = createService({
    rows: [],
    customerValues: buildChunkedStatePatch(
      'softora_customers_premium_v1',
      JSON.stringify(customerRows),
      80
    ),
    leadRows: [
      {
        id: 'lead-ready',
        company: 'Klaar Belbedrijf',
        phone: '+31 6 11 11 22 22',
        status: 'prospect',
      },
      {
        id: 'lead-missing',
        company: 'Zonder Design Belbedrijf',
        phone: '+31 6 33 33 44 44',
        status: 'prospect',
      },
    ],
    photoMap: {
      'ready-customer': {
        id: 'ready-customer',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Klaar Belbedrijf webdesign',
      },
    },
  });

  const result = await service.getColdmailCampaignRecipients({
    count: 10,
    mode: 'call',
    service: "Website's",
    specialAction: 'webdesign',
  });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'call');
  assert.equal(result.selected, 1);
  assert.deepEqual(result.recipients, [
    {
      id: 'lead-ready',
      bedrijf: 'Klaar Belbedrijf',
      email: '',
      phone: '+31 6 11 11 22 22',
      distanceKm: null,
    },
  ]);
  assert.equal(result.failedItems.length, 1);
  assert.equal(result.failedItems[0].bedrijf, 'Zonder Design Belbedrijf');
  assert.match(result.failedItems[0].error, /Nog geen website-design klaar/i);
});

test('coldmail campaign never sends to blocked email addresses', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'blocked-mail-1',
        bedrijf: 'Niet Mailen BV',
        naam: 'Ruben',
        email: 'blocked@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'mailable-1',
        bedrijf: 'Wel Mailen BV',
        naam: 'Servé',
        email: 'allowed@example.test',
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
    emailBlocklist: 'blocked@example.test',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    ['allowed@example.test']
  );
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
  assert.equal(
    getSendGuardState().entries.reduce((sum, entry) => sum + entry.count, 0),
    2
  );

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

test('coldmail campaign caps personal mailbox domains separately from business domains', async () => {
  const { service, sentMessages } = createService({
    coldmailPersonalMailboxDailyLimit: 1,
    rows: [
      {
        id: 'personal-mailbox-1',
        bedrijf: 'Gmail 1',
        naam: 'Ruben',
        email: 'ruben@gmail.com',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'personal-mailbox-2',
        bedrijf: 'Outlook 1',
        naam: 'Martijn',
        email: 'martijn@hotmail.com',
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
  assert.equal(result.failed, 1);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    ['ruben@gmail.com', 'ruben@example.test']
  );
  assert.match(result.failedItems[0].error, /Persoonlijke mailbox-daglimiet/);
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
  const { service, sentMessages } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
  });

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test',
    body: 'Test',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
});

test('coldmail campaign refuses selected senders without their own SMTP password', async () => {
  const { service } = createService();

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Test',
        senderEmail: 'serve@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'SENDER_SMTP_NOT_CONFIGURED');
      assert.match(error.message, /serve@softora\.nl/);
      assert.ok(error.missing.includes('MAILBOX_SERVE_SOFTORA_NL_PASS'));
      return true;
    }
  );
});

test('coldmail campaign sends through the selected mailbox smtp account when configured', async () => {
  const { service, sentMessages, transportConfigs } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
  });

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Test',
    body: 'Test',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].replyTo, 'serve@softora.nl');
  assert.equal(transportConfigs[0].host, 'smtp.strato.com');
  assert.equal(transportConfigs[0].port, 465);
  assert.equal(transportConfigs[0].secure, true);
  assert.deepEqual(transportConfigs[0].auth, {
    user: 'serve@softora.nl',
    pass: 'serve-secret',
  });
});

test('coldmail campaign saves sent copies into the selected sender sent folder', async () => {
  const appendedMessages = [];
  const client = {
    usable: true,
    async connect() {},
    async list() {
      return [{ path: 'INBOX' }, { path: 'INBOX/Verstuurd' }];
    },
    async append(mailboxName, raw, flags) {
      appendedMessages.push({ mailboxName, raw, flags });
      return { path: mailboxName };
    },
    async logout() {
      this.usable = false;
    },
  };
  const { service } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    createImapClient: () => client,
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.sentItems[0].sentCopySaved, true);
  assert.equal(appendedMessages.length, 1);
  assert.equal(appendedMessages[0].mailboxName, 'INBOX/Verstuurd');
  assert.match(String(appendedMessages[0].raw), /Subject: Nieuwe website voor Bakkerij Zon/);
});

test('coldmail campaign saves sent copies with the selected mailbox account imap settings', async () => {
  const appendedMessages = [];
  const imapConfigs = [];
  const client = {
    usable: true,
    async connect() {},
    async list() {
      return [{ path: 'INBOX' }, { path: 'INBOX/Verzonden', specialUse: '\\Sent' }];
    },
    async append(mailboxName, raw, flags) {
      appendedMessages.push({ mailboxName, raw, flags });
      return { path: mailboxName };
    },
    async logout() {
      this.usable = false;
    },
  };
  const { service } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-smtp-secret',
        imapHost: 'imap.strato.com',
        imapPort: 993,
        imapSecure: true,
        imapUser: 'serve@softora.nl',
        imapPass: 'serve-imap-secret',
      },
    ]),
    createImapClient: (config) => {
      imapConfigs.push(config);
      return client;
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.sentItems[0].sentCopySaved, true);
  assert.equal(imapConfigs[0].host, 'imap.strato.com');
  assert.equal(imapConfigs[0].auth.user, 'serve@softora.nl');
  assert.equal(imapConfigs[0].auth.pass, 'serve-imap-secret');
  assert.equal(appendedMessages.length, 1);
  assert.equal(appendedMessages[0].mailboxName, 'INBOX/Verzonden');
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

test('coldmail campaign records a safety pause when the provider rate-limits sending', async () => {
  const { service, getSendGuardState } = createService({
    sendMailError: 'too many recipients, transmit rate limit',
    coldmailSafetyPauseMs: 60_000,
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Hoi {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SAFETY_PAUSED');
      assert.match(error.message, /Geen mails verzonden/);
      return true;
    }
  );

  assert.equal(getSendGuardState().entries[0].count, 0);
  assert.match(getSendGuardState().entries[0].safetyPauseReason, /too many recipients/);

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Hoi {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SAFETY_PAUSED');
      return true;
    }
  );
});

test('coldmail reply sync safety-pauses on generic Strato provider warnings', async () => {
  const parsedInbound = {
    messageId: '<strato-warning@example.test>',
    subject: 'STRATO waarschuwing: mailverzending tijdelijk geblokkeerd',
    text:
      'Uw mailbox is blocked because we detected suspected phishing. ' +
      'De mailversand is gesperrt en SPF failed controles zijn gezien.',
    from: { value: [{ address: 'no-reply@strato.nl', name: 'STRATO Mailserver' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
  };
  const markedSeen = [];
  const { service, sentMessages, getReplyState, getSendGuardState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    coldmailSafetyPauseMs: 60_000,
    createImapClient: () => ({
      usable: true,
      connect: async () => {},
      logout: async () => {},
      getMailboxLock: async () => ({ release: () => {} }),
      search: async () => [12],
      fetch: async function* () {
        yield { uid: 12, source: 'raw-provider-warning', flags: new Set() };
      },
      messageFlagsAdd: async (uids) => {
        markedSeen.push(...uids);
      },
    }),
    parseMailSource: async () => parsedInbound,
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

  assert.equal(result.providerWarnings, 1);
  assert.equal(result.safetyPausedUntil, '2026-04-24T12:01:00.000Z');
  assert.equal(result.matched, 0);
  assert.equal(result.ignored, 0);
  assert.deepEqual(markedSeen, [12]);
  assert.equal(sentMessages.length, 0);
  assert.equal(getSendGuardState().entries[0].senderEmail, 'serve@softora.nl');
  assert.equal(getSendGuardState().entries[0].safetyPauseUntil, '2026-04-24T12:01:00.000Z');
  assert.match(getSendGuardState().entries[0].safetyPauseReason, /suspected phishing/i);
  const processed = getReplyState().processed['message:strato-warning@example.test'];
  assert.equal(processed.lifecycleIntent, 'provider_warning');
  assert.equal(processed.safetyPauseUntil, '2026-04-24T12:01:00.000Z');
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
