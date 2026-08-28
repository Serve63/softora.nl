const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  LIVE_MOMENTUM_ACCESS_COOKIE_NAME,
  LIVE_MOMENTUM_ACCESS_TTL_MS,
  createLiveMomentumAccessGate,
} = require('../../server/security/live-momentum-access');
const { registerLiveMomentumAccessRoutes } = require('../../server/routes/live-momentum-access');

const repoRoot = path.resolve(__dirname, '../..');

function createResponseRecorder() {
  return {
    cookies: [],
    statusCode: 200,
    payload: null,
    append(name, value) {
      if (name === 'Set-Cookie') this.cookies.push(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('Live Momentum gate accepts only 808080 and binds its cookie to the current admin', () => {
  assert.equal(LIVE_MOMENTUM_ACCESS_COOKIE_NAME, 'softora_live_momentum_access_v2');
  assert.equal(LIVE_MOMENTUM_ACCESS_TTL_MS, 30 * 60 * 1000);
  let currentTime = 1_700_000_000_000;
  const gate = createLiveMomentumAccessGate({
    sessionSecret: 'live-momentum-test-secret',
    now: () => currentTime,
  });
  const authState = {
    authenticated: true,
    isAdmin: true,
    email: 'serve@softora.test',
  };

  const deniedResponse = createResponseRecorder();
  assert.equal(
    gate.grantLiveMomentumAccess({ headers: {} }, deniedResponse, authState, '000000').ok,
    false
  );
  assert.deepEqual(deniedResponse.cookies, []);

  const grantedResponse = createResponseRecorder();
  const grant = gate.grantLiveMomentumAccess(
    { headers: {} },
    grantedResponse,
    authState,
    '808080'
  );
  assert.equal(grant.ok, true);
  assert.equal(grant.expiresInMs, LIVE_MOMENTUM_ACCESS_TTL_MS);
  assert.equal(grantedResponse.cookies.length, 1);
  assert.match(grantedResponse.cookies[0], new RegExp(`^${LIVE_MOMENTUM_ACCESS_COOKIE_NAME}=`));
  assert.match(grantedResponse.cookies[0], /HttpOnly/);
  assert.match(grantedResponse.cookies[0], /SameSite=Lax/);

  const cookiePair = grantedResponse.cookies[0].split(';')[0];
  const requestWithCookie = { headers: { cookie: cookiePair } };
  assert.equal(gate.hasLiveMomentumAccess(requestWithCookie, authState), true);
  assert.equal(
    gate.hasLiveMomentumAccess(requestWithCookie, {
      ...authState,
      email: 'andere-admin@softora.test',
    }),
    false
  );

  currentTime += grant.expiresInMs + 1;
  assert.equal(gate.hasLiveMomentumAccess(requestWithCookie, authState), false);
});

test('Live Momentum access route is rate-limited, admin-only and never returns the code', () => {
  const registrations = [];
  const app = {
    post(path, ...handlers) {
      registrations.push({ path, handlers });
    },
  };
  const rateLimiter = () => {};
  const adminGuard = () => {};
  const auditEvents = [];

  registerLiveMomentumAccessRoutes(app, {
    premiumLoginRateLimiter: rateLimiter,
    requirePremiumAdminApiAccess: adminGuard,
    grantLiveMomentumAccess: (_req, _res, authState, code) => ({
      ok: code === '808080' && authState.isAdmin,
      status: 403,
      error: 'Toegangscode is onjuist.',
      expiresInMs: 1000,
    }),
    appendSecurityAuditEvent: (event) => auditEvents.push(event),
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].path, '/api/live-momentum/access');
  assert.equal(registrations[0].handlers[0], rateLimiter);
  assert.equal(registrations[0].handlers[1], adminGuard);

  const handler = registrations[0].handlers[2];
  const deniedResponse = createResponseRecorder();
  handler(
    {
      body: { code: '111111' },
      premiumAuth: { authenticated: true, isAdmin: true, email: 'serve@softora.test' },
      get: () => 'test-agent',
    },
    deniedResponse
  );
  assert.equal(deniedResponse.statusCode, 403);
  assert.equal(deniedResponse.payload.ok, false);
  assert.doesNotMatch(JSON.stringify(deniedResponse.payload), /808080/);
  assert.equal(auditEvents[0].success, false);
});

test('Winnen toont een compacte toegangspagina zonder de dashboardinhoud vooraf te leveren', () => {
  const html = fs.readFileSync(path.join(repoRoot, 'live-momentum-access.html'), 'utf8');
  const css = fs.readFileSync(path.join(repoRoot, 'assets/live-momentum-access.css'), 'utf8');
  const js = fs.readFileSync(path.join(repoRoot, 'assets/live-momentum-access.js'), 'utf8');

  assert.match(html, /data-live-momentum-access-page/);
  assert.match(html, /<h1 id="momentum-access-title">Toegangscode<\/h1>/);
  assert.match(html, /data-momentum-access-dots/);
  assert.equal((html.match(/data-momentum-access-digit=/g) || []).length, 10);
  assert.match(html, /live-momentum-access\.css\?v=20260828a/);
  assert.match(html, /settings-module-routes\.js\?v=20260818b/);
  assert.match(html, /settings-module-back\.js\?v=20260814b/);
  assert.equal((html.match(/data-settings-module-back-host/g) || []).length, 1);
  assert.doesNotMatch(html, /momentum-access-close|Toegangsscherm sluiten/);
  assert.match(html, /live-momentum-access\.js\?v=20260804a/);
  assert.match(html, /data-sidebar-shell="canonical"/);
  assert.match(html, /<aside class="sidebar" data-live-momentum-sidebar-host aria-label="Softora navigatie"><\/aside>/);
  assert.match(html, /premium-sidebar-links\.js\?v=20260818a/);
  assert.match(html, /assets\/personnel-theme\.(?:css|js)\?v=/);
  assert.doesNotMatch(html, /data-live-momentum-page|live-momentum-endgame-cards|data-end-game-goal-track/);
  assert.doesNotMatch(html, /ATTACK, ATTACK, ATTACK\.|THE END GAME IS TO WIN|momentum-access-art/i);
  assert.doesNotMatch(css, /momentum-access-art|ATTACK, ATTACK, ATTACK|THE END GAME IS TO WIN/i);
  assert.match(css, /width:\s*min\(100%,\s*390px\)/);
  assert.match(css, /height:\s*52px/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*body\[data-live-momentum-access-page\][\s\S]*\.sidebar\[data-static-sidebar="1"\][\s\S]*display:\s*none !important/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.dashboard-layout\[data-sidebar-shell="canonical"\] > \.momentum-access-page[\s\S]*width:\s*100% !important[\s\S]*margin-left:\s*0 !important/);
  assert.doesNotMatch(css.slice(0, css.indexOf('@media (max-width: 900px)')), /momentum-access-layout[\s\S]*display:\s*none/);
  assert.match(js, /fetch\('\/api\/live-momentum\/access'/);
  assert.match(js, /credentials:\s*'same-origin'/);
  assert.match(js, /window\.location\.replace\('\/winnen'\)/);
  assert.doesNotMatch(js, /808080/);
});

test('alleen de vergrendelde Winnen-weergave verbergt slogans; unlocked behoudt ze', () => {
  const lockedHtml = fs.readFileSync(path.join(repoRoot, 'live-momentum-access.html'), 'utf8');
  const unlockedHtml = fs.readFileSync(path.join(repoRoot, 'live-momentum.html'), 'utf8');

  assert.doesNotMatch(lockedHtml, /ATTACK, ATTACK, ATTACK\.|THE END GAME IS TO WIN/i);
  assert.match(unlockedHtml, /<h1 id="momentum-title">ATTACK, ATTACK, ATTACK\.<\/h1>/);
  assert.match(unlockedHtml, /<span class="momentum-art-quote is-end-game">The end game is to win<\/span>/);
  assert.match(unlockedHtml, /<span class="momentum-art-quote is-attack">Attack, attack, attack<\/span>/);
});
