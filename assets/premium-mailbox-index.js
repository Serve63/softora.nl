(function () {
"use strict";

let syncInFlight = false;
let lastBackgroundSyncAt = 0;
const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_THREAD_HYDRATION_TARGETS = 40;
const MAILBOX_BODY_FETCH_ATTEMPTS = 2;
const MAILBOX_BODY_FETCH_TIMEOUT_MS = 75_000;
const MAILBOX_BODY_REQUEST_DEADLINE_MS = 80_000;
const MAILBOX_BODY_PARTIAL_STATUS_DELAY_MS = 1200;
const visibleBodyLoadingDeadlines = new Map();
const LEGACY_MAILBOX_MEDIA_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeMessageId(value) {
  return normalizeText(value).toLowerCase().replace(/^[<\s]+|[>\s]+$/g, '');
}

function normalizeMessageIdValue(value) {
  return normalizeText(value).replace(/^[<\s]+|[>\s]+$/g, '');
}

function isValidMessageId(value) {
  return /^[^<>\s@]{1,240}@[^<>\s@]{1,240}$/.test(normalizeMessageId(value));
}

function hasProviderMessageIdHydrationEvidence(value) {
  const source = value && typeof value === 'object' ? value : {};
  return source.providerMessageIdHydrationEligible === true ||
    source.localAcceptedSend === true ||
    source.legacyAcceptedRoot === true ||
    (
      source.softoraThreadProvenanceKnown === true &&
      Boolean(normalizeText(source.softoraSendIntentId))
    );
}

function createAbortError() {
  const error = new Error('Mailbox body request geannuleerd.');
  error.name = 'AbortError';
  return error;
}

function createBodyDeadlineError() {
  const error = new Error('Laden duurde te lang. Opnieuw proberen.');
  error.name = 'TimeoutError';
  error.retryable = true;
  return error;
}

function createBodyLoadDeadline(parentSignal, requestedDeadlineMs) {
  const requested = Number(requestedDeadlineMs);
  const deadlineMs = Number.isFinite(requested) && requested > 0
    ? requested
    : MAILBOX_BODY_REQUEST_DEADLINE_MS;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let deadlineExpired = false;
  const abortFromParent = () => controller?.abort?.();
  parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  if (parentSignal?.aborted) abortFromParent();
  const timer = setTimeout(() => {
    deadlineExpired = true;
    controller?.abort?.();
  }, deadlineMs);
  return {
    signal: controller?.signal || parentSignal,
    expired: () => deadlineExpired,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

function clearVisibleBodyLoadingDeadline(id) {
  const key = String(id || '');
  const entry = visibleBodyLoadingDeadlines.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  visibleBodyLoadingDeadlines.delete(key);
}

function isRootBodyVisiblyPending(mail) {
  const source = mail && typeof mail === 'object' ? mail : {};
  if (normalizeText(source.bodyLoadError)) return false;
  const body = normalizeText(source.body);
  const hasBody = Boolean(source.hasBody || body);
  return Boolean(
    source.bodyLoading === true ||
    (
      hasBody &&
      (
        source.bodyLoaded === false ||
        !body ||
        source.bodyTruncated === true
      )
    )
  );
}

function isThreadBodyVisiblyPending(message) {
  if (!message || normalizeText(message.bodyLoadError)) return false;
  return message.bodyLoading === true || needsThreadBodyHydration(message);
}

function guardVisibleBodyLoading({ id, getMail, getActiveMail, getDetailElement, openMail }) {
  const key = String(id || '');
  if (!key || typeof getMail !== 'function' || typeof getActiveMail !== 'function') return false;
  for (const candidateId of Array.from(visibleBodyLoadingDeadlines.keys())) {
    if (candidateId !== key) clearVisibleBodyLoadingDeadline(candidateId);
  }
  const detail = typeof getDetailElement === 'function' ? getDetailElement() : null;
  const loadingIsVisible = Boolean(detail && String(detail.innerHTML || '').includes('Volledige inhoud wordt opgehaald…'));
  if (String(getActiveMail() || '') !== key || !loadingIsVisible) {
    clearVisibleBodyLoadingDeadline(key);
    return false;
  }
  if (visibleBodyLoadingDeadlines.has(key)) return true;
  const timer = setTimeout(() => {
    const entry = visibleBodyLoadingDeadlines.get(key);
    if (!entry || entry.timer !== timer) return;
    visibleBodyLoadingDeadlines.delete(key);
    if (String(getActiveMail() || '') !== key) return;
    const currentDetail = typeof getDetailElement === 'function' ? getDetailElement() : null;
    if (!currentDetail || !String(currentDetail.innerHTML || '').includes('Volledige inhoud wordt opgehaald…')) return;
    const mail = getMail(key);
    if (!mail) return;
    if (isRootBodyVisiblyPending(mail)) mail.bodyLoadState = 'partial';
    (Array.isArray(mail.threadMessages) ? mail.threadMessages : []).forEach((message) => {
      if (isThreadBodyVisiblyPending(message)) message.bodyLoadState = 'partial';
    });
    openMail?.(key, {
      skipBodyFetch: true,
      skipThreadBodyFetch: true,
      skipReadPersist: true,
      preserveVisibleDetail: true,
    });
  }, MAILBOX_BODY_PARTIAL_STATUS_DELAY_MS);
  visibleBodyLoadingDeadlines.set(key, { timer });
  return true;
}

function isRetryableBodyStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function waitForBodyRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(createAbortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(createAbortError());
    }, { once: true });
  });
}

