(function () {
"use strict";

let syncInFlight = false;
let lastBackgroundSyncAt = 0;
const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const MAX_THREAD_HYDRATION_TARGETS = 40;
const LEGACY_MAILBOX_MEDIA_CAPTION =
  'Hieronder zie je een korte indruk van de eerste versie op verschillende schermen.';

function normalizeText(value) {
  return String(value || '').trim();
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
  const recipientRoutingNeedsHydration = (
    message.recipientRoutingEvidenceKnown !== true &&
    window.SoftoraMailboxCampaignInbox?.isCampaignAccount?.(message.email) &&
    !String(message.to || '').toLowerCase().includes(String(message.accountEmail || '').toLowerCase())
  );
  return {
    ...mail,
    hasBody: Boolean(message.hasBody || message.body),
    bodyLoaded:
      Boolean(message.body) &&
      !message.bodyTruncated &&
      !message.bodyImagesTruncated &&
      !legacyMediaNeedsHydration &&
      !recipientRoutingNeedsHydration,
    bodyLoading: false,
    bodyTruncated: Boolean(message.bodyTruncated),
    bodyImagesTruncated: Boolean(message.bodyImagesTruncated),
    bodyImageEvidenceKnown: Boolean(message.bodyImageEvidenceKnown),
    embeddedImageCount: Math.max(0, Math.min(8, Number(message.embeddedImageCount) || 0)),
    originalCampaignOutbound: Boolean(message.originalCampaignOutbound),
    webdesignLinkEvidenceKnown: Boolean(message.webdesignLinkEvidenceKnown),
    webdesignLinkUrl: normalizeText(message.webdesignLinkUrl),
    toDisplay: normalizeText(message.toDisplay),
    cc: normalizeText(message.cc),
    bcc: normalizeText(message.bcc),
    deliveredTo: normalizeText(message.deliveredTo),
    recipientRoutingEvidenceKnown: message.recipientRoutingEvidenceKnown === true,
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    indexed: Boolean(message.indexed),
  };
}

async function hydrateOutreachContexts({ getMails, setMails, renderList, getActiveMail, openMail, toast }) {
  if (window.SoftoraMailboxOutreach && typeof window.SoftoraMailboxOutreach.hydrate === 'function') {
    setMails(await window.SoftoraMailboxOutreach.hydrate(getMails()));
    renderList();
    if (getActiveMail()) openMail(getActiveMail(), { skipBodyFetch: true });
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
}) {
  const mail = getMail(id);
  if (!mail || mail.bodyLoading) return;
  mail.bodyLoading = true;
  try {
    try {
      const indexedResponse = await fetch('/api/mailbox/messages/bodies', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(signal ? { signal } : {}),
        body: JSON.stringify({
          messages: [{ account, folder, id: String(requestId || id) }],
        }),
      });
      const indexedData = await indexedResponse.json().catch(() => ({}));
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
        mail.webdesignLinkUrl = normalizeText(indexedMessage.webdesignLinkUrl);
        mail.bodyLoadError = '';
        const needsLiveCampaignEnrichment = Boolean(
          mail.originalCampaignOutbound &&
          (
            !mail.bodyImageEvidenceKnown ||
            mail.embeddedImageCount > 0 ||
            !mail.webdesignLinkEvidenceKnown
          )
        );
        if (mail.bodyLoaded && !needsLiveCampaignEnrichment) return;
      }
    } catch (error) {
      if (error && error.name === 'AbortError') throw error;
      // De exacte detailroute hieronder blijft de fallback voor nog niet
      // geïndexeerde berichten en ontbrekende media- of linkprovenance.
    }
    const params = new URLSearchParams({ account, folder, id: String(requestId || id) });
    const response = await fetch(`/api/mailbox/message?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data.message) {
      throw new Error(data?.detail || data?.error || 'Bericht laden mislukt');
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
    mail.webdesignLinkUrl = normalizeText(data.message.webdesignLinkUrl);
    mail.to = normalizeText(data.message.to || mail.to);
    mail.toDisplay = normalizeText(data.message.toDisplay || data.message.to || mail.toDisplay || mail.to);
    mail.cc = normalizeText(data.message.cc);
    mail.bcc = normalizeText(data.message.bcc);
    mail.deliveredTo = normalizeText(data.message.deliveredTo);
    mail.recipientRoutingEvidenceKnown = data.message.recipientRoutingEvidenceKnown === true;
    mail.attachments = Array.isArray(data.message.attachments) ? data.message.attachments : [];
  } catch (error) {
    if (typeof isCurrent === 'function' && !isCurrent()) return;
    mail.bodyLoadError = String(error?.message || error || 'Bericht laden mislukt');
    mail.bodyLoaded = false;
  } finally {
    mail.bodyLoading = false;
    if (
      (typeof isCurrent !== 'function' || isCurrent()) &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(id)
    ) {
      openMail(id, { skipBodyFetch: true });
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
  message.webdesignLinkUrl = normalizeText(source && source.webdesignLinkUrl);
  message.attachments = Array.isArray(source && source.attachments) ? source.attachments : [];
  return Boolean(body);
}

function needsThreadLinkHydration(message) {
  const source = message && typeof message === 'object' ? message : {};
  if (source.originalCampaignOutbound !== true) return false;
  if (source.webdesignLinkEvidenceKnown === true) return false;
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
      needsThreadLinkHydration(message)
    )
  ));
  const targets = pendingTargets.slice(0, MAX_THREAD_HYDRATION_TARGETS);
  pendingTargets.slice(MAX_THREAD_HYDRATION_TARGETS).forEach((message) => {
    message.bodyLoading = false;
    message.bodyLoadError = 'Dit bericht wacht op een losse laadpoging.';
  });
  if (!targets.length) return false;

  const request = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  mail.threadBodiesLoading = true;
  targets.forEach((message) => {
    message.bodyLoadError = '';
    message.bodyLoading =
      needsThreadBodyHydration(message) ||
      needsThreadLinkHydration(message);
  });
  if (
    typeof openMail === 'function' &&
    typeof getActiveMail === 'function' &&
    String(getActiveMail()) === String(mail.id)
  ) {
    openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true });
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
        const response = await request('/api/mailbox/messages/bodies', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          ...(signal ? { signal } : {}),
          body: JSON.stringify({
            messages: targetReferences.slice(offset, offset + 20),
          }),
        });
        const data = await response.json().catch(() => ({}));
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
          if (!needsThreadBodyHydration(target.message) && !needsThreadLinkHydration(target.message)) {
            target.message.bodyLoadError = '';
          }
        });
      } catch (_) {
        // De gerichte detailfallback hieronder houdt oude of nog niet geïndexeerde berichten leesbaar.
      }
    }

    if (!stillCurrent()) return false;
    targets.forEach((message) => {
      message.bodyLoading =
        needsThreadBodyHydration(message) ||
        needsThreadLinkHydration(message);
    });
    if (
      typeof openMail === 'function' &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(mail.id)
    ) {
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true });
    }

    const detailTargets = targets.filter((message) => (
      needsThreadBodyHydration(message) ||
      needsThreadImageHydration(message) ||
      needsThreadLinkHydration(message)
    ));
    for (let offset = 0; offset < detailTargets.length; offset += 2) {
      await Promise.all(detailTargets.slice(offset, offset + 2).map(async (message) => {
        const { account, folder, id } = getThreadMessageRequest(message, mail);
        if (!account || !id) {
          message.bodyLoadError = 'Volledig bericht kon niet worden geladen.';
          return;
        }
        message.imageLoading = true;
        message.bodyLoading =
          needsThreadBodyHydration(message) ||
          needsThreadLinkHydration(message);
        try {
          const params = new URLSearchParams({ account, folder, id });
          const response = await request(`/api/mailbox/message?${params.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
            ...(signal ? { signal } : {}),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.ok || !data.message) {
            throw new Error(data?.detail || data?.error || 'Volledig bericht kon niet worden geladen.');
          }
          if (!stillCurrent()) return;
          updated = applyThreadMessagePayload(
            message,
            data.message,
            normalizeBodyImages,
            normalizeOptOutUrl
          ) || updated;
          message.bodyLoadError = (
            needsThreadBodyHydration(message) || needsThreadLinkHydration(message)
          ) ? 'Volledig bericht kon niet worden geladen.' : '';
        } catch (error) {
          if (stillCurrent() && !(error && error.name === 'AbortError')) {
            message.bodyLoadError = (
              needsThreadBodyHydration(message) || needsThreadLinkHydration(message)
            ) ? 'Volledig bericht kon niet worden geladen.' : '';
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
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true });
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
  setStatus,
  syncInBackground,
};
})();
