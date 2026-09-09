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

  function getMailboxSidebarLink() { return { key: "mailbox", href: "/mailbox", label: "Mailbox", icon: '<svg class="sidebar-link-mailbox-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-7.5a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="m3 8 9 6 9-6"></path></svg>' }; }

    function getCustomersSidebarLink() {
        return {
            key: "customers",
            href: "/premium-klanten",
            label: "Klanten",
            icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>',
        };
    }
    function getDatabaseSidebarLink() {
        return {
            key: "database",
            href: "/premium-database",
            label: "Mailsysteem",
            icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="5.25" rx="6.75" ry="2.25"></ellipse><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25v6c0 1.243 3.022 2.25 6.75 2.25s6.75-1.007 6.75-2.25v-6"></path><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 11.25v6c0 1.243 3.022 2.25 6.75 2.25s6.75-1.007 6.75-2.25v-6"></path></svg>',
        };
    }
    function getPremiumSidebarAdminExtraLinks() {
        return [
            {
                key: "passwords",
                href: "/premium-wachtwoordenregister",
                label: "Wachtwoordenregister",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V7.875a4.5 4.5 0 1 0-9 0V10.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 10.5h10.5A1.5 1.5 0 0 1 18.75 12v7.5A1.5 1.5 0 0 1 17.25 21H6.75A1.5 1.5 0 0 1 5.25 19.5V12a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M12 15.75v1.5"></path></svg>',
            },
        ];
    }

    const PREMIUM_SIDEBAR_COMING_SOON_KEYS = new Set([
        "leads", "coldcalling", "qr_code",
        "ads_linkedin",
        "ads_pinterest",
        "ads_twitter",
        "social_instagram",
        "social_facebook",
        "social_linkedin",
        "social_twitter",
    ]);

    /* Klassiek hangslot: U-beugel + afgeronde kast (herkenbaar op klein formaat) */
    const COMING_SOON_LOCK_SVG =
        '<svg class="sidebar-link-lock-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11V7a5 5 0 0 1 10 0v4"/><rect x="5" y="11" width="14" height="11" rx="2" ry="2"/></svg>';
    function renderSidebarLink(link, activeKey) {
        const isActive = link.key === activeKey;
        const isComingSoon = PREMIUM_SIDEBAR_COMING_SOON_KEYS.has(String(link.key || "").trim());
        const classes = `sidebar-link magnetic${isActive ? " active" : ""}${isComingSoon ? " sidebar-link--coming-soon" : ""}`;
        const labelHtml = `<span class="sidebar-link-text">${link.label}</span>`;
        const iconHtml = isComingSoon
            ? `<span class="sidebar-link-lock" aria-hidden="true">${COMING_SOON_LOCK_SVG}</span>`
            : link.icon;
        const hasCountBadge = link.key === "leads" && !isComingSoon;
        const countBadgeHtml = hasCountBadge
            ? `<span class="sidebar-notification-badge" data-sidebar-count-key="${link.key}" hidden>0</span>`
            : "";
        const comingSoonAttrs = isComingSoon ? ' aria-disabled="true" tabindex="-1"' : "";
        return `<a href="${link.href}" class="${classes}" data-sidebar-key="${link.key}"${comingSoonAttrs}>${iconHtml}${labelHtml}${countBadgeHtml}</a>`;
    }
    function getPremiumSidebarSections(session) {
        const overviewLinks = [
            {
                key: "dashboard",
                href: "/premium-personeel-dashboard",
                label: "Dashboard",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
            },
            {
                key: "active_orders",
                href: "/premium-actieve-opdrachten",
                label: "Actieve Opdrachten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6M9 16h6M9 8h6"></path><path stroke-linecap="round" stroke-linejoin="round" d="M7 20h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>',
            },
            {
                key: "leads",
                href: "/premium-leads",
                label: "Leads",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/></svg>',
            },
            {
                key: "coldcalling",
                href: "/premium-ai-lead-generator",
                label: "Coldcalling",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.5 4.25h2.214c.498 0 .933.334 1.062.815l1.146 4.289a1.125 1.125 0 0 1-.418 1.171l-1.33.997a14.34 14.34 0 0 0 4.304 4.304l.997-1.33a1.125 1.125 0 0 1 1.171-.418l4.289 1.146c.481.129.815.564.815 1.062V18.5a1.75 1.75 0 0 1-1.75 1.75h-1C9.88 20.25 3.75 14.12 3.75 6.5v-.5A1.75 1.75 0 0 1 5.5 4.25Z"></path></svg>',
            },
            getLeadRadarSidebarLink(),
            getDatabaseSidebarLink(),
        ];
        const managementLinks = [
            getCustomersSidebarLink(),
            getMailboxSidebarLink(), getSummarizeSidebarLink(),
            {
                key: "seo",
                href: "/premium-seo",
                label: "SEO",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"></circle><path stroke-linecap="round" stroke-linejoin="round" d="m20 20-3.5-3.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8.5 11.5l1.7 1.7L13.6 9.8"></path></svg>',
            }, { key: "qr_code", href: "/premium-qr-code", label: "QR Code", icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5h5v5h-5v-5Zm10 0h5v5h-5v-5Zm-10 10h5v5h-5v-5Zm10 0h1.5m3.5 0v1.5m-5 3.5h1.5m3.5 0h.01m-3.51-3.5h3.5v3.5"></path></svg>' },
            {
                key: "packages",
                href: "/premium-pakketten",
                label: "Pakketten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 7.5h13.5A1.5 1.5 0 0 1 20.25 9v6a1.5 1.5 0 0 1-1.5 1.5H5.25A1.5 1.5 0 0 1 3.75 15V9a1.5 1.5 0 0 1 1.5-1.5Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 12h2.25m4.5 0h2.25M9.75 9.75v4.5"></path></svg>',
            },
        ];
        const adsPlatformIcon =
            '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"></path></svg>';

        const adsLinks = [
            {
                key: "ads_pinterest",
                href: "/premium-advertenties#pinterest",
                label: "Pinterest",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_facebook",
                href: "/premium-advertenties#facebook",
                label: "Facebook",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_twitter",
                href: "/premium-advertenties#twitter",
                label: "X / Twitter",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_google",
                href: "/premium-advertenties#google",
                label: "Google",
                icon: adsPlatformIcon,
            },
            {
                key: "ads_linkedin",
                href: "/premium-advertenties#linkedin",
                label: "LinkedIn",
                icon: adsPlatformIcon,
            },
        ];

        const socialLinks = [
            {
                key: "social_instagram",
                href: "/premium-socialmedia#instagram",
                label: "Instagram",
                icon: adsPlatformIcon,
            },
            {
                key: "social_linkedin",
                href: "/premium-socialmedia#linkedin",
                label: "LinkedIn",
                icon: adsPlatformIcon,
            },
            {
                key: "social_facebook",
                href: "/premium-socialmedia#facebook",
                label: "Facebook",
                icon: adsPlatformIcon,
            },
            {
                key: "social_twitter",
                href: "/premium-socialmedia#twitter",
                label: "X / Twitter",
                icon: adsPlatformIcon,
            },
        ];

        const extraLinks = getPremiumSidebarAdminExtraLinks().concat([{
                key: "monthly_costs",
                href: "/premium-vaste-lasten",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><rect x="3.75" y="4.5" width="16.5" height="15" rx="1.5"></rect><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 9h9M7.5 13h4.5"></path><circle cx="16.5" cy="13" r="1.25"></circle></svg>',
                label: "Terugkerende kosten",
            },
            {
                key: "notepad",
                href: "/premium-kladblok",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 5.25h16.5v13.5H3.75z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8 13.5h4m-4 2.5h6"></path></svg>',
                label: "Kladblok",
            },
            {
                key: "word",
                href: "/premium-word",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M7.5 3h6L19.5 9v10.5A1.5 1.5 0 0 1 18 21H7.5A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3Z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 3V9H19.5"></path><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 12.75h2.25m1.12 0h2.25m-5.62 3.75h6m-6 3h4.5"></path></svg>',
                label: "Word",
            },
            {
                key: "settings",
                href: "/premium-instellingen",
                icon: '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h9m3 0h4M13 6a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 12h3m3 0h10M7 12a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0ZM4 18h11m3 0h2M15 18a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0Z"></path></svg>',
                label: "Instellingen",
            },
        ]).filter(link => link.key !== "passwords" || Boolean(session && session.authenticated && session.role === "admin"));

        return [
            { label: 'Overzicht', className: 'sidebar-section sidebar-flow-section', links: overviewLinks },
            { label: 'Beheer', className: 'sidebar-section', links: managementLinks },
            { label: "ADVERTENTIE'S", className: 'sidebar-section', links: adsLinks },
            { label: 'Socialmedia', className: 'sidebar-section', links: socialLinks },
            { label: 'Extra', className: 'sidebar-section', links: extraLinks },
        ];
    }
    function renderPremiumSidebarNavigation(session, activeKey) {
        return getPremiumSidebarSections(session).map(section => '<div class="' + section.className + '"><div class="sidebar-section-label">' + section.label + '</div>' + section.links.map(link => renderSidebarLink(link, activeKey)).join('') + '</div>').join('');
    }
  const api = Object.freeze({ getLeadRadarSidebarLink, getSummarizeSidebarLink, getMailboxSidebarLink,
    getCustomersSidebarLink, getDatabaseSidebarLink, getPremiumSidebarAdminExtraLinks,
    getPremiumSidebarSections, renderSidebarLink, renderPremiumSidebarNavigation,
    COMING_SOON_KEYS: Object.freeze(Array.from(PREMIUM_SIDEBAR_COMING_SOON_KEYS)), COMING_SOON_LOCK_SVG });
  if (typeof window !== 'undefined') window.SoftoraPremiumSidebarLinks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}());
