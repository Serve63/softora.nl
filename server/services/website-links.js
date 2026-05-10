function createWebsiteLinkCoordinator(deps = {}) {
  const {
    logger = console,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    slugifyAutomationText = (value, fallback = 'pagina') => String(value || '').trim() || fallback,
    isSupabaseConfigured = () => false,
    fetchSupabaseRowsByStateKeyPrefixViaRest = async () => ({ ok: false, body: null }),
    fetchSupabaseRowByKeyViaRest = async () => ({ ok: false, body: null }),
    upsertSupabaseRowViaRest = async () => ({ ok: false, body: null }),
    websiteLinkStateKeyPrefix = 'website_link:',
    knownPrettyPageSlugToFile = new Map(),
    resolveLegacyPrettyPageRedirect = () => '',
    getPublicBaseUrlFromRequest = () => '',
    appendDashboardActivity = () => {},
  } = deps;

  const supabasePageSize = 500;
  const autoWebsiteLinkSlugBase = 'voorbeelddesign';

  const reservedExactSlugs = new Set([
    'api',
    'assets',
    'healthz',
    'index',
    'robots',
    'manifest',
    'sitemap',
    'favicon',
  ]);

  function normalizeWebsiteLinkSlug(value) {
    const normalized = slugifyAutomationText(value || '', '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    if (!normalized) return '';
    if (!/^[a-z0-9-]{2,80}$/.test(normalized)) return '';
    return normalized;
  }

  function buildWebsiteLinkStateKey(slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug) return '';
    return `${websiteLinkStateKeyPrefix}${slug}`;
  }

  function extractSlugFromWebsiteLinkStateKey(rowKey) {
    const key = normalizeString(rowKey || '');
    const prefix = normalizeString(websiteLinkStateKeyPrefix || '');
    if (!key || !prefix || !key.startsWith(prefix)) return '';
    return normalizeWebsiteLinkSlug(key.slice(prefix.length));
  }

  function resolveWebsiteLinkSlugFromRow(row) {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    return normalizeWebsiteLinkSlug(payload.slug || extractSlugFromWebsiteLinkStateKey(row?.state_key || ''));
  }

  function getAutoWebsiteLinkNumber(slugRaw) {
    const match = normalizeWebsiteLinkSlug(slugRaw).match(/^voorbeelddesign(\d+)$/);
    return match ? Number(match[1]) || 0 : 0;
  }

  function formatWebsiteLinkTitleFromSlug(slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    const number = getAutoWebsiteLinkNumber(slug);
    return number ? `Voorbeelddesign ${number}` : `Softora pagina ${slug}`;
  }

  function isReservedWebsiteLinkSlug(slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug) return true;
    if (reservedExactSlugs.has(slug)) return true;
    if (slug.startsWith('premium-')) return true;
    if (slug.startsWith('personeel-')) return true;
    if (knownPrettyPageSlugToFile.has(slug)) return true;
    if (normalizeString(resolveLegacyPrettyPageRedirect(slug))) return true;
    return false;
  }

  function stripHtmlTags(value) {
    return String(value || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractTitleFromHtml(html) {
    const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    return truncateText(stripHtmlTags(match?.[1] || ''), 160);
  }

  function extractFirstHeadingFromHtml(html) {
    const match = String(html || '').match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
    return truncateText(stripHtmlTags(match?.[1] || ''), 160);
  }

  function buildSafeHtmlDocument(rawHtml, options = {}) {
    const slug = normalizeWebsiteLinkSlug(options.slug || '');
    const explicitTitle = truncateText(normalizeString(options.title || ''), 160);
    let html = String(rawHtml || '').trim();

    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
    html = html.replace(/<object\b[\s\S]*?<\/object>/gi, '');
    html = html.replace(/<embed\b[^>]*>/gi, '');
    html = html.replace(/<base\b[^>]*>/gi, '');
    html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1[^>]*>/gi, '');
    html = html.replace(/\s(on[a-z]+)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    html = html.replace(
      /\s(href|src)\s*=\s*(['"])\s*(?:javascript:|data:text\/html)[\s\S]*?\2/gi,
      ' $1="#"'
    );

    const inferredTitle =
      explicitTitle ||
      extractTitleFromHtml(html) ||
      extractFirstHeadingFromHtml(html) ||
      (slug ? `Softora pagina ${slug}` : 'Softora pagina');

    const hasHtmlTag = /<html\b/i.test(html);
    if (!hasHtmlTag) {
      html = [
        '<!DOCTYPE html>',
        '<html lang="nl">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        `  <title>${inferredTitle}</title>`,
        '  <meta name="robots" content="noindex,nofollow,noarchive">',
        '</head>',
        '<body>',
        html,
        '</body>',
        '</html>',
      ].join('\n');
    }

    if (/<html\b/i.test(html) && !/<head\b/i.test(html)) {
      html = html.replace(/<html\b([^>]*)>/i, '<html$1>\n<head>\n</head>');
    }

    if (!/<meta\b[^>]*charset=/i.test(html)) {
      html = html.replace(/<head\b[^>]*>/i, '$&\n<meta charset="UTF-8">');
    }
    if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) {
      html = html.replace(
        /<head\b[^>]*>/i,
        '$&\n<meta name="viewport" content="width=device-width, initial-scale=1.0">'
      );
    }
    if (!/<meta\b[^>]*name=["']robots["']/i.test(html)) {
      html = html.replace(
        /<head\b[^>]*>/i,
        '$&\n<meta name="robots" content="noindex,nofollow,noarchive">'
      );
    }
    if (!/<title\b/i.test(html)) {
      html = html.replace(/<head\b[^>]*>/i, `$&\n<title>${inferredTitle}</title>`);
    }

    return {
      html,
      title: inferredTitle,
    };
  }

  async function fetchStoredWebsiteLinkRow(slugRaw) {
    const rowKey = buildWebsiteLinkStateKey(slugRaw);
    if (!rowKey || !isSupabaseConfigured()) return null;

    const result = await fetchSupabaseRowByKeyViaRest(rowKey, 'payload,updated_at');
    if (!result.ok) return null;

    const row = Array.isArray(result.body) ? result.body[0] || null : result.body;
    if (!row || typeof row !== 'object') return null;
    return row;
  }

  async function getPublishedWebsiteLinkBySlug(slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug) return null;

    const row = await fetchStoredWebsiteLinkRow(slug);
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object') return null;

    const html = String(payload.html || '').trim();
    if (!html) return null;

    return {
      slug,
      title: truncateText(normalizeString(payload.title || ''), 160) || `Softora pagina ${slug}`,
      html,
      createdAt: normalizeString(payload.createdAt || row?.updated_at || ''),
      updatedAt: normalizeString(payload.updatedAt || row?.updated_at || ''),
    };
  }

  function mapWebsiteLinkRowToClient(row) {
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    const slug = resolveWebsiteLinkSlugFromRow(row);
    if (!slug) return null;
    return {
      slug,
      title: truncateText(normalizeString(payload.title || ''), 160) || formatWebsiteLinkTitleFromSlug(slug),
      url: '',
      createdAt: normalizeString(payload.createdAt || row?.updated_at || ''),
      updatedAt: normalizeString(payload.updatedAt || row?.updated_at || ''),
    };
  }

  async function fetchWebsiteLinkRows(selectColumns = 'state_key,updated_at') {
    const rows = [];
    let offset = 0;

    while (true) {
      const result = await fetchSupabaseRowsByStateKeyPrefixViaRest(
        websiteLinkStateKeyPrefix,
        supabasePageSize,
        selectColumns,
        offset
      );
      if (!result.ok) return result;

      const pageRows = Array.isArray(result.body) ? result.body : [];
      rows.push(...pageRows);
      if (pageRows.length < supabasePageSize) return { ok: true, body: rows };
      offset += supabasePageSize;
    }
  }

  async function fetchWebsiteLinkRowsWithFallback() {
    const lightweightResult = await fetchWebsiteLinkRows('state_key,updated_at');
    if (lightweightResult.ok) return lightweightResult;

    logger.error(
      '[WebsiteLinks][ListRetryWithPayload]',
      lightweightResult.error || lightweightResult.status || lightweightResult.body
    );

    return fetchWebsiteLinkRows('state_key,payload,updated_at');
  }

  async function fetchExistingWebsiteLinkSlugs() {
    const result = await fetchWebsiteLinkRows('state_key');
    if (!result.ok) return result;
    return {
      ok: true,
      slugs: new Set((Array.isArray(result.body) ? result.body : [])
        .map(resolveWebsiteLinkSlugFromRow)
        .filter(Boolean)),
    };
  }

  function compareWebsiteLinkRows(a, b) {
    const aNumber = getAutoWebsiteLinkNumber(a.slug);
    const bNumber = getAutoWebsiteLinkNumber(b.slug);
    if (aNumber && bNumber && aNumber !== bNumber) return aNumber - bNumber;
    if (aNumber && !bNumber) return -1;
    if (!aNumber && bNumber) return 1;
    return String(a.slug || '').localeCompare(String(b.slug || ''), 'nl');
  }

  async function listWebsiteLinksResponse(req, res) {
    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Websitelinks laden is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      });
    }

    try {
      const result = await fetchWebsiteLinkRowsWithFallback();
      if (!result.ok) {
        logger.error('[WebsiteLinks][ListError]', result.error || result.status || result.body);
        return res.status(200).json({ ok: true, links: [] });
      }

      const links = (Array.isArray(result.body) ? result.body : [])
        .map(mapWebsiteLinkRowToClient)
        .filter(Boolean)
        .map((link) => ({ ...link, url: buildPublishedWebsiteLinkUrl(req, link.slug) }))
        .sort(compareWebsiteLinkRows);

      return res.status(200).json({ ok: true, links });
    } catch (error) {
      logger.error('[WebsiteLinks][ListCrash]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Websitelinks laden mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  async function isWebsiteLinkSlugAvailable(slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug) return false;
    if (isReservedWebsiteLinkSlug(slug)) return false;
    const existingRow = await fetchStoredWebsiteLinkRow(slug);
    return !existingRow;
  }

  async function resolveNextWebsiteLinkSlug(requestedSlugRaw, rawHtml, explicitTitle = '') {
    const requestedSlug = normalizeWebsiteLinkSlug(requestedSlugRaw);
    if (requestedSlugRaw && !requestedSlug) {
      return {
        ok: false,
        status: 400,
        error: 'Ongeldige websitelink',
        detail: 'Gebruik alleen letters, cijfers en koppeltekens voor de link.',
      };
    }

    if (requestedSlug) {
      if (isReservedWebsiteLinkSlug(requestedSlug)) {
        return {
          ok: false,
          status: 400,
          error: 'Deze websitelink is gereserveerd',
          detail: 'Kies een ander pad op je domein.',
        };
      }
      if (!(await isWebsiteLinkSlugAvailable(requestedSlug))) {
        return {
          ok: false,
          status: 409,
          error: 'Deze websitelink bestaat al',
          detail: 'Kies een andere slug of laat hem automatisch genereren.',
        };
      }
      return { ok: true, slug: requestedSlug, autoGenerated: false };
    }

    const existingResult = await fetchExistingWebsiteLinkSlugs();
    if (existingResult.ok) {
      const existingSlugs = existingResult.slugs;
      let highestNumber = 0;
      existingSlugs.forEach((slug) => {
        highestNumber = Math.max(highestNumber, getAutoWebsiteLinkNumber(slug));
      });

      const startIndex = Math.max(1, highestNumber + 1);
      for (let index = startIndex; index < startIndex + 500; index += 1) {
        const candidate = `${autoWebsiteLinkSlugBase}${index}`;
        if (!existingSlugs.has(candidate) && (await isWebsiteLinkSlugAvailable(candidate))) {
          return { ok: true, slug: candidate, autoGenerated: true };
        }
      }
    } else {
      logger.error('[WebsiteLinks][SlugListError]', existingResult.error || existingResult.status || existingResult.body);
    }

    for (let index = 1; index <= 500; index += 1) {
      const candidate = `${autoWebsiteLinkSlugBase}${index}`;
      if (await isWebsiteLinkSlugAvailable(candidate)) {
        return { ok: true, slug: candidate, autoGenerated: true };
      }
    }

    return {
      ok: false,
      status: 500,
      error: 'Kon geen unieke websitelink genereren',
      detail: 'Probeer een eigen slug in te vullen.',
    };
  }

  function buildPublishedWebsiteLinkUrl(req, slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug) return '';
    const baseUrl =
      normalizeString(getPublicBaseUrlFromRequest(req) || '') || 'https://www.softora.nl';
    return `${baseUrl.replace(/\/+$/, '')}/${slug}`;
  }

  async function saveWebsiteLinkResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const htmlRaw = String(body.html || body.htmlCode || body.code || '').trim();
    const explicitTitle = truncateText(normalizeString(body.title || ''), 160);

    if (!htmlRaw) {
      return res.status(400).json({
        ok: false,
        error: 'HTML code ontbreekt',
        detail: 'Plak eerst de HTML-code van de pagina die je wilt publiceren.',
      });
    }

    if (htmlRaw.length > 250_000) {
      return res.status(400).json({
        ok: false,
        error: 'HTML code is te groot',
        detail: 'Hou de HTML onder 250.000 tekens.',
      });
    }

    if (!isSupabaseConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Websitelinks opslaan is niet beschikbaar',
        detail: 'Supabase is niet geconfigureerd voor deze omgeving.',
      });
    }

    try {
      const slugResolution = await resolveNextWebsiteLinkSlug(
        body.slug || body.path || body.linkPath || '',
        htmlRaw,
        explicitTitle
      );
      if (!slugResolution.ok) {
        return res.status(Number(slugResolution.status) || 400).json({
          ok: false,
          error: slugResolution.error,
          detail: slugResolution.detail || '',
        });
      }

      const published = buildSafeHtmlDocument(htmlRaw, {
        slug: slugResolution.slug,
        title: explicitTitle,
      });
      const now = new Date().toISOString();
      const row = {
        state_key: buildWebsiteLinkStateKey(slugResolution.slug),
        payload: {
          slug: slugResolution.slug,
          title: published.title,
          html: published.html,
          createdAt: now,
          updatedAt: now,
          source: 'premium-websitegenerator',
        },
        meta: {
          type: 'website_link',
          source: 'premium-websitegenerator',
          actor: normalizeString(req?.premiumAuth?.displayName || req?.premiumAuth?.email || 'dashboard'),
        },
        updated_at: now,
      };

      const saveResult = await upsertSupabaseRowViaRest(row);
      if (!saveResult.ok) {
        logger.error('[WebsiteLinks][SaveError]', saveResult.error || saveResult.status || saveResult.body);
        return res.status(500).json({
          ok: false,
          error: 'Websitelink opslaan mislukt',
          detail: 'De pagina kon niet in Supabase worden opgeslagen.',
        });
      }

      const publicUrl = buildPublishedWebsiteLinkUrl(req, slugResolution.slug);
      appendDashboardActivity(
        {
          type: 'website_link_created',
          title: 'Websitelink aangemaakt',
          detail: `${slugResolution.slug} gepubliceerd vanuit geplakte HTML-code.`,
          source: 'premium-websitegenerator',
          actor: normalizeString(req?.premiumAuth?.displayName || req?.premiumAuth?.email || 'dashboard'),
        },
        'dashboard_activity_website_link_created'
      );

      return res.status(200).json({
        ok: true,
        slug: slugResolution.slug,
        title: published.title,
        url: publicUrl,
        autoGeneratedSlug: Boolean(slugResolution.autoGenerated),
        publishedAt: now,
      });
    } catch (error) {
      logger.error('[WebsiteLinks][CreateCrash]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Websitelink aanmaken mislukt',
        detail: String(error?.message || 'Onbekende fout'),
      });
    }
  }

  async function sendPublishedWebsiteLinkResponse(req, res, slugRaw) {
    const slug = normalizeWebsiteLinkSlug(slugRaw);
    if (!slug || isReservedWebsiteLinkSlug(slug)) return false;

    const page = await getPublishedWebsiteLinkBySlug(slug);
    if (!page) return false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self' https: data: blob:",
        "script-src 'none'",
        "connect-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
        "style-src 'unsafe-inline' https:",
        "img-src https: data: blob:",
        "font-src https: data:",
        "media-src https: data: blob:",
      ].join('; ')
    );

    res.status(200).send(page.html);
    return true;
  }

  return {
    buildSafeHtmlDocument,
    buildWebsiteLinkStateKey,
    getPublishedWebsiteLinkBySlug,
    listWebsiteLinksResponse,
    normalizeWebsiteLinkSlug,
    saveWebsiteLinkResponse,
    sendPublishedWebsiteLinkResponse,
  };
}

module.exports = {
  createWebsiteLinkCoordinator,
};
