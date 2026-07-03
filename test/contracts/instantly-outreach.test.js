const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { createInstantlyOutreachService } = require('../../server/services/instantly-outreach');
const {
  buildChunkedStatePatch,
  readChunkedStateValue,
} = require('../../server/services/data-ops-serialization');
const {
  clearPreviewImageCache,
  getCachedPreviewImage,
  getPreviewImageCacheKey,
} = require('../../server/services/coldmail-preview-image-cache');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64');

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

function withCheckedMockupMeta(item) {
  if (!item || typeof item !== 'object' || !item.websiteMockup) return item;
  if (item.mockupQualityStatus || item.mockupOrientation) return item;
  return {
    ...item,
    mockupRenderer: 'softora-test-device-v8',
    mockupOrientation: 'upright',
    mockupQualityStatus: 'checked',
    mockupQualityCheckedAt: '2026-04-24T12:00:00.000Z',
  };
}

function createRequest({ body = {}, secret = 'webhook-secret' } = {}) {
  return {
    body,
    headers: {
      'x-instantly-webhook-secret': secret,
    },
    get(name) {
      return this.headers[String(name || '').toLowerCase()] || '';
    },
  };
}

function extractPreviewImageTokens(html) {
  const matches = [...String(html || '').matchAll(/\/coldmailing\/webdesign-foto\?t=([^"&\s]+)/g)];
  return matches.map((match) => decodeURIComponent(match[1]));
}

function extractImageTags(html) {
  return [...String(html || '').matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
}

function assertInstantlyHtmlUsesReadableWidth(html) {
  assert.match(html, /<div style="max-width:580px;margin:0;">/);
}

function assertInstantlyHtmlUsesVisibleWebdesignImages(html, expectedPath = '/webdesign/bakkerij-zon?cid=prospect-1&sender=serve') {
  assertInstantlyHtmlUsesReadableWidth(html);
  const imageTags = extractImageTags(html);
  assert.equal(imageTags.length, 2);
  assert.match(imageTags[0], /alt="Webdesign"/);
  assert.match(imageTags[0], /src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(imageTags[1], /alt="Mockup"/);
  assert.match(imageTags[1], /src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(html, /Beste lezer/);
  const escapedExpectedPath = expectedPath
    .replace(/&/g, '&amp;')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(html, new RegExp(escapedExpectedPath));
  assert.match(html, /Hieronder zie je een korte indruk van de eerste versie op verschillende schermen\./);
  assert.doesNotMatch(html, /PS: Wordt het webdesign niet zichtbaar|device mockup/i);
}

function createService(overrides = {}) {
  clearPreviewImageCache();
  let rows = overrides.rows || [
    {
      id: 'prospect-1',
      bedrijf: 'Bakkerij Zon',
      naam: 'Ruben Bakker',
      email: 'ruben@example.test',
      website: 'https://bakkerijzon.test',
      status: 'prospect',
      mail: true,
    },
  ];
  const photoMap = Object.fromEntries(Object.entries(overrides.photoMap || {
    'prospect-1': {
      id: 'prospect-1',
      websitePhoto: TINY_PNG_DATA_URL,
      websiteMockup: TINY_PNG_DATA_URL,
      websitePhotoName: 'Bakkerij Zon webdesign',
      websiteMockupName: 'Bakkerij Zon device mockup',
    },
  }).map(([key, value]) => [key, withCheckedMockupMeta(value)]));
  const coldmailingSettings = overrides.coldmailingSettings || {
    senderEmail: 'serve@softora.nl',
    senders: {
      'serve@softora.nl': {
        subject: 'Nieuw webdesign gemaakt!',
        body:
          'Goedemorgen {{naam}}\n\nIk ben benieuwd wat je ervan vindt.\n\nMet vriendelijke groeten:\nServé Creusen\n\n📍 {{stad}}\n\n0629917185',
      },
    },
  };
  const autopilotState = overrides.autopilotState || {};
  let customerValues =
    overrides.customerValues || {
      softora_customers_premium_v1: JSON.stringify(rows),
    };
  const scopeValues = new Map();
  let coldmailSendGuardReadIndex = 0;
  if (overrides.coldmailSendGuard) {
    scopeValues.set('premium_coldmail_send_guard', {
      softora_coldmail_send_guard_v1: JSON.stringify(overrides.coldmailSendGuard),
    });
  }
  const fetchCalls = [];
  const publicImageFetchCalls = [];
  const writes = [];
  const outboundGuardCalls = [];
  const defaultOutboundRecipientGuardStore = {
    findRecipientConflict: async () => null,
    reserveRecipients: async (items, options) => {
      outboundGuardCalls.push({ type: 'reserve', items, options });
      return {
        ok: true,
        reservationId: `instantly-reservation-${outboundGuardCalls.length}`,
        count: (Array.isArray(items) ? items.length : 0) * 4,
        expectedCount: (Array.isArray(items) ? items.length : 0) * 4,
      };
    },
  };
  const service = createInstantlyOutreachService({
    instantlyConfig: {
      enabled: true,
      syncEnabled: overrides.syncEnabled === undefined ? true : overrides.syncEnabled,
      schedulerEnabled: false,
      apiKey: 'instantly-key',
      apiBaseUrl: 'https://api.instantly.test/api/v2',
      defaultCampaignId: 'campaign-1',
      webhookSecret: 'webhook-secret',
      intervalMinutes: 15,
      batchSize: overrides.batchSize || 10,
      dailyCap: overrides.dailyCap || 25,
      verifyLeadsOnImport: Boolean(overrides.verifyLeadsOnImport),
      blockPersonalMailboxDomains:
        overrides.blockPersonalMailboxDomains === undefined
          ? true
          : overrides.blockPersonalMailboxDomains,
      requireWebdesignAssets:
        overrides.requireWebdesignAssets === undefined
          ? true
          : overrides.requireWebdesignAssets,
      prewarmPublicImageUrls:
        overrides.prewarmPublicImageUrls === undefined
          ? true
          : overrides.prewarmPublicImageUrls,
      publicBaseUrl: overrides.publicBaseUrl || 'https://www.softora.nl',
      previewImageBaseUrl: overrides.previewImageBaseUrl,
      coldmailLinkSecret: 'unsubscribe-secret',
      coldmailPreviewImageSecret: overrides.coldmailPreviewImageSecret,
      defaultSenderEmail: overrides.defaultSenderEmail || 'serve@softora.nl',
    },
    outboundRecipientGuardStore:
      overrides.outboundRecipientGuardStore === undefined
        ? defaultOutboundRecipientGuardStore
        : overrides.outboundRecipientGuardStore,
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return {
          values: {
            softora_database_photos_v1: JSON.stringify(photoMap),
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
      if (scope === 'premium_coldmail_autopilot') {
        return {
          values: {
            softora_coldmail_autopilot_v1: JSON.stringify(autopilotState),
          },
        };
      }
      if (scope === 'premium_coldmail_send_guard' && Array.isArray(overrides.coldmailSendGuardSequence)) {
        const index = Math.min(coldmailSendGuardReadIndex, overrides.coldmailSendGuardSequence.length - 1);
        coldmailSendGuardReadIndex += 1;
        return {
          values: {
            softora_coldmail_send_guard_v1: JSON.stringify(overrides.coldmailSendGuardSequence[index] || {}),
          },
        };
      }
      if (scopeValues.has(scope)) {
        return {
          values: scopeValues.get(scope),
        };
      }
      return {
        values: customerValues,
      };
    },
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      if (scope !== 'premium_customers_database') {
        scopeValues.set(scope, values);
        return { ok: true };
      }
      customerValues = values;
      rows = JSON.parse(readChunkedStateValue(values, 'softora_customers_premium_v1') || '[]');
      return { ok: true };
    },
    fetchJsonWithTimeout: async (url, options, timeoutMs) => {
      if (url === 'https://api.instantly.test/api/v2/leads/list') {
        return {
          response: { ok: true, status: 200 },
          data: {
            items: Array.isArray(overrides.remoteInstantlyLeads) ? overrides.remoteInstantlyLeads : [],
            next_starting_after: '',
          },
        };
      }
      fetchCalls.push({ url, options, timeoutMs });
      if (typeof overrides.fetchJsonWithTimeout === 'function') {
        return overrides.fetchJsonWithTimeout(url, options, timeoutMs, fetchCalls.length);
      }
      return {
        response: { ok: true, status: 200 },
        data:
          overrides.instantlyResponse || {
            created_leads: [{ id: 'instantly-lead-1', email: 'ruben@example.test' }],
          },
      };
    },
    fetchImageWithTimeout: overrides.fetchImageWithTimeout,
    fetchPublicPreviewImage: async (url, timeoutMs) => {
      publicImageFetchCalls.push({ url, timeoutMs });
      if (typeof overrides.fetchPublicPreviewImage === 'function') {
        return overrides.fetchPublicPreviewImage(url, timeoutMs, publicImageFetchCalls.length);
      }
      return { ok: true, status: 200, contentType: 'image/jpeg', bytes: 1234 };
    },
    resolveEmailDomain: async (domain) => !new Set(overrides.invalidDomains || []).has(domain),
    now: () => new Date(overrides.now || '2026-05-25T10:00:00.000Z'),
  });

  return {
    service,
    fetchCalls,
    publicImageFetchCalls,
    outboundGuardCalls,
    getRows: () => rows,
    writes,
  };
}

test('instantly sync pushes eligible Softora leads only after central guard reservation', async () => {
  const { service, fetchCalls, outboundGuardCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'customer-1',
        bedrijf: 'Klant BV',
        email: 'klant@example.test',
        status: 'klant',
        mail: true,
      },
      {
        id: 'synced-1',
        bedrijf: 'Al Gesynct BV',
        email: 'synced@example.test',
        status: 'prospect',
        mail: true,
        instantlyStatus: 'synced',
        instantlyCampaignId: 'campaign-1',
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  assert.equal(outboundGuardCalls.length, 1);
  assert.equal(outboundGuardCalls[0].items[0].recipientEmail, 'ruben@example.test');
  assert.equal(outboundGuardCalls[0].options.provider, 'instantly');
  assert.equal(outboundGuardCalls[0].options.source, 'instantly-sync');
  assert.equal(result.markedBenaderd, 2);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.instantly.test/api/v2/leads/add');
  assert.equal(fetchCalls[0].timeoutMs, 30_000);
  assert.equal(fetchCalls[0].options.headers.Authorization, 'Bearer instantly-key');
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.campaign_id, 'campaign-1');
  assert.equal(body.skip_if_in_workspace, true);
  assert.equal(body.skip_if_in_campaign, true);
  assert.equal(body.verify_leads_on_import, false);
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].email, 'ruben@example.test');
  assert.equal(body.leads[0].custom_variables.softora_customer_id, 'prospect-1');
  assert.equal(body.leads[0].custom_variables.softora_subject, 'Nieuw webdesign gemaakt!');
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Beste lezer/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /website \(bakkerijzon\.test\) tegen/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Je kunt je webdesign hier bekijken 👈/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Servé Creusen/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /📍 uw regio/);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_mail_body, /PS: Wordt het webdesign niet zichtbaar/);
  assert.equal(body.leads[0].custom_variables.softora_city_with_pin, '📍 uw regio');
  assert.equal(
    body.leads[0].custom_variables.softora_image_visibility_ps,
    'PS: Wordt het webdesign niet zichtbaar?\nOpen het via hier 👈'
  );
  assert.equal(body.leads[0].custom_variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon?cid=prospect-1&sender=serve');
  assert.equal(body.leads[0].custom_variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=serve');
  assert.match(body.leads[0].custom_variables.softora_instantly_email_body, /Geen webdesign willen ontvangen/);
  assertInstantlyHtmlUsesVisibleWebdesignImages(body.leads[0].custom_variables.softora_instantly_email_html);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_instantly_email_html, /Bakkerij Zon device mockup/);
  const previewTokens = [
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_image_url),
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_mockup_url),
  ];
  assert.equal(previewTokens.length, 2);
  assert.notEqual(previewTokens[0], previewTokens[1]);
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[0], 'webdesign')).contentType, 'image/png');
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[1], 'mockup')).contentType, 'image/png');
  assert.match(body.leads[0].custom_variables.softora_webdesign_image_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(body.leads[0].custom_variables.softora_webdesign_mockup_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(body.leads[0].custom_variables.softora_webdesign_ready, 'true');
  assert.equal(body.leads[0].custom_variables.softora_instantly_email_text, body.leads[0].custom_variables.softora_instantly_email_body);
  assert.equal(body.leads[0].personalization, body.leads[0].custom_variables.softora_instantly_email_html);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].scope, 'premium_coldmail_send_guard');
  assert.equal(writes[0].meta.source, 'instantly-sync');
  const guardState = JSON.parse(writes[0].values.softora_coldmail_send_guard_v1);
  assert.equal(guardState.recipientEntries.length, 1);
  assert.equal(guardState.recipientEntries[0].provider, 'instantly');
  assert.equal(guardState.recipientEntries[0].permanent, true);
  assert.equal(guardState.recipientEntries[0].recipientEmail, 'ruben@example.test');
  assert.equal(guardState.recipientEntries[0].campaignId, 'campaign-1');
  assert.equal(guardState.recipientEntries[0].leadId, 'instantly-lead-1');
  assert.equal(writes[1].scope, 'premium_customers_database');
  const rows = getRows();
  assert.equal(rows[0].instantlyLeadId, 'instantly-lead-1');
  assert.equal(rows[0].instantlyStatus, 'synced');
  assert.equal(rows[0].lastColdmailProvider, 'instantly');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[0].status, 'gemaild');
  assert.equal(rows[0].outreachStatus, 'benaderd');
  assert.equal(rows[0].lastMailSentAt, undefined);
  assert.equal(rows[2].databaseStatus, 'gemaild');
  assert.equal(rows[2].outreachStatus, 'benaderd');
});

