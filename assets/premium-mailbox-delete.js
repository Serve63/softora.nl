(function (global) {
  const VISIBILITY_PROTOCOL = 'atomic-contact-v1';

  function normalize(value) {
    return String(value || '').trim();
  }

  function create(options = {}) {
    const hiddenMessageKeys = new Set();
    const pendingMessageKeys = new Set();

    function getMessageKey(mail) {
      const account = normalize(options.getAccount?.(mail)).toLowerCase();
      const folder = normalize(options.getFolder?.(mail) || 'inbox').toLowerCase() || 'inbox';
      const uid = Number(mail && mail.uid) || 0;
      const id = normalize(options.getRequestId?.(mail) || mail && mail.id);
      return `${account}|${folder}|${uid > 0 ? `uid:${uid}` : `id:${id}`}`;
    }

    function filterMessages(messages) {
      return (Array.isArray(messages) ? messages : []).flatMap((mail) => {
        if (hiddenMessageKeys.has(getMessageKey(mail))) return [];
        if (!Array.isArray(mail && mail.threadMessages)) return [mail];
        const threadMessages = filterMessages(mail.threadMessages);
        return threadMessages.length === mail.threadMessages.length
          ? [mail]
          : [{ ...mail, threadMessages }];
      });
    }

    function getResolvedMessages(mail, data) {
      const resolved = data?.result?.resolvedMessages;
      return Array.isArray(resolved) && resolved.length ? resolved : [mail];
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
      const conversationScope = normalize(options.getConversationScope?.(mail)).toLowerCase();
      const contactEmail = normalize(
        options.getContactEmail?.(mail) || mail && mail.externalContactEmail
      ).toLowerCase();
      const outreachContact = conversationScope === 'outreach' && Boolean(contactEmail);
      const response = await options.fetch(`/api/mailbox/messages/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          visibilityProtocol: VISIBILITY_PROTOCOL,
          owner: normalize(options.getOwner?.(mail)),
          account: root.account,
          id: root.id,
          uid: root.uid,
          folder: root.folder,
          messages: targets,
          ...(outreachContact ? {
            visibilityScope: 'outreach-contact',
            contactEmail,
            expectedMessageCount: action === 'hide' ? targets.length : 0,
          } : {}),
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
      if (!mail) return { ok: false, cancelled: true };
      const messageKey = getMessageKey(mail);
      if (pendingMessageKeys.has(messageKey)) return { ok: false, pending: true };
      pendingMessageKeys.add(messageKey);
      try {
        if (!(await confirmDeletion(mail))) return { ok: false, cancelled: true };
        if (typeof options.prepareConversation === 'function') {
          try {
            if ((await options.prepareConversation(mail)) !== true) {
              throw new Error('Gesprek kon niet volledig worden geladen; er is niets verborgen. Probeer opnieuw.');
            }
          } catch (error) {
            options.toast?.(String(error?.message || error || 'Gesprek kon niet volledig worden geladen; er is niets verborgen. Probeer opnieuw.'));
            return { ok: false, incomplete: true, error };
          }
        }
        hiddenMessageKeys.add(messageKey);
        const transaction = hooks.optimistic?.(mail);
        try {
          const data = await requestVisibility(mail, 'hide');
          getResolvedMessages(mail, data).forEach((message) => hiddenMessageKeys.add(getMessageKey(message)));
          options.removeCached?.(mail, data);
          hooks.commit?.(mail, transaction, data);
          return { ok: true, data };
        } catch (error) {
          hiddenMessageKeys.delete(messageKey);
          hooks.rollback?.(mail, transaction, error);
          options.toast?.(String(error?.message || error || 'Gesprek verbergen mislukt'));
          return { ok: false, error };
        }
      } finally {
        pendingMessageKeys.delete(messageKey);
      }
    }

    async function restore(mail) {
      if (!mail) return { ok: false };
      try {
        const data = await requestVisibility(mail, 'restore');
        getResolvedMessages(mail, data).forEach((message) => hiddenMessageKeys.delete(getMessageKey(message)));
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
