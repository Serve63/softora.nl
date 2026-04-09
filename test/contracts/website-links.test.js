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

test('website link coordinator stores sanitized html and returns a public slug url', async () => {
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
  assert.equal(res.body.slug, 'mijn-landing');
  assert.equal(res.body.url, 'https://www.softora.nl/mijn-landing');
  assert.equal(activityCalls.length, 1);
  assert.equal(activityCalls[0].reason, 'dashboard_activity_website_link_created');

  const stored = rows.get('core:website_link:mijn-landing');
  assert.equal(typeof stored.html, 'string');
  assert.doesNotMatch(stored.html, /<script/i);
  assert.doesNotMatch(stored.html, /onclick=/i);
  assert.doesNotMatch(stored.html, /javascript:/i);
  assert.match(stored.html, /<meta name="robots" content="noindex,nofollow,noarchive">/i);
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
