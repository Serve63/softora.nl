(function () {
  'use strict';

  var LOCK_CODE = 'Andre2Fritz2!';
  var UNLOCK_COOKIE = 'softora_public_premium_unlocked';

  function readCookie(name) {
    var prefix = encodeURIComponent(name) + '=';
    return document.cookie
      .split(';')
      .map(function (part) { return part.trim(); })
      .some(function (part) { return part.indexOf(prefix) === 0 && part.slice(prefix.length) === '1'; });
  }

  function writeUnlockCookie() {
    document.cookie = encodeURIComponent(UNLOCK_COOKIE) + '=1; path=/; SameSite=Lax';
  }

  function bindRevealAnimations() {
    var revealItems = Array.prototype.slice.call(document.querySelectorAll('.reveal'));
    if (revealItems.length === 0) return;

    if (typeof IntersectionObserver !== 'function') {
      revealItems.forEach(function (item) { item.classList.add('visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.1 });

    revealItems.forEach(function (item) { observer.observe(item); });
  }

  function bindPublicLock() {
    var overlay = document.getElementById('overlay');
    if (!overlay) return;

    var input = document.querySelector('[data-public-lock-input]');
    var error = document.getElementById('login-error');
    var submit = document.querySelector('[data-public-lock-submit]');

    function hideOverlay() {
      overlay.style.display = 'none';
    }

    function showError() {
      if (!input || !error) return;
      error.textContent = 'Onjuiste code, probeer opnieuw.';
      input.value = '';
      input.focus();
    }

    function unlock() {
      if (!input) return;

      if (input.value === LOCK_CODE) {
        writeUnlockCookie();
        hideOverlay();
        return;
      }

      showError();
    }

    if (readCookie(UNLOCK_COOKIE)) {
      hideOverlay();
    }

    if (submit) {
      submit.addEventListener('click', unlock);
    }

    if (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') unlock();
      });
    }
  }

  bindRevealAnimations();
  bindPublicLock();
})();
