const test = require('node:test');
const assert = require('node:assert/strict');

const { createWebsiteLinkCoordinator } = require('../../server/services/website-links');

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function createFixture(overrides = {}) {
  const rows = new Map();
  const activityCalls = [];

  const coordinator = createWebsiteLinkCoordinator({
    logger: { error() {} },
    normalizeString: (value) => String(value || '').trim(),
    truncateText: (value, maxLength = 500) => String(value || '').trim().slice(0, maxLength),
    slugifyAutomationText: (value, fallback = 'pagina') =>
      String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '') || fallback,
    isSupabaseConfigured: overrides.isSupabaseConfigured || (() => true),
    fetchSupabaseRowByKeyViaRest:
      overrides.fetchSupabaseRowByKeyViaRest ||
      (async (rowKey) => ({
        ok: true,
        body: rows.has(rowKey)
          ? [{ payload: rows.get(rowKey), updated_at: rows.get(`${rowKey}:updated_at`) || '' }]
          : [],
      })),
    fetchSupabaseRowsByStateKeyPrefixViaRest:
      overrides.fetchSupabaseRowsByStateKeyPrefixViaRest ||
      (async (prefix) => ({
        ok: true,
        body: [...rows.entries()]
          .filter(([key]) => String(key).startsWith(prefix) && !String(key).endsWith(':updated_at'))
          .map(([key, payload]) => ({
            state_key: key,
            payload,
            updated_at: rows.get(`${key}:updated_at`) || '',
          })),
      })),
    upsertSupabaseRowViaRest:
      overrides.upsertSupabaseRowViaRest ||
      (async (row) => {
        rows.set(row.state_key, row.payload);
        rows.set(`${row.state_key}:updated_at`, row.updated_at || '');
        return { ok: true, body: { ok: true } };
      }),
    websiteLinkStateKeyPrefix: 'core:website_link:',
    knownPrettyPageSlugToFile: new Map([['premium-website', 'premium-website.html']]),
    resolveLegacyPrettyPageRedirect: (slug) =>
      slug === 'personeel-dashboard' ? 'premium-personeel-dashboard' : '',
    getPublicBaseUrlFromRequest:
      overrides.getPublicBaseUrlFromRequest || (() => 'https://www.softora.nl'),
    appendDashboardActivity: (payload, reason) => activityCalls.push({ payload, reason }),
  });

  return {
    activityCalls,
    coordinator,
    rows,
  };
}

test('website link coordinator rejects missing html code', async () => {
  const { coordinator } = createFixture();
  const res = createResponseRecorder();

  await coordinator.saveWebsiteLinkResponse({ body: {} }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'HTML code ontbreekt');
});

