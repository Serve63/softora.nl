(function (initialize) {
  if (typeof module === 'object' && module.exports) module.exports = initialize;
  else initialize(window, document);
})(function (window, document) {
  'use strict';
  var teaser = document.querySelector('[data-ebook-teaser]');
  var dialog = document.querySelector('[data-ebook-dialog]');
  if (!teaser || !dialog || typeof dialog.showModal !== 'function') return;
  var launcher = document.querySelector('[data-ebook-launcher]');
  var form = dialog.querySelector('[data-ebook-form]');
  var status = dialog.querySelector('[data-ebook-status]');
  var success = dialog.querySelector('[data-ebook-success]');
  var download = dialog.querySelector('[data-ebook-download]');
  var submit = form.querySelector('[type="submit"]');
  var opened = false;
  var ready = false;
  var sending = false;
  var finished = false;
  var remaining = Math.max(0, 10000 - window.performance.now());
  var started;
  var timer;

  function reveal() {
    if (opened) return;
    ready = true;
    // Never stack over another open dialog, or move keyboard focus from the article.
    if (!document.hidden && !document.querySelector('dialog[open], [aria-modal="true"]')) {
      teaser.hidden = false;
      opened = true;
    }
  }
  function schedule() {
    window.clearTimeout(timer);
    if (opened || document.hidden) return;
    if (ready) return reveal();
    started = window.performance.now();
    timer = window.setTimeout(reveal, remaining);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      window.clearTimeout(timer);
      if (started !== undefined) remaining = Math.max(0, remaining - (window.performance.now() - started));
    } else schedule();
  });
  document.addEventListener('close', function () { if (ready) reveal(); }, true);
  schedule();

  function dismiss() { teaser.hidden = true; launcher.hidden = false; }
  document.querySelector('[data-ebook-dismiss]').addEventListener('click', function () {
    dismiss(); launcher.focus();
  });
  document.querySelectorAll('[data-ebook-open]').forEach(function (button) {
    button.addEventListener('click', function () {
      opened = true; window.clearTimeout(timer); dismiss(); dialog.showModal();
      if (finished) success.focus(); else form.elements.name.focus();
    });
  });
  dialog.querySelector('[data-ebook-close]').addEventListener('click', function () { dialog.close(); });
  dialog.addEventListener('click', function (event) {
    if (event.target !== dialog) return;
    var rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', function () { launcher.focus(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !teaser.hidden && !dialog.open) dismiss();
  });

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    sending = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    submit.textContent = 'Je e-book wordt klaargezet…'; status.textContent = '';
    var controller = new window.AbortController();
    var timeout = window.setTimeout(function () { controller.abort(); }, 20000);
    try {
      var response = await window.fetch('/api/public-ebook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ name: form.elements.name.value.trim(), email: form.elements.email.value.trim(),
          website: form.elements.website.value, page: window.location.pathname.replace(/\/$/, '') }),
      });
      var result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Je aanvraag is nog niet verwerkt. Probeer opnieuw.');
      if (result.downloadUrl !== '/assets/ebooks/meer-groei-minder-handwerk.pdf') throw new Error('De download is tijdelijk niet beschikbaar.');
      download.href = result.downloadUrl;
      finished = true; form.reset(); form.hidden = true; success.hidden = false;
      if (dialog.open) { success.focus(); download.click(); }
    } catch (error) {
      status.textContent = error.name === 'AbortError'
        ? 'Het duurt langer dan verwacht. Probeer het zo nog eens.'
        : (error.message === 'Failed to fetch' || error instanceof SyntaxError)
          ? 'Verbinding mislukt. Controleer je internetverbinding en probeer opnieuw.' : error.message;
    } finally {
      window.clearTimeout(timeout); sending = false; submit.disabled = false;
      submit.removeAttribute('aria-busy'); submit.textContent = 'Download PDF ↓';
    }
  });
});
