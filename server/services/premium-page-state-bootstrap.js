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
  'premium-wachtwoordenregister.html': Object.freeze(['premium_password_register']),
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
  return {
    values,
    source: String(result && result.source || '').trim() || 'bootstrap',
    updatedAt: result && result.updatedAt ? result.updatedAt : null,
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
      const entry = [normalizedScope, sanitizeStateSnapshot(result)];
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
      const result = await mailboxCoordinator.listCampaignReplies({ limit: 100 });
      const snapshot = {
        ok: result && result.ok !== false,
        messages: Array.isArray(result && result.messages) ? result.messages : [],
        sync: result && result.sync && typeof result.sync === 'object' ? result.sync : null,
      };
      mailboxCache = { snapshot, cachedAt: Date.now() };
      return snapshot;
    } catch (_error) {
      return mailboxCache ? mailboxCache.snapshot : null;
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

  async function readMailboxSnapshot(fileName) {
    if (normalizeFileName(fileName) !== 'premium-mailbox.html') return null;
    const cacheAgeMs = mailboxCache ? Math.max(0, Date.now() - mailboxCache.cachedAt) : Infinity;
    if (mailboxCache && cacheAgeMs <= Math.max(0, Number(freshCacheMs) || 0)) {
      return mailboxCache.snapshot;
    }
    if (mailboxCache && cacheAgeMs <= Math.max(0, Number(staleCacheMs) || 0)) {
      void refreshMailboxSnapshot();
      return mailboxCache.snapshot;
    }
    return refreshMailboxSnapshot();
  }

  async function buildPageStateBootstrapPayload(fileName, options = {}) {
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
