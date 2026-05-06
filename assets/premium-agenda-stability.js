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
    const kindText = [apt.manualKind, apt.kind, apt.type, apt.appointmentKind, apt.source, apt.summary]
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
    const modalBadge = document.getElementById('modalBadge');
    if (modalBadge && isManualOtherAppointment(apt)) {
        modalBadge.textContent = 'Overige afspraak';
        modalBadge.className = 'modal-type-badge';
    }
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
    if (isAgendaDateBeforeToday(dateYmd)) return;
    return baseOpenManualAppointmentModal(dateYmd);
};

const baseSubmitManualAppointment = submitManualAppointment;
submitManualAppointment = async function submitManualAppointmentStable() {
    const timeVal = manualAppointmentTimeEl ? String(manualAppointmentTimeEl.value || '').trim() : '';
    if (isAgendaDateBeforeToday(manualAppointmentSelectedDate)) {
        setManualAppointmentStatus('Je kunt geen afspraak in het verleden inplannen.', 'error');
        return;
    }
    if (isManualAppointmentStartInPast(manualAppointmentSelectedDate, timeVal)) {
        setManualAppointmentStatus('Dit tijdstip is al voorbij. Kies een toekomstige datum of tijd.', 'error');
        return;
    }
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
    if (!modalWorkspaceMode && isManualOtherAppointment(apt)) {
        modalPrimaryBtn.hidden = true;
        modalPrimaryBtn.disabled = true;
        modalNoDealBtn.hidden = true;
        modalNoDealBtn.disabled = true;
        if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Sluiten';
    }
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
    document.querySelectorAll('[data-calendar-date]').forEach((cell) => {
        const date = cell.getAttribute('data-calendar-date');
        if (!isAgendaDateBeforeToday(date)) return;
        cell.classList.remove('calendar-day-selectable');
        cell.removeAttribute('data-calendar-date');
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

if (modalSecondaryBtn) modalSecondaryBtn.hidden = true;
ensureAgendaAudioUploadControl();
