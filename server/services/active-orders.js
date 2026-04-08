function createActiveOrdersCoordinator(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    sanitizeReferenceImages = () => [],
    sanitizeLaunchDomainName = () => '',
    generateWebsiteHtmlWithAi = async () => ({
      html: '',
      source: '',
      model: '',
      usage: null,
      apiCost: null,
    }),
    runActiveOrderLaunchPipeline = async () => ({ ok: true }),
    appendDashboardActivity = () => {},
    getOpenAiApiKey = () => '',
    getAnthropicApiKey = () => '',
    getWebsiteGenerationProvider = () => '',
    getWebsiteAnthropicModel = () => '',
    openAiModel = '',
    websiteGenerationStrictAnthropic = false,
    websiteGenerationStrictHtml = false,
  } = deps;

  async function sendGenerateSiteResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const prompt = normalizeString(body.prompt || '');
      const company = truncateText(normalizeString(body.company || body.clientName || ''), 160);
      const title = truncateText(normalizeString(body.title || ''), 200);
      const description = truncateText(normalizeString(body.description || ''), 3000);
      const language = normalizeString(body.language || 'nl') || 'nl';
      const orderId = Number(body.orderId) || null;
      const buildMode = normalizeString(body.buildMode || '') || null;
      const referenceImages = sanitizeReferenceImages(body.referenceImages || body.attachments || [], {
        maxItems: 6,
        maxBytesPerImage: 550 * 1024,
        maxTotalBytes: 3 * 1024 * 1024,
      });

      if (!prompt) {
        return res.status(400).json({
          ok: false,
          error: 'Prompt ontbreekt',
          detail: 'Stuur een body met minimaal { prompt: "..." }',
        });
      }

      const generated = await generateWebsiteHtmlWithAi({
        prompt,
        company,
        title,
        description,
        language,
        referenceImages,
      });

      appendDashboardActivity(
        {
          type: 'active_order_generated',
          title: 'AI website gegenereerd',
          detail: `HTML-opzet gegenereerd${company ? ` voor ${company}` : ''}${referenceImages.length ? ` met ${referenceImages.length} referentiebeeld(en)` : ''}.`,
          company,
          actor: 'api',
          taskId: Number.isFinite(orderId) ? orderId : null,
          source: 'premium-actieve-opdrachten',
        },
        'dashboard_activity_active_order_generated'
      );

      return res.status(200).json({
        ok: true,
        html: generated.html,
        source: generated.source,
        model: generated.model,
        generator: {
          strictAnthropic: websiteGenerationStrictAnthropic,
          strictHtml: websiteGenerationStrictHtml,
        },
        usage: generated.usage,
        apiCost: generated.apiCost,
        order: {
          orderId,
          company,
          title,
          buildMode,
          referenceImageCount: referenceImages.length,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      const upstreamDetail = truncateText(
        normalizeString(
          error?.data?.error?.message ||
            error?.data?.error?.detail ||
            error?.data?.error ||
            error?.data?.detail ||
            ''
        ),
        500
      );
      return res.status(safeStatus).json({
        ok: false,
        error:
          safeStatus === 503
            ? 'AI website generatie niet beschikbaar'
            : 'AI website generatie mislukt',
        detail: String(error?.message || 'Onbekende fout'),
        openAiEnabled: Boolean(getOpenAiApiKey()),
        anthropicEnabled: Boolean(getAnthropicApiKey()),
        websiteGenerationProvider: getWebsiteGenerationProvider(),
        websiteGenerationModel:
          getWebsiteGenerationProvider() === 'anthropic'
            ? getWebsiteAnthropicModel()
            : openAiModel,
        upstreamDetail: upstreamDetail || null,
      });
    }
  }

  async function sendLaunchSiteResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const html = String(body.html || '');
      const orderId = Number(body.orderId) || null;
      const company = truncateText(normalizeString(body.company || body.clientName || ''), 160);
      const title = truncateText(normalizeString(body.title || ''), 200);
      const description = truncateText(normalizeString(body.description || ''), 3000);
      const deliveryTime = truncateText(normalizeString(body.deliveryTime || ''), 200);
      const domainName = sanitizeLaunchDomainName(body.domainName || body.domain || '');

      if (!html.trim()) {
        return res.status(400).json({
          ok: false,
          error: 'HTML ontbreekt',
          detail: 'Stuur een body met minimaal { html: "..." }.',
        });
      }

      const launchResult = await runActiveOrderLaunchPipeline({
        orderId,
        company,
        title,
        description,
        deliveryTime,
        domainName,
        html,
      });

      appendDashboardActivity(
        {
          type: 'active_order_automation_completed',
          title: 'Case automatisch gelanceerd',
          detail: `${company || 'Case'} is doorgezet naar GitHub en Vercel.`,
          company,
          actor: 'api',
          taskId: Number.isFinite(orderId) ? orderId : null,
          source: 'premium-actieve-opdrachten',
        },
        'dashboard_activity_active_order_launch'
      );

      return res.status(200).json(launchResult);
    } catch (error) {
      const detail = String(error?.message || 'Onbekende launch fout');
      const status = /ontbreekt|missing|niet compleet|staat uit|verwacht/i.test(detail) ? 400 : 500;
      return res.status(status).json({
        ok: false,
        error: 'Launch pipeline mislukt',
        detail,
      });
    }
  }

  return {
    sendGenerateSiteResponse,
    sendLaunchSiteResponse,
  };
}

module.exports = {
  createActiveOrdersCoordinator,
};
