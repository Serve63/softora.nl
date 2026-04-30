const {
  normalizeString,
  readChunkedStateValue,
  safeParseJsonArray,
  safeParseJsonObject,
} = require('./data-ops-serialization');
const { KEYS, SCOPES } = require('./data-ops-ui-state-bridge');

const LEGACY_SCOPE_DEFS = Object.freeze([
  { scope: SCOPES.customers, kind: 'customers', key: KEYS.customers },
  { scope: SCOPES.photos, kind: 'photos', key: KEYS.photos },
  { scope: SCOPES.activeOrders, kind: 'active_orders', key: KEYS.activeOrders },
  { scope: 'coldcalling', kind: 'leads', key: 'softora_coldcalling_lead_rows_json' },
  { scope: 'premium_agenda', kind: 'agenda', key: 'softora_agenda_appointments_json' },
]);

function countMissingPhotoChunks(values, photoMap) {
  let missing = 0;
  Object.values(photoMap || {}).forEach((meta) => {
    const photoKey = normalizeString(meta && meta.photoKey);
    const count = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0));
    if (!photoKey || !count) {
      missing += 1;
      return;
    }
    for (let index = 0; index < count; index += 1) {
      if (!normalizeString(values && values[`${photoKey}_${index}`])) missing += 1;
    }
  });
  return missing;
}

function summarizeLegacyValues(def, values) {
  if (def.kind === 'customers' || def.kind === 'leads' || def.kind === 'agenda') {
    const rows = safeParseJsonArray(readChunkedStateValue(values, def.key));
    return { rowCount: rows.length };
  }
  if (def.kind === 'active_orders') {
    const orders = safeParseJsonArray(readChunkedStateValue(values, def.key));
    const runtime = safeParseJsonObject(values && values[KEYS.orderRuntime]);
    return {
      rowCount: orders.length,
      runtimeCount: Object.keys(runtime).length,
    };
  }
  if (def.kind === 'photos') {
    const photoMap = safeParseJsonObject(values && values[def.key]);
    return {
      rowCount: Object.keys(photoMap).length,
      missingPhotoChunks: countMissingPhotoChunks(values, photoMap),
    };
  }
  return { rowCount: 0 };
}

function createDataOpsHealthReporter(deps = {}) {
  const {
    fetchSupabaseRowsByStateKeyPrefixViaRest = async () => ({ ok: false }),
    dataOpsStore = null,
  } = deps;

  async function readLegacyScope(def) {
    const stateKey = `ui_state:${def.scope}`;
    const result = await fetchSupabaseRowsByStateKeyPrefixViaRest(
      stateKey,
      1,
      'state_key,payload,updated_at'
    );
    const row = result.ok && Array.isArray(result.body) ? result.body[0] : null;
    const values = row?.payload?.values && typeof row.payload.values === 'object' ? row.payload.values : {};
    return {
      scope: def.scope,
      kind: def.kind,
      stateKey,
      ok: Boolean(result.ok && row),
      updatedAt: normalizeString(row && row.updated_at) || null,
      valueKeyCount: Object.keys(values).length,
      ...summarizeLegacyValues(def, values),
      error: result.ok ? null : normalizeString(result.error || result.status || 'legacy scope niet leesbaar'),
    };
  }

  async function buildReport() {
    const legacyScopes = await Promise.all(LEGACY_SCOPE_DEFS.map(readLegacyScope));
    const structuredCounts =
      dataOpsStore && typeof dataOpsStore.getDataOpsCounts === 'function'
        ? await dataOpsStore.getDataOpsCounts()
        : null;

    return {
      ok: true,
      generatedAt: new Date().toISOString(),
      legacyScopes,
      structuredCounts,
      warnings: legacyScopes
        .filter((item) => Number(item.missingPhotoChunks || 0) > 0)
        .map((item) => `${item.scope}: ${item.missingPhotoChunks} ontbrekende fotochunks`),
    };
  }

  return {
    buildReport,
    _summarizeLegacyValues: summarizeLegacyValues,
  };
}

module.exports = {
  LEGACY_SCOPE_DEFS,
  createDataOpsHealthReporter,
};
