(function () {
    'use strict';

    const STYLE_ID = 'softoraActiveOrdersLeadsTabStyle';
    const TAB_COUNT_ID = 'filterCountLeads';
    let leadFilterCountObserver = null;

    function ensureLeadTabStyles() {
        if (document.getElementById(STYLE_ID)) return;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.orders-filter-btn[data-order-link="leads"] {
    order: 0;
    text-decoration: none;
}

.orders-filter-btn[data-order-link="leads"] .orders-filter-dot {
    background: var(--green);
    opacity: 0.92;
}
`;
        document.head.appendChild(style);
    }

    function buildLeadFilterTab() {
        const link = document.createElement('a');
        link.className = 'orders-filter-btn magnetic';
        link.href = '/premium-leads';
        link.dataset.orderLink = 'leads';

        const label = document.createElement('span');
        label.className = 'orders-filter-label';

        const dot = document.createElement('span');
        dot.className = 'orders-filter-dot';

        const text = document.createTextNode('Openstaande leads');
        label.append(dot, text);

        const count = document.createElement('span');
        count.className = 'orders-filter-count';
        count.id = TAB_COUNT_ID;
        count.textContent = '0';

        link.append(label, count);
        return link;
    }

    function ensureLeadFilterTab() {
        const bar = document.querySelector('.orders-filter-bar');
        if (!bar) return null;

        let link = bar.querySelector('[data-order-link="leads"]');
        if (link) return link;

        ensureLeadTabStyles();
        link = buildLeadFilterTab();
        bar.insertBefore(link, bar.firstChild);
        return link;
    }

    function syncLeadFilterCountFromSidebarBadge() {
        const countEl = document.getElementById(TAB_COUNT_ID);
        if (!countEl) return;

        const badge = document.querySelector('[data-sidebar-count-key="leads"]');
        if (!badge) {
            countEl.textContent = '0';
            return;
        }

        const badgeText = String(badge.textContent || '').trim();
        countEl.textContent = badgeText || (badge.dataset.countZero === '1' ? '0' : '0');
    }

    function initLeadFilterCountMirror() {
        syncLeadFilterCountFromSidebarBadge();

        const badge = document.querySelector('[data-sidebar-count-key="leads"]');
        if (!badge || typeof MutationObserver !== 'function') return;

        if (leadFilterCountObserver) leadFilterCountObserver.disconnect();
        leadFilterCountObserver = new MutationObserver(() => {
            syncLeadFilterCountFromSidebarBadge();
        });
        leadFilterCountObserver.observe(badge, {
            attributes: true,
            attributeFilter: ['hidden', 'data-count-zero', 'title', 'aria-label'],
            childList: true,
            characterData: true,
            subtree: true
        });
    }

    function refreshLeadFilterCount() {
        const refreshFn = window.SoftoraPersonnelTheme?.refreshSidebarLeadsCount;
        if (typeof refreshFn !== 'function') {
            syncLeadFilterCountFromSidebarBadge();
            return;
        }

        Promise.resolve(refreshFn())
            .catch(() => null)
            .finally(() => {
                syncLeadFilterCountFromSidebarBadge();
            });
    }

    function initActiveOrdersLeadTab() {
        const link = ensureLeadFilterTab();
        if (!link) return;
        initLeadFilterCountMirror();
        refreshLeadFilterCount();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initActiveOrdersLeadTab, { once: true });
    } else {
        initActiveOrdersLeadTab();
    }

    window.addEventListener('pageshow', () => {
        syncLeadFilterCountFromSidebarBadge();
    });

    window.SoftoraActiveOrdersLeadTab = Object.freeze({
        init: initActiveOrdersLeadTab,
        refreshLeadFilterCount,
        syncLeadFilterCountFromSidebarBadge
    });
})();
