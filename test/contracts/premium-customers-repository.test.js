const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DEFAULT_CUSTOMER_KEY,
  DEFAULT_CUSTOMER_LIST_LIMIT,
  DEFAULT_CUSTOMER_SCOPE,
  CUSTOMER_SORT_FIELDS,
  MAX_CUSTOMER_LIST_LIMIT,
  MAX_CUSTOMER_FIELD_KEY_LENGTH,
  MAX_CUSTOMER_FIELD_VALUE_LENGTH,
  MAX_CUSTOMER_ROWS,
  bulkUpsertCustomerRows,
  createPremiumCustomersRepository,
  customerRowMatchesQuery,
  filterCustomerRows,
  findCustomerByIdentity,
  findCustomerIndexByIdentity,
  getCustomerIdentityKey,
  mergeCustomerRows,
  normalizeCustomerDatabaseStatus,
  normalizeCustomerCompanyName,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  normalizeCustomerRows,
  normalizeCustomerWebsite,
  parseCustomerListOptions,
  parseCustomerRows,
  removeCustomerFromRows,
  sanitizeCustomerFieldValue,
  selectCustomerRows,
  sortCustomerRows,
  summarizeCustomerRows,
  stringifyCustomerRows,
  updateCustomerStatusInRows,
} = require('../../server/repositories/premium-customers-repository');

test('premium customers repository reads customers from the existing ui-state scope', async () => {
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async (scope) => {
      assert.equal(scope, DEFAULT_CUSTOMER_SCOPE);
      return {
        values: {
          [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
            { id: 'cust-1', bedrijf: 'Softora', databaseStatus: 'klant' },
            { id: 'cust-2', bedrijf: 'Demo BV', databaseStatus: 'afspraak' },
          ]),
        },
        source: 'supabase',
        updatedAt: '2026-04-28T10:00:00.000Z',
      };
    },
  });

  const result = await repository.listCustomers();

  assert.equal(result.scope, DEFAULT_CUSTOMER_SCOPE);
  assert.equal(result.key, DEFAULT_CUSTOMER_KEY);
  assert.equal(result.source, 'supabase');
  assert.equal(result.updatedAt, '2026-04-28T10:00:00.000Z');
  assert.equal(result.count, 2);
  assert.deepEqual(result.rows[0], { id: 'cust-1', bedrijf: 'Softora', databaseStatus: 'klant' });
});

test('premium customers repository keeps malformed customer json safe and empty', async () => {
  const errors = [];
  const repository = createPremiumCustomersRepository({
    logger: {
      error: (...args) => errors.push(args),
    },
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: '{not-json',
      },
      source: 'memory',
    }),
  });

  const result = await repository.listCustomers();

  assert.equal(result.count, 0);
  assert.deepEqual(result.rows, []);
  assert.equal(result.source, 'memory');
  assert.equal(errors.length, 1);
});

test('premium customers repository supports filtered and paged reads without exposing raw storage', async () => {
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'customer-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'klant' },
          { id: 'customer-2', bedrijf: 'Demo', telefoon: '+31 6 11 22 33 44', databaseStatus: 'klant' },
          { id: 'customer-3', bedrijf: 'Afspraak BV', databaseStatus: 'afspraak' },
        ]),
      },
      source: 'supabase',
    }),
  });

  const result = await repository.listCustomers({
    status: 'klant',
    query: 'softora',
    limit: 1,
    offset: 0,
  });

  assert.equal(result.count, 1);
  assert.equal(result.total, 1);
  assert.equal(result.limit, 1);
  assert.equal(result.offset, 0);
  assert.deepEqual(result.rows, [
    { id: 'customer-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'klant' },
  ]);
});

test('premium customers repository supports stable sorted reads', async () => {
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'customer-1', bedrijf: 'Zebra BV', databaseStatus: 'klant' },
          { id: 'customer-2', bedrijf: 'Alpha BV', databaseStatus: 'afspraak' },
          { id: 'customer-3', bedrijf: 'Demo BV', databaseStatus: 'gemaild' },
        ]),
      },
      source: 'supabase',
    }),
  });

  const result = await repository.listCustomers({
    sortBy: 'bedrijf',
    sortDirection: 'asc',
    limit: 2,
  });

  assert.deepEqual(
    result.rows.map((row) => row.bedrijf),
    ['Alpha BV', 'Demo BV']
  );
  assert.equal(result.count, 2);
  assert.equal(result.total, 3);
});

