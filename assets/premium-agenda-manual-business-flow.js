function setManualAppointmentActiveChoices() {
    document.querySelectorAll('[data-manual-kind]').forEach(function (button) {
        button.classList.toggle('is-active', String(button.getAttribute('data-manual-kind') || '') === manualAppointmentKind);
    });
    document.querySelectorAll('[data-manual-business-type]').forEach(function (button) {
        button.classList.toggle('is-active', String(button.getAttribute('data-manual-business-type') || '') === manualAppointmentBusinessType);
    });
    document.querySelectorAll('[data-manual-meeting-type]').forEach(function (button) {
        button.classList.toggle('is-active', String(button.getAttribute('data-manual-meeting-type') || '') === manualAppointmentMeetingType);
    });
    document.querySelectorAll('[data-manual-who]').forEach(function (button) {
        button.classList.toggle('is-active', String(button.getAttribute('data-manual-who') || '') === manualAppointmentWho);
    });
}

function isManualAppointmentMeetingFlow() {
    return manualAppointmentKind === 'meeting' || (manualAppointmentKind === 'business' && manualAppointmentBusinessType === 'meeting');
}

function getManualAppointmentLegendChoice() {
    if (isManualAppointmentMeetingFlow()) return normalizeManualLegendChoice(manualAppointmentMeetingType);
    if (manualAppointmentKind === 'business' && manualAppointmentBusinessType === 'appointment') {
        if (manualAppointmentWho === 'martijn') return 'manual-martijn';
        if (manualAppointmentWho === 'both') return 'manual-both';
        return 'manual-serve';
    }
    if (manualAppointmentKind === 'overig') return 'manual-overig';
    return '';
}

function getManualAppointmentPhoneValue() {
    const input = document.getElementById('manualAppointmentPhone');
    return input ? String(input.value || '').trim() : '';
}

function syncManualAppointmentDetailsMode() {
    const isMeeting = isManualAppointmentMeetingFlow();
    const whoLabel = document.getElementById('manualAppointmentWhoLabel');
    const whoChoices = document.getElementById('manualAppointmentWhoChoices');
    const bothChoice = document.querySelector('[data-manual-who="both"]');
    if (whoLabel) whoLabel.textContent = isMeeting ? 'Wie heeft deze lead geregeld?' : 'Voor wie?';
    if (whoChoices) whoChoices.setAttribute('aria-label', isMeeting ? 'Wie heeft deze lead geregeld?' : 'Voor wie is deze afspraak?');
    if (bothChoice) bothChoice.hidden = isMeeting;
    if (isMeeting && manualAppointmentWho === 'both') manualAppointmentWho = '';
}

function setManualAppointmentStep(step) {
    manualAppointmentStep = step || 'kind';
    const panels = {
        kind: document.getElementById('manualAppointmentStepKind'),
        business: document.getElementById('manualAppointmentStepBusiness'),
        meeting: document.getElementById('manualAppointmentStepMeeting'),
        details: document.getElementById('manualAppointmentStepDetails'),
    };
    Object.keys(panels).forEach(function (key) {
        if (panels[key]) panels[key].hidden = key !== manualAppointmentStep;
    });
    if (manualAppointmentModal) manualAppointmentModal.setAttribute('data-manual-step', manualAppointmentStep);
    if (manualAppointmentBackBtn) manualAppointmentBackBtn.hidden = manualAppointmentStep === 'kind';
    if (manualAppointmentSubmitBtn) manualAppointmentSubmitBtn.textContent = manualAppointmentStep === 'details' ? 'Toevoegen' : 'Volgende';
    syncManualAppointmentDetailsMode();
    setManualAppointmentActiveChoices();
    setManualAppointmentStatus('');
}

function resetManualAppointmentWizard() {
    manualAppointmentKind = 'business';
    manualAppointmentBusinessType = '';
    manualAppointmentMeetingType = '';
    manualAppointmentWho = '';
    if (manualAppointmentTimeEl) manualAppointmentTimeEl.value = '';
    if (manualAppointmentActivityTimeEl) manualAppointmentActivityTimeEl.value = '';
    if (manualAppointmentLegendChoiceEl) manualAppointmentLegendChoiceEl.value = '';
    if (manualAppointmentActivityEl) manualAppointmentActivityEl.value = '';
    const phoneInput = document.getElementById('manualAppointmentPhone');
    if (phoneInput) phoneInput.value = '';
    if (manualAppointmentLocationEl) manualAppointmentLocationEl.value = '';
    if (manualAppointmentNotesEl) manualAppointmentNotesEl.value = '';
    setManualAppointmentStep('kind');
}

function focusManualAppointmentStep() {
    window.setTimeout(() => {
        const selectorByStep = {
            kind: '[data-manual-kind]',
            business: '[data-manual-business-type]',
            meeting: '[data-manual-meeting-type]',
            details: manualAppointmentWho ? '#manualAppointmentActivity' : '[data-manual-who]',
        };
        const target = document.querySelector(selectorByStep[manualAppointmentStep] || '#manualAppointmentActivity');
        if (target) target.focus();
    }, 30);
}

function goBackManualAppointmentStep() {
    if (manualAppointmentStep === 'details') {
        setManualAppointmentStep(isManualAppointmentMeetingFlow() ? 'meeting' : (manualAppointmentKind === 'business' ? 'business' : 'kind'));
        focusManualAppointmentStep();
        return;
    }
    if (manualAppointmentStep === 'meeting') {
        setManualAppointmentStep(manualAppointmentKind === 'business' ? 'business' : 'kind');
        focusManualAppointmentStep();
        return;
    }
    if (manualAppointmentStep === 'business') {
        setManualAppointmentStep('kind');
        focusManualAppointmentStep();
    }
}

function advanceManualAppointmentStep() {
    if (manualAppointmentStep === 'kind') {
        if (manualAppointmentKind !== 'business' && manualAppointmentKind !== 'meeting' && manualAppointmentKind !== 'overig') {
            setManualAppointmentStatus('Kies eerst Zakelijk of Privé.', 'error');
            return;
        }
        setManualAppointmentStep(manualAppointmentKind === 'business' ? 'business' : (manualAppointmentKind === 'meeting' ? 'meeting' : 'details'));
        focusManualAppointmentStep();
        return;
    }
    if (manualAppointmentStep === 'business') {
        if (manualAppointmentBusinessType !== 'meeting' && manualAppointmentBusinessType !== 'appointment') {
            setManualAppointmentStatus('Kies eerst Meeting of Afspraak.', 'error');
            return;
        }
        setManualAppointmentStep(manualAppointmentBusinessType === 'meeting' ? 'meeting' : 'details');
        focusManualAppointmentStep();
        return;
    }
    if (manualAppointmentStep === 'meeting') {
        if (!normalizeManualLegendChoice(manualAppointmentMeetingType)) {
            setManualAppointmentStatus('Kies welke meeting je wilt inplannen.', 'error');
            return;
        }
        setManualAppointmentStep('details');
        focusManualAppointmentStep();
        return;
    }
    void submitManualAppointment();
}
