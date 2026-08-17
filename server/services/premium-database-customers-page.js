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
    const view = normalizeString(query.view).toLowerCase();
    if (view === 'clients') {
      if (typeof dataOpsStore.listDashboardCustomers !== 'function') {
        return res.status(503).json({ ok: false, error: 'De formele klantenlijst is tijdelijk niet beschikbaar.' });
      }
      const customers = await dataOpsStore.listDashboardCustomers({
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressTransientReadFailureLog: true,
        maxRows: 5000,
      });
      if (!Array.isArray(customers)) {
        return res.status(503).json({ ok: false, error: 'De formele klantenlijst kon niet volledig worden gelezen.' });
      }
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      return res.status(200).json({
        ok: true,
        source: 'canonical-clients',
        completeDataset: true,
        customers,
        total: customers.length,
      });
    }
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
