var modalFollowUpBtn = null;

(function () {
    'use strict';

    const STYLE_ID = 'agendaFollowUpLeadStyles';

    function getLinkedFollowUpLeadIdForAppointment(apt) {
        const followUpId = Number(apt?.leadFollowUpAppointmentId || 0);
        return Number.isFinite(followUpId) && followUpId > 0 ? followUpId : null;
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.modal-btn.followup{background:rgba(166,45,101,.08);color:var(--accent);border:1px solid rgba(166,45,101,.32)}
.modal-btn.followup:hover{color:#fff;background:rgba(166,45,101,.88);border-color:rgba(166,45,101,.95);box-shadow:0 0 24px rgba(166,45,101,.18)}
`;
        document.head.appendChild(style);
    }

    function ensureFollowUpButton() {
        const footer = typeof modalPrimaryBtn !== 'undefined' && modalPrimaryBtn
            ? modalPrimaryBtn.closest('.modal-footer')
            : null;
        if (!footer) return null;

        let button = document.getElementById('modalFollowUpBtn');
        if (!button) {
            button = document.createElement('button');
            button.className = 'modal-btn followup magnetic';
            button.id = 'modalFollowUpBtn';
            button.type = 'button';
            button.textContent = 'Vervolg';
            footer.insertBefore(button, typeof modalNoDealBtn !== 'undefined' ? modalNoDealBtn : null);
        }

        modalFollowUpBtn = button;
        return button;
    }

    function patchNormalizeServerAppointment() {
        if (typeof normalizeServerAppointment !== 'function') return;
        const baseNormalizeServerAppointment = normalizeServerAppointment;
        normalizeServerAppointment = function normalizeServerAppointmentWithFollowUp(item) {
            const normalized = baseNormalizeServerAppointment(item);
            if (!normalized || !item || typeof item !== 'object') return normalized;
            return {
                ...normalized,
                leadFollowUpAppointmentId: Number(item.leadFollowUpAppointmentId || 0) || null,
                leadFollowUpAddedAt: String(item.leadFollowUpAddedAt || ''),
                leadFollowUpCallId: String(item.leadFollowUpCallId || ''),
            };
        };
    }

    function patchFillWorkspaceFromAppointment() {
        if (typeof fillWorkspaceFromAppointment !== 'function') return;
        const baseFillWorkspaceFromAppointment = fillWorkspaceFromAppointment;
        fillWorkspaceFromAppointment = function fillWorkspaceFromAppointmentWithFollowUp(apt) {
            baseFillWorkspaceFromAppointment(apt);
            if (!apt) return;
            if (typeof getLinkedOrderIdForAppointment === 'function' && getLinkedOrderIdForAppointment(apt)) return;
            if (getLinkedFollowUpLeadIdForAppointment(apt) && typeof setWorkspaceStatus === 'function') {
                setWorkspaceStatus('Vervolgdossier staat klaar bij openstaande leads.', 'success');
            }
        };
    }

    function patchUpdateAppointmentPostCallFields() {
        if (typeof updateAppointmentPostCallFields !== 'function') return;
        const baseUpdateAppointmentPostCallFields = updateAppointmentPostCallFields;
        updateAppointmentPostCallFields = function updateAppointmentPostCallFieldsWithFollowUp(update) {
            baseUpdateAppointmentPostCallFields(update);
            const appointmentId = Number(update?.id || activeAppointmentId || 0);
            const idx = Array.isArray(appointments)
                ? appointments.findIndex((item) => Number(item?.id || 0) === appointmentId)
                : -1;
            if (idx < 0) return;
            appointments[idx] = {
                ...appointments[idx],
                leadFollowUpAppointmentId:
                    Number(update?.leadFollowUpAppointmentId || appointments[idx]?.leadFollowUpAppointmentId || 0) || null,
                leadFollowUpAddedAt: String(update?.leadFollowUpAddedAt || appointments[idx]?.leadFollowUpAddedAt || ''),
                leadFollowUpCallId: String(update?.leadFollowUpCallId || appointments[idx]?.leadFollowUpCallId || ''),
            };
            if (typeof renderCalendar === 'function') renderCalendar();
            if (typeof refreshWorkspacePrimaryButtonLabel === 'function') refreshWorkspacePrimaryButtonLabel();
        };
    }

    async function addFollowUpLeadForActiveAppointment(options = {}) {
        const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
        if (!apt) {
            if (typeof setWorkspaceStatus === 'function') setWorkspaceStatus('Afspraak niet gevonden.', 'error');
            return null;
        }
        const domainName =
            typeof resolveWorkspaceDomainNameOrFail === 'function' ? resolveWorkspaceDomainNameOrFail() : '';
        if (domainName === null) return null;
        const transcriptText = String(workspaceTranscriptEl?.value || '').trim();
        if (transcriptText.length < 10) {
            if (typeof setWorkspaceStatus === 'function') {
                setWorkspaceStatus('Vul eerst meetingnotities in (minimaal 10 tekens).', 'error');
            }
            return null;
        }
        if (typeof hasWorkspaceLinkedOrder === 'function' && hasWorkspaceLinkedOrder()) {
            if (typeof setWorkspaceStatus === 'function') {
                setWorkspaceStatus('Deze afspraak is al gekoppeld aan een actieve opdracht.', 'success');
            }
            return null;
        }
        if (workspaceBusy) return null;

        workspaceBusy = true;
        if (typeof refreshWorkspacePrimaryButtonLabel === 'function') refreshWorkspacePrimaryButtonLabel();
        if (typeof setWorkspaceStatus === 'function') setWorkspaceStatus('', '');
        if (typeof setWorkspaceLoading === 'function') setWorkspaceLoading(true);

        try {
            let promptText = String(workspaceDraftPrompt || '').trim();
            const shouldGeneratePrompt = options?.autoGeneratePrompt !== false;

            if (!promptText && shouldGeneratePrompt) {
                const promptResult = await postJsonWithFallback(
                    ['/api/ai-transcript-to-prompt', '/api/ai/transcript-to-prompt'],
                    {
                        transcript: transcriptText,
                        language: 'nl',
                        appointmentId: activeAppointmentId,
                    },
                    { timeoutMs: 50000 }
                );
                promptText = String(promptResult?.prompt || '').trim();
                if (promptText) workspaceDraftPrompt = promptText;
            }

            if (!promptText) {
                if (typeof setWorkspaceLoading === 'function') setWorkspaceLoading(false);
                if (typeof setWorkspaceStatus === 'function') {
                    setWorkspaceStatus('Prompt kon niet worden gemaakt. Vul handmatig een prompt in of probeer opnieuw.', 'error');
                }
                return null;
            }

            const payload = {
                status: 'bezig',
                transcript: transcriptText,
                prompt: promptText,
                domainName,
                referenceImages:
                    typeof normalizeReferenceImageList === 'function'
                        ? normalizeReferenceImageList(workspaceReferenceImages)
                        : [],
                actor: 'premium-personeel-agenda',
            };
            const result = await postJsonWithFallback(
                [
                    `/api/agenda/appointments/${encodeURIComponent(String(apt.id))}/add-follow-up-lead`,
                    `/api/agenda/add-follow-up-lead?appointmentId=${encodeURIComponent(String(apt.id))}`,
                ],
                payload,
                { timeoutMs: 30000 }
            );
            if (typeof updateAppointmentPostCallFields === 'function') {
                updateAppointmentPostCallFields(result?.appointment || {});
            }
            if (typeof setWorkspaceLoading === 'function') setWorkspaceLoading(false);
            if (typeof setWorkspaceStatus === 'function') {
                setWorkspaceStatus(
                    result?.alreadyExisted
                        ? 'Vervolgdossier bijgewerkt. We openen nu openstaande leads.'
                        : 'Vervolgdossier toegevoegd. We openen nu openstaande leads.',
                    'success'
                );
            }
            if (options?.redirectToLeads !== false) {
                window.setTimeout(() => {
                    window.location.assign('/premium-leads');
                }, 140);
            }
            return result;
        } catch (error) {
            if (typeof setWorkspaceLoading === 'function') setWorkspaceLoading(false);
            if (typeof setWorkspaceStatus === 'function') {
                setWorkspaceStatus(`Vervolg aanmaken mislukt: ${String(error?.message || 'onbekende fout')}`, 'error');
            }
            return null;
        } finally {
            workspaceBusy = false;
            if (typeof refreshWorkspacePrimaryButtonLabel === 'function') refreshWorkspacePrimaryButtonLabel();
        }
    }

    function patchRefreshWorkspacePrimaryButtonLabel() {
        if (typeof refreshWorkspacePrimaryButtonLabel !== 'function') return;
        const baseRefreshWorkspacePrimaryButtonLabel = refreshWorkspacePrimaryButtonLabel;
        refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelWithFollowUp() {
            const button = ensureFollowUpButton();
            baseRefreshWorkspacePrimaryButtonLabel();
            if (!button) return;

            const apt = typeof getActiveAppointment === 'function' ? getActiveAppointment() : null;
            const hasLinkedOrder =
                typeof getLinkedOrderIdForAppointment === 'function'
                    ? Boolean(getLinkedOrderIdForAppointment(apt))
                    : false;
            const isManualOther =
                typeof isManualOtherAppointment === 'function' ? isManualOtherAppointment(apt) : false;
            const completed =
                typeof isAppointmentCompleted === 'function' ? isAppointmentCompleted(apt) : false;
            const shouldShow = Boolean(apt) && !modalWorkspaceMode && !hasLinkedOrder && !isManualOther && !completed;

            button.hidden = !shouldShow;
            button.disabled = workspaceBusy || !shouldShow;
        };
    }

    function bindButton() {
        const button = ensureFollowUpButton();
        if (!button || button.dataset.followUpBound === '1') return;
        button.dataset.followUpBound = '1';
        button.addEventListener('click', () => {
            if (typeof isWorkspaceExitLocked === 'function' && isWorkspaceExitLocked()) return;
            if (modalWorkspaceMode) return;
            void addFollowUpLeadForActiveAppointment({ autoGeneratePrompt: true, redirectToLeads: true });
        });
    }

    ensureStyles();
    patchNormalizeServerAppointment();
    patchFillWorkspaceFromAppointment();
    patchUpdateAppointmentPostCallFields();
    patchRefreshWorkspacePrimaryButtonLabel();
    bindButton();
    if (typeof refreshWorkspacePrimaryButtonLabel === 'function') refreshWorkspacePrimaryButtonLabel();
})();
