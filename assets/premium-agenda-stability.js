function isManualAgendaAppointment(item) {
    if (!item || typeof item !== 'object') return false;
    const callId = String(item.callId || '').trim().toLowerCase();
    if (callId.startsWith('manual_')) return true;
    const sourceText = [item.source, item.softoraSource, item.createdFrom, item.createdBy, item.summary]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(' ');
    return /\b(handmatig|manual|premium-personeel-agenda)\b/.test(sourceText);
}

function normalizeManualAgendaDate(value) {
    const ymd = typeof normalizeAgendaDateYmd === 'function' ? normalizeAgendaDateYmd(value) : String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : '';
}

function isAgendaDateBeforeToday(value) {
    const ymd = normalizeManualAgendaDate(value);
    if (!ymd) return false;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!match) return false;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return Number.isFinite(date.getTime()) && date.getTime() < todayStart.getTime();
}

function getAppointmentStartDate(apt) {
    const ymd = normalizeManualAgendaDate(apt && apt.date);
    if (!ymd) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    const minutes = typeof parseManualTimeToMinutes === 'function' ? parseManualTimeToMinutes(apt.time || apt.activityTime || '') : null;
    const hour = minutes === null ? 0 : Math.floor(minutes / 60);
    const minute = minutes === null ? 0 : minutes % 60;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, minute, 0, 0);
    return Number.isFinite(date.getTime()) ? date : null;
}

function hasAppointmentStartPassed(apt) {
    const startDate = getAppointmentStartDate(apt);
    return Boolean(startDate && startDate.getTime() <= Date.now());
}

function isManualAppointmentStartInPast(dateYmd, timeValue) {
    return hasAppointmentStartPassed({ date: dateYmd, time: timeValue });
}

function isManualOtherAppointment(apt) {
    if (!apt || typeof apt !== 'object') return false;
    if (!isManualAgendaAppointment(apt)) return false;
    const choice = normalizeManualLegendChoice(apt.manualLegendChoice || apt.legendChoice || '');
    if (choice === 'manual-overig' || choice === 'manual-serve' || choice === 'manual-martijn' || choice === 'manual-both') return true;
    if (choice) return false;
    const kindText = [apt.manualKind, apt.kind, apt.type, apt.appointmentKind, apt.source]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(' ');
    return /\b(overig|other|manual-overig)\b/.test(kindText);
}

function setModalDetailValueHidden(valueElementId, hidden) {
    const valueElement = document.getElementById(valueElementId);
    const detailItem = valueElement ? valueElement.closest('.modal-detail-item') : null;
    if (detailItem) detailItem.hidden = Boolean(hidden);
}

function syncManualAppointmentModalDetails(apt) {
    const isManual = isManualAgendaAppointment(apt);
    setModalDetailValueHidden('modalBranche', isManual);
    setModalDetailValueHidden('modalProvider', isManual);
    const contactEl = document.getElementById('modalContact');
    if (contactEl) {
        const contact = String((apt && apt.contact) || '').trim();
        const phone = String((apt && apt.phone) || '').trim();
        contactEl.hidden = isManual && !((contact && contact !== '-' && contact !== '—') || phone);
    }
}

function setModalAudioBlockHidden(hidden) {
    if (!modalAudioBlock) return;
    modalAudioBlock.hidden = Boolean(hidden);
    modalAudioBlock.style.display = hidden ? 'none' : '';
}

function ensureAgendaAudioUploadStyles() {
    if (document.getElementById('agendaAudioUploadStyles')) return;
    const style = document.createElement('style');
    style.id = 'agendaAudioUploadStyles';
    style.textContent = `
        .modal-workspace-actions--notes { margin: 0 0 0.6rem; }
        .workspace-attachment-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.4rem;
        }
        .workspace-attachment-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
            box-shadow: none;
        }
        .workspace-attachment-btn svg {
            width: 15px;
            height: 15px;
        }
    `;
    document.head.appendChild(style);
}

