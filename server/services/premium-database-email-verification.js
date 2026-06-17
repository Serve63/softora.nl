const {
  buildChunkedStatePatch,
  readChunkedStateValue,
  safeParseJsonArray,
} = require('./data-ops-serialization');
const dnsNative = require('node:dns');
const dns = dnsNative.promises;

const DEFAULT_CUSTOMER_DB_SCOPE = 'premium_customers_database';
const DEFAULT_CUSTOMER_DB_KEY = 'softora_customers_premium_v1';
const SOFTORA_PROVIDER = 'softora';
const ZEROBOUNCE_PROVIDER = 'zerobounce';
const DEFAULT_PROVIDER = SOFTORA_PROVIDER;
const DEFAULT_ZEROBOUNCE_API_BASE_URL = 'https://api-eu.zerobounce.net/v2';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DEFAULT_TIMEOUT_MS = 15000;
const PERSONAL_MAILBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'tuta.com',
  'tutamail.com',
  'yahoo.com',
  'ymail.com',
]);
const ROLE_BASED_LOCAL_PARTS = new Set([
  'admin',
  'administratie',
  'beheer',
  'billing',
  'boekhouding',
  'compliance',
  'contact',
  'customerservice',
  'debiteuren',
  'facturen',
  'finance',
  'hello',
  'helpdesk',
  'hosting',
  'inbox',
  'help',
  'hr',
  'info',
  'invoice',
  'jobs',
  'klantenservice',
  'marketing',
  'mail',
  'noreply',
  'office',
  'orders',
  'post',
  'privacy',
  'receptie',
  'recruitment',
  'sales',
  'security',
  'service',
  'spam',
  'support',
  'webmaster',
]);
const MAILABLE_ROLE_BASED_LOCAL_PARTS = new Set([
  'admin',
  'administratie',
  'beheer',
  'contact',
  'customerservice',
  'hello',
  'help',
  'helpdesk',
  'inbox',
  'info',
  'klantenservice',
  'mail',
  'office',
  'post',
  'receptie',
  'sales',
  'service',
  'support',
]);
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'anonbox.net',
  'byom.de',
  'dispostable.com',
  'discard.email',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemail.net',
  'getnada.com',
  'grr.la',
  'guerrillamail.com',
  'guerrillamail.net',
  'hidemail.de',
  'inboxbear.com',
  'mail.tm',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mytemp.email',
  'nada.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempmail.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'yopmail.com',
]);
const COMMON_EMAIL_DOMAIN_TYPOS = new Set([
  'gamil.com',
  'gmial.com',
  'gmai.com',
  'gmail.co',
  'gmail.con',
  'gmail.nl',
  'hotmial.com',
  'hotmai.com',
  'hotnail.com',
  'outlok.com',
  'outlook.con',
  'yaho.com',
  'yahoo.con',
]);
const HARD_BOUNCE_TYPES = new Set(['hard', 'instantly']);
const BLOCKING_INSTANTLY_STATUSES = new Set(['bounced', 'unsubscribed', 'blocked']);
const BLOCKING_CONTACT_STATUSES = new Set(['geblokkeerd', 'opt_out', 'unsubscribe', 'geen_interesse', 'geenbehoefte']);

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

