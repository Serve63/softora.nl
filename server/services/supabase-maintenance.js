const crypto = require('node:crypto');

const { resolveSupabaseProjectRef } = require('./supabase-costs');

const DEFAULT_SUPABASE_MANAGEMENT_API_BASE_URL = 'https://api.supabase.com/v1';
const DEFAULT_SUPABASE_DATABASE_RESTART_TIMEOUT_MS = 30000;

function normalizeString(value) {
  return String(value || '').trim();
}

function resolveEnv(deps = {}) {
  return deps.env || process.env || {};
}

function isEnabledFlag(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createServiceError(message, code, status = 500, detail = '') {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.detail = detail;
  return error;
}

function sanitizeSupabaseMaintenanceDetail(value) {
  const detail = normalizeString(value);
  if (!detail) return '';
  return detail
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .replace(/sbp_[A-Za-z0-9._-]+/g, 'sbp_[redacted]')
    .replace(/SUPABASE_MAINTENANCE_TOKEN=[^\s&]+/gi, 'SUPABASE_MAINTENANCE_TOKEN=[redacted]')
    .slice(0, 500);
}

function redactProjectRef(projectRef) {
  const value = normalizeString(projectRef);
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}...`;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function resolveSupabaseManagementToken(deps = {}) {
  const env = resolveEnv(deps);
  return normalizeString(
    deps.supabaseManagementAccessToken ||
      deps.supabaseAccessToken ||
      env.SUPABASE_MANAGEMENT_ACCESS_TOKEN ||
      env.SUPABASE_ACCESS_TOKEN ||
      env.SUPABASE_PERSONAL_ACCESS_TOKEN
  );
}

function resolveMaintenanceToken(deps = {}) {
  const env = resolveEnv(deps);
  return normalizeString(deps.supabaseMaintenanceToken || env.SUPABASE_MAINTENANCE_TOKEN);
}

function isSupabaseDatabaseRestartEnabled(deps = {}) {
  const env = resolveEnv(deps);
  if (typeof deps.supabaseDatabaseRestartEnabled === 'boolean') {
    return deps.supabaseDatabaseRestartEnabled;
  }
  return isEnabledFlag(env.SUPABASE_DATABASE_RESTART_ENABLED);
}

function resolveSupabaseManagementApiBaseUrl(deps = {}) {
  const env = resolveEnv(deps);
  return normalizeString(
    deps.supabaseManagementApiBaseUrl ||
      env.SUPABASE_MANAGEMENT_API_BASE_URL ||
      DEFAULT_SUPABASE_MANAGEMENT_API_BASE_URL
  ).replace(/\/+$/, '');
}

function buildPostgresConfigUrl(deps = {}, projectRef = '') {
  const apiBaseUrl = resolveSupabaseManagementApiBaseUrl(deps);
  return `${apiBaseUrl}/projects/${encodeURIComponent(projectRef)}/config/database/postgres`;
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(normalizeString(actual));
  const right = Buffer.from(normalizeString(expected));
  if (!left.length || !right.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function extractMaintenanceTokenFromRequest(req) {
  const headers = (req && req.headers) || {};
  const authorization = normalizeString(headers.authorization || headers.Authorization);
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearer) return normalizeString(bearer[1]);
  return normalizeString(headers['x-softora-maintenance-token'] || headers['X-Softora-Maintenance-Token']);
}

function getSupabaseMaintenanceConfigStatus(deps = {}) {
  const projectRef = resolveSupabaseProjectRef(deps);
  return {
    enabled: isSupabaseDatabaseRestartEnabled(deps),
    maintenanceTokenConfigured: Boolean(resolveMaintenanceToken(deps)),
    managementTokenConfigured: Boolean(resolveSupabaseManagementToken(deps)),
    projectRefConfigured: Boolean(projectRef),
    projectRef: redactProjectRef(projectRef),
    managementApiBaseUrl: resolveSupabaseManagementApiBaseUrl(deps),
  };
}

function createSupabaseMaintenanceAccessGuard(deps = {}) {
  return (req, res, next) => {
    if (!isSupabaseDatabaseRestartEnabled(deps)) {
      return res.status(503).json({
        ok: false,
        source: 'supabase-maintenance',
        error: 'SUPABASE_RESTART_DISABLED',
        detail: 'Supabase database restart is server-side uitgeschakeld.',
        config: getSupabaseMaintenanceConfigStatus(deps),
      });
    }

    const expectedToken = resolveMaintenanceToken(deps);
    if (!expectedToken) {
      return res.status(503).json({
        ok: false,
        source: 'supabase-maintenance',
        error: 'SUPABASE_MAINTENANCE_TOKEN_MISSING',
        detail: 'SUPABASE_MAINTENANCE_TOKEN ontbreekt server-side.',
        config: getSupabaseMaintenanceConfigStatus(deps),
      });
    }

    if (!safeTokenEqual(extractMaintenanceTokenFromRequest(req), expectedToken)) {
      return res.status(401).json({
        ok: false,
        source: 'supabase-maintenance',
        error: 'SUPABASE_MAINTENANCE_UNAUTHORIZED',
      });
    }

    return next();
  };
}

async function requestSupabaseDatabaseRestart(deps = {}) {
  const apiToken = resolveSupabaseManagementToken(deps);
  if (!apiToken) {
    throw createServiceError(
      'Supabase database restart kon niet worden aangevraagd.',
      'SUPABASE_MANAGEMENT_TOKEN_MISSING',
      503,
      'SUPABASE_MANAGEMENT_ACCESS_TOKEN of SUPABASE_ACCESS_TOKEN ontbreekt server-side.'
    );
  }

  const projectRef = resolveSupabaseProjectRef(deps);
  if (!projectRef) {
    throw createServiceError(
      'Supabase database restart kon niet worden aangevraagd.',
      'SUPABASE_PROJECT_REF_MISSING',
      503,
      'SUPABASE_PROJECT_REF ontbreekt server-side.'
    );
  }

  const fetchJsonWithTimeout = deps.fetchJsonWithTimeout;
  if (typeof fetchJsonWithTimeout !== 'function') {
    throw createServiceError(
      'Supabase database restart helper ontbreekt.',
      'SUPABASE_MAINTENANCE_FETCH_UNAVAILABLE',
      503
    );
  }

  const timeoutMs =
    Number(deps.supabaseDatabaseRestartTimeoutMs) > 0
      ? Number(deps.supabaseDatabaseRestartTimeoutMs)
      : DEFAULT_SUPABASE_DATABASE_RESTART_TIMEOUT_MS;
  const { response, data } = await fetchJsonWithTimeout(
    buildPostgresConfigUrl(deps, projectRef),
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ restart_database: true }),
    },
    timeoutMs
  );

  if (!response || !response.ok) {
    const status = response && response.status ? response.status : 502;
    const detail = normalizeString(data && (data.message || data.error || data.detail || data.raw));
    throw createServiceError(
      'Supabase database restart kon niet worden aangevraagd.',
      'SUPABASE_DATABASE_RESTART_FAILED',
      status,
      detail
    );
  }

  return {
    accepted: true,
    projectRef: redactProjectRef(projectRef),
    status: response.status || 200,
  };
}

function createSupabaseMaintenanceCoordinator(deps = {}) {
  return {
    async sendSupabaseDatabaseRestartResponse(_req, res) {
      try {
        const result = await requestSupabaseDatabaseRestart(deps);
        return res.status(200).json({
          ok: true,
          source: 'supabase-maintenance',
          result,
        });
      } catch (error) {
        return res.status(error.status || 500).json({
          ok: false,
          source: 'supabase-maintenance',
          error: error.code || 'SUPABASE_MAINTENANCE_ERROR',
          detail: sanitizeSupabaseMaintenanceDetail(error.detail || error.message),
          config: getSupabaseMaintenanceConfigStatus(deps),
        });
      }
    },
  };
}

module.exports = {
  buildPostgresConfigUrl,
  createSupabaseMaintenanceAccessGuard,
  createSupabaseMaintenanceCoordinator,
  getSupabaseMaintenanceConfigStatus,
  requestSupabaseDatabaseRestart,
  sanitizeSupabaseMaintenanceDetail,
};
