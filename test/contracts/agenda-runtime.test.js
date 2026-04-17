const test = require('node:test');
const assert = require('node:assert/strict');

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
