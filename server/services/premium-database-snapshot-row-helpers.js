const { createHash } = require('crypto');

function createSnapshotRowHelpers({ getRowId, getRowUpdatedAt, normalizeString }) {
  function dedupeCustomerRows(rows = []) {
    const byId = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const id = getRowId(row);
      if (!id) return;
      const current = byId.get(id);
      if (!current) {
        byId.set(id, row);
        return;
      }
      const currentUpdatedAt = Date.parse(getRowUpdatedAt(current)) || 0;
      const nextUpdatedAt = Date.parse(getRowUpdatedAt(row)) || 0;
      if (nextUpdatedAt > currentUpdatedAt) byId.set(id, row);
    });
    return Array.from(byId.values());
  }

  function buildSnapshotVersion(data = {}) {
    const normalizeIds = (rows) => Array.from(new Set(
      (Array.isArray(rows) ? rows : []).map(getRowId).filter(Boolean)
    )).sort();
    const identity = {
      mailReady: normalizeIds(data.customers),
      available: normalizeIds(data.availableCustomers),
      instantlyReady: normalizeIds(data.instantlyReadyCustomers),
      found: Array.from(new Set(
        (Array.isArray(data.foundCustomerIds) ? data.foundCustomerIds : [])
          .map(normalizeString)
          .filter(Boolean)
      )).sort(),
    };
    return `sha256:${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`;
  }

  return { dedupeCustomerRows, buildSnapshotVersion };
}

module.exports = { createSnapshotRowHelpers };
