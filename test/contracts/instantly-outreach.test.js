const test = require('node:test');
const assert = require('node:assert/strict');

const { createInstantlyOutreachService } = require('../../server/services/instantly-outreach');

const VALID_WEBDESIGN_PHOTO = 'data:image/png;base64,aGVsbG8=';

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
      websitePhoto: VALID_WEBDESIGN_PHOTO,
    },
  ];
  const fetchCalls = [];
  const writes = [];
  const service = createInstantlyOutreachService({
    instantlyConfig: {
      enabled: true,
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
    },
    getUiStateValues: async (scope) => {
      if (scope === 'premium_database_photos') {
        return { values: overrides.photoValues || {} };
      }
      return {
        values: {
          softora_customers_premium_v1: JSON.stringify(rows),
        },
      };
    },
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      rows = JSON.parse(values.softora_customers_premium_v1);
      return { ok: true };
    },
    fetchJsonWithTimeout: async (url, options, timeoutMs) => {
      fetchCalls.push({ url, options, timeoutMs });
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
        websitePhoto: VALID_WEBDESIGN_PHOTO,
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

  assert.equal(writes.length, 1);
  const rows = getRows();
  assert.equal(rows[0].instantlyLeadId, 'instantly-lead-1');
  assert.equal(rows[0].instantlyStatus, 'synced');
  assert.equal(rows[0].lastColdmailProvider, 'instantly');
  assert.equal(rows[0].databaseStatus, undefined);
  assert.equal(rows[0].status, 'prospect');
});

test('instantly sync only pushes leads that have a webdesign mockup', async () => {
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'no-mockup',
        bedrijf: 'Geen Mockup BV',
        email: 'geen@example.test',
        status: 'prospect',
        mail: true,
      },
      {
        id: 'with-mockup',
        bedrijf: 'Wel Mockup BV',
        email: 'wel@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: VALID_WEBDESIGN_PHOTO,
      },
    ],
    instantlyResponse: {
      created_leads: [{ id: 'instantly-lead-2', email: 'wel@example.test' }],
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /Geen webdesign\/mockup gevonden/);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.deepEqual(body.leads.map((lead) => lead.email), ['wel@example.test']);
});

test('instantly sync accepts mockups stored in the photo state map', async () => {
  const photoKey = 'softora_database_photo_data_v1_photo-map-lead';
  const { service, fetchCalls } = createService({
    rows: [
      {
        id: 'photo-map-lead',
        bedrijf: 'Photo Map BV',
        email: 'photomap@example.test',
        status: 'prospect',
        mail: true,
      },
    ],
    photoValues: {
      softora_database_photos_v1: JSON.stringify({
        'photo-map-lead': {
          id: 'photo-map-lead',
          photoKey,
          chunkCount: 1,
          websitePhotoName: 'mockup.png',
        },
      }),
      [`${photoKey}_0`]: VALID_WEBDESIGN_PHOTO,
    },
    instantlyResponse: {
      created_leads: [{ id: 'instantly-lead-3', email: 'photomap@example.test' }],
    },
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.synced, 1);
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.leads[0].email, 'photomap@example.test');
});

test('instantly sync respects the daily cap from existing synced rows', async () => {
  const { service, fetchCalls } = createService({
    dailyCap: 1,
    rows: [
      {
        id: 'synced-today',
        bedrijf: 'Vandaag BV',
        email: 'vandaag@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: VALID_WEBDESIGN_PHOTO,
        instantlySyncedAt: '2026-05-25T08:00:00.000Z',
      },
      {
        id: 'prospect-2',
        bedrijf: 'Morgen BV',
        email: 'morgen@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: VALID_WEBDESIGN_PHOTO,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'daily_cap_reached');
  assert.equal(fetchCalls.length, 0);
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
        websitePhoto: VALID_WEBDESIGN_PHOTO,
        instantlySyncedAt: '2026-05-25T22:30:00.000Z',
      },
      {
        id: 'prospect-2',
        bedrijf: 'Nieuwe Lead BV',
        email: 'nieuw@example.test',
        status: 'prospect',
        mail: true,
        websitePhoto: VALID_WEBDESIGN_PHOTO,
      },
    ],
  });

  const result = await service.syncInstantlyLeads({ actor: 'Test' });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'daily_cap_reached');
  assert.equal(fetchCalls.length, 0);
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
