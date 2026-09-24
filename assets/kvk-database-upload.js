(function (global) {
  function createController({ document, fetch, crypto, refresh = () => {} }) {
    const dialog = document.getElementById('kvk-upload-dialog');
    const opener = document.getElementById('kvk-upload-open');
    const button = document.getElementById('kvk-upload-with-website');
    const count = document.getElementById('kvk-upload-count');
    const amount = document.getElementById('kvk-upload-amount');
    const message = document.getElementById('kvk-upload-message');
    const resultLink = document.getElementById('kvk-upload-result');
    let busy = false, ready = false, requestId = null, requestedCount = null, available = 0, revision = 0;
    async function request(options) {
      const response = await fetch('/api/kvk-database/upload', { credentials: 'same-origin', cache: 'no-store', ...options });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const error = new Error(data.error || 'Upload kon niet worden bevestigd. Probeer opnieuw.');
        error.status = response.status;
        throw error;
      }
      return data;
    }
    async function open() {
      if (busy) return;
      dialog.showModal();
      const current = ++revision;
      // Keep the same operation ID after an uncertain response, including reopening.
      ready = false; button.disabled = true; amount.disabled = true; message.textContent = ''; resultLink.hidden = true;
      count.textContent = 'Voorraad controleren…';
      try {
        const data = await request();
        if (current !== revision) return;
        available = data.count;
        count.textContent = `${available.toLocaleString('nl-NL')} beschikbaar`;
        if (requestedCount !== null) amount.value = String(requestedCount);
        else if (!/^[1-9][0-9]*$/.test(amount.value || '') || Number(amount.value) > available) amount.value = String(Math.min(1, available));
        amount.disabled = Boolean(requestId) || available === 0;
        ready = data.count > 0 || Boolean(requestId);
        button.disabled = !ready;
      } catch (error) { count.textContent = 'Voorraad tijdelijk niet beschikbaar'; message.textContent = error.message; }
    }
    async function upload() {
      if (busy || !ready) return;
      const selected = requestedCount ?? Number(amount.value);
      if (requestedCount === null && (!/^[1-9][0-9]*$/.test(amount.value || '') || !Number.isInteger(selected) || selected < 1 || selected > available || selected > 50000)) {
        message.textContent = `Vul een heel aantal van 1 tot ${available.toLocaleString('nl-NL')} in.`;
        return;
      }
      requestedCount = selected; amount.disabled = true;
      busy = true; button.disabled = true; opener.disabled = true;
      requestId ||= crypto.randomUUID();
      message.textContent = 'Bedrijven worden geüpload…';
      try {
        const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Softora-Requested-With': 'premium' }, body: JSON.stringify({ mode: 'with-website', requestId, count: requestedCount }) });
        message.textContent = data.snapshotReady === false
          ? `${data.count.toLocaleString('nl-NL')} bedrijven opgeslagen. De lijst Beschikbaar wordt bij openen opnieuw ververst.`
          : `${data.count.toLocaleString('nl-NL')} bedrijven toegevoegd aan Beschikbaar.`;
        count.textContent = 'Upload afgerond'; resultLink.hidden = false; ready = false; requestId = null; requestedCount = null;
        refresh();
      } catch (error) {
        if (error.status === 400 || error.status === 409) { requestId = null; requestedCount = null; amount.disabled = false; }
        message.textContent = error.message;
      }
      finally { busy = false; button.disabled = !ready; opener.disabled = false; }
    }
    opener.addEventListener('click', open);
    button.addEventListener('click', upload);
    document.getElementById('kvk-upload-close').addEventListener('click', () => { if (!busy) { revision++; dialog.close(); } });
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); else revision++; });
    return { open, upload };
  }
  if (typeof module === 'object' && module.exports) module.exports = { createController };
  else createController({ document: global.document, fetch: global.fetch.bind(global), crypto: global.crypto, refresh() {
    void global.refreshDashboard?.({ reloadTables: true, preserveScroll: true });
    global.dispatchEvent(new Event('kvk-upload-completed'));
  } });
})(typeof window === 'object' ? window : globalThis);
