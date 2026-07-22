(function (root) {
  'use strict';

  // Legacy bestandsnaam: premium pagina's mogen nooit kunstmatig op een loader wachten.
  const DEFAULT_MINIMUM_MS = 0;
  let startedAt = Date.now();
  let releaseTimer = null;

  function getMain() {
    return root.document && root.document.querySelector
      ? root.document.querySelector('main.is-premium-boot-host')
      : null;
  }

  function applyShellBooting(isBooting) {
    const main = getMain();
    if (!main) return;
    const loader = main.querySelector('.premium-boot-loader');
    const shell = main.querySelector('.premium-boot-shell');
    if (shell) {
      shell.classList.toggle('is-booting', Boolean(isBooting));
      shell.setAttribute('aria-busy', isBooting ? 'true' : 'false');
    }
    if (loader) {
      loader.classList.toggle('is-hidden', !isBooting);
      loader.setAttribute('aria-hidden', isBooting ? 'false' : 'true');
    }
  }

  function clearReleaseTimer() {
    if (!releaseTimer) return;
    root.clearTimeout(releaseTimer);
    releaseTimer = null;
  }

  function originalSetShellBooting(isBooting) {
    const boot = root.SoftoraPremiumBoot;
    if (boot && typeof boot.__softoraOriginalSetShellBooting === 'function') {
      boot.__softoraOriginalSetShellBooting(isBooting);
      return;
    }
    applyShellBooting(isBooting);
  }

  function releaseShellAfterMinimum(customStartedAt, customMinimumMs) {
    const safeStartedAt = Number(customStartedAt) || startedAt || Date.now();
    const requestedMinimumMs = Math.max(0, Number(customMinimumMs) || 0);
    const safeMinimumMs = DEFAULT_MINIMUM_MS > 0
      ? Math.min(requestedMinimumMs || DEFAULT_MINIMUM_MS, DEFAULT_MINIMUM_MS)
      : 0;
    const remainingMs = Math.max(0, safeMinimumMs - (Date.now() - safeStartedAt));
    clearReleaseTimer();
    releaseTimer = root.setTimeout(function () {
      clearReleaseTimer();
      originalSetShellBooting(false);
    }, remainingMs);
  }

  function patchPremiumBoot() {
    const boot = root.SoftoraPremiumBoot;
    if (!boot || boot.__softoraOneSecondPatched) return false;
    boot.__softoraOriginalSetShellBooting = typeof boot.setShellBooting === 'function'
      ? boot.setShellBooting.bind(boot)
      : applyShellBooting;
    boot.releaseShellAfterMinimum = releaseShellAfterMinimum;
    boot.setShellBooting = function setShellBooting(isBooting) {
      if (isBooting) {
        clearReleaseTimer();
        startedAt = Date.now();
        originalSetShellBooting(true);
        return;
      }
      releaseShellAfterMinimum(startedAt, DEFAULT_MINIMUM_MS);
    };
    boot.__softoraOneSecondPatched = true;
    return true;
  }

  root.SoftoraPremiumBootTiming = Object.freeze({
    patchPremiumBoot,
    release: releaseShellAfterMinimum
  });

  if (!patchPremiumBoot()) {
    root.setTimeout(patchPremiumBoot, 0);
    if (root.document && root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', patchPremiumBoot, { once: true });
    }
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('load', patchPremiumBoot, { once: true });
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
