(function () {
  const path = String(window.location.pathname || '').toLowerCase();
  const isPremiumPersonnelContext = path.indexOf('/premium-') !== -1;
  const STORAGE_KEY = isPremiumPersonnelContext
    ? 'softora_premium_ai_management_mode'
    : 'softora_software_ai_management_mode';
  const root = document.documentElement;

  function normalizeMode(value) {
    return value === 'software' ? 'software' : 'personnel';
  }

  function getModeLabel(value) {
    return normalizeMode(value) === 'software' ? 'AI BEHEER' : 'PERSONEEL BEHEER';
  }

  function readStoredMode() {
    try {
      return normalizeMode(window.localStorage.getItem(STORAGE_KEY));
    } catch (_) {
      return normalizeMode(root.getAttribute('data-ai-management-mode'));
    }
  }

  let currentMode = normalizeMode(root.getAttribute('data-ai-management-mode') || readStoredMode());

  function getContext() {
    return {
      mode: currentMode,
      label: getModeLabel(currentMode),
    };
  }

  function applyMode(nextMode, options = {}) {
    currentMode = normalizeMode(nextMode);
    root.setAttribute('data-ai-management-mode', currentMode);

    if (!options.skipPersist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, currentMode);
      } catch (_) {
        /* ignore storage errors */
      }
    }

    if (!options.silent) {
      window.dispatchEvent(
        new CustomEvent('softora-ai-management-change', {
          detail: getContext(),
        })
      );
    }

    return currentMode;
  }

  window.SoftoraAiManagement = {
    STORAGE_KEY,
    normalizeMode,
    getMode() {
      return currentMode;
    },
    getLabel(value) {
      return getModeLabel(value);
    },
    getContext,
    setMode(value, options) {
      return applyMode(value, options);
    },
  };

  applyMode(currentMode, { skipPersist: true, silent: true });

  window.addEventListener('storage', (event) => {
    if (!event || event.key !== STORAGE_KEY) return;
    applyMode(event.newValue, { skipPersist: true });
  });
})();
