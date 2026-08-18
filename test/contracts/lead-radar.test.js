'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildSearchPlan,
  createLeadRadarService,
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
  assert.doesNotMatch(shell, /assets\/lead-radar-sidebar\.js/);
  assert.match(sidebarScript, /const LINK_KEY = 'lead_radar'/);
  assert.match(sidebarScript, /href = LINK_HREF/);
  assert.match(sidebarScript, /__softoraLeadRadarSidebarInitialized/);
  assert.match(sidebarScript, /observer\.disconnect\(\)/);
  assert.match(page, /Geen website gevonden/);
  assert.match(page, /id="scan-regions"/);
  assert.match(script, /no_website_found: 'GEEN WEBSITE GEVONDEN'/);
  assert.match(script, /Open originele post/);
  assert.match(script, /Website zoeken/);
  assert.match(script, /setInterval/);
  assert.match(page, /id="auto-scan-status"/);
});

test('Lead Radar wordt via de centrale HTML-deliverylaag in de premium-sidebar geladen', () => {
  const htmlPages = readRepoFile('server/services/html-pages.js');
  const vercel = readRepoFile('vercel.json');
  const envExample = readRepoFile('.env.example');
  assert.match(htmlPages, /LEAD_RADAR_SIDEBAR_VERSION = '20260818a'/);
  assert.match(htmlPages, /assets\/lead-radar-sidebar\.js\?v=\$\{LEAD_RADAR_SIDEBAR_VERSION\}/);
  assert.match(vercel, /"path": "\/api\/lead-radar\/cron"/);
  assert.match(vercel, /"schedule": "\*\/15 \* \* \* \*"/);
  assert.match(envExample, /LEAD_RADAR_AUTO_SCAN_INTERVAL_MINUTES=15/);
});
