const { createSupabaseStateStore } = require('./supabase-state');
const { createCallProviderHelpers } = require('./call-provider-helpers');
const { createCallUpdateRuntime } = require('./call-update-runtime');
const { createRuntimeHelpers } = require('./runtime-helpers');

function createPlatformRuntime(deps = {}) {
  const {
    env,
    normalizeString,
    normalizeColdcallingStack,
    parseNumberSafe,
    websiteAnthropicModel,
    anthropicModel,
    websiteGenerationProvider,
    dossierAnthropicModel,
    retellApiBaseUrl,
    twilioApiBaseUrl,
    defaultTwilioMediaWsUrl,
    fetchJsonWithTimeout,
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeNlPhoneToE164,
    parseIntSafe,
    truncateText,
    extractRetellTranscriptText,
    normalizeLeadLikePhoneKey,
    getLatestCallUpdateByCallId,
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    generatedAgendaAppointments,
    upsertRecentCallUpdate,
    retellCallStatusRefreshByCallId,
    retellStatusRefreshCooldownMs,
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseStateTable,
    supabaseStateKey,
    supabaseCallUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit,
  } = deps;

  const runtimeHelpers = createRuntimeHelpers({
    env,
    normalizeString,
    normalizeColdcallingStack,
    parseNumberSafe,
    websiteAnthropicModel,
    anthropicModel,
    websiteGenerationProvider,
    dossierAnthropicModel,
  });

  const callProviderHelpers = createCallProviderHelpers({
    env,
    retellApiBaseUrl,
    twilioApiBaseUrl,
    defaultTwilioMediaWsUrl,
    fetchJsonWithTimeout: (...args) => fetchJsonWithTimeout(...args),
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    appendQueryParamsToUrl,
    normalizeString,
    normalizeColdcallingStack,
    normalizeNlPhoneToE164,
    parseIntSafe,
    parseNumberSafe,
    truncateText,
    getColdcallingStackLabel: (...args) => runtimeHelpers.getColdcallingStackLabel(...args),
    extractRetellTranscriptText: (...args) => extractRetellTranscriptText(...args),
  });

  const {
    extractCallIdFromRecordingUrl,
    extractTwilioRecordingSidFromUrl,
    normalizeRecordingReference,
    fetchRetellCallStatusById,
    fetchTwilioCallStatusById,
    extractCallUpdateFromRetellCallStatusResponse,
    extractCallUpdateFromTwilioCallStatusResponse,
    isTerminalColdcallingStatus,
  } = callProviderHelpers;

  const callUpdateRuntime = createCallUpdateRuntime({
    normalizeString,
    normalizeColdcallingStack,
    normalizeLeadLikePhoneKey,
    extractCallIdFromRecordingUrl,
    extractTwilioRecordingSidFromUrl,
    normalizeRecordingReference,
    getLatestCallUpdateByCallId: (...args) => getLatestCallUpdateByCallId(...args),
    recentCallUpdates,
    callUpdatesById,
    recentAiCallInsights,
    generatedAgendaAppointments,
    inferCallProvider: (...args) => runtimeHelpers.inferCallProvider(...args),
    fetchRetellCallStatusById: (...args) => fetchRetellCallStatusById(...args),
    fetchTwilioCallStatusById: (...args) => fetchTwilioCallStatusById(...args),
    extractCallUpdateFromRetellCallStatusResponse,
    extractCallUpdateFromTwilioCallStatusResponse,
    upsertRecentCallUpdate: (...args) => upsertRecentCallUpdate(...args),
    isTwilioStatusApiConfigured: runtimeHelpers.isTwilioStatusApiConfigured,
    hasRetellApiKey: () => Boolean(normalizeString(env.RETELL_API_KEY)),
    isTerminalColdcallingStatus,
    retellCallStatusRefreshByCallId,
    retellStatusRefreshCooldownMs,
    logger: console,
  });

  const supabaseStateStore = createSupabaseStateStore({
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseStateTable,
    supabaseStateKey,
    supabaseCallUpdateStateKeyPrefix,
    supabaseCallUpdateRowsFetchLimit,
    normalizeString,
    truncateText,
  });

  return {
    ...runtimeHelpers,
    ...callProviderHelpers,
    ...callUpdateRuntime,
    ...supabaseStateStore,
  };
}

module.exports = {
  createPlatformRuntime,
};