async function fetchMailboxBodyJson(request, url, init = {}, options = {}) {
  const parentSignal = options.signal;
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || MAILBOX_BODY_FETCH_TIMEOUT_MS);
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 200);
  let lastError = null;
  for (let attempt = 0; attempt < MAILBOX_BODY_FETCH_ATTEMPTS; attempt += 1) {
    if (parentSignal?.aborted) throw createAbortError();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const abortFromParent = () => controller?.abort?.();
    parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
    let rejectForParentAbort = null;
    const parentAbortPromise = new Promise((_resolve, reject) => {
      rejectForParentAbort = () => reject(createAbortError());
      parentSignal?.addEventListener?.('abort', rejectForParentAbort, { once: true });
      if (parentSignal?.aborted) rejectForParentAbort();
    });
    let timedOut = false;
    let timeout = null;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller?.abort?.();
        const error = new Error('Mailbox body request duurde te lang.');
        error.name = 'TimeoutError';
        error.retryable = true;
        reject(error);
      }, timeoutMs);
    });
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => request(url, {
          ...init,
          ...(controller ? { signal: controller.signal } : parentSignal ? { signal: parentSignal } : {}),
        })),
        timeoutPromise,
        parentAbortPromise,
      ]);
      const data = await response.json().catch(() => ({}));
      if (response.ok || !isRetryableBodyStatus(response.status) || attempt === MAILBOX_BODY_FETCH_ATTEMPTS - 1) {
        return { response, data };
      }
      lastError = new Error(data?.detail || data?.error || 'Mailbox body tijdelijk niet bereikbaar.');
    } catch (error) {
      if (parentSignal?.aborted) throw createAbortError();
      lastError = error;
      if (!timedOut && error?.name === 'AbortError') throw error;
      if (attempt === MAILBOX_BODY_FETCH_ATTEMPTS - 1) break;
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      parentSignal?.removeEventListener?.('abort', abortFromParent);
      parentSignal?.removeEventListener?.('abort', rejectForParentAbort);
    }
    await waitForBodyRetry(retryDelayMs * (attempt + 1), parentSignal);
  }
  const error = new Error('Laden duurde te lang. Opnieuw proberen.');
  error.retryable = true;
  error.cause = lastError;
  throw error;
}

function getBodyLoadError(error, status) {
  if (Number(status) === 404) return 'Volledig bericht is niet beschikbaar in het bronbericht.';
  if (error?.name === 'AbortError') return '';
  if (error?.retryable || isRetryableBodyStatus(status)) return 'Laden duurde te lang. Opnieuw proberen.';
  return normalizeText(error?.message || error) || 'Volledig bericht kon niet worden geladen. Opnieuw proberen.';
}

function setStatus(message) {
  const el = document.getElementById('mail-sync-status');
  if (!el) return;
  const text = normalizeText(message);
  el.hidden = !text;
  el.textContent = text;
}

function hasUnverifiedLegacyMedia(message) {
  const source = message && typeof message === 'object' ? message : {};
  if (source.bodyImageEvidenceKnown === true) return false;
  const body = String(source.body || '');
  return body.includes(LEGACY_MAILBOX_MEDIA_CAPTION) || /^\s*\[image:\s*[^\]]+\]\s*$/im.test(body);
}

function decorateMessage(mail, source) {
  const message = source && typeof source === 'object' ? source : {};
  const legacyMediaNeedsHydration = hasUnverifiedLegacyMedia(message);
  const recipientRoutingNeedsHydration = message.recipientRoutingEvidenceKnown !== true;
  return {
    ...mail,
    hasBody: Boolean(message.hasBody || message.body),
    bodyLoaded:
      Boolean(message.body) &&
      !message.bodyTruncated &&
      !message.bodyImagesTruncated &&
      !legacyMediaNeedsHydration,
    bodyLoading: false,
    bodyTruncated: Boolean(message.bodyTruncated),
    bodyImagesTruncated: Boolean(message.bodyImagesTruncated),
    bodyImageEvidenceKnown: Boolean(message.bodyImageEvidenceKnown),
    safeBodyPreviewOnly: legacyMediaNeedsHydration,
    embeddedImageCount: Math.max(0, Math.min(8, Number(message.embeddedImageCount) || 0)),
    originalCampaignOutbound: Boolean(message.originalCampaignOutbound),
    webdesignLinkEvidenceKnown: Boolean(message.webdesignLinkEvidenceKnown),
    webdesignLinkHydrationAttempted: Boolean(
      message.webdesignLinkHydrationAttempted || message.webdesignLinkEvidenceKnown
    ),
    webdesignLinkUrl: normalizeText(message.webdesignLinkUrl),
    toDisplay: normalizeText(message.toDisplay),
    cc: normalizeText(message.cc),
    bcc: normalizeText(message.bcc),
    deliveredTo: normalizeText(message.deliveredTo),
    recipientRoutingEvidenceKnown: message.recipientRoutingEvidenceKnown === true,
    recipientRoutingNeedsHydration,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    attachmentEvidenceKnown: message.attachmentEvidenceKnown === true,
    attachmentHydrationAttempted: Boolean(
      message.attachmentHydrationAttempted || message.attachmentEvidenceKnown
    ),
    providerMessageIdHydrationEligible:
      hasProviderMessageIdHydrationEvidence(message) ||
      Boolean(mail && mail.providerMessageIdHydrationEligible),
    providerMessageIdHydrationAttempted: Boolean(
      message.providerMessageIdHydrationAttempted || mail && mail.providerMessageIdHydrationAttempted
    ),
    indexed: Boolean(message.indexed),
  };
}

