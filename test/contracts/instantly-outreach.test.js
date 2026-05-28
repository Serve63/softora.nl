const test = require('node:test');
const assert = require('node:assert/strict');

const { createInstantlyOutreachService } = require('../../server/services/instantly-outreach');
const {
  buildChunkedStatePatch,
  readChunkedStateValue,
} = require('../../server/services/data-ops-serialization');

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function withCheckedMockupMeta(item) {
  if (!item || typeof item !== 'object' || !item.websiteMockup) return item;
  if (item.mockupQualityStatus || item.mockupOrientation) return item;
  return {
    ...item,
    mockupRenderer: 'softora-test-device-v6',
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

function createService(overrides = {}) {
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
      publicBaseUrl: 'https://www.softora.nl',
      coldmailLinkSecret: 'unsubscribe-secret',
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
    resolveEmailDomain: async (domain) => !new Set(overrides.invalidDomains || []).has(domain),
    now: () => new Date(overrides.now || '2026-05-25T10:00:00.000Z'),
  });

  return {
    service,
    fetchCalls,
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
    /📍 uw regio\n\nPS: Zie je het webdesign niet\? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊/
  );
  assert.equal(body.leads[0].custom_variables.softora_city_with_pin, '📍 uw regio');
  assert.equal(
    body.leads[0].custom_variables.softora_image_visibility_ps,
    'PS: Zie je het webdesign niet? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊'
  );
  assert.match(body.leads[0].custom_variables.softora_instantly_email_body, /Geen webdesign willen ontvangen/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /<img src="https:\/\/www\.softora\.nl\/coldmailing\/webdesign-foto\?t=/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /min-height:220px/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /alt="Webdesign" width="640" loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /alt="Mockup" width="640" loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(body.leads[0].custom_variables.softora_instantly_email_html, /height:auto;max-height:none/);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_instantly_email_html, /height="360"|height:360px|object-fit/);
  assert.doesNotMatch(body.leads[0].custom_variables.softora_instantly_email_html, /Bakkerij Zon device mockup/);
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
    /📍 Alphen\n\nPS: Zie je het webdesign niet\? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊/
  );
  assert.doesNotMatch(variables.softora_mail_body, /\nAlphen$/);
  assert.equal(variables.softora_city, 'Alphen');
  assert.equal(variables.softora_city_with_pin, '📍 Alphen');
  assert.match(variables.softora_instantly_email_html, /📍 Alphen/);
  assert.match(
    variables.softora_instantly_email_html,
    /<em style="font-style:italic;">PS: Zie je het webdesign niet\? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊<\/em>/
  );
});

test('instantly sync places Martijn location above the LinkedIn CTA', async () => {
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
    /Martijn van de Ven\n\n📍 Boxtel\n\n💼 Mijn LinkedIn 👈\n\nPS: Zie je het webdesign niet\? Klik dan even op ‘afbeeldingen tonen’ ergens in je scherm 😊/
  );
  assert.ok(
    variables.softora_instantly_email_html.indexOf('📍 Boxtel') <
      variables.softora_instantly_email_html.indexOf('💼 Mijn LinkedIn 👈')
  );
  assert.match(
    variables.softora_instantly_email_html,
    /<a href="https:\/\/www\.linkedin\.com\/in\/martijn-van-de-ven-51a5b61ba\?utm_source=share_via&amp;utm_content=profile&amp;utm_medium=member_ios" target="_blank" rel="noopener noreferrer" style="color:#0a66c2;text-decoration:underline;font-weight:600;">💼 Mijn LinkedIn 👈<\/a>/
  );
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
  assert.match(variables.softora_mail_body, /📍 Boxtel\n\n💼 Mijn LinkedIn 👈/);
  assert.doesNotMatch(variables.softora_mail_body, /Servé Creusen/);
  assert.match(variables.softora_instantly_email_html, /Martijn van de Ven/);
  assert.match(variables.softora_instantly_email_html, /📍 Boxtel/);
  assert.match(variables.softora_instantly_email_html, /💼 Mijn LinkedIn 👈/);
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
  assert.match(body.personalization, /alt="Webdesign" width="640" loading="eager" decoding="async" fetchpriority="high"/);
  assert.match(body.personalization, /height:auto;max-height:none/);
  assert.match(body.custom_variables.softora_mail_body, /📍 Boxtel\n\n💼 Mijn LinkedIn 👈/);
  assert.match(body.custom_variables.softora_instantly_email_html, /min-height:220px/);
  assert.doesNotMatch(body.custom_variables.softora_instantly_email_html, /height="360"|height:360px|object-fit/);
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
