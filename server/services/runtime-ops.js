const { createAdminOnlyUiStateScopesSet } = require('../config/admin-ui-state-scopes');
const {
  createPasswordRegisterOwnerPolicy,
  isPasswordRegisterScope,
} = require('../security/password-register-access');
const {
  isExactLegacyPasswordRegisterWrite,
  validatePasswordRegisterValues,
} = require('../schemas/password-register-vault');

const PREMIUM_WORD_SCOPE = 'premium_word';
const PREMIUM_WORD_HTML_KEY = 'softora_premium_word_html_v1';
const PREMIUM_WORD_BACKUPS_KEY = 'softora_premium_word_html_backups_v1';
const PREMIUM_WORD_BACKUP_LIMIT = 8;
const PREMIUM_WORD_BACKUPS_MAX_LENGTH = 180000;
const SPORTSCHOOL_LOGBOOK_SCOPE = 'sportschool_logboek';
const SPORTSCHOOL_LOGBOOK_KEY = 'sportschool_logboek_v1';
const SPORTSCHOOL_LOGBOOK_MAX_LENGTH = 180000;

function normalizeDashboardCustomerAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
}

function projectDashboardCustomer(raw, index, normalizeString) {
  const customer = raw && typeof raw === 'object' ? raw : {};
  const clean = (value, maxLength) => normalizeString(value).slice(0, maxLength);
  const rawType = clean(customer.type, 80);
  const type = rawType === 'Onderhoud' || rawType === 'Website + onderhoud' ? rawType : 'Website';
  const legacyAmount = normalizeDashboardCustomerAmount(customer.bedrag);
  const websiteAmount = normalizeDashboardCustomerAmount(customer.websiteBedrag);
  const maintenanceAmount = normalizeDashboardCustomerAmount(customer.onderhoudPerMaand);
  const websiteBedrag = websiteAmount !== null
    ? websiteAmount
    : type === 'Website' || type === 'Website + onderhoud'
      ? legacyAmount
      : null;
  const onderhoudPerMaand = maintenanceAmount !== null
    ? maintenanceAmount
    : type === 'Onderhoud'
      ? legacyAmount
      : null;
  return {
    id: clean(customer.id, 160) || `dashboard-customer-${index}`,
    naam: clean(customer.naam, 180),
    bedrijf: clean(customer.bedrijf, 180),
    type,
    websiteBedrag,
    onderhoudPerMaand,
    bedrag: legacyAmount !== null ? legacyAmount : websiteBedrag ?? onderhoudPerMaand ?? 0,
    status: clean(customer.status, 40),
    databaseStatus: clean(customer.databaseStatus, 40),
    datum: clean(customer.datum, 40),
  };
}

function normalizeSportschoolLogbookSnapshot(rawSnapshot) {
  let snapshot = rawSnapshot;
  if (typeof snapshot === 'string') {
    try {
      snapshot = JSON.parse(snapshot);
    } catch (_error) {
      return null;
    }
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  if (!snapshot.days || typeof snapshot.days !== 'object' || Array.isArray(snapshot.days)) return null;

  const serialized = JSON.stringify(snapshot);
  if (serialized.length > SPORTSCHOOL_LOGBOOK_MAX_LENGTH) return null;
  return serialized;
}

function extractSportschoolLogbookSnapshot(body = {}) {
  if (Object.prototype.hasOwnProperty.call(body, 'snapshot')) return body.snapshot;
  if (Object.prototype.hasOwnProperty.call(body, 'snapshotJson')) return body.snapshotJson;
  if (
    body.patch &&
    typeof body.patch === 'object' &&
    Object.prototype.hasOwnProperty.call(body.patch, SPORTSCHOOL_LOGBOOK_KEY)
  ) {
    return body.patch[SPORTSCHOOL_LOGBOOK_KEY];
  }
  if (
    body.values &&
    typeof body.values === 'object' &&
    Object.prototype.hasOwnProperty.call(body.values, SPORTSCHOOL_LOGBOOK_KEY)
  ) {
    return body.values[SPORTSCHOOL_LOGBOOK_KEY];
  }
  return null;
}

function parsePremiumWordBackups(value) {
  let raw = value;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch (_error) {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const html = String(item.html || '');
      if (!html.trim()) return null;
      return {
        html,
        savedAt: String(item.savedAt || ''),
        source: String(item.source || ''),
        actor: String(item.actor || ''),
      };
    })
    .filter(Boolean);
}

function serializePremiumWordBackups(backups) {
  const safeBackups = backups
    .filter((backup) => backup && String(backup.html || '').trim())
    .slice(0, PREMIUM_WORD_BACKUP_LIMIT)
    .map((backup) => ({
      html: String(backup.html || ''),
      savedAt: String(backup.savedAt || ''),
      source: String(backup.source || ''),
      actor: String(backup.actor || ''),
    }));

  let serialized = JSON.stringify(safeBackups);
  while (serialized.length > PREMIUM_WORD_BACKUPS_MAX_LENGTH && safeBackups.length > 1) {
    safeBackups.pop();
    serialized = JSON.stringify(safeBackups);
  }
  if (serialized.length > PREMIUM_WORD_BACKUPS_MAX_LENGTH && safeBackups.length === 1) {
    safeBackups[0].html = safeBackups[0].html.slice(0, PREMIUM_WORD_BACKUPS_MAX_LENGTH - 500);
    serialized = JSON.stringify(safeBackups);
  }
  return serialized.length <= PREMIUM_WORD_BACKUPS_MAX_LENGTH ? serialized : '[]';
}

