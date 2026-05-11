const CONTACT_STATUSES = Object.freeze([
  'nieuw',
  'prospect',
  'benaderbaar',
  'gebeld',
  'geengehoor',
  'gemaild',
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

const OUTREACH_BLOCKING_STATUSES = new Set([
  'interesse',
  'afspraak',
  'klant',
  'afgehaakt',
  'geblokkeerd',
  'buiten',
]);

const STATUS_PRIORITY = Object.freeze({
  nieuw: 10,
  prospect: 20,
  benaderbaar: 30,
  gebeld: 40,
  geengehoor: 45,
  gemaild: 50,
  buiten: 55,
  afgehaakt: 60,
  geblokkeerd: 70,
  interesse: 80,
  afspraak: 90,
  klant: 100,
});

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeStatusKey(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeContactStatus(value, row = {}) {
  const key = normalizeStatusKey(value);
  if (!key) {
    const activeValue = normalizeStatusKey(row && (row.actief ?? row.active ?? row.isActive));
    return ['nee', 'no', 'false', '0', 'inactive'].includes(activeValue) ? 'buiten' : '';
  }

  if (['nieuw', 'new'].includes(key)) return 'nieuw';
  if (['prospect', 'lead'].includes(key)) return 'prospect';
  if (['benaderbaar', 'open', 'callable', 'mailbaar'].includes(key)) return 'benaderbaar';
  if (['gebeld', 'called'].includes(key)) return 'gebeld';
  if (['geengehoor', 'geenbereik', 'noanswer', 'nietbereikbaar'].includes(key)) return 'geengehoor';
  if (['gemaild', 'mailed', 'emailsent'].includes(key)) return 'gemaild';
  if (['interesse', 'interested', 'geinteresseerd'].includes(key)) return 'interesse';
  if (['afspraak', 'appointment', 'meeting', 'ingepland'].includes(key)) return 'afspraak';
  if (['klant', 'customer', 'betaald', 'paid'].includes(key)) return 'klant';
  if (['afgehaakt', 'geendeal', 'nodeal', 'lost', 'nietdoorgegaan'].includes(key)) {
    return 'afgehaakt';
  }
  if (
    [
      'geblokkeerd',
      'geeninteresse',
      'geenbehoefte',
      'uitbellijst',
      'uitmaillijst',
      'donotcall',
      'donotmail',
      'dnc',
      'blocked',
      'optout',
      'unsubscribe',
    ].includes(key)
  ) {
    return 'geblokkeerd';
  }
  if (
    [
      'buiten',
      'buitengebruik',
      'buitendienst',
      'invalid',
      'invalidnumber',
      'notconnected',
      'disconnected',
      'inactive',
    ].includes(key)
  ) {
    return 'buiten';
  }

  return key;
}

function getContactStatusPriority(value) {
  const status = normalizeContactStatus(value);
  return STATUS_PRIORITY[status] || 0;
}

function chooseStrongerContactStatus(left, right) {
  const normalizedLeft = normalizeContactStatus(left);
  const normalizedRight = normalizeContactStatus(right);
  if (!normalizedLeft) return normalizedRight;
  if (!normalizedRight) return normalizedLeft;
  return getContactStatusPriority(normalizedRight) >= getContactStatusPriority(normalizedLeft)
    ? normalizedRight
    : normalizedLeft;
}

function canAdvanceContactStatus(currentStatus, nextStatus) {
  const current = normalizeContactStatus(currentStatus);
  const next = normalizeContactStatus(nextStatus);
  if (!next) return false;
  if (current === 'klant' && next !== 'klant') return false;
  return getContactStatusPriority(next) >= getContactStatusPriority(current);
}

function isOutreachBlockingStatus(value) {
  return OUTREACH_BLOCKING_STATUSES.has(normalizeContactStatus(value));
}

module.exports = {
  CONTACT_STATUSES,
  OUTREACH_BLOCKING_STATUSES,
  canAdvanceContactStatus,
  chooseStrongerContactStatus,
  getContactStatusPriority,
  isOutreachBlockingStatus,
  normalizeContactStatus,
};
