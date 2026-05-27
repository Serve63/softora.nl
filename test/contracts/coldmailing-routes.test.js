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
    const requestBody = { startConfirmPin: '8080', ...body };
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

function createPreviewImageRouteHarness(deps) {
  let previewImageHandler = null;
  const app = {
    get(routePath, ...handlers) {
      if (routePath === '/coldmailing/webdesign-foto') {
        previewImageHandler = handlers[handlers.length - 1];
      }
    },
    post() {},
  };

  registerColdmailingRoutes(app, deps);
  assert.equal(typeof previewImageHandler, 'function');

  return async function callPreviewImage(query = {}) {
    const res = {
      statusCode: 200,
      headers: {},
      body: null,
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
    await previewImageHandler({ query }, res);
    return res;
  };
}

function createAutopilotRouteHarness(deps) {
  let cronRunHandlers = null;
  let adminRunHandlers = null;
  let statusHandlers = null;
  let settingsHandlers = null;
  const app = {
    get(routePath, ...handlers) {
      if (routePath === '/api/coldmailing/autopilot/run') cronRunHandlers = handlers;
      if (routePath === '/api/coldmailing/autopilot/status') statusHandlers = handlers;
    },
    post(routePath, ...handlers) {
      if (routePath === '/api/coldmailing/autopilot/run') adminRunHandlers = handlers;
      if (routePath === '/api/coldmailing/autopilot/settings') settingsHandlers = handlers;
    },
  };

  registerColdmailingRoutes(app, deps);
  assert.ok(Array.isArray(cronRunHandlers));
  assert.ok(Array.isArray(adminRunHandlers));
  assert.ok(Array.isArray(statusHandlers));
  assert.ok(Array.isArray(settingsHandlers));

  async function callHandlers(handlers, req = {}) {
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
    let index = 0;
    const next = async () => {
      const handler = handlers[index];
      index += 1;
      if (!handler) return undefined;
      let nextPromise = null;
      const runNext = () => {
        nextPromise = next();
        return nextPromise;
      };
      await Promise.resolve(handler(req, res, runNext));
      if (nextPromise) await nextPromise;
      return undefined;
    };
    await next();
    return res;
  }

  return {
    cronRun: (req = {}) => callHandlers(cronRunHandlers, {
      headers: {},
      body: {},
      ...req,
    }),
    adminRun: (body = {}) => callHandlers(adminRunHandlers, {
      body,
      premiumAuth: { displayName: 'Servé' },
    }),
    status: (req = {}) => callHandlers(statusHandlers, {
      premiumAuth: { displayName: 'Servé' },
      ...req,
    }),
    settings: (body = {}) => callHandlers(settingsHandlers, {
      body,
      premiumAuth: { displayName: 'Servé' },
    }),
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

test('coldmailing campaign send accepts only the 8080 mail confirmation pin', async () => {
  let sent = 0;
  const callSend = createRouteHarness({
    coldmailCampaignService: {
      sendColdmailCampaign: async () => {
        sent += 1;
        return { ok: true, sent: 1 };
      },
    },
    generatedAgendaAppointments: [],
    isGeneratedAppointmentVisibleForAgenda: () => true,
  });

  const badRes = await callSend({
    startConfirmPin: '698069',
    count: 1,
    subject: 'Nieuwe website',
    body: 'Goedemorgen',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(badRes.statusCode, 403);
  assert.equal(sent, 0);

  const okRes = await callSend({
    startConfirmPin: '8080',
    count: 1,
    subject: 'Nieuwe website',
    body: 'Goedemorgen',
    senderEmail: 'serve@softora.nl',
  });

  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.ok, true);
  assert.equal(sent, 1);
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

test('coldmailing autopilot cron route requires CRON_SECRET bearer access', async () => {
  let runs = 0;
  const autopilot = createAutopilotRouteHarness({
    cronSecret: 'cron-secret',
    coldmailCampaignService: {
      runColdmailAutopilot: async () => {
        runs += 1;
        return { ok: true, skipped: true, reason: 'disabled' };
      },
      getColdmailAutopilotStatus: async () => ({ ok: true, autopilot: { enabled: false } }),
      updateColdmailAutopilotSettings: async () => ({ ok: true, autopilot: { enabled: true } }),
    },
    getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    normalizeString: (value) => String(value || '').trim(),
  });

  const denied = await autopilot.cronRun({
    headers: { authorization: 'Bearer wrong' },
  });

  assert.equal(denied.statusCode, 401);
  assert.equal(denied.body.code, 'COLDMAIL_AUTOPILOT_CRON_UNAUTHORIZED');
  assert.equal(runs, 0);

  const allowed = await autopilot.cronRun({
    headers: { authorization: 'Bearer cron-secret' },
  });

  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.reason, 'disabled');
  assert.equal(runs, 1);
});

test('coldmailing autopilot run uses mail safety only and does not require the send pin or agenda capacity', async () => {
  let received = null;
  let agendaTouched = false;
  const autopilot = createAutopilotRouteHarness({
    cronSecret: 'cron-secret',
    coldmailCampaignService: {
      runColdmailAutopilot: async (payload) => {
        received = payload;
        return { ok: true, skipped: false, reason: 'sent', sent: 3 };
      },
      getColdmailAutopilotStatus: async () => ({ ok: true, autopilot: { enabled: true } }),
      updateColdmailAutopilotSettings: async () => ({ ok: true, autopilot: { enabled: true } }),
    },
    getEffectivePublicBaseUrl: () => 'https://www.softora.nl',
    normalizeString: (value) => String(value || '').trim(),
    backfillInsightsAndAppointmentsFromRecentCallUpdates: () => {
      agendaTouched = true;
    },
    generatedAgendaAppointments: [{ date: '2026-05-21', time: '09:00', manualAllDayUnavailable: true }],
  });

  const res = await autopilot.cronRun({
    headers: { authorization: 'Bearer cron-secret' },
    body: { startConfirmPin: '' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sent, 3);
  assert.equal(received.actor, 'Coldmail Autopilot Cron');
  assert.equal(received.force, false);
  assert.equal(received.publicBaseUrl, 'https://www.softora.nl');
  assert.equal(Object.prototype.hasOwnProperty.call(received, 'agendaCapacity'), false);
  assert.equal(agendaTouched, false);
});

test('coldmailing autopilot status route is visible to authenticated staff without admin access', async () => {
  let premiumAccessCalls = 0;
  let adminAccessCalls = 0;
  const autopilot = createAutopilotRouteHarness({
    requirePremiumApiAccess: (req, _res, next) => {
      premiumAccessCalls += 1;
      req.premiumAuth = { displayName: 'Martijn', role: 'medewerker' };
      next();
    },
    requirePremiumAdminApiAccess: (_req, res) => {
      adminAccessCalls += 1;
      res.status(403).json({ ok: false, error: 'Alleen Full Acces-accounts hebben toegang.' });
    },
    coldmailCampaignService: {
      runColdmailAutopilot: async () => ({ ok: true }),
      getColdmailAutopilotStatus: async () => ({ ok: true, autopilot: { enabled: true } }),
      updateColdmailAutopilotSettings: async () => ({ ok: true, autopilot: { enabled: true } }),
    },
    normalizeString: (value) => String(value || '').trim(),
  });

  const res = await autopilot.status({
    premiumAuth: { displayName: 'Martijn', role: 'medewerker' },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.autopilot.enabled, true);
  assert.equal(premiumAccessCalls, 1);
  assert.equal(adminAccessCalls, 0);
});

test('coldmailing autopilot settings route stores dashboard configuration through admin access', async () => {
  let received = null;
  const autopilot = createAutopilotRouteHarness({
    coldmailCampaignService: {
      runColdmailAutopilot: async () => ({ ok: true }),
      getColdmailAutopilotStatus: async () => ({ ok: true, autopilot: { enabled: false } }),
      updateColdmailAutopilotSettings: async (payload, actor) => {
        received = { payload, actor };
        return { ok: true, autopilot: { enabled: payload.enabled } };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
  });

  const res = await autopilot.settings({
    enabled: true,
    config: {
      count: 3,
      senderEmails: ['serve@softora.nl', 'martijn@softora.nl'],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.autopilot.enabled, true);
  assert.equal(received.actor, 'Servé');
  assert.deepEqual(received.payload.config.senderEmails, ['serve@softora.nl', 'martijn@softora.nl']);
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
  assert.match(res.body, /<h1>Had je liever geen webdesign willen ontvangen\?<\/h1>/);
  assert.match(res.body, /Bevestig hieronder dat je hierover geen bericht meer wilt ontvangen/);
  assert.match(res.body, /Dit geldt voor Bakkerij Zon\./);
  assert.match(res.body, /<form method="post" action="\/afmelden\?t=signed-token">/);
  assert.match(res.body, /Ja, laat dit verder rusten/);
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
  assert.match(res.body, /<h1>Helemaal goed<\/h1>/);
  assert.match(res.body, /Ik laat dit verder rusten/);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('coldmailing preview image route serves linked webdesign photos inline', async () => {
  let received = null;
  const callPreviewImage = createPreviewImageRouteHarness({
    coldmailCampaignService: {
      getColdmailPreviewImage: async (payload) => {
        received = payload;
        return {
          ok: true,
          content: Buffer.from('mockup-image'),
          contentType: 'image/png',
          filename: 'Bakkerij-Zon-device-mockup.png',
        };
      },
    },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  const res = await callPreviewImage({ t: 'signed-image-token' });

  assert.equal(res.statusCode, 200);
  assert.equal(received.token, 'signed-image-token');
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.headers['content-disposition'], 'inline; filename="Bakkerij-Zon-device-mockup.png"');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(res.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(Buffer.compare(res.body, Buffer.from('mockup-image')), 0);
});

test('coldmail preview image lookup reuses the fresh mockup preference logic', () => {
  const serviceSource = fs.readFileSync(path.join(__dirname, '../../server/services/coldmail-campaign.js'), 'utf8');

  assert.match(
    serviceSource,
    /const photo = preferFreshRowPhotoFields\(\s*rows\[match\.index\],\s*findStoredPhotoRecordForRow\(rows\[match\.index\], match\.index, photos, photosByIdentity\)\s*\);/
  );
});

test('coldmailing exposes mail-interest follow-ups outside the coldcalling leads inbox', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');
  const leadsPageSource = fs.readFileSync(path.join(__dirname, '../../premium-ai-coldmailing.html'), 'utf8');
  const sidebarSource = fs.readFileSync(path.join(__dirname, '../../assets/personnel-theme.js'), 'utf8');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/replies\/follow-ups'/);
  assert.match(routeSource, /coldmailCampaignService\.listColdmailReplyFollowUps/);
  assert.match(routeSource, /campaignType:\s*req\.query\.campaignType \|\| req\.query\.campaign \|\| req\.query\.source/);
  assert.doesNotMatch(leadsPageSource, /\/api\/coldmailing\/replies\/follow-ups/);
  assert.doesNotMatch(sidebarSource, /\/api\/coldmailing\/replies\/follow-ups/);
});

test('coldmailing exposes token-protected one-click unsubscribe without admin auth', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /app\.post\('\/api\/coldmailing\/unsubscribe'/);
  assert.match(routeSource, /unsubscribeColdmailRecipient/);
  assert.doesNotMatch(routeSource, /app\.post\('\/api\/coldmailing\/unsubscribe', requirePremiumAdminApiAccess/);
  assert.match(routeSource, /INVALID_UNSUBSCRIBE_TOKEN/);
});

test('coldmailing exposes token-protected open tracking pixel without admin auth', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/open\.gif'/);
  assert.match(routeSource, /recordColdmailOpen/);
  assert.doesNotMatch(routeSource, /app\.get\('\/api\/coldmailing\/open\.gif', requirePremiumAdminApiAccess/);
  assert.match(routeSource, /Content-Type': 'image\/gif'/);
  assert.match(routeSource, /Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'/);
});

test('coldmailing maps overlapping campaign sends to conflict status', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');

  assert.match(routeSource, /COLDMAIL_SEND_IN_PROGRESS/);
  assert.match(routeSource, /\?\s*409/);
});

test('coldmailing autopilot route stays protected and is restored as a Vercel cron', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '../../server/routes/coldmailing.js'), 'utf8');
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8'));
  const autopilotCron = vercelConfig.crons.find((cron) => cron.path === '/api/coldmailing/autopilot/run');

  assert.match(routeSource, /app\.get\('\/api\/coldmailing\/autopilot\/run', requireColdmailingCronAccess/);
  assert.match(routeSource, /runColdmailAutopilot/);
  assert.equal(autopilotCron.schedule, '*/5 * * * *');
});