test('premium customers repository writes customers through the existing ui-state scope', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-04-28T11:00:00.000Z',
      };
    },
  });

  const rows = [
    { id: 'cust-1', bedrijf: 'Softora', databaseStatus: 'klant' },
    null,
    { id: 'cust-2', bedrijf: 'Demo BV', databaseStatus: 'afspraak' },
  ];
  const result = await repository.saveCustomers(rows, { actor: 'contract-test' });

  assert.equal(result.ok, true);
  assert.equal(result.count, 2);
  assert.equal(result.source, 'supabase');
  assert.equal(result.updatedAt, '2026-04-28T11:00:00.000Z');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].scope, DEFAULT_CUSTOMER_SCOPE);
  assert.equal(writes[0].meta.source, 'premium-customers-repository');
  assert.equal(writes[0].meta.actor, 'contract-test');
  assert.deepEqual(JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]), [
    { id: 'cust-1', bedrijf: 'Softora', databaseStatus: 'klant' },
    { id: 'cust-2', bedrijf: 'Demo BV', databaseStatus: 'afspraak' },
  ]);
});

test('premium customers repository merges customers by stable business identity', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'old-1', bedrijf: 'Softora BV', telefoon: '+31 6 12 34 56 78', databaseStatus: 'afspraak' },
          { id: 'old-2', bedrijf: 'Los bedrijf' },
        ]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-04-28T12:00:00.000Z' };
    },
  });

  const result = await repository.mergeCustomers(
    [
      { id: 'new-1', bedrijf: 'Softora B.V.', telefoon: '0612345678', databaseStatus: 'klant' },
      { id: 'new-2', bedrijf: 'Nieuw bedrijf', website: 'https://www.nieuwbedrijf.nl/contact' },
    ],
    { actor: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.count, 3);
  assert.equal(writes.length, 1);

  const savedRows = JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]);
  assert.deepEqual(savedRows[0], {
    id: 'new-1',
    bedrijf: 'Softora B.V.',
    telefoon: '0612345678',
    databaseStatus: 'klant',
  });
  assert.deepEqual(savedRows[1], { id: 'old-2', bedrijf: 'Los bedrijf' });
  assert.deepEqual(savedRows[2], {
    id: 'new-2',
    bedrijf: 'Nieuw bedrijf',
    website: 'https://www.nieuwbedrijf.nl/contact',
  });
});

test('premium customers repository upserts a single customer by identity', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'afspraak' },
          { id: 'existing-2', bedrijf: 'Demo' },
        ]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-04-28T13:00:00.000Z' };
    },
  });

  const result = await repository.upsertCustomer(
    { id: 'incoming-1', bedrijf: 'Softora Nieuw', email: 'INFO@SOFTORA.NL', databaseStatus: 'klant' },
    { actor: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.matched, true);
  assert.equal(result.identityKey, 'email:info@softora.nl');
  assert.equal(result.count, 2);
  assert.equal(writes.length, 1);

  const savedRows = JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]);
  assert.deepEqual(savedRows[0], {
    id: 'incoming-1',
    bedrijf: 'Softora Nieuw',
    email: 'INFO@SOFTORA.NL',
    databaseStatus: 'klant',
  });
  assert.deepEqual(savedRows[1], { id: 'existing-2', bedrijf: 'Demo' });
});

test('premium customers repository bulk-upserts imports with added, updated and skipped counts', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'afspraak' },
          { id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' },
        ]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-04-28T17:00:00.000Z' };
    },
  });

  const result = await repository.bulkUpsertCustomers(
    [
      { id: 'incoming-1', bedrijf: 'Softora Nieuw', email: 'INFO@SOFTORA.NL', databaseStatus: 'klant' },
      { id: 'incoming-2', bedrijf: 'Nieuw bedrijf', website: 'https://nieuw.example.nl' },
    ],
    { actor: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.added, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.skipped, 0);
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.changes.map((change) => change.type),
    ['updated', 'added']
  );
  assert.equal(writes.length, 1);

  const savedRows = JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]);
  assert.deepEqual(savedRows[0], {
    id: 'incoming-1',
    bedrijf: 'Softora Nieuw',
    email: 'INFO@SOFTORA.NL',
    databaseStatus: 'klant',
  });
  assert.deepEqual(savedRows[2], {
    id: 'incoming-2',
    bedrijf: 'Nieuw bedrijf',
    website: 'https://nieuw.example.nl',
  });
});

