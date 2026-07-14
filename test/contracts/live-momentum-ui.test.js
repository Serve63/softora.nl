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
  assert.match(html, /href="\/assets\/live-momentum\.css\?v=20260713p"/);
  assert.match(html, /<script src="\/assets\/live-momentum\.js\?v=20260713e" defer><\/script>/);
  assert.match(html, /<h1 id="momentum-title">Live momentum<\/h1>/);
  assert.match(html, /Juli 2026 .* gestart op 13 juli/);
  assert.match(html, /<strong>100%<\/strong>/);
  assert.match(html, /<div class="bar-chart" aria-hidden="true"><\/div>/);
  assert.match(html, /<div class="habit-grid" role="table" aria-label="Momentum taken in juli"><\/div>/);
  assert.match(html, /13 juli is vandaag/);
  assert.doesNotMatch(html, /laatste 30 dagen/);
  assert.doesNotMatch(html, /Dag<br>/);
  assert.doesNotMatch(html, /chart-legend|legend-dot|Legenda/);
  assert.doesNotMatch(html, /Groen|Oranje|Rood/);
  assert.doesNotMatch(html, /Afgerond/);
  assert.doesNotMatch(html, /Dag 1 toevoegen/);
  assert.doesNotMatch(html, /Discipline vandaag/);
  assert.doesNotMatch(html, /Focus\. Consistentie\. Groei\./);
  assert.doesNotMatch(html, /motivation-strip/);
  assert.doesNotMatch(html, /closing-quote/);
  assert.doesNotMatch(html, /Nog te gaan/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
});

test('live momentum stylesheet keeps the visual replica self-contained', () => {
  const css = read('assets/live-momentum.css');

  assert.match(css, /--good:\s*#2fbf71;/);
  assert.match(css, /--warning:\s*#f0a22e;/);
  assert.match(css, /--danger:\s*#e45148;/);
  assert.doesNotMatch(css, /purple/i);
  assert.doesNotMatch(css, /88366b|74265c|91436f|7f426b/i);
  assert.match(css, /\.bar-chart\s*\{[\s\S]*grid-template-columns:\s*repeat\(var\(--day-count, 31\),/);
  assert.match(css, /\.habit-grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(190px, 12vw\) repeat\(var\(--day-count, 31\), minmax\(32px, 1fr\)\);/);
  assert.match(css, /width:\s*100%;/);
  assert.doesNotMatch(css, /width:\s*min\(1320px, 100%\);/);
  assert.doesNotMatch(css, /\.momentum-hero,\s*\.habit-board,\s*\.closing-quote/);
  assert.match(css, /\.chart-card\s*\{[\s\S]*border-top:\s*1px solid var\(--soft-line\);/);
  assert.doesNotMatch(css, /\.chart-legend|\.legend-dot/);
  assert.match(css, /\.bar\.is-warning\s*\{[\s\S]*var\(--warning\)/);
  assert.match(css, /\.bar\.is-danger\s*\{[\s\S]*var\(--danger\)/);
  assert.match(css, /\.status\.is-today-end\s*\{[\s\S]*border-bottom:\s*2px solid var\(--good-line\);/);
  assert.match(css, /\.status\.is-untracked::before\s*\{[\s\S]*background:\s*#d4d9df;/);
  assert.match(css, /\.status\.is-missed::before\s*\{[\s\S]*background-color:\s*var\(--danger\);/);
  assert.match(css, /\.habit-label:focus\s*\{[\s\S]*box-shadow:\s*0 0 0 2px rgba\(86, 196, 134, \.34\);/);
  assert.match(css, /\.add-goal\s*\{[\s\S]*border-radius:\s*999px;/);
  assert.match(css, /\.habit-add-cell\s*\{[\s\S]*min-height:\s*38px;/);
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

  assert.match(js, /startDay:\s*13/);
  assert.match(js, /today:\s*13/);
  assert.match(js, /lastDay:\s*31/);
  assert.match(js, /const TOTAL_DAYS = DAYS\.length;/);
  assert.match(js, /Juli 2026|shortLabel:\s*'Jul'/);
  assert.match(js, /DEFAULT_GOALS/);
  assert.match(js, /Workout/);
  assert.match(js, /90 min deep work/);
  assert.match(js, /Dagdoel behalen/);
  assert.match(js, /Gezonde voeding/);
  assert.match(js, /function getScoreBand\(score\)/);
  assert.match(js, /function toggleCell\(cell\)/);
  assert.match(js, /function updateChart\(\)/);
  assert.match(js, /function getDayScore\(day\)/);
  assert.match(js, /function renderChartShell\(\)/);
  assert.match(js, /function renderGridShell\(\)/);
  assert.match(js, /function createGoalRow\(\)/);
  assert.match(js, /function refreshCellData\(\)/);
  assert.match(js, /function updateTodayColumnEnd/);
  assert.match(js, /closest\('\.add-goal'\)/);
  assert.match(js, /button\.textContent = '\+'/);
  assert.match(js, /DAYS\.forEach\(\(\) =>/);
  assert.match(js, /is-untracked/);
  assert.match(js, /day < PERIOD\.startDay/);
  assert.match(js, /day < TODAY/);
  assert.match(js, /is-missed/);
  assert.match(js, /is-warning/);
  assert.match(js, /is-danger/);
  assert.match(js, /aria-checked/);
  assert.match(js, /scorePoints\.replaceChildren/);
  assert.doesNotMatch(js, /localStorage|sessionStorage/);
});
