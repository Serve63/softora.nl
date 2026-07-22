(function (global) {
  'use strict';

  const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
  const REFRESH_AGE_UPDATE_INTERVAL_MS = 1000;

  function formatRefreshAge(lastRefreshAt, currentTime = Date.now()) {
    const elapsedMs = Math.max(0, Number(currentTime) - Number(lastRefreshAt));
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (elapsedSeconds < 60) {
      return elapsedSeconds === 1 ? '1 sec geleden' : elapsedSeconds + ' sec geleden';
    }
    const elapsedMinutes = Math.floor(elapsedMs / 60_000);
    if (elapsedMinutes < 60) return `${elapsedMinutes} min geleden`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    return elapsedHours === 1 ? '1 uur geleden' : `${elapsedHours} uur geleden`;
  }

  function create(options = {}) {
    const button = options.button || global.document?.getElementById('mailbox-refresh');
    const ageLabel = options.ageLabel || global.document?.getElementById('mailbox-refresh-age');
    const getAccount = typeof options.getAccount === 'function' ? options.getAccount : () => '';
    const getFolder = typeof options.getFolder === 'function' ? options.getFolder : () => 'inbox';
    const loadMessages = typeof options.loadMessages === 'function' ? options.loadMessages : async () => {};
    const showToast = typeof options.toast === 'function' ? options.toast : () => {};
    const request = typeof options.fetch === 'function' ? options.fetch : global.fetch.bind(global);
    const schedule = typeof options.setInterval === 'function' ? options.setInterval : global.setInterval?.bind(global);
    const getNow = typeof options.now === 'function' ? options.now : Date.now;
    let refreshInFlight = false;
    let autoRefreshTimer = 0;
    let refreshAgeTimer = 0;
    let lastRefreshAt = getNow();

    function updateRefreshAge() {
      if (!ageLabel) return;
      ageLabel.textContent = formatRefreshAge(lastRefreshAt, getNow());
      ageLabel.setAttribute('title', `Laatst vernieuwd: ${new Date(lastRefreshAt).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}`);
    }

    function setRefreshing(refreshing) {
      if (!button) return;
      button.disabled = Boolean(refreshing);
      button.classList.toggle('is-refreshing', Boolean(refreshing));
      button.setAttribute('aria-busy', refreshing ? 'true' : 'false');
    }

    async function refresh({ manual = false } = {}) {
      if (refreshInFlight) return false;
      refreshInFlight = true;
      setRefreshing(true);
      try {
        const activeFolder = String(getFolder() || 'inbox').trim().toLowerCase() || 'inbox';
        const response = await request('/api/mailbox/sync', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            account: activeFolder === 'outreach' ? '' : String(getAccount() || '').trim().toLowerCase(),
            folder: activeFolder === 'outreach' ? 'inbox' : activeFolder,
            limit: activeFolder === 'outreach' ? 100 : 50,
            force: true,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.detail || data?.error || 'Mailbox vernieuwen mislukt');
        await loadMessages({ showLoader: false, skipBackgroundSync: true, openLatest: false });
        lastRefreshAt = getNow();
        updateRefreshAge();
        if (manual) showToast(data?.ok === false ? 'Mailbox gedeeltelijk bijgewerkt' : 'Mailbox bijgewerkt');
        return true;
      } catch (error) {
        if (manual) showToast(String(error?.message || error || 'Mailbox vernieuwen mislukt'));
        return false;
      } finally {
        refreshInFlight = false;
        setRefreshing(false);
      }
    }

    function startAutoRefresh() {
      if (autoRefreshTimer || typeof schedule !== 'function') return;
      autoRefreshTimer = schedule(() => void refresh(), AUTO_REFRESH_INTERVAL_MS);
    }

    function startRefreshAgeTicker() {
      if (refreshAgeTimer || typeof schedule !== 'function') return;
      refreshAgeTimer = schedule(updateRefreshAge, REFRESH_AGE_UPDATE_INTERVAL_MS);
    }

    if (button) button.addEventListener('click', () => void refresh({ manual: true }));
    updateRefreshAge();
    startAutoRefresh();
    startRefreshAgeTicker();
    return { refresh, startAutoRefresh, updateRefreshAge };
  }

  const mailboxRefreshApi = { AUTO_REFRESH_INTERVAL_MS, REFRESH_AGE_UPDATE_INTERVAL_MS, formatRefreshAge, create };
  global.SoftoraMailboxRefresh = mailboxRefreshApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxRefreshApi;
})(typeof window !== 'undefined' ? window : globalThis);
