const {
  buildChunkedStatePatch,
  buildCustomerIdentityKey,
  normalizeString,
  parseImageDataUrl,
  readChunkedStateValue,
  safeParseJsonArray,
  safeParseJsonObject,
} = require('./data-ops-serialization');
const {
  getContactStatusPriority,
  normalizeContactStatus,
} = require('./customer-lifecycle');
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
const LEGACY_CONTACT_SYNC_FIELDS = Object.freeze([
  'status',
  'databaseStatus',
  'mail',
  'canMail',
  'doNotMail',
  'lastMailSentAt',
  'lastMailedAt',
  'lastColdmailSentAt',
  'lastColdmailSenderEmail',
  'coldmailCampaignStartedAt',
  'coldmailCampaignDurationDays',
  'coldmailCampaignEndsAt',
  'activeColdmailCampaignUntil',
  'campaignType',
  'campaign_type',
  'outreachCampaignType',
  'outreach_campaign_type',
  'coldmailSpecialAction',
  'outreachStatus',
  'outreachSentAt',
  'outreach_sent_at',
  'coldmailSentMessageId',
  'outreachMessageId',
  'sentMessageId',
  'messageId',
  'sentFromEmail',
  'sent_from_email',
  'outreachSentFromEmail',
  'statusUpdatedAt',
  'updatedAt',
]);

