'use strict';

/**
 * routes/seo.js — SEO beheer: pagina-overzicht, meta-overrides, site audit, automatisering.
 */

module.exports = function registerSeoRoutes(app, ctx) {
  const {
    normalizeString,
    getSeoEditableHtmlFiles, getSeoConfigCached, persistSeoConfig,
    readHtmlPageContent, extractSeoSourceFromHtml,
    normalizeSeoStoredPageOverrides, normalizeSeoStoredImageOverrides,
    mergeSeoSourceWithOverrides, extractImageEntriesFromHtml,
    resolveSeoPageFileFromRequest, normalizeSeoPageOverridePatch, normalizeSeoImageOverridePatch,
    normalizeSeoConfig, buildSeoSiteAudit, applySeoAuditSuggestionsToConfig,
    normalizeSeoModelPreset, normalizeSeoAutomationSettings, getSeoModelPresetOptions,
    appendDashboardActivity, SEO_PAGE_FIELD_DEFS,
  } = ctx;

  // --- GET /api/seo/pages ---
  app.get('/api/seo/pages', async (req, res) => {
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
        pages.push({ file: fileName, slug, path: pathName, title: effective.title || source.title || slug, metaDescription: effective.metaDescription || source.metaDescription || '', imageCount: images.length, pageOverrideCount: Object.keys(pageOverrides).length, imageOverrideCount: Object.keys(imageOverrides).length });
      }
      return res.status(200).json({ ok: true, count: pages.length, pages });
    } catch (error) {
      console.error('[SEO][PagesError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Kon SEO pagina-overzicht niet ophalen.' });
    }
  });

  // --- GET /api/seo/page ---
  app.get('/api/seo/page', async (req, res) => {
    const fileName = resolveSeoPageFileFromRequest(req.query.file, req.query.slug);
    if (!fileName) return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
    const html = await readHtmlPageContent(fileName);
    if (!html) return res.status(404).json({ ok: false, error: 'Pagina niet gevonden of onleesbaar.' });
    try {
      const config = await getSeoConfigCached();
      const source = extractSeoSourceFromHtml(html);
      const pageOverrides = normalizeSeoStoredPageOverrides(config.pages[fileName] || {});
      const effective = mergeSeoSourceWithOverrides(source, pageOverrides);
      const imageOverrides = normalizeSeoStoredImageOverrides(config.images[fileName] || {});
      const images = extractImageEntriesFromHtml(html).map((entry) => {
        const overrideAlt = normalizeString(imageOverrides[entry.src] || '');
        return { src: entry.src, sourceAlt: entry.alt || '', overrideAlt, effectiveAlt: overrideAlt || entry.alt || '' };
      });
      return res.status(200).json({ ok: true, file: fileName, slug: String(fileName).replace(/\.html$/i, ''), seo: { source, overrides: pageOverrides, effective }, imageCount: images.length, images });
    } catch (error) {
      console.error('[SEO][PageError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Kon SEO data voor deze pagina niet ophalen.' });
    }
  });

  // --- POST /api/seo/page ---
  app.post('/api/seo/page', async (req, res) => {
    const fileName = resolveSeoPageFileFromRequest(req.body?.file, req.body?.slug);
    if (!fileName) return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
    const pageOverridePatch = normalizeSeoPageOverridePatch(req.body?.pageOverrides || req.body?.page || {});
    const imageOverridePatch = normalizeSeoImageOverridePatch(req.body?.imageAltOverrides || req.body?.imageOverrides || req.body?.images || {});
    try {
      const currentConfig = await getSeoConfigCached(true);
      const nextConfig = normalizeSeoConfig(currentConfig);
      const nextPageOverrides = { ...(nextConfig.pages[fileName] || {}) };
      for (const field of SEO_PAGE_FIELD_DEFS) {
        if (!Object.prototype.hasOwnProperty.call(pageOverridePatch, field.key)) continue;
        const value = normalizeString(pageOverridePatch[field.key]);
        if (!value) { delete nextPageOverrides[field.key]; continue; }
        nextPageOverrides[field.key] = value;
      }
      if (Object.keys(nextPageOverrides).length > 0) { nextConfig.pages[fileName] = nextPageOverrides; } else { delete nextConfig.pages[fileName]; }
      const nextImageOverrides = { ...(nextConfig.images[fileName] || {}) };
      for (const [src, altRaw] of Object.entries(imageOverridePatch)) {
        const alt = normalizeString(altRaw);
        if (!alt) { delete nextImageOverrides[src]; continue; }
        nextImageOverrides[src] = alt;
      }
      if (Object.keys(nextImageOverrides).length > 0) { nextConfig.images[fileName] = nextImageOverrides; } else { delete nextConfig.images[fileName]; }
      const saved = await persistSeoConfig(nextConfig, { source: 'seo-dashboard', actor: normalizeString(req.body?.actor || 'dashboard') });
      if (!saved) return res.status(500).json({ ok: false, error: 'Kon SEO wijzigingen niet opslaan.' });
      appendDashboardActivity({ type: 'seo_page_updated', title: 'SEO-instellingen opgeslagen', detail: `SEO updates opgeslagen voor ${fileName}.`, source: 'premium-seo', actor: normalizeString(req.body?.actor || 'dashboard') }, 'dashboard_activity_seo_updated');
      return res.status(200).json({ ok: true, file: fileName, saved: { pageOverrideCount: Object.keys(saved.pages[fileName] || {}).length, imageOverrideCount: Object.keys(saved.images[fileName] || {}).length } });
    } catch (error) {
      console.error('[SEO][SaveError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'SEO wijzigingen opslaan mislukt.' });
    }
  });

  // --- GET /api/seo/site-audit ---
  app.get('/api/seo/site-audit', async (_req, res) => {
    try {
      return res.status(200).json(await buildSeoSiteAudit());
    } catch (error) {
      console.error('[SEO][SiteAuditError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Kon de volledige SEO-scan niet uitvoeren.' });
    }
  });

  // --- POST /api/seo/site-optimize ---
  app.post('/api/seo/site-optimize', async (req, res) => {
    try {
      const preferredModel = normalizeSeoModelPreset(req.body?.model || req.body?.preferredModel || 'gpt-5.1');
      const currentConfig = await getSeoConfigCached(true);
      const currentAudit = await buildSeoSiteAudit(currentConfig);
      const optimization = applySeoAuditSuggestionsToConfig(currentConfig, currentAudit, preferredModel);
      if (optimization.changedPages.length === 0) {
        let savedConfig = currentConfig;
        if (normalizeSeoModelPreset(currentConfig?.automation?.preferredModel || '') !== preferredModel) {
          const saved = await persistSeoConfig(optimization.nextConfig, { source: 'seo-dashboard', actor: normalizeString(req.body?.actor || 'site-optimize') });
          if (saved) savedConfig = saved;
        }
        const audit = await buildSeoSiteAudit(savedConfig);
        return res.status(200).json({ ok: true, optimizedAt: new Date().toISOString(), preferredModel, changedPages: [], appliedPageFieldCount: 0, appliedImageAltCount: 0, audit, message: 'Er waren geen extra SEO-aanpassingen nodig.' });
      }
      const saved = await persistSeoConfig(optimization.nextConfig, { source: 'seo-dashboard', actor: normalizeString(req.body?.actor || 'site-optimize') });
      if (!saved) return res.status(500).json({ ok: false, error: 'Kon de AI SEO-optimalisatie niet opslaan.' });
      appendDashboardActivity({ type: 'seo_site_optimized', title: 'SEO site-optimalisatie uitgevoerd', detail: `${optimization.changedPages.length} pagina's geoptimaliseerd met ${preferredModel}.`, source: 'premium-seo', actor: normalizeString(req.body?.actor || 'site-optimize') }, 'dashboard_activity_seo_site_optimized');
      const audit = await buildSeoSiteAudit(saved);
      return res.status(200).json({ ok: true, optimizedAt: new Date().toISOString(), preferredModel, changedPages: optimization.changedPages, appliedPageFieldCount: optimization.appliedPageFieldCount, appliedImageAltCount: optimization.appliedImageAltCount, audit, message: `${optimization.changedPages.length} pagina's automatisch bijgewerkt.` });
    } catch (error) {
      console.error('[SEO][SiteOptimizeError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Kon de AI SEO-optimalisatie niet uitvoeren.' });
    }
  });

  // --- POST /api/seo/automation ---
  app.post('/api/seo/automation', async (req, res) => {
    try {
      const currentConfig = await getSeoConfigCached(true);
      const nextConfig = normalizeSeoConfig(currentConfig);
      const automationPatch = { ...(nextConfig.automation || {}), updatedAt: new Date().toISOString() };
      const body = req.body || {};
      const fields = ['preferredModel', 'model', 'blogAutomationEnabled', 'blogCadence', 'blogModel', 'blogAutoImages', 'searchConsoleConnected', 'analyticsConnected'];
      for (const field of fields) {
        if (Object.prototype.hasOwnProperty.call(body, field)) automationPatch[field === 'model' ? 'preferredModel' : field] = body[field];
      }
      nextConfig.automation = normalizeSeoAutomationSettings(automationPatch);
      const saved = await persistSeoConfig(nextConfig, { source: 'seo-dashboard', actor: normalizeString(req.body?.actor || 'automation') });
      if (!saved) return res.status(500).json({ ok: false, error: 'Kon de SEO automatisering niet opslaan.' });
      appendDashboardActivity({ type: 'seo_automation_updated', title: 'SEO automatisering bijgewerkt', detail: `Voorkeursmodel ${saved.automation.preferredModel}, blogschema ${saved.automation.blogCadence}.`, source: 'premium-seo', actor: normalizeString(req.body?.actor || 'automation') }, 'dashboard_activity_seo_automation_updated');
      return res.status(200).json({ ok: true, automation: normalizeSeoAutomationSettings(saved.automation), modelOptions: getSeoModelPresetOptions() });
    } catch (error) {
      console.error('[SEO][AutomationSaveError]', error?.message || error);
      return res.status(500).json({ ok: false, error: 'Kon de SEO automatisering niet opslaan.' });
    }
  });
};
