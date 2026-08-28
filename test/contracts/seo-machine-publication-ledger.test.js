const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildWindowSummary,
  collectLivePublicationLedger,
  evaluateCadence,
  extractCanonicalHref,
  extractSitemapLocations,
  isPublicationInWindow,
} = require('../../server/services/seo-machine-publication-ledger');
const {
  getSeoContentGrowthEventPlan,
  getSeoMachinePublicationPlan,
  getPublicSeoGrowthEventPlan,
} = require('../../server/services/seo-machine-publication-plan');

function htmlPage({ path, publishedAt, modifiedAt, noindex = false }) {
  return [
    '<!doctype html><html><head>',
    `<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">`,
    `<link rel="canonical" href="https://www.softora.nl${path}">`,
    `<script type="application/ld+json">{"datePublished":"${publishedAt}"${
      modifiedAt ? `,"dateModified":"${modifiedAt}"` : ''
    }}</script>`,
    '</head><body>Content</body></html>',
  ].join('');
}

function response(body, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) {
  return new Response(body, {
    status,
    headers: { 'content-type': contentType },
  });
}

function createFetchFixture() {
  const routes = new Map([
    ['https://www.softora.nl/api/health/baseline', response(
      JSON.stringify({ deployment: { commitSha: 'abc123' } }),
      { contentType: 'application/json' }
    )],
    ['https://www.softora.nl/sitemap.xml', response(
      '<urlset><url><loc>https://www.softora.nl/blog/good</loc></url><url><loc>https://www.softora.nl/blog/noindex</loc></url><url><loc>https://www.softora.nl/blog/refreshed</loc></url><url><loc>https://www.softora.nl/ai-telefonist</loc></url></urlset>',
      { contentType: 'application/xml' }
    )],
    ['https://www.softora.nl/blog/good', response(htmlPage({
      path: '/blog/good',
      publishedAt: '2026-07-16',
    }))],
    ['https://www.softora.nl/blog/noindex', response(htmlPage({
      path: '/blog/noindex',
      publishedAt: '2026-07-15',
      noindex: true,
    }))],
    ['https://www.softora.nl/blog/refreshed', response(htmlPage({
      path: '/blog/refreshed',
      publishedAt: '2026-06-01',
      modifiedAt: '2026-07-14',
    }))],
    ['https://www.softora.nl/ai-telefonist', response(htmlPage({
      path: '/ai-telefonist',
      publishedAt: '',
      modifiedAt: '2026-07-17',
    }))],
  ]);
  return async (url) => {
    const found = routes.get(String(url));
    if (!found) return response('not found', { status: 404 });
    return found.clone();
  };
}

test('publication helpers normalize canonical and UTC rolling windows', () => {
  assert.equal(
    extractCanonicalHref('<link href="/x" rel="alternate"><link rel="canonical" href="https://www.softora.nl/y">'),
    'https://www.softora.nl/y'
  );
  assert.deepEqual(
    [...extractSitemapLocations('<url><loc>https://www.softora.nl/y/</loc></url>')],
    ['https://www.softora.nl/y']
  );
  assert.equal(isPublicationInWindow('2026-07-11', new Date('2026-07-17T20:00:00Z'), 7), true);
  assert.equal(isPublicationInWindow('2026-07-10', new Date('2026-07-17T20:00:00Z'), 7), false);
});

test('public SEO refreshes have an explicit machine-readable event plan', () => {
  const events = getPublicSeoGrowthEventPlan({ now: new Date('2026-08-06T12:00:00.000Z') });
  assert.deepEqual(
    events.map((event) => [event.path, event.eventAt, event.publicationKind]),
    [
      ['/bedrijfssoftware-op-maat', '2026-08-06', 'substantial_refresh'],
      ['/crm-systeem-op-maat', '2026-08-28', 'other_growth_action'],
      ['/ai-automatisering', '2026-07-23', 'substantial_refresh'],
      ['/ai-telefonist', '2026-08-23', 'other_growth_action'],
    ]
  );
  assert.equal(events.every((event) => event.publicationLane === 'money_page'), true);
});

