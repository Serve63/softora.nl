const test = require('node:test');
const assert = require('node:assert/strict');

const { loadRuntimeEnv } = require('../../server/config/runtime-env');

test('loadRuntimeEnv normalizes premium auth and supabase-derived keys', () => {
  const runtimeEnv = loadRuntimeEnv({
    NODE_ENV: 'production',
    PUBLIC_BASE_URL: ' https://softora.nl ',
    PREMIUM_LOGIN_EMAILS: ' Admin@Softora.NL, second@example.com;admin@softora.nl ',
    AGENDA_APP_PIN_HASH: ' sha256:abc123 ',
    AGENDA_APP_SERVE_EMAIL: ' Serve@Softora.NL ',
    AGENDA_APP_MARTIJN_EMAIL: ' MARTIJN@Softora.NL ',
    AGENDA_APP_SESSION_TTL_DAYS: '60',
    SUPABASE_STATE_KEY: ' core-v2 ',
  });

  assert.equal(runtimeEnv.app.isProduction, true);
  assert.equal(runtimeEnv.app.publicBaseUrl, 'https://softora.nl');
  assert.deepEqual(runtimeEnv.premiumAuth.loginEmails, [
    'admin@softora.nl',
    'second@example.com',
  ]);
  assert.equal(runtimeEnv.premiumAuth.agendaAppPinHash, 'sha256:abc123');
  assert.equal(runtimeEnv.premiumAuth.agendaAppServeEmail, 'serve@softora.nl');
  assert.equal(runtimeEnv.premiumAuth.agendaAppMartijnEmail, 'martijn@softora.nl');
  assert.equal(runtimeEnv.premiumAuth.agendaAppSessionTtlDays, 60);
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
    COLDMAIL_AUDIT_BCC: ' prive@example.nl ',
    COLDMAIL_UNSUBSCRIBE_SECRET: ' unsubscribe-secret ',
  });

  assert.equal(runtimeEnv.mail.smtpHost, 'smtp.strato.com');
  assert.equal(runtimeEnv.mail.smtpSecure, true);
  assert.equal(runtimeEnv.mail.fromAddress, 'team@softora.nl');
  assert.equal(runtimeEnv.mail.imapHost, 'imap.strato.com');
  assert.equal(runtimeEnv.mail.imapPort, 993);
  assert.equal(runtimeEnv.mail.imapSecure, true);
  assert.equal(runtimeEnv.mail.imapUser, 'team@softora.nl');
  assert.equal(runtimeEnv.mail.imapPass, 'secret');
  assert.equal(runtimeEnv.mail.coldmailCampaignSendLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailDailySendLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailPackageDailySendLimit, 81);
  assert.equal(runtimeEnv.mail.coldmailSendDelayMs, 90_000);
  assert.equal(runtimeEnv.mail.coldmailSafetyPauseMs, 21_600_000);
  assert.equal(runtimeEnv.mail.coldmailPersonalMailboxDailyLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailPersonalMailboxSendDelayMs, 180_000);
  assert.equal(runtimeEnv.mail.coldmailBounceProcessingEnabled, true);
  assert.equal(runtimeEnv.mail.coldmailBlockPersonalMailboxDomains, false);
  assert.equal(runtimeEnv.mail.coldmailAuditBcc, 'prive@example.nl');
  assert.equal(runtimeEnv.mail.coldmailUnsubscribeSecret, 'unsubscribe-secret');
  assert.equal(runtimeEnv.mail.coldmailTrackingSecret, 'unsubscribe-secret');
});

test('loadRuntimeEnv supports a separate coldmail tracking secret', () => {
  const runtimeEnv = loadRuntimeEnv({
    COLDMAIL_UNSUBSCRIBE_SECRET: 'unsubscribe-secret',
    COLDMAIL_TRACKING_SECRET: ' tracking-secret ',
  });

  assert.equal(runtimeEnv.mail.coldmailUnsubscribeSecret, 'unsubscribe-secret');
  assert.equal(runtimeEnv.mail.coldmailTrackingSecret, 'tracking-secret');
});

