const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCES, parseFeed, safeArticleUrl, createWorldWatcherService } = require('../../server/services/world-watcher');
const { registerWorldWatcherRoutes } = require('../../server/routes/world-watcher');
const { filterItems, project, currentSnapshot } = require('../../assets/world-watcher');
const NOW = Date.parse('2026-09-05T22:00:00Z'), HOUR = 3600000;
const feed = (...items) => '<rss xmlns:georss="http://www.georss.org/georss" xmlns:gdacs="http://www.gdacs.org"><channel>' + items.join('') + '</channel></rss>';
function item(source = SOURCES[0], { id = 'one', date = NOW - HOUR, title = 'Envoys discuss Ukraine peace', details = '', description = '<p>Published &amp; verified by the source</p>' } = {}) {
  return `<item><title><![CDATA[${title}]]></title><link>https://${source.hosts[0]}/news/${id}</link><description><![CDATA[${description}]]></description><pubDate>${new Date(date).toUTCString()}</pubDate>${details}</item>`;
}
const geo = (level = 'Orange', coords = '-6.2 106.8') => `<georss:point>${coords}</georss:point><gdacs:alertlevel>${level}</gdacs:alertlevel><gdacs:eventtype>EQ</gdacs:eventtype><gdacs:country>Indonesia</gdacs:country>`;
const xmlFor = (source) => feed(item(source, { details: source.id === 'gdacs' ? geo() : '' }));

