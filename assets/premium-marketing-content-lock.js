(function () {
  'use strict';

  var CONTENT_LOCK_CODE = 'Andre2Fritz2!';
  var REMOTE_UNLOCK_KEY = 'unlocked';
  var overlay = document.getElementById('contentLockOverlay');

  if (!overlay) {
    return;
  }

  var remoteScope = overlay.getAttribute('data-content-lock-scope') || '';
  var input = document.querySelector('[data-content-lock-input]');
  var submitButton = document.querySelector('[data-content-lock-submit]');
  var error = document.getElementById('contentLockError');

  function getUiStateClient() {
    return window.SoftoraUiStateClient || null;
  }

  async function readRemoteUnlockFlag() {
    var client = getUiStateClient();
    if (!client || !remoteScope) return false;

    try {
      var state = await client.get(remoteScope);
      return Boolean(state && state.values && state.values[REMOTE_UNLOCK_KEY] === '1');
    } catch (loadError) {
      console.error('Marketing lock-status laden mislukt:', loadError);
      return false;
    }
  }

  async function writeRemoteUnlockFlag() {
    var client = getUiStateClient();
    if (!client || !remoteScope) return;

    try {
      await client.set(remoteScope, {
        patch: {
          [REMOTE_UNLOCK_KEY]: '1'
        },
        source: 'premium-marketing-content-lock',
        actor: 'browser'
      });
    } catch (saveError) {
      console.error('Marketing lock-status opslaan mislukt:', saveError);
    }
  }

  function hideOverlay() {
    overlay.style.display = 'none';
  }

  function scrollToCurrentHash() {
    var raw = String(window.location.hash || '').replace(/^#/, '');
    if (!raw) return;

    var target = document.getElementById(raw);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function unlockContent() {
    if (!input || !error) return;

    if (input.value === CONTENT_LOCK_CODE) {
      hideOverlay();
      void writeRemoteUnlockFlag();
      scrollToCurrentHash();
      return;
    }

    error.textContent = 'Onjuiste code, probeer opnieuw.';
    input.value = '';
    input.focus();
  }

  function bindContentLock() {
    void readRemoteUnlockFlag().then(function (isUnlocked) {
      if (isUnlocked) hideOverlay();
    });

    if (submitButton) {
      submitButton.addEventListener('click', unlockContent);
    }

    if (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          unlockContent();
        }
      });
    }

    window.addEventListener('hashchange', scrollToCurrentHash);
    window.addEventListener('load', scrollToCurrentHash, { once: true });
  }

  bindContentLock();
})();