test('loadRuntimeEnv reads Instantly coldmail provider configuration', () => {
  const runtimeEnv = loadRuntimeEnv({
    INSTANTLY_ENABLED: 'true',
    INSTANTLY_SYNC_ENABLED: 'true',
    INSTANTLY_SCHEDULER_ENABLED: 'true',
    INSTANTLY_API_KEY: ' instantly-key ',
    INSTANTLY_API_BASE_URL: ' https://api.instantly.test/api/v2 ',
    INSTANTLY_DEFAULT_CAMPAIGN_ID: ' campaign-1 ',
    INSTANTLY_WEBHOOK_SECRET: ' webhook-secret ',
    INSTANTLY_SYNC_INTERVAL_MINUTES: '30',
    INSTANTLY_SYNC_BATCH_SIZE: '25',
    INSTANTLY_DAILY_CAP: '75',
    INSTANTLY_VERIFY_LEADS_ON_IMPORT: 'true',
    INSTANTLY_REQUIRE_WEBDESIGN_ASSETS: 'true',
    INSTANTLY_DEFAULT_SENDER_EMAIL: ' Serve@Softora.NL ',
    EMAIL_VERIFICATION_ENABLED: 'true',
    EMAIL_VERIFICATION_PROVIDER: ' zerobounce ',
    ZEROBOUNCE_API_KEY: ' zb-key ',
    ZEROBOUNCE_API_BASE_URL: ' https://api-eu.zerobounce.test/v2 ',
    EMAIL_VERIFICATION_REQUIRE_GREEN_FOR_OUTBOUND: 'true',
    EMAIL_VERIFICATION_TIMEOUT_MS: '22000',
  });

  assert.equal(runtimeEnv.instantly.enabled, true);
  assert.equal(runtimeEnv.instantly.syncEnabled, true);
  assert.equal(runtimeEnv.instantly.schedulerEnabled, true);
  assert.equal(runtimeEnv.instantly.apiKey, 'instantly-key');
  assert.equal(runtimeEnv.instantly.apiBaseUrl, 'https://api.instantly.test/api/v2');
  assert.equal(runtimeEnv.instantly.defaultCampaignId, 'campaign-1');
  assert.equal(runtimeEnv.instantly.webhookSecret, 'webhook-secret');
  assert.equal(runtimeEnv.instantly.syncIntervalMinutes, 30);
  assert.equal(runtimeEnv.instantly.syncBatchSize, 25);
  assert.equal(runtimeEnv.instantly.dailyCap, 75);
  assert.equal(runtimeEnv.instantly.verifyLeadsOnImport, true);
  assert.equal(runtimeEnv.instantly.requireWebdesignAssets, true);
  assert.equal(runtimeEnv.instantly.defaultSenderEmail, 'serve@softora.nl');
  assert.equal(runtimeEnv.emailVerification.enabled, true);
  assert.equal(runtimeEnv.emailVerification.provider, 'zerobounce');
  assert.equal(runtimeEnv.emailVerification.zeroBounceApiKey, 'zb-key');
  assert.equal(runtimeEnv.emailVerification.zeroBounceApiBaseUrl, 'https://api-eu.zerobounce.test/v2');
  assert.equal(runtimeEnv.emailVerification.requireGreenForOutbound, true);
  assert.equal(runtimeEnv.emailVerification.timeoutMs, 22000);
});

test('loadRuntimeEnv defaults email verification to strict Softora shield', () => {
  const runtimeEnv = loadRuntimeEnv({});

  assert.equal(runtimeEnv.emailVerification.enabled, true);
  assert.equal(runtimeEnv.emailVerification.provider, 'softora');
  assert.equal(runtimeEnv.emailVerification.requireGreenForOutbound, true);
});

test('loadRuntimeEnv lets the agenda app reuse the existing settings pin', () => {
  const fallbackRuntimeEnv = loadRuntimeEnv({
    PREMIUM_SETTINGS_CONFIRM_PIN: ' 123456 ',
  });
  const explicitRuntimeEnv = loadRuntimeEnv({
    PREMIUM_SETTINGS_CONFIRM_PIN: '123456',
    AGENDA_APP_PIN: '654321',
  });

  assert.equal(fallbackRuntimeEnv.premiumAuth.agendaAppPin, '123456');
  assert.equal(explicitRuntimeEnv.premiumAuth.agendaAppPin, '654321');
});

test('loadRuntimeEnv derives generic imap host from smtp subdomain', () => {
  const runtimeEnv = loadRuntimeEnv({
    MAIL_SMTP_HOST: 'smtp.softora.nl',
    MAIL_SMTP_USER: 'info@softora.nl',
    MAIL_SMTP_PASS: 'secret',
  });

  assert.equal(runtimeEnv.mail.imapHost, 'imap.softora.nl');
  assert.equal(runtimeEnv.mail.imapUser, 'info@softora.nl');
  assert.equal(runtimeEnv.mail.imapPass, 'secret');
});

