const DEFAULT_SITE_ORIGIN = 'https://www.softora.nl';
const DEFAULT_OG_IMAGE_PATH = '/assets/home-hero-generated-v2.jpg';
const DEFAULT_LOGO_PATH = '/assets/61C2BCF5-70E9-4789-AFDE-FA18C862D58A.PNG';

const SEO_CONTENT_COLLECTIONS = Object.freeze({
  blog: Object.freeze({
    key: 'blog',
    path: '/blog',
    title: 'Softora Blog',
    description:
      'Praktische inzichten over websites, AI automatisering, bedrijfssoftware, chatbots en digitale groei voor ondernemers.',
    eyebrow: 'Inzichten',
    heading: 'Artikelen over websites, software en AI groei',
    intro:
      'Hier verzamelen we concrete lessen uit projecten, keuzes en veelgestelde vragen. Geen losse hype, maar bruikbare richting voor ondernemers die slimmer willen groeien.',
  }),
  kennisbank: Object.freeze({
    key: 'kennisbank',
    path: '/kennisbank',
    title: 'Softora Kennisbank',
    description:
      'Heldere uitleg over websites, bedrijfssoftware, AI automatisering en digitale processen voor ondernemers en teams.',
    eyebrow: 'Kennisbank',
    heading: 'Heldere uitleg voor betere digitale keuzes',
    intro:
      'De kennisbank is bedoeld als vaste SEO-basis: korte, duidelijke uitlegpagina’s die intern linken naar diensten en verdiepende artikelen.',
  }),
});

