const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifySoftoraResult,
  classifyZeroBounceResult,
  createPremiumDatabaseEmailVerificationService,
  getEmailVerificationBlockReason,
} = require('../../server/services/premium-database-email-verification');
const { registerPremiumDatabaseEmailVerificationRoutes } = require('../../server/routes/premium-database-email-verification');

function createResponseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return payload;
    },
  };
}

test('premium database email verification maps provider verdicts into green orange red', () => {
  const checkedAt = '2026-06-17T09:45:00.000Z';
  assert.equal(
    classifyZeroBounceResult({ status: 'valid', sub_status: '' }, 'julia@bedrijf.nl', checkedAt).verdict,
    'green'
  );
  assert.equal(
    classifyZeroBounceResult({ status: 'valid', sub_status: '' }, 'info@bedrijf.nl', checkedAt).verdict,
    'orange'
  );
  assert.equal(
    classifyZeroBounceResult({ status: 'valid', sub_status: 'accept_all' }, 'julia@bedrijf.nl', checkedAt).verdict,
    'orange'
  );
  assert.equal(
    classifyZeroBounceResult({ status: 'invalid', sub_status: 'mailbox_not_found' }, 'julia@bedrijf.nl', checkedAt).verdict,
    'red'
  );
});

test('premium database email verification writes results and hard-blocks red rows', async () => {
  const rows = [
    { id: 'good', bedrijf: 'Groen BV', email: 'julia@groen.test', status: 'benaderbaar', mail: true },
    { id: 'role', bedrijf: 'Role BV', email: 'info@role.test', status: 'benaderbaar', mail: true },
    { id: 'bad', bedrijf: 'Rood BV', email: 'bad@rood.test', status: 'benaderbaar', mail: true },
  ];
  let savedRows = null;
  const fetchCalls = [];
  const service = createPremiumDatabaseEmailVerificationService({
    emailVerificationConfig: {
      provider: 'zerobounce',
      zeroBounceApiKey: 'zb-key',
      zeroBounceApiBaseUrl: 'https://api-eu.zerobounce.test/v2',
    },
    getUiStateValues: async () => ({
      values: {
        softora_customers_premium_v1: JSON.stringify(rows),
      },
    }),
    setUiStateValues: async (_scope, values) => {
      savedRows = JSON.parse(values.softora_customers_premium_v1);
      return { ok: true };
    },
    fetchJsonWithTimeout: async (url) => {
      fetchCalls.push(url);
      const email = new URL(url).searchParams.get('email');
      if (email === 'bad@rood.test') {
        return { response: { ok: true, status: 200 }, data: { status: 'invalid', sub_status: 'mailbox_not_found' } };
      }
      return { response: { ok: true, status: 200 }, data: { status: 'valid', sub_status: '' } };
    },
    now: () => new Date('2026-06-17T09:45:00.000Z'),
  });

  const result = await service.verifyDatabaseEmails({ limit: 3, actor: 'Servé' });

  assert.equal(result.checked, 3);
  assert.equal(result.summary.green, 1);
  assert.equal(result.summary.orange, 1);
  assert.equal(result.summary.red, 1);
  assert.equal(fetchCalls.length, 3);
  assert.match(fetchCalls[0], /^https:\/\/api-eu\.zerobounce\.test\/v2\/validate\?/);
  assert.match(fetchCalls[0], /api_key=zb-key/);
  assert.equal(savedRows[0].emailVerificationVerdict, 'green');
  assert.equal(savedRows[0].emailVerificationMailReady, true);
  assert.equal(savedRows[1].emailVerificationVerdict, 'orange');
  assert.equal(savedRows[1].mail, true);
  assert.equal(savedRows[2].emailVerificationVerdict, 'red');
  assert.equal(savedRows[2].mail, false);
  assert.equal(savedRows[2].canMail, false);
  assert.equal(savedRows[2].doNotMail, true);
  assert.equal(savedRows[2].status, 'geblokkeerd');
  assert.equal(savedRows[2].hist[0].source, 'premium-database-email-verification');
  assert.match(getEmailVerificationBlockReason(savedRows[1]), /Role-based/);
  assert.equal(getEmailVerificationBlockReason(savedRows[0]), '');
});