test('World Watcher parses RSS CDATA and publisher dates, retaining original links and honest region precision', () => {
  const [parsed] = parseFeed(xmlFor(SOURCES[0]), SOURCES[0], NOW);
  assert.equal(parsed.description, 'Published & verified by the source');
  assert.equal(parsed.publishedAt, '2026-09-05T21:00:00.000Z');
  assert.equal(parsed.kind, 'geopolitics'); assert.equal(parsed.regionId, 'ukraine');
  assert.equal(parsed.locationPrecision, 'region'); assert.equal(parsed.level, 'news');
  const [unlocated] = parseFeed(feed(item(SOURCES[1], { title: 'Een nieuw museum opent', description: '' })), SOURCES[1], NOW);
  assert.equal(unlocated.kind, 'world'); assert.equal(unlocated.lat, null); assert.equal(unlocated.regionId, null);
});
test('World Watcher IDs survive reordered feeds and entries are deduplicated by safe source URL', () => {
  const a = item(), b = item(SOURCES[0], { id: 'two' });
  const first = parseFeed(feed(a, b, a), SOURCES[0], NOW), second = parseFeed(feed(b, a), SOURCES[0], NOW);
  assert.equal(first.length, 2); assert.equal(first[0].id, second[1].id); assert.notEqual(first[0].id, first[1].id);
});
test('World Watcher rejects off-source links, credentials, unusual ports and executable URLs', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://www.bbc.com.example.org/story', 'https://example.org/', 'https://user:pass@www.bbc.com/story', 'https://www.bbc.com:8443/story', '/relative']) assert.equal(safeArticleUrl(url, SOURCES[0]), null, url);
  assert.equal(safeArticleUrl('http://www.bbc.co.uk/news/1', SOURCES[0]), 'https://www.bbc.co.uk/news/1');
  assert.equal(parseFeed(feed(item().replace('https://www.bbc.co.uk/news/one', 'https://example.org/')), SOURCES[0], NOW).length, 0);
});
test('World Watcher omits missing, invalid, old and future publication dates and malformed documents', () => {
  const invalid = item().replace(/<pubDate>.*?<\/pubDate>/, '<pubDate>unknown</pubDate>');
  const missing = item().replace(/<pubDate>.*?<\/pubDate>/, '');
  assert.equal(parseFeed(feed(invalid, missing, item(SOURCES[0], { id: 'old', date: NOW - 8 * 24 * HOUR }), item(SOURCES[0], { id: 'future', date: NOW + HOUR })), SOURCES[0], NOW).length, 0);
  assert.throws(() => parseFeed('<html>Service unavailable</html>', SOURCES[0], NOW), /INVALID_FEED/);
  assert.throws(() => parseFeed('<rss><channel>', SOURCES[0], NOW), /INVALID_FEED/);
});
test('GDACS uses published impact levels and validated latitude/longitude, never news risk scores', () => {
  const [parsed] = parseFeed(xmlFor(SOURCES[2]), SOURCES[2], NOW);
  assert.deepEqual([parsed.level, parsed.lat, parsed.lon, parsed.eventType, parsed.locationPrecision], ['orange', -6.2, 106.8, 'Aardbeving', 'provider']);
  for (const details of [geo('critical'), geo('Red', '91 10'), geo('Red', '10 181'), geo('Red', 'x 2'), geo('Red', ''), '']) assert.equal(parseFeed(feed(item(SOURCES[2], { details })), SOURCES[2], NOW).length, 0);
});
test('GDACS caps its selection but retains higher impact alerts before newer green reports', () => {
  const green = Array.from({ length: 70 }, (_, id) => item(SOURCES[2], { id: String(id), details: geo('Green'), date: NOW - (id + 1) * 60000 }));
  const parsed = parseFeed(feed(...green, item(SOURCES[2], { id: 'red', details: geo('Red'), date: NOW - 24 * HOUR }), item(SOURCES[2], { id: 'orange', details: geo('Orange'), date: NOW - 2 * HOUR })), SOURCES[2], NOW);
  assert.equal(parsed.length, 60); assert.deepEqual(parsed.slice(0, 2).map((entry) => entry.level), ['red', 'orange']);
  assert.equal(parseFeed(feed(...Array.from({ length: 50 }, (_, id) => item(SOURCES[0], { id: String(id) }))), SOURCES[0], NOW).length, 40);
});
test('World Watcher shares requests and caches three public feeds for five minutes', async () => {
  let clock = NOW, calls = 0;
  const service = createWorldWatcherService({ now: () => clock, fetchImpl: async (url, options) => { calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal); return new Response(xmlFor(SOURCES.find((source) => source.url === url))); } });
  const [a, b] = await Promise.all([service.getSnapshot(), service.getSnapshot()]);
  assert.equal(calls, 3); assert.strictEqual(a, b); assert.equal(a.ok, true); assert.equal(a.items.length, 3);
  clock += 299999; assert.strictEqual(await service.getSnapshot(), a); assert.equal(calls, 3);
  clock++; await service.getSnapshot(); assert.equal(calls, 6);
});
test('World Watcher isolates failed sources, retries after 30 seconds and expires old data after one hour', async () => {
  let clock = NOW, failed = false, calls = 0;
  const service = createWorldWatcherService({ now: () => clock, fetchImpl: async (url) => { calls++; const source = SOURCES.find((candidate) => candidate.url === url); if (failed && source.id === 'bbc') throw new Error('upstream failure'); return new Response(xmlFor(source)); } });
  await service.getSnapshot(); failed = true; clock += 300000;
  const partial = await service.getSnapshot(); assert.equal(partial.ok, true); assert.equal(partial.sources[0].status, 'stale'); assert.equal(partial.items.find((entry) => entry.source === 'bbc').stale, true); assert.equal(partial.sources[1].status, 'ready');
  clock += 29999; await service.getSnapshot(); assert.equal(calls, 6); clock++; await service.getSnapshot(); assert.equal(calls, 9);
  clock = NOW + HOUR; const expired = await service.getSnapshot(); assert.equal(expired.sources[0].status, 'unavailable'); assert.equal(expired.sources[0].count, null); assert.equal(expired.items.some((entry) => entry.source === 'bbc'), false);
});
test('World Watcher fails honestly when feeds return errors, invalid content or oversized bodies', async () => {
  const service = createWorldWatcherService({ now: () => NOW, fetchImpl: async (url) => url === SOURCES[0].url ? new Response('error', { status: 502 }) : url === SOURCES[1].url ? new Response('<html>blocked</html>') : new Response('x'.repeat(2500001)) });
  const snapshot = await service.getSnapshot(); assert.equal(snapshot.ok, false); assert.equal(snapshot.items.length, 0); assert.ok(snapshot.sources.every((source) => source.status === 'unavailable'));
});

