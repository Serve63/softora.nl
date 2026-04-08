function createSeoWriteCoordinator(deps = {}) {
  const {
    logger = console,
    resolveSeoPageFileFromRequest = () => '',
    normalizeSeoPageOverridePatch = () => ({}),
    normalizeSeoImageOverridePatch = () => ({}),
    getSeoConfigCached = async () => ({}),
    normalizeSeoConfig = (value) => value || {},
    seoPageFieldDefs = [],
    normalizeString = (value) => String(value || '').trim(),
    persistSeoConfig = async () => null,
    appendDashboardActivity = () => {},
    normalizeSeoModelPreset = (value) => String(value || '').trim(),
    applySeoAuditSuggestionsToConfig = (_config, audit) => ({
      nextConfig: {},
      changedPages: [],
      appliedPageFieldCount: 0,
      appliedImageAltCount: 0,
      preferredModel: '',
      audit,
    }),
    seoReadCoordinator,
    normalizeSeoAutomationSettings = (value) => value || {},
    getSeoModelPresetOptions = () => [],
  } = deps;

  async function saveSeoPageResponse(req, res) {
    const fileName = resolveSeoPageFileFromRequest(req.body?.file, req.body?.slug);
    if (!fileName) {
      return res.status(400).json({ ok: false, error: 'Ongeldig of onbekend HTML-bestand.' });
    }

    const pageOverridePatch = normalizeSeoPageOverridePatch(req.body?.pageOverrides || req.body?.page || {});
    const imageOverridePatch = normalizeSeoImageOverridePatch(
      req.body?.imageAltOverrides || req.body?.imageOverrides || req.body?.images || {}
    );

    try {
      const currentConfig = await getSeoConfigCached(true);
      const nextConfig = normalizeSeoConfig(currentConfig);

      const nextPageOverrides = {
        ...(nextConfig.pages[fileName] || {}),
      };
      for (const field of seoPageFieldDefs) {
        if (!Object.prototype.hasOwnProperty.call(pageOverridePatch, field.key)) continue;
        const value = normalizeString(pageOverridePatch[field.key]);
        if (!value) {
          delete nextPageOverrides[field.key];
          continue;
        }
        nextPageOverrides[field.key] = value;
      }
      if (Object.keys(nextPageOverrides).length > 0) {
        nextConfig.pages[fileName] = nextPageOverrides;
      } else {
        delete nextConfig.pages[fileName];
      }

      const nextImageOverrides = {
        ...(nextConfig.images[fileName] || {}),
      };
      for (const [src, altRaw] of Object.entries(imageOverridePatch)) {
        const alt = normalizeString(altRaw);
        if (!alt) {
          delete nextImageOverrides[src];
          continue;
        }
        nextImageOverrides[src] = alt;
      }
      if (Object.keys(nextImageOverrides).length > 0) {
        nextConfig.images[fileName] = nextImageOverrides;
      } else {
        delete nextConfig.images[fileName];
      }

      const saved = await persistSeoConfig(nextConfig, {
        source: 'seo-dashboard',
        actor: normalizeString(req.body?.actor || 'dashboard'),
      });
      if (!saved) {
        return res.status(500).json({ ok: false, error: 'Kon SEO wijzigingen niet opslaan.' });
      }

      appendDashboardActivity(
        {
          type: 'seo_page_updated',
          title: 'SEO-instellingen opgeslagen',
          detail: `SEO updates opgeslagen voor ${fileName}.`,
          source: 'premium-seo',
          actor: normalizeString(req.body?.actor || 'dashboard'),
        },
        'dashboard_activity_seo_updated'
      );

      return res.status(200).json({
        ok: true,
        file: fileName,
        saved: {
          pageOverrideCount: Object.keys(saved.pages[fileName] || {}).length,
          imageOverrideCount: Object.keys(saved.images[fileName] || {}).length,
        },
      });
    } catch (error) {
      logger.error('[SEO][SaveError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'SEO wijzigingen opslaan mislukt.',
      });
    }
  }

  async function siteOptimizeResponse(req, res) {
    try {
      const preferredModel = normalizeSeoModelPreset(req.body?.model || req.body?.preferredModel || 'gpt-5.1');
      const currentConfig = await getSeoConfigCached(true);
      const currentAudit = await seoReadCoordinator.buildSeoSiteAudit(currentConfig);
      const optimization = applySeoAuditSuggestionsToConfig(currentConfig, currentAudit, preferredModel);

      if (optimization.changedPages.length === 0) {
        let savedConfig = currentConfig;
        if (normalizeSeoModelPreset(currentConfig?.automation?.preferredModel || '') !== preferredModel) {
          const saved = await persistSeoConfig(optimization.nextConfig, {
            source: 'seo-dashboard',
            actor: normalizeString(req.body?.actor || 'site-optimize'),
          });
          if (saved) savedConfig = saved;
        }
        const audit = await seoReadCoordinator.buildSeoSiteAudit(savedConfig);
        return res.status(200).json({
          ok: true,
          optimizedAt: new Date().toISOString(),
          preferredModel,
          changedPages: [],
          appliedPageFieldCount: 0,
          appliedImageAltCount: 0,
          audit,
          message: 'Er waren geen extra SEO-aanpassingen nodig.',
        });
      }

      const saved = await persistSeoConfig(optimization.nextConfig, {
        source: 'seo-dashboard',
        actor: normalizeString(req.body?.actor || 'site-optimize'),
      });
      if (!saved) {
        return res.status(500).json({
          ok: false,
          error: 'Kon de AI SEO-optimalisatie niet opslaan.',
        });
      }

      appendDashboardActivity(
        {
          type: 'seo_site_optimized',
          title: 'SEO site-optimalisatie uitgevoerd',
          detail: `${optimization.changedPages.length} pagina's geoptimaliseerd met ${preferredModel}.`,
          source: 'premium-seo',
          actor: normalizeString(req.body?.actor || 'site-optimize'),
        },
        'dashboard_activity_seo_site_optimized'
      );

      const audit = await seoReadCoordinator.buildSeoSiteAudit(saved);
      return res.status(200).json({
        ok: true,
        optimizedAt: new Date().toISOString(),
        preferredModel,
        changedPages: optimization.changedPages,
        appliedPageFieldCount: optimization.appliedPageFieldCount,
        appliedImageAltCount: optimization.appliedImageAltCount,
        audit,
        message: `${optimization.changedPages.length} pagina's automatisch bijgewerkt.`,
      });
    } catch (error) {
      logger.error('[SEO][SiteOptimizeError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Kon de AI SEO-optimalisatie niet uitvoeren.',
      });
    }
  }

  async function saveSeoAutomationResponse(req, res) {
    try {
      const currentConfig = await getSeoConfigCached(true);
      const nextConfig = normalizeSeoConfig(currentConfig);
      const automationPatch = {
        ...(nextConfig.automation || {}),
        updatedAt: new Date().toISOString(),
      };
      if (
        Object.prototype.hasOwnProperty.call(req.body || {}, 'preferredModel') ||
        Object.prototype.hasOwnProperty.call(req.body || {}, 'model')
      ) {
        automationPatch.preferredModel = req.body?.preferredModel ?? req.body?.model;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blogAutomationEnabled')) {
        automationPatch.blogAutomationEnabled = req.body?.blogAutomationEnabled;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blogCadence')) {
        automationPatch.blogCadence = req.body?.blogCadence;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blogModel')) {
        automationPatch.blogModel = req.body?.blogModel;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'blogAutoImages')) {
        automationPatch.blogAutoImages = req.body?.blogAutoImages;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'searchConsoleConnected')) {
        automationPatch.searchConsoleConnected = req.body?.searchConsoleConnected;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'analyticsConnected')) {
        automationPatch.analyticsConnected = req.body?.analyticsConnected;
      }
      nextConfig.automation = normalizeSeoAutomationSettings(automationPatch);

      const saved = await persistSeoConfig(nextConfig, {
        source: 'seo-dashboard',
        actor: normalizeString(req.body?.actor || 'automation'),
      });
      if (!saved) {
        return res.status(500).json({
          ok: false,
          error: 'Kon de SEO automatisering niet opslaan.',
        });
      }

      appendDashboardActivity(
        {
          type: 'seo_automation_updated',
          title: 'SEO automatisering bijgewerkt',
          detail: `Voorkeursmodel ${saved.automation.preferredModel}, blogschema ${saved.automation.blogCadence}.`,
          source: 'premium-seo',
          actor: normalizeString(req.body?.actor || 'automation'),
        },
        'dashboard_activity_seo_automation_updated'
      );

      return res.status(200).json({
        ok: true,
        automation: normalizeSeoAutomationSettings(saved.automation),
        modelOptions: getSeoModelPresetOptions(),
      });
    } catch (error) {
      logger.error('[SEO][AutomationSaveError]', error?.message || error);
      return res.status(500).json({
        ok: false,
        error: 'Kon de SEO automatisering niet opslaan.',
      });
    }
  }

  return {
    saveSeoAutomationResponse,
    saveSeoPageResponse,
    siteOptimizeResponse,
  };
}

module.exports = {
  createSeoWriteCoordinator,
};
