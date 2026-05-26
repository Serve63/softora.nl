(function () {
    const MANUAL_OPEN_LEADS_SCOPE = 'premium_active_orders';
    const MANUAL_OPEN_LEADS_KEY = 'softora_manual_open_leads_premium_v1';
    const OPEN_LEAD_CACHE_MS = 45000;
    let manualOpenLeads = [];
    let manualOpenLeadsLoadedAt = 0;
    let createBusy = false;

    function appendTextElement(parent, tagName, className, text) {
        const el = document.createElement(tagName);
        if (className) el.className = className;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeAssignee(value) {
        const raw = normalizeText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const words = raw.split(/[^a-z]+/).filter(Boolean);
        if (words.includes('serve')) return 'Servé';
        if (words.includes('martijn')) return 'Martijn';
        return '';
    }

    function parseAmount(value) {
        const amount = Number(String(value || '').replace(/[^\d]/g, ''));
        return Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0;
    }

    function formatCurrency(value) {
        const amount = parseAmount(value);
        if (!amount) return '';
        return amount.toLocaleString('nl-NL', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    }

    function resolveProductLine(item) {
        const hay = [
            item?.productLine,
            item?.openLeadType,
            item?.leadType,
            item?.manualLeadType,
            item?.manualLegendChoice,
            item?.legendChoice,
            item?.title,
            item?.summary,
            item?.notes
        ].map((value) => String(value || '').toLowerCase()).join(' ');
        if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot/.test(hay)) return 'chatbot';
        if (/voicesoftware|voice\s*software|voice_software|spraaksoftware|belsoftware|telefon(y|ie)|ai\s*voice/.test(hay)) return 'voice';
        if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b|business/.test(hay)) return 'business';
        if (/website|webdesign|web\s*site|premium\s*web/.test(hay)) return 'website';
        return 'website';
    }

    function getLineLabel(productLine) {
        if (productLine === 'business') return 'Bedrijfssoftware';
        if (productLine === 'voice') return 'Voicesoftware';
        if (productLine === 'chatbot') return 'Chatbot';
        return 'Website';
    }

    function padDatePart(value) {
        return String(value).padStart(2, '0');
    }

    function getLocalDateTimeParts() {
        const now = new Date();
        return {
            date: `${now.getFullYear()}-${padDatePart(now.getMonth() + 1)}-${padDatePart(now.getDate())}`,
            time: `${padDatePart(now.getHours())}:${padDatePart(now.getMinutes())}`
        };
    }

    async function fetchUiStateGet(scope) {
        const encodedScope = encodeURIComponent(String(scope || ''));
        const urls = [`/api/ui-state-get?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) throw new Error(`UI-state ophalen mislukt (${response.status})`);
                return await response.json().catch(() => ({}));
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('UI-state ophalen mislukt.');
    }

    async function fetchUiStateSet(scope, patch) {
        const encodedScope = encodeURIComponent(String(scope || ''));
        const urls = [`/api/ui-state-set?scope=${encodedScope}`, `/api/ui-state/${encodedScope}`];
        let lastError = null;
        for (const url of urls) {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ patch, source: 'premium-actieve-opdrachten', actor: 'browser' })
                });
                if (!response.ok) throw new Error(`UI-state opslaan mislukt (${response.status})`);
                return await response.json().catch(() => ({}));
            } catch (error) {
                lastError = error;
            }
        }
        throw lastError || new Error('UI-state opslaan mislukt.');
    }

    function normalizeManualOpenLeadOption(item) {
        if (!item || typeof item !== 'object') return null;
        const id = Number(item?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
            id,
            company: normalizeText(item?.company || item?.companyName || 'Onbekende lead') || 'Onbekende lead',
            contact: normalizeText(item?.contact || item?.contactPerson || 'Onbekend') || 'Onbekend',
            date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '').trim()) ? String(item.date).trim() : '',
            time: /^\d{2}:\d{2}$/.test(String(item?.time || '').trim()) ? String(item.time).trim() : '09:00',
            summary: normalizeText(item?.summary || item?.notes || item?.postCallNotesTranscript || ''),
            value: normalizeText(item?.value || ''),
            leadOwnerName: normalizeAssignee(item?.leadOwnerName || item?.assignee || ''),
            productLine: resolveProductLine(item),
            phone: normalizeText(item?.phone || item?.contactPhone || ''),
            contactEmail: normalizeText(item?.contactEmail || item?.email || ''),
            activeOrderId: null,
            postCallPrompt: normalizeText(item?.postCallPrompt || ''),
            postCallNotesTranscript: normalizeText(item?.postCallNotesTranscript || item?.notes || ''),
            postCallDomainName: normalizeText(item?.postCallDomainName || item?.domainName || ''),
            isManualOpenLead: true,
            source: 'manual_open_lead',
            createdAt: normalizeText(item?.createdAt || '')
        };
    }

    function parseManualOpenLeads(rawValue) {
        try {
            const parsed = JSON.parse(String(rawValue || '[]'));
            if (!Array.isArray(parsed)) return [];
            return parsed.map(normalizeManualOpenLeadOption).filter(Boolean);
        } catch (_) {
            return [];
        }
    }

    async function listManualOpenLeads(force) {
        const now = Date.now();
        if (!force && manualOpenLeadsLoadedAt && (now - manualOpenLeadsLoadedAt) < OPEN_LEAD_CACHE_MS) return manualOpenLeads;
        try {
            const data = await fetchUiStateGet(MANUAL_OPEN_LEADS_SCOPE);
            manualOpenLeads = parseManualOpenLeads(data?.values?.[MANUAL_OPEN_LEADS_KEY]);
        } catch (_) {
            manualOpenLeads = manualOpenLeads.map(normalizeManualOpenLeadOption).filter(Boolean);
        } finally {
            manualOpenLeadsLoadedAt = Date.now();
        }
        return manualOpenLeads;
    }

    async function saveManualOpenLeads(nextLeads) {
        manualOpenLeads = (Array.isArray(nextLeads) ? nextLeads : []).map(normalizeManualOpenLeadOption).filter(Boolean);
        manualOpenLeadsLoadedAt = Date.now();
        await fetchUiStateSet(MANUAL_OPEN_LEADS_SCOPE, {
            [MANUAL_OPEN_LEADS_KEY]: JSON.stringify(manualOpenLeads)
        });
        return manualOpenLeads;
    }

    async function removeManualOpenLead(leadId) {
        await listManualOpenLeads(false);
        return saveManualOpenLeads(manualOpenLeads.filter((lead) => String(lead?.id) !== String(leadId)));
    }

    function setHiddenCreateOrderValue(name, value) {
        const form = document.getElementById('createOrderForm');
        if (!form) return null;
        let input = form.querySelector(`input[type="hidden"][name="${name}"][data-open-lead-temp="1"]`);
        if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.dataset.openLeadTemp = '1';
            form.appendChild(input);
        }
        input.value = String(value || '');
        return input;
    }

    async function convertManualLeadToOrder(lead, values, assignee) {
        const form = document.getElementById('createOrderForm');
        if (!form || typeof window.handleCreateOrderSubmit !== 'function') {
            throw new Error('Actieve opdracht-formulier is niet beschikbaar.');
        }
        const fieldValues = {
            newOrderCompany: values.company || lead.company || '',
            newOrderContact: values.contact || lead.contact || '',
            newOrderTitle: values.title || `${getLineLabel(lead.productLine)} opdracht voor ${lead.company || 'lead'}`,
            newOrderDesc: values.notes || lead.summary || 'Handmatig aangemaakte openstaande lead.',
            newOrderDeliveryTime: values.delivery || 'Volgens afspraak',
            newOrderAmount: String(parseAmount(values.amount || lead.value) || 2500),
            newOrderAssignee: normalizeAssignee(assignee || lead.leadOwnerName || '')
        };
        Object.entries(fieldValues).forEach(([id, value]) => {
            const field = document.getElementById(id);
            if (field) field.value = String(value || '');
        });
        setHiddenCreateOrderValue('domainName', normalizeText(values.domain || lead.postCallDomainName || ''));
        setHiddenCreateOrderValue('agendaLeadId', '');
        window.handleCreateOrderSubmit({ preventDefault() {}, currentTarget: form });
        if (document.getElementById('createOrderMessage')?.classList.contains('error')) {
            throw new Error(document.getElementById('createOrderMessage')?.textContent || 'Actieve opdracht aanmaken mislukt.');
        }
        await removeManualOpenLead(lead.id);
        return true;
    }

    function setModalVisible(id, visible) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.toggle('show', Boolean(visible));
        modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function setCreateMessage(message, type) {
        const el = document.getElementById('openLeadCreateMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'create-order-message' + (type ? ' ' + type : '');
    }

    function setCreateBusy(isBusy) {
        createBusy = Boolean(isBusy);
        const submitBtn = document.getElementById('openLeadCreateSubmitBtn');
        if (submitBtn) submitBtn.disabled = createBusy;
    }

    function createModalCloseButton(onClick) {
        const button = document.createElement('button');
        button.className = 'modal-close magnetic';
        button.type = 'button';
        button.setAttribute('aria-label', 'Sluiten');
        button.textContent = 'x';
        button.addEventListener('click', onClick);
        return button;
    }

    function createField(parent, id, label, tagName, attrs = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'create-order-field' + (attrs.full ? ' full' : '');
        const labelEl = document.createElement('label');
        labelEl.className = 'create-order-label';
        labelEl.setAttribute('for', id);
        labelEl.textContent = label;
        const field = document.createElement(tagName);
        field.className = tagName === 'textarea' ? 'create-order-textarea' : (tagName === 'select' ? 'create-order-select' : 'create-order-input');
        field.id = id;
        field.name = attrs.name || id;
        if (attrs.type) field.type = attrs.type;
        if (attrs.required) field.required = true;
        if (attrs.placeholder) field.placeholder = attrs.placeholder;
        if (attrs.min) field.min = attrs.min;
        if (attrs.step) field.step = attrs.step;
        if (tagName === 'select') {
            field.dataset.customSelect = 'true';
            const options = Array.isArray(attrs.options) ? attrs.options : [];
            field.replaceChildren(...options.map((option) => {
                const optionEl = document.createElement('option');
                optionEl.value = option.value;
                optionEl.textContent = option.label;
                return optionEl;
            }));
        }
        wrap.append(labelEl, field);
        parent.appendChild(wrap);
        return field;
    }

    function createOpenLeadCreateModal() {
        if (document.getElementById('openLeadCreateModal')) return;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'openLeadCreateModal';
        overlay.dataset.openLeadCreateModal = 'true';
        overlay.setAttribute('aria-hidden', 'true');
        const modal = document.createElement('div');
        modal.className = 'modal create-order-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Openstaande lead aanmaken');
        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendTextElement(headerText, 'div', 'modal-title', 'Openstaande Lead Aanmaken');
        appendTextElement(headerText, 'div', 'modal-subtitle', 'Zet een kans klaar zonder er meteen een actieve opdracht van te maken.');
        header.append(headerText, createModalCloseButton(closeCreateModal));
        const form = document.createElement('form');
        form.className = 'create-order-form';
        form.id = 'openLeadCreateForm';
        const grid = document.createElement('div');
        grid.className = 'create-order-grid';
        createField(grid, 'openLeadCreateCompany', 'Bedrijfsnaam', 'input', { required: true, placeholder: 'Bijv. Salon Nova B.V.' });
        createField(grid, 'openLeadCreateContact', 'Contactpersoon', 'input', { required: true, placeholder: 'Bijv. Sanne de Vries' });
        createField(grid, 'openLeadCreateType', 'Type', 'select', {
            required: true,
            options: [
                { value: 'website', label: 'Website' },
                { value: 'business', label: 'Bedrijfssoftware' },
                { value: 'voice', label: 'Voicesoftware' },
                { value: 'chatbot', label: 'Chatbot' }
            ]
        });
        createField(grid, 'openLeadCreateValue', 'Leadwaarde (€)', 'input', { required: true, type: 'number', min: '1', step: '100', placeholder: '2500' });
        createField(grid, 'openLeadCreateAssignee', 'Toegewezen aan', 'select', {
            options: [
                { value: '', label: 'Nog niet geclaimd' },
                { value: 'Martijn', label: 'Martijn' },
                { value: 'Servé', label: 'Servé' }
            ]
        });
        createField(grid, 'openLeadCreatePhone', 'Telefoon', 'input', { placeholder: 'optioneel' });
        createField(grid, 'openLeadCreateEmail', 'E-mail', 'input', { type: 'email', placeholder: 'optioneel', full: true });
        createField(grid, 'openLeadCreateNotes', 'Notitie', 'textarea', { placeholder: 'Wat moet er nog gebeuren met deze lead?', full: true });
        const meta = document.createElement('div');
        meta.className = 'create-order-meta';
        appendTextElement(meta, 'div', 'create-order-help', 'Na aanmaken verschijnt de lead direct onder Openstaande leads.');
        appendTextElement(meta, 'div', 'create-order-message', '').id = 'openLeadCreateMessage';
        const actions = document.createElement('div');
        actions.className = 'create-order-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'modal-btn secondary magnetic';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Annuleren';
        cancelBtn.addEventListener('click', closeCreateModal);
        const submitBtn = document.createElement('button');
        submitBtn.className = 'modal-btn magnetic';
        submitBtn.id = 'openLeadCreateSubmitBtn';
        submitBtn.type = 'submit';
        submitBtn.style.background = 'var(--accent)';
        submitBtn.style.color = '#fff';
        submitBtn.textContent = 'Lead aanmaken';
        actions.append(cancelBtn, submitBtn);
        form.append(grid, meta, actions);
        form.addEventListener('submit', (event) => { void submitOpenLeadCreate(event); });
        modal.append(header, form);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeCreateModal();
        });
        document.body.appendChild(overlay);
        if (typeof window.initCustomFormSelects === 'function') window.initCustomFormSelects(overlay);
    }

    function openCreateModal() {
        createOpenLeadCreateModal();
        const form = document.getElementById('openLeadCreateForm');
        if (form) form.reset();
        setCreateMessage('', '');
        setModalVisible('openLeadCreateModal', true);
        window.setTimeout(() => document.getElementById('openLeadCreateCompany')?.focus(), 40);
    }

    function closeCreateModal() {
        setModalVisible('openLeadCreateModal', false);
        setCreateMessage('', '');
        setCreateBusy(false);
    }

    async function submitOpenLeadCreate(event) {
        event.preventDefault();
        if (createBusy) return;
        const company = normalizeText(document.getElementById('openLeadCreateCompany')?.value || '');
        const contact = normalizeText(document.getElementById('openLeadCreateContact')?.value || '');
        const productLine = resolveProductLine({ productLine: document.getElementById('openLeadCreateType')?.value || '' });
        const amount = parseAmount(document.getElementById('openLeadCreateValue')?.value || '');
        const assignee = normalizeAssignee(document.getElementById('openLeadCreateAssignee')?.value || '');
        const phone = normalizeText(document.getElementById('openLeadCreatePhone')?.value || '');
        const contactEmail = normalizeText(document.getElementById('openLeadCreateEmail')?.value || '');
        const notes = normalizeText(document.getElementById('openLeadCreateNotes')?.value || '');
        if (!company || !contact || !productLine || !amount) {
            setCreateMessage('Vul bedrijf, contactpersoon, type en leadwaarde in.', 'error');
            return;
        }
        const dateTime = getLocalDateTimeParts();
        const lead = normalizeManualOpenLeadOption({
            id: Date.now(),
            company,
            contact,
            productLine,
            value: formatCurrency(amount),
            leadOwnerName: assignee,
            phone,
            contactEmail,
            summary: notes,
            postCallNotesTranscript: notes,
            date: dateTime.date,
            time: dateTime.time,
            createdAt: new Date().toISOString(),
            isManualOpenLead: true
        });
        if (!lead) {
            setCreateMessage('Lead kon niet worden opgebouwd.', 'error');
            return;
        }
        setCreateBusy(true);
        setCreateMessage('Lead opslaan...', '');
        try {
            await listManualOpenLeads(false);
            await saveManualOpenLeads([lead].concat(manualOpenLeads.filter((item) => String(item?.id) !== String(lead.id))));
            closeCreateModal();
            if (typeof window.setOrderFilter === 'function') window.setOrderFilter('open_leads');
            if (typeof window.SoftoraActiveOrderOpenLeads?.load === 'function') {
                await window.SoftoraActiveOrderOpenLeads.load(true);
            }
        } catch (error) {
            setCreateMessage(String(error?.message || 'Lead opslaan mislukt.'), 'error');
        } finally {
            setCreateBusy(false);
        }
    }

    function bindCreateLauncher() {
        const btn = document.getElementById('createOrderBtn');
        if (!btn || btn.dataset.openLeadCreateBound === '1') return;
        btn.dataset.openLeadCreateBound = '1';
        btn.setAttribute('aria-label', 'Openstaande lead aanmaken');
        btn.replaceChildren(document.createTextNode('Aanmaken'));
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            openCreateModal();
        }, true);
    }

    function bootManualOpenLeads() {
        createOpenLeadCreateModal();
        bindCreateLauncher();
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') closeCreateModal();
        });
    }

    window.SoftoraManualOpenLeads = {
        convertToOrder: convertManualLeadToOrder,
        list: listManualOpenLeads,
        normalize: normalizeManualOpenLeadOption,
        openCreateModal: openCreateModal,
        remove: removeManualOpenLead
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootManualOpenLeads, { once: true });
    } else {
        bootManualOpenLeads();
    }
})();
