function normalizeString(value) {
  return String(value || '').trim();
}

function createPremiumDatabaseCustomersPageCoordinator(deps = {}) {
  const { dataOpsStore = null } = deps;

  async function sendCustomersPageResponse(req, res) {
    if (!dataOpsStore || typeof dataOpsStore.listCustomersPage !== 'function') {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase is tijdelijk niet beschikbaar.' });
    }
    const query = req && req.query && typeof req.query === 'object' ? req.query : {};
    const metaValue = normalizeString(query.meta).toLowerCase();
    const page = await dataOpsStore.listCustomersPage({
      offset: query.offset,
      limit: query.limit,
      metaOnly: metaValue === '1' || metaValue === 'true',
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!page) {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase kon niet volledig worden gelezen.' });
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ ok: true, ...page });
  }

  return { sendCustomersPageResponse };
}

module.exports = { createPremiumDatabaseCustomersPageCoordinator };
