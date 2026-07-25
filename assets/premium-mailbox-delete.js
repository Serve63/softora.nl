(function (global) {
  function normalize(value) {
    return String(value || '').trim();
  }

  function create(options = {}) {
    const hiddenMessageKeys = new Set();

    function getMessageKey(mail) {
      const account = normalize(options.getAccount?.(mail)).toLowerCase();
      const folder = normalize(options.getFolder?.(mail) || 'inbox').toLowerCase() || 'inbox';
      const uid = Number(mail && mail.uid) || 0;
      const id = normalize(options.getRequestId?.(mail) || mail && mail.id);
      return `${account}|${folder}|${uid > 0 ? `uid:${uid}` : `id:${id}`}`;
    }

    function filterMessages(messages) {
      return (Array.isArray(messages) ? messages : []).filter(
        (mail) => !hiddenMessageKeys.has(getMessageKey(mail))
      );
    }

    async function confirmDeletion(mail) {
      const subject = normalize(mail && mail.subject) || 'deze mail';
      const message = `Wil je "${subject}" alleen uit de Softora-mailbox verbergen? De echte e-mail blijft ongewijzigd in Gmail, IMAP en andere gekoppelde mailboxen.`;
      const dialogOptions = {
        title: 'Gesprek verbergen in Softora',
        confirmText: 'Verbergen',
        cancelText: 'Annuleren',
      };
      const dialogs = options.getDialogs?.() || options.dialogs || global.SoftoraDialogs;
      if (dialogs && typeof dialogs.confirm === 'function') {
        return dialogs.confirm(message, dialogOptions);
      }
      return typeof options.confirm === 'function' ? options.confirm(message) : false;
    }

    function getConversationTargets(mail) {
      const candidates = [
        mail,
        ...(Array.isArray(mail && mail.threadMessages) ? mail.threadMessages : []),
      ];
      const seen = new Set();
      return candidates.map((message) => {
        const account = normalize(options.getAccount?.(message) || message && message.accountEmail).toLowerCase();
        const folder = normalize(options.getFolder?.(message) || message && message.folder || 'inbox').toLowerCase() || 'inbox';
        const uid = Number(message && message.uid) || 0;
        const id = normalize(options.getRequestId?.(message) || message && message.id);
        const key = `${account}|${folder}|${uid > 0 ? `uid:${uid}` : `id:${id}`}`;
        if (!account || (!uid && !id) || seen.has(key)) return null;
        seen.add(key);
        return { account, folder, uid, id };
      }).filter(Boolean);
    }

    async function requestVisibility(mail, action) {
      const targets = getConversationTargets(mail);
      const root = targets[0] || {};
      const response = await options.fetch(`/api/mailbox/messages/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          owner: normalize(options.getOwner?.()),
          account: root.account,
          id: root.id,
          uid: root.uid,
          folder: root.folder,
          messages: targets,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || (
          action === 'restore' ? 'Gesprek herstellen mislukt' : 'Gesprek verbergen mislukt'
        ));
      }
      return data;
    }

    async function remove(mail, hooks = {}) {
      if (!mail || !(await confirmDeletion(mail))) return { ok: false, cancelled: true };
      const messageKey = getMessageKey(mail);
      hiddenMessageKeys.add(messageKey);
      const transaction = hooks.optimistic?.(mail);
      try {
        const data = await requestVisibility(mail, 'hide');
        options.removeCached?.(mail);
        hooks.commit?.(mail, transaction, data);
        return { ok: true, data };
      } catch (error) {
        hiddenMessageKeys.delete(messageKey);
        hooks.rollback?.(mail, transaction, error);
        options.toast?.(String(error?.message || error || 'Gesprek verbergen mislukt'));
        return { ok: false, error };
      }
    }

    async function restore(mail) {
      if (!mail) return { ok: false };
      try {
        const data = await requestVisibility(mail, 'restore');
        hiddenMessageKeys.delete(getMessageKey(mail));
        options.restoreCached?.(mail);
        return { ok: true, data };
      } catch (error) {
        options.toast?.(String(error?.message || error || 'Gesprek herstellen mislukt'));
        return { ok: false, error };
      }
    }

    return {
      filterMessages,
      remove,
      restore,
    };
  }

  const api = { create };
  global.SoftoraMailboxDelete = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
