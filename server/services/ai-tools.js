function createAiToolsCoordinator(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    fetchWebsitePreviewScanFromUrl = async () => ({
      scan: {},
      normalizedUrl: '',
      finalUrl: '',
    }),
    generateWebsitePreviewImageWithAi = async () => ({
      brief: '',
      prompt: '',
      dataUrl: '',
      mimeType: 'image/png',
      fileName: 'preview.png',
      model: '',
      revisedPrompt: '',
      usage: null,
    }),
    appendDashboardActivity = () => {},
    getOpenAiApiKey = () => '',
    openAiImageModel = '',
    buildOrderDossierInput = (value) => value || {},
    generateDynamicOrderDossierWithAnthropic = async () => ({
      layout: {},
      source: '',
      model: '',
      usage: null,
    }),
    buildOrderDossierFallbackLayout = () => ({}),
    getAnthropicApiKey = () => '',
    getDossierAnthropicModel = () => '',
    generateWebsitePromptFromTranscriptWithAi = async () => ({
      prompt: '',
      source: '',
      model: '',
      usage: null,
      language: 'nl',
    }),
    buildWebsitePromptFallback = () => '',
    extractMeetingNotesFromImageWithAi = async () => ({
      transcript: '',
      source: '',
      model: '',
      usage: null,
    }),
    logger = console,
  } = deps;

  async function sendWebsitePreviewGenerateResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const inputUrl = normalizeString(body.url || body.websiteUrl || '');
      if (!inputUrl) {
        return res.status(400).json({
          ok: false,
          error: 'Website-URL ontbreekt',
          detail: 'Stuur een JSON body met { url: "https://voorbeeld.nl" }',
        });
      }

      const fetched = await fetchWebsitePreviewScanFromUrl(inputUrl);
      const generated = await generateWebsitePreviewImageWithAi(fetched.scan);

      appendDashboardActivity(
        {
          type: 'website_preview_generated',
          title: 'Websitegenerator gegenereerd',
          detail: `Nieuwe AI preview gemaakt voor ${fetched.scan.host || fetched.finalUrl}.`,
          actor: 'api',
          source: 'premium-websitegenerator',
        },
        'dashboard_activity_website_preview_generated'
      );

      return res.status(200).json({
        ok: true,
        site: {
          requestedUrl: inputUrl,
          normalizedUrl: fetched.normalizedUrl,
          finalUrl: fetched.finalUrl,
          host: fetched.scan.host || '',
        },
        scan: {
          title: fetched.scan.title || '',
          metaDescription: fetched.scan.metaDescription || '',
          h1: fetched.scan.h1 || '',
          headings: fetched.scan.headings || [],
          paragraphs: fetched.scan.paragraphs || [],
          visualCues: fetched.scan.visualCues || [],
          imageCount: Number(fetched.scan.imageCount || 0) || 0,
        },
        brief: generated.brief,
        prompt: generated.prompt,
        image: {
          dataUrl: generated.dataUrl,
          mimeType: generated.mimeType,
          fileName: generated.fileName,
        },
        model: generated.model,
        revisedPrompt: generated.revisedPrompt || '',
        usage: generated.usage,
        openAiEnabled: true,
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
            ? 'Websitegenerator AI niet beschikbaar'
            : 'Websitegenerator genereren mislukt',
        detail: String(error?.message || 'Onbekende fout'),
        openAiEnabled: Boolean(getOpenAiApiKey()),
        imageModel: openAiImageModel,
        upstreamDetail: upstreamDetail || null,
      });
    }
  }

  async function sendOrderDossierResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const input = buildOrderDossierInput({
      orderId: body.orderId,
      title: body.title,
      company: body.company,
      contact: body.contact,
      domainName: body.domainName,
      deliveryTime: body.deliveryTime,
      claimedBy: body.claimedBy,
      claimedAt: body.claimedAt,
      description: body.description,
      transcript: body.transcript,
      sourceAppointmentLabel: body.sourceAppointmentLabel,
      language: body.language || 'nl',
    });

    if (!input.orderId && !normalizeString(input.title) && !normalizeString(input.company)) {
      return res.status(400).json({
        ok: false,
        error: 'Onvoldoende dossierinformatie',
        detail: 'Stuur minimaal orderId en basisprojectdata mee.',
      });
    }

    try {
      const result = await generateDynamicOrderDossierWithAnthropic(input);
      return res.status(200).json({
        ok: true,
        layout: result.layout,
        source: result.source,
        model: result.model,
        usage: result.usage,
        anthropicEnabled: true,
      });
    } catch (error) {
      const fallbackLayout = buildOrderDossierFallbackLayout(input);
      logger.error(
        '[AI][OrderDossier][Fallback]',
        JSON.stringify(
          {
            reason: String(error?.message || 'Onbekende fout'),
            status: Number(error?.status || 0) || null,
            anthropicEnabled: Boolean(getAnthropicApiKey()),
            model: getDossierAnthropicModel(),
            orderId: input.orderId || null,
          },
          null,
          2
        )
      );

      return res.status(200).json({
        ok: true,
        layout: fallbackLayout,
        source: 'template-fallback',
        model: null,
        usage: null,
        warning: 'Claude dossier generatie faalde, template-fallback gebruikt.',
        detail: String(error?.message || 'Onbekende fout'),
        anthropicEnabled: Boolean(getAnthropicApiKey()),
      });
    }
  }

  async function sendTranscriptToPromptResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const transcript = normalizeString(body.transcript || body.text || '');
    const language = normalizeString(body.language || 'nl') || 'nl';
    const context = normalizeString(body.context || '');

    if (!transcript) {
      return res.status(400).json({
        ok: false,
        error: 'Transcript ontbreekt',
        detail: 'Stuur een JSON body met { transcript: "..." }',
      });
    }

    if (transcript.length > 50000) {
      return res.status(400).json({
        ok: false,
        error: 'Transcript te lang',
        detail: 'Maximaal 50.000 tekens per request.',
      });
    }

    try {
      const result = await generateWebsitePromptFromTranscriptWithAi({
        transcript,
        language,
        context,
      });

      return res.status(200).json({
        ok: true,
        prompt: result.prompt,
        source: result.source,
        model: result.model,
        usage: result.usage,
        language: result.language,
        openAiEnabled: true,
      });
    } catch (error) {
      const fallbackPrompt = buildWebsitePromptFallback({
        transcript,
        language,
        context,
      });

      logger.error(
        '[AI][TranscriptToPrompt][Fallback]',
        JSON.stringify(
          {
            reason: String(error?.message || 'Onbekende fout'),
            status: Number(error?.status || 0) || null,
            openAiEnabled: Boolean(getOpenAiApiKey()),
          },
          null,
          2
        )
      );

      return res.status(200).json({
        ok: true,
        prompt: fallbackPrompt,
        source: 'template-fallback',
        model: null,
        usage: null,
        language,
        warning: 'AI prompt generatie faalde, template fallback gebruikt.',
        detail: String(error?.message || 'Onbekende fout'),
        openAiEnabled: Boolean(getOpenAiApiKey()),
      });
    }
  }

  async function sendNotesImageToTextResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const imageDataUrl = normalizeString(body.imageDataUrl || body.image || '').replace(/\s+/g, '');
    const language = normalizeString(body.language || 'nl') || 'nl';
    const context = normalizeString(body.context || '');

    if (!imageDataUrl) {
      return res.status(400).json({
        ok: false,
        error: 'Afbeelding ontbreekt',
        detail: 'Stuur een JSON body met { imageDataUrl: "data:image/...;base64,..." }',
      });
    }

    if (imageDataUrl.length > 900000) {
      return res.status(413).json({
        ok: false,
        error: 'Afbeelding te groot',
        detail: 'Lever een compactere afbeelding aan (max ~700KB geadviseerd).',
      });
    }

    try {
      const extraction = await extractMeetingNotesFromImageWithAi({
        imageDataUrl,
        language,
      });

      let promptResult = null;
      try {
        promptResult = await generateWebsitePromptFromTranscriptWithAi({
          transcript: extraction.transcript,
          language,
          context,
        });
      } catch (_promptError) {
        promptResult = {
          prompt: buildWebsitePromptFallback({
            transcript: extraction.transcript,
            language,
            context,
          }),
          source: 'template-fallback',
          model: null,
          usage: null,
        };
      }

      return res.status(200).json({
        ok: true,
        transcript: extraction.transcript,
        prompt: String(promptResult?.prompt || '').trim(),
        source: extraction.source,
        model: extraction.model,
        promptSource: String(promptResult?.source || ''),
        usage: {
          extraction: extraction.usage || null,
          prompt: promptResult?.usage || null,
        },
        language,
        openAiEnabled: true,
      });
    } catch (error) {
      const status = Number(error?.status) || 500;
      const safeStatus = status >= 400 && status < 600 ? status : 500;
      return res.status(safeStatus).json({
        ok: false,
        error:
          safeStatus === 503
            ? 'AI notitie-herkenning niet beschikbaar'
            : 'AI notitie-herkenning mislukt',
        detail: String(error?.message || 'Onbekende fout'),
        openAiEnabled: Boolean(getOpenAiApiKey()),
      });
    }
  }

  return {
    sendNotesImageToTextResponse,
    sendOrderDossierResponse,
    sendTranscriptToPromptResponse,
    sendWebsitePreviewGenerateResponse,
  };
}

module.exports = {
  createAiToolsCoordinator,
};