async function hydrateOutreachContexts({ getMails, setMails, renderList, getActiveMail, openMail, toast }) {
  if (window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.hydrate === 'function') {
    setMails(await window.SoftoraMailboxOutreach.hydrate(getMails()));
    renderList();
    if (getActiveMail()) openMail(getActiveMail(), { skipBodyFetch: true, skipReadPersist: true, preserveVisibleDetail: true });
  }
  if (window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.applyIntentAfterLoad === 'function') {
    window.SoftoraMailboxOutreach.applyIntentAfterLoad({ getMails, openMail, renderList, toast });
  }
}

async function syncInBackground({ account, folder, loadMessages }) {
  if (syncInFlight) return;
  const now = Date.now();
  if (lastBackgroundSyncAt && now - lastBackgroundSyncAt < MIN_BACKGROUND_SYNC_INTERVAL_MS) return;
  lastBackgroundSyncAt = now;
  syncInFlight = true;
  setStatus('Mailbox bijwerken…');
  try {
    await fetch('/api/mailbox/sync', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ account, folder, limit: 50 }),
    });
    await loadMessages({
      showLoader: false,
      skipBackgroundSync: true,
      openLatest: false,
      preserveOnError: true,
      reuseActiveToken: true,
    });
    setStatus('');
  } catch (_) {
    setStatus('');
  } finally {
    syncInFlight = false;
  }
}

