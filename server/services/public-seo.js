const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const DEFAULT_OG_IMAGE_PATH = '/assets/softora-office-digital-growth.jpg';
const DEFAULT_LOGO_PATH = '/assets/61C2BCF5-70E9-4789-AFDE-FA18C862D58A.PNG';
const { getSeoContentPublicPaths, getSeoContentSitemapEntries } = require('./seo-content');

const INDEXABLE_PUBLIC_SEO_PAGES = Object.freeze([
  {
    fileName: 'premium-website.html',
    path: '/',
    title: 'Softora | Websites, software en AI automatisering',
    description:
      'Softora bouwt snelle websites, bedrijfssoftware en AI automatisering voor ondernemers die meer aanvragen, minder handwerk en slimmere groei willen.',
    kind: 'home',
    legacyPaths: ['/premium-website'],
    relatedLinks: ['/diensten', '/website-laten-maken', '/blog', '/kennisbank'],
  },
  {
    fileName: 'diensten.html',
    path: '/diensten',
    title: 'Softora diensten voor websites, software en AI',
    description:
      'Bekijk de Softora diensten voor websites, bedrijfssoftware, CRM, AI automatisering, chatbots en AI telefonie voor groeiende ondernemers.',
    kind: 'collection',
    relatedLinks: [
      '/website-laten-maken',
      '/ai-automatisering',
      '/bedrijfssoftware-op-maat',
      '/crm-systeem-op-maat',
      '/maatwerk-platform',
      '/pakketten',
      '/over-softora',
    ],
  },
  {
    fileName: 'premium-websites.html',
    path: '/website-laten-maken',
    legacyPaths: ['/premium-websites'],
    title: 'Website laten maken voor meer aanvragen',
    description:
      "Laat een snelle, SEO-vriendelijke website maken door Softora met sterke structuur, duidelijke dienstenpagina's en focus op offerteaanvragen.",
    kind: 'service',
    serviceName: 'Webdesign en website ontwikkeling',
    relatedLinks: [
      '/blog/website-laten-maken-kosten-2026',
      '/blog/website-laten-maken-mkb-paginas',
      '/kennisbank/wat-is-een-conversiegerichte-website',
      '/website-laten-maken-oisterwijk',
      '/crm-systeem-op-maat',
      '/pakketten',
      '/kennisbank',
    ],
  },
  {
    fileName: 'website-laten-maken-oisterwijk.html',
    path: '/website-laten-maken-oisterwijk',
    title: 'Website laten maken Oisterwijk door Softora',
    description:
      'Softora bouwt snelle, professionele websites voor ondernemers in Oisterwijk met lokale SEO, duidelijke structuur en focus op aanvragen.',
    kind: 'service',
    serviceName: 'Website laten maken Oisterwijk',
    relatedLinks: ['/website-laten-maken', '/regio/oisterwijk', '/blog/website-laten-maken-kosten-2026', '/diensten'],
  },
  {
    fileName: 'premium-bedrijfssoftware.html',
    path: '/bedrijfssoftware-op-maat',
    legacyPaths: ['/premium-bedrijfssoftware'],
    title: 'Bedrijfssoftware op maat laten maken',
    description:
      'Laat bedrijfssoftware op maat maken voor CRM, dashboards, klantbeheer, offertes, planning en AI automatisering die dagelijks werk versnelt.',
    kind: 'service',
    serviceName: 'Bedrijfssoftware op maat',
    relatedLinks: [
      '/crm-systeem-op-maat',
      '/maatwerk-platform',
      '/kennisbank/wat-is-bedrijfssoftware-op-maat',
      '/ai-automatisering',
      '/vergelijkingen/maatwerk-software-vs-standaard-software',
    ],
  },
  {
    fileName: 'crm-systeem-op-maat.html',
    path: '/crm-systeem-op-maat',
    title: 'CRM systeem op maat laten maken',
    description:
      'Laat een CRM systeem op maat maken door Softora voor leadpipeline, klantbeheer, offertes, dashboards, reminders en AI-opvolging.',
    kind: 'service',
    serviceName: 'CRM systeem op maat',
    relatedLinks: [
      '/bedrijfssoftware-op-maat',
      '/ai-automatisering',
      '/chatbot-laten-maken',
      '/voicesoftware-op-maat',
      '/kennisbank/wat-is-bedrijfssoftware-op-maat',
      '/kennisbank/wat-is-een-crm-systeem',
      '/blog/crm-systeem-op-maat-spreadsheets-vervangen',
      '/blog/ai-automatisering-mkb-waar-beginnen',
    ],
  },
  {
    fileName: 'ai-automatisering.html',
    path: '/ai-automatisering',
    title: 'AI automatisering laten maken voor MKB',
    description:
      'Laat AI automatisering maken door Softora voor leadopvolging, intake, mailbox, CRM-flows, rapportages en veilige menselijke controle.',
    kind: 'service',
    serviceName: 'AI automatisering',
    relatedLinks: [
      '/crm-systeem-op-maat',
      '/chatbot-laten-maken',
      '/voicesoftware-op-maat',
      '/ai-telefonist',
      '/bedrijfssoftware-op-maat',
      '/kennisbank/wat-is-ai-automatisering',
      '/blog/ai-automatisering-mkb-waar-beginnen',
      '/blog/ai-automatisering-leadopvolging',
    ],
  },
  {
    fileName: 'maatwerk-platform.html',
    path: '/maatwerk-platform',
    title: 'Maatwerk platform laten bouwen',
    description:
      'Softora ontwikkelt maatwerk platformen, databases en softwareoplossingen voor bedrijven die hun processen professioneel willen digitaliseren.',
    kind: 'service',
    serviceName: 'Maatwerk platform ontwikkeling',
    relatedLinks: [
      '/bedrijfssoftware-op-maat',
      '/crm-systeem-op-maat',
      '/ai-automatisering',
      '/kennisbank/wat-is-bedrijfssoftware-op-maat',
      '/vergelijkingen/maatwerk-software-vs-standaard-software',
    ],
  },
  {
    fileName: 'ai-telefonist.html',
    path: '/ai-telefonist',
    title: 'AI telefonist laten maken voor het MKB',
    description:
      'Laat een AI telefonist maken door Softora voor intake, bereikbaarheid, leadkwalificatie, afspraakverzoeken en CRM-opvolging met menselijke controle.',
    kind: 'service',
    serviceName: 'AI telefonist',
    relatedLinks: [
      '/voicesoftware-op-maat',
      '/chatbot-laten-maken',
      '/ai-automatisering',
      '/crm-systeem-op-maat',
      '/kennisbank/wat-is-een-ai-telefonist',
      '/blog/ai-automatisering-mkb-waar-beginnen',
    ],
  },
  {
    fileName: 'premium-voicesoftware.html',
    path: '/voicesoftware-op-maat',
    legacyPaths: ['/premium-voicesoftware'],
    title: 'AI telefonie en voicesoftware op maat',
    description:
      'Laat voicesoftware en AI telefonie op maat maken door Softora voor bereikbaarheid, leadkwalificatie, afspraakintake, CRM-opvolging en veilige overdracht.',
    kind: 'service',
    serviceName: 'Voicesoftware op maat',
    relatedLinks: [
      '/ai-telefonist',
      '/crm-systeem-op-maat',
      '/ai-automatisering',
      '/chatbot-laten-maken',
      '/blog/ai-automatisering-mkb-waar-beginnen',
    ],
  },
  {
    fileName: 'premium-chatbot.html',
    path: '/chatbot-laten-maken',
    legacyPaths: ['/premium-chatbot'],
    title: 'Chatbot laten maken voor leads en support',
    description:
      'Laat een chatbot maken die websitebezoekers helpt, leads kwalificeert, veelgestelde vragen opvangt en gesprekken doorstuurt naar je team of CRM.',
    kind: 'service',
    serviceName: 'Chatbot laten maken',
    relatedLinks: [
      '/blog/chatbot-laten-maken-wanneer-zinvol',
      '/vergelijkingen/chatbot-vs-livechat',
      '/website-laten-maken',
      '/crm-systeem-op-maat',
      '/ai-automatisering',
      '/ai-telefonist',
    ],
  },
  {
    fileName: 'pakketten.html',
    path: '/pakketten',
    legacyPaths: ['/premium-pakketten'],
    title: 'Softora pakketten voor websites, software en AI groei',
    description:
      'Bekijk Softora pakketten voor websites, bedrijfssoftware, AI automatisering, beheer en doorontwikkeling. Kies de route voor meer verkeer, leads en rust.',
    kind: 'collection',
    relatedLinks: [
      '/website-laten-maken',
      '/bedrijfssoftware-op-maat',
      '/crm-systeem-op-maat',
      '/ai-automatisering',
      '/chatbot-laten-maken',
      '/voicesoftware-op-maat',
    ],
  },
  {
    fileName: 'premium-over-softora.html',
    path: '/over-softora',
    legacyPaths: ['/premium-over-softora'],
    title: 'Over Softora | Websites, software en AI voor het MKB',
    description:
      'Leer Softora kennen: digitaal bouwbureau uit Oisterwijk voor websites, bedrijfssoftware, CRM, chatbots en AI automatisering die verkeer en leads beter opvolgen.',
    kind: 'about',
    relatedLinks: [
      '/diensten',
      '/website-laten-maken',
      '/bedrijfssoftware-op-maat',
      '/ai-automatisering',
      '/crm-systeem-op-maat',
      '/blog',
    ],
  },
  {
    fileName: 'premium-algemene-voorwaarden.html',
    path: '/algemene-voorwaarden',
    legacyPaths: ['/premium-algemene-voorwaarden'],
    title: 'Algemene voorwaarden van Softora',
    description:
      'Bekijk de algemene voorwaarden van Softora voor afspraken, levering, samenwerking en gebruik van diensten.',
    kind: 'legal',
  },
  {
    fileName: 'premium-privacy-policy.html',
    path: '/privacybeleid',
    legacyPaths: ['/premium-privacy-policy'],
    title: 'Privacybeleid van Softora',
    description:
      'Lees hoe Softora omgaat met persoonsgegevens, privacy, beveiliging en gegevensverwerking binnen de dienstverlening.',
    kind: 'legal',
  },
]);

