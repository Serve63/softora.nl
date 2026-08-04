const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePremiumAdminActionPin } = require('../../server/security/premium-admin-action-pin');
const { registerPremiumUserManagementRoutes } = require('../../server/routes/premium-users');

test('premium admin action pin fails closed when expected pin is empty', () => {
  const result = validatePremiumAdminActionPin({}, { expectedPin: '' });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 503);
  assert.equal(result.code, 'ACTION_CONFIRM_PIN_NOT_CONFIGURED');
});

test('generic admin PIN keeps legacy optional configuration while password scope fails closed', () => {
  assert.equal(validatePremiumAdminActionPin({}, { env: {} }).ok, true);
  const scoped = validatePremiumAdminActionPin({}, {
    env: {},
    envName: 'PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN',
    requireConfigured: true,
  });
  assert.equal(scoped.ok, false);
  assert.equal(scoped.statusCode, 503);
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
  const auditEvents = [];
  let createdUsers = 0;
  const updatedUserIds = [];
  const deletedUserIds = [];
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
  const previousColdmailPin = process.env.COLDMAIL_SEND_CONFIRM_PIN;
  const previousVaultPin = process.env.PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN;
  process.env.PREMIUM_SETTINGS_CONFIRM_PIN = 'test-only-settings-pin';
  process.env.COLDMAIL_SEND_CONFIRM_PIN = 'test-only-coldmail-pin';
  process.env.PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN = 'test-only-vault-pin';

  try {
    registerPremiumUserManagementRoutes(app, {
      requirePremiumAdminApiAccess: (_req, _res, next) => next(),
      coordinator: {
        getProfileResponse: () => {},
        updateProfileResponse: () => {},
        listPremiumUsersResponse: () => {},
        createPremiumUserResponse: () => { createdUsers += 1; },
        updatePremiumUserResponse: (_req, _res, id) => updatedUserIds.push(id),
        deletePremiumUserResponse: (_req, _res, id) => deletedUserIds.push(id),
      },
      passwordRegisterOwnerPolicy: {
        getAccessDecision: () => ({ ok: true }),
      },
      passwordRegisterWriteProofManager: {
        mint: () => ({
          ok: true,
          writeProof: 'opaque-write-proof',
          writeProofExpiresAt: '2026-08-04T12:05:00.000Z',
        }),
      },
      appendSecurityAuditEvent: (payload, reason) => auditEvents.push({ payload, reason }),
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
    handler({ body: { actionConfirmCode: 'wrong' }, premiumAuth: { userId: 'usr_test' } }, badRes);
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
    handler(
      { body: { actionConfirmCode: 'test-only-settings-pin' }, premiumAuth: { userId: 'usr_test' } },
      okRes
    );
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
    handler(
      {
        body: { actionConfirmCode: '8080', actionConfirmScope: 'coldmail-send' },
        premiumAuth: { userId: 'usr_test' },
      },
      coldmailRes
    );
    assert.equal(coldmailRes.statusCode, 200);
    assert.deepEqual(coldmailRes.body, { ok: true });

    const vaultRes = {
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
    handler(
      {
        body: { actionConfirmCode: 'test-only-vault-pin', actionConfirmScope: 'password-register' },
        premiumAuth: { userId: 'usr_test' },
      },
      vaultRes
    );
    assert.equal(vaultRes.statusCode, 200);
    assert.deepEqual(vaultRes.body, {
      ok: true,
      writeProof: 'opaque-write-proof',
      writeProofExpiresAt: '2026-08-04T12:05:00.000Z',
    });
    assert.ok(
      auditEvents.some((event) => event.payload.type === 'password_register_pin_verified')
    );
    assert.doesNotMatch(JSON.stringify(auditEvents), /test-only-(settings|coldmail|vault)-pin/);

    const mutationRes = { status: () => mutationRes, json: () => mutationRes };
    routes.find((entry) => entry.method === 'POST' && entry.path === '/api/premium-users')
      .handlers.at(-1)(
        { body: { actionConfirmCode: 'test-only-settings-pin' }, premiumAuth: { userId: 'usr_admin_test' } },
        mutationRes
      );
    routes.find((entry) => entry.method === 'PATCH' && entry.path === '/api/premium-users/:id')
      .handlers.at(-1)(
        { body: { actionConfirmCode: 'test-only-settings-pin' }, params: { id: 'usr_update_test' }, premiumAuth: { userId: 'usr_admin_test' } },
        mutationRes
      );
    routes.find((entry) => entry.method === 'DELETE' && entry.path === '/api/premium-users/:id')
      .handlers.at(-1)(
        { body: {}, params: { id: 'usr_delete_test' }, premiumAuth: { userId: 'usr_admin_test' } },
        mutationRes
      );
    assert.equal(createdUsers, 1);
    assert.deepEqual(updatedUserIds, ['usr_update_test']);
    assert.deepEqual(deletedUserIds, ['usr_delete_test']);
    assert.doesNotMatch(JSON.stringify(auditEvents), /test-only-settings-pin/);
  } finally {
    if (previousPin === undefined) delete process.env.PREMIUM_SETTINGS_CONFIRM_PIN;
    else process.env.PREMIUM_SETTINGS_CONFIRM_PIN = previousPin;
    if (previousColdmailPin === undefined) delete process.env.COLDMAIL_SEND_CONFIRM_PIN;
    else process.env.COLDMAIL_SEND_CONFIRM_PIN = previousColdmailPin;
    if (previousVaultPin === undefined) delete process.env.PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN;
    else process.env.PREMIUM_PASSWORD_REGISTER_CONFIRM_PIN = previousVaultPin;
  }
});
