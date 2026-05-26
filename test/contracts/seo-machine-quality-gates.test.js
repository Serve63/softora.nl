const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INDEXABLE_PUBLIC_SEO_PAGES,
  applyPublicSeoHeadDefaults,
} = require('../../server/services/public-seo');
const {
  buildSeoContentArticleHtml,
  buildSeoContentIndexHtml,
  getSeoContentClusterForItem,
  getSeoContentClusters,
  getSeoContentCollectionPaths,
  getSeoContentItems,
  getSeoContentPublicationPlan,
  getSeoContentPathForItem,
} = require('../../server/services/seo-content');
const {
  DEFAULT_MIN_CONTENT_WORDS_BY_COLLECTION,
  DEFAULT_UNSUPPORTED_CLAIM_RULES,
  auditClaimSafety,
  auditContentQuality,
  auditConversionCtas,
  auditLinkGraph,
  auditSeoImages,
  buildSeoLinkGraph,
  extractButtonLikeControlEntries,
  extractButtonEntries,
  extractImageEntriesFromHtml,
  isLeadCtaLabel,
} = require('../../server/services/seo-machine-quality-gates');

const repoRoot = path.resolve(__dirname, '../..');
const siteOrigin = 'https://www.softora.nl';
const seoMachineNow = new Date('2026-06-10T12:00:00.000Z');

