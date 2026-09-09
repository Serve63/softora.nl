const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initialize } = require('../../assets/premium-settings-navigation');
const { createHtmlPageCoordinator } = require('../../server/services/html-pages');
const { createPremiumSidebarShell } = require('../../server/services/premium-sidebar-shell');
const root = path.join(__dirname, '../..');

const modulePages = [
  'premium-samenvatten.html', 'premium-world-watcher.html', 'premium-flynow.html',
  'premium-wereldmap.html', 'live-momentum.html', 'live-momentum-access.html',
  'premium-kvk-database-shell.html', 'premium-kvk-company-directory-shell.html',
  'premium-coldmailing-lead.html',
];

for (const fileName of modulePages) {
  test(`${fileName}: first response contains the complete sidebar and stable CSS`, async () => {
    const coordinator = createHtmlPageCoordinator({
      pagesDir: root,
      resolvePremiumHtmlPageAccess: async () => ({
        isProtectedPremiumPage: true,
        authState: { authenticated: true, role: 'admin', userId: 'test-owner', displayName: 'Layout Test' },
      }),
    });
    const res = { setHeader() {}, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; } };
    await coordinator.sendSeoManagedHtmlPageResponse({ originalUrl: '/' + fileName, query: {} }, res, () => {}, fileName);
    assert.equal(res.statusCode, 200);
    const sidebar = res.body.match(/<aside\b[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
    assert.ok(sidebar, 'navigation must exist before deferred scripts execute');
    for (const key of ['dashboard', 'database', 'customers', 'settings', 'lead_radar', 'summarize']) assert.match(sidebar, new RegExp(`data-sidebar-key="${key}"`));
    assert.match(sidebar, />Layout Test</);
    assert.doesNotMatch(sidebar, /data-sidebar-key="(?:agenda|coldmailing|bookkeeping|pdfs|websitegenerator)"/);
    assert.ok(res.body.indexOf('id="softora-premium-sidebar-critical"') < res.body.indexOf('assets/personnel-theme.css'));
    assert.match(res.body, /scrollbar-gutter:auto !important/);
    assert.match(res.body, /premium-sidebar-mobile\.css\?v=/);
    assert.match(res.body, /function prefillPremiumSidebarActiveState/);
  });
}

test('mobile shell overrides desktop geometry and keeps navigation and logout reachable', () => {
  const css = fs.readFileSync(path.join(root, 'assets/premium-sidebar-mobile.css'), 'utf8');
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /grid-template-areas: "logo profile" "nav nav"/);
  assert.match(css, /overflow-x: auto !important; overflow-y: hidden !important/);
  assert.match(css, /sidebar-footer \{[^}]*display: block !important/);
  assert.match(css, /margin-left: 0 !important; width: 100% !important/);
});

test('empty-host rendering preserves page hooks and never adds owner navigation for staff', () => {
  const render = createPremiumSidebarShell();
  const input = '<aside class="sidebar" id="ww-sidebar" aria-label="Navigation"></aside>';
  const output = render(input, { authenticated: true, role: 'employee' });
  assert.match(output, /id="ww-sidebar" aria-label="Navigation" data-static-sidebar="1"/);
  assert.doesNotMatch(output, /data-sidebar-key="passwords"/);
  assert.equal(render(output, { authenticated: true, role: 'employee' }), output);
  assert.equal(render('<main>Public page</main>'), '<main>Public page</main>');
});

test('settings categories are released without a session or network dependency', () => {
  const source = fs.readFileSync(path.join(root, 'assets/premium-user-management.js'), 'utf8');
  assert.match(source, /mountExtraSettingsCategory\(\);\s*window\.SoftoraSettingsNavigation\.initialize\(window, goTo\);\s*\(async function bootstrapPersoneelManager/);
  const page = fs.readFileSync(path.join(root, 'premium-instellingen.html'), 'utf8');
  assert.ok(page.indexOf('premium-settings-navigation.js') < page.indexOf('premium-user-management.js'));
  const events = [];
  const target = {
    SoftoraPremiumBoot: { setShellBooting: value => events.push(value) }, addEventListener() {},
    fetch: () => { throw new Error('categories must not need the network'); },
  };
  initialize(target, () => {});
  assert.deepEqual(events, [false]);
});

test('browser back and forward synchronize the settings category without reloading', () => {
  const screens = [];
  const handlers = {};
  const target = {
    document: { getElementById: () => ({ classList: { contains: () => true } }) },
    location: { hash: '#extra' }, addEventListener: (name, handler) => { handlers[name] = handler; },
  };
  initialize(target, screen => screens.push(screen));
  handlers.hashchange();
  target.location.hash = '';
  handlers.hashchange();
  assert.deepEqual(screens, ['screen-extra', 'screen-overzicht']);
});


test('settings response reserves both category tiles before deferred scripts run', () => {
  const page = fs.readFileSync(path.join(root, 'premium-instellingen.html'), 'utf8');
  const overview = page.slice(page.indexOf('id="screen-overzicht"'), page.indexOf('id="screen-personeel"'));
  assert.equal((overview.match(/class="tegel"/g) || []).length, 2);
  assert.ok(overview.indexOf('data-settings-extra-open') < overview.indexOf('data-settings-action="open-pin"'));
  const { EXTRA_MODULES } = require('../../assets/settings-module-routes');
  assert.match(overview, new RegExp('data-settings-extra-count>' + EXTRA_MODULES.length + ' onderdelen'));
  assert.match(fs.readFileSync(path.join(root, 'assets/premium-settings-tiles.css'), 'utf8'), /#screen-overzicht \.settings-overview-grid[^}]+grid-template-columns: repeat\(2,minmax\(0,280px\)\)/);
  assert.match(fs.readFileSync(path.join(root, 'assets/premium-settings-tiles.css'), 'utf8'), /#screen-overzicht \.settings-overview-grid > \.tegel[^}]+aspect-ratio:1 \/ 1/);
  const source = fs.readFileSync(path.join(root, 'assets/premium-user-management.js'), 'utf8');
  assert.match(source, /overviewScreen\.querySelector\('\[data-settings-extra-open\]'\) \|\| document\.createElement/);
});
