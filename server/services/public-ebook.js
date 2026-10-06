const { getSeoContentItem } = require('./seo-content');

const EBOOK_DOWNLOAD_URL = '/assets/ebooks/meer-groei-minder-handwerk.pdf';
const EMAIL_PATTERN = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]{2,}$/;

function createPublicEbookService({ contactService, logger = console } = {}) {
  async function submitResponse(req, res) {
    res.set('Cache-Control', 'no-store');
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const page = typeof body.page === 'string' ? body.page : '';
    const slug = /^\/blog\/([a-z0-9-]+)$/.exec(page)?.[1];
    if (name.length < 2 || name.length > 100 || /[\r\n\x00-\x1f<>]/.test(name)) {
      return res.status(400).json({ ok: false, error: 'Vul je voornaam in (2 tot 100 tekens).' });
    }
    if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ ok: false, error: 'Vul een geldig e-mailadres in.' });
    }
    if (!slug || !getSeoContentItem('blog', slug)) {
      return res.status(400).json({ ok: false, error: 'Open het formulier opnieuw vanuit een artikel.' });
    }
    if (body.website) return res.status(400).json({ ok: false, error: 'De aanvraag is niet verwerkt.' });
    if (req.headers?.['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ ok: false, error: 'Vraag het e-book aan via Softora.nl.' });
    }
    try {
      const result = await contactService.sendContactRequest({
        // The existing contact inbox is the durable destination for ebook requests.
        name,
        email,
        page,
        message: 'Gratis e-book aangevraagd: Meer groei. Minder handwerk.\n' +
          'Ontdek hoe bedrijfssoftware je bedrijf helpt groeien.\n' +
          'Voornaam: ' + name + '\nGeen toestemming voor nieuwsbrieven of automatische marketingmail.',
      });
      if (!result.accepted?.length || result.rejected?.length) throw new Error('Contact inbox did not accept request');
      return res.status(200).json({ ok: true, downloadUrl: EBOOK_DOWNLOAD_URL });
    } catch {
      logger.error('[PublicEbook] Aanvraag kon niet worden opgeslagen in de contactinbox.');
      return res.status(503).json({ ok: false, error: 'Je aanvraag is nog niet verwerkt. Probeer het zo nog eens.' });
    }
  }
  return { submitResponse };
}

module.exports = { createPublicEbookService, EBOOK_DOWNLOAD_URL };
