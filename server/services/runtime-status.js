function createRuntimeStatusService(deps = {}) {
  const {
    env = {},
    isSupabaseConfigured = () => false,
    runtimeStateSyncState = {},
    supabaseStateTable = '',
    supabaseStateKey = '',
    isSmtpMailConfigured = () => false,
    isImapMailConfigured = () => false,
    mailImapMailbox = '',
    mailImapPollCooldownMs = 0,
    confirmationMailRuntimeState = {},
    getColdcallingProvider = () => 'retell',
    normalizeString = (value) => String(value || '').trim(),
    getMissingEnvVars = () => [],
    premiumSessionSecret = '',
    premiumSessionCookieName = '',
    isPremiumMfaConfigured = () => false,
    recentWebhookEvents = [],
    recentCallUpdates = [],
    recentAiCallInsights = [],
    recentSecurityAuditEvents = [],
    generatedAgendaAppointments = [],
  } = deps;

  function hasTwilioRegionalApiKeyPair() {
    return Boolean(
      normalizeString(env.TWILIO_API_KEY_SID) && normalizeString(env.TWILIO_API_KEY_SECRET)
    );
  }

  function hasTwilioLegacyAuth() {
    return Boolean(normalizeString(env.TWILIO_ACCOUNT_SID) && normalizeString(env.TWILIO_AUTH_TOKEN));
  }

  function getSupabaseStatus() {
    return {
      enabled: isSupabaseConfigured(),
      hydrated: Boolean(runtimeStateSyncState.supabaseStateHydrated),
      table: isSupabaseConfigured() ? supabaseStateTable : null,
      stateKey: isSupabaseConfigured() ? supabaseStateKey : null,
      lastHydrateError: runtimeStateSyncState.supabaseLastHydrateError || null,
      lastPersistError: runtimeStateSyncState.supabaseLastPersistError || null,
      lastCallUpdatePersistError: runtimeStateSyncState.supabaseLastCallUpdatePersistError || null,
    };
  }

  function getMailStatus() {
    return {
      smtpConfigured: isSmtpMailConfigured(),
      imapConfigured: isImapMailConfigured(),
      imapMailbox: isImapMailConfigured() ? mailImapMailbox : null,
      imapPollCooldownMs: mailImapPollCooldownMs,
      imapNextPollAfterMs: confirmationMailRuntimeState.inboundConfirmationMailSyncNotBeforeMs,
      imapLastSync: confirmationMailRuntimeState.inboundConfirmationMailSyncLastResult || null,
    };
  }

  function getAiStatus() {
    return {
      coldcallingProvider: getColdcallingProvider(),
      openaiConfigured: Boolean(normalizeString(env.OPENAI_API_KEY)),
      anthropicConfigured: Boolean(normalizeString(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY)),
      retellConfigured: Boolean(normalizeString(env.RETELL_API_KEY)),
      twilioConfigured: Boolean(
        normalizeString(env.TWILIO_ACCOUNT_SID) &&
          (hasTwilioLegacyAuth() || hasTwilioRegionalApiKeyPair())
      ),
      missingProviderEnv: getMissingEnvVars(getColdcallingProvider()),
    };
  }

  function getSessionStatus() {
    return {
      configured: Boolean(premiumSessionSecret),
      cookieName: premiumSessionCookieName,
      mfaConfigured: isPremiumMfaConfigured(),
    };
  }

  function getRuntimeStatus() {
    return {
      webhookEvents: recentWebhookEvents.length,
      callUpdates: recentCallUpdates.length,
      aiCallInsights: recentAiCallInsights.length,
      securityAuditEvents: recentSecurityAuditEvents.length,
      appointments: generatedAgendaAppointments.length,
      realCallUpdates: recentCallUpdates.filter((item) => {
        const callId = normalizeString(item?.callId || '');
        return callId && !callId.startsWith('demo-');
      }).length,
    };
  }

  return {
    getAiStatus,
    getMailStatus,
    getRuntimeStatus,
    getSessionStatus,
    getSupabaseStatus,
  };
}

module.exports = {
  createRuntimeStatusService,
};
