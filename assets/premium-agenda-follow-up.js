(function () {
    const followUpBtn = document.getElementById('modalFollowUpBtn');
    if (!followUpBtn) return;

    let followUpWorkspaceActive = false;

    function getLinkedOrderId(apt) {
        return Number(typeof getLinkedOrderIdForAppointment === 'function' ? getLinkedOrderIdForAppointment(apt) : 0) || 0;
    }

    function shouldHideFollowUpButton() {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        const isManualOther = typeof isManualOtherAppointment === 'function' && isManualOtherAppointment(apt);
        return !apt || modalWorkspaceMode || isManualOther || getLinkedOrderId(apt) > 0;
    }

    function syncFollowUpButtonState() {
        const hideFollowUp = shouldHideFollowUpButton();
        followUpBtn.hidden = hideFollowUp;
        followUpBtn.disabled = hideFollowUp || workspaceBusy;

        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        if (followUpWorkspaceActive && modalWorkspaceMode && getLinkedOrderId(apt) <= 0) {
            modalPrimaryBtn.hidden = false;
            modalPrimaryBtn.textContent = 'Vervolg opslaan';
            modalPrimaryBtn.disabled = workspaceBusy;
            modalNoDealBtn.hidden = true;
            modalNoDealBtn.disabled = true;
            if (modalSecondaryBtn) modalSecondaryBtn.textContent = 'Terug';
        }
    }

    function openFollowUpWorkspace() {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        if (!apt || workspaceBusy || getLinkedOrderId(apt)) return;
        followUpWorkspaceActive = true;
        applyWorkspaceMode(true);
        window.setTimeout(() => {
            if (workspaceTranscriptEl) workspaceTranscriptEl.focus();
        }, 30);
        syncFollowUpButtonState();
    }

    async function saveFollowUpLeadForActiveAppointment() {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        if (!apt || workspaceBusy) return null;

        const transcriptText = String((workspaceTranscriptEl && workspaceTranscriptEl.value) || '').trim();
        if (transcriptText.length < 10) {
            setWorkspaceStatus('Vul eerst meetingnotities in (minimaal 10 tekens).', 'error');
            if (workspaceTranscriptEl) workspaceTranscriptEl.focus();
            return null;
        }

        const domainName = resolveWorkspaceDomainNameOrFail();
        if (domainName === null) return null;

        workspaceBusy = true;
        syncFollowUpButtonState();
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
            updateAppointmentPostCallFields((result && result.appointment) || {});
            setWorkspaceStatus('Vervolg staat bij openstaande leads.', 'success');
            if (window.SoftoraPersonnelTheme && typeof window.SoftoraPersonnelTheme.refreshSidebarCounts === 'function') {
                window.SoftoraPersonnelTheme.refreshSidebarCounts();
            }
            shouldCloseModal = true;
            return result;
        } catch (error) {
            setWorkspaceStatus(`Vervolg opslaan mislukt: ${String((error && error.message) || 'onbekende fout')}`, 'error');
            return null;
        } finally {
            workspaceBusy = false;
            syncFollowUpButtonState();
            if (shouldCloseModal) {
                followUpWorkspaceActive = false;
                applyWorkspaceMode(false);
                closeModal();
            }
        }
    }

    const baseApplyWorkspaceMode = applyWorkspaceMode;
    applyWorkspaceMode = function applyWorkspaceModeWithFollowUp(enabled) {
        const result = baseApplyWorkspaceMode(enabled);
        if (!enabled) followUpWorkspaceActive = false;
        syncFollowUpButtonState();
        return result;
    };

    const baseRefreshWorkspacePrimaryButtonLabel = refreshWorkspacePrimaryButtonLabel;
    refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelWithFollowUp() {
        baseRefreshWorkspacePrimaryButtonLabel();
        syncFollowUpButtonState();
    };

    const baseOpenAppointment = openAppointment;
    openAppointment = async function openAppointmentWithFollowUp(id) {
        followUpWorkspaceActive = false;
        await baseOpenAppointment(id);
        syncFollowUpButtonState();
    };

    modalPrimaryBtn.addEventListener('click', (event) => {
        if (!followUpWorkspaceActive || !modalWorkspaceMode) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveFollowUpLeadForActiveAppointment();
    }, true);
    followUpBtn.addEventListener('click', openFollowUpWorkspace);
    syncFollowUpButtonState();
})();
