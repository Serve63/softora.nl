(function (global) {
  "use strict";

  const CAMPAIGN_RECIPIENT_PREVIEW_COUNT_LIMIT = 500;
  const CAMPAIGN_RECIPIENT_PREVIEW_DEBOUNCE_MS = 180;

  function normalizeMessage(value) {
    return String(value || '').trim();
  }

  function createEmptyState(key = '') {
    return {
      key,
      loading: false,
      loaded: false,
      count: null,
      error: '',
    };
  }

  function createCampaignRecipientPreviewController(deps = {}) {
    let timer = null;
    let promise = null;
    let requestId = 0;
    let state = createEmptyState();

    const byId = typeof deps.byId === 'function' ? deps.byId : () => null;
    const getSelectedText = typeof deps.getSelectedText === 'function' ? deps.getSelectedText : () => '';
    const getBlockedPhoneKeys = typeof deps.getBlockedPhoneKeys === 'function' ? deps.getBlockedPhoneKeys : () => [];
    const resolveRadiusKm = typeof deps.resolveRadiusKm === 'function' ? deps.resolveRadiusKm : () => Infinity;
    const fetchWithTimeout = typeof deps.fetchWithTimeout === 'function' ? deps.fetchWithTimeout : global.fetch.bind(global);
    const normalizeFreeText = typeof deps.normalizeFreeText === 'function' ? deps.normalizeFreeText : normalizeMessage;
    const paint = typeof deps.paint === 'function' ? deps.paint : () => {};

    function buildRequest() {
      const params = new URLSearchParams();
      params.set('mode', 'call');
      params.set('count', String(CAMPAIGN_RECIPIENT_PREVIEW_COUNT_LIMIT));

      const branch = getSelectedText('branche');
      if (branch && !/^alles$/i.test(branch)) params.set('branch', branch);

      const radiusKm = resolveRadiusKm(byId('regio'));
      if (Number.isFinite(radiusKm) && radiusKm > 0) {
        params.set('radiusKm', String(Math.round(radiusKm)));
      }

      const blockedPhones = Array.from(getBlockedPhoneKeys()).filter(Boolean).sort();
      if (blockedPhones.length > 0) params.set('blockedPhones', blockedPhones.join(','));

      const key = params.toString();
      return {
        key,
        url: `/api/coldmailing/campaigns/recipients?${key}`,
      };
    }

    function getState() {
      const request = buildRequest();
      return state.key === request.key ? state : createEmptyState(request.key);
    }

    function getDisplayCount(localCount, localLeadCount = 0) {
      const current = getState();
      const remoteCount = Math.floor(Number(current.count));
      const hasRemoteCount = current.loaded && Number.isFinite(remoteCount) && remoteCount >= 0;
      return {
        count: hasRemoteCount ? remoteCount : Math.max(0, Math.floor(Number(localCount) || 0)),
        loading: current.loading && !hasRemoteCount && Math.max(0, Number(localLeadCount) || 0) === 0,
      };
    }

    async function refresh(options = {}) {
      const request = buildRequest();
      const force = Boolean(options.force);

      if (!force && state.key === request.key && state.loaded) return state;
      if (!force && state.key === request.key && state.loading && promise) return promise;

      const currentRequestId = (requestId += 1);
      state = { ...createEmptyState(request.key), loading: true };
      paint();

      promise = fetchWithTimeout(
        request.url,
        {
          method: 'GET',
          cache: 'no-store',
        },
        12000
      )
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data?.ok === false) {
            throw new Error(data?.message || data?.error || `Ontvangers laden mislukt (${response.status})`);
          }
          const remoteCount = Math.max(
            0,
            Math.floor(Number(data?.candidates ?? data?.selected ?? data?.recipients?.length ?? 0) || 0)
          );
          if (currentRequestId !== requestId) return state;
          state = {
            ...createEmptyState(request.key),
            loaded: true,
            count: remoteCount,
          };
          return state;
        })
        .catch((error) => {
          if (currentRequestId === requestId) {
            state = {
              ...createEmptyState(request.key),
              error: normalizeFreeText(error?.message || 'Ontvangers konden niet worden geladen.'),
            };
          }
          return state;
        })
        .finally(() => {
          if (currentRequestId === requestId) {
            promise = null;
            paint();
          }
        });

      return promise;
    }

    function schedule(options = {}) {
      const request = buildRequest();
      const force = Boolean(options.force);
      const immediate = Boolean(options.immediate);

      if (!force && state.key === request.key && (state.loaded || state.loading)) return;

      state = { ...createEmptyState(request.key), loading: true };
      paint();

      if (timer) {
        global.clearTimeout(timer);
        timer = null;
      }

      timer = global.setTimeout(() => {
        timer = null;
        void refresh({ force });
      }, immediate ? 0 : CAMPAIGN_RECIPIENT_PREVIEW_DEBOUNCE_MS);
    }

    function reset() {
      if (timer) {
        global.clearTimeout(timer);
        timer = null;
      }
      promise = null;
      requestId += 1;
      state = createEmptyState();
    }

    return {
      getDisplayCount,
      getState,
      refresh,
      reset,
      schedule,
    };
  }

  global.SoftoraColdcallingCampaignRecipientPreview = {
    createCampaignRecipientPreviewController,
  };
})(window);
