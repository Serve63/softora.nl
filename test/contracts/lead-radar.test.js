'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildSearchPlan,
  buildSignalFromProviderItem,
  classifySignal,
  createDataForSeoProvider,
  getPublicPagePublicationDetails,
  createLeadRadarService,
  hasCompletedInitialBackfill,
  isLikelyDirectPlatformPostUrl,
  normalizeProviderPublishedAt,
  normalizeHttpUrl,
  normalizePlatform,
  scoreSignal,
} = require('../../server/services/lead-radar');
const {
  contentMatchScore,
  createLeadRadarSourceVerifier,
  extractPostId,
} = require('../../server/services/lead-radar-source');
const { registerLeadRadarRoutes } = require('../../server/routes/lead-radar');
const { createLeadRadarEnrichment } = require('../../server/services/lead-radar-enrichment');

const repoRoot = path.join(__dirname, '../..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('Lead Radar normaliseert alleen toegestane openbare URLs', () => {
  assert.equal(normalizePlatform('https://www.facebook.com/groups/softora/posts/1'), 'facebook');
  assert.equal(normalizePlatform('https://www.linkedin.com/posts/softora_website-123'), 'linkedin');
  assert.equal(normalizePlatform('https://www.instagram.com/p/abc123/'), '');
  assert.equal(normalizeHttpUrl('https://example.nl/bedrijf/#contact', { allowPlatform: false }), 'https://example.nl/bedrijf');
  assert.equal(normalizeHttpUrl('http://localhost:3000', { allowPlatform: false }), '');
  assert.equal(normalizeHttpUrl('https://192.168.1.10/site', { allowPlatform: false }), '');
  assert.equal(normalizeHttpUrl('file:///C:/secret.txt', { allowPlatform: false }), '');
});

test('Lead Radar bouwt kleine Facebook- en LinkedIn-queryfamilies met regionale dekking', () => {
  const nationwide = buildSearchPlan({ platforms: ['facebook', 'linkedin'], regionMode: 'nationwide', keywordGroups: ['direct_website'] });
  assert.ok(nationwide.length > 20);
  assert.ok(nationwide.some((item) => item.query.startsWith('site:facebook.com')));
  assert.ok(nationwide.some((item) => item.query.includes('site:linkedin.com/posts')));
  assert.ok(nationwide.filter((item) => item.platform === 'linkedin').every((item) => !item.query.includes('feed/update')));
  assert.deepEqual(new Set(nationwide.slice(0, 2).map((item) => item.platform)), new Set(['facebook', 'linkedin']));
  assert.ok(nationwide.every((item) => !item.query.includes('instagram')));
  assert.ok(nationwide.every((item) => item.query.includes('-marketingbureau')));
  assert.ok(nationwide.every((item) => item.query.includes('Nederland')));
  assert.deepEqual(nationwide.slice(0, 8).map((item) => item.platform), ['facebook', 'linkedin', 'facebook', 'linkedin', 'facebook', 'linkedin', 'facebook', 'linkedin']);

  const regional = buildSearchPlan({ platforms: ['facebook'], regionMode: 'regional', keywordGroups: ['webshop'] });
  assert.ok(regional.some((item) => item.region === 'Noord-Brabant'));
  assert.ok(regional.some((item) => item.region === 'Eindhoven'));

  const custom = buildSearchPlan({ platforms: ['linkedin'], regions: ['Oisterwijk', 'Noord-Brabant'], keywordGroups: ['direct_website'] });
  assert.deepEqual([...new Set(custom.map((item) => item.region))].sort(), ['Noord-Brabant', 'Oisterwijk']);

  const recent = buildSearchPlan({ platforms: ['facebook'], regions: ['Nederland'], keywordGroups: ['direct_website'], maxAgeDays: 7 });
  assert.ok(recent.every((item) => / after:\d{4}-\d{2}-\d{2}$/.test(item.query)));
});

test('Lead Radar accepteert alleen organische DataForSEO-resultaten en meldt betaalblokkades eerlijk', async () => {
  const responses = [
    {
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        status_message: 'Ok.',
        tasks: [{
          status_code: 20000,
          status_message: 'Ok.',
          result: [{
            datetime: '2026-08-19T10:00:00Z',
            items: [
              { type: 'organic', url: 'https://www.linkedin.com/posts/softora_website-123', title: 'Softora', description: 'Wij zoeken iemand voor onze website.' },
              { type: 'people_also_ask', url: 'https://www.facebook.com/groups/example/posts/2', title: 'Vraag', description: 'Geen organisch resultaat.' },
            ],
          }],
        }],
      }),
    },
    {
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        status_message: 'Ok.',
        tasks: [{ status_code: 40200, status_message: 'Payment Required.', result: null }],
      }),
    },
  ];
  const provider = createDataForSeoProvider({
    env: { LEAD_RADAR_DATAFORSEO_LOGIN: 'login', LEAD_RADAR_DATAFORSEO_PASSWORD: 'password' },
    fetchImpl: async () => responses.shift(),
  });
  const items = await provider.search({ query: 'site:linkedin.com/posts "website gezocht" Nederland' });
  assert.equal(items.length, 1);
  assert.match(items[0].url, /linkedin\.com\/posts/);
  await assert.rejects(
    provider.search({ query: 'site:facebook.com "website gezocht" Nederland' }),
    (error) => error.message === 'Payment Required.' && error.fatal === true && Number(error.providerStatusCode) === 40200
  );
});

