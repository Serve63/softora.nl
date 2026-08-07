(function (global) {
  'use strict';

  let ready = false;

  function finish() {
    if (!ready) return;
    if (global.SoftoraPremiumBoot && typeof global.SoftoraPremiumBoot.setShellBooting === 'function') {
      global.SoftoraPremiumBoot.setShellBooting(false);
      return;
    }
    const main = global.document?.querySelector?.('main.is-premium-boot-host');
    if (!main) return;
    const shell = main.querySelector('.premium-boot-shell');
    const loader = main.querySelector('.premium-boot-loader');
    if (shell) {
      shell.classList.remove('is-booting');
      shell.setAttribute('aria-busy', 'false');
    }
    if (loader) loader.classList.add('is-hidden');
  }

  global.SoftoraMailboxBoot = Object.freeze({
    markReady() { ready = true; finish(); },
    finish,
  });
})(typeof window !== 'undefined' ? window : globalThis);
