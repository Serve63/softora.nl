const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Winnen levert een toegankelijke maandgrafiek zonder locked toegang of paginareload', () => {
  const html = read('live-momentum.html');
  const locked = read('live-momentum-access.html');
  const source = read('assets/live-momentum-history-ui.js');
  const styles = read('assets/live-momentum-history.css');

  assert.match(html, /data-momentum-history-trigger[^>]*aria-label="Maandgemiddelde openen"[^>]*aria-haspopup="dialog"/);
  assert.match(html, /id="momentum-history-dialog"[^>]*aria-labelledby="momentum-history-title"/);
  assert.match(html, /data-momentum-history-close aria-label="Maandgemiddelde sluiten"/);
  assert.match(html, /live-momentum-history\.js\?v=20260814a/);
  assert.match(html, /live-momentum-history-ui\.js\?v=20260814a/);
  assert.match(html, /live-momentum-history\.css\?v=20260814a/);
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
});

test('de bestaande grid-, scroll- en focusmode-state blijft buiten de grafiekcontroller', () => {
  const source = read('assets/live-momentum-history-ui.js');
  const focusSource = read('assets/live-momentum-focus-mode.js');

  assert.doesNotMatch(source, /scrollTo|scrollTop\s*=|scrollLeft\s*=|momentum-focus-mode|data-momentum-mobile-view\s*=/);
  assert.match(focusSource, /body\.classList\.toggle\("momentum-focus-mode", next\)/);
});
