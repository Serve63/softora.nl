const test = require('node:test');
const assert = require('node:assert/strict');

require('../../assets/premium-database-webdesign-asset-state');
const { createController, createVisibleController } = require('../../assets/premium-database-current-campaign-media');

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
      websitePhotoCreatedAt: hasOwnMedia ? '2026-09-20T10:00:00.000Z' : '',
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

test('existing campaign images refresh missing design dates and retain the returned timestamp', async () => {
  const { needsMedia } = require('../../assets/premium-database-current-campaign-media');
  const customer = { id: 'campaign-design', websitePhoto: 'https://media.test/design.png', websiteMockup: 'https://media.test/mockup.png', signedUrlExpiresAt: '2099-01-01T00:00:00Z' };
  assert.equal(needsMedia(customer, Date.now()), true);
  const date = '2026-10-08T10:34:00.000Z';
  let applied;
  const controller = createController({ state: { klanten: [customer] }, isCurrentCampaignCustomer: () => true,
    mergeCustomersWithPhotos, buildCustomerIdentityKey: identityKey,
    fetchJsonWithTimeout: async () => ({ ok: true, json: async () => ({ ok: true, media: [{ ...customer, customerId: customer.id, websitePhotoCreatedAt: date }] }) }),
    applyCustomerList: (rows) => { applied = rows; },
  });
  assert.equal(await controller.refresh(), true);
  assert.equal(applied[0].websitePhotoCreatedAt, date);
  assert.equal(needsMedia(applied[0], Date.now()), false);
});

test('visible snapshot designs hydrate without campaign membership and follow pagination', async () => {
  const date = '2026-10-07T18:44:00.000Z';
  const state = { visibleLimit: 25, klanten: Array.from({ length: 60 }, (_, index) => ({
    id: `ready-${index}`, bedrijf: `Bedrijf ${index}`, hasPhoto: true, hasMockup: true,
    mailReadySnapshot: true, websitePhoto: '', websiteMockup: '', websitePhotoCreatedAt: date,
  })) };
  state.klanten.push({ id: 'available', bedrijf: 'Nog geen ontwerp', hasPhoto: false });
  const requests = [];
  let settled = 0;
  const controller = createVisibleController({ state, getCustomers: () => state.klanten,
    shouldShowWebsitePhoto: () => true,
    getAssetState: (customer) => ({ hasPhoto: customer.hasPhoto, hasMockup: customer.hasMockup }),
    mergeCustomersWithPhotos, buildCustomerIdentityKey: identityKey,
    applyCustomerList: (rows) => { state.klanten = rows; },
    onSettled: () => { settled++; },
    fetchJsonWithTimeout: async (url) => {
      const ids = decodeURIComponent(url.split('ids=')[1]).split(',');
      requests.push(ids);
      return { ok: true, json: async () => ({ ok: true, media: ids.map((id) => ({
        customerId: id, websitePhoto: `https://media.test/${id}.png`, websiteMockup: `https://media.test/${id}-m.png`,
        websitePhotoCreatedAt: date, signedUrlExpiresAt: '2099-01-01T00:00:00Z',
      })) }) };
    },
  });
  assert.equal(await controller.refresh(), true);
  assert.deepEqual(requests[0], state.klanten.slice(0, 25).map((row) => row.id));
  assert.equal(state.klanten[0].websitePhoto, 'https://media.test/ready-0.png');
  assert.equal(state.klanten[0].mailReadySnapshot, true);
  assert.equal(state.klanten[25].websitePhoto, '');
  state.visibleLimit = 50;
  assert.equal(await controller.refresh(), true);
  assert.deepEqual(requests[1], state.klanten.slice(25, 50).map((row) => row.id));
  assert.equal(settled, 2);
  assert.equal(await controller.refresh(), false);
  assert.equal(requests.length, 2, 'loaded previews do not refetch on every render');
  state.visibleLimit = 61;
  assert.equal(await controller.refresh(), true);
  assert.deepEqual(requests[2], state.klanten.slice(50, 60).map((row) => row.id), 'rows without an existing design are excluded');
});

test('empty, partial and failed visible media reads are throttled and can recover', async () => {
  let nowMs = Date.now();
  const state = { klanten: [{ id: 'ready', hasPhoto: true, hasMockup: true }] };
  let calls = 0;
  let outcome = 'error';
  const controller = createController({ state, now: () => nowMs, getCustomers: () => state.klanten,
    isCurrentCampaignCustomer: () => true, mergeCustomersWithPhotos,
    applyCustomerList: (rows) => { state.klanten = rows; },
    fetchJsonWithTimeout: async () => {
      calls++;
      return { ok: outcome !== 'error', status: 503, json: async () => ({ ok: true,
        media: outcome === 'empty' ? [] : [{ customerId: 'ready', websitePhoto: 'https://media.test/photo.png',
          websiteMockup: outcome === 'partial' ? '' : 'https://media.test/mockup.png',
          websitePhotoCreatedAt: '2026-10-07T18:44:00.000Z', signedUrlExpiresAt: '2099-01-01T00:00:00Z' }],
      }) };
    },
  });
  for (const nextOutcome of ['error', 'empty', 'partial', 'complete']) {
    outcome = nextOutcome;
    assert.equal(await controller.refresh(), ['partial', 'complete'].includes(outcome));
    assert.equal(await controller.refresh(), false);
    nowMs += 30_001;
  }
  assert.equal(calls, 4);
  assert.equal(state.klanten[0].websiteMockup, 'https://media.test/mockup.png');
});
