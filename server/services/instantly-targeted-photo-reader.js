function createInstantlyTargetedPhotoReader(deps = {}) {
  const {
    dataOpsStore = null,
    normalizeString = (value) => String(value || '').trim(),
    getExplicitRowId = () => '',
    buildRowIdentityKeys = () => new Set(),
    buildRowIdentityKey = () => '',
    normalizeStoredIdentityKeys = () => new Set(),
    getUiStateValues = async () => ({ values: {} }),
    customerPhotoScope = '',
    customerPhotoKey = '',
    parseCustomerPhotoMap = () => ({}),
    logger = console,
  } = deps;

  function buildSignedPhotoMap(entries = [], rows = []) {
    const rowById = new Map();
    const rowByIdentity = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = getExplicitRowId(row, normalizeString).toLowerCase();
      if (id && !rowById.has(id)) rowById.set(id, row);
      buildRowIdentityKeys(row, normalizeString).forEach((identityKey) => {
        if (identityKey && !rowByIdentity.has(identityKey)) rowByIdentity.set(identityKey, row);
      });
    });
    const map = {};
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const id = normalizeString(entry && (entry.customerId || entry.customer_id));
      if (!id) return;
      const legacyMeta = entry && entry.legacyMeta && typeof entry.legacyMeta === 'object' ? entry.legacyMeta : {};
      const row = rowById.get(id.toLowerCase()) ||
        rowByIdentity.get(normalizeString(entry && entry.identityKey)) ||
        (Array.isArray(rows) ? rows.find((candidate) => getExplicitRowId(candidate, normalizeString) === id) : null);
      const websitePhotoUrl = normalizeString(entry && (entry.websitePhotoUrl || entry.signedUrl || entry.publicUrl));
      const websiteMockupUrl = normalizeString(entry && (entry.websiteMockupUrl || entry.mockupUrl || entry.signedMockupUrl));
      if (!websitePhotoUrl && !websiteMockupUrl) return;
      map[id] = {
        id,
        identityKey: normalizeString(entry && entry.identityKey) || buildRowIdentityKey(row, normalizeString),
        websitePhoto: websitePhotoUrl,
        websitePhotoUrl,
        websiteMockup: websiteMockupUrl,
        websiteMockupUrl,
        websitePhotoName: normalizeString(entry && (entry.fileName || entry.websitePhotoName)) || 'Websitefoto',
        websiteMockupName: normalizeString(entry && entry.websiteMockupName) || normalizeString(legacyMeta.websiteMockupName),
        webdesignMailProvider: normalizeString(entry && entry.webdesignMailProvider) || normalizeString(legacyMeta.webdesignMailProvider),
        senderEmail: normalizeString(entry && entry.senderEmail) || normalizeString(legacyMeta.senderEmail),
        mockupRenderer: normalizeString(entry && entry.mockupRenderer) || normalizeString(legacyMeta.mockupRenderer),
        mockupOrientation: normalizeString(entry && entry.mockupOrientation) || normalizeString(legacyMeta.mockupOrientation),
        mockupQualityStatus: normalizeString(entry && entry.mockupQualityStatus) || normalizeString(legacyMeta.mockupQualityStatus),
        mockupQualityCheckedAt: normalizeString(entry && entry.mockupQualityCheckedAt) || normalizeString(legacyMeta.mockupQualityCheckedAt),
        legacyMeta,
        updatedAt: normalizeString(entry && entry.updatedAt),
        storage: {
          source: 'supabase_storage',
          bucket: normalizeString(entry && entry.storageBucket),
          path: normalizeString(entry && entry.storagePath),
          signedUrlExpiresAt: normalizeString(entry && entry.signedUrlExpiresAt),
        },
      };
    });
    return map;
  }

  async function read(rows = [], options = {}) {
    if (
      options?.instantlyAutoUpload !== true ||
      !dataOpsStore ||
      typeof dataOpsStore.listDesignPhotoAssetFlags !== 'function' ||
      typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function'
    ) {
      return { handled: false, photoMap: null };
    }
    try {
      const flags = await dataOpsStore.listDesignPhotoAssetFlags({
        bypassReadCache: true,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
      });
      if (!Array.isArray(flags) || !flags.length) return { handled: false, photoMap: null };
      const flagById = new Map();
      const flagByIdentity = new Map();
      flags.forEach((flag) => {
        const id = normalizeString(flag && flag.customerId).toLowerCase();
        if (id && !flagById.has(id)) flagById.set(id, flag);
        normalizeStoredIdentityKeys(flag && flag.identityKey, normalizeString).forEach((identityKey) => {
          if (identityKey && !flagByIdentity.has(identityKey)) flagByIdentity.set(identityKey, flag);
        });
      });
      const candidateIds = [];
      const seenIds = new Set();
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        const rowId = getExplicitRowId(row, normalizeString);
        const flag = flagById.get(rowId.toLowerCase()) ||
          Array.from(buildRowIdentityKeys(row, normalizeString))
            .map((identityKey) => flagByIdentity.get(identityKey))
            .find(Boolean);
        const provider = normalizeString(
          (row && row.webdesignMailProvider) || (flag && flag.webdesignMailProvider)
        ).toLowerCase();
        if (!flag || provider !== 'instantly' || flag.hasPhoto !== true || flag.hasMockup !== true) return;
        if (!rowId || seenIds.has(rowId.toLowerCase())) return;
        seenIds.add(rowId.toLowerCase());
        candidateIds.push(rowId);
      });
      if (!candidateIds.length) return { handled: true, photoMap: {} };
      const signedEntries = await dataOpsStore.listDesignPhotosWithSignedUrls({
        customerIds: candidateIds.slice(0, 500),
        maxMatches: Math.min(candidateIds.length, 500),
        expiresInSeconds: 24 * 60 * 60,
        bypassReadCache: true,
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
      });
      if (Array.isArray(signedEntries)) {
        return { handled: true, photoMap: buildSignedPhotoMap(signedEntries, rows) };
      }
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[Instantly][photo-targeted-read]', error?.message || error);
      }
    }
    return { handled: false, photoMap: null };
  }

  async function load(rows = [], options = {}) {
    const targeted = await read(rows, options);
    if (targeted && targeted.handled) return targeted.photoMap || {};
    const state = await getUiStateValues(customerPhotoScope, options);
    const values = state && typeof state.values === 'object' ? state.values : {};
    return parseCustomerPhotoMap(values[customerPhotoKey], values, rows, normalizeString);
  }

  return { read, load };
}

module.exports = { createInstantlyTargetedPhotoReader };
