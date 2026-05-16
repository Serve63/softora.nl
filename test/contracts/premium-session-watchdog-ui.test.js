const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWatchdogSandbox(fetchImpl) {
  const source = fs.readFileSync(path.join(__dirname, '../../assets/premium-session-watchdog.js'), 'utf8');
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
      setInterval() {},
    },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window;
}

test('premium session watchdog redirects protected pages to login after api 401', async () => {
  const windowRef = loadWatchdogSandbox(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ ok: false }),
  }));

  const response = await windowRef.fetch('/api/ui-state-get?scope=premium_customers_database');

  assert.equal(response.status, 401);
  assert.equal(
    windowRef.location.replacedWith,
    '/premium-personeel-login?next=%2Fpremium-database%3Fstatus%3Dbenaderd%23rij-1&expired=1'
  );
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
