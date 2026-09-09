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
    lunaMaxWorkerStaleAfterMs = 10 * 60_000,
    workerProgressStaleAfterMs = 30 * 60_000,
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
      automaticStoppedAt: '',
      automaticStopReason: '',
      automaticStopWasFailure: false,
    };
  }

  function defaultWorker(workerKey = 'vuller') {
    return {
      workerKey,
      workerState: 'offline',
      workerMessage: '',
      model: '',
      reasoningEffort: '',
      workerHeartbeatAt: '',
      workerProgressAt: '',
      queuePending: null,
      queueHeadKvk: '',
      currentBatch: '',
      controlRevision: 0,
      updatedAt: '',
    };
  }

  function normalizeControlRequest(payload = {}) {
    return {
      enabled: payload.enabled === true,
      activeWorkerKeys: Array.isArray(payload.activeWorkerKeys)
        && payload.activeWorkerKeys.length > 0
        && payload.activeWorkerKeys.every((key) => WORKER_KEYS.has(key))
        ? [...new Set(payload.activeWorkerKeys)]
        : [...WORKER_KEYS],
      revision: Math.max(0, Number(payload.revision || 0)),
      requestedAt: normalizeString(payload.requestedAt || ''),
      updatedAt: normalizeString(payload.updatedAt || ''),
      automaticStoppedAt: normalizeString(payload.automaticStoppedAt || ''),
      automaticStopReason: truncateText(payload.automaticStopReason || '', 240),
      automaticStopWasFailure: payload.automaticStopWasFailure === true,
    };
  }

  function normalizeWorker(payload = {}, workerKey = 'vuller') {
    const workerState = normalizeString(payload.workerState || 'offline').toLowerCase();
    return {
      workerKey,
      workerState: WORKER_STATES.has(workerState) ? workerState : 'offline',
      workerMessage: truncateText(payload.workerMessage || '', 240),
      model: truncateText(payload.model || '', 80),
      reasoningEffort: truncateText(payload.reasoningEffort || '', 20),
      workerHeartbeatAt: normalizeString(payload.workerHeartbeatAt || ''),
      workerProgressAt: normalizeString(payload.workerProgressAt || ''),
      queuePending: typeof payload.queuePending === 'boolean' ? payload.queuePending : null,
      queueHeadKvk: truncateText(payload.queueHeadKvk || '', 32),
      currentBatch: truncateText(payload.currentBatch || '', 160),
      controlRevision: Math.max(0, Number(payload.controlRevision || 0)),
      updatedAt: normalizeString(payload.updatedAt || ''),
    };
  }

  function heartbeatStaleAfterMs(worker) {
    // Native Luna Max reasoning and compaction can exceed the ordinary heartbeat
    // interval. Keep a finite liveness deadline and the separate progress gate.
    return worker.model === 'gpt-5.6-luna' && worker.reasoningEffort === 'max'
      ? Math.max(workerStaleAfterMs, lunaMaxWorkerStaleAfterMs)
      : workerStaleAfterMs;
  }

  function effectiveWorker(control, worker) {
    if (!control.activeWorkerKeys.includes(worker.workerKey)) {
      return { ...worker, workerState: 'idle', workerMessage: 'Niet geselecteerd voor deze run.', currentBatch: '', stale: false, stalled: false };
    }
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
    if (heartbeatAgeMs > heartbeatStaleAfterMs(worker)) {
      return {
        ...worker,
        workerState: 'waiting',
        workerMessage: `${WORKER_LABELS[worker.workerKey]}: geen recente heartbeat; continuiteitsbewaking hervat automatisch.`,
        stale: true,
      };
    }
    if (worker.queuePending === false) {
      return {
        ...worker,
        workerState: 'idle',
        workerMessage: `${WORKER_LABELS[worker.workerKey]}: wachtrij leeg; wacht op nieuw werk.`,
        stale: false,
        stalled: false,
      };
    }
    const progressAt = Date.parse(worker.workerProgressAt || '');
    const progressReferenceAt = Number.isFinite(progressAt)
      && (!Number.isFinite(requestedAt) || progressAt >= requestedAt)
      ? progressAt
      : requestedAt;
    const progressAgeMs = Number.isFinite(progressReferenceAt)
      ? Math.max(0, now().getTime() - progressReferenceAt)
      : 0;
    if (
      worker.queuePending === true &&
      worker.workerState === 'running' &&
      Number.isFinite(progressAt) &&
      progressAgeMs > workerProgressStaleAfterMs
    ) {
      return {
        ...worker,
        workerState: 'waiting',
        workerMessage: `${WORKER_LABELS[worker.workerKey]}: heartbeat actief maar geen opgeslagen voortgang; continuiteitsbewaking moet hervatten.`,
        stale: false,
        stalled: true,
      };
    }
    return { ...worker, stale: false, stalled: false };
  }

  function combinedWorkerState(workers, enabled) {
    const states = Object.values(workers).map((worker) => worker.workerState);
    if (states.includes('error')) return 'error';
    if (enabled && states.includes('starting')) return 'starting';
    if (states.includes('waiting')) return 'waiting';
    if (states.includes('running')) return 'running';
    if (states.every((state) => state === 'idle')) return 'idle';
    return states.every((state) => state === 'offline') ? 'offline' : 'idle';
  }

  function combinedControl(control, workers) {
    const workerList = control.activeWorkerKeys.map((key) => workers[key]);
    const heartbeatValues = workerList
      .map((worker) => worker.workerHeartbeatAt)
      .filter(Boolean)
      .sort();
    const batches = workerList
      .map((worker) => worker.currentBatch)
      .filter(Boolean);
    return {
      ...control,
      workerState: control.automaticStopReason && control.automaticStopWasFailure
        ? 'error'
        : combinedWorkerState(Object.fromEntries(workerList.map((worker) => [worker.workerKey, worker])), control.enabled),
      workerMessage: control.automaticStopReason || workerList
        .map((worker) => worker.workerMessage || `${WORKER_LABELS[worker.workerKey]}: ${worker.workerState}`)
        .join(' • '),
      workerHeartbeatAt: heartbeatValues.at(-1) || '',
      currentBatch: batches.join(' • '),
      workers,
    };
  }

  function automaticStopReason(control, workers) {
    if (!control.enabled) return '';
    const currentTime = now().getTime();
    const requestedAt = Date.parse(control.requestedAt || '');
    const startGraceExpired = !Number.isFinite(requestedAt)
      || currentTime - requestedAt > workerStaleAfterMs;

    const workerList = control.activeWorkerKeys.map((key) => workers[key]);
    const hasCurrentHeartbeat = (worker) => {
      const heartbeatAt = Date.parse(worker.workerHeartbeatAt || '');
      return Number.isFinite(heartbeatAt)
        && (!Number.isFinite(requestedAt) || heartbeatAt >= requestedAt);
    };
    if (
      workerList.every((worker) => hasCurrentHeartbeat(worker))
      && workerList.every((worker) => worker.queuePending === false)
    ) {
      return {
        reason: 'Alle databasewachtrijen zijn leeg; database vullen is afgerond.',
        wasFailure: false,
      };
    }

    for (const worker of workerList) {
      const label = WORKER_LABELS[worker.workerKey];
      const heartbeatAt = Date.parse(worker.workerHeartbeatAt || '');
      const heartbeatMissing = !Number.isFinite(heartbeatAt);
      const heartbeatPredatesRequest = Number.isFinite(requestedAt) && heartbeatAt < requestedAt;
      if (heartbeatMissing || heartbeatPredatesRequest) {
        if (startGraceExpired) {
          return { reason: `${label} is niet gestart: geen heartbeat ontvangen.`, wasFailure: true };
        }
        continue;
      }
      if (Number.isFinite(heartbeatAt) && currentTime - heartbeatAt > heartbeatStaleAfterMs(worker)) {
        return { reason: `${label} is gestopt: de heartbeat is verlopen.`, wasFailure: true };
      }

      if (worker.workerState === 'error') {
        return {
          reason: `${label} is door een fout gestopt${worker.workerMessage ? `: ${worker.workerMessage}` : '.'}`,
          wasFailure: true,
        };
      }

      if (worker.queuePending === true && ['offline', 'idle'].includes(worker.workerState)) {
        return {
          reason: `${label} is gestopt terwijl de wachtrij nog werk bevat.`,
          wasFailure: true,
        };
      }

      if (worker.queuePending === true) {
        const progressAt = Date.parse(worker.workerProgressAt || '');
        const progressReferenceAt = Number.isFinite(progressAt)
          && (!Number.isFinite(requestedAt) || progressAt >= requestedAt)
          ? progressAt
          : requestedAt;
        const progressExpired = Number.isFinite(progressReferenceAt)
          && currentTime - progressReferenceAt > workerProgressStaleAfterMs;
        if (progressExpired) {
          return {
            reason: `${label} is gestopt: te lang geen opgeslagen databasevoortgang.`,
            wasFailure: true,
          };
        }
      }
    }
    return '';
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
    let control = normalizeControlRequest({ ...defaultControl(), ...controlResult.payload });
    const reportedWorkers = {
      vuller: normalizeWorker({ ...defaultWorker('vuller'), ...vullerResult.payload }, 'vuller'),
      controle: normalizeWorker({ ...defaultWorker('controle'), ...controleResult.payload }, 'controle'),
      goedgekeurd: normalizeWorker(
        { ...defaultWorker('goedgekeurd'), ...goedgekeurdResult.payload },
        'goedgekeurd'
      ),
    };
    const automaticStop = automaticStopReason(control, reportedWorkers);
    if (automaticStop) {
      const updatedAt = now().toISOString();
      control = normalizeControlRequest({
        ...control,
        enabled: false,
        revision: control.revision + 1,
        requestedAt: updatedAt,
        updatedAt,
        automaticStoppedAt: updatedAt,
        automaticStopReason: automaticStop.reason,
        automaticStopWasFailure: automaticStop.wasFailure,
      });
      const saved = await writeStateRow(
        controlStateKey,
        control,
        'Databasevulling kon na workeruitval niet automatisch worden uitgezet.'
      );
      if (!saved.ok) return saved;
    }
    const workers = Object.fromEntries(
      Object.entries(reportedWorkers).map(([workerKey, worker]) => [
        workerKey,
        effectiveWorker(control, worker),
      ])
    );
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
    if (req.body.activeWorkerKeys !== undefined && (
      !Array.isArray(req.body.activeWorkerKeys)
      || req.body.activeWorkerKeys.length === 0
      || req.body.activeWorkerKeys.some((key) => !WORKER_KEYS.has(key))
      || new Set(req.body.activeWorkerKeys).size !== req.body.activeWorkerKeys.length
    )) {
      return res.status(400).json({ ok: false, error: 'activeWorkerKeys moet unieke geldige worker-lanes bevatten.' });
    }
    const current = await readControl();
    if (!current.ok) return res.status(503).json({ ok: false, error: current.error });
    const updatedAt = now().toISOString();
    const controlRequest = normalizeControlRequest({
      enabled: req.body.enabled,
      activeWorkerKeys: req.body.activeWorkerKeys ?? current.control.activeWorkerKeys,
      revision: current.control.revision + 1,
      requestedAt: updatedAt,
      updatedAt,
      automaticStoppedAt: '',
      automaticStopReason: '',
      automaticStopWasFailure: false,
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
    if (beforeReport.control.enabled && !beforeReport.control.activeWorkerKeys.includes(workerKey)) {
      return res.status(409).json({ ok: false, error: 'Deze worker is niet geselecteerd voor deze run.' });
    }
    const updatedAt = now().toISOString();
    const worker = normalizeWorker({
      workerState,
      workerMessage: req?.body?.workerMessage || '',
      model: req?.body?.model || '',
      reasoningEffort: req?.body?.reasoningEffort || '',
      workerHeartbeatAt: updatedAt,
      workerProgressAt: req?.body?.workerProgressAt || '',
      queuePending: req?.body?.queuePending,
      queueHeadKvk: req?.body?.queueHeadKvk || '',
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
