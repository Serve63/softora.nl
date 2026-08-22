(function (global) {
  'use strict';

  const SCOPE = 'premium_mailbox_preferences';
  const PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';
  const SELECTION_KEY_PREFIX = 'softora_mailbox_active_owner_v1_';
  const OWNER_HISTORY_STATE_KEY = 'softoraMailboxOwnerViewV1';

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    if (owner === 'serve' || owner === 'servé') return 'serve';
    if (owner === 'martijn') return 'martijn';
    if (owner === 'both' || owner === 'all') return 'both';
    return '';
  }

  function normalizeIdentity(identity) {
    return String(identity || '')
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, '_')
      .slice(0, 72) || 'anonymous';
  }

  function key(prefix, identity) {
    return `${prefix}${normalizeIdentity(identity)}`;
  }

  function create(options = {}) {
    let client = null;
    let identity = 'anonymous';
    let ready = false;
    let writes = Promise.resolve();

    function getPinKey(nextIdentity) {
      return key(PIN_KEY_PREFIX, nextIdentity);
    }

    function getSelectionKey(nextIdentity) {
      return key(SELECTION_KEY_PREFIX, nextIdentity);
    }

    function getHistory() {
      return options.history || (global && global.history) || null;
    }

    function readCurrentOwner(nextIdentity = identity) {
      try {
        const state = getHistory()?.state;
        const view = state && typeof state === 'object' ? state[OWNER_HISTORY_STATE_KEY] : null;
        if (!view || normalizeIdentity(view.identity) !== normalizeIdentity(nextIdentity)) return '';
        return normalizeOwner(view.owner);
      } catch (_) {
        return '';
      }
    }

    function replaceCurrentOwner(value, nextIdentity = identity) {
      const owner = normalizeOwner(value);
      const viewIdentity = normalizeIdentity(nextIdentity);
      const history = getHistory();
      if (!owner || !history || typeof history.replaceState !== 'function') {
        return false;
      }
      try {
        const state = history.state && typeof history.state === 'object' ? history.state : {};
        const currentView = state[OWNER_HISTORY_STATE_KEY];
        if (
          currentView && normalizeIdentity(currentView.identity) === viewIdentity &&
          normalizeOwner(currentView.owner) === owner
        ) return true;
        history.replaceState({
          ...state,
          [OWNER_HISTORY_STATE_KEY]: { identity: viewIdentity, owner },
        }, '');
        return true;
      } catch (_) {
        return false;
      }
    }

    function enqueueWrite(writeClient, writeIdentity, owner, includePin) {
      const patch = { [getSelectionKey(writeIdentity)]: owner };
      if (includePin) patch[getPinKey(writeIdentity)] = owner;
      const pending = writes.catch(() => {}).then(() => writeClient.set(SCOPE, {
        patch,
        source: 'premium-mailbox',
        actor: writeIdentity,
      }, { keepalive: true }));
      writes = pending.catch(() => {});
      return pending;
    }

    async function initialize(uiStateClient, nextIdentity) {
      const initializedClient = uiStateClient && typeof uiStateClient.get === 'function' ? uiStateClient : null;
      const initializedIdentity = String(nextIdentity || '').trim().toLowerCase() || 'anonymous';
      const currentOwner = readCurrentOwner(initializedIdentity);
      client = initializedClient;
      identity = initializedIdentity;
      ready = false;
      let pinnedOwner = '';
      let selectedOwner = '';
      try {
        if (initializedClient) {
          const hasBootstrapPeek = typeof initializedClient.peek === 'function';
          let payload = null;
          try { payload = hasBootstrapPeek ? initializedClient.peek(SCOPE) : null; } catch (_) { payload = null; }
          if (!payload && !hasBootstrapPeek && !currentOwner) payload = await initializedClient.get(SCOPE);
          const values = payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object'
            ? payload.values
            : {};
          pinnedOwner = normalizeOwner(values[getPinKey(initializedIdentity)]);
          selectedOwner = normalizeOwner(values[getSelectionKey(initializedIdentity)]);
        }
      } catch (_) {
        pinnedOwner = '';
        selectedOwner = '';
      }
      if (client !== initializedClient || identity !== initializedIdentity) {
        return { pinnedOwner, selectedOwner, currentOwner };
      }
      ready = true;
      if (
        currentOwner && currentOwner !== selectedOwner &&
        initializedClient && typeof initializedClient.set === 'function'
      ) {
        void enqueueWrite(initializedClient, initializedIdentity, currentOwner, false).catch(() => {});
      }
      return { pinnedOwner, selectedOwner, currentOwner };
    }

    function persist(value) {
      const owner = normalizeOwner(value);
      if (!owner) return;
      replaceCurrentOwner(owner);
      if (!ready || !client || typeof client.set !== 'function') return;
      return enqueueWrite(client, identity, owner, false);
    }

    async function pin(value, fallbackClient) {
      const owner = normalizeOwner(value);
      if (!owner) return false;
      replaceCurrentOwner(owner);
      const writer = client && typeof client.set === 'function' ? client : fallbackClient;
      if (!writer || typeof writer.set !== 'function') return false;
      try {
        await enqueueWrite(writer, identity, owner, true);
        return true;
      } catch (_) {
        return false;
      }
    }

    return {
      getPinKey,
      getSelectionKey,
      initialize,
      persist,
      pin,
      readCurrentOwner,
      replaceCurrentOwner,
    };
  }

  const api = { create, scope: SCOPE };
  global.SoftoraMailboxOwnerPreference = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