function renderStaticPublicPages() {
  return INDEXABLE_PUBLIC_SEO_PAGES.map((entry) => {
    const filePath = path.join(repoRoot, entry.fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    return {
      path: entry.path,
      kind: entry.kind,
      html: applyPublicSeoHeadDefaults(source, entry.fileName, { siteOrigin }),
    };
  });
}

function renderSeoContentPages() {
  return [
    ...getSeoContentCollectionPaths().map((pathName) => {
      const collection = pathName.replace(/^\//, '');
      return {
        path: pathName,
        kind: 'content-index',
        html: buildSeoContentIndexHtml(collection, { siteOrigin, now: seoMachineNow }),
      };
    }),
    ...getSeoContentItems({ now: seoMachineNow }).map((item) => ({
      path: getSeoContentPathForItem(item),
      kind: 'content-article',
      html: buildSeoContentArticleHtml(item, { siteOrigin }),
    })),
  ];
}

test('seo machine contentkwaliteit blijft sterk genoeg om automatisch door te groeien', () => {
  assert.deepEqual(DEFAULT_MIN_CONTENT_WORDS_BY_COLLECTION, {
    blog: 1500,
    kennisbank: 850,
    vergelijkingen: 1200,
    branches: 1100,
    regio: 1100,
  });

  const items = getSeoContentItems({ now: seoMachineNow }).map((item) => ({
    ...item,
    cluster: getSeoContentClusterForItem(item).key,
  }));
  const issues = auditContentQuality({
    items,
    clusters: getSeoContentClusters(),
  });

  assert.deepEqual(issues, []);
});

test('weekly SEO batch heeft planning, money-page links, beelden en claim-safety op orde', () => {
  const weeklyPaths = [
    '/blog/ai-automatisering-leadkwalificatie-mkb',
    '/kennisbank/wat-is-leadkwalificatie',
    '/blog/website-leadgeneratie-mkb-meten',
    '/kennisbank/wat-is-crm-datakwaliteit',
    '/regio/midden-brabant',
  ];
  const plan = getSeoContentPublicationPlan({ now: new Date('2026-06-01T12:00:00.000Z') });
  const weeklyPlan = plan.filter((entry) => weeklyPaths.includes(entry.path));

  assert.deepEqual(
    weeklyPlan.map((entry) => `${entry.publishedAt}:${entry.status}:${entry.path}`),
    [
      '2026-06-02:scheduled:/blog/ai-automatisering-leadkwalificatie-mkb',
      '2026-06-03:scheduled:/kennisbank/wat-is-leadkwalificatie',
      '2026-06-04:scheduled:/blog/website-leadgeneratie-mkb-meten',
      '2026-06-05:scheduled:/kennisbank/wat-is-crm-datakwaliteit',
      '2026-06-08:scheduled:/regio/midden-brabant',
    ]
  );

  const weeklyItems = getSeoContentItems({ now: new Date('2026-06-08T12:00:00.000Z') })
    .filter((item) => weeklyPaths.includes(getSeoContentPathForItem(item)))
    .map((item) => ({
      ...item,
      cluster: getSeoContentClusterForItem(item).key,
    }));
  const weeklyPages = weeklyItems.map((item) => ({
    path: getSeoContentPathForItem(item),
    html: buildSeoContentArticleHtml(item, { siteOrigin }),
  }));

  assert.equal(weeklyItems.length, 5);
  assert.deepEqual(auditContentQuality({ items: weeklyItems, clusters: getSeoContentClusters() }), []);
  assert.deepEqual(auditClaimSafety({ items: weeklyItems, pages: weeklyPages }), []);
  assert.deepEqual(auditSeoImages({ pages: weeklyPages }), []);
  assert.ok(weeklyPages.every((page) => /data-softora-conversion-target="service"/.test(page.html)));
});

test('seo machine blokkeert gevaarlijke of onbewezen contentclaims', () => {
  assert.ok(DEFAULT_UNSUPPORTED_CLAIM_RULES.length >= 6);

  const currentItems = getSeoContentItems({ now: seoMachineNow });
  assert.deepEqual(auditClaimSafety({ items: currentItems }), []);

  const issues = auditClaimSafety({
    items: [
      {
        collection: 'blog',
        slug: 'gevaarlijke-claims',
        title: 'Softora garandeert nummer 1 in Google',
        description:
          'Softora is Google Partner, ISO 27001 gecertificeerd en garandeert 100 leads per maand zonder risico.',
        summary:
          'Onze AI maakt geen fouten, neemt alle beslissingen, geeft juridisch advies en Servé Creusen staat op de voorkant.',
        sections: [
          {
            heading: '100% veilig en hackvrij',
            paragraphs: ['Wij worden de grootste speler en noemen 25 klanttrajecten zonder bronvermelding.'],
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => issue.type).sort(),
    [
      'absolute-security-or-availability',
      'frontstage-private-founder-name',
      'guaranteed-seo-or-business-result',
      'market-leader-or-number-one-claim',
      'regulated-advice-claim',
      'unbounded-ai-claim',
      'unsupported-certification-or-partner-claim',
      'unsupported-scale-proof',
    ].sort()
  );
});

test('seo machine scant ook publieke SEO-pagina’s op onbewezen claims', () => {
  const pages = [...renderStaticPublicPages(), ...renderSeoContentPages()];

  assert.deepEqual(auditClaimSafety({ pages }), []);
});

test('publieke losse HTML-bronnen sturen niet richting gevaarlijke claimvoorbeelden', () => {
  const customerFacingHtmlFiles = fs
    .readdirSync(repoRoot)
    .filter((fileName) => fileName.endsWith('.html'))
    .filter((fileName) => !fileName.startsWith('premium-'))
    .filter((fileName) => !fileName.startsWith('personeel-'))
    .sort();

  const rawPublicSource = customerFacingHtmlFiles
    .map((fileName) => fs.readFileSync(path.join(repoRoot, fileName), 'utf8'))
    .join('\n');

  assert.doesNotMatch(rawPublicSource, /\buptime\s+garantie\b/i);
  assert.doesNotMatch(rawPublicSource, /\b(?:gegarandeerd|garantie)\b.{0,80}\b(?:leads?|omzet|conversie|ranking|google)\b/i);
  assert.doesNotMatch(rawPublicSource, /\bAI\b.{0,80}\b(?:altijd correct|maakt geen fouten|vervangt alle medewerkers|neemt alle beslissingen)\b/i);
  assert.doesNotMatch(rawPublicSource, /\b\d{2,}\+?\s+(?:klanttrajecten|trajecten|klanten|projecten|reviews)\b/i);
});

test('seo machine blokkeert harde uptimegaranties in publieke paginacopy', () => {
  const issues = auditClaimSafety({
    pages: [
      {
        path: '/maatwerk-platform',
        html: '<span>99.9%</span><span>Uptime Garantie</span>',
      },
    ],
  });

  assert.deepEqual(issues.map((issue) => issue.type), ['absolute-security-or-availability']);
});

test('seo machine ziet juridische ontkenningen niet als commerciële garantieclaims', () => {
  const issues = auditClaimSafety({
    pages: [
      {
        path: '/juridische-disclaimer',
        html: [
          'Softora garandeert niet dat websites altijd foutloos, ononderbroken of zonder beperkingen werken.',
          'Softora garandeert geen volledige beveiliging, hackvrij systeem of permanente beschikbaarheid.',
          'Geen enkel digitaal systeem is volledig veilig.',
        ].join(' '),
      },
    ],
  });

  assert.deepEqual(issues, []);
});

test('seo machine houdt money pages ondersteund met interne links', () => {
  const pages = [...renderStaticPublicPages(), ...renderSeoContentPages()];
  const graph = buildSeoLinkGraph(pages);
  const issues = auditLinkGraph({ graph });

  assert.deepEqual(issues, []);
});

test('publieke SEO-pagina CTAs zijn meetbaar van landing tot leadactie', () => {
  const pages = renderStaticPublicPages();
  const conversionPages = pages.filter((page) => page.kind !== 'legal');
  const issues = auditConversionCtas({ pages: conversionPages });
  const diensten = pages.find((page) => page.path === '/diensten');
  const homepage = pages.find((page) => page.path === '/');

  assert.deepEqual(issues, []);
  assert.match(diensten.html, /data-softora-conversion="public-cta"/);
  assert.match(diensten.html, /data-softora-conversion-page="\/diensten"/);
  assert.match(diensten.html, /href="https:\/\/wa\.me\/31643262792"/);
  assert.match(diensten.html, /data-softora-conversion-target="whatsapp"/);
  assert.match(homepage.html, /data-softora-conversion-page="\/"/);
  assert.match(homepage.html, /data-softora-conversion="public-form-submit"/);
  assert.match(homepage.html, /data-softora-whatsapp-action="submit"/);
});

test('leadknoppen mogen niet meer naar dode contactroutes of niet-veilige WhatsApp-routes wijzen', () => {
  assert.equal(isLeadCtaLabel('Neem contact op'), true);
  assert.equal(isLeadCtaLabel('Stuur een bericht'), true);
  assert.equal(isLeadCtaLabel('Verstuur bericht'), true);
  assert.equal(isLeadCtaLabel('Bekijk diensten'), false);

  const issues = auditConversionCtas({
    pages: [
      {
        path: '/voorbeeld',
        html: [
          '<a href="https://wa.me/31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="public-cta" data-softora-conversion-page="/voorbeeld" data-softora-conversion-target="whatsapp">WhatsApp Martijn</a>',
          '<a href="/#contact">Neem contact op</a>',
          '<a href="#">Stuur een bericht</a>',
        ].join('\n'),
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => issue.type).sort(),
    ['lead-cta-not-whatsapp', 'non-whatsapp-conversion-link', 'untracked-conversion-link']
  );

  const strictWhatsappIssues = auditConversionCtas({
    pages: [
      {
        path: '/api-whatsapp',
        html:
          '<a href="https://api.whatsapp.com/send?phone=31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="public-cta" data-softora-conversion-page="/api-whatsapp" data-softora-conversion-target="whatsapp">WhatsApp</a>',
      },
      {
        path: '/unsafe-whatsapp',
        html: '<a href="https://wa.me/31643262792" data-softora-conversion="public-cta" data-softora-conversion-page="/unsafe-whatsapp" data-softora-conversion-target="whatsapp">WhatsApp</a>',
      },
    ],
  });

  assert.deepEqual(
    strictWhatsappIssues.map((issue) => issue.type).sort(),
    ['lead-cta-not-whatsapp', 'non-whatsapp-conversion-link', 'whatsapp-link-missing-new-tab-safety'].sort()
  );
});

test('zichtbare contactform-buttons moeten expliciet als WhatsApp-conversie gemarkeerd zijn', () => {
  const buttons = extractButtonEntries(
    '<button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-page="/contact" data-softora-conversion-target="whatsapp" data-softora-whatsapp-action="submit">Verstuur bericht</button>'
  );
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].label, 'Verstuur bericht');

  const issues = auditConversionCtas({
    pages: [
      {
        path: '/formulier-zonder-whatsapp',
        html: '<form><button type="submit">Verstuur bericht</button></form>',
      },
      {
        path: '/formulier-met-whatsapp',
        html:
          '<form><button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-page="/formulier-met-whatsapp" data-softora-conversion-target="whatsapp" data-softora-whatsapp-action="submit">Verstuur bericht</button></form>',
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => `${issue.path}:${issue.type}`).sort(),
    [
      '/formulier-zonder-whatsapp:lead-button-not-whatsapp',
      '/formulier-zonder-whatsapp:missing-conversion-link',
    ].sort()
  );
});

test('WhatsApp-conversies tellen pas met pagina, target en submit-route', () => {
  const issues = auditConversionCtas({
    pages: [
      {
        path: '/half-gemeten-link',
        html:
          '<a href="https://wa.me/31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="public-cta">WhatsApp</a>',
      },
      {
        path: '/half-gemeten-formulier',
        html:
          '<form><button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-page="/half-gemeten-formulier" data-softora-conversion-target="whatsapp">Verstuur bericht</button></form>',
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => `${issue.path}:${issue.type}`).sort(),
    [
      '/half-gemeten-formulier:lead-button-not-whatsapp',
      '/half-gemeten-formulier:missing-conversion-link',
      '/half-gemeten-link:untracked-conversion-link',
    ].sort()
  );
});

test('button-like lead controls zonder WhatsApp-route worden geblokkeerd', () => {
  const controls = extractButtonLikeControlEntries(
    [
      '<input type="submit" value="Plan scan">',
      '<a class="seo-growth-button">Vraag advies</a>',
      '<div role="button" class="hero-cta">Start project</div>',
      '<span onclick="openContact()" aria-label="WhatsApp"></span>',
    ].join('\n')
  );

  assert.deepEqual(
    controls.map((control) => control.label),
    ['Plan scan', 'Vraag advies', 'Start project', 'WhatsApp']
  );

  const issues = auditConversionCtas({
    pages: [
      {
        path: '/button-like-controls',
        html: [
          '<input type="submit" value="Plan scan">',
          '<a class="seo-growth-button">Vraag advies</a>',
          '<div role="button" class="hero-cta">Start project</div>',
          '<span onclick="openContact()" aria-label="WhatsApp"></span>',
          '<button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-page="/button-like-controls" data-softora-conversion-target="whatsapp" data-softora-whatsapp-action="submit">Verstuur bericht</button>',
        ].join('\n'),
      },
    ],
  });

  assert.deepEqual(issues.map((issue) => issue.type), ['lead-button-not-whatsapp']);
});

test('SEO-content CTAs zijn meetbaar en linken terug naar commerciële pagina’s', () => {
  const item = getSeoContentItems({ now: seoMachineNow }).find(
    (contentItem) => contentItem.slug === 'ai-automatisering-mkb-waar-beginnen'
  );
  const html = buildSeoContentArticleHtml(item, { siteOrigin });

  assert.match(html, /data-softora-conversion="content-primary"/);
  assert.match(html, /data-softora-conversion="content-contact"/);
  assert.match(html, /data-softora-conversion-page="\/blog\/ai-automatisering-mkb-waar-beginnen"/);
  assert.match(html, /data-softora-conversion-target="service"/);
  assert.match(html, /data-softora-conversion-target="whatsapp"/);
  assert.match(html, /href="https:\/\/wa\.me\/31643262792"[^>]*>WhatsApp Martijn<\/a>/);
  assert.match(html, /href="\/pakketten">Pakketten<\/a>/);
});

test('SEO-content gebruikt echte geoptimaliseerde foto’s in plaats van placeholders', () => {
  const pages = renderSeoContentPages();
  const issues = auditSeoImages({ pages });

  assert.deepEqual(issues, []);

  for (const page of pages) {
    const images = extractImageEntriesFromHtml(page.html).filter((image) =>
      String(image.src || '').startsWith('/assets/seo-content/')
    );
    assert.ok(images.length >= 1, `${page.path} mist een SEO-foto.`);

    for (const image of images) {
      const assetPath = path.join(repoRoot, image.src);
      assert.ok(fs.existsSync(assetPath), `${image.src} bestaat niet op schijf.`);
      assert.ok(image.alt.length >= 55, `${image.src} heeft een te korte alt-tekst.`);
      assert.equal(image.width, '1600', `${image.src} mist vaste breedte.`);
      assert.equal(image.height, '1000', `${image.src} mist vaste hoogte.`);
      assert.match(image.loading, /^(eager|lazy)$/);
      assert.equal(image.decoding, 'async', `${image.src} mist async decoding.`);
      assert.match(image.fetchpriority, /^(high|low)$/);
    }
  }
});

test('publieke SEO-pagina’s gebruiken lokale afbeeldingen met alt, dimensies en laadstrategie', () => {
  const pages = renderStaticPublicPages().filter((page) => page.kind !== 'legal');
  const issues = auditSeoImages({
    pages,
    checkAllImages: true,
    requireLocalImages: true,
  });

  assert.deepEqual(issues, []);
});

test('SEO-image gate blokkeert foto’s zonder prestatie-attributen', () => {
  const issues = auditSeoImages({
    pages: [
      {
        path: '/blog/slappe-foto',
        html:
          '<img src="/assets/seo-content/slappe-foto-softora.jpg" alt="Realistische werksessie rond Softora workflow met duidelijke context voor ondernemers.">',
      },
    ],
  });

  assert.deepEqual(
    issues.map((issue) => issue.type).sort(),
    [
      'missing-image-decoding-strategy',
      'missing-image-dimensions',
      'missing-image-fetch-priority',
      'missing-image-loading-strategy',
    ].sort()
  );
});

test('publieke SEO-image gate blokkeert externe of zwakke servicepagina-afbeeldingen', () => {
  const issues = auditSeoImages({
    pages: [
      {
        path: '/website-laten-maken',
        html:
          '<img src="https://images.unsplash.com/photo-123?auto=format" alt="Website" width="900" height="560" loading="lazy" decoding="async" fetchpriority="low">',
      },
      {
        path: '/crm-systeem-op-maat',
        html:
          '<img src="/assets/random.jpg" alt="CRM systeem op maat voor ondernemers met klantbeheer en opvolging." width="900" height="560" loading="lazy" decoding="async" fetchpriority="low">',
      },
    ],
    checkAllImages: true,
    requireLocalImages: true,
  });

  assert.deepEqual(
    issues.map((issue) => issue.type).sort(),
    ['external-seo-image', 'weak-image-alt', 'weak-image-filename'].sort()
  );
});
