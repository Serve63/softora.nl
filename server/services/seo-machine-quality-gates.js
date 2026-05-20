const DEFAULT_COMMERCIAL_TARGETS = Object.freeze([
  '/website-laten-maken',
  '/ai-automatisering',
  '/bedrijfssoftware-op-maat',
  '/crm-systeem-op-maat',
  '/chatbot-laten-maken',
  '/ai-telefonist',
  '/voicesoftware-op-maat',
  '/diensten',
  '/pakketten',
]);

const DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS = Object.freeze({
  '/diensten': 8,
  '/website-laten-maken': 8,
  '/ai-automatisering': 8,
  '/bedrijfssoftware-op-maat': 8,
  '/crm-systeem-op-maat': 6,
  '/chatbot-laten-maken': 6,
  '/ai-telefonist': 5,
  '/voicesoftware-op-maat': 5,
  '/pakketten': 5,
});

function normalizeInternalPath(valueRaw) {
  const raw = String(valueRaw || '').trim();
  if (!raw || raw.startsWith('#')) return '';
  if (/^(mailto|tel|sms|javascript|data):/i.test(raw)) return '';

  let pathName = raw;
  try {
    const parsed = new URL(raw, 'https://www.softora.nl');
    if (parsed.origin !== 'https://www.softora.nl') return '';
    pathName = parsed.pathname;
  } catch {
    pathName = raw.split('?')[0].split('#')[0];
  }

  if (!pathName.startsWith('/')) return '';
  pathName = pathName.replace(/\/{2,}/g, '/');
  if (pathName.length > 1) pathName = pathName.replace(/\/+$/, '');
  return pathName || '/';
}

function extractInternalLinksFromHtml(htmlRaw) {
  return Array.from(String(htmlRaw || '').matchAll(/href=["']([^"']+)["']/gi))
    .map((match) => normalizeInternalPath(match[1]))
    .filter(Boolean);
}

function buildSeoLinkGraph(pagesRaw = []) {
  const pages = Array.isArray(pagesRaw) ? pagesRaw : [];
  const publicPaths = new Set(pages.map((page) => normalizeInternalPath(page.path)).filter(Boolean));
  const outgoingByPath = new Map();
  const incomingByPath = new Map();

  for (const pathName of publicPaths) {
    outgoingByPath.set(pathName, new Set());
    incomingByPath.set(pathName, new Set());
  }

  for (const page of pages) {
    const sourcePath = normalizeInternalPath(page.path);
    if (!sourcePath || !publicPaths.has(sourcePath)) continue;

    for (const targetPath of new Set(extractInternalLinksFromHtml(page.html))) {
      if (targetPath === sourcePath || !publicPaths.has(targetPath)) continue;
      outgoingByPath.get(sourcePath).add(targetPath);
      incomingByPath.get(targetPath).add(sourcePath);
    }
  }

  return {
    paths: Array.from(publicPaths).sort(),
    incomingByPath,
    outgoingByPath,
  };
}

function countWords(valueRaw) {
  return String(valueRaw || '').trim().split(/\s+/).filter(Boolean).length;
}

function getItemWordCount(item) {
  return (item.sections || []).reduce((total, section) => {
    const headingWords = countWords(section.heading);
    const paragraphWords = (section.paragraphs || []).reduce((sum, paragraph) => sum + countWords(paragraph), 0);
    return total + headingWords + paragraphWords;
  }, countWords(item.summary));
}