test('website link coordinator stores sanitized html and returns the next voorbeelddesign url', async () => {
  const { activityCalls, coordinator, rows } = createFixture();
  const res = createResponseRecorder();

  await coordinator.saveWebsiteLinkResponse(
    {
      body: {
        html: `
          <html>
            <head>
              <title>Mijn Landing</title>
              <script>alert('x')</script>
            </head>
            <body>
              <h1 onclick="alert('x')">Welkom</h1>
              <a href="javascript:alert('x')">klik</a>
            </body>
          </html>
        `,
      },
      premiumAuth: {
        displayName: 'Servé Creusen',
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.slug, 'voorbeelddesign1');
  assert.equal(res.body.url, 'https://www.softora.nl/voorbeelddesign1');
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_website_link_created');

  const stored = rows.get('core:website_link:voorbeelddesign1');
  assert.equal(typeof stored.html, 'string');
  assert.doesNotMatch(stored.html, /<script/i);
  assert.doesNotMatch(stored.html, /onclick=/i);
  assert.doesNotMatch(stored.html, /javascript:/i);
  assert.match(stored.html, /<meta name="robots" content="noindex,nofollow,noarchive">/i);
});

test('website link coordinator uses the highest existing voorbeelddesign number for the next slug', async () => {
  const { coordinator, rows } = createFixture();
  const res = createResponseRecorder();

  rows.set('core:website_link:voorbeelddesign1', {
    slug: 'voorbeelddesign1',
    title: 'Voorbeelddesign 1',
    html: '<html><body>Een</body></html>',
  });
  rows.set('core:website_link:voorbeelddesign3', {
    slug: 'voorbeelddesign3',
    title: 'Voorbeelddesign 3',
    html: '<html><body>Drie</body></html>',
  });

  await coordinator.saveWebsiteLinkResponse(
    { body: { html: '<html><head><title>Nieuwe pagina</title></head><body>Nieuw</body></html>' } },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.slug, 'voorbeelddesign4');
  assert.equal(res.body.url, 'https://www.softora.nl/voorbeelddesign4');
  assert.equal(rows.has('core:website_link:voorbeelddesign4'), true);
});

test('website link coordinator blocks reserved and duplicate slugs', async () => {
  const fixture = createFixture();
  const duplicateRes = createResponseRecorder();

  fixture.rows.set('core:website_link:demo-pagina', {
    slug: 'demo-pagina',
    title: 'Demo pagina',
    html: '<html><body>Demo</body></html>',
  });

  await fixture.coordinator.saveWebsiteLinkResponse(
    {
      body: {
        slug: 'premium-website',
        html: '<div>test</div>',
      },
    },
    duplicateRes
  );

  assert.equal(duplicateRes.statusCode, 400);
  assert.equal(duplicateRes.body.error, 'Deze websitelink is gereserveerd');

  const takenRes = createResponseRecorder();
  await fixture.coordinator.saveWebsiteLinkResponse(
    {
      body: {
        slug: 'demo-pagina',
        html: '<div>test</div>',
      },
    },
    takenRes
  );

  assert.equal(takenRes.statusCode, 409);
  assert.equal(takenRes.body.error, 'Deze websitelink bestaat al');
});

test('website link coordinator treats an existing state row as a taken slug even without html', async () => {
  const fixture = createFixture();
  const res = createResponseRecorder();

  fixture.rows.set('core:website_link:lege-rij', {
    slug: 'lege-rij',
    title: 'Lege rij',
  });

  await fixture.coordinator.saveWebsiteLinkResponse(
    {
      body: {
        slug: 'lege-rij',
        html: '<div>test</div>',
      },
    },
    res
  );

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, 'Deze websitelink bestaat al');
});

test('website link coordinator serves stored pages with safe public headers', async () => {
  const { coordinator, rows } = createFixture();
  const res = createResponseRecorder();

  rows.set('core:website_link:demo-link', {
    slug: 'demo-link',
    title: 'Demo link',
    html: '<!DOCTYPE html><html><head><title>Demo</title></head><body><h1>Demo</h1></body></html>',
  });

  const handled = await coordinator.sendPublishedWebsiteLinkResponse({}, res, 'demo-link');

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.match(String(res.body || ''), /<h1>Demo<\/h1>/);
  assert.match(String(res.headers['content-security-policy'] || ''), /script-src 'none'/);
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
});

test('website link coordinator lists stored public links', async () => {
  const { coordinator, rows } = createFixture();
  const res = createResponseRecorder();

  rows.set('core:website_link:demo-link', {
    slug: 'demo-link',
    title: 'Demo link',
    html: '<html><body>Demo</body></html>',
    createdAt: '2026-04-25T20:00:00.000Z',
  });

  await coordinator.listWebsiteLinksResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.links, [
    {
      slug: 'demo-link',
      title: 'Demo link',
      url: 'https://www.softora.nl/demo-link',
      createdAt: '2026-04-25T20:00:00.000Z',
      updatedAt: '',
    },
  ]);
});

test('website link coordinator lists links from lightweight state keys without loading stored html', async () => {
  const selectCalls = [];
  const { coordinator } = createFixture({
    fetchSupabaseRowsByStateKeyPrefixViaRest: async (_prefix, _limit, selectColumns) => {
      selectCalls.push(selectColumns);
      return {
        ok: true,
        body: [
          { state_key: 'core:website_link:voorbeelddesign2', updated_at: '2026-05-01T11:00:00.000Z' },
          { state_key: 'core:website_link:voorbeelddesign1', updated_at: '2026-05-01T10:00:00.000Z' },
        ],
      };
    },
  });
  const res = createResponseRecorder();

  await coordinator.listWebsiteLinksResponse({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(selectCalls, ['state_key,updated_at']);
  assert.deepEqual(res.body.links.map((link) => link.slug), ['voorbeelddesign1', 'voorbeelddesign2']);
  assert.deepEqual(res.body.links.map((link) => link.url), [
    'https://www.softora.nl/voorbeelddesign1',
    'https://www.softora.nl/voorbeelddesign2',
  ]);
});
