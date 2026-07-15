'use strict';

const OUTBOUND_SENDER_IDENTITIES = Object.freeze({
  'serve@softora.nl': Object.freeze({ name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' }),
  'martijn@softora.nl': Object.freeze({ name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' }),
  'servecreusen@softora.nl': Object.freeze({ name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' }),
  'martijnvandeven@softora.nl': Object.freeze({ name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' }),
  'servec321@gmail.com': Object.freeze({ name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' }),
  'martijnven123@gmail.com': Object.freeze({ name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' }),
  'serve290@gmail.com': Object.freeze({ name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' }),
  'servecreusen7@gmail.com': Object.freeze({ name: 'Servé Creusen', location: 'Liempde', profileKey: 'serve' }),
  'contact.venvisuals@gmail.com': Object.freeze({ name: 'Martijn van de Ven', location: 'Alphen', profileKey: 'martijn' }),
});

const OUTBOUND_SENDER_DISPLAY_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(OUTBOUND_SENDER_IDENTITIES).map(([email, identity]) => [email, identity.name])
));
const OUTBOUND_SENDER_LOCATION_NAMES = Object.freeze(Object.fromEntries(
  Object.entries(OUTBOUND_SENDER_IDENTITIES).map(([email, identity]) => [email, identity.location])
));
const OUTBOUND_SENDER_PROFILE_KEYS = Object.freeze(Object.fromEntries(
  Object.entries(OUTBOUND_SENDER_IDENTITIES).map(([email, identity]) => [email, identity.profileKey])
));

function normalizeOutboundSenderEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function getOutboundSenderIdentity(email) {
  return OUTBOUND_SENDER_IDENTITIES[normalizeOutboundSenderEmail(email)] || null;
}

module.exports = {
  OUTBOUND_SENDER_DISPLAY_NAMES,
  OUTBOUND_SENDER_IDENTITIES,
  OUTBOUND_SENDER_LOCATION_NAMES,
  OUTBOUND_SENDER_PROFILE_KEYS,
  getOutboundSenderIdentity,
};
