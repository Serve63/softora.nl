const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
  buildPublicSeoRobotsTxt,
  buildPublicSeoSitemapXml,
  getIndexablePublicHtmlFileFromPath,
  getIndexablePublicPathFromHtmlFile,
  getIndexablePublicSeoPages,
  getLegacyPublicSeoRedirectTargetPath,
  getPublicSeoInternalLinks,
} = require('../../server/services/public-seo');

const root = path.join(__dirname, '../..');
const KNOWN_FILES = new Set([
  ...INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => entry.fileName),
  'premium-personeel-dashboard.html',
  'premium-seo.html',
  'premium-websitegenerator.html',
]);

function runPublicConversionTracker({ formIsValid = true, trigger = 'submit', linkAttrs = {} } = {}) {
  const listeners = {};
  const opened = [];
  const dispatched = [];
  const fakeLinkAttrs = {
    href: 'https://wa.me/31643262792',
    ...linkAttrs,
  };
  const fakeLink = {
    getAttribute(name) {
      return fakeLinkAttrs[name] || '';
    },
    setAttribute(name, value) {
      fakeLinkAttrs[name] = value;
    },
  };
  const fakeClickTarget = {
    closest(selector) {
      return selector.includes('a[') ? fakeLink : null;
    },
  };
  const submitControl = {
    matches(selector) {
      return selector === '[data-softora-conversion][data-softora-whatsapp-action="submit"]';
    },
    getAttribute(name) {
      return {
        'data-softora-conversion': 'public-form-submit',
        'data-softora-conversion-page': '/contact',
        'data-softora-conversion-target': 'whatsapp',
        'data-softora-whatsapp-action': 'submit',
        'data-softora-whatsapp-url': 'https://wa.me/31643262792',
      }[name] || '';
    },
  };
  const fakeForm = {
    checkValidity: () => formIsValid,
    querySelector: () => submitControl,
  };
  const context = {
    URL,
    CustomEvent: function CustomEvent(name, options) {
      this.type = name;
      this.detail = options && options.detail;
    },
    document: {
      referrer: 'https://www.softora.nl/diensten?utm=test',
      addEventListener(type, handler) {
        listeners[type] = handler;
      },
    },
    window: {
      location: { origin: 'https://www.softora.nl', pathname: '/contact', search: '?bron=seo' },
      open(url, target, features) {
        opened.push({ url, target, features });
        return {};
      },
      dispatchEvent(event) {
        dispatched.push(event);
      },
    },
  };
  context.window.window = context.window;
  context.window.document = context.document;

  const trackerSource = fs.readFileSync(path.join(root, 'assets/public-conversion-tracking.js'), 'utf8');
  vm.runInNewContext(trackerSource, context);

  let prevented = false;
  if (trigger === 'click') {
    listeners.click({ target: fakeClickTarget });
  } else {
    listeners.submit({
      target: fakeForm,
      submitter: submitControl,
      defaultPrevented: false,
      preventDefault() {
        prevented = true;
        this.defaultPrevented = true;
      },
    });
  }

  return {
    opened,
    dispatched,
    prevented,
    linkHref: fakeLinkAttrs.href,
    events: context.window.__softoraPublicConversionEvents || [],
    lastConversion: context.window.__softoraPublicLastConversion,
  };
}

test('public seo sitemap exposes the indexable acquisition pages only', () => {
  const sitemap = buildPublicSeoSitemapXml({
    knownHtmlPageFiles: KNOWN_FILES,
    siteOrigin: 'https://www.softora.nl/',
  });

  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/diensten<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/pakketten<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/website-laten-maken-oisterwijk<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/bedrijfssoftware-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/crm-systeem-op-maat<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-automatisering<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/ai-telefonist<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/over-softora<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/ai-automatisering-mkb-waar-beginnen<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/website-laten-maken-kosten-2026<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/blog\/chatbot-laten-maken-wanneer-zinvol<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/kennisbank<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/www\.softora\.nl\/kennisbank\/wat-is-bedrijfssoftware-op-maat<\/loc>/);
  assert.doesNotMatch(sitemap, /premium-bedrijfssoftware/);
  assert.doesNotMatch(sitemap, /premium-blog/);
  assert.doesNotMatch(sitemap, /premium-pakketten/);
  assert.doesNotMatch(sitemap, /premium-personeel-dashboard/);
  assert.doesNotMatch(sitemap, /premium-seo/);
  assert.doesNotMatch(sitemap, /premium-websitegenerator/);
});

