const test = require('node:test');
const assert = require('node:assert/strict');

const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');

function createSupabaseClientRecorder(currentCustomerIds = []) {
  const recorder = {
    upsertRows: [],
    deletedIds: [],
  };
  const client = {
    from(table) {
      return {
        upsert(rows) {
          if (table === 'softora_customers') recorder.upsertRows = rows;
          return Promise.resolve({ data: rows, error: null });
        },
        select(column) {
          return {
            is() {
              return {
                limit() {
                  const idColumn = String(column || 'customer_id');
                  return Promise.resolve({
                    data: currentCustomerIds.map((id) => ({ [idColumn]: id })),
                    error: null,
                  });
                },
              };
            },
          };
        },
        update() {
          return {
            in(_column, ids) {
              recorder.deletedIds = ids;
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
      };
    },
  };
  return { client, recorder };
}

test('data ops store merges duplicate customer identities before structured upsert', async () => {
  const { client, recorder } = createSupabaseClientRecorder(['lead-1', 'lead-2']);
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-05-11T12:00:00.000Z'),
    logger: { error: () => {} },
  });

  const result = await store.replaceCustomers(
    [
      {
        id: 'lead-1',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        telefoon: '+31 6 12345678',
        email: '',
        status: 'prospect',
        databaseStatus: 'prospect',
        hist: [{ type: 'import', label: 'Import', date: '2026-04-01' }],
      },
      {
        id: 'lead-2',
        bedrijf: 'Bakkerij Zon',
        naam: 'Ruben',
        telefoon: '+31 6 12345678',
        email: 'ruben@example.test',
        status: 'klant',
        databaseStatus: 'klant',
        updatedAt: '2026-05-10T09:00:00.000Z',
        hist: [{ type: 'klant', label: 'Klant geworden', date: '2026-05-10' }],
      },
    ],
    { source: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(recorder.upsertRows.length, 1);
  assert.equal(recorder.upsertRows[0].customer_id, 'lead-2');
  assert.equal(recorder.upsertRows[0].database_status, 'klant');
  assert.equal(recorder.upsertRows[0].payload.email, 'ruben@example.test');
  assert.deepEqual(recorder.upsertRows[0].payload.mergedCustomerIds, ['lead-2', 'lead-1']);
  assert.deepEqual(
    recorder.upsertRows[0].payload.hist.map((entry) => entry.type),
    ['klant', 'import']
  );
  assert.deepEqual(recorder.deletedIds, ['lead-1']);
});

test('data ops store paginates customer reads beyond Supabase default page size', async () => {
  const rows = Array.from({ length: 1250 }, (_item, index) => ({
    customer_id: `lead-${index + 1}`,
    payload: {
      id: `lead-${index + 1}`,
      bedrijf: `Bedrijf ${index + 1}`,
    },
    updated_at: '2026-05-22T10:00:00.000Z',
  }));
  const ranges = [];
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range(from, to) {
                      ranges.push([from, to]);
                      return Promise.resolve({
                        data: rows.slice(from, to + 1),
                        error: null,
                      });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error: () => {} },
  });

  const customers = await store.listCustomers();

  assert.equal(customers.length, 1250);
  assert.equal(customers[0].id, 'lead-1');
  assert.equal(customers[1249].bedrijf, 'Bedrijf 1250');
  assert.deepEqual(ranges, [
    [0, 999],
    [1000, 1999],
  ]);
});

test('data ops store returns quickly when customer reads hang', async () => {
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range() {
                      return new Promise(() => {});
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    dataOpsReadQueryTimeoutMs: 25,
    logger: { error: () => {}, warn: () => {} },
  });

  const startedAt = Date.now();
  const customers = await store.listCustomers();

  assert.equal(customers, null);
  assert.ok(Date.now() - startedAt < 1000);
});

