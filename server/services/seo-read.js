const {
  buildSearchConsoleAgentReport: defaultBuildSearchConsoleAgentReport,
  createSearchConsoleClient: defaultCreateSearchConsoleClient,
  fetchSearchConsoleSnapshot: defaultFetchSearchConsoleSnapshot,
  getMissingSearchConsoleConfig: defaultGetMissingSearchConsoleConfig,
  getSearchConsoleConfigFromEnv: defaultGetSearchConsoleConfigFromEnv,
  resolveDateWindows: defaultResolveDateWindows,
} = require('../../scripts/lib/search-console-agent-report');

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundNumber(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(toFiniteNumber(value) * factor) / factor;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function resolvePerformanceDays(value) {
  const raw = normalizeString(value);
  if (raw === '7' || raw === '28' || raw === '90') return Number(raw);
  return 90;
}

function compactSearchConsoleRow(row = {}, labelKey = 'label') {
  const keys = Array.isArray(row.keys) ? row.keys : [];
  const label = normalizeString(row[labelKey] || row.query || row.page || keys[0]);
  return {
    label,
    clicks: roundNumber(row.clicks, 2),
    impressions: roundNumber(row.impressions, 2),
    ctr: roundNumber(row.ctr, 4),
    position: roundNumber(row.position, 2),
    clicksDelta: roundNumber(row.clicksDelta, 2),
    impressionsDelta: roundNumber(row.impressionsDelta, 2),
  };
}

function compactDateRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => compactSearchConsoleRow(row))
    .filter((row) => row.label)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildEmptySearchConsolePerformancePayload(extra = {}) {
  return {
    ok: true,
    connected: false,
    status: 'needs_connection',
    generatedAt: new Date().toISOString(),
    siteUrl: '',
    dateWindows: null,
    totals: {
      current: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      previous: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      clicksDelta: 0,
      impressionsDelta: 0,
      ctrDelta: 0,
      positionDelta: 0,
    },
    rows: {
      queries: [],
      pages: [],
      dates: [],
      countries: [],
      devices: [],
      searchAppearance: [],
    },
    sitemaps: [],
    actionQueue: [],
    ...extra,
  };
}

