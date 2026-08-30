const { DomUtils, parseDocument } = require('htmlparser2');

const {
  getSeoContentImageForItem,
  getSeoContentItems,
  getSeoContentPathForItem,
} = require('./seo-content');
const { requiresVisualQualityV2 } = require('./seo-machine-visual-quality');

const SOFTORA_HOSTS = new Set(['softora.nl', 'www.softora.nl']);
const PRIVATE_TEXT_PATTERNS = Object.freeze([
  /Serve Creusen/i,
  /SEO_MACHINE_PROMPT_VERSION/i,
  /selection-evidence\.json/i,
  /codex-automation/i,
  /origin\/main/i,
]);

function normalizePublicUrl(value) {
  const parsed = new URL(String(value || ''));
  parsed.hash = '';
  if (parsed.pathname !== '/') parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function isTag(node, name) {
  return node && ['tag', 'script', 'style'].includes(node.type) && node.name === name;
}

function findTags(document, name) {
  return DomUtils.findAll((node) => isTag(node, name), document.children || []);
}

function findMetaContent(document, key, value) {
  const expected = String(value || '').toLowerCase();
  return findTags(document, 'meta').find((node) => String(node.attribs?.[key] || '').toLowerCase() === expected)?.attribs?.content || '';
}

function findCanonical(document) {
  const node = findTags(document, 'link').find((candidate) => {
    return String(candidate.attribs?.rel || '').toLowerCase().split(/\s+/).includes('canonical');
  });
  return String(node?.attribs?.href || '').trim();
}

function parseJsonLd(document) {
  const values = [];
  for (const script of findTags(document, 'script')) {
    if (String(script.attribs?.type || '').toLowerCase() !== 'application/ld+json') continue;
    try {
      const parsed = JSON.parse(DomUtils.textContent(script));
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch (_) {
      values.push({ __invalid: true });
    }
  }
  return values;
}

function flattenSchemaNodes(values) {
  const nodes = [];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    nodes.push(value);
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(visit);
  };
  values.forEach(visit);
  return nodes;
}

function schemaHasType(node, expectedTypes) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.some((type) => expectedTypes.includes(type));
}

function getSchemaImages(entity) {
  const values = Array.isArray(entity?.image) ? entity.image : [entity?.image];
  return values.filter((value) => value && typeof value === 'object' && !Array.isArray(value));
}

function collectXmlLocations(xml) {
  const document = parseDocument(String(xml || ''), { xmlMode: true });
  return DomUtils.findAll(
    (node) => node?.type === 'tag' && (node.name === 'loc' || String(node.name || '').endsWith(':loc')),
    document.children || []
  ).map((node) => DomUtils.textContent(node).trim()).filter(Boolean);
}

async function fetchChecked(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    redirect: 'follow',
    signal: options.signal || AbortSignal.timeout(20_000),
    headers: { 'user-agent': 'Softora-SEO-Live-Check/1.0' },
  });
  return response;
}

function resolveContentItem(pathname, items = getSeoContentItems()) {
  return items.find((item) => getSeoContentPathForItem(item) === pathname) || null;
}

function expectedContentImages(item) {
  if (!item) return [];
  return [getSeoContentImageForItem(item), item.secondaryImage]
    .filter(Boolean)
    .map((image) => ({
      src: String(image.src || '').trim(),
      alt: String(image.alt || '').trim(),
      width: Number(image.width) || null,
      height: Number(image.height) || null,
    }))
    .filter((image) => image.src);
}

function normalizePathname(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  try {
    const parsed = new URL(raw, 'https://www.softora.nl');
    if (!SOFTORA_HOSTS.has(parsed.hostname) || parsed.search || parsed.hash) return '';
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return '';
  }
}

function collectInternalAnchorPaths(document, baseUrl) {
  return new Set(findTags(document, 'a').flatMap((node) => {
    const href = String(node.attribs?.href || '').trim();
    if (!href) return [];
    try {
      const parsed = new URL(href, baseUrl);
      if (!SOFTORA_HOSTS.has(parsed.hostname)) return [];
      return [parsed.pathname.replace(/\/+$/, '') || '/'];
    } catch {
      return [];
    }
  }));
}

