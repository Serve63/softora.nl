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
    const choice = normalizeManualLegendChoice(apt.manualLegendChoice || apt.legendChoice || '');
    if (choice === 'manual-overig') return true;
    if (choice) return false;
    if (!isManualAgendaAppointment(apt)) return false;
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
        const completed = isAppointmentCompleted(apt);
        modalPrimaryBtn.hidden = false;
        modalPrimaryBtn.textContent = completed ? 'Activiteit afgerond' : 'Activiteit afronden';
        modalPrimaryBtn.disabled = workspaceBusy || completed;
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
        void markActiveManualActivityCompleted();
        return;
    }
    return baseHandleModalPrimaryAction();
};

if (modalSecondaryBtn) modalSecondaryBtn.hidden = true;
