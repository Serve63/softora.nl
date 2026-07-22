const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registerRevenueProofRoutes } = require('../../server/routes/revenue-proof');

test('revenue proof keeps only the verified bank callback public', () => {
  const routes = [];
  const app = {
    post(routePath, ...handlers) { routes.push({ method: 'POST', routePath, handlers }); },
    get(routePath, ...handlers) { routes.push({ method: 'GET', routePath, handlers }); },
  };
  const requireAdmin = (_req, _res, next) => next();
  registerRevenueProofRoutes(app, {
    requirePremiumAdminApiAccess: requireAdmin,
    service: {
      bunqWebhookResponse() {},
      automationEventResponse() {},
      statusResponse() {},
    },
  });

  const webhook = routes.find((route) => route.routePath.endsWith('/bunq-webhook'));
  const events = routes.find((route) => route.routePath.endsWith('/events'));
  const status = routes.find((route) => route.routePath.endsWith('/status'));
  assert.equal(webhook.handlers.length, 1);
  assert.equal(events.handlers[0], requireAdmin);
  assert.equal(status.handlers[0], requireAdmin);
});

test('revenue proof forwards rejected service work to the server error boundary', async () => {
  const routes = [];
  const app = {
    post(routePath, ...handlers) { routes.push({ method: 'POST', routePath, handlers }); },
    get(routePath, ...handlers) { routes.push({ method: 'GET', routePath, handlers }); },
  };
  const expected = new Error('opslag tijdelijk niet beschikbaar');
  registerRevenueProofRoutes(app, {
    requirePremiumAdminApiAccess: (_req, _res, next) => next(),
    service: {
      async bunqWebhookResponse() { throw expected; },
      automationEventResponse() {},
      statusResponse() {},
    },
  });
  const webhook = routes.find((route) => route.routePath.endsWith('/bunq-webhook'));
  let forwarded = null;
  await webhook.handlers[0]({}, {}, (error) => { forwarded = error; });
  assert.equal(forwarded, expected);
});

test('revenue proof protected routes fail closed when the admin guard is absent', () => {
  const routes = [];
  let serviceCalls = 0;
  const app = {
    post(routePath, ...handlers) { routes.push({ method: 'POST', routePath, handlers }); },
    get(routePath, ...handlers) { routes.push({ method: 'GET', routePath, handlers }); },
  };
  registerRevenueProofRoutes(app, {
    service: {
      bunqWebhookResponse() {},
      automationEventResponse() { serviceCalls += 1; },
      statusResponse() { serviceCalls += 1; },
    },
  });
  const events = routes.find((route) => route.routePath.endsWith('/events'));
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  events.handlers[0]({}, res, () => { serviceCalls += 1; });
  assert.equal(res.statusCode, 503);
  assert.equal(serviceCalls, 0);
});

test('revenue proof migration is private, append-only evidence storage', () => {
  const migrationPath = path.join(
    __dirname,
    '../../supabase/migrations/20260722154315_autonomous_revenue_proof.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');
  assert.match(sql, /create table if not exists public\.softora_revenue_proof_events/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.softora_revenue_proof_events from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy/i);
  assert.match(sql, /softora_revenue_proof_events_append_only/);
  assert.match(sql, /before update or delete/);
  assert.match(sql, /event_kind <> 'cash_in' or source = 'bunq'/);
});