test('premium customers repository can find a customer by identity without exposing storage details', async () => {
  const rows = [
    { id: 'existing-1', bedrijf: 'Softora', telefoon: '+31 6 12 34 56 78' },
    { id: 'existing-2', bedrijf: 'Demo' },
  ];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify(rows),
      },
      source: 'supabase',
    }),
  });

  assert.equal(findCustomerIndexByIdentity(rows, { telefoon: '0612345678' }), 0);
  assert.deepEqual(findCustomerByIdentity(rows, 'phone:0612345678'), rows[0]);
  assert.deepEqual(await repository.findCustomerByIdentity({ telefoon: '0612345678' }), rows[0]);
});

test('premium customers repository updates lifecycle status by identity', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'existing-1', bedrijf: 'Softora', telefoon: '+31 6 12 34 56 78', databaseStatus: 'afspraak' },
          { id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' },
        ]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-04-28T14:00:00.000Z' };
    },
  });

  const result = await repository.updateCustomerStatus(
    { telefoon: '0612345678' },
    'No deal na afspraak',
    { actor: 'contract-test' }
  );

  assert.equal(result.ok, true);
  assert.equal(result.matched, true);
  assert.equal(result.identityKey, 'phone:0612345678');
  assert.equal(result.databaseStatus, 'afgehaakt');
  assert.equal(result.count, 2);
  assert.equal(writes.length, 1);

  const savedRows = JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]);
  assert.equal(savedRows[0].databaseStatus, 'afgehaakt');
  assert.equal(savedRows[1].databaseStatus, 'gemaild');
});

test('premium customers repository removes a customer by identity', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'klant' },
          { id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' },
        ]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase', updatedAt: '2026-04-28T16:00:00.000Z' };
    },
  });

  const result = await repository.removeCustomer('email:info@softora.nl', { actor: 'contract-test' });

  assert.equal(result.ok, true);
  assert.equal(result.removed, true);
  assert.equal(result.identityKey, 'email:info@softora.nl');
  assert.deepEqual(result.row, {
    id: 'existing-1',
    bedrijf: 'Softora',
    email: 'info@softora.nl',
    databaseStatus: 'klant',
  });
  assert.equal(result.count, 1);
  assert.equal(writes.length, 1);

  const savedRows = JSON.parse(writes[0].values[DEFAULT_CUSTOMER_KEY]);
  assert.deepEqual(savedRows, [{ id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' }]);
});

test('premium customers repository remove reports misses without writing', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([{ id: 'existing-1', bedrijf: 'Softora' }]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase' };
    },
  });

  const result = await repository.removeCustomer({ email: 'unknown@example.nl' });

  assert.equal(result.ok, false);
  assert.equal(result.removed, false);
  assert.equal(result.identityKey, 'email:unknown@example.nl');
  assert.equal(result.count, 1);
  assert.equal(writes.length, 0);
});

test('premium customers repository summarizes customers for dashboards without exposing storage', async () => {
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([
          { id: 'customer-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'klant' },
          { id: 'customer-2', bedrijf: 'Demo', telefoon: '+31 6 11 22 33 44', databaseStatus: 'afspraak' },
          { id: 'customer-3', databaseStatus: 'No deal na afspraak' },
          { id: 'customer-4' },
        ]),
      },
      source: 'supabase',
      updatedAt: '2026-04-28T15:00:00.000Z',
    }),
  });

  const summary = await repository.summarizeCustomers();

  assert.deepEqual(summary, {
    total: 4,
    statusCounts: {
      klant: 1,
      afspraak: 1,
      afgehaakt: 1,
      onbekend: 1,
    },
    withIdentity: 2,
    withoutIdentity: 2,
    scope: DEFAULT_CUSTOMER_SCOPE,
    key: DEFAULT_CUSTOMER_KEY,
    source: 'supabase',
    updatedAt: '2026-04-28T15:00:00.000Z',
  });
});