test('instantly sync stops before Instantly API when the central outbound guard is unavailable', async () => {
  const { service, fetchCalls, writes } = createService({
    outboundRecipientGuardStore: null,
  });

  await assert.rejects(
    () => service.syncInstantlyLeads({ actor: 'Test' }),
    (error) => {
      assert.equal(error.code, 'INSTANTLY_OUTBOUND_GUARD_UNAVAILABLE');
      assert.equal(error.status, 503);
      assert.match(error.message, /Centrale outbound duplicate-guard ontbreekt/);
      return true;
    }
  );
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
});

test('safe Instantly upload prepares CSV only after reserving leads and permanent guards', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'prospect-2',
        bedrijf: 'Slagerij Maan',
        naam: 'Luna Slager',
        email: 'luna@example.test',
        website: 'https://slagerijmaan.test',
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
      'prospect-2': {
        id: 'prospect-2',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    uploadId: 'upload-test',
    limit: 2,
  });

  assert.equal(result.ok, true);
  assert.equal(result.prepared, 2);
  assert.equal(result.markedBenaderd, 2);
  assert.equal(result.permanentGuards, 2);
  assert.equal(result.campaignId, 'campaign-manual');
  assert.equal(result.fileName, 'softora-instantly-2-leads-upload-test.csv');
  assert.match(result.csv, /^email,first_name,last_name,company_name/);
  assert.match(result.csv, /"ruben@example\.test"/);
  assert.match(result.csv, /"luna@example\.test"/);
  assert.match(result.csv, /softora_customer_id/);
  assert.equal(fetchCalls.length, 0, 'manual upload preparation must not call Instantly API');

  assert.equal(writes.length, 2);
  assert.equal(writes[0].scope, 'premium_coldmail_send_guard');
  assert.equal(writes[0].meta.source, 'instantly-safe-manual-upload');
  const guardState = JSON.parse(writes[0].values.softora_coldmail_send_guard_v1);
  assert.equal(guardState.recipientEntries.length, 2);
  assert.deepEqual(
    guardState.recipientEntries.map((entry) => entry.recipientEmail),
    ['ruben@example.test', 'luna@example.test']
  );
  assert.ok(guardState.recipientEntries.every((entry) => entry.provider === 'instantly'));
  assert.ok(guardState.recipientEntries.every((entry) => entry.permanent === true));
  assert.ok(guardState.recipientEntries.every((entry) => entry.campaignId === 'campaign-manual'));

  assert.equal(writes[1].scope, 'premium_customers_database');
  const rows = getRows();
  assert.equal(rows[0].lastColdmailProvider, 'instantly');
  assert.equal(rows[0].instantlyStatus, 'queued');
  assert.equal(rows[0].instantlyManualUploadId, 'upload-test');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[1].lastColdmailProvider, 'instantly');
  assert.equal(rows[1].instantlyStatus, 'queued');
  assert.equal(rows[1].databaseStatus, 'gemaild');
});