test('data ops store opens a short read cooldown after Supabase timeouts', async () => {
  let readCalls = 0;
  const warnings = [];
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range() {
                      readCalls += 1;
                      return new Promise(() => {});
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    dataOpsReadQueryTimeoutMs: 25,
    dataOpsReadFailureCooldownMs: 1000,
    logger: { error: () => {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  const first = await store.listCustomers();
  const secondStartedAt = Date.now();
  const second = await store.listCustomers();

  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(readCalls, 1);
  assert.ok(Date.now() - secondStartedAt < 100);
  assert.match(warnings.join('\n'), /\[DataOps\]\[read-circuit-open\]/);
});

test('data ops store can suppress public-preview fallback read cooldowns', async () => {
  let readCalls = 0;
  const warnings = [];
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range() {
                      readCalls += 1;
                      return new Promise(() => {});
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    dataOpsReadQueryTimeoutMs: 25,
    dataOpsReadFailureCooldownMs: 1000,
    logger: { error: () => {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  const suppressed = await store.listCustomers({
    suppressReadFailureCooldown: true,
    suppressTransientReadFailureLog: true,
  });
  assert.equal(suppressed, null);
  assert.equal(warnings.length, 0);

  const normalStartedAt = Date.now();
  const normal = await store.listCustomers();

  assert.equal(normal, null);
  assert.equal(readCalls, 2);
  assert.ok(Date.now() - normalStartedAt >= 20);
  assert.match(warnings.join('\n'), /\[DataOps\]\[read-circuit-open\]/);
});

test('data ops store serves stale cached customers when a later read times out', async () => {
  let nowMs = Date.parse('2026-05-22T10:00:00.000Z');
  let readCalls = 0;
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range() {
                      readCalls += 1;
                      if (readCalls === 1) {
                        return Promise.resolve({
                          data: [
                            {
                              customer_id: 'lead-1',
                              payload: { id: 'lead-1', bedrijf: 'Softora' },
                              updated_at: '2026-05-22T10:00:00.000Z',
                            },
                          ],
                          error: null,
                        });
                      }
                      return new Promise(() => {});
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    dataOpsReadQueryTimeoutMs: 25,
    dataOpsReadCacheTtlMs: 1,
    now: () => new Date(nowMs),
    logger: { error: () => {}, warn: () => {} },
  });

  const first = await store.listCustomers();
  nowMs += 10;
  const second = await store.listCustomers();

  assert.equal(readCalls, 2);
  assert.equal(first[0].bedrijf, 'Softora');
  assert.equal(second[0].bedrijf, 'Softora');
});

test('data ops store can suppress stale cache warnings for public-preview fallbacks', async () => {
  let nowMs = Date.parse('2026-05-22T10:00:00.000Z');
  let readCalls = 0;
  const warnings = [];
  const client = {
    from(table) {
      assert.equal(table, 'softora_customers');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    range() {
                      readCalls += 1;
                      if (readCalls === 1) {
                        return Promise.resolve({
                          data: [
                            {
                              customer_id: 'lead-1',
                              payload: { id: 'lead-1', bedrijf: 'Softora' },
                              updated_at: '2026-05-22T10:00:00.000Z',
                            },
                          ],
                          error: null,
                        });
                      }
                      return new Promise(() => {});
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    dataOpsReadQueryTimeoutMs: 25,
    dataOpsReadCacheTtlMs: 1,
    now: () => new Date(nowMs),
    logger: { error: () => {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  const first = await store.listCustomers();
  nowMs += 10;
  const second = await store.listCustomers({
    suppressReadFailureCooldown: true,
    suppressStaleReadCacheLog: true,
    suppressTransientReadFailureLog: true,
  });

  assert.equal(readCalls, 2);
  assert.equal(first[0].bedrijf, 'Softora');
  assert.equal(second[0].bedrijf, 'Softora');
  assert.equal(warnings.length, 0);
});

test('data ops store saves webdesign and device mockup as one photo record', async () => {
  const uploads = [];
  const upserts = [];
  const client = {
    storage: {
      getBucket: async () => ({ data: { name: 'softora-design-photos' }, error: null }),
      createBucket: async () => ({ data: null, error: null }),
      from(bucket) {
        return {
          upload: async (path, buffer, options) => {
            uploads.push({
              bucket,
              path,
              byteLength: buffer.length,
              cacheControl: options.cacheControl,
              contentType: options.contentType,
            });
            return { data: { path }, error: null };
          },
        };
      },
    },
    from(table) {
      return {
        upsert: async (row, options) => {
          upserts.push({ table, row, options });
          return { data: [row], error: null };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const result = await store.uploadDesignPhoto(
    {
      customerId: 'softora-test-mode-recipient',
      identityKey: 'softora testmodus|serve|31000000000',
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      fileName: 'softora.nl-webdesign.png',
      mockup: 'data:image/jpeg;base64,bW9ja3Vw',
      websiteMockupName: 'softora.nl-device-mockup-v11.jpg',
      legacyMeta: {
        websitePhotoName: 'softora.nl-webdesign.png',
        mockup: {
          renderer: 'softora-server-device-v7',
          orientation: 'upright',
          qualityStatus: 'checked',
          qualityCheckedAt: '2026-05-28T23:00:00.000Z',
        },
      },
    },
    { source: 'premium-database-webdesign-jobs' }
  );

  assert.equal(result.ok, true);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].cacheControl, '31536000');
  assert.equal(uploads[1].cacheControl, '31536000');
  assert.equal(uploads[0].contentType, 'image/png');
  assert.equal(uploads[1].contentType, 'image/jpeg');
  assert.match(uploads[1].path, /mockup\.jpg$/);
  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].table, 'softora_design_photos');
  assert.equal(upserts[0].row.customer_id, 'softora-test-mode-recipient');
  assert.equal(upserts[0].row.file_name, 'softora.nl-webdesign.png');
  assert.equal(upserts[0].row.legacy_meta.websiteMockupName, 'softora.nl-device-mockup-v11.jpg');
  assert.equal(upserts[0].row.legacy_meta.mockup.fileName, 'softora.nl-device-mockup-v11.jpg');
  assert.equal(upserts[0].row.legacy_meta.mockup.storageBucket, 'softora-design-photos');
  assert.equal(upserts[0].row.legacy_meta.mockup.mimeType, 'image/jpeg');
  assert.equal(upserts[0].row.legacy_meta.mockup.renderer, 'softora-browser-device-v11');
  assert.equal(upserts[0].row.legacy_meta.mockup.orientation, 'upright');
  assert.equal(upserts[0].row.legacy_meta.mockup.qualityStatus, 'checked');
  assert.match(upserts[0].row.legacy_meta.mockup.qualityCheckedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('data ops store signs design photo URLs in storage batches', async () => {
  const rows = Array.from({ length: 18 }, (_item, index) => ({
    customer_id: `customer-${index + 1}`,
    identity_key: `company ${index + 1}|contact|310000000${index}`,
    storage_bucket: 'softora-design-photos',
    storage_path: `customers/customer-${index + 1}/webdesign.png`,
    mime_type: 'image/png',
    file_name: `webdesign-${index + 1}.png`,
    legacy_meta: {
      mockup: {
        storageBucket: 'softora-design-photos',
        storagePath: `customers/customer-${index + 1}/mockup.jpg`,
        fileName: `mockup-${index + 1}.jpg`,
      },
    },
    updated_at: '2026-05-26T12:00:00.000Z',
  }));
  let bulkCalls = 0;
  let singleCalls = 0;
  const signedPaths = [];
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, expiresInSeconds) {
            bulkCalls += 1;
            signedPaths.push(...paths.map((path) => ({ bucket, path, expiresInSeconds })));
            return {
              data: paths.map((path) => ({
                path,
                signedUrl: `https://storage.example.test/${bucket}/${path}`,
              })),
              error: null,
            };
          },
          async createSignedUrl(path) {
            singleCalls += 1;
            signedPaths.push({ bucket, path });
            return {
              data: { signedUrl: `https://storage.example.test/${bucket}/${path}` },
              error: null,
            };
          },
        };
      },
    },
    from(table) {
      assert.equal(table, 'softora_design_photos');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    limit(limit) {
                      assert.equal(limit, 500);
                      return Promise.resolve({ data: rows, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const entries = await store.listDesignPhotosWithSignedUrls({ expiresInSeconds: 120 });

  assert.equal(entries.length, rows.length);
  assert.equal(signedPaths.length, rows.length * 2);
  assert.equal(bulkCalls, 1);
  assert.equal(singleCalls, 0);
  assert.equal(entries.every((entry) => entry.websitePhotoUrl.startsWith('https://')), true);
  assert.equal(entries.every((entry) => entry.websiteMockupUrl.startsWith('https://')), true);
});

test('data ops store signs only matching design photo rows for targeted preview lookups', async () => {
  const rows = [
    {
      customer_id: 'customer-nope',
      identity_key: 'ander bedrijf||3100000000',
      storage_bucket: 'softora-design-photos',
      storage_path: 'customers/customer-nope/webdesign.png',
      mime_type: 'image/png',
      file_name: 'anderbedrijf.nl-webdesign.png',
      legacy_meta: {
        mockup: {
          storageBucket: 'softora-design-photos',
          storagePath: 'customers/customer-nope/mockup.jpg',
          fileName: 'anderbedrijf-device-mockup-v8.jpg',
        },
      },
      updated_at: '2026-05-26T12:00:00.000Z',
    },
    {
      customer_id: 'manual-import-rvh-nl-0123',
      identity_key: 'r vh montage constructie reparatie||0612345678',
      storage_bucket: 'softora-design-photos',
      storage_path: 'customers/manual-import-rvh/webdesign.png',
      mime_type: 'image/png',
      file_name: 'rvhmontage.nl-webdesign.png',
      legacy_meta: {
        websitePhotoName: 'rvhmontage.nl-webdesign.png',
        mockup: {
          storageBucket: 'softora-design-photos',
          storagePath: 'customers/manual-import-rvh/mockup.jpg',
          fileName: 'rvhmontage.nl-device-mockup-v8.jpg',
        },
      },
      updated_at: '2026-05-26T12:01:00.000Z',
    },
  ];
  const signedPaths = [];
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path) {
            signedPaths.push({ bucket, path });
            return {
              data: { signedUrl: `https://storage.example.test/${bucket}/${path}` },
              error: null,
            };
          },
        };
      },
    },
    from(table) {
      assert.equal(table, 'softora_design_photos');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    limit(limit) {
                      assert.equal(limit, 500);
                      return Promise.resolve({ data: rows, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const entries = await store.listDesignPhotosWithSignedUrls({
    identifiers: ['r-vh-montage-constructie-reparatie'],
    expiresInSeconds: 24 * 60 * 60,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].customerId, 'manual-import-rvh-nl-0123');
  assert.deepEqual(
    signedPaths.map((item) => item.path),
    ['customers/manual-import-rvh/webdesign.png', 'customers/manual-import-rvh/mockup.jpg']
  );
  assert.equal(entries.targetedIdentifiersApplied, true);
});

test('data ops store reuses fresh signed design photo URLs per storage path', async () => {
  const rows = [{
    customer_id: 'customer-1',
    identity_key: 'company|contact|3100000000',
    storage_bucket: 'softora-design-photos',
    storage_path: 'customers/customer-1/webdesign.png',
    mime_type: 'image/png',
    file_name: 'webdesign.png',
    legacy_meta: {
      mockup: {
        storageBucket: 'softora-design-photos',
        storagePath: 'customers/customer-1/mockup.jpg',
        fileName: 'mockup.jpg',
      },
    },
    updated_at: '2026-05-26T12:00:00.000Z',
  }];
  let signCount = 0;
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path, expiresInSeconds) {
            signCount += 1;
            return {
              data: { signedUrl: `https://storage.example.test/${bucket}/${path}?signed=${signCount}&ttl=${expiresInSeconds}` },
              error: null,
            };
          },
        };
      },
    },
    from(table) {
      assert.equal(table, 'softora_design_photos');
      return {
        select() {
          return {
            is() {
              return {
                order() {
                  return {
                    limit(limit) {
                      assert.equal(limit, 500);
                      return Promise.resolve({ data: rows, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const first = await store.listDesignPhotosWithSignedUrls({ expiresInSeconds: 600 });
  const second = await store.listDesignPhotosWithSignedUrls({ expiresInSeconds: 600 });

  assert.equal(signCount, 2);
  assert.equal(first[0].websitePhotoUrl, second[0].websitePhotoUrl);
  assert.equal(first[0].websiteMockupUrl, second[0].websiteMockupUrl);
});