function getAgendaAudioUploadMimeType(file) {
    const explicit = String(file && file.type || '').trim().toLowerCase();
    if (explicit.startsWith('audio/')) return explicit;

    const name = String(file && file.name || '').trim().toLowerCase();
    if ((explicit === 'video/mp4' || explicit === 'video/webm' || explicit === 'video/ogg') && /\.(m4a|mp4|webm|ogg|oga)$/.test(name)) {
        return explicit;
    }
    if (name.endsWith('.mp3')) return 'audio/mpeg';
    if (name.endsWith('.m4a') || name.endsWith('.mp4')) return 'audio/mp4';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.webm')) return 'audio/webm';
    if (name.endsWith('.ogg') || name.endsWith('.oga')) return 'audio/ogg';
    if (name.endsWith('.aac')) return 'audio/aac';
    if (name.endsWith('.flac')) return 'audio/flac';
    return '';
}

function readAgendaAudioFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Bestand kon niet worden gelezen.'));
        reader.readAsDataURL(file);
    });
}

async function normalizeAgendaNotesAudioForUpload(file) {
    const mimeType = getAgendaAudioUploadMimeType(file);
    if (!file || !mimeType) {
        throw new Error('Upload een geldig audiobestand.');
    }
    if (Number(file.size || 0) > 24 * 1024 * 1024) {
        throw new Error('Audiobestand is te groot. Upload maximaal 24MB.');
    }

    const originalDataUrl = await readAgendaAudioFileAsDataUrl(file);
    const payload = String(originalDataUrl || '').split(',')[1] || '';
    if (!payload) {
        throw new Error('Audiobestand kon niet worden gelezen.');
    }
    return `data:${mimeType};base64,${payload}`;
}

async function postAgendaAudioJsonWithFallback(urls, body, options = {}) {
    const endpointList = Array.isArray(urls) ? urls : [urls];
    const timeoutMs = Math.max(3000, Math.min(130000, Number(options.timeoutMs || 130000)));
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
                cache: 'no-store',
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok) {
                const err = new Error(String(data.detail || data.error || `Request mislukt (${response.status})`));
                err.status = response.status;
                throw err;
            }
            return data;
        } catch (error) {
            if (String(error && error.name || '') === 'AbortError') {
                const timeoutError = new Error(`Timeout na ${Math.round(timeoutMs / 1000)}s (${url})`);
                timeoutError.code = 'TIMEOUT';
                lastError = timeoutError;
            } else {
                lastError = error;
            }
        } finally {
            window.clearTimeout(timer);
        }
    }

    throw lastError || new Error('Audio verwerken mislukt.');
}

async function handleAgendaNotesAudioUpload(file, button, input) {
    if (!file || workspaceBusy) return;

    workspaceBusy = true;
    refreshWorkspacePrimaryButtonLabel();
    if (button) button.disabled = true;
    setVoiceStatus('Audio verwerken naar notities... (kan 1-2 minuten duren)');

    try {
        const audioDataUrl = await normalizeAgendaNotesAudioForUpload(file);
        const result = await postAgendaAudioJsonWithFallback(
            ['/api/ai/notes-audio-to-text', '/api/ai-notes-audio-to-text'],
            {
                audioDataUrl,
                fileName: String(file.name || 'meeting-audio').trim().slice(0, 160),
                mimeType: getAgendaAudioUploadMimeType(file),
                language: 'nl',
                appointmentId: activeAppointmentId,
            },
            { timeoutMs: 130000 }
        );

        const extractedNotes = String(result.transcript || result.text || '').trim();
        if (!extractedNotes) {
            throw new Error('Geen transcriptie gevonden in het audiobestand.');
        }

        const currentNotes = String(workspaceTranscriptEl.value || '').trim();
        const audioLabel = String(file.name || '').trim()
            ? `Transcriptie audiobestand (${String(file.name).trim()}):`
            : 'Transcriptie audiobestand:';
        workspaceTranscriptEl.value = currentNotes
            ? `${currentNotes}\n\n${audioLabel}\n${extractedNotes}`
            : `${audioLabel}\n${extractedNotes}`;

        const generatedPrompt = String(result.prompt || '').trim();
        if (generatedPrompt) {
            workspaceDraftPrompt = generatedPrompt;
        }

        setVoiceStatus('Audio verwerkt. Transcriptie toegevoegd.', 'success');
        setWorkspaceStatus('Notities uit audio toegevoegd.', 'success');
    } catch (error) {
        setVoiceStatus(`Audio verwerken mislukt: ${String(error && error.message || 'onbekende fout')}`, 'error');
    } finally {
        workspaceBusy = false;
        if (button) button.disabled = false;
        refreshWorkspacePrimaryButtonLabel();
        if (input) input.value = '';
    }
}

