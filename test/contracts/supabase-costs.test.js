const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectSupabaseAddonCosts,
  fetchSupabaseCostSummary,
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
  assert.equal(summary.currency, 'eur');
  assert.equal(summary.baseCost.source, 'configured-eur');
  assert.deepEqual(summary.currencies, { usd: 10, eur: 25 });
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
  assert.equal(summary.costEur, 9);
  assert.match(summary.note, /SUPABASE_MONTHLY_BASE_COST/);
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
