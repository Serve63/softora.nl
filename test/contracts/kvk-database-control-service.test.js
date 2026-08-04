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

function createInMemoryService() {
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

test('premium control request persists the requested enabled state', async () => {
  const { service, getStoredRow } = createInMemoryService();
  const response = createJsonResponse();

  await service.sendPostControlResponse({ body: { enabled: true } }, response);

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
  await service.sendPostControlResponse({ body: { enabled: true } }, createJsonResponse());

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

test('stale worker heartbeat is exposed as waiting for self-healing', async () => {
  const { service, setNow } = createInMemoryService();
  await service.sendPostControlResponse({ body: { enabled: true } }, createJsonResponse());
  await service.sendReportWorkerResponse(
    {
      headers: { authorization: 'Bearer worker-token' },
      body: { workerKey: 'controle', workerState: 'running', workerMessage: 'Controlebatch loopt.' },
    },
    createJsonResponse()
  );

  setNow('2026-07-26T20:33:00.001Z');
  const response = createJsonResponse();
  await service.sendGetControlResponse({}, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.control.workers.controle.workerState, 'waiting');
  assert.equal(response.payload.control.workers.controle.stale, true);
  assert.match(response.payload.control.workers.controle.workerMessage, /hervat automatisch/);
});

test('kvk database control validates browser and worker payloads', async () => {
  const { service } = createInMemoryService();
  const invalidToggle = createJsonResponse();
  await service.sendPostControlResponse({ body: { enabled: 'yes' } }, invalidToggle);
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
