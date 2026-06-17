const {
  buildChunkedStatePatch,
  readChunkedStateValue,
  safeParseJsonArray,
} = require('./data-ops-serialization');

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const DEFAULT_PROVIDER = 'zerobounce';
const DEFAULT_ZEROBOUNCE_API_BASE_URL = 'https://api-eu.zerobounce.net/v2';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 15000;
const ROLE_BASED_LOCAL_PARTS = new Set([
  'admin',
  'administratie',
  'billing',
  'boekhouding',
  'contact',
  'customerservice',
  'finance',
  'hello',
  'help',
  'hr',
  'info',
  'mail',
  'office',
  'post',
  'sales',
  'service',
  'support',
]);

function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function defaultTruncateText(value, maxLength = 500) {
  return defaultNormalizeString(value).slice(0, maxLength);
}

function normalizeEmailAddress(value, normalizeString = defaultNormalizeString) {
  const raw = normalizeString(value).toLowerCase().replace(/[\u200B-\u200D\uFEFF]/g, '');
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?/i);
  return (match ? match[0] : raw)
    .replace(/[<>()"[\]]/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim();
}

function isLikelyValidEmail(value, normalizeString = defaultNormalizeString) {
  const email = normalizeEmailAddress(value, normalizeString);
  return Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function getRowEmail(row, normalizeString = defaultNormalizeString) {
  return normalizeEmailAddress(row && (row.email || row.contactEmail || row.mail || ''), normalizeString);
}

function getRowCompany(row, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.bedrijf || row.company || row.companyName || row.naam || row.name));
}

function getRowId(row, index, normalizeString = defaultNormalizeString) {
  return normalizeString(row && (row.id || row.customerId || row.databaseId || '')) || `row-${index}`;
}

function parseBoolean(value, fallback = false) {
  const normalized = defaultNormalizeString(value);
  if (!normalized) return Boolean(fallback);
  return /^(1|true|yes)$/i.test(normalized);
}