async function loadBody({
  id,
  requestId,
  getMail,
  account,
  folder,
  normalizeBodyImages,
  normalizeOptOutUrl,
  getActiveMail,
  openMail,
  isCurrent,
  signal,
  bodyFetchTimeoutMs,
  bodyFetchRetryDelayMs,
  bodyLoadDeadlineMs,
}) {
  const mail = getMail(id);
  if (!mail) return;
  const detailState = window.SoftoraMailboxDetailState;
  const flight = detailState?.begin?.(id, { partial: Boolean(normalizeText(mail.body || mail.preview)), signal });
  if (flight?.duplicate) return;
  const stillCurrent = () => (typeof isCurrent !== 'function' || isCurrent()) && (!flight || detailState.isCurrent(flight));
  const bodyLoadDeadline = createBodyLoadDeadline(flight?.controller?.signal || signal, bodyLoadDeadlineMs);
  const loadToken = {};
  mail.bodyLoadToken = loadToken;
  mail.bodyLoading = true;
  mail.bodyLoadState = normalizeText(mail.body || mail.preview) ? 'partial' : 'loading';
  let exactBodyAvailable = Boolean(mail.bodyLoaded && normalizeText(mail.body));
  let retryableFailure = false;
  let finalState = 'failed';
  try {
    try {
      const { response: indexedResponse, data: indexedData } = await fetchMailboxBodyJson(fetch, '/api/mailbox/messages/bodies', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Mailbox-Request-Id': `detail-${Number(flight?.generation) || 0}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
        body: JSON.stringify({
          messages: [{ account, folder, id: String(requestId || id) }],
        }),
      }, { signal: bodyLoadDeadline.signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
      const indexedMessage = Array.isArray(indexedData && indexedData.messages)
        ? indexedData.messages[0]
        : null;
      if (
        stillCurrent() &&
        indexedResponse.ok &&
        indexedData?.ok &&
        indexedMessage &&
        indexedMessage.resolved !== false
      ) {
        const indexedBody = normalizeText(indexedMessage.body || '');
        mail.body = indexedBody;
        mail.hasBody = Boolean(indexedMessage.hasBody || indexedBody);
        mail.bodyTruncated = Boolean(indexedMessage.bodyTruncated);
        mail.bodyLoaded = Boolean(
          !mail.bodyTruncated && (indexedBody || indexedMessage.hasBody === false)
        );
        mail.bodyImageEvidenceKnown = Boolean(indexedMessage.bodyImageEvidenceKnown);
        mail.embeddedImageCount = Math.max(
          0,
          Math.min(8, Number(indexedMessage.embeddedImageCount) || 0)
        );
        mail.originalCampaignOutbound = Boolean(indexedMessage.originalCampaignOutbound);
        mail.webdesignLinkEvidenceKnown = Boolean(indexedMessage.webdesignLinkEvidenceKnown);
        if (mail.webdesignLinkEvidenceKnown) mail.webdesignLinkHydrationAttempted = true;
        mail.webdesignLinkUrl = normalizeText(indexedMessage.webdesignLinkUrl);
        mail.to = normalizeText(indexedMessage.to || mail.to);
        mail.toDisplay = normalizeText(indexedMessage.toDisplay || indexedMessage.to || mail.toDisplay || mail.to);
        mail.cc = normalizeText(indexedMessage.cc);
        mail.bcc = normalizeText(indexedMessage.bcc);
        mail.deliveredTo = normalizeText(indexedMessage.deliveredTo);
        mail.recipientRoutingEvidenceKnown = indexedMessage.recipientRoutingEvidenceKnown === true;
        mail.recipientRoutingNeedsHydration = !mail.recipientRoutingEvidenceKnown;
        mail.attachments = Array.isArray(indexedMessage.attachments) ? indexedMessage.attachments : [];
        mail.attachmentEvidenceKnown = indexedMessage.attachmentEvidenceKnown === true;
        if (mail.attachmentEvidenceKnown) mail.attachmentHydrationAttempted = true;
        mail.bodyLoadError = '';
        exactBodyAvailable = Boolean(mail.bodyLoaded && normalizeText(mail.body));
        const needsLiveCampaignEnrichment = Boolean(
          mail.recipientRoutingNeedsHydration ||
          (mail.originalCampaignOutbound &&
          (
            !mail.bodyImageEvidenceKnown ||
            mail.embeddedImageCount > 0 ||
            !mail.webdesignLinkEvidenceKnown
          ))
        );
        if (mail.bodyLoaded && !needsLiveCampaignEnrichment) return;
        if (exactBodyAvailable) {
          mail.bodyLoading = false;
        }
      }
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      // De exacte detailroute hieronder blijft de fallback voor nog niet
      // geïndexeerde berichten en ontbrekende media- of linkprovenance.
    }
    const params = new URLSearchParams({ account, folder, id: String(requestId || id) });
    const { response, data } = await fetchMailboxBodyJson(fetch, `/api/mailbox/message?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    }, { signal: bodyLoadDeadline.signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
    if (!response.ok || !data?.ok || !data.message) {
      const error = new Error(data?.detail || data?.error || 'Bericht laden mislukt');
      error.status = response.status;
      throw error;
    }
    if (!stillCurrent()) return;
    const body = normalizeText(data.message.body || '');
    mail.body = body;
    mail.bodyImages = normalizeBodyImages(data.message.bodyImages || mail.bodyImages);
    mail.optOutUrl = normalizeOptOutUrl(data.message.optOutUrl || mail.optOutUrl);
    mail.hasBody = Boolean(data.message.hasBody || body);
    mail.bodyTruncated = Boolean(data.message.bodyTruncated);
    mail.bodyLoaded = Boolean(
      !mail.bodyTruncated &&
      (body || data.message.hasBody === false)
    );
    mail.bodyImagesTruncated = false;
    mail.bodyImageEvidenceKnown = Boolean(data.message.bodyImageEvidenceKnown);
    mail.embeddedImageCount = Math.max(
      0,
      Math.min(8, Number(data.message.embeddedImageCount) || 0)
    );
    mail.originalCampaignOutbound = Boolean(data.message.originalCampaignOutbound);
    mail.webdesignLinkEvidenceKnown = Boolean(data.message.webdesignLinkEvidenceKnown);
    mail.webdesignLinkHydrationAttempted = true;
    mail.webdesignLinkUrl = normalizeText(data.message.webdesignLinkUrl);
    mail.to = normalizeText(data.message.to || mail.to);
    mail.toDisplay = normalizeText(data.message.toDisplay || data.message.to || mail.toDisplay || mail.to);
    mail.cc = normalizeText(data.message.cc);
    mail.bcc = normalizeText(data.message.bcc);
    mail.deliveredTo = normalizeText(data.message.deliveredTo);
    mail.recipientRoutingEvidenceKnown = data.message.recipientRoutingEvidenceKnown === true;
    mail.recipientRoutingNeedsHydration = !mail.recipientRoutingEvidenceKnown;
    mail.attachments = Array.isArray(data.message.attachments) ? data.message.attachments : [];
    mail.attachmentEvidenceKnown = data.message.attachmentEvidenceKnown === true;
    mail.attachmentHydrationAttempted = true;
    mail.bodyLoadError = '';
    finalState = mail.bodyLoaded ? 'ready' : 'partial';
  } catch (error) {
    if (!stillCurrent()) return;
    if (bodyLoadDeadline.expired()) error = createBodyDeadlineError();
    const failureStatus = Number(error && error.status);
    retryableFailure = error?.name !== 'AbortError' && Boolean(
      error && error.retryable ||
      !Number.isFinite(failureStatus) ||
      isRetryableBodyStatus(failureStatus)
    );
    if (!retryableFailure && error?.name !== 'AbortError') {
      mail.webdesignLinkHydrationAttempted = true;
      mail.attachmentHydrationAttempted = true;
    }
    if (exactBodyAvailable || normalizeText(mail.body || mail.preview)) {
      mail.bodyLoadError = '';
      finalState = 'partial';
    } else {
      mail.bodyLoadError = getBodyLoadError(error, error?.status);
      mail.bodyLoaded = false;
      finalState = 'failed';
    }
  } finally {
    const currentAtFinish = stillCurrent();
    bodyLoadDeadline.cleanup();
    if (mail.bodyLoadToken === loadToken) {
      mail.bodyLoading = false;
      delete mail.bodyLoadToken;
    }
    if (currentAtFinish && mail.bodyLoaded) finalState = 'ready';
    detailState?.finish?.(flight, finalState);
    if (currentAtFinish) {
      if (retryableFailure && detailState?.scheduleRetry?.(flight, () => {
        mail.bodyLoadError = '';
        void loadBody({ id, requestId, getMail, account, folder, normalizeBodyImages, normalizeOptOutUrl, getActiveMail, openMail, isCurrent, signal, bodyFetchTimeoutMs, bodyFetchRetryDelayMs, bodyLoadDeadlineMs });
      })) {
        mail.bodyLoadState = 'retryScheduled';
        mail.bodyLoadError = '';
      } else {
        mail.bodyLoadState = finalState;
      }
      if (typeof getActiveMail === 'function' && String(getActiveMail()) === String(id)) {
        openMail(id, { skipBodyFetch: true, skipReadPersist: true, preserveVisibleDetail: true });
      }
    }
  }
}

function needsThreadBodyHydration(message) {
  const source = message && typeof message === 'object' ? message : {};
  const hasBody = Boolean(source.hasBody || source.body);
  return Boolean(
    hasBody &&
    (
      !normalizeText(source.body) ||
      source.bodyLoaded === false ||
      source.bodyTruncated ||
      source.bodyImagesTruncated
    )
  );
}

function needsThreadRoutingHydration(message) {
  const source = message && typeof message === 'object' ? message : {};
  return source.recipientRoutingEvidenceKnown !== true && source.recipientRoutingHydrationAttempted !== true;
}

function getThreadMessageRequest(message, mail) {
  const account = normalizeText(message && (message.accountEmail || mail && mail.accountEmail)).toLowerCase();
  const folder = normalizeText(message && (message.storageFolder || message.folder) || 'sent').toLowerCase() || 'sent';
  const id = normalizeText(message && (message.mailboxId || message.id));
  const uid = Number(message && message.uid) || 0;
  const requestMessageId = normalizeMessageIdValue(message && message.messageId);
  const canonicalMessageId = normalizeMessageId(requestMessageId);
  const uidlessMessageIdReference = Boolean(
    !uid &&
    ['sent', 'allmail'].includes(folder) &&
    isValidMessageId(canonicalMessageId)
  );
  const providerMessageIdLookup = Boolean(
    uidlessMessageIdReference &&
    hasProviderMessageIdHydrationEvidence(message) &&
    message && message.providerMessageIdHydrationAttempted !== true
  );
  return {
    account,
    folder,
    id,
    uid,
    ...(providerMessageIdLookup ? {
      messageId: `<${requestMessageId}>`,
      providerMessageIdHydrationEligible: true,
    } : {}),
    providerMessageIdLookup,
    uidlessMessageIdReference,
    canonicalMessageId: providerMessageIdLookup ? canonicalMessageId : '',
  };
}

function getThreadMessageRequestIdentity(reference) {
  if (!reference || !reference.account) return '';
  if (reference.uidlessMessageIdReference && !reference.providerMessageIdLookup) return '';
  if (reference.providerMessageIdLookup && reference.canonicalMessageId) {
    return `${reference.account}|message-id:${reference.canonicalMessageId}`;
  }
  const providerIdentity = reference.uid || normalizeText(reference.id);
  return providerIdentity ? `${reference.account}|${reference.folder}|${providerIdentity}` : '';
}

function getThreadMessageResponseIdentity(source) {
  const account = normalizeText(source && source.accountEmail).toLowerCase();
  const requestMessageId = normalizeMessageId(source && source.requestMessageId);
  if (account && requestMessageId) return `${account}|message-id:${requestMessageId}`;
  const folder = normalizeText(source && source.folder).toLowerCase();
  const providerIdentity = Number(source && source.uid) || normalizeText(source && source.id);
  return account && folder && providerIdentity ? `${account}|${folder}|${providerIdentity}` : '';
}

function applyThreadMessagePayload(message, source, normalizeBodyImages, normalizeOptOutUrl) {
  const previousEvidence = [
    message.bodyImageEvidenceKnown,
    message.webdesignLinkEvidenceKnown,
    message.webdesignLinkUrl,
    message.attachmentEvidenceKnown,
    JSON.stringify(Array.isArray(message.attachments) ? message.attachments : []),
  ].map((value) => String(value || '')).join('|');
  const body = normalizeText(source && source.body);
  if (body) {
    message.body = body;
    message.bodyTruncated = Boolean(source && source.bodyTruncated);
    message.bodyLoaded = !message.bodyTruncated;
  } else if (source && source.hasBody === false) {
    message.bodyTruncated = false;
    message.bodyLoaded = true;
  } else if (source && source.hasBody === true) {
    message.bodyLoaded = false;
  }
  if (typeof normalizeBodyImages === 'function' && Array.isArray(source && source.bodyImages)) {
    message.bodyImages = normalizeBodyImages(source.bodyImages);
    message.bodyImagesTruncated = false;
  }
  if (typeof normalizeOptOutUrl === 'function') {
    message.optOutUrl = normalizeOptOutUrl(source && source.optOutUrl || message.optOutUrl);
  }
  message.hasBody = Boolean(source && (source.hasBody || body || message.body));
  message.bodyImageEvidenceKnown = Boolean(source && source.bodyImageEvidenceKnown);
  message.embeddedImageCount = Math.max(0, Math.min(8, Number(source && source.embeddedImageCount) || 0));
  message.originalCampaignOutbound = Boolean(source && source.originalCampaignOutbound);
  message.webdesignLinkEvidenceKnown = Boolean(source && source.webdesignLinkEvidenceKnown);
  if (message.webdesignLinkEvidenceKnown) message.webdesignLinkHydrationAttempted = true;
  message.webdesignLinkUrl = normalizeText(source && source.webdesignLinkUrl);
  const previousRouting = [message.to, message.toDisplay, message.cc, message.bcc, message.deliveredTo, message.recipientRoutingEvidenceKnown]
    .map((value) => String(value || ''))
    .join('|');
  message.to = normalizeText(source && source.to || message.to);
  message.toDisplay = normalizeText(source && (source.toDisplay || source.to) || message.toDisplay || message.to);
  message.cc = normalizeText(source && source.cc);
  message.bcc = normalizeText(source && source.bcc);
  message.deliveredTo = normalizeText(source && source.deliveredTo);
  message.recipientRoutingEvidenceKnown = source && source.recipientRoutingEvidenceKnown === true;
  message.recipientRoutingHydrationAttempted = true;
  if (source && source.attachmentEvidenceKnown === true) {
    message.attachments = Array.isArray(source.attachments) ? source.attachments : [];
    message.attachmentEvidenceKnown = true;
    message.attachmentHydrationAttempted = true;
  }
  const nextRouting = [message.to, message.toDisplay, message.cc, message.bcc, message.deliveredTo, message.recipientRoutingEvidenceKnown]
    .map((value) => String(value || ''))
    .join('|');
  const nextEvidence = [
    message.bodyImageEvidenceKnown,
    message.webdesignLinkEvidenceKnown,
    message.webdesignLinkUrl,
    message.attachmentEvidenceKnown,
    JSON.stringify(Array.isArray(message.attachments) ? message.attachments : []),
  ].map((value) => String(value || '')).join('|');
  return Boolean(body) || previousRouting !== nextRouting || previousEvidence !== nextEvidence;
}

function needsThreadLinkHydration(message) {
  const source = message && typeof message === 'object' ? message : {};
  if (source.originalCampaignOutbound !== true) return false;
  if (source.webdesignLinkEvidenceKnown === true) return false;
  if (source.webdesignLinkHydrationAttempted === true) return false;
  const body = normalizeText(source.body || source.preview);
  if (!body || /https?:\/\/[^\s<>"']*\/webdesign\/[a-z0-9-]+/i.test(body)) return false;
  return /\b(?:webdesign|ontwerp)\b[\s\S]{0,240}\b(?:deze link|(?:open|bekijk) het via hier)\b/i.test(body);
}

function needsThreadAttachmentHydration(message) {
  const source = message && typeof message === 'object' ? message : {};
  if (source.attachmentEvidenceKnown === true) return false;
  if (source.attachmentHydrationAttempted === true) return false;
  const folder = normalizeText(source.storageFolder || source.folder).toLowerCase();
  return hasProviderMessageIdHydrationEvidence(source) &&
    !Number(source.uid) &&
    ['sent', 'allmail'].includes(folder) &&
    isValidMessageId(source.messageId);
}

function needsThreadImageHydration(message) {
  if (!message) return false;
  if (!message.bodyImageEvidenceKnown) return message.originalCampaignOutbound === true;
  const expectedImages = Math.max(0, Math.min(8, Number(message.embeddedImageCount) || 0));
  const loadedImages = Array.isArray(message.bodyImages) ? message.bodyImages.length : 0;
  return expectedImages > loadedImages;
}

async function loadThreadBodies({
  mail,
  normalizeBodyImages,
  normalizeOptOutUrl,
  getActiveMail,
  openMail,
  fetchImpl,
  isCurrent,
  signal,
  targetMessages,
  retryFailed = false,
  bodyFetchTimeoutMs,
  bodyFetchRetryDelayMs,
  bodyLoadDeadlineMs,
}) {
  const stillCurrent = () => typeof isCurrent !== 'function' || isCurrent();
  if (!stillCurrent()) return false;
  if (!mail) return false;
  const messages = Array.isArray(targetMessages)
    ? targetMessages
    : Array.isArray(mail.threadMessages) ? mail.threadMessages : [];
  const pendingTargets = messages.filter((message) => (
    (retryFailed || !normalizeText(message && message.bodyLoadError)) &&
    (
      needsThreadBodyHydration(message) ||
      needsThreadImageHydration(message) ||
      needsThreadLinkHydration(message) ||
      needsThreadAttachmentHydration(message) ||
      needsThreadRoutingHydration(message)
    )
  ));
  const targets = pendingTargets.slice(0, MAX_THREAD_HYDRATION_TARGETS);
  pendingTargets.slice(MAX_THREAD_HYDRATION_TARGETS).forEach((message) => {
    message.bodyLoading = false;
    message.bodyLoadError = needsThreadBodyHydration(message)
      ? 'Dit bericht wacht op een losse laadpoging.'
      : '';
  });
  if (!targets.length) return false;

  const request = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  const bodyLoadDeadline = createBodyLoadDeadline(signal, bodyLoadDeadlineMs);
  const loadToken = {};
  mail.threadBodiesLoadToken = loadToken;
  mail.threadBodiesLoading = true;
  targets.forEach((message) => {
    message.threadBodyLoadToken = loadToken;
    message.bodyLoadError = '';
    message.bodyLoading = needsThreadBodyHydration(message);
  });
  let updated = false;
  try {
    const targetEntries = targets.map((message) => {
        const reference = getThreadMessageRequest(message, mail);
        return { message, reference, identity: getThreadMessageRequestIdentity(reference) };
      });
    const targetByIdentity = new Map(
      targetEntries.filter(({ identity }) => identity).map((entry) => [entry.identity, entry])
    );
    const indexedReferences = targetEntries
      .filter(({ identity, reference }) => identity && !reference.providerMessageIdLookup)
      .map(({ reference }) => reference);
    const providerReferences = targetEntries
      .filter(({ identity, reference }) => identity && reference.providerMessageIdLookup)
      .map(({ reference }) => reference);
    const referenceBatches = [];
    for (let offset = 0; offset < indexedReferences.length; offset += 20) {
      referenceBatches.push(indexedReferences.slice(offset, offset + 20));
    }
    providerReferences.forEach((reference) => referenceBatches.push([reference]));
    for (const referenceBatch of referenceBatches) {
      try {
        const { response, data } = await fetchMailboxBodyJson(request, '/api/mailbox/messages/bodies', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            messages: referenceBatch.map((reference) => {
              const {
                providerMessageIdLookup,
                canonicalMessageId,
                uidlessMessageIdReference,
                ...payload
              } = reference;
              return payload;
            }),
          }),
        }, { signal: bodyLoadDeadline.signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
        if (!response.ok || !data?.ok || !Array.isArray(data.messages)) {
          throw new Error(data?.detail || data?.error || 'Berichtinhoud laden mislukt');
        }
        if (!stillCurrent()) return false;
        data.messages.forEach((source) => {
          const identity = getThreadMessageResponseIdentity(source);
          const target = targetByIdentity.get(identity);
          if (!target) return;
          if (source && source.resolved === false) {
            if (source.providerMessageIdLookup === true) {
              const retryable = source.providerLookupRetryable === true;
              target.message.providerMessageIdHydrationRetryable = retryable;
              if (!retryable) {
                target.message.providerMessageIdHydrationAttempted = true;
                target.message.webdesignLinkHydrationAttempted = true;
                target.message.attachmentHydrationAttempted = true;
                target.message.recipientRoutingHydrationAttempted = true;
              }
            }
            return;
          }
          delete target.message.providerMessageIdHydrationRetryable;
          target.message.providerMessageIdHydrationAttempted = true;
          updated = applyThreadMessagePayload(
            target.message,
            source,
            normalizeBodyImages,
            normalizeOptOutUrl
          ) || updated;
          if (!needsThreadBodyHydration(target.message)) {
            target.message.bodyLoadError = '';
          }
        });
      } catch (error) {
        if (bodyLoadDeadline.expired() || error?.name === 'AbortError') throw error;
        // De gerichte detailfallback hieronder houdt oude of nog niet geïndexeerde berichten leesbaar.
      }
    }

    if (!stillCurrent()) return false;
    targets.forEach((message) => {
      if (message.threadBodyLoadToken === loadToken) message.bodyLoading = needsThreadBodyHydration(message);
    });

    const detailTargets = targets.filter((message) => (
      needsThreadBodyHydration(message) ||
      needsThreadImageHydration(message) ||
      needsThreadLinkHydration(message) ||
      needsThreadAttachmentHydration(message) ||
      needsThreadRoutingHydration(message)
    ) && !getThreadMessageRequest(message, mail).uidlessMessageIdReference);
    for (let offset = 0; offset < detailTargets.length; offset += 2) {
      await Promise.all(detailTargets.slice(offset, offset + 2).map(async (message) => {
        const { account, folder, id } = getThreadMessageRequest(message, mail);
        if (!account || !id) {
          message.webdesignLinkHydrationAttempted = true;
          message.attachmentHydrationAttempted = true;
          message.bodyLoadError = needsThreadBodyHydration(message)
            ? 'Volledig bericht kon niet worden geladen.'
            : '';
          return;
        }
        message.imageLoading = true;
        message.bodyLoading = needsThreadBodyHydration(message);
        try {
          const params = new URLSearchParams({ account, folder, id });
          const { response, data } = await fetchMailboxBodyJson(request, `/api/mailbox/message?${params.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          }, { signal: bodyLoadDeadline.signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
          if (!response.ok || !data?.ok || !data.message) {
            const error = new Error(data?.detail || data?.error || 'Volledig bericht kon niet worden geladen.');
            error.status = response.status;
            throw error;
          }
          if (!stillCurrent()) return;
          updated = applyThreadMessagePayload(
            message,
            data.message,
            normalizeBodyImages,
            normalizeOptOutUrl
          ) || updated;
          message.webdesignLinkHydrationAttempted = true;
          message.attachmentHydrationAttempted = true;
          message.bodyLoadError = needsThreadBodyHydration(message)
            ? 'Volledig bericht is niet beschikbaar in het bronbericht.'
            : '';
        } catch (error) {
          if (bodyLoadDeadline.expired() || error?.name === 'AbortError') throw error;
          if (stillCurrent() && !(error && error.name === 'AbortError')) {
            const status = Number(error && error.status);
            const retryable = Boolean(
              error && error.retryable ||
              !Number.isFinite(status) ||
              isRetryableBodyStatus(status)
            );
            if (!retryable) {
              message.webdesignLinkHydrationAttempted = true;
              message.attachmentHydrationAttempted = true;
            }
            message.bodyLoadError = needsThreadBodyHydration(message)
              ? getBodyLoadError(error, error?.status)
              : '';
          }
        } finally {
          if (message.threadBodyLoadToken === loadToken) {
            message.bodyLoading = false;
            message.imageLoading = false;
          }
        }
      }));
    }
  } catch (error) {
    if (stillCurrent() && bodyLoadDeadline.expired()) {
      targets.forEach((message) => {
        message.bodyLoadError = needsThreadBodyHydration(message)
          ? getBodyLoadError(createBodyDeadlineError())
          : '';
      });
    }
  } finally {
    bodyLoadDeadline.cleanup();
    targets.forEach((message) => {
      if (message.threadBodyLoadToken !== loadToken) return;
      message.bodyLoading = false;
      message.imageLoading = false;
      delete message.threadBodyLoadToken;
    });
    if (mail.threadBodiesLoadToken === loadToken) {
      mail.threadBodiesLoading = false;
      delete mail.threadBodiesLoadToken;
    }
    if (
      stillCurrent() &&
      typeof openMail === 'function' &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(mail.id)
    ) {
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true, preserveVisibleDetail: true });
    }
  }
  return updated;
}

