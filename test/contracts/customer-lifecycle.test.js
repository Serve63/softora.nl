const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeContactStatus } = require('../../server/services/customer-lifecycle');

test('customer lifecycle treats benaderd as mailed contact status', () => {
  assert.equal(normalizeContactStatus('benaderd'), 'gemaild');
  assert.equal(normalizeContactStatus('sent'), 'gemaild');
});
