const test = require('node:test');
const assert = require('node:assert/strict');

const { createDataOpsHealthReporter } = require('../../server/services/data-ops-health');

test('data ops health reporter summarizes legacy scopes and missing photo chunks', async () => {
  const reporter = createDataOpsHealthReporter({
    fetchSupabaseRowsByStateKeyPrefixViaRest: async (prefix) => {
      if (prefix === 'ui_state:premium_database_photos') {
        return {
          ok: true,
          body: [
            {
              state_key: prefix,
              updated_at: '2026-04-30T12:00:00.000Z',
              payload: {
                values: {
                  softora_database_photos_v1: JSON.stringify({
                    'cust-1': {
                      id: 'cust-1',
                      photoKey: 'photo_cust_1',
                      chunkCount: 2,
                    },
                  }),
                  photo_cust_1_0: 'data:image/png;base64,AAAA',
                },
              },
            },
          ],
        };
      }
      return {
        ok: true,
        body: [
          {
            state_key: prefix,
            payload: { values: {} },
            updated_at: '2026-04-30T12:00:00.000Z',
          },
        ],
      };
    },
    dataOpsStore: {
      getDataOpsCounts: async () => ({
        customers: 2,
        activeOrders: 1,
        orderRuntime: 1,
        designPhotos: 1,
        webdesignJobs: 0,
      }),
    },
  });

  const report = await reporter.buildReport();
  const photos = report.legacyScopes.find((item) => item.scope === 'premium_database_photos');

  assert.equal(report.ok, true);
  assert.equal(report.structuredCounts.customers, 2);
  assert.equal(photos.rowCount, 1);
  assert.equal(photos.missingPhotoChunks, 1);
  assert.match(report.warnings[0], /ontbrekende fotochunks/);
});