async function verifySupportingAction({
  supportingAction,
  selectedUrl,
  origin,
  sitemapLocations,
  fetchImpl,
} = {}) {
  if (!supportingAction) return { errors: [], summary: null };
  const errors = [];
  const type = String(supportingAction.type || '').trim();
  const supportingPath = normalizePathname(supportingAction.path);
  const selectedPath = new URL(selectedUrl).pathname.replace(/\/+$/, '') || '/';
  const verification = supportingAction.verification;
  const verificationKind = String(verification?.kind || '').trim();
  const verificationValue = String(verification?.value || '').trim();
  if (!type) errors.push('supportingAction.type ontbreekt.');
  if (!supportingPath) errors.push('supportingAction.path is ongeldig.');
  if (supportingPath && supportingPath === selectedPath) {
    errors.push('supportingAction.path mag niet gelijk zijn aan de gewijzigde URL.');
  }
  if (!verification || typeof verification !== 'object' || !verificationKind) {
    errors.push('supportingAction.verification ontbreekt.');
  } else if (verificationKind === 'link_present' && !normalizePathname(verificationValue)) {
    errors.push('supportingAction link_present-bewijs mist een geldige Softora-route.');
  } else if (verificationKind === 'text_present' && verificationValue.length < 12) {
    errors.push('supportingAction text_present-bewijs is te vaag.');
  } else if (verificationKind === 'title_equals' && verificationValue.length < 10) {
    errors.push('supportingAction title_equals-bewijs is te kort.');
  } else if (verificationKind === 'meta_description_equals' && verificationValue.length < 30) {
    errors.push('supportingAction meta_description_equals-bewijs is te kort.');
  }
  if (!supportingPath || errors.length) {
    return {
      errors,
      summary: {
        type: type || null,
        path: supportingPath || null,
        verification: verificationKind ? { kind: verificationKind, value: verificationValue || null } : null,
        verified: false,
      },
    };
  }

  const supportingUrl = new URL(supportingPath, origin).toString();
  let html = '';
  let routeStatus = null;
  try {
    const response = await fetchChecked(fetchImpl, supportingUrl);
    routeStatus = response.status;
    if (response.status !== 200) errors.push(`supportingAction route gaf HTTP ${response.status}.`);
    if (response.url && normalizePublicUrl(response.url) !== normalizePublicUrl(supportingUrl)) {
      errors.push('supportingAction route redirect naar een andere eind-URL.');
    }
    if (!String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
      errors.push('supportingAction route is geen HTML-response.');
    }
    html = await response.text();
  } catch (error) {
    errors.push(`supportingAction route kon niet worden gelezen: ${error.message || String(error)}`);
  }

  const document = parseDocument(html);
  const canonical = findCanonical(document);
  try {
    if (!canonical || normalizePublicUrl(new URL(canonical, supportingUrl).toString()) !== normalizePublicUrl(supportingUrl)) {
      errors.push('supportingAction canonical is niet self-referential.');
    }
  } catch {
    errors.push('supportingAction canonical is ongeldig.');
  }
  const robots = findMetaContent(document, 'name', 'robots').toLowerCase();
  if (!robots || robots.includes('noindex')) errors.push('supportingAction route is niet indexeerbaar.');
  if (!sitemapLocations.has(normalizePublicUrl(supportingUrl))) {
    errors.push('supportingAction route ontbreekt in sitemap.xml.');
  }

  const internalLinks = collectInternalAnchorPaths(document, supportingUrl);
  const visibleText = DomUtils.textContent(document).replace(/\s+/g, ' ').trim();
  const title = DomUtils.textContent(findTags(document, 'title')[0] || '').trim();
  const description = findMetaContent(document, 'name', 'description').trim();
  if (verificationKind === 'link_to_selected_url' && !internalLinks.has(selectedPath)) {
    errors.push(`supportingAction mist de live interne link naar ${selectedPath}.`);
  } else if (verificationKind === 'link_present') {
    const expectedPath = normalizePathname(verificationValue);
    if (!expectedPath || !internalLinks.has(expectedPath)) {
      errors.push(`supportingAction mist de verwachte interne link ${verificationValue || '(leeg)'}.`);
    }
  } else if (verificationKind === 'text_present' && !visibleText.toLowerCase().includes(verificationValue.toLowerCase())) {
    errors.push('supportingAction mist de verwachte zichtbare tekst.');
  } else if (verificationKind === 'title_equals' && title !== verificationValue) {
    errors.push('supportingAction title wijkt af van het selectiebewijs.');
  } else if (verificationKind === 'meta_description_equals' && description !== verificationValue) {
    errors.push('supportingAction meta description wijkt af van het selectiebewijs.');
  } else if (![
    'link_to_selected_url', 'link_present', 'text_present', 'title_equals', 'meta_description_equals',
  ].includes(verificationKind)) {
    errors.push(`supportingAction verification.kind is ongeldig: ${verificationKind || '(leeg)'}.`);
  }

  return {
    errors,
    summary: {
      type,
      path: supportingPath,
      verification: { kind: verificationKind, value: verificationValue || null },
      verified: errors.length === 0,
      routeStatus,
      canonical: canonical || null,
      sitemap: sitemapLocations.has(normalizePublicUrl(supportingUrl)),
    },
  };
}

