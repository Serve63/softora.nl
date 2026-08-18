'use strict';

function createLeadRadarSourceVerifier({ fetchImpl = globalThis.fetch, normalizeHttpUrl, getPublicPagePublicationDetails }) {
  async function verifyPublicSource(url) {
    const normalized = normalizeHttpUrl(url);
    if (!normalized || typeof fetchImpl !== 'function') return { available: true, publication: null };
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 5_000) : null;
    try {
      const response = await fetchImpl(normalized, {
        method: 'GET',
        redirect: 'follow',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller?.signal,
      });
      if ([404, 410].includes(Number(response.status))) return { available: false, publication: null };
      const body = await response.text().catch(() => '');
      const unavailable = /(this content isn't available|this page isn't available|content is not available|pagina is niet beschikbaar|pagina niet gevonden)/i.test(body);
      return {
        available: !unavailable,
        publication: getPublicPagePublicationDetails(body, new Date().toISOString()),
      };
    } catch {
      // A platform timeout or bot protection is inconclusive; do not discard a
      // possibly valid public lead because our server could not inspect it.
      return { available: true, publication: null };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  return { verifyPublicSource };
}

module.exports = { createLeadRadarSourceVerifier };

