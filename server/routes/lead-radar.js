'use strict';

const { createLeadRadarService } = require('../services/lead-radar');

function passThrough(_req, _res, next) {
  if (typeof next === 'function') next();
}

function sendError(res, error) {
  const statusCode = Number(error?.statusCode) || (error?.code === 'LEAD_RADAR_PROVIDER_UNAVAILABLE' ? 200 : 500);
  return res.status(statusCode).json({
    ok: false,
    error: String(error?.message || error || 'Lead Radar is tijdelijk niet beschikbaar.').slice(0, 500),
    code: error?.code || 'LEAD_RADAR_ERROR',
  });
}

function registerLeadRadarRoutes(app, deps = {}) {
  const service = deps.service || createLeadRadarService(deps);
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : passThrough;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();

  function requireCronAccess(req, res, next) {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'Lead Radar-cron is niet geconfigureerd.' });
    if (String(req.headers?.authorization || '').trim() !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Lead Radar-cron geweigerd.' });
    }
    return next();
  }

  app.get('/api/lead-radar/cron', requireCronAccess, async (_req, res) => {
    try { return res.json({ ok: true, ...(await service.runScheduledScan()) }); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/api/lead-radar/status', requireAdmin, async (_req, res) => {
    try { return res.json({ ok: true, ...(await service.getStatus()) }); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/api/lead-radar/signals', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, ...(await service.listSignals(req.query || {})) }); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/api/lead-radar/signals/:id', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, signal: await service.getSignal(req.params.id) }); }
    catch (error) { return sendError(res, error); }
  });

  app.patch('/api/lead-radar/signals/:id', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, signal: await service.updateSignal(req.params.id, req.body || {}) }); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/api/lead-radar/import', requireAdmin, async (req, res) => {
    try {
      const result = await service.importSignal(req.body || {});
      return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/lead-radar/scan', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, run: await service.runScan(req.body || {}) }); }
    catch (error) { return sendError(res, error); }
  });

  app.get('/api/lead-radar/runs', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, runs: await service.listRuns(req.query?.limit) }); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/api/lead-radar/signals/:id/website-lookup', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, signal: await service.lookupWebsite(req.params.id, { force: Boolean(req.body?.force) }) }); }
    catch (error) { return sendError(res, error); }
  });

  app.post('/api/lead-radar/website-lookup', requireAdmin, async (req, res) => {
    try { return res.json({ ok: true, signals: await service.bulkLookupWebsite(req.body || {}) }); }
    catch (error) { return sendError(res, error); }
  });
}

module.exports = { registerLeadRadarRoutes };
