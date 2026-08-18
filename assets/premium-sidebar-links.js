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

  window.SoftoraPremiumSidebarLinks = Object.freeze({ getLeadRadarSidebarLink });
}());
