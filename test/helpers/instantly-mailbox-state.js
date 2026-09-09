'use strict';
const { createUiStateStore } = require('../../server/services/ui-state');

// Model the real database contract: whole-row replacement, revision checks and
// a duplicate-key conflict on concurrent inserts. The production store runs.
function createInstantlyStateFixture(values = {}) {
  let row = null;
  let readsUnavailable = false;
  let conflicts = 0;
  const copy = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const client = { from: () => {
    let operation, replacement;
    const filters = {};
    const query = {
      update(value) { operation = 'update'; replacement = copy(value); return query; },
      insert(value) { operation = 'insert'; replacement = copy(value); return query; },
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      async maybeSingle() {
        if (operation === 'insert') {
          if (row) { conflicts += 1; return { error: { code: '23505' } }; }
          row = replacement;
        } else if (operation === 'update') {
          if (!row || Object.entries(filters).some(([key, value]) => row[key] !== value)) {
            conflicts += 1; return { data: null };
          }
          row = { ...row, ...replacement };
        }
        if (row) { for (const key of Object.keys(values)) delete values[key]; Object.assign(values, row.payload.values); }
        return { data: copy(row) };
      },
      async upsert(value) { row = copy(value); return { error: null }; },
    };
    return query;
  } };
  if (Object.keys(values).length) row = { state_key: 'ui_state:instantly_mailbox_sync', revision: 1,
    updated_at: '2026-09-09T12:00:00Z', payload: { values: copy(values) } };
  const store = createUiStateStore({ isSupabaseConfigured: () => true, getSupabaseClient: () => client,
    supabaseStateTable: 'app_state', logger: { error() {}, info() {} },
    fetchSupabaseRowByKeyViaRest: async () => readsUnavailable ? { ok: false, status: 503 } : { ok: true, body: copy(row) },
  });
  return { store, values, get conflicts() { return conflicts; }, setUnavailable(value) { readsUnavailable = value; } };
}
module.exports = { createInstantlyStateFixture };
