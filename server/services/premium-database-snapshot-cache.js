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

  function parseMailReadySnapshotCacheValue(raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
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
    return total === 0 || rows.length > 0;
  }

  function isMailReadySnapshotCoherent(snapshot = {}) {
    return Boolean(
      snapshot &&
      isSnapshotCategoryCoherent(snapshot.total, snapshot.customers) &&
      isSnapshotCategoryCoherent(snapshot.availableTotal, snapshot.availableCustomers)
    );
  }

  function serializeMailReadySnapshotCache(data = {}, rowLimit = maxLimit) {
    const limit = Math.max(1, Math.min(maxLimit, Number(rowLimit) || maxLimit));
    const customers = (Array.isArray(data.customers) ? data.customers : []).slice(0, limit);
    const availableCustomers = (Array.isArray(data.availableCustomers) ? data.availableCustomers : []).slice(0, limit);
    if (!customers.length && !availableCustomers.length) return '';
    return JSON.stringify({
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
  }

  return {
    isMailReadySnapshotCoherent,
    parseMailReadySnapshotCacheValue,
    serializeMailReadySnapshotCache,
  };
}

module.exports = {
  createPremiumDatabaseSnapshotCacheCodec,
};
