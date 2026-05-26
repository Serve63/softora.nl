const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const CHUNKED_PNG_DATA_URL = 'data:image/png;base64,TQ==';

function signColdmailOpenTrackingToken(input = {}, secret = 'tracking-secret') {
  const payload = [
    String(input.trackingId || '').trim(),
    String(input.email || '').trim().toLowerCase(),
    String(input.id || input.customerId || '').trim(),
  ].join('\n');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createService(overrides = {}) {
  const sentMessages = [];
  const transportConfigs = [];
  const sleepCalls = [];
  let savedState = null;
  const savedStates = [];
  let replyState = overrides.replyState || { processed: {} };
  let sendGuardState = overrides.sendGuardState || { entries: [] };
  let scheduleQueueState = overrides.scheduleQueueState || { items: [] };
  let rows = overrides.rows || [
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
      smtpUser: overrides.smtpUser === undefined ? 'info@softora.nl' : overrides.smtpUser,
      smtpPass: overrides.smtpPass === undefined ? 'secret' : overrides.smtpPass,
      mailFromAddress:
        overrides.mailFromAddress === undefined ? 'info@softora.nl' : overrides.mailFromAddress,
      mailFromName: 'Softora',
      mailReplyTo: overrides.mailReplyTo === undefined ? 'reply@softora.nl' : overrides.mailReplyTo,
      publicBaseUrl: overrides.publicBaseUrl,
      coldmailUnsubscribeSecret: overrides.coldmailUnsubscribeSecret,
      coldmailTrackingSecret: overrides.coldmailTrackingSecret,
      coldmailAuditBcc: overrides.coldmailAuditBcc,
      coldmailReplySyncEmail: overrides.coldmailReplySyncEmail,
      coldmailReplyForwardEnabled: Boolean(overrides.coldmailReplyForwardEnabled),
      coldmailReplyForwardFrom: overrides.coldmailReplyForwardFrom,
      coldmailReplyForwardTo: overrides.coldmailReplyForwardTo,
      imapHost: overrides.imapHost || '',
      imapPort: 993,
      imapSecure: true,
      imapUser: overrides.imapUser || '',
      imapPass: overrides.imapPass || '',
      imapMailbox: 'INBOX',
      coldmailBounceProcessingEnabled: overrides.coldmailBounceProcessingEnabled,
      coldmailCampaignSendLimit: overrides.coldmailCampaignSendLimit,
      coldmailDailySendLimit: overrides.coldmailDailySendLimit,
      coldmailPackageDailySendLimit: overrides.coldmailPackageDailySendLimit,
      coldmailSendDelayMs: overrides.coldmailSendDelayMs === undefined ? 0 : overrides.coldmailSendDelayMs,
      coldmailSafetyPauseMs: overrides.coldmailSafetyPauseMs || 60_000,
      coldmailPersonalMailboxDailyLimit: overrides.coldmailPersonalMailboxDailyLimit,
      coldmailPersonalMailboxSendDelayMs:
        overrides.coldmailPersonalMailboxSendDelayMs === undefined
          ? 0
          : overrides.coldmailPersonalMailboxSendDelayMs,
      coldmailBlockPersonalMailboxDomains: overrides.coldmailBlockPersonalMailboxDomains,
      coldmailSendWindowStart: overrides.coldmailSendWindowStart,
      coldmailSendWindowEnd: overrides.coldmailSendWindowEnd,
      coldmailSendWindowTimeZone: overrides.coldmailSendWindowTimeZone,
      coldmailHourlyPacingEnabled:
        overrides.coldmailHourlyPacingEnabled === undefined
          ? false
          : overrides.coldmailHourlyPacingEnabled,
      coldmailWeekdaysOnly: overrides.coldmailWeekdaysOnly,
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
      if (scope === 'premium_coldmail_scheduled_queue') {
        return {
          values: {
            softora_coldmail_scheduled_queue_v1: JSON.stringify(scheduleQueueState),
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
      if (scope === 'premium_coldmail_scheduled_queue') {
        scheduleQueueState = JSON.parse(values.softora_coldmail_scheduled_queue_v1);
      }
      if (scope === 'premium_customers_database') {
        rows = JSON.parse(values.softora_customers_premium_v1);
      }
      return { ok: true };
    },
    createTransport: (config) => {
      transportConfigs.push(config);
      return {
        sendMail: async (message) => {
          if (typeof overrides.beforeSendMail === 'function') {
            await overrides.beforeSendMail(message, sentMessages.length);
          }
          if (typeof overrides.sendMailError === 'function') {
            const error = overrides.sendMailError(message, sentMessages.length);
            if (error) throw error;
          } else if (overrides.sendMailError) {
            throw new Error(overrides.sendMailError);
          }
          sentMessages.push(message);
          return { messageId: `msg-${sentMessages.length}`, response: '250 ok' };
        },
      };
    },
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
    now: () => new Date(overrides.now || '2026-04-24T12:00:00.000Z'),
    sleep: async (ms) => {
      sleepCalls.push(ms);
      if (typeof overrides.sleep === 'function') return overrides.sleep(ms);
      return undefined;
    },
    scheduleTask: (fn, delayMs) => {
      if (typeof overrides.scheduleTask === 'function') return overrides.scheduleTask(fn, delayMs);
      return { fn, delayMs };
    },
    clearScheduledTask: () => {},
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  return {
    service,
    sentMessages,
    getTransportConfigs: () => transportConfigs,
    getSavedState: (scope = 'premium_customers_database') =>
      savedStates
        .slice()
        .reverse()
        .find((item) => item.scope === scope) || savedState,
    getSavedStates: () => savedStates,
    getReplyState: () => replyState,
    getSendGuardState: () => sendGuardState,
    getScheduleQueueState: () => scheduleQueueState,
    getSleepCalls: () => sleepCalls,
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
  assert.deepEqual(sentMessages[0].headers, {
    'List-Unsubscribe': '<mailto:reply@softora.nl?subject=Afmelden>',
  });
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

test('coldmail campaign links Martijn LinkedIn CTA in the HTML mail body', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_MARTIJN_SOFTORA_NL_PASS = 'martijn-secret';
  try {
    const { service, sentMessages } = createService();

    const result = await service.sendColdmailCampaign({
      count: 1,
      subject: 'Nieuwe website voor {{bedrijf}}',
      body: [
        'Goedemorgen {{naam}},',
        '',
        'Zou u openstaan voor webdesign?',
        '',
        'Met vriendelijke groet,',
        'Martijn van de Ven',
        '💼 Mijn LinkedIn 👈',
        'Softora.nl',
      ].join('\n'),
      senderEmail: 'martijn@softora.nl',
    });

    assert.equal(result.sent, 1);
    assert.equal(sentMessages[0].from, 'Martijn van de Ven <martijn@softora.nl>');
    assert.match(sentMessages[0].text, /💼 Mijn LinkedIn 👈/);
    assert.match(
      sentMessages[0].html,
      /<a href="https:\/\/www\.linkedin\.com\/in\/martijn-van-de-ven-51a5b61ba\?utm_source=share_via&amp;utm_content=profile&amp;utm_medium=member_ios" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;font-weight:600;">💼 Mijn LinkedIn 👈<\/a>/
    );
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign adds tokenized one-click unsubscribe when public URL is configured', async () => {
  const { service, sentMessages, getSavedState } = createService({
    publicBaseUrl: 'https://softora.nl',
    coldmailUnsubscribeSecret: 'unsubscribe-secret',
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.match(sentMessages[0].headers['List-Unsubscribe'], /^<mailto:reply@softora\.nl\?subject=Afmelden>, <https:\/\/softora\.nl\/api\/coldmailing\/unsubscribe\?/);
  assert.equal(sentMessages[0].headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');

  const oneClickUrl = sentMessages[0].headers['List-Unsubscribe'].match(/<(https:\/\/softora\.nl\/api\/coldmailing\/unsubscribe[^>]+)>/)[1];
  const parsedUrl = new URL(oneClickUrl);
  const unsubscribe = await service.unsubscribeColdmailRecipient({
    email: parsedUrl.searchParams.get('email'),
    token: parsedUrl.searchParams.get('token'),
  });
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);

  assert.equal(unsubscribe.ok, true);
  assert.equal(unsubscribe.updated, 1);
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailReplyIntent, 'unsubscribe');
  assert.equal(savedRows[0].hist[0].source, 'coldmail-unsubscribe');
});

test('coldmail campaign does not add open tracking pixels to new outbound mail', async () => {
  const { service, sentMessages, getSavedState } = createService({
    publicBaseUrl: 'https://softora.nl',
    coldmailTrackingSecret: 'tracking-secret',
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.doesNotMatch(sentMessages[0].html, /https:\/\/softora\.nl\/api\/coldmailing\/open\.gif\?/);
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);

  assert.equal(savedRows[0].coldmailTrackingId, undefined);
  assert.equal(savedRows[0].coldmailOpenTrackingId, undefined);
});

test('coldmail campaign keeps legacy open tracking endpoint available', async () => {
  const trackingId = 'legacy-track-1';
  const email = 'ruben@example.test';
  const id = 'prospect-1';
  const { service, getSavedState } = createService({
    coldmailTrackingSecret: 'tracking-secret',
    rows: [
      {
        id,
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email,
        status: 'gemaild',
        mail: true,
        coldmailTrackingId: trackingId,
        coldmailOpenTrackingId: trackingId,
        coldmailOpened: false,
        coldmailOpenCount: 0,
      },
    ],
  });

  const tracked = await service.recordColdmailOpen({
    id,
    email,
    trackingId,
    token: signColdmailOpenTrackingToken({ id, email, trackingId }),
  });
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);

  assert.equal(tracked.ok, true);
  assert.equal(tracked.tracked, true);
  assert.equal(tracked.openCount, 1);
  assert.equal(savedRows[0].coldmailOpened, true);
  assert.equal(savedRows[0].coldmailFirstOpenedAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailLastOpenedAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailOpenCount, 1);
  assert.equal(savedRows[0].hist[0].source, 'coldmail-open-tracking');
});

test('coldmail open tracking ignores invalid tokens without changing rows', async () => {
  const trackingId = 'legacy-track-1';
  const email = 'ruben@example.test';
  const id = 'prospect-1';
  const { service, getSavedStates } = createService({
    coldmailTrackingSecret: 'tracking-secret',
    rows: [
      {
        id,
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email,
        status: 'gemaild',
        mail: true,
        coldmailTrackingId: trackingId,
        coldmailOpenTrackingId: trackingId,
        coldmailOpened: false,
        coldmailOpenCount: 0,
      },
    ],
  });

  const tracked = await service.recordColdmailOpen({
    id,
    email,
    trackingId,
    token: 'wrong-token',
  });

  assert.equal(tracked.ok, true);
  assert.equal(tracked.tracked, false);
  assert.equal(tracked.reason, 'invalid_token');
  assert.equal(getSavedStates().length, 0);
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

test('coldmail campaign blocks private copies for personal senders', async () => {
  const oldEnv = { ...process.env };
  for (const senderEmail of [
    'serve@softora.nl',
    'martijn@softora.nl',
    'servec321@gmail.com',
  ]) {
    const envKey = senderEmail.replace(/[^a-z0-9]+/gi, '_').toUpperCase();
    process.env[`MAILBOX_${envKey}_PASS`] = 'sender-secret';
    process.env.MAILBOX_GMAIL_COM_SMTP_HOST = 'smtp.gmail.test';
    try {
      const { service, sentMessages } = createService({
        coldmailAuditBcc: 'servec321@gmail.com',
        mailReplyTo: 'servec321@gmail.com',
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
    } finally {
      process.env = oldEnv;
    }
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

test('coldmail campaign attaches webdesign photo inline and as attachment', async () => {
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
  assert.match(sentMessages[0].html, /<table role="presentation" width="100%"/);
  assert.match(sentMessages[0].html, /<td style="[^"]*overflow:visible;"/);
  assert.match(sentMessages[0].html, /width="640" style="display:block;width:100%;max-width:640px;height:auto;max-height:none;/);
  assert.match(sentMessages[0].html, /object-fit:contain;/);
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
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].campaignType, 'webdesign');
  assert.equal(savedRows[0].outreachStatus, 'benaderd');
  assert.equal(savedRows[0].sentFromEmail, 'info@softora.nl');
  assert.equal(savedRows[0].outreachSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailSentMessageId, 'msg-1');
  assert.equal(savedRows[0].actionRequired, false);
});

test('coldmail campaign accepts inline database webdesign photo when photo storage map misses', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-inline-photo',
        bedrijf: 'Inline Design BV',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Inline Design webdesign',
      },
    ],
    photoMap: {},
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
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-prospect-inline-photo@softora"/);
  assert.equal(sentMessages[0].attachments.length, 1);
  assert.equal(sentMessages[0].attachments[0].filename, 'Inline-Design-webdesign.png');
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

  const { service: leadService } = createService({ rows: savedRows });
  const leads = await leadService.listColdmailReplyFollowUps({ limit: 10, campaignType: 'webdesign' });
  assert.equal(leads.total, 1);
  assert.equal(leads.items[0].id, 'prospect-1');
  assert.equal(leads.items[0].campaignType, 'webdesign');
  assert.equal(leads.items[0].mailboxAccount, 'serve@softora.nl');
});

test('webdesign lead page uses AI intent to include positive mailbox replies', async () => {
  const parsedInbound = {
    messageId: '<incoming-webdesign-ai@example.test>',
    subject: 'Re: Nieuwe website',
    text: 'Hoi Martijn, zullen we hier komende week even naar kijken?',
    from: { value: [{ address: 'owner@example.test', name: 'Owner' }] },
    to: { value: [{ address: 'martijn@softora.nl', name: 'Martijn van de Ven' }] },
    cc: { value: [] },
    references: '<sent-webdesign-ai@softora>',
  };
  let aiClassifyRequests = 0;
  const { service, getSavedStates } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'martijn@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    rows: [
      {
        id: 'webdesign-ai-lead',
        bedrijf: 'Studio Groei',
        naam: 'Owner',
        email: 'owner@example.test',
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
      search: async () => [9],
      fetch: async function* () {
        yield { uid: 9, source: 'raw-message', flags: new Set() };
      },
      messageFlagsAdd: async () => {},
    }),
    parseMailSource: async () => parsedInbound,
    fetchJsonWithTimeout: async (_url, request) => {
      const body = JSON.parse(request.body);
      if (/webdesign-outreachmail/.test(body.messages[0].content)) {
        aiClassifyRequests += 1;
        assert.match(body.messages[1].content, /komende week even naar kijken/);
        return {
          response: { ok: true, status: 200 },
          data: {
            choices: [{ message: { content: '{"intent":"interested"}' } }],
          },
        };
      }
      return {
        response: { ok: true, status: 200 },
        data: {
          choices: [{ message: { content: 'Dank je, ik kom hier snel inhoudelijk op terug.' } }],
        },
      };
    },
  });

  const sync = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const customerWrite = getSavedStates().find((item) => item.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerWrite.values.softora_customers_premium_v1);
  const { service: leadService } = createService({ rows: savedRows });
  const leads = await leadService.listColdmailReplyFollowUps({ limit: 10, campaignType: 'webdesign' });

  assert.equal(aiClassifyRequests, 1);
  assert.equal(sync.lifecycleUpdated, 1);
  assert.equal(leads.total, 1);
  assert.equal(leads.items[0].id, 'webdesign-ai-lead');
  assert.equal(leads.items[0].mailboxAccount, 'martijn@softora.nl');
  assert.match(leads.items[0].preview, /komende week/);
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
      assert.equal(error.code, 'NO_WEBDESIGN_PHOTOS');
      assert.match(error.message, /Geen webdesign-foto gevonden voor Bakkerij Zonder Foto/);
      assert.equal(error.failedItems[0].email, 'ruben@example.test');
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
  assert.match(result.failedItems[0].error, /Geen webdesign-foto gevonden voor Zonder Design/);
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
  const oldEnv = { ...process.env };
  process.env.MAILBOX_MARTIJN_SOFTORA_NL_PASS = 'martijn-secret';
  const parsedInbound = {
    messageId: '<incoming-1@example.test>',
    subject: 'Re: Nieuw webdesign gemaakt!',
    text: 'Hoi Martijn, klinkt interessant. Wat zou dit ongeveer inhouden?',
    from: { value: [{ address: 'reply@example.test', name: 'Reply Test' }] },
    to: { value: [{ address: 'martijn@softora.nl', name: 'Martijn van de Ven' }] },
    cc: { value: [] },
    references: '<sent-1@softora>',
  };
  let requestedModel = '';
  let requestedMessages = [];
  const { service, sentMessages, getReplyState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'martijn@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    rows: [
      {
        id: 'test-recipient',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'reply@example.test',
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
      const body = JSON.parse(request.body);
      requestedModel = body.model;
      requestedMessages = body.messages;
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

  try {
    const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

    assert.equal(result.replied, 1);
    assert.equal(requestedModel, 'gpt-5.5-pro');
    assert.match(requestedMessages[0].content, /Je bent Martijn van de Ven van Softora/);
    assert.equal(JSON.parse(requestedMessages[1].content).sender.name, 'Martijn van de Ven');
    assert.equal(JSON.parse(requestedMessages[1].content).sender.email, 'martijn@softora.nl');
    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].from, 'Martijn van de Ven <martijn@softora.nl>');
    assert.equal(sentMessages[0].to, 'reply@example.test');
    assert.equal(sentMessages[0].subject, 'Re: Nieuw webdesign gemaakt!');
    assert.equal(sentMessages[0].inReplyTo, '<incoming-1@example.test>');
    assert.match(sentMessages[0].text, /Zullen we kort bellen/);
    assert.equal(Object.keys(getReplyState().processed).length, 1);
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail reply sync blocks private forward for Serve and Martijn senders', async () => {
  for (const senderEmail of ['serve@softora.nl', 'martijn@softora.nl']) {
    const { service, sentMessages } = createService({
      imapHost: 'imap.example.test',
      imapUser: senderEmail,
      imapPass: 'secret',
      coldmailBounceProcessingEnabled: false,
      coldmailAutoReplyEnabled: false,
      coldmailReplyForwardEnabled: true,
      coldmailReplyForwardFrom: senderEmail,
      coldmailReplyForwardTo: 'servec321@gmail.com',
    });

    const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

    assert.deepEqual(result, {
      ok: true,
      skipped: true,
      reason: 'coldmail_reply_processing_disabled',
    });
    assert.equal(sentMessages.length, 0);
    assert.equal(service.getColdmailSafetyLimits().replyForwardConfigured, false);
  }
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

test('coldmail campaign lists only positive webdesign replies for tracked lead mailboxes', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'webdesign-serve',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        campaignType: 'webdesign',
        outreachStatus: 'reactie_ontvangen',
        replyMailboxAccount: 'serve@softora.nl',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-24T12:00:00.000Z',
        lastColdmailReplyPreview: 'Kun je meer informatie sturen?',
      },
      {
        id: 'webdesign-ruben',
        bedrijf: 'Ruben Inbox BV',
        email: 'ruben-inbox@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        campaignType: 'webdesign',
        outreachStatus: 'reactie_ontvangen',
        replyMailboxAccount: 'ruben@softora.nl',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-24T13:00:00.000Z',
      },
      {
        id: 'webdesign-gmail',
        bedrijf: 'Gmail Lead BV',
        email: 'gmail-lead@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        campaignType: 'webdesign',
        outreachStatus: 'reactie_ontvangen',
        replyMailboxAccount: 'servec321@gmail.com',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-24T11:00:00.000Z',
      },
      {
        id: 'webdesign-unclear',
        bedrijf: 'Twijfel BV',
        email: 'twijfel@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        campaignType: 'webdesign',
        outreachStatus: 'reactie_ontvangen',
        replyMailboxAccount: 'martijn@softora.nl',
        coldmailReplyIntent: 'unclear',
        lastColdmailReplyAt: '2026-04-24T14:00:00.000Z',
      },
      {
        id: 'generic-interest',
        bedrijf: 'Generic BV',
        email: 'generic@example.test',
        status: 'interesse',
        databaseStatus: 'interesse',
        coldmailReplyIntent: 'interested',
        lastColdmailReplyAt: '2026-04-24T15:00:00.000Z',
      },
    ],
  });

  const result = await service.listColdmailReplyFollowUps({ limit: 10, campaignType: 'webdesign' });

  assert.equal(result.ok, true);
  assert.equal(result.total, 2);
  assert.equal(result.items[0].id, 'webdesign-serve');
  assert.equal(result.items[0].campaignType, 'webdesign');
  assert.equal(result.items[0].mailboxAccount, 'serve@softora.nl');
  assert.deepEqual(
    result.items.map((item) => item.mailboxAccount).sort(),
    ['serve@softora.nl', 'servec321@gmail.com']
  );
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

test('coldmail reply sync blocks hard-bounced recipients without auto-replying', async () => {
  const parsedInbound = {
    messageId: '<bounce-hard@example.test>',
    subject: 'Undelivered Mail Returned to Sender',
    text: [
      'This is the mail system at host smtp.rzone.de.',
      'Final-Recipient: rfc822; ruben@example.test',
      'Diagnostic-Code: smtp; 550 5.1.1 User unknown',
    ].join('\n'),
    from: { value: [{ address: 'mailer-daemon@strato.de', name: 'Mail Delivery System' }] },
    to: { value: [{ address: 'info@softora.nl', name: 'Softora' }] },
    cc: { value: [] },
  };
  const { service, sentMessages, getSavedStates, getReplyState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'info@softora.nl',
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
    fetchJsonWithTimeout: async () => {
      throw new Error('OpenAI mag niet worden aangeroepen voor bounces.');
    },
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const customerWrite = getSavedStates().find((item) => item.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerWrite.values.softora_customers_premium_v1);
  const processed = getReplyState().processed['message:bounce-hard@example.test'];

  assert.equal(result.deliveryFailures, 1);
  assert.equal(result.hardBounced, 1);
  assert.equal(result.replied, 0);
  assert.equal(sentMessages.length, 0);
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailReplyIntent, 'hard_bounce');
  assert.equal(savedRows[0].coldmailBounceType, 'hard');
  assert.equal(savedRows[0].hist[0].source, 'coldmail-bounce');
  assert.equal(processed.lifecycleIntent, 'hard_bounce');
  assert.equal(processed.messageId, undefined);
});

test('coldmail reply sync tracks soft bounces without blocking the prospect', async () => {
  const parsedInbound = {
    messageId: '<bounce-soft@example.test>',
    subject: 'Delivery Status Notification',
    text: [
      'Delivery is delayed to these recipients.',
      'Final-Recipient: rfc822; ruben@example.test',
      'Diagnostic-Code: smtp; 452 mailbox full, quota exceeded',
    ].join('\n'),
    from: { value: [{ address: 'mailer-daemon@strato.de', name: 'Mail Delivery System' }] },
    to: { value: [{ address: 'info@softora.nl', name: 'Softora' }] },
    cc: { value: [] },
  };
  const { service, getSavedStates } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'info@softora.nl',
    imapPass: 'secret',
    coldmailAutoReplyEnabled: false,
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
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const customerWrite = getSavedStates().find((item) => item.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerWrite.values.softora_customers_premium_v1);

  assert.equal(result.deliveryFailures, 1);
  assert.equal(result.softBounced, 1);
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].mail, true);
  assert.equal(savedRows[0].doNotMail, undefined);
  assert.equal(savedRows[0].coldmailReplyIntent, 'soft_bounce');
  assert.equal(savedRows[0].coldmailBounceType, 'soft');
});

test('coldmail reply sync safety-pauses on SPF or DMARC delivery failures', async () => {
  const parsedInbound = {
    messageId: '<bounce-auth@example.test>',
    subject: 'Delivery Status Notification',
    text: [
      'A message could not be delivered.',
      'Final-Recipient: rfc822; ruben@example.test',
      'Diagnostic-Code: smtp; Email rejected per DMARC policy. SPF failed for softora.nl',
    ].join('\n'),
    from: { value: [{ address: 'mailer-daemon@strato.de', name: 'Mail Delivery System' }] },
    to: { value: [{ address: 'info@softora.nl', name: 'Softora' }] },
    cc: { value: [] },
  };
  const { service, getSendGuardState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'info@softora.nl',
    imapPass: 'secret',
    coldmailAutoReplyEnabled: false,
    coldmailSafetyPauseMs: 60_000,
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
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });

  assert.equal(result.deliveryFailures, 1);
  assert.equal(result.safetyPausedUntil, '2026-04-24T12:01:00.000Z');
  assert.equal(getSendGuardState().safetyPause.until, '2026-04-24T12:01:00.000Z');
  assert.match(getSendGuardState().safetyPause.reason, /DMARC policy/);
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

test('coldmail campaign normalizes pasted recipient email addresses', async () => {
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
    'servec321@gmail.com',
  ]);
});

test('coldmail campaign replaces legacy impactbox sender identity with softora account', () => {
  const { service } = createService({
    smtpUser: 'zakelijk@theimpactbox.co',
    mailFromAddress: 'zakelijk@theimpactbox.co',
  });
  const allowed = service.getAllowedSenderEmails();

  assert.ok(allowed.includes('zakelijk@softora.nl'));
  assert.ok(!allowed.includes('zakelijk@theimpactbox.co'));
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

  assert.equal(result.selected, 9);
  assert.equal(result.safetyLimits.campaignSendLimit, 9);
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
  const { service, sentMessages, getSavedState, getSendGuardState } = createService({
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

test('coldmail campaign schedules hourly paced sends with sender-specific jitter', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `scheduled-${index + 1}`,
    bedrijf: `Scheduled ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `scheduled${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getScheduleQueueState } = createService({
    rows,
    coldmailHourlyPacingEnabled: true,
  });

  const result = await service.sendColdmailCampaign({
    count: 4,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 0);
  assert.equal(result.scheduled, 4);
  assert.equal(sentMessages.length, 0);
  assert.equal(getScheduleQueueState().items.length, 4);
  assert.equal(result.safetyLimits.hourlyPacingEnabled, true);
  const scheduledDates = getScheduleQueueState().items.map((item) => new Date(item.scheduledAt));
  assert.equal(new Set(scheduledDates.map((date) => date.getUTCHours())).size, 4);
});

test('coldmail campaign keeps hourly paced sends on weekdays', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `weekday-${index + 1}`,
    bedrijf: `Weekday ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `weekday${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, getScheduleQueueState } = createService({
    rows,
    coldmailHourlyPacingEnabled: true,
    now: '2026-04-24T14:30:00.000Z',
  });

  const result = await service.sendColdmailCampaign({
    count: 3,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.scheduled, 3);
  assert.equal(result.safetyLimits.sendWindow.weekdaysOnly, true);
  const scheduledDates = getScheduleQueueState().items.map((item) => new Date(item.scheduledAt));
  assert.ok(scheduledDates.every((date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6));
  assert.equal(scheduledDates[0].toISOString().slice(0, 10), '2026-04-27');
});

test('coldmail campaign dispatches due hourly scheduled item through the normal sender', async () => {
  const { service, sentMessages, getScheduleQueueState } = createService({
    coldmailHourlyPacingEnabled: true,
    scheduleQueueState: {
      items: [
        {
          id: 'due-1',
          createdAt: '2026-04-24T11:00:00.000Z',
          scheduledAt: '2026-04-24T11:59:00.000Z',
          status: 'queued',
          input: {
            count: 1,
            subject: 'Test',
            body: 'Hoi {{naam}}',
            senderEmail: 'info@softora.nl',
            bypassHourlyScheduler: true,
          },
        },
      ],
    },
  });

  const result = await service.dispatchColdmailScheduledQueue('test-dispatch');

  assert.equal(result.processed, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
  assert.equal(getScheduleQueueState().items[0].status, 'sent');
});

test('coldmail campaign rejects overlapping sends before quota can race', async () => {
  let releaseFirstSend = null;
  let firstSendStarted = null;
  const firstSendStartedPromise = new Promise((resolve) => {
    firstSendStarted = resolve;
  });
  const rows = Array.from({ length: 2 }, (_, index) => ({
    id: `parallel-${index + 1}`,
    bedrijf: `Parallel ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `parallel${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getSavedState, getSendGuardState } = createService({
    rows,
    coldmailCampaignSendLimit: 10,
    coldmailDailySendLimit: 10,
    beforeSendMail: async () => {
      if (sentMessages.length > 0) return;
      firstSendStarted();
      await new Promise((resolve) => {
        releaseFirstSend = resolve;
      });
    },
  });

  const firstSend = service.sendColdmailCampaign({
    count: 1,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });
  await firstSendStartedPromise;

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Test',
        body: 'Hoi {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SEND_IN_PROGRESS');
      return true;
    }
  );

  releaseFirstSend();
  const result = await firstSend;

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(getSendGuardState().entries[0].count, 1);
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
    coldmailDailySendLimit: 9,
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:00:00.000Z',
          senderEmail: 'info@softora.nl',
          count: 7,
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

test('coldmail campaign paces sends between selected recipients', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `paced-${index + 1}`,
    bedrijf: `Paced ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `paced${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, getSleepCalls } = createService({
    rows,
    coldmailSendDelayMs: 1234,
  });

  const result = await service.sendColdmailCampaign({
    count: 3,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 3);
  assert.deepEqual(getSleepCalls(), [1234, 1234]);
  assert.equal(result.safetyLimits.sendDelayMs, 1234);
});

test('coldmail campaign pauses safely on Strato-style SMTP warnings', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `safety-${index + 1}`,
    bedrijf: `Safety ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `safety${index + 1}@example.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getSavedState, getSendGuardState } = createService({
    rows,
    coldmailSafetyPauseMs: 60_000,
    sendMailError: (_message, index) => {
      if (index !== 1) return null;
      const error = new Error('Transmit rate limit exceeded, try again later (ACC)');
      error.response = '421 Transmit rate limit exceeded, try again later (ACC)';
      return error;
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 3,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.safetyPaused, true);
  assert.equal(result.dailyQuota.safetyPausedUntil, '2026-04-24T12:01:00.000Z');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'safety1@example.test');
  assert.match(result.failedItems[0].error, /Transmit rate limit exceeded/);
  assert.match(result.failedItems[1].error, /Veiligheidspauze actief/);
  assert.equal(getSendGuardState().safetyPause.until, '2026-04-24T12:01:00.000Z');
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[1].status, 'prospect');
  assert.equal(savedRows[2].status, 'prospect');

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
      assert.equal(error.quota.safetyPause.until, '2026-04-24T12:01:00.000Z');
      return true;
    }
  );
});

test('coldmail campaign skips personal mailbox domains by default', async () => {
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

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.failedItems[0].email, 'ruben@gmail.com');
  assert.match(result.failedItems[0].error, /Persoonlijke mailbox/);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
});

test('coldmail campaign can still explicitly send personal mailbox domains', async () => {
  const { service, sentMessages } = createService({
    coldmailBlockPersonalMailboxDomains: false,
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

test('coldmail campaign caps explicitly enabled personal mailbox domains separately', async () => {
  const { service, sentMessages, getSendGuardState } = createService({
    coldmailBlockPersonalMailboxDomains: false,
    coldmailPersonalMailboxDailyLimit: 1,
    rows: [
      {
        id: 'personal-mailbox-1',
        bedrijf: 'Eenmanszaak Gmail',
        naam: 'Ruben',
        email: 'ruben@gmail.com',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'personal-mailbox-2',
        bedrijf: 'Eenmanszaak Outlook',
        naam: 'Martijn',
        email: 'martijn@outlook.com',
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
  assert.equal(result.failedItems[0].email, 'martijn@outlook.com');
  assert.match(result.failedItems[0].error, /Persoonlijke mailbox-daglimiet/);
  assert.equal(
    getSendGuardState().entries.reduce((sum, entry) => sum + entry.count, 0),
    2
  );
  assert.equal(
    getSendGuardState().entries.reduce((sum, entry) => sum + entry.personalCount, 0),
    1
  );
  assert.equal(result.dailyQuota.personalMailboxRemainingBefore, 1);
});

test('coldmail campaign uses slower pacing for personal mailbox domains', async () => {
  const { service, getSleepCalls } = createService({
    coldmailBlockPersonalMailboxDomains: false,
    coldmailSendDelayMs: 1000,
    coldmailPersonalMailboxSendDelayMs: 3000,
    rows: [
      {
        id: 'business-domain-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'personal-mailbox',
        bedrijf: 'Eenmanszaak Gmail',
        naam: 'Ruben',
        email: 'ruben@gmail.com',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'business-domain-2',
        bedrijf: 'Slagerij Maan',
        naam: 'Martijn',
        email: 'martijn@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 3,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 3);
  assert.deepEqual(getSleepCalls(), [3000, 1000]);
  assert.equal(result.safetyLimits.personalMailboxSendDelayMs, 3000);
});

test('coldmail campaign uses personal sender name for Serve mailbox', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SERVE_SOFTORA_NL_PASS = 'serve-secret';
  const { service, sentMessages } = createService();

  try {
    await service.sendColdmailCampaign({
      count: 1,
      subject: 'Test',
      body: 'Test',
      senderEmail: 'serve@softora.nl',
    });

    assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign requires a safe SMTP account for non-base senders', async () => {
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
      return true;
    }
  );
});

test('coldmail campaign sends selected sender through its own mailbox SMTP credentials', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SERVE_SOFTORA_NL_PASS = 'serve-secret';
  try {
    const { service, sentMessages, getTransportConfigs } = createService();

    await service.sendColdmailCampaign({
      count: 1,
      subject: 'Test',
      body: 'Test',
      senderEmail: 'serve@softora.nl',
    });

    assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
    assert.equal(getTransportConfigs()[0].auth.user, 'serve@softora.nl');
    assert.equal(getTransportConfigs()[0].auth.pass, 'serve-secret');
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign sends Gmail sender through Gmail SMTP domain settings', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SERVEC321_GMAIL_COM_PASS = 'gmail-app-password';
  process.env.MAILBOX_GMAIL_COM_SMTP_HOST = 'smtp.gmail.com';
  process.env.MAILBOX_GMAIL_COM_SMTP_PORT = '465';
  process.env.MAILBOX_GMAIL_COM_SMTP_SECURE = 'true';
  try {
    const { service, sentMessages, getTransportConfigs } = createService();

    await service.sendColdmailCampaign({
      count: 1,
      subject: 'Test',
      body: 'Test',
      senderEmail: 'servec321@gmail.com',
    });

    assert.equal(sentMessages[0].from, 'Servé Creusen <servec321@gmail.com>');
    assert.equal(sentMessages[0].replyTo, 'servec321@gmail.com');
    assert.equal(getTransportConfigs()[0].host, 'smtp.gmail.com');
    assert.equal(getTransportConfigs()[0].port, 465);
    assert.equal(getTransportConfigs()[0].secure, true);
    assert.equal(getTransportConfigs()[0].auth.user, 'servec321@gmail.com');
    assert.equal(getTransportConfigs()[0].auth.pass, 'gmail-app-password');
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign reports configured sender mailboxes separately from allowed senders', () => {
  const oldEnv = { ...process.env };
  [
    'MAILBOX_ZAKELIJK_SOFTORA_NL_PASS',
    'MAILBOX_ZAKELIJK_SOFTORA_NL_SMTP_PASS',
    'MAILBOX_RUBEN_SOFTORA_NL_PASS',
    'MAILBOX_RUBEN_SOFTORA_NL_SMTP_PASS',
    'MAILBOX_MARTIJN_SOFTORA_NL_PASS',
    'MAILBOX_MARTIJN_SOFTORA_NL_SMTP_PASS',
    'MAILBOX_SERVEC321_GMAIL_COM_PASS',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_PASS',
    'MAILBOX_GMAIL_COM_PASS',
    'MAILBOX_GMAIL_COM_SMTP_PASS',
    'MAILBOX_ZAKELIJK_PASS',
    'MAILBOX_ZAKELIJK_SMTP_PASS',
    'MAILBOX_RUBEN_PASS',
    'MAILBOX_RUBEN_SMTP_PASS',
    'MAILBOX_MARTIJN_PASS',
    'MAILBOX_MARTIJN_SMTP_PASS',
    'MAILBOX_SOFTORA_NL_PASS',
    'MAILBOX_SOFTORA_NL_SMTP_PASS',
  ].forEach((key) => {
    delete process.env[key];
  });
  process.env.MAILBOX_SERVE_SOFTORA_NL_PASS = 'serve-secret';
  try {
    const { service } = createService();

    assert.ok(service.getAllowedSenderEmails().includes('martijn@softora.nl'));
    assert.ok(service.getAllowedSenderEmails().includes('servec321@gmail.com'));
    assert.deepEqual(service.getConfiguredSenderEmails().sort(), [
      'info@softora.nl',
      'serve@softora.nl',
    ]);
    assert.deepEqual(service.getColdmailSafetyLimits().configuredSenderEmails.sort(), [
      'info@softora.nl',
      'serve@softora.nl',
    ]);
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign saves sent copies into the selected sender sent folder', async () => {
  const oldEnv = { ...process.env };
  process.env.MAILBOX_SERVE_SOFTORA_NL_PASS = 'serve-secret';
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

  try {
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
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail campaign refuses to send when SMTP is not configured', async () => {
  const oldEnv = { ...process.env };
  [
    'MAILBOX_SERVEC321_GMAIL_COM_PASS',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_PASS',
    'MAILBOX_GMAIL_COM_PASS',
    'MAILBOX_GMAIL_COM_SMTP_PASS',
    'MAILBOX_GMAIL_COM_SMTP_HOST',
  ].forEach((key) => {
    delete process.env[key];
  });
  try {
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
  } finally {
    process.env = oldEnv;
  }
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

test('coldmail campaign skips rows that are already active in Instantly', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'instantly-active',
        bedrijf: 'Instantly Actief BV',
        naam: 'Ruben',
        email: 'active@example.test',
        status: 'prospect',
        mail: true,
        instantlyStatus: 'synced',
        instantlyCampaignId: 'campaign-1',
      },
      {
        id: 'normal-prospect',
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
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'ruben@example.test');
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
