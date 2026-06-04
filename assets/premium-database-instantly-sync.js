(function () {
  const SAFE_UPLOAD_ENDPOINT = '/api/outreach/provider-upload';
  const STATUS_ENDPOINT = '/api/outreach/provider-status';
  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 250;
  const FALLBACK_CAMPAIGN_ID = '7feff589-b0b5-46f7-ad23-c47d9b3c2a03';
  const BUTTON_LABEL = 'Veilige Instantly CSV maken';

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
    button.textContent = label || (busy ? 'Leads worden veilig gereserveerd...' : BUTTON_LABEL);
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
    const text = String(message || 'Veilige Instantly upload mislukt');
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

  function promptLeadLimit() {
    const raw = typeof window.prompt === 'function'
      ? window.prompt('Hoeveel nieuwe leads veilig reserveren voor Instantly?', String(DEFAULT_LIMIT))
      : String(DEFAULT_LIMIT);
    if (raw === null) return null;
    const parsed = Math.floor(Number(String(raw).replace(',', '.')));
    if (!Number.isFinite(parsed) || parsed < 1) {
      showBlockingError('Kies een geldig aantal leads.');
      return null;
    }
    return Math.min(MAX_LIMIT, parsed);
  }

  async function getDefaultCampaignId() {
    try {
      const response = await fetch(STATUS_ENDPOINT, {
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      return String((payload && payload.campaignId) || FALLBACK_CAMPAIGN_ID || '').trim();
    } catch (_error) {
      return FALLBACK_CAMPAIGN_ID;
    }
  }

  function downloadCsv(fileName, csv) {
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'softora-instantly-leads.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 2500);
  }

  async function syncLeads(button) {
    const limit = promptLeadLimit();
    if (!limit) return;
    const campaignId = await getDefaultCampaignId();
    if (!campaignId) {
      showBlockingError('Instantly campaign ID ontbreekt. Stel eerst de campaign ID in.');
      return;
    }
    if (!window.confirm(limit + ' leads eerst in Softora reserveren en daarna als Instantly CSV downloaden?')) return;
    setBusy(button, true);
    let reloadScheduled = false;
    try {
      const response = await fetch(SAFE_UPLOAD_ENDPOINT, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: limit,
          campaignId: campaignId,
          actor: 'Database veilige Instantly upload',
        }),
      });
      const payload = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !payload.ok) {
        throw new Error(getMessage(payload, 'Veilige Instantly upload mislukt.'));
      }
      if (payload.skipped) {
        const requested = Number(payload.requested || limit || 0);
        const available = Number(payload.available || payload.prepared || 0);
        const message = payload.reason === 'insufficient_eligible_leads' || requested > available
          ? 'Zet eerst genoeg mail-ready leads klaar. Gevraagd: ' + requested + ', veilig klaar: ' + available + '.'
          : 'Geen geschikte mockup-leads gevonden';
        showToast(message, 5600);
        showButtonMessage(button, message);
        return;
      }
      const syncedCount = Number(payload.prepared || payload.synced || 0);
      const markedCount = Number(payload.markedBenaderd || 0);
      if (syncedCount > 0 || markedCount > 0) {
        downloadCsv(payload.fileName, payload.csv);
        showToast('✓ ' + syncedCount.toLocaleString('nl-NL') + ' leads veilig gereserveerd. CSV wordt gedownload...', 5600);
        reloadScheduled = true;
        reloadDatabaseSoon(button);
        return;
      }
      showToast('Geen nieuwe mockup-leads gereserveerd', 5600);
      showButtonMessage(button, 'Geen nieuwe mockup-leads');
    } catch (error) {
      showBlockingError(error && error.message ? error.message : 'Veilige Instantly upload mislukt');
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
