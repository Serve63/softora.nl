const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium customers page bootstraps customer rows before async sync runs', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<!-- SOFTORA_CUSTOMERS_BOOTSTRAP -->/);
  assert.match(pageSource, /function readCustomersBootstrapPayload\(\)/);
  assert.match(pageSource, /document\.getElementById\("softoraCustomersBootstrap"\)/);
  assert.match(pageSource, /function resolveBootstrapCustomers\(\)/);
  assert.match(
    pageSource,
    /const initialBootstrapCustomers = resolveBootstrapCustomers\(\);[\s\S]*state\.klanten = initialBootstrapCustomers;[\s\S]*renderPage\(\);/
  );
  assert.match(pageSource, /const hadBootstrapCustomers = state\.klanten\.length > 0;/);
});

test('premium customers page supports verantwoordelijke in table, modal and order import', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<th>Verantwoordelijk<\/th>/);
  assert.match(pageSource, /<label class="form-label" for="fieldResponsible">Verantwoordelijk<\/label>/);
  assert.match(pageSource, /<select class="form-select" id="fieldResponsible" name="verantwoordelijk" required>/);
  assert.match(pageSource, /<option value="Serve" selected>Serve<\/option>/);
  assert.match(pageSource, /<option value="Martijn">Martijn<\/option>/);
  assert.match(pageSource, /fieldResponsible: document\.getElementById\("fieldResponsible"\),/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
  assert.match(pageSource, /claimedBy: normalizeString\(item && \(item\.claimedBy \|\| item\.leadOwnerName \|\| item\.leadOwnerFullName\)\),/);
  assert.match(pageSource, /customer\.verantwoordelijk,/);
  assert.match(pageSource, /<td data-label=\\"Verantwoordelijk\\" class=\\"muted-cell\\">/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = "Serve";/);
  assert.match(pageSource, /if \(nodes\.fieldResponsible\) nodes\.fieldResponsible\.value = customer\.verantwoordelijk \|\| "Serve";/);
  assert.match(pageSource, /verantwoordelijk: nodes\.fieldResponsible \? nodes\.fieldResponsible\.value : "Serve",/);
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
});