test('Lead Radar scoreert directe en recente websitevragen hoger', () => {
  const recent = scoreSignal({
    message_text: 'Wie kent een goede webdesigner? Ik heb dringend een website nodig voor mijn bedrijf in Eindhoven.',
    published_at: new Date().toISOString(),
    region: 'Eindhoven',
    engagement_known: false,
  }, { targetRegion: 'Eindhoven' });
  const old = scoreSignal({
    message_text: 'Website inspiratie gezocht.',
    published_at: new Date(Date.now() - 40 * 86_400_000).toISOString(),
    engagement_known: false,
  });
  assert.ok(recent.score > old.score);
  assert.ok(recent.reasons.includes('Bevat directe websitevraag'));
  assert.ok(recent.reasons.includes('Aantal reacties onbekend') || recent.reasons.includes('Engagement onbekend'));
});

test('Lead Radar filtert zelfpromotie van webbouwers zonder echte klantvraag', () => {
  const providerOne = {
    url: 'https://www.facebook.com/websitedesigner.nu',
    title: 'Websitedesigner',
    snippet: 'Wij bouwen websites & webshops + SEO optimalisatie voor meer bezoekers op je website. Website laten maken? Wij bouwen websites & webshops + online marketing.',
  };
  const providerTwo = {
    url: 'https://www.facebook.com/example/posts/123',
    title: '# Maatwerk website laten maken? * Volledig via programmering ...',
    snippet: 'Maatwerk website laten maken? Volledig via programmering ontworpen; Geschikt voor mobiel, tablet en computer; Gemakkelijk zelf wijzigingen doorvoeren.',
  };
  const prospect = {
    url: 'https://www.facebook.com/kapsalonnijlen/posts/123',
    title: 'Kapsalon Nijlen',
    snippet: 'Beste we zijn opzoek naar iemand die een website kan maken. Neem gerust contact met ons op.',
    timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  };

  assert.equal(classifySignal(providerOne).role, 'provider');
  assert.equal(classifySignal(providerTwo).role, 'provider');
  assert.equal(buildSignalFromProviderItem(providerOne, { region: 'Nederland' }), null);
  assert.equal(buildSignalFromProviderItem(providerTwo, { region: 'Nederland' }), null);
  assert.ok(buildSignalFromProviderItem(prospect, { region: 'Nijlen' }));
});

test('Lead Radar houdt echte ondernemersvragen en websitebouwers uit elkaar', () => {
  const classify = (title, snippet) => classifySignal({
    title,
    snippet,
    url: 'https://www.facebook.com/example/posts/123',
  });

  const agency = classify(
    'Roweb Webdesign | Deurne',
    'Wilt u voor een scherpe prijs een WordPress website laten bouwen? Wij bouwen websites voor bedrijven.'
  );
  const vacancy = classify(
    'Effectief B.V.',
    'VACATURE: ervaren webdeveloper gezocht. Wij zoeken een fulltime collega om ons team te versterken.'
  );
  const productSearch = classify(
    'Marketplace',
    'Nederlandse website gezocht naar een identieke auto, nergens te koop of te vinden.'
  );
  const webshopOwner = classify(
    'Noor Van Dam',
    'WEBdesigner gezocht. Ik zoek iemand die mijn webshop kan verbeteren en professioneler kan maken.'
  );
  const butcher = classify(
    'Slagerij Echt Ambachtelijk',
    'WEBSITEBOUWER GEZOCHT! WIE HELPT.'
  );

  assert.equal(agency.role, 'provider');
  assert.equal(vacancy.role, 'excluded');
  assert.equal(productSearch.isWebsiteNeed, false);
  assert.equal(classifySignal({ title: 'Team Rood', snippet: 'ZZP\'ers en bedrijven zonder website opgelet! Wil jij een website laten ontwikkelen? Dan is dit je kans.' }).role, 'provider');
  assert.equal(classifySignal({ title: 'Fine Graphic', snippet: 'GumFree heeft een nieuwe website laten ontwikkelen door Fine Graphic.' }).role, 'provider');
  assert.equal(webshopOwner.role, 'prospect');
  assert.equal(butcher.role, 'prospect');
  assert.equal(classifySignal({ title: 'Algemene pagina', snippet: 'Maatwerk website laten maken? Volledig via programmering ontworpen.' }).role, 'provider');
  assert.equal(classifySignal({ title: 'Algemene pagina', snippet: 'Website laten maken.' }).role, 'unclear');
  assert.equal(buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/124',
    title: 'Marketplace',
    snippet: productSearch.message || 'Nederlandse website gezocht naar een identieke auto.',
  }, { region: 'Nederland' }), null);
});

test('Lead Radar behandelt een website-link uit een bericht eerst als kandidaat', () => {
  const signal = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/123',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner. Bekijk onze huidige website https://voorbeeld.nl',
    timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  }, { region: 'Eindhoven', query: 'site:facebook.com website gezocht Eindhoven', keywordGroup: 'direct_website' });
  assert.equal(signal.website_url, 'https://voorbeeld.nl');
  assert.equal(signal.website_status, 'website_not_checked');
  assert.equal(signal.website_source, 'post');
});

