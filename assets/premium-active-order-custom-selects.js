(function () {
    const SELECTOR = [
        'select.create-order-select',
        '.create-order-select-wrap select',
        '.create-order-form select',
        '.create-order-dialog select',
        '#openLeadCreateModal select',
        '[data-open-lead-create-modal] select'
    ].join(', ');
    const STYLE_ID = 'premiumActiveOrderCustomSelectStyles';
    let observer = null;

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            .create-order-select-wrap:has(.site-select)::after { content: none; }
            .create-order-dialog .site-select { position: relative; z-index: 30; }
            .create-order-dialog .site-select.is-open { z-index: 5200; }
            .create-order-dialog .site-select-trigger { position: relative; }
            .create-order-dialog .site-select.is-open .site-select-trigger { opacity: 1; pointer-events: auto; }
            .create-order-dialog .site-select-menu {
                top: calc(100% + 0.45rem);
                padding: 0.45rem;
                border-color: rgba(139, 34, 82, 0.28);
                background: var(--bg-secondary);
                box-shadow: 0 18px 45px rgba(8, 8, 12, 0.18), 0 0 0 1px rgba(139, 34, 82, 0.08);
                max-height: min(18rem, 44vh);
            }
            .create-order-dialog .site-select-option {
                position: relative;
                padding: 0.78rem 0.9rem 0.78rem 2.05rem;
            }
            .create-order-dialog .site-select-option::before {
                content: '';
                position: absolute;
                left: 0.78rem;
                top: 50%;
                width: 0.48rem;
                height: 0.26rem;
                border-left: 2px solid transparent;
                border-bottom: 2px solid transparent;
                transform: translateY(-65%) rotate(-45deg);
                transition: border-color 0.18s ease;
            }
            .create-order-dialog .site-select-option:hover,
            .create-order-dialog .site-select-option:focus-visible { background: rgba(139, 34, 82, 0.08); }
            .create-order-dialog .site-select-option.is-selected {
                color: var(--text-primary);
                background: rgba(139, 34, 82, 0.14);
            }
            .create-order-dialog .site-select-option.is-selected::before { border-color: var(--accent-light); }
        `;
        document.head.appendChild(style);
    }

    function collectSelects(root, result) {
        if (!root || !result) return;
        if (root instanceof HTMLSelectElement && root.matches(SELECTOR)) {
            result.add(root);
            return;
        }
        if (typeof root.querySelectorAll === 'function') {
            root.querySelectorAll(SELECTOR).forEach((select) => result.add(select));
        }
    }

    function hydrate(root = document) {
        const selects = new Set();
        collectSelects(root, selects);
        if (!selects.size) return;

        selects.forEach((select) => {
            if (select.multiple || Number(select.size) > 1) return;
            select.dataset.customSelect = 'true';
            select.classList.add('magnetic');
        });

        if (typeof window.initCustomFormSelects === 'function') {
            window.initCustomFormSelects(root);
        }
    }

    function observe() {
        if (observer || typeof MutationObserver !== 'function') return;
        observer = new MutationObserver((mutations) => {
            const selects = new Set();
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => collectSelects(node, selects));
            });
            selects.forEach((select) => hydrate(select));
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function boot() {
        ensureStyles();
        hydrate();
        observe();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }
})();
