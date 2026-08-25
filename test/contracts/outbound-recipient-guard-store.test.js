const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  HISTORICAL_MAILBOX_LEDGER_GUARD_KEY,
  createOutboundRecipientGuardStore,
} = require('../../server/services/outbound-recipient-guard-store');

function createMockSupabaseClient({ conflictKeys = [], conflictAfterInsert = false, confirmRows = 1 } = {}) {
  const calls = [];
  let conflictCheckCount = 0;
  const conflicts = new Set(conflictKeys);
  const conflictRow = (keys) => {
    const key = keys.find((candidate) => conflicts.has(candidate));
    return key
      ? {
          guard_key: key,
          provider: 'softora',
          channel: 'coldmail',
          recipient_email: 'blocked@example.test',
          permanent: true,
        }
      : null;
  };

  const client = {
    from(table) {
      return {
        delete() {
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push({ column, value });
              return query;
            },
            async lt(column, value) {
              filters.push({ column, value, operator: 'lt' });
              calls.push({ type: 'delete', table, filters: filters.slice() });
              return { error: null };
            },
            then(resolve, reject) {
              calls.push({ type: 'delete', table, filters: filters.slice() });
              return Promise.resolve({ error: null }).then(resolve, reject);
            },
          };
          return query;
        },
        select(columns) {
          return {
            in(column, keys) {
              return {
                async limit(count) {
                  conflictCheckCount += 1;
                  calls.push({ type: 'conflict-check', table, columns, column, keys, count });
                  const conflict =
                    !conflictAfterInsert || conflictCheckCount > 1 ? conflictRow(Array.isArray(keys) ? keys : []) : null;
                  return { data: conflict ? [conflict] : [], error: null };
                },
              };
            },
          };
        },
        insert(rows) {
          calls.push({ type: 'insert', table, rows });
          return {
            async select() {
              if (conflictAfterInsert) {
                return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
              }
              return { data: rows, error: null };
            },
          };
        },
        update(patch) {
          return {
            eq(column, value) {
              return {
                async select(columns) {
                  calls.push({ type: 'confirm', table, patch, column, value, columns });
                  return {
                    data: Array.from({ length: Math.max(0, Number(confirmRows) || 0) }, (_, index) => ({
                      guard_key: `confirmed:${index + 1}`,
                    })),
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return { client, calls };
}

function createStore(client) {
  return createOutboundRecipientGuardStore({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => client,
    now: () => new Date('2026-06-08T10:00:00.000Z'),
  });
}

test('outbound recipient guard schema keeps public roles locked out', () => {
  const schema = fs.readFileSync(
    path.resolve(__dirname, '../../supabase/data-ops-schema.sql'),
    'utf8'
  );

  assert.match(schema, /create table if not exists public\.softora_outbound_recipient_guards/);
  assert.match(schema, /guard_key text primary key/);
  assert.match(schema, /softora_outbound_recipient_guards_key_idx/);
  assert.match(schema, /alter table public\.softora_outbound_recipient_guards enable row level security;/);
  assert.match(schema, /revoke all on table public\.softora_outbound_recipient_guards from public;/);
  assert.match(schema, /revoke all on table public\.softora_outbound_recipient_guards from anon;/);
  assert.match(schema, /revoke all on table public\.softora_outbound_recipient_guards from authenticated;/);
  assert.match(schema, /grant select, insert, update, delete on public\.softora_outbound_recipient_guards to service_role;/);
});

test('outbound recipient guard store blocks a batch conflict before inserting', async () => {
  const { client, calls } = createMockSupabaseClient({
    conflictKeys: ['email:blocked@example.test'],
  });
  const store = createStore(client);

  const result = await store.reserveRecipients(
    [
      { recipientEmail: 'fresh@example.test', recipientCompany: 'Fresh BV', recipientId: 'fresh-1' },
      { recipientEmail: 'blocked@example.test', recipientCompany: 'Blocked BV', recipientId: 'blocked-1' },
    ],
    { provider: 'softora', channel: 'coldmail', permanent: true, source: 'test' }
  );

  assert.equal(result.ok, false);
  assert.equal(result.conflict.guard_key, 'email:blocked@example.test');
  assert.equal(calls.some((call) => call.type === 'insert'), false);
  const check = calls.find((call) => call.type === 'conflict-check');
  assert.ok(check.keys.includes('email:blocked@example.test'));
});

test('outbound recipient guard store reads the indexed mailbox-history ledger marker', async () => {
  const { client, calls } = createMockSupabaseClient({
    conflictKeys: [HISTORICAL_MAILBOX_LEDGER_GUARD_KEY],
  });
  const store = createStore(client);

  const status = await store.getHistoricalMailboxLedgerStatus();

  assert.equal(status.ok, true);
  assert.equal(status.marker.guard_key, HISTORICAL_MAILBOX_LEDGER_GUARD_KEY);
  const check = calls.find((call) => call.type === 'conflict-check');
  assert.deepEqual(check.keys, [HISTORICAL_MAILBOX_LEDGER_GUARD_KEY]);
  assert.equal(check.count, 1);
});

test('outbound recipient guard store fails readiness closed when the ledger marker is absent', async () => {
  const { client } = createMockSupabaseClient();
  const store = createStore(client);

  const status = await store.getHistoricalMailboxLedgerStatus();

  assert.equal(status.ok, false);
  assert.equal(status.reason, 'mailbox_outbound_ledger_marker_missing');
  assert.equal(status.marker, null);
});

test('outbound recipient guard store resolves the real conflict after a unique-key race', async () => {
  const { client, calls } = createMockSupabaseClient({
    conflictKeys: ['email:blocked@example.test'],
    conflictAfterInsert: true,
  });
  const store = createStore(client);

  const result = await store.reserveRecipients(
    [
      { recipientEmail: 'fresh@example.test', recipientCompany: 'Fresh BV', recipientId: 'fresh-1' },
      { recipientEmail: 'blocked@example.test', recipientCompany: 'Blocked BV', recipientId: 'blocked-1' },
    ],
    { provider: 'softora', channel: 'coldmail', permanent: true, source: 'test' }
  );

  assert.equal(result.ok, false);
  assert.equal(result.conflict.guard_key, 'email:blocked@example.test');
  assert.equal(calls.filter((call) => call.type === 'insert').length, 1);
  assert.equal(calls.filter((call) => call.type === 'conflict-check').length, 2);
});

test('outbound recipient guard store reports exact reserve and confirm counts', async () => {
  const { client, calls } = createMockSupabaseClient({ confirmRows: 4 });
  const store = createStore(client);

  const reservation = await store.reserveRecipients(
    [{ recipientEmail: 'fresh@example.test', recipientCompany: 'Fresh BV', recipientId: 'fresh-1' }],
    { provider: 'softora', channel: 'coldmail', permanent: true, source: 'test' }
  );

  assert.equal(reservation.ok, true);
  assert.equal(reservation.count, 4);
  assert.equal(reservation.expectedCount, 4);

  const confirmation = await store.confirmReservation(reservation.reservationId, {
    status: 'sent',
    permanent: true,
  });

  assert.equal(confirmation.ok, true);
  assert.equal(confirmation.count, 4);
  assert.equal(calls.some((call) => call.type === 'confirm'), true);
});

test('outbound recipient guard store groups permanent sent guard rows by reservation', async () => {
  const sentRows = [
    {
      reservation_id: 'reservation-1',
      guard_key: 'email:fresh@example.test',
      key_type: 'email',
      provider: 'softora',
      channel: 'coldmail',
      recipient_email: 'fresh@example.test',
      recipient_domain: 'example-test',
      recipient_company_key: 'fresh-bv',
      recipient_id: 'fresh-1',
      status: 'sent',
      permanent: true,
      updated_at: '2026-06-08T09:00:00.000Z',
    },
    {
      reservation_id: 'reservation-1',
      guard_key: 'domain:example-test',
      key_type: 'domain',
      provider: 'softora',
      channel: 'coldmail',
      recipient_email: 'fresh@example.test',
      recipient_domain: 'example-test',
      recipient_company_key: 'fresh-bv',
      recipient_id: 'fresh-1',
      status: 'sent',
      permanent: true,
      updated_at: '2026-06-08T09:00:00.000Z',
    },
    {
      reservation_id: 'reservation-2',
      guard_key: 'email:second@example.test',
      key_type: 'email',
      provider: 'softora',
      channel: 'coldmail',
      recipient_email: 'second@example.test',
      recipient_domain: 'example-test',
      recipient_company_key: 'second-bv',
      recipient_id: 'second-1',
      status: 'sent',
      permanent: true,
      updated_at: '2026-06-08T09:30:00.000Z',
    },
  ];
  const calls = [];
  const client = {
    from(table) {
      return {
        select(columns) {
          const query = {
            eq(column, value) {
              calls.push({ type: 'eq', table, columns, column, value });
              return query;
            },
            gte(column, value) {
              calls.push({ type: 'gte', column, value });
              return query;
            },
            order(column, options) {
              calls.push({ type: 'order', column, options });
              return query;
            },
            async limit(count) {
              calls.push({ type: 'limit', count });
              return { data: sentRows, error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const store = createStore(client);

  const groups = await store.listSentRecipientGroups({
    provider: 'softora',
    channel: 'coldmail',
    keyType: 'email',
    updatedSince: '2026-06-08T08:00:00.000Z',
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].recipient_email, 'fresh@example.test');
  assert.equal(groups[1].recipient_email, 'second@example.test');
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'status' && call.value === 'sent'), true);
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'permanent' && call.value === true), true);
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'provider' && call.value === 'softora'), true);
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'channel' && call.value === 'coldmail'), true);
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'key_type' && call.value === 'email'), true);
  assert.equal(calls.some((call) => call.type === 'gte' && call.column === 'updated_at' && call.value === '2026-06-08T08:00:00.000Z'), true);
});

test('outbound recipient guard store filtert sent emailguards exact en volledig per ontvanger', async () => {
  const calls = [];
  const rows = [{
    reservation_id: 'shared-reservation',
    guard_key: 'email:first@example.test',
    key_type: 'email',
    key_value: 'first@example.test',
    recipient_email: 'first@example.test',
    status: 'sent',
    permanent: true,
  }, {
    reservation_id: 'shared-reservation',
    guard_key: 'email:second@example.test',
    key_type: 'email',
    key_value: 'second@example.test',
    recipient_email: 'second@example.test',
    status: 'sent',
    permanent: true,
  }];
  const client = {
    from(table) {
      return {
        select(columns, options) {
          calls.push({ type: 'select', columns, options });
          const query = {
            eq(column, value) {
              calls.push({ type: 'eq', table, columns, column, value });
              return query;
            },
            in(column, values) {
              calls.push({ type: 'in', column, values });
              return query;
            },
            order(column, options) {
              calls.push({ type: 'order', column, options });
              return query;
            },
            async limit(count) {
              calls.push({ type: 'limit', count });
              return { data: rows, count: rows.length, error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const recipientEmails = [
    ' First@Example.test ',
    'first@example.test',
    'Naam <SECOND@example.test>',
    'geen-email',
    ...Array.from({ length: 98 }, (_, index) => `lead-${index + 1}@example.test`),
  ];

  const groups = await createStore(client).listSentRecipientGroups({
    recipientEmails,
    keyType: 'domain',
    maxRows: 1,
  });

  assert.equal(groups.length, 2, 'dezelfde reservation mag twee exacte ontvangerbewijzen niet samenvoegen');
  assert.deepEqual(groups.map((group) => group.key_value), [
    'first@example.test', 'second@example.test',
  ]);
  assert.equal(calls.some((call) => (
    call.type === 'eq' && call.column === 'status' && call.value === 'sent'
  )), true);
  assert.equal(calls.some((call) => (
    call.type === 'eq' && call.column === 'permanent' && call.value === true
  )), true);
  assert.equal(calls.some((call) => (
    call.type === 'eq' && call.column === 'key_type' && call.value === 'email'
  )), true);
  assert.equal(calls.some((call) => (
    call.type === 'eq' && call.column === 'key_type' && call.value === 'domain'
  )), false);
  const recipientFilter = calls.find((call) => call.type === 'in');
  assert.equal(recipientFilter.column, 'key_value');
  assert.equal(recipientFilter.values.length, 100);
  assert.deepEqual(recipientFilter.values.slice(0, 2), [
    'first@example.test',
    'second@example.test',
  ]);
  assert.equal(recipientFilter.values.includes('geen-email'), false);
  assert.equal(calls.find((call) => call.type === 'limit').count, 101);
  assert.deepEqual(calls.find((call) => call.type === 'select').options, { count: 'exact' });
});

test('outbound recipient guard store verbreedt ongeldige, te brede of onbeschikbare exacte filters nooit', async () => {
  let queried = false;
  const client = {
    from() {
      queried = true;
      throw new Error('onveilige exacte filter mag Supabase niet benaderen');
    },
  };
  const store = createStore(client);

  assert.deepEqual(await store.listSentRecipientGroups({
    recipientEmails: ['geen-email', '', null],
  }), []);
  assert.equal(await store.listSentRecipientGroups({
    recipientEmails: Array.from({ length: 101 }, (_, index) => `lead-${index}@example.test`),
  }), null);
  assert.equal(queried, false);

  const unavailable = createOutboundRecipientGuardStore({ isSupabaseConfigured: () => false });
  assert.equal(await unavailable.listSentRecipientGroups({
    recipientEmails: ['lead@example.test'],
  }), null);
});

test('outbound exacte recipient guard lookup faalt gesloten op dubbele of scopevreemde rijen', async () => {
  function clientFor(rows) {
    return {
      from() {
        return {
          select() {
            const query = {
              eq() { return query; },
              in() { return query; },
              order() { return query; },
              async limit() { return { data: rows, count: rows.length, error: null }; },
            };
            return query;
          },
        };
      },
    };
  }
  const exact = {
    reservation_id: 'exact', guard_key: 'email:lead@example.test', key_type: 'email',
    key_value: 'lead@example.test', recipient_email: 'lead@example.test',
    status: 'sent', permanent: true,
  };
  assert.equal(await createStore(clientFor([exact, { ...exact, guard_key: 'duplicate' }]))
    .listSentRecipientGroups({ recipientEmails: ['lead@example.test'] }), null);
  assert.equal(await createStore(clientFor([{ ...exact, key_value: 'other@example.test' }]))
    .listSentRecipientGroups({ recipientEmails: ['lead@example.test'] }), null);
});

test('outbound recipient guard store exposes bounded pending permanent reservations for reconciliation', async () => {
  const calls = [];
  const rows = [{
    reservation_id: 'pending-1',
    guard_key: 'email:pending@example.test',
    key_type: 'email',
    provider: 'softora',
    channel: 'coldmail',
    recipient_email: 'pending@example.test',
    recipient_id: 'pending-customer',
    sender_email: 'serve@softora.nl',
    status: 'reserved',
    permanent: true,
    source: 'softora-coldmail-pre-send',
    payload: { expectedSubject: 'Kleine vraag over jullie website' },
    created_at: '2026-06-08T09:00:00.000Z',
    updated_at: '2026-06-08T09:00:00.000Z',
  }];
  const client = {
    from(table) {
      return {
        select(columns) {
          const query = {
            eq(column, value) {
              calls.push({ type: 'eq', table, columns, column, value });
              return query;
            },
            gte(column, value) {
              calls.push({ type: 'gte', column, value });
              return query;
            },
            order() { return query; },
            async limit() { return { data: rows, error: null }; },
          };
          return query;
        },
      };
    },
  };

  const groups = await createStore(client).listReservedRecipientGroups({
    provider: 'softora',
    channel: 'coldmail',
    keyType: 'email',
    updatedSince: '2026-06-01T00:00:00.000Z',
    maxRows: 100,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].reservation_id, 'pending-1');
  assert.equal(groups[0].status, 'reserved');
  assert.equal(groups[0].payload.expectedSubject, 'Kleine vraag over jullie website');
  assert.equal(calls.some((call) => call.type === 'eq' && call.column === 'status' && call.value === 'reserved'), true);
  assert.equal(calls.some((call) => call.type === 'gte' && call.column === 'updated_at'), true);
});

test('outbound recipient guard store paginates sent guard rows beyond Supabase single-page caps', async () => {
  const sentRows = Array.from({ length: 1003 }, (_, index) => ({
    reservation_id: `reservation-${index + 1}`,
    guard_key: `email:lead-${index + 1}@example.test`,
    key_type: 'email',
    provider: 'softora',
    channel: 'coldmail',
    recipient_email: `lead-${index + 1}@example.test`,
    recipient_domain: 'example-test',
    recipient_company_key: `lead-${index + 1}`,
    recipient_id: `lead-${index + 1}`,
    status: 'sent',
    permanent: true,
    updated_at: `2026-06-08T09:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }));
  const calls = [];
  const client = {
    from(table) {
      return {
        select(columns) {
          const query = {
            eq(column, value) {
              calls.push({ type: 'eq', table, columns, column, value });
              return query;
            },
            order(column, options) {
              calls.push({ type: 'order', column, options });
              return query;
            },
            async range(from, to) {
              calls.push({ type: 'range', from, to });
              return { data: sentRows.slice(from, to + 1), error: null };
            },
          };
          return query;
        },
      };
    },
  };
  const store = createStore(client);

  const groups = await store.listSentRecipientGroups({
    provider: 'softora',
    channel: 'coldmail',
    maxRows: 2000,
  });

  assert.equal(groups.length, 1003);
  assert.equal(groups[0].recipient_email, 'lead-1@example.test');
  assert.equal(groups[1002].recipient_email, 'lead-1003@example.test');
  assert.deepEqual(
    calls.filter((call) => call.type === 'range').map((call) => [call.from, call.to]),
    [
      [0, 999],
      [1000, 1999],
    ]
  );
});

test('outbound recipient guard store normalizes company legal suffix punctuation like coldmail', async () => {
  const { client, calls } = createMockSupabaseClient();
  const store = createStore(client);

  const reservation = await store.reserveRecipients(
    [{ recipientEmail: 'info@idtravel.nl', recipientCompany: 'ID Travel B.V.', recipientId: 'idtravel-1' }],
    { provider: 'softora', channel: 'coldmail', permanent: true, source: 'test' }
  );

  assert.equal(reservation.ok, true);
  const insertedRows = calls.find((call) => call.type === 'insert').rows;
  const keys = insertedRows.map((row) => row.guard_key).sort();
  assert.equal(keys.includes('company:id-travel-b-v'), true);
  assert.equal(keys.includes('company:id-travel-b.v.'), false);
});

test('outbound recipient guard store does not treat personal mailbox providers as recipient domains', async () => {
  const { client, calls } = createMockSupabaseClient();
  const store = createStore(client);

  const reservation = await store.reserveRecipients(
    [
      { recipientEmail: 'ruben@gmail.com', recipientCompany: 'Eenmanszaak Gmail', recipientId: 'gmail-1' },
      { recipientEmail: 'info@bakkerijzon.nl', recipientCompany: 'Bakkerij Zon', recipientId: 'bakkerij-1' },
    ],
    { provider: 'softora', channel: 'coldmail', permanent: true, source: 'test' }
  );

  assert.equal(reservation.ok, true);
  const insertedRows = calls.find((call) => call.type === 'insert').rows;
  const keys = insertedRows.map((row) => row.guard_key).sort();
  assert.equal(keys.includes('domain:gmail-com'), false);
  assert.equal(keys.includes('domain:bakkerijzon-nl'), true);
  assert.equal(keys.includes('email:ruben@gmail.com'), true);
});

test('outbound recipient guard store marks confirm empty when no reservation rows are updated', async () => {
  const { client } = createMockSupabaseClient({ confirmRows: 0 });
  const store = createStore(client);

  const confirmation = await store.confirmReservation('missing-reservation', {
    status: 'sent',
    permanent: true,
  });

  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.reason, 'reservation_not_found');
  assert.equal(confirmation.count, 0);
});

test('outbound recipient guard store releases reserved rows without touching sent guards', async () => {
  const { client, calls } = createMockSupabaseClient();
  const store = createStore(client);

  const result = await store.releaseReservation('reservation-to-release');

  assert.equal(result.ok, true);
  const release = calls.find((call) => call.type === 'delete' && call.filters.some((filter) => filter.column === 'reservation_id'));
  assert.ok(release);
  assert.deepEqual(release.filters, [
    { column: 'reservation_id', value: 'reservation-to-release' },
    { column: 'status', value: 'reserved' },
  ]);
});
