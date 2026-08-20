(function (global) {
  'use strict';

  function withoutDeletedMessages(messages, identity, matchesMessageIdentity) {
    let changed = false;
    const next = (Array.isArray(messages) ? messages : []).flatMap((message) => {
      if (matchesMessageIdentity(message, identity)) { changed = true; return []; }
      const currentThread = Array.isArray(message.threadMessages) ? message.threadMessages : [];
      const threadMessages = currentThread.filter((item) => !matchesMessageIdentity(item, identity));
      if (threadMessages.length === currentThread.length) return [message];
      changed = true;
      return [{ ...message, threadMessages }];
    });
    return { changed, messages: next };
  }

  function removeResolvedMessageCaches(mail, data, removeAndPublish) {
    const resolved = Array.isArray(data?.result?.resolvedMessages) && data.result.resolvedMessages.length
      ? data.result.resolvedMessages
      : [mail];
    const seen = new Set();
    return resolved.reduce((changed, message) => {
      const key = `${message.accountEmail || message.account || ''}|${String(message.messageId || '').trim().toLowerCase() || `${message.folder || ''}|${message.uid || message.id || ''}`}`;
      if (seen.has(key)) return changed;
      seen.add(key);
      return (typeof removeAndPublish === 'function' && removeAndPublish(message)) || changed;
    }, false);
  }

  function createViewBridge(options = {}) {
    return {
      removeCached(mail, data) {
        return removeResolvedMessageCaches(mail, data, options.removeAndPublish);
      },
      commit() {
        const messages = options.filterMessages(options.getMessages());
        options.setMessages(messages);
        if (options.getActiveId() && !options.findMessage(options.getActiveId())) options.setActiveId(null);
        options.renderList({ openLatest: true });
        if (!options.getActiveId()) options.resetDetail();
      },
    };
  }

  const api = { createViewBridge, removeResolvedMessageCaches, withoutDeletedMessages };
  global.SoftoraMailboxLogicalDelete = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
