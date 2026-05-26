const { buildOpenAiContextHeaders } = require('./openai-request-context');

function createAiRemoteService(deps = {}) {
  const {
    env = process.env,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    getOpenAiApiKey = () => '',
    getAnthropicApiKey = () => '',
    getWebsiteGenerationProvider = () => 'openai',
    getWebsiteAnthropicModel = () => '',
    getDossierAnthropicModel = () => '',
    getAnthropicDossierMaxTokens = () => 12000,
    fetchJsonWithTimeout = async () => ({
      response: { ok: true, status: 200 },
      data: {},
    }),
    fetchBinaryWithTimeout = async () => ({
      response: {
        ok: false,
        status: 501,
        url: '',
        headers: { get: () => '' },
      },
      bytes: Buffer.from(''),
    }),
    fetchTextWithTimeout = async () => ({
      response: {
        ok: true,
        status: 200,
        url: '',
        headers: { get: () => '' },
      },
      text: '',
    }),
    fetchImpl = fetch,
    extractOpenAiTextContent = () => '',
    extractAnthropicTextContent = () => '',
    parseJsonLoose = () => null,
    assertWebsitePreviewUrlIsPublic = async (value) => normalizeString(value),
    normalizeWebsitePreviewTargetUrl = (value) => normalizeString(value),
    extractWebsitePreviewScanFromHtml = () => ({}),
    buildWebsitePreviewPromptFromScan = () => '',
    buildWebsitePreviewBriefFromScan = () => '',
    buildWebsitePreviewDownloadFileName = () => 'preview.png',
    buildWebsiteGenerationPrompts = () => ({
      company: '',
      title: '',
      userPrompt: '',
      systemPrompt: '',
      referenceImages: [],
    }),
    ensureHtmlDocument = () => '',
    ensureStrictAnthropicHtml = () => '',
    isLikelyUsableWebsiteHtml = () => false,
    buildLocalWebsiteBlueprint = () => '',
    buildAnthropicWebsiteHtmlPrompts = () => ({
      systemPrompt: '',
      userPrompt: '',
      referenceImages: [],
      title: '',
      company: '',
    }),
    getAnthropicWebsiteStageEffort = () => 'high',
    getAnthropicWebsiteStageMaxTokens = () => 12000,
    supportsAnthropicAdaptiveThinking = () => false,
    sanitizeReferenceImages = () => [],
    parseImageDataUrl = () => null,
    estimateOpenAiUsageCost = () => null,
    estimateOpenAiTextCost = () => null,
    estimateAnthropicUsageCost = () => null,
    estimateAnthropicTextCost = () => null,
    buildAnthropicOrderDossierPrompts = () => ({
      systemPrompt: '',
      userPrompt: '',
      input: {},
    }),
    normalizeOrderDossierLayout = (value) => value || {},
    openAiApiBaseUrl = '',
    openAiModel = '',
    openAiImageModel = '',
    openAiAudioTranscriptionModel = '',
    anthropicApiBaseUrl = '',
    anthropicModel = '',
    websiteGenerationTimeoutMs = 60000,
    websiteGenerationStrictAnthropic = false,
    websiteGenerationStrictHtml = false,
    waitForOpenAiImageRetry = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    openAiImageRateLimitRetryAttempts = 8,
  } = deps;

  const OPENAI_IMAGE_RATE_LIMIT_RETRY_ATTEMPTS = Math.max(
    1,
    Math.min(20, Number(openAiImageRateLimitRetryAttempts) || 8)
  );
  const OPENAI_IMAGE_RATE_LIMIT_RETRY_FALLBACK_MS = 15000;
  const OPENAI_IMAGE_RATE_LIMIT_RETRY_MAX_MS = 90000;

  function parseHtmlTagAttributes(tagRaw) {
    const tag = String(tagRaw || '');
    const attrs = {};
    const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = pattern.exec(tag))) {
      const key = normalizeString(match[1] || '').toLowerCase();
      const value = normalizeString(match[3] || match[4] || match[5] || '');
      if (!key) continue;
      attrs[key] = value;
    }
    return attrs;
  }

  function extractInlineStyleBlocksFromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    const out = [];
    const pattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let match;
    while ((match = pattern.exec(html))) {
      const cssText = String(match[1] || '').trim();
      if (!cssText) continue;
      out.push(cssText);
      if (out.length >= 8) break;
    }
    return out;
  }

  function extractStylesheetUrlsFromHtml(htmlRaw, pageUrlRaw) {
    const html = String(htmlRaw || '');
    const pageUrl = normalizeString(pageUrlRaw || '');
    const out = [];
    const seen = new Set();
    const pattern = /<link\b[^>]*>/gi;
    let match;
    while ((match = pattern.exec(html))) {
      const attrs = parseHtmlTagAttributes(match[0]);
      const rel = normalizeString(attrs.rel || '').toLowerCase();
      const hrefRaw = normalizeString(attrs.href || '');
      if (!hrefRaw || !rel.split(/\s+/).includes('stylesheet')) continue;
      if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(hrefRaw)) continue;
      let absoluteUrl = '';
      try {
        absoluteUrl = new URL(hrefRaw, pageUrl).toString();
      } catch {
        continue;
      }
      const normalized = normalizeString(absoluteUrl);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
      if (out.length >= 4) break;
    }
    return out;
  }

  function buildWebsitePreviewDocumentFetchProfiles() {
    return [
      {
        id: 'browser-desktop',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          DNT: '1',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      },
      {
        id: 'softora-compat',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; SoftoraWebsitePreview/1.0; +https://softora.nl)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
        },
      },
    ];
  }

  function buildWebsitePreviewStylesheetHeaders(pageUrlRaw) {
    const pageUrl = normalizeString(pageUrlRaw || '');
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'text/css,text/plain;q=0.9,*/*;q=0.1',
      'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: pageUrl,
      'Sec-Fetch-Dest': 'style',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-origin',
    };
    if (!pageUrl) delete headers.Referer;
    return headers;
  }

  function buildWebsitePreviewImageHeaders(pageUrlRaw) {
    const pageUrl = normalizeString(pageUrlRaw || '');
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
      Referer: pageUrl,
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-origin',
    };
    if (!pageUrl) delete headers.Referer;
    return headers;
  }

  function extractResponseHeader(response, name) {
    if (!response || !response.headers || typeof response.headers.get !== 'function') return '';
    return normalizeString(response.headers.get(name) || '');
  }

  function inferAudioMimeTypeFromFileName(fileName = '') {
    const match = normalizeString(fileName).toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
    const ext = normalizeString(match?.[1] || '').toLowerCase();
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'webm') return 'audio/webm';
    if (ext === 'ogg' || ext === 'oga') return 'audio/ogg';
    if (ext === 'aac') return 'audio/aac';
    if (ext === 'flac') return 'audio/flac';
    return '';
  }

  function inferAudioExtensionFromMime(mimeType = '', fileName = '') {
    const normalizedMime = normalizeString(mimeType).toLowerCase();
    if (normalizedMime.includes('mpeg') || normalizedMime.includes('mp3')) return 'mp3';
    if (normalizedMime.includes('mp4') || normalizedMime.includes('m4a')) return 'm4a';
    if (normalizedMime.includes('wav')) return 'wav';
    if (normalizedMime.includes('webm')) return 'webm';
    if (normalizedMime.includes('ogg')) return 'ogg';
    if (normalizedMime.includes('aac')) return 'aac';
    if (normalizedMime.includes('flac')) return 'flac';
    const match = normalizeString(fileName).toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
    const ext = normalizeString(match?.[1] || '').toLowerCase();
    if (/^(mp3|m4a|mp4|wav|webm|ogg|oga|aac|flac)$/.test(ext)) {
      return ext === 'mp4' ? 'm4a' : ext;
    }
    return 'mp3';
  }

  function isSupportedMeetingAudioMime(mimeType = '', fileName = '') {
    const normalizedMime = normalizeString(mimeType).toLowerCase();
    if (/^audio\/[a-z0-9.+-]+$/i.test(normalizedMime)) return true;
    if (/^video\/(?:mp4|webm|ogg)$/i.test(normalizedMime)) return true;
    return Boolean(inferAudioMimeTypeFromFileName(fileName));
  }

  function parseMeetingAudioDataUrl(audioDataUrl = '', fileName = '', fallbackMimeType = '') {
    const raw = normalizeString(audioDataUrl).replace(/\s+/g, '');
    const match = raw.match(/^data:([^;,]+);base64,([a-z0-9+/=]+)$/i);
    if (!match) {
      const err = new Error('Ongeldig audiobestand. Upload MP3, M4A, WAV, WEBM, OGG, AAC of FLAC.');
      err.status = 400;
      throw err;
    }

    const inferredMime = inferAudioMimeTypeFromFileName(fileName);
    let mimeType = normalizeString(match[1] || fallbackMimeType || inferredMime || 'audio/mpeg').toLowerCase();
    if (!isSupportedMeetingAudioMime(mimeType, fileName)) {
      if (inferredMime) {
        mimeType = inferredMime;
      } else {
        const err = new Error('Ongeldig audiobestand. Upload MP3, M4A, WAV, WEBM, OGG, AAC of FLAC.');
        err.status = 400;
        throw err;
      }
    }

    const base64Payload = normalizeString(match[2] || '');
    if (!base64Payload || base64Payload.length % 4 === 1 || !/^[a-z0-9+/]+={0,2}$/i.test(base64Payload)) {
      const err = new Error('Audiobestand kon niet worden gelezen.');
      err.status = 400;
      throw err;
    }

    const bytes = Buffer.from(base64Payload, 'base64');
    if (!bytes.length) {
      const err = new Error('Audiobestand is leeg.');
      err.status = 400;
      throw err;
    }

    return {
      bytes,
      mimeType,
    };
  }

  function buildMeetingAudioUploadFileName(fileName = '', mimeType = '') {
    const ext = inferAudioExtensionFromMime(mimeType, fileName);
    const safeBase =
      normalizeString(fileName)
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[^a-z0-9_-]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'meeting-audio';
    return `${safeBase}.${ext}`;
  }

  function getOpenAiAudioTranscriptionModelCandidates() {
    const configured = normalizeString(
      openAiAudioTranscriptionModel ||
        env.OPENAI_AUDIO_TRANSCRIPTION_MODEL ||
        env.OPENAI_TRANSCRIPTION_MODEL ||
        ''
    );
    const models = [];
    if (configured) models.push(configured);
    ['gpt-4o-transcribe', 'whisper-1'].forEach((candidate) => {
      if (!models.includes(candidate)) models.push(candidate);
    });
    return models;
  }

  function normalizeWebsitePreviewText(textRaw) {
    return String(textRaw || '')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function isLikelyBlockedWebsiteContent(textRaw) {
    const text = normalizeWebsitePreviewText(textRaw);
    if (!text) return false;

    const hardSignals = [
      'verify you are human',
      'unusual traffic',
      'access denied',
      'enable javascript',
      'enable cookies',
      'temporarily blocked',
      'request blocked',
      'forbidden',
      'detected unusual activity',
      'automatische scripts',
      'toegang tot',
      'toegang is tijdelijk geblokkeerd',
      'ip adres',
      'ip address',
      'captcha',
    ];
    if (hardSignals.some((signal) => text.includes(signal))) {
      return true;
    }

    const blockWords = ['blocked', 'geblokkeerd', 'forbidden', 'denied'];
    const securityWords = ['ip adres', 'ip address', 'captcha', 'bot', 'misbruik', 'automation'];
    return (
      blockWords.some((word) => text.includes(word)) &&
      securityWords.some((word) => text.includes(word))
    );
  }

  function stripWebsitePreviewHtmlNoise(htmlRaw) {
    return String(htmlRaw || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }

  function isLikelyWebsitePreviewClientRedirectShell(htmlRaw) {
    const html = String(htmlRaw || '');
    if (!html) return false;
    const hasClientRedirect = /(?:window\.)?location(?:\.href|\.replace|\.assign)?|http-equiv\s*=\s*["']?refresh/i.test(html);
    if (!hasClientRedirect) return false;

    const visibleText = normalizeWebsitePreviewText(stripWebsitePreviewHtmlNoise(html));
    if (/(je wordt doorgestuurd|wordt doorgestuurd|you are being redirected|redirecting|document has moved)/i.test(visibleText)) {
      return true;
    }

    const hasUsefulPageStructure = /<(?:h1|h2|main|section|article|nav)\b/i.test(html);
    return html.length < 3000 && visibleText.length < 240 && !hasUsefulPageStructure;
  }

  function resolveWebsitePreviewUrlAgainstBase(valueRaw, baseUrlRaw) {
    const value = normalizeString(valueRaw || '');
    const baseUrl = normalizeString(baseUrlRaw || '');
    if (!value) return '';
    try {
      return new URL(value, baseUrl || undefined).toString();
    } catch {
      return normalizeWebsitePreviewTargetUrl(value);
    }
  }

  function extractWebsitePreviewClientRedirectUrl(htmlRaw, pageUrlRaw) {
    const html = String(htmlRaw || '');
    if (!isLikelyWebsitePreviewClientRedirectShell(html)) return '';

    const patterns = [
      /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/i,
      /(?:window\.)?location\.assign\(\s*["']([^"']+)["']\s*\)/i,
      /(?:window\.)?location\.href\s*=\s*["']([^"']+)["']/i,
      /(?:window\.)?location\s*=\s*["']([^"']+)["']/i,
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      const url = resolveWebsitePreviewUrlAgainstBase(match && match[1], pageUrlRaw);
      if (url) return url;
    }

    const metaRefreshTags = html.match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi) || [];
    for (const tag of metaRefreshTags) {
      const contentMatch = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i);
      const urlMatch = normalizeString(contentMatch && contentMatch[1]).match(/url\s*=\s*([^;]+)/i);
      const url = resolveWebsitePreviewUrlAgainstBase(urlMatch && urlMatch[1], pageUrlRaw);
      if (url) return url;
    }

    return '';
  }

  function buildWebsitePreviewReaderUrl(pageUrlRaw) {
    const pageUrl = normalizeString(pageUrlRaw || '');
    if (!pageUrl) return '';
    if (/^https?:\/\//i.test(pageUrl)) {
      return `https://r.jina.ai/${pageUrl}`;
    }
    return `https://r.jina.ai/http://${pageUrl}`;
  }

  function extractReaderContentSection(markdownRaw) {
    const markdown = String(markdownRaw || '');
    const marker = /\nMarkdown Content:\n/i;
    const match = marker.exec(markdown);
    if (!match) return markdown.trim();
    return markdown.slice(match.index + match[0].length).trim();
  }

  function stripMarkdownFormatting(markdownRaw) {
    return String(markdownRaw || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^>\s*/gm, '')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractWebsitePreviewScanFromReaderMarkdown(markdownRaw, pageUrlRaw) {
    const markdown = String(markdownRaw || '');
    const normalizedPageUrl = normalizeWebsitePreviewTargetUrl(pageUrlRaw) || normalizeString(pageUrlRaw || '');
    const sourceUrlMatch = markdown.match(/(?:^|\n)URL Source:\s*([^\n]+)/i);
    const readerSourceUrl =
      normalizeWebsitePreviewTargetUrl(sourceUrlMatch && sourceUrlMatch[1]) || normalizedPageUrl;
    const titleMatch = markdown.match(/(?:^|\n)Title:\s*([^\n]+)/i);
    const contentSection = extractReaderContentSection(markdown);
    const headingMatches = Array.from(contentSection.matchAll(/^\s{0,3}#{1,6}\s+(.+)$/gm))
      .map((match) => normalizeString(match[1] || ''))
      .filter(Boolean);
    const paragraphs = contentSection
      .split(/\n\s*\n/g)
      .map((entry) => stripMarkdownFormatting(entry))
      .filter((entry) => entry.length >= 32)
      .slice(0, 6);
    const plainText = stripMarkdownFormatting(contentSection);
    const title = normalizeString(titleMatch && titleMatch[1]);
    const h1 = normalizeString(headingMatches[0] || title || '');
    const metaDescription = truncateText(normalizeString(paragraphs[0] || plainText || ''), 280);
    const bodyTextSample = truncateText(plainText, 3200);

    return {
      title,
      h1,
      metaDescription,
      headings: headingMatches.slice(1, 7),
      paragraphs,
      visualCues: [],
      imageCount: 0,
      bodyTextSample,
      sourceUrl: readerSourceUrl,
      fetchSource: 'reader-fallback',
    };
  }

  async function assertWebsitePreviewFetchedUrlIsPublic(response, fallbackUrl) {
    const finalUrlRaw = normalizeString(response?.url || '') || fallbackUrl;
    return assertWebsitePreviewUrlIsPublic(finalUrlRaw);
  }

  async function tryFetchWebsitePreviewDocument(normalizedUrl, timeoutMs = 25000) {
    const attempts = [];
    const profiles = buildWebsitePreviewDocumentFetchProfiles();

    for (const profile of profiles) {
      try {
        const { response, text } = await fetchTextWithTimeout(
          normalizedUrl,
          {
            method: 'GET',
            redirect: 'follow',
            headers: profile.headers,
          },
          timeoutMs
        );
        const contentType = extractResponseHeader(response, 'content-type').toLowerCase();
        const bodyText = String(text || '');
        const blocked = isLikelyBlockedWebsiteContent(bodyText);
        const finalUrl = await assertWebsitePreviewFetchedUrlIsPublic(response, normalizedUrl);
        attempts.push({
          mode: profile.id,
          status: Number(response?.status || 0) || 0,
          contentType,
          blocked,
          finalUrl,
        });

        if (!response.ok) continue;
        if (
          contentType &&
          !contentType.includes('text/html') &&
          !contentType.includes('application/xhtml+xml')
        ) {
          continue;
        }
        if (!bodyText) continue;
        if (blocked) continue;

        return {
          ok: true,
          finalUrl,
          response,
          text: bodyText,
          attempts,
        };
      } catch (error) {
        if (Number(error?.status) === 400) {
          throw error;
        }
        attempts.push({
          mode: profile.id,
          status: 0,
          error: truncateText(normalizeString(error?.message || 'Fetch mislukt'), 180),
        });
      }
    }

    return {
      ok: false,
      attempts,
    };
  }

  async function tryFetchWebsitePreviewViaReader(normalizedUrl, timeoutMs = 25000) {
    const readerUrl = buildWebsitePreviewReaderUrl(normalizedUrl);
    if (!readerUrl) {
      return { ok: false, reason: 'reader-url-leeg' };
    }

    try {
      const { response, text } = await fetchTextWithTimeout(
        readerUrl,
        {
          method: 'GET',
          redirect: 'follow',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; SoftoraWebsitePreview/1.0; +https://softora.nl)',
            Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.1',
            'Accept-Language': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
          },
        },
        timeoutMs
      );
      const markdown = String(text || '').trim();
      const blocked = isLikelyBlockedWebsiteContent(markdown);
      if (!response.ok || !markdown || blocked) {
        return {
          ok: false,
          status: Number(response?.status || 0) || 0,
          blocked,
        };
      }

      const scan = extractWebsitePreviewScanFromReaderMarkdown(markdown, normalizedUrl);
      const finalUrl = await assertWebsitePreviewUrlIsPublic(scan.sourceUrl || normalizedUrl);
      scan.sourceUrl = finalUrl;
      return {
        ok: Boolean(scan.title || scan.h1 || scan.metaDescription || scan.bodyTextSample),
        status: Number(response?.status || 0) || 200,
        scan,
        finalUrl,
      };
    } catch (error) {
      if (Number(error?.status) === 400) {
        throw error;
      }
      return {
        ok: false,
        status: 0,
        error: truncateText(normalizeString(error?.message || 'Reader fetch mislukt'), 180),
      };
    }
  }

  function buildWebsitePreviewFetchError(attempts = []) {
    const lastAttemptWithStatus = [...attempts]
      .reverse()
      .find((attempt) => Number.isFinite(attempt?.status) && attempt.status > 0);
    const status = lastAttemptWithStatus ? lastAttemptWithStatus.status : 502;
    const blocked = attempts.some(
      (attempt) => attempt?.blocked || [401, 403, 406, 409, 429, 451].includes(Number(attempt?.status || 0))
    );
    const err = new Error(
      blocked
        ? `Kon deze website niet ophalen (${status}). Deze site blokkeert geautomatiseerde serververzoeken.`
        : `Kon deze website niet ophalen (${status}).`
    );
    err.status = status >= 400 && status < 600 ? status : 502;
    return err;
  }

  function extractColorTokensFromCss(textRaw) {
    const text = String(textRaw || '');
    if (!text) return [];
    const matches = text.match(/#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi);
    if (!Array.isArray(matches)) return [];
    return matches
      .map((value) => normalizeString(value).toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean);
  }

  function parseCssColorToRgb(colorRaw) {
    const color = normalizeString(colorRaw || '').toLowerCase();
    if (!color) return null;

    const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
      const value = hex[1];
      if (value.length === 3 || value.length === 4) {
        const r = Number.parseInt(value[0] + value[0], 16);
        const g = Number.parseInt(value[1] + value[1], 16);
        const b = Number.parseInt(value[2] + value[2], 16);
        return { r, g, b };
      }
      const r = Number.parseInt(value.slice(0, 2), 16);
      const g = Number.parseInt(value.slice(2, 4), 16);
      const b = Number.parseInt(value.slice(4, 6), 16);
      return { r, g, b };
    }

    const rgb = color.match(/^rgba?\(([^)]*)\)$/i);
    if (rgb) {
      const parts = rgb[1]
        .split(',')
        .map((item) => Number.parseFloat(String(item || '').trim()))
        .filter((value) => Number.isFinite(value));
      if (parts.length >= 3) {
        return {
          r: Math.max(0, Math.min(255, parts[0])),
          g: Math.max(0, Math.min(255, parts[1])),
          b: Math.max(0, Math.min(255, parts[2])),
        };
      }
    }

    return null;
  }

  function isLikelyNeutralCssColor(colorRaw) {
    const parsed = parseCssColorToRgb(colorRaw);
    if (!parsed) return false;
    const values = [parsed.r, parsed.g, parsed.b];
    const spread = Math.max(...values) - Math.min(...values);
    return spread <= 18;
  }

  function extractCssVariableColorHints(cssSources = []) {
    const hits = new Map();
    const keywordWeights = [
      ['accent', 10],
      ['primary', 9],
      ['brand', 9],
      ['secondary', 8],
      ['highlight', 7],
      ['cta', 7],
      ['hero', 5],
      ['theme', 5],
      ['bg', 3],
      ['background', 3],
      ['text', 2],
    ];

    for (const cssText of cssSources) {
      const pattern = /--([a-z0-9-_]{2,60})\s*:\s*([^;}{]+)/gi;
      let match;
      while ((match = pattern.exec(String(cssText || '')))) {
        const variableName = normalizeString(match[1] || '').toLowerCase();
        const declaration = String(match[2] || '');
        const colors = extractColorTokensFromCss(declaration);
        if (!variableName || colors.length === 0) continue;

        const color = colors[0];
        let score = isLikelyNeutralCssColor(color) ? 1 : 4;
        for (const [keyword, weight] of keywordWeights) {
          if (variableName.includes(keyword)) score += weight;
        }
        if (variableName.includes('text')) score -= 5;
        if (variableName.includes('bg') || variableName.includes('background')) score -= 2;

        const key = `${variableName}:${color}`;
        const existing = hits.get(key);
        if (!existing || existing.score < score) {
          hits.set(key, {
            name: variableName,
            color,
            score,
          });
        }
      }
    }

    return Array.from(hits.values())
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map((entry) => `${entry.name}: ${entry.color}`);
  }

  function extractCssBrandPalette(cssSources = [], preferredColors = []) {
    const counts = new Map();
    const preferred = preferredColors
      .map((value) => normalizeString(value || '').toLowerCase())
      .filter(Boolean);

    for (const cssText of cssSources) {
      for (const color of extractColorTokensFromCss(cssText)) {
        const current = counts.get(color) || 0;
        const neutralPenalty = isLikelyNeutralCssColor(color) ? 0 : 2;
        counts.set(color, current + 1 + neutralPenalty);
      }
    }

    const palette = [];
    for (const color of preferred) {
      if (!palette.includes(color)) palette.push(color);
      if (palette.length >= 6) return palette;
    }

    const ranked = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([color]) => color);

    for (const color of ranked) {
      if (!palette.includes(color)) palette.push(color);
      if (palette.length >= 6) break;
    }

    return palette.slice(0, 6);
  }

  function extractCssFontFamilyHints(cssSources = []) {
    const counts = new Map();
    let seenIndex = 0;
    for (const cssText of cssSources) {
      const text = String(cssText || '');
      const pattern = /font-family\s*:\s*([^;{}]+)/gi;
      let match;
      while ((match = pattern.exec(text))) {
        const raw = normalizeString(match[1] || '')
          .replace(/!important/gi, '')
          .replace(/\s+/g, ' ');
        if (!raw) continue;

        const families = raw
          .split(',')
          .map((item) => normalizeString(item).replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
          .filter((item) => !/^(sans-serif|serif|monospace|system-ui|inherit|initial|unset)$/i.test(item));

        for (const family of families.slice(0, 3)) {
          const key = family.toLowerCase();
          const existing = counts.get(key);
          counts.set(key, {
            label: family,
            count: (existing?.count || 0) + 1,
            firstIndex: existing?.firstIndex ?? seenIndex++,
          });
        }
      }
    }

    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex)
      .map((entry) => entry.label)
      .slice(0, 5);
  }

  function isSupportedOpenAiImageModel(modelRaw) {
    const model = normalizeString(modelRaw || '').toLowerCase();
    return (
      /^gpt-image-(?:1(?:\.5)?|1-mini|2)$/.test(model) ||
      model === 'chatgpt-image-latest' ||
      /^dall-e-[23]$/.test(model)
    );
  }

  function isGptImageGenerationModel(modelRaw) {
    const model = normalizeString(modelRaw || '').toLowerCase();
    return /^gpt-image-/i.test(model) || model === 'chatgpt-image-latest';
  }

  function requiresLegacyOpenAiImageResponseFormat(modelRaw) {
    return /^dall-e-[23]$/i.test(normalizeString(modelRaw || ''));
  }

  function supportsOpenAiReferenceImageEdits(modelRaw) {
    return isGptImageGenerationModel(modelRaw);
  }

  function isSupportedWebsitePreviewReferenceMimeType(mimeTypeRaw) {
    return /^image\/(?:png|jpeg|webp)$/i.test(normalizeString(mimeTypeRaw || '').split(';')[0]);
  }

  function guessImageMimeTypeFromUrl(urlRaw) {
    const url = normalizeString(urlRaw || '').toLowerCase();
    if (!url) return '';
    if (/\.png(?:[?#].*)?$/.test(url)) return 'image/png';
    if (/\.(?:jpe?g)(?:[?#].*)?$/.test(url)) return 'image/jpeg';
    if (/\.webp(?:[?#].*)?$/.test(url)) return 'image/webp';
    return '';
  }

  function isLikelyUsefulReferenceImageUrl(urlRaw) {
    const url = normalizeString(urlRaw || '').toLowerCase();
    if (!url) return false;
    if (/^data:|^blob:|^javascript:/i.test(url)) return false;
    if (/\.(?:svg|ico)(?:[?#].*)?$/i.test(url)) return false;
    return /^https?:\/\//i.test(url);
  }

  function inferWebsitePreviewReferenceFileName(urlRaw, index, mimeTypeRaw) {
    const mimeType = normalizeString(mimeTypeRaw || '').toLowerCase();
    const extension =
      mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
    let base = '';
    try {
      const parsed = new URL(String(urlRaw || ''));
      base = normalizeString(parsed.pathname.split('/').filter(Boolean).pop() || '')
        .replace(/\.[a-z0-9]+$/i, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    } catch {
      base = '';
    }
    return `${base || `website-reference-${index + 1}`}.${extension}`;
  }

  async function fetchWebsitePreviewReferenceImages(scan = {}) {
    const candidates = Array.isArray(scan.referenceImageUrls)
      ? scan.referenceImageUrls.map((item) => normalizeString(item || '')).filter(Boolean)
      : [];
    if (candidates.length === 0) return [];

    const rawImages = [];
    let totalBytes = 0;
    const pageUrl = normalizeString(scan.sourceUrl || scan.url || '');

    for (let index = 0; index < candidates.length; index += 1) {
      if (rawImages.length >= 3) break;
      const candidateUrl = candidates[index];
      if (!isLikelyUsefulReferenceImageUrl(candidateUrl)) continue;

      try {
        const safeUrl = await assertWebsitePreviewUrlIsPublic(candidateUrl);
        const { response, bytes } = await fetchBinaryWithTimeout(
          safeUrl,
          {
            method: 'GET',
            redirect: 'follow',
            headers: buildWebsitePreviewImageHeaders(pageUrl),
          },
          15000
        );
        if (!response?.ok) continue;
        const finalUrl = await assertWebsitePreviewFetchedUrlIsPublic(response, safeUrl);

        const contentType =
          normalizeString(extractResponseHeader(response, 'content-type') || '').split(';')[0] ||
          guessImageMimeTypeFromUrl(finalUrl);
        if (!isSupportedWebsitePreviewReferenceMimeType(contentType)) continue;
        if (!Buffer.isBuffer(bytes) || bytes.length < 1024 || bytes.length > 2 * 1024 * 1024) continue;
        if (totalBytes + bytes.length > 4 * 1024 * 1024) continue;

        rawImages.push({
          name: inferWebsitePreviewReferenceFileName(finalUrl, index, contentType),
          dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
        });
        totalBytes += bytes.length;
      } catch (_) {
        /* ignore reference-image fetch failures; prompt-only generation remains available */
      }
    }

    return sanitizeReferenceImages(rawImages, {
      maxItems: 3,
      maxBytesPerImage: 2 * 1024 * 1024,
      maxTotalBytes: 4 * 1024 * 1024,
    });
  }

  async function fetchWebsitePreviewCssSources(htmlRaw, pageUrlRaw) {
    const inlineCssSources = extractInlineStyleBlocksFromHtml(htmlRaw);
    const stylesheetUrls = extractStylesheetUrlsFromHtml(htmlRaw, pageUrlRaw);

    for (const stylesheetUrl of stylesheetUrls) {
      try {
        const safeUrl = await assertWebsitePreviewUrlIsPublic(stylesheetUrl);
        const { response, text } = await fetchTextWithTimeout(
          safeUrl,
          {
            method: 'GET',
            redirect: 'follow',
            headers: buildWebsitePreviewStylesheetHeaders(pageUrlRaw),
          },
          12000
        );
        if (!response.ok) continue;
        await assertWebsitePreviewFetchedUrlIsPublic(response, safeUrl);
        const cssText = String(text || '').trim();
        if (!cssText) continue;
        inlineCssSources.push(cssText);
      } catch (_) {
        /* ignore stylesheet fetch failures; html scan is still primary */
      }
    }

    return inlineCssSources.slice(0, 8);
  }

  async function requestOpenAiWebsitePreviewImageGeneration({
    apiKey,
    imageModel,
    prompt,
    referenceImages = [],
    imageSize = '2160x3840',
  }) {
    if (referenceImages.length > 0 && supportsOpenAiReferenceImageEdits(imageModel)) {
      const body = new FormData();
      body.set('model', imageModel);
      body.set('prompt', prompt);
      body.set('size', imageSize);
      body.set('quality', 'high');
      referenceImages.forEach((item) => {
        const parsed = parseImageDataUrl(item?.dataUrl || '');
        if (!parsed) return;
        body.append(
          'image[]',
          new Blob([Buffer.from(parsed.base64Payload, 'base64')], { type: parsed.mimeType }),
          item.name || 'reference.png'
        );
      });

      return fetchJsonWithTimeout(
        `${openAiApiBaseUrl}/images/edits`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        },
        180000
      );
    }

    const requestBody = {
      model: imageModel,
      prompt,
      size: imageSize,
      quality: 'high',
    };
    if (requiresLegacyOpenAiImageResponseFormat(imageModel)) {
      requestBody.response_format = 'b64_json';
    }

    return fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/images/generations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
      180000
    );
  }

  function getOpenAiImageErrorMessage(data) {
    return [
      data?.error?.message,
      data?.error?.detail,
      data?.error,
      data?.message,
      data?.detail,
    ]
      .map((value) => normalizeString(value))
      .filter(Boolean)
      .join(' ');
  }

  function getResponseHeader(response, headerName) {
    try {
      if (!response || !response.headers || typeof response.headers.get !== 'function') return '';
      return normalizeString(response.headers.get(headerName));
    } catch (_) {
      return '';
    }
  }

  function parseRetryAfterMs(value) {
    const raw = normalizeString(value);
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000) + 1000;
    const timestamp = Date.parse(raw);
    if (Number.isFinite(timestamp)) return Math.max(0, timestamp - Date.now()) + 1000;
    return 0;
  }

  function isOpenAiImageRateLimitResponse(response, data) {
    const status = Number(response?.status || 0);
    if (status === 429) return true;
    return /rate limit|too many requests|try again in/i.test(getOpenAiImageErrorMessage(data));
  }

  function getOpenAiImageRateLimitRetryMs(response, data) {
    const retryAfterMs = parseRetryAfterMs(getResponseHeader(response, 'retry-after'));
    const message = getOpenAiImageErrorMessage(data);
    const secondsMatch = message.match(/try again in\s+([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|secs|second|seconds)?/i);
    const messageMs = secondsMatch ? Math.ceil(Number(secondsMatch[1]) * 1000) + 1000 : 0;
    const parsedMs = retryAfterMs || messageMs || OPENAI_IMAGE_RATE_LIMIT_RETRY_FALLBACK_MS;
    const safeMs =
      Number.isFinite(parsedMs) && parsedMs > 0
        ? parsedMs
        : OPENAI_IMAGE_RATE_LIMIT_RETRY_FALLBACK_MS;
    return Math.max(1000, Math.min(OPENAI_IMAGE_RATE_LIMIT_RETRY_MAX_MS, safeMs));
  }

  async function requestOpenAiWebsitePreviewImageGenerationWithRateLimitRetry(options) {
    let lastResult = null;
    for (let attempt = 1; attempt <= OPENAI_IMAGE_RATE_LIMIT_RETRY_ATTEMPTS; attempt += 1) {
      const result = await requestOpenAiWebsitePreviewImageGeneration(options);
      lastResult = result;
      if (result?.response?.ok || !isOpenAiImageRateLimitResponse(result?.response, result?.data)) {
        return result;
      }
      if (attempt >= OPENAI_IMAGE_RATE_LIMIT_RETRY_ATTEMPTS) return result;
      await waitForOpenAiImageRetry(getOpenAiImageRateLimitRetryMs(result.response, result.data));
    }
    return lastResult;
  }

  function isOpenAiImageSizeError(response, data) {
    const status = Number(response?.status || 0);
    if (status !== 400 && status !== 422) return false;
    const message = normalizeString(
      data?.error?.message || data?.error?.detail || data?.error || data?.message || ''
    ).toLowerCase();
    return /size|resolution|dimension|width|height|pixels/.test(message);
  }

  async function generateWebsitePreviewImageWithAi(scan = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }
    const imageModel = normalizeString(
      openAiImageModel || env.WEBSITE_PREVIEW_IMAGE_MODEL || env.OPENAI_IMAGE_MODEL || 'gpt-image-2'
    );
    if (!isSupportedOpenAiImageModel(imageModel)) {
      const err = new Error(`OpenAI image-model ongeldig geconfigureerd (${imageModel || 'leeg'})`);
      err.status = 500;
      err.data = {
        error: {
          detail:
            'OPENAI_IMAGE_MODEL moet een ondersteund image-model zijn, bijvoorbeeld gpt-image-2, chatgpt-image-latest, gpt-image-1.5 of gpt-image-1-mini.',
        },
      };
      throw err;
    }

    const referenceImages = await fetchWebsitePreviewReferenceImages(scan);
    const prompt = buildWebsitePreviewPromptFromScan({
      ...scan,
      referenceImageCount: referenceImages.length,
    });

    let { response, data } = await requestOpenAiWebsitePreviewImageGenerationWithRateLimitRetry({
      apiKey,
      imageModel,
      prompt,
      referenceImages,
      imageSize: '2160x3840',
    });
    if (!response.ok && isOpenAiImageSizeError(response, data)) {
      ({ response, data } = await requestOpenAiWebsitePreviewImageGenerationWithRateLimitRetry({
        apiKey,
        imageModel,
        prompt,
        referenceImages,
        imageSize: '1024x1536',
      }));
    }

    if (!response.ok) {
      const err = new Error(`OpenAI websitegenerator mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      err.model = imageModel;
      throw err;
    }

    const imageEntry = Array.isArray(data?.data) ? data.data[0] : null;
    const b64 = normalizeString(imageEntry?.b64_json || '');
    if (!b64) {
      const err = new Error('OpenAI gaf geen afbeelding terug voor de websitegenerator.');
      err.status = 502;
      err.data = data;
      err.model = imageModel;
      throw err;
    }

    return {
      prompt,
      brief: buildWebsitePreviewBriefFromScan(scan),
      model: imageModel,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${b64}`,
      fileName: buildWebsitePreviewDownloadFileName(scan),
      revisedPrompt: normalizeString(imageEntry?.revised_prompt || ''),
      referenceImageCount: referenceImages.length,
      usage: data?.usage || null,
    };
  }

  async function fetchWebsitePreviewScanFromUrl(targetUrlRaw) {
    const normalizedUrl = await assertWebsitePreviewUrlIsPublic(targetUrlRaw);
    const directFetch = await tryFetchWebsitePreviewDocument(normalizedUrl, 25000);
    if (!directFetch.ok) {
      const readerFetch = await tryFetchWebsitePreviewViaReader(normalizedUrl, 25000);
      if (readerFetch.ok) {
        return {
          normalizedUrl,
          finalUrl: readerFetch.finalUrl,
          scan: readerFetch.scan,
        };
      }
      throw buildWebsitePreviewFetchError([
        ...directFetch.attempts,
        {
          mode: 'reader-fallback',
          status: Number(readerFetch.status || 0) || 0,
          blocked: Boolean(readerFetch.blocked),
          error: normalizeString(readerFetch.error || readerFetch.reason || ''),
        },
      ]);
    }

    let response = directFetch.response;
    let finalUrl = directFetch.finalUrl || normalizedUrl;
    let html = String(directFetch.text || '');
    let contentType = extractResponseHeader(response, 'content-type').toLowerCase();
    const clientRedirectUrl = extractWebsitePreviewClientRedirectUrl(html, finalUrl);
    if (clientRedirectUrl) {
      const safeClientRedirectUrl = await assertWebsitePreviewUrlIsPublic(clientRedirectUrl);
      if (safeClientRedirectUrl && safeClientRedirectUrl !== normalizedUrl) {
        const redirectedFetch = await tryFetchWebsitePreviewDocument(safeClientRedirectUrl, 25000);
        if (redirectedFetch.ok) {
          response = redirectedFetch.response;
          finalUrl = redirectedFetch.finalUrl || safeClientRedirectUrl;
          html = String(redirectedFetch.text || '');
          contentType = extractResponseHeader(response, 'content-type').toLowerCase();
        } else {
          const readerFetch = await tryFetchWebsitePreviewViaReader(safeClientRedirectUrl, 25000);
          if (readerFetch.ok) {
            return {
              normalizedUrl,
              finalUrl: readerFetch.finalUrl,
              scan: {
                ...readerFetch.scan,
                fetchSource: 'client-redirect-reader-fallback',
              },
            };
          }
        }
      }
    }
    if (
      contentType &&
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml')
    ) {
      const readerFetch = await tryFetchWebsitePreviewViaReader(normalizedUrl, 25000);
      if (readerFetch.ok) {
        return {
          normalizedUrl,
          finalUrl: readerFetch.finalUrl,
          scan: readerFetch.scan,
        };
      }

      const err = new Error('De opgegeven URL lijkt geen HTML-webpagina te zijn.');
      err.status = 400;
      throw err;
    }

    if (!html) {
      const readerFetch = await tryFetchWebsitePreviewViaReader(normalizedUrl, 25000);
      if (readerFetch.ok) {
        return {
          normalizedUrl,
          finalUrl: readerFetch.finalUrl,
          scan: readerFetch.scan,
        };
      }

      const err = new Error('Deze website gaf geen leesbare HTML terug.');
      err.status = 502;
      throw err;
    }

    const scan = extractWebsitePreviewScanFromHtml(html, finalUrl);
    if (clientRedirectUrl) {
      scan.fetchSource = 'client-redirect';
      scan.clientRedirectUrl = normalizeWebsitePreviewTargetUrl(clientRedirectUrl) || clientRedirectUrl;
    }
    const cssSources = await fetchWebsitePreviewCssSources(html, finalUrl);
    const brandColorHints = extractCssVariableColorHints(cssSources);
    const brandPalette = extractCssBrandPalette(
      cssSources,
      brandColorHints.map((item) => {
        const color = item.split(':').slice(1).join(':');
        return normalizeString(color || '').toLowerCase();
      })
    );
    if (brandColorHints.length) {
      scan.brandColorHints = brandColorHints;
    }
    if (brandPalette.length) {
      scan.brandPalette = brandPalette;
    }
    const fontHints = extractCssFontFamilyHints(cssSources);
    if (fontHints.length) {
      scan.fontHints = fontHints;
    }
    scan.stylesheetCount = cssSources.length;
    if (!scan.title && !scan.h1 && !scan.metaDescription && !scan.bodyTextSample) {
      const readerFetch = await tryFetchWebsitePreviewViaReader(normalizedUrl, 25000);
      if (readerFetch.ok) {
        return {
          normalizedUrl,
          finalUrl: readerFetch.finalUrl,
          scan: readerFetch.scan,
        };
      }

      const err = new Error('Er kon te weinig bruikbare inhoud uit deze website worden gelezen.');
      err.status = 422;
      throw err;
    }

    return {
      normalizedUrl,
      finalUrl,
      scan,
    };
  }

  async function generateWebsitePromptFromTranscriptWithAi(options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 20000);
    if (!transcript) {
      const err = new Error('Transcript ontbreekt');
      err.status = 400;
      throw err;
    }

    const language = normalizeString(options.language || 'nl') || 'nl';
    const context = truncateText(normalizeString(options.context || ''), 2000);

    const systemPrompt = [
      'Je bent een senior digital strategist en prompt engineer.',
      'Taak: zet een gesprekstranscript om naar EEN direct uitvoerbare prompt voor een AI die websites bouwt.',
      'Belangrijk:',
      '- Gebruik alleen feiten uit transcriptie/context, verzin niets.',
      '- Als info ontbreekt, gebruik placeholders in vorm [VUL IN: ...].',
      '- Output alleen de prompttekst, zonder markdown fences of extra uitleg.',
      '- Schrijf in duidelijke professionele taal in de gevraagde taal.',
    ].join('\n');

    const userPrompt = [
      `Taal: ${language}`,
      '',
      'Maak een complete prompt met deze secties en volgorde:',
      '1) Rol en doel van de website-AI',
      '2) Bedrijfscontext',
      '3) Doelgroep(en)',
      '4) Hoofddoel + conversiedoelen',
      '5) Paginastructuur (navigatie + secties per pagina)',
      '6) Copy-richting per sectie',
      '7) Designrichting (stijl, kleur, typografie, tone-of-voice)',
      '8) Functionaliteit (formulieren, CTA, contact, eventuele integraties)',
      '9) SEO-basis (title, meta, headings, keywords, interne links)',
      '10) Technische eisen (performance, mobile-first, toegankelijkheid)',
      '11) Opleverchecklist',
      '',
      'Regels voor nauwkeurigheid:',
      '- Gebruik concrete details uit de transcriptie waar beschikbaar.',
      '- Houd placeholders zichtbaar voor alles wat ontbreekt.',
      '- Schrijf zo dat de prompt direct in een AI website-builder geplakt kan worden.',
      context ? `- Extra context: ${context}` : '',
      '',
      'Transcriptie bron:',
      transcript,
    ]
      .filter(Boolean)
      .join('\n');

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      },
      30000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI prompt generatie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const prompt = normalizeString(extractOpenAiTextContent(content));
    if (!prompt) {
      const err = new Error('OpenAI gaf een lege prompt terug.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    return {
      prompt: truncateText(prompt, 12000),
      source: 'openai',
      model: openAiModel,
      usage: data?.usage || null,
      language,
    };
  }

  async function extractMeetingNotesFromImageWithAi(options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const imageDataUrl = normalizeString(options.imageDataUrl || options.image || '').replace(/\s+/g, '');
    if (!imageDataUrl) {
      const err = new Error('Afbeelding ontbreekt');
      err.status = 400;
      throw err;
    }
    if (!/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(imageDataUrl)) {
      const err = new Error('Ongeldige afbeelding. Gebruik PNG, JPG of WEBP als data URL.');
      err.status = 400;
      throw err;
    }
    if (imageDataUrl.length > 900000) {
      const err = new Error('Afbeelding te groot. Lever een compactere foto aan.');
      err.status = 413;
      throw err;
    }

    const language = normalizeString(options.language || 'nl') || 'nl';
    const systemPrompt = [
      'Je bent een nauwkeurige notitie-assistent.',
      'Lees de geuploade foto van meetingnotities en zet dit om naar leesbare tekst.',
      'Verzin geen feiten. Als een woord onduidelijk is, gebruik [ONLEESBAAR].',
      'Output exact JSON met veld "transcript". Geen markdown, geen extra velden.',
    ].join('\n');

    const userPrompt = [
      `Taal voor transcript: ${language}.`,
      'Zet de notities om naar een compacte, duidelijke transcriptie met regeleinden.',
      'Behoud concrete wensen, functionaliteiten, planning, budget en stijlkeuzes als die zichtbaar zijn.',
      'Output JSON voorbeeld: {"transcript":"..."}',
    ].join('\n');

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.1,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: imageDataUrl } },
              ],
            },
          ],
        }),
      },
      70000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI image-notes extractie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const textContent = normalizeString(extractOpenAiTextContent(content));
    if (!textContent) {
      const err = new Error('OpenAI gaf geen notities terug uit de afbeelding.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    const parsed = parseJsonLoose(textContent);
    const transcript = truncateText(
      normalizeString(
        parsed && typeof parsed === 'object' && typeof parsed.transcript === 'string'
          ? parsed.transcript
          : textContent
      ),
      20000
    );

    if (!transcript) {
      const err = new Error('Er kon geen transcriptie uit de notitiefoto worden gehaald.');
      err.status = 502;
      throw err;
    }

    return {
      transcript,
      source: 'openai-vision',
      model: openAiModel,
      usage: data?.usage || null,
      language,
    };
  }

  async function transcribeMeetingAudioWithAi(options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const audioDataUrl = normalizeString(options.audioDataUrl || options.audio || '');
    const fileName = normalizeString(options.fileName || 'meeting-audio');
    const fallbackMimeType = normalizeString(options.mimeType || '');
    const language = normalizeString(options.language || 'nl') || 'nl';
    const parsedAudio = parseMeetingAudioDataUrl(audioDataUrl, fileName, fallbackMimeType);
    if (parsedAudio.bytes.length > 24 * 1024 * 1024) {
      const err = new Error('Audiobestand is te groot om direct te transcriberen.');
      err.status = 413;
      throw err;
    }

    const models = getOpenAiAudioTranscriptionModelCandidates();
    let lastError = null;

    for (const model of models) {
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([parsedAudio.bytes], { type: parsedAudio.mimeType || 'audio/mpeg' }),
          buildMeetingAudioUploadFileName(fileName, parsedAudio.mimeType)
        );
        form.append('model', model);
        form.append('language', language);
        form.append('temperature', '0');
        form.append('response_format', 'text');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);

        try {
          const response = await fetchImpl(`${openAiApiBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              ...buildOpenAiContextHeaders({ env, openAiApiBaseUrl }),
            },
            body: form,
            signal: controller.signal,
          });

          const rawBody = await response.text();
          if (!response.ok) {
            const err = new Error(`OpenAI audio transcriptie mislukt (${response.status})`);
            err.status = response.status;
            err.data = parseJsonLoose(rawBody) || rawBody;
            throw err;
          }

          const parsed = parseJsonLoose(rawBody);
          const transcript = truncateText(
            normalizeString(parsed?.text || parsed?.transcript || parsed?.output_text || '') ||
              normalizeString(rawBody),
            20000
          );
          if (!transcript) {
            const err = new Error('OpenAI gaf geen transcriptie terug uit het audiobestand.');
            err.status = 502;
            throw err;
          }

          return {
            transcript,
            source: 'openai-audio',
            model,
            usage: parsed?.usage || null,
            language,
          };
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    const err = new Error('Audio transcriptie mislukt.');
    err.status = 502;
    throw err;
  }

  function buildWebsitePromptFallback(options = {}) {
    const language = normalizeString(options.language || 'nl') || 'nl';
    const context = truncateText(normalizeString(options.context || ''), 2000);
    const transcript = truncateText(normalizeString(options.transcript || options.text || ''), 12000);

    const headerNl = [
      'ROL',
      'Je bent een senior webdesigner + conversion copywriter + front-end developer.',
      '',
      'DOEL',
      'Bouw een conversiegerichte website op basis van de transcriptie hieronder.',
      'Gebruik alleen feiten uit de transcriptie. Als iets ontbreekt: gebruik [VUL IN: ...].',
      '',
      'OUTPUTVORM',
      'Lever concreet op in deze volgorde:',
      '1) Merkprofiel (bedrijf, dienst, propositie)',
      '2) Doelgroepen + pijnpunten',
      '3) Sitemap met pagina-doelen',
      '4) Wireframe per pagina (secties in volgorde)',
      '5) Definitieve copy per sectie',
      '6) Designrichting (kleur, typografie, sfeer, beeldstijl)',
      '7) Conversie-elementen (CTA, formulieren, vertrouwen)',
      '8) Technische bouwinstructies (responsive, performance, toegankelijkheid)',
      '9) SEO-basis (title, meta, H1-H3, keywords)',
      '10) TODO-lijst met open vragen [VUL IN: ...]',
      '',
      context ? `EXTRA CONTEXT\n${context}\n` : '',
      'BRONTRANSCRIPTIE (LETTERLIJK)',
      transcript || '[VUL IN: transcriptie ontbreekt]',
    ];

    if (language.toLowerCase().startsWith('en')) {
      return [
        'ROLE',
        'You are a senior web designer + conversion copywriter + front-end developer.',
        '',
        'GOAL',
        'Build a conversion-focused website from the transcript below.',
        'Use only facts from the transcript. If something is missing: use [FILL IN: ...].',
        '',
        'OUTPUT FORMAT',
        'Deliver in this order:',
        '1) Brand profile',
        '2) Target audiences + pain points',
        '3) Sitemap with page goals',
        '4) Wireframe per page',
        '5) Final copy per section',
        '6) Design direction',
        '7) Conversion elements',
        '8) Technical build instructions',
        '9) SEO basics',
        '10) Open questions [FILL IN: ...]',
        '',
        context ? `EXTRA CONTEXT\n${context}\n` : '',
        'SOURCE TRANSCRIPT (VERBATIM)',
        transcript || '[FILL IN: missing transcript]',
      ].join('\n');
    }

    return headerNl.join('\n');
  }

  async function generateDynamicOrderDossierWithAnthropic(options = {}) {
    const promptPack = buildAnthropicOrderDossierPrompts(options);
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const model = normalizeString(options.model || openAiModel) || 'gpt-5.5-pro';
    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: promptPack.systemPrompt },
            { role: 'user', content: promptPack.userPrompt },
          ],
        }),
      },
      websiteGenerationTimeoutMs
    );

    if (!response.ok) {
      const err = new Error(`OpenAI dossier generatie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const rawText = normalizeString(extractOpenAiTextContent(data?.choices?.[0]?.message?.content));
    const parsed = parseJsonLoose(rawText);
    if (!parsed || typeof parsed !== 'object') {
      const err = new Error('OpenAI gaf geen geldig JSON-layout terug.');
      err.status = 502;
      throw err;
    }

    const layout = normalizeOrderDossierLayout(parsed, promptPack.input);
    return {
      layout,
      source: 'openai',
      model: normalizeString(data?.model || model) || model,
      usage: data?.usage || null,
    };
  }

  async function sendAnthropicMessage(options = {}) {
    const err = new Error('Claude/Anthropic modellen zijn uitgeschakeld. Gebruik OpenAI.');
    err.status = 410;
    err.code = 'CLAUDE_MODELS_DISABLED';
    err.data = {
      provider: 'anthropic',
      replacementProvider: 'openai',
    };
    throw err;
  }

  async function generateWebsiteHtmlWithOpenAi(options = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      const err = new Error('OPENAI_API_KEY ontbreekt');
      err.status = 503;
      throw err;
    }

    const { company, title, userPrompt, systemPrompt, referenceImages } =
      buildWebsiteGenerationPrompts(options);
    const userContent = referenceImages.length
      ? [
          { type: 'text', text: userPrompt },
          ...referenceImages.map((item) => ({
            type: 'image_url',
            image_url: { url: item.dataUrl },
          })),
        ]
      : userPrompt;

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        }),
      },
      websiteGenerationTimeoutMs
    );

    if (!response.ok) {
      const err = new Error(`OpenAI website generatie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const generatedText = normalizeString(extractOpenAiTextContent(content));
    if (!generatedText) {
      const err = new Error('OpenAI gaf lege HTML terug.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    const html = ensureHtmlDocument(generatedText, { title, company });
    if (!html) {
      const err = new Error('Kon HTML output niet valideren.');
      err.status = 502;
      err.data = data;
      throw err;
    }

    return {
      html,
      source: 'openai',
      model: openAiModel,
      usage: data?.usage || null,
      apiCost:
        estimateOpenAiUsageCost(data?.usage || null, openAiModel) ||
        estimateOpenAiTextCost(userPrompt, html, openAiModel),
    };
  }

  async function generateWebsiteHtmlWithAnthropic(options = {}) {
    return generateWebsiteHtmlWithOpenAi(options);
  }

  async function generateWebsiteHtmlWithAi(options = {}) {
    return generateWebsiteHtmlWithOpenAi(options);
  }

  return {
    buildWebsitePromptFallback,
    extractMeetingNotesFromImageWithAi,
    fetchWebsitePreviewScanFromUrl,
    generateDynamicOrderDossierWithAnthropic,
    generateWebsiteHtmlWithAi,
    generateWebsiteHtmlWithAnthropic,
    generateWebsiteHtmlWithOpenAi,
    generateWebsitePreviewImageWithAi,
    generateWebsitePromptFromTranscriptWithAi,
    sendAnthropicMessage,
    transcribeMeetingAudioWithAi,
  };
}

module.exports = {
  createAiRemoteService,
};
