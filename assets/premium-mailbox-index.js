(function () {
"use strict";

let syncInFlight = false;
let lastBackgroundSyncAt = 0;
const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_THREAD_HYDRATION_TARGETS = 40;
const MAILBOX_BODY_FETCH_ATTEMPTS = 3;
const MAILBOX_BODY_FETCH_TIMEOUT_MS = 6000;
const LEGACY_MAILBOX_MEDIA_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';

function normalizeText(value) {
  return String(value || '').trim();
}

function createAbortError() {
  const error = new Error('Mailbox body request geannuleerd.');
  error.name = 'AbortError';
  return error;
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
    indexed: Boolean(message.indexed),
  };
}

async function hydrateOutreachContexts({ getMails, setMails, renderList, getActiveMail, openMail, toast }) {
  if (window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.hydrate === 'function') {
    setMails(await window.SoftoraMailboxOutreach.hydrate(getMails()));
    renderList();
    if (getActiveMail()) openMail(getActiveMail(), { skipBodyFetch: true, skipReadPersist: true });
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
    await loadMessages({ showLoader: false, skipBackgroundSync: true });
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
}) {
  const mail = getMail(id);
  if (!mail || mail.bodyLoading) return;
  mail.bodyLoading = true;
  let exactBodyAvailable = Boolean(mail.bodyLoaded && normalizeText(mail.body));
  try {
    try {
      const { response: indexedResponse, data: indexedData } = await fetchMailboxBodyJson(fetch, '/api/mailbox/messages/bodies', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          messages: [{ account, folder, id: String(requestId || id) }],
        }),
      }, { signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
      const indexedMessage = Array.isArray(indexedData && indexedData.messages)
        ? indexedData.messages[0]
        : null;
      if (
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
          if (
            (typeof isCurrent !== 'function' || isCurrent()) &&
            typeof getActiveMail === 'function' &&
            String(getActiveMail()) === String(id)
          ) {
            openMail(id, { skipBodyFetch: true, skipReadPersist: true });
          }
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
    }, { signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
    if (!response.ok || !data?.ok || !data.message) {
      const error = new Error(data?.detail || data?.error || 'Bericht laden mislukt');
      error.status = response.status;
      throw error;
    }
    if (typeof isCurrent === 'function' && !isCurrent()) return;
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
  } catch (error) {
    if (typeof isCurrent === 'function' && !isCurrent()) return;
    mail.webdesignLinkHydrationAttempted = true;
    if (exactBodyAvailable || (mail.bodyLoaded && normalizeText(mail.body))) {
      mail.bodyLoadError = '';
      mail.bodyLoaded = true;
    } else {
      mail.bodyLoadError = getBodyLoadError(error, error?.status);
      mail.bodyLoaded = false;
    }
  } finally {
    mail.bodyLoading = false;
    if (
      (typeof isCurrent !== 'function' || isCurrent()) &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(id)
    ) {
      openMail(id, { skipBodyFetch: true, skipReadPersist: true });
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
  return { account, folder, id, uid: Number(message && message.uid) || 0 };
}

function applyThreadMessagePayload(message, source, normalizeBodyImages, normalizeOptOutUrl) {
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
  message.attachments = Array.isArray(source && source.attachments) ? source.attachments : [];
  const nextRouting = [message.to, message.toDisplay, message.cc, message.bcc, message.deliveredTo, message.recipientRoutingEvidenceKnown]
    .map((value) => String(value || ''))
    .join('|');
  return Boolean(body) || previousRouting !== nextRouting;
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
}) {
  const stillCurrent = () => typeof isCurrent !== 'function' || isCurrent();
  if (!stillCurrent()) return false;
  if (!mail || mail.threadBodiesLoading) return false;
  const messages = Array.isArray(targetMessages)
    ? targetMessages
    : Array.isArray(mail.threadMessages) ? mail.threadMessages : [];
  const pendingTargets = messages.filter((message) => (
    (retryFailed || !normalizeText(message && message.bodyLoadError)) &&
    (
      needsThreadBodyHydration(message) ||
      needsThreadImageHydration(message) ||
      needsThreadLinkHydration(message) ||
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
  mail.threadBodiesLoading = true;
  targets.forEach((message) => {
    message.bodyLoadError = '';
    message.bodyLoading = needsThreadBodyHydration(message);
  });
  if (
    typeof openMail === 'function' &&
    typeof getActiveMail === 'function' &&
    String(getActiveMail()) === String(mail.id)
  ) {
    openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true });
  }
  let updated = false;
  try {
    const targetByIdentity = new Map(
      targets.map((message) => {
        const reference = getThreadMessageRequest(message, mail);
        return [`${reference.account}|${reference.folder}|${reference.uid || reference.id}`, { message, reference }];
      })
    );
    const targetReferences = Array.from(targetByIdentity.values()).map(({ reference }) => reference);
    for (let offset = 0; offset < targetReferences.length; offset += 20) {
      try {
        const { response, data } = await fetchMailboxBodyJson(request, '/api/mailbox/messages/bodies', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            messages: targetReferences.slice(offset, offset + 20),
          }),
        }, { signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
        if (!response.ok || !data?.ok || !Array.isArray(data.messages)) {
          throw new Error(data?.detail || data?.error || 'Berichtinhoud laden mislukt');
        }
        if (!stillCurrent()) return false;
        data.messages.forEach((source) => {
          if (source && source.resolved === false) return;
          const identity = `${normalizeText(source.accountEmail).toLowerCase()}|${normalizeText(source.folder).toLowerCase()}|${Number(source.uid) || normalizeText(source.id)}`;
          const target = targetByIdentity.get(identity);
          if (!target) return;
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
      } catch (_) {
        // De gerichte detailfallback hieronder houdt oude of nog niet geïndexeerde berichten leesbaar.
      }
    }

    if (!stillCurrent()) return false;
    targets.forEach((message) => {
      message.bodyLoading = needsThreadBodyHydration(message);
    });
    if (
      typeof openMail === 'function' &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(mail.id)
    ) {
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true });
    }

    const detailTargets = targets.filter((message) => (
      needsThreadBodyHydration(message) ||
      needsThreadImageHydration(message) ||
      needsThreadLinkHydration(message) ||
      needsThreadRoutingHydration(message)
    ));
    for (let offset = 0; offset < detailTargets.length; offset += 2) {
      await Promise.all(detailTargets.slice(offset, offset + 2).map(async (message) => {
        const { account, folder, id } = getThreadMessageRequest(message, mail);
        if (!account || !id) {
          message.webdesignLinkHydrationAttempted = true;
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
          }, { signal, timeoutMs: bodyFetchTimeoutMs, retryDelayMs: bodyFetchRetryDelayMs });
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
          message.bodyLoadError = needsThreadBodyHydration(message)
            ? 'Volledig bericht is niet beschikbaar in het bronbericht.'
            : '';
        } catch (error) {
          if (stillCurrent() && !(error && error.name === 'AbortError')) {
            message.webdesignLinkHydrationAttempted = true;
            message.bodyLoadError = needsThreadBodyHydration(message)
              ? getBodyLoadError(error, error?.status)
              : '';
          }
        } finally {
          message.bodyLoading = false;
          message.imageLoading = false;
        }
      }));
    }
  } finally {
    targets.forEach((message) => {
      message.bodyLoading = false;
    });
    mail.threadBodiesLoading = false;
    if (
      stillCurrent() &&
      typeof openMail === 'function' &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(mail.id)
    ) {
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true, skipReadPersist: true });
    }
  }
  return updated;
}

function bindImageRecovery({ getActiveMail, getMail, loadMessageBody }) {
  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!image || !image.matches || !image.matches('[data-mailbox-inline-image]')) return;
    const figure = image.closest && image.closest('.detail-mail-image');
    if (figure) figure.hidden = true;
    const mail = getMail(getActiveMail());
    if (!mail || mail.bodyLoading || mail.imageRecoveryAttempted) return;
    mail.imageRecoveryAttempted = true;
    mail.bodyLoaded = false;
    mail.bodyImagesTruncated = true;
    void loadMessageBody(mail.id);
  }, true);
}

window.SoftoraMailboxIndex = {
  bindImageRecovery,
  decorateMessage,
  hydrateOutreachContexts,
  isSyncInFlight: () => syncInFlight,
  loadBody,
  loadThreadBodies,
  needsThreadLinkHydration,
  needsThreadImageHydration,
  needsThreadBodyHydration,
  needsThreadRoutingHydration,
  setStatus,
  syncInBackground,
};
})();
