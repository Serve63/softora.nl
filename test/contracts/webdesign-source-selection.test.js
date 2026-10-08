'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const browserWindow = {};
const previousWindow = global.window;
try {
  global.window = browserWindow;
  require('../../assets/premium-database-webdesign-source-selection.js');
} finally {
  if (previousWindow === undefined) delete global.window;
  else global.window = previousWindow;
}
const { selectWebdesignSources, createWebdesignSourceSelectionResponse } = require('../../server/services/webdesign-source-selection');
const { createWebdesignSourceHistoryRepository } = require('../../server/repositories/webdesign-source-history');
const now = Date.parse('2026-10-07T12:00:00Z');
const target = { customerId: 'contract-a', websiteUrl: 'https://example.test/' };
const row = (patch = {}) => ({ customer_id: target.customerId, website_url: target.websiteUrl, status: 'error',
  finished_at: new Date(now - 60000).toISOString(), preparationPhase: 'failed',
  error: 'Websiteanalyse mislukt: Kon deze website niet ophalen (422).', ...patch });
const selected = (history, input = target, time = now) => selectWebdesignSources([input], history, time)[0];

test('transient source failures have bounded holds while image/provider failures remain eligible', () => {
  for (const error of ['Websiteanalyse mislukt: Kon deze website niet ophalen (422).',
    'Websiteanalyse mislukt: Kon deze website niet ophalen (503).',
    'Websiteanalyse mislukt: Websiteanalyse duurde te lang.']) {
    assert.equal(selected([row({ error })]).retryAt, now - 60000 + 30 * 60000);
    assert.equal(selected([row({ error })], target, now + 30 * 60000).eligible, true);
  }
  for (const preparationCode of ['WEBDESIGN_WEBSITE_DNS_MISSING', 'WEBDESIGN_WEBSITE_TLS_FAILED']) {
    assert.equal(selected([row({ preparationCode })]).retryAt, now - 60000 + 86400000);
  }
  const rejected = row({ rejected: true, preparationPhase: 'ready' });
  assert.equal(selected([rejected]).eligible, false);
  assert.equal(selected([rejected], target, now + 86400000).eligible, false);
  assert.equal(selected([row({ preparationPhase: 'ready', error: 'Upload mislukt (403).' })]).eligible, true);
  assert.equal(selected([row({ preparationPhase: 'ready', error: 'De homepage-screenshot is geblokkeerd of onleesbaar. Er is geen webdesign gemaakt of opgeslagen.' })]).requiresSourceRecheck, true);
  assert.equal(selected([row({ preparationPhase: '', error: 'De beeldgenerator gaf fout 422.' })]).eligible, true);
  assert.equal(selected([row({ error: 'Websiteanalyse mislukt: onbekende fout' })]).eligible, true);
});

test('confirmed source failures stay excluded across later batches until corrected or successful', () => {
  const failures = [
    row({ preparationPhase: 'ready', error: 'De homepage-screenshot is geblokkeerd, leeg of onleesbaar. Er is geen webdesign gemaakt of opgeslagen.' }),
    row({ preparationCode: 'WEBDESIGN_EMPTY_WEBSITE', error: 'Websiteanalyse mislukt: Websitebron onbruikbaar: lege pagina of te weinig leesbare inhoud.' }),
    row({ error: 'Websiteanalyse mislukt: Er kon te weinig bruikbare inhoud uit deze website worden gelezen.' }),
    row({ preparationCode: 'WEBDESIGN_WEBSITE_DNS_MISSING' }),
    row({ preparationCode: 'WEBDESIGN_WEBSITE_TLS_FAILED' }),
    row({ error: 'Websiteanalyse mislukt: De website weigert toegang (403); de bedrijfsinhoud kon niet worden gelezen.' }),
    row({ error: 'Websiteanalyse mislukt: De opgegeven websitepagina bestaat niet meer of is niet beschikbaar (404).' }),
    row({ error: 'Websiteanalyse mislukt: De website toont een toegangscontrole of blokkeerpagina; de bedrijfsinhoud kon niet worden gelezen.' }),
    row({ preparationPhase: 'ready', error: 'De beeldgenerator heeft dit ontwerp geweigerd via het veiligheidsfilter. Er is geen webdesign gemaakt of opgeslagen.' }),
  ];
  for (const failed of failures) {
    const decision = selected([failed], target, now + 7 * 86400000);
    assert.equal(decision.eligible, false);
    assert.equal(decision.requiresSourceRecheck, true);
    assert.ok(decision.reason && Number.isFinite(decision.retryAt));
    assert.equal(selected([failed, row({ error: 'Codex kon het ontwerp niet maken.', preparationPhase: 'ready', finished_at: new Date(now).toISOString() })]).eligible, false);
    assert.equal(selected([failed], { ...target, websiteUrl: 'https://corrected.test/' }).eligible, true);
    assert.equal(selected([failed, row({ status: 'done', finished_at: new Date(now).toISOString() })]).eligible, true);
  }
});

test('last completed success and a corrected website release the bulk source hold', () => {
  const failed = row({ rejected: true });
  assert.equal(selected([failed, row({ status: 'done', finished_at: new Date(now).toISOString() })]).eligible, true);
  assert.equal(selected([row({ status: 'done', finished_at: new Date(now - 120000).toISOString() }), failed]).eligible, false);
  for (const websiteUrl of ['http://example.test/', 'https://www.example.test/', 'https://example.test/bedrijfswebsite']) {
    assert.equal(selected([failed], { ...target, websiteUrl }).eligible, true);
  }
  assert.equal(selected([failed], { ...target, customerId: 'other-company' }).eligible, true);
  assert.equal(selected([row({ website_url: 'https://EXAMPLE.test/#top', rejected: true })]).eligible, false);
});

