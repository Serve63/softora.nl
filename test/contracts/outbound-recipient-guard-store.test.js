const assert = require('node:assert/strict');
const test = require('node:test');

const { createOutboundRecipientGuardStore } = require('../../server/services/outbound-recipient-guard-store');

function createMockSupabaseClient({ conflictKeys = [], conflictAfterInsert = false } = {}) {
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
