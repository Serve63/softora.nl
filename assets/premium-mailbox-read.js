(function (global) {
  'use strict';

  const READ_STATE_CHANNEL = 'softora_mailbox_read_state_v3';

  function normalize(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeUidValidity(value) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 && normalized <= 4294967295
      ? normalized
      : 0;
  }

  function create(options = {}) {
    const BroadcastChannelImpl = options.BroadcastChannel || (global.document ? global.BroadcastChannel : null);
    const confirmedStates = new Map();
    let channel = null;

    function getIdentity(mail) {
      if (!mail || typeof mail !== 'object') return null;
      const id = String(options.getRequestId?.(mail) || mail.id || '').trim();
      const account = normalize(options.getAccount?.(mail) || mail.accountEmail);
      const folder = normalize(options.getFolder?.(mail) || mail.storageFolder || mail.folder || 'inbox');
      const owner = normalize(options.getOwner?.(mail) || mail.providerOwner);
      const uid = Number(mail.uid) || 0;
      const uidValidity = normalizeUidValidity(mail.uidValidity);
      if (!id || !account) return null;
      return { owner, account, folder, id, uid, uidValidity };
    }

    function getIdentityKey(identity) {
      const source = identity && typeof identity === 'object' ? identity : {};
      const folder = normalize(source.folder);
      const uid = Number(source.uid) || 0;
      const identityPart = folder !== 'instantly' && uid > 0
        ? `uv:${normalizeUidValidity(source.uidValidity)}|uid:${uid}`
        : `id:${String(source.id || '').trim()}`;
      return [normalize(source.owner), normalize(source.account), folder, identityPart].join('|');
    }

    function applyConfirmedState(mail) {
      const identity = getIdentity(mail);
      const state = identity ? confirmedStates.get(getIdentityKey(identity)) : null;
      const persistedReadAt = String(mail && (mail.softoraReadAt || mail.readAt) || '').trim();
      if (!state && !persistedReadAt) return mail;
      mail.unread = false;
      mail.readPending = false;
      mail.readError = '';
      mail.softoraReadConfirmed = true;
      if (state?.replyDismissedAt) mail.replyDismissedAt = state.replyDismissedAt;
      return mail;
    }

    function publishConfirmedState(state) {
      if (!channel || typeof channel.postMessage !== 'function') return;
      try {
        channel.postMessage({ type: 'mailbox-read-confirmed', state });
      } catch (_) {}
    }

    function rememberConfirmedState(mail, result = {}, settings = {}) {
      const identity = getIdentity(mail);
      if (!identity) return false;
      const state = {
        identity,
        unread: false,
        replyDismissedAt: String(result.replyDismissedAt || mail.replyDismissedAt || ''),
        savedAt: Date.now(),
      };
      confirmedStates.set(getIdentityKey(identity), state);
      if (settings.broadcast !== false) publishConfirmedState(state);
      return true;
    }

    async function persist(mail, persistOptions = {}) {
      const requestId = options.getRequestId?.(mail);
      const account = options.getAccount?.(mail);
      if (!mail || !requestId || !account) {
        return { ok: false, error: new Error('Gelezen status mist berichtprovenance') };
      }
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
            uidValidity: normalizeUidValidity(mail.uidValidity),
            folder: options.getFolder?.(mail) || 'inbox',
            dismissReply: persistOptions.dismissReply === true,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.ok) {
          throw new Error(data?.detail || data?.error || 'Gelezen status opslaan mislukt');
        }
        return { ok: true, result: data.result || null };
      } catch (error) {
        return { ok: false, error };
      }
    }

    function render(hooks, mail, target) {
      if (typeof hooks.render === 'function') hooks.render(mail, target);
    }

    function setFailure(target, previous, error, hooks, mail) {
      target.unread = previous.unread;
      target.replyDismissedAt = previous.replyDismissedAt;
      target.readPending = false;
      target.replyDismissPending = false;
      target.readError = String(error?.message || error || 'Gelezen status opslaan mislukt');
      render(hooks, mail, target);
      options.toast?.(`${target.readError} · probeer opnieuw`);
    }

    async function markRead(mail, hooks = {}) {
      if (!mail || mail.readPending) return { ok: false };
      if (!mail.unread && !mail.readError) return { ok: true, skipped: true };
      const previous = {
        unread: Boolean(mail.unread),
        replyDismissedAt: String(mail.replyDismissedAt || ''),
      };
      mail.unread = false;
      mail.readPending = true;
      mail.readError = '';
      render(hooks, mail, mail);
      const outcome = await persist(mail);
      if (!outcome.ok) {
        setFailure(mail, previous, outcome.error, hooks, mail);
        return { ok: false, error: outcome.error };
      }
      mail.readPending = false;
      mail.readError = '';
      mail.softoraReadConfirmed = true;
      rememberConfirmedState(mail, outcome.result || {});
      render(hooks, mail, mail);
      return { ok: true, result: outcome.result };
    }

    function getDismissTarget(mail) {
      if (typeof options.getDismissTarget === 'function') return options.getDismissTarget(mail);
      const action = options.getConversationAction?.(mail);
      if (!action) return mail;
      if (action.kind !== 'reply') return null;
      return action.isRoot ? mail : action.message;
    }

    async function dismissReply(mail, hooks = {}) {
      const target = getDismissTarget(mail);
      if (!target || target.replyDismissedAt || target.replyDismissPending) return { ok: false };
      const previous = { unread: Boolean(target.unread), replyDismissedAt: String(target.replyDismissedAt || '') };
      target.replyDismissPending = true;
      target.readPending = true;
      target.readError = '';
      target.unread = false;
      target.replyDismissedAt = new Date().toISOString();
      render(hooks, mail, target);
      const outcome = await persist(target, { dismissReply: true });
      target.replyDismissPending = false;
      target.readPending = false;
      if (!outcome.ok || !outcome.result?.replyDismissedAt) {
        setFailure(target, previous, outcome.error, hooks, mail);
        return { ok: false, error: outcome.error };
      }
      target.replyDismissedAt = outcome.result.replyDismissedAt;
      target.readError = '';
      target.softoraReadConfirmed = true;
      rememberConfirmedState(target, outcome.result);
      render(hooks, mail, target);
      options.toast?.('Gesprek als gelezen afgehandeld');
      return { ok: true, result: outcome.result };
    }

    if (typeof BroadcastChannelImpl === 'function') {
      try {
        channel = new BroadcastChannelImpl(READ_STATE_CHANNEL);
        channel.addEventListener?.('message', (event) => {
          const payload = event && event.data;
          const state = payload && payload.type === 'mailbox-read-confirmed' ? payload.state : null;
          const identity = state && state.identity;
          const key = getIdentityKey(identity);
          if (!key || state.unread !== false) return;
          confirmedStates.set(key, {
            identity,
            unread: false,
            replyDismissedAt: String(state.replyDismissedAt || ''),
            savedAt: Number(state.savedAt) || Date.now(),
          });
          options.onExternalState?.(identity);
        });
      } catch (_) {
        channel = null;
      }
    }

    return {
      dismissReply,
      getIdentity,
      markRead,
      persist,
      reconcile: applyConfirmedState,
      rememberConfirmedState,
    };
  }

  const api = {
    READ_STATE_CHANNEL,
    create,
  };
  global.SoftoraMailboxRead = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
