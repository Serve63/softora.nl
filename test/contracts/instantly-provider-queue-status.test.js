const test = require('node:test');
const assert = require('node:assert/strict');

const { countInstantlyProviderQueueRows } = require('../../server/services/instantly-provider-queue-status');

test('provider queue counts only linked current-campaign leads and separate pending acceptances', () => {
  const campaignId = 'campaign-current';
  const rows = [
    { instantlyCampaignId: campaignId, instantlyLeadId: 'lead-1', instantlyStatus: 'synced' },
    { instantlyCampaignId: campaignId, instantlyLeadId: '', instantlyStatus: 'queued' },
    { instantlyCampaignId: campaignId, instantlyLeadId: 'lead-sent', instantlyStatus: 'sent' },
    { instantlyCampaignId: 'campaign-old', instantlyLeadId: 'lead-old', instantlyStatus: 'synced' },
    { instantlyCampaignId: campaignId, instantlyLeadId: 'lead-blocked', instantlyStatus: 'provider_not_found' },
  ];

  const result = countInstantlyProviderQueueRows({
    rows,
    campaignIds: [campaignId],
    isActive: (row) => ['queued', 'synced'].includes(row.instantlyStatus),
    isApproached: (row) => row.instantlyStatus === 'sent',
    isConfirmedSent: (row) => row.instantlyStatus === 'sent',
  });

  assert.deepEqual(result, {
    activeInstantlyRows: 3,
    approachedInstantlyRows: 1,
    instantlyReadyRows: 3,
    instantlySentRows: 1,
    currentCampaignQueuedRows: 1,
    pendingProviderAcceptanceRows: 1,
  });
});
