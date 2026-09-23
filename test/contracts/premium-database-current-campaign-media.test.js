const test = require('node:test');
const assert = require('node:assert/strict');
const { createController, needsMedia } = require('../../assets/premium-database-current-campaign-media');

test('current campaign media restores both design previews without changing other leads', async () => {
  const state = { klanten: [
    { id: 'serve-1', currentCampaign: true, websitePhoto: '', websiteMockup: '' },
    { id: 'old-1', currentCampaign: false, websitePhoto: '', websiteMockup: '' },
  ] };
  const requests = [];
  const controller = createController({
    state,
    isCurrentCampaignCustomer: (customer) => customer.currentCampaign,
    async fetchJsonWithTimeout(url) {
      requests.push(url);
      return { ok: true, async json() { return { ok: true, media: [{
        customerId: 'serve-1', websitePhoto: 'https://media.test/design.png',
        websiteMockup: 'https://media.test/mockup.png', signedUrlExpiresAt: '2099-01-01T00:00:00Z',
      }] }; } };
    },
    mergeCustomersWithPhotos(customers, media) {
      return customers.map((customer) => media[customer.id]
        ? { ...customer, websitePhoto: media[customer.id].websitePhoto, websiteMockup: media[customer.id].websiteMockup }
        : customer);
    },
    applyCustomerList(customers) { state.klanten = customers; },
  });

  assert.equal(await controller.refresh(), true);
  assert.match(requests[0], /^\/api\/premium-database\/current-campaign-media\?ids=serve-1$/);
  assert.equal(state.klanten[0].websitePhoto, 'https://media.test/design.png');
  assert.equal(state.klanten[0].websiteMockup, 'https://media.test/mockup.png');
  assert.equal(state.klanten[1].websitePhoto, '');
  assert.equal(await controller.refresh(), false);
  assert.equal(requests.length, 1);
});

test('current campaign media refreshes expiring signed URLs', () => {
  assert.equal(needsMedia({ websitePhoto: 'https://media.test/a', websiteMockup: 'https://media.test/b', signedUrlExpiresAt: '2026-09-23T20:04:00Z' }, Date.parse('2026-09-23T20:00:00Z')), true);
  assert.equal(needsMedia({ websitePhoto: 'https://media.test/a', websiteMockup: 'https://media.test/b', signedUrlExpiresAt: '2026-09-23T21:00:00Z' }, Date.parse('2026-09-23T20:00:00Z')), false);
});