test('Lead Radar houdt directe posts zonder publicatiedatum zichtbaar en filtert bekende oude posts', () => {
  const recentTimestamp = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const recent = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/123',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner voor onze website.',
    timestamp: recentTimestamp,
    datetime: new Date().toISOString(),
  }, { region: 'Eindhoven', maxAgeDays: 30, requireFresh: true });
  const old = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/124',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner voor onze website.',
    timestamp: new Date(Date.now() - 45 * 86_400_000).toISOString(),
  }, { region: 'Eindhoven', maxAgeDays: 30, requireFresh: true });
  const profileOnly = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner voor onze website.',
    timestamp: recentTimestamp,
  }, { region: 'Eindhoven', maxAgeDays: 30, requireFresh: true });

  assert.equal(normalizeProviderPublishedAt({ datetime: recentTimestamp }), null);
  assert.equal(normalizeProviderPublishedAt({ date: '17 aug 2026', retrieved_at: '2026-08-17T18:00:00.000Z' }), '2026-08-17T00:00:00.000Z');
  assert.equal(normalizeProviderPublishedAt({ date: '3 dagen geleden', retrieved_at: '2026-08-17T18:00:00.000Z' }), '2026-08-14T18:00:00.000Z');
  assert.equal(normalizeProviderPublishedAt({ snippet: 'Gevonden op 17 aug 2026', retrieved_at: '2026-08-17T18:00:00.000Z' }), '2026-08-17T00:00:00.000Z');
  assert.equal(isLikelyDirectPlatformPostUrl('https://www.facebook.com/example/posts/123', 'facebook'), true);
  assert.equal(isLikelyDirectPlatformPostUrl('https://www.facebook.com/example', 'facebook'), false);
  assert.equal(isLikelyDirectPlatformPostUrl('https://www.linkedin.com/posts/softora_website-123', 'linkedin'), true);
  assert.equal(isLikelyDirectPlatformPostUrl('https://www.linkedin.com/company/softora', 'linkedin'), false);
  assert.ok(recent);
  assert.equal(old, null);
  assert.equal(profileOnly, null);
  assert.equal(buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner voor onze website.',
    timestamp: recentTimestamp,
  }, { region: 'Eindhoven' }), null);
  const undated = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/125',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner voor onze website.',
  }, { region: 'Eindhoven' });
  assert.ok(undated);
  assert.equal(undated.published_at, null);
  assert.equal(undated.publication_date_source, 'unknown');
});

test('Lead Radar haalt de publicatiedatum uit openbare postmetadata wanneer SERP geen datum levert', () => {
  const meta = getPublicPagePublicationDetails(
    '<meta property="article:published_time" content="2026-08-17T11:32:00+00:00">',
    '2026-08-18T12:00:00.000Z'
  );
  assert.equal(meta.publishedAt, '2026-08-17T11:32:00.000Z');
  assert.equal(meta.source, 'post_meta');

  const jsonLd = getPublicPagePublicationDetails(
    '<script type="application/ld+json">{"datePublished":"2026-08-16T09:00:00Z"}</script>',
    '2026-08-18T12:00:00.000Z'
  );
  assert.equal(jsonLd.publishedAt, '2026-08-16T09:00:00.000Z');
  assert.equal(jsonLd.source, 'post_jsonld');
});

test('Lead Radar bevestigt dat posttekst, directe URL en publicatiedatum bij elkaar horen', async () => {
  const sourceUrl = 'https://www.facebook.com/groups/2998390776854288/posts/28421724800760869';
  const expected = 'Is er iemand die een website kan maken voor me? Gaat om beauty en het boeken van afspraken.';
  const verifier = createLeadRadarSourceVerifier({
    normalizeHttpUrl,
    getPublicPagePublicationDetails,
    fetchImpl: async () => ({
      status: 200,
      text: async () => `<html><head>
        <link rel="canonical" href="${sourceUrl}">
        <meta property="og:description" content="${expected}">
        <meta property="article:published_time" content="2026-08-18T09:15:00Z">
      </head></html>`,
    }),
  });
  const result = await verifier.verifyPublicSource(sourceUrl, { expectedText: expected });
  assert.equal(result.status, 'verified');
  assert.equal(result.publication.publishedAt, '2026-08-18T09:15:00.000Z');
  assert.equal(result.postId, 'facebook:28421724800760869');
  assert.ok(result.contentMatchScore >= 90);
});

test('Lead Radar weigert een aantrekkelijke snippet die naar een andere Facebook-post wijst', async () => {
  const sourceUrl = 'https://www.facebook.com/groups/2998390776854288/posts/28421724800760869';
  const verifier = createLeadRadarSourceVerifier({
    normalizeHttpUrl,
    getPublicPagePublicationDetails,
    fetchImpl: async () => ({
      status: 200,
      text: async () => `<html><head>
        <link rel="canonical" href="${sourceUrl}">
        <meta property="og:description" content="Ik ben eigenaar van interieurontwerp bedrijf Atelier Somia en zoek extra opdrachten.">
        <meta property="article:published_time" content="2026-06-29T09:15:00Z">
      </head></html>`,
    }),
  });
  const result = await verifier.verifyPublicSource(sourceUrl, {
    expectedText: 'Is er iemand die een website kan maken voor me? Gaat om beauty en het boeken van afspraken.',
  });
  assert.equal(result.status, 'rejected');
  assert.match(result.reason, /niet dezelfde aanvraagtekst/i);
  assert.ok(result.contentMatchScore < 65);
});

