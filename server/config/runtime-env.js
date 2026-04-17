function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeLoginEmailValue(value) {
  return normalizeString(value).toLowerCase();
}

function readBooleanEnvFlag(value, defaultValue = false) {
  const normalized = normalizeString(value);
  if (!normalized) return Boolean(defaultValue);
  return /^(1|true|yes)$/i.test(normalized);
}

function readNegatedBooleanEnvFlag(value, defaultValue = true) {
  const normalized = normalizeString(value);
  if (!normalized) return Boolean(defaultValue);
  return !/^(0|false|no)$/i.test(normalized);
}

function readBoundedNumberEnv(value, fallback, min, max) {
  const parsed = Number(value || fallback) || fallback;
  return Math.max(min, Math.min(max, parsed));
}

function loadRuntimeEnv(env = process.env) {
  const safeEnv = env && typeof env === 'object' ? env : {};
  const mailSmtpHostSource =
    safeEnv.MAIL_SMTP_HOST || safeEnv.SMTP_HOST || safeEnv.STRATO_SMTP_HOST || '';
  const mailSmtpPort = Number(
    safeEnv.MAIL_SMTP_PORT || safeEnv.SMTP_PORT || safeEnv.STRATO_SMTP_PORT || 587
  );
  const mailSmtpUser = normalizeString(
    safeEnv.MAIL_SMTP_USER || safeEnv.SMTP_USER || safeEnv.STRATO_SMTP_USER || ''
  );
  const mailSmtpPass = normalizeString(
    safeEnv.MAIL_SMTP_PASS || safeEnv.SMTP_PASS || safeEnv.STRATO_SMTP_PASS || ''
  );
  const mailImapPort = Number(
    safeEnv.MAIL_IMAP_PORT || safeEnv.IMAP_PORT || safeEnv.STRATO_IMAP_PORT || 993
  );
  const supabaseStateKey = normalizeString(safeEnv.SUPABASE_STATE_KEY || 'core');

  return {
    app: {
      port: Number(safeEnv.PORT) || 3000,
      isProduction: String(safeEnv.NODE_ENV || '').toLowerCase() === 'production',
      publicBaseUrl: normalizeString(safeEnv.PUBLIC_BASE_URL || safeEnv.APP_BASE_URL || ''),
    },
    ai: {
      retellApiBaseUrl: safeEnv.RETELL_API_BASE_URL || 'https://api.retellai.com',
      twilioApiBaseUrl: safeEnv.TWILIO_API_BASE_URL || 'https://api.twilio.com',
      openaiApiBaseUrl: safeEnv.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
      openaiModel: safeEnv.OPENAI_MODEL || 'gpt-4o-mini',
      openaiImageModel:
        safeEnv.OPENAI_IMAGE_MODEL || safeEnv.WEBSITE_PREVIEW_IMAGE_MODEL || 'gpt-image-1',
      anthropicApiBaseUrl: safeEnv.ANTHROPIC_API_BASE_URL || 'https://api.anthropic.com/v1',
      anthropicModel: safeEnv.ANTHROPIC_MODEL || safeEnv.CLAUDE_MODEL || 'claude-opus-4-6',
      websiteAnthropicModel:
        safeEnv.WEBSITE_ANTHROPIC_MODEL ||
        safeEnv.ANTHROPIC_WEBSITE_MODEL ||
        'claude-opus-4-6',
      dossierAnthropicModel:
        safeEnv.DOSSIER_ANTHROPIC_MODEL ||
        safeEnv.ANTHROPIC_DOSSIER_MODEL ||
        safeEnv.CLAUDE_DOSSIER_MODEL ||
        'claude-opus-4-6',
      verboseCallWebhookLogs: readBooleanEnvFlag(safeEnv.VERBOSE_CALL_WEBHOOK_LOGS),
      defaultTwilioMediaWsUrl: 'wss://twilio-media-bridge-pjzd.onrender.com/twilio-media',
    },
    websiteGeneration: {
      provider: normalizeString(
        safeEnv.WEBSITE_GENERATION_PROVIDER || safeEnv.SITE_GENERATION_PROVIDER || ''
      ).toLowerCase(),
      strictAnthropic: readNegatedBooleanEnvFlag(
        safeEnv.WEBSITE_GENERATION_STRICT_ANTHROPIC,
        true
      ),
      strictHtml: readNegatedBooleanEnvFlag(safeEnv.WEBSITE_GENERATION_STRICT_HTML, true),
      timeoutMs: readBoundedNumberEnv(
        safeEnv.WEBSITE_GENERATION_TIMEOUT_MS,
        300_000,
        60_000,
        600_000
      ),
    },
    activeOrderAutomation: {
      enabled: readBooleanEnvFlag(safeEnv.ACTIVE_ORDER_AUTOMATION_ENABLED),
      githubToken: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_TOKEN || safeEnv.GITHUB_TOKEN || ''
      ),
      githubOwner: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER || safeEnv.GITHUB_OWNER || ''
      ),
      githubPrivate: readNegatedBooleanEnvFlag(
        safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_PRIVATE || 'true',
        true
      ),
      githubOwnerIsOrg: readBooleanEnvFlag(safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_OWNER_IS_ORG),
      githubRepoPrefix: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_REPO_PREFIX || 'softora-case-'
      ).toLowerCase(),
      githubDefaultBranch:
        normalizeString(safeEnv.ACTIVE_ORDER_AUTOMATION_GITHUB_DEFAULT_BRANCH || 'main') || 'main',
      vercelToken: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_VERCEL_TOKEN || safeEnv.VERCEL_TOKEN || ''
      ),
      vercelScope: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_VERCEL_SCOPE || safeEnv.VERCEL_SCOPE || ''
      ),
      stratoCommand: normalizeString(safeEnv.ACTIVE_ORDER_AUTOMATION_STRATO_COMMAND || ''),
      stratoWebhookUrl: normalizeString(safeEnv.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_URL || ''),
      stratoWebhookToken: normalizeString(
        safeEnv.ACTIVE_ORDER_AUTOMATION_STRATO_WEBHOOK_TOKEN || ''
      ),
    },
    supabase: {
      url: normalizeString(safeEnv.SUPABASE_URL || ''),
      serviceRoleKey: normalizeString(safeEnv.SUPABASE_SERVICE_ROLE_KEY || ''),
      stateTable: normalizeString(safeEnv.SUPABASE_STATE_TABLE || 'softora_runtime_state'),
      stateKey: supabaseStateKey,
      callUpdateStateKeyPrefix: `${supabaseStateKey}:call_update:`,
      dismissedLeadsStateKey: `${supabaseStateKey}:dismissed_leads`,
      callUpdateRowsFetchLimit: 1000,
    },
    premiumAuth: {
      loginEmails: Array.from(
        new Set(
          String(safeEnv.PREMIUM_LOGIN_EMAILS || safeEnv.PREMIUM_LOGIN_EMAIL || '')
            .split(/[\s,;]+/)
            .map((value) => normalizeLoginEmailValue(value))
            .filter(Boolean)
        )
      ),
      loginPassword: normalizeString(safeEnv.PREMIUM_LOGIN_PASSWORD || ''),
      loginPasswordHash: normalizeString(safeEnv.PREMIUM_LOGIN_PASSWORD_HASH || ''),
      sessionSecret: normalizeString(safeEnv.PREMIUM_SESSION_SECRET || ''),
      sessionTtlHours: readBoundedNumberEnv(
        safeEnv.PREMIUM_SESSION_TTL_HOURS,
        12,
        1,
        24 * 30
      ),
      sessionRememberTtlDays: readBoundedNumberEnv(
        safeEnv.PREMIUM_SESSION_REMEMBER_TTL_DAYS,
        30,
        1,
        365
      ),
      sessionCookieName: 'softora_premium_session',
      mfaTotpSecret: normalizeString(safeEnv.PREMIUM_MFA_TOTP_SECRET || ''),
      adminIpAllowlist: normalizeString(safeEnv.PREMIUM_ADMIN_IP_ALLOWLIST || ''),
      enforceSameOriginRequests: readNegatedBooleanEnvFlag(
        safeEnv.PREMIUM_ENFORCE_SAME_ORIGIN_REQUESTS,
        true
      ),
      enableRuntimeDebugRoutes: readBooleanEnvFlag(safeEnv.PREMIUM_ENABLE_RUNTIME_DEBUG_ROUTES),
    },
    mail: {
      smtpHost: normalizeString(mailSmtpHostSource),
      smtpPort: mailSmtpPort,
      smtpUser: mailSmtpUser,
      smtpPass: mailSmtpPass,
      smtpSecure: readBooleanEnvFlag(
        safeEnv.MAIL_SMTP_SECURE || safeEnv.SMTP_SECURE || (mailSmtpPort === 465 ? 'true' : '')
      ),
      fromAddress: normalizeString(
        safeEnv.CONFIRMATION_MAIL_FROM ||
          safeEnv.MAIL_FROM ||
          safeEnv.STRATO_SMTP_FROM ||
          mailSmtpUser ||
          ''
      ),
      fromName: normalizeString(
        safeEnv.CONFIRMATION_MAIL_FROM_NAME || safeEnv.MAIL_FROM_NAME || 'Softora'
      ),
      replyTo: normalizeString(safeEnv.CONFIRMATION_MAIL_REPLY_TO || safeEnv.MAIL_REPLY_TO || ''),
      imapHost: normalizeString(
        safeEnv.MAIL_IMAP_HOST ||
          safeEnv.IMAP_HOST ||
          safeEnv.STRATO_IMAP_HOST ||
          (/strato/i.test(String(mailSmtpHostSource)) ? 'imap.strato.com' : '')
      ),
      imapPort: mailImapPort,
      imapSecure: readBooleanEnvFlag(
        safeEnv.MAIL_IMAP_SECURE || safeEnv.IMAP_SECURE || (mailImapPort === 993 ? 'true' : '')
      ),
      imapUser: normalizeString(
        safeEnv.MAIL_IMAP_USER || safeEnv.IMAP_USER || safeEnv.STRATO_IMAP_USER || mailSmtpUser || ''
      ),
      imapPass: normalizeString(
        safeEnv.MAIL_IMAP_PASS || safeEnv.IMAP_PASS || safeEnv.STRATO_IMAP_PASS || mailSmtpPass || ''
      ),
      imapMailbox: normalizeString(safeEnv.MAIL_IMAP_MAILBOX || safeEnv.IMAP_MAILBOX || 'INBOX') || 'INBOX',
      imapExtraMailboxes: String(safeEnv.MAIL_IMAP_MAILBOXES || '')
        .split(',')
        .map((value) => normalizeString(value))
        .filter(Boolean),
      imapPollCooldownMs: readBoundedNumberEnv(
        safeEnv.MAIL_IMAP_POLL_COOLDOWN_MS,
        20_000,
        5_000,
        300_000
      ),
    },
    securityContactEmail: normalizeString(safeEnv.SECURITY_CONTACT_EMAIL || 'info@softora.nl'),
    demoConfirmationTaskEnabled: readBooleanEnvFlag(safeEnv.ENABLE_DEMO_CONFIRMATION_TASK),
  };
}

module.exports = {
  loadRuntimeEnv,
  normalizeLoginEmailValue,
  readBooleanEnvFlag,
  readNegatedBooleanEnvFlag,
  readBoundedNumberEnv,
};
