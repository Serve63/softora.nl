function normalizeLeadIdentityText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function normalizeLeadLikePhoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0031')) return `31${digits.slice(4)}`;
  if (digits.startsWith('31')) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return `31${digits.slice(1)}`;
  if (digits.startsWith('6') && digits.length === 9) return `31${digits}`;
  return digits;
}

function resolveLeadIdentityCompany(item = {}) {
  return String(
    item?.company ||
      item?.leadCompany ||
      item?.bedrijf ||
      item?.companyName ||
      item?.clientName ||
      ''
  ).trim();
}

function resolveLeadIdentityContact(item = {}) {
  return String(
    item?.contact ||
      item?.contactName ||
      item?.contactPerson ||
      item?.contactpersoon ||
      item?.leadName ||
      item?.name ||
      item?.location ||
      ''
  ).trim();
}

function buildLeadIdentityKey(item = {}) {
  const phoneKey = normalizeLeadLikePhoneKey(item?.phone || item?.telefoon || item?.contactPhone || '');
  if (phoneKey) return `phone:${phoneKey}`;

  const companyKey = normalizeLeadIdentityText(resolveLeadIdentityCompany(item));
  const contactKey = normalizeLeadIdentityText(resolveLeadIdentityContact(item));
  if (companyKey || contactKey) return `name:${companyKey}|${contactKey}`;
  return '';
}

module.exports = {
  buildLeadIdentityKey,
  normalizeLeadIdentityText,
  normalizeLeadLikePhoneKey,
  resolveLeadIdentityCompany,
  resolveLeadIdentityContact,
};
