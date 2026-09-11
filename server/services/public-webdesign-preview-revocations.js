const PUBLIC_PREVIEW_REVOKED_IDENTIFIERS = new Set([
  'kvk-98956612',
  'portivio-technology-b-v',
  'kvk-30138458',
  'adriaan-van-dam-fotografie',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function isPublicPreviewRevokedIdentifier(value) {
  return PUBLIC_PREVIEW_REVOKED_IDENTIFIERS.has(normalizeString(value).toLowerCase());
}

function isPublicPreviewRequestRevoked(req) {
  const query = req && req.query && typeof req.query === 'object' ? req.query : {};
  const params = req && req.params && typeof req.params === 'object' ? req.params : {};
  return [
    query.cid,
    query.customerId,
    query.id,
    params.companySlug,
    params.customerId,
  ].some(isPublicPreviewRevokedIdentifier);
}

function guardPublicPreviewResponse(handler, { buildNotFoundHtml, asset = false }) {
  return async function guardedPublicPreviewResponse(req, res) {
    if (!isPublicPreviewRequestRevoked(req)) return handler(req, res);
    if (!asset) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    }
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    return res.status(404).send(asset ? 'Preview image unavailable' : buildNotFoundHtml());
  };
}

module.exports = {
  guardPublicPreviewResponse,
  isPublicPreviewRequestRevoked,
};
