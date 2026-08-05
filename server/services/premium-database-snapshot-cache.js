const { gzipSync, gunzipSync } = require('zlib');

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeFoundCustomerIds(value) {
  return Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((customerId) => normalizeString(customerId))
      .filter(Boolean)
  ));
}

function createPremiumDatabaseSnapshotCacheCodec(options = {}) {
  const maxLimit = Math.max(1, Number(options.maxLimit) || 3000);
  const formatVersion = Math.max(1, Number(options.formatVersion) || 1);

  function decodeSnapshotValue(raw) {
    const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.encoding === 'gzip-base64' &&
      normalizeString(parsed.data)
    ) {
      return JSON.parse(gunzipSync(Buffer.from(parsed.data, 'base64')).toString('utf8'));
    }
    return parsed;
  }

  function parseMailReadySnapshotCacheValue(raw) {
    try {
      const parsed = decodeSnapshotValue(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.customers)) return null;
      const customers = parsed.customers
        .filter((customer) => customer && typeof customer === 'object' && normalizeString(customer.id))
        .slice(0, maxLimit);
      const availableCustomers = (Array.isArray(parsed.availableCustomers) ? parsed.availableCustomers : [])
        .filter((customer) => customer && typeof customer === 'object' && normalizeString(customer.id))
        .slice(0, maxLimit);
      if (!customers.length && !availableCustomers.length) return null;
      return {
        version: Math.max(1, Number(parsed.version) || 1),
        generatedAt: normalizeString(parsed.generatedAt),
        total: Math.max(customers.length, Number(parsed.total) || 0),
        customers,
        availableTotal: Math.max(availableCustomers.length, Number(parsed.availableTotal) || 0),
        availableCustomers,
        foundCustomerIds: Array.isArray(parsed.foundCustomerIds)
          ? normalizeFoundCustomerIds(parsed.foundCustomerIds)
          : null,
        timings: parsed.timings && typeof parsed.timings === 'object' ? parsed.timings : {},
      };
    } catch (_error) {
      return null;
    }
  }

  function isSnapshotCategoryCoherent(totalRaw, rowsRaw) {
    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
    const total = Math.max(0, Number(totalRaw) || 0);
    return total === rows.length;
  }

  function isMailReadySnapshotCoherent(snapshot = {}) {
    return Boolean(
      snapshot &&
      isSnapshotCategoryCoherent(snapshot.total, snapshot.customers) &&
      isSnapshotCategoryCoherent(snapshot.availableTotal, snapshot.availableCustomers)
    );
  }

  function isMailReadySnapshotBootstrapCoherent(snapshot = {}, rowLimit = 100) {
    const limit = Math.max(1, Number(rowLimit) || 100);
    const customers = Array.isArray(snapshot && snapshot.customers) ? snapshot.customers : [];
    const availableCustomers = Array.isArray(snapshot && snapshot.availableCustomers) ? snapshot.availableCustomers : [];
    const total = Math.max(0, Number(snapshot && snapshot.total) || 0);
    const availableTotal = Math.max(0, Number(snapshot && snapshot.availableTotal) || 0);
    return Boolean(
      snapshot &&
      customers.length === Math.min(total, limit) &&
      availableCustomers.length === Math.min(availableTotal, limit)
    );
  }

  function serializeMailReadySnapshotCache(data = {}, rowLimit = maxLimit, serializeOptions = {}) {
    const limit = Math.max(1, Math.min(maxLimit, Number(rowLimit) || maxLimit));
    const customers = (Array.isArray(data.customers) ? data.customers : []).slice(0, limit);
    const availableCustomers = (Array.isArray(data.availableCustomers) ? data.availableCustomers : []).slice(0, limit);
    if (!customers.length && !availableCustomers.length) return '';
    const serialized = JSON.stringify({
      version: formatVersion,
      generatedAt: normalizeString(data.generatedAt),
      total: Math.max(customers.length, Number(data.total) || (Array.isArray(data.customers) ? data.customers.length : 0)),
      customers,
      availableTotal: Math.max(availableCustomers.length, Number(data.availableTotal) || (Array.isArray(data.availableCustomers) ? data.availableCustomers.length : 0)),
      availableCustomers,
      ...(Array.isArray(data.foundCustomerIds) ? {
        foundCustomerIds: normalizeFoundCustomerIds(data.foundCustomerIds),
      } : {}),
      timings: data.timings && typeof data.timings === 'object' ? data.timings : {},
    });
    if (serializeOptions.compress !== true || serialized.length <= 200000) return serialized;
    return JSON.stringify({
      version: formatVersion,
      encoding: 'gzip-base64',
      data: gzipSync(Buffer.from(serialized, 'utf8'), { level: 9 }).toString('base64'),
    });
  }

  return {
    isMailReadySnapshotCoherent,
    isMailReadySnapshotBootstrapCoherent,
    parseMailReadySnapshotCacheValue,
    serializeMailReadySnapshotCache,
  };
}

module.exports = {
  createPremiumDatabaseSnapshotCacheCodec,
};