test('premium customers repository status update reports misses without writing', async () => {
  const writes = [];
  const repository = createPremiumCustomersRepository({
    getUiStateValues: async () => ({
      values: {
        [DEFAULT_CUSTOMER_KEY]: JSON.stringify([{ id: 'existing-1', bedrijf: 'Softora' }]),
      },
      source: 'supabase',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return { values, source: 'supabase' };
    },
  });

  const result = await repository.updateCustomerStatus({ email: 'unknown@example.nl' }, 'klant');

  assert.equal(result.ok, false);
  assert.equal(result.matched, false);
  assert.equal(result.identityKey, 'email:unknown@example.nl');
  assert.equal(result.databaseStatus, 'klant');
  assert.equal(result.count, 1);
  assert.equal(writes.length, 0);
});

test('premium customers repository normalizes lifecycle statuses conservatively', () => {
  assert.equal(normalizeCustomerDatabaseStatus(' Klant '), 'klant');
  assert.equal(normalizeCustomerDatabaseStatus('No deal na afspraak'), 'afgehaakt');
  assert.equal(normalizeCustomerDatabaseStatus('Gemaild'), 'gemaild');
  assert.equal(normalizeCustomerDatabaseStatus('Terugbellen'), 'terugbellen');
  assert.equal(normalizeCustomerDatabaseStatus(''), '');
});

test('premium customers repository normalizes identity fields for future migrations', () => {
  assert.equal(normalizeCustomerEmail(' INFO@Softora.NL '), 'info@softora.nl');
  assert.equal(normalizeCustomerPhone('+31 6 12 34 56 78'), '0612345678');
  assert.equal(normalizeCustomerPhone('0031-20-1234567'), '0201234567');
  assert.equal(normalizeCustomerWebsite('https://www.softora.nl/contact?ref=test'), 'softora.nl');
  assert.equal(normalizeCustomerCompanyName('Softora & Créusen B.V.'), 'softora en creusen b v');
  assert.equal(getCustomerIdentityKey({ telefoon: '+31 6 12 34 56 78', email: 'other@example.nl' }), 'phone:0612345678');
  assert.equal(getCustomerIdentityKey({ email: 'INFO@Softora.NL' }), 'email:info@softora.nl');
  assert.equal(getCustomerIdentityKey({ website: 'https://www.softora.nl/' }), 'website:softora.nl');
  assert.equal(getCustomerIdentityKey({ bedrijf: 'Softora BV' }), 'company:softora bv');
});

test('premium customers repository merge helper preserves order and lets incoming rows refresh matches', () => {
  const merged = mergeCustomerRows(
    [
      { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'afspraak' },
      { id: 'existing-2', bedrijf: 'Demo' },
    ],
    [
      { id: 'incoming-1', bedrijf: 'Softora Nieuw', email: 'INFO@SOFTORA.NL', databaseStatus: 'klant' },
      { id: 'incoming-2', bedrijf: 'Nieuw' },
    ]
  );

  assert.deepEqual(merged, [
    { id: 'incoming-1', bedrijf: 'Softora Nieuw', email: 'INFO@SOFTORA.NL', databaseStatus: 'klant' },
    { id: 'existing-2', bedrijf: 'Demo' },
    { id: 'incoming-2', bedrijf: 'Nieuw' },
  ]);
});

test('premium customers repository bulk helper skips additions beyond the row limit', () => {
  const existingRows = Array.from({ length: MAX_CUSTOMER_ROWS }, (_item, index) => ({
    id: `existing-${index}`,
    email: `existing-${index}@example.nl`,
  }));

  const result = bulkUpsertCustomerRows(existingRows, [
    { id: 'updated', email: 'existing-0@example.nl', databaseStatus: 'klant' },
    { id: 'new', email: 'new@example.nl' },
  ]);

  assert.equal(result.total, MAX_CUSTOMER_ROWS);
  assert.equal(result.updated, 1);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 1);
  assert.deepEqual(
    result.changes.map((change) => change.type),
    ['updated', 'skipped']
  );
  assert.equal(result.rows[0].id, 'updated');
});

