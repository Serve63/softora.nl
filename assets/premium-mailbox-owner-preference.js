(function (global) {
  'use strict';

  const SCOPE = 'premium_mailbox_preferences';
  const PIN_KEY_PREFIX = 'softora_mailbox_pinned_owner_v1_';
  const SELECTION_KEY_PREFIX = 'softora_mailbox_active_owner_v1_';

  function normalizeOwner(value) {
    const owner = String(value || '').trim().toLowerCase();
    if (owner === 'serve' || owner === 'servé') return 'serve';
    if (owner === 'martijn') return 'martijn';
    if (owner === 'both' || owner === 'all') return 'both';
    return '';
  }

  function key(prefix, identity) {
    const normalized = String(identity || '')
      .toLowerCase()
      .replace(/[^a-z0-9@._-]+/g, '_')
      .slice(0, 72) || 'anonymous';
    return `${prefix}${normalized}`;
  }

  function create() {
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

    async function initialize(uiStateClient, nextIdentity) {
      client = uiStateClient && typeof uiStateClient.get === 'function' ? uiStateClient : null;
      identity = String(nextIdentity || '').trim().toLowerCase() || 'anonymous';
      ready = false;
      let pinnedOwner = '';
      let selectedOwner = '';
      try {
        if (client) {
          const payload = await client.get(SCOPE);
          const values = payload && typeof payload === 'object' && payload.values && typeof payload.values === 'object'
            ? payload.values
            : {};
          pinnedOwner = normalizeOwner(values[getPinKey(identity)]);
          selectedOwner = normalizeOwner(values[getSelectionKey(identity)]);
        }
      } catch (_) {
        pinnedOwner = '';
        selectedOwner = '';
      }
      ready = true;
      return { pinnedOwner, selectedOwner };
    }

    function persist(value) {
      if (!ready || !client || typeof client.set !== 'function') return;
      const owner = normalizeOwner(value);
      if (!owner) return;
      writes = writes.catch(() => {}).then(() => client.set(SCOPE, {
        patch: { [getSelectionKey(identity)]: owner },
        source: 'premium-mailbox',
        actor: identity,
      })).catch(() => {});
    }

    async function pin(value, fallbackClient) {
      const owner = normalizeOwner(value);
      const writer = client && typeof client.set === 'function' ? client : fallbackClient;
      if (!owner || !writer || typeof writer.set !== 'function') return false;
      try {
        await writer.set(SCOPE, {
          patch: { [getPinKey(identity)]: owner },
          source: 'premium-mailbox',
          actor: identity,
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    return { getPinKey, initialize, persist, pin };
  }

  const api = { create, scope: SCOPE };
  global.SoftoraMailboxOwnerPreference = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