function retryBody({ id, getMail, loadMessageBody, openMail }) {
  const mail = typeof getMail === 'function' ? getMail(id) : null;
  if (!mail || mail.bodyLoading || typeof loadMessageBody !== 'function') return false;
  mail.bodyLoadError = '';
  mail.bodyLoading = false;
  mail.bodyLoaded = false;
  void loadMessageBody(mail.id, { forceRootHydration: true });
  return true;
}

function bindImageRecovery({ getActiveMail, getMail, loadMessageBody, openMail }) {
  document.addEventListener('click', (event) => {
    const action = event.target?.closest?.('[data-mailbox-action="retry-mail-body"]');
    if (!action) return;
    retryBody({ id: action.getAttribute('data-mailbox-id'), getMail, loadMessageBody, openMail });
  });
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!image || !image.matches || !image.matches('[data-mailbox-inline-image]')) return;
    const detail = image.closest?.('.mail-detail');
    if (!detail || detail !== document.getElementById?.('mail-detail')) return;
    const pendingId = String(detail.dataset?.mailboxPendingId || '');
    const committedId = String(detail?.dataset?.mailboxCommittedId || '');
    if (!committedId || committedId !== String(getActiveMail() || '')) return;
    if (detail.dataset) detail.dataset.mailboxDomDirty = 'true';
    if (pendingId) return;
    const figure = image.closest && image.closest('.detail-mail-image');
    figure?.classList?.add?.('is-image-error');
    if (image.style) image.style.visibility = 'hidden';
    const mail = getMail(committedId);
    if (!mail || mail.bodyLoading || mail.imageRecoveryAttempted) return;
    const source = String(image.getAttribute?.('src') || image.currentSrc || image.src || '').trim();
    window.SoftoraMailboxImages?.invalidate?.(source);
    mail.imageRecoveryAttempted = true;
    mail.bodyLoaded = false;
    mail.bodyImagesTruncated = true;
    void loadMessageBody(mail.id, { preserveVisibleDetail: true });
  }, true);
}

window.SoftoraMailboxIndex = {
  bindImageRecovery,
  decorateMessage,
  guardVisibleBodyLoading,
  hydrateOutreachContexts,
  isSyncInFlight: () => syncInFlight,
  loadBody,
  loadThreadBodies,
  needsThreadAttachmentHydration,
  needsThreadLinkHydration,
  needsThreadImageHydration,
  needsThreadBodyHydration,
  needsThreadRoutingHydration,
  retryBody,
  setStatus,
  syncInBackground,
};
})();