function normalizeDomain(value) {
  return defaultNormalizeString(value).toLowerCase().replace(/\.+$/g, '');
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalizeDomain(normalized.slice(at + 1));
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

function isMailableRoleBasedEmail(email) {
  const local = getEmailLocalPart(email);
  if (!local) return false;
  if (MAILABLE_ROLE_BASED_LOCAL_PARTS.has(local)) return true;
  return /^(admin|info|sales|support|contact|office|service|help|hello)[._-]/i.test(local);
}

function isRoleBasedResult(status, subStatus, email) {
  if (isRoleBasedEmail(email)) return true;
  return /role_based/.test(`${status} ${subStatus}`);
}

function isPersonalMailboxEmail(email) {
  return PERSONAL_MAILBOX_DOMAINS.has(getEmailDomain(email));
}

function isDisposableEmail(email) {
  return DISPOSABLE_EMAIL_DOMAINS.has(getEmailDomain(email));
}

function isCommonEmailDomainTypo(email) {
  return COMMON_EMAIL_DOMAIN_TYPOS.has(getEmailDomain(email));
}

function isExpectedDnsMiss(error) {
  return Boolean(
    error &&
      ['EBADNAME', 'ENODATA', 'ENODOMAIN', 'ENONAME', 'ENOTFOUND'].includes(String(error.code || '').toUpperCase())
  );
}

function isNullMxRecord(record) {
  const exchange = normalizeDomain(record && record.exchange);
  return !exchange || exchange === '.';
}

async function resolvesAnyAddress(domain, helpers = {}) {
  const resolve4 = helpers.resolve4 || ((value) => dns.resolve4(value));
  const resolve6 = helpers.resolve6 || ((value) => dns.resolve6(value));
  try {
    const addresses = await resolve4(domain);
    if (Array.isArray(addresses) && addresses.length) return true;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
  }
  try {
    const addresses = await resolve6(domain);
    return Array.isArray(addresses) && addresses.length > 0;
  } catch (error) {
    if (!isExpectedDnsMiss(error)) throw error;
    return false;
  }
}

async function inspectMailDomain(domain, helpers = {}) {
  const value = normalizeDomain(domain);
  const resolveMx = helpers.resolveMx || ((target) => dns.resolveMx(target));
  if (!value) {
    return { ok: false, status: 'invalid', subStatus: 'missing_domain', mxFound: false };
  }
  try {
    const mxRecords = await resolveMx(value);
    if (Array.isArray(mxRecords) && mxRecords.length) {
      if (mxRecords.every(isNullMxRecord)) {
        return { ok: false, status: 'invalid', subStatus: 'null_mx', mxFound: true, mxRecords };
      }
      const usable = mxRecords.filter((record) => !isNullMxRecord(record));
      for (const record of usable.slice(0, 3)) {
        const exchange = normalizeDomain(record && record.exchange);
        if (exchange && (await resolvesAnyAddress(exchange, helpers))) {
          return { ok: true, status: 'valid', subStatus: 'mx_found', mxFound: true, mxRecords };
        }
      }
      return { ok: false, status: 'invalid', subStatus: 'mx_without_address', mxFound: true, mxRecords };
    }
  } catch (error) {
    if (!isExpectedDnsMiss(error)) {
      return { ok: false, status: 'unknown', subStatus: 'dns_lookup_failed', mxFound: false, error };
    }
  }
  if (await resolvesAnyAddress(value, helpers)) {
    return { ok: true, status: 'risky', subStatus: 'implicit_mx_fallback', mxFound: false };
  }
  return { ok: false, status: 'invalid', subStatus: 'no_mail_dns', mxFound: false };
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

function buildSoftoraResult({ email, nowIso, status, subStatus, verdict, score, reason, flags = {}, signals = [] }) {
  return {
    provider: SOFTORA_PROVIDER,
    status,
    subStatus,
    verdict,
    mailReady: verdict === 'green',
    reason,
    checkedAt: nowIso,
    roleBased: flags.roleBased === true,
    catchAll: flags.catchAll === true,
    disposable: flags.disposable === true,
    mxFound: flags.mxFound === true,
    score,
    raw: {
      email,
      score,
      signals,
    },
  };
}

function addRiskSignal(signals, signal) {
  const code = normalizeStatus(signal && signal.code);
  if (!code) return;
  if (signals.some((item) => normalizeStatus(item && item.code) === code)) return;
  signals.push({
    level: normalizeStatus(signal.level || 'orange'),
    code,
    reason: defaultNormalizeString(signal.reason),
    penalty: Math.max(0, Number(signal.penalty) || 0),
  });
}

function addRowHistorySignals(row, signals) {
  const status = normalizeStatus(row && (row.databaseStatus || row.status));
  const instantlyStatus = normalizeStatus(row && row.instantlyStatus);
  const bounceType = normalizeStatus(row && row.coldmailBounceType);
  if (row && (row.doNotMail === true || row.mail === false || row.canMail === false || BLOCKING_CONTACT_STATUSES.has(status))) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'softora_do_not_mail',
      reason: 'Lead staat al op niet mailen of geblokkeerd in Softora.',
      penalty: 100,
    });
  }
  if (BLOCKING_INSTANTLY_STATUSES.has(instantlyStatus)) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'instantly_blocked_status',
      reason: 'Instantly meldde eerder bounce, unsubscribe of blokkade.',
      penalty: 100,
    });
  }
  if (HARD_BOUNCE_TYPES.has(bounceType)) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'prior_hard_bounce',
      reason: 'Softora zag eerder een harde bounce op deze lead.',
      penalty: 100,
    });
  } else if (bounceType || defaultNormalizeString(row && row.coldmailBounceAt)) {
    addRiskSignal(signals, {
      level: 'orange',
      code: 'prior_mailserver_warning',
      reason: 'Softora zag eerder een bounce- of mailservermelding op deze lead.',
      penalty: 35,
    });
  }
  if (defaultNormalizeString(row && (row.coldmailUnsubscribedAt || row.unsubscribedAt || row.unsubscribeAt))) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'prior_unsubscribe',
      reason: 'Ontvanger heeft zich eerder afgemeld.',
      penalty: 100,
    });
  }
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
    provider: ZEROBOUNCE_PROVIDER,
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
    score: verdict === 'green' ? 100 : verdict === 'orange' ? 65 : 0,
    raw: data && typeof data === 'object' ? data : null,
  };
}

