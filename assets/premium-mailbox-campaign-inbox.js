(function (global) {
  'use strict';

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function decorateMessage(mail, source) {
    const message = source && typeof source === 'object' ? source : {};
    return {
      ...mail,
      mailboxId: message.mailboxId || message.id,
      accountEmail: normalizeEmail(message.accountEmail),
      campaign: message.campaign || null,
      outreach: message.outreach || null,
    };
  }

  function isCampaignMail(mail) {
    return Boolean(mail && mail.campaign);
  }

  function getAccount(mail, fallbackAccount) {
    return normalizeEmail(mail && mail.accountEmail) || normalizeEmail(fallbackAccount);
  }

  function getRequestId(mail) {
    return String(mail && (mail.mailboxId || mail.id) || '').trim();
  }

  function getFolder(mail, activeFolder) {
    const folder = String(mail && mail.folder || activeFolder || '').trim().toLowerCase();
    return folder && folder !== 'outreach' ? folder : 'inbox';
  }

  function renderListMeta(mail, escapeHtml) {
    if (!isCampaignMail(mail) || typeof escapeHtml !== 'function') return '';
    const company = escapeHtml(mail.campaign.company || mail.email);
    const account = escapeHtml(mail.accountEmail || mail.campaign.account || '');
    const status = mail.campaign.actionRequired
      ? '<strong>Actie nodig</strong>'
      : '<em>Afgehandeld</em>';
    return `<div class="mail-campaign-meta"><span>${company}</span><span>${account}</span>${status}</div>`;
  }

  function renderDetailAccount(mail, escapeHtml) {
    if (!isCampaignMail(mail) || !mail.accountEmail || typeof escapeHtml !== 'function') return '';
    return `<div class="detail-campaign-account">Binnengekomen via ${escapeHtml(mail.accountEmail)}</div>`;
  }

  async function load(folder, normalizeMessage) {
    if (folder !== 'outreach') return null;
    if (
      !global.SoftoraMailboxOutreach ||
      typeof global.SoftoraMailboxOutreach.loadCampaignReplies !== 'function'
    ) {
      throw new Error('Coldmail Reacties is niet beschikbaar');
    }
    const replies = await global.SoftoraMailboxOutreach.loadCampaignReplies();
    return {
      messages: (Array.isArray(replies) ? replies : []).map(normalizeMessage),
      sync: {
        indexed: true,
        stale: false,
        source: 'campaign-replies',
        refreshRecommended: false,
        warming: false,
      },
    };
  }

  global.SoftoraMailboxCampaignInbox = {
    decorateMessage,
    getAccount,
    getFolder,
    getRequestId,
    isCampaignMail,
    load,
    renderDetailAccount,
    renderListMeta,
  };
})(typeof window !== 'undefined' ? window : globalThis);
