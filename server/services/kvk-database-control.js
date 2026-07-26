const crypto = require('node:crypto');

const DEFAULT_CONTROL_KEY_SUFFIX = 'kvk_database_control_v1';
const DEFAULT_WORKER_KEY_SUFFIX = 'kvk_database_worker_v1';
const WORKER_STATES = new Set(['offline', 'idle', 'starting', 'running', 'waiting', 'error']);

function createKvkDatabaseControlService(deps = {}) {
  const {
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null, error: 'Opslag niet beschikbaar.' }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, error: 'Opslag niet beschikbaar.' }),
    supabaseStateKey = 'core',
    kvkDatabaseSyncToken = '',
    fallbackSyncToken = '',
    controlReadTimeoutMs = 15_000,
    controlWriteTimeoutMs = 30_000,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;

  const controlStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_CONTROL_KEY_SUFFIX}`;
  const workerStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_WORKER_KEY_SUFFIX}`;

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

  function defaultWorker() {
    return {
      workerState: 'offline',
      workerMessage: '',
      workerHeartbeatAt: '',
      currentBatch: '',
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

  function normalizeWorker(payload = {}) {
    const workerState = normalizeString(payload.workerState || 'offline').toLowerCase();
    return {
      workerState: WORKER_STATES.has(workerState) ? workerState : 'offline',
      workerMessage: truncateText(payload.workerMessage || '', 240),
      workerHeartbeatAt: normalizeString(payload.workerHeartbeatAt || ''),
      currentBatch: truncateText(payload.currentBatch || '', 160),
      updatedAt: normalizeString(payload.updatedAt || ''),
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
    const [controlResult, workerResult] = await Promise.all([
      readStateRow(controlStateKey, 'Databasevulling-besturing kon niet worden geladen.'),
      readStateRow(workerStateKey, 'Databasevulling-workerstatus kon niet worden geladen.'),
    ]);
    if (!controlResult.ok) return controlResult;
    if (!workerResult.ok) return workerResult;
    return {
      ok: true,
      control: {
        ...normalizeControlRequest({ ...defaultControl(), ...controlResult.payload }),
        ...normalizeWorker({ ...defaultWorker(), ...workerResult.payload }),
      },
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

  async function sendPostControlResponse(req, res) {
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
    return saved.ok
      ? res.status(200).json({ ok: true, control: { ...current.control, ...controlRequest } })
      : res.status(502).json({ ok: false, error: saved.error });
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
    const updatedAt = now().toISOString();
    const worker = normalizeWorker({
      workerState,
      workerMessage: req?.body?.workerMessage || '',
      workerHeartbeatAt: updatedAt,
      currentBatch: req?.body?.currentBatch || '',
      updatedAt,
    });
    const saved = await writeStateRow(
      workerStateKey,
      worker,
      'Databasevulling-workerstatus opslaan mislukt.'
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
    sendGetControlResponse,
    sendPollControlResponse,
    sendPostControlResponse,
    sendReportWorkerResponse,
  };
}

module.exports = {
  createKvkDatabaseControlService,
};