test('content growth actions have an explicit machine-readable event plan', () => {
  const events = getSeoContentGrowthEventPlan({ now: new Date('2026-07-26T12:00:00.000Z') });
  assert.deepEqual(
    events.map((event) => [event.path, event.eventAt, event.publicationKind, event.status]),
    [
      [
        '/kennisbank/wat-is-interne-linkstructuur',
        '2026-07-26',
        'substantial_refresh',
        'live',
      ],
      [
        '/vergelijkingen/chatbot-vs-livechat',
        '2026-08-07',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/blog/chatbot-crm-koppeling-leads-opvolgen',
        '2026-08-09',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-een-crm-integratie',
        '2026-08-12',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/vergelijkingen/maatwerk-software-vs-standaard-software',
        '2026-08-13',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/blog/ai-automatisering-leadkwalificatie-mkb',
        '2026-08-14',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-een-conversiegerichte-website',
        '2026-08-15',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/branches/adviesbureaus',
        '2026-08-16',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-procesautomatisering',
        '2026-08-20',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-een-klantportaal',
        '2026-08-21',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-een-ai-telefonist',
        '2026-08-22',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/kennisbank/wat-is-chatbot-overdracht',
        '2026-08-27',
        'substantial_refresh',
        'scheduled',
      ],
      [
        '/blog/website-offerte-vergelijken',
        '2026-08-28',
        'other_growth_action',
        'scheduled',
      ],
    ]
  );
  assert.equal(
    events.find((event) => event.path === '/kennisbank/wat-is-interne-linkstructuur').publicationLane,
    'editorial'
  );
});

test('new content appears once when it also records an explicit new-url event', () => {
  const events = getSeoMachinePublicationPlan({ now: new Date('2026-08-18T12:00:00.000Z') })
    .filter((event) => event.path === '/kennisbank/ai-telefonist-crm-koppeling');

  assert.equal(events.length, 1);
  assert.equal(events[0].publicationKind, 'new_url');
  assert.equal(events[0].eventAt, '2026-08-18');
  assert.equal(events[0].publicationLane, 'editorial');
});

test('website-migratiepublicatie staat eenmaal als nieuwe URL in het machineplan', () => {
  const events = getSeoMachinePublicationPlan({ now: new Date('2026-08-26T12:00:00.000Z') })
    .filter((event) => event.path === '/kennisbank/website-migratie-zonder-seo-verlies');

  assert.equal(events.length, 1);
  assert.equal(events[0].publicationKind, 'new_url');
  assert.equal(events[0].eventAt, '2026-08-26');
  assert.equal(events[0].status, 'live');
  assert.equal(events[0].publicationLane, 'editorial');
});