async function classifySoftoraResult(email, row, nowIso, helpers = {}) {
  const signals = [];
  const normalizedEmail = normalizeEmailAddress(email, helpers.normalizeString || defaultNormalizeString);
  const domain = getEmailDomain(normalizedEmail);
  addRowHistorySignals(row, signals);

  if (isCommonEmailDomainTypo(normalizedEmail)) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'common_domain_typo',
      reason: 'E-maildomein lijkt een bekende typefout.',
      penalty: 100,
    });
  }
  if (isDisposableEmail(normalizedEmail)) {
    addRiskSignal(signals, {
      level: 'red',
      code: 'disposable_domain',
      reason: 'Tijdelijk of disposable e-mailadres; niet gebruiken voor outreach.',
      penalty: 100,
    });
  }
  const roleBased = isRoleBasedEmail(normalizedEmail);
  if (roleBased) {
    const mailableRole = isMailableRoleBasedEmail(normalizedEmail);
    addRiskSignal(signals, {
      level: mailableRole ? 'notice' : 'orange',
      code: 'role_based',
      reason: mailableRole
        ? 'Algemene bedrijfsinbox; toegestaan als domein, historie en DNS verder gezond zijn.'
        : 'Role-based adres; grotere kans op lage betrokkenheid of klachten.',
      penalty: mailableRole ? 15 : 35,
    });
  }
  const personalMailbox = isPersonalMailboxEmail(normalizedEmail);
  if (personalMailbox) {
    addRiskSignal(signals, {
      level: 'orange',
      code: 'personal_mailbox',
      reason: 'Persoonlijke mailbox; apart behandelen voor zakelijke cold outreach.',
      penalty: 25,
    });
  }

  const domainInspection = await inspectMailDomain(domain, helpers);
  if (domainInspection.status === 'invalid') {
    addRiskSignal(signals, {
      level: 'red',
      code: domainInspection.subStatus,
      reason:
        domainInspection.subStatus === 'null_mx'
          ? 'Domein publiceert null-MX en accepteert geen e-mail.'
          : domainInspection.subStatus === 'mx_without_address'
            ? 'MX-records hebben geen bruikbaar serveradres.'
            : 'Domein heeft geen bruikbare mail-DNS.',
      penalty: 100,
    });
  } else if (domainInspection.status === 'unknown') {
    addRiskSignal(signals, {
      level: 'orange',
      code: domainInspection.subStatus,
      reason: 'DNS-controle faalde tijdelijk; niet automatisch mailen.',
      penalty: 40,
    });
  } else if (domainInspection.subStatus === 'implicit_mx_fallback') {
    addRiskSignal(signals, {
      level: 'orange',
      code: 'implicit_mx_fallback',
      reason: 'Domein heeft geen MX-record; alleen oude SMTP fallback is mogelijk.',
      penalty: 45,
    });
  }

  const redSignal = signals.find((signal) => signal.level === 'red');
  const penalty = signals.reduce((total, signal) => total + signal.penalty, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const orangeSignal = signals.find((signal) => signal.level === 'orange');
  const verdict = redSignal ? 'red' : orangeSignal ? 'orange' : 'green';
  const primary = redSignal || orangeSignal;
  const noticeSignal = signals.find((signal) => signal.level === 'notice');
  const subStatus = primary ? primary.code : noticeSignal ? noticeSignal.code : domainInspection.subStatus || 'softora_clean';
  const status = verdict === 'green' ? 'valid' : verdict === 'red' ? 'invalid' : 'risky';
  const reason = primary
    ? primary.reason
    : noticeSignal
      ? `Softora-check groen: ${noticeSignal.reason}`
      : 'Softora-check groen: syntax, domein en bestaande mailhistorie geven geen bounce-risico.';

  return buildSoftoraResult({
    email: normalizedEmail,
    nowIso,
    status,
    subStatus,
    verdict,
    score,
    reason,
    flags: {
      roleBased,
      disposable: isDisposableEmail(normalizedEmail),
      mxFound: domainInspection.mxFound === true,
    },
    signals,
  });
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
    emailVerificationScore: Number.isFinite(Number(result.score)) ? Number(result.score) : '',
    emailVerificationSignals: Array.isArray(result.raw && result.raw.signals)
      ? result.raw.signals.map((signal) => signal.code).filter(Boolean).join(',')
      : '',
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
    resolveMx = (value) => dns.resolveMx(value),
    resolve4 = (value) => dns.resolve4(value),
    resolve6 = (value) => dns.resolve6(value),
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
    requireGreenForOutbound: parseBoolean(emailVerificationConfig.requireGreenForOutbound, true),
    timeoutMs: Math.max(3000, Math.min(60000, Number(emailVerificationConfig.timeoutMs) || DEFAULT_TIMEOUT_MS)),
  };

  function getMissingConfig() {
    if (!config.enabled) return ['EMAIL_VERIFICATION_ENABLED'];
    if (config.provider === SOFTORA_PROVIDER) return [];
    if (config.provider === ZEROBOUNCE_PROVIDER) {
      return [!config.zeroBounceApiKey ? 'ZEROBOUNCE_API_KEY' : null].filter(Boolean);
    }
    return ['EMAIL_VERIFICATION_PROVIDER'];
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

  async function verifyEmail(email, row = {}) {
    const checkedAt = now().toISOString();
    if (!isLikelyValidEmail(email, normalizeString)) {
      return buildLocalSyntaxResult(email, checkedAt);
    }
    if (config.provider === SOFTORA_PROVIDER) {
      return classifySoftoraResult(email, row, checkedAt, {
        normalizeString,
        resolveMx,
        resolve4,
        resolve6,
      });
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
        const result = await verifyEmail(item.email, item.row);
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
  DEFAULT_PROVIDER,
  DEFAULT_ZEROBOUNCE_API_BASE_URL,
  applyVerificationResultToRow,
  classifySoftoraResult,
  classifyZeroBounceResult,
  createPremiumDatabaseEmailVerificationService,
  getEmailVerificationBlockReason,
  inspectMailDomain,
  isEmailVerificationAllowedForOutbound,
  isLikelyValidEmail,
};
