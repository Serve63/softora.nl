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
    buildLead,
    loadPersonalizationContext,
    resolveSender,
    reserveRecipients,
    outboundRecipientGuardStore,
    saveLegacyGuards,
    markPreparedRows,
    campaignApi,
    normalizeString,
  } = deps;

  const loadRows = async () => {
      const state = await getUiStateValues(customerDbScope);
      const values = state && typeof state.values === 'object' ? state.values : {};
      return { state, values, rows: parseRows(values, customerDbKey, normalizeString) };
    };
  const persistRows = async (loaded, rows, meta) =>
    setUiStateValues(customerDbScope, buildRowsStateValues(loaded && loaded.values, rows, customerDbKey), meta);
  const loadContext = async (rows, sender, input) => ({
    ...buildInstantlyQueueSelectionContext(await loadPersonalizationContext(rows, { senderProfile: sender && sender.key, senderEmail: sender && sender.email }), input, normalizeString, createError),
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
    campaigns: config.replacementCampaigns,
    reserveRows: (items, options) => reserveRecipients(items, { ...options, campaignId: 'serve-martijn', source: 'instantly-campaign-replacement' }),
    releaseReservation,
    listCampaignLeads: campaignApi.listCampaignLeads,
    pauseCampaign: campaignApi.pauseCampaign,
    deleteCampaignLeads: campaignApi.deleteCampaignLeads,
  });
  const automatic = createInstantlyAutoUpload({
    ...shared,
    config,
    markPreparedRows,
    reserveRows: (items, options) => reserveRecipients(items, { ...options, source: 'instantly-auto-upload' }),
  });
  return { ...replacement, autoUpload: automatic.run };
}

module.exports = { createInstantlyCampaignReplacementRuntime };