test('safe Instantly upload stores the explicit sender persona in CSV, guards and customer rows', async () => {
  const { service, writes, getRows, outboundGuardCalls } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Boxtel',
        status: 'prospect',
        mail: true,
      },
    ],
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'serve@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: 'Goedendag,\n\nMet vriendelijke groet,\nServé Creusen\n\n{{stad}}',
        },
        'martijn@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: 'Goedendag,\n\nMet vriendelijke groet,\nMartijn van de Ven\n\n{{stad}}',
        },
      },
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-martijn',
    uploadId: 'upload-martijn',
    limit: 1,
    senderProfile: 'martijn',
    senderEmail: 'martijn@websoftora.com',
  });

  assert.equal(result.ok, true);
  assert.equal(result.senderProfileKey, 'martijn');
  assert.equal(result.senderName, 'Martijn van de Ven');
  assert.equal(result.senderEmail, 'martijn@websoftora.com');
  assert.match(result.csv, /softora_sender_profile/);
  assert.match(result.csv, /"martijn"/);
  assert.match(result.csv, /"Martijn van de Ven"/);
  assert.match(result.csv, /"martijn@websoftora\.com"/);
  assert.match(result.csv, /Met vriendelijke groet,\nMartijn van de Ven\n\n📍 Boxtel/);
  assert.doesNotMatch(result.csv, /Servé Creusen/);

  assert.equal(outboundGuardCalls.length, 1);
  assert.equal(outboundGuardCalls[0].options.senderEmail, 'martijn@websoftora.com');
  assert.equal(outboundGuardCalls[0].options.payload.senderProfileKey, 'martijn');
  assert.equal(outboundGuardCalls[0].options.payload.senderName, 'Martijn van de Ven');

  const guardState = JSON.parse(writes[0].values.softora_coldmail_send_guard_v1);
  assert.equal(guardState.recipientEntries[0].senderEmail, 'martijn@websoftora.com');
  assert.equal(guardState.recipientEntries[0].senderProfileKey, 'martijn');
  assert.equal(guardState.recipientEntries[0].senderName, 'Martijn van de Ven');

  const row = getRows()[0];
  assert.equal(row.instantlySenderProfileKey, 'martijn');
  assert.equal(row.instantlySenderName, 'Martijn van de Ven');
  assert.equal(row.instantlySenderEmail, 'martijn@websoftora.com');
  assert.equal(row.lastColdmailSenderEmail, 'martijn@websoftora.com');
  assert.equal(row.sentFromEmail, 'martijn@websoftora.com');
  assert.equal(row.outreachSentFromEmail, 'martijn@websoftora.com');
  assert.equal(row.replyMailboxAccount, 'martijn@websoftora.com');
});

