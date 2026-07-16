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
  var remoteUnlocked = false;

  function isOpenGoogleAdsView() {
    var path = String(window.location.pathname || '').toLowerCase();
    var hash = String(window.location.hash || '').replace(/^#/, '').toLowerCase();
    return path.indexOf('/premium-advertenties') === 0 && (!hash || hash === 'google');
  }

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

  function syncOverlayVisibility() {
    var googleAdsOpen = isOpenGoogleAdsView();
    if (googleAdsOpen) {
      document.documentElement.setAttribute('data-google-ads-open', 'true');
    } else {
      document.documentElement.removeAttribute('data-google-ads-open');
    }
    overlay.style.display = remoteUnlocked || googleAdsOpen ? 'none' : '';
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
      remoteUnlocked = true;
      syncOverlayVisibility();
      void writeRemoteUnlockFlag();
      scrollToCurrentHash();
      return;
    }

    error.textContent = 'Onjuiste code, probeer opnieuw.';
    input.value = '';
    input.focus();
  }

  function bindContentLock() {
    syncOverlayVisibility();
    void readRemoteUnlockFlag().then(function (isUnlocked) {
      remoteUnlocked = isUnlocked;
      syncOverlayVisibility();
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

    window.addEventListener('hashchange', function () {
      syncOverlayVisibility();
      scrollToCurrentHash();
    });
    window.addEventListener('load', scrollToCurrentHash, { once: true });
  }

  bindContentLock();
})();
