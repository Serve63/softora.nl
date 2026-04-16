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
  assert.match(source, /const selectedAssignee = normalizeOrderAssignee\(data\.get\('assignee'\) \|\| linkedLeadOwnerName\);/);
  assert.match(source, /if \(!selectedAssignee \|\| !ORDER_ASSIGNEE_OPTIONS\.includes\(selectedAssignee\)\) \{[\s\S]*Kies wie deze opdracht krijgt toegewezen\./);
  assert.match(source, /claimedBy: selectedAssignee \|\| null,/);
  assert.match(source, /claimedAt: claimedAtIso,/);
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

  assert.match(source, /<label class="create-order-label" for="newOrderAssignee">Toegewezen aan<\/label>/);
  assert.match(source, /<select class="create-order-select" id="newOrderAssignee" name="assignee" required>/);
  assert.match(source, /<option value="">Kies medewerker<\/option>\s*<option value="Martijn">Martijn<\/option>\s*<option value="Servé">Servé<\/option>/);
  assert.match(source, /const ORDER_ASSIGNEE_OPTIONS = Object\.freeze\(\['Martijn', 'Servé'\]\);/);
  assert.match(source, /function normalizeOrderAssignee\(value\) \{[\s\S]*const words = normalized\.split\(\/\[\^a-z\]\+\/\)\.filter\(Boolean\);[\s\S]*if \(words\.includes\('serve'\)\) return 'Servé';[\s\S]*if \(words\.includes\('martijn'\)\) return 'Martijn';/);
  assert.match(source, /function normalizeClaimEmployeeName\(value\) \{[\s\S]*const canonicalAssignee = normalizeOrderAssignee\(value\);[\s\S]*if \(canonicalAssignee\) return canonicalAssignee;/);
  assert.match(source, /\.modal-btn\.danger \{[\s\S]*color:\s*var\(--accent-light\);/);
  assert.match(source, /\.modal-btn\.danger:hover \{[\s\S]*color:\s*var\(--accent-light\);/);
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
  assert.match(source, /const DOSSIER_LAYOUT_SCHEMA_VERSION = '20260416c';/);
  assert.match(source, /function buildDossierCacheFingerprint\(baseData\) \{/);
  assert.match(source, /layoutVersion: DOSSIER_LAYOUT_SCHEMA_VERSION,/);
  assert.match(source, /function getCachedDossierLayoutResponse\(rawValue, orderId, fingerprint\) \{/);
  assert.match(source, /const expectedFingerprint = String\(fingerprint \|\| ''\)\.trim\(\);[\s\S]*if \(!entryFingerprint \|\| !expectedFingerprint \|\| entryFingerprint !== expectedFingerprint\) \{[\s\S]*return null;/);
  assert.match(source, /function buildShortOpusPrompt\(baseData\) \{/);
  assert.match(source, /return 'Werk deze opdracht in Claude Opus 4\.6 uit op basis van uitsluitend de gekoppelde lead- en dossierinformatie\.';/);
  assert.match(source, /function shouldHideLegacyDossierBlockTitle\(value\) \{[\s\S]*normalized === 'uitvoerplan'[\s\S]*normalized === 'uitvoerfocus'[\s\S]*normalized\.startsWith\('ontbrekende informatie'\)[\s\S]*normalized\.startsWith\('praktische aandachtspunten'\)/);
  assert.match(source, /function normalizeDossierPairLabel\(value\) \{[\s\S]*normalized === 'accounthouder softora' \|\| normalized === 'softora contactpersoon'[\s\S]*return ''[\s\S]*normalized === 'geclaimd door' \? 'Aangewezen aan' : label;/);
  assert.match(source, /const prompt = buildShortOpusPrompt\(baseData\);/);
  assert.match(source, /label: 'Aangewezen aan', value: baseData\.claimedBy \|\| '—'/);
  assert.match(source, /const cacheMap = parseDossierCacheMap\(rawValue\);[\s\S]*const entry = cacheMap\[String\(orderId\)\];/);
  assert.doesNotMatch(source, /window\.localStorage/);
  assert.doesNotMatch(source, /window\.sessionStorage/);
  assert.match(source, /async function persistDossierCache\(rawValue, orderId, fingerprint, layoutResponse\) \{/);
  assert.match(source, /await fetchUiStateSetWithFallback\(REMOTE_SCOPE, \{/);
  assert.match(source, /const cachedLayoutResponse = getCachedDossierLayoutResponse\(/);
  assert.match(source, /const opusPrompt = buildShortOpusPrompt\(baseData\);/);
  assert.match(source, /if \(shouldHideLegacyDossierBlockTitle\(title\)\) return null;/);
  assert.match(source, /if \(cachedLayoutResponse\) \{[\s\S]*renderDossier\(baseData, cachedLayoutResponse\);/);
  assert.match(source, /void persistDossierCache\(values\?\.\[DOSSIER_CACHE_KEY\], orderId, dossierFingerprint, layoutResponse\);/);
  assert.doesNotMatch(source, /source-chip/);
  assert.doesNotMatch(source, /Dynamisch via/);
  assert.doesNotMatch(source, /Klantwensen \(bron\):/);
  assert.doesNotMatch(source, /Werk praktisch en concreet, zonder vage algemeenheden\./);
  assert.doesNotMatch(source, /title: 'Uitvoerfocus'/);
});

test('server opdrachtdossier filtert legacy planningsblokken en houdt de opus prompt kort', () => {
  const filePath = path.join(__dirname, '../../server.js');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.match(source, /function buildShortOrderDossierOpusPrompt\(options = \{\}\) \{/);
  assert.match(source, /return 'Werk deze opdracht in Claude Opus 4\.6 uit op basis van uitsluitend de gekoppelde lead- en dossierinformatie\.';/);
  assert.match(source, /function shouldHideOrderDossierBlockTitle\(value\) \{[\s\S]*normalized === 'uitvoerplan'[\s\S]*normalized === 'uitvoerfocus'[\s\S]*normalized\.startsWith\('ontbrekende informatie'\)[\s\S]*normalized\.startsWith\('praktische aandachtspunten'\)/);
  assert.match(source, /function normalizeOrderDossierPairLabel\(value\) \{[\s\S]*normalized === 'accounthouder softora' \|\| normalized === 'softora contactpersoon'[\s\S]*return ''[\s\S]*normalized === 'geclaimd door' \? 'Aangewezen aan' : label;/);
  assert.match(source, /const promptText = buildShortOrderDossierOpusPrompt\(input\);/);
  assert.match(source, /const opusPrompt = buildShortOrderDossierOpusPrompt\(fallbackOptions\);/);
  assert.match(source, /if \(shouldHideOrderDossierBlockTitle\(title\)\) return null;/);
  assert.match(source, /label: 'Aangewezen aan', value: input\.claimedBy \|\| '—'/);
  assert.match(source, /Gebruik geen bloktitels zoals "Uitvoerplan", "Ontbrekende informatie" of "Praktische aandachtspunten"\./);
  assert.match(source, /Voeg geen interne velden toe zoals "Accounthouder Softora" of "Softora-contactpersoon"\./);
  assert.match(source, /Laat interne Softora-contactvelden zoals account- of contactpersoonlabels weg\./);
  assert.match(source, /- opusPrompt moet direct bruikbaar zijn voor Claude Opus 4\.6 en exact 1 zin lang zijn\./);
  assert.doesNotMatch(source, /Klantwensen \(bron\):/);
  assert.doesNotMatch(source, /title: 'Uitvoerfocus'/);
});

test('premium opdrachtdossier toont de pdf-knop rechtsboven en laat de pagina volledig uitlopen', () => {
  const filePath = path.join(__dirname, '../../premium-opdracht-dossier.html');
  const source = fs.readFileSync(filePath, 'utf8');

  assert.doesNotMatch(source, /Uitvoerdossier voor uitvoering/);
  assert.doesNotMatch(source, /Dynamisch uitvoerdossier op basis van actuele opdrachtinformatie\./);
  assert.match(source, /\.dossier-wrap \{[\s\S]*align-items:\s*stretch;/);
  assert.match(source, /\.page-toolbar \{[\s\S]*justify-content:\s*flex-end;[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;/);
  assert.match(source, /\.toolbar-actions \{[\s\S]*justify-content:\s*flex-end;[\s\S]*margin-left:\s*auto;/);
  assert.match(source, /\.paper-stage \{[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.dossier-page \{[\s\S]*position:\s*relative;[\s\S]*height:\s*auto;[\s\S]*overflow:\s*visible;/);
  assert.match(source, /\.page-body \{[\s\S]*overflow:\s*visible;/);
  assert.match(source, /root\.innerHTML = `\s*<div class="page-toolbar screen-only" id="pageToolbar" style="justify-content: flex-end;">[\s\S]*<div class="paper-shell" id="paperShell">/);
  assert.match(source, /function syncPaperScale\(\) \{[\s\S]*paperShell\.style\.setProperty\('--paper-scale', '1'\);/);
});
