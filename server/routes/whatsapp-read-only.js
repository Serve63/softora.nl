const crypto = require('node:crypto');

function headerValue(req, name) {
  if (req && typeof req.get === 'function') return String(req.get(name) || '');
  return String(req?.headers?.[String(name || '').toLowerCase()] || '');
}

function bearerToken(req) {
  const authorization = headerValue(req, 'authorization').trim();
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function safeError(error) {
  const code = String(error?.code || 'WHATSAPP_REQUEST_FAILED').slice(0, 120);
  const publicErrors = {
    WHATSAPP_STORAGE_NOT_CONFIGURED: 'WhatsApp-opslag is niet geconfigureerd.',
    WHATSAPP_ENCRYPTION_KEY_INVALID: 'WhatsApp-versleuteling is niet geconfigureerd.',
    WHATSAPP_QUERY_INVALID: 'De WhatsApp-zoekopdracht is ongeldig.',
  };
  return {
    ok: false,
    errorCode: code,
    error: publicErrors[code] || 'WhatsApp-verzoek kon niet veilig worden verwerkt.',
  };
}

function registerWhatsAppReadOnlyRoutes(app, deps = {}) {
  const service = deps.service;
  const cronSecret = String(deps.cronSecret || process.env.CRON_SECRET || '').trim();
  if (!service) return;

  function requireReadAccess(req, res, next) {
    if (!service.isReadAuthorized(bearerToken(req))) {
      return res.status(401).json({ ok: false, error: 'WhatsApp read-only toegang geweigerd.' });
    }
    return next();
  }

  app.get('/api/whatsapp/webhook', (req, res) => {
    const challenge = service.verifyChallenge({
      mode: String(req.query?.['hub.mode'] || ''),
      token: String(req.query?.['hub.verify_token'] || ''),
      challenge: String(req.query?.['hub.challenge'] || ''),
    });
    if (challenge === null) return res.status(403).send('Verification failed');
    return res.status(200).send(challenge);
  });

  app.post('/api/whatsapp/webhook', async (req, res) => {
    try {
      const result = await service.acceptWebhook({
        rawBody: req.rawBody,
        payload: req.body,
        signature: headerValue(req, 'x-hub-signature-256'),
      });
      return res.status(202).json(result);
    } catch (error) {
      const status = error?.code === 'WHATSAPP_WEBHOOK_SIGNATURE_INVALID'
        ? 401
        : error?.code === 'WHATSAPP_WEBHOOK_PAYLOAD_INVALID'
          ? 400
          : 503;
      return res.status(status).json(safeError(error));
    }
  });

  app.get('/api/whatsapp/webhook-worker', async (req, res) => {
    if (!cronSecret) return res.status(503).json({ ok: false, error: 'WhatsApp-worker is niet geconfigureerd.' });
    if (!safeEqual(bearerToken(req), cronSecret)) {
      return res.status(401).json({ ok: false, error: 'WhatsApp-worker geweigerd.' });
    }
    try {
      return res.json(await service.processWebhookQueue({ limit: req.query?.limit }));
    } catch (error) {
      return res.status(error?.code === 'WHATSAPP_QUERY_INVALID' ? 400 : 500).json(safeError(error));
    }
  });

  app.get('/api/whatsapp/status', requireReadAccess, async (_req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      return res.json({ ok: true, ...(await service.getStatus()) });
    } catch (error) {
      return res.status(500).json(safeError(error));
    }
  });

  app.get('/api/whatsapp/messages', requireReadAccess, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const result = await service.readMessages({
        contact: req.query?.contact,
        query: req.query?.query,
        after: req.query?.after,
        before: req.query?.before,
        limit: req.query?.limit,
        actor: headerValue(req, 'x-softora-whatsapp-actor') || 'codex-whatsapp-read-only',
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json(safeError(error));
    }
  });
}

module.exports = { registerWhatsAppReadOnlyRoutes };
