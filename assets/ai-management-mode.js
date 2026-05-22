(function () {
  const path = String(window.location.pathname || '').toLowerCase();
  const isPremiumPersonnelContext = path.indexOf('/premium-') !== -1;
  const STORAGE_KEY = isPremiumPersonnelContext
    ? 'softora_premium_ai_management_mode'
    : 'softora_software_ai_management_mode';
  const REMOTE_SCOPE = isPremiumPersonnelContext
    ? 'premium_dashboard_ai_management'
    : 'software_ai_management';
  const REMOTE_MODE_KEY = isPremiumPersonnelContext
    ? 'softora_dashboard_ai_management_mode_v1'
    : STORAGE_KEY;
  const root = document.documentElement;

  function isValidMode(value) {
    return value === 'software' || value === 'personnel';
  }

  function normalizeMode(value) {
    return value === 'software' ? 'software' : 'personnel';
  }

  function getModeLabel(value) {
    return normalizeMode(value) === 'software' ? 'AI BEHEER' : 'PERSONEEL BEHEER';
  }

  function readStoredMode() {
    return normalizeMode(root.getAttribute('data-ai-management-mode'));
  }

  let currentMode = normalizeMode(root.getAttribute('data-ai-management-mode') || readStoredMode());

  function getReadUrls(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    return [
      '/api/ui-state-get?scope=' + encodedScope,
      '/api/ui-state/' + encodedScope,
    ];
  }

  function getWriteUrls(scope) {
    const encodedScope = encodeURIComponent(String(scope || ''));
    return [
      '/api/ui-state-set?scope=' + encodedScope,
      '/api/ui-state/' + encodedScope,
    ];
  }

  async function requestJson(urls, options, label) {
    let lastError = null;

    for (const url of urls) {
      try {
        const response = await window.fetch(url, options);
        if (!response.ok) throw new Error(label + ' mislukt (' + response.status + ')');
        return await response.json().catch(() => ({}));
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error(label + ' mislukt');
  }

  function readRemoteMode(data) {
    const values = data && data.values && typeof data.values === 'object' ? data.values : {};
    const value = values[REMOTE_MODE_KEY];
    return isValidMode(value) ? value : '';
  }

  async function fetchStoredMode() {
    const data = await requestJson(
      getReadUrls(REMOTE_SCOPE),
      { method: 'GET', cache: 'no-store' },
      'AI beheer stand ophalen'
    );
    return readRemoteMode(data);
  }

  function persistMode(mode) {
    if (typeof window.fetch !== 'function') return;
    requestJson(
      getWriteUrls(REMOTE_SCOPE),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          values: {
            [REMOTE_MODE_KEY]: normalizeMode(mode),
          },
        }),
      },
      'AI beheer stand opslaan'
    ).catch(() => {
      /* ignore persistence errors */
    });
  }

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
      persistMode(currentMode);
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

  fetchStoredMode()
    .then((storedMode) => {
      if (!storedMode || storedMode === currentMode) return;
      applyMode(storedMode, { skipPersist: true });
    })
    .catch(() => {
      /* keep the page's boot mode when remote state is unavailable */
    });
})();
