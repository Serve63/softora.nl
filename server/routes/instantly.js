const crypto = require('node:crypto');

function registerInstantlyRoutes(app, deps = {}) {
  const {
    instantlyOutreachService,
    instantlyQueueRegistrationService,
    instantlyMailboxService,
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    requirePremiumAdminApiAccess = (_req, _res, next) => next(),
    cronSecret = process.env.CRON_SECRET,
    postAutomaticUpload = async (secret) => fetch('https://www.softora.nl/api/outreach/provider-upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, Origin: 'https://www.softora.nl', 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'auto' }),
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    }),
  } = deps;

  if (!instantlyOutreachService) return;

  function hasCronAccess(req) {
    const expected = Buffer.from(`Bearer ${normalizeString(cronSecret)}`);
    const supplied = Buffer.from(normalizeString(req && req.headers && req.headers.authorization));
    return Boolean(normalizeString(cronSecret)) && expected.length === supplied.length &&
      crypto.timingSafeEqual(expected, supplied);
  }

  function requireUploadAccess(req, res, next) {
    if (normalizeString(req && req.body && req.body.mode).toLowerCase() === 'auto' && hasCronAccess(req)) {
      req.premiumAuth = { displayName: 'Instantly automatische cron' };
      next();
      return;
    }
    requirePremiumAdminApiAccess(req, res, next);
  }

  async function handleQueueRegistration(req, res) {
    try {
      if (!instantlyQueueRegistrationService || typeof instantlyQueueRegistrationService.registerBatch !== 'function') {
        res.status(503).json({
          ok: false,
          code: 'INSTANTLY_QUEUE_REGISTRATION_UNAVAILABLE',
          message: 'Instantly-wachtrijregistratie is tijdelijk niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await instantlyQueueRegistrationService.registerBatch({
        rows: body.rows,
        sourceId: body.sourceId,
        fileDigest: body.fileDigest,
        totalRows: body.totalRows,
        batchIndex: body.batchIndex,
        batchCount: body.batchCount,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Instantly sheetregistratie',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_QUEUE_REGISTRATION_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly-wachtrij kon niet worden geregistreerd.',
          500
        ),
        conflictCount: Number(error && error.conflictCount) || undefined,
        conflicts: Array.isArray(error && error.conflicts) ? error.conflicts : undefined,
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
        sheetRow: Number(error && error.sheetRow) || undefined,
      });
    }
  }

  async function handleQueueDesignStage(req, res) {
    try {
      if (!instantlyQueueRegistrationService || typeof instantlyQueueRegistrationService.stageDesignBatch !== 'function') {
        res.status(503).json({
          ok: false,
          code: 'INSTANTLY_QUEUE_DESIGN_STAGE_UNAVAILABLE',
          message: 'Instantly-ontwerpstaging is tijdelijk niet beschikbaar.',
        });
        return;
      }
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = await instantlyQueueRegistrationService.stageDesignBatch({
        emails: body.emails,
        sourceId: body.sourceId,
        fileDigest: body.fileDigest,
        refreshInventory: body.refreshInventory === true,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Instantly ontwerpstaging',
      });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_QUEUE_DESIGN_STAGE_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly-ontwerpstaging is mislukt.',
          500
        ),
        conflictCount: Number(error && error.conflictCount) || undefined,
      });
    }
  }

  async function handlePrepareUpload(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const mode = normalizeString(body.mode).toLowerCase();
      const operation = mode === 'auto'
        ? instantlyOutreachService.autoUploadMailReady
        : mode === 'replace'
          ? instantlyOutreachService.replaceInstantlyCampaigns
          : instantlyOutreachService.prepareInstantlyUpload;
      if (typeof operation !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_SAFE_UPLOAD_UNAVAILABLE',
          message: 'Veilige Instantly upload is niet beschikbaar.',
        });
        return;
      }
      const result = await operation.call(instantlyOutreachService, {
        limit: body.limit,
        campaignId: body.campaignId || body.campaign || body.defaultCampaignId,
        uploadId: body.uploadId,
        queueSourceId: body.queueSourceId,
        queueFileDigest: body.queueFileDigest,
        senderProfile: body.senderProfile || body.senderProfileKey || body.profileKey,
        senderEmail: body.senderEmail || body.sentFromEmail || body.mailboxAccount,
        actor:
          normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
          normalizeString(body.actor) ||
          'Instantly veilige upload',
      });
      res.status(mode === 'auto' && result && result.ok === false ? 502 : 200).json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_SAFE_UPLOAD_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Veilige Instantly upload kon niet worden voorbereid.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  }

  async function handleAutoCron(req, res) {
    if (!hasCronAccess(req)) {
      res.status(401).json({ ok: false, code: 'INSTANTLY_AUTO_CRON_UNAUTHORIZED' });
      return;
    }
    try {
      // Vercel Cron invokes GET; this authenticated run delegates every new
      // lead to the sole canonical POST provider-upload route.
      const response = await postAutomaticUpload(cronSecret);
      const result = await response.json();
      res.status(response.status).json(result);
    } catch (_error) {
      res.status(502).json({ ok: false, code: 'INSTANTLY_AUTO_CRON_POST_FAILED' });
    }
  }

  async function handleSync(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const deliveryStatusOnly = body.deliveryStatusOnly === true;
      if (
        (deliveryStatusOnly && typeof instantlyOutreachService.refreshInstantlyDeliveryStatus !== 'function') ||
        (!deliveryStatusOnly && typeof instantlyOutreachService.syncInstantlyLeads !== 'function')
      ) {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_SYNC_UNAVAILABLE',
          message: 'Instantly sync is niet beschikbaar.',
        });
        return;
      }
      const actor =
        normalizeString(req.premiumAuth && (req.premiumAuth.displayName || req.premiumAuth.email)) ||
        normalizeString(body.actor) ||
        'Instantly sync';
      const result = deliveryStatusOnly
        ? await instantlyOutreachService.refreshInstantlyDeliveryStatus({ actor, reconcileOnly: true })
        : await instantlyOutreachService.syncInstantlyLeads({
          campaignId: body.campaignId || body.campaign || body.defaultCampaignId,
          senderProfile: body.senderProfile || body.senderProfileKey || body.profileKey,
          senderEmail: body.senderEmail || body.sentFromEmail || body.mailboxAccount,
          refreshExistingVariables: body.refreshExistingVariables === true,
          refreshExistingLimit: body.refreshExistingLimit,
          refreshExistingOnly: body.refreshExistingOnly === true,
          reconcileOnly: true,
          cleanupOnly: body.cleanupOnly === true,
          actor,
        });
      res.json(result);
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_SYNC_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly sync kon niet worden gestart.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  }

  async function handleStatus(_req, res) {
    try {
      if (typeof instantlyOutreachService.getStatus !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_STATUS_UNAVAILABLE',
          message: 'Instantly status is niet beschikbaar.',
        });
        return;
      }
      const result = await instantlyOutreachService.getStatus();
      res.json({
        ...result,
        mailbox: typeof instantlyMailboxService?.getStatus === 'function'
          ? instantlyMailboxService.getStatus()
          : {
              enabled: false,
              configured: false,
              missing: ['INSTANTLY_MAILBOX_SERVICE'],
            },
      });
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_STATUS_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly status kon niet worden geladen.',
          500
        ),
      });
    }
  }

  app.post('/api/instantly/webhook', async (req, res) => {
    try {
      if (typeof instantlyOutreachService.handleInstantlyWebhook !== 'function') {
        res.status(404).json({
          ok: false,
          code: 'INSTANTLY_WEBHOOK_UNAVAILABLE',
          message: 'Instantly webhook is niet beschikbaar.',
        });
        return;
      }
      const [outreachResult, mailboxResult] = await Promise.all([
        instantlyOutreachService.handleInstantlyWebhook(req),
        typeof instantlyMailboxService?.ingestWebhook === 'function'
          ? instantlyMailboxService.ingestWebhook(req)
          : Promise.resolve({ ok: true, skipped: true, reason: 'mailbox-integration-unavailable' }),
      ]);
      res.json({
        ...outreachResult,
        mailbox: mailboxResult,
      });
    } catch (error) {
      res.status(error && error.status ? error.status : 400).json({
        ok: false,
        code: normalizeString(error && error.code) || 'INSTANTLY_WEBHOOK_FAILED',
        message: truncateText(
          normalizeString(error && error.message) || 'Instantly webhook kon niet worden verwerkt.',
          500
        ),
        missing: Array.isArray(error && error.missing) ? error.missing : undefined,
      });
    }
  });

  app.post('/api/instantly/sync', requirePremiumAdminApiAccess, handleSync);
  app.post('/api/outreach/provider-sync', requirePremiumAdminApiAccess, handleSync);

  app.post('/api/instantly/prepare-upload', requirePremiumAdminApiAccess, handlePrepareUpload);
  app.post('/api/outreach/provider-upload', requireUploadAccess, handlePrepareUpload);
  app.get('/api/outreach/provider-upload/auto-run', handleAutoCron);
  app.post('/api/outreach/provider-queue/register', requirePremiumAdminApiAccess, handleQueueRegistration);
  app.post('/api/outreach/provider-queue/stage-designs', requirePremiumAdminApiAccess, handleQueueDesignStage);

  app.get('/api/instantly/status', requirePremiumAdminApiAccess, handleStatus);
  app.get('/api/outreach/provider-status', requirePremiumAdminApiAccess, handleStatus);
}

module.exports = {
  registerInstantlyRoutes,
};
