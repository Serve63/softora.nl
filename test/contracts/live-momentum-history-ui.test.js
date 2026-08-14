const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const historyUi = require('../../assets/live-momentum-history-ui');

test('Winnen levert een toegankelijke maandgrafiek zonder locked toegang of paginareload', () => {
  const html = read('live-momentum.html');
  const locked = read('live-momentum-access.html');
  const source = read('assets/live-momentum-history-ui.js');
  const styles = read('assets/live-momentum-history.css');

  assert.match(html, /data-momentum-history-trigger[^>]*aria-label="Maandgemiddelde openen"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="momentum-history-dialog"[^>]*aria-labelledby="momentum-history-title"/);
  assert.match(html, /data-momentum-history-close aria-label="Maandgemiddelde sluiten"/);
  assert.match(html, /live-momentum-history\.js\?v=20260814a/);
  assert.match(html, /live-momentum-history-ui\.js\?v=20260814b/);
  assert.match(html, /live-momentum-history\.css\?v=20260814b/);
  assert.doesNotMatch(locked, /momentum-history-trigger|momentum-history-dialog|live-momentum-history/);

  assert.match(source, /dialog\.showModal\(\)/);
  assert.match(source, /dialog\.addEventListener\('cancel'/);
  assert.match(source, /event\.preventDefault\(\);[\s\S]*?close\(\);/);
  assert.match(source, /event\.target === dialog/);
  assert.match(source, /lastFocused\?\.focus\?\.\(\)/);
  assert.match(source, /softora:momentum-history-state/);
  assert.match(source, /aria-label', `\$\{month\.label\}: \$\{value\} gemiddeld over/);
  assert.doesNotMatch(source, /location\.(?:reload|assign|replace)|localStorage|sessionStorage/);
  assert.match(styles, /\.momentum-history-viewport\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(styles, /\.momentum-history-point:hover > span,[\s\S]*?\.momentum-history-point:focus-visible > span/);
  assert.match(styles, /@media \(max-width:\s*520px\)/);
  assert.match(source, /new ResizeObserverClass\(scheduleResponsiveRender\)/);
  assert.match(source, /orientationchange', scheduleResponsiveRender/);
  assert.match(styles, /\.momentum-history-month-label\.is-last\s*\{[\s\S]*?text-anchor:\s*end;/);
});

test('plotlayout gebruikt de volledige container en schaalt gecontroleerd voor 1, 2, 3, 12 en veel maanden', () => {
  const one = historyUi.calculatePlotLayout(1, 880);
  const two = historyUi.calculatePlotLayout(2, 880);
  const three = historyUi.calculatePlotLayout(3, 880);
  const twelve = historyUi.calculatePlotLayout(12, 880);
  const many = historyUi.calculatePlotLayout(30, 360);

  assert.equal(one.width, 880);
  assert.equal(one.xPositions[0], 440);
  assert.deepEqual(two.xPositions, [48, 832]);
  assert.deepEqual(three.xPositions, [48, 440, 832]);
  assert.equal(twelve.width, 1416);
  assert.equal(twelve.xPositions.at(-1), 1368);
  assert.equal(many.width, 3540);
  assert.equal(many.xPositions.at(-1), 3492);
});

test('plotlayout herberekent deterministisch op containerresize zonder halve lege breedte', () => {
  const compact = historyUi.calculatePlotLayout(2, 520);
  const expanded = historyUi.calculatePlotLayout(2, 1040);

  assert.deepEqual(compact.xPositions, [48, 472]);
  assert.deepEqual(expanded.xPositions, [48, 992]);
  assert.equal(expanded.width, 1040);
  assert.equal(expanded.usableWidth, 944);
});

test('de bestaande grid-, scroll- en focusmode-state blijft buiten de grafiekcontroller', () => {
  const source = read('assets/live-momentum-history-ui.js');
  const focusSource = read('assets/live-momentum-focus-mode.js');

  assert.doesNotMatch(source, /scrollTo|scrollTop\s*=|scrollLeft\s*=|momentum-focus-mode|data-momentum-mobile-view\s*=/);
  assert.match(focusSource, /body\.classList\.toggle\("momentum-focus-mode", next\)/);
});