test('public seo robots keeps marketing pages crawlable and blocks private surfaces', () => {
  const robots = buildPublicSeoRobotsTxt({
    knownHtmlPageFiles: KNOWN_FILES,
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/www\.softora\.nl\/sitemap\.xml$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/premium-pakketten$/m);
  assert.match(robots, /^Disallow: \/premium-personeel-dashboard$/m);
  assert.match(robots, /^Disallow: \/premium-seo$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-website$/m);
  assert.doesNotMatch(robots, /^Disallow: \/diensten$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ai-automatisering$/m);
  assert.doesNotMatch(robots, /^Disallow: \/crm-systeem-op-maat$/m);
  assert.doesNotMatch(robots, /^Disallow: \/ai-telefonist$/m);
  assert.doesNotMatch(robots, /^Disallow: \/bedrijfssoftware-op-maat$/m);
  assert.doesNotMatch(robots, /^Disallow: \/over-softora$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-bedrijfssoftware$/m);
  assert.doesNotMatch(robots, /^Disallow: \/blog$/m);
  assert.doesNotMatch(robots, /^Disallow: \/kennisbank$/m);
  assert.doesNotMatch(robots, /^Disallow: \/premium-blog$/m);
});

test('public seo head defaults add canonical metadata and structured data once', () => {
  const source = '<!DOCTYPE html><html lang="nl"><head><title>Oud</title></head><body><h1>Softora</h1></body></html>';
  const first = applyPublicSeoHeadDefaults(source, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const second = applyPublicSeoHeadDefaults(first, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(first, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/">/);
  assert.match(first, /<meta name="description" content="Softora bouwt snelle websites/);
  assert.match(first, /<meta name="robots" content="index, follow">/);
  assert.match(first, /<meta property="og:url" content="https:\/\/www\.softora\.nl\/">/);
  assert.match(first, /type="application\/ld\+json" data-softora-public-seo="structured-data"/);
  assert.match(first, /"telephone":"\+31643262792"/);
  assert.match(first, /"addressLocality":"Oisterwijk"/);
  assert.match(first, /"addressRegion":"Noord-Brabant"/);
  assert.match(first, /"contactType":"sales"/);
  assert.match(first, /data-softora-public-seo="internal-links"/);
  assert.match(first, /<script src="\/assets\/public-conversion-tracking\.js\?v=20260601a" defer><\/script>/);
  assert.match(first, /href="\/diensten"/);
  assert.equal((second.match(/data-softora-public-seo="structured-data"/g) || []).length, 1);
  assert.equal((second.match(/data-softora-public-seo="internal-links"/g) || []).length, 1);
  assert.equal((second.match(/\/assets\/public-conversion-tracking\.js/g) || []).length, 1);
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-website.html'), '/');
});

test('public seo renderer normalizes legacy contact CTAs to measured Martijn WhatsApp links', () => {
  const source = [
    '<!DOCTYPE html><html lang="nl"><head><title>Oud</title></head><body>',
    '<a href="mailto:info@softora.nl">Neem contact op</a>',
    '<a href="tel:+31643262792" rel="nofollow">Bel direct</a>',
    '<a href="/#contact">Plan gesprek</a>',
    '<a href="https://api.whatsapp.com/send?phone=31643262792">Start gesprek</a>',
    '<a href="https://wa.me/31643262792?text=Hoi%20Martijn">Vraag advies</a>',
    '</body></html>',
  ].join('\n');
  const html = applyPublicSeoHeadDefaults(source, 'diensten.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.equal((html.match(/href="https:\/\/wa\.me\/31643262792"/g) || []).length, 5);
  assert.equal((html.match(/target="_blank"/g) || []).length, 5);
  assert.equal((html.match(/data-softora-conversion-page="\/diensten"/g) || []).length, 5);
  assert.equal((html.match(/data-softora-conversion-target="whatsapp"/g) || []).length, 5);
  assert.doesNotMatch(html, /href="mailto:|href="tel:|href="\/#contact|api\.whatsapp\.com|wa\.me\/31643262792\?/);
  assert.match(html, /rel="nofollow noopener noreferrer"/);
});

test('public seo internal links use the existing footer when one is present', () => {
  const source = fs.readFileSync(path.join(root, 'premium-website.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-website.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const footerStart = html.indexOf('<footer');
  const footerEnd = html.indexOf('</footer>');
  const internalLinks = html.indexOf('data-softora-public-seo="internal-links"');

  assert.ok(footerStart > -1, 'Homepage mist bestaande footer.');
  assert.ok(internalLinks > footerStart && internalLinks < footerEnd, 'Interne SEO-links moeten binnen de footer vallen.');
  assert.doesNotMatch(html, /softora-seo-link-map/);
});

test('public seo fixed-nav templates own internal links without fallback bars', () => {
  const source = fs.readFileSync(path.join(root, 'website-laten-maken-oisterwijk.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'website-laten-maken-oisterwijk.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const whyStart = html.indexOf('<div class="why-grid" data-softora-public-seo="internal-links"');
  const internalLinks = html.indexOf('data-softora-public-seo="internal-links"');

  assert.ok(whyStart > -1, 'Oisterwijk-template moet zichtbare contextuele interne links bezitten.');
  assert.ok(internalLinks >= whyStart, 'Interne SEO-links horen in bestaande content te staan.');
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.match(html, /href="\/regio\/oisterwijk"/);
  assert.match(html, /href="\/kennisbank\/wat-is-een-conversiegerichte-website"/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('public seo pages do not render fallback internal link bars', () => {
  for (const entry of INDEXABLE_PUBLIC_SEO_PAGES) {
    const source = fs.readFileSync(path.join(root, entry.fileName), 'utf8');
    const html = applyPublicSeoHeadDefaults(source, entry.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });

    assert.doesNotMatch(html, /softora-seo-footer-links/, `${entry.path} gebruikt nog fallback SEO-links.`);
    assert.doesNotMatch(html, /href="\/premium-[^"]*"/i, `${entry.path} linkt nog naar premium routes.`);
  }
});

test('public seo pages load first-party conversion tracking once', () => {
  const trackerSource = fs.readFileSync(path.join(root, 'assets/public-conversion-tracking.js'), 'utf8');

  assert.match(trackerSource, /MARTIJN_WHATSAPP_URL = 'https:\/\/wa\.me\/31643262792'/);
  assert.match(trackerSource, /softora:public-conversion/);
  assert.match(trackerSource, /recordConversion\(link\)/);
  assert.match(trackerSource, /public-whatsapp-link/);
  assert.match(trackerSource, /document\.addEventListener\('submit', handleConversionSubmit\)/);
  assert.match(trackerSource, /recordConversion\(control\)/);
  assert.match(trackerSource, /window\.open\(MARTIJN_WHATSAPP_URL, '_blank', 'noopener,noreferrer'\)/);
  assert.match(trackerSource, /link\.setAttribute\('href', MARTIJN_WHATSAPP_URL\)/);
  assert.doesNotMatch(trackerSource, /Landingspagina: |CTA-pagina: |Referrer: |\?text=|searchParams\.set\('text'|buildWhatsappText|withWhatsappText/);
  assert.doesNotMatch(trackerSource, /localStorage|sessionStorage/);

  for (const entry of INDEXABLE_PUBLIC_SEO_PAGES) {
    const source = fs.readFileSync(path.join(root, entry.fileName), 'utf8');
    const html = applyPublicSeoHeadDefaults(source, entry.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });

    assert.equal(
      (html.match(/\/assets\/public-conversion-tracking\.js/g) || []).length,
      1,
      `${entry.path} mist de publieke conversietracker.`
    );
  }
});

test('public conversion tracker measures bare Martijn WhatsApp links as fallback', () => {
  const result = runPublicConversionTracker({ trigger: 'click' });

  assert.equal(result.linkHref, 'https://wa.me/31643262792');
  assert.equal(result.events.length, 1);
  assert.equal(result.lastConversion.name, 'public-whatsapp-link');
  assert.equal(result.lastConversion.page, '/contact?bron=seo');
  assert.equal(result.lastConversion.target, 'whatsapp');
  assert.equal(result.lastConversion.landing, '/contact?bron=seo');
  assert.equal(result.lastConversion.referrer, '/diensten?utm=test');
  assert.equal(result.dispatched[0].type, 'softora:public-conversion');
});

test('public conversion tracker records valid WhatsApp form submits without browser storage', () => {
  const trackerSource = fs.readFileSync(path.join(root, 'assets/public-conversion-tracking.js'), 'utf8');

  assert.match(trackerSource, /function handleConversionSubmit\(event\)/);
  assert.match(trackerSource, /data-softora-whatsapp-action="submit"/);
  assert.match(trackerSource, /data-softora-whatsapp-url/);
  assert.match(trackerSource, /if \(form && form\.checkValidity && !form\.checkValidity\(\)\) return;/);
  assert.doesNotMatch(trackerSource, /localStorage|sessionStorage/);
});

test('public conversion tracker measures and routes valid WhatsApp form submits', () => {
  const result = runPublicConversionTracker();

  assert.equal(result.prevented, true);
  assert.deepEqual(result.opened, [
    {
      url: 'https://wa.me/31643262792',
      target: '_blank',
      features: 'noopener,noreferrer',
    },
  ]);
  assert.equal(result.events.length, 1);
  assert.equal(result.lastConversion.name, 'public-form-submit');
  assert.equal(result.lastConversion.page, '/contact');
  assert.equal(result.lastConversion.target, 'whatsapp');
  assert.equal(result.lastConversion.landing, '/contact?bron=seo');
  assert.equal(result.lastConversion.referrer, '/diensten?utm=test');
  assert.equal(result.dispatched[0].type, 'softora:public-conversion');
});

test('public conversion tracker does not count invalid WhatsApp form submits', () => {
  const result = runPublicConversionTracker({ formIsValid: false });

  assert.equal(result.prevented, false);
  assert.deepEqual(result.opened, []);
  assert.deepEqual(result.events, []);
});

const CORE_INTERNAL_LINK_EXPECTATIONS = [
  {
    fileName: 'diensten.html',
    canonical: '/diensten',
    links: [
      '/website-laten-maken',
      '/ai-automatisering',
      '/bedrijfssoftware-op-maat',
      '/crm-systeem-op-maat',
      '/chatbot-laten-maken',
      '/ai-telefonist',
    ],
  },
  {
    fileName: 'premium-websites.html',
    canonical: '/website-laten-maken',
    links: [
      '/blog/website-laten-maken-kosten-2026',
      '/blog/website-laten-maken-mkb-paginas',
      '/kennisbank/wat-is-een-conversiegerichte-website',
      '/website-laten-maken-oisterwijk',
      '/crm-systeem-op-maat',
      '/pakketten',
      '/ai-automatisering',
    ],
  },
  {
    fileName: 'premium-bedrijfssoftware.html',
    canonical: '/bedrijfssoftware-op-maat',
    links: [
      '/crm-systeem-op-maat',
      '/maatwerk-platform',
      '/kennisbank/wat-is-bedrijfssoftware-op-maat',
      '/ai-automatisering',
    ],
  },
  {
    fileName: 'premium-chatbot.html',
    canonical: '/chatbot-laten-maken',
    links: [
      '/blog/chatbot-laten-maken-wanneer-zinvol',
      '/website-laten-maken',
      '/crm-systeem-op-maat',
      '/ai-automatisering',
      '/ai-telefonist',
    ],
  },
  {
    fileName: 'ai-telefonist.html',
    canonical: '/ai-telefonist',
    links: [
      '/voicesoftware-op-maat',
      '/chatbot-laten-maken',
      '/ai-automatisering',
      '/crm-systeem-op-maat',
      '/blog/ai-automatisering-mkb-waar-beginnen',
      '/kennisbank/wat-is-een-ai-telefonist',
    ],
  },
];

for (const page of CORE_INTERNAL_LINK_EXPECTATIONS) {
  test(`${page.canonical} owns its service links inside visible content`, () => {
    const source = fs.readFileSync(path.join(root, page.fileName), 'utf8');
    const html = applyPublicSeoHeadDefaults(source, page.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });

    assert.match(html, new RegExp(`<link rel="canonical" href="https:\\/\\/www\\.softora\\.nl${page.canonical.replace(/\//g, '\\/')}"`));
    assert.match(html, /data-softora-public-seo="internal-links"/);
    for (const href of page.links) {
      assert.match(html, new RegExp(`href="${href.replace(/\//g, '\\/')}"`), `${page.canonical} mist ${href}`);
    }
    assert.doesNotMatch(html, /softora-seo-footer-links/);
    assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
  });
}

test('ai automation page owns its internal links inside the page content', () => {
  const source = fs.readFileSync(path.join(root, 'ai-automatisering.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'ai-automatisering.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/ai-automatisering">/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /href="\/chatbot-laten-maken"/);
  assert.match(html, /href="\/voicesoftware-op-maat"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('crm page owns its internal links inside the page content', () => {
  const source = fs.readFileSync(path.join(root, 'crm-systeem-op-maat.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'crm-systeem-op-maat.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/crm-systeem-op-maat">/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/ai-automatisering"/);
  assert.match(html, /href="\/chatbot-laten-maken"/);
  assert.match(html, /href="\/voicesoftware-op-maat"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('money pages verwerken actuele GSC-zoeksignalen in normale content', () => {
  const pages = [
    {
      fileName: 'crm-systeem-op-maat.html',
      terms: [
        'crm systeem op maat',
        'crm op maat',
        'crm offerte systeem',
        'klantportaal',
        'dashboard laten ontwikkelen',
        'sales pipeline',
      ],
    },
    {
      fileName: 'premium-bedrijfssoftware.html',
      terms: ['bedrijfssoftware laten maken', 'dashboard laten ontwikkelen', 'klantportaal', 'crm offerte systeem'],
    },
    {
      fileName: 'ai-automatisering.html',
      terms: ['ai automatisering', 'processen automatiseren met ai'],
    },
  ];

  for (const page of pages) {
    const source = fs.readFileSync(path.join(root, page.fileName), 'utf8');
    const html = applyPublicSeoHeadDefaults(source, page.fileName, {
      siteOrigin: 'https://www.softora.nl',
    });
    const normalized = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();

    for (const term of page.terms) {
      assert.ok(normalized.includes(term), `${page.fileName} mist GSC-signaal "${term}"`);
    }
  }
});

test('voicesoftware page owns its internal links inside the page content', () => {
  const source = fs.readFileSync(path.join(root, 'premium-voicesoftware.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-voicesoftware.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/voicesoftware-op-maat">/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(html, /href="\/ai-telefonist"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('ai telefonist head metadata targets make and comparison intent', () => {
  const source = fs.readFileSync(path.join(root, 'ai-telefonist.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'ai-telefonist.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<title>AI telefonist laten maken voor het MKB \| Softora<\/title>/);
  assert.match(html, /<meta name="description" content="Laat een AI telefonist maken door Softora/);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/ai-telefonist">/);
  assert.match(html, /AI telefonist, voicemail of callcenter\?/);
  assert.match(html, /Past dit bij leadgeneratie voor MKB\?/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('public seo url mapping exposes clean paths and keeps legacy redirects available', () => {
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-bedrijfssoftware.html'), '/bedrijfssoftware-op-maat');
  assert.equal(getIndexablePublicHtmlFileFromPath('/bedrijfssoftware-op-maat'), 'premium-bedrijfssoftware.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('website-laten-maken-oisterwijk.html'), '/website-laten-maken-oisterwijk');
  assert.equal(getIndexablePublicHtmlFileFromPath('/website-laten-maken-oisterwijk'), 'website-laten-maken-oisterwijk.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('diensten.html'), '/diensten');
  assert.equal(getIndexablePublicHtmlFileFromPath('/ai-automatisering'), 'ai-automatisering.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/crm-systeem-op-maat'), 'crm-systeem-op-maat.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/ai-telefonist'), 'ai-telefonist.html');
  assert.equal(getIndexablePublicHtmlFileFromPath('/voicesoftware-op-maat'), 'premium-voicesoftware.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('pakketten.html'), '/pakketten');
  assert.equal(getIndexablePublicHtmlFileFromPath('/pakketten'), 'pakketten.html');
  assert.equal(getIndexablePublicPathFromHtmlFile('premium-over-softora.html'), '/over-softora');
  assert.equal(getIndexablePublicHtmlFileFromPath('/over-softora'), 'premium-over-softora.html');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-bedrijfssoftware'), '/bedrijfssoftware-op-maat');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-chatbot'), '/chatbot-laten-maken');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-voicesoftware'), '/voicesoftware-op-maat');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-pakketten'), '');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-over-softora'), '/over-softora');
  assert.equal(getLegacyPublicSeoRedirectTargetPath('/premium-website'), '/');
});

test('public packages page is a clean public sales page without premium sidebar links', () => {
  const source = fs.readFileSync(path.join(root, 'pakketten.html'), 'utf8');

  assert.match(source, /<title>Softora pakketten voor websites, software en AI groei<\/title>/);
  assert.match(source, /<meta name="description" content="Bekijk Softora pakketten voor websites, bedrijfssoftware/);
  assert.match(source, /<h1\b[\s\S]*Pakketten voor bouwen, beheren en groeien[\s\S]*<\/h1>/i);
  assert.match(source, /Website route/);
  assert.match(source, /Software en CRM route/);
  assert.match(source, /AI groei route/);
  assert.match(source, /data-softora-public-seo="internal-links"/);
  assert.doesNotMatch(source, /sidebar-link|premium-sidebar|personnel-theme/i);
  assert.doesNotMatch(source, /href="\/premium-[^"]*"/i);
  assert.doesNotMatch(source, /premium-personeel|premium-dashboard|admin-menu|admin-nav/i);
});

test('packages page owns its internal links inside the page content', () => {
  const source = fs.readFileSync(path.join(root, 'pakketten.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'pakketten.html', {
    siteOrigin: 'https://www.softora.nl',
  });

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/pakketten">/);
  assert.match(html, /data-softora-public-seo="internal-links"/);
  assert.match(html, /href="\/website-laten-maken"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /href="\/ai-automatisering"/);
  assert.match(html, /href="\/chatbot-laten-maken"/);
  assert.match(html, /href="\/voicesoftware-op-maat"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('over softora page owns its internal links inside the page footer', () => {
  const source = fs.readFileSync(path.join(root, 'premium-over-softora.html'), 'utf8');
  const html = applyPublicSeoHeadDefaults(source, 'premium-over-softora.html', {
    siteOrigin: 'https://www.softora.nl',
  });
  const footerStart = html.indexOf('<footer');
  const internalLinks = html.indexOf('data-softora-public-seo="internal-links"');

  assert.match(html, /<link rel="canonical" href="https:\/\/www\.softora\.nl\/over-softora">/);
  assert.ok(footerStart > -1, 'Over Softora mist een footer.');
  assert.ok(internalLinks > footerStart, 'Interne links horen in de footer te staan.');
  assert.match(html, /href="\/diensten"/);
  assert.match(html, /href="\/website-laten-maken"/);
  assert.match(html, /href="\/bedrijfssoftware-op-maat"/);
  assert.match(html, /href="\/ai-automatisering"/);
  assert.match(html, /href="\/crm-systeem-op-maat"/);
  assert.match(html, /href="\/blog"/);
  assert.match(html, /href="\/kennisbank"/);
  assert.doesNotMatch(html, /softora-seo-footer-links/);
  assert.doesNotMatch(html, /href="\/premium-[^"]*"/i);
});

test('public seo registry points to existing crawlable pages with h1 and link graph', () => {
  const pages = getIndexablePublicSeoPages(KNOWN_FILES);
  const seenPaths = new Set();

  pages.forEach((entry) => {
    const filePath = path.join(root, entry.fileName);
    assert.ok(fs.existsSync(filePath), `${entry.fileName} ontbreekt voor ${entry.path}`);
    assert.ok(!seenPaths.has(entry.path), `${entry.path} staat dubbel in de SEO registry`);
    seenPaths.add(entry.path);

    const source = fs.readFileSync(filePath, 'utf8');
    assert.match(source, /<h1\b[\s\S]*?<\/h1>/i, `${entry.fileName} mist een H1`);
    assert.doesNotMatch(source, /data-public-lock-input|premium-public-lock\.js|Binnenkort beschikbaar/, entry.fileName);

    if (entry.kind !== 'legal') {
      const links = getPublicSeoInternalLinks(entry);
      assert.ok(links.length >= 4, `${entry.path} mist interne SEO-links`);
      assert.ok(links.every((link) => /^\/[a-z0-9/_-]+$/i.test(link.href)), `${entry.path} heeft geen schone interne links`);
    }
  });
});
