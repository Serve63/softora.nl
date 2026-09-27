const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWatchdogSandbox(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '../../assets/premium-session-watchdog.js'), 'utf8');
  const intervals = [];
  const sandbox = {
    URL,
    URLSearchParams,
    document: {
      visibilityState: 'visible',
      addEventListener() {},
    },
    window: {
      location: {
        pathname: '/premium-database',
        search: '?status=benaderd',
        hash: '#rij-1',
        href: 'https://www.softora.nl/premium-database?status=benaderd#rij-1',
        origin: 'https://www.softora.nl',
        replace(value) {
          this.replacedWith = value;
        },
      },
      fetch: fetchImpl,
      addEventListener() {},
      setTimeout() {},
      setInterval(handler, ms) {
        intervals.push(ms);
        return intervals.length;
      },
    },
  };
  vm.runInNewContext(source, sandbox);
  sandbox.window.__intervals = intervals;
  return sandbox.window;
}

test('premium session watchdog redirects after api 401 only when the session check is unauthenticated', async () => {
  const windowRef = loadWatchdogSandbox(async (url) => url === '/api/auth/session'
    ? {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, authenticated: false }),
      }
    : {
        ok: false,
        status: 401,
        json: async () => ({ ok: false }),
      });

  const response = await windowRef.fetch('/api/ui-state-get?scope=premium_customers_database');

  assert.equal(response.status, 401);
  assert.equal(
    windowRef.location.replacedWith,
    '/premium-personeel-login?next=%2Fpremium-database%3Fstatus%3Dbenaderd%23rij-1&logout=1&expired=1'
  );
});

test('premium session watchdog keeps a valid session after an upstream provider 401', async () => {
  const requests = [];
  const windowRef = loadWatchdogSandbox(async (url) => {
    requests.push(url);
    if (url === '/api/auth/session') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, authenticated: true }),
      };
    }
    return {
      ok: false,
      status: 401,
      json: async () => ({ ok: false, code: 'INSTANTLY_API_REQUEST_FAILED' }),
    };
  });

  const response = await windowRef.fetch('/api/outreach/provider-sync', { method: 'POST' });

  assert.equal(response.status, 401);
  assert.equal(windowRef.location.replacedWith, undefined);
  assert.deepEqual(requests, ['/api/outreach/provider-sync', '/api/auth/session']);
});

test('premium session watchdog keeps non-api 401 responses on the current page', async () => {
  const windowRef = loadWatchdogSandbox(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ ok: false }),
  }));

  await windowRef.fetch('/private-download');

  assert.equal(windowRef.location.replacedWith, undefined);
});

test('premium session watchdog limits proactive session polling', () => {
  const windowRef = loadWatchdogSandbox(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ authenticated: true }),
  }));

  assert.deepEqual(windowRef.__intervals, [300000]);
});

for (const payload of [null, {}, { ok: false }, { ok: true, configured: false, authenticated: false },
  { ok: true, authenticated: false, hydrationUnavailable: true }]) {
  test('session watchdog preserves the page for inconclusive session response ' + JSON.stringify(payload), async () => {
    const windowRef = loadWatchdogSandbox(async (url) => url === '/api/auth/session'
      ? { ok: true, status: 200, json: async () => payload }
      : { ok: false, status: 401 });
    await windowRef.fetch('/api/ui-state-get?scope=premium_customers_database');
    assert.equal(windowRef.location.replacedWith, undefined);
  });
}
test('session watchdog preserves the page during a database outage and a malformed response', async () => {
  for (const response of [{ ok: false, status: 503 },
    { ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON'); } }]) {
    const windowRef = loadWatchdogSandbox(async (url) => url === '/api/auth/session'
      ? response : { ok: false, status: 401 });
    await windowRef.fetch('/api/premium-database/customers');
    assert.equal(windowRef.location.replacedWith, undefined);
  }
});

test('HTML responses load the outage-safe session watchdog with a fresh asset version', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../server/services/html-pages.js'), 'utf8');
  assert.match(source, /premium-session-watchdog\.js\?v=20260927a/);
});
