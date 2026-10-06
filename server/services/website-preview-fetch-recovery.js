'use strict';

function httpRecoveryUrl(value, result) {
  const attempts = result?.attempts || [];
  // A server response (including a block page) is not a broken TLS connection.
  if (result?.ok || !attempts.length || attempts.some((attempt) => Number(attempt.status) !== 0)) return '';
  try {
    const url = new URL(value);
    // Only retrieve public website documents; never downgrade credentials, query
    // parameters or non-standard ports, and never disable certificate checking.
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.port) return '';
    url.protocol = 'http:';
    return url.href;
  } catch {
    return '';
  }
}

function createWebsitePreviewDocumentFetcher({ fetchDocument, assertPublic }) {
  return async (url, timeoutMs = 25000) => {
    const primary = await fetchDocument(url, timeoutMs);
    const recoveryUrl = httpRecoveryUrl(url, primary);
    if (!recoveryUrl) return primary;
    const checkedUrl = await assertPublic(recoveryUrl);
    const recovery = await fetchDocument(checkedUrl, Math.min(timeoutMs, 12000));
    return {
      ...(recovery.ok ? recovery : primary),
      attempts: [...primary.attempts, ...(recovery.attempts || [])],
      recoveredHttp: Boolean(recovery.ok),
    };
  };
}

function buildWebsitePreviewFetchError(attempts = []) {
  const lastAttemptWithStatus = [...attempts].reverse()
    .find((attempt) => Number.isFinite(attempt?.status) && attempt.status > 0);
  const status = lastAttemptWithStatus ? lastAttemptWithStatus.status : 502;
  const blocked = attempts.some((attempt) => attempt?.blocked || [401, 403, 406, 409, 429, 451].includes(Number(attempt?.status || 0)));
  const error = new Error(blocked
    ? `Kon deze website niet ophalen (${status}). Deze site blokkeert geautomatiseerde serververzoeken.`
    : `Kon deze website niet ophalen (${status}).`);
  error.status = status >= 400 && status < 600 ? status : 502;
  // A reader's 422 can mask the origin's temporary timeout or 5xx response.
  const originAttempts = attempts.filter((attempt) => attempt.mode !== 'reader-fallback');
  error.retryableWebsiteFetch = originAttempts.length > 0 && originAttempts.every((attempt) => {
    const status = Number(attempt.status);
    if (status === 429) return true;
    if (attempt.blocked) return false;
    if ([408, 425].includes(status) || status >= 500) return true;
    if (status !== 0) return false;
    // A nonexistent host or invalid certificate does not improve by retrying.
    return ['AbortError', 'TimeoutError'].includes(attempt.errorName) ||
      /^(EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|UND_ERR_(CONNECT_TIMEOUT|HEADERS_TIMEOUT|BODY_TIMEOUT|SOCKET))$/.test(attempt.errorCode || '');
  });
  return error;
}

module.exports = { createWebsitePreviewDocumentFetcher, buildWebsitePreviewFetchError };
