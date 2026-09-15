const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The shared preview endpoint also serves coldcalling, outside this mail change.
test('mail preview reports Haaren distances without changing call preview distances', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/services/coldmail-campaign.js'), 'utf8');
  const start = source.indexOf('  async function getColdmailCampaignRecipients(input = {}) {');
  const end = source.indexOf('  function getColdmailReplyHistoryEntry(row)', start);
  assert.ok(start >= 0 && end > start);
  const preview = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    resolveColdmailRecipients: async input => ({
      mode: input.mode, count: 1, radiusKm: null, candidateRows: [{}],
      selectedRows: [{ id: 'test', row: {} }], failed: [],
    }),
    getColdmailSafetyLimits: () => ({}),
    getRowDomain: () => '',
    getRowCompany: () => 'Test',
    getRowEmail: () => 'test@example.test',
    getRowPhone: () => '',
    getHaarenDistanceKm: () => 10,
    getRowDistanceKm: () => 20,
  });
  assert.equal((await preview({ mode: 'mail' })).recipients[0].distanceKm, 10);
  assert.equal((await preview({ mode: 'call' })).recipients[0].distanceKm, 20);
});
