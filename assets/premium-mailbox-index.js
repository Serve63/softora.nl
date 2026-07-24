(function () {
"use strict";

let syncInFlight = false;
let lastBackgroundSyncAt = 0;
const MIN_BACKGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;

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

function decorateMessage(mail, source) {
  const message = source && typeof source === 'object' ? source : {};
  return {
    ...mail,
    hasBody: Boolean(message.hasBody || message.body),
    bodyLoaded: Boolean(message.body) && !message.bodyTruncated && !message.bodyImagesTruncated,
    bodyLoading: false,
    bodyTruncated: Boolean(message.bodyTruncated),
    bodyImagesTruncated: Boolean(message.bodyImagesTruncated),
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
}) {
  const mail = getMail(id);
  if (!mail || mail.bodyLoading) return;
  mail.bodyLoading = true;
  try {
    const params = new URLSearchParams({ account, folder, id: String(requestId || id) });
    const response = await fetch(`/api/mailbox/message?${params.toString()}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data.message) {
      throw new Error(data?.detail || data?.error || 'Bericht laden mislukt');
    }
    const body = normalizeText(data.message.body || '');
    mail.body = body || mail.preview || '';
    mail.bodyImages = normalizeBodyImages(data.message.bodyImages || mail.bodyImages);
    mail.optOutUrl = normalizeOptOutUrl(data.message.optOutUrl || mail.optOutUrl);
    mail.bodyLoaded = true;
    mail.hasBody = Boolean(data.message.hasBody || body);
    mail.bodyTruncated = Boolean(data.message.bodyTruncated);
    mail.bodyImagesTruncated = false;
  } catch (error) {
    if (!mail.body) {
      mail.body = String(error?.message || error || 'Bericht laden mislukt');
      mail.bodyLoaded = true;
    }
  } finally {
    mail.bodyLoading = false;
    if (typeof getActiveMail === 'function' && String(getActiveMail()) === String(id)) {
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
      source.bodyTruncated ||
      source.bodyImagesTruncated
    )
  );
}

function getThreadMessageRequest(message, mail) {
  const account = normalizeText(message && (message.accountEmail || mail && mail.accountEmail)).toLowerCase();
  const folder = normalizeText(message && message.folder || 'sent').toLowerCase() || 'sent';
  const id = normalizeText(message && (message.mailboxId || message.id));
  return { account, folder, id, uid: Number(message && message.uid) || 0 };
}

function applyThreadMessagePayload(message, source, normalizeBodyImages, normalizeOptOutUrl) {
  const body = normalizeText(source && source.body);
  if (body) {
    message.body = body;
    message.bodyTruncated = Boolean(source && source.bodyTruncated);
  } else if (source && source.hasBody === false) {
    message.bodyTruncated = false;
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
  return Boolean(body);
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
}) {
  if (!mail || mail.threadBodiesLoading) return false;
  const messages = Array.isArray(mail.threadMessages) ? mail.threadMessages : [];
  const targets = messages.filter((message) => (
    needsThreadBodyHydration(message) || needsThreadImageHydration(message)
  ));
  if (!targets.length) return false;

  const request = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  mail.threadBodiesLoading = true;
  targets.forEach((message) => {
    message.bodyLoading = needsThreadBodyHydration(message);
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
          body: JSON.stringify({
            messages: targetReferences.slice(offset, offset + 20),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok || !Array.isArray(data.messages)) {
          throw new Error(data?.detail || data?.error || 'Berichtinhoud laden mislukt');
        }
        data.messages.forEach((source) => {
          const identity = `${normalizeText(source.accountEmail).toLowerCase()}|${normalizeText(source.folder).toLowerCase()}|${Number(source.uid) || normalizeText(source.id)}`;
          const target = targetByIdentity.get(identity);
          if (!target) return;
          updated = applyThreadMessagePayload(
            target.message,
            source,
            normalizeBodyImages,
            normalizeOptOutUrl
          ) || updated;
        });
      } catch (_) {
        // De gerichte detailfallback hieronder houdt oude of nog niet geïndexeerde berichten leesbaar.
      }
    }

    targets.forEach((message) => {
      message.bodyLoading = false;
    });
    if (
      typeof openMail === 'function' &&
      typeof getActiveMail === 'function' &&
      String(getActiveMail()) === String(mail.id)
    ) {
      openMail(mail.id, { skipBodyFetch: true, skipThreadBodyFetch: true });
    }

    const detailTargets = targets.filter((message) => (
      needsThreadBodyHydration(message) || needsThreadImageHydration(message)
    ));
    for (let offset = 0; offset < detailTargets.length; offset += 2) {
      await Promise.all(detailTargets.slice(offset, offset + 2).map(async (message) => {
        const { account, folder, id } = getThreadMessageRequest(message, mail);
        if (!account || !id) return;
        message.imageLoading = true;
        message.bodyLoading = needsThreadBodyHydration(message);
        try {
          const params = new URLSearchParams({ account, folder, id });
          const response = await request(`/api/mailbox/message?${params.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data?.ok || !data.message) return;
          updated = applyThreadMessagePayload(
            message,
            data.message,
            normalizeBodyImages,
            normalizeOptOutUrl
          ) || updated;
        } catch (_) {
          // Keep the safe preview in place; reopening the conversation retries.
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
  needsThreadImageHydration,
  needsThreadBodyHydration,
  setStatus,
  syncInBackground,
};
})();
