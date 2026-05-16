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
  assert.equal(uiStateWrites.length, 2);
  assert.equal(uiStateWrites[0].scope, 'premium_active_orders');
  assert.match(uiStateWrites[0].values.softora_custom_orders_premium_v1, /Softora/);
  assert.equal(uiStateWrites[1].scope, 'premium_customers_database');
  assert.match(uiStateWrites[1].values.softora_customers_premium_v1, /"databaseStatus":"klant"/);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_active_order_added');
});

test('agenda post-call coordinator promotes an open lead without creating duplicate active orders', async () => {
  const existingOrders = [
    {
      id: 12,
      clientName: 'Administratieportaal',
      location: 'Marco',
      companyName: 'Administratieportaal',
      contactName: 'Marco',
      title: 'Website opdracht voor Administratieportaal',
      description: 'Oude notitie',
      amount: 3000,
      status: 'wacht',
      sourceAppointmentId: 55,
      prompt: 'Oude prompt',
      transcript: 'Oude transcriptie',
    },
  ];
  const { appointments, coordinator, uiStateWrites } = createFixture({
    appointments: [
      {
        id: 55,
        company: 'Administratieportaal',
        contact: 'Marco',
        phone: '0611111111',
        callId: 'manual_55',
        summary: 'Website meeting met vervolg nodig.',
        postCallStatus: 'lead_follow_up',
        confirmationTaskType: 'lead_follow_up',
        taskType: 'lead_follow_up',
        type: 'lead_follow_up',
        needsConfirmationEmail: true,
        confirmationResponseReceived: false,
      },
    ],
    getUiStateValues: async (scope) => {
      if (scope === 'premium_active_orders') {
        return {
          values: {
            softora_custom_orders_premium_v1: JSON.stringify(existingOrders),
          },
        };
      }
      return { values: {} };
    },
  });
  const res = createResponseRecorder();

  await coordinator.addAgendaAppointmentToPremiumActiveOrders(
    {
      body: {
        prompt: 'Nieuwe dossierprompt',
        transcript: 'Nieuwe dossiernotitie uit opname.',
        actor: 'Serve',
        title: 'Nieuwe titel',
        description: 'Nieuwe omschrijving',
        amount: 4500,
        status: 'actieve_opdracht',
      },
    },
    res,
    '55'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.alreadyExisted, true);
  assert.equal(res.body.order.id, 12);
  assert.equal(appointments[0].activeOrderId, 12);
  assert.equal(appointments[0].postCallStatus, 'actieve_opdracht');
  assert.equal(appointments[0].confirmationTaskType, 'actieve_opdracht');
  assert.equal(appointments[0].confirmationResponseReceived, true);
  const savedOrders = JSON.parse(uiStateWrites[0].values.softora_custom_orders_premium_v1);
  assert.equal(savedOrders.length, 1);
  assert.equal(savedOrders[0].id, 12);
  assert.equal(savedOrders[0].title, 'Nieuwe titel');
  assert.equal(savedOrders[0].description, 'Nieuwe omschrijving');
  assert.equal(savedOrders[0].amount, 4500);
  assert.equal(savedOrders[0].prompt, 'Nieuwe dossierprompt');
  assert.equal(savedOrders[0].transcript, 'Nieuwe dossiernotitie uit opname.');
});

test('agenda post-call coordinator marks the premium database row as afgehaakt after no deal', async () => {
  const { coordinator, uiStateWrites } = createFixture({
    getUiStateValues: async (scope) => {
      if (scope === 'premium_customers_database') {
        return {
          values: {
            softora_customers_premium_v1: JSON.stringify([
              {
                id: 'customer-42',
                naam: 'Serve Creusen',
                bedrijf: 'Softora',
                telefoon: '0612345678',
                databaseStatus: 'afspraak',
                hist: [],
              },
            ]),
          },
        };
      }
      return { values: {} };
    },
  });
  const res = createResponseRecorder();

  await coordinator.updateAgendaAppointmentPostCallDataById(
    {
      body: {
        status: 'no_deal',
        actor: 'Serve',
      },
    },
    res,
    '42'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.databaseSync.ok, true);
  assert.equal(res.body.databaseSync.status, 'afgehaakt');
  assert.equal(uiStateWrites.length, 1);
  assert.equal(uiStateWrites[0].scope, 'premium_customers_database');
  const savedRows = JSON.parse(uiStateWrites[0].values.softora_customers_premium_v1);
  assert.equal(savedRows[0].databaseStatus, 'afgehaakt');
  assert.equal(savedRows[0].hist[0].type, 'afgehaakt');
});

test('agenda post-call coordinator can turn an appointment into an open lead follow-up', async () => {
  const { activityCalls, appointments, coordinator } = createFixture({
    appointments: [
      {
        id: 55,
        company: 'Administratieportaal',
        contact: 'Marco',
        phone: '0611111111',
        callId: 'manual_55',
        summary: 'Website meeting met vervolg nodig.',
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: '2026-05-13T09:00:00.000Z',
        confirmationTaskType: '',
        needsConfirmationEmail: false,
      },
    ],
  });
  const res = createResponseRecorder();

  await coordinator.updateAgendaAppointmentPostCallDataById(
    {
      body: {
        status: 'lead_follow_up',
        transcript: 'Klant wil eerst intern overleggen en later vervolg oppakken.',
        actor: 'Serve',
      },
    },
    res,
    '55'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(appointments[0].postCallStatus, 'lead_follow_up');
  assert.equal(appointments[0].confirmationTaskType, 'lead_follow_up');
  assert.equal(appointments[0].needsConfirmationEmail, true);
  assert.equal(appointments[0].confirmationResponseReceived, false);
  assert.equal(appointments[0].confirmationResponseReceivedAt, null);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_lead_follow_up_added');
});
