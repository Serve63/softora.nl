const crypto = require('node:crypto');

const DEFAULT_STATE_KEY_SUFFIX = 'kvk_database_snapshot_v1';
const MAX_SNAPSHOT_BYTES = 7_500_000;
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

  function summarizeSnapshot(snapshot) {
    const state = snapshot && typeof snapshot.state === 'object' ? snapshot.state : {};
    const companyTotals =
      snapshot && typeof snapshot.companyTotals === 'object' ? snapshot.companyTotals : {};
    return {
      companiesFound: Number(state.companies_found || companyTotals.all || 0),
      usable: Number(companyTotals.usable || 0),
      withWebsite: Number(state.with_website || companyTotals.with_website || 0),
      withoutWebsite: Number(state.without_website || companyTotals.without_website || 0),
      unusable: Number(state.unusable || companyTotals.unusable || 0),
      generatedAt: normalizeString(snapshot?.generatedAt || ''),
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
    const snapshot = payload && payload.snapshot ? payload.snapshot : null;
    if (!snapshot || typeof snapshot !== 'object') {
      return res.status(404).json({ ok: false, error: 'Nog geen live KVK snapshot opgeslagen.' });
    }

    return res.status(200).json({
      ok: true,
      updatedAt: normalizeString(payload.updatedAt || row.updated_at || ''),
      summary: payload.summary || summarizeSnapshot(snapshot),
      snapshot,
    });
  }

  async function sendPostSnapshotResponse(req, res) {
    if (!getAcceptedTokens().length) {
      return res.status(503).json({ ok: false, error: 'KVK sync-token is niet geconfigureerd.' });
    }
    if (!hasValidSyncToken(req)) {
      return res.status(401).json({ ok: false, error: 'Ongeldig KVK sync-token.' });
    }

    const snapshot = getSubmittedSnapshot(req.body || {});
    const validationError = validateSnapshot(snapshot);
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const updatedAt = now().toISOString();
    const payload = {
      snapshot,
      updatedAt,
      summary: summarizeSnapshot(snapshot),
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
    sendGetSnapshotResponse,
    sendPostSnapshotResponse,
    snapshotStateKey,
  };
}

module.exports = {
  createKvkDatabaseSnapshotService,
};
