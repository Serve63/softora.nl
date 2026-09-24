(function (global) {
  function createController({ document, fetch, crypto, refresh = () => {} }) {
    const dialog = document.getElementById('kvk-upload-dialog');
    const opener = document.getElementById('kvk-upload-open');
    const button = document.getElementById('kvk-upload-with-website');
    const count = document.getElementById('kvk-upload-count');
    const message = document.getElementById('kvk-upload-message');
    const resultLink = document.getElementById('kvk-upload-result');
    let busy = false, ready = false, requestId = null, revision = 0;
    async function request(options) {
      const response = await fetch('/api/kvk-database/upload', { credentials: 'same-origin', cache: 'no-store', ...options });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Upload kon niet worden bevestigd. Probeer opnieuw.');
      return data;
    }
    async function open() {
      if (busy) return;
      dialog.showModal();
      const current = ++revision;
      // Keep the same operation ID after an uncertain response, including reopening.
      ready = false; button.disabled = true; message.textContent = ''; resultLink.hidden = true;
      count.textContent = 'Voorraad controleren…';
      try {
        const data = await request();
        if (current !== revision) return;
        count.textContent = `${data.count.toLocaleString('nl-NL')} bedrijven klaar voor Beschikbaar`;
        ready = data.count > 0 || Boolean(requestId);
        button.disabled = !ready;
      } catch (error) { count.textContent = 'Voorraad tijdelijk niet beschikbaar'; message.textContent = error.message; }
    }
    async function upload() {
      if (busy || !ready) return;
      busy = true; button.disabled = true; opener.disabled = true;
      requestId ||= crypto.randomUUID();
      message.textContent = 'Bedrijven worden geüpload…';
      try {
        const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Softora-Requested-With': 'premium' }, body: JSON.stringify({ mode: 'with-website', requestId }) });
        message.textContent = `${data.count.toLocaleString('nl-NL')} bedrijven toegevoegd aan Beschikbaar.`;
        count.textContent = 'Upload afgerond'; resultLink.hidden = false; ready = false; requestId = null;
        refresh();
      } catch (error) { message.textContent = error.message; }
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
