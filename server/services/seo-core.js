function createSeoCore(deps = {}) {
  const {
    knownHtmlPageFiles = new Set(),
    normalizeAbsoluteHttpUrl = (value) => String(value || '').trim(),
    normalizeString = (value) => String(value || '').trim(),
    normalizeWebsitePreviewTargetUrl = (value) => String(value || '').trim(),
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(String(value || ''), 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    seoDefaultSiteOrigin = '',
    seoMaxImagesPerPage = 2000,
    seoModelPresets = [],
    seoPageFieldDefs = [],
    toBooleanSafe = (value, fallback = false) => {
      if (value == null) return fallback;
      return Boolean(value);
    },
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
  } = deps;

  const knownHtmlFileSet = knownHtmlPageFiles instanceof Set ? knownHtmlPageFiles : new Set(knownHtmlPageFiles || []);

  function getDefaultSeoConfig() {
    return {
      version: 2,
      pages: {},
      images: {},
      automation: getDefaultSeoAutomationSettings(),
    };
  }

  function normalizeSeoModelPreset(valueRaw) {
    const raw = normalizeString(valueRaw || '')
      .toLowerCase()
      .replace(/[\s_]+/g, '-');
    if (!raw) return 'gpt-5.1';
    if (raw === 'gpt-5.1' || raw === 'gpt51' || raw === 'gpt-5') return 'gpt-5.1';
    if (
      raw === 'claude-opus-4.6' ||
      raw === 'opus-4.6' ||
      raw === 'opus46' ||
      raw === 'claude-opus-46' ||
      raw === 'claude-opus'
    ) {
      return 'claude-opus-4.6';
    }
    if (raw === 'gpt-5-mini' || raw === 'gpt5mini') return 'gpt-5-mini';
    return seoModelPresets.some((item) => item.value === raw) ? raw : 'gpt-5.1';
  }

  function normalizeSeoBlogCadence(valueRaw) {
    const raw = normalizeString(valueRaw || '')
      .toLowerCase()
      .replace(/[\s_]+/g, '_');
    if (!raw) return 'weekly';
    if (raw === 'daily' || raw === 'dagelijks' || raw === 'elke_dag') return 'daily';
    if (raw === 'weekdays' || raw === 'werkdagen') return 'weekdays';
    if (raw === 'three_per_week' || raw === 'drie_per_week' || raw === '3x_per_week') return 'three_per_week';
    if (raw === 'weekly' || raw === 'wekelijks') return 'weekly';
    if (raw === 'manual' || raw === 'handmatig') return 'manual';
    return 'weekly';
  }

  function getDefaultSeoAutomationSettings() {
    return {
      preferredModel: 'gpt-5.1',
      blogAutomationEnabled: false,
      blogCadence: 'weekly',
      blogModel: 'gpt-5.1',
      blogAutoImages: true,
      searchConsoleConnected: false,
      analyticsConnected: false,
      updatedAt: '',
    };
  }

  function normalizeSeoAutomationSettings(raw) {
    const defaults = getDefaultSeoAutomationSettings();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
    return {
      preferredModel: normalizeSeoModelPreset(raw.preferredModel || raw.model || defaults.preferredModel),
      blogAutomationEnabled: toBooleanSafe(raw.blogAutomationEnabled ?? raw.blogEnabled, defaults.blogAutomationEnabled),
      blogCadence: normalizeSeoBlogCadence(raw.blogCadence || raw.blogFrequency || defaults.blogCadence),
      blogModel: normalizeSeoModelPreset(raw.blogModel || raw.blog_model || defaults.blogModel),
      blogAutoImages: toBooleanSafe(raw.blogAutoImages ?? raw.blogImages, defaults.blogAutoImages),
      searchConsoleConnected: toBooleanSafe(raw.searchConsoleConnected, defaults.searchConsoleConnected),
      analyticsConnected: toBooleanSafe(raw.analyticsConnected, defaults.analyticsConnected),
      updatedAt: normalizeString(raw.updatedAt || ''),
    };
  }

  function sanitizeKnownHtmlFileName(fileNameRaw) {
    const fileName = normalizeString(fileNameRaw);
    if (!fileName || !/^[a-zA-Z0-9._-]+\.html$/.test(fileName)) return '';
    if (!knownHtmlFileSet.has(fileName)) return '';
    return fileName;
  }

  function normalizeSeoFieldValue(value, maxLength = 1000) {
    return truncateText(normalizeString(value), maxLength);
  }

  function normalizeSeoPageOverridePatch(raw) {
    const patch = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return patch;

    for (const field of seoPageFieldDefs) {
      if (!Object.prototype.hasOwnProperty.call(raw, field.key)) continue;
      patch[field.key] = normalizeSeoFieldValue(raw[field.key], field.maxLength);
    }
    return patch;
  }

  function normalizeSeoImageOverridePatch(raw) {
    const patch = {};
    if (!raw) return patch;

    if (Array.isArray(raw)) {
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const src = truncateText(normalizeString(entry.src), 1800);
        if (!src) continue;
        patch[src] = truncateText(normalizeString(entry.alt), 1200);
      }
      return patch;
    }

    if (typeof raw !== 'object') return patch;

    for (const [srcRaw, altRaw] of Object.entries(raw)) {
      const src = truncateText(normalizeString(srcRaw), 1800);
      if (!src) continue;
      patch[src] = truncateText(normalizeString(altRaw), 1200);
    }
    return patch;
  }

  function normalizeSeoStoredPageOverrides(raw) {
    const patch = normalizeSeoPageOverridePatch(raw);
    const stored = {};
    for (const [key, value] of Object.entries(patch)) {
      if (!value) continue;
      stored[key] = value;
    }
    return stored;
  }

  function normalizeSeoStoredImageOverrides(raw) {
    const patch = normalizeSeoImageOverridePatch(raw);
    const stored = {};
    for (const [src, alt] of Object.entries(patch)) {
      if (!alt) continue;
      stored[src] = alt;
    }
    return stored;
  }

  function normalizeSeoConfig(raw) {
    const base = getDefaultSeoConfig();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
    base.version = Math.max(2, parseIntSafe(raw.version, 2));
    base.automation = normalizeSeoAutomationSettings(raw.automation);

    const pagesRaw = raw.pages && typeof raw.pages === 'object' ? raw.pages : {};
    for (const [fileNameRaw, pageOverridesRaw] of Object.entries(pagesRaw)) {
      const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
      if (!fileName) continue;
      const pageOverrides = normalizeSeoStoredPageOverrides(pageOverridesRaw);
      if (Object.keys(pageOverrides).length === 0) continue;
      base.pages[fileName] = pageOverrides;
    }

    const imagesRaw = raw.images && typeof raw.images === 'object' ? raw.images : {};
    for (const [fileNameRaw, imageOverridesRaw] of Object.entries(imagesRaw)) {
      const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
      if (!fileName) continue;
      const imageOverrides = normalizeSeoStoredImageOverrides(imageOverridesRaw);
      if (Object.keys(imageOverrides).length === 0) continue;
      base.images[fileName] = imageOverrides;
    }

    return base;
  }

  function getSeoEditableHtmlFiles() {
    return Array.from(knownHtmlFileSet)
      .filter((fileName) => fileName !== 'premium-seo.html')
      .sort((a, b) => a.localeCompare(b));
  }

  function decodeBasicHtmlEntities(valueRaw) {
    const value = String(valueRaw || '');
    return value
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function stripHtmlTags(valueRaw) {
    return String(valueRaw || '').replace(/<[^>]*>/g, ' ');
  }

  function parseHtmlTagAttributes(tagRaw) {
    const tag = String(tagRaw || '');
    const attrs = {};
    const pattern = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match;
    while ((match = pattern.exec(tag))) {
      const key = normalizeString(match[1]).toLowerCase();
      const value = decodeBasicHtmlEntities(match[3] || match[4] || match[5] || '');
      if (!key) continue;
      attrs[key] = value;
    }
    return attrs;
  }

  function extractTitleFromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!match) return '';
    return truncateText(normalizeString(decodeBasicHtmlEntities(stripHtmlTags(match[1]))), 300);
  }

  function extractMetaContentFromHtml(htmlRaw, selectorAttr, selectorValue) {
    const html = String(htmlRaw || '');
    const tagPattern = /<meta\b[^>]*>/gi;
    const attrName = normalizeString(selectorAttr).toLowerCase();
    const attrValue = normalizeString(selectorValue).toLowerCase();
    let match;
    while ((match = tagPattern.exec(html))) {
      const attrs = parseHtmlTagAttributes(match[0]);
      const selectedValue = normalizeString(attrs[attrName]).toLowerCase();
      if (selectedValue !== attrValue) continue;
      return truncateText(normalizeString(attrs.content || ''), 1200);
    }
    return '';
  }

  function extractCanonicalHrefFromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    const tagPattern = /<link\b[^>]*>/gi;
    let match;
    while ((match = tagPattern.exec(html))) {
      const attrs = parseHtmlTagAttributes(match[0]);
      const rel = normalizeString(attrs.rel || '').toLowerCase();
      if (!rel.split(/\s+/).includes('canonical')) continue;
      return truncateText(normalizeString(attrs.href || ''), 1200);
    }
    return '';
  }

  function extractFirstH1FromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    const match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    if (!match) return '';
    return truncateText(normalizeString(decodeBasicHtmlEntities(stripHtmlTags(match[1]))), 300);
  }

  function extractImageEntriesFromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    const out = [];
    const seen = new Set();
    const pattern = /<img\b[^>]*>/gi;
    let match;
    while ((match = pattern.exec(html))) {
      if (out.length >= seoMaxImagesPerPage) break;
      const attrs = parseHtmlTagAttributes(match[0]);
      const src = truncateText(normalizeString(attrs.src || attrs['data-src'] || ''), 1800);
      if (!src || seen.has(src)) continue;
      seen.add(src);
      out.push({
        src,
        alt: truncateText(normalizeString(attrs.alt || ''), 1200),
      });
    }
    return out;
  }

  function extractSeoSourceFromHtml(htmlRaw) {
    const html = String(htmlRaw || '');
    return {
      title: extractTitleFromHtml(html),
      metaDescription: extractMetaContentFromHtml(html, 'name', 'description'),
      metaKeywords: extractMetaContentFromHtml(html, 'name', 'keywords'),
      canonical: extractCanonicalHrefFromHtml(html),
      robots: extractMetaContentFromHtml(html, 'name', 'robots'),
      ogTitle: extractMetaContentFromHtml(html, 'property', 'og:title'),
      ogDescription: extractMetaContentFromHtml(html, 'property', 'og:description'),
      ogImage: extractMetaContentFromHtml(html, 'property', 'og:image'),
      twitterTitle: extractMetaContentFromHtml(html, 'name', 'twitter:title'),
      twitterDescription: extractMetaContentFromHtml(html, 'name', 'twitter:description'),
      twitterImage: extractMetaContentFromHtml(html, 'name', 'twitter:image'),
      h1: extractFirstH1FromHtml(html),
    };
  }

  function extractRepeatedTagTextEntriesFromHtml(htmlRaw, tagPattern, options = {}) {
    const html = String(htmlRaw || '');
    const maxItems = Math.max(1, Math.min(12, Number(options.maxItems) || 6));
    const maxLength = Math.max(40, Math.min(600, Number(options.maxLength) || 220));
    const regex = tagPattern instanceof RegExp ? new RegExp(tagPattern.source, 'gi') : null;
    if (!regex) return [];
    const out = [];
    const seen = new Set();
    let match;
    while ((match = regex.exec(html))) {
      const value = truncateText(
        normalizeString(decodeBasicHtmlEntities(stripHtmlTags(match[1] || '')).replace(/\s+/g, ' ')),
        maxLength
      );
      const dedupeKey = value.toLowerCase();
      if (!value || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push(value);
      if (out.length >= maxItems) break;
    }
    return out;
  }

  function extractVisibleTextSampleFromHtml(htmlRaw, maxLength = 2800) {
    const html = String(htmlRaw || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ');
    return truncateText(
      normalizeString(decodeBasicHtmlEntities(stripHtmlTags(html)).replace(/\s+/g, ' ')),
      maxLength
    );
  }

  function extractWebsitePreviewScanFromHtml(htmlRaw, pageUrlRaw) {
    const html = String(htmlRaw || '');
    const normalizedUrl = normalizeWebsitePreviewTargetUrl(pageUrlRaw);
    const parsedUrl = normalizedUrl ? new URL(normalizedUrl) : null;
    const source = extractSeoSourceFromHtml(html);
    const headings = extractRepeatedTagTextEntriesFromHtml(html, /<h[2-3]\b[^>]*>([\s\S]*?)<\/h[2-3]>/gi, {
      maxItems: 8,
      maxLength: 220,
    });
    const paragraphs = extractRepeatedTagTextEntriesFromHtml(html, /<p\b[^>]*>([\s\S]*?)<\/p>/gi, {
      maxItems: 8,
      maxLength: 280,
    });
    const images = extractImageEntriesFromHtml(html).slice(0, 8);
    const visualCues = Array.from(
      new Set(
        images
          .map((entry) => {
            const alt = normalizeString(entry?.alt || '');
            if (alt) return alt;
            const src = normalizeString(entry?.src || '');
            if (!src) return '';
            return src
              .split(/[/?#]/)
              .filter(Boolean)
              .pop()
              .replace(/\.[a-z0-9]+$/i, '')
              .replace(/[-_]+/g, ' ');
          })
          .map((value) => truncateText(normalizeString(value), 120))
          .filter(Boolean)
      )
    ).slice(0, 6);
    const bodyTextSample = extractVisibleTextSampleFromHtml(html, 3200);

    return {
      url: normalizedUrl,
      host: parsedUrl ? parsedUrl.host : '',
      title: source.title || source.ogTitle || '',
      metaDescription: source.metaDescription || source.ogDescription || '',
      h1: source.h1 || '',
      headings,
      paragraphs,
      visualCues,
      imageCount: images.length,
      bodyTextSample,
    };
  }

  function mergeSeoSourceWithOverrides(sourceRaw, overridesRaw) {
    const source = normalizeSeoPageOverridePatch(sourceRaw);
    const overrides = normalizeSeoStoredPageOverrides(overridesRaw);
    const merged = {};
    for (const field of seoPageFieldDefs) {
      merged[field.key] = overrides[field.key] || source[field.key] || '';
    }
    return merged;
  }

  function getSeoModelPresetOptions() {
    return seoModelPresets.map((item) => ({ ...item }));
  }

  function getSeoPathFromFileName(fileNameRaw) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    if (!fileName) return '/';
    const slug = fileName.replace(/\.html$/i, '');
    return slug === 'index' ? '/' : `/${slug}`;
  }

  function stripSeoBrandTokens(valueRaw) {
    return normalizeString(valueRaw || '')
      .replace(/\bsoftora(?:\.nl)?\b/gi, ' ')
      .replace(/[|·]+/g, ' ')
      .replace(/\s+[—-]\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function humanizeSeoToken(tokenRaw) {
    const token = normalizeString(tokenRaw || '').toLowerCase();
    if (!token) return '';
    if (token === 'ai') return 'AI';
    if (token === 'seo') return 'SEO';
    if (token === 'crm') return 'CRM';
    if (token === 'pdfs' || token === 'pdf') return "PDF's";
    if (token === 'ga') return 'GA';
    return token.charAt(0).toUpperCase() + token.slice(1);
  }

  function humanizeSeoPathSegment(segmentRaw) {
    return normalizeString(segmentRaw || '')
      .split(/[-_/]+/)
      .map(humanizeSeoToken)
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  function buildSeoTopicLabel(fileName, effectiveSeoRaw = {}) {
    const effectiveSeo = effectiveSeoRaw && typeof effectiveSeoRaw === 'object' ? effectiveSeoRaw : {};
    const candidates = [
      stripSeoBrandTokens(effectiveSeo.h1 || ''),
      stripSeoBrandTokens(effectiveSeo.title || ''),
      humanizeSeoPathSegment(getSeoPathFromFileName(fileName).replace(/^\//, '')),
    ].filter(Boolean);

    for (const candidate of candidates) {
      const cleaned = normalizeString(candidate).replace(/\s+/g, ' ').trim();
      if (cleaned && cleaned.length >= 3) return cleaned;
    }

    return 'Softora website';
  }

  function buildSeoPathKeywords(pathNameRaw, topicRaw) {
    const pathName = normalizeString(pathNameRaw || '');
    const topic = normalizeString(topicRaw || '');
    const source = `${pathName.replace(/[\/_-]+/g, ' ')} ${topic}`;
    const parts = source
      .toLowerCase()
      .split(/\s+/)
      .map((item) => item.replace(/[^a-z0-9à-ÿ]/gi, ''))
      .filter(Boolean)
      .filter((item) => item.length >= 3);
    const unique = [];
    const seen = new Set();
    parts.forEach((part) => {
      if (seen.has(part)) return;
      seen.add(part);
      unique.push(part);
    });
    return unique.slice(0, 6);
  }

  function buildSeoSuggestedTitle(fileName, effectiveSeoRaw = {}) {
    const pathName = getSeoPathFromFileName(fileName);
    if (pathName === '/') return 'Softora | Websites, Bedrijfssoftware & Voicesoftware';
    const topic = buildSeoTopicLabel(fileName, effectiveSeoRaw);
    const withBrand = `${topic} | Softora`;
    return truncateText(withBrand, 60);
  }

  function buildSeoSuggestedMetaDescription(fileName, effectiveSeoRaw = {}) {
    const pathName = getSeoPathFromFileName(fileName);
    const topic = buildSeoTopicLabel(fileName, effectiveSeoRaw);
    const keywordBits = buildSeoPathKeywords(pathName, topic);
    const keywordTail = keywordBits.length ? ` met focus op ${keywordBits.slice(0, 3).join(', ')}` : '';

    if (pathName === '/') {
      return truncateText(
        'Softora bouwt websites, bedrijfssoftware en voicesoftware die direct bijdragen aan groei, conversie en slimmere processen.',
        160
      );
    }

    return truncateText(
      `${topic} van Softora. Ontdek wat deze pagina oplevert, hoe de oplossing werkt en waarom dit relevant is voor jouw bedrijf${keywordTail}.`,
      160
    );
  }

  function buildSeoSuggestedMetaKeywords(fileName, effectiveSeoRaw = {}) {
    const pathName = getSeoPathFromFileName(fileName);
    const topic = buildSeoTopicLabel(fileName, effectiveSeoRaw);
    const keywords = ['softora'];
    const topicWords = topic
      .toLowerCase()
      .split(/\s+/)
      .map((item) => item.replace(/[^a-z0-9à-ÿ]/gi, ''))
      .filter((item) => item.length >= 3);
    keywords.push(...topicWords);
    keywords.push(...buildSeoPathKeywords(pathName, topic));
    return Array.from(new Set(keywords)).slice(0, 8).join(', ');
  }

  function buildSeoSuggestedCanonical(fileName) {
    const pathName = getSeoPathFromFileName(fileName);
    return pathName === '/' ? seoDefaultSiteOrigin : `${seoDefaultSiteOrigin}${pathName}`;
  }

  function buildSeoSuggestedH1(fileName, effectiveSeoRaw = {}) {
    return truncateText(buildSeoTopicLabel(fileName, effectiveSeoRaw), 80);
  }

  function buildSeoSuggestedAltText(fileName, _imageIndex, effectiveSeoRaw = {}) {
    const topic = buildSeoTopicLabel(fileName, effectiveSeoRaw);
    return truncateText(`Visual van ${topic} - Softora`, 120);
  }

  function isSeoTitleHealthy(valueRaw) {
    const length = normalizeString(valueRaw || '').length;
    return length >= 28 && length <= 65;
  }

  function isSeoDescriptionHealthy(valueRaw) {
    const length = normalizeString(valueRaw || '').length;
    return length >= 110 && length <= 170;
  }

  function isSeoCanonicalHealthy(valueRaw, fileName) {
    const value = normalizeAbsoluteHttpUrl(valueRaw || '');
    if (!value) return false;
    return value === buildSeoSuggestedCanonical(fileName);
  }

  function isSeoRobotsHealthy(valueRaw) {
    const value = normalizeString(valueRaw || '').toLowerCase();
    if (!value) return true;
    return /index/.test(value) && /follow/.test(value);
  }

  function buildSeoPageAuditEntry(fileName, sourceSeo, pageOverrides, effectiveSeo, images) {
    const normalizedImages = Array.isArray(images) ? images : [];
    const imageAltMissing = normalizedImages.filter((image) => !normalizeString(image?.effectiveAlt || image?.alt || '')).length;
    const totalImages = normalizedImages.length;
    const altCoverage = totalImages === 0 ? 100 : Math.round(((totalImages - imageAltMissing) / totalImages) * 100);

    const titleHealthy = isSeoTitleHealthy(effectiveSeo?.title || '');
    const descriptionHealthy = isSeoDescriptionHealthy(effectiveSeo?.metaDescription || '');
    const h1Healthy = normalizeString(effectiveSeo?.h1 || '').length >= 4;
    const canonicalHealthy = isSeoCanonicalHealthy(effectiveSeo?.canonical || '', fileName);
    const robotsHealthy = isSeoRobotsHealthy(effectiveSeo?.robots || '');
    const ogTitleHealthy = normalizeString(effectiveSeo?.ogTitle || '').length >= 4;
    const ogDescriptionHealthy = normalizeString(effectiveSeo?.ogDescription || '').length >= 30;
    const twitterTitleHealthy = normalizeString(effectiveSeo?.twitterTitle || '').length >= 4;
    const twitterDescriptionHealthy = normalizeString(effectiveSeo?.twitterDescription || '').length >= 30;

    const score =
      (titleHealthy ? 18 : 0) +
      (descriptionHealthy ? 18 : 0) +
      (h1Healthy ? 12 : 0) +
      (canonicalHealthy ? 12 : 0) +
      (robotsHealthy ? 8 : 0) +
      (ogTitleHealthy ? 8 : 0) +
      (ogDescriptionHealthy ? 8 : 0) +
      (twitterTitleHealthy ? 5 : 0) +
      (twitterDescriptionHealthy ? 5 : 0) +
      Math.round((Math.max(0, Math.min(100, altCoverage)) / 100) * 6);

    const strengths = [];
    const improvements = [];

    if (titleHealthy) strengths.push('Meta title staat op goede lengte.');
    else improvements.push('Meta title kan scherper of compacter.');
    if (descriptionHealthy) strengths.push('Meta description is bruikbaar voor zoekresultaten.');
    else improvements.push('Meta description mist of kan duidelijker.');
    if (canonicalHealthy) strengths.push('Canonical URL staat goed.');
    else improvements.push('Canonical URL ontbreekt of wijst nog niet strak naar deze pagina.');
    if (altCoverage >= 90) strengths.push('Afbeeldingen zijn grotendeels voorzien van alt-tekst.');
    else if (totalImages > 0) improvements.push('Niet alle afbeeldingen hebben een goede alt-tekst.');
    if (ogTitleHealthy && ogDescriptionHealthy) strengths.push('Social sharing basis is aanwezig.');
    else improvements.push('Open Graph velden kunnen vollediger.');
    if (twitterTitleHealthy && twitterDescriptionHealthy) strengths.push('Twitter/X velden zijn ingevuld.');
    else improvements.push('Twitter/X velden kunnen vollediger.');

    const suggestedPageOverrides = {};
    if (!titleHealthy) suggestedPageOverrides.title = buildSeoSuggestedTitle(fileName, effectiveSeo);
    if (!descriptionHealthy) suggestedPageOverrides.metaDescription = buildSeoSuggestedMetaDescription(fileName, effectiveSeo);
    if (!normalizeString(effectiveSeo?.metaKeywords || '')) {
      suggestedPageOverrides.metaKeywords = buildSeoSuggestedMetaKeywords(fileName, effectiveSeo);
    }
    if (!canonicalHealthy) suggestedPageOverrides.canonical = buildSeoSuggestedCanonical(fileName);
    if (!robotsHealthy) suggestedPageOverrides.robots = 'index, follow';
    if (!ogTitleHealthy) {
      suggestedPageOverrides.ogTitle =
        suggestedPageOverrides.title ||
        normalizeString(effectiveSeo?.title || '') ||
        buildSeoSuggestedTitle(fileName, effectiveSeo);
    }
    if (!ogDescriptionHealthy) {
      suggestedPageOverrides.ogDescription =
        suggestedPageOverrides.metaDescription ||
        normalizeString(effectiveSeo?.metaDescription || '') ||
        buildSeoSuggestedMetaDescription(fileName, effectiveSeo);
    }
    if (!twitterTitleHealthy) {
      suggestedPageOverrides.twitterTitle =
        suggestedPageOverrides.ogTitle ||
        suggestedPageOverrides.title ||
        normalizeString(effectiveSeo?.title || '') ||
        buildSeoSuggestedTitle(fileName, effectiveSeo);
    }
    if (!twitterDescriptionHealthy) {
      suggestedPageOverrides.twitterDescription =
        suggestedPageOverrides.ogDescription ||
        suggestedPageOverrides.metaDescription ||
        normalizeString(effectiveSeo?.metaDescription || '') ||
        buildSeoSuggestedMetaDescription(fileName, effectiveSeo);
    }
    if (!h1Healthy) suggestedPageOverrides.h1 = buildSeoSuggestedH1(fileName, effectiveSeo);

    const suggestedImageOverrides = {};
    normalizedImages.forEach((image, index) => {
      const currentAlt = normalizeString(image?.effectiveAlt || image?.alt || '');
      if (currentAlt) return;
      const src = truncateText(normalizeString(image?.src || ''), 1800);
      if (!src) return;
      suggestedImageOverrides[src] = buildSeoSuggestedAltText(fileName, index + 1, effectiveSeo);
    });

    const changeCount = Object.keys(suggestedPageOverrides).length + Object.keys(suggestedImageOverrides).length;
    const pathName = getSeoPathFromFileName(fileName);

    return {
      file: fileName,
      path: pathName,
      title: normalizeString(effectiveSeo?.title || sourceSeo?.title || pathName || fileName),
      topic: buildSeoTopicLabel(fileName, effectiveSeo),
      score: Math.max(0, Math.min(100, score)),
      strengths: strengths.slice(0, 3),
      improvements: improvements.slice(0, 4),
      imageCount: totalImages,
      missingAltCount: imageAltMissing,
      pageOverrideCount: Object.keys(pageOverrides || {}).length,
      imageOverrideCount: Object.keys(suggestedImageOverrides || {}).length,
      current: effectiveSeo,
      suggestedPageOverrides,
      suggestedImageOverrides,
      changeCount,
      health: {
        titleHealthy,
        descriptionHealthy,
        h1Healthy,
        canonicalHealthy,
        robotsHealthy,
        ogTitleHealthy,
        ogDescriptionHealthy,
        twitterTitleHealthy,
        twitterDescriptionHealthy,
        altCoverage,
      },
    };
  }

  function applySeoAuditSuggestionsToConfig(configRaw, auditRaw, modelRaw) {
    const nextConfig = normalizeSeoConfig(configRaw);
    const audit = auditRaw && typeof auditRaw === 'object' ? auditRaw : {};
    const pages = Array.isArray(audit.pages) ? audit.pages : [];
    const preferredModel = normalizeSeoModelPreset(modelRaw || nextConfig.automation?.preferredModel || 'gpt-5.1');

    let appliedPageFieldCount = 0;
    let appliedImageAltCount = 0;
    const changedPages = [];

    pages.forEach((page) => {
      const fileName = sanitizeKnownHtmlFileName(page?.file);
      if (!fileName) return;

      const pagePatch = normalizeSeoStoredPageOverrides(page?.suggestedPageOverrides || {});
      const imagePatch = normalizeSeoStoredImageOverrides(page?.suggestedImageOverrides || {});
      const pageFieldCount = Object.keys(pagePatch).length;
      const imageFieldCount = Object.keys(imagePatch).length;
      if (pageFieldCount === 0 && imageFieldCount === 0) return;

      nextConfig.pages[fileName] = {
        ...(nextConfig.pages[fileName] || {}),
        ...pagePatch,
      };

      nextConfig.images[fileName] = {
        ...(nextConfig.images[fileName] || {}),
        ...imagePatch,
      };

      if (Object.keys(nextConfig.pages[fileName]).length === 0) delete nextConfig.pages[fileName];
      if (Object.keys(nextConfig.images[fileName]).length === 0) delete nextConfig.images[fileName];

      appliedPageFieldCount += pageFieldCount;
      appliedImageAltCount += imageFieldCount;

      changedPages.push({
        file: fileName,
        path: normalizeString(page?.path || getSeoPathFromFileName(fileName)),
        title: normalizeString(page?.title || page?.topic || fileName),
        topic: normalizeString(page?.topic || ''),
        scoreBefore: Math.max(0, Math.min(100, parseIntSafe(page?.score, 0))),
        appliedPageFieldCount: pageFieldCount,
        appliedImageAltCount: imageFieldCount,
        pageOverrides: pagePatch,
        imageOverrides: imagePatch,
      });
    });

    nextConfig.automation = normalizeSeoAutomationSettings({
      ...(nextConfig.automation || {}),
      preferredModel,
      updatedAt: new Date().toISOString(),
    });

    return {
      nextConfig,
      preferredModel,
      changedPages,
      appliedPageFieldCount,
      appliedImageAltCount,
    };
  }

  function escapeHtmlAttribute(valueRaw) {
    return String(valueRaw || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeHtmlText(valueRaw) {
    return String(valueRaw || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeRegex(valueRaw) {
    return String(valueRaw || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function setOrUpdateTagAttribute(tagRaw, attrNameRaw, valueRaw) {
    const tag = String(tagRaw || '');
    const attrName = normalizeString(attrNameRaw).toLowerCase();
    if (!attrName) return tag;
    const escapedValue = escapeHtmlAttribute(valueRaw);
    const attrPattern = new RegExp(`\\s${escapeRegex(attrName)}\\s*=\\s*(\"[^\"]*\"|'[^']*'|[^\\s>]+)`, 'i');

    if (attrPattern.test(tag)) {
      return tag.replace(attrPattern, ` ${attrName}="${escapedValue}"`);
    }

    if (tag.endsWith('/>')) {
      return tag.replace(/\/>$/, ` ${attrName}="${escapedValue}" />`);
    }

    return tag.replace(/>$/, ` ${attrName}="${escapedValue}">`);
  }

  function upsertTitleInHtml(htmlRaw, title) {
    const html = String(htmlRaw || '');
    const value = normalizeSeoFieldValue(title, 300);
    if (!value) return html;

    if (/<title\b[^>]*>[\s\S]*?<\/title>/i.test(html)) {
      return html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtmlText(value)}</title>`);
    }

    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `    <title>${escapeHtmlText(value)}</title>\n</head>`);
    }

    return html;
  }

  function upsertMetaInHtml(htmlRaw, selectorAttrRaw, selectorValueRaw, contentRaw) {
    const html = String(htmlRaw || '');
    const selectorAttr = normalizeString(selectorAttrRaw).toLowerCase();
    const selectorValue = normalizeString(selectorValueRaw);
    const content = normalizeString(contentRaw);

    if (!selectorAttr || !selectorValue || !content) return html;

    const tagPattern = new RegExp(
      `<meta\\b[^>]*${escapeRegex(selectorAttr)}\\s*=\\s*["']${escapeRegex(selectorValue)}["'][^>]*>`,
      'i'
    );

    if (tagPattern.test(html)) {
      return html.replace(tagPattern, (tag) => setOrUpdateTagAttribute(tag, 'content', content));
    }

    const newTag = `    <meta ${selectorAttr}="${escapeHtmlAttribute(selectorValue)}" content="${escapeHtmlAttribute(content)}">`;
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${newTag}\n</head>`);
    }
    return html;
  }

  function upsertCanonicalInHtml(htmlRaw, canonicalRaw) {
    const html = String(htmlRaw || '');
    const canonical = normalizeString(canonicalRaw);
    if (!canonical) return html;

    const tagPattern = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i;
    if (tagPattern.test(html)) {
      return html.replace(tagPattern, (tag) => setOrUpdateTagAttribute(tag, 'href', canonical));
    }

    const newTag = `    <link rel="canonical" href="${escapeHtmlAttribute(canonical)}">`;
    if (/<\/head>/i.test(html)) {
      return html.replace(/<\/head>/i, `${newTag}\n</head>`);
    }
    return html;
  }

  function upsertFirstH1InHtml(htmlRaw, h1Raw) {
    const html = String(htmlRaw || '');
    const h1 = normalizeSeoFieldValue(h1Raw, 300);
    if (!h1) return html;

    return html.replace(/<h1\b([^>]*)>[\s\S]*?<\/h1>/i, `<h1$1>${escapeHtmlText(h1)}</h1>`);
  }

  function applyImageAltOverridesToHtml(htmlRaw, imageOverridesRaw) {
    const html = String(htmlRaw || '');
    const imageOverrides = normalizeSeoStoredImageOverrides(imageOverridesRaw);
    if (Object.keys(imageOverrides).length === 0) return html;

    return html.replace(/<img\b[^>]*>/gi, (tag) => {
      const attrs = parseHtmlTagAttributes(tag);
      const src = truncateText(normalizeString(attrs.src || attrs['data-src'] || ''), 1800);
      if (!src) return tag;
      const alt = imageOverrides[src];
      if (!alt) return tag;
      return setOrUpdateTagAttribute(tag, 'alt', alt);
    });
  }

  function applySeoOverridesToHtml(fileNameRaw, htmlRaw, configRaw) {
    const fileName = sanitizeKnownHtmlFileName(fileNameRaw);
    const html = String(htmlRaw || '');
    if (!fileName || !html) return html;

    const config = normalizeSeoConfig(configRaw || {});
    const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
    const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});

    let nextHtml = html;
    if (pageOverrides.title) nextHtml = upsertTitleInHtml(nextHtml, pageOverrides.title);
    if (pageOverrides.metaDescription) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'description', pageOverrides.metaDescription);
    }
    if (pageOverrides.metaKeywords) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'keywords', pageOverrides.metaKeywords);
    }
    if (pageOverrides.canonical) nextHtml = upsertCanonicalInHtml(nextHtml, pageOverrides.canonical);
    if (pageOverrides.robots) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'robots', pageOverrides.robots);
    }
    if (pageOverrides.ogTitle) {
      nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:title', pageOverrides.ogTitle);
    }
    if (pageOverrides.ogDescription) {
      nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:description', pageOverrides.ogDescription);
    }
    if (pageOverrides.ogImage) {
      nextHtml = upsertMetaInHtml(nextHtml, 'property', 'og:image', pageOverrides.ogImage);
    }
    if (pageOverrides.twitterTitle) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:title', pageOverrides.twitterTitle);
    }
    if (pageOverrides.twitterDescription) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:description', pageOverrides.twitterDescription);
    }
    if (pageOverrides.twitterImage) {
      nextHtml = upsertMetaInHtml(nextHtml, 'name', 'twitter:image', pageOverrides.twitterImage);
    }
    if (pageOverrides.h1) {
      nextHtml = upsertFirstH1InHtml(nextHtml, pageOverrides.h1);
    }
    if (Object.keys(imageOverrides).length > 0) {
      nextHtml = applyImageAltOverridesToHtml(nextHtml, imageOverrides);
    }
    return nextHtml;
  }

  return {
    applySeoAuditSuggestionsToConfig,
    applySeoOverridesToHtml,
    buildSeoPageAuditEntry,
    extractImageEntriesFromHtml,
    extractSeoSourceFromHtml,
    extractWebsitePreviewScanFromHtml,
    getDefaultSeoAutomationSettings,
    getDefaultSeoConfig,
    getSeoEditableHtmlFiles,
    getSeoModelPresetOptions,
    mergeSeoSourceWithOverrides,
    normalizeSeoAutomationSettings,
    normalizeSeoBlogCadence,
    normalizeSeoConfig,
    normalizeSeoFieldValue,
    normalizeSeoImageOverridePatch,
    normalizeSeoModelPreset,
    normalizeSeoPageOverridePatch,
    normalizeSeoStoredImageOverrides,
    normalizeSeoStoredPageOverrides,
    sanitizeKnownHtmlFileName,
  };
}

module.exports = {
  createSeoCore,
};
