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

  assert.match(pageSource, /<script src="assets\/premium-packages\.js\?v=20260430a"><\/script>/);
  assert.doesNotMatch(pageSource, /\son[a-z]+=/);
  assert.match(pageSource, /data-package-tab="routes"/);
  assert.match(pageSource, /id="tab-routes"/);
  assert.match(pageSource, /Website routes/);
  assert.match(pageSource, /Los opleveren/);
  assert.match(pageSource, /Website met CRM/);
  assert.match(pageSource, /Volledig beheer/);
  assert.match(pageSource, /CRM vanaf €200 eenmalig/);
  assert.match(pageSource, /Minimaal €30 per maand/);
  assert.match(pageSource, /data-package-tab="website"/);
  assert.match(pageSource, /data-package-tab="bedrijfssoftware"/);
  assert.match(pageSource, /data-package-tab="voicesoftware"/);
  assert.match(pageSource, /data-package-tab="chatbots"/);
  assert.match(scriptSource, /var packageTabGroups = \{/);
  assert.match(scriptSource, /routes: \["routes"\]/);
  assert.match(scriptSource, /website: \["bouwen", "onderhoud"\]/);
  assert.match(scriptSource, /bedrijfssoftware: \["bedrijfssoftware", "bedrijfssoftware-onderhoud"\]/);
  assert.match(scriptSource, /voicesoftware: \["voice-software", "voice-software-onderhoud"\]/);
  assert.match(scriptSource, /chatbots: \["chatbots", "chatbots-onderhoud"\]/);
  assert.match(scriptSource, /event\.target\.closest\("\[data-package-tab\]"\)/);
  assert.match(scriptSource, /function switchTab\(name, tabEl\)/);
  assert.match(scriptSource, /SoftoraPremiumBoot\.setShellBooting\(false\)/);
});
