const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../assets/premium-database-system-mail-count.js'), 'utf8');

function environment(saved) {
  const nodes = Object.fromEntries([
    'systemMailSentCount', 'mailRoiAppointmentsCount', 'mailRoiAppointmentRatio',
    'mailRoiDealsCount', 'mailRoiRatio',
  ].map(id => [id, { textContent: '' }]));
  nodes.softoraCustomersBootstrap = { textContent: JSON.stringify({
    mailStats: { totalSent: 4448 }, mailRoi: { appointmentCount: 15, dealCount: 7 },
  }) };
  const writes = [];
  let response = { ok: true, stats: { systemTotalSent: 4448 } };
  const window = {
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    fetch: async () => ({ ok: response.ok, json: async () => response }),
    setInterval: () => 0, addEventListener: () => {},
    SoftoraReadModelStore: {
      readLastKnown: () => saved || null,
      rememberLastKnown: (key, value) => { writes.push({ key, value }); },
    },
  };
  vm.runInNewContext(source, { window });
  return { client: window.SoftoraDatabaseSystemMailCount, nodes, writes,
    respond: value => { response = value; } };
}

function instantlyCustomers(count) {
  return Array.from({ length: count }, (_, i) => ({
    email: `recipient-${i}@example.test`, lastColdmailProvider: 'instantly', instantlyStatus: 'sent',
  }));
}

function assertMetrics(env, total, appointmentRatio, dealRatio) {
  assert.equal(env.nodes.systemMailSentCount.textContent, total);
  assert.equal(env.nodes.mailRoiAppointmentRatio.textContent, appointmentRatio);
  assert.equal(env.nodes.mailRoiRatio.textContent, dealRatio);
}

for (const first of ['stats', 'customers']) {
  test(`Mailsysteem waits for both channel totals when ${first} arrive first`, async () => {
    const env = environment();
    env.client.render([], { dataLoading: true });
    assertMetrics(env, '--', '—', '—');
    if (first === 'stats') {
      await env.client.refreshTodaySentCount();
      env.client.render(instantlyCustomers(1), { dataLoading: true });
    } else {
      env.client.render(instantlyCustomers(1646), { dataLoading: false });
    }
    assertMetrics(env, '--', '—', '—');
    assert.equal(env.client.getMetricReadiness().combined, false);
    assert.equal(env.writes.length, 0);
    if (first === 'stats') env.client.render(instantlyCustomers(1646), { dataLoading: false });
    else await env.client.refreshTodaySentCount();
    assertMetrics(env, '6.094', '1 op 406', '1 op 871');
    assert.equal(env.client.getMetricReadiness().combined, true);
    assert.equal(env.writes.at(-1).value.combinedTotal, 6094);
    assert.equal(env.writes.at(-1).value.softoraTotal, 4448);
    assert.equal(env.writes.at(-1).value.total, 1646);
  });
}

test('Mailsysteem restores a complete total without mixing in a new partial channel read', async () => {
  const env = environment({ total: 1646, softoraTotal: 4448, combinedTotal: 6094 });
  env.client.render([], { dataLoading: true });
  assertMetrics(env, '6.094', '1 op 406', '1 op 871');
  env.respond({ ok: true, stats: { systemTotalSent: 4500 } });
  await env.client.refreshTodaySentCount();
  assertMetrics(env, '6.094', '1 op 406', '1 op 871');
  assert.equal(env.client.getMetricReadiness().combined, false);
  assert.equal(env.writes.length, 0);
  env.client.render(instantlyCustomers(1646), { dataLoading: false });
  assertMetrics(env, '6.146', '1 op 410', '1 op 878');
});

for (const saved of [
  { total: 1646 },
  { total: 1646, softoraTotal: 4448, combinedTotal: 9999 },
]) {
  test(`Mailsysteem rejects incomplete or inconsistent remembered totals ${JSON.stringify(saved)}`, () => {
    const env = environment(saved);
    env.client.render([], { dataLoading: true });
    assertMetrics(env, '--', '—', '—');
  });
}

test('Mailsysteem keeps the complete total on a failed refresh and accepts a complete correction', async () => {
  const env = environment();
  env.client.render(instantlyCustomers(1646), { dataLoading: false });
  await env.client.refreshTodaySentCount();
  assertMetrics(env, '6.094', '1 op 406', '1 op 871');
  const savedCount = env.writes.length;
  env.respond({ ok: false, message: 'Unavailable' });
  await env.client.refreshTodaySentCount();
  env.client.render([], { dataLoading: true });
  assertMetrics(env, '6.094', '1 op 406', '1 op 871');
  assert.equal(env.client.getMetricReadiness().combined, false);
  assert.equal(env.writes.length, savedCount);
  env.respond({ ok: true, stats: { systemTotalSent: 4448 } });
  await env.client.refreshTodaySentCount();
  env.client.render(instantlyCustomers(1500), { dataLoading: false });
  assertMetrics(env, '5.948', '1 op 397', '1 op 850');
});

test('Mailsysteem verifies an empty Instantly channel as zero without confusing it with missing data', async () => {
  const env = environment();
  env.client.render([], { dataLoading: true });
  await env.client.refreshTodaySentCount();
  assertMetrics(env, '--', '—', '—');
  env.client.render([], { dataLoading: false });
  assertMetrics(env, '4.448', '1 op 297', '1 op 635');
  assert.equal(env.client.getMetricReadiness().combined, true);
});

test('Mailsysteem holds the last complete pair while customer inventory refreshes', async () => {
  const env = environment();
  env.client.render(instantlyCustomers(1646), { dataLoading: false });
  await env.client.refreshTodaySentCount();
  env.client.render(instantlyCustomers(10), { dataLoading: true });
  env.respond({ ok: true, stats: { systemTotalSent: 4500 } });
  await env.client.refreshTodaySentCount();
  assertMetrics(env, '6.094', '1 op 406', '1 op 871');
  assert.equal(env.client.getMetricReadiness().combined, false);
  env.client.render(instantlyCustomers(1646), { dataLoading: false });
  assertMetrics(env, '6.146', '1 op 410', '1 op 878');
});

test('Mailsysteem never marks failed or incomplete inventory as a complete channel count', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-database.html'), 'utf8');
  assert.match(page, /dataLoading: preparing \|\| state\.photoRestoreFailed \|\| !state\.canonicalInventoryReady \|\| state\.dataUnavailable/);
});

test('Mailsysteem cannot verify a combined total from a successful response missing its mail count', async () => {
  const env = environment();
  env.respond({ ok: true, stats: {} });
  env.client.render(instantlyCustomers(1646), { dataLoading: false });
  await env.client.refreshTodaySentCount();
  assertMetrics(env, '--', '—', '—');
  assert.equal(env.client.getMetricReadiness().stats, false);
  assert.equal(env.client.getMetricReadiness().combined, false);
});
