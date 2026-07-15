'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  OUTBOUND_SENDER_IDENTITIES,
  getOutboundSenderIdentity,
} = require('../../server/services/outbound-sender-identity');

const EXPECTED_IDENTITIES = {
  'serve@softora.nl': { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' },
  'martijn@softora.nl': { name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' },
  'servecreusen@softora.nl': { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' },
  'martijnvandeven@softora.nl': { name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' },
  'servec321@gmail.com': { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' },
  'martijnven123@gmail.com': { name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' },
  'serve290@gmail.com': { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' },
  'servecreusen7@gmail.com': { name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' },
  'contact.venvisuals@gmail.com': { name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' },
};

test('outbound sender identities lock the exact nine mailbox personas', () => {
  assert.deepEqual(OUTBOUND_SENDER_IDENTITIES, EXPECTED_IDENTITIES);
  for (const [email, identity] of Object.entries(EXPECTED_IDENTITIES)) {
    assert.deepEqual(getOutboundSenderIdentity(email.toUpperCase()), identity);
  }
  assert.equal(getOutboundSenderIdentity('unknown@example.test'), null);
});
