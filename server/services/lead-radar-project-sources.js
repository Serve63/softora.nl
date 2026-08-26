'use strict';

const { DomUtils, parseDocument } = require('htmlparser2');

const DEFAULT_PROJECT_INDEXES = Object.freeze([
  'https://freelancer.nl/opdrachten/development-en-it',
  'https://freelancer.nl/opdrachten/ai-services',
  'https://www.hoofdkraan.nl/opdrachten/websites-en-applicaties',
  'https://www.hoofdkraan.nl/opdrachten',
]);

const DIGITAL_PROJECT_PATTERN = /\b(?:website|webshop|webwinkel|wordpress|woocommerce|webdesign|webdeveloper|websitebouwer|software|programma|programmeur|developer|app|applicatie|crm|erp|portaal|dashboard|database|api|koppeling|automatisering|automate|automation|ai[- ]?(?:agent|assistant|assistent|operator|workflow)|chatbot|power automate|copilot)\b/i;

function cleanText(value, maxLength = 20_000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function hasClass(node, className) {
  return String(node?.attribs?.class || '').split(/\s+/).includes(className);
}

function findAll(root, predicate) {
  return DomUtils.findAll((node) => ['tag', 'script'].includes(node?.type) && predicate(node), root?.children || []);
}

function findOne(root, predicate) {
  return DomUtils.findOne((node) => ['tag', 'script'].includes(node?.type) && predicate(node), root?.children || [], true);
}

function nodeText(node, maxLength = 20_000) {
  return cleanText(node ? DomUtils.textContent(node) : '', maxLength);
}

function absoluteUrl(value, baseUrl) {
  try {
    const parsed = new URL(String(value || ''), baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function publicationDay(value) {
  const match = String(value || '').match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function parseCount(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function parseFreelancerIndex(html, indexUrl) {
  const document = parseDocument(String(html || ''), { decodeEntities: true });
  return findAll(document, (node) => hasClass(node, 'card')).map((card) => {
    const titleNode = findOne(card, (node) => node.name === 'h4' && hasClass(node, 'card-title'));
    const linkNode = findOne(card, (node) => node.name === 'a' && /\bbtn-primary\b/.test(node.attribs?.class || '') && /\/opdrachten\//.test(node.attribs?.href || ''));
    const descriptionNode = findOne(card, (node) => node.name === 'p' && hasClass(node, 'card-text'));
    const locationNode = findOne(card, (node) => hasClass(node, 'location'));
    const postedNode = findOne(card, (node) => hasClass(node, 'posted'));
    const offersNode = findOne(card, (node) => hasClass(node, 'offers'));
    const title = nodeText(titleNode, 500);
    const description = nodeText(descriptionNode);
    const url = absoluteUrl(linkNode?.attribs?.href, indexUrl);
    if (!url || !title || !description || !DIGITAL_PROJECT_PATTERN.test(`${title} ${description}`)) return null;
    return {
      url,
      title,
      description,
      region: nodeText(locationNode, 120).replace(/^Locatie\s*/i, '') || 'Nederland',
      dateRaw: nodeText(postedNode, 120).replace(/^Geplaatst\s*/i, ''),
      comments: parseCount(nodeText(offersNode, 120)),
    };
  }).filter(Boolean);
}

function detailValue(document, label) {
  const detail = findAll(document, (node) => hasClass(node, 'detail')).find((node) => {
    const labelNode = findOne(node, (candidate) => hasClass(candidate, 'label'));
    return nodeText(labelNode, 100).toLowerCase() === label.toLowerCase();
  });
  return nodeText(findOne(detail, (node) => hasClass(node, 'value')), 300);
}

function parseFreelancerDetail(html, url, fallback = {}) {
  const document = parseDocument(String(html || ''), { decodeEntities: true });
  const titleNode = findOne(document, (node) => node.name === 'h1' && node.attribs?.itemprop === 'title');
  const descriptionNode = findOne(document, (node) => node.attribs?.itemprop === 'description');
  const dateNode = findOne(document, (node) => node.name === 'time' && node.attribs?.itemprop === 'datePosted');
  const identifierNode = findOne(document, (node) => node.name === 'meta' && node.attribs?.itemprop === 'identifier');
  const title = nodeText(titleNode, 500) || fallback.title || '';
  const description = nodeText(descriptionNode) || fallback.description || '';
  const publishedAt = publicationDay(dateNode?.attribs?.datetime || nodeText(dateNode, 120));
  const status = detailValue(document, 'Status');
  if (!title || !description || !publishedAt || status.toLowerCase() !== 'open') return null;
  return {
    url,
    title,
    description,
    publishedAt,
    publicationRaw: dateNode?.attribs?.datetime || nodeText(dateNode, 120),
    region: detailValue(document, 'Locatie') || fallback.region || 'Nederland',
    externalId: cleanText(identifierNode?.attribs?.content, 300) || url,
    comments: fallback.comments || 0,
    sourceName: 'Freelancer.nl',
  };
}

function parseHoofdkraanIndex(html, indexUrl) {
  const document = parseDocument(String(html || ''), { decodeEntities: true });
  return findAll(document, (node) => hasClass(node, 'projectResult') && hasClass(node, 'newContentBox')).map((card) => {
    const titleNode = findOne(card, (node) => (node.name === 'h2' || node.name === 'h3') && /h3Like|mb-3/.test(node.attribs?.class || ''));
    const linkNode = findOne(titleNode || card, (node) => node.name === 'a' && /\/j\//.test(node.attribs?.href || ''));
    const descriptionNode = findOne(card, (node) => hasClass(node, 'projectResultDescription'));
    const title = nodeText(linkNode || titleNode, 500);
    const description = nodeText(descriptionNode);
    const url = absoluteUrl(linkNode?.attribs?.href, indexUrl);
    const metadata = nodeText(card, 5_000);
    const status = metadata.match(/Status:\s*([^:]+?)(?:\s+(?:Budget|Geplaatst|Reacties|Locatie|Laatst gewijzigd):|$)/i)?.[1]?.trim() || '';
    if (/^(?:gesloten|gepauzeerd)$/i.test(status)) return null;
    if (!url || !title || !description || !DIGITAL_PROJECT_PATTERN.test(`${title} ${description}`)) return null;
    return {
      url,
      title,
      description,
      region: metadata.match(/Locatie:\s*([^:]+?)(?:\s+Laatst gewijzigd:|\s+Status:|$)/i)?.[1]?.trim() || 'Nederland',
      dateRaw: metadata.match(/Geplaatst:\s*([^:]+?)(?:\s+Reacties:|$)/i)?.[1]?.trim() || '',
      comments: parseCount(metadata.match(/Reacties:\s*(\d+)/i)?.[1]),
    };
  }).filter(Boolean);
}

function readJobPosting(document) {
  const scripts = findAll(document, (node) => node.name === 'script' && /ld\+json/i.test(node.attribs?.type || ''));
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(DomUtils.textContent(script));
      const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      const posting = candidates.find((item) => String(item?.['@type'] || '').toLowerCase() === 'jobposting');
      if (posting) return posting;
    } catch {
      // Hoofdkraan currently emits literal newlines inside its JSON-LD
      // description. Recover only the small set of fields we verify instead
      // of trusting or repairing the complete malformed document.
      const raw = DomUtils.textContent(script);
      if (!/"@type"\s*:\s*"JobPosting"/i.test(raw)) continue;
      const title = raw.match(/"title"\s*:\s*"([\s\S]*?)"\s*,\s*"description"/i)?.[1];
      const description = raw.match(/"description"\s*:\s*"([\s\S]*?)"\s*,\s*"identifier"/i)?.[1];
      const datePosted = raw.match(/"datePosted"\s*:\s*"([^"]+)"/i)?.[1];
      const identifier = raw.match(/"identifier"[\s\S]*?"value"\s*:\s*"([^"]+)"/i)?.[1];
      const addressLocality = raw.match(/"addressLocality"\s*:\s*"([^"]*)"/i)?.[1];
      if (title && description && datePosted) {
        return {
          '@type': 'JobPosting',
          title: cleanText(title.replace(/\\"/g, '"')),
          description: cleanText(description.replace(/\\"/g, '"')),
          datePosted,
          identifier: { value: identifier || '' },
          jobLocation: { address: { addressLocality: addressLocality || '' } },
        };
      }
    }
  }
  return null;
}

function parseHoofdkraanDetail(html, url, fallback = {}) {
  const document = parseDocument(String(html || ''), { decodeEntities: true });
  const posting = readJobPosting(document);
  const pageText = nodeText(document, 80_000);
  const status = pageText.match(/Status:\s*([^:]+?)(?:\s+Heb je|\s+Ben je|\s+Reageer|$)/i)?.[1]?.trim() || '';
  const title = cleanText(posting?.title, 500) || fallback.title || '';
  const description = cleanText(posting?.description) || fallback.description || '';
  const publishedAt = publicationDay(posting?.datePosted);
  if (!posting || !title || !description || !publishedAt || !/^(?:open|match!)$/i.test(status)) return null;
  return {
    url,
    title,
    description,
    publishedAt,
    publicationRaw: cleanText(posting.datePosted, 120),
    region: cleanText(posting?.jobLocation?.address?.addressLocality, 120) || fallback.region || 'Nederland',
    externalId: cleanText(posting?.identifier?.value, 300) || url,
    comments: fallback.comments || 0,
    sourceName: 'Hoofdkraan.nl',
  };
}

function parserForUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'freelancer.nl') return { parseIndex: parseFreelancerIndex, parseDetail: parseFreelancerDetail };
    if (hostname === 'hoofdkraan.nl') return { parseIndex: parseHoofdkraanIndex, parseDetail: parseHoofdkraanDetail };
  } catch {
    return null;
  }
  return null;
}

function isSupportedProjectIndexUrl(value) {
  return Boolean(parserForUrl(value));
}

function createProjectSourceAdapter({ fetchPublic, logger = console, detailLimit = 20 } = {}) {
  async function search(context = {}, maxResults = 25) {
    const parser = parserForUrl(context.sourceUrl);
    if (!parser || typeof fetchPublic !== 'function') throw new Error('Onbekende openbare opdrachtenbron.');
    const indexResult = await fetchPublic(context.sourceUrl, { accept: 'text/html,application/xhtml+xml' });
    const candidates = parser.parseIndex(indexResult.body, indexResult.url).slice(0, Math.min(detailLimit, maxResults));
    const items = [];
    for (const candidate of candidates) {
      try {
        const detailResult = await fetchPublic(candidate.url, { accept: 'text/html,application/xhtml+xml' });
        const detail = parser.parseDetail(detailResult.body, detailResult.url, candidate);
        if (!detail) continue;
        items.push({
          platform: 'web',
          source_type: 'crawl',
          provider: 'softora_public_scraper',
          url: detail.url,
          title: detail.title,
          snippet: detail.description,
          author_name: null,
          external_id: detail.externalId,
          published_at: detail.publishedAt,
          publication_date_raw: detail.publicationRaw,
          retrieved_at: new Date().toISOString(),
          region: detail.region,
          comments: detail.comments,
          engagement_known: true,
          source_verified: true,
          source_post_id: `${detail.sourceName.toLowerCase().replace(/\W+/g, '-')}:${detail.externalId}`,
          source_verification_reason: `Opdrachttekst, open status en publicatiedatum rechtstreeks gecontroleerd op de openbare detailpagina van ${detail.sourceName}.`,
        });
        if (items.length >= maxResults) break;
      } catch (error) {
        logger.warn('[LeadRadar][project-detail]', candidate.url, error?.message || error);
      }
    }
    return items;
  }

  return { search };
}

module.exports = {
  DEFAULT_PROJECT_INDEXES,
  createProjectSourceAdapter,
  isSupportedProjectIndexUrl,
  parseFreelancerDetail,
  parseFreelancerIndex,
  parseHoofdkraanDetail,
  parseHoofdkraanIndex,
  publicationDay,
};
