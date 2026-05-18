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
        if (aTs === bTs) return String(b?.id || '').localeCompare(String(a?.id || ''));
        return bTs - aTs;
    }

    function normalizeLeadFollowUpStatus(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    }

    function resolveOpenLeadProductLine(item) {
        const hay = [
            item?.leadType,
            item?.title,
            item?.company,
            item?.summary,
            item?.conversationSummary,
            item?.coldcallingStack,
            item?.coldcallingStackLabel,
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
        if (!status.includes('lead_follow_up')) return false;
        if (Number(item?.activeOrderId || 0) > 0) return false;
        return Boolean(resolveOpenLeadProductLine(item));
    }

    function normalizeOpenLeadOption(item) {
        if (!item || typeof item !== 'object' || !isOpenLeadFollowUpTask(item)) return null;
        const id = Number(item?.appointmentId || item?.id);
        if (!Number.isFinite(id) || id <= 0) return null;
        const productLine = resolveOpenLeadProductLine(item);
        if (!productLine) return null;
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
            let agendaOptions = [];
            try {
                const response = await fetch('/api/agenda/confirmation-tasks?limit=250&quick=1&fresh=1', { cache: 'no-store' });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result?.ok || !Array.isArray(result?.tasks)) throw new Error('Openstaande leads niet beschikbaar.');
                agendaOptions = result.tasks.map(normalizeOpenLeadOption).filter(Boolean);
            } catch (_) {
                agendaOptions = [];
            } finally {
                openLeadOptionsLoadedAt = Date.now();
            }
            const manualOptions = await Promise.resolve(window.SoftoraManualOpenLeads?.getOptions?.() || []).catch(() => []);
            openLeadOptions = agendaOptions.concat(Array.isArray(manualOptions) ? manualOptions : []).sort(compareAgendaLeadOptions);
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
            .open-lead-action-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-top: 1rem; }
            .open-lead-action-message { min-height: 1.35rem; color: #8f8fa0; font-weight: 700; margin-top: 0.8rem; }
            .open-lead-action-message.error { color: #d24a3a; }
            .open-lead-action-message.success { color: var(--accent); }
            .lead-convert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
            .lead-convert-field { display: flex; flex-direction: column; gap: 0.35rem; }
            .lead-convert-field.full { grid-column: 1 / -1; }
            .lead-convert-label { color: #9a9aaa; font-family: Oswald, sans-serif; font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; }
            .lead-convert-input, .lead-convert-textarea { border: 1px solid rgba(30,30,47,0.13); border-radius: 8px; color: var(--text-dark); font: inherit; padding: 0.85rem 0.95rem; width: 100%; }
            .lead-convert-textarea { min-height: 150px; resize: vertical; }
            .lead-convert-audio-row { display: flex; align-items: center; gap: 0.65rem; margin: 0.35rem 0 0.7rem; }
            .lead-convert-file-input { display: none; }
            .open-lead-card { cursor: pointer; }
            .open-lead-action-grid .modal-btn.primary, #openLeadConvertSubmitBtn { background: var(--accent); color: #fff; }
            .open-lead-action-grid .modal-btn.primary:hover, #openLeadConvertSubmitBtn:hover { background: var(--accent-light); box-shadow: 0 0 30px var(--accent-glow); }
            @media (max-width: 768px) { .open-lead-action-grid, .lead-convert-grid { grid-template-columns: 1fr; } }
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
        const convertBtn = document.createElement('button');
        convertBtn.className = 'modal-btn primary magnetic';
        convertBtn.id = 'openLeadConvertBtn';
        convertBtn.type = 'button';
        convertBtn.textContent = 'Verplaatsen naar actieve opdrachten';
        convertBtn.addEventListener('click', openSelectedLeadConversionModal);
        grid.append(removeBtn, convertBtn);
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
        const company = document.getElementById('openLeadConvertCompany');
        const contact = document.getElementById('openLeadConvertContact');
        const title = document.getElementById('openLeadConvertTitle');
        const delivery = document.getElementById('openLeadConvertDelivery');
        const amount = document.getElementById('openLeadConvertAmount');
        const domain = document.getElementById('openLeadConvertDomain');
        const notes = document.getElementById('openLeadConvertNotes');
        if (company) company.value = lead.company || '';
        if (contact) contact.value = lead.contact || '';
        if (title) title.value = `${getOpenLeadLineLabel(lead.productLine)} opdracht voor ${lead.company || 'lead'}`;
        if (delivery) delivery.value = 'Volgens afspraak';
        if (amount) amount.value = String(parseOpenLeadAmount(lead.value));
        if (domain) domain.value = lead.postCallDomainName || '';
        if (notes) {
            notes.value = joinLeadNotes(lead.postCallNotesTranscript, lead.summary);
        }
        const audioStatus = document.getElementById('openLeadConvertAudioStatus');
        if (audioStatus) audioStatus.textContent = '';
        setOpenLeadConversionMessage('', '');
        setModalVisible('openLeadConvertModal', true);
        window.setTimeout(() => notes?.focus(), 40);
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
        const key = String(leadId || '').trim();
        openLeadOptions = openLeadOptions.filter((item) => String(item?.id || '').trim() !== key);
        const card = document.getElementById(`open-lead-${key.replace(/[^a-z0-9_-]+/gi, '-')}`);
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
        const convertBtn = document.getElementById('openLeadConvertBtn');
        if (removeBtn) removeBtn.disabled = true;
        if (convertBtn) convertBtn.disabled = true;
        setOpenLeadActionMessage('Lead wordt uit systeem gehaald...', '');
        try {
            if (lead.isManualOpenLead && typeof window.SoftoraManualOpenLeads?.remove === 'function') {
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
            domain: document.getElementById('openLeadConvertDomain')?.value || '',
            notes: document.getElementById('openLeadConvertNotes')?.value || ''
        };
        const company = normalizeOpenLeadText(values.company);
        const contact = normalizeOpenLeadText(values.contact);
        const title = normalizeOpenLeadText(values.title);
        const delivery = normalizeOpenLeadText(values.delivery);
        const notes = String(values.notes || '').trim();
        const amount = parseOpenLeadAmount(values.amount);
        if (!company || !contact || !title || !delivery || notes.length < 10) {
            setOpenLeadConversionMessage('Vul bedrijf, contact, titel, oplevertijd en notities in.', 'error');
            return;
        }
        setOpenLeadConversionBusy(true);
        setOpenLeadConversionMessage('Dossier bijwerken en verplaatsen...', '');
        try {
            const prompt = lead.postCallPrompt || buildPromptFromOpenLead(lead, {
                company,
                title,
                domain: values.domain,
                notes
            });
            if (lead.isManualOpenLead && typeof window.SoftoraManualOpenLeads?.convertToOrder === 'function') {
                const order = await window.SoftoraManualOpenLeads.convertToOrder(lead, {
                    companyName: company,
                    contactName: contact,
                    contactPhone: lead.phone,
                    contactEmail: lead.contactEmail,
                    title,
                    description: notes,
                    deliveryTime: delivery,
                    amount,
                    domainName: normalizeOpenLeadText(values.domain || lead.postCallDomainName || ''),
                    transcript: joinLeadNotes(lead.postCallNotesTranscript, notes),
                    prompt,
                    leadOwnerName: lead.leadOwnerName,
                    sourceOpenLeadId: lead.id
                });
                removeOpenLeadLocally(lead.id);
                closeOpenLeadConversionModal(true);
                if (!revealConvertedOpenLeadOrder(order)) window.location.reload();
                return;
            }
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
                    prompt
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
        card.id = `open-lead-${String(lead.id || '').replace(/[^a-z0-9_-]+/gi, '-')}`;
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

        const price = document.createElement('div');
        price.className = 'order-price';
        appendTextElement(price, 'div', 'order-price-label', 'Leadwaarde');
        appendTextElement(price, 'div', 'order-price-value', lead.value || '-');

        const actions = document.createElement('div');
        actions.className = 'order-actions';
        const status = appendTextElement(actions, 'div', 'order-title', 'Openstaande lead');
        status.style.color = color;
        status.style.fontSize = '0.92rem';
        const assignee = appendTextElement(actions, 'div', 'order-assignee', lead.leadOwnerName || 'Nog niet geclaimd');
        assignee.style.textAlign = 'center';

        main.append(info, price, actions);
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

    window.SoftoraActiveOrderOpenLeads = { load: loadOpenLeadCards, normalizeOpenLeadOption, resolveOpenLeadProductLine };
    window.setTimeout(() => { void loadOpenLeadCards(true); }, 450);
})();
