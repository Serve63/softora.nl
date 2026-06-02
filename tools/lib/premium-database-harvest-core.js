const fs = require('fs/promises');
const path = require('path');

const IMPORT_HEADERS = Object.freeze([
  'Bedrijfsnaam',
  'Adres',
  'E-mail',
  'Telefoonnummer',
  'Website',
  'Contactpersoon',
  'Branche',
  'Status',
  'Toegewezen aan',
  'Service',
  'Laatste actie',
]);

const SAFE_IMPORT_RECORDS_PER_FILE = 1999;
const DEFAULT_OUTPUT_BASENAME = 'softora-bedrijven';
const DEFAULT_SITE_PROGRESS_RELATIVE_PATH = 'assets/premium-database-harvest-progress.json';
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const DEFAULT_MAX_LOCATIONS = 1;
const DEFAULT_MAX_SEARCH_RESULTS_PER_SOURCE = 12;
const DEFAULT_MAX_OFFICIAL_SITES_PER_LOCATION = 80;
const DEFAULT_MIN_SOURCE_FAMILIES_FOR_COMPLETION = 3;
const DEFAULT_REQUIRED_EMPTY_ROUNDS = 2;
const DEFAULT_USER_AGENT = 'SoftoraLocalHarvester/1.0 (+https://www.softora.nl)';

const DEFAULT_BLACKLIST = Object.freeze([
  'rebirthfestival',
  'rebirth festival',
  'bouwinfosys.nl',
  'gemeente ',
  'gemeente-',
  'overheid',
  'vereniging',
  'stichting',
  'school',
  'basisschool',
  'college',
  'festival',
]);

const DIRECTORY_DOMAINS = Object.freeze([
  'allebiz.nl',
  'openkvk.nl',
  'drimble.nl',
  'oozo.nl',
  'bedrijvenpagina.nl',
  'bedrijveninfogids.nl',
  'telefoonboek.nl',
  'cylex.nl',
  'openingstijden.com',
  'indebuurt.nl',
  'trustoo.nl',
]);

const SKIPPED_DOMAINS = Object.freeze([
  'google.',
  'bing.',
  'duckduckgo.',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'kvk.nl',
  'companydata.com',
]);

