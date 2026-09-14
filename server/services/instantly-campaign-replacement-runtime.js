const { createInstantlyCampaignReplacement } = require('./instantly-campaign-replacement');
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
    campaignApi,
    normalizeString,
  } = deps;

  return createInstantlyCampaignReplacement({
    campaigns: config.replacementCampaigns,
    now,
    createError,
    loadRows: async () => {
      const state = await getUiStateValues(customerDbScope);
      const values = state && typeof state.values === 'object' ? state.values : {};
      return { state, values, rows: parseRows(values, customerDbKey, normalizeString) };
    },
    persistRows: async (loaded, rows, meta) => setUiStateValues(customerDbScope, buildRowsStateValues(loaded && loaded.values, rows, customerDbKey), meta),
    collectEligibleRows,
    buildLead,
    loadContext: async (rows, sender, input) => buildInstantlyQueueSelectionContext(await loadPersonalizationContext(rows, { senderProfile: sender && sender.key, senderEmail: sender && sender.email }), input, normalizeString, createError),
    resolveSender,
    reserveRows: (items, options) => reserveRecipients(items, { ...options, campaignId: 'serve-martijn', source: 'instantly-campaign-replacement' }),
    releaseReservation: (reservationId) => outboundRecipientGuardStore && typeof outboundRecipientGuardStore.releaseReservation === 'function' ? outboundRecipientGuardStore.releaseReservation(reservationId) : Promise.resolve({ ok: false, skipped: true }),
    confirmReservation: (reservationId, options) => outboundRecipientGuardStore && typeof outboundRecipientGuardStore.confirmReservation === 'function' ? outboundRecipientGuardStore.confirmReservation(reservationId, options) : Promise.resolve({ ok: false, skipped: true }),
    saveLegacyGuards,
    listCampaignLeads: campaignApi.listCampaignLeads,
    getCampaign: campaignApi.getCampaign,
    pauseCampaign: campaignApi.pauseCampaign,
    addCampaignLeads: campaignApi.addCampaignLeads,
    deleteCampaignLeads: campaignApi.deleteCampaignLeads,
    activateCampaign: campaignApi.activateCampaign,
  });
}

module.exports = { createInstantlyCampaignReplacementRuntime };
