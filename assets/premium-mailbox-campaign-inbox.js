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
  const MAILBOX_DELETION_CHANNEL = 'softora_mailbox_deletions_v1';
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

  function normalizeClassifierText(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  function isAutomatedCampaignReply(mail) {
    const subject = normalizeClassifierText(mail && mail.subject);
    const content = normalizeClassifierText([
      mail && mail.preview,
      mail && mail.body,
    ].filter(Boolean).join(' '));
    const automatedSubjectPatterns = [
      /\bautomatisch antwoord\b/,
      /\bautomatic (?:reply|response)\b/,
      /\bauto[ -]?reply\b/,
      /\bout[ -]?of[ -]?office\b/,
      /\bafwezigheid(?:sbericht|melding)?\b/,
      /^email received\b/,
      /^bericht ontvangen\b/,
    ];
    const automatedContentPatterns = [
      /\bdit (?:bericht|e-mail|email) is automatisch gegenereerd\b/,
      /\bdit is een automatisch bericht\b/,
      /\bwe would like to acknowledge that we have received your request\b/,
      /\bis ons kantoor gesloten\b/,
    ];
    return (
      automatedSubjectPatterns.some((pattern) => pattern.test(subject)) ||
      automatedContentPatterns.some((pattern) => pattern.test(content))
    );
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

  function normalizeMessageId(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^<+|>+$/g, '');
  }

  function getMessageReferenceIds(mail) {
    return Array.from(new Set([
      mail && mail.references,
      mail && mail.inReplyTo,
    ]
      .flatMap((value) => String(value || '').trim().toLowerCase().split(/\s+/))
      .map(normalizeMessageId)
      .filter(Boolean)));
  }

  function getConversationId(mail) {
    const explicitId = String(mail && mail.conversationId || '').trim();
    if (explicitId) return explicitId;
    const account = normalizeEmail(mail && (mail.accountEmail || mail.campaign && mail.campaign.account));
    const referenceIds = getMessageReferenceIds(mail);
    if (account && referenceIds.length) return `conversation:${account}|${referenceIds[0]}`;
    const messageId = normalizeMessageId(mail && mail.messageId);
    if (account && messageId) return `conversation:${account}|${messageId}`;
    const mailboxId = String(mail && (mail.mailboxId || mail.id) || '').trim();
    if (account && mailboxId) return `conversation:${account}|mailbox:${mailboxId}`;
    return '';
  }

  function getMessageIdentity(mail) {
    const account = normalizeEmail(mail && mail.accountEmail);
    const messageId = normalizeMessageId(mail && mail.messageId);
    if (account && messageId) return `${account}|message:${messageId}`;
    const mailboxId = String(mail && (mail.mailboxId || mail.id) || '').trim();
    return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
  }

  function sortMessagesNewestFirst(messages) {
    return (Array.isArray(messages) ? messages : [])
      .slice()
      .sort((left, right) => getReceivedTimestamp(right) - getReceivedTimestamp(left));
  }

  function groupConversationMessages(messages) {
    const groups = new Map();
    sortMessagesNewestFirst(messages).forEach((mail) => {
      const conversationId = getConversationId(mail) || getMessageIdentity(mail);
      if (!groups.has(conversationId)) groups.set(conversationId, []);
      groups.get(conversationId).push(mail);
    });
    return Array.from(groups.entries()).map(([conversationId, groupedMessages]) => {
      const primary = groupedMessages[0];
      const primaryIdentity = getMessageIdentity(primary);
      const seen = new Set(primaryIdentity ? [primaryIdentity] : []);
      const threadMessages = [
        ...(Array.isArray(primary.threadMessages) ? primary.threadMessages : []),
        ...groupedMessages.slice(1).flatMap((message) => [
          { ...message, folder: String(message && message.folder || 'inbox').toLowerCase() },
          ...(Array.isArray(message && message.threadMessages) ? message.threadMessages : []),
        ]),
      ]
        .filter((message) => {
          const identity = getMessageIdentity(message);
          if (!identity) return true;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        })
        .sort((left, right) => getReceivedTimestamp(right) - getReceivedTimestamp(left));
      return {
        ...primary,
        conversationId,
        unread: groupedMessages.some((message) => Boolean(message && message.unread)),
        threadMessages,
      };
    });
  }

  function filterMessages(messages, value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return groupConversationMessages(
      (Array.isArray(messages) ? messages : []).filter((mail) => {
        if (isAutomatedCampaignReply(mail)) return false;
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
      conversationId: String(message.conversationId || mail && mail.conversationId || '').trim(),
      threadMessages: Array.isArray(message.threadMessages) ? message.threadMessages : [],
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

  function stripQuotedReply(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const quoteStart = lines.findIndex((line) => {
      const content = String(line || '').trim();
      return (
        /^>/.test(content) ||
        /^(?:on .+ wrote:|op .+ (?:schreef|heeft .+ geschreven):)$/i.test(content) ||
        /^-{2,}\s*(?:original message|oorspronkelijk bericht)/i.test(content)
      );
    });
    return (quoteStart >= 0 ? lines.slice(0, quoteStart) : lines).join('\n').trim();
  }

  function renderThreadMessages(mail, escapeHtml, formatDate) {
    if (!mail || typeof escapeHtml !== 'function') return '';
    const messages = Array.isArray(mail.threadMessages) ? mail.threadMessages : [];
    return messages.map((message) => {
      const body = stripQuotedReply(message && (message.body || message.preview));
      if (!body) return '';
      const when = typeof formatDate === 'function' ? formatDate(message.date) : null;
      const folder = String(message && message.folder || 'sent').trim().toLowerCase();
      const sent = folder === 'sent';
      const owner = sent ? getOwnerLabel(getOwnerByAccount(message.accountEmail)) : '';
      const dateLabel = [when && when.date, when && when.time].filter(Boolean).join(', ');
      const meta = [dateLabel, owner].filter(Boolean).join(' · ');
      const lines = body.split('\n').map((line) => {
        const content = String(line || '');
        const emptyClass = content.trim() ? '' : ' detail-mail-line-empty';
        return `<div class="detail-mail-line${emptyClass}">${escapeHtml(content)}</div>`;
      }).join('');
      const sectionClass = sent
        ? 'detail-mail-section detail-mail-section-sent'
        : 'detail-mail-section detail-mail-section-received';
      return `
        <section class="${sectionClass}">
          <div class="detail-mail-section-label">${sent ? 'Jouw antwoord' : 'Eerder ontvangen'}</div>
          ${meta ? `<div class="detail-mail-quote-meta">${escapeHtml(meta)}</div>` : ''}
          <div class="detail-mail-lines">${lines}</div>
        </section>`;
    }).filter(Boolean).join('');
  }

  function readPageBootstrapPayload() {
    if (!global.document) return null;
    const element = global.document.getElementById('softoraPageStateBootstrap');
    if (!element) return null;
    try {
      let serialized = String(element.textContent || '{}');
      if (
        typeof element.getAttribute === 'function' &&
        element.getAttribute('data-softora-encoding') === 'base64'
      ) {
        if (typeof global.atob !== 'function') return null;
        const binary = global.atob(serialized.trim());
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        serialized = typeof global.TextDecoder === 'function'
          ? new global.TextDecoder('utf-8').decode(bytes)
          : decodeURIComponent(escape(binary));
      }
      const payload = JSON.parse(serialized);
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
      savedAt: Number.isFinite(Date.parse(String(data.savedAt || '')))
        ? new Date(data.savedAt).toISOString()
        : new Date().toISOString(),
      messages,
      sync: data.sync && typeof data.sync === 'object' ? data.sync : null,
    });
  }

  function readInitialMailboxSnapshot() {
    const pageSnapshot = readPageBootstrap();
    const sessionSnapshot = readSessionMailboxSnapshot();
    return pageSnapshot || sessionSnapshot;
  }

  function getDeletionIdentity(mail) {
    if (!mail || typeof mail !== 'object') return null;
    const accountEmail = getAccount(mail, '');
    const folder = getFolder(mail, 'inbox');
    const uid = Number(mail.uid) || 0;
    const id = getRequestId(mail);
    if (!accountEmail || (!uid && !id)) return null;
    return { accountEmail, folder, uid, id };
  }

  function matchesMessageIdentity(mail, identity) {
    const candidate = getDeletionIdentity(mail);
    const deleted = getDeletionIdentity(identity);
    if (!candidate || !deleted) return false;
    if (candidate.accountEmail !== deleted.accountEmail || candidate.folder !== deleted.folder) return false;
    if (candidate.uid > 0 && deleted.uid > 0) return candidate.uid === deleted.uid;
    return Boolean(candidate.id && deleted.id && candidate.id === deleted.id);
  }

  function removeCachedMessage(mail) {
    const snapshot = readSessionMailboxSnapshot();
    if (!snapshot || !mail) return false;
    const messages = snapshot.messages.filter((candidate) => !matchesMessageIdentity(candidate, mail));
    if (messages.length === snapshot.messages.length) return false;
    return writeSessionMailboxSnapshot({
      ...snapshot,
      savedAt: new Date().toISOString(),
      messages,
    });
  }

  function publishMessageDeletion(mail) {
    const identity = getDeletionIdentity(mail);
    if (!identity || typeof global.BroadcastChannel !== 'function') return false;
    const channel = new global.BroadcastChannel(MAILBOX_DELETION_CHANNEL);
    try {
      channel.postMessage(identity);
      return true;
    } finally {
      channel.close?.();
    }
  }

  function removeAndPublishMessageDeletion(mail) {
    const cacheUpdated = removeCachedMessage(mail);
    const published = publishMessageDeletion(mail);
    return cacheUpdated || published;
  }

  function subscribeToMessageDeletions(handler) {
    if (typeof handler !== 'function' || typeof global.BroadcastChannel !== 'function') return () => {};
    const channel = new global.BroadcastChannel(MAILBOX_DELETION_CHANNEL);
    const receive = (event) => {
      const identity = getDeletionIdentity(event && event.data);
      if (!identity) return;
      removeCachedMessage(identity);
      handler(identity);
    };
    if (typeof channel.addEventListener === 'function') channel.addEventListener('message', receive);
    else channel.onmessage = receive;
    return () => {
      if (typeof channel.removeEventListener === 'function') channel.removeEventListener('message', receive);
      else if (channel.onmessage === receive) channel.onmessage = null;
      channel.close?.();
    };
  }

  function bindMessageDeletionSync(options = {}) {
    if (!global.document || typeof global.addEventListener !== 'function') return () => {};
    const unsubscribe = subscribeToMessageDeletions((identity) => {
      const messages = typeof options.getMessages === 'function' ? options.getMessages() : [];
      const activeId = typeof options.getActiveId === 'function' ? options.getActiveId() : null;
      const removedActiveMessage = messages.find((mail) => (
        String(mail && mail.id) === String(activeId) && matchesMessageIdentity(mail, identity)
      ));
      const remainingMessages = messages.filter((mail) => !matchesMessageIdentity(mail, identity));
      if (remainingMessages.length === messages.length) return;
      const nextMessages = typeof options.filterMessages === 'function'
        ? options.filterMessages(remainingMessages)
        : remainingMessages;
      options.setMessages?.(nextMessages);
      if (removedActiveMessage) options.setActiveId?.(null);
      options.renderList?.({ openLatest: false });
      const nextActiveId = typeof options.getActiveId === 'function' ? options.getActiveId() : null;
      if (nextActiveId) options.openMail?.(nextActiveId, { skipBodyFetch: true });
      else options.resetDetail?.();
    });
    global.addEventListener?.('pagehide', unsubscribe, { once: true });
    return unsubscribe;
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
    bindMessageDeletionSync,
    decorateMessage,
    filterMessages,
    getAccount,
    getConversationId,
    getFolder,
    hasPageBootstrap,
    getOwner,
    getOwnerByAccount,
    getOwnerLabel,
    getOwnerOptionsForMenu,
    getOwnerPinKeyForIdentity,
    getPageBootstrapSession,
    getRequestId,
    groupConversationMessages,
    initializeOwnerPreference,
    isAutomatedCampaignReply,
    isOwner,
    isSafeImageSource,
    isCampaignMail,
    isCampaignAccount,
    load,
    matchesMessageIdentity,
    normalizeOwner,
    pinOwner,
    publishMessageDeletion,
    removeAndPublishMessageDeletion,
    removeCachedMessage,
    renderDetailAccount,
    renderListMeta,
    renderOwnerMenu,
    renderThreadMessages,
    resolveOwnerForSession,
    setOwner,
    sortMessagesNewestFirst,
    subscribeToMessageDeletions,
  };
  global.SoftoraMailboxCampaignInbox = campaignInboxApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = campaignInboxApi;
})(typeof window !== 'undefined' ? window : globalThis);