function createSoftoraDataOpsUiStateBridge(deps = {}) {
  const {
    enabled = true,
    store = createSoftoraDataOpsStore(deps),
    legacyContactMergeEnabled = false,
    legacyReadTimeoutMs = 1200,
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

  async function readLegacyWithTimeout(legacyGetUiStateValues, scope, reason = 'fallback') {
    if (typeof legacyGetUiStateValues !== 'function') return null;
    const timeoutMs = Math.max(0, Number(legacyReadTimeoutMs) || 0);
    if (!timeoutMs) return null;
    let timeoutId = null;
    try {
      return await Promise.race([
        legacyGetUiStateValues(scope),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } catch (error) {
      logger.warn(`[DataOps][legacy-${reason}]`, error?.message || error);
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function isStructuredReadCooldownActive() {
    if (!store || typeof store.getReadFailureCooldownStatus !== 'function') return false;
    return Boolean(store.getReadFailureCooldownStatus().active);
  }

  function shouldSkipLegacyAfterStructuredReadFailure() {
    return isStructuredReadCooldownActive();
  }

  function buildState(scope, values, source = 'supabase:data_ops') {
    return {
      values: values && typeof values === 'object' ? values : {},
      source,
      updatedAt: new Date().toISOString(),
    };
  }

  function parseLegacyCustomerRows(legacy) {
    const values = legacy && typeof legacy.values === 'object' ? legacy.values : {};
    if (!hasKey(values, KEYS.customers)) return [];
    return safeParseJsonArray(readChunkedStateValue(values, KEYS.customers));
  }

  function hasUsableCustomerIdentityKey(identityKey) {
    const parts = normalizeString(identityKey).split('|');
    const company = normalizeString(parts[0]);
    const contact = normalizeString(parts[1]);
    const phone = normalizeString(parts[2]).replace(/[^\d]/g, '');
    return phone.length >= 7 || Boolean(company && contact);
  }

  function getCustomerMergeKeys(row) {
    const payload = row && typeof row === 'object' ? row : {};
    const identityKey = buildCustomerIdentityKey(payload);
    return Array.from(new Set([
      normalizeString(payload.id || payload.customerId || payload.databaseId),
      hasUsableCustomerIdentityKey(identityKey) ? identityKey : '',
    ].filter(Boolean)));
  }

  function parseCustomerContactTimestampMs(row) {
    const payload = row && typeof row === 'object' ? row : {};
    return [
      payload.statusUpdatedAt,
      payload.updatedAt,
      payload.lastColdmailSentAt,
      payload.lastMailSentAt,
      payload.outreachSentAt,
      payload.outreach_sent_at,
      payload.coldmailCampaignStartedAt,
      payload.datum,
    ]
      .map((value) => Date.parse(normalizeString(value)))
      .filter(Number.isFinite)
      .reduce((max, value) => Math.max(max, value), 0);
  }

  function hasLegacyColdmailSignal(row) {
    const payload = row && typeof row === 'object' ? row : {};
    if (normalizeString(payload.lastColdmailSentAt || payload.lastMailSentAt || payload.outreachSentAt || payload.outreach_sent_at)) return true;
    if (normalizeString(payload.coldmailSentMessageId || payload.outreachMessageId || payload.sentMessageId || payload.messageId)) return true;
    return (Array.isArray(payload.hist) ? payload.hist : []).some((entry) => {
      const text = normalizeString([
        entry && entry.type,
        entry && entry.status,
        entry && entry.label,
        entry && entry.source,
      ].join(' ')).toLowerCase();
      return /(gemaild|mail verstuurd|coldmail|cold mailing|webdesign-outreach)/.test(text);
    });
  }

  function shouldApplyLegacyContactState(current, legacy) {
    const currentStatus = normalizeContactStatus(current && (current.databaseStatus || current.status), current);
    const legacyStatus = normalizeContactStatus(legacy && (legacy.databaseStatus || legacy.status), legacy);
    const currentPriority = getContactStatusPriority(currentStatus);
    const legacyPriority = getContactStatusPriority(legacyStatus);
    if (legacyPriority > currentPriority) return true;
    if (!hasLegacyColdmailSignal(legacy)) return false;
    if (legacyPriority === currentPriority) {
      return parseCustomerContactTimestampMs(legacy) > parseCustomerContactTimestampMs(current);
    }
    return legacyStatus === 'gemaild' && currentPriority < getContactStatusPriority('gemaild');
  }

  function mergeHistories(current, legacy) {
    const combined = [
      ...(Array.isArray(legacy && legacy.hist) ? legacy.hist : []),
      ...(Array.isArray(current && current.hist) ? current.hist : []),
    ].filter(Boolean);
    const seen = new Set();
    return combined.filter((entry) => {
      const key = normalizeString(entry && entry.messageKey) || [
        normalizeString(entry && entry.type),
        normalizeString(entry && entry.label),
        normalizeString(entry && entry.date),
        normalizeString(entry && entry.actor),
        normalizeString(entry && entry.source),
      ].join('|');
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 50);
  }

  function applyLegacyContactState(current, legacy) {
    const merged = { ...(current || {}) };
    LEGACY_CONTACT_SYNC_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(legacy || {}, field)) {
        merged[field] = legacy[field];
      }
    });
    merged.hist = mergeHistories(current, legacy);
    return merged;
  }

  function mergeLegacyCustomerContactState(customers, legacyRows) {
    if (!Array.isArray(customers) || !customers.length || !Array.isArray(legacyRows) || !legacyRows.length) {
      return customers;
    }
    const indexByKey = new Map();
    customers.forEach((customer, index) => {
      getCustomerMergeKeys(customer).forEach((key) => {
        if (!indexByKey.has(key)) indexByKey.set(key, index);
      });
    });
    const merged = customers.slice();
    legacyRows.forEach((legacy) => {
      const index = getCustomerMergeKeys(legacy)
        .map((key) => indexByKey.get(key))
        .find((value) => value !== undefined);
      if (index === undefined) return;
      if (shouldApplyLegacyContactState(merged[index], legacy)) {
        merged[index] = applyLegacyContactState(merged[index], legacy);
      }
    });
    return merged;
  }

  async function getCustomersState(legacyGetUiStateValues) {
    const customers = await store.listCustomers();
    if (!customers || customers.length === 0) {
      if (shouldSkipLegacyAfterStructuredReadFailure()) return null;
      return readLegacyWithTimeout(legacyGetUiStateValues, SCOPES.customers, 'customers-fallback');
    }
    const legacy = legacyContactMergeEnabled
      ? await readLegacyWithTimeout(legacyGetUiStateValues, SCOPES.customers, 'customers-overlay')
      : null;
    const mergedCustomers = legacy
      ? mergeLegacyCustomerContactState(customers, parseLegacyCustomerRows(legacy))
      : customers;
    return buildState(SCOPES.customers, buildChunkedStatePatch(KEYS.customers, JSON.stringify(mergedCustomers)));
  }

  async function getActiveOrdersState(legacyGetUiStateValues) {
    const [orders, runtime] = await Promise.all([
      store.listActiveOrders(),
      store.listOrderRuntime(),
    ]);
    const hasOrders = Array.isArray(orders) && orders.length > 0;
    const hasRuntime = runtime && typeof runtime === 'object' && Object.keys(runtime).length > 0;
    if (!hasOrders && !hasRuntime) {
      if (shouldSkipLegacyAfterStructuredReadFailure()) return null;
      return readLegacyWithTimeout(legacyGetUiStateValues, SCOPES.activeOrders, 'active-orders-fallback');
    }
    return buildState(SCOPES.activeOrders, {
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

  function getMockupMeta(entry) {
    const legacyMeta = entry && entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {};
    const mockup = legacyMeta.mockup && typeof legacyMeta.mockup === 'object' ? legacyMeta.mockup : {};
    return {
      mockupRenderer: normalizeString(mockup.renderer || legacyMeta.mockupRenderer),
      mockupOrientation: normalizeString(mockup.orientation || legacyMeta.mockupOrientation),
      mockupQualityStatus: normalizeString(mockup.qualityStatus || legacyMeta.mockupQualityStatus),
      mockupQualityCheckedAt: normalizeString(mockup.qualityCheckedAt || legacyMeta.mockupQualityCheckedAt),
    };
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
      const mockupParsed = parseImageDataUrl(entry.websiteMockup || entry.mockup || entry.websiteMockupDataUrl || entry.mockupDataUrl);
      const mockupPhotoKey = mockupParsed ? `${photoKey}_mockup` : '';
      const mockupChunks = mockupParsed ? chunkPhotoDataUrl(mockupParsed.dataUrl) : [];
      mockupChunks.forEach((chunk, index) => {
        values[`${mockupPhotoKey}_${index}`] = chunk;
      });
      const mockupMeta = getMockupMeta(entry);
      const hasMockup = Boolean(
        mockupChunks.length ||
          normalizeString(entry.websiteMockupUrl || entry.mockupUrl) ||
          normalizeString(entry.websiteMockup || entry.mockup)
      );
      map[customerId] = {
        id: customerId,
        identityKey: normalizeString(entry.identityKey),
        photoKey,
        chunkCount: chunks.length,
        mockupPhotoKey,
        mockupChunkCount: mockupChunks.length,
        websitePhotoUrl,
        websiteMockupUrl: normalizeString(entry.websiteMockupUrl || entry.mockupUrl),
        websitePhotoName: normalizeString(entry.fileName || entry.legacyMeta?.websitePhotoName) || 'Websitefoto',
        websiteMockupName: normalizeString(entry.websiteMockupName || entry.legacyMeta?.websiteMockupName),
        mockupRenderer: mockupMeta.mockupRenderer,
        mockupOrientation: mockupMeta.mockupOrientation,
        mockupQualityStatus: mockupMeta.mockupQualityStatus || (hasMockup ? 'unverified' : ''),
        mockupQualityCheckedAt: mockupMeta.mockupQualityCheckedAt,
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
    if (!entries) {
      if (shouldSkipLegacyAfterStructuredReadFailure()) return null;
      return readLegacyWithTimeout(legacyGetUiStateValues, SCOPES.photos, 'photos-fallback');
    }
    if (entries.length === 0 && !entries.hadStructuredRows) {
      if (shouldSkipLegacyAfterStructuredReadFailure()) return null;
      return readLegacyWithTimeout(legacyGetUiStateValues, SCOPES.photos, 'photos-empty-fallback');
    }
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
    if (shouldSkipLegacyAfterStructuredReadFailure()) return null;
    return readLegacyWithTimeout(options.legacyGetUiStateValues, scope, 'error-fallback');
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
          legacyMeta: {
            ...(meta && typeof meta === 'object' ? meta : {}),
            mockup: {
              ...(meta && meta.mockup && typeof meta.mockup === 'object' ? meta.mockup : {}),
              renderer: normalizeString(meta && meta.mockupRenderer),
              orientation: normalizeString(meta && meta.mockupOrientation),
              qualityStatus: normalizeString(meta && meta.mockupQualityStatus),
              qualityCheckedAt: normalizeString(meta && meta.mockupQualityCheckedAt),
            },
          },
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
        const upsertOnly = meta.upsertOnly === true || meta.partial === true || meta.replaceMissing === false;
        const saveCustomers = upsertOnly && typeof store.upsertCustomers === 'function'
          ? store.upsertCustomers
          : store.replaceCustomers;
        const saved = await saveCustomers(customers, sourceMeta);
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
        const upsertedPhotoIds = new Set(entries.map((entry) => normalizeString(entry.customerId)).filter(Boolean));
        const removalIds = extractPhotoRemovalIds(stateValues).filter((id) => !upsertedPhotoIds.has(id));
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
