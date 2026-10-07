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
  const originAttempts = attempts.filter((attempt) => attempt.mode !== 'reader-fallback');
  const originResponse = [...originAttempts].reverse().find((attempt) => Number(attempt.status) >= 400);
  const fallbackResponse = [...attempts].reverse().find((attempt) => Number(attempt.status) >= 400);
  const status = Number((originResponse || fallbackResponse)?.status) || 502;
  const transportOnly = originAttempts.length > 0 && originAttempts.every((attempt) => Number(attempt.status) === 0);
  const dnsMissing = transportOnly && originAttempts.every((attempt) => /^(ENOTFOUND|EAI_NONAME)$/.test(attempt.errorCode || ''));
  const tlsFailure = transportOnly && originAttempts.some((attempt) => /CERT_|^ERR_TLS_|SELF_SIGNED|UNABLE_TO_VERIFY/.test(attempt.errorCode || ''));
  const blocked = originAttempts.some((attempt) => attempt.blocked);
  let code = 'WEBDESIGN_WEBSITE_FETCH_FAILED';
  let message = `Kon deze website niet ophalen (${status}).`;
  if (dnsMissing) {
    code = 'WEBDESIGN_WEBSITE_DNS_MISSING';
    message = 'Het websiteadres is niet te vinden in DNS. Controleer het domein van dit bedrijf.';
  } else if (tlsFailure) {
    code = 'WEBDESIGN_WEBSITE_TLS_FAILED';
    message = 'De beveiligde verbinding met deze website werkt niet; ook via HTTP is geen bruikbare website gevonden.';
  } else if (status === 404 || status === 410) {
    message = `De opgegeven websitepagina bestaat niet meer of is niet beschikbaar (${status}).`;
  } else if (status === 429) {
    message = 'De website staat tijdelijk geen extra verzoeken toe (429).';
  } else if ([408, 504, 522, 524].includes(status)) {
    message = `De website reageert niet op tijd (${status}).`;
  } else if (status === 401 || status === 403 || status === 451) {
    message = `De website weigert toegang (${status}); de bedrijfsinhoud kon niet worden gelezen.`;
  } else if (blocked) {
    message = 'De website toont een toegangscontrole of blokkeerpagina; de bedrijfsinhoud kon niet worden gelezen.';
  }
  const error = Object.assign(new Error(message), { status, code });
  // A reader's 422 can mask the origin's temporary timeout or 5xx response.
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
