(function (global) {
  function createPendingNavigation(windowRef) {
    // Only the operation reference lives in navigation; the server receipt is authoritative.
    function target() { try { return windowRef.top?.location ? windowRef.top : windowRef; } catch (_) { return windowRef; } }
    return {
      read() {
        const url = new URL(target().location.href);
        return { requestId: url.searchParams.get('kvkUploadRequest'), count: Number(url.searchParams.get('kvkUploadCount')) };
      },
      write(value) {
        const window = target(), url = new URL(window.location.href);
        if (value) { url.searchParams.set('kvkUploadRequest', value.requestId); url.searchParams.set('kvkUploadCount', String(value.count)); }
        else { url.searchParams.delete('kvkUploadRequest'); url.searchParams.delete('kvkUploadCount'); }
        window.history.replaceState(window.history.state, '', url.href);
      },
    };
  }
  function createController({ document, fetch, crypto, pendingNavigation, onInventory = () => {}, timeoutMs = 120000, refresh = () => {} }) {
    const dialog = document.getElementById('kvk-upload-dialog');
    const opener = document.getElementById('kvk-upload-open');
    const button = document.getElementById('kvk-upload-with-website');
    const count = document.getElementById('kvk-upload-count');
    const amount = document.getElementById('kvk-upload-amount');
    const message = document.getElementById('kvk-upload-message');
    const resultLink = document.getElementById('kvk-upload-result');
    const exclusions = document.getElementById('kvk-upload-exclusions');
    let busy = false, ready = false, requestId = null, requestedCount = null, available = 0, revision = 0;
    try {
      const pending = pendingNavigation?.read();
      if (/^[0-9a-f-]{36}$/i.test(pending?.requestId || '') && Number.isInteger(pending.count) && pending.count > 0 && pending.count <= 50000) {
        requestId = pending.requestId; requestedCount = pending.count;
      }
    } catch (_) { /* Recovery remains available in memory when navigation is unavailable. */ }
    function rememberPending() {
      try {
        pendingNavigation?.write(requestId ? { requestId, count: requestedCount } : null);
      } catch (_) { /* A navigation failure never starts a second operation. */ }
    }
    async function request(options) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch('/api/kvk-database/upload', { credentials: 'same-origin', cache: 'no-store', signal: controller?.signal, ...options });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          const error = new Error(data.error || 'Upload kon niet worden bevestigd. Probeer opnieuw.');
          error.status = response.status;
          throw error;
        }
        if (!Number.isSafeInteger(data.count) || data.count < 0) throw new Error('Uploadstatus bevat geen geldig aantal. Probeer opnieuw.');
        return data;
      } catch (error) {
        if (error.name === 'AbortError') throw new Error('De server reageert te langzaam. Probeer dezelfde overdracht opnieuw.');
        throw error;
      } finally { if (timer) clearTimeout(timer); }
    }
    async function open() {
      if (busy) return;
      dialog.showModal();
      const current = ++revision;
      // Keep the same operation ID after an uncertain response, including reopening.
      ready = false; button.disabled = true; amount.disabled = true; message.textContent = ''; resultLink.hidden = true;
      count.textContent = 'Voorraad controleren…';
      if (exclusions) exclusions.textContent = '';
      if (requestId) {
        amount.value = String(requestedCount);
        count.textContent = 'Vorige overdracht controleren';
        message.textContent = 'Klik op Uploaden om dezelfde overdracht veilig te bevestigen.';
        ready = true; button.disabled = false;
        return;
      }
      try {
        const data = await request();
        if (current !== revision) return;
        available = data.count;
        onInventory(data);
        count.textContent = `${available.toLocaleString('nl-NL')} beschikbaar`;
        if (exclusions && data.excludedCount > 0) {
          exclusions.textContent = `${data.excludedCount.toLocaleString('nl-NL')} onderzoeksregels uitgesloten door dubbele gegevens of eerdere benadering.`;
        }
        if (requestedCount !== null) amount.value = String(requestedCount);
        else if (!/^[1-9][0-9]*$/.test(amount.value || '') || Number(amount.value) > available) amount.value = String(Math.min(1, available));
        amount.disabled = Boolean(requestId) || available === 0;
        ready = data.count > 0 || Boolean(requestId);
        button.disabled = !ready;
      } catch (error) {
        if (current !== revision) return;
        count.textContent = 'Voorraad tijdelijk niet beschikbaar'; message.textContent = error.message;
      }
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
      message.textContent = 'Bedrijven worden geüpload…';
      try {
        requestId ||= crypto.randomUUID();
        rememberPending();
        const data = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Softora-Requested-With': 'premium' }, body: JSON.stringify({ mode: 'with-website', requestId, count: requestedCount }) });
        if (data.count !== requestedCount) throw new Error('Het opgeslagen aantal kon niet worden bevestigd. Probeer dezelfde overdracht opnieuw.');
        message.textContent = data.snapshotReady === false
          ? `${data.count.toLocaleString('nl-NL')} bedrijven opgeslagen. De lijst Beschikbaar wordt bij openen opnieuw ververst.`
          : `${data.count.toLocaleString('nl-NL')} bedrijven toegevoegd aan Beschikbaar.`;
        count.textContent = 'Upload afgerond'; resultLink.hidden = false; ready = false; requestId = null; requestedCount = null;
        rememberPending();
        try { await refresh(); } catch (_) { /* The confirmed database write remains successful. */ }
      } catch (error) {
        if (error.status === 400 || error.status === 409) {
          requestId = null; requestedCount = null; rememberPending(); ready = false;
          try {
            const stock = await request(); available = stock.count; onInventory(stock);
            count.textContent = `${available.toLocaleString('nl-NL')} beschikbaar`;
            amount.value = String(Math.min(selected, available)); amount.disabled = available === 0; ready = available > 0;
          } catch (_) { count.textContent = 'Voorraad tijdelijk niet beschikbaar'; }
        }
        if (!requestId) { requestedCount = null; amount.disabled = !ready; }
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
  if (typeof module === 'object' && module.exports) module.exports = { createController, createPendingNavigation };
  else createController({ document: global.document, fetch: global.fetch.bind(global), crypto: global.crypto, pendingNavigation: createPendingNavigation(global),
    onInventory(data) { global.dispatchEvent(new CustomEvent('kvk-upload-inventory', { detail: data })); }, refresh() {
    void global.refreshDashboard?.({ reloadTables: true, preserveScroll: true });
    global.dispatchEvent(new Event('kvk-upload-completed'));
  } });
})(typeof window === 'object' ? window : globalThis);
