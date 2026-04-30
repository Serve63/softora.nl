const test = require('node:test');
const assert = require('node:assert/strict');

const dashboardCore = require('../../assets/premium-dashboard-core');

test('premium dashboard core exposes stable pure helpers', () => {
  assert.equal(Object.isFrozen(dashboardCore), true);
  assert.equal(dashboardCore.escapeHtml('<span title="x">&'), '&lt;span title=&quot;x&quot;&gt;&amp;');
  assert.equal(dashboardCore.normalizeDashboardString('  Softora  '), 'Softora');
  assert.equal(dashboardCore.normalizeDashboardTime('09:30'), '09:30');
  assert.equal(dashboardCore.normalizeDashboardTime('', '08:00'), '08:00');
  assert.equal(dashboardCore.normalizeDashboardDate('2026-04-28'), '2026-04-28');
  assert.equal(typeof dashboardCore.fetchPremiumDashboardJson, 'function');
  assert.equal(typeof dashboardCore.releasePremiumDashboardBootShell, 'function');
  assert.equal(typeof dashboardCore.startPremiumDashboardBootWatchdog, 'function');
});

test('premium dashboard core reads chunked customer state values safely', () => {
  const values = {
    softora_customers_premium_v1_chunks_v1: JSON.stringify({ count: 2 }),
    softora_customers_premium_v1_chunk_0: '[{"naam":"Sof',
    softora_customers_premium_v1_chunk_1: 'tora"}]',
  };

  assert.equal(
    dashboardCore.readPremiumDashboardChunkedStateValue(values, 'softora_customers_premium_v1'),
    '[{"naam":"Softora"}]'
  );

  assert.equal(
    dashboardCore.readPremiumDashboardChunkedStateValue(
      { softora_customers_premium_v1: 'fallback' },
      'softora_customers_premium_v1'
    ),
    'fallback'
  );
});

test('premium dashboard core formats money and project metadata', () => {
  assert.equal(dashboardCore.formatMoneyEUR(1250), '\u20ac1.250');
  assert.equal(
    dashboardCore.formatProjectMeta({
      location: 'Amsterdam',
      amount: 1250,
      ui: { isBuilt: true, isPaid: false },
    }),
    'Amsterdam \u2022 \u20ac1.250 \u2022 wacht op betaling'
  );
});
