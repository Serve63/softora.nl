const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMigrationPlanFromLegacyValues,
} = require('../../scripts/migrate-data-ops');
const { buildChunkedStatePatch } = require('../../server/services/data-ops-serialization');
const { KEYS } = require('../../server/services/data-ops-ui-state-bridge');

test('data ops migration script builds an idempotent plan from legacy ui-state values', () => {
  const customerValues = buildChunkedStatePatch(
    KEYS.customers,
    JSON.stringify([{ id: 'cust-1', bedrijf: 'Softora' }])
  );
  const activeOrderValues = {
    ...buildChunkedStatePatch(KEYS.activeOrders, JSON.stringify([{ id: 12, title: 'Website' }])),
    [KEYS.orderRuntime]: JSON.stringify({ 12: { statusKey: 'running' } }),
  };
  const photoKey = 'softora_database_photo_data_v1_cust_1';
  const photoValues = {
    [KEYS.photos]: JSON.stringify({
      'cust-1': {
        id: 'cust-1',
        photoKey,
        chunkCount: 1,
        websitePhotoName: 'demo.png',
      },
    }),
    [`${photoKey}_0`]: 'data:image/png;base64,aGVsbG8=',
  };

  const first = buildMigrationPlanFromLegacyValues({ customerValues, activeOrderValues, photoValues });
  const second = buildMigrationPlanFromLegacyValues({ customerValues, activeOrderValues, photoValues });

  assert.deepEqual(first.counts, {
    customers: 1,
    activeOrders: 1,
    orderRuntime: 1,
    designPhotos: 1,
  });
  assert.deepEqual(second, first);
  assert.equal(first.designPhotos[0].customerId, 'cust-1');
});