function normalizeString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeText(value) {
  return normalizeString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeHtml(value) {
  return normalizeString(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function decodeHtmlEntities(value) {
  return normalizeString(value)
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function htmlToText(html) {
  return decodeHtmlEntities(
    normalizeString(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
  );
}

function normalizeWebsiteUrl(value, baseUrl = '') {
  const raw = decodeHtmlEntities(normalizeString(value));
  if (!raw || /^(?:mailto|tel|javascript|data):/i.test(raw)) return '';
  try {
    const parsed = new URL(raw, baseUrl || undefined);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString().replace(/\/+$/, '/');
  } catch (_error) {
    return '';
  }
}

function normalizeDomain(value) {
  const raw = normalizeString(value).toLowerCase();
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, '');
  } catch (_error) {
    return raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/.*$/, '')
      .trim();
  }
}

function isDirectoryDomain(domain) {
  const normalized = normalizeDomain(domain);
  return DIRECTORY_DOMAINS.some((item) => normalized === item || normalized.endsWith(`.${item}`));
}

function isSkippedDomain(domain) {
  const normalized = normalizeDomain(domain);
  return SKIPPED_DOMAINS.some((item) => normalized.includes(item));
}

function isLikelyOfficialDomain(domain) {
  const normalized = normalizeDomain(domain);
  return Boolean(normalized && normalized.includes('.') && !isDirectoryDomain(normalized) && !isSkippedDomain(normalized));
}

function parseTargetLabel(label) {
  const parts = normalizeString(label).split('|').map(normalizeString).filter(Boolean);
  return {
    label: parts.join(' | '),
    country: parts[0] || '',
    province: parts[1] || '',
    municipality: parts.length > 3 ? parts[2] : '',
    place: parts.length ? parts[parts.length - 1] : '',
  };
}

function parseTargetLines(raw) {
  const seen = new Set();
  return normalizeString(raw)
    .split(/\r?\n/)
    .map((line) => normalizeString(line).replace(/^\s*(?:[-*•]+|\d+[.)]?)\s*/, '').replace(/\s+/g, ' '))
    .filter((line) => {
      const key = normalizeText(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function extractDefaultTargetTextFromAsset(source) {
  const match = normalizeString(source).match(/const DEFAULT_TARGET_TEXT_BASE64 = \[([\s\S]*?)\]\.join\(""\);/);
  if (!match) throw new Error('DEFAULT_TARGET_TEXT_BASE64 niet gevonden in deep-search asset.');
  const chunks = Array.from(match[1].matchAll(/"([^"]*)"/g)).map((item) => item[1]);
  if (!chunks.length) throw new Error('DEFAULT_TARGET_TEXT_BASE64 bevat geen chunks.');
  return Buffer.from(chunks.join(''), 'base64').toString('utf8');
}

async function loadPlanningTargets(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(__dirname, '../..');
  const deepSearchAssetPath = options.deepSearchAssetPath || path.join(repoRoot, 'assets/premium-database-deep-search.js');
  const distanceAssetPath = options.distanceAssetPath || path.join(repoRoot, 'assets/premium-database-distance.js');
  const targetCoordsPath = options.targetCoordsPath || path.join(repoRoot, 'assets/premium-database-target-coords.js');
  const source = await fs.readFile(deepSearchAssetPath, 'utf8');
  let labels = parseTargetLines(extractDefaultTargetTextFromAsset(source));

  try {
    require(targetCoordsPath);
    const distance = require(distanceAssetPath);
    if (distance && typeof distance.sortTargetLabelsByDistance === 'function') {
      labels = distance.sortTargetLabelsByDistance(labels);
    }
  } catch (_error) {
    // Fallback is still usable for local harvesting; it just follows raw target order.
  }

  return labels;
}

function buildSourceSearches(target) {
  const place = target.place;
  const municipality = target.municipality || target.place;
  return [
    { family: 'general-search', query: `"${place}" bedrijf email telefoon website` },
    { family: 'directory', query: `"${place}" bedrijvengids bedrijven website telefoon` },
    { family: 'association', query: `"${place}" ondernemersvereniging leden bedrijven` },
    { family: 'business-park', query: `"${place}" bedrijventerrein bedrijven contact` },
    { family: 'contact-pages', query: `"${place}" "info@" "tel" bedrijf` },
    { family: 'municipality-wide-check', query: `"${place}" "${municipality}" bedrijf contact website` },
  ];
}

function buildDuckDuckGoUrl(query) {
  const url = new URL('https://duckduckgo.com/html/');
  url.searchParams.set('q', query);
  return url.toString();
}

function decodeSearchRedirectUrl(url) {
  const normalized = normalizeWebsiteUrl(url);
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const redirected = parsed.searchParams.get('uddg') || parsed.searchParams.get('url') || '';
    return normalizeWebsiteUrl(redirected) || normalized;
  } catch (_error) {
    return normalized;
  }
}

function extractLinksFromHtml(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const source = normalizeString(html);
  const linkPattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = linkPattern.exec(source))) {
    const normalized = decodeSearchRedirectUrl(normalizeWebsiteUrl(match[1], baseUrl));
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function extractMetaContent(html, selectorName) {
  const source = normalizeString(html);
  const escaped = selectorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<meta\\b[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const reversePattern = new RegExp(`<meta\\b[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${escaped}["'][^>]*>`, 'i');
  const match = source.match(pattern) || source.match(reversePattern);
  return match ? decodeHtmlEntities(match[1]) : '';
}

function extractCompanyName(html, domain) {
  const siteName = extractMetaContent(html, 'og:site_name');
  if (siteName) return cleanupCompanyName(siteName, domain);
  const h1 = normalizeString((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  if (h1) return cleanupCompanyName(htmlToText(h1), domain);
  const title = normalizeString((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  if (title) return cleanupCompanyName(title, domain);
  return cleanupCompanyName(domain.replace(/\.[a-z]{2,}$/i, ''), domain);
}

function cleanupCompanyName(value, domain = '') {
  const domainBase = normalizeDomain(domain).split('.')[0] || '';
  return decodeHtmlEntities(value)
    .replace(/\s+[-|•]\s+.*$/, '')
    .replace(/\b(home|homepage|contact|welkom)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || domainBase;
}

function extractEmails(html) {
  const text = decodeHtmlEntities(html);
  const emails = new Set();
  const mailtoMatches = text.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi) || [];
  mailtoMatches.forEach((item) => emails.add(item.replace(/^mailto:/i, '').toLowerCase()));
  const plainMatches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [];
  plainMatches.forEach((item) => {
    const email = item.toLowerCase();
    if (!/\.(?:png|jpg|jpeg|gif|webp|svg)$/i.test(email)) emails.add(email);
  });
  return Array.from(emails);
}

function extractPhones(html) {
  const text = decodeHtmlEntities(html);
  const phones = new Set();
  const telMatches = text.match(/tel:([+()0-9\-\s.]{7,24})/gi) || [];
  telMatches.forEach((item) => phones.add(cleanupPhone(item.replace(/^tel:/i, ''))));
  const plainMatches = text.match(/(?:\+31|0031|0)\s?(?:\(?[1-9][0-9]?\)?[\s.-]?)?[0-9][0-9\s.-]{5,16}/g) || [];
  plainMatches.forEach((item) => phones.add(cleanupPhone(item)));
  return Array.from(phones).filter(Boolean);
}

function cleanupPhone(value) {
  const raw = normalizeString(value).replace(/\s+/g, ' ');
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 7 || digits.length > 14) return '';
  return raw;
}

function lineContainsExactPlace(line, place) {
  const normalizedLine = ` ${normalizeText(line)} `;
  const normalizedPlace = normalizeText(place);
  return Boolean(normalizedPlace && normalizedLine.includes(` ${normalizedPlace} `));
}

function extractAddress(text, target) {
  const lines = normalizeString(text)
    .split(/\n| {2,}|\s\|\s/)
    .map((line) => normalizeString(line).replace(/\s+/g, ' '))
    .filter(Boolean);
  const postcodePattern = /\b[1-9][0-9]{3}\s?[A-Z]{2}\b/i;
  const candidates = lines.filter((line) => postcodePattern.test(line) && lineContainsExactPlace(line, target.place));
  if (candidates.length) return candidates[0].slice(0, 220);
  const nearby = lines.filter((line) => lineContainsExactPlace(line, target.place) && /\d/.test(line));
  return nearby.length ? nearby[0].slice(0, 220) : '';
}

function isProbablyParkedWebsite(html, url) {
  const text = normalizeText(htmlToText(html));
  if (text.length < 160) return true;
  return /(domain for sale|domein te koop|parked domain|coming soon|under construction|binnenkort online|this domain is parked)/i.test(text)
    || /(?:apache2 ubuntu default page|index of \/)/i.test(text)
    || normalizeDomain(url).endsWith('wordpress.com');
}

function isBlacklistedCandidate(candidate, blacklist = DEFAULT_BLACKLIST) {
  const haystack = normalizeText([
    candidate.companyName,
    candidate.website,
    candidate.email,
    candidate.address,
  ].join(' '));
  return (blacklist || DEFAULT_BLACKLIST).some((item) => haystack.includes(normalizeText(item)));
}

function buildDedupeKeys(record) {
  const keys = [];
  const domain = normalizeDomain(record.website);
  const email = normalizeString(record.email).toLowerCase();
  const phoneDigits = normalizeString(record.phone).replace(/\D+/g, '');
  const companyAddress = `${normalizeText(record.companyName)}|${normalizeText(record.address)}`;
  if (domain) keys.push(`domain:${domain}`);
  if (email) keys.push(`email:${email}`);
  if (phoneDigits) keys.push(`phone:${phoneDigits}`);
  if (companyAddress !== '|') keys.push(`company-address:${companyAddress}`);
  return keys;
}

function createDedupeIndex(records = []) {
  const index = new Set();
  records.forEach((record) => {
    buildDedupeKeys(record).forEach((key) => index.add(key));
  });
  return index;
}

function validateCandidate(candidate, target, options = {}) {
  const reasons = [];
  if (!candidate.companyName) reasons.push('bedrijfsnaam ontbreekt');
  if (!candidate.website || !normalizeDomain(candidate.website)) reasons.push('website ontbreekt');
  if (!candidate.websiteReachable) reasons.push('website niet bereikbaar of niet werkend');
  if (!candidate.email) reasons.push('e-mail ontbreekt');
  if (!candidate.phone) reasons.push('telefoon ontbreekt');
  if (!candidate.address) reasons.push('adres ontbreekt');
  if (candidate.address && !lineContainsExactPlace(candidate.address, target.place)) reasons.push('adres staat niet in exacte plaats');
  if (isBlacklistedCandidate(candidate, options.blacklist)) reasons.push('blacklist of niet-commerciele organisatie');
  return reasons;
}

async function fetchText(url, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch is niet beschikbaar.');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Number(options.fetchTimeoutMs) || DEFAULT_FETCH_TIMEOUT_MS)
    : null;
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      redirect: 'follow',
      signal: controller ? controller.signal : undefined,
    });
    const status = Number(response && response.status) || 0;
    const contentType = response && response.headers && typeof response.headers.get === 'function'
      ? normalizeString(response.headers.get('content-type')).toLowerCase()
      : '';
    const body = typeof response.text === 'function' ? await response.text() : '';
    return {
      ok: status >= 200 && status < 400,
      status,
      contentType,
      url: response && response.url ? response.url : url,
      body,
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function selectContactLinks(html, baseUrl, maxLinks = 4) {
  return extractLinksFromHtml(html, baseUrl)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return /(contact|over-ons|overons|about|impressum|team|privacy)/i.test(parsed.pathname);
      } catch (_error) {
        return false;
      }
    })
    .slice(0, maxLinks);
}

async function inspectOfficialWebsite(url, target, options = {}) {
  const normalizedUrl = normalizeWebsiteUrl(url);
  const domain = normalizeDomain(normalizedUrl);
  const raw = {
    url: normalizedUrl,
    target: target.label,
    sourceFamily: options.sourceFamily || 'unknown',
    accepted: false,
    reasons: [],
  };
  if (!normalizedUrl || !isLikelyOfficialDomain(domain)) {
    raw.reasons.push('geen officiele bedrijfswebsite');
    return { raw };
  }

  let firstPage;
  try {
    firstPage = await fetchText(normalizedUrl, options);
  } catch (error) {
    raw.reasons.push(`website fetch faalde: ${error.message || error}`);
    return { raw };
  }

  if (!firstPage.ok || isProbablyParkedWebsite(firstPage.body, firstPage.url)) {
    raw.reasons.push('website niet bereikbaar of niet werkend');
    return { raw };
  }

  const pages = [{ url: firstPage.url, body: firstPage.body }];
  const contactLinks = selectContactLinks(firstPage.body, firstPage.url, options.maxContactPages || 4);
  for (const contactUrl of contactLinks) {
    try {
      const page = await fetchText(contactUrl, options);
      if (page.ok && page.body) pages.push({ url: page.url || contactUrl, body: page.body });
    } catch (_error) {
      // Contact pages are useful, not mandatory.
    }
  }

  const combinedHtml = pages.map((page) => page.body).join('\n');
  const combinedText = htmlToText(combinedHtml);
  const emails = extractEmails(combinedHtml).filter((email) => !/(example\.com|sentry\.io)$/i.test(email));
  const phones = extractPhones(combinedHtml);
  const candidate = {
    companyName: extractCompanyName(firstPage.body, domain),
    address: extractAddress(combinedText, target),
    email: emails[0] || '',
    phone: phones[0] || '',
    website: normalizeWebsiteUrl(firstPage.url || normalizedUrl),
    websiteDomain: domain,
    websiteReachable: true,
    sources: pages.map((page) => page.url).slice(0, 8),
    sourceFamily: options.sourceFamily || 'official-site',
  };
  const reasons = validateCandidate(candidate, target, options);
  raw.companyName = candidate.companyName;
  raw.address = candidate.address;
  raw.email = candidate.email;
  raw.phone = candidate.phone;
  raw.website = candidate.website;
  raw.sources = candidate.sources;
  raw.reasons = reasons;
  raw.accepted = reasons.length === 0;
  return { candidate: raw.accepted ? candidate : null, raw };
}

function filterSearchResultUrls(urls, limit) {
  const result = [];
  const seen = new Set();
  for (const url of urls || []) {
    const normalized = normalizeWebsiteUrl(url);
    const domain = normalizeDomain(normalized);
    if (!normalized || seen.has(normalized) || isSkippedDomain(domain)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

async function collectUrlsForSource(target, source, options = {}) {
  const seedUrls = Array.isArray(options.seedUrlsByTarget && options.seedUrlsByTarget[target.label])
    ? options.seedUrlsByTarget[target.label]
    : [];
  const urls = seedUrls.filter(Boolean);
  if (options.searchProvider === 'none') return filterSearchResultUrls(urls, options.maxSearchResultsPerSource || DEFAULT_MAX_SEARCH_RESULTS_PER_SOURCE);

  const searchUrl = buildDuckDuckGoUrl(source.query);
  try {
    const page = await fetchText(searchUrl, options);
    if (page.ok) urls.push(...extractLinksFromHtml(page.body, page.url || searchUrl));
  } catch (_error) {
    // Search failures should not make the whole batch unusable.
  }
  return filterSearchResultUrls(urls, options.maxSearchResultsPerSource || DEFAULT_MAX_SEARCH_RESULTS_PER_SOURCE);
}

function discoverOfficialUrlsFromDirectoryPage(html, pageUrl) {
  const pageDomain = normalizeDomain(pageUrl);
  return extractLinksFromHtml(html, pageUrl)
    .filter((url) => {
      const domain = normalizeDomain(url);
      return domain && domain !== pageDomain && isLikelyOfficialDomain(domain);
    })
    .slice(0, 20);
}

async function expandCandidateUrls(initialUrls, options = {}) {
  const queue = [];
  const seen = new Set();
  function add(url, sourceFamily) {
    const normalized = normalizeWebsiteUrl(url);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    queue.push({ url: normalized, sourceFamily });
  }
  initialUrls.forEach((item) => add(item.url || item, item.sourceFamily || 'unknown'));
  const expanded = [];
  for (const item of queue) {
    const domain = normalizeDomain(item.url);
    if (!isDirectoryDomain(domain)) {
      expanded.push(item);
      continue;
    }
    try {
      const page = await fetchText(item.url, options);
      discoverOfficialUrlsFromDirectoryPage(page.body, page.url || item.url).forEach((url) => add(url, item.sourceFamily));
    } catch (_error) {
      // Directory expansion is opportunistic.
    }
  }
  return expanded;
}

function shouldCompleteLocation(progress, options = {}) {
  const minSourceFamilies = Number(options.minSourceFamiliesForCompletion) || DEFAULT_MIN_SOURCE_FAMILIES_FOR_COMPLETION;
  const requiredEmptyRounds = Number(options.requiredEmptyRounds) || DEFAULT_REQUIRED_EMPTY_ROUNDS;
  return progress.sourceFamilies.size >= minSourceFamilies && progress.emptyRounds >= requiredEmptyRounds;
}

async function harvestLocation(targetLabel, options = {}) {
  const target = parseTargetLabel(targetLabel);
  const accepted = [];
  const raw = [];
  const dedupeIndex = createDedupeIndex(options.existingRecords || []);
  const inspectedUrls = new Set();
  const progress = {
    target: target.label,
    status: 'bezig',
    sourceFamilies: new Set(),
    candidatesSeen: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    emptyRounds: 0,
    completed: false,
    completionReason: '',
  };
  async function emitProgress() {
    progress.updatedAt = new Date().toISOString();
    if (typeof options.onProgress !== 'function') return;
    await options.onProgress({
      target,
      accepted: accepted.slice(),
      raw: raw.slice(),
      progress: {
        ...progress,
        sourceFamilies: new Set(progress.sourceFamilies),
      },
    });
  }

  await emitProgress();
  for (const source of buildSourceSearches(target)) {
    progress.sourceFamilies.add(source.family);
    const urls = await collectUrlsForSource(target, source, options);
    const expanded = await expandCandidateUrls(
      urls.map((url) => ({ url, sourceFamily: source.family })),
      options
    );
    let acceptedBeforeRound = accepted.length;
    for (const item of expanded.slice(0, options.maxOfficialSitesPerLocation || DEFAULT_MAX_OFFICIAL_SITES_PER_LOCATION)) {
      const normalizedInspectionUrl = normalizeWebsiteUrl(item.url);
      if (!normalizedInspectionUrl || inspectedUrls.has(normalizedInspectionUrl)) continue;
      inspectedUrls.add(normalizedInspectionUrl);
      const inspected = await inspectOfficialWebsite(item.url, target, {
        ...options,
        sourceFamily: item.sourceFamily || source.family,
      });
      progress.candidatesSeen += 1;
      raw.push(inspected.raw);
      if (!inspected.candidate) {
        progress.rejectedCount += 1;
        await emitProgress();
        continue;
      }
      const keys = buildDedupeKeys(inspected.candidate);
      if (keys.some((key) => dedupeIndex.has(key))) {
        inspected.raw.accepted = false;
        inspected.raw.reasons = ['duplicaat'];
        progress.rejectedCount += 1;
        await emitProgress();
        continue;
      }
      keys.forEach((key) => dedupeIndex.add(key));
      accepted.push(inspected.candidate);
      progress.acceptedCount += 1;
      await emitProgress();
    }
    progress.emptyRounds = accepted.length === acceptedBeforeRound ? progress.emptyRounds + 1 : 0;
    await emitProgress();
  }

  progress.completed = shouldCompleteLocation(progress, options);
  progress.status = progress.completed ? 'afgerond' : 'open';
  progress.completionReason = progress.completed
    ? 'Meerdere bronsoorten doorzocht en twee lege uitbreidingsrondes gehaald.'
    : 'Nog niet genoeg lege uitbreidingsrondes of bronfamilies om hard af te ronden.';
  progress.updatedAt = new Date().toISOString();
  await emitProgress();
  return { target, accepted, raw, progress };
}

function formatDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function csvEscape(value) {
  const raw = normalizeString(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function recordToImportRow(record, today = formatDate()) {
  return [
    record.companyName,
    record.address,
    record.email,
    record.phone,
    record.website,
    '',
    '',
    'benaderbaar',
    'Serve',
    'website',
    today,
  ];
}

function buildImportCsv(records, today = formatDate()) {
  const rows = [IMPORT_HEADERS].concat((records || []).map((record) => recordToImportRow(record, today)));
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function splitRecordsForImport(records, maxRecords = SAFE_IMPORT_RECORDS_PER_FILE) {
  const safeMax = Math.max(1, Number(maxRecords) || SAFE_IMPORT_RECORDS_PER_FILE);
  const chunks = [];
  for (let index = 0; index < records.length; index += safeMax) {
    chunks.push(records.slice(index, index + safeMax));
  }
  return chunks.length ? chunks : [[]];
}

function buildRawJsonl(rawEntries) {
  return (rawEntries || []).map((entry) => JSON.stringify(entry)).join('\n') + ((rawEntries || []).length ? '\n' : '');
}

function buildProgressPayload(state, options = {}) {
  const progress = (state.progress || []).map((item) => ({
    target: item.target,
    label: item.target,
    status: item.status,
    completed: Boolean(item.completed),
    acceptedCount: Math.max(0, Number(item.acceptedCount) || 0),
    rejectedCount: Math.max(0, Number(item.rejectedCount) || 0),
    candidatesSeen: Math.max(0, Number(item.candidatesSeen) || 0),
    completionReason: item.completionReason || '',
    updatedAt: item.updatedAt || state.updatedAt || new Date().toISOString(),
  }));
  return {
    version: 1,
    source: 'softora-local-harvest',
    updatedAt: state.updatedAt || new Date().toISOString(),
    completedTargetLabels: progress
      .filter((item) => item.completed || item.status === 'afgerond' || item.status === 'done')
      .map((item) => item.label)
      .filter(Boolean),
    targetProgress: progress,
    importReadyCount: Math.max(0, Number((state.records || []).length) || 0),
    rawCandidateCount: Math.max(0, Number((state.raw || []).length) || 0),
    outputBaseName: options.basename || DEFAULT_OUTPUT_BASENAME,
  };
}

function buildLiveHtml(state) {
  const progressRows = (state.progress || []).map((item, index) => {
    const doneClass = item.completed ? ' class="done"' : '';
    return `<tr${doneClass}><td>${index + 1}</td><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.status)}</td><td>${item.acceptedCount}</td><td>${item.rejectedCount}</td><td>${item.candidatesSeen}</td><td>${escapeHtml(item.completionReason)}</td></tr>`;
  }).join('');
  const businessRows = (state.records || []).map((item, index) => (
    `<tr><td>${index + 1}</td><td>${escapeHtml(item.companyName)}</td><td><a href="${escapeHtml(item.website)}">${escapeHtml(normalizeDomain(item.website))}</a></td><td>${escapeHtml(item.email)}</td><td>${escapeHtml(item.phone)}</td><td>${escapeHtml(item.address)}</td><td>${escapeHtml(item.sourceFamily)}</td></tr>`
  )).join('');
  const rejectedRows = (state.raw || []).filter((item) => !item.accepted).slice(-80).map((item) => (
    `<tr><td>${escapeHtml(item.target)}</td><td>${escapeHtml(item.companyName || normalizeDomain(item.url) || item.url)}</td><td>${escapeHtml((item.reasons || []).join(', '))}</td><td>${escapeHtml(item.url)}</td></tr>`
  )).join('');
  return `<!doctype html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="15">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Softora bedrijven harvest</title>
  <style>
    body{font-family:Inter,Arial,sans-serif;margin:24px;color:#171727;background:#fbfaf9}
    h1{font-family:Impact,Arial Black,sans-serif;letter-spacing:.5px;margin:0 0 8px}
    .meta{color:#7b7d8d;margin-bottom:22px}
    table{width:100%;border-collapse:collapse;background:white;border:1px solid #e8e3e6;border-radius:8px;overflow:hidden;margin:12px 0 28px}
    th,td{border-bottom:1px solid #ebe7ea;padding:10px 12px;text-align:left;vertical-align:top}
    th{font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#858899;background:#f4f1f3}
    tr.done td:nth-child(2){text-decoration:line-through;color:#19743a}
    a{color:#981f58;font-weight:700}
  </style>
</head>
<body>
  <h1>Softora Bedrijven Harvest</h1>
  <div class="meta">Laatst bijgewerkt: ${escapeHtml(state.updatedAt || new Date().toISOString())} · Importklaar: ${(state.records || []).length} · Ruwe kandidaten: ${(state.raw || []).length}</div>
  <h2>Voortgang</h2>
  <table><thead><tr><th>#</th><th>Locatie</th><th>Status</th><th>Importklaar</th><th>Afgekeurd</th><th>Kandidaten</th><th>Opmerking</th></tr></thead><tbody>${progressRows || '<tr><td colspan="7">Nog geen locaties verwerkt.</td></tr>'}</tbody></table>
  <h2>Importklare bedrijven</h2>
  <table><thead><tr><th>#</th><th>Bedrijf</th><th>Website</th><th>E-mail</th><th>Telefoon</th><th>Adres</th><th>Bronfamilie</th></tr></thead><tbody>${businessRows || '<tr><td colspan="7">Nog geen complete records.</td></tr>'}</tbody></table>
  <h2>Laatste afkeuringen</h2>
  <table><thead><tr><th>Locatie</th><th>Kandidaat</th><th>Reden</th><th>URL</th></tr></thead><tbody>${rejectedRows || '<tr><td colspan="4">Nog geen afkeuringen.</td></tr>'}</tbody></table>
</body>
</html>`;
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeOutputs(outputDir, state, options = {}) {
  const basename = options.basename || DEFAULT_OUTPUT_BASENAME;
  await ensureDirectory(outputDir);
  const records = state.records || [];
  const csvChunks = splitRecordsForImport(records);
  const baseCsvPath = path.join(outputDir, `${basename}-importklaar.csv`);
  await fs.writeFile(baseCsvPath, buildImportCsv(csvChunks[0] || [], options.today), 'utf8');
  const extraCsvPaths = [];
  if (csvChunks.length > 1) {
    for (let index = 0; index < csvChunks.length; index += 1) {
      const filePath = path.join(outputDir, `${basename}-importklaar-${String(index + 1).padStart(3, '0')}.csv`);
      await fs.writeFile(filePath, buildImportCsv(csvChunks[index], options.today), 'utf8');
      extraCsvPaths.push(filePath);
    }
  }
  const rawJsonlPath = path.join(outputDir, `${basename}-raw.jsonl`);
  const liveHtmlPath = path.join(outputDir, `${basename}-verzamellijst-live.html`);
  const progressJsonPath = path.join(outputDir, `${basename}-progress.json`);
  const progressPayload = buildProgressPayload(state, options);
  await fs.writeFile(rawJsonlPath, buildRawJsonl(state.raw || []), 'utf8');
  await fs.writeFile(liveHtmlPath, buildLiveHtml(state), 'utf8');
  await fs.writeFile(progressJsonPath, JSON.stringify(progressPayload, null, 2) + '\n', 'utf8');
  let siteProgressPath = '';
  if (options.syncSiteProgress || options.siteProgressPath) {
    siteProgressPath = options.siteProgressPath || path.join(options.repoRoot || path.resolve(__dirname, '../..'), DEFAULT_SITE_PROGRESS_RELATIVE_PATH);
    await ensureDirectory(path.dirname(siteProgressPath));
    await fs.writeFile(siteProgressPath, JSON.stringify(progressPayload, null, 2) + '\n', 'utf8');
  }
  return { csvPath: baseCsvPath, extraCsvPaths, rawJsonlPath, liveHtmlPath, progressJsonPath, siteProgressPath };
}

async function runHarvest(options = {}) {
  const outputDir = options.outputDir || path.join(process.cwd(), 'reports/premium-database-harvest');
  const labels = options.targets || await loadPlanningTargets(options);
  const externalOnProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const startAt = normalizeString(options.startAt);
  const startIndex = startAt
    ? Math.max(0, labels.findIndex((label) => normalizeText(label) === normalizeText(startAt)))
    : 0;
  const selectedLabels = labels.slice(startIndex === -1 ? 0 : startIndex, (startIndex === -1 ? 0 : startIndex) + (Number(options.maxLocations) || DEFAULT_MAX_LOCATIONS));
  const state = {
    records: Array.isArray(options.initialRecords) ? options.initialRecords.slice() : [],
    raw: [],
    progress: [],
    updatedAt: new Date().toISOString(),
  };
  await writeOutputs(outputDir, state, options);
  for (const label of selectedLabels) {
    const baseRecords = state.records.slice();
    const baseRaw = state.raw.slice();
    const progressIndex = state.progress.length;
    state.progress.push({
      target: parseTargetLabel(label).label,
      status: 'bezig',
      completed: false,
      acceptedCount: 0,
      rejectedCount: 0,
      candidatesSeen: 0,
      completionReason: 'Deze locatie wordt nu doorzocht.',
      updatedAt: new Date().toISOString(),
    });
    state.updatedAt = new Date().toISOString();
    await writeOutputs(outputDir, state, options);
    const result = await harvestLocation(label, {
      ...options,
      existingRecords: state.records,
      onProgress: async (partial) => {
        state.records = baseRecords.concat(partial.accepted || []);
        state.raw = baseRaw.concat(partial.raw || []);
        state.progress[progressIndex] = partial.progress;
        state.updatedAt = new Date().toISOString();
        await writeOutputs(outputDir, state, options);
        if (externalOnProgress) await externalOnProgress({ ...state, currentTarget: partial.target });
      },
    });
    state.records = baseRecords.concat(result.accepted);
    state.raw = baseRaw.concat(result.raw);
    state.progress[progressIndex] = result.progress;
    state.updatedAt = new Date().toISOString();
    await writeOutputs(outputDir, state, options);
  }
  return { ...state, output: await writeOutputs(outputDir, state, options) };
}

module.exports = {
  DEFAULT_BLACKLIST,
  DEFAULT_OUTPUT_BASENAME,
  DEFAULT_SITE_PROGRESS_RELATIVE_PATH,
  IMPORT_HEADERS,
  SAFE_IMPORT_RECORDS_PER_FILE,
  buildImportCsv,
  buildLiveHtml,
  buildProgressPayload,
  buildRawJsonl,
  buildSourceSearches,
  createDedupeIndex,
  extractAddress,
  extractDefaultTargetTextFromAsset,
  extractEmails,
  extractLinksFromHtml,
  extractPhones,
  harvestLocation,
  inspectOfficialWebsite,
  isBlacklistedCandidate,
  loadPlanningTargets,
  normalizeDomain,
  normalizeText,
  normalizeWebsiteUrl,
  parseTargetLabel,
  parseTargetLines,
  recordToImportRow,
  runHarvest,
  shouldCompleteLocation,
  splitRecordsForImport,
  validateCandidate,
  writeOutputs,
};
