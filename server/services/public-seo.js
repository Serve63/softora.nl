const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const DEFAULT_OG_IMAGE_PATH = '/assets/home-hero-generated-v2.jpg';
const DEFAULT_LOGO_PATH = '/assets/61C2BCF5-70E9-4789-AFDE-FA18C862D58A.PNG';

const INDEXABLE_PUBLIC_SEO_PAGES = Object.freeze([
  {
    fileName: 'premium-website.html',
    path: '/',
    title: 'Softora | Websites, software en AI automatisering',
    description:
      'Softora bouwt snelle websites, bedrijfssoftware en AI automatisering voor ondernemers die meer aanvragen, minder handwerk en slimmere groei willen.',
    kind: 'home',
  },
  {
    fileName: 'premium-websites.html',
    path: '/premium-websites',
    title: 'Website laten maken door Softora',
    description:
      'Laat een snelle, overtuigende website maken door Softora met sterke uitstraling, heldere structuur en focus op offerteaanvragen.',
    kind: 'service',
    serviceName: 'Webdesign en website ontwikkeling',
  },
  {
    fileName: 'diensten.html',
    path: '/diensten',
    title: 'Softora diensten voor websites, software en AI',
    description:
      'Bekijk de Softora diensten voor websites, AI automatisering, bedrijfssoftware, CRM systemen, chatbots en voice software.',
    kind: 'collection',
  },
  {
    fileName: 'website-laten-maken.html',
    path: '/website-laten-maken',
    title: 'Website laten maken door Softora',
    description:
      'Website laten maken die snel laadt, professioneel voelt en gericht is op aanvragen. Softora bouwt websites voor ondernemers die willen groeien.',
    kind: 'service',
    serviceName: 'Website laten maken',
  },
  {
    fileName: 'ai-automatisering.html',
    path: '/ai-automatisering',
    title: 'AI automatisering voor bedrijven door Softora',
    description:
      'AI automatisering voor bedrijven die minder handwerk, snellere opvolging en slimmere processen willen. Softora bouwt praktische AI workflows.',
    kind: 'service',
    serviceName: 'AI automatisering',
  },
  {
    fileName: 'premium-bedrijfssoftware.html',
    path: '/premium-bedrijfssoftware',
    title: 'Bedrijfssoftware op maat door Softora',
    description:
      'Softora bouwt bedrijfssoftware op maat voor dashboards, klantbeheer, processen, automatisering en interne tools die dagelijks werk versnellen.',
    kind: 'service',
    serviceName: 'Bedrijfssoftware op maat',
  },
  {
    fileName: 'bedrijfssoftware-op-maat.html',
    path: '/bedrijfssoftware-op-maat',
    title: 'Bedrijfssoftware op maat laten maken',
    description:
      'Bedrijfssoftware op maat laten maken voor dashboards, klantbeheer, interne processen en automatisering. Softora bouwt software die met je bedrijf meewerkt.',
    kind: 'service',
    serviceName: 'Bedrijfssoftware op maat',
  },
  {
    fileName: 'crm-systeem-op-maat.html',
    path: '/crm-systeem-op-maat',
    title: 'CRM systeem op maat laten maken',
    description:
      'CRM systeem op maat laten maken voor leads, klanten, afspraken, opvolging en sales overzicht. Softora bouwt klantbeheer dat past bij jouw bedrijf.',
    kind: 'service',
    serviceName: 'CRM systeem op maat',
  },
  {
    fileName: 'maatwerk-platform.html',
    path: '/maatwerk-platform',
    title: 'Maatwerk platform laten bouwen',
    description:
      'Softora ontwikkelt maatwerk platformen, databases en softwareoplossingen voor bedrijven die hun processen professioneel willen digitaliseren.',
    kind: 'service',
    serviceName: 'Maatwerk platform ontwikkeling',
  },
  {
    fileName: 'ai-telefonist.html',
    path: '/ai-telefonist',
    title: 'AI telefonist voor het MKB',
    description:
      'Softora bouwt een AI telefonist die telefoontjes opneemt, klanten kwalificeert, afspraken plant en samenvattingen doorstuurt.',
    kind: 'service',
    serviceName: 'AI telefonist',
  },
  {
    fileName: 'premium-voicesoftware.html',
    path: '/premium-voicesoftware',
    title: 'Voicesoftware op maat door Softora',
    description:
      'Softora maakt voicesoftware en AI telefonie op maat voor bereikbaarheid, gespreksafhandeling, opvolging en slimme automatisering.',
    kind: 'service',
    serviceName: 'Voicesoftware op maat',
  },
  {
    fileName: 'premium-chatbot.html',
    path: '/premium-chatbot',
    title: 'Chatbot op maat door Softora',
    description:
      'Softora bouwt chatbots op maat die bezoekers helpen, leads kwalificeren, vragen beantwoorden en jouw bedrijf online sneller laten reageren.',
    kind: 'service',
    serviceName: 'Chatbot op maat',
  },
  {
    fileName: 'chatbot-laten-maken.html',
    path: '/chatbot-laten-maken',
    title: 'Chatbot laten maken door Softora',
    description:
      'Chatbot laten maken voor je website, klantenservice of leadgeneratie. Softora bouwt AI chatbots die bezoekers helpen en aanvragen beter kwalificeren.',
    kind: 'service',
    serviceName: 'Chatbot laten maken',
  },
  {
    fileName: 'premium-over-softora.html',
    path: '/premium-over-softora',
    title: 'Over Softora',
    description:
      'Lees meer over Softora, de werkwijze en de focus op websites, software en AI oplossingen die ondernemers praktisch verder helpen.',
    kind: 'about',
  },
  {
    fileName: 'premium-algemene-voorwaarden.html',
    path: '/premium-algemene-voorwaarden',
    title: 'Algemene voorwaarden van Softora',
    description:
      'Bekijk de algemene voorwaarden van Softora voor afspraken, levering, samenwerking en gebruik van diensten.',
    kind: 'legal',
  },
  {
    fileName: 'premium-privacy-policy.html',
    path: '/premium-privacy-policy',
    title: 'Privacybeleid van Softora',
    description:
      'Lees hoe Softora omgaat met persoonsgegevens, privacy, beveiliging en gegevensverwerking binnen de dienstverlening.',
    kind: 'legal',
  },
]);

