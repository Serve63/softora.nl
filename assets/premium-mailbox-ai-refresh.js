(function (global) {
  'use strict';
  // Read cached decisions only; this endpoint never calls the model.
  function create({ getMail, getActiveId, getOwner, openMail, fetchImpl = global.fetch,
    schedule = global.setTimeout, cancel = global.clearTimeout, delay = 15000 } = {}) {
    let timer = null, flight = false, generation = 0, storageAttempts = 0, target = null, targetOwner = null;
    function watch(mail) {
      if (!mail) return;
      if (target !== mail || targetOwner !== getOwner()) { stop(); target = mail; targetOwner = getOwner(); }
      if (timer || flight) return;
      const owner = getOwner(), id = mail.id, token = generation;
      const pending = [mail, ...(mail.threadMessages || [])].filter((m) => m.aiPresentation?.status === 'pending' ||
        (m.aiPresentation?.reason === 'storage' && storageAttempts < 3)).slice(0, 20);
      if (!pending.length) return;
      const current = () => token === generation && getOwner() === owner && getActiveId() === id && getMail(id) === mail;
      timer = schedule(async () => {
        timer = null;
        if (!current()) return;
        flight = true;
        if (pending.some((message) => message.aiPresentation?.reason === 'storage')) storageAttempts += 1;
        let changed = false;
        try {
          const snapshot = pending.map((message) => ({ message, body: message.body, ref: {
            account: message.accountEmail || mail.accountEmail,
            folder: (message.storageFolder || message.folder) === 'outreach' ? 'inbox' : message.storageFolder || message.folder || 'inbox',
            id: String(message.mailboxId || message.id || ''),
          } }));
          const response = await fetchImpl('/api/mailbox/messages/bodies', { method: 'POST', credentials: 'same-origin',
            cache: 'no-store', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: snapshot.map((item) => item.ref) }) });
          if (!response.ok) return;
          const data = await response.json();
          if (!current() || !data.ok) return;
          for (const item of snapshot) {
            const result = data.messages?.find((m) => m.id === item.ref.id && m.accountEmail === item.ref.account && m.folder === item.ref.folder);
            if (!result?.aiPresentation || item.message.body !== item.body || result.body !== item.body) continue;
            if (result.aiPresentation.status === 'ready' || (result.aiPresentation.status === 'unavailable' &&
              (item.message.aiPresentation?.status !== 'unavailable' || item.message.aiPresentation?.reason !== result.aiPresentation.reason))) {
              item.message.aiPresentation = result.aiPresentation;
              changed = true;
            }
          }
          if (changed) await openMail(id, { skipBodyFetch: true, skipReadPersist: true });
        } catch (_) { /* Preserve the visible message during temporary read failures. */ }
        finally { flight = false; watch(getMail(getActiveId())); }
      }, delay);
    }
    function stop() { generation += 1; storageAttempts = 0; if (timer) cancel(timer); timer = null; }
    return { watch, stop };
  }
  const api = { create };
  global.SoftoraMailboxAiRefresh = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
