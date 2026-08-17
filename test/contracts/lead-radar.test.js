'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildSearchPlan,
  buildSignalFromProviderItem,
  classifySignal,
  createLeadRadarService,
  hasCompletedInitialBackfill,
  normalizeHttpUrl,
  normalizePlatform,
  scoreSignal,
} = require('../../server/services/lead-radar');
const { registerLeadRadarRoutes } = require('../../server/routes/lead-radar');

const repoRoot = path.join(__dirname, '../..');
const readRepoFile = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('Lead Radar normaliseert alleen toegestane openbare URLs', () => {
  assert.equal(normalizePlatform('https://www.facebook.com/groups/softora/posts/1'), 'facebook');
  assert.equal(normalizePlatform('https://www.instagram.com/p/abc123/'), 'instagram');
  assert.equal(normalizeHttpUrl('https://example.nl/bedrijf/#contact', { allowPlatform: false }), 'https://example.nl/bedrijf');
  assert.equal(normalizeHttpUrl('http://localhost:3000', { allowPlatform: false }), '');
  assert.equal(normalizeHttpUrl('https://192.168.1.10/site', { allowPlatform: false }), '');
  assert.equal(normalizeHttpUrl('file:///C:/secret.txt', { allowPlatform: false }), '');
});

test('Lead Radar bouwt kleine Facebook- en Instagram-queryfamilies met regionale dekking', () => {
  const nationwide = buildSearchPlan({ platforms: ['facebook', 'instagram'], regionMode: 'nationwide', keywordGroups: ['direct_website'] });
  assert.ok(nationwide.length > 20);
  assert.ok(nationwide.some((item) => item.query.startsWith('site:facebook.com')));
  assert.ok(nationwide.some((item) => item.query.startsWith('site:instagram.com')));
  assert.ok(nationwide.every((item) => item.query.includes('Nederland')));

  const regional = buildSearchPlan({ platforms: ['facebook'], regionMode: 'regional', keywordGroups: ['webshop'] });
  assert.ok(regional.some((item) => item.region === 'Noord-Brabant'));
  assert.ok(regional.some((item) => item.region === 'Eindhoven'));

  const custom = buildSearchPlan({ platforms: ['instagram'], regions: ['Oisterwijk', 'Noord-Brabant'], keywordGroups: ['direct_website'] });
  assert.deepEqual([...new Set(custom.map((item) => item.region))].sort(), ['Noord-Brabant', 'Oisterwijk']);

  const recent = buildSearchPlan({ platforms: ['facebook'], regions: ['Nederland'], keywordGroups: ['direct_website'], maxAgeDays: 7 });
  assert.ok(recent.every((item) => / after:\d{4}-\d{2}-\d{2}$/.test(item.query)));
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
  };

  assert.equal(classifySignal(providerOne).role, 'provider');
  assert.equal(classifySignal(providerTwo).role, 'provider');
  assert.equal(buildSignalFromProviderItem(providerOne, { region: 'Nederland' }), null);
  assert.equal(buildSignalFromProviderItem(providerTwo, { region: 'Nederland' }), null);
  assert.ok(buildSignalFromProviderItem(prospect, { region: 'Nijlen' }));
});

test('Lead Radar behandelt een website-link uit een bericht eerst als kandidaat', () => {
  const signal = buildSignalFromProviderItem({
    url: 'https://www.facebook.com/example/posts/123',
    title: 'Voorbeeld bedrijf',
    snippet: 'Wij zoeken een webdesigner. Bekijk onze huidige website https://voorbeeld.nl',
  }, { region: 'Eindhoven', query: 'site:facebook.com website gezocht Eindhoven', keywordGroup: 'direct_website' });
  assert.equal(signal.website_url, 'https://voorbeeld.nl');
  assert.equal(signal.website_status, 'website_not_checked');
  assert.equal(signal.website_source, 'post');
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
});

test('Lead Radar gebruikt een eigen ruimere Supabase-timeout zonder globale cooldown', async () => {
  const clientOptions = [];
  const chain = {
    select() { return chain; },
    eq() { return chain; },
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
});

test('Lead Radar page, sidebar and user-visible website labels are wired', () => {
  const shell = readRepoFile('premium-lead-radar-shell.html');
  const page = readRepoFile('premium-lead-radar.html');
  const script = readRepoFile('assets/lead-radar.js');
  const sidebarScript = readRepoFile('assets/lead-radar-sidebar.js');
  const routing = readRepoFile('server/config/page-routing.js');
  assert.match(shell, /src="\/premium-lead-radar\?softora_sidebar_content=1"/);
  assert.match(routing, /map\.set\('lead-radar', map\.get\('premium-lead-radar-shell'\)\)/);
  assert.match(shell, /assets\/lead-radar-sidebar\.js\?v=20260817b/);
  assert.match(sidebarScript, /const LINK_KEY = 'lead_radar'/);
  assert.match(sidebarScript, /href = LINK_HREF/);
  assert.match(page, /Geen website gevonden/);
  assert.match(page, /id="scan-regions"/);
  assert.match(script, /no_website_found: 'GEEN WEBSITE GEVONDEN'/);
  assert.match(script, /Open originele post/);
  assert.match(script, /Gepubliceerd op:/);
  assert.match(script, /import-published-at/);
  assert.match(script, /Website zoeken/);
  assert.match(script, /setInterval/);
  assert.match(page, /id="auto-scan-status"/);
  assert.match(page, /assets\/lead-radar\.css\?v=20260817e/);
  assert.match(page, /assets\/lead-radar\.js\?v=20260817e/);
  assert.match(page, /id="scan-max-age-days"/);
  assert.match(page, /id="scan-max-queries"[^>]*max="12"/);
});

test('Lead Radar wordt via de centrale HTML-deliverylaag in de premium-sidebar geladen', () => {
  const htmlPages = readRepoFile('server/services/html-pages.js');
  const vercel = readRepoFile('vercel.json');
  const envExample = readRepoFile('.env.example');
  assert.match(htmlPages, /LEAD_RADAR_SIDEBAR_VERSION = '20260817b'/);
  assert.match(htmlPages, /assets\/lead-radar-sidebar\.js\?v=\$\{LEAD_RADAR_SIDEBAR_VERSION\}/);
  assert.doesNotMatch(vercel, /"path": "\/api\/lead-radar\/cron"/);
  assert.match(envExample, /LEAD_RADAR_AUTO_SCAN_ENABLED=false/);
  assert.match(envExample, /LEAD_RADAR_SUPABASE_TIMEOUT_MS=10000/);
});
