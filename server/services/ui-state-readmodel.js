// Versioned ui-state reads (docs/platform-performance.md). The version is a hash
// of the stored values themselves, so "unchanged" is exact by construction.
// Only scopes listed here may be kept as a browser copy: never the password
// register, never scopes composed from other tables, never an in-memory fallback.
const { createHash } = require('node:crypto');
const { buildReadModelVersion, readRequestedReadModelVersion } = require('./readmodel-version-response');

const VERSIONED_UI_STATE_SCOPES = Object.freeze([
  'premium_coldmail_send_guard',
  'premium_customers_database_sync',
  'premium_database_mail_roi',
]);
const UI_STATE_FIELDS = Object.freeze(['scope', 'values', 'source', 'updatedAt']);

function uiStateReadModelVersion(scope, state) {
  if (!VERSIONED_UI_STATE_SCOPES.includes(scope) || !state || state.source !== 'supabase') return '';
  const values = state.values && typeof state.values === 'object' ? state.values : {};
  const contentHash = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return buildReadModelVersion(['ui-state', scope, contentHash]);
}

function buildUiStateGetBody(req, scope, state, extra = {}) {
  const body = {
    ok: true,
    scope,
    values: state.values || {},
    source: state.source || 'supabase',
    updatedAt: state.updatedAt || null,
    ...extra,
  };
  const version = uiStateReadModelVersion(scope, state);
  if (!version) return body;
  const key = `ui-state:${scope}`;
  if (readRequestedReadModelVersion(req) === version) {
    return { ok: true, scope, readModel: { key, version, unchanged: true } };
  }
  return { ...body, readModel: { key, version, unchanged: false, fields: UI_STATE_FIELDS.slice() } };
}

module.exports = { VERSIONED_UI_STATE_SCOPES, buildUiStateGetBody, uiStateReadModelVersion };
