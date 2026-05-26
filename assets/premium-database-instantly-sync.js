(function () {
  const SYNC_ENDPOINT = '/api/outreach/provider-sync';
  const DEFAULT_LIMIT = 10;
  const BUTTON_LABEL = '10 mockup-leads naar Instantly';

  function showToast(message, duration) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.add('on');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.classList.remove('on');
    }, duration || 3600);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = label || (busy ? 'Leads worden doorgestuurd...' : BUTTON_LABEL);
  }

  function showButtonMessage(button, message) {
    if (!button) return;
    window.clearTimeout(showButtonMessage.timer);
    button.textContent = message;
    showButtonMessage.timer = window.setTimeout(function () {
      if (!button.disabled) button.textContent = BUTTON_LABEL;
    }, 4200);
  }

  function showBlockingError(message) {
    const text = String(message || 'Instantly-sync mislukt');
    showToast(text, 7000);
    if (typeof window.alert === 'function') window.alert(text);
  }

  function reloadDatabaseSoon(button) {
    setBusy(button, true, 'Database wordt ververst...');
    window.setTimeout(function () {
      window.location.reload();
    }, 900);
  }

  function getMessage(payload, fallback) {
    if (payload && typeof payload === 'object') {
      return payload.message || payload.error || fallback;
    }
    return fallback;
  }

  async function syncLeads(button) {
    if (!window.confirm('10 leads met webdesign en mockup naar Instantly sturen?')) return;
    setBusy(button, true);
    let reloadScheduled = false;
    try {
      const response = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: DEFAULT_LIMIT,
          actor: 'Database knop',
        }),
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !payload.ok) {
        throw new Error(getMessage(payload, 'Instantly-sync mislukt.'));
      }
      if (payload.skipped) {
        const message = payload.reason === 'daily_cap_reached' ? 'Daglimiet bereikt' : 'Geen geschikte mockup-leads gevonden';
        showToast(message, 5600);
        showButtonMessage(button, message);
        return;
      }
      const syncedCount = Number(payload.synced || 0);
      const markedCount = Number(payload.markedBenaderd || 0);
      if (syncedCount > 0 || markedCount > 0) {
        showToast('✓ ' + syncedCount.toLocaleString('nl-NL') + ' mockup-leads naar Instantly. Database wordt ververst...', 5600);
        reloadScheduled = true;
        reloadDatabaseSoon(button);
        return;
      }
      showToast('Geen nieuwe mockup-leads doorgestuurd', 5600);
      showButtonMessage(button, 'Geen nieuwe mockup-leads');
    } catch (error) {
      showBlockingError(error && error.message ? error.message : 'Instantly-sync mislukt');
    } finally {
      if (!reloadScheduled) setBusy(button, false);
    }
  }

  function bind() {
    const button = document.getElementById('instantOutreachSyncButton');
    if (!button) return;
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const menu = button.closest('.add-actions');
      if (menu) menu.classList.remove('is-open');
      void syncLeads(button);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