test('live publication ledger counts only verified public indexable URLs', async () => {
  const ledger = await collectLivePublicationLedger({
    expectedCommit: 'abc123',
    fetchImpl: createFetchFixture(),
    now: new Date('2026-07-17T12:00:00.000Z'),
    publicationPlan: [
      {
        collection: 'blog',
        cluster: 'software-crm',
        path: '/blog/good',
        publishedAt: '2026-07-16',
        status: 'live',
        title: 'Good',
      },
      {
        collection: 'blog',
        cluster: 'software-crm',
        path: '/blog/noindex',
        publishedAt: '2026-07-15',
        status: 'live',
        title: 'Noindex',
      },
      {
        collection: 'blog',
        cluster: 'software-crm',
        path: '/blog/refreshed',
        publishedAt: '2026-06-01',
        eventAt: '2026-07-14',
        publicationKind: 'substantial_refresh',
        status: 'live',
        title: 'Refreshed',
      },
      {
        collection: 'service',
        cluster: 'ai-contact',
        path: '/ai-telefonist',
        publishedAt: '',
        eventAt: '2026-07-17',
        publicationKind: 'other_growth_action',
        status: 'live',
        title: 'AI telefonist',
      },
    ],
  });

  assert.equal(ledger.status, 'p0');
  assert.match(ledger.errors.join('\n'), /noindex.*indexable/i);
  assert.equal(ledger.windows['7'].declared, 4);
  assert.equal(ledger.windows['7'].qualifying, 3);
  assert.equal(ledger.windows['7'].newUrls, 1);
  assert.equal(ledger.windows['7'].growthNewUrls, 1);
  assert.equal(ledger.windows['7'].editorialNewUrls, 1);
  assert.equal(ledger.windows['7'].moneyPageNewUrls, 0);
  assert.equal(ledger.windows['7'].otherNewUrls, 0);
  assert.equal(ledger.windows['7'].unclassifiedNewUrls, 0);
  assert.equal(ledger.windows['7'].substantialRefreshes, 1);
  assert.equal(ledger.windows['7'].otherGrowthActions, 1);
  assert.equal(ledger.windows['7'].deficit, 6);
  const byPath = new Map(ledger.windows['7'].items.map((item) => [item.path, item]));
  assert.equal(byPath.get('/blog/good').qualifies, true);
  assert.equal(byPath.get('/blog/good').publicationLane, 'editorial');
  assert.equal(byPath.get('/blog/noindex').checks.indexable, false);
  assert.equal(byPath.get('/blog/refreshed').publicationKind, 'substantial_refresh');
  assert.equal(byPath.get('/blog/refreshed').dateModified, '2026-07-14');
  assert.equal(byPath.get('/ai-telefonist').publicationKind, 'other_growth_action');
  assert.equal(byPath.get('/ai-telefonist').dateModified, '2026-07-17');
});

test('window summary separates editorial and money-page URLs and exposes the cap', () => {
  const summary = buildWindowSummary([
    { eventAt: '2026-08-27', publicationKind: 'new_url', publicationLane: 'editorial', qualifies: true },
    { eventAt: '2026-08-26', publicationKind: 'new_url', publicationLane: 'editorial', qualifies: true },
    { eventAt: '2026-08-25', publicationKind: 'new_url', publicationLane: 'money_page', qualifies: true },
    { eventAt: '2026-08-24', publicationKind: 'new_url', publicationLane: 'money_page', qualifies: true },
    { eventAt: '2026-08-23', publicationKind: 'substantial_refresh', publicationLane: 'editorial', qualifies: true },
  ], new Date('2026-08-28T12:00:00.000Z'), 7);

  assert.equal(summary.newUrls, 4);
  assert.equal(summary.growthNewUrls, 4);
  assert.equal(summary.editorialNewUrls, 2);
  assert.equal(summary.moneyPageNewUrls, 2);
  assert.equal(summary.moneyPageMaximum, 2);
  assert.equal(summary.moneyPageCapReached, true);
  assert.equal(summary.editorialDeficit, 3);
  assert.equal(summary.deficit, 3);
});

test('cadence gate returns red exit code two when content is required', () => {
  const result = evaluateCadence({
    backlogResult: {
      ok: true,
      errors: [],
      summary: {
        topReady: [{ id: 'candidate-1', path: '/blog/candidate-1', score: 4.5 }],
        topReadyEditorial: [{ id: 'candidate-1', path: '/blog/candidate-1', score: 4.5 }],
      },
    },
    ledger: {
      status: 'ready',
      errors: [],
      windows: {
        '7': { qualifying: 2, growthNewUrls: 2, editorialNewUrls: 2, moneyPageNewUrls: 0 },
      },
    },
  });

  assert.equal(result.status, 'content_required');
  assert.equal(result.color, 'red');
  assert.equal(result.exitCode, 2);
  assert.equal(result.deficit, 5);
  assert.equal(result.requiredPublicationLane, 'editorial');
  assert.equal(result.nextCandidate.id, 'candidate-1');
});

test('cadence gate reserves exit code one for an operational P0', () => {
  const result = evaluateCadence({
    backlogResult: { ok: false, errors: ['invalid backlog'] },
    ledger: { status: 'p0', errors: ['live mismatch'] },
  });

  assert.equal(result.status, 'p0');
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.errors, ['invalid backlog', 'live mismatch']);
});
