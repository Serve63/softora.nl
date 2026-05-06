const test = require('node:test');
const assert = require('node:assert/strict');

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
    await sendHandler({ body, premiumAuth: { displayName: 'Servé' } }, res);
    return res;
  };
}

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
