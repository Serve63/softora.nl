const HARD_BLOCKED_OUTREACH_DOMAINS = Object.freeze([
  'growsocialmedia.nl',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeEmailAddress(value) {
  return normalizeString(value).toLowerCase();
}

function normalizeKeyPart(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCompactKeyPart(value) {
  return normalizeKeyPart(value).replace(/-/g, '');
}

function addKeyVariants(keys, value) {
  const key = normalizeKeyPart(value);
  if (key) keys.add(key);
  const compactKey = normalizeCompactKeyPart(value);
  if (compactKey) keys.add(compactKey);
}

function stripUrlToHost(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return '';
  const candidate = raw.includes('://') ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./, '');
  } catch (_) {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split(/[/?#]/)[0]
      .trim();
  }
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const at = normalized.lastIndexOf('@');
  return at === -1 ? '' : normalized.slice(at + 1);
}

function getCandidateDomains(input = {}) {
  const domains = new Set();
  [
    input.recipientDomain,
    input.domain,
    input.websiteDomain,
    input.website,
    input.websiteUrl,
    input.website_url,
    input.url,
    input.dom,
    input.domein,
    input.site,
  ].forEach((value) => {
    const host = stripUrlToHost(value);
    if (host) domains.add(host);
  });
  const emailDomain = getEmailDomain(input.recipientEmail || input.email || input.contactEmail || input.mail);
  if (emailDomain) domains.add(emailDomain);
  return domains;
}

function getCandidateDomainKeys(input = {}) {
  const keys = new Set();
  getCandidateDomains(input).forEach((domain) => {
    const key = normalizeKeyPart(domain);
    if (key) keys.add(key);
  });
  [
    input.recipientDomain,
    input.domain,
    input.websiteDomain,
  ].forEach((value) => {
    const key = normalizeKeyPart(value);
    if (key) keys.add(key);
  });
  return keys;
}

function getCandidateCompanyKeys(input = {}) {
  const keys = new Set();
  [
    input.recipientCompanyKey,
    input.companyKey,
    input.recipientCompany,
    input.company,
    input.bedrijf,
    input.organisatie,
    input.organization,
    input.name,
    input.naam,
  ].forEach((value) => addKeyVariants(keys, value));
  return keys;
}

function matchesBlockedDomain(candidateDomain, blockedHost) {
  const domain = stripUrlToHost(candidateDomain);
  const blocked = stripUrlToHost(blockedHost);
  return Boolean(domain && blocked && (domain === blocked || domain.endsWith(`.${blocked}`)));
}

function findOutreachSuppressionMatch(input = {}) {
  const domains = getCandidateDomains(input);
  const domainKeys = getCandidateDomainKeys(input);
  const companyKeys = getCandidateCompanyKeys(input);
  for (const blockedDomain of HARD_BLOCKED_OUTREACH_DOMAINS) {
    const blockedHost = stripUrlToHost(blockedDomain);
    const blockedDomainKey = normalizeKeyPart(blockedHost);
    const blockedCompanyKey = normalizeKeyPart(blockedHost.replace(/\.[a-z0-9.-]+$/i, ''));
    const blockedCompanyCompactKey = normalizeCompactKeyPart(blockedCompanyKey);
    if (Array.from(domains).some((domain) => matchesBlockedDomain(domain, blockedHost))) {
      return {
        domain: blockedHost,
        reason: 'hard_blocked_domain',
        message: `Outbound mail naar ${blockedHost} is hard geblokkeerd.`,
      };
    }
    if (blockedDomainKey && domainKeys.has(blockedDomainKey)) {
      return {
        domain: blockedHost,
        reason: 'hard_blocked_domain',
        message: `Outbound mail naar ${blockedHost} is hard geblokkeerd.`,
      };
    }
    const hasCompanyMatch = Array.from(companyKeys).some((key) => {
      const compactKey = normalizeCompactKeyPart(key);
      return (
        key === blockedCompanyKey ||
        key === blockedCompanyCompactKey ||
        (blockedCompanyCompactKey && compactKey.includes(blockedCompanyCompactKey))
      );
    });
    if (blockedCompanyKey && hasCompanyMatch) {
      return {
        domain: blockedHost,
        reason: 'hard_blocked_company',
        message: `Outbound mail naar ${blockedHost} is hard geblokkeerd.`,
      };
    }
  }
  return null;
}

function isOutreachSuppressed(input = {}) {
  return Boolean(findOutreachSuppressionMatch(input));
}

module.exports = {
  HARD_BLOCKED_OUTREACH_DOMAINS,
  findOutreachSuppressionMatch,
  isOutreachSuppressed,
};