test('premium customers repository status helper updates only the matching row', () => {
  const result = updateCustomerStatusInRows(
    [
      { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'afspraak' },
      { id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' },
    ],
    'email:info@softora.nl',
    'Klant'
  );

  assert.equal(result.updated, true);
  assert.equal(result.identityKey, 'email:info@softora.nl');
  assert.equal(result.databaseStatus, 'klant');
  assert.equal(result.rows[0].databaseStatus, 'klant');
  assert.equal(result.rows[1].databaseStatus, 'gemaild');
});

test('premium customers repository summary helper counts statuses and identity coverage', () => {
  assert.deepEqual(
    summarizeCustomerRows([
      { bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'Klant' },
      { bedrijf: 'Demo', telefoon: '+31 6 11 22 33 44', status: 'Gemaild' },
      { id: 'no-identity', databaseStatus: 'No deal na afspraak' },
      { id: 'unknown-status' },
    ]),
    {
      total: 4,
      statusCounts: {
        klant: 1,
        gemaild: 1,
        afgehaakt: 1,
        onbekend: 1,
      },
      withIdentity: 2,
      withoutIdentity: 2,
    }
  );
});

test('premium customers repository remove helper removes only the matching row', () => {
  const result = removeCustomerFromRows(
    [
      { id: 'existing-1', bedrijf: 'Softora', email: 'info@softora.nl', databaseStatus: 'klant' },
      { id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' },
    ],
    { email: 'INFO@SOFTORA.NL' }
  );

  assert.equal(result.removed, true);
  assert.equal(result.identityKey, 'email:info@softora.nl');
  assert.deepEqual(result.row, {
    id: 'existing-1',
    bedrijf: 'Softora',
    email: 'info@softora.nl',
    databaseStatus: 'klant',
  });
  assert.deepEqual(result.rows, [{ id: 'existing-2', bedrijf: 'Demo', databaseStatus: 'gemaild' }]);
});

test('premium customers repository selection helpers filter by status, query and pagination', () => {
  const rows = [
    { id: 'customer-1', bedrijf: 'Softora', telefoon: '+31 6 12 34 56 78', databaseStatus: 'klant' },
    { id: 'customer-2', bedrijf: 'Demo', telefoon: '+31 6 11 22 33 44', databaseStatus: 'klant' },
    { id: 'customer-3', bedrijf: 'Afspraak BV', databaseStatus: 'afspraak' },
  ];

  assert.equal(customerRowMatchesQuery(rows[0], '0612345678'), true);
  assert.deepEqual(filterCustomerRows(rows, { status: 'klant' }), [rows[0], rows[1]]);
  assert.deepEqual(selectCustomerRows(rows, { status: 'klant', limit: 1, offset: 1 }), {
    rows: [rows[1]],
    count: 1,
    total: 2,
    limit: 1,
    offset: 1,
  });
});

test('premium customers repository sorting helpers keep deterministic order', () => {
  const rows = [
    { id: 'customer-1', bedrijf: 'Zebra BV', databaseStatus: 'klant' },
    { id: 'customer-2', bedrijf: 'Alpha BV', databaseStatus: 'afspraak' },
    { id: 'customer-3', bedrijf: 'Alpha BV', databaseStatus: 'gemaild' },
  ];

  assert.deepEqual(
    sortCustomerRows(rows, { sortBy: 'bedrijf' }).map((row) => row.id),
    ['customer-2', 'customer-3', 'customer-1']
  );
  assert.deepEqual(
    sortCustomerRows(rows, { sortBy: 'status', sortDirection: 'desc' }).map((row) => row.databaseStatus),
    ['klant', 'gemaild', 'afspraak']
  );
  assert.ok(CUSTOMER_SORT_FIELDS.bedrijf.includes('bedrijf'));
});

test('premium customers repository list options clamp unsafe limits', () => {
  assert.deepEqual(parseCustomerListOptions({ status: 'Klant', query: ' Softora ', limit: 999999, offset: -5 }), {
    status: 'klant',
    query: 'Softora',
    limit: MAX_CUSTOMER_LIST_LIMIT,
    offset: 0,
    sortBy: '',
    sortDirection: 'asc',
  });
  assert.equal(parseCustomerListOptions({ limit: 'bad' }).limit, DEFAULT_CUSTOMER_LIST_LIMIT);
  assert.equal(parseCustomerListOptions({}).limit, null);
  assert.equal(parseCustomerListOptions({ sortBy: 'bedrijf', sortDirection: 'desc' }).sortBy, 'bedrijf');
  assert.equal(parseCustomerListOptions({ sortBy: 'unknown' }).sortBy, '');
});

test('premium customers repository sanitizes rows before persistence', () => {
  const longKey = `x${'a'.repeat(MAX_CUSTOMER_FIELD_KEY_LENGTH + 10)}`;
  const longValue = 'v'.repeat(MAX_CUSTOMER_FIELD_VALUE_LENGTH + 10);
  const rows = normalizeCustomerRows([
    {
      [longKey]: longValue,
      keepNumber: 42,
      keepBoolean: true,
      unsafeNumber: Number.POSITIVE_INFINITY,
      nested: { ok: true },
      empty: null,
      skip: undefined,
      status: 'Klant',
    },
  ]);

  const truncatedKey = longKey.slice(0, MAX_CUSTOMER_FIELD_KEY_LENGTH);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][truncatedKey].length, MAX_CUSTOMER_FIELD_VALUE_LENGTH);
  assert.equal(rows[0].keepNumber, 42);
  assert.equal(rows[0].keepBoolean, true);
  assert.equal(rows[0].unsafeNumber, '');
  assert.equal(rows[0].nested, '{"ok":true}');
  assert.equal(rows[0].empty, '');
  assert.equal(Object.prototype.hasOwnProperty.call(rows[0], 'skip'), false);
  assert.equal(rows[0].databaseStatus, 'klant');
});

