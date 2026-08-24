const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createKvkDatabaseControlService,
} = require('../../server/services/kvk-database-control');

function createJsonResponse() {
  return {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function createInMemoryService(overrides = {}) {
  const storedRows = new Map();
  let currentNow = new Date('2026-07-26T20:30:00.000Z');
  const service = createKvkDatabaseControlService({
    supabaseStateKey: 'softora',
    kvkDatabaseSyncToken: 'worker-token',
    fetchSupabaseRowByKeyViaRest: async (stateKey) => ({ ok: true, body: storedRows.get(stateKey) || null }),
    upsertSupabaseRowViaRest: async (row) => {
      storedRows.set(row.state_key, row);
      return { ok: true };
    },
    now: () => currentNow,
    ...overrides,
  });
  return {
    service,
    getStoredRow: (stateKey) => storedRows.get(stateKey) || null,
    setNow: (value) => { currentNow = new Date(value); },
  };
}

test('kvk database control defaults fail closed to disabled', async () => {
  const { service } = createInMemoryService();
  const response = createJsonResponse();

  await service.sendGetControlResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.control.enabled, false);
  assert.equal(response.payload.control.workerState, 'offline');
  assert.equal(response.payload.control.workers.vuller.workerState, 'offline');
  assert.equal(response.payload.control.workers.controle.workerState, 'offline');
  assert.equal(response.payload.control.workers.goedgekeurd.workerState, 'offline');
  assert.equal(service.controlStateKey, 'softora:kvk_database_control_v1');
  assert.deepEqual(service.workerStateKeys, {
    vuller: 'softora:kvk_database_worker_v1',
    controle: 'softora:kvk_database_worker_v1:controle',
    goedgekeurd: 'softora:kvk_database_worker_v1:goedgekeurd',
  });
});

test('dashboard control is read-only and token-protected chat command persists enabled state', async () => {
  const { service, getStoredRow } = createInMemoryService();
  const dashboardResponse = createJsonResponse();
  await service.sendPostControlResponse({ body: { enabled: true } }, dashboardResponse);
  assert.equal(dashboardResponse.statusCode, 405);
  assert.match(dashboardResponse.payload.error, /alleen-lezen/);

  const response = createJsonResponse();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.control.enabled, true);
  assert.equal(response.payload.control.revision, 1);
  assert.equal(response.payload.control.workerState, 'starting');
  assert.equal(response.payload.control.workers.vuller.workerState, 'starting');
  assert.equal(response.payload.control.workers.controle.workerState, 'starting');
  assert.equal(response.payload.control.workers.goedgekeurd.workerState, 'starting');
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, true);
  assert.equal(getStoredRow(service.controlStateKey).updated_at, '2026-07-26T20:30:00.000Z');
});

