const {
  buildChunkedStatePatch,
  buildCustomerIdentityKey,
  normalizeString,
  parseImageDataUrl,
  readChunkedStateValue,
  safeParseJsonArray,
  safeParseJsonObject,
} = require('./data-ops-serialization');
const { createSoftoraDataOpsStore } = require('./data-ops-store');

const SCOPES = Object.freeze({
  customers: 'premium_customers_database',
  activeOrders: 'premium_active_orders',
  photos: 'premium_database_photos',
});

const KEYS = Object.freeze({
  customers: 'softora_customers_premium_v1',
  activeOrders: 'softora_custom_orders_premium_v1',
  orderRuntime: 'softora_order_runtime_premium_v1',
  photos: 'softora_database_photos_v1',
  photoRemovals: 'softora_database_photos_removed_v1',
});

const PHOTO_DATA_PREFIX = 'softora_database_photo_data_v1_';

function createSoftoraDataOpsUiStateBridge(deps = {}) {
  const {
    enabled = true,
    store = createSoftoraDataOpsStore(deps),
    logger = console,
  } = deps;

  function canHandleScope(scope) {
    return enabled && Object.values(SCOPES).includes(normalizeString(scope).toLowerCase());
  }

  function hasKey(values, key) {
    const stateValues = values && typeof values === 'object' ? values : {};
    return (
      Object.prototype.hasOwnProperty.call(stateValues, key) ||
      Object.prototype.hasOwnProperty.call(stateValues, `${key}_chunks_v1`)
    );
  }

  async function readLegacy(legacyGetUiStateValues, scope) {
    return typeof legacyGetUiStateValues === 'function' ? legacyGetUiStateValues(scope) : null;
  }

  function buildState(scope, values, source = 'supabase:data_ops') {
    return {
      values: values && typeof values === 'object' ? values : {},
      source,
      updatedAt: new Date().toISOString(),
    };
  }

  async function getCustomersState(legacyGetUiStateValues) {
    const customers = await store.listCustomers();
    if (!customers || customers.length === 0) return readLegacy(legacyGetUiStateValues, SCOPES.customers);
    return buildState(SCOPES.customers, buildChunkedStatePatch(KEYS.customers, JSON.stringify(customers)));
  }

  async function getActiveOrdersState(legacyGetUiStateValues) {
    const [orders, runtime, legacy] = await Promise.all([
      store.listActiveOrders(),
      store.listOrderRuntime(),
      readLegacy(legacyGetUiStateValues, SCOPES.activeOrders),
    ]);
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    const hasRuntime = runtime && typeof runtime === 'object' && Object.keys(runtime).length > 0;
    if (!hasOrders && !hasRuntime) return legacy;
    return buildState(SCOPES.activeOrders, {
      ...((legacy && legacy.values) || {}),
      ...(hasOrders ? buildChunkedStatePatch(KEYS.activeOrders, JSON.stringify(orders)) : {}),
      ...(hasRuntime ? { [KEYS.orderRuntime]: JSON.stringify(runtime) } : {}),
    });
  }

  function buildPhotoDataKey(customerId) {
    return PHOTO_DATA_PREFIX + normalizeString(customerId).replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
  }

  function chunkPhotoDataUrl(dataUrl) {
    return normalizeString(dataUrl).match(/[\s\S]{1,180000}/g) || [];
  }

  function buildPhotoCompatValues(entries) {
    const values = {};
    const map = {};
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const customerId = normalizeString(entry.customerId);
      const parsed = parseImageDataUrl(entry.dataUrl);
      const websitePhotoUrl = normalizeString(entry.websitePhotoUrl || entry.signedUrl || entry.publicUrl);
      if (!customerId || (!parsed && !websitePhotoUrl)) return;
      const photoKey = buildPhotoDataKey(customerId);
      const chunks = parsed ? chunkPhotoDataUrl(parsed.dataUrl) : [];
      chunks.forEach((chunk, index) => {
        values[`${photoKey}_${index}`] = chunk;
      });
      map[customerId] = {
        id: customerId,
        identityKey: normalizeString(entry.identityKey),
        photoKey,
        chunkCount: chunks.length,
        websitePhotoUrl,
        websiteMockupUrl: normalizeString(entry.websiteMockupUrl || entry.mockupUrl),
        websitePhotoName: normalizeString(entry.fileName || entry.legacyMeta?.websitePhotoName) || 'Websitefoto',
        websiteMockupName: normalizeString(entry.websiteMockupName || entry.legacyMeta?.websiteMockupName),
        updatedAt: normalizeString(entry.legacyMeta?.updatedAt || entry.updatedAt).slice(0, 10),
        storage: {
          source: 'supabase_storage',
          bucket: normalizeString(entry.storageBucket),
          path: normalizeString(entry.storagePath),
          signedUrlExpiresAt: normalizeString(entry.signedUrlExpiresAt),
        },
      };
    });
    values[KEYS.photos] = JSON.stringify(map);
    return values;
  }

  async function getPhotosState(legacyGetUiStateValues) {
    const entries = typeof store.listDesignPhotosWithSignedUrls === 'function'
      ? await store.listDesignPhotosWithSignedUrls()
      : await store.listDesignPhotosWithDataUrls();
    if (!entries) return readLegacy(legacyGetUiStateValues, SCOPES.photos);
    if (entries.length === 0 && !entries.hadStructuredRows) return readLegacy(legacyGetUiStateValues, SCOPES.photos);
    return buildState(SCOPES.photos, buildPhotoCompatValues(entries));
  }

  async function getUiStateValues(scope, options = {}) {
    if (!canHandleScope(scope)) return null;
    try {
      if (scope === SCOPES.customers) return getCustomersState(options.legacyGetUiStateValues);
      if (scope === SCOPES.activeOrders) return getActiveOrdersState(options.legacyGetUiStateValues);
      if (scope === SCOPES.photos) return getPhotosState(options.legacyGetUiStateValues);
    } catch (error) {
      logger.error('[DataOps][ui-state-get]', error?.message || error);
    }
    return readLegacy(options.legacyGetUiStateValues, scope);
  }

  function extractPhotoEntries(values) {
    const map = safeParseJsonObject(values && values[KEYS.photos]);
    return Object.entries(map)
      .map(([id, meta]) => {
        const customerId = normalizeString((meta && meta.id) || id);
        const photoKey = normalizeString(meta && meta.photoKey);
        const chunkCount = Math.max(0, Math.min(100, Number(meta && meta.chunkCount) || 0));
        if (!customerId || !photoKey || !chunkCount) return null;
        const chunks = [];
        for (let index = 0; index < chunkCount; index += 1) {
          chunks.push(normalizeString(values[`${photoKey}_${index}`]));
        }
        const dataUrl = chunks.join('');
        if (!parseImageDataUrl(dataUrl)) return null;
        const mockupPhotoKey = normalizeString(meta && (meta.mockupPhotoKey || meta.websiteMockupKey));
        const mockupChunkCount = Math.max(0, Math.min(100, Number(meta && (meta.mockupChunkCount || meta.websiteMockupChunkCount)) || 0));
        const mockupDataUrl = mockupPhotoKey && mockupChunkCount
          ? Array.from({ length: mockupChunkCount }, (_, index) => normalizeString(values[`${mockupPhotoKey}_${index}`])).join('')
          : '';
        return {
          customerId,
          dataUrl,
          websiteMockup: parseImageDataUrl(mockupDataUrl) ? mockupDataUrl : '',
          identityKey: normalizeString(meta && meta.identityKey),
          fileName: normalizeString(meta && meta.websitePhotoName) || 'Websitefoto',
          websiteMockupName: normalizeString(meta && meta.websiteMockupName),
          legacyMeta: meta && typeof meta === 'object' ? meta : {},
        };
      })
      .filter(Boolean);
  }

  function extractPhotoRemovalIds(values) {
    const parsed = safeParseJsonArray(values && values[KEYS.photoRemovals]);
    return Array.from(new Set(parsed.map(normalizeString).filter(Boolean)));
  }

  async function setUiStateValues(scope, values, meta = {}) {
    if (!canHandleScope(scope)) return null;
    const stateValues = values && typeof values === 'object' ? values : {};
    const sourceMeta = { source: normalizeString(meta.source || 'ui-state-compat') };

    try {
      if (scope === SCOPES.customers && hasKey(stateValues, KEYS.customers)) {
        const customers = safeParseJsonArray(readChunkedStateValue(stateValues, KEYS.customers));
        const saved = await store.replaceCustomers(customers, sourceMeta);
        return saved.ok ? buildState(scope, stateValues) : null;
      }
      if (scope === SCOPES.activeOrders) {
        let changed = false;
        if (hasKey(stateValues, KEYS.activeOrders)) {
          const orders = safeParseJsonArray(readChunkedStateValue(stateValues, KEYS.activeOrders));
          const saved = await store.replaceActiveOrders(orders, sourceMeta);
          if (!saved.ok) return null;
          changed = true;
        }
        if (Object.prototype.hasOwnProperty.call(stateValues, KEYS.orderRuntime)) {
          const runtime = safeParseJsonObject(stateValues[KEYS.orderRuntime]);
          const saved = await store.replaceOrderRuntime(runtime, sourceMeta);
          if (!saved.ok) return null;
          changed = true;
        }
        return changed ? buildState(scope, stateValues) : null;
      }
      if (scope === SCOPES.photos && Object.prototype.hasOwnProperty.call(stateValues, KEYS.photos)) {
        const entries = extractPhotoEntries(stateValues);
        const removalIds = extractPhotoRemovalIds(stateValues);
        if (entries.length) {
          const saved = typeof store.upsertDesignPhotos === 'function'
            ? await store.upsertDesignPhotos(entries, sourceMeta)
            : await store.replaceDesignPhotos(entries, sourceMeta);
          if (!saved.ok) return null;
        }
        if (removalIds.length && typeof store.deleteDesignPhotos === 'function') {
          const removed = await store.deleteDesignPhotos(removalIds, sourceMeta);
          if (!removed.ok) return null;
        }
        return buildState(scope, stateValues);
      }
    } catch (error) {
      logger.error('[DataOps][ui-state-set]', error?.message || error);
    }
    return null;
  }

  return {
    canHandleScope,
    getUiStateValues,
    setUiStateValues,
    _constants: { KEYS, PHOTO_DATA_PREFIX, SCOPES },
  };
}

module.exports = {
  KEYS,
  PHOTO_DATA_PREFIX,
  SCOPES,
  createSoftoraDataOpsUiStateBridge,
};
