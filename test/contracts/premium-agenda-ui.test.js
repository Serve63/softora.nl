const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium agenda modal uses dossier flow for appointments that already have an active order', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

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

test('premium agenda offers manual add flow on day click with business-hour notice', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.match(pageSource, /id="manualAppointmentOverlay"/);
  assert.match(pageSource, /name="manualAppointmentWho"/);
  assert.match(pageSource, /value="serve"/);
  assert.match(pageSource, /Servé/);
  assert.match(pageSource, /value="martijn"/);
  assert.match(pageSource, /Martijn/);
  assert.match(pageSource, /type="time"[^>]*id="manualAppointmentAvailableAgain"/);
  assert.match(pageSource, /\/api\/agenda\/appointments\/manual/);
  assert.match(pageSource, /data-calendar-date=/);
  assert.match(pageSource, /isManualAppointmentTimeAllowed/);
  assert.match(
    pageSource,
    /Afspraken die geen effect hebben op de werktijden[\s\S]*09:00[\s\S]*17:00[\s\S]*maandag[\s\S]*vrijdag[\s\S]*hier niet gemeld/i
  );
  assert.match(pageSource, /legend-dot manual-serve/);
  assert.match(pageSource, /Activiteit Servé/);
  assert.match(pageSource, /legend-dot manual-martijn/);
  assert.match(pageSource, /Activiteit Martijn/);
});

test('premium agenda handmatige afspraak-modal heeft geen locatieveld', () => {
  const pagePath = path.join(__dirname, '../../premium-personeel-agenda.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');

  assert.doesNotMatch(pageSource, /id="manualAppointmentLocation"/);
  assert.doesNotMatch(pageSource, /ensureAgendaPlacesReady/);
  assert.match(pageSource, /payload\.activity = activity/);
  assert.match(pageSource, /payload\.availableAgain = availableAgain/);
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
