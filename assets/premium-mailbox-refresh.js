(function (global) {
  'use strict';

  const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  function create(options = {}) {
    const button = options.button || global.document?.getElementById('mailbox-refresh');
    const getAccount = typeof options.getAccount === 'function' ? options.getAccount : () => '';
    const getFolder = typeof options.getFolder === 'function' ? options.getFolder : () => 'inbox';
    const loadMessages = typeof options.loadMessages === 'function' ? options.loadMessages : async () => {};
    const showToast = typeof options.toast === 'function' ? options.toast : () => {};
    const request = typeof options.fetch === 'function' ? options.fetch : global.fetch.bind(global);
    const schedule = typeof options.setInterval === 'function' ? options.setInterval : global.setInterval?.bind(global);
    let refreshInFlight = false;
    let autoRefreshTimer = 0;

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

    if (button) button.addEventListener('click', () => void refresh({ manual: true }));
    startAutoRefresh();
    return { refresh, startAutoRefresh };
  }

  const mailboxRefreshApi = { AUTO_REFRESH_INTERVAL_MS, create };
  global.SoftoraMailboxRefresh = mailboxRefreshApi;
  if (typeof module !== 'undefined' && module.exports) module.exports = mailboxRefreshApi;
})(typeof window !== 'undefined' ? window : globalThis);
