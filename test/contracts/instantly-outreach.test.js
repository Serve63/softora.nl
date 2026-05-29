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

function assertInstantlyImageTagsUseNaturalLayout(html) {
  const imageTags = extractImageTags(html);
  assert.equal(imageTags.length, 2);
  assert.match(imageTags[0], /alt="Webdesign" width="1024" height="1536" loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(imageTags[0], /aspect-ratio:1024\/1536/);
  assert.match(imageTags[1], /alt="Mockup" width="1600" height="1000" loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(imageTags[1], /aspect-ratio:1600\/1000/);
  for (const imageTag of imageTags) {
    assert.match(
      imageTag,
      /style="display:block;width:100%;max-width:640px;height:auto;aspect-ratio:\d+\/\d+;border:0;outline:none;text-decoration:none;"/
    );
    assert.doesNotMatch(
      imageTag,
      /min-height|max-height|height:(?:220|360)px|object-fit|border-radius|font-family|font-size|font-weight|text-align/
    );
  }
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
  const fetchCalls = [];
  const publicImageFetchCalls = [];
  const writes = [];
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
      return {
        values: customerValues,
      };
    },
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      customerValues = values;
      rows = JSON.parse(readChunkedStateValue(values, 'softora_customers_premium_v1') || '[]');
      return { ok: true };
    },
    fetchJsonWithTimeout: async (url, options, timeoutMs) => {
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
    getRows: () => rows,
    writes,
  };
}

test('instantly sync pushes eligible Softora leads with campaign dedupe options', async () => {
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
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Goedemorgen Ruben Bakker/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Servé Creusen/);
  assert.match(body.leads[0].custom_variables.softora_mail_body, /📍 uw regio/);
  assert.match(
    body.leads[0].custom_variables.softora_mail_body,
    /📍 uw regio\n\nPS: Wordt het webdesign niet zichtbaar\? open het via hier 👈/
  );
  assert.equal(body.leads[0].custom_variables.softora_city_with_pin, '📍 uw regio');
  assert.equal(
    body.leads[0].custom_variables.softora_image_visibility_ps,
    'PS: Wordt het webdesign niet zichtbaar? open het via hier 👈'
  );
  assert.equal(body.leads[0].custom_variables.softora_webdesign_public_path, '/webdesign/bakkerij-zon');
  assert.equal(body.leads[0].custom_variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon');
  assert.match(body.leads[0].custom_variables.softora_instantly_email_body, /Geen webdesign willen ontvangen/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /<img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assertInstantlyImageTagsUseNaturalLayout(body.leads[0].custom_variables.softora_instantly_email_html);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_instantly_email_html, /Bakkerij Zon device mockup/);
  const previewTokens = extractPreviewImageTokens(body.leads[0].custom_variables.softora_instantly_email_html);
  assert.equal(previewTokens.length, 2);
  assert.notEqual(previewTokens[0], previewTokens[1]);
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[0], 'webdesign')).contentType, 'image/png');
  assert.equal(getCachedPreviewImage(getPreviewImageCacheKey(previewTokens[1], 'mockup')).contentType, 'image/png');
  assert.match(body.leads[0].custom_variables.softora_webdesign_image_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(body.leads[0].custom_variables.softora_webdesign_mockup_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.equal(body.leads[0].custom_variables.softora_webdesign_ready, 'true');
  assert.equal(body.leads[0].custom_variables.softora_instantly_email_text, body.leads[0].custom_variables.softora_instantly_email_body);
  assert.equal(body.leads[0].personalization, body.leads[0].custom_variables.softora_instantly_email_html);

  assert.equal(writes.length, 1);
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

test('instantly sync uses the public Softora image host even when the app base url is Render', async () => {
  const { service, fetchCalls } = createService({
    publicBaseUrl: 'https://softora-nl-final.onrender.com',
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  const body = JSON.parse(fetchCalls[0].options.body);
  const variables = body.leads[0].custom_variables;
  assert.match(variables.softora_unsubscribe_url, /^https:\/\/softora-nl-final\.onrender\.com\/afmelden\?t=/);
  assert.equal(variables.softora_webdesign_public_url, 'https://www.softora.nl/webdesign/bakkerij-zon');
  assert.match(variables.softora_webdesign_image_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(variables.softora_webdesign_mockup_url, /^https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(variables.softora_instantly_email_html, /<img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
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
  assert.match(
    variables.softora_mail_body,
    /📍 Alphen\n\nPS: Wordt het webdesign niet zichtbaar\? open het via hier 👈/
  );
  assert.doesNotMatch(variables.softora_mail_body, /\nAlphen$/);
  assert.equal(variables.softora_city, 'Alphen');
  assert.equal(variables.softora_city_with_pin, '📍 Alphen');
  assert.match(variables.softora_instantly_email_html, /📍 Alphen/);
  assert.match(
    variables.softora_instantly_email_html,
    /<em style="font-style:italic;">PS: Wordt het webdesign niet zichtbaar\? open het via <a href="https:\/\/www\.softora\.nl\/webdesign\/bakkerij-zon" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;">hier<\/a> 👈<\/em>/
  );
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
  assertInstantlyImageTagsUseNaturalLayout(html);
  const previewTokens = extractPreviewImageTokens(html);
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
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /<img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
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
  assertInstantlyImageTagsUseNaturalLayout(html);
  assert.doesNotMatch(html, /border-radius|object-fit|background:#eef3fb|min-height|max-height/);
  const previewTokens = extractPreviewImageTokens(html);
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
  assert.match(
    variables.softora_mail_body,
    /Martijn van de Ven\n\n📍 Boxtel\n\nPS: Wordt het webdesign niet zichtbaar\? open het via hier 👈/
  );
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
  assert.match(variables.softora_mail_body, /📍 Boxtel\n\nPS:/);
  assert.doesNotMatch(variables.softora_mail_body, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(variables.softora_mail_body, /Servé Creusen/);
  assert.match(variables.softora_instantly_email_html, /Martijn van de Ven/);
  assert.match(variables.softora_instantly_email_html, /📍 Boxtel/);
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
  assert.match(body.personalization, /<img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assertInstantlyImageTagsUseNaturalLayout(body.personalization);
  assert.match(body.custom_variables.softora_mail_body, /📍 Boxtel\n\nPS:/);
  assert.doesNotMatch(body.custom_variables.softora_mail_body, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(body.custom_variables.softora_instantly_email_html, /Mijn LinkedIn|linkedin\.com/i);
  assert.doesNotMatch(body.custom_variables.softora_instantly_email_html, /Bakkerij Zon device mockup/);
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
  assert.equal(writes.length, 1);
  assert.ok(writes[0].values.softora_customers_premium_v1_chunks_v1);
  assert.ok(writes[0].values.softora_customers_premium_v1_chunk_0);
  const savedRows = JSON.parse(
    readChunkedStateValue(writes[0].values, 'softora_customers_premium_v1')
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
  assert.match(body.leads[0].custom_variables.softora_mail_body, /Deze tekst draait nu via autopilot/);
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
