const path = require('path');
const {
  canReuseVideo,
  createCompanyWebsiteVideoRepository,
} = require('../repositories/company-website-video');
const { normalizeWebsiteUrl } = require('../security/company-website-video-url');

function normalizeString(value) {
  return String(value || '').trim();
}

function resolveCompanyWebsiteUrl(company) {
  return normalizeString(company && (
    company.website || company.websiteUrl || company.url || company.dom || company.domain
  ));
}

function resolveCompanyName(company) {
  return normalizeString(company && (
    company.bedrijf || company.company || company.companyName || company.naam
  )) || 'Bedrijf';
}

function createCompanyWebsiteVideoCoordinator(options = {}) {
  const dataOpsStore = options.dataOpsStore;
  const repository = options.repository || createCompanyWebsiteVideoRepository({
    supabaseUrl: options.supabaseUrl || process.env.SUPABASE_URL,
    supabaseServiceRoleKey: options.supabaseServiceRoleKey || process.env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: options.storageBucket || process.env.WEBSITE_VIDEO_STORAGE_BUCKET,
  });
  const pagesDir = options.pagesDir || path.resolve(__dirname, '../..');
  const logger = options.logger || console;

  async function findCompany(companyId) {
    const id = normalizeString(companyId);
    if (!id || !dataOpsStore || typeof dataOpsStore.listCustomers !== 'function') return null;
    const customers = await dataOpsStore.listCustomers({
      bypassReadCache: true,
      suppressTransientReadFailureLog: true,
    });
    if (!Array.isArray(customers)) return null;
    return customers.find((entry) => normalizeString(entry && entry.id) === id) || null;
  }

  async function buildStatus(companyId) {
    const company = await findCompany(companyId);
    if (!company) return null;
    const originalWebsiteUrl = resolveCompanyWebsiteUrl(company);
    const normalizedWebsiteUrl = normalizeWebsiteUrl(originalWebsiteUrl);
    const base = {
      companyId: normalizeString(company.id),
      companyName: resolveCompanyName(company),
      websiteUrl: originalWebsiteUrl,
      normalizedWebsiteUrl,
      hasWebsite: Boolean(normalizedWebsiteUrl),
      status: normalizedWebsiteUrl ? 'missing' : 'no_website',
      needsRender: Boolean(normalizedWebsiteUrl),
      videoUrl: '',
    };
    if (!normalizedWebsiteUrl || !repository.configured) return base;
    const record = await repository.get(company.id);
    if (!record) return base;
    const sameUrl = record.normalizedWebsiteUrl === normalizedWebsiteUrl;
    let fileExists = false;
    if (record.status === 'ready' && sameUrl) fileExists = await repository.exists(record);
    if (canReuseVideo(record, normalizedWebsiteUrl, fileExists)) {
      return {
        ...base,
        status: 'ready',
        needsRender: false,
        videoUrl: `/api/bedrijven/${encodeURIComponent(base.companyId)}/website-video/file`,
        updatedAt: record.updatedAt,
      };
    }
    if (!sameUrl) return base;
    return {
      ...base,
      status: record.status === 'ready' ? 'missing' : record.status,
      needsRender: record.status === 'failed' || record.status === 'ready',
      updatedAt: record.updatedAt,
    };
  }

  async function statusResponse(req, res) {
    try {
      const status = await buildStatus(req.params.companyId);
      if (!status) return res.status(404).json({ ok: false, error: 'Niet gevonden.' });
      return res.status(200).json({ ok: true, video: status });
    } catch (error) {
      logger.error('[WebsiteVideo][Status]', error && error.message ? error.message : error);
      return res.status(503).json({ ok: false, error: 'De websitevideo is tijdelijk niet beschikbaar.' });
    }
  }

  async function startResponse(req, res) {
    try {
      const status = await buildStatus(req.params.companyId);
      if (!status) return res.status(404).json({ ok: false, error: 'Niet gevonden.' });
      if (!status.hasWebsite) return res.status(422).json({ ok: false, error: 'Voor dit bedrijf is geen geldige website gevonden.' });
      if (!repository.configured) return res.status(503).json({ ok: false, error: 'De websitevideo is tijdelijk niet beschikbaar.' });
      if (status.status === 'ready') return res.status(200).json({ ok: true, video: status });
      const record = await repository.queue({
        companyId: status.companyId,
        originalWebsiteUrl: status.websiteUrl,
        normalizedWebsiteUrl: status.normalizedWebsiteUrl,
      }, { forceRetry: Boolean(req.body && req.body.retry) || status.status === 'missing' });
      return res.status(record.status === 'ready' ? 200 : 202).json({
        ok: true,
        video: { ...status, status: record.status, needsRender: false },
      });
    } catch (error) {
      logger.error('[WebsiteVideo][Start]', error && error.message ? error.message : error);
      return res.status(503).json({ ok: false, error: 'De websitevideo kon niet worden gestart.' });
    }
  }

  async function fileResponse(req, res) {
    try {
      const status = await buildStatus(req.params.companyId);
      if (!status || status.status !== 'ready') return res.status(404).json({ ok: false, error: 'Niet gevonden.' });
      const record = await repository.get(status.companyId);
      const buffer = await repository.download(record);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('Accept-Ranges', 'none');
      return res.status(200).send(buffer);
    } catch (error) {
      logger.error('[WebsiteVideo][File]', error && error.message ? error.message : error);
      return res.status(404).json({ ok: false, error: 'Niet gevonden.' });
    }
  }

  function pageResponse(_req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    return res.sendFile(path.join(pagesDir, 'premium-company-website-video.html'));
  }

  return {
    buildStatus,
    fileResponse,
    findCompany,
    pageResponse,
    repository,
    startResponse,
    statusResponse,
  };
}

module.exports = {
  createCompanyWebsiteVideoCoordinator,
  resolveCompanyName,
  resolveCompanyWebsiteUrl,
};