function ensureAgendaAudioUploadControl() {
    const transcript = document.getElementById('workspaceTranscript');
    if (!transcript || document.getElementById('notesAudioUploadBtn')) return;
    ensureAgendaAudioUploadStyles();

    const actions = document.createElement('div');
    actions.className = 'modal-workspace-actions modal-workspace-actions--notes';
    actions.setAttribute('aria-label', 'Meetingnotities toevoegen');

    const button = document.createElement('button');
    button.className = 'workspace-attachment-btn magnetic';
    button.id = 'notesAudioUploadBtn';
    button.type = 'button';
    button.title = 'Audiobestand toevoegen';
    button.innerHTML = '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9 18V5l12-2v13"/><path stroke-linecap="round" stroke-linejoin="round" d="M9 18a3 3 0 11-6 0 3 3 0 016 0zm12-2a3 3 0 11-6 0 3 3 0 016 0z"/></svg><span>Audio toevoegen</span>';

    const input = document.createElement('input');
    input.className = 'workspace-file-input';
    input.id = 'notesAudioUploadInput';
    input.type = 'file';
    input.accept = 'audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,audio/webm,audio/ogg,audio/aac,audio/flac,.mp3,.m4a,.wav,.webm,.ogg,.aac,.flac';

    button.addEventListener('click', () => {
        if (workspaceBusy) return;
        input.click();
    });
    input.addEventListener('change', (event) => {
        const file = event && event.target && event.target.files ? event.target.files[0] : null;
        if (!file) return;
        void handleAgendaNotesAudioUpload(file, button, input);
    });

    actions.appendChild(button);
    actions.appendChild(input);
    transcript.parentNode.insertBefore(actions, transcript);
}

async function markActiveManualActivityCompleted() {
    const apt = getActiveAppointment();
    if (!apt || workspaceBusy || !isManualOtherAppointment(apt) || isAppointmentCompleted(apt)) return;
    workspaceBusy = true;
    refreshWorkspacePrimaryButtonLabel();
    try {
        const payload = {
            status: 'completed',
            transcript: String(apt.postCallNotesTranscript || apt.summary || ''),
            prompt: String(apt.postCallPrompt || ''),
            domainName: normalizeWorkspaceDomainName(apt.postCallDomainName || ''),
            referenceImages: normalizeReferenceImageList(apt.referenceImages || []),
            actor: 'premium-personeel-agenda',
        };
        const result = await postJsonWithFallback([
            `/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/post-call`,
            `/api/agenda/appointment-post-call?appointmentId=${encodeURIComponent(String(apt.id))}`,
        ], payload);
        updateAppointmentPostCallFields({ ...apt, ...(result.appointment || {}), postCallStatus: 'completed' });
    } catch (_) {
        updateAppointmentPostCallFields({ ...apt, postCallStatus: 'completed' });
    } finally {
        workspaceBusy = false;
        refreshWorkspacePrimaryButtonLabel();
    }
}

