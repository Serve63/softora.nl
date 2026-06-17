const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

const repoRoot = path.join(__dirname, '../..');

test('kvk database clean URL resolves to the protected premium snapshot page', () => {
  const slugMap = createKnownPrettyPageSlugToFile(new Set(['premium-kvk-database.html']));

  assert.equal(slugMap.get('premium-kvk-database'), 'premium-kvk-database.html');
  assert.equal(slugMap.get('kvk-database'), 'premium-kvk-database.html');
});

test('kvk database snapshot page contains the local Bedrijven Scraper dashboard', () => {
  const pageSource = fs.readFileSync(path.join(repoRoot, 'premium-kvk-database.html'), 'utf8');

  assert.match(pageSource, /<title>Softora Database \| Bedrijven Scraper<\/title>/);
  assert.match(pageSource, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(pageSource, /<script id="kvkSnapshot" type="application\/json">/);
  assert.match(pageSource, /<h1>Bedrijven Scraper<\/h1>/);
  assert.match(pageSource, /id="companies-treated"/);
  assert.match(pageSource, /"companies_found":1123744/);
  assert.match(pageSource, /"with_website":239/);
  assert.match(pageSource, /"unusable":877/);
  assert.match(pageSource, /"all":1123744/);
  assert.match(pageSource, /"usable":263/);
  assert.match(pageSource, /"bedrijfsnaam":"Scouting St\. Joris Haaren"/);
  assert.match(pageSource, /assets\/kvk-database\.js\?v=20260617b/);
});
