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
  assert.match(pageSource, /function mergeCustomersWithResponsible\(customers, orders\)/);
  assert.match(pageSource, /function deriveCustomersFromOrders\(orders\)/);
});

test('premium customers page renders the new database UI while preserving persistence hooks', () => {
  const pagePath = path.join(__dirname, '../../premium-klanten.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<title>Softora \| Database<\/title>/);
  assert.match(pageSource, /<div class="page-title">Database<\/div>/);
  assert.match(pageSource, /<button class="btn prim" id="addButton" type="button">[\s\S]*Toevoegen/);
  assert.match(pageSource, /<tbody id="tbody"><\/tbody>/);
  assert.match(pageSource, /<div class="panel" id="panel" aria-hidden="true">/);
  assert.match(pageSource, /<textarea class="p-ta" id="p-nota"/);
  assert.match(pageSource, /<select class="p-sel" id="p-status">/);
  assert.match(pageSource, /<select class="msel" id="m-responsible">[\s\S]*Servé[\s\S]*Martijn/);
  assert.match(pageSource, /function parseResponsibleValue\(value\)/);
  assert.match(pageSource, /function normalizeResponsibleValue\(value\)/);
  assert.match(pageSource, /function formatResponsibleDisplayName\(value\)/);
  assert.match(pageSource, /function getResponsibleSourceValue\(raw\)/);
  assert.match(pageSource, /function openPanel\(id\)/);
  assert.match(pageSource, /function saveNota\(\)/);
  assert.match(pageSource, /function applyPanelStatus\(\)/);
  assert.match(pageSource, /function addCustomerFromModal\(\)/);
  assert.match(pageSource, /function exportCSV\(\)/);
  assert.match(pageSource, /fetchUiStateSetWithFallback\(CUSTOMER_DB_SCOPE/);
  assert.match(pageSource, /source: "premium-klanten"/);
  assert.match(pageSource, /actor: "Premium klanten database"/);
});