function releaseAgendaBootShell() {
    if (window.SoftoraPremiumBoot && typeof window.SoftoraPremiumBoot.setShellBooting === 'function') {
        window.SoftoraPremiumBoot.setShellBooting(false);
        return;
    }
    const main = document.querySelector('main.is-premium-boot-host');
    const shell = main ? main.querySelector('.premium-boot-shell') : null;
    const loader = main ? main.querySelector('.premium-boot-loader') : null;
    if (shell) {
        shell.classList.remove('is-booting');
        shell.setAttribute('aria-busy', 'false');
    }
    if (loader) {
        loader.classList.add('is-hidden');
        loader.setAttribute('aria-hidden', 'true');
    }
}

const agendaBootFailsafeTimer = window.setTimeout(releaseAgendaBootShell, 4500);

window.SoftoraAgendaStability = {
    finishBoot() {
        window.clearTimeout(agendaBootFailsafeTimer);
        releaseAgendaBootShell();
    },
};

const agendaModalEditBtn = document.getElementById('modalEditBtn');
const agendaModalDeleteBtn = document.getElementById('modalDeleteBtn');
const agendaModalFollowUpBtn = document.getElementById('modalFollowUpBtn');
let agendaModalWorkspaceTarget = 'active_order';
let manualAppointmentEditId = null;

function isMeetingLegendChoiceForEdit(value) {
    const choice = normalizeManualLegendChoice(value || '');
    return choice === 'website' || choice === 'business' || choice === 'voice' || choice === 'chatbot';
}

function setAgendaTopActionState(hidden, disabled) {
    [agendaModalEditBtn, agendaModalDeleteBtn].forEach((button) => {
        if (!button) return;
        button.hidden = Boolean(hidden);
        button.disabled = Boolean(disabled || hidden);
        button.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    });
}

function refreshAgendaFollowUpButtonState() {
    const apt = getActiveAppointment();
    const linkedOrderId = Number(getLinkedOrderIdForAppointment(apt) || 0) || 0;
    const isManualOther = isManualOtherAppointment(apt);

    if (agendaModalFollowUpBtn) {
        const hideFollowUp = !apt || modalWorkspaceMode || isManualOther || linkedOrderId > 0;
        agendaModalFollowUpBtn.hidden = hideFollowUp;
        agendaModalFollowUpBtn.disabled = hideFollowUp || workspaceBusy;
    }

    if (modalWorkspaceMode && agendaModalWorkspaceTarget === 'follow_up' && linkedOrderId <= 0) {
        modalPrimaryBtn.hidden = false;
        modalPrimaryBtn.textContent = 'Vervolg opslaan';
        modalPrimaryBtn.disabled = workspaceBusy;
        modalNoDealBtn.hidden = true;
        modalNoDealBtn.disabled = true;
        if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Terug';
    }
}

function openAgendaFollowUpWorkspace() {
    const apt = getActiveAppointment();
    if (!apt || workspaceBusy || getLinkedOrderIdForAppointment(apt)) return;
    agendaModalWorkspaceTarget = 'follow_up';
    applyWorkspaceMode(true);
    window.setTimeout(() => {
        if (workspaceTranscriptEl) workspaceTranscriptEl.focus();
    }, 30);
    refreshWorkspacePrimaryButtonLabel();
}

