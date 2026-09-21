function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function countInstantlyProviderQueueRows({ rows = [], campaignIds = [], isActive, isApproached, isConfirmedSent } = {}) {
  const currentCampaignIds = new Set((Array.isArray(campaignIds) ? campaignIds : []).map(normalizeText).filter(Boolean));
  const isActiveRow = typeof isActive === 'function' ? isActive : () => false;
  const isApproachedRow = typeof isApproached === 'function' ? isApproached : () => false;
  const isSentRow = typeof isConfirmedSent === 'function' ? isConfirmedSent : () => false;
  const currentRows = Array.isArray(rows) ? rows : [];

  return {
    activeInstantlyRows: currentRows.filter(isActiveRow).length,
    approachedInstantlyRows: currentRows.filter(isApproachedRow).length,
    instantlyReadyRows: currentRows.filter((row) => isActiveRow(row) && !isSentRow(row)).length,
    instantlySentRows: currentRows.filter(isSentRow).length,
    currentCampaignQueuedRows: currentRows.filter((row) =>
      currentCampaignIds.has(normalizeText(row && row.instantlyCampaignId)) &&
      normalizeText(row && row.instantlyLeadId) &&
      isActiveRow(row) &&
      !isSentRow(row)
    ).length,
    pendingProviderAcceptanceRows: currentRows.filter((row) =>
      currentCampaignIds.has(normalizeText(row && row.instantlyCampaignId)) &&
      !normalizeText(row && row.instantlyLeadId) &&
      normalizeText(row && row.instantlyStatus).replace(/[^a-z0-9]+/g, '_') === 'queued'
    ).length,
  };
}

module.exports = { countInstantlyProviderQueueRows };
