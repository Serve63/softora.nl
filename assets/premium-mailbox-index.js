(function () {
"use strict";

let syncInFlight = false;

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
    bodyLoaded: Boolean(message.body),
    bodyLoading: false,
    bodyTruncated: Boolean(message.bodyTruncated),
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
  getMail,
  account,
  folder,
  normalizeBodyImages,
  normalizeOptOutUrl,
  openMail,
}) {
  const mail = getMail(id);
  if (!mail || mail.bodyLoading) return;
  mail.bodyLoading = true;
  try {
    const params = new URLSearchParams({ account, folder, id: String(id) });
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
  } catch (error) {
    mail.body = String(error?.message || error || 'Bericht laden mislukt');
    mail.bodyLoaded = true;
  } finally {
    mail.bodyLoading = false;
    openMail(id, { skipBodyFetch: true });
  }
}

window.SoftoraMailboxIndex = {
  decorateMessage,
  hydrateOutreachContexts,
  isSyncInFlight: () => syncInFlight,
  loadBody,
  setStatus,
  syncInBackground,
};
})();
