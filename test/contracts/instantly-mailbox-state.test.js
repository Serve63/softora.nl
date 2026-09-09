const test = require('node:test');
const assert = require('node:assert/strict');
const { createInstantlyStateFixture } = require('../helpers/instantly-mailbox-state');
const { patchInstantlyMailboxState, INSTANTLY_MAILBOX_SYNC_SCOPE: scope } = require('../../server/services/instantly-mailbox-state');

test('concurrent continuation, rate, scope and audit writers retain all fields even on first insert', async () => {
  const h = createInstantlyStateFixture();
  const results = await Promise.all([
    { cursor_serve: 'serve-page' }, { cursor_martijn: 'martijn-page' },
    { read_cooldown_test: 10000 }, { lead_scope_cooldown_test: 20000 }, { thread_audit_test: 30000 },
  ].map(patch => h.store.setUiStateValues(scope, patch)));
  assert.ok(results.every(result => result?.ok));
  assert.deepEqual(h.values, { cursor_serve: 'serve-page', cursor_martijn: 'martijn-page',
    read_cooldown_test: '10000', lead_scope_cooldown_test: '20000', thread_audit_test: '30000' });
  assert.ok(h.conflicts > 0, 'the fixture must exercise a real lost revision race');
});

test('a later shorter cooldown cannot shorten an existing provider wait; cursors can still be cleared', async () => {
  const h = createInstantlyStateFixture({ read_cooldown_test: '30000', cursor_serve: 'last-page' });
  await h.store.setUiStateValues(scope, { read_cooldown_test: '10000', cursor_serve: '' });
  assert.equal(h.values.read_cooldown_test, '30000');
  assert.equal(h.values.cursor_serve, '');
});

test('unavailable reads and exhausted conflicts never become an unconditional state overwrite', async () => {
  const h = createInstantlyStateFixture({ cursor_serve: 'retain' }); h.setUnavailable(true);
  assert.equal(await h.store.setUiStateValues(scope, { cursor_martijn: 'new' }), null);
  assert.deepEqual(h.values, { cursor_serve: 'retain' });
  let attempts = 0;
  const result = await patchInstantlyMailboxState({
    getUiStateValues: async () => ({ source: 'supabase', values: {}, revision: 1 }),
    compareAndSwapUiStateValues: async () => { attempts += 1; return { conflict: true }; },
  }, { cursor_serve: 'new' });
  assert.equal(result, null); assert.equal(attempts, 6);
});

test('unrelated UI scopes retain their existing replacement semantics', async () => {
  const h = createInstantlyStateFixture();
  const result = await h.store.setUiStateValues('another_scope', { value: 'unchanged' });
  assert.deepEqual(result.values, { value: 'unchanged' });
});