test('selection endpoint authenticates, validates and stops on missing or partial history', async () => {
  let calls = 0;
  const request = async (store, body = { targets: [target] }, owner = 'owner-contract') => {
    const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } };
    await createWebdesignSourceSelectionResponse({ ownerKeyFromReq: () => owner, now: () => now, dataOpsStore: store })({ body }, res);
    return res;
  };
  const store = { listWebdesignSourceHistory: async (owner, ids, since) => {
    calls++; assert.equal(owner, 'owner-contract'); assert.deepEqual(ids, [target.customerId]);
    assert.equal(since, undefined, 'confirmed source failures must not age out of the history query');
    return [row({ preparationCode: 'WEBDESIGN_EMPTY_WEBSITE', finished_at: new Date(now - 7 * 86400000).toISOString() })];
  } };
  assert.equal((await request(store, undefined, '')).statusCode, 401);
  assert.equal((await request(store, { targets: Array(251).fill(target) })).statusCode, 400);
  assert.equal(calls, 0);
  assert.equal((await request(store)).body.targets[0].eligible, false);
  for (const broken of [{}, { listWebdesignSourceHistory: async () => null }, { listWebdesignSourceHistory: async () => { throw new Error('offline'); } }]) {
    assert.equal((await request(broken)).statusCode, 503);
  }
});

test('repository paginates compact owner-scoped history and never accepts a partial result', async () => {
  const scopes = [], ranges = [], columns = [], timeFilters = [];
  const make = (fail) => createWebdesignSourceHistoryRepository({ TABLES: { webdesignJobs: 'jobs' },
    getWebdesignStatusReadOptions: () => ({}), createWebdesignJobStatusReadError: () => new Error('history unavailable'),
    run: async (_action, query) => {
      const builder = { select(value) { columns.push(value); return this; }, eq(...value) { scopes.push(value); return this; },
        in() { return this; }, gte(...value) { timeFilters.push(value); return this; }, order() { return this; }, range(...value) { ranges.push(value); return this; } };
      query({ from: () => builder });
      return ranges.length % 2 ? { ok: true, data: Array(500).fill(row()) } : (fail ? { ok: false } : { ok: true, data: [row()] });
    } });
  assert.equal((await make(false).listWebdesignSourceHistory('owner', ['id'], 'since')).length, 501);
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
  assert.deepEqual(scopes[0], ['owner_key', 'owner']);
  assert.deepEqual(timeFilters, [], 'an old source rejection remains visible to later batches');
  assert.doesNotMatch(columns[0], /(?:^|,)payload(?:,|$)|preparation:payload/);
  await assert.rejects(make(true).listWebdesignSourceHistory('owner', ['id'], 'since'), /history unavailable/);
});

function browserSelection(customers, requestJson) {
  return browserWindow.SoftoraDatabaseWebdesignSourceSelection.createController({ getSortedCustomers: (items) => items,
    getFilteredCustomers: () => customers, isWebdesignPhotoEligible: () => true, sourceFilter: {},
    resolveCustomerWebsiteUrl: (customer) => customer.website, requestJson });
}
const customers = Array.from({ length: 300 }, (_, index) => ({ id: String(index), bedrijf: 'Bedrijf ' + index, website: 'https://example' + index + '.test/' }));

test('bulk selection fills requested N past failed sources without creating attempts', async () => {
  const sizes = [];
  const controller = browserSelection(customers, async (items) => {
    sizes.push(items.length);
    return { targets: items.map((item) => ({ ...item, eligible: Number(item.customerId) >= 20, reason: 'Bron niet beschikbaar', retryAt: now + 60000 })) };
  });
  const result = await controller.getTargetsForBatch(100, 'all');
  assert.equal(result.targets.length, 100); assert.equal(result.targets[0].id, '20');
  assert.equal(result.targets[99].id, '119'); assert.equal(result.excluded.length, 20);
  assert.deepEqual(sizes, [100, 20]);
  assert.equal(controller.getTargets(100, 'all').length, 100);
});

test('bulk selection stops for incomplete history and returns empty when every source is deferred', async () => {
  const allExcluded = browserSelection(customers.slice(0, 3), async (items) => ({ targets: items.map((item) => ({ ...item, eligible: false, reason: 'Bronfout', retryAt: now + 60000 })) }));
  assert.equal((await allExcluded.getTargetsForBatch(10, 'all')).targets.length, 0);
  for (const reply of [{ targets: [] }, { targets: [target] }, { targets: [{ ...target, eligible: false }] }]) {
    await assert.rejects(browserSelection(customers.slice(0, 1), async () => reply).getTargetsForBatch(1, 'all'), /onvolledig/);
  }
  await assert.rejects(browserSelection(customers, async () => { throw new Error('offline'); }).getTargetsForBatch(1, 'all'), /offline/);
  const sizes = [];
  await browserSelection(customers, async (items) => { sizes.push(items.length); return { targets: items.map((item) => ({ ...item, eligible: true })) }; }).getTargetsForBatch(null, 'all');
  assert.deepEqual(sizes, [250, 50]);
});

test('screenshot transport exhaustion has only a short cooldown, without condemning the business source', () => {
  const failed = row({ preparationPhase: 'ready', error: 'De screenshotdiensten leverden na drie pogingen geen bruikbaar bronbeeld. Dit is een technische ophaalfout; de bedrijfswebsite is niet afgekeurd. Probeer later opnieuw.' });
  const result = selected([failed]);
  assert.equal(result.eligible, false);
  assert.equal(result.retryAt, now - 60000 + 30 * 60000);
  assert.equal(result.requiresSourceRecheck, undefined);
  assert.equal(selected([failed], target, now + 30 * 60000).eligible, true);
});
