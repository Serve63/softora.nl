const {
  MAILBOX_CAMPAIGN_SNAPSHOT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY,
  MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE,
  MAILBOX_CAMPAIGN_SNAPSHOT_FRESH_MS,
  MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
  MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE,
  getMailboxCampaignSnapshotAgeMs,
  isMailboxCampaignSnapshotInvalidated,
  markMailboxCampaignSnapshotStale,
  parseMailboxCampaignSnapshot,
  parseMailboxCampaignSnapshotInvalidatedAt,
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
    mailboxFreshMs = MAILBOX_CAMPAIGN_SNAPSHOT_FRESH_MS,
    mailboxMaxStaleMs = MAILBOX_CAMPAIGN_SNAPSHOT_MAX_STALE_MS,
    mailboxRefreshWaitMs = 1200,
  } = deps;
  const scopeCache = new Map();
  let mailboxCache = null;
  let mailboxRefreshPromise = null;

  function getNow() {
    const value = now();
    return value instanceof Date ? value : new Date(value);
  }

  function getUsableMailboxSnapshot(snapshot, staleReason = 'snapshot_stale') {
    if (!snapshot) return null;
    const ageMs = getMailboxCampaignSnapshotAgeMs(snapshot, getNow());
    if (ageMs > Math.max(0, Number(mailboxMaxStaleMs) || 0)) return null;
    return markMailboxCampaignSnapshotStale(
      snapshot,
      ageMs > Math.max(0, Number(mailboxFreshMs) || 0) ? staleReason : 'bootstrap_unconfirmed'
    );
  }

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
      const snapshotAt = result && (result.contentAt || result.savedAt) || getNow().toISOString();
      const snapshot = {
        ok: result && result.ok !== false,
        savedAt: result && result.savedAt || snapshotAt,
        contentAt: result && result.contentAt || snapshotAt,
        messages: Array.isArray(result && result.snapshotMessages)
          ? result.snapshotMessages
          : Array.isArray(result && result.messages) ? result.messages : [],
        sync: result && result.sync && typeof result.sync === 'object' ? result.sync : null,
      };
      const compactSnapshot = snapshot.messages.length
        ? parseMailboxCampaignSnapshot(serializeMailboxCampaignSnapshot(snapshot, {
            savedAt: snapshot.savedAt,
            contentAt: snapshot.contentAt,
          }))
        : snapshot;
      mailboxCache = { snapshot: compactSnapshot, cachedAt: Date.now() };
      return getUsableMailboxSnapshot(compactSnapshot, 'bootstrap_unconfirmed');
    } catch (_error) {
      return getUsableMailboxSnapshot(mailboxCache && mailboxCache.snapshot, 'refresh_failed');
    }
  }

  async function readPersistedMailboxSnapshot() {
    try {
      const readOptions = {
        uiStateReadTimeoutMs: Math.max(100, Math.min(1000, Number(readTimeoutMs) || 1000)),
        bypassReadFailureCooldown: true,
        suppressReadFailureCooldown: true,
        suppressReadFailureLog: true,
        preferSupabaseRestRead: true,
        ignoreSupabaseRestFailureCooldown: true,
        suppressSupabaseRestFailureCooldown: true,
      };
      const [result, invalidationResult] = await Promise.all([
        getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_SCOPE, readOptions),
        getUiStateValues(MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATION_SCOPE, readOptions),
      ]);
      if (!result || !result.values || !invalidationResult || !invalidationResult.values) return null;
      const snapshot = parseMailboxCampaignSnapshot(
        result && result.values && result.values[MAILBOX_CAMPAIGN_SNAPSHOT_KEY]
      );
      const invalidatedAt = parseMailboxCampaignSnapshotInvalidatedAt(
        invalidationResult && invalidationResult.values &&
        invalidationResult.values[MAILBOX_CAMPAIGN_SNAPSHOT_INVALIDATED_AT_KEY]
      );
      if (isMailboxCampaignSnapshotInvalidated(snapshot, invalidatedAt)) return null;
      const usableSnapshot = getUsableMailboxSnapshot(snapshot);
      if (!usableSnapshot) return null;
      mailboxCache = { snapshot: usableSnapshot, cachedAt: Date.now() };
      return usableSnapshot;
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

  async function waitForMailboxRefresh(fallback = null) {
    const waitMs = Math.max(0, Math.min(2500, Number(mailboxRefreshWaitMs) || 0));
    if (!waitMs) return refreshMailboxSnapshot();
    let timeoutId = null;
    try {
      const refreshed = await Promise.race([
        refreshMailboxSnapshot(),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve(null), waitMs);
        }),
      ]);
      return refreshed || fallback;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function readMailboxSnapshot(fileName) {
    if (normalizeFileName(fileName) !== 'premium-mailbox.html') return null;
    const cacheAgeMs = mailboxCache ? Math.max(0, Date.now() - mailboxCache.cachedAt) : Infinity;
    if (mailboxCache && cacheAgeMs <= Math.max(0, Number(freshCacheMs) || 0)) {
      return getUsableMailboxSnapshot(mailboxCache.snapshot);
    }
    if (mailboxCache && cacheAgeMs <= Math.max(0, Number(staleCacheMs) || 0)) {
      const cachedSnapshot = getUsableMailboxSnapshot(mailboxCache.snapshot);
      if (cachedSnapshot) return waitForMailboxRefresh(cachedSnapshot);
    }
    const persistedSnapshot = await readPersistedMailboxSnapshot();
    if (persistedSnapshot) {
      return waitForMailboxRefresh(persistedSnapshot);
    }
    return waitForMailboxRefresh(null);
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
