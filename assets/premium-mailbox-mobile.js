(function () {
  'use strict';

  const shell = document.querySelector('.mail-page-shell');
  const sidebar = document.querySelector('.dashboard-layout > .sidebar');
  const backdrop = document.querySelector('.mailbox-mobile-sidebar-backdrop');
  const menuButton = document.querySelector('[data-mailbox-mobile-action="toggle-navigation"]');
  const list = document.querySelector('.mail-list');
  const detail = document.getElementById('mail-detail');
  const compose = document.getElementById('compose-overlay');
  const singlePane = window.matchMedia('(max-width: 720px)');
  const compactShell = window.matchMedia('(max-width: 900px)');
  const params = new URLSearchParams(window.location.search);
  let detailRequested = ['message', 'email', 'query'].some((key) => params.has(key));
  let detailReturnFocus = null;
  let composeReturnFocus = null;

  if (!shell || !sidebar || !list || !detail || !compose) return;

  function isSinglePane() {
    return singlePane.matches;
  }

  function setPaneAccessibility(showingDetail) {
    if (!isSinglePane()) {
      list.removeAttribute('aria-hidden');
      detail.removeAttribute('aria-hidden');
      list.inert = false;
      detail.inert = false;
      return;
    }
    list.setAttribute('aria-hidden', String(showingDetail));
    detail.setAttribute('aria-hidden', String(!showingDetail));
    list.inert = showingDetail;
    detail.inert = !showingDetail;
  }

  function showList(options = {}) {
    detailRequested = false;
    shell.classList.remove('is-mobile-detail-open');
    setPaneAccessibility(false);
    if (options.restoreFocus !== false && detailReturnFocus?.isConnected) {
      requestAnimationFrame(() => detailReturnFocus.focus({ preventScroll: true }));
    }
  }

  function showDetail(source) {
    if (!isSinglePane() || detail.querySelector('.detail-empty')) return;
    detailRequested = true;
    detailReturnFocus = source?.closest?.('[data-mailbox-action="open-mail"]') || detailReturnFocus;
    shell.classList.add('is-mobile-detail-open');
    setPaneAccessibility(true);
  }

  function setNavigationOpen(open, options = {}) {
    const active = Boolean(open && compactShell.matches);
    document.body.classList.toggle('mailbox-mobile-nav-open', active);
    menuButton?.setAttribute('aria-expanded', String(active));
    menuButton?.setAttribute('aria-label', active ? 'Navigatie sluiten' : 'Navigatie openen');
    sidebar.setAttribute('aria-hidden', String(compactShell.matches && !active));
    sidebar.inert = compactShell.matches && !active;
    if (backdrop) backdrop.hidden = !active;
    if (active) {
      requestAnimationFrame(() => sidebar.querySelector('a[href]:not([tabindex="-1"])')?.focus());
    } else if (options.restoreFocus) {
      requestAnimationFrame(() => menuButton?.focus());
    }
  }

  function syncVisualViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight);
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    document.documentElement.style.setProperty('--mailbox-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--mailbox-viewport-offset-top', `${offsetTop}px`);
  }

  function ensureDetailToolbar() {
    const body = detail.querySelector('.detail-body');
    if (!body || body.querySelector('.mailbox-mobile-detail-toolbar')) return;
    body.insertAdjacentHTML('afterbegin', `
      <div class="mailbox-mobile-detail-toolbar">
        <button class="mailbox-mobile-back" type="button" data-mailbox-mobile-action="show-list">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
          <span>Inbox</span>
        </button>
      </div>`);
  }

  function syncComposeState() {
    const open = compose.classList.contains('open');
    compose.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('mailbox-mobile-compose-open', open);
    if (open) {
      requestAnimationFrame(() => document.getElementById('c-body')?.focus({ preventScroll: true }));
    } else if (composeReturnFocus?.isConnected) {
      requestAnimationFrame(() => composeReturnFocus.focus({ preventScroll: true }));
      composeReturnFocus = null;
    }
  }

  function getFocusable(container) {
    return Array.from(container.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), textarea:not([disabled]):not([hidden]), [href]:not([tabindex="-1"])'))
      .filter((element) => !element.closest('[hidden]'));
  }

  document.addEventListener('click', (event) => {
    const mobileAction = event.target.closest?.('[data-mailbox-mobile-action]');
    if (mobileAction) {
      const action = mobileAction.getAttribute('data-mailbox-mobile-action');
      if (action === 'toggle-navigation') setNavigationOpen(!document.body.classList.contains('mailbox-mobile-nav-open'));
      if (action === 'close-navigation') setNavigationOpen(false, { restoreFocus: true });
      if (action === 'show-list') showList();
      return;
    }

    if (compactShell.matches && event.target.closest?.('.sidebar a')) setNavigationOpen(false);
    if (event.target.closest?.('[data-mailbox-email]')) showList({ restoreFocus: false });

    const action = event.target.closest?.('[data-mailbox-action]');
    if (!action) return;
    const command = action.getAttribute('data-mailbox-action');
    if (command === 'open-mail') requestAnimationFrame(() => showDetail(action));
    if (command === 'reply-mail' || command === 'new-message') composeReturnFocus = action;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && compose.classList.contains('open')) {
      event.preventDefault();
      document.querySelector('[data-mailbox-action="close-compose"]')?.click();
      return;
    }
    if (event.key === 'Escape' && document.body.classList.contains('mailbox-mobile-nav-open')) {
      event.preventDefault();
      setNavigationOpen(false, { restoreFocus: true });
      return;
    }
    if (event.key === 'Escape' && isSinglePane() && shell.classList.contains('is-mobile-detail-open')) {
      event.preventDefault();
      showList();
      return;
    }
    if (event.key !== 'Tab' || !compose.classList.contains('open')) return;
    const focusable = getFocusable(compose);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  new MutationObserver(() => {
    ensureDetailToolbar();
    if (detail.querySelector('.detail-empty')) {
      shell.classList.remove('is-mobile-detail-open');
      setPaneAccessibility(false);
      if (!detailRequested) showList({ restoreFocus: false });
    }
    else if (detailRequested) showDetail(detailReturnFocus);
  }).observe(detail, { childList: true, subtree: true });
  new MutationObserver(syncComposeState).observe(compose, { attributes: true, attributeFilter: ['class'] });

  function handleBreakpointChange() {
    setNavigationOpen(false);
    if (!isSinglePane()) {
      shell.classList.remove('is-mobile-detail-open');
      setPaneAccessibility(false);
    } else if (detailRequested && !detail.querySelector('.detail-empty')) showDetail(detailReturnFocus);
    else if (detailRequested) {
      shell.classList.remove('is-mobile-detail-open');
      setPaneAccessibility(false);
    } else showList({ restoreFocus: false });
  }

  singlePane.addEventListener('change', handleBreakpointChange);
  compactShell.addEventListener('change', handleBreakpointChange);
  window.visualViewport?.addEventListener('resize', syncVisualViewport);
  window.visualViewport?.addEventListener('scroll', syncVisualViewport);
  window.addEventListener('resize', syncVisualViewport, { passive: true });
  window.SoftoraMailboxMobile = { isSinglePane, showList, showDetail, syncVisualViewport };
  syncVisualViewport();
  syncComposeState();
  setNavigationOpen(false);
  handleBreakpointChange();
})();