function auditContentQuality({ items = [], clusters = [], commercialTargets = DEFAULT_COMMERCIAL_TARGETS } = {}) {
  const issues = [];
  const seenPaths = new Set();
  const clusterKeys = new Set(clusters.map((cluster) => String(cluster.key || '').trim()).filter(Boolean));
  const targetSet = new Set(commercialTargets.map(normalizeInternalPath).filter(Boolean));

  for (const item of Array.isArray(items) ? items : []) {
    const pathName = normalizeInternalPath(`/${item.collection || ''}/${item.slug || ''}`);
    const relatedLinks = Array.isArray(item.relatedLinks) ? item.relatedLinks : [];
    const relatedTargets = relatedLinks.map((link) => normalizeInternalPath(link.href)).filter(Boolean);
    const pageLabel = pathName || item.slug || item.title || 'onbekende content';

    if (!pathName || seenPaths.has(pathName)) {
      issues.push({ type: 'duplicate-path', path: pathName, message: `${pageLabel} heeft geen uniek pad.` });
    }
    seenPaths.add(pathName);

    if (String(item.title || '').trim().length < 20) {
      issues.push({ type: 'thin-title', path: pathName, message: `${pageLabel} heeft een te zwakke titel.` });
    }
    if (String(item.description || '').trim().length < 80) {
      issues.push({ type: 'thin-description', path: pathName, message: `${pageLabel} heeft een te korte meta description.` });
    }
    if ((item.sections || []).length < 3) {
      issues.push({ type: 'thin-sections', path: pathName, message: `${pageLabel} heeft minder dan drie inhoudsblokken.` });
    }
    if (getItemWordCount(item) < 140) {
      issues.push({ type: 'thin-body', path: pathName, message: `${pageLabel} heeft te weinig inhoud voor SEO.` });
    }
    if (relatedLinks.length < 3) {
      issues.push({ type: 'weak-related-links', path: pathName, message: `${pageLabel} heeft te weinig interne links.` });
    }
    if (!relatedTargets.every(Boolean) || relatedTargets.length !== relatedLinks.length) {
      issues.push({ type: 'invalid-related-link', path: pathName, message: `${pageLabel} bevat een ongeldige interne link.` });
    }
    if (!relatedTargets.some((href) => targetSet.has(href))) {
      issues.push({ type: 'missing-commercial-link', path: pathName, message: `${pageLabel} linkt niet naar een money page.` });
    }
    if (!clusterKeys.has(String(item.cluster || '').trim())) {
      issues.push({ type: 'missing-cluster', path: pathName, message: `${pageLabel} hangt niet aan een bekend SEO-cluster.` });
    }
  }

  return issues;
}

function auditLinkGraph({ graph, requiredIncoming = DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS } = {}) {
  const issues = [];
  if (!graph || !(graph.incomingByPath instanceof Map)) {
    return [{ type: 'missing-link-graph', path: '', message: 'De interne linkgraph ontbreekt.' }];
  }

  for (const [pathRaw, minimumRaw] of Object.entries(requiredIncoming || {})) {
    const pathName = normalizeInternalPath(pathRaw);
    const minimum = Number(minimumRaw) || 0;
    const incomingCount = graph.incomingByPath.get(pathName)?.size || 0;
    if (incomingCount < minimum) {
      issues.push({
        type: 'weak-money-page-internal-links',
        path: pathName,
        message: `${pathName} heeft ${incomingCount} interne ingangen, minimaal ${minimum} verwacht.`,
      });
    }
  }

  return issues;
}

function isConversionHref(hrefRaw) {
  const href = String(hrefRaw || '').trim();
  if (/^mailto:/i.test(href)) return true;
  return href === '#contact' || href === '/#contact' || href.endsWith('/#contact');
}

function auditConversionCtas({ pages = [] } = {}) {
  const issues = [];

  for (const page of Array.isArray(pages) ? pages : []) {
    const pathName = normalizeInternalPath(page.path);
    const html = String(page.html || '');
    const conversionLinks = Array.from(html.matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>/gi)).filter((match) =>
      isConversionHref(match[2])
    );
    const annotatedLinks = conversionLinks.filter((match) => /data-softora-conversion=["'][^"']+["']/i.test(match[1]));

    if (conversionLinks.length === 0) {
      issues.push({ type: 'missing-conversion-link', path: pathName, message: `${pathName} heeft geen meetbare CTA-route.` });
      continue;
    }
    if (annotatedLinks.length !== conversionLinks.length) {
      issues.push({ type: 'untracked-conversion-link', path: pathName, message: `${pathName} heeft CTA-links zonder meetlabel.` });
    }
  }

  return issues;
}

module.exports = {
  DEFAULT_COMMERCIAL_TARGETS,
  DEFAULT_MONEY_PAGE_INCOMING_REQUIREMENTS,
  auditContentQuality,
  auditConversionCtas,
  auditLinkGraph,
  buildSeoLinkGraph,
  extractInternalLinksFromHtml,
  normalizeInternalPath,
};
