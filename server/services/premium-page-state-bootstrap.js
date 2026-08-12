const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  parseMailboxCampaignSnapshot,
  serializeMailboxCampaignSnapshot,
} = require('./mailbox-campaign-snapshot');

const PAGE_STATE_SCOPES = Object.freeze({
  'live-momentum.html': Object.freeze(['premium_live_momentum']),
  'premium-actieve-opdrachten.html': Object.freeze(['premium_assignment_filters']),
  'premium-advertenties.html': Object.freeze(['premium_advertenties_content_lock']),
  'premium-boekhouding.html': Object.freeze(['premium_bookkeeping']),
  'premium-bevestigingsmails.html': Object.freeze([
    'premium_coldmailing_settings',
    'premium_ai_lead_generator_settings',
  ]),
  'premium-kladblok.html': Object.freeze(['premium_notepad']),
  'premium-mailbox.html': Object.freeze([
    'premium_mailbox_preferences',
    'premium_coldmailing_settings',
  ]),
  'premium-database.html': Object.freeze(['premium_database_mail_roi']),
  'premium-opdracht-dossier.html': Object.freeze(['premium_active_orders']),
  'premium-opdracht-preview.html': Object.freeze(['premium_active_orders']),
  'premium-personeel-dashboard.html': Object.freeze(['premium_dashboard_ai_management']),
  'premium-socialmedia.html': Object.freeze(['premium_socialmedia_content_lock']),
  'premium-seo-crm-system.html': Object.freeze(['premium_seo_crm']),
  'premium-vaste-lasten.html': Object.freeze(['premium_monthly_costs']),
  'premium-word.html': Object.freeze(['premium_word']),
  'sportschool.html': Object.freeze(['sportschool_logboek']),
});

