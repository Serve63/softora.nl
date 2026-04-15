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
    /function isWorkspaceLoadingVisible\(\) \{\s*return Boolean\(workspaceLoadingOverlay && workspaceLoadingOverlay\.classList\.contains\('show'\)\);\s*\}/
  );
  assert.match(
    pageSource,
    /function isWorkspaceExitLocked\(\) \{\s*return modalWorkspaceMode && \(workspaceBusy \|\| workspacePendingCustomerCheck \|\| isWorkspaceLoadingVisible\(\)\);\s*\}/
  );
  assert.match(
    pageSource,
    /function syncWorkspaceExitControls\(\) \{[\s\S]*modalCloseBtn\.hidden = shouldLockExit;[\s\S]*modalSecondaryBtn\.disabled = shouldLockExit;/
  );
  assert.match(
    pageSource,
    /function setWorkspaceLoading\(loading\) \{[\s\S]*workspaceLoadingOverlay\.classList\.toggle\('show', loading\);[\s\S]*workspaceLoadingOverlay\.setAttribute\('aria-hidden', loading \? 'false' : 'true'\);[\s\S]*syncWorkspaceExitControls\(\);[\s\S]*\}/
  );
  assert.match(pageSource, /workspaceSuccessTitle\.hidden = true;/);
  assert.match(
    pageSource,
    /modalPrimaryBtn\.textContent = workspacePendingCustomerCheck \? 'Dossier aanmaken' : 'Open dossier';/
  );
  assert.match(pageSource, /modalPrimaryBtn\.disabled = workspaceBusy \|\| workspacePendingCustomerCheck;/);
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
