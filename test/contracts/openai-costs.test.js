const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCostWindow,
  collectOpenAiCostAmounts,
  fetchOpenAiCostSummary,
} = require('../../server/services/openai-costs');

test('openai costs service builds a current-month unix window', () => {
  const window = buildCostWindow('month', Date.UTC(2026, 3, 29, 9, 0, 0));

  assert.equal(window.scope, 'month');
  assert.equal(window.startTime, new Date(2026, 3, 1, 0, 0, 0, 0).getTime() / 1000);
  assert.equal(window.endTime, Date.UTC(2026, 3, 29, 9, 0, 0) / 1000);
});

test('openai costs service sums official cost buckets by currency', () => {
  const amounts = collectOpenAiCostAmounts({
    data: [
      {
        results: [
          { amount: { value: 1.25, currency: 'usd' } },
          { amount: { value: 2.5, currency: 'USD' } },
          { amount: { value: 0.4, currency: 'eur' } },
        ],
      },
    ],
  });

  assert.deepEqual(amounts.currencies, { usd: 3.75, eur: 0.4 });
  assert.equal(amounts.bucketCount, 1);
  assert.equal(amounts.resultCount, 3);
});

test('openai costs service fetches official OpenAI cost summary and converts USD to EUR', async () => {
  const calls = [];
  const summary = await fetchOpenAiCostSummary(
    {
      openAiCostsApiKey: 'cost-key',
      openAiApiBaseUrl: 'https://api.openai.test/v1',
      usdToEurRate: 0.9,
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        return {
          response: { ok: true, status: 200 },
          data: {
            data: [
              {
                results: [
                  { amount: { value: 10, currency: 'usd' } },
                  { amount: { value: 1.25, currency: 'eur' } },
                ],
              },
            ],
            has_more: false,
          },
        };
      },
    },
    { scope: 'month', nowMs: Date.UTC(2026, 3, 29, 9, 0, 0) }
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.openai\.test\/v1\/organization\/costs\?/);
  assert.match(calls[0].url, /bucket_width=1d/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer cost-key');
  assert.equal(summary.exact, true);
  assert.equal(summary.source, 'openai-costs');
  assert.equal(summary.costUsd, 10);
  assert.equal(summary.costEur, 10.25);
  assert.deepEqual(summary.currencies, { usd: 10, eur: 1.25 });
});

test('openai costs service fails closed when no costs key is configured', async () => {
  await assert.rejects(
    () =>
      fetchOpenAiCostSummary({
        env: {},
        fetchJsonWithTimeout: async () => ({ response: { ok: true }, data: {} }),
      }),
    (error) => {
      assert.equal(error.code, 'OPENAI_COSTS_NOT_CONFIGURED');
      assert.equal(error.status, 503);
      return true;
    }
  );
});
