const crypto = require('node:crypto');
const { getLast60Minutes } = require('../../assets/kvk-database-metrics');

const DEFAULT_STATE_KEY_SUFFIX = 'kvk_database_snapshot_v1';
const DEFAULT_PROGRESS_KEY_SUFFIX = 'kvk_database_progress_v1';
const MAX_SNAPSHOT_BYTES = 7_500_000;
const MAX_PROGRESS_BYTES = 250_000;
const DEFAULT_SNAPSHOT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_SNAPSHOT_WRITE_TIMEOUT_MS = 30_000;

function createKvkDatabaseSnapshotService(deps = {}) {
  const {
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null, error: 'Opslag niet beschikbaar.' }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, error: 'Opslag niet beschikbaar.' }),
    supabaseStateKey = 'core',
    kvkDatabaseSyncToken = '',
    fallbackSyncToken = '',
    snapshotReadTimeoutMs = DEFAULT_SNAPSHOT_READ_TIMEOUT_MS,
    snapshotWriteTimeoutMs = DEFAULT_SNAPSHOT_WRITE_TIMEOUT_MS,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    now = () => new Date(),
  } = deps;

  const snapshotStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_STATE_KEY_SUFFIX}`;
  const progressStateKey = `${normalizeString(supabaseStateKey) || 'core'}:${DEFAULT_PROGRESS_KEY_SUFFIX}`;
  let progressWriteQueue = Promise.resolve();

  function constantTimeEquals(left, right) {
    const leftText = normalizeString(left);
    const rightText = normalizeString(right);
    if (!leftText || !rightText) return false;
    const leftBuffer = Buffer.from(leftText);
    const rightBuffer = Buffer.from(rightText);
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  function getAcceptedTokens() {
    return [kvkDatabaseSyncToken, fallbackSyncToken]
      .map((token) => normalizeString(token))
      .filter(Boolean);
  }

  function extractRequestToken(req) {
    const authorization = normalizeString(req?.headers?.authorization || '');
    if (/^bearer\s+/i.test(authorization)) return authorization.replace(/^bearer\s+/i, '').trim();
    return normalizeString(
      req?.headers?.['x-kvk-sync-token'] ||
        req?.headers?.['x-softora-sync-token'] ||
        req?.body?.syncToken ||
        ''
    );
  }

  function hasValidSyncToken(req) {
    const requestToken = extractRequestToken(req);
    const acceptedTokens = getAcceptedTokens();
    return acceptedTokens.some((token) => constantTimeEquals(requestToken, token));
  }

  function getSubmittedSnapshot(body = {}) {
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      if (body.snapshot && typeof body.snapshot === 'object' && !Array.isArray(body.snapshot)) {
        return body.snapshot;
      }
      if (body.state && typeof body.state === 'object' && !Array.isArray(body.state)) {
        return body;
      }
    }
    return null;
  }

  function getSubmittedProgress(body = {}) {
    if (
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      body.progress &&
      typeof body.progress === 'object' &&
      !Array.isArray(body.progress)
    ) {
      return body.progress;
    }
    return null;
  }

  function summarizeSnapshot(snapshot) {
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state : {};
    const companyTotals =
      snapshot && typeof snapshot.companyTotals === 'object' ? snapshot.companyTotals : {};
    return {
      companiesFound: Number(state.companies_found || companyTotals.all || 0),
      successfulFound: getSuccessfulFoundCount(snapshot),
      usable: Number(companyTotals.usable || 0),
      withWebsite: Number(state.with_website || companyTotals.with_website || 0),
      withoutWebsite: Number(state.without_website || companyTotals.without_website || 0),
      unusable: Number(state.unusable || companyTotals.unusable || 0),
      generatedAt: normalizeString(snapshot?.generatedAt || ''),
    };
  }

  function normalizeCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  }

  function getUsableCount(snapshot) {
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state : {};
    const companyTotals =
      snapshot && typeof snapshot.companyTotals === 'object' ? snapshot.companyTotals : {};
    if (companyTotals.usable !== null && companyTotals.usable !== undefined) {
      return normalizeCount(companyTotals.usable);
    }
    return normalizeCount(state.with_website) + normalizeCount(state.without_website);
  }

  function getSuccessfulFoundCount(snapshot, fallback = 0) {
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state : {};
    if (state.successful_found !== null && state.successful_found !== undefined) {
      return normalizeCount(state.successful_found);
    }
    return normalizeCount(fallback || getUsableCount(snapshot));
  }

  function withSuccessfulFoundCount(snapshot, successfulFound) {
    return {
      ...snapshot,
      state: {
        ...snapshot.state,
        successful_found: normalizeCount(successfulFound),
      },
    };
  }

  function buildSuccessfulFoundTracker(snapshot, storedPayload) {
    const currentUsable = getUsableCount(snapshot);
    const submittedSuccessfulFound = snapshot?.state?.successful_found;
    if (submittedSuccessfulFound !== null && submittedSuccessfulFound !== undefined) {
      return {
        total: normalizeCount(submittedSuccessfulFound),
        currentUsable,
      };
    }
    const storedSnapshot = storedPayload?.snapshot;
    if (!storedSnapshot || typeof storedSnapshot !== 'object') {
      return { total: currentUsable, currentUsable };
    }

    const storedTracker = storedPayload?.successfulFoundTracker;
    const previousUsable = normalizeCount(
      storedTracker?.currentUsable ?? getUsableCount(storedSnapshot)
    );
    const previousTotal = normalizeCount(
      storedTracker?.total ?? getSuccessfulFoundCount(storedSnapshot, previousUsable)
    );
    return {
      total: previousTotal + Math.max(0, currentUsable - previousUsable),
      currentUsable,
    };
  }

  function validateSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return 'Snapshot ontbreekt of is ongeldig.';
    }
    if (!snapshot.state || typeof snapshot.state !== 'object' || Array.isArray(snapshot.state)) {
      return 'Snapshot mist state.';
    }
    if (!Array.isArray(snapshot.locations)) {
      return 'Snapshot mist locations.';
    }
    const serialized = JSON.stringify(snapshot);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      return `Snapshot is te groot. Maximaal ${MAX_SNAPSHOT_BYTES} bytes.`;
    }
    return '';
  }

  function validateProgress(progress) {
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) {
      return 'Voortgangssnapshot ontbreekt of is ongeldig.';
    }
    if (!progress.state || typeof progress.state !== 'object' || Array.isArray(progress.state)) {
      return 'Voortgangssnapshot mist state.';
    }
    if (!Array.isArray(progress.latestTreated)) {
      return 'Voortgangssnapshot mist latestTreated.';
    }
    if (progress.latestTreated.length > 10) {
      return 'Voortgangssnapshot bevat meer dan 10 behandelde bedrijven.';
    }
    if (Buffer.byteLength(JSON.stringify(progress), 'utf8') > MAX_PROGRESS_BYTES) {
      return `Voortgangssnapshot is te groot. Maximaal ${MAX_PROGRESS_BYTES} bytes.`;
    }
    return '';
  }

  function timestampMs(value) {
    const parsed = Date.parse(normalizeString(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function progressTimestamp(progress, fallback = '') {
    return timestampMs(
      progress?.generatedAt || progress?.updatedAt || progress?.state?.served_at || fallback
    );
  }

  function queueProgressWrite(task) {
    const next = progressWriteQueue.then(task, task);
    progressWriteQueue = next.catch(() => undefined);
    return next;
  }

  async function sendGetSnapshotResponse(_req, res) {
    const result = await fetchSupabaseRowByKeyViaRest(snapshotStateKey, 'payload,updated_at', {
      timeoutMs: snapshotReadTimeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!result || !result.ok) {
      return res.status(503).json({
        ok: false,
        error: truncateText(result?.error || 'KVK snapshot kon niet worden geladen.', 500),
      });
    }

    const row = Array.isArray(result.body) ? result.body[0] || null : result.body || null;
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : null;
    const storedSnapshot = payload && payload.snapshot ? payload.snapshot : null;
    const successfulFound = normalizeCount(
      payload?.successfulFoundTracker?.total ?? getSuccessfulFoundCount(storedSnapshot)
    );
    let snapshot = storedSnapshot
      ? withSuccessfulFoundCount(storedSnapshot, successfulFound)
      : null;
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(404).json({ ok: false, error: 'Nog geen live KVK snapshot opgeslagen.' });
    }

    if (snapshot.state.last_60_minutes) {
      snapshot = {
        ...snapshot,
        state: { ...snapshot.state, last_60_minutes: getLast60Minutes(snapshot, now()) },
      };
    }

    return res.status(200).json({
      ok: true,
      updatedAt: normalizeString(payload.updatedAt || row.updated_at || ''),
      summary: summarizeSnapshot(snapshot),
      snapshot,
    });
  }

  async function sendGetProgressResponse(_req, res) {
    const result = await fetchSupabaseRowByKeyViaRest(progressStateKey, 'payload,updated_at', {
      timeoutMs: snapshotReadTimeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!result || !result.ok) {
      return res.status(503).json({
        ok: false,
        error: truncateText(result?.error || 'KVK voortgang kon niet worden geladen.', 500),
      });
    }
    const row = Array.isArray(result.body) ? result.body[0] || null : result.body || null;
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : null;
    const progress = payload?.progress;
    const validationError = validateProgress(progress);
    if (validationError) {
      return res.status(404).json({ ok: false, error: 'Nog geen live KVK voortgang opgeslagen.' });
    }
    return res.status(200).json({
      ok: true,
      updatedAt: normalizeString(payload.updatedAt || row.updated_at || ''),
      progress,
    });
  }

  async function storeProgressResponse(progress, res) {
    const validationError = validateProgress(progress);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }
    return queueProgressWrite(async () => {
      const storedResult = await fetchSupabaseRowByKeyViaRest(
        progressStateKey,
        'payload,updated_at',
        {
          timeoutMs: snapshotReadTimeoutMs,
          ignoreFailureCooldown: true,
          suppressFailureCooldown: true,
        }
      );
      if (!storedResult || !storedResult.ok) {
        return res.status(502).json({
          ok: false,
          error: truncateText(
            storedResult?.error || 'Bestaande KVK voortgang kon niet worden geladen.',
            500
          ),
        });
      }

      const storedRow = Array.isArray(storedResult.body)
        ? storedResult.body[0] || null
        : storedResult.body || null;
      const storedPayload =
        storedRow?.payload && typeof storedRow.payload === 'object' ? storedRow.payload : null;
      const storedProgress = storedPayload?.progress;
      const storedUpdatedAt = normalizeString(storedPayload?.updatedAt || storedRow?.updated_at || '');
      const incomingTime = progressTimestamp(progress);
      const storedTime = progressTimestamp(storedProgress, storedUpdatedAt);

      // A slow/retried request must never move the dashboard backwards. Keep
      // the newest accepted row and acknowledge the old request so publishers
      // do not retry it forever.
      if (incomingTime > 0 && storedTime > 0 && incomingTime < storedTime) {
        return res.status(200).json({
          ok: true,
          accepted: false,
          stale: true,
          stateKey: progressStateKey,
          updatedAt: storedUpdatedAt,
          summary: summarizeSnapshot(storedProgress),
        });
      }

      const updatedAt = now().toISOString();
      const payload = { progress, updatedAt };
      const result = await upsertSupabaseRowViaRest(
        { state_key: progressStateKey, payload, updated_at: updatedAt },
        {
          timeoutMs: snapshotWriteTimeoutMs,
          ignoreFailureCooldown: true,
          suppressFailureCooldown: true,
        }
      );
      if (!result || !result.ok) {
        return res.status(502).json({
          ok: false,
          error: truncateText(result?.error || 'KVK voortgang opslaan mislukt.', 500),
        });
      }
      return res.status(200).json({
        ok: true,
        accepted: true,
        stateKey: progressStateKey,
        updatedAt,
        summary: summarizeSnapshot(progress),
      });
    });
  }

  async function sendPostProgressResponse(req, res) {
    if (!getAcceptedTokens().length) {
      return res.status(503).json({ ok: false, error: 'KVK sync-token is niet geconfigureerd.' });
    }
    if (!hasValidSyncToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK sync-token.' });
    }
    const progress = getSubmittedProgress(req.body || {});
    if (!progress) {
      return res.status(400).json({ ok: false, error: 'Voortgangssnapshot ontbreekt of is ongeldig.' });
    }
    return storeProgressResponse(progress, res);
  }

  async function sendGetLocationStatsResponse(_req, res) {
    const result = await fetchSupabaseRowByKeyViaRest(snapshotStateKey, 'payload,updated_at', {
      timeoutMs: snapshotReadTimeoutMs,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    });
    if (!result || !result.ok) {
      return res.status(503).json({
        ok: false,
        error: truncateText(result?.error || 'KVK locatiestatistieken konden niet worden geladen.', 500),
      });
    }
    const row = Array.isArray(result.body) ? result.body[0] || null : result.body || null;
    const snapshot = row?.payload?.snapshot;
    if (!snapshot || !Array.isArray(snapshot.locations)) {
      return res.status(404).json({ ok: false, error: 'Nog geen live KVK locatiestatistieken opgeslagen.' });
    }
    const locations = snapshot.locations.map((location) => ({
      woonplaatscode: normalizeString(location?.woonplaatscode || ''),
      land: normalizeString(location?.land || ''),
      provincie: normalizeString(location?.provincie || ''),
      gemeente: normalizeString(location?.gemeente || ''),
      woonplaats: normalizeString(location?.woonplaats || ''),
      bruikbareBedrijven: Math.max(0, Number(location?.bruikbare_bedrijven || 0)),
    }));
    return res.status(200).json({ ok: true, locations });
  }

  async function sendPostSnapshotResponse(req, res) {
    if (!getAcceptedTokens().length) {
      return res.status(503).json({ ok: false, error: 'KVK sync-token is niet geconfigureerd.' });
    }
    if (!hasValidSyncToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK sync-token.' });
    }

    const progress = getSubmittedProgress(req.body || {});
    if (progress) return storeProgressResponse(progress, res);

    const snapshot = getSubmittedSnapshot(req.body || {});
    const validationError = validateSnapshot(snapshot);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const storedResult = await fetchSupabaseRowByKeyViaRest(
      snapshotStateKey,
      'payload,updated_at',
      {
        timeoutMs: snapshotReadTimeoutMs,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }
    );
    if (!storedResult || !storedResult.ok) {
      return res.status(502).json({
        ok: false,
        error: truncateText(
          storedResult?.error || 'Bestaande teller voor succesvol gevonden kon niet worden geladen.',
          500
        ),
      });
    }

    const storedRow = Array.isArray(storedResult.body)
      ? storedResult.body[0] || null
      : storedResult.body || null;
    const storedPayload =
      storedRow?.payload && typeof storedRow.payload === 'object' ? storedRow.payload : null;
    const successfulFoundTracker = buildSuccessfulFoundTracker(snapshot, storedPayload);
    const enrichedSnapshot = withSuccessfulFoundCount(snapshot, successfulFoundTracker.total);
    const enrichedValidationError = validateSnapshot(enrichedSnapshot);
    if (enrichedValidationError) {
      return res.status(400).json({ ok: false, error: enrichedValidationError });
    }

    const updatedAt = now().toISOString();
    const payload = {
      snapshot: enrichedSnapshot,
      updatedAt,
      summary: summarizeSnapshot(enrichedSnapshot),
      successfulFoundTracker,
    };
    const result = await upsertSupabaseRowViaRest(
      {
        state_key: snapshotStateKey,
        payload,
        updated_at: updatedAt,
      },
      {
        timeoutMs: snapshotWriteTimeoutMs,
        ignoreFailureCooldown: true,
        suppressFailureCooldown: true,
      }
    );

    if (!result || !result.ok) {
      return res.status(502).json({
        ok: false,
        error: truncateText(result?.error || 'KVK snapshot opslaan mislukt.', 500),
      });
    }

    return res.status(200).json({
      ok: true,
      stateKey: snapshotStateKey,
      updatedAt,
      summary: payload.summary,
    });
  }

  return {
    progressStateKey,
    sendGetProgressResponse,
    sendPostProgressResponse,
    sendGetLocationStatsResponse,
    sendGetSnapshotResponse,
    sendPostSnapshotResponse,
    snapshotStateKey,
  };
}

module.exports = {
  createKvkDatabaseSnapshotService,
};
