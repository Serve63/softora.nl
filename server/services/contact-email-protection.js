// Website protection markers are source evidence, never recipient addresses.
// Keep the SQL predicate in contact_email_placeholder_guard in sync.
function isProtectedContactEmail(value) {
  const raw = String(value || '').trim();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw)) return false;
  const compact = raw.toLowerCase().replace(/&[^;\s]{1,32};/g, '').replace(/[^a-z]/g, '');
  return /emailprotected|emailprotection|cfemail/.test(compact);
}

function normalizeProtectedContactEmail(value) {
  return isProtectedContactEmail(value) ? '' : String(value || '').trim();
}

module.exports = { isProtectedContactEmail, normalizeProtectedContactEmail };
