function defaultNormalizeString(value) {
  return String(value || '').trim();
}

function defaultTruncateText(value, maxLength = 500) {
  return String(value || '').slice(0, maxLength);
}

function createPublicConversionTrackingService(deps = {}) {
  const {
    logger = console,
    normalizeString = defaultNormalizeString,
    truncateText = defaultTruncateText,
    appendDashboardActivity = () => null,
    now = () => new Date(),
    maxEventsPerMinute = 60,
  } = deps;

  let windowStartedAtMs = Date.now();
  let eventsInWindow = 0;

  function sanitize(value, maxLength) {
    return truncateText(normalizeString(value), maxLength).replace(/\r|\n/g, ' ');
  }

  function normalizePublicPath(value) {
    const raw = sanitize(value, 240);
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://www.softora.nl');
      return parsed.pathname && parsed.pathname.startsWith('/') ? parsed.pathname : '';
    } catch {
      return raw.startsWith('/') ? raw.split('?')[0].split('#')[0] : '';
    }
  }

  function allowEvent() {
    const currentMs = Date.now();
    if (currentMs - windowStartedAtMs >= 60000) {
      windowStartedAtMs = currentMs;
      eventsInWindow = 0;
    }
    eventsInWindow += 1;
    return eventsInWindow <= maxEventsPerMinute;
  }

  function normalizeConversionPayload(payload = {}) {
    const event = sanitize(payload.event || payload.eventType || 'conversion', 80);
    const conversion = sanitize(payload.conversion || payload.name || payload.action, 120);
    const target = sanitize(payload.target, 80).toLowerCase();
    const page = normalizePublicPath(payload.page || payload.path);
    const landingPage = normalizePublicPath(payload.landingPage || payload.landing || page);
    const href = sanitize(payload.href || payload.url, 320);
    const label = sanitize(payload.label || payload.text, 160);

    if (!conversion) {
      const error = new Error('Conversion name ontbreekt.');
      error.status = 400;
      throw error;
    }
    if (!page) {
      const error = new Error('Pagina ontbreekt.');
      error.status = 400;
      throw error;
    }

    return {
      event,
      conversion,
      target,
      page,
      landingPage,
      href,
      label,
      measuredAt: now().toISOString(),
    };
  }

  function recordConversion(payload = {}) {
    if (!allowEvent()) {
      return { ok: true, recorded: false, throttled: true };
    }

    const conversion = normalizeConversionPayload(payload);
    const targetLabel = conversion.target ? `${conversion.target} ` : '';
    appendDashboardActivity(
      {
        type: 'public_seo_conversion',
        title: 'Publieke SEO conversie',
        detail: `${targetLabel}CTA ${conversion.conversion} op ${conversion.page} vanaf ${conversion.landingPage}.`,
        source: 'public-seo',
        actor: 'website-bezoeker',
        createdAt: conversion.measuredAt,
      },
      'dashboard_activity_public_seo_conversion'
    );

    return {
      ok: true,
      recorded: true,
      conversion,
    };
  }

  function recordResponse(req, res) {
    try {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const result = recordConversion(body);
      return res.status(200).json(result);
    } catch (error) {
      logger.warn('[PublicConversion][Record]', error?.message || error);
      return res.status(error.status || 500).json({
        ok: false,
        error: error.status ? error.message : 'Conversie meten mislukt.',
      });
    }
  }

  return {
    normalizeConversionPayload,
    recordConversion,
    recordResponse,
  };
}

module.exports = {
  createPublicConversionTrackingService,
};
