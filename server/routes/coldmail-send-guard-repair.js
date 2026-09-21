const REPAIR_CONFIRMATION = 'repair-coldmail-send-guard-manifest';

function rejectUnwiredPremiumAdminGuard(_req, res) {
  return res.status(503).json({
    ok: false,
    code: 'PREMIUM_ADMIN_SECURITY_NOT_WIRED',
    error: 'Premium admin-beveiliging is tijdelijk niet beschikbaar.',
  });
}

function sendServiceError(res, error) {
  return res.status(Number(error?.status) || 500).json({
    ok: false,
    source: 'coldmail-send-guard-storage',
    code: String(error?.code || 'COLDMAIL_SEND_GUARD_REPAIR_ERROR'),
    error: String(error?.message || 'Coldmail send-guard-opslag kon niet worden verwerkt.'),
    ...(error?.details && typeof error.details === 'object' ? error.details : {}),
  });
}

function registerColdmailSendGuardRepairRoutes(app, deps = {}) {
  const service = deps.service;
  if (!service) return;
  const requireAdmin = typeof deps.requirePremiumAdminApiAccess === 'function'
    ? deps.requirePremiumAdminApiAccess
    : rejectUnwiredPremiumAdminGuard;

  app.get('/api/admin/coldmail-send-guard/storage', requireAdmin, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    try {
      return res.status(200).json(await service.inspect());
    } catch (error) {
      return sendServiceError(res, error);
    }
  });

  app.post('/api/admin/coldmail-send-guard/repair', requireAdmin, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, private');
    if (String(req?.body?.confirm || '') !== REPAIR_CONFIRMATION) {
      return res.status(400).json({
        ok: false,
        source: 'coldmail-send-guard-storage',
        code: 'COLDMAIL_SEND_GUARD_REPAIR_CONFIRMATION_REQUIRED',
        error: 'Expliciete herstelbevestiging ontbreekt.',
      });
    }
    try {
      return res.status(200).json(await service.repair());
    } catch (error) {
      return sendServiceError(res, error);
    }
  });
}

module.exports = {
  REPAIR_CONFIRMATION,
  registerColdmailSendGuardRepairRoutes,
};
