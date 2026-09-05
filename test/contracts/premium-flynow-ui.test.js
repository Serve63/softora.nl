const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { destinations, selectDestinations, travelUrl } = require('../../assets/flynow-explore');
const routes = require('../../assets/settings-module-routes');
const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('FlyNow opent vanuit Extra met gedeelde navigatie en eigen ontwerpassets', () => {
  const html = read('premium-flynow.html');
  assert.match(html, /<title>FlyNow — Vind jouw volgende bestemming<\/title>/);
  assert.match(html, /data-sidebar-shell="canonical"/);
  assert.match(html, /data-flynow-sidebar-host="1"/);
  assert.match(html, /data-settings-module-back-host/);
  assert.match(html, /flynow-explore\.css\?v=20260905a/);
  assert.match(html, /flynow-explore\.js\?v=20260905a/);
  assert.doesNotMatch(html, /src="[^"\n]*\/flynow\.js|href="[^"\n]*\/flynow\.css/);
  assert.doesNotMatch(html, /<script>(?!\s*<\/script>)|\son(?:click|input|change|error|submit)=/);
  assert.equal(routes.findByPath('/premium-flynow')?.unlocked, true);
  assert.equal(routes.findByPath('/premium-flynow.html')?.href, '/premium-flynow');
  assert.match(read('server/config/premium-admin-html-files.js'), /'premium-flynow.html'/);
});

test('FlyNow combineert reissoort, land en zoekwoorden in echte resultaten', () => {
  assert.equal(selectDestinations('zon', '', '').length, 6);
  assert.equal(selectDestinations('snow', '', '').length, 6);
  assert.deepEqual(selectDestinations('zon', 'Portugal', '').map((item) => item.id), ['algarve']);
  assert.deepEqual(selectDestinations('zon', 'Spanje', '').map((item) => item.id), ['mallorca', 'ibiza', 'tenerife']);
  assert.deepEqual(selectDestinations('snow', 'Oostenrijk', 'stad').map((item) => item.id), ['innsbruck']);
  assert.deepEqual(selectDestinations('zon', '', '  PORTUGÁL kust  ').map((item) => item.id), ['algarve']);
  assert.deepEqual(selectDestinations('zon', 'Portugal', 'Santorini'), []);
  assert.deepEqual(selectDestinations('snow', '', 'Mallorca'), []);
  assert.deepEqual(selectDestinations('zon', '', '<script>'), []);
  assert.equal(selectDestinations('zon', '', '').length, 6, 'zoeken verandert de collectie niet');
});

test('elke bestemming heeft eigen informatie, bestaand beeld en juiste externe zoeklinks', () => {
  assert.equal(new Set(destinations.map((item) => item.id)).size, 12);
  for (const item of destinations) {
    const photo = fs.readFileSync(path.join(root, 'assets/flynow/flynow-' + item.photo + '.jpg'));
    assert.equal(photo[0], 0xff, item.id); assert.equal(photo[1], 0xd8, item.id);
    assert.ok(item.description.length > 80 && item.tip.length > 50 && item.alt.length > 20, item.id);
    const flight = new URL(travelUrl(item, 'flights')), stay = new URL(travelUrl(item, 'stays'));
    assert.equal(flight.origin, 'https://www.google.com'); assert.equal(flight.pathname, '/travel/flights');
    assert.equal(flight.searchParams.get('q'), 'Vluchten naar ' + item.airport);
    assert.equal(stay.origin, 'https://www.google.com'); assert.equal(stay.pathname, '/travel/search');
    assert.equal(stay.searchParams.get('q'), 'Hotels in ' + item.name + ' ' + item.country);
    assert.equal('price' in item, false); assert.equal('score' in item, false);
  }
});

test('FlyNow heeft toegankelijke tabs, zoekveld, lege selectie en modaal reisvenster', () => {
  const html = read('premium-flynow.html'), js = read('assets/flynow-explore.js'), css = read('assets/flynow-explore.css');
  assert.match(html, /role="tablist" aria-label="Soort reis"/);
  assert.equal((html.match(/role="tab" /g) || []).length, 2);
  assert.match(html, /role="tabpanel" aria-labelledby="fn-tab-zon"/);
  assert.match(html, /type="search"[^>]*aria-label="Zoek een bestemming"/);
  assert.match(html, /id="fn-count" role="status" aria-live="polite"/);
  assert.match(html, /id="fn-empty" hidden/);
  assert.match(html, /<dialog[^>]*aria-labelledby="fn-detail-title"/);
  assert.match(html, /aria-label="Sluit bestemming" autofocus/);
  assert.equal((html.match(/rel="noopener noreferrer"/g) || []).length, 2);
  assert.match(js, /'ArrowLeft', 'ArrowRight', 'Home', 'End'/);
  assert.match(js, /showModal\(\)/); assert.match(js, /detailTrigger\.focus\(\)/);
  assert.match(js, /image\.loading = 'lazy'/); assert.match(html, /fetchpriority="high"/);
  assert.match(html, /aria-controls="fn-sidebar" aria-expanded="false"/);
  assert.match(js, /function toggleNavigation\(open\)/);
  assert.match(css, /\.fn-nav-open \.sidebar\{display:flex!important/);
  assert.match(css, /:focus-visible/); assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\(max-width:580px\)/);
  assert.doesNotMatch(js, /innerHTML|fetch\(|localStorage|sessionStorage|Math\.random|setTimeout/);
  assert.doesNotMatch(html, /Nog 3 kamers|Nu boeken|2025\/2026|AI reisdeals/);
  assert.match(html, /Actuele prijzen bij de aanbieder/);
});

test('premium flynow lokale plekfoto assets dekken alle collage-slots', () => {
  [
    'flynow-zon-photo-1.jpg',
    'flynow-zon-photo-2.jpg',
    'flynow-zon-photo-3.jpg',
    'flynow-zon-photo-4.jpg',
    'flynow-zon-photo-5.jpg',
    'flynow-zon-photo-6.jpg',
    'flynow-zon-photo-7.jpg',
    'flynow-zon-photo-8.jpg',
    'flynow-zon-photo-9.jpg',
    'flynow-zon-photo-10.jpg',
    'flynow-sneeuw-photo-1.jpg',
    'flynow-sneeuw-photo-2.jpg',
    'flynow-sneeuw-photo-3.jpg',
    'flynow-sneeuw-photo-4.jpg',
    'flynow-sneeuw-photo-5.jpg',
    'flynow-sneeuw-photo-6.jpg',
    'flynow-sneeuw-photo-7.jpg',
    'flynow-sneeuw-photo-8.jpg',
    'flynow-sneeuw-photo-9.jpg',
  ].forEach((fileName) => {
    const source = fs.readFileSync(path.join(root, 'assets/flynow', fileName));
    assert.equal(source[0], 0xff);
    assert.equal(source[1], 0xd8);
    assert.equal(source[2], 0xff);
  });
});