test('safe Instantly upload rejects mismatched sender persona and mailbox', async () => {
  const { service, writes, getRows } = createService({
    syncEnabled: false,
  });

  await assert.rejects(
    () =>
      service.prepareInstantlyUpload({
        actor: 'Test',
        campaignId: 'campaign-martijn',
        limit: 1,
        senderProfile: 'martijn',
        senderEmail: 'serve@websoftora.com',
      }),
    (error) => {
      assert.equal(error.code, 'INSTANTLY_SENDER_PROFILE_MISMATCH');
      assert.equal(error.status, 400);
      assert.match(error.message, /senderProfile en senderEmail/);
      return true;
    }
  );

  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('safe Instantly upload preserves existing Softora send guards when reserving leads', async () => {
  const { service, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
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
    coldmailSendGuard: {
      entries: [
        {
          at: '2026-06-04T12:52:18.196Z',
          senderEmail: 'martijnven123@gmail.com',
          count: 1,
          recipientEmail: 'info@tractorbumper.com',
          recipientDomain: 'tractorbumper-com',
          recipientId: 'import-260-db-mohsau64-kxmn82',
          recipientCompany: 'Tractorbumper',
        },
      ],
      recipientEntries: [
        {
          at: '2026-06-04T12:52:18.196Z',
          senderEmail: 'martijnven123@gmail.com',
          recipientEmail: 'info@tractorbumper.com',
          recipientDomain: 'tractorbumper-com',
          recipientId: 'import-260-db-mohsau64-kxmn82',
          recipientCompany: 'Tractorbumper',
        },
      ],
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    uploadId: 'upload-test',
    limit: 1,
  });

  assert.equal(result.prepared, 1);
  assert.equal(writes[0].scope, 'premium_coldmail_send_guard');
  const guardState = JSON.parse(writes[0].values.softora_coldmail_send_guard_v1);
  assert.equal(guardState.entries.length, 1);
  assert.equal(guardState.entries[0].recipientEmail, 'info@tractorbumper.com');
  assert.equal(guardState.recipientEntries.length, 2);
  assert.ok(guardState.recipientEntries.some((entry) => entry.recipientEmail === 'info@tractorbumper.com'));
  assert.ok(guardState.recipientEntries.some((entry) => entry.recipientEmail === 'ruben@example.test'));
});

test('safe Instantly upload aborts when a live guard appears after lead preparation', async () => {
  const { service, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
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
    coldmailSendGuardSequence: [
      { entries: [], recipientEntries: [] },
      {
        entries: [
          {
            at: '2026-06-04T12:52:18.196Z',
            senderEmail: 'serve@softora.nl',
            count: 1,
            recipientEmail: 'ruben@example.test',
            recipientDomain: 'bakkerijzon-test',
            recipientId: 'prospect-1',
          },
        ],
        recipientEntries: [
          {
            at: '2026-06-04T12:52:18.196Z',
            senderEmail: 'serve@softora.nl',
            recipientKey: 'email:ruben@example.test',
            recipientEmail: 'ruben@example.test',
            recipientDomain: 'bakkerijzon-test',
            recipientId: 'prospect-1',
          },
        ],
      },
    ],
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    uploadId: 'upload-test',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.requested, 1);
  assert.equal(result.available, 0);
  assert.equal(result.prepared, 0);
  assert.match(result.failed[0].error, /intussen een Softora\/Instantly duplicate-guard/);
  assert.equal(result.csv, undefined);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('safe Instantly upload refuses partial batches when fewer leads are ready than requested', async () => {
  const { service, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'prospect-2',
        bedrijf: 'Slagerij Maan',
        naam: 'Luna Slager',
        email: 'luna@example.test',
        website: 'https://slagerijmaan.test',
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
      'prospect-2': {
        id: 'prospect-2',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    uploadId: 'upload-test',
    limit: 3,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'insufficient_eligible_leads');
  assert.equal(result.requested, 3);
  assert.equal(result.available, 2);
  assert.equal(result.prepared, 0);
  assert.match(result.message, /Zet eerst genoeg mail-ready leads klaar/);
  assert.equal(result.csv, undefined);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
  assert.equal(getRows()[1].lastColdmailProvider, undefined);
});

test('safe Instantly upload skips leads that are already protected by recipient guard', async () => {
  const { service, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'guarded-1',
        bedrijf: 'Guarded BV',
        email: 'guarded@example.test',
        website: 'https://guarded.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'guarded-1': {
        id: 'guarded-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
    coldmailSendGuard: {
      recipientEntries: [
        {
          at: '2026-06-04T12:00:00.000Z',
          recipientKey: 'email:guarded@example.test',
          recipientEmail: 'guarded@example.test',
          provider: 'instantly',
          permanent: true,
        },
      ],
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.prepared, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /permanente duplicate-guard/);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].instantlyStatus, undefined);
});

test('safe Instantly upload skips leads when the same company already has a guard', async () => {
  const { service, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'same-company-1',
        bedrijf: 'Cafetaria De Bank',
        email: 'contact@cafetariadebank.nl',
        website: 'https://cafetariadebank.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'same-company-1': {
        id: 'same-company-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
    coldmailSendGuard: {
      recipientEntries: [
        {
          at: '2026-06-05T17:32:00.000Z',
          recipientKey: 'email:info@cafetariadebank.nl',
          recipientEmail: 'info@cafetariadebank.nl',
          recipientDomain: 'cafetariadebank-nl',
          recipientCompanyKey: 'cafetaria-de-bank',
          provider: 'softora',
          permanent: true,
        },
      ],
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.prepared, 0);
  assert.match(result.failed[0].error, /permanente duplicate-guard/);
  assert.equal(result.csv, undefined);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('safe Instantly upload skips leads already reserved in the central outbound guard', async () => {
  const { service, getRows, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'central-guard-1',
        bedrijf: 'Wereldtekst',
        email: 'info@wereldtekst.nl',
        website: 'https://wereldtekst.nl',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'central-guard-1': {
        id: 'central-guard-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => ({
        guard_key: 'domain:wereldtekst-nl',
        provider: 'softora',
        recipient_email: 'info@wereldtekst.nl',
        recipient_domain: 'wereldtekst-nl',
        recipient_company_key: 'wereldtekst',
        recipient_company: 'Wereldtekst',
        permanent: true,
      }),
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.prepared, 0);
  assert.match(result.failed[0].error, /centrale outbound duplicate-guard/);
  assert.equal(result.csv, undefined);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('safe Instantly upload stops before CSV when the central outbound guard is unavailable', async () => {
  const { service, fetchCalls, writes, getRows } = createService({
    syncEnabled: false,
    outboundRecipientGuardStore: null,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
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

  await assert.rejects(
    () =>
      service.prepareInstantlyUpload({
        actor: 'Test',
        campaignId: 'campaign-manual',
        limit: 1,
      }),
    (error) => {
      assert.equal(error.code, 'INSTANTLY_OUTBOUND_GUARD_UNAVAILABLE');
      assert.equal(error.status, 503);
      assert.match(error.message, /Centrale outbound duplicate-guard ontbreekt/);
      return true;
    }
  );
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('safe Instantly upload reserves the whole batch centrally before returning CSV', async () => {
  const calls = [];
  const { service, writes } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
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
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => null,
      reserveRecipients: async (items, options) => {
        calls.push({ items, options });
        return { ok: true, reservationId: 'instantly-reservation-1', count: items.length * 4, expectedCount: items.length * 4 };
      },
    },
  });

  const result = await service.prepareInstantlyUpload({
    actor: 'Test',
    campaignId: 'campaign-manual',
    uploadId: 'upload-test',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.prepared, 1);
  assert.match(result.csv, /"ruben@example\.test"/);
  assert.equal(result.centralGuards, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].items[0].recipientEmail, 'ruben@example.test');
  assert.equal(calls[0].options.provider, 'instantly');
  assert.equal(calls[0].options.channel, 'instantly');
  assert.equal(calls[0].options.permanent, true);
  assert.equal(writes[0].scope, 'premium_coldmail_send_guard');
});

test('safe Instantly upload stops before CSV when the central outbound guard reservation is incomplete', async () => {
  const calls = [];
  const { service, fetchCalls, writes, getRows } = createService({
    syncEnabled: false,
    rows: [
      {
        id: 'prospect-incomplete-guard',
        bedrijf: 'Incomplete Guard BV',
        email: 'info@incomplete-guard.example',
        website: 'https://incomplete-guard.example',
        status: 'prospect',
        mail: true,
      },
    ],
    photoMap: {
      'prospect-incomplete-guard': {
        id: 'prospect-incomplete-guard',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
      },
    },
    outboundRecipientGuardStore: {
      findRecipientConflict: async () => null,
      reserveRecipients: async (items, options) => {
        calls.push({ items, options });
        return { ok: true, reservationId: 'instantly-incomplete', count: 1, expectedCount: items.length * 4 };
      },
    },
  });

  await assert.rejects(
    () =>
      service.prepareInstantlyUpload({
        actor: 'Test',
        campaignId: 'campaign-manual',
        uploadId: 'upload-incomplete',
        limit: 1,
      }),
    (error) => {
      assert.equal(error.code, 'INSTANTLY_OUTBOUND_GUARD_FAILED');
      assert.equal(error.status, 502);
      assert.match(error.message, /Centrale outbound duplicate-guard kon niet reserveren/);
      return true;
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].lastColdmailProvider, undefined);
});

test('instantly sync uses the public Softora image host even when the app base url is Render', async () => {
  const { service, fetchCalls } = createService({
    publicBaseUrl: 'https://softora-nl-final.onrender.com',
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  const body = JSON.parse(fetchCalls[0].options.body);
  const variables = body.leads[0].custom_variables;
  assert.match(variables.softora_unsubscribe_url, /^https:\/\/softora-nl-final\.onrender\.com\/afmelden\?t=/);
  assert.equal(variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=serve');
  assert.match(variables.softora_webdesign_image_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(variables.softora_webdesign_mockup_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assertInstantlyHtmlUsesVisibleWebdesignImages(variables.softora_instantly_email_html);
});

test('instantly sync normalizes Serve accent and pins the city line', async () => {
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Alphen',
        status: 'prospect',
        mail: true,
      },
    ],
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'serve@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body:
            'Goedendag,\n\nIk ben benieuwd wat je ervan vindt.\n\nMet vriendelijke groet,\nServe Creusen\n\n{{stad}}',
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  const variables = body.leads[0].custom_variables;
  assert.match(variables.softora_mail_body, /Servé Creusen/);
  assert.doesNotMatch(variables.softora_mail_body, /Serve Creusen/);
  assert.match(variables.softora_mail_body, /📍 Alphen/);
  assert.match(variables.softora_mail_body, /Je kunt je webdesign hier bekijken 👈/);
  assert.doesNotMatch(variables.softora_mail_body, /PS: Wordt het webdesign niet zichtbaar/);
  assert.doesNotMatch(variables.softora_mail_body, /\nAlphen$/);
  assert.equal(variables.softora_city, 'Alphen');
  assert.equal(variables.softora_city_with_pin, '📍 Alphen');
  assert.match(variables.softora_instantly_email_html, /📍 Alphen/);
  assertInstantlyHtmlUsesVisibleWebdesignImages(variables.softora_instantly_email_html);
});

test('instantly sync prewarms HTTPS webdesign images so the first email open does not rebuild them', async () => {
  const imageFetchCalls = [];
  const publicPrewarmOrder = [];
  const { service, fetchCalls, publicImageFetchCalls } = createService({
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: 'https://cdn.softora.test/prospect-webdesign.png',
        websitePhotoName: 'Bakkerij Zon webdesign',
        websiteMockup: 'https://cdn.softora.test/prospect-mockup.png',
        websiteMockupName: 'Bakkerij Zon device mockup',
      },
    },
    fetchImageWithTimeout: async (url) => {
      imageFetchCalls.push(url);
      return {
        content: TINY_PNG_BUFFER,
        contentType: 'image/png',
      };
    },
    fetchPublicPreviewImage: async (url, timeoutMs, index) => {
      publicPrewarmOrder.push(`public-${index}`);
      assert.equal(timeoutMs, 30_000);
      assert.match(url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
      return { ok: true, status: 200, contentType: 'image/jpeg', bytes: 116340 };
    },
    fetchJsonWithTimeout: async () => {
      publicPrewarmOrder.push('instantly-add');
      return {
        response: { ok: true, status: 200 },
        data: { created_leads: [{ id: 'instantly-lead-1', email: 'ruben@example.test' }] },
      };
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.deepEqual(imageFetchCalls, [
    'https://cdn.softora.test/prospect-webdesign.png',
    'https://cdn.softora.test/prospect-mockup.png',
  ]);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(publicPrewarmOrder, ['public-1', 'public-2', 'instantly-add']);
  const body = JSON.parse(fetchCalls[0].options.body);
  const html = body.leads[0].custom_variables.softora_instantly_email_html;
  assertInstantlyHtmlUsesVisibleWebdesignImages(html);
  const previewTokens = [
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_image_url),
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_mockup_url),
  ];
  assert.equal(previewTokens.length, 2);
  assert.notEqual(previewTokens[0], previewTokens[1]);
  assert.deepEqual(
    publicImageFetchCalls.map((call) => call.url),
    [
      body.leads[0].custom_variables.softora_webdesign_image_url,
      body.leads[0].custom_variables.softora_webdesign_mockup_url,
    ]
  );
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[0], 'webdesign')).contentType, 'image/png');
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[1], 'mockup')).contentType, 'image/png');
  assert.equal(body.leads[0].custom_variables.softora_webdesign_image_prewarmed, 'true');
  assert.equal(body.leads[0].custom_variables.softora_webdesign_mockup_prewarmed, 'true');
});

test('instantly sync keeps sending lead data when public image prewarm fails', async () => {
  const { service, fetchCalls, publicImageFetchCalls } = createService({
    fetchPublicPreviewImage: async () => ({ ok: false, reason: 'timeout' }),
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(publicImageFetchCalls.length, 2);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.leads[0].custom_variables.softora_webdesign_image_prewarmed, 'false');
  assert.equal(body.leads[0].custom_variables.softora_webdesign_mockup_prewarmed, 'false');
  assertInstantlyHtmlUsesVisibleWebdesignImages(body.leads[0].custom_variables.softora_instantly_email_html);
});

test('instantly sync caches a stripped webdesign image instead of the decorative placeholder frame', async () => {
  const framedWebdesign = await createFramedWebdesignDataUrl();
  const { service, fetchCalls } = createService({
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: framedWebdesign,
        websiteMockup: TINY_PNG_DATA_URL,
        websitePhotoName: 'Bakkerij Zon webdesign',
        websiteMockupName: 'Bakkerij Zon device mockup',
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  const html = body.leads[0].custom_variables.softora_instantly_email_html;
  assertInstantlyHtmlUsesVisibleWebdesignImages(html);
  assert.doesNotMatch(html, /border-radius|object-fit|background:#eef3fb|min-height|max-height/);
  const previewTokens = [
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_image_url),
    ...extractPreviewImageTokens(body.leads[0].custom_variables.softora_webdesign_mockup_url),
  ];
  assert.equal(previewTokens.length, 2);
  const webdesignImage = getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[0], 'webdesign'));
  assert.equal(webdesignImage.contentType, 'image/jpeg');
  const metadata = await sharp(webdesignImage.content).metadata();
  assert.equal(metadata.width, 328);
  assert.equal(metadata.height, 244);
});

test('instantly sync removes Martijn LinkedIn CTA before syncing', async () => {
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Boxtel',
        status: 'prospect',
        mail: true,
      },
    ],
    coldmailingSettings: {
      senderEmail: 'martijn@softora.nl',
      senders: {
        'martijn@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: [
            'Goedendag,',
            '',
            'Ik ben benieuwd wat je ervan vindt.',
            '',
            'Met vriendelijke groet,',
            'Martijn van de Ven',
            '',
            '💼 Mijn LinkedIn 👈',
            '',
            '{{stad}}',
          ].join('\n'),
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  const variables = body.leads[0].custom_variables;
  assert.match(variables.softora_mail_body, /Met vriendelijke groet,\nMartijn van de Ven\n\n📍 Boxtel/);
  assert.match(variables.softora_mail_body, /Je kunt je webdesign hier bekijken 👈/);
  assert.equal(variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assert.equal(variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assert.doesNotMatch(variables.softora_mail_body, /PS: Wordt het webdesign niet zichtbaar/);
  assert.doesNotMatch(variables.softora_mail_body, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(variables.softora_instantly_email_html, /Mijn LinkedIn|linkedin\.com/i);
});

test('instantly sync maps websoftora Martijn sender aliases to the Martijn coldmail profile', async () => {
  const { service, fetchCalls } = createService({
    defaultSenderEmail: 'martijn@websoftora.com',
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Boxtel',
        status: 'prospect',
        mail: true,
      },
    ],
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'serve@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: [
            'Goedendag,',
            '',
            'Ik ben benieuwd wat je ervan vindt.',
            '',
            'Met vriendelijke groet,',
            'Serve Creusen',
            '',
            '{{stad}}',
          ].join('\n'),
        },
        'martijn@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: [
            'Goedendag,',
            '',
            'Ik ben benieuwd wat je ervan vindt.',
            '',
            'Met vriendelijke groet,',
            'Martijn van de Ven',
            '',
            '💼 Mijn LinkedIn 👈',
            '',
            '{{stad}}',
          ].join('\n'),
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  const variables = body.leads[0].custom_variables;
  assert.match(variables.softora_mail_body, /Martijn van de Ven/);
  assert.match(variables.softora_mail_body, /📍 Boxtel/);
  assert.doesNotMatch(variables.softora_mail_body, /PS: Wordt het webdesign niet zichtbaar/);
  assert.doesNotMatch(variables.softora_mail_body, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(variables.softora_mail_body, /Servé Creusen/);
  assert.match(variables.softora_instantly_email_html, /Martijn van de Ven/);
  assert.match(variables.softora_instantly_email_html, /📍 Boxtel/);
  assert.equal(variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assert.equal(variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assertInstantlyHtmlUsesVisibleWebdesignImages(
    variables.softora_instantly_email_html,
    '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn'
  );
  assert.doesNotMatch(variables.softora_instantly_email_html, /Mijn LinkedIn|linkedin\.com/i);
});

test('instantly sync can refresh existing lead variables without adding duplicate leads', async () => {
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Boxtel',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        outreachStatus: 'benaderd',
        mail: true,
        instantlyLeadId: 'lead-1',
        instantlyCampaignId: 'campaign-1',
        instantlyStatus: 'synced',
        lastColdmailProvider: 'instantly',
      },
    ],
    coldmailingSettings: {
      senderEmail: 'martijn@softora.nl',
      senders: {
        'martijn@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: [
            'Goedendag,',
            '',
            'Ik ben benieuwd wat je ervan vindt.',
            '',
            'Met vriendelijke groet,',
            'Martijn van de Ven',
            '',
            '💼 Mijn LinkedIn 👈',
            '',
            '{{stad}}',
          ].join('\n'),
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({
    actor: 'Test',
    refreshExistingVariables: true,
    refreshExistingOnly: true,
    refreshExistingLimit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'refreshed_existing_variables');
  assert.equal(result.synced, 0);
  assert.equal(result.refreshedExistingVariables, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.instantly.test/api/v2/leads/lead-1');
  assert.equal(fetchCalls[0].options.method, 'PATCH');
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.custom_variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assert.equal(body.custom_variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assertInstantlyHtmlUsesVisibleWebdesignImages(
    body.personalization,
    '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn'
  );
  assert.match(body.custom_variables.softora_mail_body, /📍 Boxtel/);
  assert.doesNotMatch(body.custom_variables.softora_mail_body, /PS: Wordt het webdesign niet zichtbaar/);
  assert.doesNotMatch(body.custom_variables.softora_mail_body, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(body.custom_variables.softora_instantly_email_html, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(body.custom_variables.softora_instantly_email_html, /Bakkerij Zon device mockup/);
});

test('instantly sync refreshes remote campaign leads with an explicit sender without adding leads', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        plaats: 'Boxtel',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        outreachStatus: 'benaderd',
        mail: true,
        instantlyLeadId: 'old-lead-id',
        instantlyCampaignId: 'campaign-serve',
        instantlyStatus: 'synced',
        lastColdmailProvider: 'instantly',
        lastColdmailSenderEmail: 'serve@websoftora.com',
      },
    ],
    remoteInstantlyLeads: [
      {
        id: 'martijn-lead-1',
        campaign_id: 'campaign-martijn',
        email: 'ruben@example.test',
        company_name: 'Bakkerij Zon',
        custom_variables: {
          softora_customer_id: 'prospect-1',
          softora_source: 'softora',
        },
      },
    ],
    coldmailingSettings: {
      senderEmail: 'serve@softora.nl',
      senders: {
        'martijn@softora.nl': {
          subject: 'Kleine vraag over jullie website',
          body: 'Goedendag,\n\nMet vriendelijke groet,\nMartijn van de Ven\n\n{{stad}}',
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({
    actor: 'Test',
    campaignId: 'campaign-martijn',
    senderProfile: 'martijn',
    senderEmail: 'martijn@websoftora.com',
    refreshExistingOnly: true,
    refreshExistingLimit: 500,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'refreshed_existing_variables');
  assert.equal(result.refreshedExistingVariables, 1);
  assert.equal(result.attemptedExistingVariableRefresh, 1);
  assert.equal(result.updatedExistingRows, 1);
  assert.equal(result.campaignId, 'campaign-martijn');
  assert.equal(result.senderProfileKey, 'martijn');
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://api.instantly.test/api/v2/leads/martijn-lead-1');
  assert.equal(fetchCalls[0].options.method, 'PATCH');
  assert.doesNotMatch(fetchCalls[0].url, /\/leads\/add$/);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.custom_variables.softora_sender_profile, 'martijn');
  assert.equal(body.custom_variables.softora_sender_name, 'Martijn van de Ven');
  assert.equal(body.custom_variables.softora_sender_email, 'martijn@websoftora.com');
  assert.equal(body.custom_variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assert.equal(body.custom_variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn');
  assertInstantlyHtmlUsesVisibleWebdesignImages(
    body.personalization,
    '/webdesign/bakkerij-zon?cid=prospect-1&sender=martijn'
  );

  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope, 'premium_customers_database');
  assert.equal(writes[0].meta.source, 'instantly-existing-variable-refresh');
  const row = getRows()[0];
  assert.equal(row.instantlyLeadId, 'martijn-lead-1');
  assert.equal(row.instantlyCampaignId, 'campaign-martijn');
  assert.equal(row.instantlySenderProfileKey, 'martijn');
  assert.equal(row.instantlySenderName, 'Martijn van de Ven');
  assert.equal(row.instantlySenderEmail, 'martijn@websoftora.com');
  assert.equal(row.lastColdmailSenderEmail, 'martijn@websoftora.com');
  assert.equal(row.sentFromEmail, 'martijn@websoftora.com');
  assert.equal(row.replyMailboxAccount, 'martijn@websoftora.com');
});

test('instantly sync is blocked unless the explicit sync flag is enabled', async () => {
  const { service, fetchCalls, getRows } = createService({ syncEnabled: false });

  await assert.rejects(
    () => service.syncInstantlyLeads({ actor: 'Test' }),
    (error) => {
      assert.equal(error.code, 'INSTANTLY_SYNC_DISABLED');
      assert.equal(error.status, 503);
      return true;
    }
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(getRows()[0].status, 'prospect');
});

test('instantly status exposes whether sync is explicitly enabled', async () => {
  const { service } = createService({ syncEnabled: false });

  const status = await service.getStatus();

  assert.equal(status.enabled, true);
  assert.equal(status.syncEnabled, false);
  assert.equal(status.schedulerEnabled, false);
});

test('instantly sync blocks leads with prior Softora coldmail history', async () => {
  const { service, fetchCalls, getRows } = createService({
    rows: [
      {
        id: 'opened-before',
        bedrijf: 'Koks Bouw & Interieur',
        email: 'info@koks-b-i.nl',
        website: 'https://koks-b-i.nl',
        status: 'benaderbaar',
        mail: true,
        hist: [
          {
            date: '2026-05-23T07:58:18.559Z',
            type: 'mail_geopend',
            label: 'Mail geopend',
            source: 'coldmail-open-tracking',
            messageKey: 'open-37c10e06-123e-463a-90d9-0c3be02e47f0',
          },
        ],
      },
      {
        id: 'sent-before',
        bedrijf: 'Kools LMB Alphen',
        email: 'info@koolslmb.nl',
        website: 'https://koolslmb.nl',
        status: 'prospect',
        mail: true,
        coldmailSentMessageId: 'old-softora-message',
      },
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed[0].error, /Al eerder benaderd/);
  assert.match(result.failed[1].error, /Al eerder benaderd/);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].email, 'ruben@example.test');

  const rows = getRows();
  assert.equal(rows[0].instantlyLeadId, undefined);
  assert.equal(rows[0].status, 'benaderbaar');
  assert.equal(rows[1].instantlyLeadId, undefined);
  assert.equal(rows[1].status, 'prospect');
  assert.equal(rows[2].instantlyStatus, 'synced');
});

test('instantly sync removes active Instantly rows with older Softora coldmail history before adding leads', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'opened-before',
        bedrijf: 'Koks Bouw & Interieur',
        email: 'info@koks-b-i.nl',
        website: 'https://koks-b-i.nl',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        outreachStatus: 'benaderd',
        mail: true,
        instantlyLeadId: 'instantly-koks-lead',
        instantlyCampaignId: 'campaign-1',
        instantlyStatus: 'synced',
        instantlySyncedAt: '2026-05-25T21:37:23.045Z',
        lastColdmailProvider: 'instantly',
        hist: [
          {
            date: '2026-05-23T07:58:18.559Z',
            type: 'mail_geopend',
            label: 'Mail geopend',
            source: 'coldmail-open-tracking',
            messageKey: 'open-37c10e06-123e-463a-90d9-0c3be02e47f0',
          },
          {
            date: '2026-05-25T21:37:23.046Z',
            type: 'gemaild',
            label: 'Lead via Instantly benaderd',
            source: 'instantly-sync',
          },
        ],
      },
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
    ],
    fetchJsonWithTimeout: async (url, options) => {
      if (url === 'https://api.instantly.test/api/v2/leads' && options.method === 'DELETE') {
        return {
          response: { ok: true, status: 200 },
          data: { count: 1 },
        };
      }
      throw new Error(`Unexpected Instantly call: ${options.method} ${url}`);
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'prior_coldmail_cleanup');
  assert.equal(result.synced, 0);
  assert.equal(result.removedPriorColdmailFromInstantly, 1);
  assert.equal(result.instantlyDeletedCount, 1);
  assert.equal(fetchCalls.length, 1);
  const deleteBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(fetchCalls[0].url, 'https://api.instantly.test/api/v2/leads');
  assert.equal(fetchCalls[0].options.method, 'DELETE');
  assert.equal(deleteBody.campaign_id, 'campaign-1');
  assert.deepEqual(deleteBody.ids, ['instantly-koks-lead']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.source, 'instantly-dedupe-cleanup');

  const rows = getRows();
  assert.equal(rows[0].instantlyLeadId, '');
  assert.equal(rows[0].instantlyCampaignId, '');
  assert.equal(rows[0].instantlyStatus, '');
  assert.equal(rows[0].lastColdmailProvider, '');
  assert.equal(rows[0].instantlyRemovedLeadId, 'instantly-koks-lead');
  assert.equal(rows[0].instantlyRemovedReason, 'prior_softora_coldmail');
  assert.equal(rows[0].status, 'gemaild');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[0].outreachStatus, 'benaderd');
  assert.equal(rows[1].instantlyStatus, undefined);
  assert.ok(rows[0].hist.some((item) => item.source === 'instantly-dedupe-cleanup'));
});

test('instantly sync removes remote campaign leads that were already mailed outside Instantly', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'manual-import-gubbels-nl-0024',
        bedrijf: 'Gubbels Beheer B.V.',
        email: 'info@gubbels.nl',
        website: 'https://gubbels.nl',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        mail: true,
        hist: [
          {
            type: 'gemaild',
            label: 'Mail verstuurd',
            date: '2026-05-27',
          },
        ],
      },
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
    ],
    remoteInstantlyLeads: [
      {
        id: 'instantly-gubbels-lead',
        campaign: 'campaign-1',
        email: 'info@gubbels.nl',
        company_name: 'Gubbels Beheer B.V.',
        timestamp_last_contact: '2026-05-30T06:37:51.884000Z',
        payload: {
          softora_customer_id: 'manual-import-gubbels-nl-0024',
          softora_source: 'softora',
          softora_status: 'benaderbaar',
          softora_company: 'Gubbels Beheer B.V.',
        },
      },
    ],
    fetchJsonWithTimeout: async (url, options) => {
      if (url === 'https://api.instantly.test/api/v2/leads' && options.method === 'DELETE') {
        return {
          response: { ok: true, status: 200 },
          data: { count: 1 },
        };
      }
      throw new Error(`Unexpected Instantly call: ${options.method} ${url}`);
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'remote_instantly_reconcile');
  assert.equal(result.removedRemoteInstantlyLeads, 1);
  assert.equal(result.instantlyDeletedCount, 1);
  assert.equal(fetchCalls.length, 1);
  const deleteBody = JSON.parse(fetchCalls[0].options.body);
  assert.equal(fetchCalls[0].url, 'https://api.instantly.test/api/v2/leads');
  assert.equal(fetchCalls[0].options.method, 'DELETE');
  assert.deepEqual(deleteBody.ids, ['instantly-gubbels-lead']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.source, 'instantly-remote-reconcile');

  const rows = getRows();
  assert.equal(rows[0].status, 'gemaild');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[0].instantlyRemovedLeadId, 'instantly-gubbels-lead');
  assert.equal(rows[0].instantlyRemovedReason, 'prior_softora_coldmail');
  assert.equal(rows[1].instantlyStatus, undefined);
});

test('instantly sync backfills remote campaign leads before normal mailbox sending can select them', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'remote-only',
        bedrijf: 'Remote Only BV',
        email: 'remote@example.test',
        website: 'https://remote.test',
        status: 'prospect',
        mail: true,
      },
    ],
    remoteInstantlyLeads: [
      {
        id: 'instantly-remote-only',
        campaign: 'campaign-1',
        email: 'remote@example.test',
        company_name: 'Remote Only BV',
        timestamp_created: '2026-05-25T08:00:00.000Z',
        payload: {
          softora_customer_id: 'remote-only',
          softora_source: 'softora',
          softora_status: 'prospect',
        },
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'remote_instantly_reconcile');
  assert.equal(result.backfilledRemoteInstantlyLeads, 1);
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].meta.source, 'instantly-remote-reconcile');

  const rows = getRows();
  assert.equal(rows[0].instantlyLeadId, 'instantly-remote-only');
  assert.equal(rows[0].instantlyCampaignId, 'campaign-1');
  assert.equal(rows[0].instantlyStatus, 'synced');
  assert.equal(rows[0].lastColdmailProvider, 'instantly');
  assert.equal(rows[0].status, 'gemaild');
  assert.equal(rows[0].databaseStatus, 'gemaild');
  assert.equal(rows[0].outreachStatus, 'benaderd');
});

test('instantly sync can run remote reconciliation without importing new leads', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        website: 'https://bakkerijzon.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test', reconcileOnly: true });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'reconcile_only');
  assert.equal(result.synced, 0);
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 0);
  assert.equal(getRows()[0].status, 'prospect');
});

