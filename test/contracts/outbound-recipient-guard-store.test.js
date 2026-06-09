const assert = require('node:assert/strict');
const test = require('node:test');

const { createOutboundRecipientGuardStore } = require('../../server/services/outbound-recipient-guard-store');

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
          return {
            eq(column, value) {
              return {
                async lt(otherColumn, otherValue) {
                  calls.push({ type: 'delete', table, column, value, otherColumn, otherValue });
                  return { error: null };
                },
              };
            },
          };
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