test('Lead Radar toont een login-shell zonder controleerbare tekst of datum niet als lead', async () => {
  const verifier = createLeadRadarSourceVerifier({
    normalizeHttpUrl,
    getPublicPagePublicationDetails,
    fetchImpl: async () => ({ status: 200, text: async () => '<html><body><div id="facebook-root"></div></body></html>' }),
  });
  const result = await verifier.verifyPublicSource(
    'https://www.facebook.com/groups/2998390776854288/posts/28421724800760869',
    { expectedText: 'Wij zoeken iemand die een website voor ons bedrijf kan maken.' }
  );
  assert.equal(result.status, 'unverified');
  assert.match(result.reason, /geen controleerbare posttekst/i);
  assert.equal(contentMatchScore('website gezocht', 'website gezocht'), 0);
  assert.equal(extractPostId('https://www.linkedin.com/feed/update/urn:li:activity:1234567890'), 'linkedin:1234567890');
});

test('Lead Radar laat echte ondernemersvragen staan en blokkeert advertenties en irrelevante posts', () => {
  assert.equal(classifySignal({ title: 'Afrodite Lucia', snippet: 'Is er iemand die een website kan maken voor me? Het gaat om beauty, voor het boeken van afspraken.' }).role, 'prospect');
  assert.equal(classifySignal({ title: 'StartupAmsterdam', snippet: 'Wij zijn op zoek naar iemand die een website kan maken voor een internationaal netwerk.' }).role, 'prospect');
  assert.equal(classifySignal({ title: 'Lenn Deville', snippet: 'Nexa Society is een privaat netwerk voor jonge bouwers. Beperkte plekken, founding circle is open.' }).role, 'unclear');
  assert.equal(classifySignal({ title: 'Natalia Grab', snippet: 'In welke taal lees jij ONLINE het meest? Meer Nederlands, meer Engels.' }).role, 'unclear');
});

test('Lead Radar controleert bestaande websitekandidaten voordat ze bevestigd worden', async () => {
  const existing = {
    id: '00000000-0000-0000-0000-000000000001',
    website_url: 'https://voorbeeld.nl',
    website_status: 'website_not_checked',
    website_source: 'post',
    website_candidates: [],
  };
  const updated = { ...existing };
  const db = {
    from() {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            limit: async () => ({ data: [existing], error: null }),
          };
          return chain;
        },
        update(patch) {
          Object.assign(updated, patch);
          const chain = {
            eq() { return chain; },
            select() { return { single: async () => ({ data: updated, error: null }) }; },
          };
          return chain;
        },
      };
    },
  };
  const service = createLeadRadarService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => db,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>Voorbeeld</title>' }),
    env: {},
  });
  const result = await service.lookupWebsite(existing.id);
  assert.equal(result.website_status, 'website_found');
  assert.equal(result.website_http_status, 200);
  assert.equal(result.website_title, 'Voorbeeld');
});

test('Lead Radar zoekt een openbare bedrijfswebsite en bewaart de klikbare kandidaat', async () => {
  const existing = {
    id: '00000000-0000-0000-0000-000000000002',
    author_name: 'Kapsalon Nijlen',
    region: 'Nijlen',
    message_text: 'Wij zoeken iemand die een website kan maken.',
    website_url: null,
    website_status: 'website_not_checked',
    website_candidates: [],
  };
  const updated = { ...existing };
  const db = {
    from() {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            limit: async () => ({ data: [existing], error: null }),
          };
          return chain;
        },
        update(patch) {
          Object.assign(updated, patch);
          const chain = {
            eq() { return chain; },
            select() { return { single: async () => ({ data: updated, error: null }) }; },
          };
          return chain;
        },
      };
    },
  };
  const service = createLeadRadarService({
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => db,
    provider: {
      configured: true,
      search: async () => [{ url: 'https://kapsalonnijlen.nl', title: 'Kapsalon Nijlen', snippet: 'Officiele website van Kapsalon Nijlen' }],
    },
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '<title>Kapsalon Nijlen</title>' }),
    env: {},
  });

  const result = await service.lookupWebsite(existing.id, { force: true });
  assert.equal(result.website_url, 'https://kapsalonnijlen.nl');
  assert.equal(result.website_status, 'website_found');
  assert.equal(result.website_source, 'public_search');
  assert.equal(result.website_http_status, 200);
  assert.equal(result.website_candidates[0].url, 'https://kapsalonnijlen.nl');
});

test('Lead Radar toont provider en opslagstatus zonder nepresultaten', async () => {
  const service = createLeadRadarService({
    env: {},
    isSupabaseConfigured: () => false,
    getSupabaseClient: () => null,
  });
  const status = await service.getStatus();
  assert.equal(status.storageConfigured, false);
  assert.equal(status.provider.configured, false);
  assert.match(status.provider.message, /Configureer|provider/i);
  assert.equal(status.autoScan.enabled, false);
  assert.equal(status.autoScan.initialLookbackDays, 30);
  assert.equal(status.autoScan.refreshLookbackDays, 3);
  assert.equal(status.defaults.maxQueries, 50);
});

test('Lead Radar gebruikt een eigen ruimere Supabase-timeout zonder globale cooldown', async () => {
  const clientOptions = [];
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    in() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    then(resolve, reject) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve, reject); },
  };
  const service = createLeadRadarService({
    env: {},
    isSupabaseConfigured: () => true,
    getSupabaseClient: (options) => { clientOptions.push(options); return { from: () => chain }; },
  });

  await service.getStatus();
  assert.ok(clientOptions.some((options) => options.timeoutMs === 10_000));
  assert.ok(clientOptions.every((options) => options.ignoreFailureCooldown === true));
  assert.ok(clientOptions.every((options) => options.suppressFailureCooldown === true));
});