function clampLimit(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function normalizeProvider(value) {
  return defaultNormalizeString(value || DEFAULT_PROVIDER).toLowerCase();
}

function normalizeApiBaseUrl(value) {
  return defaultNormalizeString(value || DEFAULT_ZEROBOUNCE_API_BASE_URL).replace(/\/+$/g, '');
}

function normalizeStatus(value) {
  return defaultNormalizeString(value).toLowerCase().replace(/[\s-]+/g, '_');
}

function getEmailLocalPart(email) {
  return normalizeEmailAddress(email).split('@')[0].split('+')[0].replace(/\.+/g, '.');
}

function isRoleBasedEmail(email) {
  const local = getEmailLocalPart(email);
  if (!local) return false;
  if (ROLE_BASED_LOCAL_PARTS.has(local)) return true;
  return /^(admin|info|sales|support|contact|office|service|help|hello)[._-]/i.test(local);
}

function isRoleBasedResult(status, subStatus, email) {
  if (isRoleBasedEmail(email)) return true;
  return /role_based/.test(`${status} ${subStatus}`);
}

function buildLocalSyntaxResult(email, nowIso) {
  return {
    provider: 'local',
    status: 'invalid',
    subStatus: 'failed_syntax_check',
    verdict: 'red',
    mailReady: false,
    reason: 'E-mailadres heeft geen geldig formaat.',
    checkedAt: nowIso,
    raw: null,
  };
}

function classifyZeroBounceResult(data, email, nowIso) {
  const status = normalizeStatus(data && data.status);
  const subStatus = normalizeStatus(data && data.sub_status);
  const roleBased = isRoleBasedResult(status, subStatus, email);
  const catchAll = Boolean(
    status === 'catch_all' ||
      status === 'catch-all' ||
      data?.catchall_domain === true ||
      /accept_all|catch_all|catch-all/.test(subStatus)
  );
  const disposable = Boolean(subStatus === 'disposable' || data?.disposable === true);
  const toxic = /toxic|spamtrap|possible_trap|global_suppression|abuse/.test(`${status} ${subStatus}`);
  let verdict = 'orange';
  let reason = 'E-mailverificatie gaf een risicosignaal.';

  if (status === 'valid' && !roleBased && !catchAll) {
    verdict = 'green';
    reason = 'Mailbox is als geldig gecontroleerd.';
  } else if (['invalid', 'spamtrap', 'abuse'].includes(status) || disposable || toxic) {
    verdict = 'red';
    reason = 'E-mailadres is ongeldig of te risicovol om te mailen.';
  } else if (status === 'do_not_mail' && !roleBased) {
    verdict = 'red';
    reason = 'Provider markeert dit adres als niet mailen.';
  } else if (roleBased) {
    verdict = 'orange';
    reason = 'Role-based adres; niet automatisch in bulk mailen.';
  } else if (catchAll) {
    verdict = 'orange';
    reason = 'Catch-all of accept-all domein; mailbox kan niet hard bevestigd worden.';
  } else if (status === 'unknown' || !status) {
    verdict = 'orange';
    reason = 'Provider kon deze mailbox niet hard bevestigen.';
  }

  return {
    provider: DEFAULT_PROVIDER,
    status: status || 'unknown',
    subStatus,
    verdict,
    mailReady: verdict === 'green',
    reason,
    checkedAt: nowIso,
    roleBased,
    catchAll,
    disposable,
    mxFound: data?.mx_found === true || data?.mx_found === 'true',
    raw: data && typeof data === 'object' ? data : null,
  };
}

function buildVerificationPatch(result, truncateText = defaultTruncateText) {
  return {
    emailVerificationProvider: result.provider,
    emailVerificationStatus: result.status,
    emailVerificationSubStatus: result.subStatus || '',
    emailVerificationVerdict: result.verdict,
    emailVerificationMailReady: result.mailReady === true,
    emailVerificationCheckedAt: result.checkedAt,
    emailVerificationReason: truncateText(result.reason, 300),
    emailVerificationRoleBased: result.roleBased === true,
    emailVerificationCatchAll: result.catchAll === true,
    emailVerificationDisposable: result.disposable === true,
    emailVerificationMxFound: result.mxFound === true,
  };
}

function buildVerificationHistoryEntry(result, actor, normalizeString = defaultNormalizeString) {
  return {
    type: 'geblokkeerd',
    label: 'E-mail automatisch geblokkeerd',
    date: result.checkedAt,
    actor: normalizeString(actor) || 'E-mail verificatie',
    source: 'premium-database-email-verification',
    messageKey: `premium-database-email-verification:${result.checkedAt}:${result.status}:${result.subStatus || ''}`,
    preview: result.reason,
  };
}

function mergeHistory(row, entry, normalizeString = defaultNormalizeString) {
  const existing = Array.isArray(row && row.hist) ? row.hist.filter(Boolean) : [];
  const key = normalizeString(entry && entry.messageKey);
  if (key && existing.some((item) => normalizeString(item && item.messageKey) === key)) return existing;
  return [entry, ...existing].slice(0, 50);
}

function applyVerificationResultToRow(row, result, actor, helpers = {}) {
  const normalizeString = helpers.normalizeString || defaultNormalizeString;
  const truncateText = helpers.truncateText || defaultTruncateText;
  const patch = buildVerificationPatch(result, truncateText);
  const next = {
    ...row,
    ...patch,
    updatedAt: result.checkedAt,
  };
  if (result.verdict === 'red') {
    next.mail = false;
    next.canMail = false;
    next.doNotMail = true;
    next.status = 'geblokkeerd';
    next.databaseStatus = 'geblokkeerd';
    next.hist = mergeHistory(row, buildVerificationHistoryEntry(result, actor, normalizeString), normalizeString);
  }
  return next;
}

function getEmailVerificationBlockReason(row, options = {}) {
  const requireGreen = options.requireGreen === true;
  const verdict = normalizeStatus(row && row.emailVerificationVerdict);
  const status = normalizeStatus(row && row.emailVerificationStatus);
  const reason = defaultNormalizeString(row && row.emailVerificationReason);
  if (verdict === 'green') return '';
  if (verdict === 'red') return reason || 'E-mailverificatie blokkeert deze ontvanger.';
  if (verdict === 'orange') return reason || 'E-mailverificatie markeert deze ontvanger als risicovol.';
  if (['invalid', 'spamtrap', 'abuse', 'do_not_mail'].includes(status)) {
    return reason || 'E-mailverificatie blokkeert deze ontvanger.';
  }
  if (requireGreen) return 'E-mailadres is nog niet groen geverifieerd.';
  return '';
}

function isEmailVerificationAllowedForOutbound(row, options = {}) {
  return !getEmailVerificationBlockReason(row, options);
}

function createPremiumDatabaseEmailVerificationService(deps = {}) {
  const {
    emailVerificationConfig = {},
    getUiStateValues = async () => ({ values: {} }),
    setUiStateValues = async () => null,
    fetchJsonWithTimeout = async () => ({ response: { ok: false, status: 500 }, data: null }),
    customerDbScope = DEFAULT_CUSTOMER_DB_SCOPE,
    customerDbKey = DEFAULT_CUSTOMER_DB_KEY,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    now = () => new Date(),
  } = deps;

  const config = {
    enabled: parseBoolean(emailVerificationConfig.enabled, true),
    provider: normalizeProvider(emailVerificationConfig.provider),
    zeroBounceApiKey: normalizeString(emailVerificationConfig.zeroBounceApiKey || emailVerificationConfig.apiKey),
    zeroBounceApiBaseUrl: normalizeApiBaseUrl(emailVerificationConfig.zeroBounceApiBaseUrl || emailVerificationConfig.apiBaseUrl),
    requireGreenForOutbound: parseBoolean(emailVerificationConfig.requireGreenForOutbound, false),
    timeoutMs: Math.max(3000, Math.min(60000, Number(emailVerificationConfig.timeoutMs) || DEFAULT_TIMEOUT_MS)),
  };

  function getMissingConfig() {
    if (!config.enabled) return ['EMAIL_VERIFICATION_ENABLED'];
    if (config.provider !== DEFAULT_PROVIDER) return ['EMAIL_VERIFICATION_PROVIDER'];
    return [!config.zeroBounceApiKey ? 'ZEROBOUNCE_API_KEY' : null].filter(Boolean);
  }

  function getStatus() {
    const missing = getMissingConfig();
    return {
      ok: true,
      enabled: config.enabled,
      configured: missing.length === 0,
      provider: config.provider,
      missing,
      requireGreenForOutbound: config.requireGreenForOutbound,
      maxLimit: MAX_LIMIT,
    };
  }

  function assertConfigured() {
    const missing = getMissingConfig();
    if (missing.length) {
      const error = new Error('E-mailverificatie is nog niet volledig geconfigureerd.');
      error.code = 'EMAIL_VERIFICATION_NOT_CONFIGURED';
      error.status = 503;
      error.missing = missing;
      throw error;
    }
  }

  async function verifyWithZeroBounce(email) {
    const url = new URL(`${config.zeroBounceApiBaseUrl}/validate`);
    url.searchParams.set('api_key', config.zeroBounceApiKey);
    url.searchParams.set('email', email);
    url.searchParams.set('ip_address', '');
    const { response, data } = await fetchJsonWithTimeout(
      url.toString(),
      { method: 'GET', headers: { accept: 'application/json' } },
      config.timeoutMs
    );
    if (!response || !response.ok || (data && data.error)) {
      const error = new Error(
        normalizeString(data && (data.error || data.message)) ||
          `ZeroBounce verificatie faalde (${response ? response.status : 'geen response'}).`
      );
      error.code = 'EMAIL_VERIFICATION_PROVIDER_FAILED';
      error.status = response && response.status === 401 ? 502 : 503;
      throw error;
    }
    return classifyZeroBounceResult(data, email, now().toISOString());
  }

  async function verifyEmail(email) {
    const checkedAt = now().toISOString();
    if (!isLikelyValidEmail(email, normalizeString)) {
      return buildLocalSyntaxResult(email, checkedAt);
    }
    return verifyWithZeroBounce(email);
  }

  function selectRows(rows, limit, force) {
    const selected = [];
    const failed = [];
    for (let index = 0; index < rows.length && selected.length < limit; index += 1) {
      const row = rows[index];
      const email = getRowEmail(row, normalizeString);
      const id = getRowId(row, index, normalizeString);
      if (!email) continue;
      if (!force && normalizeString(row && row.emailVerificationCheckedAt)) continue;
      selected.push({ id, index, row, email, bedrijf: getRowCompany(row, normalizeString) });
    }
    return { selected, failed };
  }

  async function verifyDatabaseEmails(input = {}) {
    assertConfigured();
    const limit = clampLimit(input.limit);
    const force = input.force === true || input.recheck === true;
    const actor = normalizeString(input.actor) || 'E-mail verificatie';
    const state = await getUiStateValues(customerDbScope);
    const values = state && typeof state.values === 'object' ? state.values : {};
    const rows = safeParseJsonArray(readChunkedStateValue(values, customerDbKey));
    const { selected, failed } = selectRows(rows, limit, force);
    const results = [];
    const updatedByIndex = new Map();

    for (const item of selected) {
      try {
        const result = await verifyEmail(item.email);
        results.push({
          id: item.id,
          bedrijf: item.bedrijf,
          email: item.email,
          status: result.status,
          subStatus: result.subStatus,
          verdict: result.verdict,
          mailReady: result.mailReady,
          reason: result.reason,
        });
        updatedByIndex.set(
          item.index,
          applyVerificationResultToRow(item.row, result, actor, { normalizeString, truncateText })
        );
      } catch (error) {
        failed.push({
          id: item.id,
          bedrijf: item.bedrijf,
          email: item.email,
          code: normalizeString(error && error.code) || 'EMAIL_VERIFICATION_FAILED',
          error: truncateText(
            normalizeString(error && error.message) || 'E-mailverificatie faalde voor deze lead.',
            300
          ),
        });
      }
    }

    if (updatedByIndex.size) {
      const nextRows = rows.map((row, index) => updatedByIndex.get(index) || row);
      const write = await setUiStateValues(
        customerDbScope,
        buildChunkedStatePatch(customerDbKey, JSON.stringify(nextRows)),
        {
          source: 'premium-database-email-verification',
          actor,
        }
      );
      if (!write) {
        const error = new Error('Verificatieresultaten konden niet veilig worden opgeslagen.');
        error.code = 'EMAIL_VERIFICATION_WRITE_FAILED';
        error.status = 502;
        throw error;
      }
    }

    const summary = results.reduce(
      (acc, item) => {
        acc[item.verdict] = (acc[item.verdict] || 0) + 1;
        return acc;
      },
      { green: 0, orange: 0, red: 0 }
    );

    return {
      ok: true,
      checked: results.length,
      updated: updatedByIndex.size,
      failed: failed.length,
      requested: limit,
      available: selected.length,
      provider: config.provider,
      requireGreenForOutbound: config.requireGreenForOutbound,
      summary,
      results,
      failedItems: failed,
    };
  }

  return {
    getStatus,
    verifyDatabaseEmails,
  };
}

module.exports = {
  DEFAULT_ZEROBOUNCE_API_BASE_URL,
  applyVerificationResultToRow,
  classifyZeroBounceResult,
  createPremiumDatabaseEmailVerificationService,
  getEmailVerificationBlockReason,
  isEmailVerificationAllowedForOutbound,
  isLikelyValidEmail,
};
