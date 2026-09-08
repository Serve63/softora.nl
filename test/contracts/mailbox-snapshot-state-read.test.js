const test = require('node:test');
const assert = require('node:assert/strict');
const { createMailboxIndexVisibilityStore } = require('../../server/services/mailbox-index-visibility-store');

test('snapshotzichtbaarheid leest begrensde keybatches zonder bodies en sluit verborgen en oude generaties uit', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const store = createMailboxIndexVisibilityStore({
    normalizeString: (value) => String(value || '').trim(),
    run: async (label, operation, options) => {
      const call = { label, options, filters: [] };
      calls.push(call);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const query = {
        select(columns) { call.columns = columns; return query; },
        in(column, keys) { call.column = column; call.keys = keys; return query; },
        is(...filter) { call.filters.push(filter); return query; },
      };
      await operation({ from: (table) => { call.table = table; return query; } });
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      return { ok: true, data: call.keys.map((key) => ({ message_key: key })) };
    },
  });
  const messageKeys = Array.from({ length: 201 }, (_, index) => `key-${index}`);
  const rows = await store.listMessageStatesByKeys({ messageKeys: [...messageKeys, messageKeys[0], ''] });
  assert.equal(rows.length, 201);
  assert.equal(calls.length, 5);
  assert.equal(maxActive, 3);
  for (const call of calls) {
    assert.equal(call.table, 'softora_mailbox_messages');
    assert.equal(call.column, 'message_key');
    assert.ok(call.keys.length <= 50);
    assert.doesNotMatch(call.columns, /body|payload/);
    assert.deepEqual(call.filters, [['deleted_at', null], ['generation_superseded_at', null]]);
    assert.equal(call.options.bypassFailureCooldown, true);
    assert.equal(call.options.suppressFailureCooldown, true);
    assert.ok(call.options.queryTimeoutMs <= 1500);
  }
});

test('een mislukte snapshotzichtbaarheidsread is nooit een lege succesvolle lijst', async () => {
  const calls = [];
  const store = createMailboxIndexVisibilityStore({
    normalizeString: String,
    run: async () => { calls.push(1); return { ok: false, data: [] }; },
  });
  assert.equal(await store.listMessageStatesByKeys({ messageKeys: ['key'] }), null);
  assert.equal(await store.listMessageStatesByKeys({ messageKeys: ['key'], deadlineAtMs: 0 }), null);
  assert.equal(await store.listMessageStatesByKeys({ messageKeys: Array.from({ length: 2001 }, (_, i) => String(i)) }), null);
  assert.equal(calls.length, 1);
});