test('instantly sync reads and writes chunked customer database state', async () => {
  const sourceRows = [
    {
      id: 'prospect-1',
      bedrijf: 'Bakkerij Zon',
      naam: 'Ruben Bakker',
      email: 'ruben@example.test',
      website: 'https://bakkerijzon.test',
      status: 'prospect',
      mail: true,
    },
  ];
  const customerValues = buildChunkedStatePatch(
    'softora_customers_premium_v1',
    JSON.stringify(sourceRows)
  );
  customerValues.softora_customers_premium_v1 = '';
  const { service, fetchCalls, writes, getRows } = createService({
    rows: [],
    customerValues,
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  assert.equal(fetchCalls.length, 1);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].scope, 'premium_coldmail_send_guard');
  assert.equal(writes[1].scope, 'premium_customers_database');
  assert.ok(writes[1].values.softora_customers_premium_v1_chunks_v1);
  assert.ok(writes[1].values.softora_customers_premium_v1_chunk_0);
  const savedRows = JSON.parse(
    readChunkedStateValue(writes[1].values, 'softora_customers_premium_v1')
  );
  assert.equal(savedRows[0].instantlyStatus, 'synced');
  assert.equal(savedRows[0].databaseStatus, 'gemaild');
  assert.equal(savedRows[0].outreachStatus, 'benaderd');
  assert.equal(getRows()[0].lastColdmailProvider, 'instantly');
});

