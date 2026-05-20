const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePremiumAdminActionPin } = require('../../server/security/premium-admin-action-pin');
const { registerPremiumUserManagementRoutes } = require('../../server/routes/premium-users');

test('premium admin action pin skips when expected pin is empty', () => {
  assert.equal(validatePremiumAdminActionPin({}, { expectedPin: '' }).ok, true);
  assert.equal(validatePremiumAdminActionPin({ actionConfirmPin: 'x' }, { expectedPin: '  ' }).ok, true);
});

test('premium admin action pin rejects mismatch', () => {
  const bad = validatePremiumAdminActionPin({ actionConfirmPin: 'wrong' }, { expectedPin: 'geheim' });
  assert.equal(bad.ok, false);
  assert.match(String(bad.error || ''), /Bevestigingspin/);
});

test('premium admin action pin accepts exact match on actionConfirmPin', () => {
  assert.equal(
    validatePremiumAdminActionPin({ actionConfirmPin: 'geheim' }, { expectedPin: 'geheim' }).ok,
    true
  );
});

test('premium admin action pin accepts exact match on actionConfirmCode', () => {
  assert.equal(
    validatePremiumAdminActionPin({ actionConfirmCode: 'geheim' }, { expectedPin: 'geheim' }).ok,
    true
  );
});

test('premium user routes expose server-side admin pin verification without leaking the pin', () => {
  const routes = [];
  const app = {
    get(path, ...handlers) {
      routes.push({ method: 'GET', path, handlers });
    },
    post(path, ...handlers) {
      routes.push({ method: 'POST', path, handlers });
    },
    patch(path, ...handlers) {
      routes.push({ method: 'PATCH', path, handlers });
    },
    delete(path, ...handlers) {
      routes.push({ method: 'DELETE', path, handlers });
    },
  };
  const previousPin = process.env.PREMIUM_SETTINGS_CONFIRM_PIN;
  process.env.PREMIUM_SETTINGS_CONFIRM_PIN = 'geheim';

  try {
    registerPremiumUserManagementRoutes(app, {
      requirePremiumAdminApiAccess: (_req, _res, next) => next(),
      coordinator: {
        getProfileResponse: () => {},
        updateProfileResponse: () => {},
        listPremiumUsersResponse: () => {},
        createPremiumUserResponse: () => {},
        updatePremiumUserResponse: () => {},
        deletePremiumUserResponse: () => {},
      },
    });

    const route = routes.find((entry) => entry.method === 'POST' && entry.path === '/api/premium-users/verify-pin');
    assert.ok(route, 'verify-pin route hoort geregistreerd te zijn');
    const handler = route.handlers[route.handlers.length - 1];

    const badRes = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    handler({ body: { actionConfirmCode: 'wrong' } }, badRes);
    assert.equal(badRes.statusCode, 403);
    assert.equal(badRes.body.ok, false);

    const okRes = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    handler({ body: { actionConfirmCode: 'geheim' } }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(okRes.body, { ok: true });

    const coldmailRes = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    handler({ body: { actionConfirmCode: '8080', actionConfirmScope: 'coldmail-send' } }, coldmailRes);
    assert.equal(coldmailRes.statusCode, 200);
    assert.deepEqual(coldmailRes.body, { ok: true });
  } finally {
    if (previousPin === undefined) delete process.env.PREMIUM_SETTINGS_CONFIRM_PIN;
    else process.env.PREMIUM_SETTINGS_CONFIRM_PIN = previousPin;
  }
});
