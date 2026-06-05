const { createAdminOnlyUiStateScopesSet } = require('../config/admin-ui-state-scopes');

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
    dataOpsUiStateBridge = null,
    dataOpsUiStateReadTimeoutMs = 2500,
    uiStateReadTimeoutMs = 4500,
    adminOnlyUiStateScopes = createAdminOnlyUiStateScopesSet(),
    appendSecurityAuditEvent = () => {},
    logger = console,
  } = deps;

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

  function requiresAdminUiStateAccess(scope) {
    return adminOnlyUiStateScopes.has(scope);
  }

  function hasAdminUiStateAccess(req, scope) {
    if (!requiresAdminUiStateAccess(scope)) return true;
    return Boolean(req?.premiumAuth?.authenticated && req?.premiumAuth?.isAdmin);
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
        const bridged = await awaitWithTimeout(
          dataOpsUiStateBridge.getUiStateValues(scope, {
            legacyGetUiStateValues: getUiStateValues,
          }),
          dataOpsUiStateReadTimeoutMs,
          `DataOps UI-state read timeout na ${Math.round(Math.max(1, Number(dataOpsUiStateReadTimeoutMs) || 2500) / 1000)}s`
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

    const state = await getUiStateValuesForScope(scope);
    if (!state) {
      return res.status(503).json({
        ok: false,
        error: 'Kon UI state niet laden zonder geldige Supabase-opslag.',
      });
    }

    return res.status(200).json({
      ok: true,
      scope,
      values: state.values || {},
      source: state.source || 'supabase',
      updatedAt: state.updatedAt || null,
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

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patchProvided = body.patch && typeof body.patch === 'object' && !Array.isArray(body.patch);
    const valuesProvided = body.values && typeof body.values === 'object' && !Array.isArray(body.values);
    const replaceRequested =
      body.replace === true ||
      body.fullReplace === true ||
      normalizeString(body.mode || '').toLowerCase() === 'replace';
    let valuesToSave;

    if (replaceRequested) {
      valuesToSave = sanitizeUiStateValues(valuesProvided ? body.values : {});
    } else {
      const current = await getUiStateValuesForScope(scope);
      if (!current) {
        return res.status(503).json({
          ok: false,
          error: 'Kon UI state patch niet laden zonder geldige Supabase-opslag.',
        });
      }
      const currentValues =
        current && current.values && typeof current.values === 'object' ? current.values : {};
      const patchValues = sanitizeUiStateValues(patchProvided ? body.patch : valuesProvided ? body.values : {});
      valuesToSave = { ...currentValues, ...patchValues };
    }

    const state = await setUiStateValues(scope, valuesToSave, {
      source: normalizeString(body.source || 'frontend'),
      actor: normalizeString(body.actor || ''),
    });
    if (!state) {
      return res.status(503).json({
        ok: false,
        error: 'Kon UI state niet opslaan zonder geldige Supabase-opslag.',
      });
    }

    const mirroredState = await mirrorUiStateValuesToDataOps(scope, state.values || valuesToSave, {
      source: normalizeString(body.source || 'frontend'),
      actor: normalizeString(body.actor || ''),
    });

    return res.status(200).json({
      ok: true,
      scope,
      values: (mirroredState && mirroredState.values) || state.values || {},
      source: (mirroredState && mirroredState.source) || state.source || 'supabase',
      updatedAt: (mirroredState && mirroredState.updatedAt) || state.updatedAt || null,
    });
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
    sendSecurityAuditLogResponse,
    sendUiStateGetResponse,
    sendUiStateSetResponse,
  };
}

module.exports = {
  createRuntimeOpsCoordinator,
};
