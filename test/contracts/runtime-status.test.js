const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeStatusService } = require('../../server/services/runtime-status');

test('runtime status service exposes stable dependency and runtime payloads', () => {
  const service = createRuntimeStatusService({
    env: {
      OPENAI_API_KEY: 'openai-key',
      ANTHROPIC_API_KEY: 'anthropic-key',
      RETELL_API_KEY: 'retell-key',
      TWILIO_ACCOUNT_SID: 'sid',
      TWILIO_AUTH_TOKEN: 'token',
    },
    isSupabaseConfigured: () => true,
    runtimeStateSyncState: {
      supabaseStateHydrated: true,
      supabaseLastHydrateError: null,
      supabaseLastPersistError: 'persist failed',
      supabaseLastCallUpdatePersistError: 'call update failed',
    },
    supabaseStateTable: 'runtime_state',
    supabaseStateKey: 'softora',
    isSmtpMailConfigured: () => true,
    isImapMailConfigured: () => true,
    mailImapMailbox: 'INBOX',
    mailImapPollCooldownMs: 1234,
    confirmationMailRuntimeState: {
      inboundConfirmationMailSyncNotBeforeMs: 4567,
      inboundConfirmationMailSyncLastResult: { ok: true },
    },
    getColdcallingProvider: () => 'retell',
    normalizeString: (value) => String(value || '').trim(),
    getMissingEnvVars: () => ['RETELL_API_KEY'],
    premiumSessionSecret: 'secret',
    premiumSessionCookieName: 'softora_session',
    isPremiumMfaConfigured: () => true,
    recentWebhookEvents: [{ id: 1 }],
    recentCallUpdates: [{ callId: 'call-1' }, { callId: 'demo-seed' }],
    recentAiCallInsights: [{ id: 2 }],
    recentSecurityAuditEvents: [{ id: 3 }],
    generatedAgendaAppointments: [{ id: 4 }],
  });

  assert.deepEqual(service.getSupabaseStatus(), {
    enabled: true,
    hydrated: true,
    table: 'runtime_state',
    stateKey: 'softora',
    lastHydrateError: null,
    lastPersistError: 'persist failed',
    lastCallUpdatePersistError: 'call update failed',
  });
  assert.deepEqual(service.getMailStatus(), {
    smtpConfigured: true,
    imapConfigured: true,
    imapMailbox: 'INBOX',
    imapPollCooldownMs: 1234,
    imapNextPollAfterMs: 4567,
    imapLastSync: { ok: true },
  });
  assert.deepEqual(service.getAiStatus(), {
    coldcallingProvider: 'retell',
    openaiConfigured: true,
    anthropicConfigured: true,
    retellConfigured: true,
    twilioConfigured: true,
    missingProviderEnv: ['RETELL_API_KEY'],
  });
  assert.deepEqual(service.getSessionStatus(), {
    configured: true,
    cookieName: 'softora_session',
    mfaConfigured: true,
  });
  assert.deepEqual(service.getRuntimeStatus(), {
    webhookEvents: 1,
    callUpdates: 2,
    aiCallInsights: 1,
    securityAuditEvents: 1,
    appointments: 1,
    realCallUpdates: 1,
  });
});
