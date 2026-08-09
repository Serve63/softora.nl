(function (global) {
  'use strict';

  const OWNER_OPTIONS = Object.freeze([
    Object.freeze({ key: 'serve', label: 'Servé Creusen' }),
    Object.freeze({ key: 'martijn', label: 'Martijn van de Ven' }),
    Object.freeze({ key: 'both', label: 'Martijn & Servé' }),
  ]);
  const MAILBOX_SESSION_CACHE_KEY = 'mailbox_campaign_replies_v17';
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
  let activeOwner = 'serve';
  let defaultOwner = 'serve';
  let pinnedOwner = '';
  let preferenceIdentity = 'anonymous';
  const ownerPreferenceApi = global.SoftoraMailboxOwnerPreference || (
    typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-owner-preference.js') : null
  );
  const snapshotFreshness = global.PremiumMailboxSnapshotFreshness || global.SoftoraMailboxSnapshotFreshness || (
    typeof module !== 'undefined' && module.exports ? require('./premium-mailbox-snapshot-freshness.js') : null
  );
  const MAILBOX_SESSION_CACHE_MAX_AGE_MS = snapshotFreshness?.MAX_SNAPSHOT_AGE_MS || 15 * 60 * 1000;
  const ownerPreference = ownerPreferenceApi?.create?.() || null;
  const pageBootstrapConsumedOwners = new Set();

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
      mail && mail.preview ? stripQuotedReply(mail.preview) : '',
      mail && mail.body ? stripQuotedReply(mail.body) : '',
    ].filter(Boolean).join(' '));
    const autoSubmitted = normalizeClassifierText(mail && mail.autoSubmitted);
    const precedence = normalizeClassifierText(mail && mail.precedence);
    const autoResponseSuppress = normalizeClassifierText(mail && mail.autoResponseSuppress);
    const provenAutomaticHeader = Boolean(
      mail && mail.automatedReplyEvidence === true ||
      (autoSubmitted && autoSubmitted !== 'no') ||
      /^(?:auto_reply|auto-reply|bulk|junk|list)$/.test(precedence) ||
      autoResponseSuppress
    );
    const automatedSubjectPatterns = [
      /^(?:(?:re|fw|fwd)\s*:\s*)*automatisch antwoord(?:en)?\b/,
      /^(?:(?:re|fw|fwd)\s*:\s*)*(?:zomer|winter|vakantie|kerst|feestdagen?|bouwvak)[ -]?sluiting\b/,
      /\bautomatisch antwoord\b/,
      /\bautomatische (?:e-?mail|mail|reactie|ontvangstbevestiging)\b/,
      /\bontvangstbevestiging\b/,
      /\bautomatic (?:reply|response)\b/,
      /\bauto[ -]?reply\b/,
      /\bout[ -]?of[ -]?office\b/,
      /\bafwezigheid(?:sbericht|melding)?\b/,
      /^(?:niet aanwezig|afwezig)(?:\s+tot\b[^:\n]{0,80})?\s+(?:(?:re|fw|fwd)\s*:\s*)+/,
      /\bdelivery status notification\b/,
      /\bmail delivery (?:failure|failed)\b/,
      /^email received\b/,
      /^bericht ontvangen\b/,
      /\buw mail is ontvangen\b/,
      /^bedankt voor (?:je|jouw|uw) (?:mail|bericht)!?\s+(?:re|fw|fwd)\s*:/,
    ];
    const automatedContentPatterns = [
      /\bdit (?:bericht|e-mail|email) is automatisch gegenereerd\b/,
      /\bdit is (?:een )?automatisch(?:e)? (?:e-?mail|mail|bericht|antwoord|reactie|ontvangstbevestiging)\b/,
      /\bthis is an automated (?:e-?mail|mail|message|reply|response)\b/,
      /\bwe would like to acknowledge that we have received your request\b/,
      /\bis ons kantoor gesloten\b/,
      /\bop dit moment ben ik op vakantie\b/,
      /\bberichten worden (?:in deze periode )?niet gelezen\b/,
      /\bplease type your reply above this line\b/,
      /\buw aanvraag\s*\([^)]{1,40}\)\s+is ontvangen\b/,
      /\byour request\s*\([^)]{1,40}\)\s+has been received\b/,
      /\bwij streven ernaar om (?:je|jouw|uw) (?:vraag|bericht|e-?mail|mail) binnen \d+\s+(?:werk)?dag(?:en)? te beantwoorden\b/,
      /\bin deze periode beantwoorden wij geen (?:e-?mails?|mails?|berichten)\b/,
      /\b(?:we|wij) streven ernaar (?:jouw|je|uw) (?:e-?mail|mail|bericht) (?:de )?(?:eerstvolgende|volgende) werkdag te beantwoorden\b/,
      /\b(?:bedankt|dank) voor (?:je|jouw|uw) bericht\b[\s\S]{0,220}\b(?:eerstvolgende werkdag|zo snel mogelijk) te beantwoorden\b/,
      /\b(?:ik ben|wij zijn|ons kantoor is) (?:momenteel|op dit moment|tijdelijk)?\s*(?:afwezig|gesloten|niet aanwezig)\b/,
      /\b(?:momenteel|op dit moment)\s+(?:heb ik|hebben wij)\s+vakantie\b[\s\S]{0,240}\b(?:e-?mail|mail)\b[\s\S]{0,160}\b(?:minder vaak|niet|beperkt)\b/,
      /\bwelkom bij\b[\s\S]{0,240}\bals u\b[\s\S]{0,180}\bnaar whatsapp stuurt\b[\s\S]{0,180}\b(?:richtprijs|offerte)\b/,
      /\b(?:i am|we are) (?:currently )?out of (?:the )?office\b/,
    ];
    return (
      provenAutomaticHeader ||
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
    if (owner === 'both' || owner === 'all') return 'both';
    return 'serve';
  }

  function isOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    return owner === 'serve' || owner === 'servé' || owner === 'martijn' || owner === 'both' || owner === 'all';
  }

  function isPersonalOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    return owner === 'serve' || owner === 'servé' || owner === 'martijn';
  }

  function getOwnerByAccount(value) {
    return ACCOUNT_OWNERS[normalizeEmail(value)] || '';
  }

  function getMessageOwner(mail) {
    if (String(mail && mail.provider || '').trim().toLowerCase() === 'instantly') {
      const provenOwner = String(mail && mail.providerOwner || '').trim().toLowerCase();
      return isPersonalOwner(provenOwner) ? normalizeOwner(provenOwner) : '';
    }
    const copyContext = mail && mail.copyContext;
    if (copyContext && copyContext.evidenceKnown === true) {
      const sourceOwner = getOwnerByAccount(copyContext.sourceAccountEmail);
      if (sourceOwner) return sourceOwner;
    }
    const accountOwner = getOwnerByAccount(mail && (mail.accountEmail || mail.campaign && mail.campaign.account));
    const senderOwner = getOwnerByAccount(mail && mail.email);
    if (accountOwner && senderOwner && accountOwner !== senderOwner) return '';
    return accountOwner;
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
    return 'serve';
  }

  function getOwnerPinKeyForIdentity(identity) {
    return ownerPreference?.getPinKey?.(identity) || '';
  }

  async function initializeOwnerPreference(session, uiStateClient, identity) {
    defaultOwner = resolveOwnerForSession(session);
    preferenceIdentity = String(identity || '').trim().toLowerCase() || 'anonymous';
    const saved = ownerPreference
      ? await ownerPreference.initialize(uiStateClient, preferenceIdentity)
      : { pinnedOwner: '', selectedOwner: '' };
    pinnedOwner = saved.pinnedOwner;
    setOwner(pinnedOwner || saved.selectedOwner || defaultOwner);
    return { defaultOwner, pinnedOwner, activeOwner };
  }

  async function pinOwner(value, uiStateClient) {
    if (!isOwner(value)) {
      return { owner: activeOwner, label: getOwnerLabel(), saved: false };
    }
    pinnedOwner = normalizeOwner(value);
    setOwner(pinnedOwner);
    const saved = ownerPreference ? await ownerPreference.pin(pinnedOwner, uiStateClient) : false;
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
    ownerPreference?.persist?.(activeOwner);
    return activeOwner;
  }

  function getOwnerLabel(value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return OWNER_OPTIONS.find((option) => option.key === owner)?.label || 'Servé Creusen';
  }

  function getReceivedTimestamp(mail) {
    const value = mail && (mail.latestInboundAt || mail.activityAt || mail.receivedAt || mail.internalDate || mail.date);
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function getMessageTimestamp(mail) {
    const value = mail && (mail.receivedAt || mail.internalDate || mail.date);
    const timestamp = Date.parse(value || '');
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function isSentMessageByProvenance(message, account) {
    const resolver = global.SoftoraMailboxMessageProvenance;
    if (resolver && typeof resolver.isSent === 'function') {
      return resolver.isSent(message, { account });
    }
    return String(message && message.folder || '').trim().toLowerCase() === 'sent';
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

  function getDirectParentMessageIds(mail) {
    return Array.from(new Set(
      String(mail && mail.inReplyTo || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .map(normalizeMessageId)
        .filter(Boolean)
    ));
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

  function getStableCampaignConversationId(mail) {
    if (
      !mail ||
      !mail.campaign ||
      mail.copyContext && mail.copyContext.evidenceKnown === true ||
      String(mail.provider || '').trim().toLowerCase() === 'instantly'
    ) {
      return '';
    }
    const account = normalizeEmail(mail.accountEmail || mail.campaign.account);
    const counterparty = normalizeEmail(mail.email);
    if (isSentMessageByProvenance(mail, account)) return '';
    const subject = normalizeClassifierText(mail.subject)
      .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/g, '')
      .trim();
    const campaignSubject = [
      'kleine vraag over jullie website',
      'nieuw webdesign',
    ].find((candidate) => subject === candidate || subject.endsWith(candidate)) || '';
    if (!account || !counterparty || account === counterparty || !campaignSubject) return '';
    return `campaign:${account}|${counterparty}|${campaignSubject}`;
  }

  function getMessageIdentity(mail) {
    const account = normalizeEmail(mail && mail.accountEmail);
    const messageId = normalizeMessageId(mail && mail.messageId);
    if (account && messageId) return `${account}|message:${messageId}`;
    const mailboxId = String(mail && (mail.mailboxId || mail.id) || '').trim();
    return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
  }

  function getActionMessageKey(mail) {
    const messageId = normalizeMessageId(mail && mail.messageId);
    if (messageId) return `message:${messageId}`;
    const account = normalizeEmail(mail && mail.accountEmail);
    const mailboxId = String(mail && (mail.mailboxId || mail.id) || '').trim();
    return account && mailboxId ? `${account}|mailbox:${mailboxId}` : '';
  }

  function getConversationAction(mail) {
    if (!mail) return null;
    const root = { ...mail, mailboxConversationRoot: true };
    const messages = [
      root,
      ...(Array.isArray(mail.threadMessages) ? mail.threadMessages : []),
    ].filter((message) => (
      getMessageTimestamp(message) &&
      (
        isSentMessageByProvenance(message, mail.accountEmail) ||
        !isAutomatedCampaignReply(message)
      )
    ));
    if (!messages.length) return null;
    const latest = messages
      .slice()
      .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left))[0];
    const isRoot = latest.mailboxConversationRoot === true;
    const exactCopy = isRoot && mail.copyContext && mail.copyContext.evidenceKnown === true;
    const outbound = exactCopy || isSentMessageByProvenance(latest, mail.accountEmail);
    return {
      kind: outbound ? 'new-message' : 'reply',
      message: latest,
      messageKey: getActionMessageKey(latest),
      isRoot,
    };
  }

  function sortMessagesNewestFirst(messages) {
    return (Array.isArray(messages) ? messages : [])
      .slice()
      .sort((left, right) => getReceivedTimestamp(right) - getReceivedTimestamp(left));
  }

  function groupConversationMessages(messages) {
    const groups = new Map();
    sortMessagesNewestFirst(messages).forEach((mail) => {
      const isolatedId = String(mail && (mail.providerMessageId || mail.mailboxId || mail.id) || '').trim();
      const conversationId = getStableCampaignConversationId(mail) || getConversationId(mail) || getMessageIdentity(mail) || [
        'isolated',
        getMessageOwner(mail) || 'unknown',
        String(mail && mail.provider || 'imap').trim().toLowerCase(),
        isolatedId || String(groups.size),
      ].join(':');
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
        .filter((message) => (
          isSentMessageByProvenance(message, primary.accountEmail) ||
          !isAutomatedCampaignReply(message)
        ))
        .filter((message) => {
          const identity = getMessageIdentity(message);
          if (!identity) return true;
          if (seen.has(identity)) return false;
          seen.add(identity);
          return true;
        })
        .sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
      const allMessages = [primary, ...threadMessages];
      const latestInboundAt = allMessages
        .filter((message) => !isSentMessageByProvenance(message, primary.accountEmail) && !(message.copyContext && message.copyContext.evidenceKnown === true))
        .map((message) => message.receivedAt || message.internalDate || message.date)
        .filter((value) => Number.isFinite(Date.parse(value || '')))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || primary.latestInboundAt || primary.receivedAt || '';
      const latestOutboundAt = allMessages
        .filter((message) => isSentMessageByProvenance(message, primary.accountEmail) || (message.copyContext && message.copyContext.evidenceKnown === true))
        .map((message) => message.receivedAt || message.internalDate || message.date)
        .filter((value) => Number.isFinite(Date.parse(value || '')))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || primary.latestOutboundAt || '';
      return {
        ...primary,
        conversationId,
        activityAt: latestInboundAt,
        latestInboundAt,
        latestOutboundAt,
        unread: groupedMessages.some((message) => Boolean(message && message.unread)),
        threadMessages,
      };
    }).sort((left, right) => getReceivedTimestamp(right) - getReceivedTimestamp(left));
  }

  function filterMessages(messages, value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return groupConversationMessages(
      (Array.isArray(messages) ? messages : []).filter((mail) => {
        if (isAutomatedCampaignReply(mail)) return false;
        const accountOwner = getMessageOwner(mail);
        return Boolean(accountOwner && (owner === 'both' || accountOwner === owner));
      })
    );
  }

  function getOwnerOptionsForMenu(primaryOwner) {
    const primary = isPersonalOwner(primaryOwner) ? normalizeOwner(primaryOwner) : '';
    const personalOptions = OWNER_OPTIONS.slice();
    if (primary === 'serve' || primary === 'martijn') {
      personalOptions.sort((left, right) => {
        if (left.key === primary) return -1;
        if (right.key === primary) return 1;
        return 0;
      });
    }
    return personalOptions;
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
    const activityAtValue = message.latestInboundAt || receivedAtValue || message.activityAt;
    return {
      ...mail,
      id: accountEmail && mailboxId ? `${accountEmail}|${mailboxId}` : (mail && mail.id) || mailboxId,
      mailboxId,
      accountEmail,
      receivedAt: Number.isFinite(Date.parse(receivedAtValue || ''))
        ? new Date(receivedAtValue).toISOString()
        : '',
      activityAt: Number.isFinite(Date.parse(activityAtValue || ''))
        ? new Date(activityAtValue).toISOString()
        : '',
      latestInboundAt: Number.isFinite(Date.parse(activityAtValue || ''))
        ? new Date(activityAtValue).toISOString()
        : '',
      latestOutboundAt: Number.isFinite(Date.parse(message.latestOutboundAt || ''))
        ? new Date(message.latestOutboundAt).toISOString()
        : '',
      provider: String(message.provider || mail && mail.provider || '').trim().toLowerCase(),
      providerMessageId: String(message.providerMessageId || '').trim(),
      providerThreadId: String(message.providerThreadId || '').trim(),
      providerCampaignId: String(message.providerCampaignId || '').trim(),
      providerAccountEmail: normalizeEmail(message.providerAccountEmail || accountEmail),
      providerOwner: String(message.providerOwner || '').trim().toLowerCase(),
      storageFolder: String(message.storageFolder || '').trim().toLowerCase(),
      direction: String(message.direction || '').trim().toLowerCase(),
      sourceFolders: Array.isArray(message.sourceFolders) ? message.sourceFolders : [],
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
    const folder = String(mail && (mail.storageFolder || mail.folder) || activeFolder || '').trim().toLowerCase();
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
    const providerLabel = String(mail.provider || '').trim().toLowerCase() === 'instantly'
      ? ' · Instantly'
      : '';
    return `<div class="detail-campaign-account">${escapeHtml(mail.accountEmail)}${providerLabel}</div>`;
  }

  function renderMessageRouting(mail, escapeHtml) {
    const context = mail && mail.copyContext;
    const kind = String(context && context.kind || '').trim().toLowerCase();
    if (!mail || typeof escapeHtml !== 'function') return '';
    function identity(name, email) {
      const normalizedEmail = normalizeEmail(email);
      const owner = getOwnerByAccount(normalizedEmail);
      const normalizedName = owner ? getOwnerLabel(owner) : String(name || '').trim();
      if (normalizedName && normalizedEmail) {
        return `${escapeHtml(normalizedName)} &lt;${escapeHtml(normalizedEmail)}&gt;`;
      }
      return escapeHtml(normalizedEmail || normalizedName || 'Onbekend');
    }
    function exactHeaderValue(value) {
      return escapeHtml(String(value || '').trim());
    }
    if (
      context &&
      context.evidenceKnown === true &&
      ['bcc', 'cc'].includes(kind)
    ) {
      return `
        <div class="detail-routing" data-mailbox-routing-kind="${escapeHtml(kind)}">
          <div><span>Van:</span><strong>${identity(context.sourceName, context.sourceEmail)}</strong></div>
          <div><span>Aan:</span><strong>${identity(context.recipientName, context.recipientEmail)}</strong></div>
          <div><span>${kind.toUpperCase()}:</span><strong>${identity('', context.copyAccountEmail)}</strong></div>
        </div>`;
    }
    const rows = [];
    const fromName = String(mail.from || '').trim();
    const fromEmail = normalizeEmail(mail.email);
    rows.push(`<div><span>Van:</span><strong>${identity(fromName, fromEmail)}</strong></div>`);
    if (mail.recipientRoutingEvidenceKnown === true) {
      const to = String(mail.toDisplay || mail.to || '').trim();
      const cc = String(mail.cc || '').trim();
      const bcc = String(mail.bcc || '').trim();
      if (to) rows.push(`<div><span>Aan:</span><strong>${exactHeaderValue(to)}</strong></div>`);
      if (cc) rows.push(`<div><span>CC:</span><strong>${exactHeaderValue(cc)}</strong></div>`);
      if (bcc) rows.push(`<div><span>BCC:</span><strong>${exactHeaderValue(bcc)}</strong></div>`);
    }
    return `
      <div class="detail-routing" data-mailbox-routing-kind="direct">
        ${rows.join('')}
      </div>`;
  }

  const renderCopyRouting = renderMessageRouting;

  function renderAttachments(message, escapeHtml) {
    if (typeof escapeHtml !== 'function') return '';
    const attachments = (Array.isArray(message && message.attachments) ? message.attachments : [])
      .filter((attachment) => String(attachment && attachment.filename || '').trim())
      .slice(0, 20);
    if (!attachments.length) return '';
    return `<div class="detail-attachments" aria-label="Bijlagen">${attachments.map((attachment) => {
      const size = Math.max(0, Number(attachment.size) || 0);
      const sizeLabel = size >= 1024 * 1024
        ? `${(size / (1024 * 1024)).toFixed(1)} MB`
        : size ? `${Math.max(1, Math.round(size / 1024))} kB` : '';
      return `<span class="detail-attachment"><span>📎</span><strong>${escapeHtml(attachment.filename)}</strong>${sizeLabel ? `<small>${escapeHtml(sizeLabel)}</small>` : ''}</span>`;
    }).join('')}</div>`;
  }

  function splitQuotedReply(value) {
    const lines = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const directQuoteStart = lines.findIndex((line) => {
      const content = String(line || '').trim();
      return (
        /^>/.test(content) ||
        /^(?:on .+\bwrote\b|op .+\bschreef\b.*|op .+\bheeft\s+.+\s+geschreven)\s*:\s*$/i.test(content) ||
        /^-{2,}\s*(?:original message|oorspronkelijk(?:e)? bericht)/i.test(content)
      );
    });
    const headerPatterns = {
      from: /^(?:van|from):\s*\S/i,
      sent: /^(?:verzonden|sent|datum|date):\s*\S/i,
      to: /^(?:aan|to):\s*\S/i,
      subject: /^(?:onderwerp|subject):\s*\S/i,
    };
    function isHeaderCluster(startIndex) {
      const windowLines = lines
        .slice(startIndex, startIndex + 8)
        .map((line) => String(line || '').trim())
        .filter(Boolean);
      if (!windowLines.length || !headerPatterns.from.test(windowLines[0])) return false;
      const matchedFields = ['sent', 'to', 'subject']
        .filter((field) => windowLines.some((line) => headerPatterns[field].test(line)));
      return matchedFields.length >= 2;
    }
    let structuredQuoteStart = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const content = String(lines[index] || '').trim();
      const separator = /^(?:_{5,}|-{5,})$/.test(content);
      if (separator) {
        let headerIndex = index + 1;
        while (headerIndex < lines.length && !String(lines[headerIndex] || '').trim()) headerIndex += 1;
        if (isHeaderCluster(headerIndex)) {
          structuredQuoteStart = index;
          break;
        }
      }
      if (isHeaderCluster(index)) {
        structuredQuoteStart = index;
        break;
      }
    }
    const quoteStarts = [directQuoteStart, structuredQuoteStart].filter((index) => index >= 0);
    const quoteStart = quoteStarts.length ? Math.min(...quoteStarts) : -1;
    return {
      authored: (quoteStart >= 0 ? lines.slice(0, quoteStart) : lines).join('\n').trim(),
      quoted: quoteStart >= 0 ? lines.slice(quoteStart).join('\n').trim() : '',
    };
  }

  function stripQuotedReply(value) {
    return splitQuotedReply(value).authored;
  }

  function normalizeThreadMatchText(value) {
    return global.SoftoraMailboxQuotedThread?.normalizeMatchText?.(value) || '';
  }

  function stripStructuredQuoteMetadata(lines) {
    const metadataPattern = /^(?:verzonden|sent|datum|date|aan|to|onderwerp|subject):\s*/i;
    const values = Array.isArray(lines) ? lines.slice() : [];
    while (values.length && (!String(values[0] || '').trim() || metadataPattern.test(String(values[0] || '').trim()))) {
      values.shift();
    }
    return values;
  }

  function stripQuotedThreadEnvelope(value) {
    const values = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    while (values.length && !String(values[0] || '').trim()) values.shift();
    const firstLine = String(values[0] || '').trim();
    if (
      /^(?:on .+\bwrote\b|op .+\bschreef\b.*|op .+\bheeft\s+.+\s+geschreven)\s*:\s*$/i.test(firstLine) ||
      /^-{2,}\s*(?:original message|oorspronkelijk(?:e)? bericht)\b/i.test(firstLine)
    ) {
      values.shift();
    }
    return stripStructuredQuoteMetadata(values).join('\n');
  }

  function stripOneQuotedDepth(value) {
    return String(value || '')
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((line) => String(line || '').replace(/^\s*>\s?/, ''))
      .join('\n');
  }

  function isForwardedConversation(mail) {
    return /^(?:(?:re)\s*:\s*)*(?:fw|fwd)\s*:/i.test(String(mail && mail.subject || '').trim());
  }

  function isSameProvenMailboxScope(message, mail) {
    const messageAccount = normalizeEmail(message && message.accountEmail);
    const mailAccount = normalizeEmail(mail && mail.accountEmail);
    if (messageAccount && mailAccount && messageAccount === mailAccount) return true;
    const copyContext = mail && mail.copyContext;
    return Boolean(
      copyContext && copyContext.evidenceKnown === true &&
      messageAccount &&
      messageAccount === normalizeEmail(copyContext.sourceAccountEmail)
    );
  }

  function getProvenOutboundThreadMessages(mail) {
    return (Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => (
        isSentMessageByProvenance(message, mail && mail.accountEmail) &&
        isSameProvenMailboxScope(message, mail)
      ));
  }

  function findExactQuotedOutbound(quotedValue, mail) {
    const quotedEnvelope = stripQuotedThreadEnvelope(quotedValue);
    return global.SoftoraMailboxQuotedThread?.findExactProvenOutbound?.(
      quotedEnvelope,
      getProvenOutboundThreadMessages(mail)
    ) || null;
  }

  function stripProvenQuotedOutbound(value, mail, messageContext = mail) {
    const result = global.SoftoraMailboxQuotedThread?.stripProvenQuotedOutbound?.(
      value,
      getProvenOutboundThreadMessages(mail),
      { directParentMessageIds: getDirectParentMessageIds(messageContext) }
    );
    return result && typeof result.body === 'string' ? result.body : String(value || '').trim();
  }

  function getSourceSafeThreadBody(message, mail) {
    const body = String(message && message.body || '');
    if (!body || isSentMessageByProvenance(message, mail && mail.accountEmail)) {
      return stripQuotedReply(body);
    }
    return stripProvenQuotedOutbound(body, mail, message);
  }

  function isDuplicateStructuredOwnQuote(section, mail, isReplyHeaderLine) {
    if (!section || section.type !== 'quote' || !Array.isArray(section.lines)) return false;
    const firstLine = String(section.lines[0] || '').trim();
    const hasReplyHeader = typeof isReplyHeaderLine === 'function' && isReplyHeaderLine(firstLine);
    return Boolean(findExactQuotedOutbound(
      (hasReplyHeader ? section.lines.slice(1) : section.lines).join('\n'),
      mail
    ));
  }

  function isMessageBodyPending(message) {
    const source = message && typeof message === 'object' ? message : {};
    if (source.bodyLoading === true) return true;
    const body = String(source.body || '').trim();
    const hasBody = Boolean(source.hasBody || body);
    return Boolean(
      hasBody &&
      (
        source.bodyLoaded === false ||
        !body ||
        source.bodyTruncated === true ||
        source.bodyImagesTruncated === true
      )
    );
  }

  function renderThreadMessages(mail, escapeHtml, formatDate, options = {}) {
    if (!mail || typeof escapeHtml !== 'function') return '';
    const rootTimestamp = getMessageTimestamp(mail);
    const mailboxOwner = getMessageOwner(mail) || activeOwner;
    const position = String(options.position || 'all').trim().toLowerCase();
    let messages = (Array.isArray(mail.threadMessages) ? mail.threadMessages : [])
      .filter((message) => (
        isSentMessageByProvenance(message, mail.accountEmail) ||
        !isAutomatedCampaignReply(message)
      ))
      .filter((message) => {
        if (position === 'all') return true;
        if (!rootTimestamp) return position !== 'newer';
        const messageTimestamp = getMessageTimestamp(message);
        if (!messageTimestamp) return position !== 'newer';
        return position === 'newer'
          ? messageTimestamp > rootTimestamp
          : messageTimestamp <= rootTimestamp;
      });
    if (options.newestFirst === true) {
      messages = messages.slice().sort((left, right) => getMessageTimestamp(right) - getMessageTimestamp(left));
    } else if (options.chronological === true) {
      messages = messages.slice().sort((left, right) => getMessageTimestamp(left) - getMessageTimestamp(right));
    }
    return messages.map((message) => {
      const loadError = String(message && message.bodyLoadError || '').trim();
      const loading = !loadError && isMessageBodyPending(message);
      const body = loading ? '' : getSourceSafeThreadBody(message, mail);
      if (!body && !loading && !loadError) return '';
      const when = typeof formatDate === 'function' ? formatDate(message.date) : null;
      const sent = isSentMessageByProvenance(message, mail.accountEmail);
      const messageOwner = sent ? getMessageOwner(message) : '';
      const owner = messageOwner ? getOwnerLabel(messageOwner) : '';
      const sentLabel = messageOwner && messageOwner === mailboxOwner ? 'Jouw bericht' : 'Eerdere mail';
      const dateLabel = [when && when.date, when && when.time].filter(Boolean).join(', ');
      const meta = [dateLabel, owner].filter(Boolean).join(' · ');
      const renderedBody = loadError
        ? `<div class="detail-mail-load-error" role="alert"><span>${escapeHtml(loadError)}</span><button type="button" data-mailbox-action="retry-thread-message" data-mailbox-id="${escapeHtml(mail.id)}" data-mailbox-thread-key="${escapeHtml(getActionMessageKey(message))}">Opnieuw proberen</button></div>`
        : loading
        ? '<div class="detail-mail-loading" role="status">Volledig bericht laden…</div>'
        : typeof options.renderMessageBody === 'function'
        ? options.renderMessageBody({ message, body, sent })
        : `<div class="detail-mail-lines">${body.split('\n').map((line) => {
            const content = String(line || '');
            const emptyClass = content.trim() ? '' : ' detail-mail-line-empty';
            return `<div class="detail-mail-line${emptyClass}">${escapeHtml(content)}</div>`;
          }).join('')}</div>`;
      const renderedAttachments = loading ? '' : renderAttachments(message, escapeHtml);
      const renderedRouting = renderMessageRouting(message, escapeHtml);
      const sectionClass = sent
        ? 'detail-mail-section detail-mail-section-sent'
        : 'detail-mail-section detail-mail-section-received';
      const messageActionHtml = options.action &&
        options.action.messageKey === getActionMessageKey(message)
        ? String(options.action.html || '')
        : '';
      const actionBefore = sent ? messageActionHtml : '';
      const actionInside = sent ? '' : messageActionHtml;
      return `${actionBefore}<section class="${sectionClass}">
          <div class="detail-mail-section-label">${sent ? sentLabel : 'Eerder ontvangen'}</div>
          ${meta ? `<div class="detail-mail-quote-meta">${escapeHtml(meta)}</div>` : ''}
          ${renderedRouting}${renderedBody}${renderedAttachments}${actionInside}
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

  function readPageBootstrap(value) {
    const requestedOwner = normalizeOwner(value == null ? activeOwner : value);
    if (pageBootstrapConsumedOwners.has(requestedOwner)) return null;
    const payload = readPageBootstrapPayload();
    const mailbox = payload?.mailbox;
    if (!mailbox || mailbox.ok === false || !Array.isArray(mailbox.messages)) return null;
    const snapshotOwner = isOwner(mailbox.owner) ? normalizeOwner(mailbox.owner) : '';
    if (snapshotOwner && snapshotOwner !== requestedOwner) return null;
    return snapshotFreshness?.normalizeSnapshot?.({
      ...mailbox,
      owner: requestedOwner,
      origin: 'server-bootstrap',
      messages: filterMessages(mailbox.messages, requestedOwner),
    }, { origin: 'server-bootstrap' }) || null;
  }

  function getMailboxTabCacheKey(value) {
    const session = getPageBootstrapSession();
    const identity = normalizeEmail(session && (session.userId || session.email));
    const owner = normalizeOwner(value == null ? activeOwner : value);
    return identity ? `${MAILBOX_SESSION_CACHE_KEY}:${identity}:${owner}` : '';
  }

  function readSessionMailboxSnapshot(value) {
    const cache = global.SoftoraPageBootstrapSession?.cache;
    const cacheKey = getMailboxTabCacheKey(value);
    const mailbox = cache?.read?.(cacheKey, MAILBOX_SESSION_CACHE_MAX_AGE_MS);
    const snapshot = snapshotFreshness?.normalizeSnapshot?.(mailbox, { origin: 'session-cache' });
    if (!snapshot) return null;
    return { ...snapshot, complete: false, degraded: true,
      sync: { ...snapshot.sync, stale: true, refreshRecommended: true },
      messages: snapshotFreshness.applyTombstones(snapshot.messages, snapshot.tombstones, snapshot.contentAt, { authoritative: false }) };
  }
  function writeSessionMailboxSnapshot(data, value) {
    const cache = global.SoftoraPageBootstrapSession?.cache;
    const owner = normalizeOwner(value == null ? activeOwner : value);
    const cacheKey = getMailboxTabCacheKey(owner);
    if (!cache || !cacheKey || !data || !Array.isArray(data.messages)) return false;
    const incoming = snapshotFreshness?.normalizeSnapshot?.(data, {
      origin: data.origin || data.sync?.origin || 'live-api',
    });
    if (!incoming) return false;
    const existing = readSessionMailboxSnapshot(owner);
    const action = existing ? snapshotFreshness.decideSnapshotUpdate(existing, incoming) : 'replace';
    if (action === 'reject') return false;
    const tombstones = snapshotFreshness.sanitizeTombstones([...(existing?.tombstones || []), ...(incoming.tombstones || [])])
      .filter((entry) => incoming.complete !== true || Date.parse(entry.hiddenAt) > Date.parse(incoming.contentAt));
    const sourceMessages = action === 'merge-additive'
      ? snapshotFreshness.mergeSnapshotMessagesAdditively(existing, incoming, tombstones)
      : snapshotFreshness.applyTombstones(incoming.messages, tombstones, incoming.contentAt, { authoritative: incoming.complete });
    const messages = sourceMessages
      .slice(0, 200).map((message) => {
      const source = message && typeof message === 'object' ? message : {};
      const sourceBodyImages = Array.isArray(source.bodyImages) ? source.bodyImages : [];
      const bodyImages = sourceBodyImages.filter((image) => {
        const dataUrl = String(image && image.dataUrl || '').trim();
        return dataUrl.startsWith('/api/mailbox/message-image?') && isSafeImageSource(dataUrl);
      });
      const threadMessages = (Array.isArray(source.threadMessages) ? source.threadMessages : []).map((message) => {
        const threadMessage = message && typeof message === 'object' ? message : {};
        const sourceThreadImages = Array.isArray(threadMessage.bodyImages) ? threadMessage.bodyImages : [];
        const threadBodyImages = sourceThreadImages.filter((image) => {
          const dataUrl = String(image && image.dataUrl || '').trim();
          return dataUrl.startsWith('/api/mailbox/message-image?') && isSafeImageSource(dataUrl);
        });
        return {
          ...threadMessage,
          bodyImagesTruncated: Boolean(threadMessage.bodyImagesTruncated || sourceThreadImages.length > threadBodyImages.length),
          bodyImages: threadBodyImages,
          inlineImages: [],
        };
      });
      return {
        ...source,
        bodyImagesTruncated: Boolean(source.bodyImagesTruncated || sourceBodyImages.length > bodyImages.length),
        bodyImages,
        threadMessages,
        inlineImages: [],
      };
    });
    return cache.write(cacheKey, {
      ok: incoming.ok !== false,
      savedAt: incoming.savedAt, contentAt: incoming.contentAt,
      owner,
      messages,
      origin: incoming.origin, complete: incoming.complete,
      degraded: incoming.degraded === true,
      tombstones, sync: incoming.sync,
    });
  }

  function readInitialMailboxSnapshot(value) {
    const pageSnapshot = readPageBootstrap(value);
    const sessionSnapshot = readSessionMailboxSnapshot(value);
    return snapshotFreshness?.selectSnapshot?.(pageSnapshot, sessionSnapshot) || null;
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
    const owner = getMessageOwner(mail) || activeOwner;
    if (!mail) return false;
    let updated = false;
    Array.from(new Set([owner, 'both'])).forEach((cacheOwner) => {
      const snapshot = readSessionMailboxSnapshot(cacheOwner);
      if (!snapshot) return;
      const messages = snapshot.messages.filter((candidate) => !matchesMessageIdentity(candidate, mail));
      updated = writeSessionMailboxSnapshot({
        ...snapshot,
        messages,
        tombstones: snapshotFreshness.addTombstone(snapshot.tombstones, mail),
      }, cacheOwner) || updated;
    });
    return updated;
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
    global.addEventListener?.('pagehide', (event) => { if (!event?.persisted) unsubscribe(); });
    return unsubscribe;
  }

  function getPageBootstrapSession() {
    const sharedSession = global.SoftoraPageBootstrapSession?.get?.();
    if (sharedSession && sharedSession.authenticated) return sharedSession;
    const session = readPageBootstrapPayload()?.session;
    return session && session.authenticated ? session : null;
  }

  function hasPageBootstrap(folder) {
    return folder === 'outreach' && Boolean(readInitialMailboxSnapshot(activeOwner));
  }

  function normalizeLoadResult(data, normalizeMessage, fromBootstrap, value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    const origin = String(data?.origin || (fromBootstrap ? 'server-bootstrap' : 'live-api'));
    const snapshot = snapshotFreshness?.normalizeSnapshot?.(data, { origin });
    if (!snapshot) throw new Error('De mailboxresponse heeft geen geldige actualiteitstijd.');
    const result = {
      owner,
      messages: filterMessages(
        snapshotFreshness.applyTombstones(snapshot.messages, snapshot.tombstones, snapshot.contentAt, { authoritative: snapshot.complete })
          .map(normalizeMessage),
        owner
      ),
      sync: {
        ...(snapshot.sync && typeof snapshot.sync === 'object' ? snapshot.sync : {
            indexed: true,
            stale: false,
            source: 'campaign-replies-index',
            refreshRecommended: false,
            warming: false,
          }),
        contentAt: snapshot.contentAt,
        origin: snapshot.origin,
      },
      origin: snapshot.origin, contentAt: snapshot.contentAt, complete: snapshot.complete,
      fromBootstrap: Boolean(fromBootstrap), fromCache: snapshot.origin === 'session-cache' || snapshot.complete === false,
    };
    if (snapshot.origin !== 'session-cache') {
      writeSessionMailboxSnapshot({ ...snapshot, owner, messages: result.messages, sync: result.sync }, owner);
    }
    return result;
  }

  function getSessionFallback(value) {
    const owner = normalizeOwner(value == null ? activeOwner : value);
    const snapshot = readSessionMailboxSnapshot(owner);
    if (!snapshot) return null;
    return {
      owner,
      messages: filterMessages(snapshot.messages, owner),
      sync: {
        ...(snapshot.sync && typeof snapshot.sync === 'object' ? snapshot.sync : {}),
        indexed: true,
        stale: true,
        source: 'campaign-replies-session-cache',
        refreshRecommended: true,
        warming: false,
        contentAt: snapshot.contentAt,
        origin: 'session-cache',
      },
      origin: 'session-cache',
      contentAt: snapshot.contentAt,
      complete: false,
      fromBootstrap: false,
      fromCache: true,
    };
  }

  async function load(folder, normalizeMessage, fetchImpl, options) {
    if (folder !== 'outreach') return null;
    const owner = normalizeOwner(options && options.owner != null ? options.owner : activeOwner);
    const bootstrap = !(options && options.skipBootstrap) ? readInitialMailboxSnapshot(owner) : null;
    if (bootstrap) {
      pageBootstrapConsumedOwners.add(owner);
      return normalizeLoadResult(bootstrap, normalizeMessage, true, owner);
    }
    const request = typeof fetchImpl === 'function'
      ? fetchImpl
      : global.fetch.bind(global);
    const params = new URLSearchParams({
      limit: '200',
      owner: owner === 'both' ? '' : owner,
      refreshInstantly: '0',
    });
    try {
      const response = await request(`/api/mailbox/campaign-replies?${params.toString()}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...(options && options.signal ? { signal: options.signal } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || 'Campagnereacties laden mislukt');
      }
      if (owner !== 'both' && isPersonalOwner(data.owner) && normalizeOwner(data.owner) !== owner) {
        throw new Error('De mailboxresponse hoort bij een andere eigenaar.');
      }
      return normalizeLoadResult(data, normalizeMessage, false, owner);
    } catch (error) {
      if (options?.signal?.aborted || error?.name === 'AbortError') throw error;
      const fallback = getSessionFallback(owner);
      if (fallback) return fallback;
      throw error;
    }
  }

  const campaignInboxApi = {
    bindMessageDeletionSync,
    decorateMessage,
    filterMessages,
    getAccount,
    getConversationId,
    getStableCampaignConversationId,
    getConversationAction,
    getActionMessageKey,
    getFolder,
    hasPageBootstrap,
    getOwner,
    getOwnerByAccount,
    getMessageOwner,
    getOwnerLabel,
    getMailboxTabCacheKey,
    getOwnerOptionsForMenu,
    getOwnerPinKeyForIdentity,
    getPageBootstrapSession,
    getRequestId,
    groupConversationMessages,
    initializeOwnerPreference,
    isAutomatedCampaignReply,
    isDuplicateStructuredOwnQuote,
    isOwner,
    isPersonalOwner,
    isSafeImageSource,
    isCampaignMail,
    isCampaignAccount,
    isMessageBodyPending,
    load,
    matchesMessageIdentity,
    normalizeOwner,
    pinOwner,
    publishMessageDeletion,
    removeAndPublishMessageDeletion,
    removeCachedMessage,
    renderDetailAccount,
    renderCopyRouting,
    renderMessageRouting,
    renderAttachments,
    renderListMeta,
    renderOwnerMenu,
    renderThreadMessages,
    resolveOwnerForSession,
    setOwner,
    sortMessagesNewestFirst,
    stripProvenQuotedOutbound,
    stripQuotedReply,
    subscribeToMessageDeletions,
  };
  global.SoftoraMailboxCampaignInbox = campaignInboxApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = campaignInboxApi;
})(typeof window !== 'undefined' ? window : globalThis);