test('Lead Radar vult eerst 30 dagen en schakelt daarna over op een korte updateperiode', () => {
  const config = { initialLookbackDays: 30 };
  const incomplete = { status: 'paused', max_age_days: 30, query_cursor: 12, query_plan: Array.from({ length: 20 }) };
  const complete = { status: 'completed', max_age_days: 30, query_cursor: 20, query_plan: Array.from({ length: 20 }) };
  assert.equal(hasCompletedInitialBackfill(null, config), false);
  assert.equal(hasCompletedInitialBackfill(incomplete, config), false);
  assert.equal(hasCompletedInitialBackfill(complete, config), true);
});

test('Lead Radar registreert beveiligde adminroutes en geen outbound-acties', () => {
  const routes = [];
  const app = {};
  for (const method of ['get', 'post', 'patch']) {
    app[method] = (route, ...handlers) => routes.push({ method, route, handlers });
  }
  const service = {
    getStatus: async () => ({}), listSignals: async () => ({}), getSignal: async () => ({}),
    updateSignal: async () => ({}), importSignal: async () => ({ created: true }), runScan: async () => ({}),
    runScheduledScan: async () => ({ skipped: true }),
    listRuns: async () => [], lookupWebsite: async () => ({}), bulkLookupWebsite: async () => [],
  };
  const adminGuard = () => {};
  registerLeadRadarRoutes(app, { service, requirePremiumAdminApiAccess: adminGuard });
  assert.deepEqual(routes.map((item) => `${item.method.toUpperCase()} ${item.route}`), [
    'GET /api/lead-radar/cron',
    'GET /api/lead-radar/status',
    'GET /api/lead-radar/signals',
    'GET /api/lead-radar/signals/:id',
    'PATCH /api/lead-radar/signals/:id',
    'POST /api/lead-radar/import',
    'POST /api/lead-radar/scan',
    'GET /api/lead-radar/runs',
    'POST /api/lead-radar/signals/:id/website-lookup',
    'POST /api/lead-radar/website-lookup',
  ]);
  assert.ok(routes.filter((item) => item.route !== '/api/lead-radar/cron').every((item) => item.handlers.includes(adminGuard)));
  assert.ok(routes.find((item) => item.route === '/api/lead-radar/cron').handlers.length >= 2);
  const routeSource = readRepoFile('server/routes/lead-radar.js');
  assert.doesNotMatch(routeSource, /facebook.*message|instagram.*message|sendMessage|postComment/i);
});

test('Lead Radar migration is service-role-only and has one canonical website status set', () => {
  const migration = readRepoFile('supabase/migrations/20260817120000_softora_social_lead_radar.sql');
  assert.match(migration, /create table if not exists public\.softora_social_lead_signals/i);
  assert.match(migration, /create table if not exists public\.softora_social_lead_scan_runs/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.softora_social_lead_signals from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update, delete on table public\.softora_social_lead_signals to service_role/i);
  for (const status of ['website_found', 'no_website_found', 'website_not_working', 'website_unverified', 'website_not_checked', 'provider_unavailable']) {
    assert.match(migration, new RegExp(status));
  }
  assert.doesNotMatch(migration, /grant .* to anon|grant .* to authenticated/i);
  const automaticMigration = readRepoFile('supabase/migrations/20260817130000_softora_social_lead_radar_automatic_scans.sql');
  assert.match(automaticMigration, /add column if not exists scan_mode/i);
  assert.match(automaticMigration, /scan_mode in \('manual', 'automatic'\)/i);
  const linkedinMigration = readRepoFile('supabase/migrations/20260817150000_softora_social_lead_radar_linkedin.sql');
  assert.match(linkedinMigration, /platform in \('facebook', 'instagram', 'linkedin'\)/i);
  const enrichmentMigration = readRepoFile('supabase/migrations/20260818170000_softora_social_lead_enrichment.sql');
  for (const field of ['business_name', 'business_city', 'business_phone', 'business_domain', 'business_match_status', 'business_candidates', 'website_redirect_url', 'website_check_provider', 'website_technical_checks', 'website_links']) {
    assert.match(enrichmentMigration, new RegExp(field));
  }
  assert.match(enrichmentMigration, /agency_detected/);
  assert.match(enrichmentMigration, /business_match_idx/);
  const sourceIntegrityMigration = readRepoFile('supabase/migrations/20260819093410_lead_radar_source_integrity.sql');
  assert.match(sourceIntegrityMigration, /source_verification_status/);
  assert.match(sourceIntegrityMigration, /source_content_match_score/);
  assert.match(sourceIntegrityMigration, /platform_stats/);
  assert.match(sourceIntegrityMigration, /enable row level security/);
  assert.doesNotMatch(sourceIntegrityMigration, /grant .* to anon|grant .* to authenticated/i);
});

