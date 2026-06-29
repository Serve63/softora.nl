(function () {
    'use strict';

    const SCOPE = 'premium_active_orders';
    const CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
    const ORDER_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
    const ORDER_STATE_KEY = 'softora_order_state_premium_v1';
    const ASSIGNEES = ['Martijn', 'Servé'];
    let activeOrderId = null;
    let editingOrderId = null;
    let cachedOrders = null;
    let modalObserver = null;

    function text(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parseArray(rawValue) {
        try {
            const parsed = JSON.parse(String(rawValue || '[]'));
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    function parseObject(rawValue) {
        try {
            const parsed = JSON.parse(String(rawValue || '{}'));
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    function normalizeAssignee(value) {
        const normalized = text(value)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
        if (normalized === 'martijn') return 'Martijn';
        if (normalized === 'serve' || normalized === 'serve creusen') return 'Servé';
        return '';
    }

    function normalizeStatus(value) {
        const key = text(value).toLowerCase();
        if (key === 'actief') return 'actief';
        if (key === 'bezig') return 'bezig';
        if (key === 'betaald') return 'betaald';
        if (key === 'klaar') return 'klaar';
        return 'wacht';
    }

    function readStateValue(values, key) {
        const source = values && typeof values === 'object' ? values : {};
        return String(window.SoftoraActiveOrdersBoot?.readStateValue?.(source, key) ?? source[key] ?? '');
    }

    function buildPatch(key, value) {
        return window.SoftoraActiveOrdersBoot?.buildStateWritePatch?.(key, value) || { [key]: String(value ?? '') };
    }

    function getBootstrapValues() {
        const payload = window.SoftoraActiveOrdersBoot?.readActiveOrdersBootstrapPayload?.();
        const values = payload?.activeOrdersState?.values;
        return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    }

    async function fetchStateGet() {
        const scope = encodeURIComponent(SCOPE);
        const urls = [`/api/ui-state-get?scope=${scope}`, `/api/ui-state/${scope}`];
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await fetch(url, { method: 'GET', cache: 'no-store' });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data?.ok) throw new Error(String(data?.error || `UI-state lezen mislukt (${response.status})`));
                return data;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('UI-state lezen mislukt.');
    }

    async function fetchStateSet(patch) {
        const scope = encodeURIComponent(SCOPE);
        const urls = [`/api/ui-state-set?scope=${scope}`, `/api/ui-state/${scope}`];
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patch, source: 'premium-active-orders-edit-data', actor: 'browser' }),
                    cache: 'no-store'
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data?.ok) throw new Error(String(data?.error || `UI-state opslaan mislukt (${response.status})`));
                return data;
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('UI-state opslaan mislukt.');
    }

    function readOrdersFromValues(values) {
        return parseArray(readStateValue(values, CUSTOM_ORDERS_KEY));
    }

    async function getOrders(force) {
        if (!force && Array.isArray(cachedOrders)) return cachedOrders.slice();
        if (!force) {
            cachedOrders = readOrdersFromValues(getBootstrapValues());
            if (cachedOrders.length) return cachedOrders.slice();
        }
        const data = await fetchStateGet().catch(() => ({ values: getBootstrapValues() }));
        cachedOrders = readOrdersFromValues(data?.values || {});
        return cachedOrders.slice();
    }

    async function getOrder(id, force) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId) || numericId <= 0) return null;
        const orders = await getOrders(force);
        return orders.find((item) => Number(item?.id) === numericId) || null;
    }

    function ensureStyles() {
        if (document.getElementById('activeOrderEditDataStyles')) return;
        const style = document.createElement('style');
        style.id = 'activeOrderEditDataStyles';
        style.textContent = [
            '.modal-btn.edit-data{background:rgba(255,255,255,0.72);color:var(--accent);border:1px solid rgba(139,34,82,0.28);margin-top:0.5rem}',
            '.modal-btn.edit-data:hover{color:var(--accent);border-color:rgba(139,34,82,0.58);background:rgba(255,255,255,0.9)}'
        ].join('\n');
        document.head.appendChild(style);
    }

    function ensureEditButton() {
        let button = document.getElementById('modalEditDataBtn');
        if (button) return button;

        const deleteBtn = document.getElementById('modalDeleteBtn');
        const secondaryBtn = document.getElementById('modalSecondaryBtn');
        if (!deleteBtn || !secondaryBtn) return null;

        button = document.createElement('button');
        button.className = 'modal-btn edit-data magnetic';
        button.id = 'modalEditDataBtn';
        button.type = 'button';
        button.style.display = 'none';
        button.textContent = 'Gegevens bewerken';
        button.addEventListener('click', () => {
            void openEditDialog();
        });
        deleteBtn.insertAdjacentElement('afterend', button);
        return button;
    }

    function getVisibleDetailsModal() {
        const modal = document.getElementById('modal');
        if (!modal || !modal.classList.contains('show')) return null;
        return modal;
    }

    async function syncEditButtonVisibility(force) {
        const button = ensureEditButton();
        const modal = getVisibleDetailsModal();
        if (!button || !modal || !activeOrderId) {
            if (button) button.style.display = 'none';
            return;
        }

        const record = await getOrder(activeOrderId, force);
        button.style.display = record ? 'block' : 'none';
        button.disabled = false;
    }

    function captureActiveOrderFromEvent(event) {
        const card = event.target?.closest?.('#ordersGrid .order-card');
        if (!card || event.target?.closest?.('button,a')) return;
        const id = Number(String(card.id || '').replace('order-', ''));
        if (Number.isFinite(id) && id > 0) activeOrderId = id;
        window.setTimeout(() => {
            void syncEditButtonVisibility(false);
        }, 0);
    }

    function closeDetailsModal() {
        const modal = document.getElementById('modal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }

    function setFieldValue(id, value) {
        const field = document.getElementById(id);
        if (field) field.value = String(value || '');
    }

    function setCreateDialogCopy(isEditing) {
        const modal = document.getElementById('createOrderModal');
        const title = modal?.querySelector('.modal-title');
        const subtitle = modal?.querySelector('.modal-subtitle');
        const help = modal?.querySelector('.create-order-help');
        const submitBtn = modal?.querySelector('button[type="submit"]');
        if (title) title.textContent = isEditing ? 'Gegevens Bewerken' : 'Actieve Opdracht Aanmaken';
        if (subtitle) {
            subtitle.textContent = isEditing
                ? 'Wijzig de projectgegevens en sla ze direct op.'
                : 'Nieuwe opdracht toevoegen aan de actieve opdrachtenlijst.';
        }
        if (help) {
            help.textContent = isEditing
                ? 'Na opslaan worden de opdrachtkaart en het uitvoerdossier bijgewerkt.'
                : 'Na aanmaken verschijnt de opdracht direct in de lijst hieronder.';
        }
        if (submitBtn) submitBtn.textContent = isEditing ? 'Gegevens Opslaan' : 'Opdracht Aanmaken';
    }

    function setMessage(message, type) {
        const el = document.getElementById('createOrderMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'create-order-message' + (type ? ' ' + type : '');
    }

    function fillForm(record) {
        setFieldValue('newOrderCompany', record.companyName || record.clientName || '');
        setFieldValue('newOrderContact', record.contactName || record.location || '');
        setFieldValue('newOrderTitle', record.title || '');
        setFieldValue('newOrderDesc', record.description || '');
        setFieldValue('newOrderDeliveryTime', record.deliveryTime || '');
        setFieldValue('newOrderAmount', Number(record.amount) > 0 ? String(Math.round(Number(record.amount))) : '');
        window.SoftoraCreateOrderAssignee?.set?.(record.claimedBy || '');
    }

    async function openEditDialog() {
        const id = Number(activeOrderId) || 0;
        const record = await getOrder(id, true);
        const modal = document.getElementById('createOrderModal');
        const form = document.getElementById('createOrderForm');
        if (!id || !record || !modal || !form) {
            await showAlert('Deze opdracht kan hier niet bewerkt worden.');
            return;
        }

        editingOrderId = id;
        form.dataset.editDataOrderId = String(id);
        closeDetailsModal();
        setCreateDialogCopy(true);
        setMessage('', '');
        fillForm(record);
        modal.classList.add('show');
        modal.setAttribute('aria-hidden', 'false');
        window.setTimeout(() => document.getElementById('newOrderCompany')?.focus(), 40);
    }

    function resetEditModeIfClosed() {
        window.setTimeout(() => {
            const modal = document.getElementById('createOrderModal');
            if (modal?.classList.contains('show')) return;
            editingOrderId = null;
            document.getElementById('createOrderForm')?.removeAttribute('data-edit-data-order-id');
            setCreateDialogCopy(false);
        }, 0);
    }

    function buildUpdatedRecord(current, values, runtime) {
        const selectedAssignee = normalizeAssignee(values.assignee || current.claimedBy || runtime.claimedBy || '');
        const existingAssignee = normalizeAssignee(current.claimedBy || runtime.claimedBy || '');
        const previousClaimedAt = text(current.claimedAt || runtime.claimedAt);
        return {
            ...current,
            clientName: values.companyName,
            location: values.contactPerson,
            companyName: values.companyName,
            contactName: values.contactPerson,
            title: values.title,
            description: values.description,
            deliveryTime: values.deliveryTime,
            amount: values.amount,
            claimedBy: selectedAssignee || null,
            claimedAt: selectedAssignee
                ? (selectedAssignee === existingAssignee && previousClaimedAt ? previousClaimedAt : new Date().toISOString())
                : null
        };
    }

    function readEditValues(form) {
        const data = new FormData(form);
        const amount = Math.round(Number(data.get('amount')));
        return {
            companyName: text(data.get('companyName')),
            contactPerson: text(data.get('contactPerson')),
            title: text(data.get('title')),
            description: String(data.get('description') || '').trim(),
            deliveryTime: text(data.get('deliveryTime')),
            amount,
            assignee: normalizeAssignee(data.get('assignee'))
        };
    }

    function validateEditValues(values) {
        if (!values.companyName || !values.contactPerson || !values.title || !values.description || !values.deliveryTime) {
            return 'Vul alle velden in.';
        }
        if (!values.assignee || !ASSIGNEES.includes(values.assignee)) {
            return 'Kies wie deze opdracht krijgt toegewezen.';
        }
        if (!Number.isFinite(values.amount) || values.amount <= 0) {
            return 'Vul een geldig bedrag in.';
        }
        return '';
    }

    async function handleEditSubmit(event) {
        const id = Number(editingOrderId || event.currentTarget?.dataset?.editDataOrderId || 0);
        if (!id) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        const form = event.currentTarget;
        const submitBtn = form.querySelector('button[type="submit"]');
        const values = readEditValues(form);
        const validationMessage = validateEditValues(values);
        if (validationMessage) {
            setMessage(validationMessage, 'error');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Opslaan...';
        }
        setMessage('Gegevens opslaan...', '');

        try {
            const state = await fetchStateGet();
            const stateValues = state?.values || {};
            const orders = readOrdersFromValues(stateValues);
            const idx = orders.findIndex((item) => Number(item?.id) === id);
            if (idx < 0) throw new Error('Deze opdracht bestaat niet meer.');

            const runtime = parseObject(readStateValue(stateValues, ORDER_RUNTIME_KEY));
            const runtimeRecord = runtime[String(id)] || {};
            const updated = buildUpdatedRecord(orders[idx], values, runtimeRecord);
            orders[idx] = updated;
            runtime[String(id)] = {
                ...runtimeRecord,
                name: values.companyName,
                type: values.title,
                logs: Array.isArray(runtimeRecord.logs) ? runtimeRecord.logs : [],
                progressPct: Math.max(0, Math.min(100, Number(runtimeRecord.progressPct) || 0)),
                statusKey: normalizeStatus(runtimeRecord.statusKey || updated.status || 'wacht'),
                paidAt: text(updated.paidAt || runtimeRecord.paidAt) || null,
                claimedBy: updated.claimedBy || null,
                claimedAt: updated.claimedAt || null,
                updatedAt: Date.now()
            };
            const patch = Object.assign(
                {},
                buildPatch(CUSTOM_ORDERS_KEY, JSON.stringify(orders)),
                buildPatch(ORDER_RUNTIME_KEY, JSON.stringify(runtime)),
                buildPatch(ORDER_STATE_KEY, JSON.stringify({ lastOrderId: String(id), updatedAt: new Date().toISOString() }))
            );
            await fetchStateSet(patch);
            cachedOrders = orders;
            setMessage('Gegevens opgeslagen. Pagina wordt bijgewerkt...', 'success');
            window.setTimeout(() => window.location.reload(), 250);
        } catch (error) {
            setMessage(String(error?.message || 'Opslaan mislukt. Probeer het opnieuw.'), 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Gegevens Opslaan';
            }
        }
    }

    async function showAlert(message) {
        if (window.SoftoraDialogs?.alert) {
            await window.SoftoraDialogs.alert(message, { title: 'Gegevens bewerken', confirmText: 'Sluiten' });
            return;
        }
        console.warn(String(message || 'Gegevens bewerken'));
    }

    function bind() {
        ensureStyles();
        ensureEditButton();

        document.getElementById('ordersGrid')?.addEventListener('click', captureActiveOrderFromEvent, true);
        document.getElementById('ordersGrid')?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') captureActiveOrderFromEvent(event);
        }, true);
        document.getElementById('createOrderBtn')?.addEventListener('click', () => {
            editingOrderId = null;
            document.getElementById('createOrderForm')?.removeAttribute('data-edit-data-order-id');
            setCreateDialogCopy(false);
        }, true);
        document.getElementById('createOrderForm')?.addEventListener('submit', handleEditSubmit, true);
        document.getElementById('createOrderCloseBtn')?.addEventListener('click', resetEditModeIfClosed);
        document.getElementById('createOrderCancelBtn')?.addEventListener('click', resetEditModeIfClosed);
        document.getElementById('createOrderModal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) resetEditModeIfClosed();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') resetEditModeIfClosed();
        });

        const modal = document.getElementById('modal');
        if (modal && !modalObserver) {
            modalObserver = new MutationObserver(() => {
                void syncEditButtonVisibility(false);
            });
            modalObserver.observe(modal, { attributes: true, attributeFilter: ['class', 'aria-hidden'] });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind, { once: true });
    } else {
        bind();
    }
})();
