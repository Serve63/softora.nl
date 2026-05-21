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
  getSeoContentPathForItem,
} = require('../../server/services/seo-content');
const {
  DEFAULT_UNSUPPORTED_CLAIM_RULES,
  auditClaimSafety,
  auditContentQuality,
  auditConversionCtas,
  auditLinkGraph,
  auditSeoImages,
  buildSeoLinkGraph,
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
            paragraphs: ['Wij worden de grootste speler en hebben meer dan 100 klanten zonder bronvermelding.'],
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
          '<a href="https://wa.me/31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="public-cta">WhatsApp Martijn</a>',
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
          '<a href="https://api.whatsapp.com/send?phone=31643262792" target="_blank" rel="noopener noreferrer" data-softora-conversion="public-cta">WhatsApp</a>',
      },
      {
        path: '/unsafe-whatsapp',
        html: '<a href="https://wa.me/31643262792" data-softora-conversion="public-cta">WhatsApp</a>',
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
    '<button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-target="whatsapp">Verstuur bericht</button>'
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
          '<form><button type="submit" data-softora-conversion="public-form-submit" data-softora-conversion-target="whatsapp">Verstuur bericht</button></form>',
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
    }
  }
});