function normalizeFileName(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeScope(value) {
  return String(value || '').trim();
}

function sanitizeStateSnapshot(result) {
  const values = result && result.values && typeof result.values === 'object'
    ? result.values
    : {};
  const source = String(result && result.source || '').trim() || 'bootstrap';
  return {
    ok: result?.ok !== false && source.toLowerCase() === 'supabase',
    values,
    source,
    updatedAt: result && result.updatedAt ? result.updatedAt : null,
    ...(Number.isSafeInteger(Number(result && result.revision))
      ? { revision: Number(result.revision) }
      : {}),
  };
}

function sanitizeSessionSnapshot(session) {
  if (!session || !session.authenticated) return null;
  return {
    authenticated: true,
    email: String(session.email || '').trim().toLowerCase(),
    userId: String(session.userId || '').trim(),
    role: String(session.role || '').trim().toLowerCase(),
    firstName: String(session.firstName || '').trim(),
    lastName: String(session.lastName || '').trim(),
    displayName: String(session.displayName || '').trim(),
    avatarDataUrl: String(session.avatarDataUrl || '').trim(),
    canManageUsers: Boolean(session.canManageUsers || session.isAdmin),
    expiresAt: session.expiresAt || null,
  };
}

function createPremiumPageStateBootstrapService(deps = {}) {
  const {
    getUiStateValues = async () => ({ values: {}, source: 'unavailable' }),
    mailboxCoordinator = null,
    now = () => new Date(),
    readTimeoutMs = 1200,
    freshCacheMs = 15_000,
    staleCacheMs = 6 * 60 * 60 * 1000,
  } = deps;
  const scopeCache = new Map();
  let mailboxCache = null;
  let mailboxRefreshPromise = null;

  function getScopesForPage(fileName) {
    return PAGE_STATE_SCOPES[normalizeFileName(fileName)] || [];
  }

  async function fetchScope(scope) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) return null;
    try {
      const result = await getUiStateValues(normalizedScope, {
        uiStateReadTimeoutMs: Math.max(100, Math.min(1800, Number(readTimeoutMs) || 1200)),
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      });
      // Een time-out of mislukte Supabase-read mag nooit als een vers, leeg
      // bootstrap-snapshot in de browsercache belanden. De client zou die
      // placeholder anders 15 seconden hergebruiken voordat hij opnieuw leest.
      if (!result || typeof result !== 'object') return null;
      const snapshot = sanitizeStateSnapshot(result);
      if (normalizedScope === 'premium_live_momentum' && !snapshot.ok) return null;
      const entry = [normalizedScope, snapshot];
      scopeCache.set(normalizedScope, { entry, cachedAt: Date.now() });
      return entry;
    } catch (_error) {
      return null;
    }
  }

  async function readScope(scope) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) return null;
    const cached = scopeCache.get(normalizedScope);
    const cacheAgeMs = cached ? Math.max(0, Date.now() - cached.cachedAt) : Infinity;
    if (cached && cacheAgeMs <= Math.max(0, Number(freshCacheMs) || 0)) {
      return cached.entry;
    }
    if (cached && cacheAgeMs <= Math.max(0, Number(staleCacheMs) || 0)) {
      void fetchScope(normalizedScope);
      return cached.entry;
    }
    return fetchScope(normalizedScope);
  }

  async function fetchMailboxSnapshot() {
    if (!mailboxCoordinator || typeof mailboxCoordinator.listCampaignReplies !== 'function') {
      return null;
    }
    try {
      const result = await mailboxCoordinator.listCampaignReplies({
        limit: 200,
        includeSnapshotMessages: true,
        hydrateBodies: false,
      });
      const snapshot = {
        ok: result && result.ok !== false,
        messages: Array.isArray(result && result.snapshotMessages)
          ? result.snapshotMessages
          : Array.isArray(result && result.messages) ? result.messages : [],
        sync: result && result.sync && typeof result.sync === 'object' ? result.sync : null,
      };
      const compactSnapshot = snapshot.messages.length
        ? parseMailboxCampaignSnapshot(serializeMailboxCampaignSnapshot(snapshot))
        : snapshot;
      mailboxCache = { snapshot: compactSnapshot, cachedAt: Date.now() };
      return compactSnapshot;
    } catch (_error) {
      return mailboxCache ? mailboxCache.snapshot : null;
    }
  }

  async function readPersistedMailboxSnapshot() {
    try {
      const result = await getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, {
        uiStateReadTimeoutMs: Math.max(100, Math.min(1000, Number(readTimeoutMs) || 1000)),
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      });
      const snapshot = parseMailboxCampaignSnapshot(
        result && result.values && result.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
      );
      if (!snapshot) return null;
      mailboxCache = { snapshot, cachedAt: Date.now() };
      return snapshot;
    } catch (_error) {
      return null;
    }
  }

  function refreshMailboxSnapshot() {
    if (!mailboxRefreshPromise) {
      mailboxRefreshPromise = fetchMailboxSnapshot().finally(() => {
        mailboxRefreshPromise = null;
      });
    }
    return mailboxRefreshPromise;
  }

  function getMailboxSnapshotSavedAtMs(snapshot) {
    const savedAtMs = Date.parse(String(snapshot && snapshot.savedAt || ''));
    return Number.isFinite(savedAtMs) ? savedAtMs : 0;
  }

  function shouldPreferPersistedMailboxSnapshot(persistedSnapshot, cachedSnapshot) {
    if (!persistedSnapshot) return false;
    if (!cachedSnapshot) return true;
    const persistedSavedAtMs = getMailboxSnapshotSavedAtMs(persistedSnapshot);
    const cachedSavedAtMs = getMailboxSnapshotSavedAtMs(cachedSnapshot);
    if (!persistedSavedAtMs && cachedSavedAtMs) return false;
    if (persistedSavedAtMs && cachedSavedAtMs) return persistedSavedAtMs >= cachedSavedAtMs;
    return true;
  }

  function getMailboxMessageIdentityKey(message) {
    const source = message && typeof message === 'object' ? message : {};
    const accountEmail = String(source.accountEmail || '').trim().toLowerCase();
    const folder = String(source.storageFolder || source.folder || 'inbox').trim().toLowerCase();
    const uid = Number(source.storageUid || source.uid) || 0;
    if (!accountEmail || !folder) return '';
    if (uid > 0) return `${accountEmail}|${folder}|uid:${uid}`;
    const id = String(source.mailboxId || source.id || source.providerMessageId || '').trim();
    return id ? `${accountEmail}|${folder}|id:${id}` : '';
  }

  function getLatestMailboxStateTimestamp(first, second) {
    const candidates = [first, second]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .sort((left, right) => (Date.parse(left) || 0) - (Date.parse(right) || 0));
    return candidates.at(-1) || '';
  }

  function reconcileMailboxSnapshotReadState(baseSnapshot, durableSnapshot) {
    if (!baseSnapshot || !durableSnapshot) return baseSnapshot;
    const durableStates = new Map();
    const remember = (message) => {
      const key = getMailboxMessageIdentityKey(message);
      const readAt = String(message && message.readAt || '').trim();
      const replyDismissedAt = String(message && message.replyDismissedAt || '').trim();
      if (key && (readAt || replyDismissedAt)) {
        const current = durableStates.get(key) || {};
        durableStates.set(key, {
          unread: false,
          readAt: getLatestMailboxStateTimestamp(current.readAt, readAt),
          replyDismissedAt: getLatestMailboxStateTimestamp(
            current.replyDismissedAt,
            replyDismissedAt
          ),
        });
      }
      (Array.isArray(message && message.threadMessages) ? message.threadMessages : []).forEach(remember);
    };
    (Array.isArray(durableSnapshot.messages) ? durableSnapshot.messages : []).forEach(remember);
    if (!durableStates.size) return baseSnapshot;
    const apply = (message) => {
      const state = durableStates.get(getMailboxMessageIdentityKey(message));
      const threadMessages = (Array.isArray(message && message.threadMessages)
        ? message.threadMessages
        : []).map(apply);
      if (!state) return { ...message, threadMessages };
      return {
        ...message,
        unread: false,
        readAt: getLatestMailboxStateTimestamp(message.readAt, state.readAt),
        replyDismissedAt: getLatestMailboxStateTimestamp(
          message.replyDismissedAt,
          state.replyDismissedAt
        ),
        threadMessages,
      };
    };
    return {
      ...baseSnapshot,
      messages: (Array.isArray(baseSnapshot.messages) ? baseSnapshot.messages : []).map(apply),
    };
  }

  async function readMailboxSnapshot(fileName) {
    if (normalizeFileName(fileName) !== 'premium-mailbox.html') return null;
    const cachedEntry = mailboxCache;
    const cacheAgeMs = cachedEntry ? Math.max(0, Date.now() - cachedEntry.cachedAt) : Infinity;
    const persistedSnapshot = await readPersistedMailboxSnapshot();
    if (persistedSnapshot && cachedEntry?.snapshot) {
      const preferPersisted = shouldPreferPersistedMailboxSnapshot(
        persistedSnapshot,
        cachedEntry.snapshot
      );
      const baseSnapshot = preferPersisted ? persistedSnapshot : cachedEntry.snapshot;
      const durableSnapshot = preferPersisted ? cachedEntry.snapshot : persistedSnapshot;
      const reconciledSnapshot = reconcileMailboxSnapshotReadState(
        baseSnapshot,
        durableSnapshot
      );
      mailboxCache = {
        snapshot: reconciledSnapshot,
        cachedAt: preferPersisted ? Date.now() : cachedEntry.cachedAt,
      };
      if (cacheAgeMs > Math.max(0, Number(freshCacheMs) || 0)) {
        void refreshMailboxSnapshot();
      }
      return reconciledSnapshot;
    }
    if (shouldPreferPersistedMailboxSnapshot(persistedSnapshot, cachedEntry?.snapshot)) {
      if (!cachedEntry || cacheAgeMs > Math.max(0, Number(freshCacheMs) || 0)) {
        void refreshMailboxSnapshot();
      }
      return persistedSnapshot;
    }
    if (cachedEntry && cacheAgeMs <= Math.max(0, Number(staleCacheMs) || 0)) {
      mailboxCache = cachedEntry;
      if (cacheAgeMs > Math.max(0, Number(freshCacheMs) || 0)) {
        void refreshMailboxSnapshot();
      }
      return cachedEntry.snapshot;
    }
    if (persistedSnapshot) {
      void refreshMailboxSnapshot();
      return persistedSnapshot;
    }
    return refreshMailboxSnapshot();
  }

  async function buildPageStateBootstrapPayload(fileName, options = {}) {
    if (normalizeFileName(fileName) === 'premium-wachtwoordenregister.html') return null;
    const scopes = getScopesForPage(fileName);
    const session = sanitizeSessionSnapshot(options.session);
    if (!scopes.length && !session) return null;

    const [entries, mailbox] = await Promise.all([
      Promise.all(scopes.map(readScope)).then((results) => results.filter(Boolean)),
      readMailboxSnapshot(fileName),
    ]);
    return {
      ok: entries.length > 0 || Boolean(mailbox && mailbox.ok) || Boolean(session),
      loadedAt: now().toISOString(),
      page: normalizeFileName(fileName),
      scopes: Object.fromEntries(entries),
      ...(mailbox ? { mailbox } : {}),
      ...(session ? { session } : {}),
    };
  }

  return {
    buildPageStateBootstrapPayload,
    getScopesForPage,
  };
}

module.exports = {
  PAGE_STATE_SCOPES,
  createPremiumPageStateBootstrapService,
};