async function addOpenLeadForActiveAppointment() {
    const apt = getActiveAppointment();
    if (!apt || workspaceBusy) return null;

    const transcriptText = String(workspaceTranscriptEl && workspaceTranscriptEl.value || '').trim();
    if (transcriptText.length < 10) {
        setWorkspaceStatus('Vul eerst meetingnotities in (minimaal 10 tekens).', 'error');
        if (workspaceTranscriptEl) workspaceTranscriptEl.focus();
        return null;
    }

    const domainName = resolveWorkspaceDomainNameOrFail();
    if (domainName === null) return null;

    workspaceBusy = true;
    refreshWorkspacePrimaryButtonLabel();
    setWorkspaceStatus('Vervolg opslaan...', '');
    let shouldCloseModal = false;

    try {
        const result = await postJsonWithFallback(
            [
                `/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/post-call`,
                `/api/agenda/appointment-post-call?appointmentId=${encodeURIComponent(String(apt.id))}`,
            ],
            {
                status: 'lead_follow_up',
                transcript: transcriptText,
                prompt: String(workspaceDraftPrompt || '').trim(),
                domainName,
                referenceImages: normalizeReferenceImageList(workspaceReferenceImages),
                actor: 'premium-personeel-agenda',
            },
            { timeoutMs: 20000 }
        );
        updateAppointmentPostCallFields(result && result.appointment || {});
        setWorkspaceStatus('Vervolg staat bij openstaande leads.', 'success');
        if (window.SoftoraPersonnelTheme && typeof window.SoftoraPersonnelTheme.refreshSidebarCounts === 'function') {
            window.SoftoraPersonnelTheme.refreshSidebarCounts();
        }
        shouldCloseModal = true;
        return result;
    } catch (error) {
        setWorkspaceStatus(`Vervolg opslaan mislukt: ${String(error && error.message || 'onbekende fout')}`, 'error');
        return null;
    } finally {
        workspaceBusy = false;
        refreshWorkspacePrimaryButtonLabel();
        if (shouldCloseModal) {
            applyWorkspaceMode(false);
            closeModal();
        }
    }
}

function resetManualAppointmentModalChrome() {
    const title = document.getElementById('manualAppointmentTitle');
    if (title) title.textContent = 'Afspraak toevoegen';
    if (manualAppointmentSubmitBtn) {
        manualAppointmentSubmitBtn.textContent = manualAppointmentStep === 'details' ? 'Toevoegen' : 'Volgende';
    }
}

function openManualAppointmentEditModal(apt) {
    if (!apt || !manualAppointmentOverlay || manualAppointmentSaving) return;
    const appointmentId = Number(apt.id || 0);
    if (!Number.isFinite(appointmentId) || appointmentId <= 0) return;

    manualAppointmentEditId = appointmentId;
    manualAppointmentSelectedDate = normalizeManualAgendaDate(apt.date || '');
    const title = document.getElementById('manualAppointmentTitle');
    if (title) title.textContent = 'Afspraak wijzigen';
    if (manualAppointmentDateLine) {
        manualAppointmentDateLine.textContent = formatAgendaDateLongNl(manualAppointmentSelectedDate);
    }

    const legendChoice = normalizeManualLegendChoice(apt.manualLegendChoice || apt.legendChoice || '');
    const isMeeting = isMeetingLegendChoiceForEdit(legendChoice);
    manualAppointmentKind = isMeeting ? 'meeting' : 'overig';
    manualAppointmentMeetingType = isMeeting ? legendChoice : '';
    manualAppointmentWho = isMeeting
        ? String(apt.manualLeadOwnerKey || apt.leadOwnerKey || '').trim().toLowerCase()
        : String(apt.manualPlannerWho || apt.manualWho || 'both').trim().toLowerCase();
    if (isMeeting && manualAppointmentWho !== 'serve' && manualAppointmentWho !== 'martijn') {
        manualAppointmentWho = '';
    }
    if (!isMeeting && !manualAppointmentWho) manualAppointmentWho = 'both';

    if (manualAppointmentActivityEl) manualAppointmentActivityEl.value = String(apt.company || apt.title || apt.activity || '').trim();
    if (manualAppointmentTimeEl) manualAppointmentTimeEl.value = String(apt.time || apt.manualActivityTime || '').trim();
    if (manualAppointmentActivityTimeEl) manualAppointmentActivityTimeEl.value = String(apt.manualActivityTime || apt.time || '').trim();
    if (manualAppointmentLegendChoiceEl) manualAppointmentLegendChoiceEl.value = legendChoice;
    if (manualAppointmentLocationEl) {
        manualAppointmentLocationEl.value = String(apt.location || apt.appointmentLocation || '').trim();
    }
    if (manualAppointmentNotesEl) manualAppointmentNotesEl.value = String(apt.manualNotes || '').trim();

    setManualAppointmentStep('details');
    if (manualAppointmentSubmitBtn) manualAppointmentSubmitBtn.textContent = 'Opslaan';
    setManualAppointmentStatus('');
    manualAppointmentOverlay.classList.add('show');
    manualAppointmentOverlay.setAttribute('aria-hidden', 'false');
    focusManualAppointmentStep();
}

