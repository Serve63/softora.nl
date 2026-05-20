const LEGACY_MAILBOX_EMAIL_REPLACEMENTS = Object.freeze({
  'zakelijk@theimpactbox.co': 'zakelijk@softora.nl',
});

function normalizeString(value) {
  return String(value || '').trim();
}

function replaceLegacyMailboxEmail(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  return LEGACY_MAILBOX_EMAIL_REPLACEMENTS[normalized.toLowerCase()] || normalized;
}

function normalizeMailboxAccountEmail(value) {
  return replaceLegacyMailboxEmail(value).toLowerCase();
}

module.exports = {
  normalizeMailboxAccountEmail,
  replaceLegacyMailboxEmail,
};
