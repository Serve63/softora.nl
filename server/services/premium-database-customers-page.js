const { createPremiumDatabaseCustomersArchiveResponder } = require('./premium-database-customers-archive');
const { createPremiumDatabaseCustomersDeltaResponder } = require('./premium-database-customers-delta');

function normalizeString(value) {
  return String(value || '').trim();
}

function createPremiumDatabaseCustomersPageCoordinator(deps = {}) {
  const { dataOpsStore = null } = deps;
  const sendCustomersArchiveResponse = createPremiumDatabaseCustomersArchiveResponder({ dataOpsStore });
  const sendCustomersDeltaResponse = createPremiumDatabaseCustomersDeltaResponder({ dataOpsStore });

  async function sendCurrentCampaignMediaResponse(req, res) {
    if (!dataOpsStore || typeof dataOpsStore.listDesignPhotosWithSignedUrls !== 'function') {
      return res.status(503).json({ ok: false, error: 'Webdesigns zijn tijdelijk niet beschikbaar.' });
    }
    const rawIds = normalizeString(req && req.query && req.query.ids);
    const customerIds = Array.from(new Set(rawIds.split(',').map(normalizeString).filter(Boolean)));
    if (customerIds.length > 100 || customerIds.some((id) => id.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(id))) {
      return res.status(400).json({ ok: false, error: 'Ongeldige klantselectie.' });
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (!customerIds.length) return res.status(200).json({ ok: true, media: [] });
    const rows = await dataOpsStore.listDesignPhotosWithSignedUrls({
      customerIds,
      maxMatches: Math.min(500, customerIds.length * 4),
      expiresInSeconds: 60 * 60,
      bypassReadCache: true,
      bypassReadFailureCooldown: true,
      suppressReadFailureCooldown: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(rows)) {
      return res.status(503).json({ ok: false, error: 'Webdesigns konden niet worden geladen.' });
    }
    const requested = new Set(customerIds);
    const seen = new Set();
    return res.status(200).json({
      ok: true,
      media: rows.filter((row) => {
        const id = normalizeString(row && row.customerId);
        if (!requested.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      }).map((row) => ({
        customerId: normalizeString(row.customerId),
        identityKey: normalizeString(row.identityKey),
        websitePhoto: normalizeString(row.websitePhotoUrl),
        websitePhotoName: normalizeString(row.fileName),
        websiteMockup: normalizeString(row.websiteMockupUrl),
        websiteMockupName: normalizeString(row.websiteMockupName),
        signedUrlExpiresAt: normalizeString(row.signedUrlExpiresAt),
      })),
    });
  }

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
      suppressTransientReadFailureLog: false,
    });
    if (!page) {
      return res.status(503).json({ ok: false, error: 'De officiële klantdatabase kon niet volledig worden gelezen.' });
    }
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    return res.status(200).json({ ok: true, ...page });
  }

  return { sendCustomersPageResponse, sendCustomersArchiveResponse, sendCustomersDeltaResponse, sendCurrentCampaignMediaResponse };
}

module.exports = { createPremiumDatabaseCustomersPageCoordinator };
