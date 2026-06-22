function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function defaultTruncateText(value, maxLength = 500) {
  return String(value || '').slice(0, maxLength);
}

function createPublicConversionService(deps = {}) {
  const {
    logger = console,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    now = () => new Date(),
  } = deps;

  function sanitizeField(value, maxLength) {
    return truncateText(normalizeString(value), maxLength).replace(/[\r\n]/g, ' ');
  }

  function normalizeConversionPayload(payload = {}) {
    const name = sanitizeField(payload.name, 80);
    const page = sanitizeField(payload.page, 240);
    const target = sanitizeField(payload.target, 40).toLowerCase();
    const landing = sanitizeField(payload.landing, 300);
    const referrer = sanitizeField(payload.referrer, 500);
    const path = sanitizeField(payload.path, 300);
    const at = sanitizeField(payload.at, 80);

    if (!name || !page || target !== 'whatsapp') {
      return null;
    }

    return {
      name,
      page,
      target,
      landing,
      referrer,
      path,
      at,
      receivedAt: now().toISOString(),
    };
  }

  function recordConversion(payload = {}, meta = {}) {
    const event = normalizeConversionPayload(payload);
    if (!event) return null;

    logger.info('[PublicConversion][CTA]', {
      ...event,
      ip: sanitizeField(meta.ip, 120),
      userAgent: sanitizeField(meta.userAgent, 240),
    });
    return event;
  }

  function recordResponse(req, res) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event = recordConversion(body, {
      ip: normalizeString(req.ip || req.headers?.['x-forwarded-for'] || ''),
      userAgent: normalizeString(req.headers?.['user-agent'] || ''),
    });

    if (!event) {
      return res.status(400).json({
        ok: false,
        error: 'Ongeldige conversie.',
      });
    }

    return res.status(200).json({
      ok: true,
    });
  }

  return {
    normalizeConversionPayload,
    recordConversion,
    recordResponse,
  };
}

module.exports = {
  createPublicConversionService,
};
