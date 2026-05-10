(function setupAgendaDeleteButton() {
    const deleteBtn = document.getElementById('modalDeleteAppointmentBtn');
    if (!deleteBtn) return;

    function ensureDeleteButtonStyles() {
        if (document.getElementById('agendaDeleteButtonStyles')) return;
        const style = document.createElement('style');
        style.id = 'agendaDeleteButtonStyles';
        style.textContent = `
            #modalDeleteAppointmentBtn[hidden]{display:none!important}
            @media (max-width: 720px) {
                #modal .modal-footer { flex-wrap: wrap; }
                #modalPrimaryBtn,
                #modalCompleteActivityBtn,
                #modalNoDealBtn,
                #modalDeleteAppointmentBtn,
                #modalSecondaryBtn { flex: 1 1 calc(50% - 0.28rem); }
            }
        `;
        document.head.appendChild(style);
    }

    function syncDeleteButtonState() {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        const canDelete = Boolean(apt && Number(apt.id || 0) > 0) && !modalWorkspaceMode;
        deleteBtn.hidden = !canDelete;
        deleteBtn.disabled = !canDelete || workspaceBusy;
    }

    async function confirmDeleteAppointment(apt) {
        const company = String(apt && (apt.company || apt.title || apt.activity) || 'deze afspraak').trim() || 'deze afspraak';
        const linkedOrderId = typeof getLinkedOrderIdForAppointment === 'function'
            ? Number(getLinkedOrderIdForAppointment(apt) || 0)
            : 0;
        const message = linkedOrderId > 0
            ? `Weet je zeker dat je ${company} uit de agenda wilt verwijderen? Het gekoppelde dossier blijft gewoon bestaan.`
            : `Weet je zeker dat je ${company} uit de agenda wilt verwijderen?`;
        if (window.SoftoraDialogs && typeof window.SoftoraDialogs.confirm === 'function') {
            return await window.SoftoraDialogs.confirm(message, {
                title: 'Afspraak verwijderen',
                confirmText: 'Ja, verwijderen',
                cancelText: 'Annuleren',
            });
        }
        return window.confirm(message);
    }

    async function deleteActiveAppointment() {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        if (!apt || workspaceBusy || modalWorkspaceMode) return;
        const confirmed = await confirmDeleteAppointment(apt);
        if (!confirmed) return;

        workspaceBusy = true;
        refreshWorkspacePrimaryButtonLabel();

        let deleted = false;
        try {
            const result = await postJsonWithFallback(
                `/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/delete`,
                { actor: 'premium-personeel-agenda' }
            );
            const deletedAppointmentId = Number(result && result.deletedAppointmentId || apt.id);
            const appointmentIndex = Array.isArray(appointments)
                ? appointments.findIndex((item) => Number(item && item.id || 0) === deletedAppointmentId)
                : -1;
            if (appointmentIndex >= 0) appointments.splice(appointmentIndex, 1);
            activeAppointmentId = null;
            deleted = true;
        } catch (error) {
            if (window.SoftoraDialogs && typeof window.SoftoraDialogs.alert === 'function') {
                await window.SoftoraDialogs.alert(
                    `Afspraak verwijderen mislukt: ${String(error && error.message || 'onbekende fout')}`,
                    { title: 'Agenda', confirmText: 'Sluiten' }
                );
            }
        } finally {
            workspaceBusy = false;
            refreshWorkspacePrimaryButtonLabel();
            if (deleted) {
                closeModal();
                renderCalendar();
            }
        }
    }

    const baseRefreshWorkspacePrimaryButtonLabel = refreshWorkspacePrimaryButtonLabel;
    refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelWithDelete() {
        baseRefreshWorkspacePrimaryButtonLabel();
        syncDeleteButtonState();
    };

    deleteBtn.addEventListener('click', () => { void deleteActiveAppointment(); });
    ensureDeleteButtonStyles();
    syncDeleteButtonState();
})();
