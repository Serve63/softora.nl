function normalizeText(value) {
  return String(value || '').trim();
}

function extractEmail(value) {
  const source = normalizeText(value).toLowerCase();
  const match = source.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return match ? match[0] : source;
}

function normalizeMailboxIdentity(value) {
  const email = extractEmail(value);
  const separator = email.lastIndexOf('@');
  if (separator <= 0) return email;
  let local = email.slice(0, separator);
  let domain = email.slice(separator + 1);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    local = local.split('+')[0].replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

function isSameMailboxIdentity(left, right) {
  const first = normalizeMailboxIdentity(left);
  const second = normalizeMailboxIdentity(right);
  return Boolean(first && second && first === second);
}

function getMessageSourceFolders(message) {
  return Array.from(new Set([
    normalizeText(message && message.folder).toLowerCase(),
    normalizeText(message && message.storageFolder).toLowerCase(),
    ...(Array.isArray(message && message.sourceFolders) ? message.sourceFolders : []),
  ].map((value) => normalizeText(value).toLowerCase()).filter(Boolean)));
}

function getMailboxMessageDirection(message) {
  const source = message && typeof message === 'object' ? message : {};
  const folders = getMessageSourceFolders(source);
  if (folders.includes('sent')) return 'sent';

  const explicitDirection = normalizeText(source.direction).toLowerCase();
  if (['sent', 'outbound', 'outgoing'].includes(explicitDirection)) return 'sent';
  if (['received', 'inbound', 'incoming'].includes(explicitDirection)) return 'received';

  const account = normalizeMailboxIdentity(
    source.accountEmail || source.providerAccountEmail || source.campaign && source.campaign.account
  );
  const sender = normalizeMailboxIdentity(source.email || source.senderEmail);
  if (account && sender && account === sender) return 'sent';
  return 'received';
}

function normalizeMessageProvenance(message) {
  const source = message && typeof message === 'object' ? message : {};
  const storageFolder = normalizeText(source.storageFolder || source.folder).toLowerCase();
  const sourceFolders = getMessageSourceFolders(source);
  const direction = getMailboxMessageDirection({ ...source, sourceFolders });
  return {
    ...source,
    direction,
    folder: direction === 'sent'
      ? 'sent'
      : normalizeText(source.folder || storageFolder || 'inbox').toLowerCase() || 'inbox',
    storageFolder,
    sourceFolders,
  };
}

module.exports = {
  extractEmail,
  getMailboxMessageDirection,
  getMessageSourceFolders,
  isSameMailboxIdentity,
  normalizeMailboxIdentity,
  normalizeMessageProvenance,
};
