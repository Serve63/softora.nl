(function () {
    function normalizeAssignee(value) {
        const normalized = String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        const words = normalized.split(/[^a-z]+/).filter(Boolean);
        if (words.includes('serve')) return 'Servé';
        if (words.includes('martijn')) return 'Martijn';
        return '';
    }

    function setAssignee(value, options) {
        const normalized = normalizeAssignee(value);
        const input = document.getElementById('newOrderAssignee');
        const group = document.getElementById('newOrderAssigneeOptions');

        if (input) {
            input.value = normalized;
            if (options?.agendaAutofill && normalized) {
                input.dataset.agendaAutofill = '1';
            } else {
                delete input.dataset.agendaAutofill;
            }
        }

        document.querySelectorAll('[data-create-order-assignee]').forEach((button) => {
            const active = normalizeAssignee(button.getAttribute('data-create-order-assignee')) === normalized;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        if (group && normalized) group.classList.remove('is-invalid');
        return normalized;
    }

    function bindAssigneeControls() {
        const group = document.getElementById('newOrderAssigneeOptions');
        const form = document.getElementById('createOrderForm');

        document.querySelectorAll('[data-create-order-assignee]').forEach((button) => {
            button.addEventListener('click', () => setAssignee(button.getAttribute('data-create-order-assignee')));
        });

        form?.addEventListener('reset', () => {
            window.setTimeout(() => setAssignee(''), 0);
        });
        form?.addEventListener('submit', () => {
            if (!document.getElementById('newOrderAssignee')?.value) group?.classList.add('is-invalid');
        }, true);
        document.getElementById('createOrderBtn')?.addEventListener('click', () => setAssignee(''));
        setAssignee(document.getElementById('newOrderAssignee')?.value || '');
    }

    window.SoftoraCreateOrderAssignee = { set: setAssignee };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindAssigneeControls, { once: true });
    } else {
        bindAssigneeControls();
    }
})();