test('premium customers repository clamps large customer lists', () => {
  const rows = Array.from({ length: MAX_CUSTOMER_ROWS + 5 }, (_item, index) => ({ id: `customer-${index}` }));
  assert.equal(normalizeCustomerRows(rows).length, MAX_CUSTOMER_ROWS);
  assert.equal(parseCustomerRows(JSON.stringify(rows)).length, MAX_CUSTOMER_ROWS);
});

test('premium customers repository sanitizes individual field values safely', () => {
  assert.equal(sanitizeCustomerFieldValue(undefined), undefined);
  assert.equal(sanitizeCustomerFieldValue(null), '');
  assert.equal(sanitizeCustomerFieldValue(Number.NaN), '');
  assert.equal(sanitizeCustomerFieldValue({ nested: true }), '{"nested":true}');
});

test('premium customers repository helpers preserve plain customer rows only', () => {
  assert.deepEqual(parseCustomerRows([{ id: 'a', status: 'Klant' }, null, 'bad', { id: 'b' }]), [
    { id: 'a', status: 'Klant', databaseStatus: 'klant' },
    { id: 'b' },
  ]);
  assert.equal(stringifyCustomerRows([{ id: 'a' }, null, 'bad', { id: 'b' }]), '[{"id":"a"},{"id":"b"}]');
});

test('premium customers repository appends bounded status history entries', () => {
  const {
    appendCustomerStatusHistory,
    buildCustomerStatusHistoryEntry,
  } = require('../../server/repositories/premium-customers-repository');

  const entry = buildCustomerStatusHistoryEntry('klant', {
    actor: 'Serve',
    source: 'agenda-post-call',
    date: '2026-04-28T12:00:00.000Z',
  });

  assert.deepEqual(entry, {
    type: 'klant',
    label: 'Klant',
    date: '2026-04-28T12:00:00.000Z',
    actor: 'Serve',
    source: 'agenda-post-call',
  });

  const updated = appendCustomerStatusHistory(
    {
      id: 'customer-1',
      bedrijf: 'Softora',
      databaseStatus: 'afspraak',
      hist: Array.from({ length: 25 }, (_, index) => ({
        type: 'afspraak',
        label: 'Afspraak',
        date: `2026-04-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
      })),
    },
    'no deal',
    {
      actor: 'Serve',
      source: 'agenda-post-call',
      date: '2026-04-28T13:00:00.000Z',
    }
  );

  assert.equal(updated.databaseStatus, 'afgehaakt');
  assert.equal(updated.hist.length, 20);
  assert.equal(updated.hist.at(-1).type, 'afgehaakt');
  assert.equal(updated.hist.at(-1).actor, 'Serve');
  assert.equal(updated.hist.at(-1).source, 'agenda-post-call');
});

test('premium customers repository updates customer status with history by identity', () => {
  const {
    updateCustomerStatusWithHistoryInRows,
  } = require('../../server/repositories/premium-customers-repository');

  const result = updateCustomerStatusWithHistoryInRows(
    [
      {
        id: 'customer-1',
        bedrijf: 'Softora',
        telefoon: '+31 6 12 34 56 78',
        databaseStatus: 'afspraak',
        hist: Array.from({ length: 21 }, (_item, index) => ({
          type: 'afspraak',
          label: 'Afspraak',
          date: `2026-04-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
        })),
      },
    ],
    { telefoon: '0612345678' },
    'customer',
    {
      actor: 'Serve',
      source: 'repository-contract',
      date: '2026-04-28T14:00:00.000Z',
    }
  );

  assert.equal(result.updated, true);
  assert.equal(result.index, 0);
  assert.equal(result.status, 'klant');
  assert.equal(result.customer.databaseStatus, 'klant');
  assert.equal(result.customer.hist.length, 20);
  assert.equal(result.customer.hist.at(-1).type, 'klant');
  assert.equal(result.customer.hist.at(-1).actor, 'Serve');
  assert.equal(result.rows[0].databaseStatus, 'klant');

  const missed = updateCustomerStatusWithHistoryInRows(result.rows, { email: 'missing@example.test' }, 'klant');
  assert.equal(missed.updated, false);
  assert.equal(missed.customer, null);
  assert.equal(missed.rows[0].databaseStatus, 'klant');
});