test('all three visible database workers report independently and must be active', async () => {
  const { service, getStoredRow } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );

  const rejected = createJsonResponse();
  await service.sendPollControlResponse({ headers: { authorization: 'Bearer wrong' } }, rejected);
  assert.equal(rejected.statusCode, 401);

  const report = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'vuller',
        workerState: 'running',
        workerMessage: 'Batch loopt.',
        currentBatch: 'shard 1/10',
      },
    },
    report
  );
  assert.equal(report.statusCode, 200);
  assert.equal(report.payload.control.enabled, true);
  assert.equal(report.payload.control.workerState, 'starting');
  assert.equal(report.payload.control.workers.vuller.workerState, 'running');
  assert.equal(report.payload.control.workers.controle.workerState, 'starting');
  assert.equal(report.payload.control.currentBatch, 'shard 1/10');
  assert.equal(service.workerStateKey, 'softora:kvk_database_worker_v1');
  assert.equal(getStoredRow(service.workerStateKeys.vuller).payload.workerKey, 'vuller');

  const controleReport = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'controle',
        workerState: 'running',
        workerMessage: 'Controlebatch loopt.',
        currentBatch: 'controle 1/10',
      },
    },
    controleReport
  );
  assert.equal(controleReport.statusCode, 200);
  assert.equal(controleReport.payload.control.workerState, 'starting');
  assert.equal(controleReport.payload.control.workers.vuller.workerState, 'running');
  assert.equal(controleReport.payload.control.workers.controle.workerState, 'running');
  assert.equal(controleReport.payload.control.workers.goedgekeurd.workerState, 'starting');
  assert.equal(getStoredRow(service.workerStateKeys.controle).payload.workerKey, 'controle');

  const goedgekeurdReport = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'goedgekeurd',
        workerState: 'running',
        workerMessage: 'Luna-goedkeuringen worden gecontroleerd.',
        currentBatch: 'goedgekeurd 1/6',
      },
    },
    goedgekeurdReport
  );
  assert.equal(goedgekeurdReport.statusCode, 200);
  assert.equal(goedgekeurdReport.payload.control.workerState, 'running');
  assert.equal(goedgekeurdReport.payload.control.workers.goedgekeurd.workerState, 'running');
  assert.equal(getStoredRow(service.workerStateKeys.goedgekeurd).payload.workerKey, 'goedgekeurd');

  const poll = createJsonResponse();
  await service.sendPollControlResponse(
    { headers: { authorization: 'Bearer worker-token' } },
    poll
  );
  assert.equal(poll.statusCode, 200);
  assert.equal(poll.payload.control.workerState, 'running');
});

test('a stale worker heartbeat durably switches the central control off', async () => {
  const { service, getStoredRow, setNow } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );
  for (const workerKey of ['vuller', 'controle', 'goedgekeurd']) {
    await service.sendReportWorkerResponse(
      {
        headers: { authorization: 'Bearer worker-token' },
        body: { workerKey, workerState: 'running', workerMessage: `${workerKey} loopt.` },
      },
      createJsonResponse()
    );
  }

  setNow('2026-07-26T20:33:00.001Z');
  const response = createJsonResponse();
  await service.sendGetControlResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.control.enabled, false);
  assert.equal(response.payload.control.revision, 2);
  assert.equal(response.payload.control.workerState, 'error');
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, false);
  assert.match(response.payload.control.automaticStopReason, /heartbeat is verlopen/);
});

test('fresh heartbeats cannot keep control on without persisted progress', async () => {
  const { service, getStoredRow, setNow } = createInMemoryService({
    workerStaleAfterMs: 60 * 60_000,
  });
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );

  setNow('2026-07-26T21:01:00.000Z');
  const report = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'vuller',
        workerState: 'running',
        workerProgressAt: '2026-07-26T20:30:00.000Z',
        queuePending: true,
        queueHeadKvk: '12345678',
      },
    },
    report
  );

  assert.equal(report.payload.control.enabled, false);
  assert.equal(report.payload.control.workerState, 'error');
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, false);
  assert.match(report.payload.control.automaticStopReason, /geen opgeslagen databasevoortgang/);
});

test('an explicit restart gets a fresh progress grace period after stale persisted progress', async () => {
  const { service, setNow } = createInMemoryService({
    workerStaleAfterMs: 60 * 60_000,
  });
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'vuller',
        workerState: 'running',
        workerProgressAt: '2026-07-26T19:00:00.000Z',
        queuePending: true,
      },
    },
    createJsonResponse()
  );

  const restarted = createJsonResponse();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    restarted
  );

  assert.equal(restarted.payload.control.enabled, true);
  assert.equal(restarted.payload.control.automaticStopReason, '');
  assert.equal(restarted.payload.control.workers.vuller.workerState, 'running');

  setNow('2026-07-26T21:00:00.001Z');
  const expired = createJsonResponse();
  await service.sendGetControlResponse({}, expired);

  assert.equal(expired.payload.control.enabled, false);
  assert.match(expired.payload.control.automaticStopReason, /geen opgeslagen databasevoortgang/);
});

