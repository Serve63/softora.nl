const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePinnedRecipientLocationLines,
  resolveRecipientPlace,
} = require('../../server/services/outreach-recipient-location');

test('recipient location resolves a municipality before a trailing Dutch province', () => {
  const cases = [
    ['Energieweg, Udenhout, Noord-Brabant', 'Udenhout'],
    ['Dorpsstraat 1, Bergen, Noord-Holland', 'Bergen'],
    ['Havenweg 2, Kampen, Overijssel', 'Kampen'],
    ['Markt 3, Venlo, Limburg', 'Venlo'],
    ['Tongeren, Boxtel, N.Br.', 'Boxtel'],
    ['Dorpsstraat 1, 5061 AA Oisterwijk', 'Oisterwijk'],
    ['Reitselaan 45 Haaren (NB)', 'Haaren'],
  ];
  for (const [stad, expected] of cases) {
    assert.equal(resolveRecipientPlace({ stad }), expected, stad);
  }
});

test('recipient location never promotes an unambiguous province-only value to a city', () => {
  for (const province of [
    'Noord-Brabant',
    'Noord-Holland',
    'Zuid-Holland',
    'Gelderland',
    'Limburg',
    'Overijssel',
    'Drenthe',
    'Flevoland',
    'Friesland',
  ]) {
    assert.equal(resolveRecipientPlace({ stad: province }), '', province);
    assert.equal(resolveRecipientPlace({ city: province }), '', `${province} in expliciet city-veld`);
  }
  assert.equal(resolveRecipientPlace({ stad: 'Utrecht' }), 'Utrecht');
  assert.equal(resolveRecipientPlace({ plaats: 'Groningen' }), 'Groningen');
});

test('outbound location-line guard replaces a province pin with the resolved recipient city', () => {
  assert.equal(
    normalizePinnedRecipientLocationLines('Servé Creusen\n\n📍 Noord-Brabant', 'Udenhout'),
    'Servé Creusen\n\n📍 Udenhout'
  );
  assert.equal(
    normalizePinnedRecipientLocationLines('Servé Creusen\n\n📍 Noord-Brabant', ''),
    'Servé Creusen\n\n📍 uw regio'
  );
  assert.equal(
    normalizePinnedRecipientLocationLines('Servé Creusen\n\n📍 Utrecht', 'Utrecht'),
    'Servé Creusen\n\n📍 Utrecht'
  );
});
