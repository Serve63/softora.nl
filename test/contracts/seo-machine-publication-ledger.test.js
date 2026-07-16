const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectLivePublicationLedger,
  evaluateCadence,
  extractCanonicalHref,
  extractSitemapLocations,
  isPublicationInWindow,
} = require('../../server/services/seo-machine-publication-ledger');

function htmlPage({ path, publishedAt, noindex = false }) {
  return [
    '<!doctype html><html><head>',
    `<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow'}">`,
    `<link rel="canonical" href="https://www.softora.nl${path}">`,
    `<script type="application/ld+json">{"datePublished":"${publishedAt}"}</script>`,
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
      '<urlset><url><loc>https://www.softora.nl/blog/good</loc></url><url><loc>https://www.softora.nl/blog/noindex</loc></url></urlset>',
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
    ],
  });

  assert.equal(ledger.status, 'p0');
  assert.match(ledger.errors.join('\n'), /noindex.*indexable/i);
  assert.equal(ledger.windows['7'].declared, 2);
  assert.equal(ledger.windows['7'].qualifying, 1);
  assert.equal(ledger.windows['7'].deficit, 4);
  assert.equal(ledger.windows['7'].items[0].qualifies, true);
  assert.equal(ledger.windows['7'].items[1].checks.indexable, false);
});

test('cadence gate returns red exit code two when content is required', () => {
  const result = evaluateCadence({
    backlogResult: {
      ok: true,
      errors: [],
      summary: {
        topReady: [{ id: 'candidate-1', path: '/blog/candidate-1', score: 4.5 }],
      },
    },
    ledger: {
      status: 'ready',
      errors: [],
      windows: { '7': { qualifying: 2 } },
    },
  });

  assert.equal(result.status, 'content_required');
  assert.equal(result.color, 'red');
  assert.equal(result.exitCode, 2);
  assert.equal(result.deficit, 3);
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
