const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium agenda modal uses dossier flow for appointments that already have an active order', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /AI begrijpt en scant de dynamische agenda en houd rekening met reistijden\./);
  assert.match(pageSource, /Let op: Agenda functioneerd pas goed bij gebruik van Softora Agenda app\./);
  assert.doesNotMatch(pageSource, /Meetings ingepland door AI Lead Generator/);
  assert.match(
    pageSource,
    /function getLinkedOrderIdForAppointment\(apt\)\s*\{[\s\S]*const orderId = Number\(apt\?\.activeOrderId \|\| 0\);[\s\S]*return orderId;/
  );
  assert.match(pageSource, /function getLinkedOrderDossierUrl\(apt\)/);
  assert.match(pageSource, /modalPrimaryBtn\.textContent = 'Open dossier';/);
  assert.match(pageSource, /modalPrimaryBtn\.textContent = 'Dossier aanmaken';/);
  assert.match(
    pageSource,
    /if \(!modalWorkspaceMode\) \{[\s\S]*if \(getLinkedOrderIdForAppointment\(apt\)\) \{[\s\S]*openLinkedOrderDossierForAppointment\(apt\);/
  );
  assert.match(
    pageSource,
    /if \(getLinkedOrderIdForAppointment\(apt\)\) \{[\s\S]*openLinkedOrderDossierForAppointment\(apt\);[\s\S]*return;[\s\S]*\}\s*void addActiveOrderForActiveAppointment/
  );
});

test('premium agenda workspace locks modal exit while dossier flow is still mandatory', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /<button class="modal-close magnetic" id="modalCloseBtn"/);
  assert.match(
    pageSource,
    /\.modal-overlay\.dismiss-locked \.modal-close,\s*\.modal\.dismiss-locked \.modal-close \{[\s\S]*display:\s*none !important;[\s\S]*pointer-events:\s*none;/
  );
  assert.match(
    pageSource,
    /function isWorkspaceLoadingVisible\(\) \{\s*return Boolean\(workspaceLoadingOverlay && workspaceLoadingOverlay\.classList\.contains\('show'\)\);\s*\}/
  );
  assert.match(
    pageSource,
    /function isWorkspaceExitLocked\(\) \{\s*return modalWorkspaceMode && \(workspaceBusy \|\| workspacePendingCustomerCheck \|\| isWorkspaceLoadingVisible\(\)\);\s*\}/
  );
  assert.match(
    pageSource,
    /function shouldHideWorkspaceDismissControls\(\) \{\s*return modalWorkspaceMode && hasWorkspaceLinkedOrder\(\);\s*\}/
  );
  assert.match(
    pageSource,
    /function syncWorkspaceExitControls\(\) \{[\s\S]*const shouldHideDismissControls = shouldHideWorkspaceDismissControls\(\);[\s\S]*const hideClose = shouldLockExit \|\| shouldHideDismissControls;[\s\S]*modalCloseBtn\.hidden = hideClose;[\s\S]*modalCloseBtn\.style\.display = hideClose \? 'none' : '';[\s\S]*modalCloseBtn\.setAttribute\('aria-hidden', hideClose \? 'true' : 'false'\);[\s\S]*modalSecondaryBtn\.hidden = shouldHideDismissControls;[\s\S]*modalSecondaryBtn\.disabled = shouldLockExit \|\| shouldHideDismissControls;/
  );
  assert.match(
    pageSource,
    /function setWorkspaceLoading\(loading\) \{[\s\S]*workspaceLoadingOverlay\.classList\.toggle\('show', loading\);[\s\S]*workspaceLoadingOverlay\.setAttribute\('aria-hidden', loading \? 'false' : 'true'\);[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*\}/
  );
  assert.match(
    pageSource,
    /wsCustomerAddedCheck\.addEventListener\('change', function\(\) \{[\s\S]*workspacePendingCustomerCheck = !this\.checked;[\s\S]*refreshWorkspacePrimaryButtonLabel\(\);[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*\}\);/
  );
  assert.match(pageSource, /workspaceSuccessTitle\.hidden = true;/);
  assert.match(
    pageSource,
    /function showWorkspaceSuccess\(customerName, successMessage\) \{[\s\S]*workspacePendingCustomerCheck = true;[\s\S]*refreshWorkspacePrimaryButtonLabel\(\);[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*\}/
  );
  assert.match(
    pageSource,
    /function hideWorkspaceSuccess\(\) \{[\s\S]*workspacePendingCustomerCheck = false;[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*\}/
  );
  assert.match(
    pageSource,
    /modalSecondaryBtn\.textContent = 'Terug';[\s\S]*if \(linkedOrderId\) \{[\s\S]*modalPrimaryBtn\.textContent = 'Open dossier';[\s\S]*modalPrimaryBtn\.disabled = workspaceBusy \|\| workspacePendingCustomerCheck;[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*return;/
  );
  assert.match(pageSource, /function closeModal\(\) \{\s*if \(isWorkspaceExitLocked\(\)\) return;/);
  assert.match(pageSource, /function handleModalSecondaryAction\(\) \{\s*if \(isWorkspaceExitLocked\(\)\) return;/);
  assert.match(
    pageSource,
    /modalElement\.addEventListener\('click', \(event\) => \{[\s\S]*if \(event\.target !== modalElement\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*\}\);/
  );
  assert.match(
    pageSource,
    /window\.addEventListener\('keydown', \(event\) => \{[\s\S]*if \(!modalElement\.classList\.contains\('show'\)\) return;[\s\S]*if \(event\.key !== 'Escape'\) return;[\s\S]*if \(!isWorkspaceExitLocked\(\)\) return;[\s\S]*event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);[\s\S]*\}, true\);/
  );
});

test('premium agenda offers stepped manual add flow on day click', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="manualAppointmentOverlay"/);
  assert.match(pageSource, /Wat wil je inplannen\?/);
  assert.match(pageSource, /data-manual-kind="meeting"/);
  assert.match(pageSource, /data-manual-kind="overig"/);
  assert.doesNotMatch(pageSource, /id="manualAppointmentCancelBtn"/);
  assert.match(pageSource, /class="modal manual-appointment-modal"[^>]*data-manual-step="kind"/);
  assert.match(pageSource, /\.manual-appointment-modal\[data-manual-step="meeting"\] #manualAppointmentCancelBtn,/);
  assert.match(pageSource, /\.manual-appointment-modal\[data-manual-step="details"\] #manualAppointmentCancelBtn \{[\s\S]*display: none !important;/);
  assert.match(pageSource, /manualAppointmentModal\.setAttribute\('data-manual-step', manualAppointmentStep\);/);
  assert.match(pageSource, /Welke meeting\?/);
  assert.match(pageSource, /data-manual-meeting-type="website"/);
  assert.match(pageSource, /data-manual-meeting-type="business"/);
  assert.match(pageSource, /data-manual-meeting-type="voice"/);
  assert.match(pageSource, /data-manual-meeting-type="chatbot"/);
  assert.match(pageSource, /id="manualAppointmentActivity"/);
  assert.match(pageSource, /Voor wie\?/);
  assert.match(pageSource, /data-manual-who="serve"/);
  assert.match(pageSource, /data-manual-who="martijn"/);
  assert.match(pageSource, /data-manual-who="both"/);
  assert.match(pageSource, /Titel/);
  assert.match(pageSource, /id="manualAppointmentTime"/);
  assert.match(pageSource, /Tijdstip/);
  assert.match(pageSource, /id="manualAppointmentLocation"/);
  assert.match(pageSource, /Locatie/);
  assert.match(pageSource, /id="manualAppointmentNotes"/);
  assert.match(pageSource, /Opmerkingen/);
  assert.match(pageSource, /Overig/);
  assert.match(pageSource, /id="manualAppointmentActivityTime"/);
  assert.match(pageSource, /id="manualAppointmentLegendChoice"/);
  assert.match(pageSource, /\/api\/agenda\/appointments\/manual/);
  assert.match(pageSource, /data-calendar-date=/);
  assert.match(pageSource, /function advanceManualAppointmentStep\(/);
  assert.match(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-kind\]'\)\.forEach\(\(button\) => \{[\s\S]*setManualAppointmentActiveChoices\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.doesNotMatch(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-kind\]'\)\.forEach\(\(button\) => \{[\s\S]*advanceManualAppointmentStep\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.match(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-meeting-type\]'\)\.forEach\(\(button\) => \{[\s\S]*setManualAppointmentActiveChoices\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.doesNotMatch(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-meeting-type\]'\)\.forEach\(\(button\) => \{[\s\S]*advanceManualAppointmentStep\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.match(pageSource, /manualAppointmentSubmitBtn\.addEventListener\('click', \(\) => advanceManualAppointmentStep\(\)\);/);
  assert.match(pageSource, /function getManualAppointmentLegendChoice\(/);
  assert.match(pageSource, /legend-dot manual-serve/);
  assert.match(pageSource, /Activiteit Servé/);
  assert.match(pageSource, /legend-dot manual-martijn/);
  assert.match(pageSource, /Activiteit Martijn/);
  assert.match(pageSource, /legend-dot manual-both/);
  assert.match(pageSource, /Activiteit allebei/);
  assert.match(pageSource, /legend-dot manual-overig/);
  assert.match(pageSource, /Overig/);
  assert.match(pageSource, /\.legend-dot\.manual-overig \{ background: #ec4899; \}/);
  assert.match(pageSource, /\.appointment\.manual-overig \{[\s\S]*border-left: 3px solid #ec4899;/);
  assert.match(pageSource, /activityTime: timeVal/);
  assert.match(pageSource, /const who = String\(manualAppointmentWho \|\| ''\)\.trim\(\);/);
  assert.match(pageSource, /Kies voor wie deze afspraak is\./);
  assert.match(pageSource, /legendChoice,/);
  assert.match(pageSource, /who,/);
  assert.match(pageSource, /notes,/);
  assert.match(pageSource, /if \(manualLegendChoice === 'business'\) return 'appointment meeting magnetic meeting--business';/);
  assert.match(pageSource, /if \(who === 'overig'\) return 'appointment manual-overig magnetic';/);
  assert.match(pageSource, /if \(who === 'both' \|\| who === 'allebei' \|\| who === 'beide'\) return 'appointment manual-both magnetic';/);
});

test('premium agenda handmatige afspraak-modal slaat locatie en opmerkingen op', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="manualAppointmentLocation"/);
  assert.match(pageSource, /id="manualAppointmentNotes"/);
  assert.doesNotMatch(pageSource, /ensureAgendaPlacesReady/);
  assert.match(pageSource, /location,/);
  assert.match(pageSource, /notes,/);
});

test('premium agenda keeps appointment color in sync with existing dossiers', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /async function refreshKnownActiveOrdersIndex\(\) \{[\s\S]*const previousIds = knownActiveOrderIds;[\s\S]*const previousByAppointment = knownActiveOrderByAppointmentId;[\s\S]*const indexChanged = previousIds\.size !== nextIds\.size[\s\S]*renderCalendar\(\);[\s\S]*refreshWorkspacePrimaryButtonLabel\(\);[\s\S]*return \{ ids: nextIds, byAppointment: nextByAppointment \};/s
  );
  assert.match(
    pageSource,
    /function isAppointmentCompleted\(apt\) \{[\s\S]*if \(Number\(getLinkedOrderIdForAppointment\(apt\) \|\| 0\) > 0\) return true;[\s\S]*\}/s
  );
  assert.match(pageSource, /function getCalendarAppointmentClass\(apt\)/);
  assert.match(
    pageSource,
    /const appointmentClass = getCalendarAppointmentClass\(apt\);/
  );
});

test('premium agenda shows klantwerk label on Saturdays', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /const isSaturday = Boolean\(dateStr\) && i % 7 === 5;/);
  assert.match(pageSource, /calendar-day--klantwerk/);
  assert.match(pageSource, /calendar-day-klantwerk-label/);
  assert.match(pageSource, /function isYmdCalendarSaturday\(/);
  assert.match(pageSource, /if \(isYmdCalendarSaturday\(item\.date\)\) return null;/);
  assert.match(pageSource, /const withoutSaturday = appointments\.filter/);
  assert.match(pageSource, /if \(cell\.classList\.contains\('calendar-day--klantwerk'\)\) return;/);
  assert.match(pageSource, /if \(isYmdCalendarSaturday\(picked\)\) return;/);
});

test('premium agenda toont Ruben planning uitleg alleen in AI beheer modus', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /Ruben Nijhuis plant afspraken in/);
  assert.match(
    pageSource,
    /html:not\(\[data-ai-management-mode="software"\]\) \.agenda-routing-bubble-wrap \{\s*display: none;\s*\}/
  );
});

test('premium agenda does not render fictive fallback appointments when bootstrap and api return nothing', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /function buildAgendaUiFallbackAppointments\(\)/);
  assert.doesNotMatch(pageSource, /AGENDA_UI_FALLBACK_APPOINTMENTS/);
  assert.doesNotMatch(pageSource, /function ensureAgendaUiFallbackAppointments\(\)/);
  assert.doesNotMatch(pageSource, /uiFallback: true,[\s\S]*company: 'Servé Creusen'/);
  assert.doesNotMatch(pageSource, /Website meeting met Servé Creusen/);
  assert.doesNotMatch(pageSource, /Bedrijfssoftware meeting met Servé Creusen/);
  assert.doesNotMatch(pageSource, /Voicesoftware meeting met Servé Creusen/);
  assert.doesNotMatch(pageSource, /Chatbot meeting met Servé Creusen/);
  assert.match(pageSource, /function applyInitialAgendaBootstrap\(\) \{\s*mergeServerAppointments\(agendaBootstrapPayload\?\.appointments\);\s*\}/);
});
