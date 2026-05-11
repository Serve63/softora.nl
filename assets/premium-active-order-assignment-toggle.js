(function () {
    const toggleId = 'myAssignmentsOnlyToggle';
    const labelText = 'Enkel mijn toewijzingen bekijken';
    const filter = window.SoftoraActiveOrdersFilter = window.SoftoraActiveOrdersFilter || {};

    filter.onlyMine = false;

    function normalizeAssignee(value) {
        const normalized = String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        const words = normalized.split(/[^a-z]+/).filter(Boolean);
        if (words.includes('serve')) return 'serve';
        if (words.includes('martijn')) return 'martijn';
        return '';
    }

    function getCurrentAssigneeKey() {
        return normalizeAssignee(document.querySelector('[data-sidebar-user-name]')?.textContent || '');
    }

    function getOrderIdFromCard(card) {
        const id = Number(String(card?.id || '').replace('order-', ''));
        return Number.isFinite(id) && id > 0 ? id : null;
    }

    filter.shouldHideCard = function shouldHideCard(card) {
        if (!filter.onlyMine) return false;
        const currentAssignee = getCurrentAssigneeKey();
        const orderId = getOrderIdFromCard(card);
        const getClaimInfo = window.getOrderClaimInfo;
        if (!currentAssignee || !orderId || typeof getClaimInfo !== 'function') return true;
        return normalizeAssignee(getClaimInfo(orderId)?.by || '') !== currentAssignee;
    };

    function createToggle() {
        const topbarRight = document.querySelector('.topbar-right');
        if (!topbarRight || document.getElementById(toggleId)) return;

        const label = document.createElement('label');
        label.className = 'assignment-toggle magnetic';
        label.setAttribute('for', toggleId);

        const input = document.createElement('input');
        input.className = 'assignment-toggle-input';
        input.type = 'checkbox';
        input.id = toggleId;
        input.setAttribute('aria-label', labelText);

        const box = document.createElement('span');
        box.className = 'assignment-toggle-box';
        box.setAttribute('aria-hidden', 'true');

        const text = document.createElement('span');
        text.className = 'assignment-toggle-text';
        text.textContent = labelText;

        label.append(input, box, text);
        topbarRight.insertBefore(label, topbarRight.firstChild);

        input.addEventListener('change', () => {
            filter.onlyMine = input.checked;
            if (typeof window.applyOrderFilter === 'function') window.applyOrderFilter();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createToggle, { once: true });
    } else {
        createToggle();
    }
})();
