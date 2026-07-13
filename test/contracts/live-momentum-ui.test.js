const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

function read(fileName) {
  return fs.readFileSync(path.join(repoRoot, fileName), 'utf8');
}

test('live momentum page renders the requested dashboard surface', () => {
  const html = read('live-momentum.html');

  assert.match(html, /<title>Live Momentum \| Softora<\/title>/);
  assert.match(html, /href="\/assets\/live-momentum\.css\?v=20260713k"/);
  assert.match(html, /<script src="\/assets\/live-momentum\.js\?v=20260713a" defer><\/script>/);
  assert.match(html, /<h1 id="momentum-title">Live momentum<\/h1>/);
  assert.match(html, /Jouw voortgang van de laatste 30 dagen/);
  assert.match(html, /<strong>80%<\/strong>/);
  assert.equal((html.match(/class="bar-wrap"/g) || []).length, 30);
  assert.match(html, /Workout/);
  assert.match(html, /90 min deep work/);
  assert.match(html, /Dagdoel behalen/);
  assert.match(html, /Gezonde voeding/);
  assert.equal((html.match(/contenteditable="plaintext-only"/g) || []).length, 4);
  assert.equal((html.match(/class="habit-label"/g) || []).length, 4);
  assert.equal((html.match(/is-today-end/g) || []).length, 1);
  assert.match(html, /<div class="habit-spacer" role="columnheader">Doelen:<\/div>/);
  assert.doesNotMatch(html, /Dag 1 toevoegen/);
  assert.doesNotMatch(html, /<button\b/i);
  assert.doesNotMatch(html, /Discipline vandaag/);
  assert.doesNotMatch(html, /Focus\. Consistentie\. Groei\./);
  assert.doesNotMatch(html, /motivation-strip/);
  assert.doesNotMatch(html, /closing-quote/);
  assert.doesNotMatch(html, /Nog te gaan/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('live momentum stylesheet keeps the visual replica self-contained', () => {
  const css = read('assets/live-momentum.css');

  assert.match(css, /--purple:\s*#88366b;/);
  assert.match(css, /\.bar-chart\s*\{[\s\S]*grid-template-columns:\s*repeat\(30,/);
  assert.match(css, /\.habit-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(190px, 12vw\) repeat\(30, minmax\(32px, 1fr\)\);/);
  assert.match(css, /width:\s*100%;/);
  assert.doesNotMatch(css, /width:\s*min\(1320px, 100%\);/);
  assert.doesNotMatch(css, /\.momentum-hero,\s*\.habit-board,\s*\.closing-quote/);
  assert.match(css, /\.chart-card\s*\{[\s\S]*border-top:\s*1px solid var\(--soft-line\);/);
  assert.match(css, /\.chart-legend\s*\{[\s\S]*justify-content:\s*flex-start;/);
  assert.doesNotMatch(css, /\.legend-dot\.is-open/);
  assert.match(css, /\.status\.is-today-end\s*\{[\s\S]*border-bottom:\s*2px solid var\(--green-line\);/);
  assert.match(css, /\.habit-label:focus\s*\{[\s\S]*box-shadow:\s*0 0 0 2px rgba\(86, 196, 134, \.34\);/);
  assert.doesNotMatch(css, /\.habit-grid button/);
  assert.doesNotMatch(css, /\.habit-name-empty/);
  assert.match(css, /\.habit-spacer\s*\{[\s\S]*font-weight:\s*900;/);
  assert.doesNotMatch(css, /\.motivation-strip/);
  assert.doesNotMatch(css, /\.quote-card/);
  assert.doesNotMatch(css, /\.closing-quote/);
  assert.match(css, /\.status:focus-visible::before\s*\{[\s\S]*box-shadow:\s*0 0 0 3px rgba\(86, 196, 134, \.3\);/);
  assert.match(css, /@media \(max-width:\s*780px\)/);
});

test('live momentum script wires habit toggles to chart and score state', () => {
  const js = read('assets/live-momentum.js');

  assert.match(js, /const TOTAL_DAYS = 30;/);
  assert.match(js, /const STORAGE_KEY = 'softora\.liveMomentum\.v1';/);
  assert.match(js, /function toggleCell\(cell\)/);
  assert.match(js, /function updateChart\(\)/);
  assert.match(js, /function getDayScore\(day\)/);
  assert.match(js, /aria-checked/);
  assert.match(js, /scorePoints\.replaceChildren/);
  assert.match(js, /localStorage\.setItem\(STORAGE_KEY/);
});
