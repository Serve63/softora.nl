const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLeadIdentityKey,
  normalizeLeadIdentityText,
  normalizeLeadLikePhoneKey,
  resolveLeadIdentityCompany,
  resolveLeadIdentityContact,
} = require('../../server/services/lead-identity');

test('lead identity normalizes Dutch phone formats to one reusable key', () => {
  assert.equal(normalizeLeadLikePhoneKey('06 12 34 56 78'), '31612345678');
  assert.equal(normalizeLeadLikePhoneKey('+31 6 12 34 56 78'), '31612345678');
  assert.equal(normalizeLeadLikePhoneKey('00316-12345678'), '31612345678');
});

test('lead identity resolves company and contact across mixed source field names', () => {
  const row = {
    leadCompany: 'Softora B.V.',
    contactPerson: 'Servé Creusen',
  };

  assert.equal(resolveLeadIdentityCompany(row), 'Softora B.V.');
  assert.equal(resolveLeadIdentityContact(row), 'Servé Creusen');
  assert.equal(buildLeadIdentityKey(row), 'name:softora b.v.|serve creusen');
});

test('lead identity prefers normalized phone keys over name matching when present', () => {
  const row = {
    company: 'Softora',
    contactName: 'Servé',
    phone: '+31 6 12 34 56 78',
  };

  assert.equal(buildLeadIdentityKey(row), 'phone:31612345678');
  assert.equal(normalizeLeadIdentityText('Servé Creusen'), 'serve creusen');
});