const INDEXABLE_PAGE_BY_FILE = new Map(
  INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => [
    entry.fileName,
    Object.freeze({
      ...entry,
      path: normalizePublicPath(entry.path),
      legacyPaths: Object.freeze((entry.legacyPaths || []).map(normalizePublicPath).filter(Boolean)),
    }),
  ])
);

const INDEXABLE_PAGE_BY_PATH = new Map(
  Array.from(INDEXABLE_PAGE_BY_FILE.values()).map((entry) => [entry.path, entry])
);

const LEGACY_PUBLIC_PATH_TO_PAGE = new Map(
  Array.from(INDEXABLE_PAGE_BY_FILE.values()).flatMap((entry) =>
    entry.legacyPaths.map((legacyPath) => [legacyPath, entry])
  )
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

function normalizePublicPath(valueRaw) {
  const raw = String(valueRaw || '').trim();
  if (!raw) return '';

  let pathName = raw;
  try {
    pathName = new URL(raw, DEFAULT_SITE_ORIGIN).pathname;
  } catch {
    pathName = raw.split('?')[0].split('#')[0];
  }

  if (!pathName.startsWith('/')) pathName = `/${pathName}`;
  pathName = pathName.replace(/\/{2,}/g, '/');
  if (pathName.length > 1) pathName = pathName.replace(/\/+$/, '');
  return pathName || '/';
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

function escapeHtmlText(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
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

function getIndexablePublicSeoPageByPath(pathNameRaw) {
  return INDEXABLE_PAGE_BY_PATH.get(normalizePublicPath(pathNameRaw)) || null;
}

function isIndexablePublicHtmlFile(fileNameRaw) {
  return Boolean(getIndexablePublicSeoPage(fileNameRaw));
}

function getIndexablePublicPathFromHtmlFile(fileNameRaw) {
  const entry = getIndexablePublicSeoPage(fileNameRaw);
  return entry ? entry.path : '';
}

function getIndexablePublicHtmlFileFromPath(pathNameRaw) {
  const entry = getIndexablePublicSeoPageByPath(pathNameRaw);
  return entry ? entry.fileName : '';
}

function getLegacyPublicSeoRedirectTargetPath(pathNameRaw) {
  const entry = LEGACY_PUBLIC_PATH_TO_PAGE.get(normalizePublicPath(pathNameRaw));
  return entry ? entry.path : '';
}

function buildAbsoluteUrl(siteOriginRaw, pathNameRaw) {
  const siteOrigin = normalizeSiteOrigin(siteOriginRaw);
  const pathName = String(pathNameRaw || '/').trim() || '/';
  return pathName === '/' ? `${siteOrigin}/` : `${siteOrigin}${pathName}`;
}

function getIndexablePublicSeoPages(knownHtmlPageFiles) {
  const knownFiles = normalizeKnownHtmlPageFiles(knownHtmlPageFiles);
  return Array.from(INDEXABLE_PAGE_BY_FILE.values()).filter(
    (entry) => knownFiles.size === 0 || knownFiles.has(entry.fileName)
  );
}

function buildPublicSeoSitemapXml({ knownHtmlPageFiles, siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  const entries = [...getIndexablePublicSeoPages(knownHtmlPageFiles), ...getSeoContentSitemapEntries()];
  const seenPaths = new Set();
  const urlItems = entries
    .filter((entry) => {
      const pathName = normalizePublicPath(entry.path);
      if (!pathName || seenPaths.has(pathName)) return false;
      seenPaths.add(pathName);
      return true;
    })
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(buildAbsoluteUrl(siteOrigin, entry.path))}</loc>`,
        entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '',
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n')
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
  const indexablePaths = new Set(
    getIndexablePublicSeoPages(knownHtmlPageFiles).flatMap((entry) => [entry.path, ...entry.legacyPaths])
  );
  getSeoContentPublicPaths().forEach((pathName) => indexablePaths.add(pathName));
  const disallowPaths = new Set([
    '/api/',
    '/premium-personeel-login',
    '/premium-pakketten',
    '/premium-seo',
    '/premium-websitegenerator',
    '/premium-bevestigingsmails',
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

function injectBeforeBodyClose(htmlRaw, snippet) {
  const html = String(htmlRaw || '');
  if (!snippet) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  }
  return `${html}\n${snippet}`;
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

const PUBLIC_SEO_INTERNAL_LINK_STYLE = [
  '    <style data-softora-public-seo="internal-link-style">',
  '      .softora-seo-footer-links{position:static;inset:auto;z-index:auto;display:block;width:auto;background:#fff;border-top:1px solid rgba(26,26,46,.08);border-bottom:0;box-shadow:none;backdrop-filter:none;padding:26px clamp(20px,6vw,80px);font-family:Inter,system-ui,sans-serif;color:#1a1a2e;text-transform:none;letter-spacing:0;}',
  '      .softora-seo-footer-links__inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:18px;flex-wrap:wrap;}',
  '      .softora-seo-footer-links__label{font-family:Oswald,Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8b2252;}',
  '      .softora-seo-footer-links a{font-size:13px;font-weight:700;text-decoration:none;color:#5f6270;}',
  '      .softora-seo-footer-links a:hover{color:#8b2252;}',
  '      .footer-legal[data-softora-public-seo]{flex-wrap:wrap;}',
  '    </style>',
].join('\n');

const PUBLIC_SEO_LINK_LABELS = Object.freeze({
  '/': 'Home',
  '/diensten': 'Alle diensten',
  '/website-laten-maken': 'Website laten maken',
  '/website-laten-maken-oisterwijk': 'Website laten maken Oisterwijk',
  '/bedrijfssoftware-op-maat': 'Bedrijfssoftware op maat',
  '/crm-systeem-op-maat': 'CRM systeem op maat',
  '/ai-automatisering': 'AI automatisering',
  '/maatwerk-platform': 'Maatwerk platform',
  '/ai-telefonist': 'AI telefonist',
  '/voicesoftware-op-maat': 'Voicesoftware op maat',
  '/chatbot-laten-maken': 'Chatbot laten maken',
  '/pakketten': 'Pakketten',
  '/over-softora': 'Over Softora',
  '/blog': 'Blog',
  '/kennisbank': 'Kennisbank',
  '/blog/ai-automatisering-mkb-waar-beginnen': 'AI automatisering voor het MKB',
  '/blog/website-laten-maken-kosten-2026': 'Website laten maken kosten 2026',
  '/blog/website-laten-maken-mkb-paginas': 'MKB website pagina’s',
  '/blog/chatbot-laten-maken-wanneer-zinvol': 'Wanneer is een chatbot slim?',
  '/kennisbank/wat-is-bedrijfssoftware-op-maat': 'Wat is bedrijfssoftware op maat?',
  '/kennisbank/wat-is-een-conversiegerichte-website': 'Wat is een conversiegerichte website?',
  '/kennisbank/wat-is-een-ai-telefonist': 'Wat is een AI telefonist?',
  '/regio/oisterwijk': 'Softora in Oisterwijk',
});

function getPublicSeoInternalLinks(entry) {
  if (!entry || entry.kind === 'legal') return [];
  const fallbackLinks = ['/diensten', '/blog', '/kennisbank', '/pakketten'];
  const candidates = [...(entry.relatedLinks || []), ...fallbackLinks]
    .map(normalizePublicPath)
    .filter((pathName) => pathName && pathName !== entry.path);
  const seen = new Set();
  return candidates
    .filter((pathName) => {
      if (seen.has(pathName)) return false;
      seen.add(pathName);
      return true;
    })
    .slice(0, 6)
    .map((pathName) => ({
      href: pathName,
      label: PUBLIC_SEO_LINK_LABELS[pathName] || pathName.replace(/^\//, '').replace(/-/g, ' '),
    }));
}

function addInternalLinksIfMissing(htmlRaw, entry) {
  let html = String(htmlRaw || '');
  if (/data-softora-public-seo=["']internal-links["']/i.test(html)) return html;
  const links = getPublicSeoInternalLinks(entry);
  if (links.length === 0) return html;

  if (!/data-softora-public-seo=["']internal-link-style["']/i.test(html)) {
    html = injectBeforeHeadClose(html, PUBLIC_SEO_INTERNAL_LINK_STYLE);
  }

  const linkItems = links
    .map((link) => `        <a href="${escapeHtmlAttribute(link.href)}">${escapeHtmlText(link.label)}</a>`)
    .join('\n');

  if (/<div\b[^>]*class=["'][^"']*\bfooter-legal\b[^"']*["'][^>]*>/i.test(html)) {
    return html.replace(
      /<div\b([^>]*class=["'][^"']*\bfooter-legal\b[^"']*["'][^>]*)>([\s\S]*?)<\/div>/i,
      (match, attrs, content) => {
        const existingHrefs = new Set(
          Array.from(String(content || '').matchAll(/href=["']([^"']+)["']/gi)).map((hrefMatch) =>
            normalizePublicPath(hrefMatch[1])
          )
        );
        const footerLinks = links
          .filter((link) => !existingHrefs.has(normalizePublicPath(link.href)))
          .map(
            (link) =>
              `                <a href="${escapeHtmlAttribute(link.href)}">${escapeHtmlText(link.label)}</a>`
          )
          .join('\n');
        const nextAttrs = /data-softora-public-seo=/i.test(attrs)
          ? attrs
          : `${attrs} data-softora-public-seo="internal-links"`;
        return `<div${nextAttrs}>${content}${footerLinks ? `\n${footerLinks}` : ''}</div>`;
      }
    );
  }

  const snippet = [
    '  <nav class="softora-seo-footer-links" data-softora-public-seo="internal-links" aria-label="Verder binnen Softora">',
    '    <div class="softora-seo-footer-links__inner">',
    '      <span class="softora-seo-footer-links__label">Verder binnen Softora</span>',
    linkItems,
    '    </div>',
    '  </nav>',
  ].join('\n');

  if (/<\/footer>/i.test(html)) {
    return html.replace(/<\/footer>/i, `${snippet}\n</footer>`);
  }

  return injectBeforeBodyClose(html, snippet);
}

function classifyConversionTarget(hrefRaw) {
  const href = String(hrefRaw || '').trim();
  if (/^https:\/\/wa\.me\/31643262792(?:[?#].*)?$/i.test(href)) return 'whatsapp';
  if (/^mailto:/i.test(href)) return 'mailto';
  if (/^tel:/i.test(href)) return 'phone';
  if (href === '#contact' || href === '/#contact' || href.endsWith('/#contact')) return 'contact';
  return '';
}

function addConversionTrackingAttributesIfMissing(htmlRaw, entry) {
  const html = String(htmlRaw || '');
  if (!entry) return html;

  return html.replace(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>/gi, (match, attrs, href) => {
    if (/data-softora-conversion=/i.test(attrs)) return match;

    const target = classifyConversionTarget(href);
    if (!target) return match;

    const trackingAttrs = [
      'data-softora-conversion="public-cta"',
      `data-softora-conversion-page="${escapeHtmlAttribute(entry.path)}"`,
      `data-softora-conversion-target="${escapeHtmlAttribute(target)}"`,
    ].join(' ');
    return `<a ${trackingAttrs}${attrs}>`;
  });
}

function addPublicConversionTrackingScriptIfMissing(htmlRaw) {
  const html = String(htmlRaw || '');
  if (hasTag(html, /<script\b[^>]*\bsrc=["']\/assets\/public-conversion-tracking\.js(?:\?[^"']*)?["'][^>]*>/i)) {
    return html;
  }

  return injectBeforeBodyClose(
    html,
    '    <script src="/assets/public-conversion-tracking.js?v=20260529a" defer></script>'
  );
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
  html = addInternalLinksIfMissing(html, entry);
  html = addConversionTrackingAttributesIfMissing(html, entry);
  html = addPublicConversionTrackingScriptIfMissing(html);

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
  getIndexablePublicHtmlFileFromPath,
  getIndexablePublicPathFromHtmlFile,
  getIndexablePublicSeoPage,
  getIndexablePublicSeoPageByPath,
  getIndexablePublicSeoPages,
  getLegacyPublicSeoRedirectTargetPath,
  getPublicSeoInternalLinks,
  isIndexablePublicHtmlFile,
  normalizePublicPath,
  normalizeSiteOrigin,
};
