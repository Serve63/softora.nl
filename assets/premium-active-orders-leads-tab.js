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
.order-card.order-card-lead {
    border-color: rgba(46, 204, 113, 0.22);
}
.order-card.order-card-lead::before {
    content: '';
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, rgba(46,204,113,.62), rgba(139,34,82,.38));
}
.order-card.order-card-lead .order-client {
    color: var(--green);
}
`;
        document.head.appendChild(style);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatLeadDate(dateValue, timeValue) {
        const date = String(dateValue || '').trim();
        const time = String(timeValue || '').trim() || '09:00';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
        const parsed = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '09:00'}:00`);
        if (!Number.isFinite(parsed.getTime())) return `${date} ${time}`;
        return parsed.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function isOpenAgendaLead(lead) {
        if (!lead || Number(lead.activeOrderId || 0) > 0) return false;
        return Boolean(String(lead.postCallPrompt || lead.postCallNotesTranscript || lead.summary || '').trim());
    }

    function appendLeadText(parent, tagName, className, value) {
        const element = document.createElement(tagName);
        element.className = className;
        element.textContent = value;
        parent.appendChild(element);
        return element;
    }

    function createLeadCard(lead) {
        const card = document.createElement('div');
        card.className = 'order-card order-card-lead';
        card.id = `lead-${Number(lead.id)}`;
        card.dataset.orderFilterGroup = 'leads';
        card.setAttribute('role', 'article');
        const dateLabel = formatLeadDate(lead.date, lead.time);
        const value = String(lead.value || '').trim();
        const desc = String(lead.postCallPrompt || lead.postCallNotesTranscript || lead.summary || 'Vervolgdossier vanuit agenda.').trim();
        const main = document.createElement('div');
        main.className = 'order-main';

        const info = document.createElement('div');
        info.className = 'order-info';
        appendLeadText(info, 'div', 'order-client', dateLabel || 'Openstaande lead');
        appendLeadText(info, 'div', 'order-title', lead.company || 'Onbekende lead');
        appendLeadText(info, 'div', 'order-desc', desc);
        appendLeadText(info, 'div', 'order-assignee', lead.leadOwnerName || lead.leadOwnerFullName || 'Nog niet geclaimd');

        const price = document.createElement('div');
        price.className = 'order-price';
        appendLeadText(price, 'div', 'order-price-label', 'Leadwaarde');
        appendLeadText(price, 'div', 'order-price-value', value || '-');

        const actions = document.createElement('div');
        actions.className = 'order-actions';
        appendLeadText(actions, 'span', 'status-badge actief', 'Openstaande lead');

        main.append(info, price, actions);
        card.appendChild(main);
        return card;
    }

    function shouldOpenLeadsFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('filter') || params.get('tab') || '').toLowerCase() === 'leads' ||
                String(window.location.hash || '').toLowerCase() === '#leads';
        } catch (_) {
            return false;
        }
    }

    async function renderOpenLeadCards(options = {}) {
        const grid = document.getElementById('ordersGrid');
        if (!grid || typeof window.fetchAgendaLeadOptions !== 'function') return [];
        const leads = await window.fetchAgendaLeadOptions(Boolean(options.force)).catch(() => []);
        const openLeads = Array.isArray(leads) ? leads.filter(isOpenAgendaLead) : [];
        grid.querySelectorAll('.order-card-lead').forEach((card) => card.remove());
        openLeads.forEach((lead) => {
            grid.appendChild(createLeadCard(lead));
        });
        if (typeof window.updateOrderFilterCounts === 'function') {
            window.updateOrderFilterCounts(Array.from(grid.querySelectorAll('.order-card')));
        } else {
            const countEl = document.getElementById(TAB_COUNT_ID);
            if (countEl) countEl.textContent = String(openLeads.length);
        }
        if (typeof window.applyOrderFilter === 'function') window.applyOrderFilter();
        if (shouldOpenLeadsFromUrl() && typeof window.setOrderFilter === 'function') window.setOrderFilter('leads');
        return openLeads;
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
        void renderOpenLeadCards({ force: shouldOpenLeadsFromUrl() });
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
        renderOpenLeads: renderOpenLeadCards,
        refreshLeadFilterCount,
        syncLeadFilterCountFromSidebarBadge
    });
})();
