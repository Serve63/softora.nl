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
    adminOnlyUiStateScopes = createAdminOnlyUiStateScopesSet(),
    appendSecurityAuditEvent = () => {},
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

    const state = await getUiStateValues(scope);
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

    const patchProvided =
      req.body &&
      typeof req.body === 'object' &&
      req.body.patch &&
      typeof req.body.patch === 'object';
    let valuesToSave;

    if (patchProvided) {
      const current = await getUiStateValues(scope);
      if (!current) {
        return res.status(503).json({
          ok: false,
          error: 'Kon UI state patch niet laden zonder geldige Supabase-opslag.',
        });
      }
      const currentValues =
        current && current.values && typeof current.values === 'object' ? current.values : {};
      const patchValues = sanitizeUiStateValues(req.body.patch);
      valuesToSave = { ...currentValues, ...patchValues };
    } else {
      valuesToSave = sanitizeUiStateValues(req.body?.values || {});
    }

    const state = await setUiStateValues(scope, valuesToSave, {
      source: normalizeString(req.body?.source || 'frontend'),
      actor: normalizeString(req.body?.actor || ''),
    });
    if (!state) {
      return res.status(503).json({
        ok: false,
        error: 'Kon UI state niet opslaan zonder geldige Supabase-opslag.',
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
