(function (global) {
  function create(options = {}) {
    function getDismissTarget(mail) {
      if (typeof options.getDismissTarget === 'function') return options.getDismissTarget(mail);
      const action = options.getConversationAction?.(mail);
      if (!action) return mail;
      if (action.kind !== 'reply') return null;
      return action.isRoot ? mail : action.message;
    }

    async function persist(mail, persistOptions = {}) {
      const requestId = options.getRequestId?.(mail);
      const account = options.getAccount?.(mail);
      if (!mail || !requestId || !account) return null;
      try {
        const response = await options.fetch('/api/mailbox/messages/read', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            account,
            owner: options.getOwner?.(mail) || '',
            id: requestId,
            uid: mail.uid,
            folder: options.getFolder?.(mail) || 'inbox',
            dismissReply: persistOptions.dismissReply === true,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Gelezen status opslaan mislukt');
        }
        return data.result || null;
      } catch (error) {
        options.toast?.(String(error?.message || error || 'Gelezen status opslaan mislukt'));
        return null;
      }
    }

    async function dismissReply(mail, hooks = {}) {
      const target = getDismissTarget(mail);
      if (!target || target.replyDismissedAt || target.replyDismissPending) return { ok: false };
      const previous = { unread: target.unread, replyDismissedAt: target.replyDismissedAt || '' };
      target.replyDismissPending = true;
      target.unread = false;
      target.replyDismissedAt = new Date().toISOString();
      hooks.render?.(mail, target);
      const result = await persist(target, { dismissReply: true });
      target.replyDismissPending = false;
      if (!result?.replyDismissedAt) {
        target.unread = previous.unread;
        target.replyDismissedAt = previous.replyDismissedAt;
        hooks.render?.(mail, target);
        return { ok: false };
      }
      target.replyDismissedAt = result.replyDismissedAt;
      hooks.render?.(mail, target);
      options.toast?.('Gesprek als gelezen afgehandeld');
      return { ok: true, result };
    }

    return { dismissReply, persist };
  }

  const api = { create };
  global.SoftoraMailboxRead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
