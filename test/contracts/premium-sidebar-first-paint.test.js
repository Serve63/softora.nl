const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initialize } = require('../../assets/premium-settings-navigation');
const { createHtmlPageCoordinator } = require('../../server/services/html-pages');
const { createPremiumSidebarShell } = require('../../server/services/premium-sidebar-shell');
const root = path.join(__dirname, '../..');

const modulePages = [
  'premium-mailbox.html', 'premium-personeel-dashboard.html', 'premium-instellingen.html',
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
    assert.match(res.body, /<body\b[^>]*data-sidebar-nav-ready="1"/);
    const sidebar = res.body.match(/<aside\b[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
    assert.ok(sidebar, 'navigation must exist before deferred scripts execute');
    for (const key of ['dashboard', 'database', 'customers', 'settings', 'lead_radar', 'summarize']) assert.match(sidebar, new RegExp(`data-sidebar-key="${key}"`));
    const mailbox = sidebar.match(/<a\b[^>]*data-sidebar-key="mailbox"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    const { getMailboxSidebarLink } = require('../../assets/premium-sidebar-links');
    assert.equal(mailbox, getMailboxSidebarLink().icon + '<span class="sidebar-link-text">Mailbox</span>');
    assert.match(sidebar, />Layout Test</);
    assert.doesNotMatch(sidebar, /data-sidebar-key="(?:agenda|coldmailing|bookkeeping|pdfs|websitegenerator)"/);
    assert.ok(res.body.indexOf('id="softora-premium-sidebar-critical"') < res.body.indexOf('assets/personnel-theme.css'));
    assert.match(res.body, /scrollbar-gutter:auto !important/);
    assert.match(res.body, /premium-sidebar-mobile\.css\?v=/);
    assert.doesNotMatch(res.body, /premium-sidebar-links\.js\?v=20260818a/);
    assert.match(res.body, /premium-sidebar-links\.js\?v=20260909a/);
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


test('server normalizes legacy lock and envelope icons to one idempotent mailbox link', () => {
  const render = createPremiumSidebarShell();
  const { getMailboxSidebarLink } = require('../../assets/premium-sidebar-links');
  for (const legacy of ['<span class="sidebar-link-lock"><svg></svg></span>', '<svg><path d="old-envelope"/></svg>']) {
    const input = '<aside class="sidebar" data-static-sidebar="1"><a href="/premium-mailbox" class="sidebar-link magnetic sidebar-link--coming-soon active" data-sidebar-key="mailbox" aria-disabled="true" tabindex="-1">' + legacy + '<span class="sidebar-link-text">Mailbox</span></a></aside>';
    const output = render(input, { authenticated: true, role: 'admin' });
    assert.ok(output.includes(getMailboxSidebarLink().icon));
    assert.match(output, /class="sidebar-link magnetic active"/);
    assert.match(output, /href="\/mailbox"/);
    assert.doesNotMatch(output, /sidebar-link-lock|coming-soon|aria-disabled|tabindex|old-envelope/);
    assert.equal(render(output, { authenticated: true, role: 'admin' }), output);
  }
});


for (const role of ['admin', 'employee']) {
  test(`all static page templates deliver identical navigation icons and states for ${role}`, () => {
    const { renderPremiumSidebarNavigation } = require('../../assets/premium-sidebar-links');
    const session = { authenticated: true, role };
    const render = createPremiumSidebarShell();
    const expected = renderPremiumSidebarNavigation(session, '');
    const files = fs.readdirSync(root).filter(name => name.endsWith('.html'));
    let pages = 0;
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      if (!/<aside\b[^>]*data-static-sidebar="1"/.test(source)) continue;
      const output = render(source, session);
      const sidebar = output.match(/<aside\b[^>]*data-static-sidebar="1"[^>]*>([\s\S]*?)<\/aside>/)?.[1];
      const navigation = sidebar?.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/)?.[1];
      assert.equal(navigation?.replace(/ magnetic active/g, ' magnetic'), expected, file);
      assert.equal(render(output, session), output, file + ' must be idempotent');
      pages++;
    }
    assert.ok(pages >= 29, 'cover every existing static sidebar template');
  });
}


test('empty module hosts receive their correct active item from the server', () => {
  const render = createPremiumSidebarShell();
  const session = { authenticated: true, role: 'admin' };
  for (const [file, key] of [['premium-samenvatten.html', 'summarize'], ['premium-world-watcher.html', 'settings'], ['premium-lead-radar-shell.html', 'lead_radar']]) {
    const output = render('<aside class="sidebar"></aside>', session, file);
    const active = output.match(/<a\b[^>]*class="sidebar-link magnetic active"[^>]*data-sidebar-key="([^"]+)"/);
    assert.equal(active?.[1], key);
  }
});
