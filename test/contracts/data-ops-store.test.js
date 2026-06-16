const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSoftoraDataOpsStore } = require('../../server/services/data-ops-store');

test('data ops store restores large premium database webdesign job queues', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/services/data-ops-store.js'), 'utf8');

  assert.match(
    source,
    /async function listVisibleWebdesignJobs\(ownerKey\)[\s\S]*\.in\('status', \['queued', 'running'\]\)[\s\S]*\.limit\(5000\)/
  );
  assert.match(
    source,
    /async function listRunnableWebdesignBatches\(limit = 5\)[\s\S]*\.eq\('customer_id', WEBDESIGN_BATCH_CUSTOMER_ID\)[\s\S]*\.eq\('status', 'running'\)[\s\S]*\.order\('updated_at', \{ ascending: true \}\)[\s\S]*\.limit\(safeLimit\)/
  );
  assert.match(
    source,
    /async function listVisibleWebdesignBatches\(ownerKey\)[\s\S]*\.in\('status', \['queued', 'running', 'done', 'error'\]\)/
  );
  assert.match(source, /function getWebdesignBatchTableStatus\(status\)[\s\S]*return normalized === 'cancelled' \? 'error' : normalized;/);
  assert.match(source, /status,\s*total: Math\.max/);
});

test('data ops store saves cancelled webdesign batches with a table-compatible status', async () => {
  const upsertRows = [];
  const client = {
    from(table) {
      return {
        upsert(row) {
          upsertRows.push({ table, row });
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const result = await store.upsertWebdesignBatch({
    id: 'webdesign_batch_cancelled',
    ownerKey: 'owner',
    status: 'cancelled',
    total: 10,
    summary: { total: 10, done: 3, cancelled: 7 },
  });

  assert.equal(result.ok, true);
  assert.equal(upsertRows.length, 1);
  assert.equal(upsertRows[0].table, 'softora_webdesign_jobs');
  assert.equal(upsertRows[0].row.status, 'error');
  assert.equal(upsertRows[0].row.payload.batch.status, 'cancelled');
  assert.equal(upsertRows[0].row.payload.batch.summary.cancelled, 7);
});

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

function createSupabaseCustomerGuardRecorder(options = {}) {
  const currentCustomerIds = Array.isArray(options.currentCustomerIds) ? options.currentCustomerIds : [];
  const existingGuardKeys = new Set(Array.isArray(options.existingGuardKeys) ? options.existingGuardKeys : []);
  const recorder = {
    upsertRows: [],
    deletedIds: [],
    insertedGuardRows: [],
    events: [],
  };
  const client = {
    from(table) {
      if (table === 'softora_outbound_recipient_guards') {
        return {
          select(column) {
            return {
              in(_column, keys) {
                const idColumn = String(column || 'guard_key');
                return Promise.resolve({
                  data: (Array.isArray(keys) ? keys : [])
                    .filter((key) => existingGuardKeys.has(key))
                    .map((key) => ({ [idColumn]: key })),
                  error: null,
                });
              },
            };
          },
          insert(rows) {
            return {
              select(column) {
                recorder.events.push('insert-guards');
                if (options.insertGuardError) {
                  return Promise.resolve({ data: null, error: options.insertGuardError });
                }
                const inserted = Array.isArray(rows) ? rows : [rows];
                recorder.insertedGuardRows.push(...inserted);
                inserted.forEach((row) => existingGuardKeys.add(row.guard_key));
                const idColumn = String(column || 'guard_key');
                return Promise.resolve({
                  data: inserted.map((row) => ({ [idColumn]: row.guard_key })),
                  error: null,
                });
              },
            };
          },
        };
      }
      return {
        upsert(rows) {
          if (table === 'softora_customers') {
            recorder.events.push('upsert-customers');
            recorder.upsertRows = rows;
          }
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

test('data ops store chunks outbound recipient guard key lookups conservatively', async () => {
  const chunkSizes = [];
  const statusFilters = [];
  const existingGuardKeys = new Set(['guard-3', 'guard-101', 'guard-240']);
  const client = {
    from(table) {
      assert.equal(table, 'softora_outbound_recipient_guards');
      return {
        select(column) {
          assert.equal(column, 'guard_key');
          return {
            in(filterColumn, values) {
              if (filterColumn === 'guard_key') {
                chunkSizes.push(values.length);
                return {
                  in(statusColumn, statuses) {
                    assert.equal(statusColumn, 'status');
                    statusFilters.push(statuses);
                    return {
                      limit(limit) {
                        assert.equal(limit, values.length);
                        return Promise.resolve({
                          data: values
                            .filter((key) => existingGuardKeys.has(key))
                            .map((key) => ({ guard_key: key })),
                          error: null,
                        });
                      },
                    };
                  },
                };
              }
              throw new Error(`Onverwachte filterkolom: ${filterColumn}`);
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

  const keys = Array.from({ length: 241 }, (_item, index) => `guard-${index}`);
  const found = await store.listOutboundRecipientGuardKeys(keys, {
    bypassReadCache: true,
    suppressTransientReadFailureLog: true,
  });

  assert.deepEqual(chunkSizes, [100, 100, 41]);
  assert.deepEqual(statusFilters, [
    ['sent', 'reserved'],
    ['sent', 'reserved'],
    ['sent', 'reserved'],
  ]);
  assert.deepEqual(found, ['guard-3', 'guard-101', 'guard-240']);
});

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

test('data ops store can soft-delete explicit customer ids without replacing the full customer list', async () => {
  const { client, recorder } = createSupabaseClientRecorder();
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-06-16T12:58:00.000Z'),
    logger: { error: () => {} },
  });

  const result = await store.deleteCustomers(['lead-413'], { source: 'premium-database-delete-lead' });

  assert.equal(result.ok, true);
  assert.deepEqual(recorder.deletedIds, ['lead-413']);
  assert.deepEqual(recorder.upsertRows, []);
});

test('data ops store writes outbound guards before saving sent customers', async () => {
  const { client, recorder } = createSupabaseCustomerGuardRecorder({
    currentCustomerIds: ['lead-1'],
  });
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-06-15T19:00:00.000Z'),
    logger: { error: () => {}, warn: () => {} },
  });

  const result = await store.replaceCustomers(
    [
      {
        id: 'lead-1',
        bedrijf: 'B&B Bij ons in Chaam',
        email: 'info@bij-ons-in-chaam.nl',
        website: 'https://bij-ons-in-chaam.nl',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-06-15T10:15:00.000Z',
        coldmailSentMessageId: 'smtp-message-1',
        lastColdmailSenderEmail: 'serve@softora.nl',
        hist: [{ type: 'gemaild', label: 'Mail verstuurd', date: '2026-06-15' }],
      },
    ],
    { source: 'premium-database', actor: 'Servé' }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(recorder.events, ['insert-guards', 'upsert-customers']);
  assert.equal(recorder.upsertRows.length, 1);
  assert.deepEqual(
    recorder.insertedGuardRows.map((row) => row.guard_key).sort(),
    [
      'company:b-b-bij-ons-in-chaam',
      'domain:bij-ons-in-chaam-nl',
      'email:info@bij-ons-in-chaam.nl',
      'id:lead-1',
    ]
  );
  assert.equal(recorder.insertedGuardRows.every((row) => row.status === 'sent'), true);
  assert.equal(recorder.insertedGuardRows.every((row) => row.permanent === true), true);
  assert.equal(recorder.insertedGuardRows.every((row) => row.provider === 'softora'), true);
  assert.equal(recorder.insertedGuardRows.every((row) => row.channel === 'coldmail'), true);
});

test('data ops store refuses to save sent customers when outbound guards fail', async () => {
  const { client, recorder } = createSupabaseCustomerGuardRecorder({
    currentCustomerIds: ['lead-1'],
    insertGuardError: new Error('guard insert unavailable'),
  });
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-06-15T19:00:00.000Z'),
    logger: { error: () => {}, warn: () => {} },
  });

  const result = await store.replaceCustomers(
    [
      {
        id: 'lead-1',
        bedrijf: 'B&B Bij ons in Chaam',
        email: 'info@bij-ons-in-chaam.nl',
        status: 'gemaild',
        databaseStatus: 'gemaild',
        lastColdmailSentAt: '2026-06-15T10:15:00.000Z',
      },
    ],
    { source: 'premium-database' }
  );

  assert.equal(result.ok, false);
  assert.match(result.error.message, /guard insert unavailable/);
  assert.deepEqual(recorder.events, ['insert-guards']);
  assert.equal(recorder.upsertRows.length, 0);
});

test('data ops store saves customers with write timeout and cooldown bypass', async () => {
  const { client, recorder } = createSupabaseClientRecorder(['lead-1']);
  const clientOptions = [];
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: (options) => {
      clientOptions.push(options);
      return client;
    },
    dataOpsWriteQueryTimeoutMs: 12000,
    now: () => new Date('2026-06-11T12:00:00.000Z'),
    logger: { error: () => {}, warn: () => {} },
  });

  const result = await store.replaceCustomers(
    [
      {
        id: 'lead-1',
        bedrijf: 'Softora',
        naam: 'Servé',
        telefoon: '+31 6 12345678',
      },
    ],
    { source: 'premium-database' }
  );

  assert.equal(result.ok, true);
  assert.equal(recorder.upsertRows.length, 1);
  assert.deepEqual(clientOptions[0], {
    timeoutMs: 12000,
    ignoreFailureCooldown: true,
    suppressFailureCooldown: true,
  });
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

test('data ops store lets public preview reads bypass an active read cooldown', async () => {
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
                      if (readCalls === 1) return new Promise(() => {});
                      return Promise.resolve({
                        data: [{
                          customer_id: 'lead-1',
                          payload: { id: 'lead-1', bedrijf: 'Softora' },
                          updated_at: '2026-06-10T09:00:00.000Z',
                        }],
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
    dataOpsReadQueryTimeoutMs: 25,
    dataOpsReadFailureCooldownMs: 1000,
    logger: { error: () => {}, warn: () => {} },
  });

  const timeout = await store.listCustomers();
  const bypassed = await store.listCustomers({
    bypassReadFailureCooldown: true,
    bypassReadCache: true,
    suppressReadFailureCooldown: true,
    suppressTransientReadFailureLog: true,
  });

  assert.equal(timeout, null);
  assert.equal(readCalls, 2);
  assert.deepEqual(bypassed.map((customer) => customer.id), ['lead-1']);
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
      websiteMockupName: 'softora.nl-device-mockup-v8.jpg',
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
  assert.equal(upserts[0].row.legacy_meta.websiteMockupName, 'softora.nl-device-mockup-v8.jpg');
  assert.equal(upserts[0].row.legacy_meta.mockup.fileName, 'softora.nl-device-mockup-v8.jpg');
  assert.equal(upserts[0].row.legacy_meta.mockup.storageBucket, 'softora-design-photos');
  assert.equal(upserts[0].row.legacy_meta.mockup.mimeType, 'image/jpeg');
  assert.equal(upserts[0].row.legacy_meta.mockup.renderer, 'softora-browser-device-v8');
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

test('data ops store scans up to 1500 design photo rows for full coldmail stock visibility', async () => {
  const rows = Array.from({ length: 1200 }, (_item, index) => {
    const number = index + 1;
    return {
      customer_id: `customer-${number}`,
      identity_key: `bedrijf ${number}|contact|3100000000`,
      storage_bucket: 'softora-design-photos',
      storage_path: `customers/customer-${number}/webdesign.png`,
      mime_type: 'image/png',
      file_name: `bedrijf-${number}-webdesign.png`,
      legacy_meta: {
        mockup: {
          storageBucket: 'softora-design-photos',
          storagePath: `customers/customer-${number}/mockup.jpg`,
          fileName: `bedrijf-${number}-device-mockup-v8.jpg`,
        },
      },
      updated_at: '2026-05-26T12:00:00.000Z',
    };
  });
  const ranges = [];
  const bulkBatchSizes = [];
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths) {
            bulkBatchSizes.push(paths.length);
            return {
              data: paths.map((path) => ({
                path,
                signedUrl: `https://storage.example.test/${bucket}/${path}`,
              })),
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
                    range(from, to) {
                      ranges.push([from, to]);
                      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
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
    logger: { error() {}, warn() {} },
  });

  const entries = await store.listDesignPhotosWithSignedUrls({ expiresInSeconds: 120 });

  assert.equal(entries.length, 1200);
  assert.deepEqual(ranges, [[0, 499], [500, 999], [1000, 1499]]);
  assert.equal(bulkBatchSizes.length, 24);
  assert.equal(bulkBatchSizes.every((size) => size === 100), true);
  assert.equal(entries[1199].customerId, 'customer-1200');
  assert.equal(entries[1199].websiteMockupUrl.startsWith('https://'), true);
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

test('data ops store targets space-separated identity keys for dashed public preview slugs', async () => {
  const matchingRow = {
    customer_id: 'manual-import-riesenhorst-nl-0305',
    identity_key: 'riesenschnauzer kennel de riesenhorst||0612345678',
    storage_bucket: 'softora-design-photos',
    storage_path: 'customers/manual-import-riesenhorst/webdesign.png',
    mime_type: 'image/png',
    file_name: '83cea9e83a7e3a24ac247eed45824525e84429727321c8f6230acff033215692.png',
    legacy_meta: {
      websitePhotoName: '83cea9e83a7e3a24ac247eed45824525e84429727321c8f6230acff033215692.png',
      mockup: {
        storageBucket: 'softora-design-photos',
        storagePath: 'customers/manual-import-riesenhorst/mockup.jpg',
        fileName: '3555bddd319a2ee38e9b9207468ea612987e3434e73a7eeea2c0b5bd1ffc7073-mockup.jpg',
      },
    },
    updated_at: '2026-06-11T09:00:00.000Z',
  };
  const orClauses = [];
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
      const query = {
        orClause: '',
        select() {
          return this;
        },
        is() {
          return this;
        },
        or(clause) {
          this.orClause = clause;
          orClauses.push(clause);
          return this;
        },
        order() {
          return this;
        },
        limit(limit) {
          assert.equal(limit, 100);
          if (!this.orClause) throw new Error('broad design photo scan should not run for dashed identity slugs');
          const matched = this.orClause.includes('identity_key.ilike.%riesenschnauzer kennel de riesenhorst%');
          return Promise.resolve({ data: matched ? [matchingRow] : [], error: null });
        },
      };
      return query;
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {} },
  });

  const entries = await store.listDesignPhotosWithSignedUrls({
    identifiers: ['riesenschnauzer-kennel-de-riesenhorst'],
    expiresInSeconds: 24 * 60 * 60,
  });

  assert.ok(orClauses.some((clause) => clause.includes('identity_key.ilike.%riesenschnauzer kennel de riesenhorst%')));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].customerId, 'manual-import-riesenhorst-nl-0305');
  assert.deepEqual(
    signedPaths.map((item) => item.path),
    ['customers/manual-import-riesenhorst/webdesign.png', 'customers/manual-import-riesenhorst/mockup.jpg']
  );
});

test('data ops store reads exact outbound sender guards before broad public preview fallback', async () => {
  const orClauses = [];
  const statusFilters = [];
  const recipientIdFilters = [];
  const rows = [
    {
      guard_key: 'id:manual-import-idtravel-nl-0245',
      key_type: 'id',
      key_value: 'manual-import-idtravel-nl-0245',
      provider: 'softora',
      channel: 'coldmail',
      sender_email: 'martijn@softora.nl',
      recipient_email: 'info@idtravel.nl',
      recipient_domain: 'idtravel-nl',
      recipient_company_key: 'id-travel-b-v',
      recipient_id: 'manual-import-idtravel-nl-0245',
      recipient_company: 'ID Travel B.V.',
      status: 'sent',
      source: 'softora-coldmail-pre-send',
      actor: 'Coldmail Autopilot Cron',
      permanent: true,
      payload: { bedrijf: 'ID Travel B.V.' },
      created_at: '2026-06-09T17:17:36.739273+00:00',
      updated_at: '2026-06-09T17:17:38.634+00:00',
    },
  ];
  const client = {
    from(table) {
      assert.equal(table, 'softora_outbound_recipient_guards');
      return {
        select(selection) {
          assert.match(selection, /sender_email/);
          const query = {
            in(column, values) {
              if (column === 'recipient_id') recipientIdFilters.push(values);
              if (column === 'status') statusFilters.push([column, values]);
              return this;
            },
            or(clause) {
              orClauses.push(clause);
              return this;
            },
            order(column, options) {
              assert.equal(column, 'updated_at');
              assert.equal(options.ascending, false);
              return this;
            },
            limit(limit) {
              assert.equal(limit, 50);
              return Promise.resolve({ data: rows, error: null });
            },
          };
          return query;
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, warn() {} },
  });

  const guards = await store.listOutboundRecipientGuardsForPreview({
    identifiers: ['idtravelbv', 'manual-import-idtravel-nl-0245', 'https://www.idtravel.nl'],
    maxMatches: 12,
    bypassReadCache: true,
  });

  assert.equal(guards.length, 1);
  assert.equal(guards[0].sender_email, 'martijn@softora.nl');
  assert.deepEqual(recipientIdFilters[0], ['idtravelbv', 'manual-import-idtravel-nl-0245']);
  assert.deepEqual(orClauses, []);
  assert.deepEqual(statusFilters[0], ['status', ['sent', 'reserved']]);
});

test('data ops store falls back to broad outbound sender guard lookup when no exact recipient id exists', async () => {
  const orClauses = [];
  const rows = [
    {
      guard_key: 'domain:idtravel-nl',
      key_type: 'domain',
      key_value: 'idtravel-nl',
      provider: 'softora',
      channel: 'coldmail',
      sender_email: 'martijn@softora.nl',
      recipient_email: 'info@idtravel.nl',
      recipient_domain: 'idtravel-nl',
      recipient_company_key: 'id-travel-b-v',
      recipient_id: 'manual-import-idtravel-nl-0245',
      recipient_company: 'ID Travel B.V.',
      status: 'sent',
      source: 'softora-coldmail-pre-send',
      actor: 'Coldmail Autopilot Cron',
      permanent: true,
      payload: { bedrijf: 'ID Travel B.V.' },
      created_at: '2026-06-09T17:17:36.739273+00:00',
      updated_at: '2026-06-09T17:17:38.634+00:00',
    },
  ];
  let exactRead = true;
  const client = {
    from(table) {
      assert.equal(table, 'softora_outbound_recipient_guards');
      return {
        select() {
          const query = {
            in() {
              return this;
            },
            or(clause) {
              exactRead = false;
              orClauses.push(clause);
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({ data: exactRead ? [] : rows, error: null });
            },
          };
          return query;
        },
      };
    },
  };
  const store = createSoftoraDataOpsStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    logger: { error() {}, warn() {} },
  });

  const guards = await store.listOutboundRecipientGuardsForPreview({
    identifiers: ['idtravelbv', 'https://www.idtravel.nl'],
    maxMatches: 12,
    bypassReadCache: true,
  });

  assert.equal(guards.length, 1);
  assert.equal(guards[0].sender_email, 'martijn@softora.nl');
  assert.ok(orClauses.some((clause) => clause.includes('recipient_domain.eq.idtravel-nl')));
});

test('data ops store matches compact manual-import design photo ids for clean public slugs', async () => {
  const fillerRows = Array.from({ length: 500 }, (_item, index) => ({
    customer_id: `manual-import-other-company-${index + 1}`,
    identity_key: '',
    storage_bucket: 'softora-design-photos',
    storage_path: `customers/manual-import-other-company-${index + 1}/hash.png`,
    mime_type: 'image/png',
    file_name: `other-company-${index + 1}.png`,
    legacy_meta: {},
    updated_at: '2026-05-26T12:02:00.000Z',
  }));
  const rows = [
    ...fillerRows,
    {
      customer_id: 'manual-import-cafeschuttershof-nl-contact-0476',
      identity_key: '',
      storage_bucket: 'softora-design-photos',
      storage_path: 'customers/manual-import-cafeschuttershof-nl-contact-0476/hash.png',
      mime_type: 'image/png',
      file_name: 'hash.png',
      legacy_meta: {
        mockup: {
          storageBucket: 'softora-design-photos',
          storagePath: 'customers/manual-import-cafeschuttershof-nl-contact-0476/hash-mockup.jpg',
          fileName: 'hash-mockup.jpg',
        },
      },
      updated_at: '2026-05-26T12:01:00.000Z',
    },
  ];
  const ranges = [];
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
                    range(from, to) {
                      ranges.push([from, to]);
                      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
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
    identifiers: ['cafe-schuttershof'],
    expiresInSeconds: 24 * 60 * 60,
  });

  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].customerId, 'manual-import-cafeschuttershof-nl-contact-0476');
  assert.deepEqual(
    signedPaths.map((item) => item.path),
    [
      'customers/manual-import-cafeschuttershof-nl-contact-0476/hash.png',
      'customers/manual-import-cafeschuttershof-nl-contact-0476/hash-mockup.jpg',
    ]
  );
});

test('data ops store can bypass stale targeted misses and match BV slug variants', async () => {
  const matchingRow = {
    customer_id: 'manual-import-vangestelsteigerbouw-nl-contact-0420',
    identity_key: '',
    storage_bucket: 'softora-design-photos',
    storage_path: 'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash.png',
    mime_type: 'image/png',
    file_name: 'hash.png',
    legacy_meta: {
      mockup: {
        storageBucket: 'softora-design-photos',
        storagePath: 'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash-mockup.jpg',
        fileName: 'hash-mockup.jpg',
      },
    },
    updated_at: '2026-06-10T09:00:00.000Z',
  };
  let rows = [];
  let tableReads = 0;
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
                    range(from, to) {
                      tableReads += 1;
                      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
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

  const firstMiss = await store.listDesignPhotosWithSignedUrls({
    identifiers: ['van-gestel-steigerbouw-b-v'],
    expiresInSeconds: 24 * 60 * 60,
  });
  rows = [matchingRow];
  const cachedMiss = await store.listDesignPhotosWithSignedUrls({
    identifiers: ['van-gestel-steigerbouw-b-v'],
    expiresInSeconds: 24 * 60 * 60,
  });
  const freshMatch = await store.listDesignPhotosWithSignedUrls({
    identifiers: ['van-gestel-steigerbouw-b-v'],
    expiresInSeconds: 24 * 60 * 60,
    bypassReadCache: true,
  });

  assert.equal(tableReads, 2);
  assert.equal(firstMiss.length, 0);
  assert.equal(cachedMiss.length, 0);
  assert.equal(freshMatch.length, 1);
  assert.equal(freshMatch[0].customerId, 'manual-import-vangestelsteigerbouw-nl-contact-0420');
  assert.deepEqual(
    signedPaths.map((item) => item.path),
    [
      'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash.png',
      'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash-mockup.jpg',
    ]
  );
});

test('data ops store uses compact targeted lookups before broad public preview scans', async () => {
  const matchingRow = {
    customer_id: 'manual-import-vangestelsteigerbouw-nl-contact-0420',
    identity_key: '',
    storage_bucket: 'softora-design-photos',
    storage_path: 'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash.png',
    mime_type: 'image/png',
    file_name: 'hash.png',
    legacy_meta: {
      mockup: {
        storageBucket: 'softora-design-photos',
        storagePath: 'customers/manual-import-vangestelsteigerbouw-nl-contact-0420/hash-mockup.jpg',
        fileName: 'hash-mockup.jpg',
      },
    },
    updated_at: '2026-06-10T09:00:00.000Z',
  };
  const targetedFilters = [];
  let broadPageReads = 0;
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrl(path) {
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
                or(filter) {
                  targetedFilters.push(filter);
                  return {
                    order() {
                      return {
                        limit() {
                          return Promise.resolve({
                            data: /vangestelsteigerbouw/.test(filter) ? [matchingRow] : [],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
                order() {
                  return {
                    range() {
                      broadPageReads += 1;
                      return Promise.resolve({ data: [matchingRow], error: null });
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
    identifiers: ['van-gestel-steigerbouw-b-v'],
    expiresInSeconds: 24 * 60 * 60,
    bypassReadCache: true,
    bypassReadFailureCooldown: true,
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].customerId, 'manual-import-vangestelsteigerbouw-nl-contact-0420');
  assert.equal(broadPageReads, 0);
  assert.ok(targetedFilters.some((filter) => /vangestelsteigerbouw/.test(filter)));
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

test('data ops store passes resilient read policy into Supabase client reads and signed URLs', async () => {
  const clientOptions = [];
  const rows = [{
    customer_id: 'customer-1',
    identity_key: 'bakkerij-zon|ruben|3100000000',
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
  const client = {
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, expiresInSeconds) {
            return {
              data: paths.map((path) => ({
                path,
                signedUrl: `https://storage.example.test/${bucket}/${path}?ttl=${expiresInSeconds}`,
              })),
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
    getSupabaseClient(options) {
      clientOptions.push(options || {});
      return client;
    },
    logger: { error() {} },
  });

  const entries = await store.listDesignPhotosWithSignedUrls({
    expiresInSeconds: 600,
    bypassReadCache: true,
    bypassReadFailureCooldown: true,
    suppressReadFailureCooldown: true,
    suppressTransientReadFailureLog: true,
  });

  assert.equal(entries.length, 1);
  assert.deepEqual(clientOptions, [
    {
      timeoutMs: 6000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    },
    {
      timeoutMs: 6000,
      ignoreFailureCooldown: true,
      suppressFailureCooldown: true,
    },
  ]);
});
