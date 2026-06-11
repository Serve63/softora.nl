const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { simpleParser } = require('mailparser');
const sharp = require('sharp');

const { createColdmailCampaignService } = require('../../server/services/coldmail-campaign');
const {
  clearPreviewImageCache,
} = require('../../server/services/coldmail-preview-image-cache');
const {
  buildChunkedStatePatch,
  readChunkedStateValue,
} = require('../../server/services/data-ops-serialization');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const CHUNKED_PNG_DATA_URL = 'data:image/png;base64,TQ==';

async function createFramedWebdesignDataUrl() {
  const inner = await sharp({
    create: {
      width: 336,
      height: 252,
      channels: 4,
      background: '#ffffff',
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="336" height="252" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="336" height="252" fill="#ffffff"/>
            <rect x="24" y="20" width="92" height="14" fill="#008a78"/>
            <rect x="24" y="54" width="170" height="32" fill="#172554"/>
            <rect x="24" y="108" width="288" height="42" fill="#eef7f4"/>
            <rect x="24" y="174" width="288" height="46" fill="#f7fafc"/>
          </svg>`
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const framed = await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 4,
      background: '#eef3fb',
    },
  })
    .composite([{ input: inner, left: 32, top: 24 }])
    .png()
    .toBuffer();
  return `data:image/png;base64,${framed.toString('base64')}`;
}

async function createTestWebdesignDataUrl(width, height) {
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#f8fafc"/>
    <rect x="0" y="0" width="180" height="180" fill="#102a43"/>
    <rect x="${width - 180}" y="0" width="180" height="180" fill="#f97316"/>
    <rect x="0" y="${height - 180}" width="180" height="180" fill="#0ea5e9"/>
    <rect x="${width - 180}" y="${height - 180}" width="180" height="180" fill="#1e3a8a"/>
    <rect x="${Math.round(width * 0.08)}" y="${Math.round(height * 0.06)}" width="${Math.round(width * 0.84)}" height="${Math.round(height * 0.16)}" rx="34" fill="#ffffff"/>
    <rect x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.1)}" width="${Math.round(width * 0.3)}" height="62" rx="12" fill="#1d4ed8"/>
    <rect x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.3)}" width="${Math.round(width * 0.78)}" height="${Math.round(height * 0.18)}" rx="32" fill="#dbeafe"/>
    <rect x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.54)}" width="${Math.round(width * 0.34)}" height="${Math.round(height * 0.12)}" rx="28" fill="#ffffff"/>
    <rect x="${Math.round(width * 0.55)}" y="${Math.round(height * 0.54)}" width="${Math.round(width * 0.34)}" height="${Math.round(height * 0.12)}" rx="28" fill="#ffffff"/>
    <rect x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.75)}" width="${Math.round(width * 0.78)}" height="${Math.round(height * 0.13)}" rx="30" fill="#0f172a"/>
  </svg>`;
  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function withCheckedMockupMeta(item) {
  if (!item || typeof item !== 'object' || !item.websiteMockup) return item;
  const hasQualitySignal = Boolean(
    item.mockupRenderer ||
      item.websiteMockupRenderer ||
      item.mockupOrientation ||
      item.websiteMockupOrientation ||
      item.mockupQualityStatus ||
      item.websiteMockupQualityStatus ||
      item.mockupQualityCheckedAt ||
      item.websiteMockupQualityCheckedAt
  );
  if (hasQualitySignal) return item;
  return {
    ...item,
    mockupRenderer: 'softora-test-device-v8',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-04-24T12:00:00.000Z',
  };
}

function withCheckedPhotoMapMeta(photoMap) {
  return Object.fromEntries(
    Object.entries(photoMap || {}).map(([key, value]) => [key, withCheckedMockupMeta(value)])
  );
}

function encodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64UrlJson(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function extractPreviewImageTokens(html) {
  const matches = [...String(html || '').matchAll(/\/coldmailing\/webdesign-foto\?t=([^"&\s]+)/g)];
  return matches.map((match) => decodeURIComponent(match[1]));
}

function buildColdmailOpenTrackingToken(input = {}, secret = 'tracking-secret') {
  const encodedPayload = encodeBase64Url(JSON.stringify({
    v: 1,
    id: String(input.id || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    ref: String(input.reference || '').trim(),
    tid: String(input.trackingId || '').trim(),
    ts: String(input.ts || '2026-04-24T12:00:00.000Z').trim(),
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${encodedPayload}.${signature}`;
}

function buildColdmailPreviewImageToken(input = {}, secret = 'unsubscribe-secret') {
  const encodedPayload = encodeBase64Url(JSON.stringify({
    v: 1,
    id: String(input.id || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    ref: String(input.reference || '').trim(),
    type: String(input.type || 'webdesign').trim().toLowerCase() === 'mockup' ? 'mockup' : 'webdesign',
    ts: String(input.ts || '2026-04-24T12:00:00.000Z').trim(),
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${encodedPayload}.${signature}`;
}

function buildColdmailPreviewImageV2Token(input = {}, secret = 'softora-coldmail-preview-image-v2') {
  const encodedPayload = encodeBase64Url(JSON.stringify({
    v: 2,
    id: String(input.id || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    ref: String(input.reference || '').trim(),
    pv: 2,
    scope: 'preview-image',
    type: String(input.type || 'webdesign').trim().toLowerCase() === 'mockup' ? 'mockup' : 'webdesign',
    ts: String(input.ts || '2026-04-24T12:00:00.000Z').trim(),
  }));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${encodedPayload}.${signature}`;
}

function createService(overrides = {}) {
  const sentMessages = [];
  const transportConfigs = [];
  const sleeps = [];
  let savedState = null;
  const savedStates = [];
  let replyState = overrides.replyState || { processed: {} };
  let sendGuardState = overrides.sendGuardState || { entries: [] };
  const sendGuardReadStates = Array.isArray(overrides.sendGuardReadStates)
    ? overrides.sendGuardReadStates.map((state) => JSON.parse(JSON.stringify(state)))
    : null;
  let autopilotState = overrides.autopilotState || {};
  const autopilotReadStates = Array.isArray(overrides.autopilotReadStates)
    ? overrides.autopilotReadStates.map((state) =>
      state === null ? null : JSON.parse(JSON.stringify(state))
    )
    : null;
  let coldmailingSettings = overrides.coldmailingSettings || {};
  let rows = (overrides.rows || [
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
  ]).map(withCheckedMockupMeta);
  const outboundGuardCalls = [];
  const defaultOutboundRecipientGuardStore = {
    findRecipientConflict: async () => null,
    reserveRecipients: async (items, options) => {
      outboundGuardCalls.push({ type: 'reserve', items, options });
      return {
        ok: true,
        reservationId: `coldmail-reservation-${outboundGuardCalls.length}`,
        count: (Array.isArray(items) ? items.length : 0) * 4,
        expectedCount: (Array.isArray(items) ? items.length : 0) * 4,
      };
    },
    confirmReservation: async (reservationId, options) => {
      outboundGuardCalls.push({ type: 'confirm', reservationId, options });
      return { ok: true, count: 4 };
    },
  };
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
      coldmailTrackingSecret: overrides.coldmailTrackingSecret || 'tracking-secret',
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
    outboundRecipientGuardStore:
      overrides.outboundRecipientGuardStore === undefined
        ? defaultOutboundRecipientGuardStore
        : overrides.outboundRecipientGuardStore,
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: overrides.photoValues || {
            softora_database_photos_v1: JSON.stringify(withCheckedPhotoMapMeta(overrides.photoMap || {})),
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
        if (sendGuardReadStates && sendGuardReadStates.length) {
          return {
            values: {
              softora_coldmail_send_guard_v1: JSON.stringify(sendGuardReadStates.shift()),
            },
          };
        }
        return {
          values: {
            softora_coldmail_send_guard_v1: JSON.stringify(sendGuardState),
          },
        };
      }
      if (scope === 'premium_coldmail_autopilot') {
        if (autopilotReadStates && autopilotReadStates.length) {
          const nextState = autopilotReadStates.shift();
          if (nextState === null) return null;
          return {
            values: {
              softora_coldmail_autopilot_v1: JSON.stringify(nextState),
            },
          };
        }
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
      if (typeof overrides.onSetUiStateValues === 'function') {
        await overrides.onSetUiStateValues({ scope, values, meta, savedStates });
      }
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
      if (scope === 'premium_customers_database') {
        const rawRows = readChunkedStateValue(values, 'softora_customers_premium_v1');
        rows = JSON.parse(rawRows || '[]');
      }
      return { ok: true };
    },
    createTransport: (config) => {
      transportConfigs.push(config);
      return {
        sendMail: async (message) => {
          if (overrides.sendMailError) throw new Error(overrides.sendMailError);
          sentMessages.push(message);
          if (typeof overrides.onSendMail === 'function') {
            await overrides.onSendMail({
              message,
              sentMessages,
              getAutopilotState: () => autopilotState,
              setAutopilotState: (nextState) => {
                autopilotState = nextState;
              },
              getSendGuardState: () => sendGuardState,
              setSendGuardState: (nextState) => {
                sendGuardState = nextState;
              },
            });
          }
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
    now: overrides.now || (() => new Date('2026-04-24T12:00:00.000Z')),
    loadPreviewImageSharp: overrides.loadPreviewImageSharp,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (typeof overrides.sleep === 'function') return overrides.sleep(ms);
      return undefined;
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    webdesignPreparationCoordinator: overrides.webdesignPreparationCoordinator,
  });

  return {
    service,
    sentMessages,
    outboundGuardCalls,
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
  assert.doesNotMatch(sentMessages[0].text, /Geen webdesign willen ontvangen\? Laat het me weten!/);
  assert.doesNotMatch(sentMessages[0].text, /https:\/\/www\.softora\.nl\/afmelden\?t=/);
  assert.doesNotMatch(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].text, /Referentie: SF-/);
  assert.match(sentMessages[0].html, /font-family:Arial,sans-serif/);
  assert.match(sentMessages[0].html, /<p>Goedemorgen Ruben,<\/p>/);
  assert.doesNotMatch(sentMessages[0].html, /https:\/\/www\.softora\.nl\/api\/coldmailing\/open\.gif\?/);
  assert.doesNotMatch(sentMessages[0].html, /https:\/\/www\.softora\.nl\/afmelden\?t=/);
  assert.doesNotMatch(sentMessages[0].html, />Geen webdesign willen ontvangen\? Laat het me weten!<\/a>/);
  assert.match(sentMessages[0].html, /<!-- Softora referentie SF-20260424-PROSPECT/);
  assert.doesNotMatch(sentMessages[0].html, />Referentie: SF-/);

  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'gemaild');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].lastColdmailSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailCampaignDurationDays, 14);
  assert.equal(savedRows[0].activeColdmailCampaignUntil, '2026-05-08T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailTrackingId, undefined);
  assert.equal(savedRows[0].coldmailOpenTrackingId, undefined);
  assert.equal(savedRows[1].status, 'klant');
});

test('coldmail campaign uses standard SMTP transports with bounded timeouts', async () => {
  const { service, transportConfigs } = createService();

  await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedendag,\n\nIk heb een korte vraag over jullie website.',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(transportConfigs.length, 1);
  assert.equal(transportConfigs[0].family, undefined);
  assert.equal(transportConfigs[0].lookup, undefined);
  assert.equal(transportConfigs[0].getSocket, undefined);
  assert.equal(transportConfigs[0].connectionTimeout, 45_000);
  assert.equal(transportConfigs[0].greetingTimeout, 30_000);
  assert.equal(transportConfigs[0].socketTimeout, 90_000);
});

test('coldmail campaign removes Martijn LinkedIn CTA before sending', async () => {
  for (const senderEmail of ['martijn@softora.nl', 'martijnven123@gmail.com']) {
    const { service, sentMessages } = createService({
      rows: [
        {
          id: 'prospect-1',
          bedrijf: 'Bakkerij Zon',
          naam: 'Ruben',
          email: 'ruben@example.test',
          plaats: 'Boxtel',
          status: 'prospect',
          mail: true,
        },
      ],
      mailboxAccountsRaw: JSON.stringify([
        {
          email: senderEmail,
          name: 'Martijn van de Ven',
          smtpHost: senderEmail.endsWith('@gmail.com') ? 'smtp.gmail.com' : 'smtp.strato.com',
          smtpUser: senderEmail,
          smtpPass: 'martijn-secret',
        },
      ]),
    });

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
        '',
        '💼 Mijn LinkedIn 👈',
        '',
        '📍 {{stad}}',
      ].join('\n'),
      senderEmail,
    });

    assert.equal(result.sent, 1, senderEmail);
    assert.doesNotMatch(sentMessages[0].text, /Mijn LinkedIn|linkedin\.com/i);
    assert.match(
      sentMessages[0].text,
      /Martijn van de Ven\n\n📍 Boxtel/,
      senderEmail
    );
    assert.doesNotMatch(sentMessages[0].text, /Wordt het webdesign niet zichtbaar/i, senderEmail);
    assert.doesNotMatch(sentMessages[0].html, /Mijn LinkedIn|linkedin\.com/i, senderEmail);
  }
});

test('coldmail campaign keeps the standard subject and body when variants are provided', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'variant-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        website: 'bakkerijzon.nl',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
      },
      {
        id: 'variant-2',
        bedrijf: 'Lunchroom Maan',
        naam: 'Luna',
        email: 'luna@example.test',
        website: 'lunchroommaan.nl',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
      },
      {
        id: 'variant-3',
        bedrijf: 'Café Nova',
        naam: 'Nora',
        email: 'nora@example.test',
        website: 'cafenova.nl',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
      },
    ],
    photoMap: {
      'variant-1': {
        id: 'variant-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
      'variant-2': {
        id: 'variant-2',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
      'variant-3': {
        id: 'variant-3',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 3,
    subject: 'Nieuw webdesign gemaakt voor {{bedrijf}}',
    subjectVariants: [
      'Nieuw webdesign gemaakt voor {{bedrijf}}',
      'Ik maakte een webdesign voor {{bedrijf}}',
      'Korte vraag over {{website}}',
    ],
    body: 'Ik kwam {{website}} tegen en heb een nieuw webdesign gemaakt.',
    bodyVariants: [
      'Ik kwam {{website}} tegen en heb een nieuw webdesign gemaakt.',
      'Deze week zag ik {{website}} voorbij komen. Ik heb daar een nieuw webdesign voor gemaakt.',
      'Vanuit enthousiasme heb ik een alternatief design gemaakt voor {{website}}.',
    ],
    senderEmail: 'info@softora.nl',
    branch: 'Horeca & Restaurants',
    actor: 'Servé',
  });

  assert.equal(result.sent, 3);
  assert.equal(sentMessages.length, 3);
  assert.deepEqual(sentMessages.map((message) => message.subject), [
    'Nieuw webdesign gemaakt voor Bakkerij Zon',
    'Nieuw webdesign gemaakt voor Lunchroom Maan',
    'Nieuw webdesign gemaakt voor Café Nova',
  ]);
  sentMessages.forEach((message) => {
    assert.match(message.text, /Ik kwam .* tegen en heb een nieuw webdesign gemaakt\./);
    assert.doesNotMatch(message.text, /Deze week zag ik|Vanuit enthousiasme/);
  });
  assert.match(sentMessages[0].text, /bakkerijzon\.nl/);
  assert.match(sentMessages[1].text, /lunchroommaan\.nl/);
  assert.match(sentMessages[2].text, /cafenova\.nl/);
});

test('coldmail campaign does not add open tracking pixels to new outbound mail', async () => {
  const { service, sentMessages, getSavedState } = createService();

  const sendResult = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}},\n\nZou u openstaan voor webdesign?',
    senderEmail: 'info@softora.nl',
    branch: 'Horeca & Restaurants',
    actor: 'Servé',
  });

  assert.equal(sendResult.sent, 1);
  assert.equal(sendResult.sentItems[0].trackingId, '');
  assert.doesNotMatch(sentMessages[0].html, /https:\/\/www\.softora\.nl\/api\/coldmailing\/open\.gif\?/);
  const savedRows = JSON.parse(readChunkedStateValue(getSavedState().values, 'softora_customers_premium_v1'));
  assert.equal(savedRows[0].coldmailTrackingId, undefined);
  assert.equal(savedRows[0].coldmailOpenTrackingId, undefined);
});

test('coldmail campaign keeps legacy open tracking endpoint available', async () => {
  const trackingId = 'legacy-track-1';
  const email = 'ruben@example.test';
  const id = 'prospect-1';
  const { service, getSavedState } = createService({
    rows: [
      {
        id,
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email,
        telefoon: '+31 6 12345678',
        status: 'gemaild',
        branche: 'Horeca & Restaurants',
        mail: true,
        coldmailTrackingId: trackingId,
        coldmailOpenTrackingId: trackingId,
        coldmailOpened: false,
        coldmailOpenCount: 0,
      },
    ],
  });

  const result = await service.recordColdmailOpen({
    token: buildColdmailOpenTrackingToken({ id, email, trackingId }),
    trackingId,
    actor: 'contract-test',
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 1);
  const savedRows = JSON.parse(readChunkedStateValue(getSavedState().values, 'softora_customers_premium_v1'));
  assert.equal(savedRows[0].coldmailOpened, true);
  assert.equal(savedRows[0].coldmailFirstOpenedAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailLastOpenedAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailOpenCount, 1);
  assert.equal(savedRows[0].hist[0].source, 'coldmail-open-tracking');
});

test('coldmail open tracking ignores invalid tokens without changing rows', async () => {
  const { service, getSavedStates } = createService();

  const result = await service.recordColdmailOpen({
    token: 'bad-token',
    trackingId: 'bad',
    actor: 'contract-test',
  });

  assert.equal(result.ok, false);
  assert.equal(result.updated, 0);
  assert.equal(getSavedStates().length, 0);
});

test('coldmail open tracking ignores tokens from before a metrics reset', async () => {
  const trackingId = 'legacy-track-before-reset';
  const { service, getSavedStates } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@bakkerij-zon.test',
        telefoon: '+31 6 12345678',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
        coldmailTrackingId: trackingId,
        coldmailOpenTrackingId: trackingId,
        coldmailOpenTrackingResetAt: '2026-04-24T12:01:00.000Z',
      },
    ],
  });

  const result = await service.recordColdmailOpen({
    token: buildColdmailOpenTrackingToken({
      id: 'prospect-1',
      email: 'ruben@example.test',
      trackingId,
      ts: '2026-04-24T12:00:00.000Z',
    }),
    trackingId,
    actor: 'contract-test',
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated, 0);
  assert.equal(result.reason, 'tracking_token_before_reset');
  assert.equal(getSavedStates().length, 0);
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

test('coldmail autopilot does not overwrite live settings when state cannot be loaded', async () => {
  const liveState = {
    enabled: true,
    config: {
      count: 1,
      senderEmails: ['serve@softora.nl'],
      senderProfiles: {
        'serve@softora.nl': {
          subject: 'Korte vraag voor {{bedrijf}}',
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
        },
      },
    },
    schedule: {
      timezone: 'Europe/Amsterdam',
      weekdaysOnly: true,
      startHour: 7,
      endHour: 18,
      minIntervalMinutes: 12,
      senderMinIntervalMinutes: 70,
      senderMaxIntervalMinutes: 82,
      sendJitterMinSeconds: 45,
      sendJitterMaxSeconds: 240,
    },
  };
  const { service, sentMessages, getAutopilotState, getSavedStates } = createService({
    autopilotState: liveState,
    autopilotReadStates: [null],
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'state_unavailable');
  assert.equal(sentMessages.length, 0);
  assert.equal(getAutopilotState().enabled, true);
  assert.equal(getSavedStates().some((entry) => entry.scope === 'premium_coldmail_autopilot'), false);
});

test('coldmail autopilot normalizes the obsolete 70-82 workday pace to day-slot defaults', async () => {
  const { service } = createService({
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 17,
        minIntervalMinutes: 5,
        senderMinIntervalMinutes: 70,
        senderMaxIntervalMinutes: 82,
        sendJitterMinSeconds: 45,
        sendJitterMaxSeconds: 240,
      },
    },
  });

  const status = await service.getColdmailAutopilotStatus();

  assert.equal(status.autopilot.schedule.senderMinIntervalMinutes, 60);
  assert.equal(status.autopilot.schedule.senderMaxIntervalMinutes, 74);
});

test('coldmail autopilot disable toggle keeps sender configuration and live schedule intact', async () => {
  const { service, getAutopilotState } = createService({
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl', 'martijn@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Kleine vraag over jullie website',
            body: 'Goedemorgen, zou u openstaan voor een betere website?',
          },
          'martijn@softora.nl': {
            subject: 'Kleine vraag over jullie website',
            body: 'Goedemorgen, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 18,
        minIntervalMinutes: 12,
        senderMinIntervalMinutes: 70,
        senderMaxIntervalMinutes: 82,
        sendJitterMinSeconds: 45,
        sendJitterMaxSeconds: 240,
      },
    },
  });

  await service.updateColdmailAutopilotSettings({
    enabled: false,
    config: {
      senderEmails: [],
      senderProfiles: {},
    },
    schedule: {
      timezone: 'Europe/Amsterdam',
      weekdaysOnly: true,
      startHour: 8,
      endHour: 17,
      minIntervalMinutes: 5,
      senderMinIntervalMinutes: 14,
      senderMaxIntervalMinutes: 18,
      sendJitterMinSeconds: 5,
      sendJitterMaxSeconds: 45,
    },
  }, 'Dashboard toggle');

  const state = getAutopilotState();
  assert.equal(state.enabled, false);
  assert.deepEqual(state.config.senderEmails, ['serve@softora.nl', 'martijn@softora.nl']);
  assert.deepEqual(Object.keys(state.config.senderProfiles), ['serve@softora.nl', 'martijn@softora.nl']);
  assert.equal(state.schedule.startHour, 7);
  assert.equal(state.schedule.endHour, 18);
  assert.equal(state.schedule.minIntervalMinutes, 12);
  assert.equal(state.schedule.senderMinIntervalMinutes, 70);
  assert.equal(state.schedule.senderMaxIntervalMinutes, 82);
  assert.equal(state.schedule.sendJitterMinSeconds, 45);
  assert.equal(state.schedule.sendJitterMaxSeconds, 240);
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
        email: 'luna@kapsalon-luna.test',
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
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
            aiInstructions: 'Houd het kort.',
            toneStyle: 'Vriendelijk & professioneel',
          },
        },
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

test('coldmail autopilot keeps enabled state when latest state read is unavailable after send', async () => {
  const liveState = {
    enabled: true,
    config: {
      count: 1,
      senderEmails: ['serve@softora.nl'],
      senderProfiles: {
        'serve@softora.nl': {
          subject: 'Korte vraag voor {{bedrijf}}',
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
        },
      },
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
      senderMinIntervalMinutes: 70,
      senderMaxIntervalMinutes: 82,
      sendJitterMinSeconds: 45,
      sendJitterMaxSeconds: 240,
    },
  };
  const { service, sentMessages, getAutopilotState } = createService({
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
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
        },
      },
    },
    autopilotState: liveState,
    autopilotReadStates: [liveState, null],
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.reason, 'sent');
  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(getAutopilotState().enabled, true);
  assert.equal(getAutopilotState().lastResult.reason, 'sent');
  assert.equal(getAutopilotState().schedule.senderMaxIntervalMinutes, 82);
});

test('coldmail autopilot blocks invalid domains without extending the send cooldown', async () => {
  const previousLastStartedAt = '2026-04-24T11:40:00.000Z';
  const { service, sentMessages, getAutopilotState, getSavedStates } = createService({
    rows: [
      {
        id: 'bad-domain',
        bedrijf: 'MCV E-commerce',
        naam: 'MCV E-commerce',
        email: 'info@mcvecommerce.nl',
        status: 'benaderbaar',
        stad: 'Oisterwijk',
        mail: true,
      },
    ],
    invalidDomains: ['mcvecommerce.nl'],
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 12,
      },
      lastStartedAt: previousLastStartedAt,
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_valid_recipient_domains');
  assert.equal(result.invalidRecipientDomainsBlocked, 1);
  assert.equal(sentMessages.length, 0);
  assert.equal(getAutopilotState().lastStartedAt, previousLastStartedAt);
  assert.equal(getAutopilotState().lastResult.invalidRecipientDomainsBlocked, 1);

  const customerSave = getSavedStates().find((state) => state.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerSave.values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailInvalidEmailDomain, 'mcvecommerce.nl');
});

test('coldmail autopilot respects a per-sender cooldown without extending the global send clock', async () => {
  const previousLastStartedAt = '2026-04-24T11:50:00.000Z';
  const { service, sentMessages, getAutopilotState } = createService({
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
      {
        email: 'martijn@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'martijn-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:45:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 1,
          personalCount: 0,
        },
        {
          at: '2026-04-24T11:40:00.000Z',
          senderEmail: 'martijn@softora.nl',
          count: 1,
          personalCount: 0,
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl', 'martijn@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
          'martijn@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 10,
        senderMinIntervalMinutes: 25,
      },
      lastStartedAt: previousLastStartedAt,
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'sender_cooldown');
  assert.equal(sentMessages.length, 0);
  assert.equal(getAutopilotState().lastStartedAt, previousLastStartedAt);
  assert.equal(getAutopilotState().lastResult.senderSkips.length, 2);
});

test('coldmail autopilot reports redacted smtp diagnostics for unconfigured senders', async () => {
  const oldEnv = { ...process.env };
  [
    'MAILBOX_ACCOUNTS',
    'MAILBOX_SERVEC321_GMAIL_COM_PASS',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_HOST',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_PORT',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_SECURE',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_USER',
    'MAILBOX_SERVEC321_GMAIL_COM_SMTP_PASS',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_PASS',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_SMTP_HOST',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_SMTP_PORT',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_SMTP_SECURE',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_SMTP_USER',
    'MAILBOX_MARTIJNVEN123_GMAIL_COM_SMTP_PASS',
    'MAILBOX_GMAIL_COM_PASS',
    'MAILBOX_GMAIL_COM_SMTP_HOST',
    'MAILBOX_GMAIL_COM_SMTP_PORT',
    'MAILBOX_GMAIL_COM_SMTP_SECURE',
    'MAILBOX_GMAIL_COM_SMTP_PASS',
  ].forEach((key) => {
    delete process.env[key];
  });
  try {
    const { service, getAutopilotState } = createService({
      autopilotState: {
        enabled: true,
        config: {
          count: 1,
          senderEmails: ['servec321@gmail.com'],
          senderProfiles: {
            'servec321@gmail.com': {
              subject: 'Korte vraag voor {{bedrijf}}',
              body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
            },
          },
          branch: 'Horeca & Restaurants',
          specialAction: '',
          radiusKm: 250,
        },
      },
    });

    const result = await service.runColdmailAutopilot({
      publicBaseUrl: 'https://www.softora.nl',
      actor: 'Coldmail Autopilot Cron',
    });

    assert.equal(result.reason, 'no_sender_capacity');
    const [skip] = getAutopilotState().lastResult.senderSkips;
    assert.equal(skip.senderEmail, 'servec321@gmail.com');
    assert.equal(skip.reason, 'sender_smtp_not_configured');
    assert.equal(skip.smtpDiagnostic.resolved.hasPass, false);
    assert.equal(skip.smtpDiagnostic.mailboxAccount.found, true);
    assert.equal(skip.smtpDiagnostic.runtimeEnv.full.sharedPass, false);
    assert.equal(skip.smtpDiagnostic.runtimeEnv.full.smtpPass, false);
    assert.equal(skip.smtpDiagnostic.runtimeEnv.domain.smtpHost, false);
  } finally {
    process.env = oldEnv;
  }
});

test('coldmail autopilot waits a configured send jitter before sending', async () => {
  const { service, sentMessages, sleeps, getAutopilotState } = createService({
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
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 5,
        sendJitterMinSeconds: 37,
        sendJitterMaxSeconds: 37,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.sendJitterSeconds, 37);
  assert.deepEqual(sleeps, [37000]);
  assert.equal(sentMessages.length, 1);
  assert.equal(getAutopilotState().schedule.sendJitterMinSeconds, 37);
  assert.equal(getAutopilotState().lastResult.sendJitterSeconds, 37);
});

test('coldmail autopilot supports a deterministic random per-sender cooldown range', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
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
      {
        email: 'martijn@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'martijn-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:50:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 1,
          personalCount: 0,
        },
        {
          at: '2026-04-24T11:50:00.000Z',
          senderEmail: 'martijn@softora.nl',
          count: 1,
          personalCount: 0,
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl', 'martijn@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
          'martijn@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 5,
        senderMinIntervalMinutes: 14,
        senderMaxIntervalMinutes: 18,
      },
      lastStartedAt: '2026-04-24T11:55:00.000Z',
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.reason, 'sender_cooldown');
  assert.equal(sentMessages.length, 0);
  const cooldowns = getAutopilotState().lastResult.senderSkips.map((item) => item.cooldownMinutes);
  assert.equal(cooldowns.length, 2);
  cooldowns.forEach((cooldown) => {
    assert.equal(cooldown >= 14, true);
    assert.equal(cooldown <= 18, true);
  });
});

test('coldmail autopilot day-paces each mailbox across the full 07-17 workday', async () => {
  const baseSetup = {
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
    sendGuardState: {
      entries: [
        {
          at: '2026-06-08T05:05:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 1,
          personalCount: 0,
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 17,
        minIntervalMinutes: 5,
        senderMinIntervalMinutes: 60,
        senderMaxIntervalMinutes: 74,
        sendJitterMinSeconds: 45,
        sendJitterMaxSeconds: 240,
      },
      lastStartedAt: '2026-06-08T05:55:00.000Z',
    },
  };
  const early = createService({
    ...baseSetup,
    now: () => new Date('2026-06-08T06:00:00.000Z'),
  });

  const earlyResult = await early.service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(earlyResult.reason, 'sender_cooldown');
  assert.equal(early.sentMessages.length, 0);
  const readyAtMs = Date.parse(early.getAutopilotState().lastResult.senderSkips[0].readyAt);
  assert.equal(readyAtMs > Date.parse('2026-06-08T06:00:00.000Z'), true);

  const onSlot = createService({
    ...baseSetup,
    now: () => new Date('2026-06-08T06:25:00.000Z'),
  });

  const onSlotResult = await onSlot.service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(onSlotResult.reason, 'sent');
  assert.equal(onSlot.sentMessages.length, 1);
  assert.equal(onSlot.getAutopilotState().lastResult.senderEmail, 'serve@softora.nl');

  const justBeforeFloorReady = createService({
    ...baseSetup,
    sendGuardState: {
      entries: [
        {
          at: '2026-06-08T05:30:02.000Z',
          senderEmail: 'serve@softora.nl',
          count: 1,
          personalCount: 0,
        },
      ],
    },
    now: () => new Date('2026-06-08T06:25:00.000Z'),
  });

  const graceResult = await justBeforeFloorReady.service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(graceResult.reason, 'sent');
  assert.equal(justBeforeFloorReady.sentMessages.length, 1);
  assert.equal(justBeforeFloorReady.getAutopilotState().lastResult.senderEmail, 'serve@softora.nl');
});

test('coldmail autopilot starts a new workday slot even with rolling history from yesterday', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
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
        email: 'servec321@gmail.com',
        smtpHost: 'smtp.gmail.com',
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'serve-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-06-10T14:19:10.000Z',
          senderEmail: 'servec321@gmail.com',
          count: 1,
          personalCount: 0,
          recipientEmail: 'old@example.test',
          recipientDomain: 'old-example-test',
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['servec321@gmail.com'],
        senderProfiles: {
          'servec321@gmail.com': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: '',
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 17,
        minIntervalMinutes: 5,
        senderMinIntervalMinutes: 60,
        senderMaxIntervalMinutes: 74,
        sendJitterMinSeconds: 45,
        sendJitterMaxSeconds: 240,
      },
      lastStartedAt: '2026-06-11T05:00:00.000Z',
    },
    now: () => new Date('2026-06-11T05:10:00.000Z'),
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.reason, 'sent');
  assert.equal(result.senderEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(getAutopilotState().lastResult.dailyQuota.senderDaySentBefore, 0);
  assert.equal(getAutopilotState().lastResult.dailyQuota.senderSentBefore, 1);
});

test('coldmail autopilot staggers senders by choosing the mailbox whose cooldown is ready', async () => {
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
      {
        email: 'martijn@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'martijn-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:30:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 1,
          personalCount: 0,
        },
        {
          at: '2026-04-24T11:50:00.000Z',
          senderEmail: 'martijn@softora.nl',
          count: 1,
          personalCount: 0,
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl', 'martijn@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
          'martijn@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 10,
        senderMinIntervalMinutes: 25,
      },
      lastStartedAt: '2026-04-24T11:50:00.000Z',
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.reason, 'sent');
  assert.equal(result.senderEmail, 'serve@softora.nl');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
});

test('coldmail autopilot skips only the mailbox with an active safety pause', async () => {
  const { service, sentMessages, getSendGuardState } = createService({
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
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
      {
        email: 'servec321@gmail.com',
        name: 'Servé Creusen',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'gmail-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T11:55:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 0,
          personalCount: 0,
          safetyPauseUntil: '2026-04-24T13:00:00.000Z',
          safetyPauseReason: '550 5.7.1 Refused by local policy. No SPAM please!',
        },
      ],
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl', 'servec321@gmail.com'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
          'servec321@gmail.com': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: '',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 5,
        senderMinIntervalMinutes: 60,
        senderMaxIntervalMinutes: 75,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.reason, 'sent');
  assert.equal(result.senderEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <servec321@gmail.com>');
  assert.equal(
    getSendGuardState().entries.some((entry) => entry.senderEmail === 'servec321@gmail.com' && entry.count === 1),
    true
  );
});

test('coldmail autopilot only uses explicitly configured sender emails', async () => {
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
      {
        email: 'zakelijk@theimpactbox.co',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'zakelijk@theimpactbox.co',
        smtpPass: 'impact-secret',
      },
      {
        email: 'servec321@gmail.com',
        smtpHost: 'smtp.gmail.com',
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'gmail-secret',
      },
    ]),
    sendGuardState: {
      entries: [
        {
          at: '2026-04-24T09:00:00.000Z',
          senderEmail: 'serve@softora.nl',
          count: 8,
          personalCount: 0,
        },
      ],
    },
    coldmailingSettings: {
      senderEmail: 'zakelijk@theimpactbox.co',
      senders: {
        'serve@softora.nl': {
          subject: 'Korte vraag voor {{bedrijf}}',
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
        },
        'zakelijk@theimpactbox.co': {
          subject: 'Impact vraag voor {{bedrijf}}',
          body: 'Impact body',
        },
        'servec321@gmail.com': {
          subject: 'Gmail vraag voor {{bedrijf}}',
          body: 'Gmail body',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
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

  assert.equal(result.senderEmail, 'serve@softora.nl');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Servé Creusen <serve@softora.nl>');
  assert.equal(sentMessages[0].subject, 'Korte vraag voor Bakkerij Zon');
});

test('coldmail autopilot keeps all nine configured Softora sender emails', async () => {
  const senderEmails = [
    'serve@softora.nl',
    'martijn@softora.nl',
    'servecreusen@softora.nl',
    'martijnvandeven@softora.nl',
    'servec321@gmail.com',
    'martijnven123@gmail.com',
    'serve290@gmail.com',
    'servecreusen7@gmail.com',
    'contact.venvisuals@gmail.com',
  ];
  const { service, getAutopilotState } = createService({
    rows: [],
    coldmailingSettings: {
      senders: Object.fromEntries(senderEmails.map((email) => [
        email,
        {
          subject: 'Kleine vraag over jullie website',
          body: 'Mocht je er niks mee willen doen, helemaal goed.',
        },
      ])),
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails,
        senderProfiles: Object.fromEntries(senderEmails.map((email) => [
          email,
          {
            subject: 'Kleine vraag over jullie website',
            body: 'Mocht je er niks mee willen doen, helemaal goed.',
          },
        ])),
        branch: 'Webdesign',
        service: "Website's",
        specialAction: 'webdesign',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 18,
        minIntervalMinutes: 12,
      },
      lastRunAt: '2026-06-02T10:00:00.000Z',
    },
  });

  await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.deepEqual(getAutopilotState().config.senderEmails, senderEmails);
});

test('coldmail autopilot refuses non-team sender emails even when SMTP exists', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
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
        email: 'info@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'info@softora.nl',
        smtpPass: 'info-secret',
      },
      {
        email: 'zakelijk@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'zakelijk@softora.nl',
        smtpPass: 'zakelijk-secret',
      },
    ]),
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['info@softora.nl', 'zakelijk@softora.nl'],
        senderProfiles: {
          'info@softora.nl': {
            subject: 'Foute info-afzender {{bedrijf}}',
            body: 'Deze tekst mag nooit door autopilot heen.',
          },
          'zakelijk@softora.nl': {
            subject: 'Foute zakelijk-afzender {{bedrijf}}',
            body: 'Deze tekst mag ook nooit door autopilot heen.',
          },
        },
        branch: 'Horeca & Restaurants',
        service: "Website's",
        specialAction: '',
        radiusKm: 250,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_sender_capacity');
  assert.equal(sentMessages.length, 0);
  assert.deepEqual(getAutopilotState().config.senderEmails, []);
});

test('coldmail autopilot refuses legacy config without saved sender profiles', async () => {
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
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmail: 'serve@softora.nl',
        senderEmails: ['serve@softora.nl'],
        subject: 'Legacy onderwerp {{bedrijf}}',
        body: 'Legacy tekst die niet meer genoeg is.',
        branch: 'Horeca & Restaurants',
        service: "Website's",
        specialAction: '',
        radiusKm: 250,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'empty_mail_content');
  assert.equal(sentMessages.length, 0);
});

test('coldmail autopilot uses the saved dashboard profile and includes the webdesign mockup when available', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Bakkerij Zon webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Bakkerij Zon device mockup',
      },
    },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'martijn@softora.nl',
        smtpHost: 'smtp.strato.com',
        smtpUser: 'martijn@softora.nl',
        smtpPass: 'martijn-secret',
      },
    ]),
    coldmailingSettings: {
      senderEmail: 'martijn@softora.nl',
      senders: {
        'martijn@softora.nl': {
          subject: 'Oude opgeslagen tekst {{bedrijf}}',
          body: 'Deze oudere tekst mag autopilot niet gebruiken.',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['martijn@softora.nl'],
        senderProfiles: {
          'martijn@softora.nl': {
            subject: 'Nieuw webdesign gemaakt voor {{bedrijf}}',
            subjectVariants: [
              'Nieuw webdesign gemaakt voor {{bedrijf}}',
              'Ik maakte een webdesign voor {{bedrijf}}',
            ],
            body: 'Goedemorgen {{naam}},\n\nDit is de actuele dashboardtekst.\n\nMet vriendelijke groet,\nMartijn van de Ven',
            bodyVariants: [
              'Goedemorgen {{naam}},\n\nDit is de actuele dashboardtekst.\n\nMet vriendelijke groet,\nMartijn van de Ven',
              'Goedemorgen {{naam}},\n\nIk stuur je de actuele variant vanuit het dashboard.\n\nMet vriendelijke groet,\nMartijn van de Ven',
            ],
          },
        },
        branch: 'Horeca & Restaurants',
        service: "Website's",
        specialAction: 'webdesign',
        radiusKm: 250,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.senderEmail, 'martijn@softora.nl');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].from, 'Martijn van de Ven <martijn@softora.nl>');
  assert.equal(sentMessages[0].subject, 'Nieuw webdesign gemaakt voor Bakkerij Zon');
  assert.match(sentMessages[0].text, /actuele dashboardtekst/);
  assert.doesNotMatch(sentMessages[0].text, /actuele variant/);
  assert.doesNotMatch(sentMessages[0].text, /oudere tekst/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-prospect-1@softora');
  assert.equal(getAutopilotState().config.senderProfiles['martijn@softora.nl'].bodyVariants.length, 1);
});

test('coldmail autopilot treats fris webdesign dashboard text as a real image-backed webdesign send', async () => {
  const { service, sentMessages, getSavedStates } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'import-5-db-mpfntuzo-cifdr3',
        bedrijf: 'Rolsteiger.net',
        naam: 'Ruben',
        email: 'info@rolsteiger.net',
        website: 'rolsteiger.net',
        status: 'benaderbaar',
        stad: 'Etten-Leur',
        mail: true,
      },
    ],
    photoMap: {
      'import-5-db-mpfntuzo-cifdr3': {
        id: 'import-5-db-mpfntuzo-cifdr3',
        identityKey: 'Rolsteiger.net|Ruben|',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'rolsteiger-net-webdesign.png',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'rolsteiger-net-device-mockup.png',
      },
    },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'servec321@gmail.com',
        name: 'Servé Creusen',
        smtpHost: 'smtp.gmail.com',
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'gmail-secret',
      },
    ]),
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['servec321@gmail.com'],
        senderProfiles: {
          'servec321@gmail.com': {
            subject: 'Kleine vraag over jullie website',
            body: [
              'Goedendag,',
              '',
              'Afgelopen week kwam ik jullie website ({{website}}) tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
              '',
              'Met vriendelijke groet,',
              'Servé Creusen',
            ].join('\n'),
          },
        },
        specialAction: '',
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.senderEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Je kunt het webdesign hier bekijken 👈/);
  assert.doesNotMatch(sentMessages[0].text, /PS: Wordt het webdesign niet zichtbaar/);
  assert.match(
    sentMessages[0].html,
    /href="https:\/\/www\.softora\.nl\/webdesign\/rolsteiger-net"/
  );
  assert.match(
    sentMessages[0].html,
    /Je kunt het webdesign <a href="https:\/\/www\.softora\.nl\/webdesign\/rolsteiger-net" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier<\/a> bekijken 👈/
  );
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-import-5-db-mpfntuzo-cifdr3@softora"/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-import-5-db-mpfntuzo-cifdr3@softora"/);
  assert.doesNotMatch(sentMessages[0].html, /\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[1].contentDisposition, 'inline');

  const customerSave = getSavedStates().find((entry) => entry.scope === 'premium_customers_database');
  const savedRows = JSON.parse(customerSave.values.softora_customers_premium_v1);
  assert.equal(savedRows[0].coldmailSpecialAction, 'webdesign');
  assert.equal(savedRows[0].outreachCampaignType, 'webdesign');
});

test('coldmail autopilot does not send fris webdesign mail when no design assets are ready', async () => {
  const preparedJobs = [];
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'import-5-db-mpfntuzo-cifdr3',
        bedrijf: 'Rolsteiger.net',
        naam: 'Ruben',
        email: 'info@rolsteiger.net',
        website: 'rolsteiger.net',
        status: 'benaderbaar',
        stad: 'Etten-Leur',
        mail: true,
      },
    ],
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'servec321@gmail.com',
        name: 'Servé Creusen',
        smtpHost: 'smtp.gmail.com',
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'gmail-secret',
      },
    ]),
    webdesignPreparationCoordinator: {
      startJob: async (payload) => {
        preparedJobs.push(payload);
        return {
          ok: true,
          job: {
            id: payload.jobId,
            status: 'queued',
            customerId: payload.customer.id,
          },
        };
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['servec321@gmail.com'],
        senderProfiles: {
          'servec321@gmail.com': {
            subject: 'Kleine vraag over jullie website',
            body:
              'Afgelopen week kwam ik jullie website ({{website}}) tegen. Vanuit enthousiasme heb ik een fris webdesign gemaakt, gewoon omdat ik dat leuk vind.',
          },
        },
        specialAction: '',
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'webdesign_preparation_queued');
  assert.equal(sentMessages.length, 0);
  assert.equal(preparedJobs.length, 1);
  assert.equal(preparedJobs[0].customer.id, 'import-5-db-mpfntuzo-cifdr3');
});

test('coldmail autopilot skips leads without a complete webdesign mockup', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'missing-design',
        bedrijf: 'Nog Geen Design BV',
        naam: 'Ruben',
        email: 'mist@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
      {
        id: 'photo-ready',
        bedrijf: 'Foto Klaar BV',
        naam: 'Servé',
        email: 'klaar@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
      {
        id: 'mockup-ready',
        bedrijf: 'Mockup Klaar BV',
        naam: 'Ruben',
        email: 'mockup@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        stad: 'Oisterwijk',
        mail: true,
      },
    ],
    photoMap: {
      'photo-ready': {
        id: 'photo-ready',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Foto Klaar BV webdesign',
      },
      'mockup-ready': {
        id: 'mockup-ready',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Mockup Klaar BV webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Mockup Klaar BV device mockup',
      },
    },
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
          subject: 'Oude tekst {{bedrijf}}',
          body: 'Deze tekst mag autopilot niet gebruiken.',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Nieuw webdesign gemaakt voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}},\n\nIk heb een webdesign voor jullie gemaakt.',
          },
        },
        branch: 'Horeca & Restaurants',
        service: "Website's",
        specialAction: 'webdesign',
        radiusKm: 250,
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.skipped, false);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'mockup@example.test');
  assert.equal(sentMessages[0].subject, 'Nieuw webdesign gemaakt voor Mockup Klaar BV');
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-mockup-ready@softora');
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'inline');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-mockup-ready@softora');
  assert.equal(sentMessages[0].attachments[1].contentDisposition, 'inline');
});

test('coldmail autopilot does not extend cooldown when no webdesign-ready lead exists', async () => {
  const previousLastStartedAt = '2026-04-24T11:40:00.000Z';
  const { service, sentMessages, getAutopilotState } = createService({
    rows: [
      {
        id: 'missing-design',
        bedrijf: 'Nog Geen Design BV',
        naam: 'Ruben',
        email: 'mist@example.test',
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
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Nieuw webdesign gemaakt voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}},\n\nIk heb een webdesign voor jullie gemaakt.',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: 'webdesign',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 12,
      },
      lastStartedAt: previousLastStartedAt,
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_webdesign_photos');
  assert.equal(sentMessages.length, 0);
  assert.equal(getAutopilotState().lastStartedAt, previousLastStartedAt);
});

test('coldmail autopilot queues the next webdesign job when ready stock is empty', async () => {
  const previousLastStartedAt = '2026-04-24T11:40:00.000Z';
  const preparedJobs = [];
  const { service, sentMessages, getAutopilotState } = createService({
    rows: [
      {
        id: 'missing-design',
        bedrijf: 'Nog Geen Design BV',
        naam: 'Ruben',
        email: 'info@noggeendesign.nl',
        website: 'noggeendesign.nl',
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
    webdesignPreparationCoordinator: {
      startJob: async (payload) => {
        preparedJobs.push(payload);
        return {
          ok: true,
          job: {
            id: payload.jobId,
            status: 'queued',
            customerId: payload.customer.id,
          },
        };
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Nieuw webdesign gemaakt voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}},\n\nIk heb een webdesign voor jullie gemaakt.',
          },
        },
        branch: 'Horeca & Restaurants',
        specialAction: 'webdesign',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 9,
        endHour: 17,
        minIntervalMinutes: 12,
      },
      lastStartedAt: previousLastStartedAt,
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'webdesign_preparation_queued');
  assert.equal(sentMessages.length, 0);
  assert.equal(preparedJobs.length, 1);
  assert.equal(preparedJobs[0].ownerKey, 'coldmail-autopilot::system');
  assert.equal(preparedJobs[0].customer.id, 'missing-design');
  assert.equal(preparedJobs[0].customer.bedrijf, 'Nog Geen Design BV');
  assert.equal(preparedJobs[0].websiteUrl, 'https://noggeendesign.nl/');
  assert.match(preparedJobs[0].jobId, /^coldmail_webdesign_[a-f0-9]{24}_[a-z0-9]+$/);
  assert.equal(result.webdesignPreparation.customerId, 'missing-design');
  assert.equal(result.webdesignPreparation.job.status, 'queued');
  assert.equal(getAutopilotState().lastStartedAt, previousLastStartedAt);
});

test('coldmail autopilot keeps an emergency disabled state when a running batch finishes', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
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
          body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
        },
      },
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
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
    onSendMail: ({ getAutopilotState, setAutopilotState }) => {
      setAutopilotState({
        ...getAutopilotState(),
        enabled: false,
        lock: null,
        emergencyStoppedAt: '2026-04-24T12:00:00.000Z',
        emergencyStopReason: 'Noodstop tijdens actieve run.',
      });
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(getAutopilotState().enabled, false);
  assert.equal(getAutopilotState().lock, null);
  assert.equal(getAutopilotState().lastResult.reason, 'sent');
  assert.equal(getAutopilotState().emergencyStopReason, 'Noodstop tijdens actieve run.');
});

test('coldmail autopilot does not let an empty disabled state wipe sender config after a run', async () => {
  const { service, sentMessages, getAutopilotState } = createService({
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
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}, zou u openstaan voor een betere website?',
          },
        },
        branch: 'Horeca & Restaurants',
        radiusKm: 250,
      },
      schedule: {
        timezone: 'Europe/Amsterdam',
        weekdaysOnly: true,
        startHour: 7,
        endHour: 18,
        minIntervalMinutes: 12,
        senderMinIntervalMinutes: 70,
        senderMaxIntervalMinutes: 82,
        sendJitterMinSeconds: 45,
        sendJitterMaxSeconds: 240,
      },
    },
    onSendMail: ({ getAutopilotState, setAutopilotState }) => {
      setAutopilotState({
        ...getAutopilotState(),
        enabled: false,
        config: {
          count: 1,
          senderEmails: [],
          senderProfiles: {},
        },
        schedule: {
          timezone: 'Europe/Amsterdam',
          weekdaysOnly: true,
          startHour: 7,
          endHour: 17,
          minIntervalMinutes: 12,
          senderMinIntervalMinutes: 60,
          senderMaxIntervalMinutes: 60,
          sendJitterMinSeconds: 0,
          sendJitterMaxSeconds: 0,
        },
      });
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  const state = getAutopilotState();
  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(state.enabled, false);
  assert.deepEqual(state.config.senderEmails, ['serve@softora.nl']);
  assert.equal(state.config.senderProfiles['serve@softora.nl'].subject, 'Korte vraag voor {{bedrijf}}');
  assert.equal(state.schedule.endHour, 18);
  assert.equal(state.schedule.senderMinIntervalMinutes, 70);
  assert.equal(state.schedule.senderMaxIntervalMinutes, 82);
  assert.equal(state.schedule.sendJitterMinSeconds, 45);
  assert.equal(state.schedule.sendJitterMaxSeconds, 240);
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
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Korte vraag voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}}',
          },
        },
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

  assert.doesNotMatch(sentMessages[0].html, /\/afmelden\?t=/);
  const unsubscribeHeaderUrl = sentMessages[0].headers['List-Unsubscribe']
    .match(/<([^>]*\/api\/coldmailing\/unsubscribe\?token=[^>]+)>/)[1]
    .replace(/&amp;/g, '&');
  const token = new URL(unsubscribeHeaderUrl).searchParams.get('token');
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

test('coldmail campaign removes Dutch province suffixes from city variables', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Jac Reijns Staalconstructie Alphen B.V.',
        naam: 'Jac Reijns',
        email: 'info@jreijns.nl',
        stad: 'Looiersweg 7, 5131 BE Alphen (NBr.)',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'prospect-2',
        bedrijf: 'Dutch Portugal Trading B.V.',
        naam: 'Jan',
        email: 'janmakker@dutchportugaltrading.nl',
        plaats: 'Alphen NB',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 2,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}\n\n📍 {{stad}}',
    senderEmail: 'info@softora.nl',
    specialAction: '',
  });

  assert.equal(result.sent, 2);
  assert.match(sentMessages[0].text, /📍 Alphen/);
  assert.match(sentMessages[1].text, /📍 Alphen/);
  assert.doesNotMatch(sentMessages[0].text, /\(NBr\.\)|\bNBr\b|\bNB\b/);
  assert.doesNotMatch(sentMessages[1].text, /\(NBr\.\)|\bNBr\b|\bNB\b/);
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

test('coldmail campaign blocks private copies for personal senders', async () => {
  for (const senderEmail of [
    'serve@softora.nl',
    'martijn@softora.nl',
    'servecreusen@softora.nl',
    'martijnvandeven@softora.nl',
    'servec321@gmail.com',
    'martijnven123@gmail.com',
    'serve290@gmail.com',
    'servecreusen7@gmail.com',
    'contact.venvisuals@gmail.com',
  ]) {
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

test('coldmail campaign can use durable remote webdesign photo and device mockup URLs', async () => {
  let setup;
  const overrides = {
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'remote',
    },
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        email: 'ruben@example.test',
        plaats: 'Alphen',
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
    onSendMail: async ({ message }) => {
      const tokens = extractPreviewImageTokens(message.html);
      assert.equal(tokens.length, 2);
      clearPreviewImageCache();
      overrides.customerValues = {
        softora_customers_premium_v1: JSON.stringify([]),
      };
      const webdesignImage = await setup.service.getColdmailPreviewImage({ token: tokens[0] });
      const mockupImage = await setup.service.getColdmailPreviewImage({ token: tokens[1] });
      assert.equal(webdesignImage.type, 'webdesign');
      assert.equal(mockupImage.type, 'mockup');
      assert.equal(webdesignImage.content.toString('base64'), TINY_PNG_DATA_URL.split(',')[1]);
      assert.equal(mockupImage.content.toString('base64'), TINY_PNG_DATA_URL.split(',')[1]);
    },
  };
  setup = createService(overrides);
  const { service, sentMessages, getSavedState } = setup;

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: 'Goedemorgen {{naam}}\n\nMet vriendelijke groet,\nServe Creusen\n\n{{stad}}',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    webdesignImageDelivery: 'remote',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Servé Creusen/);
  assert.doesNotMatch(sentMessages[0].text, /Serve Creusen/);
  assert.match(
    sentMessages[0].text,
    /📍 Alphen\n\nJe kunt het webdesign hier bekijken 👈/
  );
  assert.doesNotMatch(sentMessages[0].text, /PS: Wordt het webdesign niet zichtbaar/);
  assert.match(sentMessages[0].html, /📍 Alphen/);
  assert.match(
    sentMessages[0].html,
    /Je kunt het webdesign <a href="https:\/\/www\.softora\.nl\/webdesign\/bakkerij-zon" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier<\/a> bekijken 👈/
  );
  assert.match(sentMessages[0].html, /Hieronder zie je een korte indruk van de eerste versie op verschillende schermen\./);
  assert.match(sentMessages[0].html, /<table role="presentation" width="100%"/);
  assert.match(sentMessages[0].html, /<td style="[^"]*overflow:visible;"/);
  assert.match(
    sentMessages[0].html,
    /margin:24px 0 0 0;"><tr><td style="[^"]*"><img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=[^"]+"/
  );
  assert.match(sentMessages[0].html, /alt="Bakkerij Zon webdesign" width="640" style="display:block;width:100%;max-width:640px;max-height:960px;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;"/);
  assert.match(sentMessages[0].html, /alt="Bakkerij Zon device mockup" width="640" style="display:block;width:100%;max-width:640px;max-height:960px;height:auto;object-fit:contain;border:0;outline:none;text-decoration:none;"/);
  assert.doesNotMatch(sentMessages[0].html, /height="360"/);
  assert.doesNotMatch(sentMessages[0].html, /cid:/);
  assert.doesNotMatch(sentMessages[0].html, /data:image\//);
  assert.doesNotMatch(sentMessages[0].html, /background-image/i);
  assert.match(
    sentMessages[0].html,
    /margin:0;"><tr><td style="[^"]*"><img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=[^"]+"/
  );
  const tokens = extractPreviewImageTokens(sentMessages[0].html);
  assert.equal(tokens.length, 2);
  const payloads = tokens.map((token) => decodeBase64UrlJson(token.split('.')[0]));
  assert.deepEqual(payloads.map((payload) => payload.type), ['webdesign', 'mockup']);
  assert.notEqual(tokens[0], tokens[1]);
  assert.ok(
    sentMessages[0].html.indexOf('/coldmailing/webdesign-foto?t=') <
      sentMessages[0].html.indexOf('Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.')
  );
  assert.ok(
    sentMessages[0].html.indexOf('Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.') <
      sentMessages[0].html.lastIndexOf('/coldmailing/webdesign-foto?t=')
  );
  assert.doesNotMatch(sentMessages[0].html, /target="_blank"[^>]*><img/);
  assert.doesNotMatch(sentMessages[0].text, /Geen webdesign willen ontvangen\? Laat het me weten!/);
  assert.doesNotMatch(sentMessages[0].text, /https:\/\/www\.softora\.nl\/afmelden\?t=/);
  assert.doesNotMatch(sentMessages[0].text, /Geen interesse\? Reageer met "stop" of "afmelden"/);
  assert.doesNotMatch(sentMessages[0].html, /<p>Geen interesse\? Reageer met/);
  assert.doesNotMatch(sentMessages[0].html, /https:\/\/www\.softora\.nl\/afmelden\?t=/);
  assert.doesNotMatch(sentMessages[0].html, />Geen webdesign willen ontvangen\? Laat het me weten!<\/a>/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].contentDisposition, 'attachment');
  assert.equal(sentMessages[0].attachments[1].contentDisposition, 'attachment');
  assert.equal(sentMessages[0].attachments[0].cid, undefined);
  assert.equal(sentMessages[0].attachments[1].cid, undefined);
  assert.match(sentMessages[0].attachments[0].filename, /Bakkerij-Zon-webdesign\.(?:png|jpg)$/);
  assert.match(sentMessages[0].attachments[1].filename, /Bakkerij-Zon-device-mockup\.(?:png|jpg)$/);
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].campaignType, 'webdesign');
  assert.equal(savedRows[0].outreachStatus, 'benaderd');
  assert.equal(savedRows[0].sentFromEmail, 'info@softora.nl');
  assert.equal(savedRows[0].outreachSentAt, '2026-04-24T12:00:00.000Z');
  assert.equal(savedRows[0].coldmailSentMessageId, 'msg-1');
  assert.equal(savedRows[0].actionRequired, false);
});

test('coldmail preview image route optimizes large images for faster email loading', async () => {
  const largePngDataUrl = `data:image/png;base64,${Buffer.alloc(160 * 1024, 7).toString('base64')}`;
  const optimizedBuffer = Buffer.from('optimized-email-image');
  const sharpCalls = [];
  const fakeSharp = () => {
    const pipeline = {
      async metadata() {
        return { width: 1800 };
      },
      rotate() {
        sharpCalls.push(['rotate']);
        return this;
      },
      resize(options) {
        sharpCalls.push(['resize', options]);
        return this;
      },
      jpeg(options) {
        sharpCalls.push(['jpeg', options]);
        return this;
      },
      async toBuffer() {
        return optimizedBuffer;
      },
    };
    return pipeline;
  };
  const token = buildColdmailPreviewImageToken({
    id: 'prospect-1',
    email: 'ruben@example.test',
    reference: 'SF-20260424-TEST',
    type: 'webdesign',
  });
  const { service } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: largePngDataUrl,
        websitePhotoName: 'Bakkerij Zon webdesign',
      },
    },
    loadPreviewImageSharp: () => fakeSharp,
  });

  const image = await service.getColdmailPreviewImage({ token });

  assert.equal(image.type, 'webdesign');
  assert.equal(image.contentType, 'image/jpeg');
  assert.equal(image.filename, 'Bakkerij-Zon-webdesign.jpg');
  assert.equal(image.content.toString(), optimizedBuffer.toString());
  assert.deepEqual(sharpCalls.find((call) => call[0] === 'resize')[1], {
    width: 960,
    withoutEnlargement: true,
  });
  assert.deepEqual(sharpCalls.find((call) => call[0] === 'jpeg')[1], {
    quality: 82,
    mozjpeg: true,
  });
});

test('coldmail preview image route accepts portable v2 image tokens across hosts', async () => {
  const token = buildColdmailPreviewImageV2Token({
    id: 'prospect-1',
    email: 'ruben@example.test',
    reference: 'SF-20260424-TEST',
    type: 'webdesign',
  });
  const { service } = createService({
    coldmailUnsubscribeSecret: 'a-different-host-secret',
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
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

  const image = await service.getColdmailPreviewImage({ token });

  assert.equal(image.type, 'webdesign');
  assert.equal(image.contentType, 'image/png');
  assert.equal(image.filename, 'Bakkerij-Zon-webdesign.png');
});

test('coldmail preview image route strips decorative webdesign frames for existing email tokens', async () => {
  const framedWebdesign = await createFramedWebdesignDataUrl();
  const token = buildColdmailPreviewImageToken({
    id: 'prospect-frame',
    email: 'frame@example.test',
    reference: 'SF-20260424-FRAME',
    type: 'webdesign',
  });
  const { service } = createService({
    rows: [
      {
        id: 'prospect-frame',
        bedrijf: 'Bakkerij Zon',
        email: 'frame@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'prospect-frame': {
        id: 'prospect-frame',
        websitePhoto: framedWebdesign,
        websitePhotoName: 'Bakkerij Zon webdesign',
      },
    },
  });

  const image = await service.getColdmailPreviewImage({ token });

  assert.equal(image.type, 'webdesign');
  assert.equal(image.contentType, 'image/jpeg');
  const metadata = await sharp(image.content).metadata();
  assert.equal(metadata.width, 328);
  assert.equal(metadata.height, 244);
});

test('coldmail campaign sends webdesign mails link-only by default for owned mailbox sends', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        stad: 'Rotterdam',
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
  assert.match(
    sentMessages[0].html,
    /href="https:\/\/www\.softora\.nl\/webdesign\/bakkerij-zon"/
  );
  assert.doesNotMatch(sentMessages[0].html, /<img src=/);
  assert.doesNotMatch(sentMessages[0].html, /cid:webdesign/);
  assert.doesNotMatch(sentMessages[0].html, /\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(sentMessages[0].attachments, undefined);
});

test('coldmail campaign strips legacy webdesign image placeholders before link-only send', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        stad: 'Rotterdam',
        email: 'ruben@example.test',
        website: 'bakkerijzon.nl',
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
    body: [
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website ({{website}}) tegen.',
      '',
      'Je kunt het webdesign hier bekijken 👈',
      '',
      'Met vriendelijke groet,',
      '{{afzender}}',
      '',
      '📍 {{afzenderPlaats}}',
      '',
      '[image: bakkerijzon.nl webdesign]',
      'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.',
      '[image: Device mockup]',
    ].join('\n'),
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    webdesignImageDelivery: 'link',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /^Goedendag,/);
  assert.match(sentMessages[0].text, /Je kunt het webdesign hier bekijken 👈/);
  assert.doesNotMatch(sentMessages[0].text, /\[image:/i);
  assert.doesNotMatch(sentMessages[0].text, /korte indruk van de eerste versie/i);
  assert.doesNotMatch(sentMessages[0].html, /\[image:/i);
  assert.doesNotMatch(sentMessages[0].html, /<img\b/i);
  assert.doesNotMatch(sentMessages[0].html, /cid:webdesign/i);
  assert.doesNotMatch(sentMessages[0].html, /\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(sentMessages[0].attachments, undefined);
});

test('coldmail autopilot lets dashboard link delivery override legacy image env', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        stad: 'Rotterdam',
        website: 'bakkerijzon.nl',
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
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    coldmailingSettings: {
      webdesignImageDelivery: 'link',
    },
    autopilotState: {
      enabled: true,
      config: {
        count: 1,
        senderEmails: ['serve@softora.nl'],
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Kleine vraag over jullie website',
            body: [
              'Goedendag,',
              '',
              'Afgelopen week kwam ik jullie website ({{website}}) tegen.',
              '',
              'Je kunt het webdesign hier bekijken 👈',
              '',
              'Met vriendelijke groet,',
              '{{afzender}}',
              '',
              '📍 {{afzenderPlaats}}',
            ].join('\n'),
          },
        },
        specialAction: 'webdesign',
      },
    },
  });

  const result = await service.runColdmailAutopilot({
    publicBaseUrl: 'https://www.softora.nl',
    actor: 'Coldmail Autopilot Cron',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /^Goedendag,/);
  assert.match(sentMessages[0].text, /Je kunt het webdesign hier bekijken 👈/);
  assert.match(
    sentMessages[0].html,
    /Je kunt het webdesign <a href="https:\/\/www\.softora\.nl\/webdesign\/bakkerij-zon" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier<\/a> bekijken 👈/
  );
  assert.doesNotMatch(sentMessages[0].html, /<img src=/);
  assert.doesNotMatch(sentMessages[0].html, /cid:webdesign/);
  assert.doesNotMatch(sentMessages[0].html, /\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(sentMessages[0].attachments, undefined);
});

test('coldmail campaign replaces sender signature variables from the selected mailbox', async () => {
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
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Bakkerij Zon device mockup',
      },
    },
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.example.test',
        smtpPort: 587,
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuwe website voor {{bedrijf}}',
    body: [
      'Goedendag,',
      '',
      'Afgelopen week kwam ik jullie website ({{website}}) tegen.',
      '',
      'Je kunt het webdesign hier bekijken 👈',
      '',
      'Met vriendelijke groet,',
      'Martijn van de Ven',
      '',
      '📍 {{stad}}',
    ].join('\n'),
    senderEmail: 'serve@softora.nl',
    specialAction: 'webdesign',
  });

  assert.equal(result.sent, 1);
  assert.match(sentMessages[0].text, /Met vriendelijke groet,\nServé Creusen\n\n📍 Liempde/);
  assert.doesNotMatch(sentMessages[0].text, /Martijn van de Ven/);
  assert.doesNotMatch(sentMessages[0].text, /📍 Alphen/);
  assert.doesNotMatch(sentMessages[0].text, /📍 Rotterdam/);
});

test('coldmail campaign refuses webdesign outreach when the device mockup is missing', async () => {
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
      assert.match(error.message, /Nog geen website-design klaar voor Bakkerij Zon/);
      assert.equal(error.failedItems[0].email, 'ruben@example.test');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign accepts a webdesign mockup without quality approval metadata', async () => {
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
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Bakkerij Zon device mockup',
        mockupOrientation: 'upside_down',
        mockupQualityStatus: 'unverified',
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
  assert.doesNotMatch(sentMessages[0].html, /cid:webdesign/);
  assert.equal(sentMessages[0].attachments, undefined);
});

test('coldmail campaign accepts a legacy webdesign mockup renderer when a mockup image exists', async () => {
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
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Bakkerij Zon-device-mockup-v7.jpg',
        mockupRenderer: 'softora-server-device-v7',
        mockupOrientation: 'upright',
        mockupQualityStatus: 'checked',
        mockupQualityCheckedAt: '2026-05-28T23:00:00.000Z',
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
  assert.doesNotMatch(sentMessages[0].html, /cid:webdesign/);
  assert.equal(sentMessages[0].attachments, undefined);
});

test('coldmail campaign keeps the closing signature before webdesign photos', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
  const captionIndex = html.indexOf('Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.');
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

test('coldmail campaign starts webdesign preparation for the exact next mailable lead when stock is empty', async () => {
  const preparedJobs = [];
  const { service, sentMessages, getSavedState } = createService({
    rows: [
      {
        id: 'recently-mailed',
        bedrijf: 'Recent Gemaild BV',
        naam: 'Ruben',
        email: 'recent@example.test',
        website: 'recent.example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'prospect-no-photo',
        bedrijf: 'Bakkerij Zonder Foto',
        naam: 'Ruben',
        email: 'info@zonderfoto.nl',
        website: 'zonderfoto.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      recipientEntries: [
        {
          at: '2026-04-24T10:00:00.000Z',
          recipientEmail: 'recent@example.test',
          recipientId: 'recently-mailed',
          senderEmail: 'serve@softora.nl',
        },
      ],
    },
    webdesignPreparationCoordinator: {
      startJob: async (payload) => {
        preparedJobs.push(payload);
        return {
          ok: true,
          job: {
            id: payload.jobId,
            status: 'queued',
            customerId: payload.customer.id,
          },
        };
      },
    },
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
      assert.equal(error.code, 'WEBDESIGN_PREPARATION_QUEUED');
      assert.match(error.message, /Voorbereiding gestart voor Bakkerij Zonder Foto/);
      assert.equal(error.webdesignPreparation.customerId, 'prospect-no-photo');
      assert.equal(error.webdesignPreparation.job.status, 'queued');
      return true;
    }
  );

  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedState(), null);
  assert.equal(preparedJobs.length, 1);
  assert.equal(preparedJobs[0].customer.id, 'prospect-no-photo');
  assert.equal(preparedJobs[0].websiteUrl, 'https://zonderfoto.nl/');
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
        websiteMockup: TINY_PNG_DATA_URL,
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
  const { service, sentMessages } = createService({
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
        websiteMockup: TINY_PNG_DATA_URL,
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
  const mockupPhotoKey = 'mockup-prospect-1';
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
        mockupPhotoKey,
        mockupChunkCount: 1,
        websitePhoto: TINY_PNG_DATA_URL,
      },
    },
    photoValues: {
      softora_database_photos_v1: JSON.stringify({
        'prospect-1': {
          id: 'prospect-1',
          photoKey,
          chunkCount: 1,
          mockupPhotoKey,
          mockupChunkCount: 1,
          websitePhoto: TINY_PNG_DATA_URL,
          mockupRenderer: 'softora-test-device-v8',
          mockupOrientation: 'upright',
          mockupQualityStatus: 'checked',
          mockupQualityCheckedAt: '2026-04-24T12:00:00.000Z',
        },
      }),
      [`${photoKey}_0`]: CHUNKED_PNG_DATA_URL,
      [`${mockupPhotoKey}_0`]: CHUNKED_PNG_DATA_URL,
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
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].content.toString('base64'), 'TQ==');
  assert.equal(sentMessages[0].attachments[1].content.toString('base64'), 'TQ==');
});

test('coldmail campaign uses recovered webdesign chunks over stale inline photo', async () => {
  const photoKey = 'softora_database_photo_data_v1_prospect-1';
  const mockupPhotoKey = 'softora_database_photo_data_v1_prospect-1_mockup';
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
          mockupPhotoKey,
          mockupChunkCount: 1,
          mockupRenderer: 'softora-test-device-v8',
          mockupOrientation: 'upright',
          mockupQualityStatus: 'checked',
          mockupQualityCheckedAt: '2026-04-24T12:00:00.000Z',
        },
      }),
      [`${photoKey}_0`]: CHUNKED_PNG_DATA_URL,
      [`${mockupPhotoKey}_0`]: CHUNKED_PNG_DATA_URL,
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
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].content.toString('base64'), 'TQ==');
  assert.equal(sentMessages[0].attachments[1].content.toString('base64'), 'TQ==');
});

test('coldmail campaign prefers stored design photo records over stale row mockup copies', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
  assert.equal(sentMessages[0].attachments[1].content.toString('base64'), TINY_PNG_DATA_URL.split(',')[1]);
  assert.equal(sentMessages[0].attachments[1].filename, 'Oude-mockup-achtergrond.png');
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

test('coldmail campaign test mode can target the approved Serve inbox too', async () => {
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

  const testRecipientEmails = ['servec321@gmail.com', 'serve@softora.nl'];
  const preview = await service.getColdmailCampaignRecipients({
    count: 10,
    testMode: true,
    testRecipientEmails,
  });

  assert.equal(preview.testMode, true);
  assert.deepEqual(preview.testRecipientEmails, testRecipientEmails);
  assert.equal(preview.selected, 2);
  assert.deepEqual(
    preview.recipients.map((recipient) => recipient.email),
    testRecipientEmails
  );

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test voor {{bedrijf}}',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
    testMode: true,
    testRecipientEmails,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 2);
  assert.equal(result.persisted, 0);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.deepEqual(result.testRecipientEmails, testRecipientEmails);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    testRecipientEmails
  );
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign test mode infers webdesign assets from the mail content safely', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
  assert.match(sentMessages[0].html, /Hieronder zie je een korte indruk van de eerste versie op verschillende schermen\./);
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
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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

test('coldmail campaign makes tall webdesign CID attachments mail-safe before sending', async () => {
  const tallWebdesign = await createTestWebdesignDataUrl(2160, 3840);
  const deviceMockup = await createTestWebdesignDataUrl(1600, 1000);
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'tall-design',
        bedrijf: 'Tall Design BV',
        naam: 'Servé',
        email: 'serve@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'tall-design': {
        id: 'tall-design',
        websitePhoto: tallWebdesign,
        websitePhotoName: 'Tall Design BV webdesign.png',
        websiteMockup: deviceMockup,
        websiteMockupName: 'Tall Design BV device mockup.png',
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuw webdesign',
    body: 'Hoi {{naam}}, ik heb een nieuw webdesign gemaakt.',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].html, /max-height:960px;height:auto;object-fit:contain/);
  assert.equal(sentMessages[0].attachments.length, 2);
  const webdesignAttachment = sentMessages[0].attachments[0];
  assert.equal(webdesignAttachment.contentType, 'image/jpeg');
  const metadata = await sharp(webdesignAttachment.content).metadata();
  assert.equal(metadata.width, 960);
  assert.equal(metadata.height, 1440);
  assert.ok(webdesignAttachment.content.length < 1024 * 1024);
});

test('coldmail campaign test mode can send Softora webdesign attachment to all approved test inboxes', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
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
  const testRecipientEmails = ['servec321@gmail.com', 'serve@softora.nl'];

  const preview = await service.getColdmailCampaignRecipients({
    count: 10,
    testMode: true,
    testRecipientEmails,
    specialAction: 'webdesign',
  });

  assert.equal(preview.testMode, true);
  assert.equal(preview.selected, 2);
  assert.equal(preview.failedItems.length, 0);
  assert.deepEqual(
    preview.recipients.map((recipient) => recipient.email),
    testRecipientEmails
  );

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Test voor {{website}}',
    body: 'Hoi {{naam}}, dit is de test voor {{website}}.',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    testMode: true,
    testRecipientEmails,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 2);
  assert.equal(result.persisted, 0);
  assert.deepEqual(result.testRecipientEmails, testRecipientEmails);
  assert.deepEqual(
    sentMessages.map((message) => message.to),
    testRecipientEmails
  );
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-softora-test-mode-recipient@softora');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-softora-test-mode-recipient@softora');
  assert.equal(sentMessages[1].attachments.length, 2);
  assert.equal(sentMessages[1].attachments[0].cid, 'webdesign-softora-test-mode-recipient-serve-softora-nl@softora');
  assert.equal(sentMessages[1].attachments[1].cid, 'webdesign-mockup-softora-test-mode-recipient-serve-softora-nl@softora');
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign test mode uses the ready Gmail design row when the dedicated id is missing', async () => {
  const { service, sentMessages, getSavedState, getSavedStates } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'serve-ready-design',
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
      'serve-ready-design': {
        id: 'serve-ready-design',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Softora Gmail test webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Softora Gmail test device mockup',
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
  assert.equal(preview.recipients[0].id, 'serve-ready-design');
  assert.equal(preview.recipients[0].email, 'servec321@gmail.com');

  const result = await service.sendColdmailCampaign({
    count: 10,
    subject: 'Nieuw webdesign gemaakt!',
    body: 'Hoi {{naam}}, ik heb een nieuw webdesign gemaakt voor {{website}}.',
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
  assert.equal(sentMessages[0].subject, 'Nieuw webdesign gemaakt!');
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-serve-ready-design@softora"/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-serve-ready-design@softora"/);
  assert.equal(sentMessages[0].attachments.length, 2);
  assert.equal(sentMessages[0].attachments[0].cid, 'webdesign-serve-ready-design@softora');
  assert.equal(sentMessages[0].attachments[1].cid, 'webdesign-mockup-serve-ready-design@softora');
  assert.equal(getSavedState(), null);
  assert.deepEqual(getSavedStates(), []);
});

test('coldmail campaign test mode can look up a ready design row with the common Gmail typo', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'serve-ready-design-typo',
        bedrijf: 'Softora Testmodus',
        naam: 'Servé',
        email: 'servec321@gail.com',
        website: 'softora.nl',
        dom: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    photoMap: {
      'serve-ready-design-typo': {
        id: 'serve-ready-design-typo',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Softora typo lookup webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Softora typo lookup device mockup',
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuw webdesign gemaakt!',
    body: 'Hoi {{naam}}, ik heb een nieuw webdesign gemaakt voor {{website}}.',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    testMode: true,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 1);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-serve-ready-design-typo@softora"/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-serve-ready-design-typo@softora"/);
});

test('coldmail campaign test mode keeps the dedicated test design when identity metadata changed', async () => {
  const { service, sentMessages } = createService({
    env: {
      COLDMAIL_WEBDESIGN_IMAGE_DELIVERY: 'cid',
    },
    rows: [
      {
        id: 'softora-test-mode-recipient',
        bedrijf: 'Softora Testmodus',
        naam: 'Servé',
        email: 'servec321@gmail.com',
        telefoon: '06 29 91 71 85',
        website: 'softora.nl',
        dom: 'softora.nl',
        status: 'benaderbaar',
        mail: true,
      },
    ],
    photoMap: {
      'softora-test-mode-recipient': {
        id: 'softora-test-mode-recipient',
        identityKey: 'softora testmodus|serve|31 00 000 00 00',
        websitePhoto: TINY_PNG_DATA_URL,
        websitePhotoName: 'Softora test webdesign',
        websiteMockup: TINY_PNG_DATA_URL,
        websiteMockupName: 'Softora test device mockup',
      },
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Nieuw webdesign gemaakt!',
    body: 'Hoi {{naam}}, ik heb een nieuw webdesign gemaakt voor {{website}}.',
    senderEmail: 'info@softora.nl',
    specialAction: 'webdesign',
    testMode: true,
  });

  assert.equal(result.testMode, true);
  assert.equal(result.sent, 1);
  assert.equal(result.testRecipientEmail, 'servec321@gmail.com');
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].to, 'servec321@gmail.com');
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-softora-test-mode-recipient@softora"/);
  assert.match(sentMessages[0].html, /<img src="cid:webdesign-mockup-softora-test-mode-recipient@softora"/);
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
    from: { value: [{ address: 'reply@example.test', name: 'Servec Test' }] },
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
  assert.equal(sentMessages[0].to, 'reply@example.test');
  assert.equal(sentMessages[0].subject, 'Re: Nieuw webdesign gemaakt!');
  assert.equal(sentMessages[0].inReplyTo, '<incoming-1@example.test>');
  assert.match(sentMessages[0].text, /Zullen we kort bellen/);
  assert.equal(Object.keys(getReplyState().processed).length, 1);
});

test('coldmail auto-reply does not send while a coldmail safety pause is active', async () => {
  const parsedInbound = {
    messageId: '<incoming-paused@example.test>',
    subject: 'Re: Kleine vraag over jullie website',
    text: 'Hoi Servé, bedankt voor je bericht.',
    from: { value: [{ address: 'reply-paused@example.test', name: 'Paused Prospect' }] },
    to: { value: [{ address: 'serve@softora.nl', name: 'Servé Creusen' }] },
    cc: { value: [] },
    references: '<sent-paused@softora>',
  };
  let openAiCalled = false;
  const { service, sentMessages, getReplyState } = createService({
    imapHost: 'imap.example.test',
    imapUser: 'serve@softora.nl',
    imapPass: 'secret',
    openAiApiKey: 'openai-secret',
    coldmailAutoReplyEnabled: true,
    now: () => new Date('2026-06-08T09:31:00.000Z'),
    sendGuardState: {
      entries: [
        {
          at: '2026-06-08T08:27:00.000Z',
          count: 0,
          senderEmail: '',
          safetyPauseUntil: '2026-06-10T08:28:00.000Z',
          safetyPauseReason: 'manual_coldmail_global_pause_by_serve_duplicate_reports_2026_06_08',
        },
      ],
      recipientEntries: [],
    },
    rows: [
      {
        id: 'prospect-paused',
        bedrijf: 'Paused Prospect BV',
        naam: 'Paused Prospect',
        email: 'reply-paused@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-06-04T10:00:00.000Z',
        lastColdmailSenderEmail: 'serve@softora.nl',
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
    fetchJsonWithTimeout: async () => {
      openAiCalled = true;
      return {
        response: { ok: true, status: 200 },
        data: {
          model: 'gpt-5.5-pro',
          choices: [{ message: { content: 'Dit mag niet verstuurd worden.' } }],
        },
      };
    },
  });

  const result = await service.syncInboundColdmailRepliesFromImap({ force: true, maxMessages: 5 });
  const processed = Object.values(getReplyState().processed)[0];

  assert.equal(result.matched, 1);
  assert.equal(result.replied, 0);
  assert.equal(result.autoReplySkippedSafetyPaused, 1);
  assert.equal(openAiCalled, false);
  assert.equal(sentMessages.length, 0);
  assert.equal(processed.lifecycleIntent, 'auto_reply_skipped_safety_pause');
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

test('coldmail campaign recipient preview does not filter by radius when radius is disabled', async () => {
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
    radiusKm: '',
  });

  assert.equal(result.ok, true);
  assert.equal(result.radiusKm, null);
  assert.equal(result.selected, 2);
  assert.deepEqual(result.recipients.map((recipient) => recipient.bedrijf), ['Oisterwijk Winkel', 'Groningen Studio']);
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
        id: 'helvoirt-1',
        bedrijf: 'Helvoirt Studio',
        email: 'helvoirt@example.test',
        status: 'prospect',
        branche: 'Retail & Winkels',
        adres: 'Lindelaan 15, Helvoirt',
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
  assert.equal(result.selected, 3);
  assert.deepEqual(result.recipients.map((recipient) => recipient.bedrijf), ['Chaam Winkel', 'Alphen Studio', 'Helvoirt Studio']);
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
        websiteMockup: TINY_PNG_DATA_URL,
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
        websiteMockup: TINY_PNG_DATA_URL,
        websitePhotoName: 'Rij Design BV webdesign',
      },
    ],
    photoMap: {
      'stored-ready': {
        id: 'stored-ready',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
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
        websiteMockup: TINY_PNG_DATA_URL,
        websitePhotoName: "'t Jaghthuijs webdesign",
      },
      'old-zon-id': {
        id: 'old-zon-id',
        identityKey: 'bakkerij de zon||0135550000',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
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
          mockupPhotoKey: 'softora_photo_chunked_ready_1_mockup',
          websitePhotoName: 'Chunked Design BV webdesign',
          mockupRenderer: 'softora-test-device-v8',
          mockupOrientation: 'upright',
          mockupQualityStatus: 'checked',
          mockupQualityCheckedAt: '2026-04-24T12:00:00.000Z',
        },
      }),
      softora_photo_chunked_ready_1_0: TINY_PNG_DATA_URL,
      softora_photo_chunked_ready_1_mockup_0: TINY_PNG_DATA_URL,
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
        websiteMockup: TINY_PNG_DATA_URL,
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
    'servecreusen@softora.nl',
    'martijnvandeven@softora.nl',
    'servec321@gmail.com',
    'martijnven123@gmail.com',
    'serve290@gmail.com',
    'servecreusen7@gmail.com',
    'contact.venvisuals@gmail.com',
  ]);
});

test('coldmail campaign caps preview volume to STRATO-safe campaign limit', async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact@prospect-${index + 1}.test`,
    status: 'prospect',
    mail: true,
  }));
  const { service } = createService({ rows });

  const result = await service.getColdmailCampaignRecipients({ count: 100 });

  assert.equal(result.selected, 9);
  assert.equal(result.safetyLimits.campaignSendLimit, 9);
  assert.equal(result.safetyLimits.dailySendLimit, 9);
  assert.equal(result.safetyLimits.packageDailySendLimit, 81);
  assert.equal(result.safetyLimits.personalMailboxDailyLimit, 9);
});

test('coldmail campaign enforces daily sender guard across campaigns', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact@sender-guard-${index + 1}.test`,
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

test('coldmail campaign blocks the same recipient across different sender mailboxes', async () => {
  const rows = [
    {
      id: 'de-hoevens',
      bedrijf: 'Landgoed de Hoevens',
      naam: 'Landgoed de Hoevens',
      email: 'gastenverblijven@dehoevens.nl',
      website: 'dehoevens.nl',
      status: 'prospect',
      mail: true,
    },
  ];
  const mailboxAccountsRaw = JSON.stringify([
    {
      email: 'serve@softora.nl',
      name: 'Servé Creusen',
      smtpHost: 'smtp.strato.test',
      smtpUser: 'serve@softora.nl',
      smtpPass: 'serve-secret',
    },
    {
      email: 'martijn@softora.nl',
      name: 'Martijn van de Ven',
      smtpHost: 'smtp.strato.test',
      smtpUser: 'martijn@softora.nl',
      smtpPass: 'martijn-secret',
    },
  ]);
  const first = createService({
    rows: JSON.parse(JSON.stringify(rows)),
    mailboxAccountsRaw,
  });

  const firstResult = await first.service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(firstResult.sent, 1);
  assert.equal(first.sentMessages[0].to, 'gastenverblijven@dehoevens.nl');
  assert.equal(first.getSendGuardState().entries[0].recipientEmail, 'gastenverblijven@dehoevens.nl');
  assert.equal(first.getSendGuardState().entries[0].recipientDomain, 'dehoevens-nl');

  const second = createService({
    rows: JSON.parse(JSON.stringify(rows)),
    mailboxAccountsRaw,
    sendGuardState: first.getSendGuardState(),
  });

  const preview = await second.service.getColdmailCampaignRecipients({ count: 1 });
  assert.equal(preview.selected, 0);
  assert.equal(preview.failedItems[0].code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
  assert.match(preview.failedItems[0].error, /serve@softora\.nl/);

  await assert.rejects(
    () =>
      second.service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'martijn@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
      assert.match(error.message, /recent al gemaild/);
      return true;
    }
  );
  assert.equal(second.sentMessages.length, 0);
});

test('coldmail campaign blocks prior recipient domains even when the next row has no website field', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'de-hoevens-reimport',
        bedrijf: 'Landgoed de Hoevens',
        naam: 'Landgoed de Hoevens',
        email: 'info@dehoevens.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      entries: [],
      recipientEntries: [
        {
          at: '2026-05-25T13:20:00.000Z',
          senderEmail: 'servec321@gmail.com',
          recipientKey: 'email:gastenverblijven@dehoevens.nl',
          recipientEmail: 'gastenverblijven@dehoevens.nl',
          recipientDomain: 'dehoevens-nl',
          recipientCompanyKey: 'landgoed-de-hoevens',
          recipientCompany: 'Landgoed de Hoevens',
          permanent: true,
        },
      ],
    },
  });

  const preview = await service.getColdmailCampaignRecipients({ count: 1 });

  assert.equal(preview.selected, 0);
  assert.equal(preview.failedItems[0].code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
  assert.match(preview.failedItems[0].error, /eerder gemaild/);

  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign blocks the same company even when the email address differs', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'same-company-new-mailbox',
        bedrijf: 'Cafetaria De Bank',
        naam: 'Cafetaria De Bank',
        email: 'contact@cafetariadebank.nl',
        website: 'https://cafetariadebank.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      entries: [],
      recipientEntries: [
        {
          at: '2026-06-05T17:32:00.000Z',
          senderEmail: 'martijnven@websoftora.com',
          recipientKey: 'email:info@cafetariadebank.nl',
          recipientEmail: 'info@cafetariadebank.nl',
          recipientDomain: 'cafetariadebank-nl',
          recipientCompanyKey: 'cafetaria-de-bank',
          recipientCompany: 'Cafetaria De Bank',
          provider: 'instantly',
          permanent: true,
        },
      ],
    },
  });

  const preview = await service.getColdmailCampaignRecipients({ count: 1 });
  assert.equal(preview.selected, 0);
  assert.equal(preview.failedItems[0].code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
  assert.match(preview.failedItems[0].error, /Instantly/);

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
      assert.match(error.message, /Instantly/);
      return true;
    }
  );
  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign blocks recipients already reserved in the central outbound guard', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'central-guard-row',
        bedrijf: 'Cafetaria De Bank',
        naam: 'Cafetaria De Bank',
        email: 'info@cafetariadebank.nl',
        website: 'https://cafetariadebank.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => ({
        guard_key: 'email:info@cafetariadebank.nl',
        provider: 'instantly',
        recipient_email: 'info@cafetariadebank.nl',
        recipient_domain: 'cafetariadebank-nl',
        recipient_company_key: 'cafetaria-de-bank',
        recipient_company: 'Cafetaria De Bank',
        permanent: true,
        source: 'instantly-safe-manual-upload',
      }),
    },
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
      assert.match(error.message, /Instantly/);
      return true;
    }
  );
  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign stops before SMTP and safety-pauses when the central outbound guard is unavailable', async () => {
  const { service, sentMessages, getSavedStates, getSendGuardState } = createService({
    outboundRecipientGuardStore: null,
    rows: [
      {
        id: 'unguarded-row',
        bedrijf: 'Geen Guard BV',
        naam: 'Geen Guard BV',
        email: 'info@geenguard.example',
        website: 'https://geenguard.example',
        status: 'prospect',
        mail: true,
      },
    ],
    coldmailSafetyPauseMs: 60_000,
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SAFETY_PAUSED');
      assert.match(error.message, /Centrale outbound duplicate-guard ontbreekt/);
      return true;
    }
  );
  assert.equal(sentMessages.length, 0);
  assert.equal(getSavedStates().some((state) => state.scope === 'premium_coldmail_send_guard'), true);
  assert.equal(getSendGuardState().entries[0].count, 0);
  assert.equal(getSendGuardState().entries[0].safetyPauseReason, 'central_outbound_guard_preflight_failed');
});

test('coldmail campaign reserves the recipient centrally before SMTP send and confirms after accept', async () => {
  const calls = [];
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'reservation-row',
        bedrijf: 'Reservation BV',
        naam: 'Reservation BV',
        email: 'info@reservation.example',
        website: 'https://reservation.example',
        status: 'prospect',
        mail: true,
      },
    ],
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => null,
      reserveRecipients: async (items, options) => {
        calls.push({ type: 'reserve', items, options });
        return { ok: true, reservationId: 'reservation-1', count: items.length * 4, expectedCount: items.length * 4 };
      },
      confirmReservation: async (reservationId, options) => {
        calls.push({ type: 'confirm', reservationId, options });
        return { ok: true, count: 4 };
      },
    },
    onSendMail: async () => {
      calls.push({ type: 'smtp' });
    },
    onSetUiStateValues: async ({ scope }) => {
      calls.push({ type: `state:${scope}` });
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages.length, 1);
  assert.equal(calls[0].type, 'reserve');
  assert.equal(calls[0].items[0].recipientEmail, 'info@reservation.example');
  assert.equal(calls[0].options.provider, 'softora');
  assert.equal(calls[0].options.channel, 'coldmail');
  assert.equal(calls[0].options.permanent, true);
  assert.equal(calls[1].type, 'smtp');
  assert.equal(calls[2].type, 'confirm');
  assert.equal(calls[2].reservationId, 'reservation-1');
  assert.equal(calls[2].options.status, 'sent');
  assert.equal(calls[2].options.permanent, true);
  const confirmIndex = calls.findIndex((call) => call.type === 'confirm');
  const sendGuardWriteIndex = calls.findIndex((call) => call.type === 'state:premium_coldmail_send_guard');
  const customerWriteIndex = calls.findIndex((call) => call.type === 'state:premium_customers_database');
  assert.ok(sendGuardWriteIndex > confirmIndex);
  assert.ok(customerWriteIndex > confirmIndex);
});

test('coldmail campaign pauses immediately when central guard confirm fails after SMTP accept', async () => {
  const calls = [];
  const { service, sentMessages, getSavedStates, getSendGuardState } = createService({
    rows: [
      {
        id: 'confirm-fail-row',
        bedrijf: 'Confirm Fail BV',
        naam: 'Confirm Fail BV',
        email: 'info@confirm-fail.example',
        website: 'https://confirm-fail.example',
        status: 'prospect',
        mail: true,
      },
    ],
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => null,
      reserveRecipients: async (items, options) => {
        calls.push({ type: 'reserve', items, options });
        return { ok: true, reservationId: 'reservation-fails', count: items.length * 4, expectedCount: items.length * 4 };
      },
      confirmReservation: async () => {
        calls.push({ type: 'confirm' });
        throw new Error('Supabase confirm timeout');
      },
    },
    onSendMail: async () => {
      calls.push({ type: 'smtp' });
    },
    onSetUiStateValues: async ({ scope }) => {
      calls.push({ type: `state:${scope}` });
    },
    coldmailSafetyPauseMs: 60_000,
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SAFETY_PAUSED');
      assert.match(error.message, /Centrale outbound duplicate-guard kon niet permanent worden bevestigd/);
      return true;
    }
  );

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.type), ['reserve', 'smtp', 'confirm']);
  assert.equal(calls[0].options.permanent, true);
  assert.equal(getSavedStates().some((state) => state.scope === 'premium_customers_database'), false);
  assert.equal(getSavedStates().some((state) => state.scope === 'premium_coldmail_send_guard'), true);
  assert.equal(getSendGuardState().entries[0].count, 0);
  assert.equal(getSendGuardState().entries[0].safetyPauseReason, 'central_outbound_guard_confirm_failed');
});

test('coldmail campaign pauses when central guard confirm updates no rows after SMTP accept', async () => {
  const calls = [];
  const { service, sentMessages, getSavedStates, getSendGuardState } = createService({
    rows: [
      {
        id: 'confirm-empty-row',
        bedrijf: 'Confirm Empty BV',
        naam: 'Confirm Empty BV',
        email: 'info@confirm-empty.example',
        website: 'https://confirm-empty.example',
        status: 'prospect',
        mail: true,
      },
    ],
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => null,
      reserveRecipients: async (items, options) => {
        calls.push({ type: 'reserve', items, options });
        return { ok: true, reservationId: 'reservation-empty', count: items.length * 4, expectedCount: items.length * 4 };
      },
      confirmReservation: async () => {
        calls.push({ type: 'confirm' });
        return { ok: false, reason: 'reservation_not_found', count: 0 };
      },
    },
    onSendMail: async () => {
      calls.push({ type: 'smtp' });
    },
    onSetUiStateValues: async ({ scope }) => {
      calls.push({ type: `state:${scope}` });
    },
    coldmailSafetyPauseMs: 60_000,
  });

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_SAFETY_PAUSED');
      assert.match(error.message, /Centrale outbound duplicate-guard kon niet permanent worden bevestigd/);
      return true;
    }
  );

  assert.equal(sentMessages.length, 1);
  assert.deepEqual(calls.slice(0, 3).map((call) => call.type), ['reserve', 'smtp', 'confirm']);
  assert.equal(getSavedStates().some((state) => state.scope === 'premium_customers_database'), false);
  assert.equal(getSendGuardState().entries[0].safetyPauseReason, 'central_outbound_guard_confirm_failed');
});

test('coldmail campaign keeps old Instantly recipient guards permanently', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'old-instantly-row',
        bedrijf: 'Old Instantly Company',
        naam: 'Old Instantly Company',
        email: 'old-instantly@example.test',
        website: 'old-instantly.example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      entries: [],
      recipientEntries: [
        {
          at: '2026-01-10T09:00:00.000Z',
          senderEmail: 'martijnven@websoftora.com',
          recipientKey: 'email:old-instantly@example.test',
          recipientEmail: 'old-instantly@example.test',
          recipientDomain: 'old-instantly-example-test',
          recipientCompanyKey: 'old-instantly-company',
          recipientId: 'old-instantly-row',
          recipientCompany: 'Old Instantly Company',
          source: 'instantly-backfill',
          provider: 'instantly',
          campaignId: 'campaign-1',
          leadId: 'lead-1',
        },
      ],
    },
  });

  const preview = await service.getColdmailCampaignRecipients({ count: 1 });
  assert.equal(preview.selected, 0);
  assert.equal(preview.failedItems[0].code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
  assert.match(preview.failedItems[0].error, /al eerder gemaild/);

  await assert.rejects(
    () =>
      service.sendColdmailCampaign({
        count: 1,
        subject: 'Kleine vraag over jullie website',
        body: 'Goedendag {{naam}}',
        senderEmail: 'info@softora.nl',
      }),
    (error) => {
      assert.equal(error.code, 'COLDMAIL_RECIPIENT_RECENTLY_SENT');
      assert.match(error.message, /al eerder gemaild/);
      return true;
    }
  );
  assert.equal(sentMessages.length, 0);
});

test('coldmail campaign expires old non-permanent recipient guards', async () => {
  const { service, sentMessages } = createService({
    rows: [
      {
        id: 'old-normal-row',
        bedrijf: 'Old Normal Company',
        naam: 'Old Normal Company',
        email: 'old-normal@example.test',
        website: 'old-normal.example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      entries: [],
      recipientEntries: [
        {
          at: '2026-01-10T09:00:00.000Z',
          senderEmail: 'serve@softora.nl',
          recipientKey: 'email:old-normal@example.test',
          recipientEmail: 'old-normal@example.test',
          recipientDomain: 'old-normal-example-test',
          recipientCompanyKey: 'old-normal-company',
          recipientId: 'old-normal-row',
          recipientCompany: 'Old Normal Company',
        },
      ],
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(sentMessages[0].to, 'old-normal@example.test');
});

test('coldmail campaign deduplicates copied recipient guard entries when saving', async () => {
  const oldRecipient = {
    at: '2026-04-24T11:00:00.000Z',
    senderEmail: 'serve@softora.nl',
    count: 1,
    personalCount: 0,
    recipientKey: 'email:old@example.test',
    recipientEmail: 'old@example.test',
    recipientDomain: 'example-test',
    recipientCompanyKey: 'old-company',
    recipientId: 'old-row',
    recipientCompany: 'Old Company',
  };
  const { service, getSendGuardState } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.test',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    rows: [
      {
        id: 'new-row',
        bedrijf: 'New Company',
        naam: 'New Company',
        email: 'new@example.test',
        website: 'new.example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: {
      entries: [oldRecipient],
      recipientEntries: [oldRecipient, oldRecipient],
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(result.sent, 1);
  const recipientEntries = getSendGuardState().recipientEntries;
  assert.equal(
    recipientEntries.filter((entry) => entry.recipientEmail === 'old@example.test').length,
    1
  );
  assert.equal(
    recipientEntries.filter((entry) => entry.recipientEmail === 'new@example.test').length,
    1
  );
});

test('coldmail campaign merges persisted send guard while saving after a stale read', async () => {
  const oldRecipient = {
    at: '2026-04-24T11:00:00.000Z',
    senderEmail: 'serve@softora.nl',
    count: 1,
    personalCount: 0,
    recipientKey: 'email:old@example.test',
    recipientEmail: 'old@example.test',
    recipientDomain: 'example-test',
    recipientCompanyKey: 'old-company',
    recipientId: 'old-row',
    recipientCompany: 'Old Company',
  };
  const emptyRead = { entries: [], recipientEntries: [] };
  const persistedRead = { entries: [oldRecipient], recipientEntries: [oldRecipient] };
  const { service, getSendGuardState } = createService({
    mailboxAccountsRaw: JSON.stringify([
      {
        email: 'serve@softora.nl',
        name: 'Servé Creusen',
        smtpHost: 'smtp.strato.test',
        smtpUser: 'serve@softora.nl',
        smtpPass: 'serve-secret',
      },
    ]),
    rows: [
      {
        id: 'new-row',
        bedrijf: 'New Company',
        naam: 'New Company',
        email: 'new@example.test',
        website: 'new.example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    sendGuardState: persistedRead,
    sendGuardReadStates: [
      persistedRead,
      persistedRead,
      emptyRead,
      persistedRead,
    ],
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(result.sent, 1);
  const entries = getSendGuardState().entries;
  assert.equal(entries.filter((entry) => entry.recipientEmail === 'old@example.test').length, 1);
  assert.equal(entries.filter((entry) => entry.recipientEmail === 'new@example.test').length, 1);
});

test('coldmail campaign does not mark daily-limit skipped rows as mailed', async () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `prospect-${index + 1}`,
    bedrijf: `Prospect ${index + 1}`,
    naam: `Contact ${index + 1}`,
    email: `contact@daily-limit-${index + 1}.test`,
    status: 'prospect',
    databaseStatus: 'prospect',
    mail: true,
  }));
  const { service, sentMessages, getSavedState } = createService({
    rows,
    coldmailCampaignSendLimit: 9,
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
    ['contact@daily-limit-1.test', 'contact@daily-limit-2.test']
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
  const { service, sentMessages } = createService({
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
  const parsedSentCopy = await simpleParser(appendedMessages[0].raw);
  assert.doesNotMatch(sentMessages[0].html, /\/api\/coldmailing\/open\.gif\?/);
  assert.doesNotMatch(String(parsedSentCopy.html || ''), /\/api\/coldmailing\/open\.gif\?/);
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

test('coldmail campaign does not append a duplicate sent copy for Gmail senders', async () => {
  const appendedMessages = [];
  const client = {
    usable: true,
    async connect() {},
    async list() {
      return [{ path: '[Gmail]/Sent Mail', specialUse: '\\Sent' }];
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
        email: 'servec321@gmail.com',
        name: 'Servé Creusen',
        smtpHost: 'smtp.gmail.com',
        smtpPort: 465,
        smtpSecure: true,
        smtpUser: 'servec321@gmail.com',
        smtpPass: 'gmail-secret',
        imapHost: 'imap.gmail.com',
        imapPort: 993,
        imapSecure: true,
        imapUser: 'servec321@gmail.com',
        imapPass: 'gmail-secret',
      },
    ]),
    createImapClient: () => client,
  });

  const result = await service.sendColdmailCampaign({
    count: 1,
    subject: 'Kleine vraag over jullie website',
    body: 'Goedendag {{naam}}',
    senderEmail: 'servec321@gmail.com',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.sentItems[0].sentCopySaved, false);
  assert.equal(appendedMessages.length, 0);
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

test('coldmail campaign stops the next message when a safety pause appears during a batch', async () => {
  const { service, sentMessages } = createService({
    rows: [
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
        id: 'prospect-2',
        bedrijf: 'Kapsalon Luna',
        naam: 'Luna',
        email: 'luna@example.test',
        status: 'prospect',
        branche: 'Horeca & Restaurants',
        mail: true,
      },
    ],
    onSendMail: ({ sentMessages, setSendGuardState }) => {
      if (sentMessages.length !== 1) return;
      setSendGuardState({
        entries: [
          {
            at: '2026-04-24T12:00:00.000Z',
            senderEmail: '',
            count: 0,
            personalCount: 0,
            safetyPauseUntil: '2026-04-24T13:00:00.000Z',
            safetyPauseReason: 'Noodstop tijdens actieve batch.',
          },
        ],
      });
    },
  });

  const result = await service.sendColdmailCampaign({
    count: 2,
    subject: 'Test',
    body: 'Hoi {{naam}}',
    senderEmail: 'info@softora.nl',
  });

  assert.equal(result.sent, 1);
  assert.equal(result.safetyPaused, true);
  assert.equal(sentMessages.length, 1);
  assert.match(result.failedItems[0].error, /tijdelijk op pauze/);
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
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].databaseStatus, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailInvalidEmailDomain, 'mcvecommerce.nl');
  assert.equal(savedRows[0].hist[0].source, 'coldmail-invalid-email-domain');
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
  const savedRows = JSON.parse(getSavedState().values.softora_customers_premium_v1);
  assert.equal(savedRows[0].status, 'geblokkeerd');
  assert.equal(savedRows[0].mail, false);
  assert.equal(savedRows[0].canMail, false);
  assert.equal(savedRows[0].doNotMail, true);
  assert.equal(savedRows[0].coldmailInvalidEmailDomain, 'mcvecommerce.nl');
  assert.equal(savedRows[0].hist[0].source, 'coldmail-invalid-email-domain');
});
