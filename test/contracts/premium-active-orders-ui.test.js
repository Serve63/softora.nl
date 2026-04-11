const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('premium actieve opdrachten tonen geen losse naam-badge meer en gebruiken bevestigde factuur-betaald flow', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /const claimHtml = /);
  assert.doesNotMatch(source, /<div class="order-claim"/);
  assert.match(source, /<div class="order-actions">\s*<button class="execute-btn magnetic"/);
  assert.match(source, /const paymentButtonHtml = ui\.isBuilt\s*\?\s*''\s*:/);
  assert.match(source, /<button class="complete-btn magnetic" id="complete-btn-\$\{id\}" type="button" data-order-complete="\$\{id\}">\s*Factuur betaald\s*<\/button>/);
  assert.match(source, /\$\{paymentButtonHtml\}\s*<div class="order-assignee" id="assignee-\$\{id\}">\$\{escapeHtml\(claimInfo\.by \|\| 'Nog niet geclaimd'\)\}<\/div>/);
  assert.match(source, /completeBtnEl\.textContent = 'Factuur betaald';/);
  assert.match(source, /completeBtnEl\.hidden = isDelivered;/);
  assert.match(source, /completeBtnEl\.style\.display = isDelivered \? 'none' : '';/);
  assert.match(source, /assigneeEl\.textContent = claimInfo\.by \|\| 'Nog niet geclaimd';/);
  assert.match(source, /const isPaidOrder = Boolean\(paidAt\) \|\| status\.key === 'betaald';[\s\S]*if \(isPaidOrder\) \{[\s\S]*nextStatus = 'betaald';/);
  assert.match(source, /async function handleOrderPaymentAction\(id\) \{[\s\S]*if \(ui\.isPaid \|\| ui\.isBuilt\) return false;[\s\S]*return markOrderAsPaid\(id, \{ confirm: true \}\);/);
  assert.match(source, /window\.SoftoraDialogs && typeof window\.SoftoraDialogs\.confirm === 'function'[\s\S]*Factuur betaald bevestigen/);
  assert.match(source, /await persistRequiredUiStateKeysOrThrow\(\s*\[CUSTOM_ORDERS_KEY, ORDER_RUNTIME_KEY\],/);
  assert.match(source, /document\.querySelectorAll\('\.complete-btn'\)\.forEach\(\(b\) => \{[\s\S]*void handleOrderPaymentAction\(id\);/);
  assert.match(source, /window\.addEventListener\('pagehide', \(\) => \{[\s\S]*void flushRemoteUiStateSave\(\);/);
  assert.match(source, /leadOwnerName: String\(item\?\.leadOwnerName \|\| item\?\.leadOwnerFullName \|\| ''\)\.trim\(\),/);
  assert.match(source, /const linkedLeadOwnerName = resolveLinkedLeadOwnerNameForOrder\(customOrder\);[\s\S]*const claimedBy = normalizeClaimEmployeeName\(customOrder\.claimedBy \|\| runtime\.claimedBy \|\| linkedLeadOwnerName \|\| ''\);/);
  assert.match(source, /claimedBy: linkedLeadOwnerName \|\| null,/);
  assert.match(source, /companyName,\s*contactName: contactPerson,\s*contactPhone: linkedContactPhone,\s*contactEmail: linkedContactEmail,/);
  assert.match(source, /const companyName = String\(item\?\.companyName \|\| ''\)\.trim\(\);/);
  assert.match(source, /const contactName = String\(item\?\.contactName \|\| ''\)\.trim\(\);/);
});

test('premium actieve opdrachten gebruiken expliciete customer identity voor koppeling naar klanten', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const explicitCompany = String\(record\?\.companyName \|\| ''\)\.trim\(\);/);
  assert.match(source, /const explicitContact = String\(record\?\.contactName \|\| ''\)\.trim\(\);/);
  assert.match(source, /return `\$\{normalizeMatchValue\(company\)\}\|\$\{normalizeMatchValue\(name\)\}\|\$\{normalizeMatchValue\(explicitPhone\)\}`;/);
});

test('premium actieve opdrachten tonen create-order modal zonder sample-design en domeinvelden', () => {
  const filePath = path.join(__dirname, '../../premium-actieve-opdrachten.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /Voorbeelddesign meenemen als basis/);
  assert.doesNotMatch(source, /Gebruik dit als je de stijl\/richting van het voorbeelddesign wilt doorzetten in de echte build\./);
  assert.doesNotMatch(source, /Domeinnaam \(voor live launch\)/);
  assert.doesNotMatch(source, /Optioneel, maar nodig als je ook domein-koppeling\/registratie wilt automatiseren\./);
  assert.doesNotMatch(source, /id="newOrderIncludeSampleDesign"/);
  assert.doesNotMatch(source, /id="newOrderDomain"/);
});

test('premium opdrachtdossier laadt eerst een bestaand cache-item voordat opus opnieuw genereert', () => {
  const filePath = path.join(__dirname, '../../premium-opdracht-dossier.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /const DOSSIER_CACHE_KEY = 'softora_order_dossier_cache_v1';/);
  assert.match(source, /function buildDossierCacheFingerprint\(baseData\) \{/);
  assert.match(source, /function getCachedDossierLayoutResponse\(rawValue, orderId, fingerprint\) \{/);
  assert.match(source, /const cacheMap = parseDossierCacheMap\(rawValue\);[\s\S]*const entry = cacheMap\[String\(orderId\)\];/);
  assert.match(source, /if \(entryFingerprint && entryFingerprint === String\(fingerprint \|\| ''\)\.trim\(\)\) \{[\s\S]*return layoutResponse;/);
  assert.doesNotMatch(source, /window\.localStorage/);
  assert.doesNotMatch(source, /window\.sessionStorage/);
  assert.match(source, /async function persistDossierCache\(rawValue, orderId, fingerprint, layoutResponse\) \{/);
  assert.match(source, /await fetchUiStateSetWithFallback\(REMOTE_SCOPE, \{/);
  assert.match(source, /const cachedLayoutResponse = getCachedDossierLayoutResponse\(/);
  assert.match(source, /if \(cachedLayoutResponse\) \{[\s\S]*renderDossier\(baseData, cachedLayoutResponse\);/);
  assert.match(source, /void persistDossierCache\(values\?\.\[DOSSIER_CACHE_KEY\], orderId, dossierFingerprint, layoutResponse\);/);
});

test('premium opdrachtdossier toont de pdf-knop rechtsboven en laat de pagina volledig uitlopen', () => {
  const filePath = path.join(__dirname, '../../premium-opdracht-dossier.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /\.dossier-wrap \{[\s\S]*align-items:\s*stretch;/);
  assert.match(source, /\.page-toolbar \{[\s\S]*justify-content:\s*flex-end;[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
  assert.match(source, /\.toolbar-actions \{[\s\S]*justify-content:\s*flex-end;[\s\S]*margin-left:\s*auto;/);
  assert.match(source, /\.paper-stage \{[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.dossier-page \{[\s\S]*position:\s*relative;[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.page-body \{[\s\S]*overflow:\s*visible;/);
  assert.match(source, /root\.innerHTML = `\s*<div class="page-toolbar screen-only" id="pageToolbar" style="justify-content: flex-end;">[\s\S]*<div class="paper-shell" id="paperShell">/);
  assert.match(source, /function syncPaperScale\(\) \{[\s\S]*paperShell\.style\.setProperty\('--paper-scale', '1'\);/);
});