async function submitManualAppointmentEdit() {
    const editId = Number(manualAppointmentEditId || 0);
    if (!editId || manualAppointmentSaving) return;

    const timeVal = manualAppointmentTimeEl ? String(manualAppointmentTimeEl.value || '').trim() : '';
    const legendChoice = getManualAppointmentLegendChoice();
    const activity = manualAppointmentActivityEl ? String(manualAppointmentActivityEl.value || '').trim() : '';
    const location = manualAppointmentLocationEl ? String(manualAppointmentLocationEl.value || '').trim() : '';
    const notes = manualAppointmentNotesEl ? String(manualAppointmentNotesEl.value || '').trim() : '';
    const isMeeting = manualAppointmentKind === 'meeting';
    const who = isMeeting ? 'both' : String(manualAppointmentWho || '').trim();
    const leadOwnerKey = isMeeting && (manualAppointmentWho === 'serve' || manualAppointmentWho === 'martijn') ? manualAppointmentWho : '';

    if (!manualAppointmentSelectedDate) {
        setManualAppointmentStatus('Afspraakdatum ontbreekt.', 'error');
        return;
    }
    if (manualAppointmentKind !== 'meeting' && manualAppointmentKind !== 'overig') {
        setManualAppointmentStatus('Kies eerst wat je wilt wijzigen.', 'error');
        return;
    }
    if (!legendChoice) {
        setManualAppointmentStatus('Kies welke meeting je wilt inplannen.', 'error');
        return;
    }
    if (isMeeting && !leadOwnerKey) {
        setManualAppointmentStatus('Kies wie deze lead heeft geregeld.', 'error');
        return;
    }
    if (!isMeeting && who !== 'serve' && who !== 'martijn' && who !== 'both') {
        setManualAppointmentStatus('Kies voor wie deze afspraak is.', 'error');
        return;
    }
    if (!activity) {
        setManualAppointmentStatus('Vul een titel in.', 'error');
        return;
    }
    if (!timeVal || parseManualTimeToMinutes(timeVal) === null) {
        setManualAppointmentStatus('Vul een geldig tijdstip in.', 'error');
        return;
    }
    if (!location) {
        setManualAppointmentStatus('Vul een locatie in.', 'error');
        return;
    }

    manualAppointmentSaving = true;
    if (manualAppointmentSubmitBtn) manualAppointmentSubmitBtn.disabled = true;
    setManualAppointmentStatus('Opslaan...', '');

    try {
        const result = await postJsonWithFallback(
            `/api/agenda/appointments/${encodeURIComponent(String(editId))}/manual`,
            {
                date: manualAppointmentSelectedDate,
                who,
                title: activity,
                time: timeVal,
                activityTime: timeVal,
                legendChoice,
                appointmentKind: manualAppointmentKind,
                manualLeadOwner: leadOwnerKey,
                leadOwnerKey,
                activity,
                location,
                notes,
                actor: 'premium-personeel-agenda',
            },
            { timeoutMs: 12000 }
        );
        const updated = result && result.appointment;
        if (updated && mergeServerAppointments([updated])) {
            renderCalendar();
        }
        await loadServerAppointments({ fresh: true, timeoutMs: 8000 });
        renderCalendar();
        closeManualAppointmentModal(true);
        if (modalElement && modalElement.classList.contains('show')) {
            await openAppointment(editId);
        }
    } catch (error) {
        setManualAppointmentStatus(String(error && error.message || 'Opslaan mislukt.'), 'error');
    } finally {
        manualAppointmentSaving = false;
        if (manualAppointmentSubmitBtn) manualAppointmentSubmitBtn.disabled = false;
    }
}

