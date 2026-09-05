'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeadRadarService, classifySignal } = require('../../server/services/lead-radar');
const { parsePublicFeed, createLeadRadarScraperProvider } = require('../../server/services/lead-radar-public-scraper');
const { isGoogleAlertsFeed, parseDiscoveryFeed } = require('../../server/services/lead-radar-discovery-feeds');

const feedUrl = 'https://www.google.com/alerts/feeds/1/2';
const postUrl = 'https://www.linkedin.com/posts/ondernemer_website-activity-1234567890123456789-abcd';
const requestText = 'Ik zoek een goede webdesigner! Ik ben op zoek naar een goede en betaalbare WordPress-webdesigner die mij kan helpen om mijn bestaande website Voorbeeldbedrijf.nl verder uit te bouwen.';
const feed = `<feed><entry><title>Websitebouwer gezocht</title><link href="https://www.google.com/url?url=${encodeURIComponent(postUrl)}"/>
  <content>${requestText}</content><published>${new Date().toISOString()}</published></entry></feed>`;

function memoryDatabase() {
  const tables = new Map();
  return {
    tables,
    from(table) {
      if (!tables.has(table)) tables.set(table, []);
      let rows = tables.get(table), predicates = [], patch, single = false, countOnly = false;
      const query = {
        select(_columns, options) { countOnly = options?.head === true; return query; },
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        gte(key, value) { predicates.push(row => row[key] >= value); return query; },
        lt(key, value) { predicates.push(row => row[key] < value); return query; },
        not(key, _operator, value) { predicates.push(row => row[key] !== value); return query; },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query; },
        order() { return query; }, limit() { return query; }, range() { return query; },
        single() { single = true; return query; },
        update(value) { patch = value; return query; },
        insert(value) {
          const row = { ...value, id: `row-${rows.length + 1}`, started_at: new Date().toISOString() };
          rows.push(row); predicates.push(item => item === row); return query;
        },
        upsert(value) {
          let row = rows.find(item => item.fingerprint === value.fingerprint);
          if (row) Object.assign(row, value);
          else { row = { ...value, id: `row-${rows.length + 1}` }; rows.push(row); }
          predicates.push(item => item === row); return query;
        },
        then(resolve, reject) {
          const found = rows.filter(row => predicates.every(predicate => predicate(row)));
          if (patch) found.forEach(row => Object.assign(row, patch));
          return Promise.resolve({ data: countOnly ? null : single ? found[0] : found, count: found.length, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

function setup({ ageDays = 1, body = requestText, status = 200, undated = false } = {}) {
  const db = memoryDatabase();
  const published = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /');
    if (String(url) === feedUrl) return new Response(undated ? feed.replace(requestText, `${requestText} Gisteren besproken.`) : feed);
    if (parsed.hostname === 'www.linkedin.com') return new Response(`<link rel="canonical" href="${postUrl}"><script type="application/ld+json">${JSON.stringify({ articleBody: body, datePublished: undated ? undefined : published })}</script>`, { status });
    return new Response('<rss><channel/></rss>');
  };
  const env = { LEAD_RADAR_DISCOVERY_FEED_URLS: feedUrl, LEAD_RADAR_PUBLIC_FEED_URLS: 'https://example.org/empty-feed', LEAD_RADAR_SCRAPER_MIN_INTERVAL_MS: '0' };
  const provider = createLeadRadarScraperProvider({ env, fetchImpl });
  const service = createLeadRadarService({ env, provider, fetchImpl, isSupabaseConfigured: () => true, getSupabaseClient: () => db });
  return { service, db, provider, calls, published };
}

test('Discovery RSS bewaart de originele postlink en behandelt de alertdatum nooit als publicatiedatum', () => {
  const [item] = parseDiscoveryFeed(feed, feedUrl, parsePublicFeed);
  assert.equal(item.url, postUrl);
  assert.equal(item.platform, 'linkedin');
  assert.equal(item.source_verified, false);
  assert.equal(item.published_at, null);
  const marketplace = feed.replace(encodeURIComponent(postUrl), encodeURIComponent('https://freelancer.nl/opdracht/1'));
  assert.equal(parseDiscoveryFeed(marketplace, feedUrl, parsePublicFeed).length, 0);
  assert.equal(isGoogleAlertsFeed(feedUrl), true);
  for (const url of ['https://www.google.com/search?q=website', 'https://google.com.evil.test/alerts/feeds/1/2', 'http://www.google.com/alerts/feeds/1/2', `${feedUrl}?redirect=1`]) {
    assert.equal(isGoogleAlertsFeed(url), false);
  }
});

test('Een gerichte feed gaat via broncontrole naar opgeslagen en zichtbare LinkedIn-lead; herhalen dedupliceert', async () => {
  const { service, calls, published } = setup();
  const run = await service.runScan({ platforms: ['web'], websiteLookupLimit: 0, maxAgeDays: 31 });
  assert.equal(run.new_signal_count, 1);
  assert.equal(run.error_count, 0);
  const inbox = await service.listSignals();
  assert.equal(inbox.total, 1);
  assert.equal(inbox.signals[0].platform, 'linkedin');
  assert.equal(inbox.signals[0].published_at, published);
  assert.equal(inbox.signals[0].message_text, requestText);
  assert.equal(inbox.signals[0].source_verification_status, 'verified');
  assert.ok(calls.includes(postUrl));
  const repeated = await service.runScan({ platforms: ['web'], websiteLookupLimit: 0, maxAgeDays: 31 });
  assert.equal(repeated.new_signal_count, 0);
  assert.equal(repeated.duplicate_count, 1);
});

test('Nieuwe alerts over oude, gesloten of ontoegankelijke posts worden geen leads', async () => {
  for (const options of [{ ageDays: 40 }, { undated: true }, { body: `${requestText} Bedankt, ik heb inmiddels iemand gevonden.` }, { body: `Oproep gesloten! ${requestText}` }, { status: 403 }]) {
    const { service } = setup(options);
    const run = await service.runScan({ platforms: ['web'], websiteLookupLimit: 0, maxAgeDays: 31 });
    assert.equal(run.new_signal_count, 0);
    assert.equal((await service.listSignals()).total, 0);
  }
});

test('Import bevestigt de originele postdatum en blijft zichtbaar; een opgegeven recente datum kan een oude post niet toelaten', async () => {
  const input = { platform: 'linkedin', source_url: postUrl, message_text: requestText, published_at: new Date().toISOString() };
  const { service, published } = setup();
  const saved = await service.importSignal(input);
  assert.equal(saved.row.published_at, published);
  assert.equal(saved.row.source_verification_status, 'verified');
  assert.ok(!saved.row.score_reasons.includes('Publicatiedatum onbekend'));
  assert.equal((await service.listSignals()).total, 1);
  const old = setup({ ageDays: 40 });
  await assert.rejects(old.service.importSignal(input), /31 dagen/);
  assert.equal((await old.service.listSignals()).total, 0);
  assert.equal(classifySignal({ message_text: `${requestText} Ik heb inmiddels iemand gevonden.` }).isExcluded, true);
});

test('Natuurlijke aanvragen met rolmodifiers worden herkend zonder advies, reclame of vacatures toe te laten', () => {
  for (const message_text of [requestText, 'Ik zoek een goede webdesigner.', 'Wij zijn op zoek naar een ervaren freelance softwareontwikkelaar voor onze software.', 'Voor een nieuw platform zijn we op zoek naar een enthousiaste freelance websitebouwer die onze visie tot leven kan brengen.']) {
    const classified = classifySignal({ message_text });
    assert.equal(classified.role, 'prospect', message_text);
    assert.equal(classified.isExcluded, false, message_text);
  }
  for (const message_text of [
    'Ik zoek een goede webdesigner voor advies over mijn website. Ik wil zelf bouwen.',
    'Ik zoek tips over betaalbare tools. Als webdesigner bouw ik zelf mijn website.',
    'Wij zoeken een ervaren webdesigner om ons team te versterken. Vacature voor 40 uur per week.',
    'Wij bouwen websites. Zoek je een goede en betaalbare WordPress-webdesigner? Neem contact op.',
  ]) {
    assert.notEqual(classifySignal({ message_text }).role, 'prospect', message_text);
  }
});
