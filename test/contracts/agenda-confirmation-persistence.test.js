const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAgendaConfirmationPersistenceHelpers,
} = require('../../server/services/agenda-confirmation-persistence');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeDateYyyyMmDd(value) {
  const input = normalizeString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(input) ? input : '';
}

function normalizeTimeHhMm(value) {
  const input = normalizeString(value);
  return /^\d{2}:\d{2}$/.test(input) ? input : '';
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

test('agenda confirmation persistence helpers expose snapshots and appointment lookups only for valid shared state', () => {
  const appointments = [{ id: 101, callId: 'call-1' }];
  const helpers = createAgendaConfirmationPersistenceHelpers({
    isSupabaseConfigured: () => true,
    buildRuntimeStateSnapshotPayload: () => ({
      savedAt: '2026-04-01T10:00:00.000Z',
      generatedAgendaAppointments: appointments.map((item) => ({ ...item })),
    }),
    getGeneratedAgendaAppointments: () => appointments,
    getGeneratedAppointmentIndexById: (rawId) =>
      appointments.findIndex((item) => Number(item?.id || 0) === Number(rawId || 0)),
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  });

  assert.equal(helpers.takeRuntimeMutationSnapshot()?.savedAt, '2026-04-01T10:00:00.000Z');
  assert.equal(helpers.resolveGeneratedAgendaAppointmentById('101')?.callId, 'call-1');
  assert.equal(helpers.resolveGeneratedAgendaAppointmentById('999'), null);
});

test('agenda confirmation persistence helpers compare only the relevant appointment mutation identity', () => {
  const helpers = createAgendaConfirmationPersistenceHelpers({
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  });

  assert.equal(
    helpers.doesAgendaMutationMatchAppointment(
      {
        id: 101,
        callId: 'call-1',
        date: '2026-04-10',
        time: '11:45',
        location: 'Amsterdam',
      },
      {
        id: 101,
        callId: 'call-1',
        date: '2026-04-10',
        time: '11:45',
        appointmentLocation: 'Amsterdam',
      }
    ),
    true
  );
  assert.equal(
    helpers.doesAgendaMutationMatchAppointment(
      {
        id: 101,
        callId: 'call-1',
        date: '2026-04-10',
      },
      {
        id: 101,
        callId: 'call-2',
        date: '2026-04-10',
      }
    ),
    false
  );
});

test('agenda confirmation persistence helpers accept pending shared persistence when local verification already matches', async () => {
  let invalidated = 0;
  const res = createResponseRecorder();
  const helpers = createAgendaConfirmationPersistenceHelpers({
    isSupabaseConfigured: () => true,
    waitForQueuedRuntimeSnapshotPersist: async () => await new Promise(() => {}),
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    applyRuntimeStateSnapshotPayload: () => false,
    invalidateSupabaseSyncTimestamp: () => {
      invalidated += 1;
    },
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  });

  const result = await helpers.ensureLeadMutationPersistedOrRespond(
    res,
    { savedAt: '2026-04-01T10:00:00.000Z' },
    'Lead kon niet veilig in gedeelde opslag worden gezet.',
    {
      allowPendingResponse: true,
      pendingResponseAfterMs: 1,
      verifyPersisted: () => true,
    }
  );

  assert.equal(result, 'pending');
  assert.equal(invalidated, 1);
  assert.equal(res.statusCode, null);
});

test('agenda confirmation persistence helpers restore the snapshot and respond 503 when shared persistence fails', async () => {
  const applySnapshotCalls = [];
  const res = createResponseRecorder();
  const helpers = createAgendaConfirmationPersistenceHelpers({
    isSupabaseConfigured: () => true,
    waitForQueuedRuntimeSnapshotPersist: async () => false,
    syncRuntimeStateFromSupabaseIfNewer: async () => false,
    applyRuntimeStateSnapshotPayload: (snapshot, options) => {
      applySnapshotCalls.push({ snapshot, options });
      return true;
    },
    invalidateSupabaseSyncTimestamp: () => {},
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
  });

  const result = await helpers.ensureLeadMutationPersistedOrRespond(
    res,
    { savedAt: '2026-04-01T10:00:00.000Z' },
    'Leadverwijdering kon niet veilig in gedeelde opslag worden opgeslagen.'
  );

  assert.equal(result, false);
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /gedeelde opslag/);
  assert.equal(applySnapshotCalls.length, 1);
  assert.equal(applySnapshotCalls[0].options.updatedAt, '2026-04-01T10:00:00.000Z');
});
