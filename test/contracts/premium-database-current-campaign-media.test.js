const test = require('node:test');
const assert = require('node:assert/strict');

require('../../assets/premium-database-webdesign-asset-state');
const { createController } = require('../../assets/premium-database-current-campaign-media');

const assetState = globalThis.SoftoraDatabaseWebdesignAssetState;
const identityKey = (customer) => [customer.bedrijf, customer.naam, customer.tel].map((value) => String(value || '').toLowerCase()).join('|');
const mergeCustomersWithPhotos = (customers, photoMap, fallback) => assetState.mergeCustomersWithPhotos(customers, photoMap, fallback, {
  normalizeCustomer: (customer) => ({ ...customer }),
  buildCustomerIdentityKey: identityKey,
  isValidWebsitePhotoSource: (value) => /^https:\/\//.test(String(value || '')),
});

function buildCustomers() {
  const customers = [];
  for (let index = 0; index < 400; index += 1) {
    const duplicateGroup = index % 37 === 0 ? 'dup-a' : index % 41 === 0 ? 'dup-b' : `bedrijf-${index}`;
    const hasOwnMedia = index % 5 === 0;
    customers.push({
      id: `c-${index}`, bedrijf: duplicateGroup, naam: duplicateGroup.startsWith('dup') ? 'Zelfde' : `Naam ${index}`,
      tel: duplicateGroup.startsWith('dup') ? '010' : String(index), instantly: index % 3 === 0,
      websitePhoto: hasOwnMedia ? `https://old/${index}.png` : '', websiteMockup: hasOwnMedia ? `https://old/${index}-m.png` : '',
      webdesignMailProvider: index % 7 === 0 ? 'softora' : '',
    });
  }
  // state.klanten is always the output of the boot-time full merge.
  return mergeCustomersWithPhotos(customers, {}, customers);
}

async function runRefresh(withIdentity) {
  const customers = buildCustomers();
  const state = { klanten: customers };
  let applied = null;
  const media = {
    'c-3': { customerId: 'c-3', websitePhoto: 'https://new/3.png', websiteMockup: 'https://new/3-m.png', signedUrlExpiresAt: '2026-09-25T00:00:00Z',
      identityKey: 'dup-b|zelfde|010' },
    'c-37': { customerId: 'c-37', websitePhoto: 'https://new/37.png', websiteMockup: 'https://new/37-m.png', identityKey: 'dup-a|zelfde|010', webdesignMailProvider: 'instantly' },
    'c-9': { customerId: 'c-9', websitePhoto: 'https://new/9.png', websiteMockup: '', signedUrlExpiresAt: '2026-09-25T01:00:00Z' },
  };
  const controller = createController({
    state,
    isCurrentCampaignCustomer: (customer) => ['c-3', 'c-37', 'c-9'].includes(customer.id),
    mergeCustomersWithPhotos,
    ...(withIdentity ? { buildCustomerIdentityKey: identityKey } : {}),
    applyCustomerList: (next) => { applied = next; },
    fetchJsonWithTimeout: async (url) => {
      const ids = decodeURIComponent(url.split('ids=')[1]).split(',');
      return { ok: true, json: async () => ({ ok: true, media: ids.map((id) => media[id]).filter(Boolean) }) };
    },
  });
  assert.equal(await controller.refresh(), true);
  return { before: customers, after: applied };
}

test('campaign media updates only the customers the full merge would change, with identical results', async () => {
  const full = await runRefresh(false);
  const targeted = await runRefresh(true);
  assert.deepEqual(targeted.after, full.after, 'targeted merge must equal the full 20k merge');
  const changed = targeted.after.filter((customer, index) => customer !== targeted.before[index]).map((customer) => customer.id);
  assert.ok(changed.includes('c-3') && changed.includes('c-9'), JSON.stringify(changed));
  assert.ok(changed.includes('c-41') && changed.includes('c-82'), 'customers matching a received photo by identity key follow the full merge');
  assert.equal(targeted.after.find((customer) => customer.id === 'c-82').websitePhoto, 'https://new/3.png');
  assert.ok(changed.length < 20, `only affected customers get new objects (got ${changed.length})`);
});
