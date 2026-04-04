'use strict';

/**
 * routes/dashboard.js — Dashboard activiteiten en security audit log.
 */

module.exports = function registerDashboardRoutes(app, ctx) {
  const { parseIntSafe, normalizeString, recentDashboardActivities, recentSecurityAuditEvents,
    appendDashboardActivity, requireRuntimeDebugAccess } = ctx;

  app.get('/api/dashboard/activity', (req, res) => {
    const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
    return res.status(200).json({
      ok: true,
      count: Math.min(limit, recentDashboardActivities.length),
      activities: recentDashboardActivities.slice(0, limit),
    });
  });

  app.get('/api/security/audit-log', requireRuntimeDebugAccess, (req, res) => {
    const limit = Math.max(1, Math.min(500, parseIntSafe(req.query.limit, 100)));
    return res.status(200).json({
      ok: true,
      count: Math.min(limit, recentSecurityAuditEvents.length),
      events: recentSecurityAuditEvents.slice(0, limit),
    });
  });

  app.post('/api/dashboard/activity', (req, res) => {
    const entry = appendDashboardActivity(
      {
        ...req.body,
        source: normalizeString(req.body?.source || 'premium-personeel-dashboard'),
        actor: normalizeString(req.body?.actor || ''),
      },
      'dashboard_activity_manual'
    );
    return res.status(201).json({ ok: true, activity: entry });
  });
};
