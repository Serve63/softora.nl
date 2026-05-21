const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectSupabaseAddonCosts,
  fetchSupabaseCostDiagnostics,
  fetchSupabaseCostSummary,
  getSupabaseCostConfigStatus,
  resolveSupabaseProjectRef,
} = require('../../server/services/supabase-costs');

test('supabase costs resolves project ref from explicit env or Supabase URL', () => {
  assert.equal(resolveSupabaseProjectRef({ env: { SUPABASE_PROJECT_REF: 'explicit-ref' } }), 'explicit-ref');
  assert.equal(
    resolveSupabaseProjectRef({ env: { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' } }),
    'abcdefghijklmnopqrst'
  );
});

test('supabase costs collects selected add-on prices as monthly amounts', () => {
  const amounts = collectSupabaseAddonCosts(
    {
      selected_addons: [
        {
          type: 'compute',
          variant: {
            name: 'Micro',
            price: { amount: 10, currency: 'usd', interval: 'monthly' },
          },
        },
        {
          type: 'ipv4',
          variant: {
            name: 'IPv4',
            price: { amount: 0.005, currency: 'usd', interval: 'hourly' },
          },
        },
        {
          type: 'annual',
          variant: {
            name: 'Annual add-on',
            price: { amount: 120, currency: 'eur', interval: 'yearly' },
          },
        },
      ],
    },
    { supabaseBillingMonthlyHours: 700 }
  );

  assert.deepEqual(amounts.currencies, { usd: 13.5, eur: 10 });
  assert.equal(amounts.selectedAddonCount, 3);
  assert.equal(amounts.lineItems[0].name, 'Micro');
  assert.equal(amounts.lineItems[1].amount, 3.5);
});

test('supabase costs fetches Management API add-ons and combines configured base cost', async () => {
  const calls = [];
  const summary = await fetchSupabaseCostSummary(
    {
      env: {},
      supabaseManagementAccessToken: 'supabase-token',
      supabaseProjectRef: 'project-ref',
      supabaseManagementApiBaseUrl: 'https://api.supabase.test/v1',
      supabaseMonthlyBaseCostEur: 25,
      usdToEurRate: 0.9,
      supabaseCostsCache: {},
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        return {
          response: { ok: true, status: 200 },
          data: {
            selected_addons: [
              {
                type: 'compute',
                variant: {
                  name: 'Micro',
                  price: { amount: 10, currency: 'usd', interval: 'monthly' },
                },
              },
            ],
          },
        };
      },
    },
    { nowMs: Date.UTC(2026, 4, 18, 16, 40, 0) }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.supabase.test/v1/projects/project-ref/billing/addons');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer supabase-token');
  assert.equal(summary.status, 'success');
  assert.equal(summary.exact, true);
  assert.equal(summary.costEur, 34);
  assert.equal(summary.addonCostEur, 9);
  assert.equal(summary.baseCostEur, 25);
  assert.equal(summary.selectedProviderKind, 'management_addons_with_configured_base');
  assert.match(summary.selectedProviderLabel, /Management API/);
  assert.equal(summary.currency, 'eur');
  assert.equal(summary.baseCost.source, 'configured-eur');
  assert.deepEqual(summary.currencies, { usd: 10, eur: 25 });
  assert.deepEqual(summary.addonCurrencies, { usd: 10 });
  assert.deepEqual(summary.baseCurrencies, { eur: 25 });
  assert.equal(summary.addons.length, 1);
});

test('supabase costs stays partial without configured base plan cost', async () => {
  const summary = await fetchSupabaseCostSummary(
    {
      env: {},
      supabaseManagementAccessToken: 'supabase-token',
      supabaseProjectRef: 'project-ref',
      usdToEurRate: 0.9,
      supabaseCostsCache: {},
      fetchJsonWithTimeout: async () => ({
        response: { ok: true, status: 200 },
        data: {
          selected_addons: [
            {
              type: 'compute',
              variant: {
                name: 'Micro',
                price: { amount: 10, currency: 'usd', interval: 'monthly' },
              },
            },
          ],
        },
      }),
    },
    { nowMs: Date.UTC(2026, 4, 18, 16, 45, 0) }
  );

  assert.equal(summary.status, 'partial');
  assert.equal(summary.exact, false);
  assert.equal(summary.selectedProviderKind, 'management_addons_only');
  assert.equal(summary.costEur, 9);
  assert.match(summary.note, /SUPABASE_MONTHLY_BASE_COST/);
});

test('supabase costs exposes redacted config status without leaking tokens', () => {
  const config = getSupabaseCostConfigStatus({
    env: {
      SUPABASE_MANAGEMENT_ACCESS_TOKEN: 'sbp_secret-token',
      SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
      SUPABASE_MONTHLY_BASE_COST_USD: '25',
    },
  });

  assert.equal(config.managementTokenConfigured, true);
  assert.equal(config.projectRefConfigured, true);
  assert.equal(config.projectRef, 'abcd...qrst');
  assert.equal(config.baseCostConfigured, true);
  assert.equal(config.baseCostCurrency, 'usd');
  assert.doesNotMatch(JSON.stringify(config), /secret-token/);
  assert.doesNotMatch(JSON.stringify(config), /abcdefghijklmnopqrst/);
});

test('supabase cost diagnostics compares configured base and Management API add-ons', async () => {
  const diagnostics = await fetchSupabaseCostDiagnostics(
    {
      env: {},
      supabaseManagementAccessToken: 'supabase-token',
      supabaseProjectRef: 'project-ref',
      supabaseMonthlyBaseCostEur: 25,
      usdToEurRate: 0.9,
      supabaseCostsCache: {},
      fetchJsonWithTimeout: async () => ({
        response: { ok: true, status: 200 },
        data: {
          selected_addons: [
            {
              type: 'compute',
              variant: {
                name: 'Micro',
                price: { amount: 10, currency: 'usd', interval: 'monthly' },
              },
            },
          ],
        },
      }),
    },
    { nowMs: Date.UTC(2026, 4, 21, 15, 35, 0) }
  );

  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.managementApi.addonCostEur, 9);
  assert.equal(diagnostics.configuredBase.costEur, 25);
  assert.equal(diagnostics.selected.costEur, 34);
  assert.equal(diagnostics.selected.selectedProviderKind, 'management_addons_with_configured_base');
  assert.equal(diagnostics.comparison.candidates[0].kind, 'configured_base');
  assert.equal(diagnostics.comparison.candidates[1].kind, 'management_addons');
  assert.equal(diagnostics.unavailable.length, 0);
});

test('supabase cost diagnostics reports missing token without throwing', async () => {
  const diagnostics = await fetchSupabaseCostDiagnostics(
    {
      env: {},
      fetchJsonWithTimeout: async () => ({ response: { ok: true, status: 200 }, data: {} }),
    },
    { nowMs: Date.UTC(2026, 4, 21, 15, 40, 0) }
  );

  assert.equal(diagnostics.ok, false);
  assert.equal(diagnostics.config.managementTokenConfigured, false);
  assert.equal(diagnostics.selected, null);
  assert.equal(diagnostics.managementApi, null);
  assert.equal(diagnostics.unavailable[0].error, 'SUPABASE_ACCESS_TOKEN_MISSING');
  assert.match(diagnostics.unavailable[0].detail, /SUPABASE_MANAGEMENT_ACCESS_TOKEN/);
});

test('supabase costs fails closed without token or project ref', async () => {
  await assert.rejects(
    () =>
      fetchSupabaseCostSummary({
        env: {},
        fetchJsonWithTimeout: async () => ({ response: { ok: true }, data: {} }),
      }),
    (error) => {
      assert.equal(error.code, 'SUPABASE_ACCESS_TOKEN_MISSING');
      assert.equal(error.status, 503);
      return true;
    }
  );

  await assert.rejects(
    () =>
      fetchSupabaseCostSummary({
        env: {},
        supabaseManagementAccessToken: 'supabase-token',
        fetchJsonWithTimeout: async () => ({ response: { ok: true }, data: {} }),
      }),
    (error) => {
      assert.equal(error.code, 'SUPABASE_PROJECT_REF_MISSING');
      assert.equal(error.status, 503);
      return true;
    }
  );
});
