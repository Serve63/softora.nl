const { getMissingReplacementCampaigns } = require('./instantly-campaign-replacement');

function createInstantlyCampaignReplacementApi(deps = {}) {
  const { config = {}, fetchJsonWithTimeout, createError, normalizeString = (value) => String(value || '').trim() } = deps;
  const configuredCampaigns = config.autoApprovedCampaigns || config.replacementCampaigns;

  function assertConfigured() {
    if (!config.enabled) throw createError('Instantly is niet ingeschakeld.', 'INSTANTLY_DISABLED', 503);
    const missing = [!config.apiKey ? 'INSTANTLY_API_KEY' : null, ...getMissingReplacementCampaigns(configuredCampaigns).map((owner) => `INSTANTLY_REPLACEMENT_CAMPAIGN_${owner.toUpperCase()}`)].filter(Boolean);
    if (missing.length) throw createError('De Instantly-wachtlijsten van Servé en Martijn zijn nog niet volledig gekoppeld.', 'INSTANTLY_REPLACEMENT_NOT_CONFIGURED', 503, { missing });
  }

  async function request(campaignId, action = '') {
    const cleanCampaignId = normalizeString(campaignId);
    if (!cleanCampaignId) throw createError('Instantly campaign ID ontbreekt.', 'INSTANTLY_CAMPAIGN_ID_REQUIRED', 400);
    const path = `/campaigns/${encodeURIComponent(cleanCampaignId)}${action ? `/${action}` : ''}`;
    const method = action ? 'POST' : 'GET';
    const { response, data } = await fetchJsonWithTimeout(`${config.apiBaseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` } }, 30_000);
    if (!response || !response.ok) {
      const label = action === 'activate' ? 'gestart' : action === 'pause' ? 'veilig gepauzeerd' : 'gecontroleerd';
      throw createError(`Instantly-campagne kon niet worden ${label} (${response ? response.status : 'geen response'}).`, action === 'activate' ? 'INSTANTLY_CAMPAIGN_ACTIVATION_FAILED' : action === 'pause' ? 'INSTANTLY_CAMPAIGN_PAUSE_FAILED' : 'INSTANTLY_CAMPAIGN_READ_FAILED', response && response.status ? response.status : 502, { data, campaignId: cleanCampaignId });
    }
    return data;
  }

  return {
    activateCampaign: (campaignId) => request(campaignId, 'activate'),
    assertConfigured,
    getCampaign: (campaignId) => request(campaignId),
    pauseCampaign: (campaignId) => request(campaignId, 'pause'),
  };
}

module.exports = { createInstantlyCampaignReplacementApi };
