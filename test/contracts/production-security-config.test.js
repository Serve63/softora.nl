const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collectProductionSecurityFindings,
  runCli,
  shouldRunProductionSecurityCheck,
} = require('../../scripts/check-production-security');

function createCompleteProductionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'https://softora.nl',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
    PREMIUM_SESSION_SECRET: 'a'.repeat(48),
    PREMIUM_MFA_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
    PREMIUM_REQUIRE_MFA: 'true',
    PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS: 'true',
    PREMIUM_ADMIN_IP_ALLOWLIST: '203.0.113.10',
    RETELL_API_KEY: 'retell-key',
    RETELL_FROM_NUMBER: '+31101234567',
    RETELL_AGENT_ID: 'agent-123',
    ...overrides,
  };
}

test('production security check skips normal local development', () => {
  const env = {};

  assert.equal(shouldRunProductionSecurityCheck(env), false);

  const findings = collectProductionSecurityFindings(env);
  assert.equal(findings.skipped, true);
  assert.deepEqual(findings.violations, []);
});

test('production security check blocks missing required live protections', () => {
  const findings = collectProductionSecurityFindings({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: 'http://softora.nl',
    PREMIUM_REQUIRE_MFA: 'false',
    PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS: 'false',
  });
  const message = findings.violations.join('\n');

  assert.equal(findings.skipped, false);
  assert.match(message, /https URL/);
  assert.match(message, /SUPABASE_URL/);
  assert.match(message, /PREMIUM_SESSION_SECRET/);
  assert.match(message, /PREMIUM_REQUIRE_MFA/);
  assert.match(message, /PREMIUM_MFA_TOTP_SECRET/);
  assert.match(message, /PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS/);
  assert.match(message, /WEBHOOK_SECRET or RETELL_API_KEY/);
});

test('production security check accepts a complete Retell production config', () => {
  const findings = collectProductionSecurityFindings(createCompleteProductionEnv());

  assert.equal(findings.skipped, false);
  assert.equal(findings.provider, 'retell');
  assert.deepEqual(findings.violations, []);
});

test('production security cli returns a failing status for insecure production config', () => {
  const logs = [];
  const logger = {
    log: (message) => logs.push(['log', message]),
    warn: (message) => logs.push(['warn', message]),
    error: (message) => logs.push(['error', message]),
  };

  const status = runCli(
    createCompleteProductionEnv({
      PREMIUM_MFA_TOTP_SECRET: '',
    }),
    logger
  );

  assert.equal(status, 1);
  assert.ok(logs.some(([level, message]) => level === 'error' && /PREMIUM_MFA_TOTP_SECRET/.test(message)));
});
