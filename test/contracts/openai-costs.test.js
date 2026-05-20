const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCostWindow,
  buildOpenAiDashboardPeriods,
  collectAnthropicCostAmounts,
  collectOpenAiCostAmounts,
  createOpenAiCostSummaryCoordinator,
  fetchAnthropicCostSummary,
  fetchCombinedApiCostSummary,
  fetchOpenAiCostsDashboardSnapshot,
  fetchOpenAiCostSummary,
  fetchOpenAiUsageEstimateSummary,
  parseUsdToEurRateResponse,
  resolveUsdToEurRateDetails,
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

test('openai costs service reads live USD to EUR rates when no fixed rate is configured', async () => {
  assert.equal(parseUsdToEurRateResponse({ rates: { EUR: 0.87 } }), 0.87);

  const calls = [];
  const rateDetails = await resolveUsdToEurRateDetails({
    env: {},
    exchangeRateApiUrl: 'https://rates.test/latest?from=USD&to=EUR',
    fetchJsonWithTimeout: async (url, options) => {
      calls.push({ url, options });
      return {
        response: { ok: true, status: 200 },
        data: { rates: { EUR: 0.91 } },
      };
    },
    usdToEurRateCache: {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://rates.test/latest?from=USD&to=EUR');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(rateDetails.rate, 0.91);
  assert.equal(rateDetails.source, 'live');
});

test('anthropic costs service sums official cent-based cost buckets', () => {
  const amounts = collectAnthropicCostAmounts({
    data: [
      {
        results: [
          {
            uncached_input_cost: '125',
            cached_input_cost: '25',
            output_cost: '350',
          },
        ],
      },
    ],
  });

  assert.deepEqual(amounts.currencies, { usd: 5 });
  assert.equal(amounts.bucketCount, 1);
  assert.equal(amounts.resultCount, 1);
});

test('openai costs service fetches official OpenAI cost summary and converts USD to EUR', async () => {
  const calls = [];
  const summary = await fetchOpenAiCostSummary(
    {
      openAiCostsApiKey: 'cost-key',
      openAiOrganizationId: 'org-correct',
      openAiProjectId: 'proj-correct',
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
  assert.match(calls[0].url, /project_ids=proj-correct/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer cost-key');
  assert.equal(calls[0].options.headers['OpenAI-Organization'], 'org-correct');
  assert.equal(calls[0].options.headers['OpenAI-Project'], 'proj-correct');
  assert.equal(summary.exact, true);
  assert.equal(summary.source, 'openai-costs');
  assert.equal(summary.costUsd, 10);
  assert.equal(summary.costEur, 10.25);
  assert.equal(summary.usdToEurRateSource, 'configured');
  assert.deepEqual(summary.currencies, { usd: 10, eur: 1.25 });
});

test('openai costs service retries temporary OpenAI Costs API failures', async () => {
  const calls = [];
  const summary = await fetchOpenAiCostSummary(
    {
      openAiCostsApiKey: 'cost-key',
      openAiApiBaseUrl: 'https://api.openai.test/v1',
      openAiCostsFetchRetries: 1,
      openAiCostsRetryDelayMs: 0,
      usdToEurRate: 1,
      logger: { info() {} },
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) {
          return {
            response: { ok: false, status: 500 },
            data: { error: { message: 'temporary server error' } },
          };
        }
        return {
          response: { ok: true, status: 200 },
          data: {
            data: [
              {
                results: [
                  { amount: { value: 3.5, currency: 'usd' } },
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

  assert.equal(calls.length, 2);
  assert.equal(summary.costUsd, 3.5);
  assert.equal(summary.costEur, 3.5);
});

test('openai costs service can convert OpenAI USD costs with a live exchange rate', async () => {
  const calls = [];
  const summary = await fetchOpenAiCostSummary(
    {
      openAiCostsApiKey: 'cost-key',
      openAiApiBaseUrl: 'https://api.openai.test/v1',
      exchangeRateApiUrl: 'https://rates.test/latest?from=USD&to=EUR',
      usdToEurRateCache: {},
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        if (url.startsWith('https://rates.test/')) {
          return {
            response: { ok: true, status: 200 },
            data: { rates: { EUR: 0.8 } },
          };
        }
        return {
          response: { ok: true, status: 200 },
          data: {
            data: [
              {
                results: [
                  { amount: { value: 10, currency: 'usd' } },
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

  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /^https:\/\/api\.openai\.test\/v1\/organization\/costs\?/);
  assert.equal(calls[1].url, 'https://rates.test/latest?from=USD&to=EUR');
  assert.equal(summary.costUsd, 10);
  assert.equal(summary.costEur, 8);
  assert.equal(summary.usdToEurRate, 0.8);
  assert.equal(summary.usdToEurRateSource, 'live');
});

test('anthropic costs service fetches official Claude cost report and converts cents to EUR', async () => {
  const calls = [];
  const summary = await fetchAnthropicCostSummary(
    {
      anthropicCostsApiKey: 'anthropic-admin-key',
      anthropicCostsApiBaseUrl: 'https://api.anthropic.test/v1',
      usdToEurRate: 0.9,
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        return {
          response: { ok: true, status: 200 },
          data: {
            data: [
              {
                results: [
                  { input_cost: '1000', output_cost: '250' },
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
  assert.match(calls[0].url, /^https:\/\/api\.anthropic\.test\/v1\/organizations\/cost_report\?/);
  assert.match(calls[0].url, /bucket_width=1d/);
  assert.equal(calls[0].options.headers['x-api-key'], 'anthropic-admin-key');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(summary.exact, true);
  assert.equal(summary.source, 'anthropic-costs');
  assert.equal(summary.costUsd, 12.5);
  assert.equal(summary.costEur, 11.25);
});

test('combined api costs use only OpenAI organization costs', async () => {
  const summary = await fetchCombinedApiCostSummary(
    {
      openAiCostsApiKey: 'openai-admin-key',
      usdToEurRate: 0.9,
      fetchJsonWithTimeout: async (url) => {
        return {
          response: { ok: true, status: 200 },
          data: { data: [{ results: [{ amount: { value: 25.18, currency: 'usd' } }] }], has_more: false },
        };
      },
      openAiCostsApiBaseUrl: 'https://api.openai.test/v1',
    },
    { scope: 'month', nowMs: Date.UTC(2026, 3, 29, 9, 0, 0) }
  );

  assert.equal(summary.exact, true);
  assert.equal(summary.source, 'api-costs');
  assert.equal(summary.costUsd, 25.18);
  assert.equal(summary.costEur, 22.66);
  assert.equal(summary.providers.length, 1);
  assert.equal(summary.providers[0].source, 'openai-costs');
  assert.deepEqual(summary.unavailable, []);
});

test('combined api costs fall back to live usage estimate when official costs lag behind', async () => {
  const calls = [];
  const summary = await fetchCombinedApiCostSummary(
    {
      openAiCostsApiKey: 'openai-admin-key',
      openAiProjectId: 'proj-softora',
      usdToEurRate: 0.9,
      fetchJsonWithTimeout: async (url) => {
        calls.push(url);
        if (url.includes('/organization/costs')) {
          return {
            response: { ok: true, status: 200 },
            data: { data: [{ results: [] }], has_more: false },
          };
        }
        if (url.includes('/organization/usage/images')) {
          return {
            response: { ok: true, status: 200 },
            data: {
              data: [
                {
                  results: [
                    {
                      images: 2,
                      num_model_requests: 2,
                      model: 'gpt-image-2',
                      size: '1024x1536',
                      source: 'image.generation',
                      project_id: 'proj-softora',
                    },
                  ],
                },
              ],
              has_more: false,
            },
          };
        }
        return {
          response: { ok: true, status: 200 },
          data: { data: [{ results: [] }], has_more: false },
        };
      },
      openAiCostsApiBaseUrl: 'https://api.openai.test/v1',
    },
    { scope: 'month', nowMs: Date.UTC(2026, 4, 20, 23, 20, 0) }
  );

  assert.equal(summary.exact, false);
  assert.equal(summary.estimated, true);
  assert.equal(summary.source, 'api-costs');
  assert.equal(summary.costUsd, 0.33);
  assert.equal(summary.costEur, 0.3);
  assert.equal(summary.providers[0].source, 'openai-usage-estimate');
  assert.equal(summary.providers[0].imageCount, 2);
  assert.equal(summary.officialProvider.costUsd, 0);
  assert.match(calls.find((url) => url.includes('/organization/costs')), /project_ids=proj-softora/);
  assert.match(calls.find((url) => url.includes('/organization/usage/images')), /project_ids=proj-softora/);
});

test('openai usage estimate can estimate text token usage', async () => {
  const summary = await fetchOpenAiUsageEstimateSummary(
    {
      openAiCostsApiKey: 'openai-admin-key',
      usdToEurRate: 1,
      fetchJsonWithTimeout: async (url) => {
        if (url.includes('/organization/usage/completions')) {
          return {
            response: { ok: true, status: 200 },
            data: {
              data: [
                {
                  results: [
                    {
                      model: 'gpt-4.1',
                      input_tokens: 1000,
                      input_cached_tokens: 250,
                      output_tokens: 500,
                      num_model_requests: 1,
                    },
                  ],
                },
              ],
              has_more: false,
            },
          };
        }
        return {
          response: { ok: true, status: 200 },
          data: { data: [{ results: [] }], has_more: false },
        };
      },
      openAiCostsApiBaseUrl: 'https://api.openai.test/v1',
    },
    { scope: 'month', nowMs: Date.UTC(2026, 4, 20, 23, 20, 0) }
  );

  assert.equal(summary.source, 'openai-usage-estimate');
  assert.equal(summary.exact, false);
  assert.equal(summary.costUsd, 0.005625);
  assert.equal(summary.costEur, 0.01);
  assert.equal(summary.requestCount, 1);
  assert.equal(summary.inputTokens, 1000);
  assert.equal(summary.cachedInputTokens, 250);
  assert.equal(summary.outputTokens, 500);
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

test('openai costs dashboard builds all required periods', () => {
  const periods = buildOpenAiDashboardPeriods(Date.UTC(2026, 4, 7, 10, 30, 0));

  assert.deepEqual(periods.map((period) => period.key), [
    'current_month',
    'today',
    'last_7_days',
    'last_30_days',
  ]);
  assert.equal(periods[0].label, 'Huidige maand tot nu toe');
  assert.equal(periods[1].label, 'Vandaag');
  assert.equal(periods[2].label, 'Afgelopen 7 dagen');
  assert.equal(periods[3].label, 'Afgelopen 30 dagen');
});

test('openai costs dashboard fetches official costs with pagination and cache', async () => {
  const calls = [];
  const cache = {};
  const logger = { info() {} };
  const snapshot = await fetchOpenAiCostsDashboardSnapshot(
    {
      env: { OPENAI_ADMIN_KEY: 'admin-key' },
      openAiApiBaseUrl: 'https://api.openai.test/v1',
      openAiCostsCache: cache,
      logger,
      fetchJsonWithTimeout: async (url, options) => {
        calls.push({ url, options });
        const parsed = new URL(url);
        const page = parsed.searchParams.get('page') || '';
        return {
          response: { ok: true, status: 200 },
          data: {
            data: [
              {
                results: [
                  { amount: { value: page ? 0.25 : 1.5, currency: 'usd' } },
                ],
              },
            ],
            has_more: !page,
            next_page: page ? null : 'next-cursor',
          },
        };
      },
    },
    { nowMs: Date.UTC(2026, 4, 7, 10, 30, 0) }
  );

  assert.equal(snapshot.status, 'success');
  assert.equal(snapshot.source, 'openai-organization-costs');
  assert.equal(snapshot.endpoint, '/v1/organization/costs');
  assert.equal(snapshot.exact, true);
  assert.equal(snapshot.currency, 'usd');
  assert.equal(snapshot.currentMonth.amount, 1.75);
  assert.equal(snapshot.periods.today.amount, 1.75);
  assert.equal(snapshot.periods.last_7_days.amount, 1.75);
  assert.equal(snapshot.periods.last_30_days.amount, 1.75);
  assert.equal(snapshot.cache.hit, false);
  assert.equal(calls.length, 8);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer admin-key');
  assert.match(calls[0].url, /^https:\/\/api\.openai\.test\/v1\/organization\/costs\?/);
  assert.match(calls[1].url, /page=next-cursor/);

  const cachedSnapshot = await fetchOpenAiCostsDashboardSnapshot(
    {
      env: { OPENAI_ADMIN_KEY: 'admin-key' },
      openAiApiBaseUrl: 'https://api.openai.test/v1',
      openAiCostsCache: cache,
      logger,
      fetchJsonWithTimeout: async () => {
        throw new Error('cache should prevent a second API call');
      },
    },
    { nowMs: Date.UTC(2026, 4, 7, 10, 31, 0) }
  );

  assert.equal(cachedSnapshot.cache.hit, true);
  assert.equal(cachedSnapshot.currentMonth.amount, 1.75);
});

test('openai costs dashboard returns a safe error payload with last success', async () => {
  const cache = {
    lastSuccessfulSnapshot: {
      status: 'success',
      currentMonth: { amount: 11.22, currency: 'usd' },
      lastSuccessfulUpdate: '2026-05-07T10:30:00.000Z',
    },
  };
  const coordinator = createOpenAiCostSummaryCoordinator({
    env: {},
    openAiCostsCache: cache,
    logger: { info() {} },
    fetchJsonWithTimeout: async () => ({ response: { ok: true, status: 200 }, data: {} }),
  });

  let statusCode = 0;
  let payload = null;
  await coordinator.sendOpenAiCostsDashboardResponse(
    { query: {} },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return body;
      },
    }
  );

  assert.equal(statusCode, 503);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'error');
  assert.equal(payload.message, 'OpenAI kosten konden niet worden opgehaald');
  assert.equal(payload.error, 'OPENAI_ADMIN_KEY_MISSING');
  assert.equal(payload.lastSuccessful.currentMonth.amount, 11.22);
  assert.doesNotMatch(JSON.stringify(payload), /€0|0,00/);
});

test('openai cost summary exposes safe upstream diagnostics without leaking keys', async () => {
  const coordinator = createOpenAiCostSummaryCoordinator({
    env: {
      OPENAI_ADMIN_API_KEY: 'admin-key',
      OPENAI_ORGANIZATION_ID: 'org-softora',
      OPENAI_PROJECT_ID: 'proj-softora',
    },
    fetchJsonWithTimeout: async () => ({
      response: { ok: false, status: 401 },
      data: {
        error: {
          message: 'Incorrect API key provided: sk-secret123',
        },
      },
    }),
  });

  let statusCode = 0;
  let payload = null;
  await coordinator.sendCostSummaryResponse(
    { query: { scope: 'month' } },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(body) {
        payload = body;
        return body;
      },
    }
  );

  assert.equal(statusCode, 502);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'OPENAI_COSTS_FETCH_FAILED');
  assert.equal(payload.upstreamStatus, 401);
  assert.equal(payload.config.adminKeyConfigured, true);
  assert.equal(payload.config.organizationConfigured, true);
  assert.equal(payload.config.projectConfigured, true);
  assert.match(payload.detail, /Incorrect API key provided/);
  assert.doesNotMatch(payload.detail, /sk-secret123/);
});