function createSeoReadCoordinator(deps = {}) {
  const {
    logger = console,
    getSeoConfigCached = async () => ({}),
    normalizeSeoConfig = (value) => value || {},
    getSeoEditableHtmlFiles = () => [],
    readHtmlPageContent = async () => '',
    extractSeoSourceFromHtml = () => ({}),
    normalizeSeoStoredPageOverrides = () => ({}),
    normalizeSeoStoredImageOverrides = () => ({}),
    mergeSeoSourceWithOverrides = (source) => source,
    extractImageEntriesFromHtml = () => [],
    normalizeString = (value) => String(value || '').trim(),
    resolveSeoPageFileFromRequest = () => '',
    buildSeoPageAuditEntry = () => ({}),
    getSeoModelPresetOptions = () => [],
    normalizeSeoAutomationSettings = (value) => value || {},
    buildSearchConsoleAgentReport = defaultBuildSearchConsoleAgentReport,
    createSearchConsoleClient = defaultCreateSearchConsoleClient,
    fetchSearchConsoleSnapshot = defaultFetchSearchConsoleSnapshot,
    getMissingSearchConsoleConfig = defaultGetMissingSearchConsoleConfig,
    getSearchConsoleConfigFromEnv = defaultGetSearchConsoleConfigFromEnv,
    resolveDateWindows = defaultResolveDateWindows,
  } = deps;

  async function buildSeoSiteAudit(configRaw = null) {
    const config = normalizeSeoConfig(configRaw || (await getSeoConfigCached()));
    const pages = [];
    const files = getSeoEditableHtmlFiles();

    for (const fileName of files) {
      const html = await readHtmlPageContent(fileName);
      if (!html) continue;
      const sourceSeo = extractSeoSourceFromHtml(html);
      const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
      const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
      const effectiveSeo = mergeSeoSourceWithOverrides(sourceSeo, pageOverrides);
      const images = extractImageEntriesFromHtml(html).map((entry) => ({
        ...entry,
        effectiveAlt: normalizeString(imageOverrides[entry.src] || entry.alt || ''),
      }));
      pages.push(buildSeoPageAuditEntry(fileName, sourceSeo, pageOverrides, effectiveSeo, images));
    }

    const sortedPages = pages.slice().sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
    const pageCount = sortedPages.length;
    const totalImages = sortedPages.reduce((sum, page) => sum + Number(page.imageCount || 0), 0);
    const totalMissingAltImages = sortedPages.reduce((sum, page) => sum + Number(page.missingAltCount || 0), 0);
    const titleHealthyCount = sortedPages.filter((page) => page.health.titleHealthy).length;
    const descriptionHealthyCount = sortedPages.filter((page) => page.health.descriptionHealthy).length;
    const canonicalHealthyCount = sortedPages.filter((page) => page.health.canonicalHealthy).length;
    const socialHealthyCount = sortedPages.filter(
      (page) =>
        page.health.ogTitleHealthy &&
        page.health.ogDescriptionHealthy &&
        page.health.twitterTitleHealthy &&
        page.health.twitterDescriptionHealthy
    ).length;
    const pagesNeedingAttention = sortedPages.filter((page) => page.score < 80).length;
    const overallScore =
      pageCount > 0
        ? Math.round(sortedPages.reduce((sum, page) => sum + Number(page.score || 0), 0) / pageCount)
        : 0;

    const metrics = [
      {
        key: 'titles',
        label: 'Meta titles',
        count: titleHealthyCount,
        total: pageCount,
        percent: pageCount > 0 ? Math.round((titleHealthyCount / pageCount) * 100) : 0,
      },
      {
        key: 'descriptions',
        label: 'Descriptions',
        count: descriptionHealthyCount,
        total: pageCount,
        percent: pageCount > 0 ? Math.round((descriptionHealthyCount / pageCount) * 100) : 0,
      },
      {
        key: 'canonicals',
        label: 'Canonicals',
        count: canonicalHealthyCount,
        total: pageCount,
        percent: pageCount > 0 ? Math.round((canonicalHealthyCount / pageCount) * 100) : 0,
      },
      {
        key: 'social',
        label: 'Social tags',
        count: socialHealthyCount,
        total: pageCount,
        percent: pageCount > 0 ? Math.round((socialHealthyCount / pageCount) * 100) : 0,
      },
      {
        key: 'image_alt',
        label: 'Afbeelding alt',
        count: totalImages - totalMissingAltImages,
        total: totalImages,
        percent: totalImages > 0 ? Math.round(((totalImages - totalMissingAltImages) / totalImages) * 100) : 100,
      },
    ];

    const strengths = [];
    const improvements = [];
    if (metrics[0].percent >= 80) strengths.push('De meeste pagina\'s hebben al een sterke meta title.');
    else improvements.push('Een deel van de pagina\'s kan een scherpere meta title gebruiken.');
    if (metrics[1].percent >= 75) strengths.push('Veel meta descriptions zijn al goed bruikbaar.');
    else improvements.push('Meerdere meta descriptions missen of zijn nog te generiek.');
    if (metrics[2].percent >= 80) strengths.push('Canonical URL\'s zijn op veel pagina\'s al netjes afgedekt.');
    else improvements.push('Canonical URL\'s mogen consistenter naar de live pagina wijzen.');
    if (metrics[4].percent >= 85) strengths.push('Afbeeldingen hebben op veel plekken al een goede alt-tekst.');
    else improvements.push('Er ontbreken nog alt-teksten op een deel van de afbeeldingen.');
    if (pagesNeedingAttention === 0 && pageCount > 0) strengths.push('Geen directe rode vlaggen in de huidige SEO-basis.');
    if (pagesNeedingAttention > 0) {
      improvements.push(
        `${pagesNeedingAttention} pagina${pagesNeedingAttention === 1 ? '' : '\'s'} vragen nog om extra aandacht.`
      );
    }

    return {
      ok: true,
      auditedAt: new Date().toISOString(),
      overallScore,
      totals: {
        pages: pageCount,
        pagesNeedingAttention,
        images: totalImages,
        missingAltImages: totalMissingAltImages,
      },
      metrics,
      strengths: strengths.slice(0, 4),
      improvements: improvements.slice(0, 5),
      pages: sortedPages,
      modelOptions: getSeoModelPresetOptions(),
      automation: normalizeSeoAutomationSettings(config.automation),
    };
  }

  async function listSeoPagesResponse(req, res) {
    const files = getSeoEditableHtmlFiles();
    const query = normalizeString(req.query.q || '').toLowerCase();

    try {
      const config = await getSeoConfigCached();
      const pages = [];

      for (const fileName of files) {
        const html = await readHtmlPageContent(fileName);
        if (!html) continue;
        const source = extractSeoSourceFromHtml(html);
        const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
        const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
        const effective = mergeSeoSourceWithOverrides(source, pageOverrides);
        const images = extractImageEntriesFromHtml(html);
        const slug = String(fileName).replace(/\.html$/i, '');
        const pathName = slug === 'index' ? '/' : `/${slug}`;
        const searchIndex = `${fileName} ${pathName} ${effective.title || ''}`.toLowerCase();

        if (query && !searchIndex.includes(query)) continue;

        pages.push({
          file: fileName,
          slug,
          path: pathName,
          title: effective.title || source.title || slug,
          metaDescription: effective.metaDescription || source.metaDescription || '',
          imageCount: images.length,
          pageOverrideCount: Object.keys(pageOverrides).length,
          imageOverrideCount: Object.keys(imageOverrides).length,
        });
      }

      return res.status(200).json({
        ok: true,
        count: pages.length,
        pages,
      });
    } catch (error) {
      logger.error('[SEO][PagesError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Kon SEO pagina-overzicht niet ophalen.',
      });
    }
  }

  async function getSeoPageResponse(req, res) {
    const fileName = resolveSeoPageFileFromRequest(req.query.file, req.query.slug);
    if (!fileName) {
      return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
    }

    const html = await readHtmlPageContent(fileName);
    if (!html) {
      return res.status(404).json({ ok: false, error: 'Pagina niet gevonden of onleesbaar.' });
    }

    try {
      const config = await getSeoConfigCached();
      const source = extractSeoSourceFromHtml(html);
      const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
      const effective = mergeSeoSourceWithOverrides(source, pageOverrides);
      const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
      const images = extractImageEntriesFromHtml(html).map((entry) => {
        const overrideAlt = normalizeString(imageOverrides[entry.src] || '');
        return {
          src: entry.src,
          sourceAlt: entry.alt || '',
          overrideAlt,
          effectiveAlt: overrideAlt || entry.alt || '',
        };
      });

      return res.status(200).json({
        ok: true,
        file: fileName,
        slug: String(fileName).replace(/\.html$/i, ''),
        seo: {
          source,
          overrides: pageOverrides,
          effective,
        },
        imageCount: images.length,
        images,
      });
    } catch (error) {
      logger.error('[SEO][PageError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Kon SEO data voor deze pagina niet ophalen.',
      });
    }
  }

  async function getSeoSiteAuditResponse(_req, res) {
    try {
      const audit = await buildSeoSiteAudit();
      return res.status(200).json(audit);
    } catch (error) {
      logger.error('[SEO][SiteAuditError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Kon de volledige SEO-scan niet uitvoeren.',
      });
    }
  }

  async function getSearchConsolePerformanceResponse(req, res) {
    const days = resolvePerformanceDays(req.query?.days);
    const config = getSearchConsoleConfigFromEnv(process.env);
    const missing = getMissingSearchConsoleConfig(config);
    const siteUrl = normalizeString(config.siteUrl || 'sc-domain:softora.nl');

    if (missing.length > 0) {
      return res.status(200).json(
        buildEmptySearchConsolePerformancePayload({
          siteUrl,
          missingSearchConsoleConfig: missing,
          message: `Search Console-koppeling mist nog: ${missing.join(', ')}.`,
          actionQueue: [
            {
              priority: 'hoog',
              type: 'connect_gsc',
              action: 'Rond de Search Console OAuth-koppeling af zodat dit scherm echte klikken, vertoningen, CTR en posities kan tonen.',
            },
          ],
        })
      );
    }

    try {
      const client = createSearchConsoleClient({ config });
      if (typeof client.resolveAccessToken === 'function') {
        await client.resolveAccessToken();
      }
      const now = new Date();
      const dateWindows = resolveDateWindows({ days, now });
      const [snapshot, datesCurrent, countriesCurrent, devicesCurrent, searchAppearanceCurrent] = await Promise.all([
        fetchSearchConsoleSnapshot({ client, config, siteUrl, days, now }),
        client.querySearchAnalytics({
          siteUrl,
          ...dateWindows.current,
          dimensions: ['date'],
          rowLimit: 500,
        }),
        client.querySearchAnalytics({
          siteUrl,
          ...dateWindows.current,
          dimensions: ['country'],
          rowLimit: 100,
        }),
        client.querySearchAnalytics({
          siteUrl,
          ...dateWindows.current,
          dimensions: ['device'],
          rowLimit: 25,
        }),
        client.querySearchAnalytics({
          siteUrl,
          ...dateWindows.current,
          dimensions: ['searchAppearance'],
          rowLimit: 100,
        }),
      ]);
      const report = buildSearchConsoleAgentReport(snapshot);

      return res.status(200).json({
        ok: true,
        connected: true,
        status: 'ready',
        generatedAt: report.generatedAt || new Date().toISOString(),
        siteUrl: report.siteUrl || siteUrl,
        dateWindows: report.dateWindows || dateWindows,
        totals: report.totals,
        rows: {
          queries: (report.queries?.top || []).slice(0, 25).map((row) => compactSearchConsoleRow(row)),
          pages: (report.pages?.top || []).slice(0, 25).map((row) => compactSearchConsoleRow(row)),
          dates: compactDateRows(datesCurrent),
          countries: (countriesCurrent || []).slice(0, 25).map((row) => compactSearchConsoleRow(row)),
          devices: (devicesCurrent || []).slice(0, 25).map((row) => compactSearchConsoleRow(row)),
          searchAppearance: (searchAppearanceCurrent || []).slice(0, 25).map((row) =>
            compactSearchConsoleRow(row)
          ),
        },
        sitemaps: report.sitemaps || [],
        actionQueue: (report.actionQueue || []).slice(0, 15),
      });
    } catch (error) {
      logger.error('[SEO][SearchConsolePerformanceError]', error?.message || error);
      return res.status(502).json({
        ...buildEmptySearchConsolePerformancePayload({
          connected: true,
          status: 'error',
          siteUrl,
          message: 'Search Console-data kon nu niet worden opgehaald.',
        }),
        ok: false,
        error: 'Kon Search Console-prestaties niet ophalen.',
      });
    }
  }

  return {
    buildSeoSiteAudit,
    getSearchConsolePerformanceResponse,
    getSeoPageResponse,
    getSeoSiteAuditResponse,
    listSeoPagesResponse,
  };
}

module.exports = {
  createSeoReadCoordinator,
};
