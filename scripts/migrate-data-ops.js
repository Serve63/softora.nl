#!/usr/bin/env node
const path = require('path');
const dotenv = require('dotenv');

const { loadRuntimeEnv } = require('../server/config/runtime-env');
const { createSupabaseStateStore } = require('../server/services/supabase-state');
const { createSoftoraDataOpsStore } = require('../server/services/data-ops-store');
const {
  normalizeString,
  parseImageDataUrl,
  readChunkedStateValue,
  safeParseJsonArray,
  safeParseJsonObject,
} = require('../server/services/data-ops-serialization');
const { KEYS, PHOTO_DATA_PREFIX, SCOPES } = require('../server/services/data-ops-ui-state-bridge');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function buildPhotoEntries(values) {
  const stateValues = values && typeof values === 'object' ? values : {};
  const map = safeParseJsonObject(stateValues[KEYS.photos]);
  return Object.entries(map)
    .map(([id, meta]) => {
      const customerId = normalizeString((meta && meta.id) || id);
      const photoKey = normalizeString(meta && meta.photoKey);
      const count = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0));
      if (!customerId || !photoKey || !count) return null;
      const chunks = [];
      for (let index = 0; index < count; index += 1) {
        chunks.push(normalizeString(stateValues[`${photoKey}_${index}`]));
      }
      const dataUrl = chunks.join('');
      if (!parseImageDataUrl(dataUrl)) return null;
      return {
        customerId,
        dataUrl,
        identityKey: normalizeString(meta && meta.identityKey),
        fileName: normalizeString(meta && meta.websitePhotoName) || 'Websitefoto',
        legacyMeta: meta && typeof meta === 'object' ? meta : {},
      };
    })
    .filter(Boolean);
}

function buildMigrationPlanFromLegacyValues(input = {}) {
  const customerValues = input.customerValues || {};
  const activeOrderValues = input.activeOrderValues || {};
  const photoValues = input.photoValues || {};
  const customers = safeParseJsonArray(readChunkedStateValue(customerValues, KEYS.customers));
  const activeOrders = safeParseJsonArray(readChunkedStateValue(activeOrderValues, KEYS.activeOrders));
  const orderRuntime = safeParseJsonObject(activeOrderValues[KEYS.orderRuntime]);
  const designPhotos = buildPhotoEntries(photoValues);
  return {
    customers,
    activeOrders,
    orderRuntime,
    designPhotos,
    counts: {
      customers: customers.length,
      activeOrders: activeOrders.length,
      orderRuntime: Object.keys(orderRuntime).length,
      designPhotos: designPhotos.length,
    },
  };
}

async function fetchUiStateValues(stateStore, scope) {
  const rowKey = `ui_state:${scope}`;
  const result = await stateStore.fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
  if (!result.ok) throw new Error(`Kon ${rowKey} niet lezen: ${result.error || result.status || 'onbekend'}`);
  const row = Array.isArray(result.body) ? result.body[0] : result.body;
  return row?.payload?.values && typeof row.payload.values === 'object' ? row.payload.values : {};
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const runtimeEnv = loadRuntimeEnv(process.env);
  const supabase = runtimeEnv.supabase;
  const stateStore = createSupabaseStateStore({
    supabaseUrl: supabase.url,
    supabaseServiceRoleKey: supabase.serviceRoleKey,
    supabaseStateTable: supabase.stateTable,
    supabaseStateKey: supabase.stateKey,
    supabaseCallUpdateStateKeyPrefix: supabase.callUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit: supabase.callUpdateRowsFetchLimit,
    normalizeString,
    truncateText: (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  });

  if (!stateStore.isSupabaseConfigured()) {
    throw new Error('Supabase is niet geconfigureerd; migratie gestopt.');
  }

  const [customerValues, activeOrderValues, photoValues] = await Promise.all([
    fetchUiStateValues(stateStore, SCOPES.customers),
    fetchUiStateValues(stateStore, SCOPES.activeOrders),
    fetchUiStateValues(stateStore, SCOPES.photos),
  ]);
  const plan = buildMigrationPlanFromLegacyValues({ customerValues, activeOrderValues, photoValues });

  if (!write) {
    console.log(JSON.stringify({ ok: true, mode: 'dry-run', counts: plan.counts }, null, 2));
    return;
  }

  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: stateStore.isSupabaseConfigured,
    getSupabaseClient: stateStore.getSupabaseClient,
    logger: console,
  });

  const customerResult = await store.replaceCustomers(plan.customers, { source: 'migration:data-ops' });
  const orderResult = await store.replaceActiveOrders(plan.activeOrders, { source: 'migration:data-ops' });
  const runtimeResult = await store.replaceOrderRuntime(plan.orderRuntime, { source: 'migration:data-ops' });
  const photoResult = await store.replaceDesignPhotos(plan.designPhotos, { source: 'migration:data-ops' });

  console.log(
    JSON.stringify(
      {
        ok: Boolean(customerResult.ok && orderResult.ok && runtimeResult.ok && photoResult.ok),
        mode: 'write',
        counts: plan.counts,
        results: {
          customers: Boolean(customerResult.ok),
          activeOrders: Boolean(orderResult.ok),
          orderRuntime: Boolean(runtimeResult.ok),
          designPhotos: Boolean(photoResult.ok),
        },
      },
      null,
      2
    )
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[data-ops-migration] ${error.message || error}`);
    process.exit(1);
  });
}

module.exports = {
  PHOTO_DATA_PREFIX,
  buildMigrationPlanFromLegacyValues,
};
