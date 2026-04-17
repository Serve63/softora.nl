const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgendaPostCallCoordinator,
  createAgendaPostCallHelpers,
} = require('../../server/services/agenda-post-call');

function normalizeString(value) {
  return String(value || '').trim();
}

function truncateText(value, maxLength = 500) {
  return normalizeString(value).slice(0, maxLength);
}

function sanitizeLaunchDomainName(value) {
  return normalizeString(value).toLowerCase();
}

function sanitizeReferenceImages(input) {
  const items = Array.isArray(input) ? input : [];
  return items
    .filter((item) => item && item.allowed !== false)
    .map((item, index) => ({
      id: item.id || `img-${index + 1}`,
      name: item.name || `Bijlage ${index + 1}`,
      dataUrl: item.dataUrl || 'data:image/png;base64,abcd',
      sizeBytes: Number(item.sizeBytes || 128) || 128,
      mimeType: item.mimeType || 'image/png',
    }));
}

function sanitizePostCallText(value, maxLen = 20000) {
  return truncateText(value, maxLen);
}

function normalizePostCallStatus(value) {
  const raw = normalizeString(value).toLowerCase();
  if (['nieuw', 'wacht', 'bezig', 'klaar'].includes(raw)) return raw;
  return 'nieuw';
}

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const appointments =
    overrides.appointments ||
    [
      {
        id: 42,
        company: 'Softora',
        contact: 'Serve Creusen',
        phone: '0612345678',
        callId: 'call-42',
        leadOwnerName: 'Servé Creusen',
        summary: 'Lead wil een website en vroeg om een vervolgstap.',
        value: 'EUR 3.500',
        postCallStatus: 'nieuw',
        postCallPrompt: '',
        postCallNotesTranscript: '',
        postCallDomainName: '',
        referenceImages: [],
      },
    ];
  const activityCalls = [];
  const uiStateWrites = [];

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, _reason) {
    appointments[idx] = {
      ...nextValue,
    };
    return appointments[idx];
  }

  const helpers = createAgendaPostCallHelpers({
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    sanitizePostCallText,
    normalizePostCallStatus,
  });

  const coordinator = createAgendaPostCallCoordinator({
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    sanitizeReferenceImages,
    sanitizePostCallText,
    normalizePostCallStatus,
    getGeneratedAppointmentIndexById: (raw) =>
      appointments.findIndex((item) => Number(item?.id || 0) === Number(raw)),
    getGeneratedAgendaAppointments: () => appointments,
    setGeneratedAgendaAppointmentAtIndex,
    appendDashboardActivity: (payload, reason) => {
      activityCalls.push({ payload, reason });
    },
    getUiStateValues:
      overrides.getUiStateValues ||
      (async () => ({
        values: {},
      })),
    setUiStateValues:
      overrides.setUiStateValues ||
      (async (scope, values, meta) => {
        uiStateWrites.push({ scope, values, meta });
        return {
          values,
          source: meta.source,
          updatedAt: '2026-04-08T12:00:00.000Z',
        };
      }),
    premiumActiveOrdersScope: 'premium_active_orders',
    premiumActiveCustomOrdersKey: 'softora_custom_orders_premium_v1',
    helpers,
  });

  return {
    activityCalls,
    appointments,
    coordinator,
    helpers,
    uiStateWrites,
  };
}

test('agenda post-call coordinator stores normalized post-call appointment data', () => {
  const { activityCalls, appointments, coordinator } = createFixture();
  const res = createResponseRecorder();

  coordinator.updateAgendaAppointmentPostCallDataById(
    {
      body: {
        status: 'bezig',
        transcript: 'Klant wil een strakke website met drie secties.',
        prompt: 'Bouw een moderne leadgeneratie website.',
        domainName: 'Softora.NL',
        actor: 'Serve',
        referenceImages: [{ id: 'img-1' }],
      },
    },
    res,
    '42'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(appointments[0].postCallStatus, 'bezig');
  assert.equal(appointments[0].postCallPrompt, 'Bouw een moderne leadgeneratie website.');
  assert.equal(appointments[0].postCallDomainName, 'softora.nl');
  assert.equal(appointments[0].referenceImages.length, 1);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_post_call_saved');
});

test('agenda post-call helpers parse custom active orders from ui-state safely', () => {
  const { helpers } = createFixture();
  const orders = helpers.parseCustomOrdersFromUiState(
    JSON.stringify([
      {
        id: 7,
        clientName: 'Softora',
        location: 'Amsterdam',
        title: 'Website opdracht',
        description: 'Nieuwe site voor leadopvolging',
        amount: 2500,
        domainName: 'Softora.NL',
        sourceAppointmentId: 42,
        sourceCallId: 'call-42',
        prompt: 'Maak een site',
        transcript: 'Transcriptsamenvatting',
      },
      {
        id: 'bad',
      },
    ])
  );

  assert.equal(orders.length, 1);
  assert.equal(orders[0].domainName, 'softora.nl');
  assert.equal(orders[0].status, 'wacht');
  assert.equal(orders[0].sourceAppointmentId, 42);
});

test('agenda post-call coordinator adds a new active order and links it back to the appointment', async () => {
  const { activityCalls, appointments, coordinator, uiStateWrites } = createFixture();
  const res = createResponseRecorder();

  await coordinator.addAgendaAppointmentToPremiumActiveOrders(
    {
      body: {
        prompt: 'Maak een conversion-focused website voor Softora.',
        transcript: 'Klant wil snel live en stuurt later teksten.',
        domainName: 'softora.nl',
        actor: 'Serve',
        referenceImages: [{ id: 'img-1' }],
      },
    },
    res,
    '42'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.alreadyExisted, false);
  assert.equal(res.body.order.id, 1);
  assert.equal(res.body.order.sourceAppointmentId, 42);
  assert.equal(res.body.order.claimedBy, 'Servé Creusen');
  assert.equal(res.body.order.companyName, 'Softora');
  assert.equal(res.body.order.contactName, 'Serve Creusen');
  assert.equal(res.body.order.contactPhone, '0612345678');
  assert.equal(appointments[0].activeOrderId, 1);
  assert.equal(appointments[0].activeOrderAddedBy, 'Serve');
  assert.equal(uiStateWrites.length, 1);
  assert.equal(uiStateWrites[0].scope, 'premium_active_orders');
  assert.match(uiStateWrites[0].values.softora_custom_orders_premium_v1, /Softora/);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_active_order_added');
});
