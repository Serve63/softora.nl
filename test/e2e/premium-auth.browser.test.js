const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startPremiumAuthBrowserServer } = require('../testlib/premium-auth-browser-server');

let browser;
test.before(async () => { browser = await chromium.launch(); });
test.after(async () => { if (browser) await browser.close(); });

async function fixture(t, options = {}) {
  const server = await startPremiumAuthBrowserServer(options);
  t.after(() => server.stop());
  const context = await browser.newContext({
    viewport: options.viewport || { width: 1280, height: 900 },
    serviceWorkers: 'block',
  });
  t.after(() => context.close());
  // Requests to external providers never leave this local test browser.
  await context.route('**/*', (route) => new URL(route.request().url()).origin === server.baseUrl
    ? route.continue() : route.fulfill({ status: 204, body: '' }));
  const pageErrors = [];
  context.on('page', (newPage) => newPage.on('pageerror', (error) => pageErrors.push(error.message)));
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  t.after(() => {
    assert.deepEqual(pageErrors, [], 'no uncaught browser errors');
    assert.deepEqual(server.errors, [], 'no server rendering or route errors');
  });
  return { ...server, context, page };
}

async function openLogin(f, next = f.probePath) {
  await f.page.goto(`${f.baseUrl}/premium-personeel-login?next=${encodeURIComponent(next)}`);
  await f.page.locator('#email').fill(f.credentials.email);
  await f.page.locator('#password').fill(f.credentials.password);
}

async function submitLogin(f, target = f.probePath) {
  await Promise.all([
    f.page.waitForURL(`${f.baseUrl}${target}`),
    f.page.getByRole('button', { name: 'Inloggen', exact: true }).click(),
  ]);
  await f.page.locator('#profile').filter({ hasText: /^Browser Test$/ }).waitFor();
}

for (const [label, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  test(`${label}: slow login survives API validation, refresh and a new tab, then logout blocks access`, { timeout: 30_000 }, async (t) => {
    const f = await fixture(t, { viewport, loginReadDelayMs: 650 });
    const target = `${f.probePath}?view=details#profile`;
    await f.page.goto(`${f.baseUrl}${target}`);
    await f.page.locator('#loginForm').waitFor();
    assert.equal(new URL(f.page.url()).pathname, '/premium-personeel-login');
    await openLogin(f, target);
    await submitLogin(f, target);
    assert.ok(f.readCounts.login > 0, 'the login uses persisted users');
    assert.ok(f.readCounts.api > 0, 'another store validates the issued identity');
    const cookie = (await f.context.cookies()).find((item) => item.name === 'session');
    assert.ok(cookie, 'the browser accepted a session cookie');
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, 'Lax');
    const remainingSeconds = cookie.expires - Date.now() / 1000;
    assert.ok(remainingSeconds > 11 * 3600 && remainingSeconds <= 12 * 3600);
    await f.page.reload();
    await f.page.locator('#profile').filter({ hasText: /^Browser Test$/ }).waitFor();
    const otherTab = await f.context.newPage();
    await otherTab.goto(`${f.baseUrl}${f.probePath}`);
    await otherTab.locator('#profile').filter({ hasText: /^Browser Test$/ }).waitFor();
    await otherTab.close();
    await Promise.all([
      f.page.waitForURL(/\/premium-personeel-login\?logout=1/),
      f.page.getByRole('link', { name: 'Uitloggen', exact: true }).click(),
    ]);
    assert.equal((await f.context.cookies()).some((item) => item.name === 'session'), false);
    const protectedResponse = await f.context.request.get(`${f.baseUrl}/api/quality-profile`);
    assert.equal(protectedResponse.status(), 401);
    await f.page.goto(`${f.baseUrl}${f.probePath}`);
    await f.page.locator('#loginForm').waitFor();
    assert.equal(new URL(f.page.url()).pathname, '/premium-personeel-login');
  });
}

test('wrong password gives a visible error, leaves no session and permits a successful retry', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await openLogin(f);
  await f.page.locator('#password').fill('wrong-fixture-password');
  const response = f.page.waitForResponse((res) => res.url().endsWith('/api/auth/login'));
  await f.page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  assert.equal((await response).status(), 401);
  await f.page.locator('#errorMsg.show').filter({ hasText: 'Ongeldige inloggegevens.' }).waitFor();
  assert.equal(await f.page.getByRole('button', { name: 'Inloggen', exact: true }).isEnabled(), true);
  assert.equal((await f.context.cookies()).some((item) => item.name === 'session'), false);
  await f.page.locator('#password').fill(f.credentials.password);
  await submitLogin(f);
});

test('remember me uses the extended session and the logout API clears it', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await openLogin(f);
  await f.page.locator('#remember').check();
  await submitLogin(f);
  const cookie = (await f.context.cookies()).find((item) => item.name === 'session');
  const remainingSeconds = cookie.expires - Date.now() / 1000;
  assert.ok(remainingSeconds > 6 * 86400 && remainingSeconds <= 7 * 86400);
  const response = await f.context.request.post(`${f.baseUrl}/api/auth/logout`);
  assert.equal(response.status(), 200);
  await f.page.reload();
  await f.page.locator('#loginForm').waitFor();
  assert.equal((await f.context.cookies()).some((item) => item.name === 'session'), false);
});

test('revoked session triggers the real watchdog and retains the return destination', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  const target = `${f.probePath}?view=details#profile`;
  await openLogin(f, target);
  await submitLogin(f, target);
  await f.revokeSession();
  await Promise.all([
    f.page.waitForURL((url) => url.pathname === '/premium-personeel-login' && url.searchParams.get('expired') === '1'),
    f.page.getByRole('button', { name: 'Profiel vernieuwen', exact: true }).click(),
  ]);
  const url = new URL(f.page.url());
  assert.equal(url.searchParams.get('next'), target);
  await f.page.locator('#errorMsg.show').filter({ hasText: 'Je bent uitgelogd omdat je sessie niet meer geldig was.' }).waitFor();
  assert.equal((await f.context.cookies()).some((item) => item.name === 'session'), false);
  assert.ok(f.requests.some((req) => req.path === '/api/quality-profile' && req.status === 401));
});

test('temporary session endpoint failure keeps the current page and recovers on the next check', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  await openLogin(f);
  await submitLogin(f);
  f.state.sessionUnavailable = true;
  const failedCheck = f.page.waitForResponse((res) => res.url().endsWith('/api/auth/session') && res.status() === 503);
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await failedCheck;
  f.state.sessionUnavailable = false;
  const recoveredCheck = f.page.waitForResponse((res) => res.url().endsWith('/api/auth/session') && res.status() === 200);
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal((await (await recoveredCheck).json()).authenticated, true);
  assert.equal(new URL(f.page.url()).pathname, f.probePath);
  assert.equal(await f.page.locator('#profile').textContent(), 'Browser Test');
});

test('unavailable user store refuses login and the same form recovers after availability returns', { timeout: 20_000 }, async (t) => {
  const f = await fixture(t);
  f.state.loginUnavailable = true;
  await openLogin(f);
  const response = f.page.waitForResponse((res) => res.url().endsWith('/api/auth/login'));
  await f.page.getByRole('button', { name: 'Inloggen', exact: true }).click();
  assert.equal((await response).status(), 503);
  await f.page.locator('#errorMsg.show').filter({ hasText: 'gebruikerslijst niet kon worden geladen' }).waitFor();
  assert.equal((await f.context.cookies()).some((item) => item.name === 'session'), false);
  f.state.loginUnavailable = false;
  await submitLogin(f);
});
