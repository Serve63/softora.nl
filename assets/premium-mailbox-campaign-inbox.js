(function (global) {
  'use strict';

  const OWNER_OPTIONS = Object.freeze([
    Object.freeze({ key: 'serve', label: 'Servé Creusen' }),
    Object.freeze({ key: 'martijn', label: 'Martijn van de Ven' }),
    Object.freeze({ key: 'both', label: 'Servé & Martijn' }),
  ]);
  const OWNER_PIN_SCOPE = 'premium_mailbox_preferences';
  const OWNER_PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';
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
  let defaultOwner = 'both';
  let pinnedOwner = '';
  let preferenceIdentity = 'anonymous';

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    if (owner === 'serve' || owner === 'servé') return 'serve';
    if (owner === 'martijn') return 'martijn';
    return 'both';
  }

  function isOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    return owner === 'serve' || owner === 'servé' || owner === 'martijn' || owner === 'both';
  }

  function getOwnerByAccount(value) {
    return ACCOUNT_OWNERS[normalizeEmail(value)] || '';
  }

  function resolveOwnerForSession(session) {
    const source = session && typeof session === 'object' ? session : {};
    const emailOwner = getOwnerByAccount(source.email);
    if (emailOwner) return emailOwner;
    const identity = [source.firstName, source.lastName, source.displayName]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (/\bmartijn\b/.test(identity)) return 'martijn';
    if (/\bserve\b/.test(identity)) return 'serve';
    return 'both';
  }

  function getOwnerPinKeyForIdentity(identity) {
    const normalizedIdentity = String(identity || '')
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, '_')
      .slice(0, 72) || 'anonymous';
    return `${OWNER_PIN_KEY_PREFIX}${normalizedIdentity}`;
  }

  async function initializeOwnerPreference(session, uiStateClient, identity) {
    defaultOwner = resolveOwnerForSession(session);
    preferenceIdentity = String(identity || '').trim().toLowerCase() || 'anonymous';
    pinnedOwner = '';
    try {
      if (uiStateClient && typeof uiStateClient.get === 'function') {
        const payload = await uiStateClient.get(OWNER_PIN_SCOPE);
        const values = payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object'
          ? payload.values
          : {};
        const savedOwner = values[getOwnerPinKeyForIdentity(preferenceIdentity)];
        if (isOwner(savedOwner)) pinnedOwner = normalizeOwner(savedOwner);
      }
    } catch (_) {
      pinnedOwner = '';
    }
    setOwner(pinnedOwner || defaultOwner);
    return { defaultOwner, pinnedOwner, activeOwner };
  }

  async function pinOwner(value, uiStateClient) {
    if (!isOwner(value)) {
      return { owner: activeOwner, label: getOwnerLabel(), saved: false };
    }
    pinnedOwner = normalizeOwner(value);
    setOwner(pinnedOwner);
    let saved = false;
    try {
      if (uiStateClient && typeof uiStateClient.set === 'function') {
        await uiStateClient.set(OWNER_PIN_SCOPE, {
          patch: { [getOwnerPinKeyForIdentity(preferenceIdentity)]: pinnedOwner },
          source: 'premium-mailbox',
          actor: preferenceIdentity,
        });
        saved = true;
      }
    } catch (_) {
      saved = false;
    }
    return { owner: pinnedOwner, label: getOwnerLabel(pinnedOwner), saved };
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
    return OWNER_OPTIONS.find((option) => option.key === owner)?.label || 'Servé & Martijn';
  }

  function getReceivedTimestamp(mail) {
    const value = mail && (mail.receivedAt || mail.internalDate || mail.date);
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function sortMessagesNewestFirst(messages) {
    return (Array.isArray(messages) ? messages : [])
      .slice()
      .sort((left, right) => getReceivedTimestamp(right) - getReceivedTimestamp(left));
  }

  function filterMessages(messages, value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return sortMessagesNewestFirst(
      (Array.isArray(messages) ? messages : []).filter((mail) => {
        const accountOwner = getOwnerByAccount(
          mail && (mail.accountEmail || mail.campaign && mail.campaign.account)
        );
        return Boolean(accountOwner && (owner === 'both' || accountOwner === owner));
      })
    );
  }

  function getOwnerOptionsForMenu(primaryOwner) {
    const primary = isOwner(primaryOwner) ? normalizeOwner(primaryOwner) : '';
    const personalOptions = OWNER_OPTIONS.filter((option) => option.key !== 'both');
    if (primary === 'serve' || primary === 'martijn') {
      personalOptions.sort((left, right) => {
        if (left.key === primary) return -1;
        if (right.key === primary) return 1;
        return 0;
      });
    }
    return [...personalOptions, OWNER_OPTIONS.find((option) => option.key === 'both')];
  }

  function renderOwnerMenu(escapeHtml, options) {
    const html = typeof escapeHtml === 'function' ? escapeHtml : String;
    const settings = options && typeof options === 'object' ? options : {};
    const menuPinnedOwner = Object.prototype.hasOwnProperty.call(settings, 'pinnedOwner')
      ? (isOwner(settings.pinnedOwner) ? normalizeOwner(settings.pinnedOwner) : '')
      : pinnedOwner;
    const menuDefaultOwner = Object.prototype.hasOwnProperty.call(settings, 'defaultOwner')
      ? (isOwner(settings.defaultOwner) ? normalizeOwner(settings.defaultOwner) : '')
      : defaultOwner;
    const primaryOwner = menuPinnedOwner || menuDefaultOwner;
    return getOwnerOptionsForMenu(primaryOwner).map((option) => {
      const isPinned = option.key === menuPinnedOwner;
      return `
      <div class="topbar-mailbox-option-row${isPinned ? ' pinned' : ''}">
        <button class="topbar-mailbox-option${option.key === activeOwner ? ' active' : ''}" type="button" data-mailbox-owner="${html(option.key)}" role="menuitemradio" aria-checked="${option.key === activeOwner ? 'true' : 'false'}">
          <span>${html(option.label)}</span>
        </button>
        <button class="topbar-mailbox-pin${isPinned ? ' active' : ''}" type="button" data-mailbox-pin-owner="${html(option.key)}" aria-label="${isPinned ? 'Vastgepinde mailbox' : `${option.label} vastpinnen`}" title="${isPinned ? 'Vastgepinde mailbox' : `${option.label} vastpinnen`}">
          <svg viewBox="0 0 24 24" fill="${isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M14 4l6 6-4 1-4.5 4.5L11 20l-7-7 4.5-.5L13 8l1-4z"/><path d="M8.5 15.5 4 20"/></svg>
        </button>
      </div>`;
    }).join('');
  }

  function decorateMessage(mail, source) {
    const message = source && typeof source === 'object' ? source : {};
    return {
      ...mail,
      mailboxId: message.mailboxId || message.id,
      accountEmail: normalizeEmail(message.accountEmail),
      receivedAt: Number.isFinite(Date.parse(message.date || ''))
        ? new Date(message.date).toISOString()
        : '',
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

  async function load(folder, normalizeMessage, fetchImpl) {
    if (folder !== 'outreach') return null;
    const request = typeof fetchImpl === 'function'
      ? fetchImpl
      : global.fetch.bind(global);
    const response = await request('/api/mailbox/campaign-replies?limit=100', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(data?.detail || data?.error || 'Campagnereacties laden mislukt');
    }
    return {
      messages: (Array.isArray(data.messages) ? data.messages : []).map(normalizeMessage),
      sync: data?.sync && typeof data.sync === 'object'
        ? data.sync
        : {
            indexed: true,
            stale: false,
            source: 'campaign-replies-index',
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
    getOwnerOptionsForMenu,
    getOwnerPinKeyForIdentity,
    getRequestId,
    initializeOwnerPreference,
    isOwner,
    isCampaignMail,
    isCampaignAccount,
    load,
    normalizeOwner,
    pinOwner,
    renderDetailAccount,
    renderListMeta,
    renderOwnerMenu,
    resolveOwnerForSession,
    setOwner,
    sortMessagesNewestFirst,
  };
  global.SoftoraMailboxCampaignInbox = campaignInboxApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = campaignInboxApi;
})(typeof window !== 'undefined' ? window : globalThis);
