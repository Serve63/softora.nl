'use strict';

const MARKETPLACE_HOSTS = Object.freeze([
  'freelancer.nl',
  'freelancer.com',
  'hoofdkraan.nl',
  'upwork.com',
  'fiverr.com',
  'werkspot.nl',
  'peopleperhour.com',
  'guru.com',
  'twago.com',
  '99designs.nl',
  '99designs.com',
  'freelance.nl',
  'freelance-info.nl',
]);

const RECRUITMENT_HOSTS = Object.freeze([
  'indeed.com',
  'indeed.nl',
  'glassdoor.com',
  'glassdoor.nl',
  'monsterboard.nl',
  'werk.nl',
  'nationalevacaturebank.nl',
  'intermediair.nl',
  'jobbird.com',
  'vacature.nl',
]);

function hostMatches(hostname, blockedHost) {
  return hostname === blockedHost || hostname.endsWith(`.${blockedHost}`);
}

function classifyLeadSourceUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.toLowerCase();
    if (MARKETPLACE_HOSTS.some((blockedHost) => hostMatches(hostname, blockedHost))) {
      return {
        allowed: false,
        category: 'project_marketplace',
        reason: 'Opdrachtmarktplaats met directe concurrentie tussen aanbieders.',
      };
    }
    if (RECRUITMENT_HOSTS.some((blockedHost) => hostMatches(hostname, blockedHost)) ||
      (hostMatches(hostname, 'linkedin.com') && /^\/jobs(?:\/|$)/.test(path))) {
      return {
        allowed: false,
        category: 'recruitment_platform',
        reason: 'Vacature- of recruitmentbron, geen directe ondernemersaanvraag.',
      };
    }
    return { allowed: true, category: 'direct_public_source', reason: '' };
  } catch {
    return { allowed: false, category: 'invalid_url', reason: 'Ongeldige openbare bron-URL.' };
  }
}

function isBlockedLeadSourceUrl(value) {
  return !classifyLeadSourceUrl(value).allowed;
}

module.exports = {
  MARKETPLACE_HOSTS,
  RECRUITMENT_HOSTS,
  classifyLeadSourceUrl,
  isBlockedLeadSourceUrl,
};
