(function () {
  const SYNC_ENDPOINT = '/api/outreach/provider-sync';
  const DEFAULT_LIMIT = 10;
  const BUTTON_LABEL = '10 mockup-leads naar Instantly';

  function showToast(message) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = String(message || '');
    toast.classList.add('on');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      toast.classList.remove('on');
    }, 2600);
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.textContent = busy ? 'Leads worden doorgestuurd...' : BUTTON_LABEL;
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
        showToast(payload.reason === 'daily_cap_reached' ? 'Daglimiet bereikt' : 'Geen geschikte mockup-leads gevonden');
        return;
      }
      showToast('✓ ' + Number(payload.synced || 0).toLocaleString('nl-NL') + ' mockup-leads naar Instantly');
    } catch (error) {
      showToast(error && error.message ? error.message : 'Instantly-sync mislukt');
    } finally {
      setBusy(button, false);
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
