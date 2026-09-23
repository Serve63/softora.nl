// Versioned ui-state reads (docs/platform-performance.md). Only scopes listed
// here may be kept as a browser copy: never the password register, never
// scopes composed from other tables, never an in-memory fallback.
//
// Preferred version: the trigger-maintained change_seq of the row
// (supabase/migrations/*_runtime_state_change_seq.sql), proven with a
// metadata-only read. Fallback: a hash of the stored values, exact by
// construction but it needs the full row.
const { createHash } = require('node:crypto');
const { buildReadModelVersion, readRequestedReadModelVersion } = require('./readmodel-version-response');

const VERSIONED_UI_STATE_SCOPES = Object.freeze([
  'premium_coldmail_send_guard',
  'premium_customers_database_sync',
  'premium_database_mail_roi',
]);
const UI_STATE_FIELDS = Object.freeze(['scope', 'values', 'source', 'updatedAt']);
const CHANGE_SEQ_RETRY_MS = 5 * 60 * 1000;

function isVersionedUiStateScope(scope) {
  return VERSIONED_UI_STATE_SCOPES.includes(scope);
}

function uiStateReadModelVersion(scope, state) {
  if (!isVersionedUiStateScope(scope) || !state || state.source !== 'supabase') return '';
  if (state.changeSeq) return buildReadModelVersion(['ui-state', scope, 'seq', state.changeSeq]);
  const values = state.values && typeof state.values === 'object' ? state.values : {};
  const contentHash = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return buildReadModelVersion(['ui-state', scope, contentHash]);
}

function unchangedBody(scope, version) {
  return { ok: true, scope, readModel: { key: `ui-state:${scope}`, version, unchanged: true } };
}

function buildUiStateGetBody(req, scope, state) {
  const body = {
    ok: true,
    scope,
    values: state.values || {},
    source: state.source || 'supabase',
    updatedAt: state.updatedAt || null,
  };
  const version = uiStateReadModelVersion(scope, state);
  if (!version) return body;
  if (readRequestedReadModelVersion(req) === version) return unchangedBody(scope, version);
  return { ...body, readModel: { key: `ui-state:${scope}`, version, unchanged: false, fields: UI_STATE_FIELDS.slice() } };
}

function createVersionedUiStateReader({ getUiStateValues, nowMs = Date.now } = {}) {
  let changeSeqRetryAtMs = 0;

  // Resolves the response body, or null when the caller must use its normal read.
  async function read(req, scope) {
    if (!isVersionedUiStateScope(scope) || typeof getUiStateValues !== 'function' || nowMs() < changeSeqRetryAtMs) return null;
    try {
      const requested = readRequestedReadModelVersion(req);
      if (requested) {
        const meta = await getUiStateValues(scope, { metadataOnly: true, includeChangeSeq: true });
        if (meta && meta.exists && meta.source === 'supabase' && meta.changeSeq) {
          const version = uiStateReadModelVersion(scope, meta);
          if (version === requested) return unchangedBody(scope, version);
        }
      }
      // Payload and change_seq come from one row read, so the version always
      // describes exactly these values.
      const state = await getUiStateValues(scope, { includeChangeSeq: true });
      if (!state) {
        changeSeqRetryAtMs = nowMs() + CHANGE_SEQ_RETRY_MS;
        return null;
      }
      return buildUiStateGetBody(req, scope, state);
    } catch (_error) {
      changeSeqRetryAtMs = nowMs() + CHANGE_SEQ_RETRY_MS;
      return null;
    }
  }

  return { read };
}

module.exports = {
  VERSIONED_UI_STATE_SCOPES,
  buildUiStateGetBody,
  createVersionedUiStateReader,
  isVersionedUiStateScope,
  uiStateReadModelVersion,
};