test('loadRuntimeEnv clamps coldmail safety limits for Strato-safe sending', () => {
  const runtimeEnv = loadRuntimeEnv({
    COLDMAIL_CAMPAIGN_SEND_LIMIT: '500',
    COLDMAIL_DAILY_SEND_LIMIT: '250',
    COLDMAIL_PACKAGE_DAILY_SEND_LIMIT: '1000',
    COLDMAIL_SEND_DELAY_MS: '9999999',
    COLDMAIL_SAFETY_PAUSE_MS: '999999999',
    COLDMAIL_PERSONAL_MAILBOX_DAILY_LIMIT: '999',
    COLDMAIL_PERSONAL_MAILBOX_SEND_DELAY_MS: '9999999',
    COLDMAIL_BLOCK_PERSONAL_MAILBOX_DOMAINS: 'true',
  });

  assert.equal(runtimeEnv.mail.coldmailCampaignSendLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailDailySendLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailPackageDailySendLimit, 81);
  assert.equal(runtimeEnv.mail.coldmailSendDelayMs, 300_000);
  assert.equal(runtimeEnv.mail.coldmailSafetyPauseMs, 86_400_000);
  assert.equal(runtimeEnv.mail.coldmailPersonalMailboxDailyLimit, 9);
  assert.equal(runtimeEnv.mail.coldmailPersonalMailboxSendDelayMs, 300_000);
  assert.equal(runtimeEnv.mail.coldmailBlockPersonalMailboxDomains, true);
});

test('loadRuntimeEnv disables Anthropic defaults', () => {
  const runtimeEnv = loadRuntimeEnv({});
  const legacyEnv = loadRuntimeEnv({
    ANTHROPIC_API_BASE_URL: 'https://api.anthropic.test/v1',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    WEBSITE_ANTHROPIC_MODEL: 'claude-opus-4-6',
    ANTHROPIC_DOSSIER_MODEL: 'claude-opus-4-6',
    WEBSITE_GENERATION_PROVIDER: 'anthropic',
    SITE_GENERATION_PROVIDER: 'anthropic',
    WEBSITE_GENERATION_STRICT_ANTHROPIC: 'true',
  });

  assert.equal(runtimeEnv.ai.anthropicModel, '');
  assert.equal(runtimeEnv.ai.anthropicApiBaseUrl, '');
  assert.equal(runtimeEnv.ai.websiteAnthropicModel, '');
  assert.equal(runtimeEnv.ai.dossierAnthropicModel, '');
  assert.equal(runtimeEnv.websiteGeneration.provider, 'openai');
  assert.equal(runtimeEnv.websiteGeneration.strictAnthropic, false);
  assert.equal(legacyEnv.ai.anthropicModel, '');
  assert.equal(legacyEnv.ai.anthropicApiBaseUrl, '');
  assert.equal(legacyEnv.ai.websiteAnthropicModel, '');
  assert.equal(legacyEnv.ai.dossierAnthropicModel, '');
  assert.equal(legacyEnv.websiteGeneration.provider, 'openai');
  assert.equal(legacyEnv.websiteGeneration.strictAnthropic, false);
});

test('loadRuntimeEnv defaults OpenAI text calls to GPT-5.5 Pro', () => {
  const runtimeEnv = loadRuntimeEnv({});

  assert.equal(runtimeEnv.ai.openaiModel, 'gpt-5.5-pro');
  assert.equal(runtimeEnv.ai.openaiImageModel, 'gpt-image-2');
  assert.equal(runtimeEnv.premiumAuth.agendaAppSessionTtlDays, 30);
});

test('loadRuntimeEnv reads Google Calendar sync configuration', () => {
  const runtimeEnv = loadRuntimeEnv({
    GOOGLE_CALENDAR_SYNC_ENABLED: 'true',
    GOOGLE_CALENDAR_CLIENT_EMAIL: ' calendar-sync@example.iam.gserviceaccount.com ',
    GOOGLE_CALENDAR_PRIVATE_KEY: '---PRIVATE---',
    GOOGLE_CALENDAR_SERVE_ID: 'serve-calendar@example.com',
    GOOGLE_CALENDAR_MARTIJN_ID: 'martijn-calendar@example.com',
    GOOGLE_CALENDAR_TIMEZONE: 'Europe/Amsterdam',
    GOOGLE_CALENDAR_SYNC_COOLDOWN_MS: '30000',
  });

  assert.equal(runtimeEnv.googleCalendar.enabled, true);
  assert.equal(runtimeEnv.googleCalendar.clientEmail, 'calendar-sync@example.iam.gserviceaccount.com');
  assert.equal(runtimeEnv.googleCalendar.privateKey, '---PRIVATE---');
  assert.equal(runtimeEnv.googleCalendar.serveCalendarId, 'serve-calendar@example.com');
  assert.equal(runtimeEnv.googleCalendar.martijnCalendarId, 'martijn-calendar@example.com');
  assert.equal(runtimeEnv.googleCalendar.timezone, 'Europe/Amsterdam');
  assert.equal(runtimeEnv.googleCalendar.syncCooldownMs, 30000);
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
    AGENDA_APP_SESSION_TTL_DAYS: '99999',
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
  assert.equal(runtimeEnv.premiumAuth.agendaAppServeEmail, 'serve@softora.nl');
  assert.equal(runtimeEnv.premiumAuth.agendaAppMartijnEmail, 'martijn@softora.nl');
  assert.equal(runtimeEnv.premiumAuth.agendaAppSessionTtlDays, 90);
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
