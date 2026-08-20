(function () {
  'use strict';

  function getLeadRadarSidebarLink() {
    return {
      key: 'lead_radar',
      href: '/lead-radar',
      label: 'Lead Radar',
      icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path stroke-linecap="round" stroke-linejoin="round" d="m16 16 4.25 4.25M11 7.5v3.75l2.5 1.5"></path></svg>',
    };
  }

  function getSummarizeSidebarLink() {
    return {
      key: 'summarize',
      href: '/premium-samenvatten',
      label: 'Samenvatten',
      icon: '<svg class="sidebar-link-summarize-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"></path></svg>',
    };
  }

  window.SoftoraPremiumSidebarLinks = Object.freeze({ getLeadRadarSidebarLink, getSummarizeSidebarLink });
}());
