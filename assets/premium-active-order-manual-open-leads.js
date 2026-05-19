(function () {
    const SCOPE = 'premium_active_orders';
    const MANUAL_KEY = 'softora_manual_open_leads_v1';
    const CUSTOM_ORDERS_KEY = 'softora_custom_orders_premium_v1';
    const ORDER_RUNTIME_KEY = 'softora_order_runtime_premium_v1';
    const ORDER_STATE_KEY = 'softora_order_state_premium_v1';
    const PRODUCT_LINES = ['website', 'business', 'voice', 'chatbot'];
    let cachedManualLeads = null;
    let allowNativeCreateOrderClick = false;

    function text(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function appendText(parent, tag, className, value) {
        const el = document.createElement(tag);
        if (className) el.className = className;
        el.textContent = value;
        parent.appendChild(el);
        return el;
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

    function readStateValue(values, key) {
        const source = values && typeof values === 'object' ? values : {};
        return String(window.SoftoraActiveOrdersBoot?.readStateValue?.(source, key) ?? source[key] ?? '');
    }

    function buildPatch(key, value) {
        return window.SoftoraActiveOrdersBoot?.buildStateWritePatch?.(key, value) || { [key]: String(value ?? '') };
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
                    body: JSON.stringify({ patch, source: 'premium-active-order-manual-open-leads', actor: 'browser' }),
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

    function createManualId() {
        return `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeRecord(item) {
        if (!item || typeof item !== 'object') return null;
        const id = text(item.id) || createManualId();
        const company = text(item.company || item.companyName);
        const contact = text(item.contact || item.contactName);
        const productLine = PRODUCT_LINES.includes(text(item.productLine)) ? text(item.productLine) : 'website';
        const summary = String(item.summary || item.notes || '').trim();
        if (!company || !contact || !summary) return null;
        const amount = Math.max(0, Math.round(Number(item.amount || 0) || 0));
        return {
            id,
            company,
            contact,
            productLine,
            amount,
            leadOwnerName: text(item.leadOwnerName),
            phone: text(item.phone),
            contactEmail: text(item.contactEmail || item.email),
            summary,
            createdAt: text(item.createdAt) || new Date().toISOString()
        };
    }

    function toOpenLeadOption(record) {
        return {
            id: record.id,
            isManualOpenLead: true,
            company: record.company,
            contact: record.contact,
            date: '',
            time: '',
            summary: record.summary,
            value: record.amount > 0 ? `€${record.amount.toLocaleString('nl-NL')}` : '',
            leadOwnerName: record.leadOwnerName,
            productLine: record.productLine,
            phone: record.phone,
            contactEmail: record.contactEmail,
            activeOrderId: null,
            postCallPrompt: '',
            postCallNotesTranscript: record.summary,
            postCallDomainName: ''
        };
    }

    async function loadRecords(force) {
        if (!force && Array.isArray(cachedManualLeads)) return cachedManualLeads.slice();
        const data = await fetchStateGet().catch(() => ({ values: {} }));
        const values = data && typeof data === 'object' && data.values && typeof data.values === 'object' ? data.values : {};
        cachedManualLeads = parseArray(readStateValue(values, MANUAL_KEY)).map(normalizeRecord).filter(Boolean);
        return cachedManualLeads.slice();
    }

    async function saveRecords(records) {
        cachedManualLeads = records.map(normalizeRecord).filter(Boolean);
        await fetchStateSet(buildPatch(MANUAL_KEY, JSON.stringify(cachedManualLeads)));
        return cachedManualLeads.slice();
    }

    async function getOptions() {
        const records = await loadRecords(false);
        return records.map(toOpenLeadOption);
    }

    async function removeManualLead(id) {
        const key = text(id);
        const records = (await loadRecords(true)).filter((item) => item.id !== key);
        await saveRecords(records);
    }

    function normalizeAssignee(value) {
        const normalized = text(value).toLowerCase();
        if (normalized === 'martijn') return 'Martijn';
        if (normalized === 'servé' || normalized === 'serve') return 'Servé';
        return '';
    }

    function nextOrderId(customOrders) {
        const ids = [
            1, 2, 3, 4, 5,
            ...customOrders.map((item) => Number(item?.id)),
            ...Array.from(document.querySelectorAll('#ordersGrid .order-card')).map((card) => Number(String(card.id || '').replace('order-', '')))
        ].filter((id) => Number.isFinite(id) && id > 0);
        return (ids.length ? Math.max(...ids) : 0) + 1;
    }

    async function convertToOrder(lead, payload) {
        const companyName = text(payload?.companyName || payload?.company || lead?.company);
        const contactName = text(payload?.contactName || payload?.contact || lead?.contact);
        const title = text(payload?.title);
        const description = String(payload?.description || payload?.summary || '').trim();
        const deliveryTime = text(payload?.deliveryTime || payload?.delivery || 'Volgens afspraak');
        const amount = Math.round(Number(payload?.amount || 0));
        if (!companyName || !contactName || !title || !description || !deliveryTime || !Number.isFinite(amount) || amount <= 0) {
            throw new Error('Vul bedrijf, contact, titel, oplevertijd, notities en bedrag in.');
        }

        const data = await fetchStateGet().catch(() => ({ values: {} }));
        const values = data && typeof data === 'object' && data.values && typeof data.values === 'object' ? data.values : {};
        const customOrders = parseArray(readStateValue(values, CUSTOM_ORDERS_KEY));
        const runtime = parseObject(readStateValue(values, ORDER_RUNTIME_KEY));
        const id = nextOrderId(customOrders);
        const claimedBy = normalizeAssignee(payload?.leadOwnerName || lead?.leadOwnerName);
        const claimedAt = claimedBy ? new Date().toISOString() : null;
        const record = {
            id,
            clientName: companyName,
            location: contactName,
            companyName,
            contactName,
            contactPhone: text(payload?.contactPhone || lead?.phone),
            contactEmail: text(payload?.contactEmail || lead?.contactEmail),
            title,
            description,
            deliveryTime,
            domainName: text(payload?.domainName || payload?.domain),
            amount,
            status: 'wacht',
            prompt: String(payload?.prompt || '').trim(),
            transcript: String(payload?.transcript || description).trim(),
            includeSampleDesign: false,
            paidAt: null,
            claimedBy: claimedBy || null,
            claimedAt,
            referenceImages: [],
            sourceAppointmentId: null,
            sourceCallId: null,
            sourceAppointmentLabel: `Handmatige openstaande lead · ${text(lead?.id)}`
        };
        customOrders.push(record);
        runtime[String(id)] = {
            name: companyName,
            type: title,
            logs: [],
            progressPct: 0,
            statusKey: 'wacht',
            paidAt: null,
            claimedBy: claimedBy || null,
            claimedAt,
            updatedAt: null
        };
        await fetchStateSet(Object.assign(
            {},
            buildPatch(CUSTOM_ORDERS_KEY, JSON.stringify(customOrders)),
            buildPatch(ORDER_RUNTIME_KEY, JSON.stringify(runtime)),
            buildPatch(ORDER_STATE_KEY, JSON.stringify({ lastOrderId: String(id), updatedAt: new Date().toISOString() }))
        ));
        await removeManualLead(lead?.id);
        return record;
    }

    function ensureStyles() {
        if (document.getElementById('manualOpenLeadStyles')) return;
        const style = document.createElement('style');
        style.id = 'manualOpenLeadStyles';
        style.textContent = `
            .modal.create-choice-dialog { max-width: 640px; padding: 2rem; }
            .create-choice-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-top: 1.1rem; }
            .create-choice-card { align-items: flex-start; background: rgba(255,255,255,0.72); border: 1px solid rgba(139,34,82,0.24); color: var(--text-primary); display: flex; flex-direction: column; gap: 0.45rem; min-height: 150px; padding: 1.15rem; text-align: left; transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s; }
            .create-choice-card:hover { border-color: rgba(139,34,82,0.62); box-shadow: 0 14px 34px rgba(139,34,82,0.1); transform: translateY(-1px); }
            .create-choice-kicker { color: var(--accent); font-family: Oswald, sans-serif; font-size: 0.66rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; }
            .create-choice-title { color: var(--text-primary); font-family: Oswald, sans-serif; font-size: 1.08rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
            .create-choice-copy { color: var(--text-secondary); font-size: 0.82rem; line-height: 1.45; }
            @media (max-width: 768px) { .create-choice-grid { grid-template-columns: 1fr; } .modal.create-choice-dialog { width: 100%; padding: 1.25rem; } }
        `;
        document.head.appendChild(style);
    }

    function createCloseButton(onClick) {
        const button = document.createElement('button');
        button.className = 'modal-close magnetic';
        button.type = 'button';
        button.setAttribute('aria-label', 'Sluiten');
        button.textContent = 'x';
        button.addEventListener('click', onClick);
        return button;
    }

    function choiceCard(id, kicker, title, copy, onClick) {
        const button = document.createElement('button');
        button.className = 'create-choice-card magnetic';
        button.id = id;
        button.type = 'button';
        appendText(button, 'span', 'create-choice-kicker', kicker);
        appendText(button, 'span', 'create-choice-title', title);
        appendText(button, 'span', 'create-choice-copy', copy);
        button.addEventListener('click', onClick);
        return button;
    }

    function closeChoiceModal() {
        const modal = document.getElementById('createChoiceModal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
    }

    function openNativeCreateOrder() {
        closeChoiceModal();
        const button = document.getElementById('createOrderBtn');
        if (!button) return;
        allowNativeCreateOrderClick = true;
        button.click();
    }

    function createChoiceModal() {
        if (document.getElementById('createChoiceModal')) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'createChoiceModal';
        overlay.setAttribute('aria-hidden', 'true');
        const modal = document.createElement('div');
        modal.className = 'modal create-choice-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Nieuw aanmaken');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendText(headerText, 'div', 'modal-title', 'Nieuw Aanmaken');
        appendText(headerText, 'div', 'modal-subtitle', 'Kies eerst wat je wilt toevoegen.');
        header.append(headerText, createCloseButton(closeChoiceModal));
        const grid = document.createElement('div');
        grid.className = 'create-choice-grid';
        grid.append(
            choiceCard('createOpenLeadChoiceBtn', 'Lead', 'Openstaande lead', 'Voor kansen die je nog moet opvolgen of later naar opdracht wilt verplaatsen.', () => {
                closeChoiceModal();
                openCreateModal();
            }),
            choiceCard('createActiveOrderChoiceBtn', 'Opdracht', 'Actieve opdracht', 'Voor werk dat direct als klantopdracht in uitvoering mag staan.', openNativeCreateOrder)
        );
        modal.append(header, grid);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeChoiceModal();
        });
        document.body.appendChild(overlay);
    }

    function addOption(select, value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }

    function createField(parent, id, label, tag, attrs = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'create-order-field' + (attrs.full ? ' full' : '');
        const labelEl = document.createElement('label');
        labelEl.className = 'create-order-label';
        labelEl.setAttribute('for', id);
        labelEl.textContent = label;
        const field = document.createElement(tag);
        field.className = tag === 'textarea' ? 'create-order-textarea' : 'create-order-input';
        if (tag === 'select') field.className += ' create-order-select';
        field.id = id;
        field.name = attrs.name || id;
        if (attrs.type) field.type = attrs.type;
        if (attrs.placeholder) field.placeholder = attrs.placeholder;
        if (attrs.required) field.required = true;
        if (attrs.min) field.min = attrs.min;
        if (attrs.step) field.step = attrs.step;
        wrap.append(labelEl, field);
        parent.appendChild(wrap);
        return field;
    }

    function setCreateMessage(message, type) {
        const el = document.getElementById('createOpenLeadMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'create-order-message' + (type ? ' ' + type : '');
    }

    async function handleCreateSubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const lead = normalizeRecord({
            id: createManualId(),
            company: data.get('company'),
            contact: data.get('contact'),
            productLine: data.get('productLine'),
            amount: Number(String(data.get('amount') || '').replace(/[^\d]/g, '')),
            leadOwnerName: data.get('leadOwnerName'),
            phone: data.get('phone'),
            contactEmail: data.get('contactEmail'),
            summary: data.get('summary'),
            createdAt: new Date().toISOString()
        });
        if (!lead) {
            setCreateMessage('Vul bedrijfsnaam, contactpersoon en notitie in.', 'error');
            return;
        }
        setCreateMessage('Lead opslaan...', '');
        try {
            const records = await loadRecords(true);
            await saveRecords([lead].concat(records.filter((item) => item.id !== lead.id)));
            closeCreateModal();
            form.reset();
            await window.SoftoraActiveOrderOpenLeads?.load?.(true);
            if (typeof window.setOrderFilter === 'function') window.setOrderFilter('open_leads');
        } catch (error) {
            setCreateMessage(String(error?.message || 'Openstaande lead opslaan mislukt.'), 'error');
        }
    }

    function closeCreateModal() {
        const modal = document.getElementById('createOpenLeadModal');
        if (!modal) return;
        modal.classList.remove('show');
        modal.setAttribute('aria-hidden', 'true');
        setCreateMessage('', '');
    }

    function createOpenLeadModal() {
        if (document.getElementById('createOpenLeadModal')) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'createOpenLeadModal';
        overlay.setAttribute('aria-hidden', 'true');
        const modal = document.createElement('div');
        modal.className = 'modal create-order-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Openstaande lead aanmaken');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendText(headerText, 'div', 'modal-title', 'Openstaande Lead Aanmaken');
        appendText(headerText, 'div', 'modal-subtitle', 'Zet een kans klaar zonder er meteen een actieve opdracht van te maken.');
        header.append(headerText, createCloseButton(closeCreateModal));
        const form = document.createElement('form');
        form.className = 'create-order-form';
        form.id = 'createOpenLeadForm';
        const grid = document.createElement('div');
        grid.className = 'create-order-grid';
        createField(grid, 'newOpenLeadCompany', 'Bedrijfsnaam', 'input', { name: 'company', placeholder: 'Bijv. Salon Nova B.V.', required: true });
        createField(grid, 'newOpenLeadContact', 'Contactpersoon', 'input', { name: 'contact', placeholder: 'Bijv. Sanne de Vries', required: true });
        const typeSelect = createField(grid, 'newOpenLeadType', 'Type', 'select', { name: 'productLine', required: true });
        addOption(typeSelect, 'website', 'Website');
        addOption(typeSelect, 'business', 'Bedrijfssoftware');
        addOption(typeSelect, 'voice', 'Voicesoftware');
        addOption(typeSelect, 'chatbot', 'Chatbot');
        createField(grid, 'newOpenLeadAmount', 'Leadwaarde (€)', 'input', { name: 'amount', type: 'number', min: '0', step: '100', placeholder: '2500' });
        const ownerSelect = createField(grid, 'newOpenLeadOwner', 'Toegewezen aan', 'select', { name: 'leadOwnerName' });
        addOption(ownerSelect, '', 'Nog niet geclaimd');
        addOption(ownerSelect, 'Martijn', 'Martijn');
        addOption(ownerSelect, 'Servé', 'Servé');
        createField(grid, 'newOpenLeadPhone', 'Telefoon', 'input', { name: 'phone', placeholder: 'optioneel' });
        createField(grid, 'newOpenLeadEmail', 'E-mail', 'input', { name: 'contactEmail', type: 'email', placeholder: 'optioneel', full: true });
        createField(grid, 'newOpenLeadNotes', 'Notitie', 'textarea', { name: 'summary', placeholder: 'Wat moet er nog gebeuren met deze lead?', required: true, full: true });
        const meta = document.createElement('div');
        meta.className = 'create-order-meta';
        appendText(meta, 'div', 'create-order-help', 'Na aanmaken verschijnt de lead direct onder Openstaande leads.');
        appendText(meta, 'div', 'create-order-message', '').id = 'createOpenLeadMessage';
        const actions = document.createElement('div');
        actions.className = 'create-order-actions';
        const cancel = document.createElement('button');
        cancel.className = 'modal-btn secondary magnetic';
        cancel.type = 'button';
        cancel.id = 'createOpenLeadCancelBtn';
        cancel.textContent = 'Annuleren';
        cancel.addEventListener('click', closeCreateModal);
        const submit = document.createElement('button');
        submit.className = 'modal-btn magnetic';
        submit.type = 'submit';
        submit.textContent = 'Lead Aanmaken';
        submit.style.background = 'var(--accent)';
        submit.style.color = '#fff';
        actions.append(cancel, submit);
        form.append(grid, meta, actions);
        form.addEventListener('submit', handleCreateSubmit);
        modal.append(header, form);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeCreateModal();
        });
        document.body.appendChild(overlay);
    }

    function openCreateModal() {
        ensureUi();
        const modal = document.getElementById('createOpenLeadModal');
        const form = document.getElementById('createOpenLeadForm');
        if (form) form.reset();
        setCreateMessage('', '');
        modal?.classList.add('show');
        modal?.setAttribute('aria-hidden', 'false');
        window.setTimeout(() => document.getElementById('newOpenLeadCompany')?.focus(), 40);
    }

    function openChoiceModal() {
        ensureUi();
        const modal = document.getElementById('createChoiceModal');
        modal?.classList.add('show');
        modal?.setAttribute('aria-hidden', 'false');
        window.setTimeout(() => document.getElementById('createOpenLeadChoiceBtn')?.focus(), 40);
    }

    function setEntryButtonLabel(button) {
        button.replaceChildren(document.createTextNode('Aanmaken'));
    }

    function bindEntryButton() {
        const button = document.getElementById('createOrderBtn');
        if (!button || button.dataset.manualOpenLeadBound === '1') return;
        button.dataset.manualOpenLeadBound = '1';
        setEntryButtonLabel(button);
        button.addEventListener('click', (event) => {
            if (allowNativeCreateOrderClick) {
                allowNativeCreateOrderClick = false;
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            openChoiceModal();
        }, true);
    }

    function ensureUi() {
        ensureStyles();
        createChoiceModal();
        createOpenLeadModal();
    }

    window.SoftoraManualOpenLeads = {
        getOptions,
        remove: removeManualLead,
        convertToOrder,
        openCreateModal,
        closeCreateModal
    };

    ensureUi();
    bindEntryButton();
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        closeChoiceModal();
        closeCreateModal();
    });
})();
