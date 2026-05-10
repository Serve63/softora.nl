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
    if (choice === 'manual-overig' || choice === 'private-serve' || choice === 'private-martijn') return true;
    if (choice === 'manual-serve' || choice === 'manual-martijn' || choice === 'manual-both') return true;
    if (choice) return false;
    const kindText = [apt.manualKind, apt.kind, apt.type, apt.appointmentKind, apt.source, apt.summary]
        .map((value) => String(value || '').trim().toLowerCase())
        .join(' ');
    return /\b(overig|other|manual-overig)\b/.test(kindText);
}

function isManualBusinessAppointment(apt) {
    if (!apt || typeof apt !== 'object') return false;
    if (!isManualAgendaAppointment(apt)) return false;
    const kind = String(apt.appointmentKind || apt.manualAppointmentKind || apt.manualBusinessType || apt.manualKind || apt.kind || apt.type || '').trim().toLowerCase();
    return kind === 'appointment' || kind === 'afspraak' || kind === 'business-appointment' || kind === 'zakelijk-afspraak';
}

function canCompleteAppointmentManually(apt) {
    if (!apt || typeof apt !== 'object') return false;
    const kind = String(apt.appointmentKind || apt.manualAppointmentKind || apt.manualKind || apt.kind || apt.type || '').trim().toLowerCase();
    if (kind === 'meeting') return false;
    if (kind === 'appointment' || kind === 'afspraak' || kind === 'business-appointment' || kind === 'zakelijk-afspraak') return true;
    if (kind === 'overig' || kind === 'other' || kind === 'prive' || kind === 'privé' || kind === 'private') return true;
    return isManualOtherAppointment(apt);
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
    const modalBadge = document.getElementById('modalBadge');
    if (modalBadge && isManualBusinessAppointment(apt)) {
        modalBadge.textContent = 'Klantenafspraak';
        modalBadge.className = 'modal-type-badge';
    } else if (modalBadge && isManualOtherAppointment(apt)) {
        modalBadge.textContent = 'Privé-afspraak';
        modalBadge.className = 'modal-type-badge';
    }
    const contactEl = document.getElementById('modalContact');
    if (contactEl) {
        const contact = String((apt && apt.contact) || '').trim();
        const phone = String((apt && apt.phone) || '').trim();
        const parts = [contact, phone].filter((part) => part && part !== '-' && part !== '—');
        if (isManual) contactEl.textContent = parts.join('  ·  ');
        contactEl.hidden = isManual && !parts.length;
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
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        const context = [
            apt && apt.title ? `Titel: ${apt.title}` : '',
            apt && apt.company ? `Bedrijf: ${apt.company}` : '',
            apt && apt.service ? `Service: ${apt.service}` : '',
            apt && apt.summary ? `Bestaande afspraakinfo: ${apt.summary}` : '',
            workspaceTranscriptEl && workspaceTranscriptEl.value
                ? `Bestaande notities: ${String(workspaceTranscriptEl.value).trim().slice(0, 1200)}`
                : '',
        ].filter(Boolean).join('\n');
        const result = await postAgendaAudioJsonWithFallback(
            ['/api/ai/notes-audio-to-text', '/api/ai-notes-audio-to-text'],
            {
                audioDataUrl,
                fileName: String(file.name || 'meeting-audio').trim().slice(0, 160),
                mimeType: getAgendaAudioUploadMimeType(file),
                language: 'nl',
                context,
                appointmentId: activeAppointmentId,
            },
            { timeoutMs: 130000 }
        );

        const extractedNotes = String(result.notes || result.summary || result.transcript || result.text || '').trim();
        if (!extractedNotes) {
            throw new Error('Geen notities gevonden in het audiobestand.');
        }

        const currentNotes = String(workspaceTranscriptEl.value || '').trim();
        const audioLabel = String(file.name || '').trim()
            ? `Meetingnotities uit audio (${String(file.name).trim()}):`
            : 'Meetingnotities uit audio:';
        workspaceTranscriptEl.value = currentNotes
            ? `${currentNotes}\n\n${audioLabel}\n${extractedNotes}`
            : `${audioLabel}\n${extractedNotes}`;

        const generatedPrompt = String(result.prompt || '').trim();
        if (generatedPrompt) {
            workspaceDraftPrompt = generatedPrompt;
        }

        setVoiceStatus('Audio verwerkt. Samenvatting toegevoegd.', 'success');
        setWorkspaceStatus('Meetingnotities uit audio toegevoegd.', 'success');
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

function syncCompleteActivityButtonVisibility() {
    const apt = getActiveAppointment();
    if (!modalCompleteActivityBtn) return;
    const shouldShow = Boolean(apt) && !modalWorkspaceMode && canCompleteAppointmentManually(apt) && !isAppointmentCompleted(apt);
    modalCompleteActivityBtn.hidden = !shouldShow;
    modalCompleteActivityBtn.disabled = workspaceBusy || !shouldShow;
}

async function markActiveAppointmentCompletedByStaff() {
    const apt = getActiveAppointment();
    if (!apt || workspaceBusy || !canCompleteAppointmentManually(apt) || isAppointmentCompleted(apt)) return;
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
        closeModal();
    } catch (_) {
        updateAppointmentPostCallFields({ ...apt, postCallStatus: 'completed' });
        closeModal();
    } finally {
        workspaceBusy = false;
        refreshWorkspacePrimaryButtonLabel();
    }
}

async function markActiveManualActivityCompleted() {
    return markActiveAppointmentCompletedByStaff();
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

const baseSyncWorkspaceExitControls = syncWorkspaceExitControls;
syncWorkspaceExitControls = function syncWorkspaceExitControlsStable() {
    baseSyncWorkspaceExitControls();
    if (!modalSecondaryBtn) return;
    const hideFooterClose = !modalWorkspaceMode;
    const hideDismiss = shouldHideWorkspaceDismissControls();
    const locked = isWorkspaceExitLocked();
    modalSecondaryBtn.hidden = hideFooterClose || hideDismiss;
    modalSecondaryBtn.disabled = locked || hideFooterClose || hideDismiss;
};

const baseOpenManualAppointmentModal = openManualAppointmentModal;
openManualAppointmentModal = function openManualAppointmentModalStable(dateYmd) {
    return baseOpenManualAppointmentModal(dateYmd);
};

const baseSubmitManualAppointment = submitManualAppointment;
submitManualAppointment = async function submitManualAppointmentStable() {
    return baseSubmitManualAppointment();
};

const baseApplyWorkspaceMode = applyWorkspaceMode;
applyWorkspaceMode = function applyWorkspaceModeStable(enabled) {
    baseApplyWorkspaceMode(enabled);
    setModalAudioBlockHidden(modalWorkspaceMode || isManualAgendaAppointment(getActiveAppointment()));
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
    if (!modalWorkspaceMode && isAppointmentCompleted(apt) && !getLinkedOrderIdForAppointment(apt)) {
        modalPrimaryBtn.hidden = true;
        modalPrimaryBtn.disabled = true;
        modalNoDealBtn.hidden = true;
        modalNoDealBtn.disabled = true;
        if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Sluiten';
    }
    if (!modalWorkspaceMode && isManualOtherAppointment(apt)) {
        modalPrimaryBtn.hidden = true;
        modalPrimaryBtn.disabled = true;
        modalNoDealBtn.hidden = true;
        modalNoDealBtn.disabled = true;
        if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Sluiten';
    }
    syncCompleteActivityButtonVisibility();
    syncWorkspaceExitControls();
};

const baseIsAppointmentCompleted = isAppointmentCompleted;
isAppointmentCompleted = function isAppointmentCompletedStable(apt) {
    const status = String((apt && apt.postCallStatus) || '').trim().toLowerCase();
    return baseIsAppointmentCompleted(apt) || status === 'completed' || status === 'afgerond';
};

const baseGetCalendarAppointmentClass = getCalendarAppointmentClass;
getCalendarAppointmentClass = function getCalendarAppointmentClassStable(apt) {
    const choice = normalizeManualLegendChoice((apt && (apt.manualLegendChoice || apt.legendChoice)) || '');
    if (choice === 'private-serve' && !isAppointmentCompleted(apt)) return 'appointment private-serve magnetic';
    if (choice === 'private-martijn' && !isAppointmentCompleted(apt)) return 'appointment private-martijn magnetic';
    if (choice === 'manual-overig' && !isAppointmentCompleted(apt)) {
        const who = String((apt && (apt.manualPlannerWho || apt.manualWho)) || '').trim().toLowerCase();
        if (who === 'martijn') return 'appointment private-martijn magnetic';
        return 'appointment private-serve magnetic';
    }
    return baseGetCalendarAppointmentClass(apt);
};

const baseRenderCalendar = renderCalendar;
renderCalendar = function renderCalendarStable() {
    baseRenderCalendar();
    document.querySelectorAll('[data-calendar-date]').forEach((cell) => {
        cell.classList.add('calendar-day-selectable');
    });
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
        return;
    }
    return baseHandleModalPrimaryAction();
};

const baseMarkActiveAppointmentNoDeal = markActiveAppointmentNoDeal;
markActiveAppointmentNoDeal = function markActiveAppointmentNoDealStable() {
    if (isManualOtherAppointment(getActiveAppointment())) return undefined;
    return baseMarkActiveAppointmentNoDeal();
};

(function setupAgendaAppointmentEditDetails() {
    let editMode = false;
    let editSaving = false;
    let editPreviousButtonState = null;

    function ensureEditStyles() {
        if (document.getElementById('agendaAppointmentEditStyles')) return;
        const style = document.createElement('style');
        style.id = 'agendaAppointmentEditStyles';
        style.textContent = `
            .appointment.private-serve{background:rgba(17,24,39,.16);color:#111827;border-left:3px solid #111827}
            .appointment.private-martijn{background:rgba(244,63,94,.18);color:#9f1239;border-left:3px solid #f43f5e}
            .legend-dot.private-serve{background:#111827}.legend-dot.private-martijn{background:#f43f5e}
            .appointment-edit-form{margin-top:1rem;display:grid;gap:.85rem}.appointment-edit-form[hidden]{display:none!important}
            .modal-overview.appointment-editing .modal-details,.modal-overview.appointment-editing>.modal-summary-label,.modal-overview.appointment-editing>.modal-summary,.modal-overview.appointment-editing>.modal-audio-block{display:none!important}
            .appointment-edit-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}@media(max-width:640px){.appointment-edit-row{grid-template-columns:1fr}}
        `;
        document.head.appendChild(style);
    }

    function createField(label, inputHtml) {
        const wrap = document.createElement('div');
        wrap.className = 'modal-workspace-field';
        wrap.innerHTML = `<div class="modal-workspace-label">${label}</div>${inputHtml}`;
        return wrap;
    }

    function ensureEditUi() {
        ensureEditStyles();
        const overview = document.getElementById('modalOverview');
        const summary = document.getElementById('modalSummary');
        const footer = modalPrimaryBtn ? modalPrimaryBtn.closest('.modal-footer') : null;
        if (footer && !document.getElementById('modalEditAppointmentBtn')) {
            const button = document.createElement('button');
            button.className = 'modal-btn secondary magnetic';
            button.id = 'modalEditAppointmentBtn';
            button.type = 'button';
            button.hidden = true;
            button.textContent = 'Gegevens wijzigen';
            footer.insertBefore(button, modalPrimaryBtn);
        }
        if (!overview || !summary || document.getElementById('appointmentEditForm')) return;

        const form = document.createElement('div');
        form.className = 'appointment-edit-form';
        form.id = 'appointmentEditForm';
        form.hidden = true;
        form.innerHTML = '<div class="modal-summary-label">Gegevens wijzigen</div><div class="modal-workspace-grid" id="appointmentEditGrid"></div><div class="modal-workspace-status" id="appointmentEditStatus"></div><div class="modal-footer" style="padding:0;border-top:0;background:transparent;"><button class="modal-btn secondary magnetic" id="appointmentEditCancelBtn" type="button">Annuleren</button><button class="modal-btn primary magnetic" id="appointmentEditSaveBtn" type="button">Opslaan</button></div>';
        summary.insertAdjacentElement('afterend', form);

        const grid = document.getElementById('appointmentEditGrid');
        const topRow = document.createElement('div');
        topRow.className = 'appointment-edit-row';
        topRow.appendChild(createField('Legenda', '<select class="modal-workspace-input" id="appointmentEditLegend"><option value="website">Website Meeting</option><option value="business">Bedrijfssoftware Meeting</option><option value="voice">Voicesoftware Meeting</option><option value="chatbot">Chatbot Meeting</option><option value="manual-serve">Activiteit Servé</option><option value="manual-martijn">Activiteit Martijn</option><option value="manual-both">Activiteit allebei</option><option value="private-serve">Privé Servé</option><option value="private-martijn">Privé Martijn</option></select>'));
        const owner = createField('Lead geregeld door', '<select class="modal-workspace-input" id="appointmentEditLeadOwner"><option value="">Kies eigenaar</option><option value="serve">Servé</option><option value="martijn">Martijn</option></select>');
        owner.id = 'appointmentEditLeadOwnerField';
        owner.hidden = true;
        topRow.appendChild(owner);
        grid.appendChild(topRow);
        grid.appendChild(createField('Titel', '<input type="text" class="modal-workspace-input" id="appointmentEditTitle" maxlength="500" autocomplete="off">'));
        const dateRow = document.createElement('div');
        dateRow.className = 'appointment-edit-row';
        dateRow.appendChild(createField('Datum', '<input type="date" class="modal-workspace-input" id="appointmentEditDate" autocomplete="off">'));
        dateRow.appendChild(createField('Tijdstip', '<input type="time" class="modal-workspace-input" id="appointmentEditTime" step="300" autocomplete="off">'));
        grid.appendChild(dateRow);
        const availableAgain = createField('Weer beschikbaar vanaf (optioneel)', '<input type="time" class="modal-workspace-input" id="appointmentEditAvailableAgain" step="300" autocomplete="off">');
        availableAgain.id = 'appointmentEditAvailableAgainField';
        availableAgain.hidden = true;
        grid.appendChild(availableAgain);
        grid.appendChild(createField('Telefoonnummer (optioneel)', '<input type="tel" class="modal-workspace-input" id="appointmentEditPhone" maxlength="80" inputmode="tel" autocomplete="tel">'));
        grid.appendChild(createField('Locatie', '<input type="text" class="modal-workspace-input" id="appointmentEditLocation" maxlength="240" autocomplete="off">'));
        grid.appendChild(createField('Opmerkingen', '<textarea class="modal-workspace-input" id="appointmentEditNotes" maxlength="1000" autocomplete="off"></textarea>'));
    }

    function byId(id) {
        return document.getElementById(id);
    }

    function isMeetingLegend(value) {
        return ['website', 'business', 'voice', 'chatbot'].includes(String(value || '').trim());
    }

    function inferEditableLegend(apt) {
        const choice = normalizeManualLegendChoice((apt && (apt.manualLegendChoice || apt.legendChoice)) || '');
        if (choice === 'manual-overig') {
            return String((apt && (apt.manualPlannerWho || apt.manualWho)) || '').toLowerCase() === 'martijn' ? 'private-martijn' : 'private-serve';
        }
        return choice || 'manual-serve';
    }

    function extractManualNotes(apt) {
        const direct = String((apt && apt.manualNotes) || '').trim();
        if (direct) return direct;
        const found = String((apt && apt.summary) || '').split(/\n+/).find((line) => /^Opmerkingen:/i.test(String(line || '').trim()));
        return found ? found.replace(/^Opmerkingen:\s*/i, '').trim() : '';
    }

    function setEditStatus(message, variant = '') {
        const status = byId('appointmentEditStatus');
        if (!status) return;
        status.textContent = message || '';
        status.className = `modal-workspace-status${variant ? ` ${variant}` : ''}`;
    }

    function syncLeadOwnerVisibility() {
        const field = byId('appointmentEditLeadOwnerField');
        const legend = byId('appointmentEditLegend');
        if (field && legend) field.hidden = !isMeetingLegend(legend.value);
    }

    function syncAvailableAgainVisibility() {
        const field = byId('appointmentEditAvailableAgainField');
        const legend = byId('appointmentEditLegend');
        if (!field || !legend) return;
        const choice = normalizeManualLegendChoice(legend.value);
        field.hidden = choice !== 'private-serve' && choice !== 'private-martijn';
    }

    function canEditAppointment(apt) {
        return Boolean(apt) && isManualAgendaAppointment(apt);
    }

    function populateEditForm(apt) {
        byId('appointmentEditLegend').value = inferEditableLegend(apt);
        byId('appointmentEditTitle').value = String((apt && apt.company) || '').trim();
        byId('appointmentEditDate').value = normalizeAgendaDateYmd(apt && apt.date);
        byId('appointmentEditTime').value = String((apt && (apt.time || apt.manualActivityTime)) || '').trim();
        byId('appointmentEditAvailableAgain').value = String((apt && (apt.manualAvailableAgain || apt.availableAgain)) || '').trim();
        byId('appointmentEditPhone').value = String((apt && (apt.manualPhone || apt.phone || apt.contactPhone)) || '').trim();
        byId('appointmentEditLocation').value = resolveAppointmentLocationDisplay(apt);
        byId('appointmentEditNotes').value = extractManualNotes(apt);
        byId('appointmentEditLeadOwner').value = String((apt && (apt.manualLeadOwnerKey || apt.leadOwnerKey)) || '').trim();
        syncLeadOwnerVisibility();
        syncAvailableAgainVisibility();
        setEditStatus('');
    }

    function syncEditButtonVisibility() {
        const button = byId('modalEditAppointmentBtn');
        if (!button) return;
        const apt = getActiveAppointment();
        const show = !editMode && !modalWorkspaceMode && canEditAppointment(apt);
        button.hidden = !show;
        button.disabled = editSaving || workspaceBusy || !show;
        if (editMode) {
            modalPrimaryBtn.hidden = true;
            modalNoDealBtn.hidden = true;
            modalCompleteActivityBtn.hidden = true;
            if (modalSecondaryBtn) modalSecondaryBtn.hidden = true;
        }
    }

    function rememberButtonState() {
        editPreviousButtonState = {
            primary: modalPrimaryBtn.hidden,
            noDeal: modalNoDealBtn.hidden,
            complete: modalCompleteActivityBtn.hidden,
            secondary: modalSecondaryBtn ? modalSecondaryBtn.hidden : true,
        };
    }

    function restoreButtonState() {
        if (!editPreviousButtonState) return;
        modalPrimaryBtn.hidden = editPreviousButtonState.primary;
        modalNoDealBtn.hidden = editPreviousButtonState.noDeal;
        modalCompleteActivityBtn.hidden = editPreviousButtonState.complete;
        if (modalSecondaryBtn) modalSecondaryBtn.hidden = editPreviousButtonState.secondary;
        editPreviousButtonState = null;
    }

    function setEditMode(enabled) {
        if (Boolean(enabled) === editMode) return;
        if (enabled) rememberButtonState();
        if (!enabled) restoreButtonState();
        editMode = Boolean(enabled);
        const overview = byId('modalOverview');
        const form = byId('appointmentEditForm');
        if (overview) overview.classList.toggle('appointment-editing', editMode);
        if (form) form.hidden = !editMode;
        if (!editMode) setEditStatus('');
        syncEditButtonVisibility();
    }

    function payloadFromEditForm() {
        const legendChoice = normalizeManualLegendChoice(byId('appointmentEditLegend').value);
        let who = 'serve';
        let appointmentKind = 'appointment';
        let manualLeadOwner = '';
        if (isMeetingLegend(legendChoice)) {
            who = 'both';
            appointmentKind = 'meeting';
            manualLeadOwner = String(byId('appointmentEditLeadOwner').value || '').trim();
        } else if (legendChoice === 'manual-martijn' || legendChoice === 'private-martijn') {
            who = 'martijn';
            appointmentKind = legendChoice === 'private-martijn' ? 'overig' : 'appointment';
        } else if (legendChoice === 'manual-both') {
            who = 'both';
        } else if (legendChoice === 'private-serve') {
            appointmentKind = 'overig';
        }
        const availableAgain =
            legendChoice === 'private-serve' || legendChoice === 'private-martijn'
                ? String(byId('appointmentEditAvailableAgain').value || '').trim()
                : '';
        return {
            date: String(byId('appointmentEditDate').value || '').trim(),
            time: String(byId('appointmentEditTime').value || '').trim(),
            activityTime: String(byId('appointmentEditTime').value || '').trim(),
            availableAgain,
            title: String(byId('appointmentEditTitle').value || '').trim(),
            activity: String(byId('appointmentEditTitle').value || '').trim(),
            phone: String(byId('appointmentEditPhone').value || '').trim(),
            manualPhone: String(byId('appointmentEditPhone').value || '').trim(),
            location: String(byId('appointmentEditLocation').value || '').trim(),
            notes: String(byId('appointmentEditNotes').value || '').trim(),
            legendChoice,
            appointmentKind,
            manualLeadOwner,
            leadOwnerKey: manualLeadOwner,
            who,
            actor: 'premium-personeel-agenda',
        };
    }

    async function saveEdit() {
        const apt = getActiveAppointment();
        if (!apt || editSaving || workspaceBusy) return;
        const payload = payloadFromEditForm();
        const error = !payload.title ? 'Vul een titel in.' : !payload.date ? 'Vul een datum in.' : !payload.time ? 'Vul een tijdstip in.' : !payload.location ? 'Vul een locatie in.' : isMeetingLegend(payload.legendChoice) && !payload.manualLeadOwner ? 'Kies wie deze lead heeft geregeld.' : '';
        if (error) {
            setEditStatus(error, 'error');
            return;
        }
        editSaving = true;
        byId('appointmentEditSaveBtn').disabled = true;
        byId('appointmentEditCancelBtn').disabled = true;
        setEditStatus('Opslaan...', '');
        try {
            const result = await postJsonWithFallback(`/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/manual`, payload, { timeoutMs: 20000 });
            if (result && result.appointment) mergeServerAppointments([result.appointment]);
            await loadServerAppointments({ fresh: true, timeoutMs: 8000 });
            renderCalendar();
            setEditMode(false);
            await openAppointment(Number((result && result.appointment && result.appointment.id) || apt.id));
        } catch (errorSave) {
            setEditStatus(String((errorSave && errorSave.message) || 'Wijzigen mislukt.'), 'error');
        } finally {
            editSaving = false;
            byId('appointmentEditSaveBtn').disabled = false;
            byId('appointmentEditCancelBtn').disabled = false;
            syncEditButtonVisibility();
        }
    }

    ensureEditUi();
    const baseRefreshForEdit = refreshWorkspacePrimaryButtonLabel;
    refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelWithEdit() {
        baseRefreshForEdit();
        syncEditButtonVisibility();
    };
    const baseApplyForEdit = applyWorkspaceMode;
    applyWorkspaceMode = function applyWorkspaceModeWithEdit(enabled) {
        if (enabled) setEditMode(false);
        baseApplyForEdit(enabled);
        syncEditButtonVisibility();
    };
    const baseOpenForEdit = openAppointment;
    openAppointment = async function openAppointmentWithEdit(id) {
        await baseOpenForEdit(id);
        setEditMode(false);
        syncEditButtonVisibility();
    };
    const baseCloseForEdit = closeModal;
    closeModal = function closeModalWithEdit() {
        setEditMode(false);
        return baseCloseForEdit();
    };
    byId('modalEditAppointmentBtn')?.addEventListener('click', () => {
        const apt = getActiveAppointment();
        if (!canEditAppointment(apt)) return;
        populateEditForm(apt);
        setEditMode(true);
    });
    byId('appointmentEditCancelBtn')?.addEventListener('click', () => setEditMode(false));
    byId('appointmentEditSaveBtn')?.addEventListener('click', () => { void saveEdit(); });
    byId('appointmentEditLegend')?.addEventListener('change', syncLeadOwnerVisibility);
    byId('appointmentEditLegend')?.addEventListener('change', syncAvailableAgainVisibility);
    syncEditButtonVisibility();
})();

if (modalSecondaryBtn) modalSecondaryBtn.hidden = true;
if (modalCompleteActivityBtn) modalCompleteActivityBtn.addEventListener('click', () => { void markActiveAppointmentCompletedByStaff(); });
ensureAgendaAudioUploadControl();
