const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { registerColdmailingRoutes } = require('../../server/routes/coldmailing');

function createRouteHarness(deps) {
  let sendHandler = null;
  const app = {
    get() {},
    post(path, ...handlers) {
      if (path === '/api/coldmailing/campaigns/send') {
        sendHandler = handlers[handlers.length - 1];
      }
    },
  };

  registerColdmailingRoutes(app, deps);
  assert.equal(typeof sendHandler, 'function');

  return async function callSend(body = {}) {
    const requestBody = { startConfirmPin: '698069', ...body };
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return payload;
      },
    };
    await sendHandler({ body: requestBody, premiumAuth: { displayName: 'Servé' } }, res);
    return res;
  };
}

function createUnsubscribeRouteHarness(deps) {
  let unsubscribeGetHandler = null;
  let unsubscribePostHandler = null;
  const app = {
    get(routePath, ...handlers) {
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      if (paths.includes('/afmelden')) {
        unsubscribeGetHandler = handlers[handlers.length - 1];
      }
    },
    post(routePath, ...handlers) {
      const paths = Array.isArray(routePath) ? routePath : [routePath];
      if (paths.includes('/afmelden')) {
        unsubscribePostHandler = handlers[handlers.length - 1];
      }
    },
  };

  registerColdmailingRoutes(app, deps);
  assert.equal(typeof unsubscribeGetHandler, 'function');
  assert.equal(typeof unsubscribePostHandler, 'function');

  async function call(handler, query = {}, body = {}) {
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      type(value) {
        this.contentType = value;
        return this;
      },
      send(payload) {
        this.body = payload;
        return payload;
      },
    };
    await handler({ query, body, path: '/afmelden' }, res);
    return res;
  }

  return {
    get: (query = {}) => call(unsubscribeGetHandler, query),
    post: (query = {}, body = {}) => call(unsubscribePostHandler, query, body),
  };
}

