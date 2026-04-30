const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pagePath = path.join(__dirname, '../../premium-pakketten.html');
const scriptPath = path.join(__dirname, '../../assets/premium-packages.js');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

function readScript() {
  return fs.readFileSync(scriptPath, 'utf8');
}

test('premium pakketten gebruikt een asset voor tabgedrag', () => {
  const pageSource = readPage();
  const scriptSource = readScript();

  assert.match(pageSource, /<script src="assets\/premium-packages\.js\?v=20260427a"><\/script>/);
  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.match(pageSource, /data-package-tab="routes"/);
  assert.match(pageSource, /data-package-tab="website"/);
  assert.match(pageSource, /data-package-tab="bedrijfssoftware"/);
  assert.match(pageSource, /data-package-tab="voicesoftware"/);
  assert.match(pageSource, /data-package-tab="chatbots"/);
  assert.match(pageSource, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(scriptSource, /var packageTabGroups = \{/);
  assert.match(pageSource, /Losse oplevering/);
  assert.match(pageSource, /Losse oplevering mét CRM/);
  assert.match(pageSource, /Softora Volledig beheer/);
  assert.match(pageSource, /<div class="card-badge">Aanbevolen<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="card-badge">Flexibel<\/div>/);
  assert.match(pageSource, /id="tab-routes" class="tab-panel theme-routes active"/);
  assert.match(pageSource, /id="tab-bouwen" class="tab-panel theme-website"/);
  assert.match(pageSource, /id="tab-onderhoud" class="tab-panel theme-website"/);
  assert.doesNotMatch(pageSource, /id="tab-onderhoud" class="tab-panel theme-website active"/);
  assert.match(scriptSource, /routes: \["routes"\]/);
  assert.match(scriptSource, /website: \["bouwen", "onderhoud"\]/);
  assert.match(scriptSource, /bedrijfssoftware: \["bedrijfssoftware", "bedrijfssoftware-onderhoud"\]/);
  assert.match(scriptSource, /voicesoftware: \["voice-software", "voice-software-onderhoud"\]/);
  assert.match(scriptSource, /chatbots: \["chatbots", "chatbots-onderhoud"\]/);
  assert.match(scriptSource, /event\.target\.closest\("\[data-package-tab\]"\)/);
  assert.match(scriptSource, /function switchTab\(name, tabEl\)/);
  assert.match(scriptSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/);
});
