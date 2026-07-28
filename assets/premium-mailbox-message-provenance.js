(function (global) {
  'use strict';

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function extractEmail(value) {
    const source = normalize(value);
    const match = source.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? match[0] : source;
  }

  function normalizeIdentity(value) {
    const email = extractEmail(value);
    const separator = email.lastIndexOf('@');
    if (separator <= 0) return email;
    let local = email.slice(0, separator);
    let domain = email.slice(separator + 1);
    if (domain === 'googlemail.com') domain = 'gmail.com';
    if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
    return `${local}@${domain}`;
  }

  function getDirection(message, options = {}) {
    const source = message && typeof message === 'object' ? message : {};
    const folders = [
      source.folder,
      source.storageFolder,
      ...(Array.isArray(source.sourceFolders) ? source.sourceFolders : []),
    ].map(normalize).filter(Boolean);
    if (folders.includes('sent')) return 'sent';
    const explicitDirection = normalize(source.direction);
    if (['sent', 'outbound', 'outgoing'].includes(explicitDirection)) return 'sent';
    if (['received', 'inbound', 'incoming'].includes(explicitDirection)) return 'received';
    const account = normalizeIdentity(
      source.accountEmail || source.providerAccountEmail || source.campaign && source.campaign.account || options.account
    );
    const sender = normalizeIdentity(source.email || source.senderEmail);
    return account && sender && account === sender ? 'sent' : 'received';
  }

  function isSent(message, options) {
    return getDirection(message, options) === 'sent';
  }

  global.SoftoraMailboxMessageProvenance = { getDirection, isSent, normalizeIdentity };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SoftoraMailboxMessageProvenance;
})(typeof window !== 'undefined' ? window : globalThis);