test('premium customer status update helper keeps source rows immutable on updates and misses', () => {
  const { updateCustomerStatusWithHistoryInRows } = require('../../server/repositories/premium-customers-repository');

  const sourceRows = [
    {
      bedrijfsnaam: 'Immutable BV',
      naam: 'Ima Mutabel',
      email: 'ima@example.nl',
      telefoon: '06 11 22 33 44',
      status: 'lead',
      databaseStatus: 'lead',
      hist: [
        {
          type: 'lead',
          label: 'Lead',
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ];
  const originalSnapshot = JSON.stringify(sourceRows);

  const updated = updateCustomerStatusWithHistoryInRows(
    sourceRows,
    { telefoon: '06 11 22 33 44' },
    'customer',
    { at: '2026-02-01T00:00:00.000Z', source: 'contract-test' }
  );

  assert.equal(JSON.stringify(sourceRows), originalSnapshot);
  assert.equal(updated.updated, true);
  assert.notEqual(updated.rows, sourceRows);
  assert.notEqual(updated.rows[0], sourceRows[0]);
  assert.equal(sourceRows[0].databaseStatus, 'lead');
  assert.equal(updated.rows[0].databaseStatus, 'klant');

  const missed = updateCustomerStatusWithHistoryInRows(sourceRows, { telefoon: '06 00 00 00 00' }, 'customer');

  assert.equal(missed.updated, false);
  assert.equal(JSON.stringify(sourceRows), originalSnapshot);
});

test('premium customer status update helper refuses invalid statuses without mutating source rows', () => {
  const { updateCustomerStatusWithHistoryInRows } = require('../../server/repositories/premium-customers-repository');

  const sourceRows = [
    {
      bedrijfsnaam: 'Safe Status BV',
      naam: 'Sanne Status',
      telefoon: '06 22 33 44 55',
      status: 'lead',
      databaseStatus: 'lead',
      hist: [
        {
          type: 'lead',
          label: 'Lead',
          at: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ];
  const originalSnapshot = JSON.stringify(sourceRows);

  const rejected = updateCustomerStatusWithHistoryInRows(
    sourceRows,
    { telefoon: '06 22 33 44 55' },
    '   ',
    { at: '2026-02-01T00:00:00.000Z', source: 'contract-test' }
  );

  assert.equal(rejected.updated, false);
  assert.equal(rejected.status, '');
  assert.equal(rejected.index, -1);
  assert.equal(rejected.customer, null);
  assert.equal(JSON.stringify(sourceRows), originalSnapshot);
});

test('premium customer status update helper handles empty row input safely', () => {
  const { updateCustomerStatusWithHistoryInRows } = require('../../server/repositories/premium-customers-repository');

  const emptyResult = updateCustomerStatusWithHistoryInRows(
    null,
    { telefoon: '06 33 44 55 66' },
    'customer',
    { at: '2026-03-01T00:00:00.000Z', source: 'contract-test' }
  );

  assert.deepEqual(emptyResult.rows, []);
  assert.equal(emptyResult.updated, false);
  assert.equal(emptyResult.status, 'klant');
  assert.equal(emptyResult.index, -1);
  assert.equal(emptyResult.customer, null);

  const nonArrayResult = updateCustomerStatusWithHistoryInRows(
    { telefoon: '06 33 44 55 66', databaseStatus: 'lead' },
    { telefoon: '06 33 44 55 66' },
    'customer'
  );

  assert.deepEqual(nonArrayResult.rows, []);
  assert.equal(nonArrayResult.updated, false);
  assert.equal(nonArrayResult.status, 'klant');
  assert.equal(nonArrayResult.customer, null);
});
