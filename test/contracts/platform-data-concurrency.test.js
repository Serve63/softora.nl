const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const calls = [];
  const events = {};
  let now = 100;
  const window = {
    fetch(url, options) {
      return new Promise((resolve, reject) => calls.push({ url, options, resolve, reject }));
    },
    addEventListener(name, handler) { events[name] = handler; },
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../../assets/premium-ui-state-client.js'), 'utf8'), {
    window, Date: { now: () => now },
  });
  function reply(index, value, status = 200) {
    calls[index].resolve({ ok: status === 200, status, json: async () => value });
  }
  return { client: window.SoftoraUiStateClient, calls, reply, events, advance: () => { now += 16000; } };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('simultaneous readers share even a request older than the cache TTL', async () => {
  const h = harness();
  const first = h.client.get('customers');
  h.advance();
  const second = h.client.get('customers');
  assert.equal(h.calls.length, 1);
  h.reply(0, { values: { current: true } });
  assert.deepEqual(await first, await second);
  await h.client.get('customers');
  assert.equal(h.calls.length, 1);
});

test('all deduplicated readers follow invalidation instead of returning an old response', async () => {
  const h = harness();
  const first = h.client.get('orders');
  const second = h.client.get('orders');
  h.client.invalidate('orders');
  const fresh = h.client.get('orders');
  h.reply(0, { values: { version: 'old' } });
  await tick();
  assert.equal(h.calls.length, 2);
  h.reply(1, { values: { version: 'new' } });
  for (const result of await Promise.all([first, second, fresh])) assert.equal(result.values.version, 'new');
  assert.equal(h.client.peek('orders').values.version, 'new');
});

test('an older failed request cannot evict a newer successful snapshot', async () => {
  const h = harness();
  const old = h.client.get('orders');
  const rejection = assert.rejects(old, /500/);
  h.client.invalidate('orders');
  const fresh = h.client.get('orders');
  h.reply(1, { values: { version: 'new' } });
  await fresh;
  h.reply(0, {}, 500);
  await rejection;
  assert.equal(h.client.peek('orders').values.version, 'new');
  await h.client.get('orders');
  assert.equal(h.calls.length, 2);
});

test('reads wait for overlapping writes; an old read cannot restore pre-write data', async () => {
  const h = harness();
  const oldRead = h.client.get('orders');
  const firstWrite = h.client.set('orders', { version: 2 });
  const secondWrite = h.client.set('orders', { version: 3 });
  const readDuringWrite = h.client.get('orders');
  assert.equal(h.calls.length, 3);
  h.reply(0, { values: { version: 1 } });
  h.reply(2, { ok: true });
  await tick();
  assert.equal(h.calls.length, 3);
  h.reply(1, { ok: true });
  await Promise.all([firstWrite, secondWrite]);
  await tick();
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[3].options.method, 'GET');
  h.reply(3, { values: { version: 3 } });
  assert.equal((await oldRead).values.version, 3);
  assert.equal((await readDuringWrite).values.version, 3);
  assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 2);
});

test('failed writes release readers and force a fresh server read', async () => {
  const h = harness();
  const write = h.client.set('orders', {});
  const failure = assert.rejects(write, /500/);
  const read = h.client.get('orders');
  h.reply(0, {}, 500);
  await failure;
  await tick();
  assert.equal(h.calls.length, 2);
  h.reply(1, { values: { stillValid: true } });
  assert.equal((await read).values.stillValid, true);
});

test('pagehide clears cached data and rejects every old-session reader', async () => {
  const h = harness();
  h.client.prime('cached', { source: 'supabase', values: { private: true } });
  const reads = [h.client.get('orders'), h.client.get('orders')];
  const rejected = reads.map((read) => assert.rejects(read, /sessie gewijzigd/));
  h.events.pagehide();
  assert.equal(h.client.peek('cached'), null);
  const newSession = h.client.get('orders');
  h.reply(1, { values: { session: 'new' } });
  await newSession;
  h.reply(0, { values: { session: 'old' } });
  await Promise.all(rejected);
  assert.equal(h.client.peek('orders').values.session, 'new');
});

test('a pre-clear write cannot erase the next session cache', async () => {
  const h = harness();
  const oldWrite = h.client.set('orders', {});
  const oldRead = h.client.get('orders');
  const rejected = assert.rejects(oldRead, /sessie gewijzigd/);
  h.client.clear();
  h.client.prime('orders', { source: 'supabase', values: { session: 'new' } });
  h.reply(0, { ok: true });
  await oldWrite;
  await rejected;
  assert.equal(h.client.peek('orders').values.session, 'new');
});
