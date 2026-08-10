(function (global) {
  'use strict';

  const VISIBLE_REFRESH_INTERVAL_MS = 60 * 1000;
  const HIDDEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const REFRESH_AGE_UPDATE_INTERVAL_MS = 1000;
  const REFRESH_REQUEST_TIMEOUT_MS = 50 * 1000;
  const REFRESH_MAX_ATTEMPTS = 2;
  const REFRESH_RETRY_BASE_DELAY_MS = 500;
  const RECOVERY_REFRESH_INTERVAL_MS = 15 * 1000;

  function formatRefreshAge(lastRefreshAt, currentTime = Date.now()) {
    if (!Number.isFinite(Number(lastRefreshAt)) || Number(lastRefreshAt) <= 0) return '';
    const elapsedMs = Math.max(0, Number(currentTime) - Number(lastRefreshAt));
    if (elapsedMs < 60_000) return 'Zojuist';
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    if (elapsedMinutes < 60) return `${elapsedMinutes} min geleden`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return elapsedHours === 1 ? '1 uur geleden' : `${elapsedHours} uur geleden`;
  }

  function normalizeScope(value = {}) {
    const folder = String(value.folder || 'inbox').trim().toLowerCase() || 'inbox';
    const owner = String(value.owner || '').trim().toLowerCase().replace('servé', 'serve');
    const account = String(value.account || '').trim().toLowerCase();
    return {
      folder,
      owner: folder === 'outreach' ? (owner || 'serve') : '',
      account: folder === 'outreach' ? '' : account,
    };
  }

  function getScopeKey(scope) {
    const normalized = normalizeScope(scope);
    return `${normalized.folder}|${normalized.owner}|${normalized.account}`;
  }

  function isRetryableStatus(status) {
    return [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
  }

  function isIncompleteRefreshPayload(value) {
    if (!value || typeof value !== 'object') return false;
    const healthyRecentSync = value.skipped === true && String(value.reason || '') === 'recent-sync' &&
      value.ok !== false && value.reconciliationDegraded !== true &&
      !(Number.isFinite(Number(value.remainingReconcileCount)) && Number(value.remainingReconcileCount) > 0);
    if (
      value.ok === false || value.complete === false || value.freshnessConfirmed === false ||
      (value.skipped === true && !healthyRecentSync)
    ) return true;
    return Object.values(value).some(isIncompleteRefreshPayload);
  }

  function createAbortError() {
    const error = new Error('Mailboxverversing geannuleerd.');
    error.name = 'AbortError';
    return error;
  }

  function create(options = {}) {
    const documentRef = options.document || global.document;
    const windowRef = options.window || global;
    const AbortControllerImpl = options.AbortController || windowRef?.AbortController || global.AbortController;
    const button = options.button || documentRef?.getElementById?.('mailbox-refresh');
    const ageLabel = options.ageLabel || documentRef?.getElementById?.('mailbox-refresh-age');
    const getAccount = typeof options.getAccount === 'function' ? options.getAccount : () => '';
    const getFolder = typeof options.getFolder === 'function' ? options.getFolder : () => 'inbox';
    const getOwner = typeof options.getOwner === 'function' ? options.getOwner : () => '';
    const loadMessages = typeof options.loadMessages === 'function' ? options.loadMessages : async () => {};
    const showToast = typeof options.toast === 'function' ? options.toast : () => {};
    const request = typeof options.fetch === 'function' ? options.fetch : global.fetch.bind(global);
    const scheduleTimeout = typeof options.setTimeout === 'function' ? options.setTimeout : global.setTimeout?.bind(global);
    const cancelTimeout = typeof options.clearTimeout === 'function' ? options.clearTimeout : global.clearTimeout?.bind(global);
    const scheduleInterval = typeof options.setInterval === 'function' ? options.setInterval : global.setInterval?.bind(global);
    const cancelInterval = typeof options.clearInterval === 'function' ? options.clearInterval : global.clearInterval?.bind(global);
    const getNow = typeof options.now === 'function' ? options.now : Date.now;
    const wait = typeof options.wait === 'function'
      ? options.wait
      : (delayMs, signal) => new Promise((resolve, reject) => {
          const timer = scheduleTimeout(resolve, delayMs);
          signal?.addEventListener?.('abort', () => {
            cancelTimeout?.(timer);
            reject(createAbortError());
          }, { once: true });
        });
    const freshnessByScope = new Map();
    let refreshInFlight = false;
    let refreshQueued = false;
    let started = false;
    let destroyed = false;
    let paused = false;
    let refreshTimer = 0;
    let refreshAgeTimer = 0;
    let activeController = null;
    let failureCount = 0;

    function getScope() {
      return normalizeScope({ account: getAccount(), folder: getFolder(), owner: getOwner() });
    }

    function getFreshness(scope = getScope()) {
      const key = getScopeKey(scope);
      if (!freshnessByScope.has(key)) {
        freshnessByScope.set(key, { status: 'checking', lastSuccessfulAt: 0, lastErrorAt: 0 });
      }
      return freshnessByScope.get(key);
    }

    function updateRefreshAge() {
      if (!ageLabel) return;
      const scope = getScope();
      const state = getFreshness(scope);
      const age = formatRefreshAge(state.lastSuccessfulAt, getNow());
      if (state.status === 'checking') {
        ageLabel.textContent = 'Controleren…';
      } else if (state.status === 'partial') {
        ageLabel.textContent = 'Deels bijgewerkt';
      } else if (state.status === 'recovering') {
        ageLabel.textContent = 'Niet live · herstellen…';
      } else {
        ageLabel.textContent = age ? `${age} gecontroleerd` : 'Nog niet gecontroleerd';
      }
      const ownerText = scope.folder === 'outreach' ? ` voor ${scope.owner}` : ` voor ${scope.account || scope.folder}`;
      const checkedText = state.lastSuccessfulAt
        ? new Date(state.lastSuccessfulAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : 'nog niet voltooid';
      const statusText = state.status === 'checking'
        ? `Mailboxproviders worden gecontroleerd${ownerText}.`
        : state.status === 'partial'
          ? `Niet alle mailboxproviders konden worden bijgewerkt${ownerText}.`
          : state.status === 'recovering'
            ? `Tijdelijke verbindingsstoring${ownerText}; de huidige mailbox blijft zichtbaar en wordt automatisch opnieuw gecontroleerd.`
            : `Laatste volledige providercontrole${ownerText}: ${checkedText}`;
      ageLabel.setAttribute('title', statusText);
      ageLabel.setAttribute('aria-label', statusText);
    }

    function setRefreshing(refreshing) {
      if (!button) return;
      button.disabled = Boolean(refreshing);
      button.classList.toggle('is-refreshing', Boolean(refreshing));
      button.setAttribute('aria-busy', refreshing ? 'true' : 'false');
    }

    function clearRefreshTimer() {
      if (!refreshTimer) return;
      cancelTimeout?.(refreshTimer);
      refreshTimer = 0;
    }

    function getNextDelay(cycleStartedAt = null) {
      const hidden = documentRef?.visibilityState === 'hidden';
      const baseDelay = hidden ? HIDDEN_REFRESH_INTERVAL_MS : VISIBLE_REFRESH_INTERVAL_MS;
      const cadence = !failureCount
        ? baseDelay
        : Math.min(
            baseDelay,
            (hidden ? VISIBLE_REFRESH_INTERVAL_MS : RECOVERY_REFRESH_INTERVAL_MS) *
              Math.pow(2, Math.min(2, failureCount - 1))
          );
      if (cycleStartedAt === null || cycleStartedAt === undefined || !Number.isFinite(Number(cycleStartedAt))) {
        return cadence;
      }
      return Math.max(0, cadence - Math.max(0, getNow() - Number(cycleStartedAt)));
    }

    function scheduleNext(delayMs = getNextDelay()) {
      if (!started || destroyed || paused || typeof scheduleTimeout !== 'function') return;
      clearRefreshTimer();
      refreshTimer = scheduleTimeout(() => {
        refreshTimer = 0;
        void refresh();
      }, Math.max(0, Number(delayMs) || 0));
    }

    async function requestJson(url, init, signal) {
      let lastError = null;
      for (let attempt = 0; attempt < REFRESH_MAX_ATTEMPTS; attempt += 1) {
        if (signal?.aborted) throw createAbortError();
        const controller = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
        const abortFromParent = () => controller?.abort?.();
        signal?.addEventListener?.('abort', abortFromParent, { once: true });
        let timeoutId = 0;
        let timedOut = false;
        try {
          const timeoutPromise = new Promise((_resolve, reject) => {
            timeoutId = scheduleTimeout(() => {
              timedOut = true;
              controller?.abort?.();
              const error = new Error('Mailboxcontrole duurde te lang.');
              error.retryable = true;
              reject(error);
            }, REFRESH_REQUEST_TIMEOUT_MS);
          });
          const response = await Promise.race([
            request(url, {
              ...init,
              ...(controller ? { signal: controller.signal } : signal ? { signal } : {}),
            }),
            timeoutPromise,
          ]);
          const data = await response.json().catch(() => ({}));
          if (response.ok) return { response, data };
          const error = new Error(data?.detail || data?.error || 'Mailbox vernieuwen mislukt');
          error.status = response.status;
          error.retryable = isRetryableStatus(response.status);
          throw error;
        } catch (error) {
          if (signal?.aborted) throw createAbortError();
          if (!timedOut && error?.name === 'AbortError') throw error;
          lastError = error;
          if (!error?.retryable || attempt === REFRESH_MAX_ATTEMPTS - 1) throw error;
        } finally {
          if (timeoutId) cancelTimeout?.(timeoutId);
          signal?.removeEventListener?.('abort', abortFromParent);
        }
        await wait(REFRESH_RETRY_BASE_DELAY_MS * Math.pow(2, attempt), signal);
      }
      throw lastError || new Error('Mailbox vernieuwen mislukt');
    }

    function buildRefreshRequests(scope, signal) {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      const init = (body) => ({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers,
        body: JSON.stringify(body),
      });
      if (scope.folder === 'outreach') {
        return [
          requestJson('/api/mailbox/sync', init({
            owner: scope.owner,
            folder: 'inbox',
            limit: 4,
            campaignOnly: true,
            incrementalOnly: true,
            fastRefresh: true,
          }), signal),
          requestJson('/api/mailbox/instantly/sync', init({ owner: scope.owner, fastRefresh: true }), signal),
        ];
      }
      return [requestJson('/api/mailbox/sync', init({
        account: scope.account,
        folder: scope.folder,
        limit: 20,
      }), signal)];
    }

    async function refresh({ manual = false } = {}) {
      if (destroyed || paused) return false;
      if (refreshInFlight) {
        refreshQueued = true;
        return false;
      }
      const scope = getScope();
      const scopeKey = getScopeKey(scope);
      const state = getFreshness(scope);
      const cycleStartedAt = getNow();
      clearRefreshTimer();
      refreshInFlight = true;
      state.status = 'checking';
      setRefreshing(true);
      updateRefreshAge();
      activeController = typeof AbortControllerImpl === 'function' ? new AbortControllerImpl() : null;
      const signal = activeController?.signal;
      try {
        const settled = await Promise.allSettled(buildRefreshRequests(scope, signal));
        if (signal?.aborted || scopeKey !== getScopeKey(getScope())) return false;
        const fulfilled = settled.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value);
        const rejected = settled.filter((entry) => entry.status === 'rejected');
        const partialPayload = fulfilled.some((entry) => (
          isIncompleteRefreshPayload(entry?.data) || Number(entry?.response?.status) !== 200
        ));

        // Provider writes may be unavailable while the read-only mailbox endpoint is
        // still healthy (for example during an auth-hydration outage). Never let a
        // failed sync suppress the list read: the durable index may already contain
        // a reply written by cron, a webhook or another browser session.
        const listUpdated = await loadMessages({
          showLoader: false,
          skipBackgroundSync: true,
          skipProviderRefresh: true,
          skipPageBootstrap: true,
          openLatest: false,
          preserveOnError: true,
        });
        if (signal?.aborted || scopeKey !== getScopeKey(getScope())) return false;
        if (listUpdated === false) throw new Error('Mailboxlijst kon niet worden bijgewerkt.');

        const complete = !rejected.length && !partialPayload;
        if (complete) {
          state.lastSuccessfulAt = getNow();
          state.status = 'ok';
          failureCount = 0;
        } else {
          state.status = 'partial';
          state.lastErrorAt = getNow();
          failureCount += 1;
        }
        updateRefreshAge();
        if (manual) showToast(complete ? 'Mailbox volledig bijgewerkt' : 'Mailbox gedeeltelijk bijgewerkt');
        return complete;
      } catch (error) {
        if (signal?.aborted || scopeKey !== getScopeKey(getScope())) return false;
        state.status = 'recovering';
        state.lastErrorAt = getNow();
        failureCount += 1;
        updateRefreshAge();
        if (manual) showToast('Tijdelijke verbindingsstoring; je huidige mailbox blijft zichtbaar.');
        return false;
      } finally {
        if (scopeKey === getScopeKey(getScope())) setRefreshing(false);
        refreshInFlight = false;
        activeController = null;
        if (!destroyed && !paused) {
          if (refreshQueued) {
            refreshQueued = false;
            scheduleNext(0);
          } else {
            scheduleNext(getNextDelay(cycleStartedAt));
          }
        }
      }
    }

    function requestImmediateRefresh({ queueIfBusy = true } = {}) {
      if (!started || destroyed || paused) return;
      if (refreshInFlight) {
        if (queueIfBusy) refreshQueued = true;
        return;
      }
      scheduleNext(0);
    }

    function requestAmbientRefresh() {
      requestImmediateRefresh({ queueIfBusy: false });
    }

    function handleVisibilityChange() {
      if (documentRef?.visibilityState === 'visible') requestAmbientRefresh();
      else scheduleNext(HIDDEN_REFRESH_INTERVAL_MS);
    }

    function scopeChanged() {
      activeController?.abort?.();
      refreshQueued = false;
      failureCount = 0;
      setRefreshing(false);
      updateRefreshAge();
      requestImmediateRefresh();
    }

    function startRefreshAgeTimer() {
      if (refreshAgeTimer || typeof scheduleInterval !== 'function') return;
      refreshAgeTimer = scheduleInterval(updateRefreshAge, REFRESH_AGE_UPDATE_INTERVAL_MS);
    }

    function stopRefreshAgeTimer() {
      if (refreshAgeTimer) cancelInterval?.(refreshAgeTimer);
      refreshAgeTimer = 0;
    }

    function handlePageHide(event) {
      if (event?.persisted === true) {
        paused = true;
        refreshQueued = false;
        activeController?.abort?.();
        clearRefreshTimer();
        stopRefreshAgeTimer();
        setRefreshing(false);
        return;
      }
      destroy();
    }

    function handlePageShow(event) {
      if (event?.persisted !== true || destroyed || !started) return;
      paused = false;
      startRefreshAgeTimer();
      updateRefreshAge();
      requestImmediateRefresh();
    }

    function start() {
      if (started || destroyed) return;
      started = true;
      paused = false;
      startRefreshAgeTimer();
      documentRef?.addEventListener?.('visibilitychange', handleVisibilityChange);
      windowRef?.addEventListener?.('focus', requestAmbientRefresh);
      windowRef?.addEventListener?.('online', requestAmbientRefresh);
      windowRef?.addEventListener?.('pagehide', handlePageHide);
      windowRef?.addEventListener?.('pageshow', handlePageShow);
      updateRefreshAge();
      scheduleNext(0);
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      paused = false;
      activeController?.abort?.();
      clearRefreshTimer();
      stopRefreshAgeTimer();
      documentRef?.removeEventListener?.('visibilitychange', handleVisibilityChange);
      windowRef?.removeEventListener?.('focus', requestAmbientRefresh);
      windowRef?.removeEventListener?.('online', requestAmbientRefresh);
      windowRef?.removeEventListener?.('pagehide', handlePageHide);
      windowRef?.removeEventListener?.('pageshow', handlePageShow);
      button?.removeEventListener?.('click', handleButtonClick);
    }

    function handleButtonClick() {
      void refresh({ manual: true });
    }

    if (button) button.addEventListener('click', handleButtonClick);
    updateRefreshAge();
    if (options.autoStart !== false) start();
    return {
      destroy,
      refresh,
      requestImmediateRefresh,
      scopeChanged,
      start,
      updateRefreshAge,
    };
  }

  const mailboxRefreshApi = {
    HIDDEN_REFRESH_INTERVAL_MS,
    REFRESH_AGE_UPDATE_INTERVAL_MS,
    REFRESH_MAX_ATTEMPTS,
    REFRESH_REQUEST_TIMEOUT_MS,
    RECOVERY_REFRESH_INTERVAL_MS,
    VISIBLE_REFRESH_INTERVAL_MS,
    create,
    formatRefreshAge,
    getScopeKey,
    normalizeScope,
  };
  global.SoftoraMailboxRefresh = mailboxRefreshApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxRefreshApi;
})(typeof window !== 'undefined' ? window : globalThis);
