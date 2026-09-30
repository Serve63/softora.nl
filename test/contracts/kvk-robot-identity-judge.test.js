const test = require('node:test');
const assert = require('node:assert/strict');
const { createKvkApiWorkersService } = require('../../server/services/kvk-api-workers');
const { createKvkRobotIdentityJudge, MODEL } = require('../../server/services/kvk-robot-identity-judge');

const QUESTION = {
  company: { bedrijfsnaam: 'aaciree Trimsalon', kvk_nummer: '58400052', straatnaam: 'Kerkstraat', plaats: 'Berkel-Enschot' },
  host: 'aaciree.nl',
  pageText: 'Trimsalon Aaciree Kerkstraat 7d Berkel-Enschot. Telefoon 013 5906564. Mail info@aaciree.nl.',
};

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function providerReply(answer, ok = true, status = 200) {
  return async () => ({
    ok,
    status,
    json: async () => ({
      status: 'completed',
      usage: { input_tokens: 700, output_tokens: 40 },
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }],
    }),
  });
}

test('the identity judge asks GPT-6 Luna one fixed-answer question and returns its verdict and quote', async () => {
  const calls = [];
  const judge = createKvkRobotIdentityJudge({
    getApiKey: () => 'test-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return providerReply({ verdict: 'same_company', quote: 'Trimsalon Aaciree Kerkstraat 7d Berkel-Enschot.' })();
    },
  });
  const result = await judge.judge(QUESTION);
  assert.equal(result.status, 200);
  assert.deepEqual([result.body.verdict, result.body.quote], ['same_company', 'Trimsalon Aaciree Kerkstraat 7d Berkel-Enschot.']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].body.model, MODEL);
  assert.equal(MODEL, 'gpt-6-luna');
  assert.equal(calls[0].body.store, false);
  assert.deepEqual(calls[0].body.text.format.schema.properties.verdict.enum, ['same_company', 'different_company', 'unclear']);
  assert.match(calls[0].body.input, /58400052/);
});

test('an invalid question or a missing key never reaches the model', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return providerReply({ verdict: 'same_company', quote: '' })(); };
  const withKey = createKvkRobotIdentityJudge({ getApiKey: () => 'test-key', fetchImpl });
  for (const body of [{}, { ...QUESTION, host: 'geen host' }, { ...QUESTION, company: { ...QUESTION.company, kvk_nummer: '12' } },
    { ...QUESTION, pageText: '   ' }]) {
    assert.equal((await withKey.judge(body)).status, 400);
  }
  const withoutKey = createKvkRobotIdentityJudge({ getApiKey: () => '', fetchImpl });
  assert.equal((await withoutKey.judge(QUESTION)).status, 503);
  assert.equal(calls, 0);
});

test('page text is capped and an unknown verdict is treated as unclear', async () => {
  let sent;
  const judge = createKvkRobotIdentityJudge({
    getApiKey: () => 'test-key',
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return providerReply({ verdict: 'maybe', quote: 'x' })(); },
  });
  const result = await judge.judge({ ...QUESTION, pageText: 'a'.repeat(50000) });
  assert.equal(result.body.verdict, 'unclear');
  assert.ok(sent.input.length < 9500);
});

test('the judge stops at its daily ceiling and reports provider failures without a verdict', async () => {
  const judge = createKvkRobotIdentityJudge({ getApiKey: () => 'k', fetchImpl: providerReply({ verdict: 'unclear', quote: '' }) });
  let last;
  for (let index = 0; index < 1501; index += 1) last = await judge.judge(QUESTION);
  assert.equal(last.status, 429);
  const failing = createKvkRobotIdentityJudge({ getApiKey: () => 'k', fetchImpl: providerReply({}, false, 500) });
  const failed = await failing.judge(QUESTION);
  assert.equal(failed.status, 502);
  assert.equal(failed.body.verdict, undefined);
});

test('the worker endpoint requires the worker token and uses the configured OpenAI key', async () => {
  const seen = [];
  const service = createKvkApiWorkersService({
    getSupabaseClient: () => null,
    kvkDatabaseSyncToken: 'test-worker-token',
    env: { OPENAI_API_KEY: 'configured-key' },
    identityJudge: createKvkRobotIdentityJudge({
      getApiKey: () => 'configured-key',
      fetchImpl: async (_url, options) => { seen.push(options.headers.Authorization); return providerReply({ verdict: 'different_company', quote: '' })(); },
    }),
  });
  const denied = response();
  await service.judgeIdentity({ headers: {}, body: QUESTION }, denied);
  assert.equal(denied.statusCode, 401);
  const allowed = response();
  await service.judgeIdentity({ headers: { authorization: 'Bearer test-worker-token' }, body: QUESTION }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body.verdict, 'different_company');
  assert.deepEqual(seen, ['Bearer configured-key']);
});

test('without a configured judge the worker endpoint answers 503 and never guesses', async () => {
  const service = createKvkApiWorkersService({ getSupabaseClient: () => null, kvkDatabaseSyncToken: 'test-worker-token', env: {} });
  const res = response();
  await service.judgeIdentity({ headers: { authorization: 'Bearer test-worker-token' }, body: QUESTION }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.verdict, undefined);
});

test('the runtime wires the judge with the existing server OpenAI key, outside the worker service', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const runtime = fs.readFileSync(path.join(__dirname, '../../server/services/feature-routes-runtime.js'), 'utf8');
  assert.match(runtime, /identityJudge: createKvkRobotIdentityJudge\(\{ getApiKey: \(\) => \(deps\.env \|\| process\.env\)\.OPENAI_API_KEY/);
  const routes = fs.readFileSync(path.join(__dirname, '../../server/routes/kvk-database.js'), 'utf8');
  assert.match(routes, /'\/api\/kvk-database\/api-workers\/identity-judge'/);
});

