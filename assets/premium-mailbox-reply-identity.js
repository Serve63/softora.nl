(function (global) {
  'use strict';

  function resolveReplyAccount(mail, fallbackAccount, selectedOwner, helpers = {}) {
    const normalizeEmail = helpers.normalizeEmail || ((value) => String(value || '').trim().toLowerCase());
    const normalizeOwner = helpers.normalizeOwner || ((value) => String(value || '').trim().toLowerCase());
    const isPersonalOwner = helpers.isPersonalOwner || (() => false);
    const getMessageOwner = helpers.getMessageOwner || (() => '');
    const getOwnerByAccount = helpers.getOwnerByAccount || (() => '');
    const selectedRaw = String(selectedOwner || '').trim().toLowerCase();
    const selected = ['serve', 'servé', 'martijn', 'both', 'all'].includes(selectedRaw)
      ? normalizeOwner(selectedRaw)
      : '';
    const provider = String(mail && mail.provider || '').trim().toLowerCase();
    if (provider === 'instantly') {
      const providerAccount = normalizeEmail(mail && mail.providerAccountEmail);
      const providerOwner = getMessageOwner(mail);
      if (!providerAccount || !isPersonalOwner(providerOwner)) return '';
      if (selected && selected !== 'both' && providerOwner !== selected) return '';
      return providerAccount;
    }
    const directCandidates = [
      mail && mail.accountEmail,
      mail && mail.campaign && mail.campaign.account,
      mail && mail.providerAccountEmail,
      mail && mail.copyContext && mail.copyContext.evidenceKnown === true
        ? mail.copyContext.sourceAccountEmail
        : '',
    ].map(normalizeEmail).filter(Boolean);
    for (const account of directCandidates) {
      const owner = getOwnerByAccount(account);
      if (!owner) continue;
      if (!selected || selected === 'both' || owner === selected) return account;
      return '';
    }

    const provenOwner = getMessageOwner(mail);
    const fallback = normalizeEmail(fallbackAccount);
    const fallbackOwner = getOwnerByAccount(fallback);
    if (!fallbackOwner) return '';
    if (selected === 'both' && !provenOwner) return '';
    if (selected && selected !== 'both' && fallbackOwner !== selected) return '';
    if (provenOwner && provenOwner !== fallbackOwner) return '';
    return fallback;
  }

  function createReplyIdentity(mail, accountEmail, owner) {
    const provider = String(mail && mail.provider || '').trim().toLowerCase() || 'smtp';
    const account = String(accountEmail || mail && (mail.providerAccountEmail || mail.accountEmail) || '').trim().toLowerCase();
    return {
      version: 1,
      provider,
      owner: String(owner || mail && mail.providerOwner || '').trim().toLowerCase(),
      accountEmail: account,
      providerAccountEmail: provider === 'instantly'
        ? String(mail && mail.providerAccountEmail || account).trim().toLowerCase()
        : '',
      providerMessageId: provider === 'instantly' ? String(mail && mail.providerMessageId || '').trim() : '',
      providerThreadId: provider === 'instantly' ? String(mail && mail.providerThreadId || '').trim() : '',
      sourceMessageId: String(mail && mail.messageId || '').trim(),
      conversationId: String(mail && mail.conversationId || '').trim(),
    };
  }

  global.SoftoraMailboxReplyIdentity = { createReplyIdentity, resolveReplyAccount };
  if (typeof module !== 'undefined' && module.exports) module.exports = global.SoftoraMailboxReplyIdentity;
})(typeof window !== 'undefined' ? window : globalThis);