async function runSeoMachineLiveRouteCheck({
  url,
  liveCommit,
  fetchImpl = global.fetch,
  contentItems,
  supportingAction = null,
} = {}) {
  const errors = [];
  let target;
  try {
    target = new URL(String(url || ''));
  } catch {
    return { status: 'blocked', errors: ['changed URL is ongeldig.'], summary: {} };
  }
  if (target.protocol !== 'https:' || !SOFTORA_HOSTS.has(target.hostname)) {
    return { status: 'blocked', errors: ['changed URL moet een publieke HTTPS Softora-URL zijn.'], summary: {} };
  }
  if (!/^[a-f0-9]{7,40}$/i.test(String(liveCommit || ''))) {
    return { status: 'blocked', errors: ['liveCommit ontbreekt of is ongeldig.'], summary: {} };
  }
  if (typeof fetchImpl !== 'function') {
    return { status: 'blocked', errors: ['fetch is niet beschikbaar.'], summary: {} };
  }

  const canonicalTarget = normalizePublicUrl(target.toString());
  const origin = 'https://www.softora.nl';
  let healthPayload = null;
  let html = '';
  let sitemapXml = '';
  let routeStatus = null;
  try {
    const healthResponse = await fetchChecked(fetchImpl, `${origin}/api/healthz`);
    if (!healthResponse.ok) errors.push(`healthz gaf HTTP ${healthResponse.status}.`);
    else healthPayload = await healthResponse.json();
  } catch (error) {
    errors.push(`healthz kon niet worden gelezen: ${error.message || String(error)}`);
  }
  const healthCommit = String(healthPayload?.deployment?.commitSha || '').trim();
  if (healthCommit !== String(liveCommit)) errors.push('healthz commit wijkt af van liveCommit.');

  try {
    const routeResponse = await fetchChecked(fetchImpl, canonicalTarget);
    routeStatus = routeResponse.status;
    if (routeResponse.status !== 200) errors.push(`route gaf HTTP ${routeResponse.status}.`);
    if (routeResponse.url) {
      try {
        if (normalizePublicUrl(routeResponse.url) !== canonicalTarget) errors.push('route redirect naar een andere eind-URL.');
      } catch {
        errors.push('route eind-URL is ongeldig.');
      }
    }
    const contentType = String(routeResponse.headers.get('content-type') || '');
    if (!contentType.toLowerCase().includes('text/html')) errors.push('route is geen HTML-response.');
    html = await routeResponse.text();
  } catch (error) {
    errors.push(`route kon niet worden gelezen: ${error.message || String(error)}`);
  }

  try {
    const sitemapResponse = await fetchChecked(fetchImpl, `${origin}/sitemap.xml`);
    if (!sitemapResponse.ok) errors.push(`sitemap gaf HTTP ${sitemapResponse.status}.`);
    else sitemapXml = await sitemapResponse.text();
  } catch (error) {
    errors.push(`sitemap kon niet worden gelezen: ${error.message || String(error)}`);
  }

  const document = parseDocument(html);
  const canonical = findCanonical(document);
  try {
    if (!canonical || normalizePublicUrl(new URL(canonical, canonicalTarget).toString()) !== canonicalTarget) {
      errors.push('canonical is niet self-referential.');
    }
  } catch {
    errors.push('canonical is ongeldig.');
  }
  const title = DomUtils.textContent(findTags(document, 'title')[0] || '').trim();
  if (!title) errors.push('title ontbreekt.');
  const description = findMetaContent(document, 'name', 'description').trim();
  if (!description) errors.push('meta description ontbreekt.');
  const robots = findMetaContent(document, 'name', 'robots').toLowerCase();
  if (!robots || robots.includes('noindex')) errors.push('robotsmeta is niet indexeerbaar.');
  const h1Values = findTags(document, 'h1').map((node) => DomUtils.textContent(node).trim()).filter(Boolean);
  if (h1Values.length !== 1) errors.push(`route moet exact een niet-lege H1 hebben; gevonden ${h1Values.length}.`);

  const sitemapLocations = collectXmlLocations(sitemapXml);
  const normalizedSitemapLocations = new Set(sitemapLocations.map((location) => {
    try { return normalizePublicUrl(location); } catch { return null; }
  }).filter(Boolean));
  if (!normalizedSitemapLocations.has(canonicalTarget)) errors.push('changed URL ontbreekt in sitemap.xml.');

  const supportingResult = await verifySupportingAction({
    supportingAction,
    selectedUrl: canonicalTarget,
    origin,
    sitemapLocations: normalizedSitemapLocations,
    fetchImpl,
  });
  errors.push(...supportingResult.errors);

  const anchorNodes = findTags(document, 'a');
  const anchors = anchorNodes.map((node) => String(node.attribs?.href || '').trim()).filter(Boolean);
  for (const anchor of anchorNodes) {
    const href = String(anchor.attribs?.href || '').trim();
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href, canonicalTarget); } catch { continue; }
    if (parsed.hostname === 'wa.me' && (parsed.pathname !== '/31643262792' || parsed.search)) {
      errors.push(`WhatsApp-link is niet schoon: ${href}`);
    }
    const accessibleLabel = DomUtils.textContent(anchor).trim()
      || String(anchor.attribs?.['aria-label'] || '').trim()
      || String(anchor.attribs?.title || '').trim();
    if (parsed.hostname === 'wa.me' && !accessibleLabel) {
      errors.push(`WhatsApp-link mist een toegankelijk label: ${href}`);
    }
  }
  const visibleText = DomUtils.textContent(document);
  for (const pattern of PRIVATE_TEXT_PATTERNS) {
    if (pattern.test(visibleText)) errors.push(`private/interne tekst aangetroffen: ${pattern.source}`);
  }

  const item = resolveContentItem(target.pathname.replace(/\/+$/, '') || '/', contentItems);
  const images = expectedContentImages(item);
  const imageNodes = findTags(document, 'img');
  if (requiresVisualQualityV2(item) && images.length !== 2) {
    errors.push('Visual Quality V2-blog heeft niet exact twee verwachte visuals.');
  }
  if (item?.targetMoneyPage) {
    const hasMoneyPageLink = anchors.some((href) => {
      try { return new URL(href, canonicalTarget).pathname.replace(/\/+$/, '') === item.targetMoneyPage; } catch { return false; }
    });
    if (!hasMoneyPageLink) errors.push(`doel-money-page ontbreekt als live interne link: ${item.targetMoneyPage}`);
  }
  const checkedImages = [];
  for (const expected of images) {
    if (!expected.src.startsWith('/assets/seo-content/')) {
      errors.push(`visual is niet een lokale Softora SEO-asset: ${expected.src}`);
    }
    const node = imageNodes.find((candidate) => String(candidate.attribs?.src || '').trim() === expected.src);
    if (!node) {
      errors.push(`verwachte visual ontbreekt in HTML: ${expected.src}`);
      continue;
    }
    const renderedAlt = String(node.attribs?.alt || '').trim();
    if (!renderedAlt) errors.push(`visual mist alt: ${expected.src}`);
    else if (expected.alt && renderedAlt !== expected.alt) errors.push(`visual-alt wijkt af van de contentbrief: ${expected.src}`);
    const renderedWidth = Number(node.attribs?.width);
    const renderedHeight = Number(node.attribs?.height);
    if (!/^\d+$/.test(String(node.attribs?.width || '')) || !/^\d+$/.test(String(node.attribs?.height || ''))) {
      errors.push(`visual mist vaste dimensies: ${expected.src}`);
    } else if (
      (expected.width && renderedWidth !== expected.width)
      || (expected.height && renderedHeight !== expected.height)
    ) {
      errors.push(`visualdimensies wijken af van de contentbrief: ${expected.src}`);
    }
    const absoluteImageUrl = new URL(expected.src, origin).toString();
    try {
      const imageResponse = await fetchChecked(fetchImpl, absoluteImageUrl);
      if (!imageResponse.ok) errors.push(`visual gaf HTTP ${imageResponse.status}: ${expected.src}`);
      if (!String(imageResponse.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
        errors.push(`visual heeft geen image content-type: ${expected.src}`);
      }
    } catch (error) {
      errors.push(`visual kon niet worden gelezen ${expected.src}: ${error.message || String(error)}`);
    }
    checkedImages.push(absoluteImageUrl);
    if (!normalizedSitemapLocations.has(normalizePublicUrl(absoluteImageUrl))) {
      errors.push(`visual ontbreekt in image-sitemaplocaties: ${expected.src}`);
    }
  }

  const schemaNodes = flattenSchemaNodes(parseJsonLd(document));
  if (schemaNodes.some((node) => node.__invalid)) errors.push('JSON-LD bevat ongeldige JSON.');
  if (item) {
    const entityTypes = item.schemaType === 'Service' ? ['Service'] : ['Article', 'BlogPosting'];
    const entity = schemaNodes.find((node) => schemaHasType(node, entityTypes));
    if (!entity) errors.push(`${entityTypes.join('/')}-schema ontbreekt.`);
    const hero = images[0];
    const heroUrl = hero ? new URL(hero.src, origin).toString() : null;
    const imageObjects = getSchemaImages(entity);
    const heroObject = imageObjects.find((image) => {
      if (!schemaHasType(image, ['ImageObject'])) return false;
      try { return normalizePublicUrl(image.contentUrl) === normalizePublicUrl(heroUrl); } catch { return false; }
    });
    if (heroUrl && !heroObject) errors.push(`${entityTypes[0]}-schema mist een ImageObject voor het hero-beeld.`);
    if (heroObject && hero && (
      Number(heroObject.width) !== hero.width
      || Number(heroObject.height) !== hero.height
    )) errors.push(`${entityTypes[0]} ImageObject-dimensies wijken af van de contentbrief.`);

    const ogImage = findMetaContent(document, 'property', 'og:image').trim();
    const ogImageWidth = Number(findMetaContent(document, 'property', 'og:image:width'));
    const ogImageHeight = Number(findMetaContent(document, 'property', 'og:image:height'));
    let ogImageMatches = false;
    try { ogImageMatches = normalizePublicUrl(ogImage) === normalizePublicUrl(heroUrl); } catch { /* handled below */ }
    if (!ogImageMatches) errors.push('og:image wijkt af van het representatieve hero-beeld.');
    if (hero && (ogImageWidth !== hero.width || ogImageHeight !== hero.height)) {
      errors.push('og:image-dimensies ontbreken of wijken af van de contentbrief.');
    }
    if (!robots.includes('max-image-preview:large')) errors.push('max-image-preview:large ontbreekt.');
  }

  return {
    status: errors.length ? 'blocked' : 'ready',
    errors,
    summary: {
      url: canonicalTarget,
      liveCommit: healthCommit || null,
      routeStatus,
      canonical: canonical || null,
      title,
      h1: h1Values[0] || null,
      sitemap: normalizedSitemapLocations.has(canonicalTarget),
      contentItem: item ? `${item.collection}/${item.slug}` : null,
      expectedImages: images.map((image) => image.src),
      checkedImages: checkedImages.length,
      imageObject: item ? !errors.some((error) => /ImageObject/.test(error)) : null,
      ogImageDimensions: item ? !errors.some((error) => /og:image/.test(error)) : null,
      whatsappLinks: anchors.filter((href) => href.includes('wa.me/')).length,
      supportingAction: supportingResult.summary,
    },
  };
}

module.exports = {
  collectXmlLocations,
  expectedContentImages,
  findCanonical,
  normalizePublicUrl,
  normalizePathname,
  parseJsonLd,
  resolveContentItem,
  runSeoMachineLiveRouteCheck,
  verifySupportingAction,
};