test('coldmailing campaign send rejects missing confirmation pin before agenda or mail dispatch', async () => {
  let sent = 0;
  let agendaSynced = false;
  const callSend = createRouteHarness({
    coldmailCampaignService: {
      sendColdmailCampaign: async () => {
        sent += 1;
        return { ok: true, sent: 1 };
      },
    },
    isSupabaseConfigured: () => true,
    syncRuntimeStateFromSupabaseIfNewer: async () => {
      agendaSynced = true;
    },
    generatedAgendaAppointments: [],
    isGeneratedAppointmentVisibleForAgenda: () => true,
  });

  const res = await callSend({
    startConfirmPin: '',
    count: 1,
    subject: 'Nieuwe website',
    body: 'Goedemorgen',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.code, 'ACTION_CONFIRM_PIN_INVALID');
  assert.match(String(res.body.message || ''), /Bevestigingspin/);
  assert.equal(sent, 0);
  assert.equal(agendaSynced, false);
});

test('coldmailing campaign send blocks before sending when next 10 workdays are full', async () => {
  let synced = false;
  let sent = 0;
  const fullWorkdayDates = [
    '2026-05-06',
    '2026-05-07',
    '2026-05-08',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-18',
    '2026-05-19',
  ];
  const callSend = createRouteHarness({
    coldmailCampaignService: {
      sendColdmailCampaign: async () => {
        sent += 1;
        return { ok: true, sent: 1 };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd: (value) => String(value || '').trim(),
    normalizeTimeHhMm: (value) => String(value || '').trim(),
    isSupabaseConfigured: () => true,
    syncRuntimeStateFromSupabaseIfNewer: async (options) => {
      synced = true;
      assert.equal(options.maxAgeMs, 0);
      assert.equal(options.skipPendingPersistWait, true);
    },
    getColdmailingAgendaCapacityNow: () => new Date('2026-05-06T06:30:00.000Z'),
    generatedAgendaAppointments: fullWorkdayDates.map((date, id) => ({
      id,
      date,
      time: '09:00',
      manualAllDayUnavailable: true,
    })),
    isGeneratedAppointmentVisibleForAgenda: () => true,
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => null,
  });

  const res = await callSend({
    count: 1,
    subject: 'Nieuwe website',
    body: 'Goedemorgen',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.agendaBlocked, true);
  assert.equal(res.body.reason, 'agenda_full_10_workdays');
  assert.equal(res.body.agendaCapacity.availableSlots, 0);
  assert.equal(synced, true);
  assert.equal(sent, 0);
});

test('coldmailing campaign send forwards sender AI instructions to the service', async () => {
  let received = null;
  const callSend = createRouteHarness({
    coldmailCampaignService: {
      sendColdmailCampaign: async (payload) => {
        received = payload;
        return { ok: true, sent: 1 };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
    generatedAgendaAppointments: [],
    isGeneratedAppointmentVisibleForAgenda: () => true,
  });

  const res = await callSend({
    count: 1,
    subject: 'Nieuwe website',
    body: 'Goedemorgen',
    aiInstructions: 'Gebruik de afsluiting van Servé.',
    toneStyle: 'Informeel & persoonlijk',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(res.statusCode, 200);
  assert.equal(received.aiInstructions, 'Gebruik de afsluiting van Servé.');
  assert.equal(received.toneStyle, 'Informeel & persoonlijk');
  assert.equal(received.senderEmail, 'serve@softora.nl');
});

test('coldmailing unsubscribe page asks for confirmation before updating the recipient', async () => {
  let previewReceived = null;
  let unsubscribeCalls = 0;
  const unsubscribe = createUnsubscribeRouteHarness({
    coldmailCampaignService: {
      getColdmailUnsubscribePreview: async (payload) => {
        previewReceived = payload;
        return { ok: true, email: 'ruben@example.test', bedrijf: 'Bakkerij Zon' };
      },
      unsubscribeColdmailRecipient: async (payload) => {
        unsubscribeCalls += 1;
        return { ok: true, unsubscribed: true };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
  });

  const res = await unsubscribe.get({ t: 'signed-token' });

  assert.equal(res.statusCode, 200);
  assert.equal(previewReceived.token, 'signed-token');
  assert.equal(unsubscribeCalls, 0);
  assert.match(res.body, /<h1>Geen e-mails meer ontvangen\?<\/h1>/);
  assert.match(res.body, /Klik hieronder om te bevestigen/);
  assert.match(res.body, /Dit geldt voor Bakkerij Zon\./);
  assert.match(res.body, /<form method="post" action="\/afmelden\?t=signed-token">/);
  assert.match(res.body, /Ja, geen e-mails meer hierover/);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('coldmailing unsubscribe confirmation updates the recipient', async () => {
  let received = null;
  const unsubscribe = createUnsubscribeRouteHarness({
    coldmailCampaignService: {
      getColdmailUnsubscribePreview: async () => ({ ok: true, email: 'ruben@example.test' }),
      unsubscribeColdmailRecipient: async (payload) => {
        received = payload;
        return { ok: true, unsubscribed: true };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
  });

  const res = await unsubscribe.post({ t: 'signed-token' });

  assert.equal(res.statusCode, 200);
  assert.equal(received.token, 'signed-token');
  assert.equal(received.actor, 'coldmail-unsubscribe-link');
  assert.match(res.body, /<h1>Bevestigd<\/h1>/);
  assert.match(res.body, /We mailen u hierover niet meer/);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('coldmailing exposes mail-interest follow-ups outside the coldcalling leads inbox', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(__dirname, '../../premium-ai-coldmailing.html'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../../assets/personnel-theme.js'), 'utf8');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/replies\/follow-ups'/);
  assert.match(routeSource, /coldmailCampaignService\.listColdmailReplyFollowUps/);
  assert.doesNotMatch(leadsPageSource, /\/api\/coldmailing\/replies\/follow-ups/);
  assert.doesNotMatch(sidebarSource, /\/api\/coldmailing\/replies\/follow-ups/);
});
