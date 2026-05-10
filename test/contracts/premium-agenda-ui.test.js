const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium agenda modal uses dossier flow for appointments that already have an active order', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const followUpPath = path.join(__dirname, '../../assets/premium-agenda-follow-up-leads.js');
  const pageSource = `${fs.readFileSync(pagePath, 'utf8')}\n${fs.readFileSync(followUpPath, 'utf8')}`;

  assert.match(pageSource, /Dynamische agenda voor de medewerkers van Softora\.nl/);
  assert.doesNotMatch(pageSource, /Meetings ingepland door AI Lead Generator/);
  assert.match(
    pageSource,
    /function getLinkedOrderIdForAppointment\(apt\)\s*\{[\s\S]*const orderId = Number\(apt\?\.activeOrderId \|\| 0\);[\s\S]*return orderId;/
  );
  assert.match(pageSource, /function getLinkedOrderDossierUrl\(apt\)/);
  assert.match(pageSource, /modalPrimaryBtn\.textContent = 'Open dossier';/);
  assert.match(pageSource, /modalPrimaryBtn\.textContent = 'Dossier aanmaken';/);
  assert.match(pageSource, /assets\/premium-agenda-follow-up-leads\.js/);
  assert.match(pageSource, /button\.id = 'modalFollowUpBtn';/);
  assert.match(pageSource, /async function addFollowUpLeadForActiveAppointment\(options = \{\}\)/);
  assert.match(pageSource, /\/api\/agenda\/appointments\/\$\{encodeURIComponent\(String\(apt\.id\)\)\}\/add-follow-up-lead/);
  assert.match(pageSource, /window\.location\.assign\('\/premium-leads'\);/);
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
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /<button class="modal-close magnetic" id="modalCloseBtn"/);
  assert.match(pageSource, /assets\/premium-agenda-stability\.js/);
  assert.match(pageSource, /\.modal-workspace-loading \{[\s\S]*background:\s*var\(--bg-primary\);[\s\S]*backdrop-filter:\s*none;[\s\S]*-webkit-backdrop-filter:\s*none;/);
  assert.doesNotMatch(pageSource, /background:\s*rgba\(250,\s*248,\s*246,\s*0\.88\)/);
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
    /function syncWorkspaceExitControls\(\) \{[\s\S]*const shouldHideDismissControls = shouldHideWorkspaceDismissControls\(\);[\s\S]*const hideClose = shouldLockExit \|\| shouldHideDismissControls;[\s\S]*modalCloseBtn\.hidden = hideClose;[\s\S]*modalCloseBtn\.style\.display = hideClose \? 'none' : '';[\s\S]*modalCloseBtn\.setAttribute\('aria-hidden', hideClose \? 'true' : 'false'\);/
  );
  assert.match(stabilitySource, /const hideFooterClose = !modalWorkspaceMode;/);
  assert.match(stabilitySource, /modalSecondaryBtn\.hidden = hideFooterClose \|\| hideDismiss;/);
  assert.match(stabilitySource, /modalSecondaryBtn\.disabled = locked \|\| hideFooterClose \|\| hideDismiss;/);
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

test('premium agenda gebruikt delegated acties voor agenda chrome en afspraken', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /\son(?:click|input|change|keydown|submit)=/i);
  assert.match(pageSource, /id="modalCloseBtn" data-modal-close/);
  assert.match(pageSource, /data-month-offset="-1"/);
  assert.match(pageSource, /data-month-offset="1"/);
  assert.match(pageSource, /data-appointment-id="\$\{apt\.id\}"/);
  assert.match(pageSource, /escapeAgendaPlanningHtml\(apt\.company\)/);
  assert.match(pageSource, /document\.querySelectorAll\('\[data-modal-close\]'\)/);
  assert.match(pageSource, /document\.querySelectorAll\('\[data-month-offset\]'\)/);
  assert.match(pageSource, /calendarGridEl\.addEventListener\('click'/);
  assert.match(pageSource, /calendarGridEl\.addEventListener\('keydown'/);
  assert.match(pageSource, /void openAppointment\(appointmentId\);/);
});

test('premium agenda offers stepped manual add flow on day click', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const manualFlowPath = path.join(__dirname, '../../assets/premium-agenda-manual-business-flow.js');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = `${fs.readFileSync(pagePath, 'utf8')}\n${fs.readFileSync(manualFlowPath, 'utf8')}\n${fs.readFileSync(stabilityPath, 'utf8')}`;

  assert.match(pageSource, /id="manualAppointmentOverlay"/);
  assert.match(pageSource, /assets\/premium-agenda-manual-business-flow\.js/);
  assert.match(pageSource, /Wat wil je inplannen\?/);
  assert.match(pageSource, /data-manual-kind="business"/);
  assert.match(pageSource, /data-manual-kind="overig"/);
  assert.match(pageSource, /Zakelijk/);
  assert.match(pageSource, /\.manual-appointment-choice:focus \{[\s\S]*outline: none;/);
  assert.match(pageSource, /\.manual-appointment-choice:focus-visible,[\s\S]*\.manual-appointment-choice\.is-active \{[\s\S]*border-color: var\(--accent\);/);
  assert.match(pageSource, /manualAppointmentKind = '';/);
  assert.match(pageSource, /manualAppointmentBusinessType = '';/);
  assert.doesNotMatch(pageSource, /id="manualAppointmentCancelBtn"/);
  assert.match(pageSource, /class="modal manual-appointment-modal"[^>]*data-manual-step="kind"/);
  assert.match(pageSource, /\.manual-appointment-modal\[data-manual-step="business"\] #manualAppointmentCancelBtn,/);
  assert.match(pageSource, /\.manual-appointment-modal\[data-manual-step="meeting"\] #manualAppointmentCancelBtn,/);
  assert.match(pageSource, /\.manual-appointment-modal\[data-manual-step="details"\] #manualAppointmentCancelBtn \{[\s\S]*display: none !important;/);
  assert.match(pageSource, /manualAppointmentModal\.setAttribute\('data-manual-step', manualAppointmentStep\);/);
  assert.match(pageSource, /Wat voor zakelijke afspraak\?/);
  assert.match(pageSource, /data-manual-business-type="meeting"/);
  assert.match(pageSource, /data-manual-business-type="appointment"/);
  assert.match(pageSource, /Afspraak/);
  assert.match(pageSource, /Welke meeting\?/);
  assert.match(pageSource, /data-manual-meeting-type="website"/);
  assert.match(pageSource, /data-manual-meeting-type="business"/);
  assert.match(pageSource, /data-manual-meeting-type="voice"/);
  assert.match(pageSource, /data-manual-meeting-type="chatbot"/);
  assert.match(pageSource, /id="manualAppointmentActivity"/);
  assert.match(pageSource, /id="manualAppointmentWhoLabel"/);
  assert.match(pageSource, /Voor wie\?/);
  assert.match(pageSource, /Wie heeft deze lead geregeld\?/);
  assert.match(pageSource, /function syncManualAppointmentDetailsMode\(\)/);
  assert.match(pageSource, /whoLabel\.textContent = isMeeting \? 'Wie heeft deze lead geregeld\?' : 'Voor wie\?';/);
  assert.match(pageSource, /whoChoices\.setAttribute\('aria-label', isMeeting \? 'Wie heeft deze lead geregeld\?' : 'Voor wie is deze afspraak\?'\);/);
  assert.match(pageSource, /id="manualAppointmentWhoChoices"/);
  assert.match(pageSource, /\.manual-appointment-step \{[\s\S]*display: grid;[\s\S]*gap: 0\.95rem;/);
  assert.match(pageSource, /\.manual-appointment-step \.modal-workspace-field \{[\s\S]*display: grid;[\s\S]*gap: 0\.55rem;/);
  assert.match(pageSource, /\.manual-appointment-step \.modal-workspace-label \{[\s\S]*margin-bottom: 0;[\s\S]*line-height: 1\.12;/);
  assert.match(pageSource, /\.manual-appointment-choice-grid--who \{[\s\S]*display: flex;[\s\S]*flex-wrap: nowrap;/);
  assert.match(pageSource, /data-manual-who="serve"/);
  assert.match(pageSource, /data-manual-who="martijn"/);
  assert.match(pageSource, /data-manual-who="both"/);
  assert.match(pageSource, /if \(bothChoice\) bothChoice\.hidden = isMeeting;/);
  assert.match(pageSource, /if \(isMeeting && manualAppointmentWho === 'both'\) manualAppointmentWho = '';/);
  assert.match(pageSource, /Titel/);
  assert.match(pageSource, /id="manualAppointmentPhone"/);
  assert.match(pageSource, /Telefoonnummer \(optioneel\)/);
  assert.match(pageSource, /id="manualAppointmentTime"/);
  assert.match(pageSource, /Tijdstip/);
  assert.match(pageSource, /id="manualAppointmentAvailableAgainField"/);
  assert.match(pageSource, /id="manualAppointmentAvailableAgain"/);
  assert.match(pageSource, /Weer beschikbaar vanaf \(optioneel\)/);
  assert.match(pageSource, /id="manualAppointmentLocation"/);
  assert.match(pageSource, /Locatie/);
  assert.match(pageSource, /id="manualAppointmentNotes"/);
  assert.match(pageSource, /Opmerkingen/);
  assert.match(pageSource, /Privé/);
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
    /document\.querySelectorAll\('\[data-manual-who\]'\)\.forEach\(\(button\) => \{[\s\S]*syncManualAppointmentDetailsMode\(\);[\s\S]*setManualAppointmentActiveChoices\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.match(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-business-type\]'\)\.forEach\(\(button\) => \{[\s\S]*setManualAppointmentActiveChoices\(\);[\s\S]*\}\);\s*\}\);/
  );
  assert.doesNotMatch(
    pageSource,
    /document\.querySelectorAll\('\[data-manual-business-type\]'\)\.forEach\(\(button\) => \{[\s\S]*advanceManualAppointmentStep\(\);[\s\S]*\}\);\s*\}\);/
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
  assert.match(pageSource, /const manualAppointmentAvailableAgainEl = document\.getElementById\('manualAppointmentAvailableAgain'\);/);
  assert.match(pageSource, /function isManualPrivateSingleAppointment\(\)/);
  assert.match(pageSource, /if \(availableAgainField\) availableAgainField\.hidden = !isManualPrivateSingleAppointment\(\);/);
  assert.match(pageSource, /if \(manualAppointmentAvailableAgainEl\) manualAppointmentAvailableAgainEl\.value = '';/);
  assert.match(pageSource, /availableAgain: canStoreAvailableAgain \? availableAgainVal : ''/);
  assert.match(pageSource, /legend-dot manual-serve/);
  assert.match(pageSource, /Activiteit Servé/);
  assert.match(pageSource, /legend-dot manual-overig/);
  assert.match(pageSource, /Afspraak/);
  assert.doesNotMatch(pageSource, /<div class="legend-item"><div class="legend-dot manual-martijn"><\/div> Activiteit Martijn<\/div>/);
  assert.doesNotMatch(pageSource, /<div class="legend-item"><div class="legend-dot manual-both"><\/div> Activiteit allebei<\/div>/);
  assert.match(pageSource, /legend-dot private-serve/);
  assert.match(pageSource, /Privé Servé/);
  assert.match(pageSource, /legend-dot private-martijn/);
  assert.match(pageSource, /Privé Martijn/);
  assert.match(pageSource, /\.legend-dot\.manual-overig \{ background: #0891b2; \}/);
  assert.match(pageSource, /\.appointment\.manual-martijn,[\s\S]*\.appointment\.manual-both,[\s\S]*\.appointment\.manual-overig \{[\s\S]*border-left: 3px solid #0891b2;/);
  assert.match(pageSource, /\.legend-dot\.private-serve\{background:#111827\}/);
  assert.match(pageSource, /\.legend-dot\.private-martijn\{background:#f43f5e\}/);
  assert.match(pageSource, /\.appointment\.private-serve\{[\s\S]*border-left:3px solid #111827/);
  assert.match(pageSource, /\.appointment\.private-martijn\{[\s\S]*border-left:3px solid #f43f5e/);
  assert.match(pageSource, /activityTime: timeVal/);
  assert.match(pageSource, /function getManualAppointmentPhoneValue\(\)/);
  assert.match(pageSource, /manualPhone: String\(item\.manualPhone \|\| item\.phone \|\| ''\),/);
  assert.match(pageSource, /manualAvailableAgain: String\(item\.manualAvailableAgain \|\| item\.availableAgain \|\| item\.available_after \|\| ''\),/);
  assert.match(pageSource, /availableAgain: String\(item\.availableAgain \|\| item\.available_after \|\| item\.manualAvailableAgain \|\| ''\),/);
  assert.match(pageSource, /id="appointmentEditAvailableAgain"/);
  assert.match(pageSource, /function syncAvailableAgainVisibility\(\)/);
  assert.match(pageSource, /field\.hidden = choice !== 'private-serve' && choice !== 'private-martijn';/);
  assert.match(pageSource, /byId\('appointmentEditAvailableAgain'\)\.value = String\(\(apt && \(apt\.manualAvailableAgain \|\| apt\.availableAgain\)\) \|\| ''\)\.trim\(\);/);
  assert.match(pageSource, /availableAgain,\s*title: String\(byId\('appointmentEditTitle'\)\.value \|\| ''\)\.trim\(\),/);
  assert.match(pageSource, /phone: getManualAppointmentPhoneValue\(\), manualPhone: getManualAppointmentPhoneValue\(\),/);
  assert.match(pageSource, /const isMeeting = isManualAppointmentMeetingFlow\(\);/);
  assert.match(pageSource, /const appointmentKind = isMeeting \? 'meeting' : isBusinessAppointment \? 'appointment' : 'overig';/);
  assert.match(pageSource, /Kies wie deze lead heeft geregeld\./);
  assert.match(pageSource, /Kies voor wie deze afspraak is\./);
  assert.match(pageSource, /legendChoice,/);
  assert.match(pageSource, /appointmentKind,/);
  assert.match(pageSource, /manualBusinessType: manualAppointmentBusinessType,/);
  assert.match(pageSource, /manualLeadOwner: leadOwnerKey,/);
  assert.match(pageSource, /leadOwnerKey,/);
  assert.match(pageSource, /who,/);
  assert.match(pageSource, /notes,/);
  assert.match(pageSource, /manualLegendChoice: String\(item\.manualLegendChoice \|\| item\.legendChoice \|\| ''\),/);
  assert.match(pageSource, /appointmentKind: String\(item\.appointmentKind \|\| item\.manualAppointmentKind \|\| ''\),/);
  assert.match(pageSource, /if \(manualLegendChoice === 'business'\) return 'appointment meeting magnetic meeting--business';/);
  assert.match(pageSource, /if \(manualWho === 'martijn'\) return 'appointment private-martijn magnetic';/);
  assert.match(pageSource, /if \(manualWho === 'serve' \|\| manualWho === 'servé'\) return 'appointment private-serve magnetic';/);
  assert.match(pageSource, /if \(who === 'both' \|\| who === 'allebei' \|\| who === 'beide'\) return 'appointment manual-both magnetic';/);
});

test('premium agenda kan handmatige afspraakgegevens wijzigen vanuit de detailmodal', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /assets\/premium-agenda-stability\.js\?v=20260510b/);
  assert.match(stabilitySource, /button\.id = 'modalEditAppointmentBtn';/);
  assert.match(stabilitySource, /form\.id = 'appointmentEditForm';/);
  assert.match(stabilitySource, /id="appointmentEditLegend"/);
  assert.match(stabilitySource, /id="appointmentEditTitle"/);
  assert.match(stabilitySource, /id="appointmentEditDate"/);
  assert.match(stabilitySource, /id="appointmentEditTime"/);
  assert.match(stabilitySource, /id="appointmentEditPhone"/);
  assert.match(stabilitySource, /id="appointmentEditLocation"/);
  assert.match(stabilitySource, /id="appointmentEditNotes"/);
  assert.match(stabilitySource, /async function saveEdit\(\)/);
  assert.match(stabilitySource, /\/api\/agenda\/appointments\/\$\{encodeURIComponent\(String\(apt\.id\)\)\}\/manual/);
  assert.match(stabilitySource, /await loadServerAppointments\(\{ fresh: true, timeoutMs: 8000 \}\);/);
  assert.match(stabilitySource, /refreshWorkspacePrimaryButtonLabel = function refreshWorkspacePrimaryButtonLabelWithEdit\(\)/);
  assert.match(stabilitySource, /function rememberButtonState\(\)/);
  assert.match(stabilitySource, /function restoreButtonState\(\)/);
});

test('premium agenda handmatige afspraak-modal slaat optionele telefoon, locatie en opmerkingen op', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="manualAppointmentPhone"/);
  assert.match(pageSource, /id="manualAppointmentLocation"/);
  assert.match(pageSource, /id="manualAppointmentNotes"/);
  assert.doesNotMatch(pageSource, /ensureAgendaPlacesReady/);
  assert.match(pageSource, /phone: getManualAppointmentPhoneValue\(\), manualPhone: getManualAppointmentPhoneValue\(\),/);
  assert.match(pageSource, /location,/);
  assert.match(pageSource, /notes,/);
});

test('premium agenda toont leadscore per eigenaar in de maandheader zonder losse statistiekkaart', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const scoreboardPath = path.join(__dirname, '../../assets/premium-agenda-lead-scoreboard.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');
  const scoreboardSource = fs.readFileSync(scoreboardPath, 'utf8');

  assert.match(pageSource, /manualLeadOwnerKey: String\(item\.manualLeadOwnerKey \|\| ''\)/);
  assert.match(pageSource, /leadOwnerKey: String\(item\.leadOwnerKey \|\| ''\)/);
  assert.match(pageSource, /leadOwnerFullName: String\(item\.leadOwnerFullName \|\| ''\)/);
  assert.match(pageSource, /class="agenda-header-owners" aria-label="Leadscore agenda"/);
  assert.match(pageSource, /data-agenda-owner="serve"/);
  assert.match(pageSource, /data-agenda-owner="martijn"/);
  assert.match(pageSource, /data-agenda-owner-count="serve">0<\/span>/);
  assert.match(pageSource, /data-agenda-owner-count="martijn">0<\/span>/);
  assert.match(pageSource, /\.month-nav\s*\{[\s\S]*gap:\s*0\.45rem;/);
  assert.match(pageSource, /\.month-label\s*\{[\s\S]*min-width:\s*auto;/);
  assert.match(pageSource, /\.agenda-header-owners\s*\{[\s\S]*flex-direction:\s*column;/);
  assert.match(pageSource, /\.agenda-header-owner\.is-leading\s*\{[\s\S]*#7c3aed/);
  assert.match(pageSource, /premium-agenda-lead-scoreboard\.js\?v=20260510a/);
  assert.match(scoreboardSource, /function refreshAgendaHeaderLeadOwnerScoreboard\(\) \{[\s\S]*const counts = \{ serve: 0, martijn: 0 \};[\s\S]*row\.classList\.toggle\('is-leading', highestCount > 0 && count === highestCount\);/);
  assert.match(scoreboardSource, /renderCalendar = function renderCalendarWithLeadScoreboard\(\) \{[\s\S]*baseRenderCalendar\(\);[\s\S]*refreshAgendaHeaderLeadOwnerScoreboard\(\);/);
  assert.doesNotMatch(pageSource, /agendaManualLeadStatsCard/);
  assert.doesNotMatch(pageSource, />\s*Handmatige leads\s*</);
  assert.doesNotMatch(stabilitySource, /agendaManualLeadStatsCard/);
  assert.doesNotMatch(stabilitySource, /renderManualLeadStatsCard/);
  assert.doesNotMatch(stabilitySource, /Handmatige leads/);
  assert.match(stabilitySource, /renderCalendar = function renderCalendarStable\(\) \{[\s\S]*baseRenderCalendar\(\);[\s\S]*document\.querySelectorAll\('\[data-calendar-date\]'\)/);
  assert.match(stabilitySource, /cell\.classList\.add\('calendar-day-selectable'\)/);
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

test('premium agenda keeps month columns fixed when appointment titles are long', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /\.calendar-header \{[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);/);
  assert.match(pageSource, /\.calendar-grid \{[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);/);
  assert.match(pageSource, /\.calendar-header-day \{[\s\S]*min-width: 0;/);
  assert.match(pageSource, /\.calendar-day \{[\s\S]*min-width: 0;/);
  assert.match(
    pageSource,
    /\.appointment \{[\s\S]*display: block;[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*min-width: 0;[\s\S]*text-overflow: ellipsis;/
  );
});

test('premium agenda shows klantwerk on Wednesdays and Saturdays without blocking planning', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /function isYmdCalendarKlantwerkDay\(/);
  assert.match(pageSource, /return day === 3 \|\| day === 6;/);
  assert.match(pageSource, /const isKlantwerkDay = Boolean\(dateStr\) && isYmdCalendarKlantwerkDay\(dateStr\);/);
  assert.match(pageSource, /calendar-day--klantwerk/);
  assert.match(pageSource, /calendar-day-klantwerk-label/);
  assert.match(pageSource, /if \(!isOtherMonth\) classes \+= ' calendar-day-selectable';/);
  assert.match(pageSource, /!isOtherMonth && dateStr \? ` data-calendar-date="\$\{dateStr\}"` : '';/);
  assert.doesNotMatch(pageSource, /function isYmdCalendarSaturday\(/);
  assert.doesNotMatch(pageSource, /if \(isYmdCalendarSaturday\(item\.date\)\) return null;/);
  assert.doesNotMatch(pageSource, /const withoutSaturday = appointments\.filter/);
  assert.doesNotMatch(pageSource, /if \(cell\.classList\.contains\('calendar-day--klantwerk'\)\) return;/);
  assert.doesNotMatch(pageSource, /if \(isYmdCalendarSaturday\(picked\)\) return;/);
  assert.doesNotMatch(pageSource, /Op zaterdag staan geen afspraken in de agenda\./);
  assert.doesNotMatch(pageSource, /\.calendar-day--klantwerk:hover \{[\s\S]*background:\s*transparent;/);
});

test('premium agenda verbergt dealacties voor handmatige overige afspraken en behoudt boot-failsafe', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const followUpPath = path.join(__dirname, '../../assets/premium-agenda-follow-up-leads.js');
  const pageSource = `${fs.readFileSync(pagePath, 'utf8')}\n${fs.readFileSync(followUpPath, 'utf8')}`;
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /assets\/premium-agenda-stability\.js/);
  assert.match(pageSource, /window\.SoftoraAgendaStability\.finishBoot\(\);/);
  assert.match(stabilitySource, /function isManualAgendaAppointment\(item\)/);
  assert.match(stabilitySource, /function isManualOtherAppointment\(apt\)/);
  assert.match(stabilitySource, /function canCompleteAppointmentManually\(apt\)/);
  assert.match(stabilitySource, /if \(kind === 'meeting'\) return false;/);
  assert.match(stabilitySource, /apt\.summary/);
  assert.match(stabilitySource, /choice === 'manual-overig' \|\| choice === 'private-serve' \|\| choice === 'private-martijn'/);
  assert.match(stabilitySource, /modalBadge\.textContent = 'Privé-afspraak';/);
  assert.match(stabilitySource, /modalPrimaryBtn\.hidden = true;/);
  assert.match(stabilitySource, /modalFollowUpBtn\.hidden = true;/);
  assert.match(stabilitySource, /modalNoDealBtn\.hidden = true;/);
  assert.match(pageSource, /class="modal-btn primary magnetic" id="modalCompleteActivityBtn"[^>]*>Activiteit afgerond<\/button>/);
  assert.match(pageSource, /const modalCompleteActivityBtn = document\.getElementById\('modalCompleteActivityBtn'\);/);
  assert.match(stabilitySource, /function syncCompleteActivityButtonVisibility\(\)/);
  assert.match(stabilitySource, /canCompleteAppointmentManually\(apt\) && !isAppointmentCompleted\(apt\)/);
  assert.match(stabilitySource, /async function markActiveAppointmentCompletedByStaff\(\)/);
  assert.match(stabilitySource, /!canCompleteAppointmentManually\(apt\)/);
  assert.match(stabilitySource, /status: 'completed'/);
  assert.match(stabilitySource, /modalCompleteActivityBtn\.addEventListener\('click', \(\) => \{ void markActiveAppointmentCompletedByStaff\(\); \}\);/);
  assert.match(
    stabilitySource,
    /if \(!modalWorkspaceMode && isAppointmentCompleted\(apt\) && !getLinkedOrderIdForAppointment\(apt\)\) \{[\s\S]*modalPrimaryBtn\.hidden = true;[\s\S]*modalNoDealBtn\.hidden = true;/
  );
  assert.match(stabilitySource, /const baseMarkActiveAppointmentNoDeal = markActiveAppointmentNoDeal;/);
  assert.match(stabilitySource, /return baseIsAppointmentCompleted\(apt\) \|\| status === 'completed' \|\| status === 'afgerond';/);
  assert.match(stabilitySource, /if \(choice === 'private-serve' && !isAppointmentCompleted\(apt\)\) return 'appointment private-serve magnetic';/);
  assert.match(stabilitySource, /if \(choice === 'private-martijn' && !isAppointmentCompleted\(apt\)\) return 'appointment private-martijn magnetic';/);
  assert.doesNotMatch(stabilitySource, /status === 'afgerond' \|\| hasAppointmentStartPassed\(apt\)/);
  assert.match(stabilitySource, /function setModalAudioBlockHidden\(hidden\)/);
  assert.match(stabilitySource, /syncManualAppointmentModalDetails\(apt\);/);
  assert.match(stabilitySource, /const agendaBootFailsafeTimer = window\.setTimeout\(releaseAgendaBootShell, 4500\);/);
  assert.match(stabilitySource, /return baseOpenManualAppointmentModal\(dateYmd\);/);
  assert.match(stabilitySource, /return baseSubmitManualAppointment\(\);/);
  assert.doesNotMatch(stabilitySource, /Dit tijdstip is al voorbij/);
  assert.doesNotMatch(stabilitySource, /Je kunt geen afspraak in het verleden inplannen/);
  assert.doesNotMatch(stabilitySource, /isManualAppointmentStartInPast\(manualAppointmentSelectedDate/);
});

test('premium agenda toont Ruben planning uitleg alleen in AI beheer modus', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /Ruben Nijhuis plant afspraken in/);
  assert.doesNotMatch(pageSource, /Even alsof Ruben je dit mondeling vertelt/);
  assert.doesNotMatch(pageSource, /Zo zou Ruben je dag kunnen voorlezen/);
  assert.doesNotMatch(pageSource, /vervolgafspraak aansluit op het adres van de vorige stop/);
  assert.match(pageSource, /is het een rustige dag\./);
  assert.match(pageSource, /Geen afspraken, wel klantwerk op de planning\./);
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

test('premium agenda herlaadt afspraken met timeout-override bij verse handmatige opslag', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const expectedTimeoutCall = 'fetchJsonGetWithFallback(url, { timeoutMs: Number.isFinite(Number(options?.timeoutMs)) ? Number(options.timeoutMs) : 12000 })';

  assert.match(pageSource, /await loadServerAppointments\(\{\s*fresh:\s*true,\s*timeoutMs:\s*8000\s*\}\);/);
  assert.ok(pageSource.includes(expectedTimeoutCall));
  assert.doesNotMatch(
    pageSource,
    /const response = await fetch\(url,\s*\{\s*cache: 'no-store'\s*\}\);/
  );
});

test('premium agenda toont de pagina direct en laadt externe data daarna bij', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(
    pageSource,
    /applyInitialAgendaBootstrap\(\);\s*renderCalendar\(\);\s*renderWorkspaceReferenceImages\(\);\s*window\.SoftoraPremiumBoot\?\.setShellBooting\?\.\(false\);/
  );
  assert.match(pageSource, /await refreshKnownActiveOrdersIndex\(\)\.catch\(\(\) => null\);/);
  assert.match(pageSource, /await loadServerAppointments\(\{ fresh: true \}\)\.catch\(\(\) => null\);/);
});

test('premium agenda dwingt modal sluiting na geslaagde handmatige opslag', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.ok(pageSource.includes('function closeManualAppointmentModal(forceClose = false) {'));
  assert.ok(pageSource.includes('if (manualAppointmentSaving && !forceClose) return;'));
  assert.ok(pageSource.includes('closeManualAppointmentModal(true);'));
});

test('premium agenda dossierwerkruimte biedt audio-upload voor meetingnotities', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /assets\/premium-agenda-stability\.js/);
  assert.match(stabilitySource, /button\.id = 'notesAudioUploadBtn';/);
  assert.match(stabilitySource, /Audio toevoegen/);
  assert.match(stabilitySource, /input\.id = 'notesAudioUploadInput';/);
  assert.match(stabilitySource, /input\.accept = 'audio\/mpeg/);
  assert.match(stabilitySource, /async function handleAgendaNotesAudioUpload\(file, button, input\)/);
  assert.match(stabilitySource, /\/api\/ai\/notes-audio-to-text/);
  assert.match(stabilitySource, /result\.notes \|\| result\.summary \|\| result\.transcript/);
  assert.match(stabilitySource, /Meetingnotities uit audio[\s\S]*workspaceTranscriptEl\.value = currentNotes/);
  assert.match(stabilitySource, /button\.addEventListener\('click'/);
});
