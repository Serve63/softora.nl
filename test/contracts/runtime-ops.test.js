const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeOpsCoordinator } = require('../../server/services/runtime-ops');

function createResponseRecorder() {
  return {
    statusCode: null,
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
}

function createFixture(overrides = {}) {
  const dashboardActivityCalls = [];
  const securityAuditCalls = [];
  const coordinator = createRuntimeOpsCoordinator({
    parseIntSafe: (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    recentDashboardActivities: overrides.recentDashboardActivities || [
      { id: 'act-1', title: 'Eerste' },
      { id: 'act-2', title: 'Tweede' },
    ],
    recentSecurityAuditEvents: overrides.recentSecurityAuditEvents || [
      { id: 'sec-1', type: 'login' },
      { id: 'sec-2', type: 'logout' },
    ],
    normalizeString: (value) => String(value || '').trim(),
    appendDashboardActivity: (payload, reason) => {
      dashboardActivityCalls.push({ payload, reason });
      return {
        id: 'act-new',
        ...payload,
      };
    },
    normalizeUiStateScope: (value) => {
      const scope = String(value || '').trim().toLowerCase();
      return /^[a-z0-9:_-]{1,80}$/.test(scope) ? scope : '';
    },
    getUiStateValues: overrides.getUiStateValues || (async () => ({
      values: { panel: 'overview' },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    })),
    sanitizeUiStateValues: (values) => {
      const out = {};
      for (const [key, value] of Object.entries(values || {})) {
        if (value === undefined) continue;
        out[String(key).trim()] = value === null ? '' : String(value);
      }
      return out;
    },
    setUiStateValues:
      overrides.setUiStateValues ||
      (async (_scope, values, meta) => ({
        values,
        source: meta.source,
        updatedAt: '2026-04-07T12:30:00.000Z',
      })),
    adminOnlyUiStateScopes: overrides.adminOnlyUiStateScopes || new Set(['premium_password_register']),
    appendSecurityAuditEvent: overrides.appendSecurityAuditEvent || ((payload, reason) => {
      securityAuditCalls.push({ payload, reason });
      return payload;
    }),
  });

  return {
    coordinator,
    dashboardActivityCalls,
    securityAuditCalls,
  };
}

test('runtime ops coordinator lists dashboard activity and audit events with stable payloads', () => {
  const { coordinator } = createFixture();
  const dashboardRes = createResponseRecorder();
  const auditRes = createResponseRecorder();

  coordinator.sendDashboardActivityResponse({ query: { limit: '1' } }, dashboardRes);
  coordinator.sendSecurityAuditLogResponse({ query: { limit: '1' } }, auditRes);

  assert.equal(dashboardRes.statusCode, 200);
  assert.equal(dashboardRes.body.ok, true);
  assert.equal(dashboardRes.body.count, 1);
  assert.equal(dashboardRes.body.activities.length, 1);

  assert.equal(auditRes.statusCode, 200);
  assert.equal(auditRes.body.ok, true);
  assert.equal(auditRes.body.count, 1);
  assert.equal(auditRes.body.events.length, 1);
});

test('runtime ops coordinator returns 400 or 503 for invalid or unavailable ui-state reads', async () => {
  const invalidFixture = createFixture();
  const invalidRes = createResponseRecorder();

  await invalidFixture.coordinator.sendUiStateGetResponse({ query: {} }, invalidRes, '../bad');

  assert.equal(invalidRes.statusCode, 400);
  assert.equal(invalidRes.body.error, 'Ongeldige UI state scope');

  const unavailableFixture = createFixture({
    getUiStateValues: async () => null,
  });
  const unavailableRes = createResponseRecorder();

  await unavailableFixture.coordinator.sendUiStateGetResponse(
    { query: {} },
    unavailableRes,
    'dashboard'
  );

  assert.equal(unavailableRes.statusCode, 503);
  assert.match(unavailableRes.body.error, /Kon UI state niet laden/i);
});

test('runtime ops coordinator merges patches for ui-state writes', async () => {
  const writes = [];
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: {
        panel: 'overview',
      },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    }),
    setUiStateValues: async (scope, values, meta) => {
      writes.push({ scope, values, meta });
      return {
        values,
        source: 'supabase',
        updatedAt: '2026-04-07T12:30:00.000Z',
      };
    },
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateSetResponse(
    {
      body: {
        patch: {
          drawer: 'open',
        },
        source: 'frontend',
        actor: 'serve',
      },
    },
    res,
    'dashboard'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(writes[0], {
    scope: 'dashboard',
    values: {
      panel: 'overview',
      drawer: 'open',
    },
    meta: {
      source: 'frontend',
      actor: 'serve',
    },
  });
});

test('runtime ops coordinator blocks admin-only ui-state scopes for non-admin users', async () => {
  const { coordinator, securityAuditCalls } = createFixture();
  const getRes = createResponseRecorder();
  const setRes = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: false, email: 'medewerker@softora.nl' },
      originalUrl: '/api/ui-state-get?scope=premium_password_register',
      headers: { origin: 'https://app.softora.nl' },
      get: () => 'agent',
      ip: '203.0.113.9',
    },
    getRes,
    'premium_password_register'
  );
  await coordinator.sendUiStateSetResponse(
    {
      premiumAuth: { authenticated: true, isAdmin: false, email: 'medewerker@softora.nl' },
      originalUrl: '/api/ui-state-set?scope=premium_password_register',
      headers: { origin: 'https://app.softora.nl' },
      get: () => 'agent',
      ip: '203.0.113.9',
      body: { values: { entries_json: '[]' } },
    },
    setRes,
    'premium_password_register'
  );

  assert.equal(getRes.statusCode, 403);
  assert.match(getRes.body.error, /Alleen Full Acces-accounts/i);
  assert.equal(setRes.statusCode, 403);
  assert.match(setRes.body.error, /Alleen Full Acces-accounts/i);
  assert.equal(securityAuditCalls.length, 2);
  assert.equal(securityAuditCalls[0].reason, 'security_admin_ui_state_scope_denied');
  assert.equal(securityAuditCalls[0].payload.type, 'admin_ui_state_scope_denied');
  assert.match(securityAuditCalls[0].payload.detail, /premium_password_register/);
});

test('runtime ops coordinator allows admin users on admin-only ui-state scopes', async () => {
  const { coordinator } = createFixture({
    getUiStateValues: async () => ({
      values: { entries_json: '[]' },
      source: 'supabase',
      updatedAt: '2026-04-07T12:00:00.000Z',
    }),
  });
  const res = createResponseRecorder();

  await coordinator.sendUiStateGetResponse(
    { premiumAuth: { authenticated: true, isAdmin: true } },
    res,
    'premium_password_register'
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, 'premium_password_register');
});

test('runtime ops coordinator creates manual dashboard activities with normalized defaults', () => {
  const { coordinator, dashboardActivityCalls } = createFixture();
  const res = createResponseRecorder();

  coordinator.sendDashboardActivityCreateResponse(
    {
      body: {
        type: 'contract_test',
        title: 'Handmatige update',
      },
    },
    res
  );

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(dashboardActivityCalls.length, 1);
  assert.equal(dashboardActivityCalls[0].reason, 'dashboard_activity_manual');
  assert.equal(dashboardActivityCalls[0].payload.source, 'premium-personeel-dashboard');
  assert.equal(dashboardActivityCalls[0].payload.actor, '');
});
