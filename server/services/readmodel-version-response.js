// Shared protocol for versioned read models (docs/platform-performance.md).
// The browser sends the version of its verified local copy in
// X-Softora-Readmodel-Version. When the server proves the same version from
// the database change counters, it answers "unchanged" and skips the expensive
// build; otherwise it returns the full part plus its new version.
const { createHash } = require('node:crypto');

const READMODEL_VERSION_HEADER = 'x-softora-readmodel-version';
const VERSION_PATTERN = /^rm1-[a-f0-9]{40}$/;

function buildReadModelVersion(parts = []) {
  const values = (Array.isArray(parts) ? parts : []).map((part) => String(part ?? ''));
  if (!values.length || values.some((value) => !value)) return '';
  return `rm1-${createHash('sha256').update(values.join('\u001f')).digest('hex').slice(0, 40)}`;
}

function readRequestedReadModelVersion(req) {
  const value = String(req?.get?.(READMODEL_VERSION_HEADER) || req?.headers?.[READMODEL_VERSION_HEADER] || '').trim();
  return VERSION_PATTERN.test(value) ? value : '';
}

function amsterdamDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const get = (type) => (parts.find((part) => part.type === type) || {}).value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

module.exports = {
  READMODEL_VERSION_HEADER,
  amsterdamDateKey,
  buildReadModelVersion,
  readRequestedReadModelVersion,
};
