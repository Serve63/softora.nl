(function (global) {
  'use strict';

  const OWNER_OPTIONS = Object.freeze([
    Object.freeze({ key: 'both', label: 'Beide' }),
    Object.freeze({ key: 'serve', label: 'Servé' }),
    Object.freeze({ key: 'martijn', label: 'Martijn' }),
  ]);
  const ACCOUNT_OWNERS = Object.freeze({
    'serve@softora.nl': 'serve',
    'servecreusen@softora.nl': 'serve',
    'servec321@gmail.com': 'serve',
    'serve290@gmail.com': 'serve',
    'servecreusen7@gmail.com': 'serve',
    'martijn@softora.nl': 'martijn',
    'martijnvandeven@softora.nl': 'martijn',
    'martijnven123@gmail.com': 'martijn',
    'contact.venvisuals@gmail.com': 'martijn',
  });
  let activeOwner = 'both';

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    if (owner === 'serve' || owner === 'servé') return 'serve';
    if (owner === 'martijn') return 'martijn';
    return 'both';
  }

  function getOwnerByAccount(value) {
    return ACCOUNT_OWNERS[normalizeEmail(value)] || '';
  }

  function isCampaignAccount(value) {
    return Boolean(getOwnerByAccount(value));
  }

  function getOwner() {
    return activeOwner;
  }

  function setOwner(value) {
    activeOwner = normalizeOwner(value);
    return activeOwner;
  }

  function getOwnerLabel(value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return OWNER_OPTIONS.find((option) => option.key === owner)?.label || 'Beide';
  }

  function filterMessages(messages, value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return (Array.isArray(messages) ? messages : []).filter((mail) => {
      const accountOwner = getOwnerByAccount(
        mail && (mail.accountEmail || mail.campaign && mail.campaign.account)
      );
      return Boolean(accountOwner && (owner === 'both' || accountOwner === owner));
    });
  }

  function renderOwnerMenu(escapeHtml) {
    const html = typeof escapeHtml === 'function' ? escapeHtml : String;
    return OWNER_OPTIONS.map((option) => `
      <div class="topbar-mailbox-option-row">
        <button class="topbar-mailbox-option${option.key === activeOwner ? ' active' : ''}" type="button" data-mailbox-owner="${html(option.key)}" role="menuitemradio" aria-checked="${option.key === activeOwner ? 'true' : 'false'}">
          <span>${html(option.label)}</span>
        </button>
      </div>`).join('');
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

  const campaignInboxApi = {
    decorateMessage,
    filterMessages,
    getAccount,
    getFolder,
    getOwner,
    getOwnerByAccount,
    getOwnerLabel,
    getRequestId,
    isCampaignMail,
    isCampaignAccount,
    load,
    renderDetailAccount,
    renderListMeta,
    renderOwnerMenu,
    setOwner,
  };
  global.SoftoraMailboxCampaignInbox = campaignInboxApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = campaignInboxApi;
})(typeof window !== 'undefined' ? window : globalThis);