test('instantly sync skips webdesign leads without ready image assets', async () => {
  const { service, fetchCalls } = createService({
    photoMap: {},
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /Nog geen website-design klaar voor Instantly/);
  assert.equal(fetchCalls.length, 0);
});

test('instantly sync blocks leads when required Softora variables are incomplete', async () => {
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben Bakker',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'no_eligible_leads');
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /mist verplichte Softora-variabelen/);
  assert.deepEqual(result.failed[0].missing, ['softora_website_domain']);
  assert.equal(fetchCalls.length, 0);
});

test('instantly sync accepts legacy mockup renderers when a mockup image exists', async () => {
  const { service, fetchCalls } = createService({
    photoMap: {
      'prospect-1': {
        id: 'prospect-1',
        websitePhoto: TINY_PNG_DATA_URL,
        websiteMockup: TINY_PNG_DATA_URL,
        websitePhotoName: 'Bakkerij Zon webdesign',
        websiteMockupName: 'Bakkerij Zon-device-mockup-v7.jpg',
        mockupRenderer: 'softora-server-device-v7',
        mockupOrientation: 'upright',
        mockupQualityStatus: 'checked',
        mockupQualityCheckedAt: '2026-05-28T23:00:00.000Z',
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.leads.length, 1);
  assert.equal(body.leads[0].custom_variables.softora_webdesign_ready, 'true');
});

test('instantly sync uses the active coldmail autopilot profile before fallback settings', async () => {
  const { service, fetchCalls } = createService({
    autopilotState: {
      enabled: true,
      config: {
        senderEmail: 'serve@softora.nl',
        senderProfiles: {
          'serve@softora.nl': {
            subject: 'Autopilot webdesign voor {{bedrijf}}',
            body: 'Goedemorgen {{naam}},\n\nDeze tekst draait nu via autopilot in {{stad}}.',
          },
        },
      },
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.leads[0].custom_variables.softora_subject, 'Autopilot webdesign voor Bakkerij Zon');
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Beste lezer/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /website \(bakkerijzon\.test\) tegen/);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_mail_body, /Deze tekst draait nu via autopilot/);
});

test('instantly sync respects the daily cap and backfills existing Instantly rows as approached', async () => {
  const { service, fetchCalls, getRows, writes } = createService({
    dailyCap: 1,
    rows: [
      {
        id: 'synced-today',
        bedrijf: 'Vandaag BV',
        email: 'vandaag@example.test',
        status: 'prospect',
        mail: true,
        instantlySyncedAt: '2026-05-25T08:00:00.000Z',
      },
      {
        id: 'prospect-2',
        bedrijf: 'Morgen BV',
        email: 'morgen@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'daily_cap_reached');
  assert.equal(result.markedBenaderd, 1);
  assert.equal(fetchCalls.length, 0);
  assert.equal(writes.length, 1);
  assert.equal(getRows()[0].databaseStatus, 'gemaild');
  assert.equal(getRows()[0].outreachStatus, 'benaderd');
  assert.equal(getRows()[1].status, 'prospect');
});

test('instantly sync counts the daily cap in Amsterdam time', async () => {
  const { service, fetchCalls } = createService({
    dailyCap: 1,
    now: '2026-05-25T23:30:00.000Z',
    rows: [
      {
        id: 'synced-amsterdam-today',
        bedrijf: 'Amsterdam Vandaag BV',
        email: 'vandaag@example.test',
        status: 'prospect',
        mail: true,
        instantlySyncedAt: '2026-05-25T22:30:00.000Z',
      },
      {
        id: 'prospect-2',
        bedrijf: 'Nieuwe Lead BV',
        email: 'nieuw@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'daily_cap_reached');
  assert.equal(fetchCalls.length, 0);
});

test('instantly status exposes the approached marker for production verification', async () => {
  const { service } = createService({
    rows: [
      {
        id: 'instantly-approached',
        bedrijf: 'Benaderd BV',
        email: 'benaderd@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        outreachStatus: 'benaderd',
        instantlyStatus: 'synced',
        instantlySyncedAt: '2026-05-25T08:00:00.000Z',
        lastColdmailProvider: 'instantly',
      },
      {
        id: 'instantly-active',
        bedrijf: 'Actief BV',
        email: 'actief@example.test',
        status: 'prospect',
        instantlyStatus: 'synced',
        instantlySyncedAt: '2026-05-25T08:05:00.000Z',
      },
    ],
  });

  const status = await service.getStatus();

  assert.equal(status.marksSyncedLeadsAsApproached, true);
  assert.equal(status.activeInstantlyRows, 2);
  assert.equal(status.approachedInstantlyRows, 1);
});

test('instantly email_sent webhook marks the Softora row as mailed', async () => {
  const { service, getRows } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        status: 'prospect',
        mail: true,
        instantlyLeadId: 'instantly-lead-1',
        instantlyCampaignId: 'campaign-1',
        instantlyStatus: 'synced',
      },
    ],
  });

  const result = await service.handleInstantlyWebhook(
    createRequest({
      body: {
        event_type: 'email_sent',
        event_id: 'event-1',
        data: {
          campaign_id: 'campaign-1',
          from_address_email: 'martijnven@websoftora.com',
          lead: {
            id: 'instantly-lead-1',
            email: 'ruben@example.test',
            custom_variables: { softora_customer_id: 'prospect-1' },
          },
        },
      },
    })
  );

  assert.equal(result.processed, true);
  const row = getRows()[0];
  assert.equal(row.status, 'gemaild');
  assert.equal(row.databaseStatus, 'gemaild');
  assert.equal(row.instantlyStatus, 'sent');
  assert.equal(row.lastMailSentAt, '2026-05-25T10:00:00.000Z');
  assert.equal(row.outreachStatus, 'benaderd');
  assert.equal(row.instantlySenderProfileKey, 'martijn');
  assert.equal(row.instantlySenderName, 'Martijn van de Ven');
  assert.equal(row.instantlySenderEmail, 'martijnven@websoftora.com');
  assert.equal(row.lastColdmailSenderEmail, 'martijnven@websoftora.com');
});

test('instantly reply aliases keep the row actionable without overwriting interest', async () => {
  const { service, getRows } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        mail: true,
        instantlyLeadId: 'instantly-lead-1',
        instantlyStatus: 'sent',
      },
    ],
  });

  const result = await service.handleInstantlyWebhook(
    createRequest({
      body: {
        event_type: 'email_replied',
        event_id: 'event-reply-1',
        data: {
          lead: {
            id: 'instantly-lead-1',
            email: 'ruben@example.test',
          },
        },
      },
    })
  );

  assert.equal(result.processed, true);
  const row = getRows()[0];
  assert.equal(row.status, 'gemaild');
  assert.equal(row.databaseStatus, 'gemaild');
  assert.equal(row.instantlyStatus, 'reply_received');
  assert.equal(row.outreachStatus, 'reactie_ontvangen');
  assert.equal(row.actionRequired, true);
});

test('instantly bounce and unsubscribe webhooks block future mail', async () => {
  const { service, getRows } = createService({
    rows: [
      {
        id: 'prospect-1',
        bedrijf: 'Bakkerij Zon',
        email: 'ruben@example.test',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        mail: true,
        instantlyLeadId: 'instantly-lead-1',
        instantlyStatus: 'sent',
      },
    ],
  });

  await service.handleInstantlyWebhook(
    createRequest({
      body: {
        event_type: 'email_bounced',
        event_id: 'event-bounce-1',
        data: {
          lead: {
            id: 'instantly-lead-1',
            email: 'ruben@example.test',
          },
        },
      },
    })
  );

  const row = getRows()[0];
  assert.equal(row.status, 'geblokkeerd');
  assert.equal(row.databaseStatus, 'geblokkeerd');
  assert.equal(row.mail, false);
  assert.equal(row.canMail, false);
  assert.equal(row.doNotMail, true);
  assert.equal(row.instantlyStatus, 'bounced');
});

test('instantly webhook rejects invalid secrets before changing data', async () => {
  const { service, getRows } = createService();

  await assert.rejects(
    () =>
      service.handleInstantlyWebhook(
        createRequest({
          secret: 'wrong-secret',
          body: { event_type: 'email_sent', data: { lead: { email: 'ruben@example.test' } } },
        })
      ),
    (error) => {
      assert.equal(error.code, 'INVALID_INSTANTLY_WEBHOOK_SECRET');
      assert.equal(error.status, 403);
      return true;
    }
  );

  assert.equal(getRows()[0].status, 'prospect');
});