async function deleteActiveAgendaAppointment() {
    const apt = getActiveAppointment();
    if (!apt || workspaceBusy) return;

    const company = String(apt.company || 'deze afspraak').trim();
    const confirmed = window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === 'function'
        ? await window.SoftoraDialogs.confirm(`Weet je zeker dat je ${company} wilt verwijderen?`, {
            title: 'Afspraak verwijderen',
            confirmText: 'Verwijderen',
            cancelText: 'Annuleren',
        })
        : window.confirm(`Weet je zeker dat je ${company} wilt verwijderen?`);
    if (!confirmed) return;

    workspaceBusy = true;
    refreshWorkspacePrimaryButtonLabel();
    let deleted = false;

    try {
        await postJsonWithFallback(
            `/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/delete`,
            { actor: 'premium-personeel-agenda' },
            { timeoutMs: 12000 }
        );
        const idx = appointments.findIndex((item) => Number(item.id) === Number(apt.id));
        if (idx >= 0) appointments.splice(idx, 1);
        deleted = true;
        activeAppointmentId = null;
        renderCalendar();
        if (window.SoftoraPersonnelTheme && typeof window.SoftoraPersonnelTheme.refreshSidebarCounts === 'function') {
            window.SoftoraPersonnelTheme.refreshSidebarCounts();
        }
    } catch (error) {
        if (window.SoftoraDialogs && typeof window.SoftoraDialogs.alert === 'function') {
            await window.SoftoraDialogs.alert(
                `Verwijderen mislukt: ${String(error && error.message || 'onbekende fout')}`,
                { title: 'Agenda', confirmText: 'Sluiten' }
            );
        }
    } finally {
        workspaceBusy = false;
        refreshWorkspacePrimaryButtonLabel();
        if (deleted) closeModal();
    }
}

const baseSyncWorkspaceExitControls = syncWorkspaceExitControls;
syncWorkspaceExitControls = function syncWorkspaceExitControlsStable() {
    baseSyncWorkspaceExitControls();
    const hideFooterClose = !modalWorkspaceMode;
    const hideDismiss = shouldHideWorkspaceDismissControls();
    const locked = isWorkspaceExitLocked();
    if (modalSecondaryBtn) {
        modalSecondaryBtn.hidden = hideFooterClose || hideDismiss;
        modalSecondaryBtn.disabled = locked || hideFooterClose || hideDismiss;
    }
    setAgendaTopActionState(modalWorkspaceMode || hideDismiss || locked, locked);
};

const baseOpenManualAppointmentModal = openManualAppointmentModal;
openManualAppointmentModal = function openManualAppointmentModalStable(dateYmd) {
    manualAppointmentEditId = null;
    resetManualAppointmentModalChrome();
    return baseOpenManualAppointmentModal(dateYmd);
};

const baseCloseManualAppointmentModal = closeManualAppointmentModal;
closeManualAppointmentModal = function closeManualAppointmentModalStable(forceClose = false) {
    const result = baseCloseManualAppointmentModal(forceClose);
    if (!manualAppointmentOverlay || !manualAppointmentOverlay.classList.contains('show')) {
        manualAppointmentEditId = null;
        resetManualAppointmentModalChrome();
    }
    return result;
};

const baseSetManualAppointmentStep = setManualAppointmentStep;
setManualAppointmentStep = function setManualAppointmentStepStable(step) {
    baseSetManualAppointmentStep(step);
    if (manualAppointmentEditId && manualAppointmentSubmitBtn && manualAppointmentStep === 'details') {
        manualAppointmentSubmitBtn.textContent = 'Opslaan';
    }
};

const baseSubmitManualAppointment = submitManualAppointment;
submitManualAppointment = async function submitManualAppointmentStable() {
    if (manualAppointmentEditId) return submitManualAppointmentEdit();
    return baseSubmitManualAppointment();
};

const baseApplyWorkspaceMode = applyWorkspaceMode;
applyWorkspaceMode = function applyWorkspaceModeStable(enabled) {
    baseApplyWorkspaceMode(enabled);
    if (!enabled) agendaModalWorkspaceTarget = 'active_order';
    setModalAudioBlockHidden(modalWorkspaceMode || isManualAgendaAppointment(getActiveAppointment()));
    refreshAgendaFollowUpButtonState();
};

