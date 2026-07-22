(function (global) {
  'use strict';

  const OWNER_OPTIONS = Object.freeze([
    Object.freeze({ key: 'serve', label: 'Servé Creusen' }),
    Object.freeze({ key: 'martijn', label: 'Martijn van de Ven' }),
    Object.freeze({ key: 'both', label: 'Servé & Martijn' }),
  ]);
  const OWNER_PIN_SCOPE = 'premium_mailbox_preferences';
  const OWNER_PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';
  const MAILBOX_SESSION_CACHE_KEY = 'mailbox_campaign_replies';
  const MAILBOX_SESSION_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
  let pageBootstrapConsumed = false;

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isSafeImageSource(value) {
    const source = String(value || '').trim();
    if (/^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(source)) return true;
    return source.startsWith('/api/mailbox/message-image?') && !/[\s"'<>]/.test(source);
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
    const mailboxId = String(message.mailboxId || message.id || mail && mail.id || '').trim();
    const accountEmail = normalizeEmail(message.accountEmail || mail && mail.accountEmail);
    const receivedAtValue = message.receivedAt || message.date || mail && mail.receivedAt;
    return {
      ...mail,
      id: accountEmail && mailboxId ? `${accountEmail}|${mailboxId}` : (mail && mail.id) || mailboxId,
      mailboxId,
      accountEmail,
      receivedAt: Number.isFinite(Date.parse(receivedAtValue || ''))
        ? new Date(receivedAtValue).toISOString()
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
    return `<div class="detail-campaign-account">${escapeHtml(mail.accountEmail)}</div>`;
  }

  function readPageBootstrapPayload() {
    if (!global.document) return null;
    const element = global.document.getElementById('softoraPageStateBootstrap');
    if (!element) return null;
    try {
      const payload = JSON.parse(String(element.textContent || '{}'));
      return payload && typeof payload === 'object' ? payload : null;
    } catch (_) {
      return null;
    }
  }

  function readPageBootstrap() {
    if (pageBootstrapConsumed) return null;
    const mailbox = readPageBootstrapPayload()?.mailbox;
    return mailbox && mailbox.ok !== false && Array.isArray(mailbox.messages) ? mailbox : null;
  }

  function getMailboxTabCacheKey() {
    const session = getPageBootstrapSession();
    const identity = normalizeEmail(session && (session.userId || session.email));
    return identity ? `${MAILBOX_SESSION_CACHE_KEY}:${identity}` : '';
  }

  function readSessionMailboxSnapshot() {
    const cache = global.SoftoraPageBootstrapSession?.cache;
    const cacheKey = getMailboxTabCacheKey();
    const mailbox = cache?.read?.(cacheKey, MAILBOX_SESSION_CACHE_MAX_AGE_MS);
    return mailbox && Array.isArray(mailbox.messages) ? mailbox : null;
  }

  function writeSessionMailboxSnapshot(data) {
    const cache = global.SoftoraPageBootstrapSession?.cache;
    const cacheKey = getMailboxTabCacheKey();
    if (!cache || !cacheKey || !data || !Array.isArray(data.messages)) return false;
    const messages = data.messages.slice(0, 100).map((message) => {
      const source = message && typeof message === 'object' ? message : {};
      const sourceBodyImages = Array.isArray(source.bodyImages) ? source.bodyImages : [];
      const bodyImages = sourceBodyImages.filter((image) => {
        const dataUrl = String(image && image.dataUrl || '').trim();
        return dataUrl.startsWith('/api/mailbox/message-image?') && isSafeImageSource(dataUrl);
      });
      return {
        ...source,
        bodyImagesTruncated: Boolean(source.bodyImagesTruncated || sourceBodyImages.length > bodyImages.length),
        bodyImages,
        inlineImages: [],
      };
    });
    return cache.write(cacheKey, {
      ok: data.ok !== false,
      messages,
      sync: data.sync && typeof data.sync === 'object' ? data.sync : null,
    });
  }

  function readInitialMailboxSnapshot() {
    return readPageBootstrap() || readSessionMailboxSnapshot();
  }

  function getPageBootstrapSession() {
    const sharedSession = global.SoftoraPageBootstrapSession?.get?.();
    if (sharedSession && sharedSession.authenticated) return sharedSession;
    const session = readPageBootstrapPayload()?.session;
    return session && session.authenticated ? session : null;
  }

  function hasPageBootstrap(folder) {
    return folder === 'outreach' && Boolean(readInitialMailboxSnapshot());
  }

  function normalizeLoadResult(data, normalizeMessage, fromBootstrap) {
    const result = {
      messages: (Array.isArray(data && data.messages) ? data.messages : []).map(normalizeMessage),
      sync: data?.sync && typeof data.sync === 'object'
        ? data.sync
        : {
            indexed: true,
            stale: false,
            source: 'campaign-replies-index',
            refreshRecommended: false,
            warming: false,
          },
      fromBootstrap: Boolean(fromBootstrap),
    };
    writeSessionMailboxSnapshot({ ...data, messages: result.messages, sync: result.sync });
    return result;
  }

  async function load(folder, normalizeMessage, fetchImpl, options) {
    if (folder !== 'outreach') return null;
    const bootstrap = !(options && options.skipBootstrap) ? readInitialMailboxSnapshot() : null;
    if (bootstrap) {
      pageBootstrapConsumed = true;
      return normalizeLoadResult(bootstrap, normalizeMessage, true);
    }
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
    return normalizeLoadResult(data, normalizeMessage, false);
  }

  const campaignInboxApi = {
    decorateMessage,
    filterMessages,
    getAccount,
    getFolder,
    hasPageBootstrap,
    getOwner,
    getOwnerByAccount,
    getOwnerLabel,
    getOwnerOptionsForMenu,
    getOwnerPinKeyForIdentity,
    getPageBootstrapSession,
    getRequestId,
    initializeOwnerPreference,
    isOwner,
    isSafeImageSource,
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