test('an explicit worker error immediately and durably switches control off', async () => {
  const { service, getStoredRow } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );

  const response = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'vuller',
        workerState: 'error',
        workerMessage: 'no such column: usable_review_state',
        queuePending: true,
      },
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.control.enabled, false);
  assert.equal(response.payload.control.workerState, 'error');
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, false);
  assert.match(response.payload.control.automaticStopReason, /no such column/);
});

test('missing startup heartbeats switch control off after the startup grace period', async () => {
  const { service, getStoredRow, setNow } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );

  setNow('2026-07-26T20:32:30.001Z');
  const response = createJsonResponse();
  await service.sendGetControlResponse({}, response);

  assert.equal(response.payload.control.enabled, false);
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, false);
  assert.match(response.payload.control.automaticStopReason, /geen heartbeat ontvangen/);
});

test('a new start is not cancelled by an error report from the previous revision', async () => {
  const { service, setNow } = createInMemoryService();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: { workerKey: 'vuller', workerState: 'error', workerMessage: 'Oude fout.' },
    },
    createJsonResponse()
  );

  setNow('2026-07-26T20:31:00.000Z');
  const response = createJsonResponse();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    response
  );

  assert.equal(response.payload.control.enabled, true);
  assert.equal(response.payload.control.workerState, 'starting');
  assert.equal(response.payload.control.automaticStopReason, '');
});

test('a healthy empty lane is idle instead of pretending to be busy', async () => {
  const { service } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );
  const report = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: {
        workerKey: 'goedgekeurd',
        workerState: 'running',
        workerProgressAt: '2026-07-26T20:30:00.000Z',
        queuePending: false,
      },
    },
    report
  );

  assert.equal(report.payload.control.workers.goedgekeurd.workerState, 'idle');
  assert.equal(report.payload.control.workers.goedgekeurd.stalled, false);
  assert.match(report.payload.control.workers.goedgekeurd.workerMessage, /wachtrij leeg/);
});

test('completed work switches control off when every queue is empty', async () => {
  const { service, getStoredRow } = createInMemoryService();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: true } },
    createJsonResponse()
  );

  let response;
  for (const workerKey of ['vuller', 'controle', 'goedgekeurd']) {
    response = createJsonResponse();
    await service.sendReportWorkerResponse(
      {
        headers: { authorization: 'Bearer worker-token' },
        body: { workerKey, workerState: 'idle', queuePending: false },
      },
      response
    );
  }

  assert.equal(response.payload.control.enabled, false);
  assert.equal(getStoredRow(service.controlStateKey).payload.enabled, false);
  assert.match(response.payload.control.automaticStopReason, /is afgerond/);
});

test('kvk database control validates browser and worker payloads', async () => {
  const { service } = createInMemoryService();
  const unauthorizedCommand = createJsonResponse();
  await service.sendCommandControlResponse({ body: { enabled: true } }, unauthorizedCommand);
  assert.equal(unauthorizedCommand.statusCode, 401);

  const invalidToggle = createJsonResponse();
  await service.sendCommandControlResponse(
    { headers: { authorization: 'Bearer worker-token' }, body: { enabled: 'yes' } },
    invalidToggle
  );
  assert.equal(invalidToggle.statusCode, 400);

  const invalidWorker = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: { workerState: 'destroy-everything' },
    },
    invalidWorker
  );
  assert.equal(invalidWorker.statusCode, 400);

  const missingWorkerKey = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: { workerState: 'running' },
    },
    missingWorkerKey
  );
  assert.equal(missingWorkerKey.statusCode, 400);

  const invalidWorkerKey = createJsonResponse();
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: { workerKey: 'alles', workerState: 'running' },
    },
    invalidWorkerKey
  );
  assert.equal(invalidWorkerKey.statusCode, 400);
});
