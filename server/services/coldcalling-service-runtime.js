const { createSequentialDispatchCoordinator } = require('./sequential-dispatch');
const { createColdcallingRuntime } = require('./coldcalling-runtime');
const { createCallWebhookRuntime } = require('./call-webhooks');

function createColdcallingServiceRuntime(deps = {}) {
  const {
    createQueueId,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    normalizeString,
    processColdcallingLead,
    logger = console,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    getColdcallingStackLabel,
    resolveColdcallingProviderForCampaign,
    buildRetellPayload,
    createRetellOutboundCall,
    classifyRetellFailure,
    toIsoFromUnixMilliseconds,
    upsertRecentCallUpdate,
    refreshCallUpdateFromRetellStatusApi,
    waitForQueuedRuntimeStatePersist,
    buildTwilioOutboundPayload,
    createTwilioOutboundCall,
    classifyTwilioFailure,
    parseDateToIso,
    ensureRuleBasedInsightAndAppointment,
    maybeAnalyzeCallUpdateWithAi,
    env,
    normalizeAbsoluteHttpUrl,
    getEffectivePublicBaseUrl,
    isSecureHttpRequest,
    appendQueryParamsToUrl,
    escapeHtml,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    appendSecurityAuditEvent,
    getTwilioMediaWsUrlForStack,
    buildTwilioStatusCallbackUrl,
    extractCallUpdateFromTwilioPayload,
    extractCallUpdateFromRetellPayload,
    recentWebhookEvents,
    verboseCallWebhookLogs,
    timingSafeEqualStrings,
  } = deps;

  let currentProcessColdcallingLead = (...args) => processColdcallingLead(...args);

  const sequentialDispatchCoordinator = createSequentialDispatchCoordinator({
    createQueueId,
    sequentialDispatchQueues,
    sequentialDispatchQueueIdByCallId,
    normalizeString,
    processColdcallingLead: (...args) => currentProcessColdcallingLead(...args),
    logInfo: (...args) => logger.log(...args),
    logError: (...args) => logger.error(...args),
  });

  const {
    sleep,
    createSequentialDispatchQueue,
    advanceSequentialDispatchQueue,
    handleSequentialDispatchQueueWebhookProgress,
  } = sequentialDispatchCoordinator;

  const coldcallingRuntime = createColdcallingRuntime({
    normalizeString,
    normalizeColdcallingStack,
    parseIntSafe,
    parseNumberSafe,
    getColdcallingStackLabel,
    resolveColdcallingProviderForCampaign,
    buildRetellPayload,
    createRetellOutboundCall,
    classifyRetellFailure,
    toIsoFromUnixMilliseconds,
    upsertRecentCallUpdate,
    refreshCallUpdateFromRetellStatusApi,
    waitForQueuedRuntimeStatePersist,
    sleep,
    buildTwilioOutboundPayload,
    createTwilioOutboundCall,
    getTwilioMediaWsUrlForStack,
    classifyTwilioFailure,
    parseDateToIso,
    handleSequentialDispatchQueueWebhookProgress,
    ensureRuleBasedInsightAndAppointment,
    maybeAnalyzeCallUpdateWithAi,
    logger,
  });

  currentProcessColdcallingLead = coldcallingRuntime.processColdcallingLead;

  const webhookRuntime = createCallWebhookRuntime({
    env,
    normalizeString,
    normalizeColdcallingStack,
    normalizeAbsoluteHttpUrl,
    getEffectivePublicBaseUrl,
    isSecureHttpRequest,
    appendQueryParamsToUrl,
    escapeHtml,
    getClientIpFromRequest,
    getRequestPathname,
    getRequestOriginFromHeaders,
    appendSecurityAuditEvent,
    getColdcallingStackLabel,
    getTwilioMediaWsUrlForStack,
    buildTwilioStatusCallbackUrl,
    upsertRecentCallUpdate,
    extractCallUpdateFromTwilioPayload,
    extractCallUpdateFromRetellPayload,
    triggerPostCallAutomation: coldcallingRuntime.triggerPostCallAutomation,
    waitForQueuedRuntimeStatePersist,
    recentWebhookEvents,
    verboseCallWebhookLogs,
    timingSafeEqualStrings,
    logger,
  });

  return {
    advanceSequentialDispatchQueue,
    createSequentialDispatchQueue,
    handleRetellWebhook: webhookRuntime.handleRetellWebhook,
    handleSequentialDispatchQueueWebhookProgress,
    handleTwilioInboundVoice: webhookRuntime.handleTwilioInboundVoice,
    handleTwilioStatusWebhook: webhookRuntime.handleTwilioStatusWebhook,
    processColdcallingLead: coldcallingRuntime.processColdcallingLead,
    processRetellColdcallingLead: coldcallingRuntime.processRetellColdcallingLead,
    processTwilioColdcallingLead: coldcallingRuntime.processTwilioColdcallingLead,
    sleep,
    triggerPostCallAutomation: coldcallingRuntime.triggerPostCallAutomation,
    validateStartPayload: coldcallingRuntime.validateStartPayload,
  };
}

module.exports = {
  createColdcallingServiceRuntime,
};