const baseSyncAppointmentAudio = syncAppointmentAudio;
syncAppointmentAudio = function syncAppointmentAudioStable(apt) {
    baseSyncAppointmentAudio(apt);
    const hasRecording = Boolean(String((apt && apt.recordingUrl) || '').trim());
    setModalAudioBlockHidden(modalWorkspaceMode || (isManualAgendaAppointment(apt) && !hasRecording));
};

const baseRefreshWorkspacePrimaryButtonLabel = refreshWorkspacePrimaryButtonLabel;
refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelStable() {
    baseRefreshWorkspacePrimaryButtonLabel();
    const apt = getActiveAppointment();
    if (!modalWorkspaceMode && isManualOtherAppointment(apt)) {
        const completed = isAppointmentCompleted(apt);
        modalPrimaryBtn.hidden = false;
        modalPrimaryBtn.textContent = completed ? 'Activiteit afgerond' : 'Activiteit afronden';
        modalPrimaryBtn.disabled = workspaceBusy || completed;
        modalNoDealBtn.hidden = true;
        modalNoDealBtn.disabled = true;
        if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Sluiten';
    }
    refreshAgendaFollowUpButtonState();
    syncWorkspaceExitControls();
};

const baseIsAppointmentCompleted = isAppointmentCompleted;
isAppointmentCompleted = function isAppointmentCompletedStable(apt) {
    const status = String((apt && apt.postCallStatus) || '').trim().toLowerCase();
    return baseIsAppointmentCompleted(apt) || status === 'completed' || status === 'afgerond' || hasAppointmentStartPassed(apt);
};

const baseGetCalendarAppointmentClass = getCalendarAppointmentClass;
getCalendarAppointmentClass = function getCalendarAppointmentClassStable(apt) {
    const choice = normalizeManualLegendChoice((apt && (apt.manualLegendChoice || apt.legendChoice)) || '');
    if (choice === 'manual-overig' && !isAppointmentCompleted(apt)) return 'appointment manual-overig magnetic';
    return baseGetCalendarAppointmentClass(apt);
};

const baseRenderCalendar = renderCalendar;
renderCalendar = function renderCalendarStable() {
    baseRenderCalendar();
};

const baseOpenAppointment = openAppointment;
openAppointment = async function openAppointmentStable(id) {
    await baseOpenAppointment(id);
    const apt = getActiveAppointment();
    syncManualAppointmentModalDetails(apt);
    syncAppointmentAudio(apt);
    refreshWorkspacePrimaryButtonLabel();
};

const baseHandleModalPrimaryAction = handleModalPrimaryAction;
handleModalPrimaryAction = function handleModalPrimaryActionStable() {
    const apt = getActiveAppointment();
    if (!modalWorkspaceMode && isManualOtherAppointment(apt)) {
        void markActiveManualActivityCompleted();
        return;
    }
    if (!modalWorkspaceMode) {
        agendaModalWorkspaceTarget = 'active_order';
    }
    if (modalWorkspaceMode && agendaModalWorkspaceTarget === 'follow_up') {
        void addOpenLeadForActiveAppointment();
        return;
    }
    return baseHandleModalPrimaryAction();
};

if (agendaModalEditBtn) {
    agendaModalEditBtn.addEventListener('click', () => {
        if (workspaceBusy || modalWorkspaceMode) return;
        openManualAppointmentEditModal(getActiveAppointment());
    });
}
if (agendaModalDeleteBtn) {
    agendaModalDeleteBtn.addEventListener('click', () => { void deleteActiveAgendaAppointment(); });
}
if (agendaModalFollowUpBtn) {
    agendaModalFollowUpBtn.addEventListener('click', openAgendaFollowUpWorkspace);
}
if (modalSecondaryBtn) modalSecondaryBtn.hidden = true;
ensureAgendaAudioUploadControl();
refreshAgendaFollowUpButtonState();