test('premium database email verification softora provider works without paid api key', async () => {
  const rows = [
    { id: 'good', bedrijf: 'Groen BV', email: 'julia@groen.nl', status: 'benaderbaar', mail: true },
    { id: 'role', bedrijf: 'Role BV', email: 'info@role.nl', status: 'benaderbaar', mail: true },
    { id: 'risky-role', bedrijf: 'Risky Role BV', email: 'privacy@risk.nl', status: 'benaderbaar', mail: true },
    { id: 'disposable', bedrijf: 'Temp BV', email: 'lead@mailinator.com', status: 'benaderbaar', mail: true },
    { id: 'nomail', bedrijf: 'No Mail BV', email: 'team@nomail.nl', status: 'benaderbaar', mail: true },
    {
      id: 'bounced',
      bedrijf: 'Bounce BV',
      email: 'jan@bounce.nl',
      status: 'benaderbaar',
      mail: true,
      coldmailBounceType: 'hard',
    },
  ];
  let savedRows = null;
  const service = createPremiumDatabaseEmailVerificationService({
    emailVerificationConfig: {
      provider: 'softora',
    },
    getUiStateValues: async () => ({
      values: {
        softora_customers_premium_v1: JSON.stringify(rows),
      },
    }),
    setUiStateValues: async (_scope, values) => {
      savedRows = JSON.parse(values.softora_customers_premium_v1);
      return { ok: true };
    },
    resolveMx: async (domain) => {
      if (domain === 'nomail.nl') return [{ priority: 0, exchange: '.' }];
      return [{ priority: 10, exchange: `mx.${domain}` }];
    },
    resolve4: async () => ['203.0.113.10'],
    resolve6: async () => [],
    now: () => new Date('2026-06-17T09:45:00.000Z'),
  });

  assert.equal(service.getStatus().configured, true);
  assert.deepEqual(service.getStatus().missing, []);

  const result = await service.verifyDatabaseEmails({ limit: 6, actor: 'Servé' });

  assert.equal(result.provider, 'softora');
  assert.equal(result.summary.green, 2);
  assert.equal(result.summary.orange, 1);
  assert.equal(result.summary.red, 3);
  assert.equal(savedRows[0].emailVerificationVerdict, 'green');
  assert.equal(savedRows[0].emailVerificationScore, 100);
  assert.equal(savedRows[1].emailVerificationVerdict, 'green');
  assert.equal(savedRows[1].emailVerificationMailReady, true);
  assert.equal(savedRows[1].emailVerificationScore, 85);
  assert.match(savedRows[1].emailVerificationSignals, /role_based/);
  assert.equal(getEmailVerificationBlockReason(savedRows[1]), '');
  assert.equal(savedRows[2].emailVerificationVerdict, 'orange');
  assert.match(getEmailVerificationBlockReason(savedRows[2]), /Role-based/);
  assert.equal(savedRows[3].emailVerificationVerdict, 'red');
  assert.equal(savedRows[3].doNotMail, true);
  assert.match(savedRows[3].emailVerificationSignals, /disposable_domain/);
  assert.equal(savedRows[4].emailVerificationVerdict, 'red');
  assert.match(savedRows[4].emailVerificationSignals, /null_mx/);
  assert.equal(savedRows[5].emailVerificationVerdict, 'red');
  assert.match(savedRows[5].emailVerificationSignals, /prior_hard_bounce/);
});

