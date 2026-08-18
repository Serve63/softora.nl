(function () {
  'use strict';

  if (window.__softoraLeadRadarSidebarInitialized === true) return;
  window.__softoraLeadRadarSidebarInitialized = true;

  const LINK_KEY = 'lead_radar';
  const LINK_HREF = '/lead-radar';
  const LINK_LABEL = 'Lead Radar';
  const LINK_ICON = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path stroke-linecap="round" stroke-linejoin="round" d="m16 16 4.25 4.25M11 7.5v3.75l2.5 1.5"></path></svg>';

  function syncLink() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return false;
    const overview = Array.from(sidebar.querySelectorAll('.sidebar-section')).find((section) => {
      const label = section.querySelector('.sidebar-section-label');
      return String(label?.textContent || '').trim().toLowerCase() === 'overzicht';
    });
    if (!overview) return false;
    let link = overview.querySelector(`[data-sidebar-key="${LINK_KEY}"]`);
    if (!link) {
      link = document.createElement('a');
      link.className = 'sidebar-link magnetic';
      link.dataset.sidebarKey = LINK_KEY;
      link.innerHTML = `${LINK_ICON}<span class="sidebar-link-text">${LINK_LABEL}</span>`;
      const database = overview.querySelector('[data-sidebar-key="database"]');
      overview.insertBefore(link, database || null);
    }
    if (window.location.pathname === LINK_HREF) {
      sidebar.querySelectorAll('.sidebar-link[data-sidebar-key]').forEach((item) => {
        item.classList.toggle('active', item === link);
      });
    }
    link.href = LINK_HREF;
    link.classList.remove('sidebar-link--coming-soon');
    link.removeAttribute('aria-disabled');
    link.removeAttribute('tabindex');
    link.classList.toggle('active', window.location.pathname === LINK_HREF);
    return true;
  }

  function boot() {
    if (syncLink()) return;
    const observer = new MutationObserver(syncLink);
    observer.observe(document.body, { childList: true, subtree: true });
    const retry = () => {
      if (!syncLink()) return;
      observer.disconnect();
    };
    window.setTimeout(retry, 100);
    window.setTimeout(retry, 500);
    window.setTimeout(() => observer.disconnect(), 3000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
