const { rateLimit } = require('express-rate-limit');
const { createPublicEbookService } = require('../services/public-ebook');

function registerPublicContactRoutes(app, deps = {}) {
  const coordinator = deps.coordinator;
  if (!coordinator) return;

  app.post('/api/public-contact', (req, res) => coordinator.submitResponse(req, res));
  const ebook = createPublicEbookService({ contactService: coordinator });
  app.post('/api/public-ebook', rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    message: { ok: false, error: 'Je hebt meerdere aanvragen gedaan. Probeer het over 15 minuten opnieuw.' },
  }), (req, res) => ebook.submitResponse(req, res));
}

module.exports = {
  registerPublicContactRoutes,
};