function routeFor(deps) { let handlers; registerWorldWatcherRoutes({ get(route, ...stack) { assert.equal(route, '/api/world-watcher'); handlers = stack; } }, deps); return handlers; }
function response() { return { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } }; }
test('World Watcher requires the wired premium admin middleware before reading any sources', async () => {
  let reads = 0; const service = { getSnapshot() { reads++; return { ok: true, items: [] }; } };
  for (const status of [401, 403]) {
    const guard = (_req, res) => res.status(status).json({ ok: false }), handlers = routeFor({ service, requirePremiumAdminApiAccess: guard }), res = response();
    assert.strictEqual(handlers[0], guard); await handlers[0]({}, res, () => handlers[1]({}, res)); assert.equal(res.statusCode, status);
  }
  assert.equal(reads, 0); const res = response(); routeFor({ service })[0]({}, res); assert.equal(res.statusCode, 503); assert.equal(reads, 0);
  const wiring = fs.readFileSync(path.join(__dirname, '../../server/services/feature-routes-runtime.js'), 'utf8');
  assert.match(wiring, /registerWorldWatcherRoutes\(app,\s*\{\s*requirePremiumAdminApiAccess: premiumRouteRuntime\?\.requirePremiumAdminApiAccess/);
});
test('World Watcher admin route returns private data and 503 for complete source failure', async () => {
  for (const ok of [true, false]) { const data = { ok, items: [] }, res = response(), handlers = routeFor({ requirePremiumAdminApiAccess: (_req, _res, next) => next(), service: { async getSnapshot() { return data; } } }); await handlers[0]({}, res, () => handlers[1]({}, res)); assert.equal(res.statusCode, ok ? 200 : 503); assert.deepEqual(res.body, data); assert.equal(res.headers['Cache-Control'], 'no-store, private'); }
  const res = response(); await routeFor({ service: { getSnapshot() { throw new Error('private error details'); } } })[1]({}, res); assert.equal(res.statusCode, 503); assert.doesNotMatch(JSON.stringify(res.body), /private error/);
});
test('World Watcher combines accent-insensitive search, kind and region filters without dropping unlocated news', () => {
  const entries = [{ title: 'Oekraïne vrede', kind: 'geopolitics', regionId: 'ukraine', sourceName: 'NOS' }, { title: 'Oekraïne museum', kind: 'world', regionId: 'ukraine' }, { title: 'International agreement', kind: 'geopolitics', regionId: null }];
  assert.equal(filterItems(entries, { kind: 'geopolitics' }).length, 2);
  assert.deepEqual(filterItems(entries, { kind: 'geopolitics', query: 'oekraine nos', region: 'ukraine' }), [entries[0]]); assert.equal(filterItems(entries, { query: 'nonexistent' }).length, 0);
  assert.deepEqual(project(85, -180), { x: 0, y: 0 }); assert.deepEqual(project(-60, 180), { x: 100, y: 100 });
});
test('browser cache becomes visibly stale on disconnect and removes expired source data without mutation', () => {
  const snapshot = { sources: [{ id: 'bbc', status: 'ready', fetchedAt: new Date(NOW).toISOString(), count: 1 }], items: [{ id: 'one', source: 'bbc' }], regions: [] };
  const stale = currentSnapshot(snapshot, true, NOW + 60000); assert.equal(stale.sources[0].status, 'stale'); assert.equal(stale.items[0].stale, true); assert.equal(snapshot.sources[0].status, 'ready');
  assert.equal(currentSnapshot(snapshot, false, NOW + 316000).sources[0].status, 'stale');
  const expired = currentSnapshot(snapshot, true, NOW + HOUR); assert.equal(expired.sources[0].status, 'unavailable'); assert.equal(expired.items.length, 0); assert.equal(expired.sources[0].count, null);
});
test('World Watcher ships an accessible map and original source links with external page logic', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../premium-world-watcher.html'), 'utf8'), script = fs.readFileSync(path.join(__dirname, '../../assets/world-watcher.js'), 'utf8');
  assert.match(html, /name="robots" content="noindex, nofollow"/); assert.match(html, /world-watcher\.js\?v=20260906a/); assert.match(html, /id="ww-map-viewport" tabindex="0"/); assert.match(html, /aria-labelledby="ww-about-title"/); assert.match(html, /Nieuws = regiopunt/); assert.match(html, /kleuren zijn geen score voor oorlogsdreiging/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/); assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage/); assert.match(script, /noopener noreferrer/); assert.match(script, /visibilitychange/);
});
