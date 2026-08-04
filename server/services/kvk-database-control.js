const crypto = require('node:crypto');

const DEFAULT_CONTROL_KEY_SUFFIX = 'kvk_database_control_v1';
const DEFAULT_WORKER_KEY_SUFFIX = 'kvk_database_worker_v1';
const WORKER_STATES = new Set(['offline', 'idle', 'starting', 'running', 'waiting', 'error']);
const WORKER_KEYS = new Set(['vuller', 'controle', 'goedgekeurd']);
const WORKER_LABELS = Object.freeze({
  vuller: 'Vuller',
  controle: 'Controle',
  goedgekeurd: 'Goedgekeurd controle',
});

function createKvkDatabaseControlService(deps = {}) {
  const {
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null, error: 'Opslag niet beschikbaar.' }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, error: 'Opslag niet beschikbaar.' }),
    supabaseStateKey = 'core',
    kvkDatabaseSyncToken = '',
    fallbackSyncToken = '',
    controlReadTimeoutMs = 15_000,
    controlWriteTimeoutMs = 30_000,
    workerStaleAfterMs = 150_000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;

  const controlStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_CONTROL_KEY_SUFFIX}`;
  const workerStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_WORKER_KEY_SUFFIX}`;
  const workerStateKeys = Object.freeze({
    vuller: workerStateKey,
    controle: `${workerStateKey}:controle`,
    goedgekeurd: `${workerStateKey}:goedgekeurd`,
  });

  function constantTimeEquals(left, right) {
    const leftText = normalizeString(left);
    const rightText = normalizeString(right);
    if (!leftText || !rightText) return false;
    const leftBuffer = Buffer.from(leftText);
    const rightBuffer = Buffer.from(rightText);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function extractRequestToken(req) {
    const authorization = normalizeString(req?.headers?.authorization || '');
    if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
    return normalizeString(req?.headers?.['x-kvk-sync-token'] || req?.headers?.['x-softora-sync-token'] || '');
  }

  function hasValidWorkerToken(req) {
    const requestToken = extractRequestToken(req);
    return [kvkDatabaseSyncToken, fallbackSyncToken]
      .map((token) => normalizeString(token))
      .filter(Boolean)
      .some((token) => constantTimeEquals(requestToken, token));
  }

  function defaultControl() {
    return {
      enabled: false,
      revision: 0,
      requestedAt: '',
      updatedAt: '',
    };
  }

  function defaultWorker(workerKey = 'vuller') {
    return {
      workerKey,
      workerState: 'offline',
      workerMessage: '',
      workerHeartbeatAt: '',
      currentBatch: '',
      controlRevision: 0,
      updatedAt: '',
    };
  }

  function normalizeControlRequest(payload = {}) {
    return {
      enabled: payload.enabled === true,
      revision: Math.max(0, Number(payload.revision || 0)),
      requestedAt: normalizeString(payload.requestedAt || ''),
      updatedAt: normalizeString(payload.updatedAt || ''),
    };
  }

  function normalizeWorker(payload = {}, workerKey = 'vuller') {
    const workerState = normalizeString(payload.workerState || 'offline').toLowerCase();
    return {
      workerKey,
      workerState: WORKER_STATES.has(workerState) ? workerState : 'offline',
      workerMessage: truncateText(payload.workerMessage || '', 240),
      workerHeartbeatAt: normalizeString(payload.workerHeartbeatAt || ''),
      currentBatch: truncateText(payload.currentBatch || '', 160),
      controlRevision: Math.max(0, Number(payload.controlRevision || 0)),
      updatedAt: normalizeString(payload.updatedAt || ''),
    };
  }

  function effectiveWorker(control, worker) {
    if (!control.enabled) return { ...worker, stale: false };
    const requestedAt = Date.parse(control.requestedAt || '');
    const heartbeatAt = Date.parse(worker.workerHeartbeatAt || '');
    const heartbeatIsMissing = !Number.isFinite(heartbeatAt);
    const heartbeatPredatesRequest = Number.isFinite(requestedAt) && heartbeatAt < requestedAt;
    if (heartbeatIsMissing || heartbeatPredatesRequest) {
      return {
        ...worker,
        workerState: 'starting',
        workerMessage: `${WORKER_LABELS[worker.workerKey]}: start aangevraagd; wacht op de eerstvolgende heartbeat.`,
        stale: true,
      };
    }
    const heartbeatAgeMs = Math.max(0, now().getTime() - heartbeatAt);
    if (heartbeatAgeMs > workerStaleAfterMs) {
      return {
        ...worker,
        workerState: 'waiting',
        workerMessage: `${WORKER_LABELS[worker.workerKey]}: geen recente heartbeat; continuiteitsbewaking hervat automatisch.`,
        stale: true,
      };
    }
    return { ...worker, stale: false };
  }

  function combinedWorkerState(workers, enabled) {
    const states = Object.values(workers).map((worker) => worker.workerState);
    if (states.includes('error')) return 'error';
    if (enabled && states.includes('starting')) return 'starting';
    if (states.includes('running')) return 'running';
    if (states.includes('waiting')) return 'waiting';
    if (states.every((state) => state === 'idle')) return 'idle';
    return states.every((state) => state === 'offline') ? 'offline' : 'idle';
  }

  function combinedControl(control, workers) {
    const workerList = Object.values(workers);
    const heartbeatValues = workerList
      .map((worker) => worker.workerHeartbeatAt)
      .filter(Boolean)
      .sort();
    const batches = workerList
      .map((worker) => worker.currentBatch)
      .filter(Boolean);
    return {
      ...control,
      workerState: combinedWorkerState(workers, control.enabled),
      workerMessage: workerList
        .map((worker) => worker.workerMessage || `${WORKER_LABELS[worker.workerKey]}: ${worker.workerState}`)
        .join(' • '),
      workerHeartbeatAt: heartbeatValues.at(-1) || '',
      currentBatch: batches.join(' • '),
      workers,
    };
  }

  async function readStateRow(stateKey, failureMessage) {
    const result = await fetchSupabaseRowByKeyViaRest(stateKey, 'payload,updated_at', {
      timeoutMs: controlReadTimeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!result || !result.ok) {
      return { ok: false, error: truncateText(result?.error || failureMessage, 500) };
    }
    const row = Array.isArray(result.body) ? result.body[0] || null : result.body || null;
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      ok: true,
      payload: { ...payload, updatedAt: payload.updatedAt || row?.updated_at || '' },
    };
  }

  async function readControl() {
    const [controlResult, vullerResult, controleResult, goedgekeurdResult] = await Promise.all([
      readStateRow(controlStateKey, 'Databasevulling-besturing kon niet worden geladen.'),
      readStateRow(workerStateKeys.vuller, 'Databasevulling Vuller-status kon niet worden geladen.'),
      readStateRow(workerStateKeys.controle, 'Databasevulling Controle-status kon niet worden geladen.'),
      readStateRow(
        workerStateKeys.goedgekeurd,
        'Databasevulling Goedgekeurd controle-status kon niet worden geladen.'
      ),
    ]);
    if (!controlResult.ok) return controlResult;
    if (!vullerResult.ok) return vullerResult;
    if (!controleResult.ok) return controleResult;
    if (!goedgekeurdResult.ok) return goedgekeurdResult;
    const control = normalizeControlRequest({ ...defaultControl(), ...controlResult.payload });
    const workers = {
      vuller: effectiveWorker(
        control,
        normalizeWorker({ ...defaultWorker('vuller'), ...vullerResult.payload }, 'vuller')
      ),
      controle: effectiveWorker(
        control,
        normalizeWorker({ ...defaultWorker('controle'), ...controleResult.payload }, 'controle')
      ),
      goedgekeurd: effectiveWorker(
        control,
        normalizeWorker(
          { ...defaultWorker('goedgekeurd'), ...goedgekeurdResult.payload },
          'goedgekeurd'
        )
      ),
    };
    return {
      ok: true,
      control: combinedControl(control, workers),
    };
  }

  async function writeStateRow(stateKey, payload, failureMessage) {
    const result = await upsertSupabaseRowViaRest(
      {
        state_key: stateKey,
        payload,
        updated_at: payload.updatedAt,
      },
      {
        timeoutMs: controlWriteTimeoutMs,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }
    );
    return result && result.ok
      ? { ok: true, payload }
      : { ok: false, error: truncateText(result?.error || failureMessage, 500) };
  }

  async function sendGetControlResponse(_req, res) {
    const result = await readControl();
    return result.ok
      ? res.status(200).json({ ok: true, control: result.control })
      : res.status(503).json({ ok: false, error: result.error });
  }

  async function persistControlRequest(req, res) {
    if (typeof req?.body?.enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled moet true of false zijn.' });
    }
    const current = await readControl();
    if (!current.ok) return res.status(503).json({ ok: false, error: current.error });
    const updatedAt = now().toISOString();
    const controlRequest = normalizeControlRequest({
      enabled: req.body.enabled,
      revision: current.control.revision + 1,
      requestedAt: updatedAt,
      updatedAt,
    });
    const saved = await writeStateRow(
      controlStateKey,
      controlRequest,
      'Databasevulling-besturing opslaan mislukt.'
    );
    if (!saved.ok) return res.status(502).json({ ok: false, error: saved.error });
    const refreshed = await readControl();
    return refreshed.ok
      ? res.status(200).json({ ok: true, control: refreshed.control })
      : res.status(503).json({ ok: false, error: refreshed.error });
  }

  async function sendPostControlResponse(_req, res) {
    return res.status(405).json({
      ok: false,
      error: 'Deze dashboardstatus is alleen-lezen. Start of stop database vullen uitsluitend via de Codex-chat.',
    });
  }

  async function sendCommandControlResponse(req, res) {
    if (!hasValidWorkerToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK worker-token.' });
    }
    return persistControlRequest(req, res);
  }

  async function sendPollControlResponse(req, res) {
    if (!hasValidWorkerToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK worker-token.' });
    }
    return sendGetControlResponse(req, res);
  }

  async function sendReportWorkerResponse(req, res) {
    if (!hasValidWorkerToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK worker-token.' });
    }
    const workerState = normalizeString(req?.body?.workerState || '').toLowerCase();
    if (!WORKER_STATES.has(workerState)) {
      return res.status(400).json({ ok: false, error: 'Ongeldige workerState.' });
    }
    const workerKey = normalizeString(req?.body?.workerKey || '').toLowerCase();
    if (!WORKER_KEYS.has(workerKey)) {
      return res.status(400).json({ ok: false, error: 'Ongeldige workerKey.' });
    }
    const beforeReport = await readControl();
    if (!beforeReport.ok) return res.status(503).json({ ok: false, error: beforeReport.error });
    const updatedAt = now().toISOString();
    const worker = normalizeWorker({
      workerState,
      workerMessage: req?.body?.workerMessage || '',
      workerHeartbeatAt: updatedAt,
      currentBatch: req?.body?.currentBatch || '',
      controlRevision: req?.body?.controlRevision ?? beforeReport.control.revision,
      updatedAt,
    }, workerKey);
    const saved = await writeStateRow(
      workerStateKeys[workerKey],
      worker,
      `Databasevulling ${WORKER_LABELS[workerKey]}-status opslaan mislukt.`
    );
    if (!saved.ok) return res.status(502).json({ ok: false, error: saved.error });
    const current = await readControl();
    return current.ok
      ? res.status(200).json({ ok: true, control: current.control })
      : res.status(503).json({ ok: false, error: current.error });
  }

  return {
    controlStateKey,
    workerStateKey,
    workerStateKeys,
    sendGetControlResponse,
    sendCommandControlResponse,
    sendPollControlResponse,
    sendPostControlResponse,
    sendReportWorkerResponse,
  };
}

module.exports = {
  createKvkDatabaseControlService,
};