test('Lead Radar page, sidebar and user-visible website labels are wired', () => {
  const shell = readRepoFile('premium-lead-radar-shell.html');
  const page = readRepoFile('premium-lead-radar.html');
  const script = readRepoFile('assets/lead-radar.js');
  const theme = readRepoFile('assets/personnel-theme.js');
  const sidebarLinks = readRepoFile('assets/premium-sidebar-links.js');
  const routing = readRepoFile('server/config/page-routing.js');
  assert.match(shell, /src="\/premium-lead-radar\?softora_sidebar_content=1"/);
  assert.match(routing, /map\.set\('lead-radar', map\.get\('premium-lead-radar-shell'\)\)/);
  assert.doesNotMatch(shell, /assets\/lead-radar-sidebar\.js/);
  assert.doesNotMatch(shell, /data-sidebar-key="lead_radar"/);
  assert.match(sidebarLinks, /function getLeadRadarSidebarLink\(\)/);
  assert.match(theme, /SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\),\s*getDatabaseSidebarLink\(\)/);
  assert.match(theme, /ensureStaticSidebarLink\(sidebar, "overzicht", window\.SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\), \["database"\]\)/);
  assert.match(
    theme,
    /function stabilizePremiumStaticSidebar\(sidebar, activeKey\) \{[\s\S]*?syncPremiumSidebarManagementLinks\(sidebar, activeKey\);/
  );
  assert.match(page, /Totale leads/);
  assert.match(page, /Nieuwe leads/);
  assert.match(page, /Nieuwe leads zoeken/);
  assert.match(page, /Recente leads/);
  assert.doesNotMatch(page, /bedrijfs- en websitecontrole/i);
  assert.match(page, /LinkedIn/);
  assert.doesNotMatch(page, /Instagram/);
  assert.doesNotMatch(script, /instagram/i);
  assert.doesNotMatch(page, /Eigen regio's|scan-region-input|id="scan-regions"|value="custom"/);
  assert.doesNotMatch(page, /coverage-panel|Scanruns en dekking|filter-bar|filter-form|filter-platform|filter-days|filter-website-status|filter-lead-status|filter-min-score|filter-search|Filteren/i);
  assert.match(page, /lead-radar\.css\?v=20260819a/);
  assert.match(page, /lead-radar\.js\?v=20260819a/);
  assert.match(page, /id="scan-platforms" data-value="facebook,linkedin"/);
  assert.match(page, /data-custom-select-trigger[\s\S]*aria-haspopup="listbox"[\s\S]*aria-controls="scan-platforms-menu"/);
  assert.match(page, /data-value="facebook,linkedin" aria-selected="true">Facebook en LinkedIn<\/button>[\s\S]*data-value="facebook" aria-selected="false">Facebook<\/button>[\s\S]*data-value="linkedin" aria-selected="false">LinkedIn<\/button>/);
  assert.match(page, /id="scan-region-mode" data-value="nationwide"/);
  assert.match(page, /data-custom-select-trigger[\s\S]*aria-controls="scan-region-mode-menu"/);
  assert.match(page, /data-value="nationwide" aria-selected="true">Heel Nederland<\/button>[\s\S]*data-value="regional" aria-selected="false">Nederland \+ provincies en steden<\/button>/);
  assert.match(page, /id="scan-max-age-days" data-value="30"/);
  assert.match(page, /data-custom-select-trigger[\s\S]*aria-controls="scan-max-age-days-menu"/);
  assert.match(page, /data-value="30" aria-selected="true">Laatste 30 dagen<\/button>[\s\S]*data-value="7" aria-selected="false">Laatste 7 dagen<\/button>[\s\S]*data-value="3" aria-selected="false">Laatste 3 dagen<\/button>[\s\S]*data-value="1" aria-selected="false">Laatste 24 uur<\/button>/);
  assert.doesNotMatch(page, /<select\b/);
  assert.doesNotMatch(page, /Totaal signalen|Nieuwe signalen zoeken|Lead importeren|>Vernieuwen<|id="refresh-button"|id="open-import-button"|id="import-panel"|zoekopdrachten|Websitechecks/i);
  assert.doesNotMatch(page, /scan-status-text|maximaal 50 zoekacties|directe openbare posts met een echte websitevraag|publicatiedatum onbekend/i);
  assert.doesNotMatch(page, /bulk-bar|selected-count|bulk-website-button|clear-selection-button|lead-select|lead-score|Geen website-URL opgeslagen/i);
  const stylesheet = readRepoFile('assets/lead-radar.css');
  assert.doesNotMatch(stylesheet, /lead-radar-header-actions|import-panel|import-form|metric-context/);
  assert.doesNotMatch(stylesheet, /coverage-panel|coverage-summary|coverage-stat|runs-list|run-row|filter-bar|filter-submit|filter-search|scan-region-input/i);
  assert.doesNotMatch(stylesheet, /select\[multiple\]/);
  assert.doesNotMatch(stylesheet, /lead-actions|lead-notes|lead-author|lead-business|lead-engagement|business-match/);
  assert.match(stylesheet, /\.custom-select__menu/);
  assert.match(stylesheet, /html, body[\s\S]*scrollbar-width:\s*none/);
  assert.match(stylesheet, /::-webkit-scrollbar[\s\S]*display:\s*none/);
  assert.match(stylesheet, /\.lead-side\s*\{[\s\S]*align-items:\s*flex-end/);
  assert.match(stylesheet, /\.lead-source-link\s*\{[\s\S]*width:\s*28px/);
  assert.match(stylesheet, /\.lead-published-date\s*\{/);
  assert.match(stylesheet, /\.lead-full-message\s+summary\s*\{/);
  assert.doesNotMatch(stylesheet, /\.lead-date\s*\{|\.lead-source\s*\{/);
  assert.match(stylesheet, /lead-link-warning/);
  assert.match(script, /Leads laden/);
  assert.doesNotMatch(script, /refresh-button|open-import-button|submitImport|import-form|zoekopdrachten|Websitechecks/i);
  assert.doesNotMatch(script, /scan-regions|regionMode\s*===\s*['"]custom['"]|\$\('#scan-region-mode'\)\.value|\$\('#scan-max-age-days'\)\.value/i);
  assert.doesNotMatch(script, /filter-form|filter-platform|filter-days|filter-website-status|filter-lead-status|filter-min-score|filter-search|getFilters|loadRuns|renderCoverage|renderRuns|toggle-runs-button|runs-list|coverage-summary|data-resume-run/i);
  assert.doesNotMatch(script, /relevance_score|score_reasons|lead-score|lead-select|selected-count|bulk-website-button|clear-selection-button|Geen website-URL opgeslagen|lead-copy__query/);
  assert.match(script, /function getLeadTitle\(signal = \{\}\)/);
  assert.match(script, /Website aanvraag/);
  assert.match(script, /<h3 class="lead-title">/);
  assert.doesNotMatch(script, /const leadTitle = signal\.author_name/);
  assert.match(script, /<p class="lead-summary">/);
  assert.match(script, /function formatPublishedDate\(value\)/);
  assert.match(script, /<details class="lead-full-message">[\s\S]*<summary>Lees volledig<\/summary>/);
  assert.match(script, /lead-full-message__text/);
  assert.match(script, /lead-published-date/);
  assert.match(script, /lead-source-icon/);
  assert.match(script, /aria-label="Open originele post"/);
  assert.match(script, /lead-side/);
  assert.doesNotMatch(script, /Open profiel\/pagina|Bedrijf en website controleren|Opnieuw controleren|Relevant|Later opvolgen|Niet relevant|Interne notitie|Notitie opslaan|lead-actions|lead-notes|data-action|Bedrijfscontrole|BEDRIJF NOG NIET GECONTROLEERD|Engagement|business-match|lead-business|lead-engagement/i);
  assert.doesNotMatch(script, /Publicatiedatum:|Nog niet beschikbaar via openbare bron|Bron vermeldde geen publicatiedatum|Gevonden op:/);
  assert.match(script, /Directe postlink niet beschikbaar/);
  assert.match(script, /website-candidate/);
  assert.match(script, /setInterval/);
  assert.doesNotMatch(page, /auto-scan-status|Automatische scan staat uit|Automatisch actief|elke 15 minuten/i);
  assert.doesNotMatch(script, /Automatisch actief/);
  assert.doesNotMatch(script, /elke 15 minuten|nieuwe openbare signalen worden/i);
  assert.match(script, /const platforms = \(\$\('#scan-platforms'\)\.dataset\.value \|\| 'facebook,linkedin'\)\.split\(','\)\.filter\(Boolean\);/);
  assert.match(script, /const regionMode = \$\('#scan-region-mode'\)\.dataset\.value \|\| 'nationwide';/);
  assert.match(script, /const maxAgeDays = Number\(\$\('#scan-max-age-days'\)\.dataset\.value\) \|\| 30;/);
  assert.match(script, /data-custom-select-option/);
  assert.match(script, /customSelects/);
  assert.match(script, /setCustomDropdownOpen/);
  assert.doesNotMatch(script, /selectedOptions/);
  assert.match(page, /id="scan-max-age-days"/);
  assert.doesNotMatch(page, /id="scan-max-queries"|id="scan-website-limit"/);
});

test('Lead Radar wordt via de centrale HTML-deliverylaag in de premium-sidebar geladen', () => {
  const htmlPages = readRepoFile('server/services/html-pages.js');
  const theme = readRepoFile('assets/personnel-theme.js');
  const vercel = readRepoFile('vercel.json');
  const envExample = readRepoFile('.env.example');
  assert.match(htmlPages, /PREMIUM_PERSONNEL_THEME_VERSION = '20260818b'/);
  assert.doesNotMatch(htmlPages, /LEAD_RADAR_SIDEBAR_VERSION|lead-radar-sidebar\.js/);
  assert.match(theme, /SoftoraPremiumSidebarLinks\.getLeadRadarSidebarLink\(\)/);
  assert.doesNotMatch(vercel, /"path": "\/api\/lead-radar\/cron"/);
  assert.match(envExample, /LEAD_RADAR_AUTO_SCAN_ENABLED=false/);
  assert.match(envExample, /LEAD_RADAR_SUPABASE_TIMEOUT_MS=10000/);
  assert.match(envExample, /LEAD_RADAR_RETENTION_DAYS=90/);
  assert.match(envExample, /LEAD_RADAR_SCAN_RUN_RETENTION_DAYS=180/);
  const publicationMigration = readRepoFile('supabase/migrations/20260818160000_softora_social_lead_publication_dates.sql');
  assert.match(publicationMigration, /publication_date_source/);
  assert.match(publicationMigration, /publication_date_confidence/);
  const maintenance = readRepoFile('server/services/lead-radar-maintenance.js');
  assert.match(maintenance, /not_relevant/);
  assert.match(maintenance, /archived/);
  assert.match(maintenance, /source_type.*serp/);
});


test('Lead Radar verrijkt een lead met bedrijfsgegevens en technische websitegegevens', async () => {
  const calls = [];
  const enrichment = createLeadRadarEnrichment({
    env: { LEAD_RADAR_DATAFORSEO_LOGIN: 'login', LEAD_RADAR_DATAFORSEO_PASSWORD: 'password' },
    normalizeHttpUrl,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('/business_data/business_listings/search/live')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status_code: 20000,
            tasks: [{
              status_code: 20000,
              result: [{
                items: [{
                  type: 'business_listing',
                  title: 'Kapsalon Nijlen',
                  category: 'Kapsalon',
                  address: 'Dorpsstraat 1, Nijlen',
                  address_info: { city: 'Nijlen', region: 'Antwerpen', zip: '2560' },
                  phone: '+32 123 45 67',
                  domain: 'kapsalonnijlen.nl',
                  place_id: 'place-1',
                  cid: 'cid-1',
                  is_claimed: true,
                  rating: { value: 4.8, votes_count: 42 },
                }],
              }],
            }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status_code: 20000,
          tasks: [{
            status_code: 20000,
            result: [{
              items: [{
                resource_type: 'html',
                status_code: 200,
                location: 'https://kapsalonnijlen.nl/',
                url: 'https://kapsalonnijlen.nl',
                meta: { title: 'Kapsalon Nijlen' },
                checks: { is_redirect: false, is_4xx_code: false, is_5xx_code: false, is_broken: false, is_https: true, broken_links: false },
                links: [{ url: 'https://kapsalonnijlen.nl/contact', title: 'Contact' }],
              }],
            }],
          }],
        }),
      };
    },
  });
  const business = await enrichment.lookupBusiness({ author_name: 'Kapsalon Nijlen', region: 'Nijlen' });
  assert.equal(business.business_match_status, 'matched');
  assert.equal(business.business_phone, '+32 123 45 67');
  assert.equal(business.business_domain, 'kapsalonnijlen.nl');
  assert.equal(business.business_city, 'Nijlen');
  const website = await enrichment.inspectWebsite('https://kapsalonnijlen.nl');
  assert.equal(website.website_status, 'website_found');
  assert.equal(website.website_check_provider, 'dataforseo_onpage');
  assert.equal(website.website_title, 'Kapsalon Nijlen');
  assert.equal(website.website_redirect_url, 'https://kapsalonnijlen.nl/');
  assert.equal(website.website_technical_checks.is_https, true);
  assert.equal(website.website_links[0].url, 'https://kapsalonnijlen.nl/contact');
  assert.equal(calls.length, 2);
});

test('Lead Radar markeert een waarschijnlijke webdesignpartij als agency in plaats van hem automatisch te koppelen', async () => {
  const enrichment = createLeadRadarEnrichment({
    env: { LEAD_RADAR_DATAFORSEO_LOGIN: 'login', LEAD_RADAR_DATAFORSEO_PASSWORD: 'password' },
    normalizeHttpUrl,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status_code: 20000,
        tasks: [{
          status_code: 20000,
          result: [{ items: [{ title: 'Websitedesigner', category: 'Webdesign bureau', domain: 'websitedesigner.nl' }] }],
        }],
      }),
    }),
  });
  const business = await enrichment.lookupBusiness({ author_name: 'Websitedesigner', region: 'Nederland' });
  assert.equal(business.business_match_status, 'agency_detected');
  assert.equal(business.business_domain, 'websitedesigner.nl');
});

test('Lead Radar gebruikt OnPage alleen na een websitekandidaat en bewaart de verrijking in de lead', async () => {
  let calls = 0;
  const enrichment = createLeadRadarEnrichment({
    env: {},
    normalizeHttpUrl,
    fetchImpl: async () => { calls += 1; throw new Error('mag niet worden aangeroepen'); },
  });
  const noCandidate = await enrichment.inspectWebsite('');
  assert.equal(noCandidate.available, false);
  assert.equal(calls, 0);
  const existing = {
    id: '00000000-0000-0000-0000-000000000003',
    author_name: 'Kapsalon Nijlen',
    region: 'Nijlen',
    message_text: 'Wij zoeken iemand voor onze website.',
    website_url: null,
    website_status: 'website_not_checked',
    website_candidates: [],
  };
  const updated = { ...existing };
  const db = {
    from() {
      return {
        select() {
          const chain = {
            eq() { return chain; },
            limit: async () => ({ data: [existing], error: null }),
          };
          return chain;
        },
        update(patch) {
          Object.assign(updated, patch);
          const chain = {
            eq() { return chain; },
            select() { return { single: async () => ({ data: updated, error: null }) }; },
          };
          return chain;
        },
      };
    },
  };
  const service = createLeadRadarService({
    env: {},
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => db,
    provider: { configured: false, search: async () => [] },
    enrichment: {
      lookupBusiness: async () => ({
        business_match_status: 'matched',
        business_source: 'business_listings',
        business_name: 'Kapsalon Nijlen',
        business_city: 'Nijlen',
        business_phone: '+32 123 45 67',
        business_domain: 'kapsalonnijlen.nl',
        business_website_url: 'https://kapsalonnijlen.nl',
        business_candidates: [],
      }),
      inspectWebsite: async () => ({
        available: true,
        website_status: 'website_found',
        website_check_provider: 'dataforseo_onpage',
        website_http_status: 200,
        website_title: 'Kapsalon Nijlen',
        website_technical_checks: { is_https: true },
        website_links: [],
      }),
      getStatus: () => ({ configured: true, businessListingsConfigured: true, onPageConfigured: true }),
    },
  });
  const result = await service.lookupWebsite(existing.id, { force: true });
  assert.equal(result.business_phone, '+32 123 45 67');
  assert.equal(result.business_domain, 'kapsalonnijlen.nl');
  assert.equal(result.website_check_provider, 'dataforseo_onpage');
  assert.equal(result.website_status, 'website_found');
});
