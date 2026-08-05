const DEFAULT_API_BASE_URL = 'https://api.instantly.ai/api/v2';
const { parseProviderHtml } = require('./mailbox-provider-rich-body');
const {
  buildIndexedThreadAuditState,
  buildCustomerQuotedMessageSource,
  buildOriginalMessageSource,
  extractLeadId,
  hydrateIndexedThreadMessageEvidence,
} = require('./instantly-original-message-source');
const {
  buildAutomatedReplyEvidence,
  isAutomatedCampaignReply,
} = require('./mailbox-automated-reply');
const { buildAcceptedSentMessage, normalizeProviderAttachmentList } = require('./mailbox-accepted-sent-message');
const { resolveConversationActivity } = require('./mailbox-conversation-activity');
const { buildRecentSyncResult } = require('./instantly-mailbox-sync-cadence');
const DEFAULT_INITIAL_LOOKBACK_DAYS = 120;
const DEFAULT_SYNC_OVERLAP_MINUTES = 10;
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_RICH_BODY_AUDIT_LIMIT = 25;
const INSTANTLY_MAILBOX_SYNC_SCOPE = 'instantly_mailbox_sync';
const VALID_OWNERS = new Set(['serve', 'martijn']);

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(normalizeText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function normalizeOwner(value) {
  const owner = normalizeText(value).toLowerCase().replace('servé', 'serve');
  return VALID_OWNERS.has(owner) ? owner : '';
}

function normalizeAccountOwnership(value) {
  const source = parseJsonObject(value);
  const byKey = new Map();
  Object.entries(source).forEach(([rawKey, rawValue]) => {
    const key = normalizeText(rawKey).toLowerCase();
    const record = rawValue && typeof rawValue === 'object'
      ? rawValue
      : { owner: rawValue };
    const owner = normalizeOwner(record.owner);
    const email = normalizeEmail(record.email || (isValidEmail(key) ? key : ''));
    if (!key || !owner || !email) return;
    byKey.set(key, Object.freeze({ key, email, owner }));
    byKey.set(email, Object.freeze({ key, email, owner }));
  });
  return byKey;
}

function normalizeCampaignOwnership(value) {
  const source = parseJsonObject(value);
  return new Map(
    Object.entries(source)
      .map(([campaignId, owner]) => [normalizeText(campaignId), normalizeOwner(owner)])
      .filter(([campaignId, owner]) => Boolean(campaignId && owner))
  );
}

function extractAddress(value) {
  if (typeof value === 'string') {
    const match = value.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    return match ? normalizeEmail(match[0]) : '';
  }
  if (!value || typeof value !== 'object') return '';
  return normalizeEmail(
    value.email ||
    value.address ||
    value.email_address ||
    value.address_email ||
    value.value
  );
}

function extractAddressList(...values) {
  const addresses = [];
  values.flat(Infinity).forEach((value) => {
    if (typeof value === 'string' && /[,;]/.test(value)) {
      value.split(/[,;]/).forEach((item) => addresses.push(extractAddress(item)));
      return;
    }
    addresses.push(extractAddress(value));
  });
  return Array.from(new Set(addresses.filter(isValidEmail)));
}

function extractName(value) {
  if (!value || typeof value !== 'object') return '';
  return normalizeText(value.name || value.display_name || value.address_name);
}

function extractInstantlyItems(data) {
  if (Array.isArray(data)) return data;
  for (const candidate of [data?.items, data?.data, data?.emails, data?.results]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractCursor(data) {
  return normalizeText(
    data?.next_starting_after ||
    data?.next_cursor ||
    data?.pagination?.next_starting_after ||
    data?.pagination?.next_cursor
  );
}

function parseDate(value, fallback = new Date()) {
  const date = value ? new Date(value) : fallback;
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function createInstantlyMailboxError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function createInstantlyMailboxService(deps = {}) {
  const {
    config = {},
    mailboxIndexStore,
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    getCustomerSourcesByEmails = async () => [],
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    now = () => new Date(),
    logger = console,
  } = deps;
  const normalizedConfig = Object.freeze({
    enabled: /^(1|true|yes|on)$/i.test(String(config.enabled || '')),
    apiKey: normalizeText(config.apiKey),
    apiBaseUrl: normalizeText(config.apiBaseUrl || DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
    webhookSecret: normalizeText(config.webhookSecret),
    initialLookbackDays: Math.max(
      1,
      Math.min(365, Number(config.initialLookbackDays) || DEFAULT_INITIAL_LOOKBACK_DAYS)
    ),
    syncOverlapMinutes: Math.max(
      1,
      Math.min(60, Number(config.syncOverlapMinutes) || DEFAULT_SYNC_OVERLAP_MINUTES)
    ),
    pageLimit: Math.max(1, Math.min(100, Number(config.pageLimit) || DEFAULT_PAGE_LIMIT)),
    maxPages: Math.max(1, Math.min(10, Number(config.maxPages) || DEFAULT_MAX_PAGES)),
    richBodyAuditLimit: Math.max(
      4,
      Math.min(50, Number(config.richBodyAuditLimit) || DEFAULT_RICH_BODY_AUDIT_LIMIT)
    ),
  });
  const accountOwnership = normalizeAccountOwnership(config.accountOwners);
  const campaignOwnership = normalizeCampaignOwnership(config.campaignOwners);
  let syncPromiseByOwner = new Map();

  function getConfiguredAccounts(owner = '') {
    const selectedOwner = normalizeOwner(owner);
    const records = new Map();
    accountOwnership.forEach((record) => {
      if (selectedOwner && record.owner !== selectedOwner) return;
      records.set(record.email, record);
    });
    return Array.from(records.values()).sort((left, right) => left.email.localeCompare(right.email));
  }

  function getMissingConfig() {
    return [
      !normalizedConfig.apiKey ? 'INSTANTLY_API_KEY' : '',
      !normalizedConfig.webhookSecret ? 'INSTANTLY_WEBHOOK_SECRET' : '',
      !getConfiguredAccounts().length ? 'INSTANTLY_ACCOUNT_OWNERS_JSON' : '',
    ].filter(Boolean);
  }

  function isConfigured() {
    return normalizedConfig.enabled && getMissingConfig().length === 0;
  }

  function assertConfigured() {
    if (!normalizedConfig.enabled) {
      throw createInstantlyMailboxError(
        'Instantly-mailbox staat nog niet aan.',
        'INSTANTLY_MAILBOX_DISABLED',
        503
      );
    }
    const missing = getMissingConfig();
    if (missing.length) {
      throw createInstantlyMailboxError(
        'Instantly-mailbox mist nog verbindingsgegevens.',
        'INSTANTLY_MAILBOX_NOT_CONFIGURED',
        503,
        { missing }
      );
    }
  }

  function assertOwner(value) {
    const owner = normalizeOwner(value);
    if (!owner) {
      throw createInstantlyMailboxError(
        'Kies eerst de mailbox van Servé of Martijn.',
        'INSTANTLY_OWNER_REQUIRED',
        400
      );
    }
    return owner;
  }

  function resolveAccountRecord(rawMessage = {}) {
    const candidates = [
      normalizeText(rawMessage.eaccount).toLowerCase(),
      normalizeText(rawMessage.email_account).toLowerCase(),
      normalizeText(rawMessage.email_account_id).toLowerCase(),
      normalizeEmail(rawMessage.from_address_email),
      ...extractAddressList(
        rawMessage.to_address_email_list,
        rawMessage.to_address_json,
        rawMessage.to,
        rawMessage.to_address_email
      ),
    ].filter(Boolean);
    const records = Array.from(
      new Map(
        candidates
          .map((candidate) => accountOwnership.get(candidate))
          .filter(Boolean)
          .map((record) => [record.email, record])
      ).values()
    );
    if (records.length !== 1) return null;
    const record = records[0];
    const campaignId = normalizeText(rawMessage.campaign_id);
    const campaignOwner = campaignId ? campaignOwnership.get(campaignId) : '';
    if (campaignOwner && campaignOwner !== record.owner) return null;
    return record;
  }

  function getEmailDirection(rawMessage, accountEmail) {
    const type = normalizeText(rawMessage.ue_type || rawMessage.email_type || rawMessage.type).toLowerCase();
    if (['1', '3', '4', 'sent', 'manual', 'scheduled'].includes(type)) return 'sent';
    if (['2', 'received'].includes(type)) return 'received';
    return normalizeEmail(rawMessage.from_address_email) === normalizeEmail(accountEmail)
      ? 'sent'
      : 'received';
  }

  function normalizeInstantlyMessage(rawMessage = {}) {
    const account = resolveAccountRecord(rawMessage);
    const providerMessageId = normalizeText(rawMessage.id || rawMessage.email_id || rawMessage.uuid);
    if (!account || !providerMessageId) return null;
    const direction = getEmailDirection(rawMessage, account.email);
    const fromAddress = normalizeEmail(rawMessage.from_address_email || extractAddress(rawMessage.from_address_json));
    const fromName = normalizeText(
      rawMessage.from_address_name ||
      extractName(rawMessage.from_address_json) ||
      fromAddress
    );
    const toAddresses = extractAddressList(
      rawMessage.to_address_email_list,
      rawMessage.to_address_json,
      rawMessage.to,
      rawMessage.to_address_email
    );
    const ccAddresses = extractAddressList(
      rawMessage.cc_address_email_list,
      rawMessage.cc_address_json,
      rawMessage.cc
    );
    const bccAddresses = extractAddressList(
      rawMessage.bcc_address_email_list,
      rawMessage.bcc_address_json,
      rawMessage.bcc
    );
    const text = normalizeText(rawMessage.body?.text || rawMessage.body_text || rawMessage.email_text);
    const html = normalizeText(rawMessage.body?.html || rawMessage.body_html || rawMessage.email_html);
    const providerHtml = parseProviderHtml(html);
    const originalSource = rawMessage.__softoraOriginalMessageSource &&
      typeof rawMessage.__softoraOriginalMessageSource === 'object'
      ? rawMessage.__softoraOriginalMessageSource
      : null;
    const body = originalSource?.available
      ? normalizeText(originalSource.body)
      : providerHtml.body || text;
    const date = parseDate(
      rawMessage.timestamp_email ||
      rawMessage.timestamp_created ||
      rawMessage.created_at,
      now()
    ).toISOString();
    const providerThreadId = normalizeText(rawMessage.thread_id);
    const lifecycleType = normalizeText(
      rawMessage.ue_type || rawMessage.email_type || rawMessage.type
    ).toLowerCase();
    return {
      id: `instantly:${providerMessageId}`,
      provider: 'instantly',
      providerMessageId,
      providerThreadId,
      providerCampaignId: normalizeText(rawMessage.campaign_id),
      providerAccountEmail: account.email,
      providerOwner: account.owner,
      accountEmail: account.email,
      folder: direction === 'sent' ? 'sent' : 'inbox',
      direction,
      from: fromName || fromAddress || 'Onbekend',
      email: fromAddress,
      to: toAddresses.join(', '),
      toDisplay: toAddresses.join(', '),
      cc: ccAddresses.join(', '),
      bcc: bccAddresses.join(', '),
      recipientRoutingEvidenceKnown: true,
      subject: normalizeText(rawMessage.subject || rawMessage.email_subject) || '(Geen onderwerp)',
      body,
      preview: normalizeText(rawMessage.content_preview || rawMessage.preview || body).slice(0, 500),
      date,
      receivedAt: date,
      activityAt: date,
      messageId: normalizeText(rawMessage.message_id),
      inReplyTo: normalizeText(rawMessage.in_reply_to || rawMessage.reply_to_uuid),
      references: normalizeText(rawMessage.references),
      unread: direction === 'received' && (
        Number(rawMessage.is_unread) === 1 ||
        (rawMessage.is_unread === undefined && rawMessage.is_read !== true)
      ),
      hasBody: Boolean(body),
      bodyLoaded: Boolean(body),
      bodyTruncated: false,
      attachments: normalizeProviderAttachmentList(rawMessage.attachment_json || rawMessage.attachments),
      originalCampaignOutbound: direction === 'sent' && lifecycleType === '1',
      providerBodyHtmlEvidenceKnown: Boolean(html),
      providerRichBodyAvailable: Boolean(providerHtml.body),
      providerOriginalBodyEvidenceKnown: originalSource?.evidenceKnown === true,
      providerOriginalBodyAvailable: originalSource?.available === true,
      webdesignLinkEvidenceKnown: originalSource?.available
        ? originalSource.webdesignLinkEvidenceKnown === true
        : providerHtml.webdesignLinkEvidenceKnown,
      webdesignLinkUrl: originalSource?.available
        ? normalizeText(originalSource.webdesignLinkUrl)
        : providerHtml.webdesignLinkUrl,
      ...buildAutomatedReplyEvidence({
        autoSubmitted: rawMessage.auto_submitted || rawMessage.autoSubmitted,
        precedence: rawMessage.precedence,
        autoResponseSuppress: rawMessage.x_auto_response_suppress || rawMessage.auto_response_suppress,
      }),
      indexed: true,
    };
  }

  async function apiRequest(path, { method = 'GET', query = {}, body } = {}) {
    assertConfigured();
    const url = new URL(`${normalizedConfig.apiBaseUrl}/${normalizeText(path).replace(/^\/+/, '')}`);
    Object.entries(query).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
    });
    const options = {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedConfig.apiKey}`,
      },
    };
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const { response, data } = await fetchJsonWithTimeout(url.toString(), options, 20_000);
    if (!response?.ok) {
      const status = Number(response?.status) || 502;
      const detail = normalizeText(data?.message || data?.error || data?.detail);
      throw createInstantlyMailboxError(
        detail || `Instantly gaf HTTP ${status}.`,
        status === 429 ? 'INSTANTLY_RATE_LIMITED' : 'INSTANTLY_API_FAILED',
        status === 429 ? 429 : 502,
        { providerStatus: status }
      );
    }
    return data;
  }

  async function hydrateThread({ threadId, accountEmail, owner, indexedMessages = [] }) {
    const exactThreadId = normalizeText(threadId);
    const exactAccountEmail = normalizeEmail(accountEmail);
    const exactOwner = assertOwner(owner);
    if (!exactThreadId || !exactAccountEmail) return { stored: 0 };
    const account = accountOwnership.get(exactAccountEmail);
    if (!account || account.owner !== exactOwner) {
      throw createInstantlyMailboxError(
        'Instantly-thread hoort niet bij het geselecteerde account.',
        'INSTANTLY_THREAD_OWNER_MISMATCH',
        403
      );
    }
    const data = await apiRequest('emails', {
      query: {
        limit: 100,
        eaccount: exactAccountEmail,
        search: `thread:${exactThreadId}`,
        sort_order: 'asc',
      },
    });
    const {
      exactIndexedMessages,
      exactProviderMessagesUnavailable,
      rawMessages,
    } = await hydrateIndexedThreadMessageEvidence({
      rawMessages: extractInstantlyItems(data),
      indexedMessages,
      threadId: exactThreadId,
      accountEmail: exactAccountEmail,
      apiRequest,
    });
    const originalRecipients = Array.from(new Set(
      rawMessages
        .filter((rawMessage) => (
          getEmailDirection(rawMessage, exactAccountEmail) === 'sent' &&
          normalizeText(rawMessage.ue_type || rawMessage.email_type || rawMessage.type).toLowerCase() === '1'
        ))
        .map((rawMessage) => extractAddressList(
          rawMessage.to_address_email_list,
          rawMessage.to_address_json,
          rawMessage.to,
          rawMessage.to_address_email
        )[0])
        .filter(Boolean)
    ));
    const customerSourcesByEmail = new Map();
    if (originalRecipients.length) {
      try {
        const customers = await getCustomerSourcesByEmails({
          emails: originalRecipients,
          bypassReadCache: true,
          bypassReadFailureCooldown: true,
          suppressReadFailureCooldown: true,
          suppressTransientReadFailureLog: true,
        });
        const candidatesByEmail = new Map();
        for (const customer of Array.isArray(customers) ? customers : []) {
          const customerEmail = normalizeEmail(customer?.email || customer?.contactEmail);
          if (!customerEmail || !originalRecipients.includes(customerEmail)) continue;
          const candidates = candidatesByEmail.get(customerEmail) || [];
          candidates.push(customer);
          candidatesByEmail.set(customerEmail, candidates);
        }
        candidatesByEmail.forEach((candidates, customerEmail) => {
          customerSourcesByEmail.set(customerEmail, candidates.length === 1 ? candidates[0] : null);
        });
      } catch (error) {
        logger.warn('[InstantlyMailbox][CustomerOriginalSource]', error?.message || error);
      }
    }
    const leadSourceCache = new Map();
    const enrichedMessages = [];
    for (const rawMessage of rawMessages) {
      const direction = getEmailDirection(rawMessage, exactAccountEmail);
      const lifecycleType = normalizeText(
        rawMessage.ue_type || rawMessage.email_type || rawMessage.type
      ).toLowerCase();
      if (direction !== 'sent' || lifecycleType !== '1') {
        enrichedMessages.push(rawMessage);
        continue;
      }
      const recipientEmail = extractAddressList(
        rawMessage.to_address_email_list,
        rawMessage.to_address_json,
        rawMessage.to,
        rawMessage.to_address_email
      )[0];
      const exactCustomer = customerSourcesByEmail.get(recipientEmail);
      const customerQuotedSource = exactCustomer
        ? buildCustomerQuotedMessageSource(
            rawMessage,
            rawMessages,
            exactCustomer,
            {
              accountEmail: exactAccountEmail,
              recipientEmail,
              sameOwnerAccountEmails: getConfiguredAccounts(exactOwner)
                .map((account) => account.email),
            }
          )
        : null;
      if (customerQuotedSource?.available === true) {
        enrichedMessages.push({
          ...rawMessage,
          __softoraOriginalMessageSource: customerQuotedSource,
        });
        continue;
      }
      const leadId = extractLeadId(rawMessage);
      const leadCacheKey = leadId || `${normalizeText(rawMessage.campaign_id)}|${recipientEmail}`;
      try {
        if (!leadSourceCache.has(leadCacheKey)) {
          if (leadId) {
            leadSourceCache.set(leadCacheKey, await apiRequest(`leads/${encodeURIComponent(leadId)}`));
          } else if (recipientEmail && normalizeText(rawMessage.campaign_id)) {
            const leadList = await apiRequest('leads/list', {
              method: 'POST',
              body: {
                campaign: normalizeText(rawMessage.campaign_id),
                contacts: [recipientEmail],
                limit: 2,
              },
            });
            const exactLeads = extractInstantlyItems(leadList).filter((lead) => (
              normalizeText(lead?.campaign || lead?.campaign_id) === normalizeText(rawMessage.campaign_id) &&
              normalizeEmail(lead?.email || lead?.contact) === recipientEmail
            ));
            leadSourceCache.set(leadCacheKey, exactLeads.length === 1 ? exactLeads[0] : null);
          } else {
            leadSourceCache.set(leadCacheKey, null);
          }
        }
        const exactLead = leadSourceCache.get(leadCacheKey);
        enrichedMessages.push({
          ...rawMessage,
          __softoraOriginalMessageSource: exactLead
            ? buildOriginalMessageSource(
                rawMessage,
                exactLead,
                { accountEmail: exactAccountEmail, recipientEmail }
              )
            : {
                evidenceKnown: true,
                available: false,
                reason: 'exact-lead-not-found',
              },
        });
      } catch (error) {
        if (Number(error?.providerStatus) === 404) {
          enrichedMessages.push({
            ...rawMessage,
            __softoraOriginalMessageSource: {
              evidenceKnown: true,
              available: false,
              reason: 'lead-not-found',
            },
          });
          continue;
        }
        logger.warn('[InstantlyMailbox][OriginalSource]', error?.message || error);
        enrichedMessages.push(rawMessage);
      }
    }
    const messages = enrichedMessages
      .map(normalizeInstantlyMessage)
      .filter((message) => (
        message &&
        message.providerOwner === exactOwner &&
        message.providerAccountEmail === exactAccountEmail &&
        message.providerThreadId === exactThreadId
      ));
    if (
      exactProviderMessagesUnavailable.size &&
      typeof mailboxIndexStore.getProviderMessage === 'function'
    ) {
      for (const providerMessageId of exactProviderMessagesUnavailable) {
        const indexedMessage = exactIndexedMessages.find((message) => (
          normalizeText(message?.providerMessageId) === providerMessageId
        ));
        if (indexedMessage?.originalCampaignOutbound !== true) continue;
        const storedMessage = await mailboxIndexStore.getProviderMessage({
          provider: 'instantly',
          providerMessageId,
          accountEmail: exactAccountEmail,
        });
        if (
          !storedMessage ||
          storedMessage.providerOwner !== exactOwner ||
          storedMessage.providerThreadId !== exactThreadId ||
          storedMessage.originalCampaignOutbound !== true
        ) {
          continue;
        }
        messages.push({
          ...storedMessage,
          folder: 'sent',
          direction: 'sent',
          providerOriginalBodyEvidenceKnown: true,
          providerOriginalBodyAvailable: false,
        });
      }
    }
    const upsert = await mailboxIndexStore.upsertProviderMessages({
      provider: 'instantly',
      messages,
    });
    if (!upsert?.ok) {
      throw createInstantlyMailboxError(
        'Instantly-thread kon niet duurzaam worden opgeslagen.',
        'INSTANTLY_THREAD_STORE_FAILED',
        503
      );
    }
    return { stored: Number(upsert.upserted) || 0 };
  }

  function getSyncStateKey(owner) {
    return `instantly-${owner}@softora.internal`;
  }

  async function getContinuation(owner) {
    try {
      const state = await getUiStateValues(INSTANTLY_MAILBOX_SYNC_SCOPE);
      const values = state && typeof state.values === 'object' ? state.values : {};
      return {
        cursor: normalizeText(values[`cursor_${owner}`]),
        minTimestamp: normalizeText(values[`min_timestamp_${owner}`]),
      };
    } catch (_) {
      return { cursor: '', minTimestamp: '' };
    }
  }

  async function setContinuation(owner, continuation = {}) {
    await setUiStateValues(
      INSTANTLY_MAILBOX_SYNC_SCOPE,
      {
        [`cursor_${owner}`]: normalizeText(continuation.cursor),
        [`min_timestamp_${owner}`]: normalizeText(continuation.minTimestamp),
      },
      {
        source: 'instantly-mailbox-sync',
        actor: 'Instantly mailbox',
      }
    );
  }

  async function syncOwner(owner, options = {}) {
    const selectedOwner = assertOwner(owner);
    assertConfigured();
    if (!mailboxIndexStore?.upsertProviderMessages || !mailboxIndexStore?.getSyncState) {
      throw createInstantlyMailboxError(
        'Duurzame Instantly-mailboxopslag is niet beschikbaar.',
        'INSTANTLY_MAILBOX_STORE_UNAVAILABLE',
        503
      );
    }
    if (syncPromiseByOwner.has(selectedOwner)) return syncPromiseByOwner.get(selectedOwner);
    const promise = (async () => {
      const accounts = getConfiguredAccounts(selectedOwner);
      if (!accounts.length) {
        throw createInstantlyMailboxError(
          `Er zijn geen Instantly-accounts aan ${selectedOwner} gekoppeld.`,
          'INSTANTLY_OWNER_HAS_NO_ACCOUNTS',
          409
        );
      }
      const syncKey = getSyncStateKey(selectedOwner);
      const state = await mailboxIndexStore.getSyncState({ accountEmail: syncKey, folder: 'instantly' });
      const recentSync = buildRecentSyncResult({ state, owner: selectedOwner, accounts, minIntervalMs: options.minIntervalMs, nowMs: now().getTime() });
      if (recentSync) return recentSync;
      const lock = await mailboxIndexStore.acquireSyncLock?.({
        accountEmail: syncKey,
        folder: 'instantly',
      });
      if (lock && !lock.ok) {
        if (lock.locked) {
          return {
            ok: true,
            owner: selectedOwner,
            accounts: accounts.map((account) => account.email),
            seen: 0,
            stored: 0,
            pages: 0,
            skipped: true,
            reason: 'sync-in-progress',
          };
        }
        throw createInstantlyMailboxError(
          'Instantly-sync kon geen duurzame lock verkrijgen.',
          'INSTANTLY_SYNC_LOCK_FAILED',
          503
        );
      }
      const lockToken = normalizeText(lock?.lockToken);
      const lastSyncedAt = Date.parse(normalizeText(state?.last_synced_at));
      const fallbackSince = now().getTime() - normalizedConfig.initialLookbackDays * 24 * 60 * 60 * 1000;
      const overlapMs = normalizedConfig.syncOverlapMinutes * 60 * 1000;
      const continuation = await getContinuation(selectedOwner);
      const calculatedMinTimestamp = new Date(
        Math.max(fallbackSince, Number.isFinite(lastSyncedAt) ? lastSyncedAt - overlapMs : fallbackSince)
      ).toISOString();
      const minTimestamp = continuation.minTimestamp || calculatedMinTimestamp;
      let cursor = continuation.cursor;
      let page = 0;
      let seen = 0;
      let stored = 0;
      const threadCandidates = new Map();
      try {
        do {
          const data = await apiRequest('emails', {
            query: {
              limit: normalizedConfig.pageLimit,
              starting_after: cursor,
              eaccount: accounts.map((account) => account.email).join(','),
              min_timestamp_created: minTimestamp,
              sort_order: 'desc',
            },
          });
          const messages = extractInstantlyItems(data)
            .map(normalizeInstantlyMessage)
            .filter((message) => message && message.providerOwner === selectedOwner);
          messages
            .filter((message) => message.folder !== 'sent' && message.providerThreadId)
            .forEach((message) => {
              const key = `${message.providerAccountEmail}|${message.providerThreadId}`;
              if (!threadCandidates.has(key)) threadCandidates.set(key, message);
            });
          seen += extractInstantlyItems(data).length;
          const upsert = await mailboxIndexStore.upsertProviderMessages({
            provider: 'instantly',
            messages,
          });
          if (!upsert?.ok) {
            throw createInstantlyMailboxError(
              'Instantly-berichten konden niet duurzaam worden opgeslagen.',
              'INSTANTLY_MAILBOX_STORE_FAILED',
              503
            );
          }
          stored += Number(upsert.upserted) || 0;
          cursor = extractCursor(data);
          page += 1;
        } while (cursor && page < normalizedConfig.maxPages);
        const indexed = await mailboxIndexStore.listProviderMessages({
          provider: 'instantly',
          accountEmails: accounts.map((account) => account.email),
          limit: 2000,
          includeBody: false,
        });
        const activeConversationAuditMessages =
          typeof mailboxIndexStore.listProviderActiveConversationAuditMessages === 'function'
            ? await mailboxIndexStore.listProviderActiveConversationAuditMessages({
                provider: 'instantly',
                accountEmails: accounts.map((account) => account.email),
              })
            : [];
        const { indexedThreadMessages } = buildIndexedThreadAuditState({
          indexedMessages: indexed,
          activeConversationAuditMessages,
          threadCandidates,
          selectedOwner,
        });
        const pendingThreadHydrations = Array.from(threadCandidates.entries())
          .filter(([key]) => {
            const indexedMessages = indexedThreadMessages.get(key) || [];
            const hasMissingThreadMember = indexedMessages.length <= 1;
            const needsExactProviderBody = indexedMessages.some((message) => (
              message.folder === 'sent' &&
              message.originalCampaignOutbound === true &&
              (
                message.providerBodyHtmlEvidenceKnown !== true ||
                message.providerOriginalBodyEvidenceKnown !== true
              )
            ));
            return hasMissingThreadMember || needsExactProviderBody;
          })
          .slice(0, normalizedConfig.richBodyAuditLimit);
        for (const [key, candidate] of pendingThreadHydrations) {
          const indexedMessages = indexedThreadMessages.get(key) || [];
          const hasMissingThreadMember = indexedMessages.length <= 1;
          const needsExactProviderBody = indexedMessages.some((message) => (
            message.folder === 'sent' &&
            message.originalCampaignOutbound === true &&
            (
              message.providerBodyHtmlEvidenceKnown !== true ||
              message.providerOriginalBodyEvidenceKnown !== true
            )
          ));
          if (!hasMissingThreadMember && !needsExactProviderBody) continue;
          const hydrated = await hydrateThread({
            threadId: candidate.providerThreadId,
            accountEmail: candidate.providerAccountEmail,
            owner: selectedOwner,
            indexedMessages,
          });
          stored += hydrated.stored;
        }
        await mailboxIndexStore.finishSync?.({
          accountEmail: syncKey,
          folder: 'instantly',
          lockToken,
          messageCount: stored,
        });
        await setContinuation(selectedOwner, cursor
          ? { cursor, minTimestamp }
          : { cursor: '', minTimestamp: '' });
        return {
          ok: true,
          owner: selectedOwner,
          accounts: accounts.map((account) => account.email),
          seen,
          stored,
          pages: page,
          partial: Boolean(cursor),
          syncedAt: now().toISOString(),
        };
      } catch (error) {
        await mailboxIndexStore.finishSync?.({
          accountEmail: syncKey,
          folder: 'instantly',
          lockToken,
          messageCount: stored,
          error: error?.message || error,
        });
        throw error;
      }
    })().finally(() => {
      syncPromiseByOwner.delete(selectedOwner);
    });
    syncPromiseByOwner.set(selectedOwner, promise);
    return promise;
  }

  function getMessageIdentity(message) {
    return normalizeText(
      message?.providerMessageId ||
      message?.messageId ||
      message?.id
    );
  }

  function groupOwnerConversations(messages, owner) {
    const selectedOwner = assertOwner(owner);
    const groups = new Map();
    (Array.isArray(messages) ? messages : [])
      .filter((message) => (
        message?.provider === 'instantly' &&
        message?.providerOwner === selectedOwner
      ))
      .forEach((message) => {
        const key = normalizeText(message.providerThreadId) ||
          `message:${getMessageIdentity(message)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(message);
      });
    return Array.from(groups.entries())
      .map(([threadId, threadMessages]) => {
        const sorted = threadMessages
          .filter((message) => (
            message.folder === 'sent' || !isAutomatedCampaignReply(message)
          ))
          .slice()
          .sort((left, right) => Date.parse(right.date || 0) - Date.parse(left.date || 0));
        const incoming = sorted.find((message) => message.folder !== 'sent');
        if (!incoming) return null;
        const root = incoming;
        const activity = resolveConversationActivity({ ...root, threadMessages: sorted.filter(
          (message) => getMessageIdentity(message) !== getMessageIdentity(root)
        ) });
        return {
          ...root,
          id: `${root.accountEmail}|instantly-thread:${threadId}`,
          mailboxId: root.id,
          conversationId: `instantly:${root.accountEmail}:${threadId}`,
          activityAt: activity.latestInboundAt,
          latestInboundAt: activity.latestInboundAt,
          latestOutboundAt: activity.latestOutboundAt,
          campaign: {
            provider: 'instantly',
            campaignId: normalizeText(root.providerCampaignId),
            account: root.accountEmail,
            company: root.from || root.email,
            actionRequired: (Date.parse(activity.latestInboundAt || '') || 0) > (Date.parse(activity.latestOutboundAt || '') || 0),
          },
          outreach: {
            provider: 'instantly',
            threadId,
            owner: selectedOwner,
          },
          threadMessages: sorted.filter(
            (message) => getMessageIdentity(message) !== getMessageIdentity(root)
          ),
        };
      })
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.latestInboundAt || right.activityAt || 0) - Date.parse(left.latestInboundAt || left.activityAt || 0));
  }

  async function listOwnerConversations(owner, { limit = 100 } = {}) {
    const selectedOwner = assertOwner(owner);
    if (!isConfigured()) return [];
    const accounts = getConfiguredAccounts(selectedOwner);
    const rows = await mailboxIndexStore.listProviderMessages({
      provider: 'instantly',
      accountEmails: accounts.map((account) => account.email),
      limit: Math.max(100, Math.min(500, Number(limit) * 5 || 500)),
      includeBody: true,
    });
    if (!Array.isArray(rows)) {
      throw createInstantlyMailboxError(
        'Instantly-mailbox kon niet uit de duurzame opslag worden geladen.',
        'INSTANTLY_MAILBOX_READ_FAILED',
        503
      );
    }
    return groupOwnerConversations(rows, selectedOwner).slice(0, Math.max(1, Number(limit) || 100));
  }

  async function findStoredProviderMessage({ providerMessageId, accountEmail }) {
    const id = normalizeText(providerMessageId).replace(/^instantly:/, '');
    const account = normalizeEmail(accountEmail);
    if (!id || !account) return null;
    const ownerRecord = accountOwnership.get(account);
    if (!ownerRecord) return null;
    if (typeof mailboxIndexStore.getProviderMessage === 'function') {
      return mailboxIndexStore.getProviderMessage({
        provider: 'instantly',
        providerMessageId: id,
        accountEmail: account,
      });
    }
    const rows = await mailboxIndexStore.listProviderMessages({
      provider: 'instantly',
      accountEmails: [account],
      limit: 2000,
      includeBody: true,
    });
    return (Array.isArray(rows) ? rows : []).find(
      (message) => message.providerMessageId === id
    ) || null;
  }

  async function assertStoredMessageOwnership({
    owner,
    accountEmail,
    providerMessageId,
    providerThreadId = '',
  } = {}) {
    const selectedOwner = assertOwner(owner);
    const account = normalizeEmail(accountEmail);
    const accountRecord = accountOwnership.get(account);
    if (!accountRecord || accountRecord.owner !== selectedOwner) {
      throw createInstantlyMailboxError(
        'Dit Instantly-account hoort niet bij de geselecteerde mailbox.',
        'INSTANTLY_ACCOUNT_OWNER_MISMATCH',
        403
      );
    }
    const stored = await findStoredProviderMessage({ providerMessageId, accountEmail: account });
    if (
      !stored ||
      stored.providerOwner !== selectedOwner ||
      stored.providerAccountEmail !== account ||
      (normalizeText(providerThreadId) && stored.providerThreadId !== normalizeText(providerThreadId))
    ) {
      throw createInstantlyMailboxError(
        'Het Instantly-bericht hoort niet bij de geselecteerde mailbox.',
        'INSTANTLY_MESSAGE_OWNER_MISMATCH',
        403
      );
    }
    return stored;
  }

  function normalizeRecipientInput(value, label) {
    const addresses = extractAddressList(value);
    const supplied = Array.isArray(value)
      ? value.filter((item) => normalizeText(item)).length
      : normalizeText(value)
        ? String(value).split(/[,;]/).filter((item) => normalizeText(item)).length
        : 0;
    if (addresses.length !== supplied) {
      throw createInstantlyMailboxError(
        `Controleer de e-mailadressen bij ${label}.`,
        'INSTANTLY_RECIPIENT_INVALID',
        400
      );
    }
    return addresses;
  }

  async function reply({
    owner,
    accountEmail,
    providerMessageId,
    providerThreadId,
    subject,
    text,
    to,
    cc,
    bcc,
    attachments,
  } = {}) {
    const selectedOwner = assertOwner(owner);
    assertConfigured();
    if (Array.isArray(attachments) && attachments.length) {
      throw createInstantlyMailboxError(
        'Instantly ondersteunt via deze API geen bijlagen bij antwoorden; verwijder de bijlage of verstuur via de gewone mailbox.',
        'INSTANTLY_ATTACHMENTS_UNSUPPORTED',
        400
      );
    }
    const account = normalizeEmail(accountEmail);
    const stored = await assertStoredMessageOwnership({
      owner: selectedOwner,
      accountEmail: account,
      providerMessageId,
      providerThreadId,
    });
    const expectedRecipient = stored.folder === 'sent'
      ? extractAddress(stored.to)
      : normalizeEmail(stored.email);
    if (!expectedRecipient || normalizeEmail(to) !== expectedRecipient) {
      throw createInstantlyMailboxError(
        'De ontvanger wijkt af van de bewezen Instantly-thread.',
        'INSTANTLY_REPLY_RECIPIENT_MISMATCH',
        409
      );
    }
    const cleanSubject = normalizeText(subject).slice(0, 240);
    const cleanText = normalizeText(text);
    if (!cleanSubject || !cleanText) {
      throw createInstantlyMailboxError(
        'Onderwerp en bericht zijn verplicht.',
        'INSTANTLY_REPLY_CONTENT_REQUIRED',
        400
      );
    }
    const ccAddresses = normalizeRecipientInput(cc, 'CC');
    const bccAddresses = normalizeRecipientInput(bcc, 'BCC');
    const response = await apiRequest('emails/reply', {
      method: 'POST',
      body: {
        eaccount: account,
        reply_to_uuid: stored.providerMessageId,
        subject: cleanSubject,
        body: { text: cleanText },
        cc_address_email_list: ccAddresses.join(','),
        bcc_address_email_list: bccAddresses.join(','),
      },
    });
    const rawSent = response?.email || response?.data || response;
    const normalizedSent = normalizeInstantlyMessage({
      ...rawSent,
      eaccount: account,
      from_address_email: account,
      email_type: 'sent',
      in_reply_to: normalizeText(rawSent?.in_reply_to || stored.providerMessageId),
      thread_id: normalizeText(rawSent?.thread_id || stored.providerThreadId),
      campaign_id: normalizeText(rawSent?.campaign_id || stored.providerCampaignId),
    });
    if (normalizedSent) {
      const upsert = await mailboxIndexStore.upsertProviderMessages({
        provider: 'instantly',
        messages: [normalizedSent],
      });
      if (!upsert?.ok) {
        logger.error('[InstantlyMailbox][ReplyStore]', 'Verzonden antwoord kon niet lokaal worden opgeslagen.');
      }
    }
    return {
      provider: 'instantly',
      providerMessageId: normalizeText(normalizedSent?.providerMessageId || rawSent?.id),
      providerThreadId: normalizeText(normalizedSent?.providerThreadId || stored.providerThreadId),
      accountEmail: account,
      owner: selectedOwner,
      sentMessage: buildAcceptedSentMessage(normalizedSent, {
        body: cleanText,
        subject: cleanSubject,
        to: expectedRecipient,
        cc: ccAddresses.join(', '),
        bcc: bccAddresses.join(', '),
      }),
    };
  }

  async function ingestWebhook(req) {
    if (!normalizedConfig.enabled) return { ok: true, skipped: true, reason: 'disabled' };
    assertConfigured();
    const authorization = normalizeText(req?.headers?.authorization);
    const bearerSecret = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || '';
    const suppliedSecret = normalizeText(
      req?.headers?.['x-instantly-webhook-secret'] ||
      req?.headers?.['x-softora-webhook-secret'] ||
      req?.headers?.['x-webhook-secret'] ||
      req?.query?.secret ||
      bearerSecret
    );
    if (normalizedConfig.webhookSecret && suppliedSecret !== normalizedConfig.webhookSecret) {
      throw createInstantlyMailboxError(
        'Instantly webhook secret is ongeldig.',
        'INVALID_INSTANTLY_WEBHOOK_SECRET',
        403
      );
    }
    const body = req?.body && typeof req.body === 'object' ? req.body : {};
    const payload = body.data && typeof body.data === 'object' ? body.data : body;
    const eventType = normalizeText(payload.event_type).toLowerCase();
    if (!['reply_received', 'auto_reply_received', 'email_sent', 'email_replied'].includes(eventType)) {
      return { ok: true, skipped: true, reason: 'unsupported-event' };
    }
    const accountRecord = accountOwnership.get(normalizeEmail(payload.email_account));
    if (!accountRecord) {
      throw createInstantlyMailboxError(
        'Webhook-account heeft geen expliciete Servé/Martijn-koppeling.',
        'INSTANTLY_WEBHOOK_ACCOUNT_UNMAPPED',
        409
      );
    }
    const providerMessageId = normalizeText(payload.email_id);
    if (providerMessageId) {
      const rawMessage = await apiRequest(`emails/${encodeURIComponent(providerMessageId)}`);
      const normalizedMessage = normalizeInstantlyMessage(rawMessage?.email || rawMessage?.data || rawMessage);
      if (!normalizedMessage || normalizedMessage.providerOwner !== accountRecord.owner) {
        throw createInstantlyMailboxError(
          'Webhook-bericht kon niet aan het exacte Instantly-account worden gekoppeld.',
          'INSTANTLY_WEBHOOK_PROVENANCE_MISMATCH',
          409
        );
      }
      const upsert = await mailboxIndexStore.upsertProviderMessages({
        provider: 'instantly',
        messages: [normalizedMessage],
      });
      if (!upsert?.ok) {
        throw createInstantlyMailboxError(
          'Webhook-bericht kon niet duurzaam worden opgeslagen.',
          'INSTANTLY_WEBHOOK_STORE_FAILED',
          503
        );
      }
      const hydrated = normalizedMessage.providerThreadId
        ? await hydrateThread({
            threadId: normalizedMessage.providerThreadId,
            accountEmail: normalizedMessage.providerAccountEmail,
            owner: normalizedMessage.providerOwner,
          })
        : { stored: 0 };
      return { ok: true, stored: 1 + hydrated.stored, owner: accountRecord.owner };
    }
    const result = await syncOwner(accountRecord.owner);
    return { ok: true, stored: result.stored, owner: accountRecord.owner };
  }

  function getStatus() {
    const missing = getMissingConfig();
    return {
      enabled: normalizedConfig.enabled,
      configured: normalizedConfig.enabled && missing.length === 0,
      missing,
      owners: {
        serve: getConfiguredAccounts('serve').map((account) => account.email),
        martijn: getConfiguredAccounts('martijn').map((account) => account.email),
      },
      attachmentsOnReplySupported: false,
    };
  }

  return {
    assertStoredMessageOwnership,
    getConfiguredAccounts,
    getStatus,
    ingestWebhook,
    hydrateThread,
    isConfigured,
    listOwnerConversations,
    normalizeInstantlyMessage,
    reply,
    resolveAccountRecord,
    syncOwner,
  };
}

module.exports = {
  DEFAULT_API_BASE_URL,
  INSTANTLY_MAILBOX_SYNC_SCOPE,
  createInstantlyMailboxError,
  createInstantlyMailboxService,
  extractAddressList,
  normalizeAccountOwnership,
  normalizeCampaignOwnership,
  normalizeOwner,
};
