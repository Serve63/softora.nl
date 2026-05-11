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
.orders-filter-btn[data-order-filter="leads"] {
    order: 0;
}

.orders-filter-btn[data-order-filter="leads"] .orders-filter-dot {
    background: var(--green);
    opacity: 0.92;
}
`;
        document.head.appendChild(style);
    }

    function buildLeadFilterTab() {
        const button = document.createElement('button');
        button.className = 'orders-filter-btn magnetic';
        button.type = 'button';
        button.dataset.orderFilter = 'leads';
        button.setAttribute('aria-pressed', 'false');

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

        button.append(label, count);
        return button;
    }

    function ensureLeadFilterTab() {
        const bar = document.querySelector('.orders-filter-bar');
        if (!bar) return null;

        let button = bar.querySelector('[data-order-filter="leads"]');
        if (button) return button;

        ensureLeadTabStyles();
        button = buildLeadFilterTab();
        bar.insertBefore(button, bar.firstChild);
        return button;
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
        const button = ensureLeadFilterTab();
        if (!button) return;
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
