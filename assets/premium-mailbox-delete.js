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
      const folder = normalize(options.getFolder?.(mail) || 'inbox').toLowerCase();
      const subject = normalize(mail && mail.subject) || 'deze mail';
      const permanent = folder === 'trash';
      const message = `Weet je zeker dat je "${subject}" wilt ${permanent ? 'definitief verwijderen' : 'naar de prullenbak verplaatsen'}?`;
      const dialogOptions = {
        title: permanent ? 'Mail definitief verwijderen' : 'Mail verwijderen',
        confirmText: permanent ? 'Definitief verwijderen' : 'Verwijderen',
        cancelText: 'Annuleren',
      };
      const dialogs = options.getDialogs?.() || options.dialogs || global.SoftoraDialogs;
      if (dialogs && typeof dialogs.confirm === 'function') {
        return dialogs.confirm(message, dialogOptions);
      }
      return typeof options.confirm === 'function' ? options.confirm(message) : false;
    }

    async function requestDeletion(mail) {
      const response = await options.fetch('/api/mailbox/messages/delete', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          account: options.getAccount?.(mail),
          id: options.getRequestId?.(mail),
          uid: mail && mail.uid,
          folder: options.getFolder?.(mail),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || 'Mail verwijderen mislukt');
      }
      return data;
    }

    async function remove(mail, hooks = {}) {
      if (!mail || !(await confirmDeletion(mail))) return { ok: false, cancelled: true };
      const messageKey = getMessageKey(mail);
      hiddenMessageKeys.add(messageKey);
      const transaction = hooks.optimistic?.(mail);
      try {
        const data = await requestDeletion(mail);
        options.removeCached?.(mail);
        hooks.commit?.(mail, transaction, data);
        options.toast?.(
          options.getFolder?.(mail) === 'trash'
            ? 'Mail definitief verwijderd'
            : 'Mail verplaatst naar prullenbak'
        );
        return { ok: true, data };
      } catch (error) {
        hiddenMessageKeys.delete(messageKey);
        hooks.rollback?.(mail, transaction, error);
        options.toast?.(String(error?.message || error || 'Mail verwijderen mislukt'));
        return { ok: false, error };
      }
    }

    return {
      filterMessages,
      remove,
    };
  }

  const api = { create };
  global.SoftoraMailboxDelete = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
