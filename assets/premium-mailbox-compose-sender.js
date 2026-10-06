(function (global) {
  'use strict';

  const normalize = (value) => String(value || '').trim().toLowerCase();
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);

  function create(options = {}) {
    const documentRef = options.document || global.document;
    let generation = 0;
    let loading = false;
    const field = () => documentRef?.getElementById('c-from');
    const row = () => documentRef?.getElementById('compose-from-field');

    function getAccounts() {
      const seen = new Set();
      return (options.getAccounts?.() || []).flatMap((account) => {
        const email = normalize(account.email);
        const owner = normalize(options.campaignInbox?.getOwnerByAccount?.(email));
        if (!email || seen.has(email) || account.smtpConfigured !== true || !['serve', 'martijn'].includes(owner)) return [];
        seen.add(email);
        return [{ accountEmail: email, owner }];
      });
    }

    function reset() {
      generation += 1;
      loading = false;
      if (row()) row().hidden = true;
      if (field()) {
        field().innerHTML = '<option value="">Kies afzender</option>';
        field().value = '';
        field().disabled = true;
      }
    }

    async function open() {
      const requestGeneration = ++generation;
      if (!row() || !field()) throw new Error('De afzenderkeuze ontbreekt; vernieuw de mailbox.');
      row().hidden = false;
      loading = true;
      field().disabled = true;
      field().innerHTML = '<option value="">Afzenders laden…</option>';
      field().value = '';
      try {
        await options.whenAccountsReady?.();
        if (requestGeneration !== generation) return;
        const accounts = getAccounts();
        field().innerHTML = `<option value="">${accounts.length ? 'Kies afzender' : 'Geen verzendmailbox beschikbaar'}</option>`
          + accounts.map((account) => `<option value="${escapeHtml(account.accountEmail)}">${escapeHtml(account.accountEmail)}</option>`).join('');
        field().value = '';
        loading = false;
        field().disabled = !accounts.length;
      } catch (error) {
        if (requestGeneration !== generation) return;
        loading = false;
        field().innerHTML = '<option value="">Afzenders laden mislukt</option>';
        options.toast?.(String(error?.message || 'Afzenders laden mislukt'));
      }
    }

    function getSelection() {
      if (loading) throw new Error('De afzenders worden nog geladen.');
      const accountEmail = normalize(field()?.value);
      if (!accountEmail) throw new Error('Kies eerst vanaf welk e-mailadres je wilt verzenden.');
      const selected = getAccounts().find((account) => account.accountEmail === accountEmail);
      if (!selected) throw new Error('Deze afzender is niet beschikbaar om te verzenden; kies een eigen mailbox.');
      return selected;
    }

    function setBusy(busy) {
      if (field() && row()?.hidden === false) field().disabled = busy || loading || !getAccounts().length;
    }

    return { open, reset, getSelection, setBusy };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.SoftoraMailboxComposeSender = api;
})(typeof window !== 'undefined' ? window : globalThis);