function buildPremiumWordBackupsValue(existingBackupsValue, previousHtml, meta = {}) {
  const html = String(previousHtml || '');
  if (!html.trim()) return '';
  const previousBackup = {
    html,
    savedAt: String(meta.savedAt || new Date().toISOString()),
    source: String(meta.source || 'frontend'),
    actor: String(meta.actor || ''),
  };
  const existingBackups = parsePremiumWordBackups(existingBackupsValue)
    .filter((backup) => backup.html !== html);
  return serializePremiumWordBackups([previousBackup, ...existingBackups]);
}

function createRuntimeOpsCoordinator(deps = {}) {
  const {
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    recentDashboardActivities = [],
    recentSecurityAuditEvents = [],
    normalizeString = (value) => String(value || '').trim(),
    appendDashboardActivity = () => ({}),
    normalizeUiStateScope = () => '',
    getUiStateValues = async () => null,
    sanitizeUiStateValues = (value) => value || {},
    setUiStateValues = async () => null,
    compareAndSwapUiStateValues = async () => ({ ok: false, unavailable: true }),
    dataOpsUiStateBridge = null,
    dataOpsStore = null,
    sportschoolLogbookStore = null,
    dataOpsUiStateReadTimeoutMs = 2500,
    dataOpsUiStateReadTimeoutMsByScope = {},
    uiStateReadTimeoutMs = 4500,
    adminOnlyUiStateScopes = createAdminOnlyUiStateScopesSet(),
    passwordRegisterOwnerPolicy = createPasswordRegisterOwnerPolicy(),
    appendSecurityAuditEvent = () => {},
    logger = console,
  } = deps;
  let sportschoolLogbookWriteQueue = Promise.resolve();

  function normalizeListLimit(value, fallback = 100) {
    return Math.max(1, Math.min(500, parseIntSafe(value, fallback)));
  }

  function sendDashboardActivityResponse(req, res) {
    const limit = normalizeListLimit(req.query.limit, 100);
    return res.status(200).json({
      ok: true,
      count: Math.min(limit, recentDashboardActivities.length),
      activities: recentDashboardActivities.slice(0, limit),
    });
  }

  function sendSecurityAuditLogResponse(req, res) {
    const limit = normalizeListLimit(req.query.limit, 100);
    return res.status(200).json({
      ok: true,
      count: Math.min(limit, recentSecurityAuditEvents.length),
      events: recentSecurityAuditEvents.slice(0, limit),
    });
  }

  async function sendDashboardCustomersResponse(_req, res) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store, private');
    }
    if (!dataOpsStore || typeof dataOpsStore.listDashboardCustomers !== 'function') {
      return res.status(503).json({
        ok: false,
        error: 'Kon formele dashboardklanten niet laden.',
      });
    }

    try {
      const customers = await awaitWithTimeout(
        dataOpsStore.listDashboardCustomers({
          bypassReadFailureCooldown: true,
          suppressReadFailureCooldown: true,
          suppressTransientReadFailureLog: true,
          maxRows: 5000,
        }),
        1800,
        'Dashboardklanten read timeout na 2s'
      );
      if (!Array.isArray(customers)) {
        return res.status(503).json({
          ok: false,
          error: 'Kon formele dashboardklanten niet laden.',
        });
      }

      const dashboardCustomers = customers.map((customer, index) =>
        projectDashboardCustomer(customer, index, normalizeString)
      );
      return res.status(200).json({
        ok: true,
        loadedAt: new Date().toISOString(),
        source: 'dashboard-customers',
        customers: dashboardCustomers,
      });
    } catch (error) {
      const log = logger && (typeof logger.warn === 'function' ? logger.warn : logger.error);
      if (typeof log === 'function') {
        log.call(logger, '[RuntimeOps][dashboard-customers]', error?.message || error);
      }
      return res.status(503).json({
        ok: false,
        error: 'Kon formele dashboardklanten niet laden.',
      });
    }
  }

  function requiresAdminUiStateAccess(scope) {
    return adminOnlyUiStateScopes.has(scope);
  }

  function hasAdminUiStateAccess(req, scope) {
    if (!requiresAdminUiStateAccess(scope)) return true;
    return Boolean(req?.premiumAuth?.authenticated && req?.premiumAuth?.isAdmin);
  }

  function appendPasswordRegisterAuditEvent(req, payload, reason) {
    appendSecurityAuditEvent(
      {
        type: payload.type,
        severity: payload.success ? 'info' : 'warning',
        success: Boolean(payload.success),
        email: String(req?.premiumAuth?.email || '').trim(),
        ip: String(req?.ip || req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim(),
        path: String(req?.originalUrl || req?.url || '').trim(),
        origin: String(req?.headers?.origin || '').trim(),
        userAgent: typeof req?.get === 'function' ? req.get('user-agent') : '',
        detail: String(payload.detail || '').trim(),
      },
      reason
    );
  }

  function getPasswordRegisterOwnerDecision(req, scope) {
    if (!isPasswordRegisterScope(scope)) return { ok: true };
    return passwordRegisterOwnerPolicy.getAccessDecision(req?.premiumAuth || null);
  }

  function sendPasswordRegisterOwnerDenied(req, res, decision) {
    appendPasswordRegisterAuditEvent(
      req,
      {
        type: 'password_register_owner_denied',
        success: false,
        detail: decision.statusCode === 503
          ? 'Wachtwoordenregister geweigerd omdat eigenaarstoegang niet geconfigureerd is.'
          : 'Wachtwoordenregister geweigerd voor niet-eigenaar.',
      },
      'security_password_register_owner_denied'
    );
    return res.status(decision.statusCode).json({
      ok: false,
      code: decision.code,
      error: decision.error,
    });
  }

  function sendPasswordRegisterVaultInvalid(req, res, statusCode, detail) {
    appendPasswordRegisterAuditEvent(
      req,
      {
        type: 'password_register_vault_rejected',
        success: false,
        detail,
      },
      'security_password_register_vault_rejected'
    );
    return res.status(statusCode).json({
      ok: false,
      code: 'PASSWORD_REGISTER_VAULT_INVALID',
      error: 'Versleutelde wachtwoordenkluis heeft een ongeldig of onveilig formaat.',
    });
  }

  function logDataOpsReadFallback(scope, error) {
    const message = error?.message || String(error || 'onbekende fout');
    const log = logger && (typeof logger.warn === 'function' ? logger.warn : logger.error);
    if (typeof log === 'function') {
      log.call(logger, '[DataOps][ui-state-read-fallback]', JSON.stringify({ scope, message }));
    }
  }

  function logUiStateReadFallback(scope, error) {
    const message = error?.message || String(error || 'onbekende fout');
    const log = logger && (typeof logger.warn === 'function' ? logger.warn : logger.error);
    if (typeof log === 'function') {
      log.call(logger, '[RuntimeOps][ui-state-read-fallback]', JSON.stringify({ scope, message }));
    }
  }

  function isTransientUiStateReadError(error) {
    const text = normalizeString(error && (error.message || error.details || error.hint || error.code || error));
    return /abort|timeout|timed out|statement timeout|504|522|fetch failed|network|econnreset|etimedout|connection terminated|temporar/i.test(text);
  }

  async function awaitWithTimeout(promise, timeoutMs, errorMessage) {
    const safeTimeoutMs = Math.max(1, Math.min(30000, Number(timeoutMs) || 2500));
    let timeoutId = null;
    try {
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error(errorMessage || `Timeout na ${Math.round(safeTimeoutMs / 1000)}s`));
          }, safeTimeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function getDataOpsUiStateReadTimeoutMs(scope) {
    if (
      dataOpsUiStateReadTimeoutMsByScope &&
      Object.prototype.hasOwnProperty.call(dataOpsUiStateReadTimeoutMsByScope, scope)
    ) {
      return dataOpsUiStateReadTimeoutMsByScope[scope];
    }
    if (scope === 'premium_database_photos') return Math.max(Number(dataOpsUiStateReadTimeoutMs) || 0, 12000);
    if (scope === 'premium_coldmail_send_guard') return Math.max(Number(dataOpsUiStateReadTimeoutMs) || 0, 12000);
    if (scope === 'premium_customers_database') return Math.max(Number(dataOpsUiStateReadTimeoutMs) || 0, 12000);
    return dataOpsUiStateReadTimeoutMs;
  }

  function appendAdminScopeDeniedAuditEvent(req, scope) {
    appendSecurityAuditEvent(
      {
        type: 'admin_ui_state_scope_denied',
        severity: 'warning',
        success: false,
        email: String(req?.premiumAuth?.email || '').trim(),
        ip: String(req?.ip || req?.headers?.['x-forwarded-for'] || '').trim(),
        path: String(req?.originalUrl || req?.url || '').trim(),
        origin: String(req?.headers?.origin || '').trim(),
        userAgent: typeof req?.get === 'function' ? req.get('user-agent') : '',
        detail: `Admin-only UI state scope geweigerd: ${scope}`,
      },
      'security_admin_ui_state_scope_denied'
    );
  }

  async function getUiStateValuesForScope(scope) {
    if (
      dataOpsUiStateBridge &&
      typeof dataOpsUiStateBridge.canHandleScope === 'function' &&
      dataOpsUiStateBridge.canHandleScope(scope) &&
      typeof dataOpsUiStateBridge.getUiStateValues === 'function'
    ) {
      try {
        const bridgedTimeoutMs = getDataOpsUiStateReadTimeoutMs(scope);
        const bridged = await awaitWithTimeout(
          dataOpsUiStateBridge.getUiStateValues(scope, {
            legacyGetUiStateValues: getUiStateValues,
          }),
          bridgedTimeoutMs,
          `DataOps UI-state read timeout na ${Math.round(Math.max(1, Number(bridgedTimeoutMs) || 2500) / 1000)}s`
        );
        if (bridged) return bridged;
      } catch (error) {
        logDataOpsReadFallback(scope, error);
      }
    }
    try {
      return await awaitWithTimeout(
        getUiStateValues(scope),
        uiStateReadTimeoutMs,
        `UI-state read timeout na ${Math.round(Math.max(1, Number(uiStateReadTimeoutMs) || 4500) / 1000)}s`
      );
    } catch (error) {
      logUiStateReadFallback(scope, error);
      return null;
    }
  }

  async function mirrorUiStateValuesToDataOps(scope, values, meta) {
    if (
      !dataOpsUiStateBridge ||
      typeof dataOpsUiStateBridge.canHandleScope !== 'function' ||
      !dataOpsUiStateBridge.canHandleScope(scope) ||
      typeof dataOpsUiStateBridge.setUiStateValues !== 'function'
    ) {
      return null;
    }
    return dataOpsUiStateBridge.setUiStateValues(scope, values, meta);
  }

  function sendUiStateSetSuccessResponse(res, scope, state, fallbackValues = {}) {
    const savedState = state && typeof state === 'object' ? state : {};
    return res.status(200).json({
      ok: true,
      scope,
      values: savedState.values || fallbackValues || {},
      source: savedState.source || 'supabase',
      updatedAt: savedState.updatedAt || null,
      ...(Number.isSafeInteger(Number(savedState.revision))
        ? { revision: Number(savedState.revision) }
        : {}),
    });
  }

  async function getAuthoritativePasswordRegisterState(scope) {
    try {
      const state = await awaitWithTimeout(
        getUiStateValues(scope, {
          includeRevision: true,
          preferSupabaseRestRead: true,
          bypassReadFailureCooldown: true,
          suppressReadFailureCooldown: true,
          suppressReadFailureLog: true,
          ignoreSupabaseRestFailureCooldown: true,
          suppressSupabaseRestFailureCooldown: true,
        }),
        uiStateReadTimeoutMs,
        'Wachtwoordenregister-read timeout'
      );
      const revision = Number(state && state.revision);
      if (
        !state ||
        normalizeString(state.source).toLowerCase() !== 'supabase' ||
        !Number.isSafeInteger(revision) ||
        revision < 0
      ) {
        return null;
      }
      return {
        ...state,
        revision,
        updatedAt: normalizeString(state.updatedAt) || null,
      };
    } catch (error) {
      logUiStateReadFallback(scope, error);
      return null;
    }
  }

  function getAuthenticatedVaultActor(req) {
    const actor = normalizeString(
      req?.premiumAuth?.userId || req?.premiumAuth?.email || 'password-register-owner'
    );
    return {
      actor,
      updatedBy: /^[a-z0-9:_-]{1,60}$/i.test(actor) ? actor : 'password-register-owner',
    };
  }

  async function sendLegacyPasswordRegisterCompatWrite(req, res, scope, incomingValues) {
    const currentState = await getAuthoritativePasswordRegisterState(scope);
    if (!currentState) {
      return res.status(503).json({
        ok: false,
        code: 'PASSWORD_REGISTER_STORAGE_UNAVAILABLE',
        error: 'Wachtwoordenregister-opslag kon niet rechtstreeks via Supabase worden bevestigd.',
      });
    }
    const currentValidation = validatePasswordRegisterValues(currentState.values || {}, {
      requireEncrypted: true,
    });
    if (!currentValidation.ok || currentValidation.version !== 1) {
      appendPasswordRegisterAuditEvent(
        req,
        {
          type: 'password_register_legacy_downgrade_blocked',
          success: false,
          detail: 'Legacy v1-write geweigerd omdat de authoritative kluis niet meer v1 is.',
        },
        'security_password_register_legacy_downgrade_blocked'
      );
      return res.status(409).json({
        ok: false,
        code: 'PASSWORD_REGISTER_LEGACY_DOWNGRADE_BLOCKED',
        error: 'Deze oude wachtwoordenregisterpagina is verouderd. Vergrendel en laad de nieuwste pagina.',
      });
    }
    const identity = getAuthenticatedVaultActor(req);
    const valuesToSave = {
      ...(currentState.values && typeof currentState.values === 'object' ? currentState.values : {}),
      ...sanitizeUiStateValues(incomingValues),
      updated_at: new Date().toISOString(),
      updated_by: identity.updatedBy,
    };
    const validation = validatePasswordRegisterValues(valuesToSave, { requireEncrypted: true });
    if (!validation.ok || validation.version !== 1) {
      return sendPasswordRegisterVaultInvalid(
        req,
        res,
        400,
        'Tijdelijke legacy-write geweigerd wegens ongeldig versleuteld opslagformaat.'
      );
    }
    // Tijdelijke backend-eerst rolloutcompat: uitsluitend exact v1, owner-gated,
    // vers gehydrateerd en rechtstreeks Supabase. Verwijderen zodra v2/CAS live is.
    const state = await compareAndSwapUiStateValues(scope, valuesToSave, {
      source: 'password-register-legacy-rollout-compat',
      actor: identity.actor,
      expectedRevision: currentState.revision,
      expectedUpdatedAt: currentState.updatedAt,
    });
    if (state && state.conflict) return sendPasswordRegisterRevisionConflict(req, res, state);
    const savedValidation = validatePasswordRegisterValues(state && state.values, {
      requireEncrypted: true,
    });
    if (
      !state ||
      !state.ok ||
      normalizeString(state.source).toLowerCase() !== 'supabase' ||
      !savedValidation.ok ||
      savedValidation.version !== 1 ||
      Number(state.revision) !== currentState.revision + 1
    ) {
      return res.status(503).json({
        ok: false,
        code: 'PASSWORD_REGISTER_STORAGE_UNAVAILABLE',
        error: 'Wachtwoordenregister legacy-write kon niet veilig worden bevestigd.',
      });
    }
    appendPasswordRegisterAuditEvent(
      req,
      {
        type: 'password_register_legacy_write_compat',
        success: true,
        detail: 'Tijdelijke owner-gated v1 rolloutcompat-write rechtstreeks in Supabase opgeslagen.',
      },
      'security_password_register_legacy_write_compat'
    );
    return sendUiStateSetSuccessResponse(res, scope, state, valuesToSave);
  }

  function sendPasswordRegisterRevisionConflict(req, res, state, code = 'PASSWORD_REGISTER_REVISION_CONFLICT') {
    appendPasswordRegisterAuditEvent(
      req,
      {
        type: 'password_register_revision_conflict',
        success: false,
        detail: code === 'PASSWORD_REGISTER_REVISION_REQUIRED'
          ? 'Wachtwoordenregister-write geweigerd omdat CAS-versievelden ontbreken.'
          : 'Wachtwoordenregister-write geweigerd wegens een versieconflict.',
      },
      'security_password_register_revision_conflict'
    );
    return res.status(409).json({
      ok: false,
      code,
      error: 'Het wachtwoordenregister is intussen gewijzigd. Vergrendel en laad de kluis opnieuw.',
      revision: Number(state && state.revision) || 0,
      updatedAt: state && state.updatedAt ? state.updatedAt : null,
    });
  }

  async function sendPasswordRegisterUiStateSetResponse(req, res, scope) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patchProvided = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch);
    const valuesProvided = body.values && typeof body.values === 'object' && !Array.isArray(body.values);
    const incomingValues = patchProvided ? body.patch : valuesProvided ? body.values : {};
    const hasExpectedRevision = Object.prototype.hasOwnProperty.call(body, 'expectedRevision');
    const hasExpectedUpdatedAt = Object.prototype.hasOwnProperty.call(body, 'expectedUpdatedAt');
    const isLegacyRolloutCompatWrite = isExactLegacyPasswordRegisterWrite(body);
    if (isLegacyRolloutCompatWrite) {
      return sendLegacyPasswordRegisterCompatWrite(req, res, scope, incomingValues);
    }
    const incomingValidation = validatePasswordRegisterValues(incomingValues, {
      requireEncrypted: true,
      requireCurrentVersion: true,
    });
    if (!incomingValidation.ok) {
      return sendPasswordRegisterVaultInvalid(
        req,
        res,
        400,
        'Wachtwoordenregister-write geweigerd wegens ongeldig versleuteld opslagformaat.'
      );
    }

    const currentState = await getAuthoritativePasswordRegisterState(scope);
    if (!currentState) {
      return res.status(503).json({
        ok: false,
        code: 'PASSWORD_REGISTER_STORAGE_UNAVAILABLE',
        error: 'Wachtwoordenregister-opslag kon niet rechtstreeks via Supabase worden bevestigd.',
      });
    }

    const expectedRevision = Number(body.expectedRevision);
    const expectedUpdatedAt = body.expectedUpdatedAt == null
      ? null
      : normalizeString(body.expectedUpdatedAt);
    if (
      !hasExpectedRevision ||
      !hasExpectedUpdatedAt ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0 ||
      (body.expectedUpdatedAt != null && !expectedUpdatedAt)
    ) {
      return sendPasswordRegisterRevisionConflict(
        req,
        res,
        currentState,
        'PASSWORD_REGISTER_REVISION_REQUIRED'
      );
    }
    if (
      expectedRevision !== currentState.revision ||
      expectedUpdatedAt !== currentState.updatedAt
    ) {
      return sendPasswordRegisterRevisionConflict(req, res, currentState);
    }

    const identity = getAuthenticatedVaultActor(req);
    const valuesToSave = {
      ...(currentState.values && typeof currentState.values === 'object' ? currentState.values : {}),
      ...sanitizeUiStateValues(incomingValues),
      updated_at: new Date().toISOString(),
      updated_by: identity.updatedBy,
    };
    const mergedValidation = validatePasswordRegisterValues(valuesToSave, {
      requireEncrypted: true,
      requireCurrentVersion: true,
    });
    if (!mergedValidation.ok) {
      return sendPasswordRegisterVaultInvalid(
        req,
        res,
        400,
        'Wachtwoordenregister-write geweigerd omdat de volledige kluisstate ongeldig is.'
      );
    }

    const state = await compareAndSwapUiStateValues(scope, valuesToSave, {
      source: 'password-register-vault',
      actor: identity.actor,
      expectedRevision,
      expectedUpdatedAt,
    });
    if (state && state.conflict) {
      return sendPasswordRegisterRevisionConflict(req, res, state);
    }
    if (!state || !state.ok || normalizeString(state.source).toLowerCase() !== 'supabase') {
      return res.status(503).json({
        ok: false,
        code: 'PASSWORD_REGISTER_STORAGE_UNAVAILABLE',
        error: 'Wachtwoordenregister kon niet atomair in Supabase worden opgeslagen.',
      });
    }

    const savedValidation = validatePasswordRegisterValues(state.values || {}, {
      requireEncrypted: true,
      requireCurrentVersion: true,
    });
    if (
      !savedValidation.ok ||
      !Number.isSafeInteger(Number(state.revision)) ||
      Number(state.revision) !== expectedRevision + 1 ||
      !normalizeString(state.updatedAt)
    ) {
      return sendPasswordRegisterVaultInvalid(
        req,
        res,
        503,
        'Wachtwoordenregister-write kon niet veilig worden bevestigd.'
      );
    }
    appendPasswordRegisterAuditEvent(
      req,
      {
        type: 'password_register_vault_written',
        success: true,
        detail: `Versleutelde wachtwoordenkluis v${savedValidation.version} atomair opgeslagen.`,
      },
      'security_password_register_vault_written'
    );
    return sendUiStateSetSuccessResponse(res, scope, state, valuesToSave);
  }

  async function sendUiStateGetResponse(req, res, scopeRaw) {
    const scope = normalizeUiStateScope(scopeRaw);
    if (!scope) {
      return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });
    }

    if (!hasAdminUiStateAccess(req, scope)) {
      appendAdminScopeDeniedAuditEvent(req, scope);
      return res.status(403).json({
        ok: false,
        error: 'Alleen Full Acces-accounts hebben toegang tot deze UI state scope.',
      });
    }

    const ownerDecision = getPasswordRegisterOwnerDecision(req, scope);
    if (!ownerDecision.ok) {
      return sendPasswordRegisterOwnerDenied(req, res, ownerDecision);
    }

    const state = isPasswordRegisterScope(scope)
      ? await getAuthoritativePasswordRegisterState(scope)
      : await getUiStateValuesForScope(scope);
    if (!state) {
      return res.status(503).json({
        ok: false,
        error: 'Kon UI state niet laden zonder geldige Supabase-opslag.',
      });
    }


    if (isPasswordRegisterScope(scope)) {
      const vaultValidation = validatePasswordRegisterValues(state.values || {});
      if (!vaultValidation.ok) {
        return sendPasswordRegisterVaultInvalid(
          req,
          res,
          503,
          'Wachtwoordenregister-read geweigerd wegens ongeldig versleuteld opslagformaat.'
        );
      }
      appendPasswordRegisterAuditEvent(
        req,
        {
          type: 'password_register_vault_read',
          success: true,
          detail: vaultValidation.empty
            ? 'Lege wachtwoordenkluis veilig gelezen.'
            : `Versleutelde wachtwoordenkluis v${vaultValidation.version} veilig gelezen.`,
        },
        'security_password_register_vault_read'
      );
    }

    return res.status(200).json({
      ok: true,
      scope,
      values: state.values || {},
      source: state.source || 'supabase',
      updatedAt: state.updatedAt || null,
      ...(isPasswordRegisterScope(scope) ? { revision: state.revision } : {}),
    });
  }

  async function sendUiStateSetResponse(req, res, scopeRaw) {
    const scope = normalizeUiStateScope(scopeRaw);
    if (!scope) {
      return res.status(400).json({ ok: false, error: 'Ongeldige UI state scope' });
    }

    if (!hasAdminUiStateAccess(req, scope)) {
      appendAdminScopeDeniedAuditEvent(req, scope);
      return res.status(403).json({
        ok: false,
        error: 'Alleen Full Acces-accounts hebben toegang tot deze UI state scope.',
      });
    }

    const ownerDecision = getPasswordRegisterOwnerDecision(req, scope);
    if (!ownerDecision.ok) {
      return sendPasswordRegisterOwnerDenied(req, res, ownerDecision);
    }

    if (isPasswordRegisterScope(scope)) {
      return sendPasswordRegisterUiStateSetResponse(req, res, scope);
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patchProvided = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch);
    const valuesProvided = body.values && typeof body.values === 'object' && !Array.isArray(body.values);
    const replaceRequested =
      body.replace === true ||
      body.fullReplace === true ||
      normalizeString(body.mode || '').toLowerCase() === 'replace';
    const source = normalizeString(body.source || 'frontend');
    const actor = normalizeString(body.actor || '');
    let valuesToSave;
    let currentState = null;
    let currentValues = {};

    if (replaceRequested) {
      if (scope === PREMIUM_WORD_SCOPE) {
        currentState = await getUiStateValuesForScope(scope);
        if (!currentState) {
          return res.status(503).json({
            ok: false,
            error: 'Kon Word backup niet veilig maken zonder geldige Supabase-opslag.',
          });
        }
        currentValues =
          currentState && currentState.values && typeof currentState.values === 'object'
            ? currentState.values
            : {};
      }
      valuesToSave = sanitizeUiStateValues(valuesProvided ? body.values : {});
    } else {
      const patchValues = sanitizeUiStateValues(patchProvided ? body.patch : valuesProvided ? body.values : {});
      currentState = await getUiStateValuesForScope(scope);
      if (!currentState) {
        const mirroredPatchState = await mirrorUiStateValuesToDataOps(scope, patchValues, {
          source,
          actor,
        });
        if (mirroredPatchState) {
          return sendUiStateSetSuccessResponse(res, scope, mirroredPatchState, patchValues);
        }
        return res.status(503).json({
          ok: false,
          error: 'Kon UI state patch niet laden zonder geldige Supabase-opslag.',
        });
      }
      currentValues =
        currentState && currentState.values && typeof currentState.values === 'object'
          ? currentState.values
          : {};
      valuesToSave = { ...currentValues, ...patchValues };
    }

    if (
      scope === PREMIUM_WORD_SCOPE &&
      Object.prototype.hasOwnProperty.call(valuesToSave, PREMIUM_WORD_HTML_KEY)
    ) {
      const previousHtml = String(currentValues[PREMIUM_WORD_HTML_KEY] || '');
      const nextHtml = String(valuesToSave[PREMIUM_WORD_HTML_KEY] || '');
      if (previousHtml.trim() && previousHtml !== nextHtml) {
        valuesToSave[PREMIUM_WORD_BACKUPS_KEY] = buildPremiumWordBackupsValue(
          currentValues[PREMIUM_WORD_BACKUPS_KEY],
          previousHtml,
          {
            savedAt: currentState && currentState.updatedAt,
            source,
            actor,
          }
        );
      }
    }

    const state = await setUiStateValues(scope, valuesToSave, {
      source,
      actor,
    });
    const mirroredState = await mirrorUiStateValuesToDataOps(scope, (state && state.values) || valuesToSave, {
      source,
      actor,
    });
    if (!state && !mirroredState) {
      return res.status(503).json({
        ok: false,
        error: 'Kon UI state niet opslaan zonder geldige Supabase-opslag.',
      });
    }

    return sendUiStateSetSuccessResponse(res, scope, mirroredState || state, valuesToSave);
  }

  function hasSportschoolLogbookValue(state) {
    return Boolean(
      state &&
        state.values &&
        typeof state.values === 'object' &&
        Object.prototype.hasOwnProperty.call(state.values, SPORTSCHOOL_LOGBOOK_KEY)
    );
  }

  function parseSportschoolLogbookStateSnapshot(state) {
    if (!hasSportschoolLogbookValue(state)) return null;
    try {
      const raw = state.values[SPORTSCHOOL_LOGBOOK_KEY];
      const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : null;
    } catch (_error) {
      return null;
    }
  }

  function getSportschoolLogbookStateQuality(state) {
    const snapshot = parseSportschoolLogbookStateSnapshot(state);
    if (!snapshot) return { usable: false, rank: 0 };
    const version = Number(snapshot.version) || 1;
    const hasExerciseSources = Boolean(
      snapshot.exerciseSources &&
        typeof snapshot.exerciseSources === 'object' &&
        !Array.isArray(snapshot.exerciseSources)
    );
    return {
      usable: true,
      rank: version * 10 + (hasExerciseSources ? 1 : 0),
      version,
      hasExerciseSources,
      freshnessMs: getSportschoolLogbookStateFreshnessMs(state),
    };
  }

  function parseStateUpdatedAtMs(state) {
    const parsed = Date.parse(normalizeString(state && state.updatedAt));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function parseSnapshotUpdatedAtMs(snapshot) {
    const parsed = Date.parse(normalizeString(snapshot && snapshot.updatedAt));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getSportschoolLogbookStateFreshnessMs(state) {
    const snapshotUpdatedAtMs = parseSnapshotUpdatedAtMs(parseSportschoolLogbookStateSnapshot(state));
    return snapshotUpdatedAtMs || parseStateUpdatedAtMs(state);
  }

  function getSportschoolLogbookStateVersionToken(state) {
    return normalizeString(
      (state && state.updatedAt) ||
        (parseSportschoolLogbookStateSnapshot(state) || {}).updatedAt
    );
  }

  function hasMatchingSportschoolLogbookVersion(expectedUpdatedAt, currentState) {
    const expected = normalizeString(expectedUpdatedAt);
    const current = getSportschoolLogbookStateVersionToken(currentState);
    if (!expected || !current) return true;
    const expectedMs = Date.parse(expected);
    const currentMs = Date.parse(current);
    if (Number.isFinite(expectedMs) && Number.isFinite(currentMs)) return expectedMs === currentMs;
    return expected === current;
  }

  function shouldPreferLegacySportschoolLogbook(fallbackState, sportschoolState) {
    const fallbackQuality = getSportschoolLogbookStateQuality(fallbackState);
    if (!fallbackQuality.usable) return false;
    const sportschoolQuality = getSportschoolLogbookStateQuality(sportschoolState);
    if (!sportschoolQuality.usable) return true;
    if (fallbackQuality.rank !== sportschoolQuality.rank) {
      return fallbackQuality.rank > sportschoolQuality.rank;
    }
    return fallbackQuality.freshnessMs > sportschoolQuality.freshnessMs;
  }

  function getPreferredSportschoolLogbookState(leftState, rightState) {
    const leftQuality = getSportschoolLogbookStateQuality(leftState);
    const rightQuality = getSportschoolLogbookStateQuality(rightState);
    if (!leftQuality.usable) return rightQuality.usable ? rightState : null;
    if (!rightQuality.usable) return leftState;
    if (leftQuality.rank !== rightQuality.rank) {
      return leftQuality.rank > rightQuality.rank ? leftState : rightState;
    }
    return leftQuality.freshnessMs >= rightQuality.freshnessMs ? leftState : rightState;
  }

  function isOlderSportschoolLogbookWrite(incomingState, existingState) {
    const incomingQuality = getSportschoolLogbookStateQuality(incomingState);
    const existingQuality = getSportschoolLogbookStateQuality(existingState);
    if (!existingQuality.usable || !incomingQuality.usable) return false;
    if (incomingQuality.rank !== existingQuality.rank) return incomingQuality.rank < existingQuality.rank;
    return existingQuality.freshnessMs > 0 && incomingQuality.freshnessMs < existingQuality.freshnessMs;
  }

  function enqueueSportschoolLogbookWrite(operation) {
    const run = sportschoolLogbookWriteQueue.then(operation, operation);
    sportschoolLogbookWriteQueue = run.catch(() => {});
    return run;
  }

  async function sendSportschoolLogbookGetResponse(_req, res) {
    const sportschoolState =
      sportschoolLogbookStore &&
      typeof sportschoolLogbookStore.readLogbookState === 'function'
        ? await sportschoolLogbookStore.readLogbookState()
        : null;
    const fallbackState = await getUiStateValuesForScope(SPORTSCHOOL_LOGBOOK_SCOPE);
    const shouldRecoverLegacy = shouldPreferLegacySportschoolLogbook(fallbackState, sportschoolState);
    if (
      shouldRecoverLegacy &&
      sportschoolLogbookStore &&
      typeof sportschoolLogbookStore.writeLogbookSnapshot === 'function'
    ) {
      await sportschoolLogbookStore.writeLogbookSnapshot(fallbackState.values[SPORTSCHOOL_LOGBOOK_KEY], {
        source: 'sportschool-logboek-legacy-recovery',
        actor: 'runtime-ops',
      });
    }
    const selectedState = shouldRecoverLegacy ? fallbackState : sportschoolState || fallbackState;
    const selectedSportschoolQuality = getSportschoolLogbookStateQuality(sportschoolState);
    const fallbackSportschoolQuality = getSportschoolLogbookStateQuality(fallbackState);
    if (
      selectedState === sportschoolState &&
      selectedSportschoolQuality.usable &&
      (!fallbackSportschoolQuality.usable ||
        selectedSportschoolQuality.rank > fallbackSportschoolQuality.rank ||
        (selectedSportschoolQuality.rank === fallbackSportschoolQuality.rank &&
          selectedSportschoolQuality.freshnessMs > fallbackSportschoolQuality.freshnessMs))
    ) {
      await setUiStateValues(SPORTSCHOOL_LOGBOOK_SCOPE, sportschoolState.values, {
        source: 'sportschool-logboek-canonical-sync',
        actor: 'runtime-ops',
      });
    }
    return res.status(200).json({
      ok: true,
      scope: SPORTSCHOOL_LOGBOOK_SCOPE,
      values: (selectedState && selectedState.values) || {},
      source: (selectedState && selectedState.source) || 'supabase',
      updatedAt: (selectedState && selectedState.updatedAt) || null,
    });
  }

  async function sendSportschoolLogbookSetResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const snapshotJson = normalizeSportschoolLogbookSnapshot(
      extractSportschoolLogbookSnapshot(body)
    );

    if (!snapshotJson) {
      return res.status(400).json({
        ok: false,
        error: 'Ongeldige sportschool logboekdata.',
      });
    }

    const result = await enqueueSportschoolLogbookWrite(async () => {
      const valuesToSave = { [SPORTSCHOOL_LOGBOOK_KEY]: snapshotJson };
      const meta = {
        source: normalizeString(body.source || 'sportschool-logboek'),
        actor: normalizeString(body.actor || 'serve'),
      };
      const currentSportschoolState =
        sportschoolLogbookStore &&
        typeof sportschoolLogbookStore.readLogbookState === 'function'
          ? await sportschoolLogbookStore.readLogbookState()
          : null;
      const currentFallbackState = await getUiStateValuesForScope(SPORTSCHOOL_LOGBOOK_SCOPE);
      const currentState = getPreferredSportschoolLogbookState(currentSportschoolState, currentFallbackState);
      const incomingState = {
        values: valuesToSave,
        source: 'request',
        updatedAt: new Date().toISOString(),
      };

      if (!hasMatchingSportschoolLogbookVersion(body.baseUpdatedAt, currentState)) {
        return {
          statusCode: 409,
          payload: {
            ok: false,
            conflict: true,
            scope: SPORTSCHOOL_LOGBOOK_SCOPE,
            error: 'Sportschool logboek is intussen gewijzigd.',
            values: (currentState && currentState.values) || {},
            source: (currentState && currentState.source) || 'supabase',
            updatedAt: (currentState && currentState.updatedAt) || null,
          },
        };
      }

      if (isOlderSportschoolLogbookWrite(incomingState, currentState)) {
        return {
          statusCode: 409,
          payload: {
            ok: false,
            conflict: true,
            scope: SPORTSCHOOL_LOGBOOK_SCOPE,
            error: 'Verouderde sportschool logboekdata geweigerd.',
            values: (currentState && currentState.values) || {},
            source: (currentState && currentState.source) || 'supabase',
            updatedAt: (currentState && currentState.updatedAt) || null,
          },
        };
      }

      const sportschoolState =
        sportschoolLogbookStore &&
        typeof sportschoolLogbookStore.writeLogbookSnapshot === 'function'
          ? await sportschoolLogbookStore.writeLogbookSnapshot(snapshotJson, meta)
          : null;
      if (sportschoolState) {
        await setUiStateValues(SPORTSCHOOL_LOGBOOK_SCOPE, valuesToSave, meta);
      }
      const state =
        sportschoolState ||
        (await mirrorUiStateValuesToDataOps(SPORTSCHOOL_LOGBOOK_SCOPE, valuesToSave, meta)) ||
        (await setUiStateValues(SPORTSCHOOL_LOGBOOK_SCOPE, valuesToSave, meta));

      if (!state) {
        return {
          statusCode: 503,
          payload: {
            ok: false,
            error: 'Kon sportschool logboek niet opslaan zonder geldige Supabase-opslag.',
          },
        };
      }

      return {
        statusCode: 200,
        payload: {
          ok: true,
          scope: SPORTSCHOOL_LOGBOOK_SCOPE,
          values: state.values || { [SPORTSCHOOL_LOGBOOK_KEY]: snapshotJson },
          source: state.source || 'supabase',
          updatedAt: state.updatedAt || null,
        },
      };
    });

    return res.status(result.statusCode).json(result.payload);
  }

  function sendDashboardActivityCreateResponse(req, res) {
    const entry = appendDashboardActivity(
      {
        ...req.body,
        source: normalizeString(req.body?.source || 'premium-personeel-dashboard'),
        actor: normalizeString(req.body?.actor || ''),
      },
      'dashboard_activity_manual'
    );

    return res.status(201).json({
      ok: true,
      activity: entry,
    });
  }

  return {
    hasAdminUiStateAccess,
    requiresAdminUiStateAccess,
    sendDashboardActivityCreateResponse,
    sendDashboardActivityResponse,
    sendDashboardCustomersResponse,
    sendSecurityAuditLogResponse,
    sendSportschoolLogbookGetResponse,
    sendSportschoolLogbookSetResponse,
    sendUiStateGetResponse,
    sendUiStateSetResponse,
  };
}

module.exports = {
  createRuntimeOpsCoordinator,
};
