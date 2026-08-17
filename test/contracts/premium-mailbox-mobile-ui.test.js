const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');

test('mailbox laadt de pagina-eigen mobiele laag als laatste en ondersteunt veilige schermranden', () => {
  const page = read('premium-mailbox.html');
  assert.match(page, /content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
  assert.ok(page.indexOf('premium-mailbox-mobile.css?v=20260817b') > page.indexOf('</style>'));
  assert.ok(page.indexOf('premium-mailbox-mobile.js?v=20260728a') > page.indexOf('premium-mailbox.js?v=20260817c'));
  assert.match(page, /data-mailbox-mobile-action="toggle-navigation"/);
  assert.match(page, /class="mailbox-mobile-sidebar-backdrop"[\s\S]*data-mailbox-mobile-action="close-navigation"/);
});

test('mobiele mailbox is drawer plus list-first master-detail met toetsenbordvaste compose', () => {
  const css = read('assets/premium-mailbox-mobile.css');
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.dashboard-layout > \.sidebar\[data-static-sidebar="1"\][\s\S]*position: fixed !important/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.mail-page-shell\.is-mobile-detail-open \.mail-detail/);
  assert.match(css, /--mailbox-viewport-height, 100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('mobiele controller bewaart uitsluitend visuele state en sluit detail toegankelijk af', () => {
  const script = read('assets/premium-mailbox-mobile.js');
  assert.match(script, /window\.SoftoraMailboxMobile = \{ isSinglePane, showList, showDetail, syncVisualViewport \}/);
  assert.match(script, /detail\.inert = !showingDetail/);
  assert.match(script, /compose\.setAttribute\('aria-hidden', String\(!open\)\)/);
  assert.match(script, /event\.key === 'Escape'[\s\S]*close-compose/);
  assert.match(script, /new MutationObserver\([\s\S]*ensureDetailToolbar/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|fetch\(|\/api\//);
});
