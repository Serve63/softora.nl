const { createActiveOrderAutomationService } = require('./active-order-automation');
const { createActiveOrdersCoordinator } = require('./active-orders');
const { createAiToolsCoordinator } = require('./ai-tools');
const { createRubenAssistant } = require('./ruben-assistant');
const { createRubenAssistantKnowledge } = require('./ruben-assistant-knowledge');
const { createAiDashboardCoordinator } = require('./ai-dashboard');

function createAiDashboardRuntime(deps = {}) {
  const {
    activeOrderAutomation,
    normalizeString,
    truncateText,
    sanitizeReferenceImages,
    sanitizeLaunchDomainName,
    generateWebsiteHtmlWithAi,
    appendDashboardActivity,
    getOpenAiApiKey,
    getAnthropicApiKey,
    getWebsiteGenerationProvider,
    getWebsiteAnthropicModel,
    openAiModel,
    websiteGenerationStrictAnthropic,
    websiteGenerationStrictHtml,
    fetchWebsitePreviewScanFromUrl,
    generateWebsitePreviewImageWithAi,
    openAiImageModel,
    buildOrderDossierInput,
    generateDynamicOrderDossierWithAnthropic,
    buildOrderDossierFallbackLayout,
    getDossierAnthropicModel,
    generateWebsitePromptFromTranscriptWithAi,
    buildWebsitePromptFallback,
    extractMeetingNotesFromImageWithAi,
    summarizeMeetingTranscriptWithAi,
    transcribeMeetingAudioWithAi,
    logger = console,
    parseJsonLoose,
    getUiStateValues,
    parseNumberSafe,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    toBooleanSafe,
    resolvePreferredRecordingUrl,
    premiumActiveOrdersScope,
    premiumCustomersScope,
    premiumActiveCustomOrdersKey,
    premiumActiveRuntimeKey,
    premiumCustomersKey,
    parseCustomOrdersFromUiState,
    recentCallUpdates,
    generatedAgendaAppointments,
    recentAiCallInsights,
    recentDashboardActivities,
    fetchJsonWithTimeout,
    openAiApiBaseUrl,
    extractOpenAiTextContent,
    ensureDashboardChatRuntimeReady,
    normalizeAiSummaryStyle,
    generateTextSummaryWithAi,
    parseIntSafe,
  } = deps;

  const { runActiveOrderLaunchPipeline } = createActiveOrderAutomationService({
    automationEnabled: activeOrderAutomation.enabled,
    githubToken: activeOrderAutomation.githubToken,
    githubOwner: activeOrderAutomation.githubOwner,
    githubPrivate: activeOrderAutomation.githubPrivate,
    githubOwnerIsOrg: activeOrderAutomation.githubOwnerIsOrg,
    githubRepoPrefix: activeOrderAutomation.githubRepoPrefix,
    githubDefaultBranch: activeOrderAutomation.githubDefaultBranch,
    vercelToken: activeOrderAutomation.vercelToken,
    vercelScope: activeOrderAutomation.vercelScope,
    stratoCommand: activeOrderAutomation.stratoCommand,
    stratoWebhookUrl: activeOrderAutomation.stratoWebhookUrl,
    stratoWebhookToken: activeOrderAutomation.stratoWebhookToken,
    normalizeString,
    truncateText,
    sanitizeLaunchDomainName,
    slugifyAutomationText: deps.slugifyAutomationText,
    logger,
  });

  const activeOrdersCoordinator = createActiveOrdersCoordinator({
    normalizeString,
    truncateText,
    sanitizeReferenceImages,
    sanitizeLaunchDomainName,
    generateWebsiteHtmlWithAi,
    runActiveOrderLaunchPipeline,
    appendDashboardActivity,
    getOpenAiApiKey,
    getAnthropicApiKey,
    getWebsiteGenerationProvider,
    getWebsiteAnthropicModel,
    openAiModel,
    websiteGenerationStrictAnthropic,
    websiteGenerationStrictHtml,
  });

  const aiToolsCoordinator = createAiToolsCoordinator({
    normalizeString,
    truncateText,
    fetchWebsitePreviewScanFromUrl,
    generateWebsitePreviewImageWithAi,
    appendDashboardActivity,
    getOpenAiApiKey,
    openAiImageModel,
    buildOrderDossierInput,
    generateDynamicOrderDossierWithAnthropic,
    buildOrderDossierFallbackLayout,
    getAnthropicApiKey,
    getDossierAnthropicModel,
    generateWebsitePromptFromTranscriptWithAi,
    buildWebsitePromptFallback,
    extractMeetingNotesFromImageWithAi,
    summarizeMeetingTranscriptWithAi,
    transcribeMeetingAudioWithAi,
    logger,
  });

  const rubenAssistantKnowledge = createRubenAssistantKnowledge({
    repoRoot: process.cwd(),
    logger,
  });

  const rubenAssistant = createRubenAssistant({
    normalizeString,
    truncateText,
    parseJsonLoose,
    getUiStateValues,
    buildKnowledgeContext: rubenAssistantKnowledge.buildKnowledgeContext,
    assistantMemoryScope: 'ruben_nijhuis_memory',
    assistantName: 'Ruben Nijhuis',
  });

  const aiDashboardCoordinator = createAiDashboardCoordinator({
    normalizeString,
    truncateText,
    parseJsonLoose,
    parseNumberSafe,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    toBooleanSafe,
    resolvePreferredRecordingUrl,
    getUiStateValues,
    premiumActiveOrdersScope,
    premiumCustomersScope,
    premiumActiveCustomOrdersKey,
    premiumActiveRuntimeKey,
    premiumCustomersKey,
    parseCustomOrdersFromUiState,
    recentCallUpdates,
    generatedAgendaAppointments,
    recentAiCallInsights,
    recentDashboardActivities,
    getOpenAiApiKey,
    fetchJsonWithTimeout,
    openAiApiBaseUrl,
    openAiModel,
    extractOpenAiTextContent,
    ensureDashboardChatRuntimeReady,
    normalizeAiSummaryStyle,
    generateTextSummaryWithAi,
    parseIntSafe,
    rubenAssistant,
  });

  return {
    activeOrdersCoordinator,
    aiDashboardCoordinator,
    aiToolsCoordinator,
  };
}

module.exports = {
  createAiDashboardRuntime,
};
