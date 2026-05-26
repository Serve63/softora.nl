(function () {
    const OPEN_LEAD_CACHE_MS = 45000;
    let openLeadOptions = [];
    let openLeadOptionsLoadedAt = 0;
    let openLeadOptionsPromise = null;
    let selectedOpenLead = null;
    let openLeadConversionBusy = false;

    function appendTextElement(parent, tagName, className, text) {
        const el = document.createElement(tagName);
        if (className) el.className = className;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    function normalizeOpenLeadText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeOpenLeadAssignee(value) {
        const raw = normalizeOpenLeadText(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        if (!raw) return '';
        const words = raw.split(/[^a-z]+/).filter(Boolean);
        if (words.includes('serve')) return 'Servé';
        if (words.includes('martijn')) return 'Martijn';
        return '';
    }

    function joinLeadNotes() {
        return Array.from(arguments)
            .map((value) => String(value || '').trim())
            .filter(Boolean)
            .join('\n\n');
    }

    function setOpenLeadActionMessage(message, type) {
        const el = document.getElementById('openLeadActionMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'open-lead-action-message' + (type ? ' ' + type : '');
    }

    function setOpenLeadConversionMessage(message, type) {
        const el = document.getElementById('openLeadConvertMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'open-lead-action-message' + (type ? ' ' + type : '');
    }

    async function postOpenLeadJsonWithFallback(urls, body, options = {}) {
        const endpointList = Array.isArray(urls) ? urls : [urls];
        const timeoutMs = Math.max(3000, Number(options.timeoutMs) || 30000);
        let lastError = null;
        for (const url of endpointList) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body || {}),
                    signal: controller.signal,
                    cache: 'no-store'
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || !data?.ok) {
                    const error = new Error(String(data?.detail || data?.error || `Actie mislukt (${response.status})`));
                    error.status = Number(response.status) || 0;
                    throw error;
                }
                return data;
            } catch (error) {
                lastError = error;
                if (Number(error?.status) >= 400 && Number(error?.status) < 500 && Number(error?.status) !== 404) break;
            } finally {
                window.clearTimeout(timer);
            }
        }
        throw lastError || new Error('Actie mislukt.');
    }

    function formatAgendaLeadDateTimeLabel(dateValue, timeValue) {
        const date = String(dateValue || '').trim();
        const time = String(timeValue || '').trim() || '09:00';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
        const parsed = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : '09:00'}:00`);
        if (Number.isNaN(parsed.getTime())) return `${date} ${time}`;
        return parsed.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function compareAgendaLeadOptions(a, b) {
        const aTs = Date.parse(`${String(a?.date || '1970-01-01')}T${String(a?.time || '00:00')}:00`) || 0;
        const bTs = Date.parse(`${String(b?.date || '1970-01-01')}T${String(b?.time || '00:00')}:00`) || 0;
        if (aTs === bTs) return Number(b?.id || 0) - Number(a?.id || 0);
        return bTs - aTs;
    }

    function mergeOpenLeadOptions(manualLeads, fetchedLeads) {
        const merged = new Map();
        (Array.isArray(manualLeads) ? manualLeads : []).forEach((lead) => {
            if (lead) merged.set(String(lead.id), lead);
        });
        (Array.isArray(fetchedLeads) ? fetchedLeads : []).forEach((lead) => {
            if (lead) merged.set(String(lead.id), lead);
        });
        return Array.from(merged.values()).sort(compareAgendaLeadOptions);
    }

    function normalizeLeadFollowUpStatus(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function resolveOpenLeadProductLine(item) {
        const hay = [
            item?.leadType,
            item?.productLine,
            item?.openLeadType,
            item?.manualLeadType,
            item?.manualOpenLeadType,
            item?.manualLeadProductLine,
            item?.serviceType,
            item?.service,
            item?.category,
            item?.line,
            item?.product,
            item?.typeLabel,
            item?.title,
            item?.company,
            item?.summary,
            item?.description,
            item?.notes,
            item?.conversationSummary,
            item?.postCallPrompt,
            item?.postCallNotesTranscript,
            item?.coldcallingStack,
            item?.coldcallingStackLabel,
            item?.manualLegendChoice,
            item?.legendChoice,
            item?.providerLabel,
            item?.source
        ].map((value) => String(value || '').toLowerCase()).join(' ');
        const isManualPrivate = /\bmanual-(?:overig|serve|martijn|both)\b|legenda:\s*manual-/.test(hay);
        if (/chatbot|chatbots|whatsapp\s*bot|widget\s*bot|conversational\s*bot/.test(hay)) return 'chatbot';
        if (/voicesoftware|voice\s*software|voice_software|spraaksoftware|belsoftware|telefon(y|ie)|voice\s*agent|ai\s*voice/.test(hay)) return 'voice';
        if (/bedrijfssoftware|business\s*software|business_software|\bcrm\b|\berp\b|legenda:\s*business/.test(hay)) return 'business';
        if (/website|webdesign|web\s*site|premium\s*web|legenda:\s*website/.test(hay)) return 'website';
        return isManualPrivate ? '' : 'website';
    }

    function isOpenLeadFollowUpTask(item) {
        const status = [item?.type, item?.taskType, item?.confirmationTaskType, item?.postCallStatus].map(normalizeLeadFollowUpStatus).join(' ');
        const openLeadSignal = [
            status.includes('lead_follow_up'),
            status.includes('open_lead'),
            status.includes('openstaande_lead'),
            status.includes('manual_open_lead'),
            status.includes('manual_lead'),
            String(item?.isOpenLead || '').trim() === 'true',
            String(item?.isManualOpenLead || '').trim() === 'true',
            String(item?.orderFilterGroup || '').trim() === 'open_leads'
        ].some(Boolean);
        if (!openLeadSignal) return false;
        if (/(uit_systeem|cancel|cancelled|completed|voltooid|afgerond|actieve_opdracht|active_order|betaald|paid)/.test(status)) return false;
        if (Number(item?.activeOrderId || 0) > 0) return false;
        return Boolean(resolveOpenLeadProductLine(item) || item?.isOpenLead || item?.isManualOpenLead);
    }

    function normalizeOpenLeadOption(item) {
        if (!item || typeof item !== 'object' || !isOpenLeadFollowUpTask(item)) return null;
        const id = Number(item?.appointmentId || item?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const productLine = resolveOpenLeadProductLine(item) || 'website';
        const date = String(item?.date || '').trim();
        const time = String(item?.time || '').trim();
        return {
            id,
            company: String(item?.company || 'Onbekende lead').trim() || 'Onbekende lead',
            contact: String(item?.contact || 'Onbekend').trim() || 'Onbekend',
            date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '',
            time: /^\d{2}:\d{2}$/.test(time) ? time : '09:00',
            summary: String(item?.summary || item?.conversationSummary || '').trim(),
            value: String(item?.value || '').trim(),
            leadOwnerName: String(item?.leadOwnerName || item?.leadOwnerFullName || '').trim(),
            productLine,
            phone: String(item?.phone || item?.contactPhone || '').trim(),
            contactEmail: String(item?.contactEmail || item?.email || '').trim(),
            activeOrderId: Number(item?.activeOrderId || 0) || null,
            postCallPrompt: String(item?.postCallPrompt || '').trim(),
            postCallNotesTranscript: String(item?.postCallNotesTranscript || '').trim(),
            postCallDomainName: String(item?.postCallDomainName || item?.domainName || '').trim()
        };
    }

    function getOpenLeadLineColor(productLine) {
        if (productLine === 'business') return '#3498db';
        if (productLine === 'voice') return '#f39c12';
        if (productLine === 'chatbot') return '#8B2252';
        return '#A62D65';
    }

    function getOpenLeadLineLabel(productLine) {
        if (productLine === 'business') return 'Bedrijfssoftware';
        if (productLine === 'voice') return 'Voicesoftware';
        if (productLine === 'chatbot') return 'Chatbot';
        return 'Website';
    }

    async function fetchOpenLeadOptions(force) {
        const now = Date.now();
        if (!force && openLeadOptions.length && (now - openLeadOptionsLoadedAt) < OPEN_LEAD_CACHE_MS) return openLeadOptions;
        if (openLeadOptionsPromise) return openLeadOptionsPromise;
        openLeadOptionsPromise = (async () => {
            const persistedManualLeads = typeof window.SoftoraManualOpenLeads?.list === 'function'
                ? await window.SoftoraManualOpenLeads.list(force)
                : [];
            try {
                const response = await fetch('/api/agenda/confirmation-tasks?limit=250&quick=1&fresh=1', { cache: 'no-store' });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result?.ok || !Array.isArray(result?.tasks)) throw new Error('Openstaande leads niet beschikbaar.');
                openLeadOptions = mergeOpenLeadOptions(
                    persistedManualLeads,
                    result.tasks.map(normalizeOpenLeadOption).filter(Boolean)
                );
            } catch (_) {
                openLeadOptions = mergeOpenLeadOptions(persistedManualLeads, []);
            } finally {
                openLeadOptionsLoadedAt = Date.now();
            }
            return openLeadOptions;
        })().finally(() => {
            openLeadOptionsPromise = null;
        });
        return openLeadOptionsPromise;
    }

    function ensureOpenLeadActionStyles() {
        if (document.getElementById('openLeadActionStyles')) return;
        const style = document.createElement('style');
        style.id = 'openLeadActionStyles';
        style.textContent = `
            .open-lead-action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.85rem; align-items: stretch; margin-top: 1rem; }
            .open-lead-action-grid .modal-btn {
                width: 100%;
                min-width: 0;
                min-height: 8.75rem;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1.2rem 0.95rem;
                line-height: 1.25;
                text-align: center;
                white-space: normal;
            }
            .open-lead-action-message { min-height: 1.35rem; color: #8f8fa0; font-weight: 700; margin-top: 0.8rem; }
            .open-lead-action-message.error { color: #d24a3a; }
            .open-lead-action-message.success { color: var(--accent); }
            .open-lead-dossier-dialog { max-width: min(920px, calc(100vw - 2rem)); }
            .open-lead-dossier-body { display: grid; gap: 0.95rem; margin-top: 1rem; }
            .open-lead-dossier-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.85rem; }
            .open-lead-dossier-item {
                border: 1px solid rgba(30,30,47,0.12);
                background: rgba(139,34,82,0.035);
                padding: 0.88rem 0.95rem;
            }
            .open-lead-dossier-item.full { grid-column: 1 / -1; }
            .open-lead-dossier-label {
                color: #9a9aaa;
                font-family: Oswald, sans-serif;
                font-size: 0.74rem;
                font-weight: 800;
                letter-spacing: 0.12em;
                text-transform: uppercase;
            }
            .open-lead-dossier-value { color: var(--text-dark); font-weight: 700; line-height: 1.55; margin-top: 0.32rem; overflow-wrap: anywhere; }
            .open-lead-dossier-value.multiline { font-weight: 500; white-space: pre-wrap; }
            .open-lead-dossier-actions { display: flex; justify-content: flex-end; gap: 0.7rem; margin-top: 0.2rem; }
            .open-lead-dossier-actions .modal-btn { width: auto; min-width: 180px; margin-top: 0; }
            .lead-convert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
            .lead-convert-field { display: flex; flex-direction: column; gap: 0.35rem; }
            .lead-convert-field.full { grid-column: 1 / -1; }
            .lead-convert-label { color: #9a9aaa; font-family: Oswald, sans-serif; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
            .lead-convert-input, .lead-convert-textarea { border: 1px solid rgba(30,30,47,0.13); border-radius: 8px; color: var(--text-dark); font: inherit; padding: 0.85rem 0.95rem; width: 100%; }
            .lead-convert-textarea { min-height: 150px; resize: vertical; }
            .lead-convert-audio-row { display: flex; align-items: center; gap: 0.65rem; margin: 0.35rem 0 0.7rem; }
            .lead-convert-file-input { display: none; }
            .open-lead-card { cursor: pointer; }
            .open-lead-card .order-main { grid-template-columns: minmax(0, 1fr) minmax(24rem, 0.78fr); align-items: stretch; }
            .open-lead-card-meta {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 0.85rem;
                align-items: stretch;
                min-width: min(100%, 34rem);
            }
            .open-lead-card-meta-item {
                min-width: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 0.34rem;
                padding: 0.2rem 0 0.2rem 0.9rem;
                border-left: 1px solid rgba(30,30,47,0.12);
            }
            .open-lead-card-meta-label {
                color: var(--text-tertiary);
                font-family: Oswald, sans-serif;
                font-size: 0.64rem;
                font-weight: 700;
                letter-spacing: 0.15em;
                text-transform: uppercase;
            }
            .open-lead-card-meta-value {
                min-width: 0;
                color: var(--text-secondary);
                font-size: 0.86rem;
                font-weight: 700;
                line-height: 1.24;
                overflow-wrap: anywhere;
            }
            .open-lead-card-meta-value.value {
                color: var(--text-primary);
                font-family: Oswald, sans-serif;
                font-size: 1.45rem;
                line-height: 1;
            }
            .open-lead-card-meta-value.status {
                font-family: Oswald, sans-serif;
                font-size: 1.02rem;
                letter-spacing: 0.02em;
                text-transform: uppercase;
            }
            .open-lead-action-grid .modal-btn.primary, #openLeadConvertSubmitBtn { background: var(--accent); color: #fff; }
            .open-lead-action-grid .modal-btn.primary:hover, #openLeadConvertSubmitBtn:hover { background: var(--accent-light); box-shadow: 0 0 30px var(--accent-glow); }
            @media (max-width: 1200px) { .open-lead-card .order-main { grid-template-columns: 1fr; } .open-lead-card-meta { width: 100%; min-width: 0; } }
            @media (max-width: 900px) { .open-lead-action-grid, .lead-convert-grid, .open-lead-dossier-grid { grid-template-columns: 1fr; } }
            @media (max-width: 768px) { .open-lead-card-meta { grid-template-columns: 1fr; } .open-lead-dossier-actions { flex-direction: column; } .open-lead-dossier-actions .modal-btn { width: 100%; min-width: 0; } }
        `;
        document.head.appendChild(style);
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

    function createLeadActionModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'openLeadActionModal';
        overlay.setAttribute('aria-hidden', 'true');

        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Openstaande lead acties');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendTextElement(headerText, 'div', 'modal-title', 'Openstaande Lead');
        appendTextElement(headerText, 'div', 'modal-subtitle', 'Kies wat er met deze lead moet gebeuren.');
        header.append(headerText, createModalCloseButton(closeOpenLeadActionModal));

        const actionTitle = appendTextElement(modal, 'div', 'order-title', '');
        actionTitle.id = 'openLeadActionTitle';
        const grid = document.createElement('div');
        grid.className = 'open-lead-action-grid';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'modal-btn danger magnetic';
        removeBtn.id = 'openLeadRemoveBtn';
        removeBtn.type = 'button';
        removeBtn.textContent = 'Uit systeem halen';
        removeBtn.addEventListener('click', () => { void removeSelectedOpenLeadFromSystem(); });
        const dossierBtn = document.createElement('button');
        dossierBtn.className = 'modal-btn secondary magnetic';
        dossierBtn.id = 'openLeadDossierBtn';
        dossierBtn.type = 'button';
        dossierBtn.textContent = 'Bekijk dossier';
        dossierBtn.addEventListener('click', openSelectedOpenLeadDossier);
        const convertBtn = document.createElement('button');
        convertBtn.className = 'modal-btn primary magnetic';
        convertBtn.id = 'openLeadConvertBtn';
        convertBtn.type = 'button';
        convertBtn.textContent = 'Verplaatsen naar actieve opdrachten';
        convertBtn.addEventListener('click', openSelectedLeadConversionModal);
        grid.append(removeBtn, dossierBtn, convertBtn);
        const actionMessage = appendTextElement(modal, 'div', 'open-lead-action-message', '');
        actionMessage.id = 'openLeadActionMessage';

        modal.insertBefore(header, modal.firstChild);
        modal.insertBefore(grid, actionMessage);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeOpenLeadActionModal();
        });
        document.body.appendChild(overlay);
    }

    function appendOpenLeadDossierItem(parent, label, value, options = {}) {
        const item = document.createElement('div');
        item.className = 'open-lead-dossier-item' + (options.full ? ' full' : '');
        appendTextElement(item, 'div', 'open-lead-dossier-label', label);
        const valueEl = appendTextElement(item, 'div', 'open-lead-dossier-value' + (options.multiline ? ' multiline' : ''), String(value || '').trim() || '-');
        if (options.multiline) valueEl.setAttribute('aria-label', label);
        parent.appendChild(item);
        return item;
    }

    function renderOpenLeadDossier(lead) {
        const body = document.getElementById('openLeadDossierBody');
        const title = document.getElementById('openLeadDossierTitle');
        if (!body || !lead) return;
        if (title) title.textContent = lead.company || 'Openstaande lead';

        const grid = document.createElement('div');
        grid.className = 'open-lead-dossier-grid';
        appendOpenLeadDossierItem(grid, 'Bedrijfsnaam', lead.company);
        appendOpenLeadDossierItem(grid, 'Contactpersoon', lead.contact);
        appendOpenLeadDossierItem(grid, 'Type', getOpenLeadLineLabel(lead.productLine));
        appendOpenLeadDossierItem(grid, 'Leadwaarde', lead.value || '-');
        appendOpenLeadDossierItem(grid, 'Toegewezen aan', lead.leadOwnerName || 'Nog niet geclaimd');
        appendOpenLeadDossierItem(grid, 'Datum', formatAgendaLeadDateTimeLabel(lead.date, lead.time) || '-');
        appendOpenLeadDossierItem(grid, 'Telefoon', lead.phone || '-');
        appendOpenLeadDossierItem(grid, 'E-mail', lead.contactEmail || '-');
        appendOpenLeadDossierItem(grid, 'Domein', lead.postCallDomainName || '-', { full: true });
        appendOpenLeadDossierItem(grid, 'Samenvatting', lead.summary || 'Nog geen samenvatting vastgelegd.', { full: true, multiline: true });
        appendOpenLeadDossierItem(grid, 'Notities / transcript', lead.postCallNotesTranscript || 'Nog geen transcript of extra notities vastgelegd.', { full: true, multiline: true });
        appendOpenLeadDossierItem(grid, 'Bouwprompt', lead.postCallPrompt || buildPromptFromOpenLead(lead, { company: lead.company, title: `${getOpenLeadLineLabel(lead.productLine)} opdracht voor ${lead.company || 'lead'}`, domain: lead.postCallDomainName, notes: joinLeadNotes(lead.postCallNotesTranscript, lead.summary) }), { full: true, multiline: true });
        body.replaceChildren(grid);
    }

    function createOpenLeadDossierModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'openLeadDossierModal';
        overlay.setAttribute('aria-hidden', 'true');

        const modal = document.createElement('div');
        modal.className = 'modal create-order-dialog open-lead-dossier-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Openstaande lead dossier');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendTextElement(headerText, 'div', 'modal-title', 'Lead Dossier');
        appendTextElement(headerText, 'div', 'modal-subtitle', 'Alle beschikbare informatie van deze openstaande lead.');
        header.append(headerText, createModalCloseButton(closeOpenLeadDossierModal));

        const dossierTitle = appendTextElement(modal, 'div', 'order-title', '');
        dossierTitle.id = 'openLeadDossierTitle';
        const body = document.createElement('div');
        body.className = 'open-lead-dossier-body';
        body.id = 'openLeadDossierBody';

        const actions = document.createElement('div');
        actions.className = 'open-lead-dossier-actions';
        const backBtn = document.createElement('button');
        backBtn.className = 'modal-btn secondary magnetic';
        backBtn.type = 'button';
        backBtn.textContent = 'Terug';
        backBtn.addEventListener('click', () => {
            closeOpenLeadDossierModal();
            if (selectedOpenLead) setModalVisible('openLeadActionModal', true);
        });
        const convertBtn = document.createElement('button');
        convertBtn.className = 'modal-btn primary magnetic';
        convertBtn.type = 'button';
        convertBtn.textContent = 'Verplaatsen naar actieve opdrachten';
        convertBtn.addEventListener('click', openSelectedLeadConversionModal);
        actions.append(backBtn, convertBtn);

        modal.insertBefore(header, modal.firstChild);
        modal.append(dossierTitle, body, actions);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeOpenLeadDossierModal();
        });
        document.body.appendChild(overlay);
    }

    function createLeadConvertField(parent, id, label, tagName, attrs = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'lead-convert-field' + (attrs.full ? ' full' : '');
        const labelEl = document.createElement('label');
        labelEl.className = 'lead-convert-label';
        labelEl.setAttribute('for', id);
        labelEl.textContent = label;
        const field = document.createElement(tagName);
        field.className = tagName === 'textarea' ? 'lead-convert-textarea' : 'lead-convert-input';
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

    function createLeadConversionModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'openLeadConvertModal';
        overlay.setAttribute('aria-hidden', 'true');

        const modal = document.createElement('div');
        modal.className = 'modal create-order-dialog';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-label', 'Openstaande lead naar actieve opdracht');

        const header = document.createElement('div');
        header.className = 'modal-header';
        const headerText = document.createElement('div');
        appendTextElement(headerText, 'div', 'modal-title', 'Dossier Bijwerken');
        appendTextElement(headerText, 'div', 'modal-subtitle', 'Voeg eerst extra info of een opname toe. Daarna wordt dit een actieve opdracht.');
        header.append(headerText, createModalCloseButton(closeOpenLeadConversionModal));

        const form = document.createElement('form');
        form.id = 'openLeadConvertForm';
        form.className = 'create-order-form';
        const grid = document.createElement('div');
        grid.className = 'lead-convert-grid';
        createLeadConvertField(grid, 'openLeadConvertCompany', 'Bedrijfsnaam', 'input', { required: true });
        createLeadConvertField(grid, 'openLeadConvertContact', 'Contactpersoon', 'input', { required: true });
        createLeadConvertField(grid, 'openLeadConvertTitle', 'Opdracht titel', 'input', { required: true, full: true });
        createLeadConvertField(grid, 'openLeadConvertDelivery', 'Oplevertijd', 'input', { required: true });
        createLeadConvertField(grid, 'openLeadConvertAmount', 'Bedrag', 'input', { required: true, type: 'number', min: '1', step: '100' });
        createLeadConvertField(grid, 'openLeadConvertAssignee', 'Toegewezen aan', 'select', {
            required: true,
            options: [
                { value: '', label: 'Kies medewerker' },
                { value: 'Martijn', label: 'Martijn' },
                { value: 'Servé', label: 'Servé' }
            ]
        });
        createLeadConvertField(grid, 'openLeadConvertDomain', 'Domeinnaam', 'input', { placeholder: 'optioneel', full: true });
        const notes = createLeadConvertField(grid, 'openLeadConvertNotes', 'Info / notities', 'textarea', { required: true, full: true });

        const audioRow = document.createElement('div');
        audioRow.className = 'lead-convert-audio-row';
        const audioButton = document.createElement('button');
        audioButton.className = 'topbar-btn magnetic';
        audioButton.id = 'openLeadConvertAudioBtn';
        audioButton.type = 'button';
        audioButton.textContent = 'Opname toevoegen';
        const audioInput = document.createElement('input');
        audioInput.className = 'lead-convert-file-input';
        audioInput.id = 'openLeadConvertAudioInput';
        audioInput.type = 'file';
        audioInput.accept = 'audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,audio/webm,audio/ogg,audio/aac,audio/flac,.mp3,.m4a,.wav,.webm,.ogg,.aac,.flac';
        const audioStatus = appendTextElement(audioRow, 'span', 'open-lead-action-message', '');
        audioStatus.id = 'openLeadConvertAudioStatus';
        audioButton.addEventListener('click', () => {
            if (!openLeadConversionBusy) audioInput.click();
        });
        audioInput.addEventListener('change', (event) => {
            const file = event?.target?.files ? event.target.files[0] : null;
            if (file) void handleOpenLeadAudioUpload(file, notes, audioInput);
        });
        audioRow.prepend(audioButton, audioInput);

        const actions = document.createElement('div');
        actions.className = 'create-order-actions';
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'modal-btn secondary magnetic';
        cancelBtn.type = 'button';
        cancelBtn.textContent = 'Annuleren';
        cancelBtn.addEventListener('click', closeOpenLeadConversionModal);
        const submitBtn = document.createElement('button');
        submitBtn.className = 'modal-btn primary magnetic';
        submitBtn.id = 'openLeadConvertSubmitBtn';
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Opslaan en verplaatsen';
        actions.append(cancelBtn, submitBtn);

        form.append(grid, audioRow);
        appendTextElement(form, 'div', 'open-lead-action-message', '').id = 'openLeadConvertMessage';
        form.appendChild(actions);
        form.addEventListener('submit', (event) => { void submitOpenLeadConversion(event); });
        modal.append(header, form);
        overlay.appendChild(modal);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) closeOpenLeadConversionModal();
        });
        document.body.appendChild(overlay);
    }

    function ensureOpenLeadActionUi() {
        ensureOpenLeadActionStyles();
        if (!document.getElementById('openLeadActionModal')) createLeadActionModal();
        if (!document.getElementById('openLeadDossierModal')) createOpenLeadDossierModal();
        if (!document.getElementById('openLeadConvertModal')) createLeadConversionModal();
    }

    function setModalVisible(id, visible) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.toggle('show', Boolean(visible));
        modal.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }

    function openOpenLeadActionModal(lead) {
        if (!lead) return;
        selectedOpenLead = lead;
        ensureOpenLeadActionUi();
        const title = document.getElementById('openLeadActionTitle');
        if (title) title.textContent = lead.company || 'Openstaande lead';
        setOpenLeadActionMessage('', '');
        setModalVisible('openLeadActionModal', true);
    }

    function closeOpenLeadActionModal() {
        setModalVisible('openLeadActionModal', false);
        setOpenLeadActionMessage('', '');
    }

    function closeOpenLeadDossierModal() {
        setModalVisible('openLeadDossierModal', false);
    }

    function closeOpenLeadConversionModal(force) {
        if (openLeadConversionBusy && !force) return;
        setModalVisible('openLeadConvertModal', false);
        setOpenLeadConversionMessage('', '');
    }

    function setOpenLeadConversionBusy(nextBusy) {
        openLeadConversionBusy = Boolean(nextBusy);
        ['openLeadConvertSubmitBtn', 'openLeadConvertAudioBtn'].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.disabled = openLeadConversionBusy;
        });
    }

    function parseOpenLeadAmount(value) {
        const n = Number(String(value || '').replace(/[^\d]/g, ''));
        return Number.isFinite(n) && n > 0 ? Math.round(n) : 2500;
    }

    function buildPromptFromOpenLead(lead, formValues) {
        const company = normalizeOpenLeadText(formValues.company || lead?.company || 'de klant');
        const title = normalizeOpenLeadText(formValues.title || `Website opdracht voor ${company}`);
        const notes = String(formValues.notes || lead?.summary || '').trim();
        const domain = normalizeOpenLeadText(formValues.domain || lead?.postCallDomainName || '');
        return [
            `Bouw een premium, moderne en volledig responsieve ${getOpenLeadLineLabel(lead?.productLine).toLowerCase()} voor ${company}.`,
            `Opdracht: ${title}.`,
            domain ? `Gewenst domein: ${domain}.` : '',
            notes ? `Dossiernotities: ${notes}` : '',
            'Gebruik de bestaande leadgegevens en werk ontbrekende onderdelen netjes als placeholder uit.'
        ].filter(Boolean).join('\n');
    }

    function openSelectedLeadConversionModal() {
        const lead = selectedOpenLead;
        if (!lead) return;
        ensureOpenLeadActionUi();
        closeOpenLeadActionModal();
        closeOpenLeadDossierModal();
        const company = document.getElementById('openLeadConvertCompany');
        const contact = document.getElementById('openLeadConvertContact');
        const title = document.getElementById('openLeadConvertTitle');
        const delivery = document.getElementById('openLeadConvertDelivery');
        const amount = document.getElementById('openLeadConvertAmount');
        const assignee = document.getElementById('openLeadConvertAssignee');
        const domain = document.getElementById('openLeadConvertDomain');
        const notes = document.getElementById('openLeadConvertNotes');
        if (company) company.value = lead.company || '';
        if (contact) contact.value = lead.contact || '';
        if (title) title.value = `${getOpenLeadLineLabel(lead.productLine)} opdracht voor ${lead.company || 'lead'}`;
        if (delivery) delivery.value = 'Volgens afspraak';
        if (amount) amount.value = String(parseOpenLeadAmount(lead.value));
        if (assignee) assignee.value = normalizeOpenLeadAssignee(lead.leadOwnerName || '');
        if (domain) domain.value = lead.postCallDomainName || '';
        if (notes) {
            notes.value = joinLeadNotes(lead.postCallNotesTranscript, lead.summary);
        }
        if (typeof window.initCustomFormSelects === 'function') window.initCustomFormSelects(document.getElementById('openLeadConvertModal') || document);
        const audioStatus = document.getElementById('openLeadConvertAudioStatus');
        if (audioStatus) audioStatus.textContent = '';
        setOpenLeadConversionMessage('', '');
        setModalVisible('openLeadConvertModal', true);
        window.setTimeout(() => notes?.focus(), 40);
    }

    function openSelectedOpenLeadDossier() {
        const lead = selectedOpenLead;
        if (!lead) return;
        ensureOpenLeadActionUi();
        renderOpenLeadDossier(lead);
        closeOpenLeadActionModal();
        setModalVisible('openLeadDossierModal', true);
    }

    function getOpenLeadAudioMimeType(file) {
        const explicit = String(file?.type || '').trim().toLowerCase();
        if (explicit.startsWith('audio/')) return explicit;
        const name = String(file?.name || '').trim().toLowerCase();
        if (name.endsWith('.mp3')) return 'audio/mpeg';
        if (name.endsWith('.m4a') || name.endsWith('.mp4')) return 'audio/mp4';
        if (name.endsWith('.wav')) return 'audio/wav';
        if (name.endsWith('.webm')) return 'audio/webm';
        if (name.endsWith('.ogg') || name.endsWith('.oga')) return 'audio/ogg';
        if (name.endsWith('.aac')) return 'audio/aac';
        if (name.endsWith('.flac')) return 'audio/flac';
        return '';
    }

    function readOpenLeadAudioAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Opname kon niet worden gelezen.'));
            reader.readAsDataURL(file);
        });
    }

    async function handleOpenLeadAudioUpload(file, notesEl, inputEl) {
        if (!file || openLeadConversionBusy) return;
        const mimeType = getOpenLeadAudioMimeType(file);
        const status = document.getElementById('openLeadConvertAudioStatus');
        if (!mimeType) {
            if (status) status.textContent = 'Upload een geldig audiobestand.';
            return;
        }
        if (Number(file.size || 0) > 24 * 1024 * 1024) {
            if (status) status.textContent = 'Opname is te groot. Maximaal 24MB.';
            return;
        }
        setOpenLeadConversionBusy(true);
        if (status) status.textContent = 'Opname verwerken...';
        try {
            const dataUrl = await readOpenLeadAudioAsDataUrl(file);
            const payload = String(dataUrl || '').split(',')[1] || '';
            const result = await postOpenLeadJsonWithFallback(
                ['/api/ai/notes-audio-to-text', '/api/ai-notes-audio-to-text'],
                {
                    audioDataUrl: `data:${mimeType};base64,${payload}`,
                    fileName: String(file.name || 'opname').trim().slice(0, 160),
                    mimeType,
                    language: 'nl',
                    appointmentId: selectedOpenLead?.id || null
                },
                { timeoutMs: 130000 }
            );
            const transcript = String(result?.transcript || result?.text || '').trim();
            if (!transcript) throw new Error('Geen transcriptie gevonden.');
            const current = String(notesEl?.value || '').trim();
            const label = String(file.name || '').trim()
                ? `Transcriptie opname (${String(file.name).trim()}):`
                : 'Transcriptie opname:';
            if (notesEl) notesEl.value = current ? `${current}\n\n${label}\n${transcript}` : `${label}\n${transcript}`;
            if (status) status.textContent = 'Opname toegevoegd.';
        } catch (error) {
            if (status) status.textContent = `Opname mislukt: ${String(error?.message || 'onbekende fout')}`;
        } finally {
            setOpenLeadConversionBusy(false);
            if (inputEl) inputEl.value = '';
        }
    }

    function removeOpenLeadLocally(leadId) {
        const idKey = String(leadId || '');
        openLeadOptions = openLeadOptions.filter((item) => String(item?.id) !== idKey);
        const card = document.getElementById(`open-lead-${idKey}`);
        if (card) card.remove();
        if (typeof window.refreshOrderSummaryCards === 'function') window.refreshOrderSummaryCards();
    }

    async function showOpenLeadFeedback(message, options) {
        if (typeof window.showActiveOrderAlert === 'function') {
            await window.showActiveOrderAlert(message, options || {});
            return;
        }
        window.alert(message);
    }

    function revealConvertedOpenLeadOrder(order) {
        const id = Number(order?.id);
        if (!Number.isFinite(id) || id <= 0) return false;
        const existingCard = document.getElementById(`order-${id}`);
        if (existingCard) {
            if (typeof window.setOrderFilter === 'function') window.setOrderFilter('in_progress');
            existingCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return true;
        }
        if (typeof window.appendCustomOrderCard === 'function') {
            const card = window.appendCustomOrderCard(order, { scrollIntoView: true });
            if (typeof window.setOrderFilter === 'function') window.setOrderFilter('in_progress');
            return Boolean(card);
        }
        return false;
    }

    async function removeSelectedOpenLeadFromSystem() {
        const lead = selectedOpenLead;
        if (!lead || openLeadConversionBusy) return;
        const removeBtn = document.getElementById('openLeadRemoveBtn');
        const dossierBtn = document.getElementById('openLeadDossierBtn');
        const convertBtn = document.getElementById('openLeadConvertBtn');
        if (removeBtn) removeBtn.disabled = true;
        if (dossierBtn) dossierBtn.disabled = true;
        if (convertBtn) convertBtn.disabled = true;
        setOpenLeadActionMessage('Lead wordt uit systeem gehaald...', '');
        try {
            if (lead.isManualOpenLead) {
                if (typeof window.SoftoraManualOpenLeads?.remove !== 'function') throw new Error('Handmatige lead-opslag is niet beschikbaar.');
                await window.SoftoraManualOpenLeads.remove(lead.id);
            } else {
                await postOpenLeadJsonWithFallback(
                    [
                        `/api/agenda/confirmation-tasks/${encodeURIComponent(String(lead.id))}/mark-cancelled`,
                        `/api/agenda/confirmation-task-mark-cancelled?taskId=${encodeURIComponent(String(lead.id))}`
                    ],
                    { actor: 'premium-actieve-opdrachten', status: 'uit_systeem' },
                    { timeoutMs: 20000 }
                );
            }
            removeOpenLeadLocally(lead.id);
            closeOpenLeadActionModal();
            await showOpenLeadFeedback('Lead is uit openstaande leads gehaald.', {
                title: 'Openstaande lead',
                confirmText: 'Sluiten'
            });
        } catch (error) {
            setOpenLeadActionMessage(String(error?.message || 'Lead verwijderen mislukt.'), 'error');
        } finally {
            if (removeBtn) removeBtn.disabled = false;
            if (dossierBtn) dossierBtn.disabled = false;
            if (convertBtn) convertBtn.disabled = false;
        }
    }

    async function submitOpenLeadConversion(event) {
        event.preventDefault();
        const lead = selectedOpenLead;
        if (!lead || openLeadConversionBusy) return;
        const values = {
            company: document.getElementById('openLeadConvertCompany')?.value || '',
            contact: document.getElementById('openLeadConvertContact')?.value || '',
            title: document.getElementById('openLeadConvertTitle')?.value || '',
            delivery: document.getElementById('openLeadConvertDelivery')?.value || '',
            amount: document.getElementById('openLeadConvertAmount')?.value || '',
            assignee: document.getElementById('openLeadConvertAssignee')?.value || '',
            domain: document.getElementById('openLeadConvertDomain')?.value || '',
            notes: document.getElementById('openLeadConvertNotes')?.value || ''
        };
        const company = normalizeOpenLeadText(values.company);
        const contact = normalizeOpenLeadText(values.contact);
        const title = normalizeOpenLeadText(values.title);
        const delivery = normalizeOpenLeadText(values.delivery);
        const notes = String(values.notes || '').trim();
        const amount = parseOpenLeadAmount(values.amount);
        const assignee = normalizeOpenLeadAssignee(values.assignee || lead.leadOwnerName || '');
        if (!company || !contact || !title || !delivery || !assignee || notes.length < 10) {
            setOpenLeadConversionMessage('Vul bedrijf, contact, titel, oplevertijd, toegewezen aan en notities in.', 'error');
            return;
        }
        setOpenLeadConversionBusy(true);
        setOpenLeadConversionMessage('Dossier bijwerken en verplaatsen...', '');
        try {
            if (lead.isManualOpenLead) {
                if (typeof window.SoftoraManualOpenLeads?.convertToOrder !== 'function') throw new Error('Handmatige lead-opslag is niet beschikbaar.');
                await window.SoftoraManualOpenLeads.convertToOrder(lead, { ...values, company, contact, title, delivery, amount, notes }, assignee);
                removeOpenLeadLocally(lead.id);
                closeOpenLeadConversionModal(true);
                if (typeof window.setOrderFilter === 'function') window.setOrderFilter('in_progress');
                return;
            }
            const prompt = lead.postCallPrompt || buildPromptFromOpenLead(lead, {
                company,
                title,
                domain: values.domain,
                notes
            });
            const result = await postOpenLeadJsonWithFallback(
                [
                    `/api/agenda/appointments/${encodeURIComponent(String(lead.id))}/add-active-order`,
                    `/api/agenda/add-active-order?appointmentId=${encodeURIComponent(String(lead.id))}`
                ],
                {
                    actor: 'premium-actieve-opdrachten',
                    status: 'actieve_opdracht',
                    title,
                    description: notes,
                    location: contact,
                    amount,
                    domainName: normalizeOpenLeadText(values.domain || lead.postCallDomainName || ''),
                    transcript: joinLeadNotes(lead.postCallNotesTranscript, notes),
                    prompt,
                    assignee,
                    leadOwnerName: assignee
                },
                { timeoutMs: 30000 }
            );
            removeOpenLeadLocally(lead.id);
            closeOpenLeadConversionModal(true);
            if (!revealConvertedOpenLeadOrder(result?.order)) window.location.reload();
        } catch (error) {
            setOpenLeadConversionMessage(String(error?.message || 'Verplaatsen mislukt.'), 'error');
        } finally {
            setOpenLeadConversionBusy(false);
        }
    }

    function clearOpenLeadCards() {
        document.querySelectorAll('#ordersGrid [data-open-lead-card="1"]').forEach((card) => card.remove());
    }

    function createOpenLeadCardElement(lead) {
        const color = getOpenLeadLineColor(lead.productLine);
        const card = document.createElement('div');
        card.className = 'order-card open-lead-card';
        card.id = `open-lead-${lead.id}`;
        card.dataset.openLeadCard = '1';
        card.dataset.orderFilterGroup = 'open_leads';
        card.dataset.leadLine = lead.productLine;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', `Openstaande lead ${lead.company}`);
        card.style.borderColor = color;
        card.addEventListener('click', (event) => {
            if (event.target.closest('button,a,input,textarea,select')) return;
            openOpenLeadActionModal(lead);
        });
        card.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openOpenLeadActionModal(lead);
        });

        const main = document.createElement('div');
        main.className = 'order-main';
        const info = document.createElement('div');
        info.className = 'order-info';
        const clientEl = appendTextElement(info, 'div', 'order-client', formatAgendaLeadDateTimeLabel(lead.date, lead.time) || 'Openstaande lead');
        clientEl.style.color = color;
        appendTextElement(info, 'div', 'order-title', lead.company);
        appendTextElement(info, 'div', 'order-desc', lead.summary || `${lead.contact} wacht op een vervolgstap.`);
        const delivery = document.createElement('div');
        delivery.className = 'order-delivery';
        appendTextElement(delivery, 'strong', '', 'Type');
        delivery.appendChild(document.createTextNode(getOpenLeadLineLabel(lead.productLine)));
        info.appendChild(delivery);

        const meta = document.createElement('div');
        meta.className = 'open-lead-card-meta';
        const valueMeta = document.createElement('div');
        valueMeta.className = 'open-lead-card-meta-item';
        appendTextElement(valueMeta, 'div', 'open-lead-card-meta-label', 'Leadwaarde');
        appendTextElement(valueMeta, 'div', 'open-lead-card-meta-value value', lead.value || '-');
        const statusMeta = document.createElement('div');
        statusMeta.className = 'open-lead-card-meta-item';
        appendTextElement(statusMeta, 'div', 'open-lead-card-meta-label', 'Status');
        const status = appendTextElement(statusMeta, 'div', 'open-lead-card-meta-value status', 'Openstaande lead');
        status.style.color = color;
        const assigneeMeta = document.createElement('div');
        assigneeMeta.className = 'open-lead-card-meta-item';
        appendTextElement(assigneeMeta, 'div', 'open-lead-card-meta-label', 'Toegewezen aan');
        appendTextElement(assigneeMeta, 'div', 'open-lead-card-meta-value', lead.leadOwnerName || 'Nog niet geclaimd');
        meta.append(valueMeta, statusMeta, assigneeMeta);

        main.append(info, meta);
        card.appendChild(main);
        return card;
    }

    function renderOpenLeadCards() {
        const grid = document.getElementById('ordersGrid');
        if (!grid) return;
        clearOpenLeadCards();
        openLeadOptions.forEach((lead) => grid.appendChild(createOpenLeadCardElement(lead)));
        if (typeof window.refreshOrderSummaryCards === 'function') window.refreshOrderSummaryCards();
    }

    async function loadOpenLeadCards(force) {
        await fetchOpenLeadOptions(force);
        renderOpenLeadCards();
    }

    window.SoftoraActiveOrderOpenLeads = {
        load: loadOpenLeadCards,
        normalizeOpenLeadOption,
        resolveOpenLeadProductLine
    };
    window.setTimeout(() => { void loadOpenLeadCards(true); }, 450);
})();