const SEO_CONTENT_ITEMS = Object.freeze([
  Object.freeze({
    collection: 'blog',
    slug: 'ai-automatisering-mkb-waar-beginnen',
    title: 'AI automatisering voor het MKB: waar begin je?',
    description:
      'Een praktische startgids voor ondernemers die AI automatisering willen inzetten zonder direct hun hele bedrijf te verbouwen.',
    category: 'AI ontwikkelingen',
    intent: 'Orientatie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'AI automatisering werkt het beste wanneer je begint bij herhaalbaar werk, duidelijke overdrachtsmomenten en meetbare tijdswinst.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Begin niet bij de tool, maar bij het proces',
        paragraphs: Object.freeze([
          'Veel bedrijven beginnen met de vraag welke AI tool ze moeten gebruiken. Dat voelt logisch, maar het is zelden het beste startpunt. De betere vraag is: welk terugkerend werk kost veel tijd, is duidelijk te beschrijven en levert direct waarde op als het sneller of consistenter gaat?',
          'Voor Softora-projecten kijken we daarom eerst naar processen zoals leadopvolging, offertevoorbereiding, klantenservice, intake, planning, rapportage en interne administratie. Daar zitten vaak taken die iedere week terugkomen en waar automatisering snel rust brengt.',
        ]),
      }),
      Object.freeze({
        heading: 'Kies eerst een klein maar belangrijk automatiseringspad',
        paragraphs: Object.freeze([
          'Een goede eerste AI automatisering is niet meteen een compleet bedrijfssysteem. Sterker nog: klein beginnen maakt de kans groter dat het goed werkt. Denk aan een intakeformulier dat automatisch een samenvatting maakt, een lead kwalificeert en een vervolgactie klaarzet.',
          'Ook een AI telefonist, chatbot of interne assistent kan klein starten. De basis is steeds hetzelfde: invoer verzamelen, beoordelen wat ermee moet gebeuren en het resultaat netjes doorzetten naar een mens of systeem.',
        ]),
      }),
      Object.freeze({
        heading: 'Maak succes meetbaar voordat je opschaalt',
        paragraphs: Object.freeze([
          'AI automatisering wordt pas serieus waardevol als je kunt meten wat er beter gaat. Meet bijvoorbeeld hoeveel minuten handwerk verdwijnen, hoeveel leads sneller opvolging krijgen, hoeveel fouten worden voorkomen en hoeveel klantvragen zonder vertraging worden beantwoord.',
          'Daarna kun je veilig uitbreiden. Niet door overal AI overheen te leggen, maar door bewezen workflows stap voor stap te koppelen aan je website, CRM, agenda of maatwerk software.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'website-laten-maken-kosten-2026',
    title: 'Website laten maken in 2026: wat bepaalt de prijs?',
    description:
      'Een nuchtere uitleg over websitekosten, van simpele bedrijfssite tot maatwerk platform met conversie, SEO en automatisering.',
    category: 'Websites',
    intent: 'Koopintentie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '7 min',
    summary:
      'De prijs van een website wordt vooral bepaald door strategie, ontwerp, techniek, content, koppelingen en hoeveel groei de site moet ondersteunen.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een website is niet alleen een paar schermen',
        paragraphs: Object.freeze([
          'Een goedkope website kan prima zijn als je alleen online vindbaar wilt zijn met basisinformatie. Maar zodra de website leads moet opleveren, sneller moet laden, goed moet indexeren en overtuigend moet aanvoelen, verandert de opdracht.',
          'Dan betaal je niet alleen voor pagina’s, maar voor structuur, tekst, techniek, conversiepunten, meetbaarheid en een systeem dat makkelijk kan meegroeien met nieuwe diensten, cases en SEO-content.',
        ]),
      }),
      Object.freeze({
        heading: 'Waar de meeste kosten in zitten',
        paragraphs: Object.freeze([
          'De grootste kosten zitten meestal in voorbereiding en afwerking. Denk aan de juiste paginastructuur, duidelijke teksten, mobiele layouts, formulieren, snelheid, redirects, metadata, analytics en koppelingen met bijvoorbeeld CRM of automatisering.',
          'Ook maatwerk maakt verschil. Een standaard landingspagina is eenvoudiger dan een offerteflow, klantportaal, dashboard of kennisbank die automatisch nieuwe content kan tonen.',
        ]),
      }),
      Object.freeze({
        heading: 'Goedkoper starten, slim uitbreiden',
        paragraphs: Object.freeze([
          'Voor SEO is het vaak slimmer om de basis eerst strak neer te zetten en daarna gericht uit te bouwen. Begin met sterke dienstenpagina’s, heldere interne links en een structuur waarin toekomstige artikelen logisch passen.',
          'Daarna kun je blogs, kennisbankartikelen, branchepagina’s en tools toevoegen zonder dat de site rommelig wordt. Zo groeit de website mee zonder dat je later alles opnieuw hoeft te bouwen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Website laten maken', href: '/website-laten-maken' }),
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Wat is bedrijfssoftware op maat?', href: '/kennisbank/wat-is-bedrijfssoftware-op-maat' }),
    ]),
  }),
  Object.freeze({
    collection: 'blog',
    slug: 'chatbot-laten-maken-wanneer-zinvol',
    title: 'Chatbot laten maken: wanneer is het slim?',
    description:
      'Wanneer een chatbot echt waarde toevoegt, welke vragen je vooraf moet beantwoorden en hoe je voorkomt dat bezoekers vastlopen.',
    category: 'Chatbots',
    intent: 'Orientatie',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '6 min',
    summary:
      'Een goede chatbot is geen gimmick, maar een duidelijke route voor veelgestelde vragen, intake, leadkwalificatie en snelle opvolging.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'Een chatbot is zinvol bij herhaalde vragen',
        paragraphs: Object.freeze([
          'Een chatbot werkt goed wanneer bezoekers vaak dezelfde vragen stellen. Denk aan prijzen, werkwijze, levertijd, beschikbaarheid, voorwaarden, intake of het verschil tussen diensten.',
          'Als die vragen nu via mail, telefoon of WhatsApp binnenkomen, kan een chatbot de eerste laag overnemen. Niet om mensen weg te houden, maar om sneller duidelijkheid te geven en betere leads door te sturen.',
        ]),
      }),
      Object.freeze({
        heading: 'De chatbot moet weten wanneer hij moet stoppen',
        paragraphs: Object.freeze([
          'De fout die veel bedrijven maken is dat een chatbot alles moet kunnen. Daardoor worden antwoorden vaag en raken bezoekers sneller gefrustreerd. Een sterke chatbot heeft juist duidelijke grenzen.',
          'Hij moet weten wanneer hij een vraag kan beantwoorden, wanneer hij een formulier moet starten en wanneer een mens moet overnemen. Die overdracht is vaak belangrijker dan de AI zelf.',
        ]),
      }),
      Object.freeze({
        heading: 'Koppel de chatbot aan echte vervolgstappen',
        paragraphs: Object.freeze([
          'Een chatbot levert pas veel op als het gesprek ergens eindigt. Bijvoorbeeld in een offerteaanvraag, afspraak, CRM-notitie, samenvatting of taak voor het team.',
          'Daarom kijken we bij Softora niet alleen naar het chatvenster, maar naar de hele flow erachter. De chatbot moet bijdragen aan omzet, tijdwinst of betere service.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Chatbot laten maken', href: '/chatbot-laten-maken' }),
      Object.freeze({ label: 'AI telefonist', href: '/ai-telefonist' }),
      Object.freeze({ label: 'AI automatisering voor het MKB', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
    ]),
  }),
  Object.freeze({
    collection: 'kennisbank',
    slug: 'wat-is-bedrijfssoftware-op-maat',
    title: 'Wat is bedrijfssoftware op maat?',
    description:
      'Een duidelijke uitleg van bedrijfssoftware op maat, wanneer het zinvol is en hoe je voorkomt dat software onnodig complex wordt.',
    category: 'Bedrijfssoftware',
    intent: 'Uitleg',
    publishedAt: '2026-05-19',
    updatedAt: '2026-05-19',
    readTime: '5 min',
    summary:
      'Bedrijfssoftware op maat is software die precies aansluit op je processen, rollen en data in plaats van andersom.',
    sections: Object.freeze([
      Object.freeze({
        heading: 'De korte uitleg',
        paragraphs: Object.freeze([
          'Bedrijfssoftware op maat is een digitaal systeem dat wordt gebouwd rondom de manier waarop jouw bedrijf werkt. Het kan gaan om een dashboard, CRM, planningstool, klantportaal, database, offertemodule of een combinatie daarvan.',
          'Het verschil met standaard software is dat je niet hoeft te werken volgens vaste schermen en beperkingen van een pakket. De software volgt je proces, mits dat proces duidelijk genoeg is om te vertalen naar logica, schermen en gegevens.',
        ]),
      }),
      Object.freeze({
        heading: 'Wanneer maatwerk logisch wordt',
        paragraphs: Object.freeze([
          'Maatwerk wordt interessant wanneer standaard software te veel omwegen veroorzaakt. Bijvoorbeeld wanneer medewerkers informatie dubbel invoeren, klantdata verspreid staat over meerdere tools of belangrijke rapportages handmatig worden gemaakt.',
          'Ook groei kan een reden zijn. Als een bedrijf meer aanvragen, klanten of interne taken krijgt, worden kleine handmatige stappen ineens duur. Een goed systeem haalt die herhaling eruit en maakt de belangrijkste informatie sneller zichtbaar.',
        ]),
      }),
      Object.freeze({
        heading: 'Zo houd je maatwerk beheersbaar',
        paragraphs: Object.freeze([
          'Goede maatwerk software begint niet met zoveel mogelijk functies. Het begint met de kernflow: welke informatie komt binnen, wie moet iets doen, welke status hoort erbij en wanneer is het klaar?',
          'Vanuit die kern kun je uitbreiden met automatisering, rollen, rapportages en koppelingen. Zo blijft het systeem bruikbaar en wordt het geen groot project dat niemand durft aan te passen.',
        ]),
      }),
    ]),
    relatedLinks: Object.freeze([
      Object.freeze({ label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' }),
      Object.freeze({ label: 'Maatwerk platform', href: '/maatwerk-platform' }),
      Object.freeze({ label: 'AI automatisering voor het MKB', href: '/blog/ai-automatisering-mkb-waar-beginnen' }),
    ]),
  }),
]);

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

function normalizePath(valueRaw) {
  const raw = String(valueRaw || '').trim();
  if (!raw) return '';
  let pathName = raw.split('?')[0].split('#')[0];
  if (!pathName.startsWith('/')) pathName = `/${pathName}`;
  pathName = pathName.replace(/\/{2,}/g, '/');
  if (pathName.length > 1) pathName = pathName.replace(/\/+$/, '');
  return pathName || '/';
}

function buildAbsoluteUrl(siteOriginRaw, pathNameRaw) {
  const siteOrigin = normalizeSiteOrigin(siteOriginRaw);
  const pathName = normalizePath(pathNameRaw) || '/';
  return pathName === '/' ? `${siteOrigin}/` : `${siteOrigin}${pathName}`;
}

function escapeHtml(valueRaw) {
  return String(valueRaw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getSeoContentCollection(collectionRaw) {
  const key = String(collectionRaw || '').trim().toLowerCase();
  return SEO_CONTENT_COLLECTIONS[key] || null;
}

function getSeoContentItems({ collection, now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return SEO_CONTENT_ITEMS.filter((item) => {
    if (collection && item.collection !== collection) return false;
    const publishedMs = new Date(`${item.publishedAt}T00:00:00.000Z`).getTime();
    return Number.isFinite(publishedMs) && publishedMs <= nowMs;
  });
}

function getSeoContentItem(collectionRaw, slugRaw, options = {}) {
  const collection = String(collectionRaw || '').trim().toLowerCase();
  const slug = String(slugRaw || '').trim().toLowerCase();
  if (!collection || !slug) return null;
  return getSeoContentItems({ collection, now: options.now }).find((item) => item.slug === slug) || null;
}

function getSeoContentPathForItem(item) {
  const collection = getSeoContentCollection(item && item.collection);
  if (!collection || !item || !item.slug) return '';
  return `${collection.path}/${item.slug}`;
}

function getSeoContentPublicPaths(options = {}) {
  const collectionPaths = Object.values(SEO_CONTENT_COLLECTIONS).map((collection) => collection.path);
  const itemPaths = getSeoContentItems(options).map(getSeoContentPathForItem).filter(Boolean);
  return [...collectionPaths, ...itemPaths, '/premium-blog'];
}

function getSeoContentSitemapEntries(options = {}) {
  const collectionEntries = Object.values(SEO_CONTENT_COLLECTIONS).map((collection) => ({
    path: collection.path,
  }));
  const itemEntries = getSeoContentItems(options).map((item) => ({
    path: getSeoContentPathForItem(item),
    lastmod: item.updatedAt || item.publishedAt,
  }));
  return [...collectionEntries, ...itemEntries].filter((entry) => entry.path);
}

function buildBaseHead({ title, description, canonicalUrl, ogType = 'website', structuredData }) {
  const imageUrl = buildAbsoluteUrl(canonicalUrl, DEFAULT_OG_IMAGE_PATH);
  return [
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<meta name="robots" content="index, follow">',
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}">`,
    '<link rel="icon" type="image/png" href="/assets/softora-favicon-round.png?v=20260513a" sizes="any">',
    '<link rel="stylesheet" href="/assets/fonts.css?v=20260409a">',
    '<link rel="stylesheet" href="/assets/seo-content.css?v=20260519a">',
    `<meta property="og:type" content="${escapeHtml(ogType)}">`,
    '<meta property="og:site_name" content="Softora">',
    '<meta property="og:locale" content="nl_NL">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(imageUrl)}">`,
    `<script type="application/ld+json" data-softora-public-seo="structured-data">${escapeHtmlJson(
      structuredData
    )}</script>`,
  ].join('\n    ');
}

function buildOrganizationGraph(siteOrigin) {
  return [
    {
      '@type': 'Organization',
      '@id': `${siteOrigin}/#organization`,
      name: 'Softora',
      url: `${siteOrigin}/`,
      logo: buildAbsoluteUrl(siteOrigin, DEFAULT_LOGO_PATH),
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
  ];
}

function buildBreadcrumbItems(siteOrigin, entries) {
  return entries.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.name,
    item: buildAbsoluteUrl(siteOrigin, entry.path),
  }));
}

function buildContentShell({ title, description, canonicalUrl, structuredData, body, ogType = 'website' }) {
  return [
    '<!DOCTYPE html>',
    '<html lang="nl">',
    '<head>',
    `    ${buildBaseHead({ title, description, canonicalUrl, structuredData, ogType })}`,
    '</head>',
    '<body>',
    '  <nav>',
    '    <a class="nav-logo" href="/" aria-label="Softora homepage">SOFTORA.NL</a>',
    '    <div class="nav-links" aria-label="Content navigatie">',
    '      <a href="/website-laten-maken">Websites</a>',
    '      <a href="/bedrijfssoftware-op-maat">Software</a>',
    '      <a href="/blog">Blog</a>',
    '      <a href="/kennisbank">Kennisbank</a>',
    '    </div>',
    '  </nav>',
    '  <div class="seo-shell">',
    body,
    '  </div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function renderRelatedLinks(links) {
  if (!Array.isArray(links) || links.length === 0) return '';
  return [
    '<section class="meer-wrap" aria-label="Verder lezen">',
    '  <div class="meer-label">Verder lezen</div>',
    '  <div class="meer-grid">',
    ...links.map(
      (link) => `    <a class="blog-card compact-card" href="${escapeHtml(link.href)}"><span>${escapeHtml(link.label)}</span></a>`
    ),
    '  </div>',
    '</section>',
  ].join('\n');
}

function renderArticleCards(items) {
  const gradients = [
    'linear-gradient(135deg, #1a1a2e 0%, #9b2355 100%)',
    'linear-gradient(135deg, #8b2252 0%, #c4346a 100%)',
    'linear-gradient(135deg, #23233b 0%, #6b1a3f 100%)',
  ];
  return items
    .map((item, index) => {
      const href = getSeoContentPathForItem(item);
      const featured = index === 0;
      return [
        `<article class="blog-card${featured ? ' featured' : ''}">`,
        `  <a href="${escapeHtml(href)}">`,
        `    <div class="blog-card-img${featured ? ' featured' : ''}" style="background:${gradients[index % gradients.length]}">`,
        `      <div class="blog-card-img-label">${escapeHtml(item.category)}</div>`,
        '    </div>',
        '    <div class="blog-card-body">',
        `      <div class="blog-card-cat">${escapeHtml(item.category)}</div>`,
        `      <div class="blog-card-title">${escapeHtml(item.title)}</div>`,
        `      <div class="blog-card-excerpt">${escapeHtml(item.description)}</div>`,
        '      <div class="blog-card-meta">',
        `        <div class="blog-card-date">${escapeHtml(item.publishedAt)}</div>`,
        '        <div class="blog-card-dot"></div>',
        `        <div class="blog-card-read">${escapeHtml(item.readTime)}</div>`,
        '      </div>',
        '    </div>',
        '  </a>',
        '</article>',
      ].join('\n');
    })
    .join('\n');
}

function buildSeoContentIndexHtml(collectionRaw, { siteOrigin = DEFAULT_SITE_ORIGIN, now } = {}) {
  const collection = getSeoContentCollection(collectionRaw);
  if (!collection) return '';
  const site = normalizeSiteOrigin(siteOrigin);
  const canonicalUrl = buildAbsoluteUrl(site, collection.path);
  const items = getSeoContentItems({ collection: collection.key, now });
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      ...buildOrganizationGraph(site),
      {
        '@type': 'CollectionPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: collection.title,
        description: collection.description,
        inLanguage: 'nl-NL',
        isPartOf: { '@id': `${site}/#website` },
      },
      {
        '@type': 'ItemList',
        '@id': `${canonicalUrl}#itemlist`,
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: buildAbsoluteUrl(site, getSeoContentPathForItem(item)),
          name: item.title,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: buildBreadcrumbItems(site, [
          { name: 'Home', path: '/' },
          { name: collection.title, path: collection.path },
        ]),
      },
    ],
  };
  const body = [
    '<main class="screen active" id="screen-overzicht">',
    '  <section class="hero-banner">',
    '    <div class="hero-content">',
    `      <div class="hero-eyebrow">${escapeHtml(collection.eyebrow)}</div>`,
    `      <h1 class="hero-title">${escapeHtml(collection.heading)}</h1>`,
    `      <p class="hero-sub">${escapeHtml(collection.intro)}</p>`,
    '    </div>',
    '  </section>',
    '  <div class="filter-bar" aria-label="Content onderdelen">',
    `    <a class="filter-tab${collection.key === 'blog' ? ' active' : ''}" href="/blog">Blog</a>`,
    `    <a class="filter-tab${collection.key === 'kennisbank' ? ' active' : ''}" href="/kennisbank">Kennisbank</a>`,
    '    <a class="filter-tab" href="/website-laten-maken">Websites</a>',
    '    <a class="filter-tab" href="/bedrijfssoftware-op-maat">Software</a>',
    '  </div>',
    '  <section class="blog-grid-wrap">',
    `    <div class="blog-grid">${renderArticleCards(items)}</div>`,
    '  </section>',
    renderRelatedLinks([
      { label: 'Website laten maken', href: '/website-laten-maken' },
      { label: 'Bedrijfssoftware op maat', href: '/bedrijfssoftware-op-maat' },
      { label: collection.key === 'blog' ? 'Bekijk de kennisbank' : 'Bekijk de blog', href: collection.key === 'blog' ? '/kennisbank' : '/blog' },
    ]),
    '</main>',
  ].join('\n');

  return buildContentShell({
    title: collection.title,
    description: collection.description,
    canonicalUrl,
    structuredData,
    body,
  });
}

function buildSeoContentArticleHtml(item, { siteOrigin = DEFAULT_SITE_ORIGIN } = {}) {
  if (!item) return '';
  const collection = getSeoContentCollection(item.collection);
  if (!collection) return '';
  const site = normalizeSiteOrigin(siteOrigin);
  const pathName = getSeoContentPathForItem(item);
  const canonicalUrl = buildAbsoluteUrl(site, pathName);
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      ...buildOrganizationGraph(site),
      {
        '@type': 'Article',
        '@id': `${canonicalUrl}#article`,
        headline: item.title,
        description: item.description,
        datePublished: item.publishedAt,
        dateModified: item.updatedAt || item.publishedAt,
        inLanguage: 'nl-NL',
        author: { '@id': `${site}/#organization` },
        publisher: { '@id': `${site}/#organization` },
        mainEntityOfPage: { '@id': `${canonicalUrl}#webpage` },
      },
      {
        '@type': 'WebPage',
        '@id': `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: item.title,
        description: item.description,
        isPartOf: { '@id': `${site}/#website` },
      },
      {
        '@type': 'BreadcrumbList',
        '@id': `${canonicalUrl}#breadcrumb`,
        itemListElement: buildBreadcrumbItems(site, [
          { name: 'Home', path: '/' },
          { name: collection.title, path: collection.path },
          { name: item.title, path: pathName },
        ]),
      },
    ],
  };
  const body = [
    '<main class="screen active" id="screen-artikel">',
    '  <section class="artikel-hero">',
    `    <a class="nav-back show inline-back" href="${escapeHtml(collection.path)}">Terug naar ${escapeHtml(collection.key === 'blog' ? 'blog' : 'kennisbank')}</a>`,
    `    <div class="artikel-cat">${escapeHtml(item.category)}</div>`,
    `    <h1 class="artikel-title">${escapeHtml(item.title)}</h1>`,
    '    <div class="artikel-meta">',
    `      <span>${escapeHtml(item.publishedAt)}</span>`,
    '      <div class="artikel-meta-dot"></div>',
    `      <span>${escapeHtml(item.readTime)}</span>`,
    '      <div class="artikel-meta-dot"></div>',
    '      <span>Softora Team</span>',
    '    </div>',
    '  </section>',
    `  <div class="artikel-img">${escapeHtml(item.title)}</div>`,
    '  <article class="artikel-body">',
    `    <p><strong>${escapeHtml(item.summary)}</strong></p>`,
    ...item.sections.map((section) =>
      [
        `    <h2>${escapeHtml(section.heading)}</h2>`,
        ...section.paragraphs.map((paragraph) => `    <p>${escapeHtml(paragraph)}</p>`),
      ].join('\n')
    ),
    '  </article>',
    renderRelatedLinks(item.relatedLinks),
    '</main>',
  ].join('\n');

  return buildContentShell({
    title: `${item.title} | Softora`,
    description: item.description,
    canonicalUrl,
    structuredData,
    body,
    ogType: 'article',
  });
}

module.exports = {
  SEO_CONTENT_COLLECTIONS,
  SEO_CONTENT_ITEMS,
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentCollection,
  getSeoContentItem,
  getSeoContentItems,
  getSeoContentPathForItem,
  getSeoContentPublicPaths,
  getSeoContentSitemapEntries,
};
