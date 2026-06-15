const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  normalizePostCallStatus,
  sanitizePostCallText,
} = require('../../server/services/agenda-runtime');

test('agenda runtime helpers normalize post-call statuses conservatively', () => {
  const normalizeString = (value) => String(value || '').trim();
  const truncateText = (value, maxLen) => String(value || '').slice(0, maxLen);

  assert.equal(
    normalizePostCallStatus('', normalizeString, truncateText),
    'customer_wants_to_proceed'
  );
  assert.equal(
    normalizePostCallStatus('klant_wil_door', normalizeString, truncateText),
    'customer_wants_to_proceed'
  );
  assert.equal(
    normalizePostCallStatus(' custom_status ', normalizeString, truncateText),
    'custom_status'
  );
});

test('agenda runtime helpers trim post-call text to a safe limit', () => {
  const normalizeString = (value) => String(value || '').trim();
  const truncateText = (value, maxLen) => String(value || '').slice(0, maxLen);

  assert.equal(
    sanitizePostCallText('  voorbeeld  ', normalizeString, truncateText, 20),
    'voorbeeld'
  );
  assert.equal(
    sanitizePostCallText('abcdefghij', normalizeString, truncateText, 5),
    'abcde'
  );
});

test('agenda runtime injecteert klanten-bootstrap ook op het premium dashboard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../server/services/agenda-runtime.js'),
    'utf8'
  );

  assert.match(source, /fileName === 'premium-personeel-dashboard\.html'/);
  assert.match(source, /const isPremiumDatabase = fileName === 'premium-database\.html';/);
  assert.doesNotMatch(source, /isPremiumDashboard \? getUiStateValues\(premiumActiveOrdersScope\) : Promise\.resolve\(null\)/);
  assert.match(source, /buildCustomersBootstrapPayload\(\{\s*includeCustomers: !isPremiumDatabase,\s*\}\)/);
  assert.match(source, /marker: 'SOFTORA_CUSTOMERS_BOOTSTRAP'/);
  assert.match(source, /scriptId: 'softoraCustomersBootstrap'/);
  assert.match(source, /buildDashboardHtmlReplacements\(dashboardPayload\)/);
});

test('agenda runtime injecteert actieve-opdrachten bootstrap op de opdrachtenpagina', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../server/services/agenda-runtime.js'),
    'utf8'
  );

  assert.match(source, /fileName === 'premium-actieve-opdrachten\.html'/);
  assert.match(source, /marker: 'SOFTORA_ACTIVE_ORDERS_BOOTSTRAP'/);
  assert.match(source, /scriptId: 'softoraActiveOrdersBootstrap'/);
  assert.match(source, /buildActiveOrdersPageBootstrapPayload\(\)/);
});
