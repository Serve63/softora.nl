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
  assert.match(pageSource, /\.topbar > \.topbar-right,\s*\.topbar > \[data-agenda-owner-score\],\s*\.topbar \.coldmail-sender-score \{\s*display: none !important;/);
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

test('premium agenda modal uses top icons for edit/delete and supports vervolg as open lead', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const followUpPath = path.join(__dirname, '../../assets/premium-agenda-follow-up.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const followUpSource = fs.readFileSync(followUpPath, 'utf8');

  assert.match(pageSource, /id="modalEditBtn"[^>]*aria-label="Gegevens wijzigen"/);
  assert.match(pageSource, /id="modalDeleteBtn"[^>]*aria-label="Afspraak verwijderen"/);
  assert.match(pageSource, /id="modalFollowUpBtn"[^>]*>Vervolg<\/button>/);
  assert.match(pageSource, /assets\/premium-agenda-follow-up\.js\?v=20260516a/);
  assert.doesNotMatch(pageSource, />\s*Gegevens wijzigen\s*<\/button>/i);
  assert.doesNotMatch(pageSource, /id="modalDeleteBtn"[^>]*>Verwijderen<\/button>/i);
  assert.match(followUpSource, /function saveFollowUpLeadForActiveAppointment\(\)/);
  assert.match(followUpSource, /status: 'lead_follow_up'/);
  assert.match(followUpSource, /Vervolg staat bij openstaande leads\./);
  assert.match(followUpSource, /event\.stopImmediatePropagation\(\);/);
});

test('premium agenda workspace locks modal exit while dossier flow is still mandatory', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /<button class="modal-close magnetic" id="modalCloseBtn"/);
  assert.match(pageSource, /assets\/premium-agenda-stability\.js/);
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
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="manualAppointmentOverlay"/);
  assert.match(pageSource, /Wat wil je inplannen\?/);
  assert.match(pageSource, /data-manual-kind="meeting"/);
  assert.match(pageSource, /data-manual-kind="overig"/);
  assert.match(pageSource, /\.manual-appointment-choice:focus \{[\s\S]*outline: none;/);
  assert.match(pageSource, /\.manual-appointment-choice:focus-visible,[\s\S]*\.manual-appointment-choice\.is-active \{[\s\S]*border-color: var\(--accent\);/);
  assert.match(pageSource, /manualAppointmentKind = 'meeting';/);
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
  assert.match(pageSource, /Wie heeft deze lead geregeld\?/);
  assert.match(pageSource, /Voor wie\?/);
  assert.match(pageSource, /id="manualAppointmentWhoLabel"/);
  assert.match(pageSource, /id="manualAppointmentWhoChoices"/);
  assert.match(pageSource, /\.manual-appointment-choice-grid--who \{[\s\S]*display: flex;[\s\S]*flex-wrap: nowrap;/);
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
  assert.match(pageSource, /function syncManualAppointmentDetailsMode\(/);
  assert.match(pageSource, /whoLabel\.textContent = isMeeting \? 'Wie heeft deze lead geregeld\?' : 'Voor wie\?';/);
  assert.match(pageSource, /bothChoice\.hidden = isMeeting;/);
  assert.match(pageSource, /if \(isMeeting && manualAppointmentWho === 'both'\) manualAppointmentWho = '';/);
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
  assert.match(pageSource, /const who = isMeeting \? 'both' : String\(manualAppointmentWho \|\| ''\)\.trim\(\);/);
  assert.match(pageSource, /const leadOwnerKey = isMeeting && \(manualAppointmentWho === 'serve' \|\| manualAppointmentWho === 'martijn'\) \? manualAppointmentWho : '';/);
  assert.match(pageSource, /Kies wie deze lead heeft geregeld\./);
  assert.match(pageSource, /Kies voor wie deze afspraak is\./);
  assert.match(pageSource, /legendChoice,/);
  assert.match(pageSource, /appointmentKind: manualAppointmentKind,/);
  assert.match(pageSource, /manualLeadOwner: leadOwnerKey,/);
  assert.match(pageSource, /who,/);
  assert.match(pageSource, /notes,/);
  assert.match(pageSource, /manualLeadOwnerKey: String\(item\.manualLeadOwnerKey \|\| item\.leadOwnerKey \|\| ''\),/);
  assert.match(pageSource, /leadOwnerKey: String\(item\.leadOwnerKey \|\| item\.manualLeadOwnerKey \|\| ''\),/);
  assert.match(pageSource, /googleCalendarOwner: String\(item\.googleCalendarOwner \|\| ''\),/);
  assert.match(pageSource, /if \(manualLegendChoice === 'business'\) return 'appointment meeting magnetic meeting--business';/);
  assert.match(pageSource, /if \(who === 'overig'\) return 'appointment manual-overig magnetic';/);
  assert.match(pageSource, /if \(who === 'both' \|\| who === 'allebei' \|\| who === 'beide'\) return 'appointment manual-both magnetic';/);
  assert.match(pageSource, /return 'appointment manual-both magnetic';\s*\}\s*const line = resolveAgendaMeetingProductLine/);
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

test('premium agenda herstelt handmatige activiteitknoppen en boot-failsafe', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const stabilityPath = path.join(__dirname, '../../assets/premium-agenda-stability.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const stabilitySource = fs.readFileSync(stabilityPath, 'utf8');

  assert.match(pageSource, /assets\/premium-agenda-stability\.js/);
  assert.match(pageSource, /window\.SoftoraAgendaStability\.finishBoot\(\);/);
  assert.match(stabilitySource, /function isManualAgendaAppointment\(item\)/);
  assert.match(stabilitySource, /function isManualOtherAppointment\(apt\)/);
  assert.match(stabilitySource, /choice === 'manual-overig' \|\| choice === 'manual-serve' \|\| choice === 'manual-martijn' \|\| choice === 'manual-both'/);
  assert.match(stabilitySource, /apt\.manualPlannerWho \|\| apt\.manualWho \|\| 'both'/);
  assert.match(stabilitySource, /if \(!isMeeting && !manualAppointmentWho\) manualAppointmentWho = 'both';/);
  assert.match(stabilitySource, /modalPrimaryBtn\.textContent = completed \? 'Activiteit afgerond' : 'Activiteit afronden';/);
  assert.match(stabilitySource, /async function markActiveManualActivityCompleted\(\)/);
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
  assert.match(stabilitySource, /Transcriptie audiobestand[\s\S]*workspaceTranscriptEl\.value = currentNotes/);
  assert.match(stabilitySource, /button\.addEventListener\('click'/);
});