const INDEXABLE_PAGE_BY_FILE = new Map(
  INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => [entry.fileName, Object.freeze({ ...entry })])
);

function normalizeSiteOrigin(valueRaw = DEFAULT_SITE_ORIGIN) {
  const raw = String(valueRaw || '').trim() || DEFAULT_SITE_ORIGIN;
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return DEFAULT_SITE_ORIGIN;
    return `${parsed.protocol}//${parsed.host}`.replace(/\/+$/, '');
  } catch {
    return DEFAULT_SITE_ORIGIN;
  }
}

function escapeXml(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtmlAttribute(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function normalizeKnownHtmlPageFiles(knownHtmlPageFiles) {
  if (knownHtmlPageFiles instanceof Set) return knownHtmlPageFiles;
  if (Array.isArray(knownHtmlPageFiles)) return new Set(knownHtmlPageFiles);
  return new Set();
}

function getIndexablePublicSeoPage(fileNameRaw) {
  return INDEXABLE_PAGE_BY_FILE.get(String(fileNameRaw || '').trim()) || null;
}

function isIndexablePublicHtmlFile(fileNameRaw) {
  return Boolean(getIndexablePublicSeoPage(fileNameRaw));
}

function getIndexablePublicPathFromHtmlFile(fileNameRaw) {
  const entry = getIndexablePublicSeoPage(fileNameRaw);
  return entry ? entry.path : '';
}

function buildAbsoluteUrl(siteOriginRaw, pathNameRaw) {
  const siteOrigin = normalizeSiteOrigin(siteOriginRaw);
  const pathName = String(pathNameRaw || '/').trim() || '/';
  return pathName === '/' ? `${siteOrigin}/` : `${siteOrigin}${pathName}`;
}

function getIndexablePublicSeoPages(knownHtmlPageFiles) {
  const knownFiles = normalizeKnownHtmlPageFiles(knownHtmlPageFiles);
  return INDEXABLE_PUBLIC_SEO_PAGES.filter((entry) => knownFiles.size === 0 || knownFiles.has(entry.fileName));
}

function buildPublicSeoSitemapXml({ knownHtmlPageFiles, siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const entries = getIndexablePublicSeoPages(knownHtmlPageFiles);
  const urlItems = entries
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(buildAbsoluteUrl(siteOrigin, entry.path))}</loc>`,
        '  </url>',
      ].join('\n')
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlItems,
    '</urlset>',
    '',
  ].join('\n');
}

function toPrettyPathFromFileName(fileNameRaw) {
  const fileName = String(fileNameRaw || '').trim();
  if (!/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
  const slug = fileName.replace(/\.html$/i, '');
  if (!slug || slug === 'index') return '/';
  return `/${slug}`;
}

function buildPublicSeoRobotsTxt({ knownHtmlPageFiles, siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const indexablePaths = new Set(getIndexablePublicSeoPages(knownHtmlPageFiles).map((entry) => entry.path));
  const disallowPaths = new Set([
    '/api/',
    '/premium-personeel-login',
    '/premium-pakketten',
    '/premium-seo',
    '/premium-websitegenerator',
    '/premium-bevestigingsmails',
    '/premium-blog',
    '/actieve-opdrachten',
    '/opdracht-preview',
    '/personeel-dashboard',
    '/personeel-agenda',
    '/personeel-login',
  ]);

  for (const fileName of normalizeKnownHtmlPageFiles(knownHtmlPageFiles)) {
    const prettyPath = toPrettyPathFromFileName(fileName);
    if (!prettyPath || prettyPath === '/' || indexablePaths.has(prettyPath)) continue;
    if (prettyPath === '/premium-website') continue;
    if (/^\/premium-/i.test(prettyPath) || /^\/personeel-/i.test(prettyPath)) {
      disallowPaths.add(prettyPath);
    }
  }

  const lines = ['User-agent: *', 'Allow: /'];
  Array.from(disallowPaths)
    .sort((a, b) => a.localeCompare(b))
    .forEach((pathName) => lines.push(`Disallow: ${pathName}`));

  lines.push('', `Sitemap: ${buildAbsoluteUrl(siteOrigin, '/sitemap.xml')}`, '');
  return lines.join('\n');
}

function hasTag(html, pattern) {
  return pattern.test(String(html || ''));
}

function injectBeforeHeadClose(htmlRaw, snippet) {
  const html = String(htmlRaw || '');
  if (!snippet) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  }
  return `${snippet}\n${html}`;
}

function upsertCanonical(htmlRaw, canonicalUrl) {
  const html = String(htmlRaw || '');
  const escaped = escapeHtmlAttribute(canonicalUrl);
  const tag = `<link rel="canonical" href="${escaped}">`;
  if (/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.test(html)) {
    return html.replace(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i, tag);
  }
  return injectBeforeHeadClose(html, `    ${tag}`);
}

function addMetaIfMissing(htmlRaw, selectorAttr, selectorValue, content) {
  const html = String(htmlRaw || '');
  const attr = String(selectorAttr || '').trim();
  const selector = String(selectorValue || '').trim();
  const value = String(content || '').trim();
  if (!attr || !selector || !value) return html;

  const existing = new RegExp(`<meta\\b[^>]*${attr}\\s*=\\s*["']${selector}["'][^>]*>`, 'i');
  if (existing.test(html)) return html;
  const tag = `<meta ${attr}="${escapeHtmlAttribute(selector)}" content="${escapeHtmlAttribute(value)}">`;
  return injectBeforeHeadClose(html, `    ${tag}`);
}

function addTitleIfMissing(htmlRaw, title) {
  const html = String(htmlRaw || '');
  const value = String(title || '').trim();
  if (!value || /<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) return html;
  return injectBeforeHeadClose(html, `    <title>${escapeHtmlAttribute(value)}</title>`);
}

function buildStructuredDataGraph(entry, siteOriginRaw) {
  const siteOrigin = normalizeSiteOrigin(siteOriginRaw);
  const pageUrl = buildAbsoluteUrl(siteOrigin, entry.path);
  const logoUrl = buildAbsoluteUrl(siteOrigin, DEFAULT_LOGO_PATH);
  const graph = [
    {
      '@type': 'Organization',
      '@id': `${siteOrigin}/#organization`,
      name: 'Softora',
      url: `${siteOrigin}/`,
      logo: logoUrl,
      email: 'info@softora.nl',
    },
    {
      '@type': 'WebSite',
      '@id': `${siteOrigin}/#website`,
      url: `${siteOrigin}/`,
      name: 'Softora',
      inLanguage: 'nl-NL',
      publisher: { '@id': `${siteOrigin}/#organization` },
    },
    {
      '@type': entry.kind === 'about' ? 'AboutPage' : 'WebPage',
      '@id': `${pageUrl}#webpage`,
      url: pageUrl,
      name: entry.title,
      description: entry.description,
      inLanguage: 'nl-NL',
      isPartOf: { '@id': `${siteOrigin}/#website` },
      about: { '@id': `${siteOrigin}/#organization` },
    },
  ];

  if (entry.kind === 'service') {
    graph.push({
      '@type': 'Service',
      '@id': `${pageUrl}#service`,
      name: entry.serviceName || entry.title,
      description: entry.description,
      provider: { '@id': `${siteOrigin}/#organization` },
      areaServed: {
        '@type': 'Country',
        name: 'Nederland',
      },
      url: pageUrl,
    });
  }

  if (entry.path !== '/') {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${pageUrl}#breadcrumb`,
      itemListElement: [
        {
          '@type': 'ListItem',
          position: 1,
          name: 'Home',
          item: `${siteOrigin}/`,
        },
        {
          '@type': 'ListItem',
          position: 2,
          name: entry.title,
          item: pageUrl,
        },
      ],
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}

function addStructuredDataIfMissing(htmlRaw, entry, siteOrigin) {
  const html = String(htmlRaw || '');
  if (/data-softora-public-seo=["']structured-data["']/i.test(html)) return html;
  const json = escapeHtmlJson(buildStructuredDataGraph(entry, siteOrigin));
  const snippet = `    <script type="application/ld+json" data-softora-public-seo="structured-data">${json}</script>`;
  return injectBeforeHeadClose(html, snippet);
}

function applyPublicSeoHeadDefaults(htmlRaw, fileNameRaw, { siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const entry = getIndexablePublicSeoPage(fileNameRaw);
  let html = String(htmlRaw || '');
  if (!entry || !html) return html;

  const pageUrl = buildAbsoluteUrl(siteOrigin, entry.path);
  const imageUrl = buildAbsoluteUrl(siteOrigin, DEFAULT_OG_IMAGE_PATH);

  html = addTitleIfMissing(html, entry.title);
  html = addMetaIfMissing(html, 'name', 'description', entry.description);
  html = addMetaIfMissing(html, 'name', 'robots', 'index, follow');
  html = upsertCanonical(html, pageUrl);
  html = addMetaIfMissing(html, 'property', 'og:type', entry.kind === 'home' ? 'website' : 'article');
  html = addMetaIfMissing(html, 'property', 'og:site_name', 'Softora');
  html = addMetaIfMissing(html, 'property', 'og:locale', 'nl_NL');
  html = addMetaIfMissing(html, 'property', 'og:title', entry.title);
  html = addMetaIfMissing(html, 'property', 'og:description', entry.description);
  html = addMetaIfMissing(html, 'property', 'og:url', pageUrl);
  html = addMetaIfMissing(html, 'property', 'og:image', imageUrl);
  html = addMetaIfMissing(html, 'name', 'twitter:card', 'summary_large_image');
  html = addMetaIfMissing(html, 'name', 'twitter:title', entry.title);
  html = addMetaIfMissing(html, 'name', 'twitter:description', entry.description);
  html = addMetaIfMissing(html, 'name', 'twitter:image', imageUrl);
  html = addStructuredDataIfMissing(html, entry, siteOrigin);

  if (!hasTag(html, /<html\b[^>]*lang=["']nl["']/i)) {
    html = html.replace(/<html\b([^>]*)>/i, '<html$1 lang="nl">');
  }

  return html;
}

module.exports = {
  DEFAULT_SITE_ORIGIN,
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
  buildPublicSeoRobotsTxt,
  buildPublicSeoSitemapXml,
  getIndexablePublicPathFromHtmlFile,
  getIndexablePublicSeoPage,
  getIndexablePublicSeoPages,
  isIndexablePublicHtmlFile,
  normalizeSiteOrigin,
};
