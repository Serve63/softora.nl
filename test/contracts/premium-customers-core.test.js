const test = require('node:test');
const assert = require('node:assert/strict');

const customersCore = require('../../assets/premium-customers-core');

test('premium customers core normalizes shared customer fields', () => {
  assert.equal(customersCore.normalizeString('  Softora  '), 'Softora');
  assert.equal(customersCore.normalizeSearchValue(' Serv\u00e9 '), 'serv\u00e9');
  assert.equal(customersCore.normalizeDate('2026-04-28'), '2026-04-28');
  assert.equal(customersCore.normalizeDate('28-04-2026'), '');
  assert.equal(customersCore.normalizeActiveValue('nee'), 'Nee');
  assert.equal(customersCore.normalizeActiveValue('ja'), 'Ja');
});

test('premium customers core keeps responsible owner labels stable', () => {
  assert.equal(customersCore.parseResponsibleValue('Serv\u00e9 Creusen'), 'Serve');
  assert.equal(customersCore.parseResponsibleValue('Martijn'), 'Martijn');
  assert.equal(customersCore.parseResponsibleValue('Softora team'), 'Team');
  assert.equal(customersCore.normalizeResponsibleValue(''), 'Team');
  assert.equal(customersCore.formatResponsibleDisplayName('serve'), 'Serv\u00e9');
  assert.equal(customersCore.formatResponsibleDisplayName('martijn'), 'Martijn');
  assert.equal(customersCore.formatResponsibleDisplayName(''), 'Team');
  assert.equal(
    customersCore.getResponsibleSourceValue({ leadOwnerFullName: 'Martijn' }),
    'Martijn'
  );
});

test('premium customers core keeps service and lifecycle contracts stable', () => {
  assert.deepEqual(customersCore.CUSTOMER_SERVICE_OPTIONS, [
    'website',
    'bedrijfssoftware',
    'voicesoftware',
    'chatbot',
  ]);
  assert.equal(customersCore.normalizeCustomerService({ service: 'chatbot' }), 'chatbot');
  assert.equal(customersCore.normalizeCustomerService({ service: 'unknown' }), 'website');
  assert.equal(customersCore.formatCustomerServiceLabel('voicesoftware'), 'Voicesoftware');
  assert.equal(customersCore.normalizeCustomerReview({ review: 'Ja' }), 'Ja');
  assert.equal(customersCore.normalizeCustomerReview({ review: 'Nee' }), 'Nee');
  assert.equal(customersCore.normalizeCustomerDatabaseStatus({ databaseStatus: 'afspraak' }), 'afspraak');
  assert.equal(customersCore.normalizeCustomerDatabaseStatus({ databaseStatus: 'benaderbaar' }), 'benaderbaar');
  assert.equal(customersCore.normalizeCustomerDatabaseStatus({ status: 'Betaald' }), 'klant');
  assert.equal(customersCore.isCustomerLifecycleRecord({ databaseStatus: 'klant' }), true);
  assert.equal(customersCore.isCustomerLifecycleRecord({ databaseStatus: 'benaderbaar' }), false);
  assert.equal(customersCore.isCustomerLifecycleRecord({ status: 'prospect' }), false);
  assert.equal(customersCore.isCustomerLifecycleRecord({ databaseStatus: 'afgehaakt' }), false);
});
