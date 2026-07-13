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
  assert.match(html, /href="\/assets\/live-momentum\.css\?v=20260713b"/);
  assert.match(html, /<h1 id="momentum-title">Live momentum<\/h1>/);
  assert.match(html, /Jouw voortgang van de laatste 30 dagen/);
  assert.match(html, /<strong>80%<\/strong>/);
  assert.equal((html.match(/class="bar-wrap"/g) || []).length, 30);
  assert.match(html, /Workout/);
  assert.match(html, /90 min deep work/);
  assert.match(html, /Dagdoel behalen/);
  assert.match(html, /Gezonde voeding/);
  assert.match(html, /Discipline vandaag/);
  assert.match(html, /Focus\. Consistentie\. Groei\./);
  assert.doesNotMatch(html, /<script\b/i);
});

test('live momentum stylesheet keeps the visual replica self-contained', () => {
  const css = read('assets/live-momentum.css');

  assert.match(css, /--purple:\s*#88366b;/);
  assert.match(css, /\.bar-chart\s*\{[\s\S]*grid-template-columns:\s*repeat\(30,/);
  assert.match(css, /\.habit-grid\s*\{[\s\S]*grid-template-columns:\s*190px repeat\(30,/);
  assert.match(css, /width:\s*min\(1320px, 100%\);/);
  assert.match(css, /photo-1500530855697-b586d89ba3ee/);
  assert.match(css, /photo-1542362567-b07e54358753/);
  assert.match(css, /photo-1534438327276-14e5300c3a48/);
  assert.match(css, /@media \(max-width:\s*780px\)/);
});
