const test = require('node:test');
const assert = require('node:assert/strict');

const { loadRuntimeEnv } = require('../../server/config/runtime-env');

test('loadRuntimeEnv normalizes premium auth and supabase-derived keys', () => {
  const runtimeEnv = loadRuntimeEnv({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: ' https://softora.nl ',
    PREMIUM_LOGIN_EMAILS: ' Admin@Softora.NL, second@example.com;admin@softora.nl ',
    SUPABASE_STATE_KEY: ' core-v2 ',
  });

  assert.equal(runtimeEnv.app.isProduction, true);
  assert.equal(runtimeEnv.app.publicBaseUrl, 'https://softora.nl');
  assert.deepEqual(runtimeEnv.premiumAuth.loginEmails, [
    'admin@softora.nl',
    'second@example.com',
  ]);
  assert.equal(runtimeEnv.supabase.stateKey, 'core-v2');
  assert.equal(runtimeEnv.supabase.callUpdateStateKeyPrefix, 'core-v2:call_update:');
  assert.equal(runtimeEnv.supabase.dismissedLeadsStateKey, 'core-v2:dismissed_leads');
});

test('loadRuntimeEnv derives Strato mail defaults from SMTP settings', () => {
  const runtimeEnv = loadRuntimeEnv({
    MAIL_SMTP_HOST: 'smtp.strato.com',
    MAIL_SMTP_PORT: '465',
    MAIL_SMTP_USER: 'team@softora.nl',
    MAIL_SMTP_PASS: 'secret',
  });

  assert.equal(runtimeEnv.mail.smtpHost, 'smtp.strato.com');
  assert.equal(runtimeEnv.mail.smtpSecure, true);
  assert.equal(runtimeEnv.mail.fromAddress, 'team@softora.nl');
  assert.equal(runtimeEnv.mail.imapHost, 'imap.strato.com');
  assert.equal(runtimeEnv.mail.imapPort, 993);
  assert.equal(runtimeEnv.mail.imapSecure, true);
  assert.equal(runtimeEnv.mail.imapUser, 'team@softora.nl');
  assert.equal(runtimeEnv.mail.imapPass, 'secret');
});

test('loadRuntimeEnv defaults dashboard Anthropic model to Claude Sonnet 4.6', () => {
  const runtimeEnv = loadRuntimeEnv({});

  assert.equal(runtimeEnv.ai.anthropicModel, 'claude-sonnet-4-6');
});

test('loadRuntimeEnv preserves legacy boolean and numeric fallback rules', () => {
  const runtimeEnv = loadRuntimeEnv({
    WEBSITE_GENERATION_TIMEOUT_MS: '99999999',
    PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS: 'custom',
    WEBSITE_GENERATION_STRICT_ANTHROPIC: '0',
    WEBSITE_GENERATION_STRICT_HTML: 'no',
    ACTIVE_ORDER_AUTOMATION_ENABLED: 'yes',
    ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE: 'false',
    PREMIUM_SESSION_TTL_HOURS: '0',
    PREMIUM_SESSION_REMEMBER_TTL_DAYS: '9999',
    MAIL_IMAP_POLL_COOLDOWN_MS: '1',
    ENABLE_DEMO_CONFIRMATION_TASK: 'true',
  });

  assert.equal(runtimeEnv.websiteGeneration.timeoutMs, 600_000);
  assert.equal(runtimeEnv.websiteGeneration.strictAnthropic, false);
  assert.equal(runtimeEnv.websiteGeneration.strictHtml, false);
  assert.equal(runtimeEnv.activeOrderAutomation.enabled, true);
  assert.equal(runtimeEnv.activeOrderAutomation.githubPrivate, false);
  assert.equal(runtimeEnv.premiumAuth.enforceSameOriginRequests, true);
  assert.equal(runtimeEnv.premiumAuth.sessionTtlHours, 12);
  assert.equal(runtimeEnv.premiumAuth.sessionRememberTtlDays, 365);
  assert.equal(runtimeEnv.mail.imapPollCooldownMs, 5_000);
  assert.equal(runtimeEnv.demoConfirmationTaskEnabled, true);
});

test('loadRuntimeEnv derives the Twilio IE1 API host from region and edge env vars', () => {
  const runtimeEnv = loadRuntimeEnv({
    TWILIO_API_REGION: 'ie1',
    TWILIO_API_EDGE: 'dublin',
  });

  assert.equal(runtimeEnv.ai.twilioApiBaseUrl, 'https://api.dublin.ie1.twilio.com');
  assert.equal(
    runtimeEnv.ai.defaultTwilioMediaWsUrl,
    'wss://twilio-media-bridge-ln3f.onrender.com/twilio-media'
  );
});