test('premium database email verification softora provider allows public company inboxes with healthy DNS', async () => {
  const checkedAt = '2026-06-17T09:45:00.000Z';
  const helpers = {
    resolveMx: async (domain) => [{ priority: 10, exchange: `mx.${domain}` }],
    resolve4: async () => ['203.0.113.10'],
    resolve6: async () => [],
  };

  for (const email of ['info@bedrijf.nl', 'admin@bedrijf.nl', 'support@bedrijf.nl']) {
    const result = await classifySoftoraResult(email, {}, checkedAt, helpers);
    assert.equal(result.verdict, 'green', email);
    assert.equal(result.mailReady, true, email);
    assert.equal(result.roleBased, true, email);
    assert.equal(result.subStatus, 'role_based', email);
    assert.equal(result.score, 85, email);
  }
});

test('premium database email verification defaults to softora and requires green for outbound', () => {
  const service = createPremiumDatabaseEmailVerificationService({});
  const status = service.getStatus();

  assert.equal(status.provider, 'softora');
  assert.equal(status.configured, true);
  assert.equal(status.requireGreenForOutbound, true);
  assert.equal(getEmailVerificationBlockReason({}, { requireGreen: status.requireGreenForOutbound }), 'E-mailadres is nog niet groen geverifieerd.');
});

test('premium database email verification still supports zerobounce when explicitly configured', () => {
  const service = createPremiumDatabaseEmailVerificationService({
    emailVerificationConfig: {
      provider: 'zerobounce',
      zeroBounceApiKey: 'zb-key',
    },
  });
  const status = service.getStatus();

  assert.equal(status.provider, 'zerobounce');
  assert.equal(status.configured, true);
  assert.deepEqual(status.missing, []);
});

test('premium database email verification softora provider treats mx fallback as risky', async () => {
  const checkedAt = '2026-06-17T09:45:00.000Z';
  const dnsMiss = Object.assign(new Error('no mx'), { code: 'ENODATA' });
  const result = await classifySoftoraResult(
    'julia@fallback.nl',
    {},
    checkedAt,
    {
      resolveMx: async () => {
        throw dnsMiss;
      },
      resolve4: async () => ['203.0.113.10'],
      resolve6: async () => [],
    }
  );

  assert.equal(result.verdict, 'orange');
  assert.equal(result.subStatus, 'implicit_mx_fallback');
  assert.equal(result.mailReady, false);
});

test('premium database email verification routes require admin and expose safe errors', async () => {
  const routes = [];
  let adminChecks = 0;
  let verifyInput = null;
  const app = {
    get(path, ...handlers) {
      routes.push(['GET', path, handlers]);
    },
    post(path, ...handlers) {
      routes.push(['POST', path, handlers]);
    },
  };

  registerPremiumDatabaseEmailVerificationRoutes(app, {
    requirePremiumAdminApiAccess(req, _res, next) {
      adminChecks += 1;
      req.premiumAuth = { email: 'serve@softora.nl' };
      next();
    },
    coordinator: {
      getStatus() {
        return { ok: true, configured: true };
      },
      async verifyDatabaseEmails(input) {
        verifyInput = input;
        return { ok: true, checked: 2 };
      },
    },
  });

  const statusRoute = routes.find(([method, path]) => method === 'GET' && path === '/api/premium-database/email-verification/status');
  const verifyRoute = routes.find(([method, path]) => method === 'POST' && path === '/api/premium-database/email-verification/verify');
  assert.ok(statusRoute);
  assert.ok(verifyRoute);

  const statusResponse = createResponseRecorder();
  statusRoute[2][0]({}, statusResponse, () => {});
  await statusRoute[2][1]({}, statusResponse);
  assert.equal(statusResponse.body.configured, true);

  const verifyRequest = { body: { limit: 25, force: true } };
  const verifyResponse = createResponseRecorder();
  verifyRoute[2][0](verifyRequest, verifyResponse, () => {});
  await verifyRoute[2][1](verifyRequest, verifyResponse);
  assert.equal(verifyResponse.body.checked, 2);
  assert.equal(verifyInput.limit, 25);
  assert.equal(verifyInput.force, true);
  assert.equal(verifyInput.actor, 'serve@softora.nl');
  assert.equal(adminChecks, 2);
});
