const { createInstantlyCampaignReplacement } = require('./instantly-campaign-replacement');
const { createInstantlyAutoUpload } = require('./instantly-auto-upload');
const { buildInstantlyQueueSelectionContext } = require('./instantly-queue-selection');

function createInstantlyCampaignReplacementRuntime(deps = {}) {
  const {
    config,
    now,
    createError,
    getUiStateValues,
    setUiStateValues,
    customerDbScope,
    customerDbKey,
    parseRows,
    buildRowsStateValues,
    collectEligibleRows,
    getReadyPhoto,
    buildLead,
    loadPersonalizationContext,
    resolveSender,
    reserveRecipients,
    outboundRecipientGuardStore,
    saveLegacyGuards,
    markPreparedRows,
    removeMailReadyCustomer,
    campaignApi,
    normalizeString,
  } = deps;
  const configuredCampaigns = config.autoApprovedCampaigns || config.replacementCampaigns;

  const loadRowsOnce = async () => {
      const state = await getUiStateValues(customerDbScope, {
        // Auto-upload must read the current durable customer rows. A stale
        // cache can hide a newly prepared design, while the read cooldown
        // should never turn into a permanent scheduler stop.
        uiStateReadTimeoutMs: 12000,
        bypassReadFailureCooldown: true,
        bypassReadCache: true,
      });
      const values = state && typeof state.values === 'object' ? state.values : {};
      return { state, values, rows: parseRows(values, customerDbKey, normalizeString) };
    };
  const loadRows = async () => {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await loadRowsOnce();
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  };
  const persistRows = async (loaded, rows, meta) =>
    setUiStateValues(customerDbScope, buildRowsStateValues(loaded && loaded.values, rows, customerDbKey), meta);
  const persistSingleRow = async (singleRow, meta) => {
    if (!singleRow || typeof singleRow !== 'object') return null;
    return setUiStateValues(
      customerDbScope,
      buildRowsStateValues({}, [singleRow], customerDbKey),
      { ...(meta && typeof meta === 'object' ? meta : {}), upsertOnly: true },
    );
  };
  const loadContext = async (rows, sender, input) => ({
    ...buildInstantlyQueueSelectionContext(await loadPersonalizationContext(rows, {
      senderProfile: sender && sender.key,
      senderEmail: sender && sender.email,
      instantlyAutoUpload: Boolean(input && input.autoMailReadyOnly === true),
      uiStateReadTimeoutMs: 20000,
      bypassReadFailureCooldown: true,
      bypassReadCache: true,
      suppressReadFailureCooldown: true,
    }), input, normalizeString, createError),
    mailProviderOnly: input && input.autoMailReadyOnly === true ? 'instantly' : '',
  });
  const releaseReservation = (reservationId) => outboundRecipientGuardStore && typeof outboundRecipientGuardStore.releaseReservation === 'function'
    ? outboundRecipientGuardStore.releaseReservation(reservationId) : Promise.resolve({ ok: false, skipped: true });
  const confirmReservation = (reservationId, options) => outboundRecipientGuardStore && typeof outboundRecipientGuardStore.confirmReservation === 'function'
    ? outboundRecipientGuardStore.confirmReservation(reservationId, options) : Promise.resolve({ ok: false, skipped: true });
  const shared = {
    now, createError, loadRows, persistRows,
    collectEligibleRows,
    buildLead,
    loadContext,
    resolveSender,
    confirmReservation,
    saveLegacyGuards,
    getCampaign: campaignApi.getCampaign,
    addCampaignLeads: campaignApi.addCampaignLeads,
    activateCampaign: campaignApi.activateCampaign,
  };
  const replacement = createInstantlyCampaignReplacement({
    ...shared,
    campaigns: configuredCampaigns,
    reserveRows: (items, options) => reserveRecipients(items, { ...options, campaignId: 'serve-martijn', source: 'instantly-campaign-replacement' }),
    releaseReservation,
    listCampaignLeads: campaignApi.listCampaignLeads,
    persistSingleRow,
    pauseCampaign: campaignApi.pauseCampaign,
    deleteCampaignLeads: campaignApi.deleteCampaignLeads,
  });
  const automatic = createInstantlyAutoUpload({
    ...shared,
    config,
    getReadyPhoto,
    markPreparedRows,
    persistSingleRow,
    releaseReservation,
    listCampaignLeads: campaignApi.listCampaignLeads,
    removeMailReadyCustomer,
    reserveRows: (items, options) => reserveRecipients(items, { ...options, source: 'instantly-auto-upload' }),
  });
  return { ...replacement, autoUpload: automatic.run, getUploadCapacity: automatic.getCapacity };
}

module.exports = { createInstantlyCampaignReplacementRuntime };
