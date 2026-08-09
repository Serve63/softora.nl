(function (global) {
  'use strict';

  const DEFAULT_REQUEST_TIMEOUT_MS = 8 * 1000;

  function createAbortError(message) {
    const error = new Error(message || 'Mailboxaanvraag geannuleerd.');
    error.name = 'AbortError';
    return error;
  }

  async function requestJsonWithDeadline({
    request,
    url,
    init = {},
    signal,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    timeoutMessage = 'Mailboxaanvraag duurde te lang.',
    timeoutCode = 'MAILBOX_REQUEST_TIMEOUT',
    AbortController: AbortControllerImpl = global.AbortController,
    setTimeout: scheduleTimeout = global.setTimeout?.bind(global),
    clearTimeout: cancelTimeout = global.clearTimeout?.bind(global),
  } = {}) {
    if (typeof request !== 'function') throw new TypeError('Mailbox request ontbreekt.');
    const controller = typeof AbortControllerImpl === 'function'
      ? new AbortControllerImpl()
      : null;
    let timeoutId = 0;
    let rejectInterrupted;
    const interrupted = new Promise((_resolve, reject) => { rejectInterrupted = reject; });
    const abortFromParent = () => {
      controller?.abort?.();
      rejectInterrupted(createAbortError());
    };
    signal?.addEventListener?.('abort', abortFromParent, { once: true });
    if (typeof scheduleTimeout === 'function') {
      timeoutId = scheduleTimeout(() => {
        controller?.abort?.();
        const error = new Error(timeoutMessage);
        error.code = timeoutCode;
        rejectInterrupted(error);
      }, Math.max(1, Number(timeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS));
    }
    try {
      if (signal?.aborted) abortFromParent();
      const requestResult = (async () => {
        const response = await request(url, {
          ...init,
          ...(controller ? { signal: controller.signal } : signal ? { signal } : {}),
        });
        const data = await response.json().catch(() => ({}));
        return { response, data };
      })();
      return await Promise.race([requestResult, interrupted]);
    } finally {
      if (timeoutId) cancelTimeout?.(timeoutId);
      signal?.removeEventListener?.('abort', abortFromParent);
    }
  }

  function requestCampaignReplies(request, url, options = {}) {
    return requestJsonWithDeadline({
      request,
      url,
      init: {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      },
      signal: options.signal,
      timeoutMessage: 'Campagnereacties laden duurde te lang.',
      timeoutCode: 'MAILBOX_CAMPAIGN_REPLIES_TIMEOUT',
      AbortController: options.AbortController,
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
    });
  }

  function requestInitJson(url, timeoutCode, options = {}) {
    const request = options.request || global.fetch?.bind(global);
    return requestJsonWithDeadline({
      request,
      url,
      init: {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      },
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      timeoutMessage: 'Mailboxinitialisatie duurde te lang.',
      timeoutCode,
      AbortController: options.AbortController,
      setTimeout: options.setTimeout,
      clearTimeout: options.clearTimeout,
    });
  }

  const api = { DEFAULT_REQUEST_TIMEOUT_MS, requestCampaignReplies, requestInitJson, requestJsonWithDeadline };
  global.SoftoraMailboxRequestDeadline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
