const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
const { findUnsafeCredentialFixtures } = require('../testlib/credential-fixture-safety');

const TEST_WRITE_PROOF = 'test-write-proof-v1';

test('premium wachtwoordenregister gebruikt dashboard-typografie en persistente editflow', () => {
  const pagePath = path.join(__dirname, '../../premium-wachtwoordenregister.html');
  const rendererPath = path.join(__dirname, '../../assets/premium-password-register-renderer.js');
  const storePath = path.join(__dirname, '../../assets/premium-password-register-store.js');
  const pinPath = path.join(__dirname, '../../assets/premium-password-register-pin.js');
  const securityPath = path.join(__dirname, '../../assets/premium-password-register-security.js');
  const autoLockPath = path.join(__dirname, '../../assets/premium-password-register-autolock.js');
  const themeBootPath = path.join(__dirname, '../../assets/premium-password-register-theme-boot.js');
  const appPath = path.join(__dirname, '../../assets/premium-password-register-app.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const rendererSource = fs.readFileSync(rendererPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const pinSource = fs.readFileSync(pinPath, 'utf8');
  const securitySource = fs.readFileSync(securityPath, 'utf8');
  const autoLockSource = fs.readFileSync(autoLockPath, 'utf8');
  const themeBootSource = fs.readFileSync(themeBootPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');
  const combinedSource = `${pageSource}\n${rendererSource}\n${storeSource}\n${pinSource}\n${securitySource}\n${autoLockSource}\n${themeBootSource}\n${appSource}`;
  const executableScriptSources = Array.from(pageSource.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi))
    .map((match) => match[1]);

  assert.deepEqual(executableScriptSources, [
    'assets/premium-password-register-theme-boot.js?v=20260804a',
    'assets/premium-password-register-renderer.js?v=20260427a',
    'assets/premium-password-register-store.js?v=20260804a',
    'assets/premium-password-register-pin.js?v=20260804a',
    'assets/premium-password-register-security.js?v=20260804a',
    'assets/premium-password-register-autolock.js?v=20260804a',
    'assets/premium-password-register-app.js?v=20260804a',
  ]);
  assert.doesNotMatch(pageSource, /personnel-theme\.js|premium-boot-one-second\.js|premium-sidebar-profile-prefill\.js/);

  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
  assert.match(pageSource, /<html lang="nl" data-password-register-csp-ready="1">/);
  assert.doesNotMatch(pageSource, /Barlow/);
  assert.doesNotMatch(pageSource, /<div class="reg-logo">SOFTORA\.NL<\/div>/);
  assert.doesNotMatch(pageSource, /cat-bar/);
  assert.doesNotMatch(pageSource, /Alle<\/button>/);
  assert.doesNotMatch(pageSource, /Hosting<\/button>/);
  assert.doesNotMatch(pageSource, /Tools<\/button>/);
  assert.doesNotMatch(pageSource, /Socials<\/button>/);

  assert.match(pageSource, /\.reg-title\s*\{[\s\S]*font-family:\s*'Oswald', sans-serif;[\s\S]*font-size:\s*3rem;/s);
  assert.match(pageSource, /\.main-content\s*\{[\s\S]*padding:\s*3rem 3rem 1\.8rem;/s);
  assert.match(pageSource, /assets\/premium-password-register-renderer\.js\?v=20260427a/);
  assert.match(pageSource, /assets\/premium-password-register-theme-boot\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-security\.css\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-store\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-pin\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-security\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-autolock\.js\?v=20260804a/);
  assert.match(pageSource, /assets\/premium-password-register-app\.js\?v=20260804a/);
  assert.match(rendererSource, /global\.SoftoraPasswordRegisterRenderer/);
  assert.match(storeSource, /global\.SoftoraPasswordRegisterStore/);
  assert.match(storeSource, /var PASSWORD_REGISTER_SCOPE = "premium_password_register";/);
  assert.match(storeSource, /var PASSWORD_REGISTER_ENCRYPTED_KEY = "entries_encrypted_v1";/);
  assert.match(storeSource, /var PASSWORD_REGISTER_LEGACY_ENTRIES_KEY = "entries_json";/);
  assert.match(storeSource, /AES-GCM/);
  assert.match(storeSource, /PBKDF2-SHA256/);
  assert.match(storeSource, /PASSWORD_REGISTER_CURRENT_ENVELOPE_VERSION = 2/);
  assert.match(storeSource, /PASSWORD_REGISTER_LEGACY_KDF_ITERATIONS = 210000/);
  assert.match(storeSource, /PASSWORD_REGISTER_CURRENT_KDF_ITERATIONS = 600000/);
  assert.match(storeSource, /PASSWORD_REGISTER_MIN_MASTER_SECRET_LENGTH = 20/);
  assert.match(storeSource, /cryptoObj\.subtle/);
  assert.match(storeSource, /fetchUiStateReadAuthoritative\(PASSWORD_REGISTER_SCOPE, writeProof\)/);
  assert.match(storeSource, /"\/api\/ui-state-read\?scope=" \+ encodedScope/);
  assert.match(storeSource, /body:\s*JSON\.stringify\(\{ writeProof: String\(writeProof \|\| ""\) \}\)/);
  assert.match(storeSource, /fetchUiStateSetAuthoritative\(PASSWORD_REGISTER_SCOPE, payload\)/);
  assert.match(storeSource, /result\.source !== "supabase"/);
  assert.match(storeSource, /result\.ok !== true/);
  assert.match(storeSource, /result\.scope !== expectedScope/);
  assert.match(storeSource, /expectedRevision:\s*expectedRevision/);
  assert.match(storeSource, /expectedUpdatedAt:\s*expectedUpdatedAt/);
  assert.match(storeSource, /writeProof:\s*confirmedWriteProof/);
  assert.match(storeSource, /writeQueue = queued\.then\([\s\S]*return undefined;[\s\S]*return undefined;/);
  assert.doesNotMatch(storeSource, /writeQueue = queued\.catch/);
  assert.doesNotMatch(storeSource, /\/api\/ui-state-get|X-Softora-Password-Register-Proof/);
  assert.match(storeSource, /"X-Softora-Requested-With": "premium"/);
  assert.match(storeSource, /credentials:\s*"same-origin"/);
  assert.doesNotMatch(storeSource, /actionConfirmCode|actionConfirmScope/);
  assert.doesNotMatch(storeSource, /SoftoraUiStateClient|readBootstrap|WithFallback/);
  assert.match(storeSource, /\[PASSWORD_REGISTER_ENCRYPTED_KEY\]: JSON\.stringify\(encryptedPayload\)/);
  assert.match(storeSource, /\[PASSWORD_REGISTER_LEGACY_ENTRIES_KEY\]: ""/);
  assert.match(appSource, /global\.SoftoraPasswordRegisterStore\.create/);
  assert.match(appSource, /passwordRegisterStore\.unlock\(masterSecret, writeProof\)/);
  assert.match(appSource, /passwordRegisterStore\.persist\([\s\S]*getActiveVaultWriteProof\(\)/);
  assert.match(pageSource, /id="master-secret-overlay"/);
  assert.match(pageSource, /id="master-secret-input"/);
  assert.match(pageSource, /class="master-secret-modal"/);
  assert.match(pageSource, />Ontgrendelen</);
  assert.doesNotMatch(pageSource, /Voer dezelfde master-wachtzin/);
  assert.doesNotMatch(pageSource, /Softora slaat hem niet op/);
  assert.doesNotMatch(`${pageSource}\n${appSource}`, /Kluis openen/);
  assert.doesNotMatch(pageSource, /id="master-secret-cancel"/);
  assert.doesNotMatch(appSource, /masterSecretCancelEl/);
  assert.match(appSource, /openMasterSecretDialog/);
  assert.match(appSource, /finishMasterSecretDialog/);
  assert.match(appSource, /passwordRegisterStore\.unlock\(masterSecret, writeProof\)/);
  assert.doesNotMatch(appSource, /global\.prompt\(/);
  assert.doesNotMatch(appSource, /window\.prompt\(/);
  assert.match(pinSource, /global\.SoftoraPasswordRegisterPin/);
  assert.match(securitySource, /global\.SoftoraPasswordRegisterSecurity/);
  assert.match(autoLockSource, /global\.SoftoraPasswordRegisterAutoLock/);
  assert.match(autoLockSource, /DEFAULT_INACTIVITY_MS = 5 \* 60 \* 1000/);
  assert.match(autoLockSource, /visibilitychange/);
  assert.match(autoLockSource, /pagehide/);
  assert.match(autoLockSource, /lock\("blur"\)/);
  assert.match(autoLockSource, /resume-timeout/);
  assert.match(storeSource, /hosting@example\.test/);
  assert.match(storeSource, /Voorbeeldgegevens geladen\. Vervang deze en sla daarna op om echte gegevens versleuteld te bewaren\./);
  assert.doesNotMatch(pageSource, /DEFAULT_PASSWORD_ENTRIES|fetchUiStateGetWithFallback|fetchUiStateSetWithFallback|PASSWORD_REGISTER_SCOPE/);
  assert.doesNotMatch(pageSource, /passwordRegisterStore|passwordRegisterPin|entryModalMode|saveEntryFromModal|persistPasswordEntries/);
  assert.doesNotMatch(pageSource, /persistPasswordEntries\('bootstrap'\)/);
  const contractSource = fs.readFileSync(__filename, 'utf8');
  assert.deepEqual(findUnsafeCredentialFixtures(combinedSource, { allowPasswordFields: true }), []);
  assert.deepEqual(findUnsafeCredentialFixtures(contractSource), []);
  assert.match(appSource, /openEditModal\(/);
  assert.match(appSource, /openCreateModal\(/);
  assert.match(pageSource, /class="add-entry-btn"/);
  assert.match(pageSource, /id="add-entry-btn"/);
  assert.match(rendererSource, /className:\s*"btn-edit"/);
  assert.match(rendererSource, /className:\s*"btn-del"/);
  assert.match(appSource, /openDeleteEntryModal\(/);
  assert.match(appSource, /confirmDeletePasswordEntry/);
  assert.doesNotMatch(combinedSource, /onclick=/);
  assert.doesNotMatch(combinedSource, /innerHTML/);
  assert.match(pageSource, /data-pin-digit="1"/);
  assert.match(pageSource, /data-pin-action="clear"/);
  assert.match(pageSource, /data-pin-action="backspace"/);
  assert.match(pageSource, /id="lock-register-btn"/);
  assert.match(appSource, /global\.SoftoraPasswordRegisterPin\.create/);
  assert.match(appSource, /onBeforeLock:\s*function \(\) \{\s*secureLockCleanup\(\)/);
  assert.match(appSource, /onLock:\s*function \(\) \{\s*passwordRegisterPin\.lock\(\)/);
  assert.match(appSource, /passwordRegisterPin\.bindNumpad\(pinNumpadEl\)/);
  assert.match(appSource, /passwordRegisterPin\.bindKeyboard\(document\)/);
  assert.match(appSource, /lockRegisterBtnEl\.addEventListener\("click", passwordRegisterPin\.lock\)/);
  assert.match(appSource, /secureLockCleanup/);
  assert.match(appSource, /SoftoraPasswordRegisterSecurity\.wipeEntries\(entries\)/);
  assert.match(appSource, /editGeneration !== vaultSessionGeneration[\s\S]*wipeEntries\(\[existingEntry\]\)/);
  assert.match(appSource, /SoftoraPasswordRegisterSecurity\.clearSensitiveUi/);
  assert.match(appSource, /passwordRegisterAutoLock\.start\(\)/);
  assert.doesNotMatch(pageSource, /function p\(|function pb\(|function pClear\(|function dots\(|function check\(/);
  assert.match(pinSource, /function createPinController/);
  assert.match(pinSource, /bindNumpad: bindNumpad/);
  assert.match(pinSource, /bindKeyboard: bindKeyboard/);
  assert.match(rendererSource, /button\.dataset\.entryAction = config\.action/);
  assert.match(rendererSource, /action:\s*"toggle"/);
  assert.match(rendererSource, /action:\s*"edit"/);
  assert.match(rendererSource, /action:\s*"delete"/);
  assert.match(appSource, /renderer\.createEntryRow\(entry, Boolean\(visible\[entry\.id\]\)\)/);
  assert.match(appSource, /passwordListEl\.replaceChildren/);
  assert.match(rendererSource, /textContent = isVisible \? normalize\(entry && entry\.pw\)/);
  assert.match(appSource, /passwordListEl\.addEventListener\("click"/);
  assert.match(appSource, /searchInputEl\.addEventListener\("input", render\)/);
  assert.match(rendererSource, /a2\.12 2\.12 0 113 3L7 19l-4 1 1-4 12\.5-12\.5z/);
  assert.match(appSource, /entryModalMode === "create"/);
  assert.match(appSource, /persistPasswordEntries\("create"\)/);
  assert.match(appSource, /saveEntryFromModal/);
  assert.match(pageSource, /id="entry-modal"/);
  assert.match(pageSource, /id="entry-user"/);
  assert.match(pageSource, /id="entry-password"/);
  assert.match(pageSource, /id="entry-password"[^>]*type="password"/);
  assert.match(pageSource, /id="entry-password-toggle"[^>]*aria-pressed="false"/);
  assert.match(pageSource, /id="change-master-secret-btn"/);
  assert.match(pageSource, /id="master-secret-current-input"[^>]*type="password"/);
  assert.match(pageSource, /id="master-secret-confirm-input"[^>]*type="password"/);
  assert.match(pageSource, /id="master-secret-pin-input"[^>]*type="password"[^>]*maxlength="6"/);
  assert.match(pageSource, /wisselen van tab of venster vergrendelt de kluis en wist niet-opgeslagen wijzigingen/);
  assert.match(appSource, /passwordRegisterStore\.changeMasterSecret/);
  assert.match(appSource, /passwordRegisterPin\.verifyFreshPin\(rawPin\)/);
  assert.match(appSource, /if \(!request \|\| typeof request !== "object"\) \{\s*passwordRegisterPin\.lock\(\)/);
  assert.match(appSource, /request\.pin = "";[\s\S]*verifyFreshPin\(rawPin\);[\s\S]*rawPin = "";[\s\S]*changeMasterSecret/);
  assert.match(appSource, /expectedGeneration !== vaultSessionGeneration[\s\S]*getVaultFailureMessage\(error\)/);
  assert.match(appSource, /VAULT_WRITE_PROOF_MAX_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(appSource, /vaultWriteProofTimer = global\.setTimeout\(function \(\) \{\s*clearVaultWriteProof\(\);\s*passwordRegisterPin\.lock\(\)/);
  assert.match(appSource, /function secureLockCleanup\(\) \{[\s\S]*clearVaultWriteProof\(\)/);
  assert.match(appSource, /if \(!masterSecret\) \{\s*clearVaultWriteProof\(\)/);
  assert.match(appSource, /async function unlockRegister\(verification\)[\s\S]*finally \{[\s\S]*masterSecret = "";/);
  assert.match(appSource, /entryPasswordEl\.type = willShow \? "text" : "password"/);
  assert.doesNotMatch(pageSource, /const PIN\s*=\s*['"][0-9]{6}['"]/);
  assert.match(pinSource, /fetch\("\/api\/premium-users\/verify-pin"/);
  assert.match(pinSource, /actionConfirmCode:\s*rawPin/);
  assert.match(pinSource, /actionConfirmScope:\s*"password-register"/);
  assert.match(pinSource, /data\.ok !== true/);
  assert.match(pinSource, /config\.unlock\(verification\)/);
  assert.match(pinSource, /catch\(function \(error\)[\s\S]*verification\.writeProof = "";[\s\S]*setMessage/);
  assert.match(pinSource, /data\.writeProofExpiresAt/);
  assert.match(pinSource, /new global\.AbortController\(\)/);
  assert.match(pinSource, /controller\.abort\(\);[\s\S]*10000/);
  assert.match(pinSource, /function lock\(\) \{\s*abortPendingVerification\(\)/);
  assert.match(pinSource, /credentials:\s*"same-origin"/);
  assert.match(pinSource, /"X-Softora-Requested-With": "premium"/);
  assert.doesNotMatch(pageSource, /SOFTORA_PAGE_STATE_BOOTSTRAP|premium-ui-state-client\.js/);
  assert.doesNotMatch(combinedSource, /console\.(?:log|info|debug|warn|error)\s*\(/);
  assert.doesNotMatch(combinedSource, /\b(?:localStorage|sessionStorage|indexedDB|navigator\.clipboard)\b/);
  assert.doesNotMatch(combinedSource, /document\.execCommand\s*\(/);
  assert.match(storeSource, /finally \{\s*wipeEntries\(parsedEntries\);\s*decryptedBytes\.fill\(0\);/);
  assert.match(storeSource, /finally \{\s*wipeEntries\(loadedEntries\);\s*\}/);
  for (const scriptTag of pageSource.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    assert.match(scriptTag[1], /\bsrc=/, 'uitvoerbare scripts moeten externe self-assets zijn');
    assert.equal(scriptTag[2].trim(), '');
  }
});

function loadPasswordRegisterStoreWithUiState(initialValues = {}, loadOptions = {}) {
  const storePath = path.join(__dirname, '../../assets/premium-password-register-store.js');
  const source = fs.readFileSync(storePath, 'utf8');
  const postBodies = [];
  const requests = [];
  let values = { ...initialValues };
  let revision = Object.prototype.hasOwnProperty.call(loadOptions, 'initialRevision')
    ? Number(loadOptions.initialRevision)
    : (Object.keys(values).length ? 1 : 0);
  let updatedAt = Object.prototype.hasOwnProperty.call(loadOptions, 'initialUpdatedAt')
    ? loadOptions.initialUpdatedAt
    : (revision > 0 ? '2026-08-04T12:00:01.000Z' : null);
  let getCount = 0;

  function nextUpdatedAt() {
    return `2026-08-04T12:00:${String(revision).padStart(2, '0')}.000Z`;
  }

  function makeJsonResponse(status, data) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    };
  }

  function advanceRemote(patch = {}) {
    values = { ...values, ...patch };
    revision += 1;
    updatedAt = nextUpdatedAt();
  }

  const window = {
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  const context = {
    window,
    fetch: async (url, fetchOptions = {}) => {
      const method = String(fetchOptions.method || 'GET').toUpperCase();
      requests.push({ url: String(url), method });
      if (String(url).startsWith('/api/ui-state-read?')) {
        getCount += 1;
        const readBody = JSON.parse(String(fetchOptions.body || '{}'));
        if (readBody.writeProof !== TEST_WRITE_PROOF) {
          return makeJsonResponse(403, {
            ok: false,
            code: 'PASSWORD_REGISTER_WRITE_PROOF_INVALID',
            error: 'Beveiligingsbevestiging ongeldig.',
          });
        }
        if (loadOptions.failGet) {
          return makeJsonResponse(503, { ok: false, error: 'fixture unavailable' });
        }
        const responseData = {
          ok: loadOptions.getResultOk !== false,
          scope: loadOptions.getScope || 'premium_password_register',
          source: loadOptions.getSource || 'supabase',
          values: { ...values },
          revision,
          updatedAt,
        };
        if (loadOptions.omitRevision) delete responseData.revision;
        if (loadOptions.omitUpdatedAt) delete responseData.updatedAt;
        return makeJsonResponse(200, responseData);
      }
      if (fetchOptions.method === 'POST') {
        const body = JSON.parse(String(fetchOptions.body || '{}'));
        postBodies.push(body);
        const postIndex = postBodies.length;
        if (typeof loadOptions.waitForPost === 'function') {
          await loadOptions.waitForPost(body, postIndex);
        }
        if (body.writeProof !== TEST_WRITE_PROOF) {
          return makeJsonResponse(403, {
            ok: false,
            code: 'PASSWORD_REGISTER_WRITE_PROOF_INVALID',
            error: 'Beveiligingsbevestiging ongeldig.',
          });
        }
        if (
          body.expectedRevision !== revision ||
          body.expectedUpdatedAt !== updatedAt
        ) {
          return makeJsonResponse(409, {
            ok: false,
            code: 'PASSWORD_REGISTER_REVISION_CONFLICT',
            error: 'De kluis is intussen gewijzigd.',
            revision,
            updatedAt,
          });
        }
        advanceRemote(body.patch || {});
        if (
          loadOptions.throwAfterCommit === true ||
          (typeof loadOptions.throwAfterCommit === 'function' && loadOptions.throwAfterCommit(body, postIndex))
        ) {
          throw new Error('Verbinding verbroken nadat Supabase de wijziging mogelijk opsloeg.');
        }
        return makeJsonResponse(200, {
          ok: true,
          scope: 'premium_password_register',
          source: loadOptions.postSource || 'supabase',
          values: { ...values },
          revision,
          updatedAt,
        });
      }
      throw new Error(`Onverwacht testverzoek: ${method} ${url}`);
    },
    AbortController,
    Buffer,
    TextDecoder,
    TextEncoder,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const rawCreateStore = context.window.SoftoraPasswordRegisterStore.create;
  return {
    createStore: (storeOptions) => {
      const store = rawCreateStore(storeOptions);
      return Object.assign({}, store, {
        changeMasterSecret: (currentSecret, newSecret, entries, actor, writeProof = TEST_WRITE_PROOF) =>
          store.changeMasterSecret(currentSecret, newSecret, entries, actor, writeProof),
        load: (masterSecret, writeProof = TEST_WRITE_PROOF) => store.load(masterSecret, writeProof),
        persist: (entries, actor, writeProof = TEST_WRITE_PROOF) => store.persist(entries, actor, writeProof),
        unlock: (masterSecret, writeProof = TEST_WRITE_PROOF) => store.unlock(masterSecret, writeProof),
      });
    },
    advanceRemote,
    getGetCount: () => getCount,
    getPostBodies: () => postBodies.slice(),
    getRequests: () => requests.slice(),
    getRevision: () => revision,
    getUpdatedAt: () => updatedAt,
    getValues: () => ({ ...values }),
  };
}

test('premium wachtwoordenregister faalt gesloten als de kluis niet kan worden geladen', async () => {
  const harness = loadPasswordRegisterStoreWithUiState({}, { failGet: true });
  const store = harness.createStore();

  await assert.rejects(
    () => store.unlock('unieke fail closed master wachtzin'),
    /fixture unavailable/
  );
  assert.equal(harness.getPostBodies().length, 0, 'een leesfout mag nooit voorbeelddata terugschrijven');
  assert.equal(store.getSecurityState().envelopeVersion, null);
});

test('premium wachtwoordenregister accepteert uitsluitend een gezaghebbende Supabase-snapshot', async () => {
  const invalidSnapshots = [
    { getSource: 'bootstrap' },
    { getSource: 'fallback' },
    { getResultOk: false },
    { getScope: 'other_scope' },
    { omitRevision: true },
    { omitUpdatedAt: true, initialRevision: 1 },
  ];

  for (const options of invalidSnapshots) {
    const harness = loadPasswordRegisterStoreWithUiState({ entries_encrypted_v1: 'fixture' }, options);
    const store = harness.createStore();
    await assert.rejects(
      () => store.unlock('unieke gezaghebbende master wachtzin'),
      /niet gezaghebbend door Supabase bevestigd/
    );
    assert.equal(harness.getPostBodies().length, 0);
    assert.deepEqual(harness.getRequests(), [{
      url: '/api/ui-state-read?scope=premium_password_register',
      method: 'POST',
    }]);
  }
});

test('premium wachtwoordenregister bewaart entries alleen als versleutelde blob', async () => {
  const harness = loadPasswordRegisterStoreWithUiState();
  const statuses = [];
  const store = harness.createStore({
    setStatus: (message, tone) => statuses.push({ message, tone }),
  });

  await store.unlock('lange master wachtzin');
  await store.persist([
    {
      id: 1,
      naam: 'Productie login',
      url: 'https://example.com',
      user: 'beheer@example.com',
      pw: 'fixture-only-secret',
      cat: 'Test',
    },
  ], 'test-save');

  const posted = harness.getPostBodies().at(-1);
  assert.equal(posted.expectedRevision, 0);
  assert.equal(posted.expectedUpdatedAt, null);
  assert.equal(posted.writeProof, TEST_WRITE_PROOF);
  assert.equal(Object.hasOwn(posted, 'actionConfirmCode'), false);
  assert.equal(Object.hasOwn(posted, 'actionConfirmScope'), false);
  assert.equal(Object.hasOwn(posted.patch, 'writeProof'), false);
  assert.equal(posted.patch.entries_json, '');
  assert.equal(typeof posted.patch.entries_encrypted_v1, 'string');
  assert.doesNotMatch(posted.patch.entries_encrypted_v1, /fixture-only-secret|beheer@example\.com|Productie login/);
  assert.match(posted.patch.entries_encrypted_v1, /"algorithm":"AES-GCM"/);
  assert.match(statuses.at(-1).message, /Versleutelde kluis/);
});

test('premium wachtwoordenregister bewaart wachtwoord-whitespace exact', async () => {
  const harness = loadPasswordRegisterStoreWithUiState();
  const store = harness.createStore();
  const masterSecret = 'exacte whitespace master wachtzin 2026';
  const exactPassword = '  fixture-exact-secret\nmet-tab\t  ';

  await store.unlock(masterSecret);
  await store.persist([{
    id: 1,
    naam: 'Whitespace-account',
    url: 'example.test',
    user: 'whitespace@example.test',
    pw: exactPassword,
    cat: 'Test',
  }], 'whitespace-test');
  store.lock();

  const reopened = await store.unlock(masterSecret);
  assert.equal(reopened[0].pw, exactPassword);
});

test('premium wachtwoordenregister migreert legacy plaintext en weigert verkeerde master key', async () => {
  const legacyEntries = [
    {
      id: 7,
      naam: 'Legacy login',
      url: 'legacy.example',
      user: 'legacy@example.com',
      pw: 'fixture-legacy-secret',
      cat: 'Legacy',
    },
  ];
  const legacyHarness = loadPasswordRegisterStoreWithUiState({
    entries_json: JSON.stringify(legacyEntries),
  });
  const legacyStore = legacyHarness.createStore();
  const migrated = await legacyStore.unlock('juiste master');

  assert.equal(migrated[0].pw, 'fixture-legacy-secret');
  const migratedPatch = legacyHarness.getPostBodies().at(-1).patch;
  assert.equal(migratedPatch.entries_json, '');
  assert.equal(typeof migratedPatch.entries_encrypted_v1, 'string');
  assert.doesNotMatch(migratedPatch.entries_encrypted_v1, /fixture-legacy-secret|legacy@example\.com/);

  const encryptedHarness = loadPasswordRegisterStoreWithUiState({
    entries_encrypted_v1: migratedPatch.entries_encrypted_v1,
  });
  const encryptedStore = encryptedHarness.createStore();
  const decrypted = await encryptedStore.unlock('juiste master');
  assert.equal(decrypted[0].user, 'legacy@example.com');
  assert.equal(decrypted[0].pw, 'fixture-legacy-secret');
  await assert.rejects(
    () => encryptedHarness.createStore().unlock('verkeerde master'),
    /Master-wachtzin klopt niet/
  );
});

async function createLegacyV1Envelope(masterSecret, entries) {
  const salt = new Uint8Array(16).fill(7);
  const iv = new Uint8Array(12).fill(9);
  const secretBytes = new TextEncoder().encode(masterSecret);
  const baseKey = await webcrypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
  secretBytes.fill(0);
  const key = await webcrypto.subtle.deriveKey({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations: 210000,
  }, baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(entries));
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  plaintext.fill(0);
  return JSON.stringify({
    version: 1,
    algorithm: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 210000,
    salt: Buffer.from(salt).toString('base64'),
    iv: Buffer.from(iv).toString('base64'),
    ciphertext: Buffer.from(ciphertext).toString('base64'),
  });
}

test('premium wachtwoordenregister migreert legacy v1 vóór tonen automatisch naar v2 met 600k iteraties', async () => {
  const legacySecret = 'oude korte zin';
  const legacyEnvelope = await createLegacyV1Envelope(legacySecret, [{
    id: 11,
    naam: 'Legacy account',
    url: 'legacy.example',
    user: 'legacy-user@example.test',
    pw: 'fixture-legacy-v1-secret',
    cat: 'Test',
  }]);
  const harness = loadPasswordRegisterStoreWithUiState({ entries_encrypted_v1: legacyEnvelope });
  const store = harness.createStore();

  const entries = await store.unlock(legacySecret);
  assert.equal(entries[0].pw, 'fixture-legacy-v1-secret');
  assert.deepEqual(
    JSON.parse(JSON.stringify(store.getSecurityState())),
    {
      envelopeVersion: 2,
      kdfIterations: 600000,
      masterSecretMeetsPolicy: false,
      migrationPending: false,
    }
  );
  assert.equal(harness.getPostBodies().length, 1, 'v1 unlock moet exact één CAS-migratie uitvoeren');
  const migrationBody = harness.getPostBodies()[0];
  assert.equal(migrationBody.expectedRevision, 1);
  assert.equal(migrationBody.expectedUpdatedAt, '2026-08-04T12:00:01.000Z');
  assert.equal(migrationBody.writeProof, TEST_WRITE_PROOF);
  const migratedEnvelope = JSON.parse(migrationBody.patch.entries_encrypted_v1);
  assert.equal(migratedEnvelope.version, 2);
  assert.equal(migratedEnvelope.iterations, 600000);
  assert.equal(migratedEnvelope.algorithm, 'AES-GCM');
  assert.equal(migratedEnvelope.kdf, 'PBKDF2-SHA256');
  assert.doesNotMatch(JSON.stringify(migratedEnvelope), /fixture-legacy-v1-secret|legacy-user/);

  const migratedHarness = loadPasswordRegisterStoreWithUiState({
    entries_encrypted_v1: JSON.stringify(migratedEnvelope),
  });
  const migratedEntries = await migratedHarness.createStore().unlock(legacySecret);
  assert.equal(migratedEntries[0].pw, 'fixture-legacy-v1-secret');
  assert.equal(migratedHarness.getPostBodies().length, 0, 'bevestigde v2 snapshot mag niet opnieuw migreren');
});

test('premium wachtwoordenregister eist een sterke nieuwe master-wachtzin en kan veilig herkeyen', async () => {
  const firstSecret = 'eerste unieke master wachtzin 2026';
  const secondSecret = 'tweede unieke master wachtzin 2026';
  const harness = loadPasswordRegisterStoreWithUiState();
  const store = harness.createStore();

  await assert.rejects(() => store.unlock('veel te kort'), /minimaal 20 tekens/);
  const entries = await store.unlock(firstSecret);
  await store.persist(entries, 'initial-save');
  await assert.rejects(
    async () => store.changeMasterSecret(firstSecret, 'nog steeds te kort', entries),
    /minimaal 20 tekens/
  );
  await store.changeMasterSecret(firstSecret, secondSecret, entries, 'master-secret-change');

  const changedEnvelope = harness.getValues().entries_encrypted_v1;
  const changedHarness = loadPasswordRegisterStoreWithUiState({ entries_encrypted_v1: changedEnvelope });
  await assert.rejects(
    () => changedHarness.createStore().unlock(firstSecret),
    /Master-wachtzin klopt niet/
  );
  const reopened = await changedHarness.createStore().unlock(secondSecret);
  assert.equal(reopened.length, entries.length);
});

test('premium wachtwoordenregister faalt gesloten bij een stale CAS-revisie', async () => {
  const harness = loadPasswordRegisterStoreWithUiState();
  const store = harness.createStore();
  const entries = await store.unlock('unieke stale cas master wachtzin 2026');
  harness.advanceRemote({ updated_by: 'andere-sessie' });

  await assert.rejects(
    () => store.persist(entries, 'stale-client'),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_REVISION_CONFLICT');
      assert.equal(error.forceLock, true);
      assert.equal(error.requiresFreshRead, true);
      return true;
    }
  );

  assert.equal(harness.getPostBodies()[0].expectedRevision, 0);
  assert.equal(harness.getPostBodies()[0].expectedUpdatedAt, null);
  assert.equal(store.getRevisionState().revision, null);
  assert.equal(store.getRevisionState().updatedAt, null);
  assert.equal(store.getSecurityState().envelopeVersion, null);
});

test('premium wachtwoordenregister serialiseert gelijktijdige writes met oplopende CAS', async () => {
  let releaseFirstPost;
  let markFirstPostStarted;
  const firstPostStarted = new Promise((resolve) => { markFirstPostStarted = resolve; });
  const harness = loadPasswordRegisterStoreWithUiState({}, {
    waitForPost: async (_body, postIndex) => {
      if (postIndex !== 1) return;
      markFirstPostStarted();
      await new Promise((resolve) => { releaseFirstPost = resolve; });
    },
  });
  const store = harness.createStore();
  const masterSecret = 'unieke serialisatie master wachtzin 2026';
  await store.unlock(masterSecret);

  const firstSave = store.persist([{
    id: 1,
    naam: 'Eerste',
    url: 'eerste.example',
    user: 'eerste@example.test',
    pw: 'fixture-first-secret',
    cat: 'Test',
  }], 'first');
  await firstPostStarted;
  const secondSave = store.persist([{
    id: 1,
    naam: 'Tweede',
    url: 'tweede.example',
    user: 'tweede@example.test',
    pw: 'fixture-second-secret',
    cat: 'Test',
  }], 'second');

  await Promise.resolve();
  assert.equal(harness.getPostBodies().length, 1, 'tweede write mag niet voor de eerste starten');
  releaseFirstPost();
  await Promise.all([firstSave, secondSave]);

  const bodies = harness.getPostBodies();
  assert.equal(bodies.length, 2);
  assert.deepEqual(
    bodies.map((body) => [body.expectedRevision, body.expectedUpdatedAt]),
    [[0, null], [1, '2026-08-04T12:00:01.000Z']]
  );
  assert.equal(store.getRevisionState().revision, 2);
  assert.equal(store.getRevisionState().updatedAt, '2026-08-04T12:00:02.000Z');
});

test('premium wachtwoordenregister vergrendelt na een ambigue rekey en leest daarna vers uit Supabase', async () => {
  const oldSecret = 'oude unieke rekey master wachtzin 2026';
  const newSecret = 'nieuwe unieke rekey master wachtzin 2026';
  const harness = loadPasswordRegisterStoreWithUiState({}, {
    throwAfterCommit: (_body, postIndex) => postIndex === 2,
  });
  const store = harness.createStore();
  const entries = await store.unlock(oldSecret);
  await store.persist(entries, 'initial-save');

  await assert.rejects(
    () => store.changeMasterSecret(oldSecret, newSecret, entries, 'ambiguous-rekey'),
    (error) => {
      assert.equal(error.forceLock, true);
      assert.equal(error.requiresFreshRead, true);
      return true;
    }
  );
  assert.equal(store.getSecurityState().envelopeVersion, null);
  assert.equal(store.getRevisionState().revision, null);

  const reopenedWithNewSecret = await store.unlock(newSecret);
  assert.equal(reopenedWithNewSecret.length, entries.length);
  await assert.rejects(
    () => store.unlock(oldSecret),
    /Master-wachtzin klopt niet/
  );
  assert.equal(harness.getGetCount(), 3, 'elke poging na de ambigue commit moet een verse authoritative read doen');
});

test('premium wachtwoordenregister controleert de huidige master-wachtzin voor rekey', async () => {
  const oldSecret = 'huidige unieke master wachtzin 2026';
  const newSecret = 'volgende unieke master wachtzin 2026';
  const harness = loadPasswordRegisterStoreWithUiState();
  const store = harness.createStore();
  const entries = await store.unlock(oldSecret);
  await store.persist(entries, 'initial-save');

  await assert.rejects(
    () => store.changeMasterSecret('onjuiste huidige master wachtzin', newSecret, entries),
    (error) => {
      assert.equal(error.code, 'PASSWORD_REGISTER_CURRENT_MASTER_INVALID');
      assert.equal(error.forceLock, true);
      return true;
    }
  );
  assert.equal(harness.getPostBodies().length, 1, 'onjuiste huidige wachtzin mag geen rekey-write starten');
  assert.equal(store.getSecurityState().envelopeVersion, null);
});

test('premium wachtwoordenregister zet een late opslag na lock niet terug in geheugen', async () => {
  let releasePost;
  let markPostStarted;
  const postStarted = new Promise((resolve) => { markPostStarted = resolve; });
  const harness = loadPasswordRegisterStoreWithUiState({}, {
    waitForPost: async () => {
      markPostStarted();
      await new Promise((resolve) => { releasePost = resolve; });
    },
  });
  const store = harness.createStore();
  const entries = await store.unlock('unieke race test master wachtzin');
  const persistPromise = store.persist(entries, 'race-test');
  await postStarted;
  store.lock();
  releasePost();

  const result = await persistPromise;
  assert.equal(result.stale, true);
  assert.equal(result.entries.length, 0);
  assert.equal(store.getSecurityState().envelopeVersion, null);
  const reopened = await store.unlock('unieke race test master wachtzin');
  assert.equal(reopened.length, entries.length, 'verse unlock moet de laat bevestigde Supabase-versie ophalen');
  assert.equal(harness.getGetCount(), 2);
});

test('premium wachtwoordenregister verifieert een verse rekey-PIN server-side en failt gesloten', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-password-register-pin.js'),
    'utf8'
  );
  const fetchCalls = [];
  const scheduledCallbacks = [];
  let nextScheduledCallbackId = 1;
  let unlockVerification = null;
  let unlockFailure = null;
  let hangPinVerification = false;
  let hangingSignal = null;
  const pinMessage = { textContent: '' };
  let responseData = {
    ok: true,
    writeProof: 'opaque-test-write-proof',
    writeProofExpiresAt: new Date(Date.now() + 300000).toISOString(),
  };
  const context = {
    window: {
      AbortController,
      setTimeout: (callback) => {
        callback.timerId = nextScheduledCallbackId;
        nextScheduledCallbackId += 1;
        scheduledCallbacks.push(callback);
        return callback.timerId;
      },
      clearTimeout: (timerId) => {
        const index = scheduledCallbacks.findIndex((callback) => callback.timerId === timerId);
        if (index >= 0) scheduledCallbacks.splice(index, 1);
      },
      setInterval,
      clearInterval,
    },
    document: {
      getElementById: (id) => id === 'pin-msg' ? pinMessage : null,
      querySelectorAll: () => [],
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (hangPinVerification) {
        hangingSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('PIN request aborted')));
        });
      }
      return {
        ok: true,
        status: 200,
        json: async () => responseData,
      };
    },
    setTimeout,
    clearTimeout,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const pinController = context.window.SoftoraPasswordRegisterPin.create({
    unlock: async (receivedVerification) => {
      unlockVerification = { ...receivedVerification };
      if (unlockFailure) throw unlockFailure;
    },
  });

  const verification = await pinController.verifyFreshPin('123456');
  assert.equal(verification.writeProof, 'opaque-test-write-proof');
  assert.equal(fetchCalls[0].url, '/api/premium-users/verify-pin');
  assert.equal(fetchCalls[0].options.credentials, 'same-origin');
  assert.equal(fetchCalls[0].options.signal.aborted, false);
  assert.equal(fetchCalls[0].options.headers['X-Softora-Requested-With'], 'premium');
  assert.deepEqual(JSON.parse(fetchCalls[0].options.body), {
    actionConfirmCode: '123456',
    actionConfirmScope: 'password-register',
  });

  for (const digit of '123456') pinController.pressDigit(digit);
  await scheduledCallbacks.shift()();
  scheduledCallbacks.shift()();
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  assert.equal(unlockVerification.ok, true);
  assert.equal(unlockVerification.writeProof, 'opaque-test-write-proof');
  assert.equal(typeof unlockVerification.writeProofExpiresAt, 'string');
  assert.equal(verification.writeProof, '', 'PIN-controller moet proof na geslaagde overdracht uit responseobject wissen');
  assert.notEqual(unlockVerification, '123456', 'de ruwe PIN mag nooit aan de kluis-app worden doorgegeven');

  unlockFailure = new Error('Gezaghebbende kluisread geweigerd.');
  responseData = {
    ok: true,
    writeProof: 'second-opaque-write-proof',
    writeProofExpiresAt: new Date(Date.now() + 300000).toISOString(),
  };
  const failedUnlockResponse = responseData;
  for (const digit of '123456') pinController.pressDigit(digit);
  await scheduledCallbacks.shift()();
  scheduledCallbacks.shift()();
  for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  assert.equal(pinMessage.textContent, 'Gezaghebbende kluisread geweigerd.');
  assert.equal(failedUnlockResponse.writeProof, '', 'proof moet ook na unlock-fout uit het responseobject verdwijnen');

  hangPinVerification = true;
  const hangingVerification = pinController.verifyFreshPin('123456');
  const hangingRejection = assert.rejects(hangingVerification, /PIN request aborted/);
  await Promise.resolve();
  assert.equal(hangingSignal.aborted, false);
  pinController.lock();
  assert.equal(hangingSignal.aborted, true, 'lock moet een lopende ruwe-PIN-request direct afbreken');
  await hangingRejection;
  hangPinVerification = false;

  responseData = { ok: false, error: 'PIN verlopen' };
  await assert.rejects(
    () => pinController.verifyFreshPin('123456'),
    /PIN verlopen/
  );
});

function loadPasswordRegisterSecurityModule() {
  const previousWindow = global.window;
  const modulePath = require.resolve('../../assets/premium-password-register-security.js');
  try {
    global.window = {};
    delete require.cache[modulePath];
    require('../../assets/premium-password-register-security.js');
    return global.window;
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

function loadPasswordRegisterAutoLockModule() {
  const previousWindow = global.window;
  const modulePath = require.resolve('../../assets/premium-password-register-autolock.js');
  try {
    global.window = {};
    delete require.cache[modulePath];
    require('../../assets/premium-password-register-autolock.js');
    return global.window;
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
}

function createFakeElement(value = '') {
  const attributes = new Map();
  const classes = new Set(['show']);
  return {
    value,
    type: 'text',
    textContent: value,
    classList: {
      contains: (name) => classes.has(name),
      remove: (name) => classes.delete(name),
    },
    setAttribute: (name, nextValue) => attributes.set(name, String(nextValue)),
    removeAttribute: (name) => attributes.delete(name),
    getAttribute: (name) => attributes.get(name),
  };
}

test('premium wachtwoordenregister wist plaintext uit entries, formulieren en DOM bij lock', () => {
  const window = loadPasswordRegisterSecurityModule();
  const security = window.SoftoraPasswordRegisterSecurity;
  const entries = [{ id: 1, naam: 'Account', user: 'user@example.test', pw: 'fixture-secret-test-value' }];
  const inputs = [
    createFakeElement('master-secret-test'),
    createFakeElement('user@example.test'),
    createFakeElement('fixture-secret-test-value'),
  ];
  const passwordInput = inputs[2];
  const toggle = createFakeElement('Verbergen');
  const deleteText = createFakeElement('Account verwijderen?');
  const status = createFakeElement('Account geladen');
  const toast = createFakeElement('Account gekopieerd');
  const list = {
    children: ['fixture-secret-test-value'],
    replaceChildren(...children) { this.children = children; },
  };
  let formResetCount = 0;

  security.wipeEntries(entries);
  security.clearSensitiveUi({
    inputs,
    entryForm: { reset: () => { formResetCount += 1; } },
    passwordInput,
    passwordToggle: toggle,
    deleteModalText: deleteText,
    status,
    toast,
    list,
    createLockedState: (message) => ({ message }),
  });

  assert.equal(entries[0].pw, '');
  assert.equal(entries[0].user, '');
  assert.equal(inputs.every((input) => input.value === ''), true);
  assert.equal(passwordInput.type, 'password');
  assert.equal(toggle.textContent, 'Tonen');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(deleteText.textContent, '');
  assert.equal(status.textContent, '');
  assert.equal(toast.textContent, '');
  assert.equal(toast.classList.contains('show'), false);
  assert.deepEqual(list.children, [{ message: 'Kluis vergrendeld.' }]);
  assert.equal(formResetCount, 1);
});

function createFakeEventTarget() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(listener);
    },
    dispatch(name) {
      for (const listener of listeners.get(name) || []) listener({ type: name });
    },
  };
}

test('premium wachtwoordenregister vergrendelt direct bij blur, inactiviteit, achtergrond en hervatten', () => {
  const window = loadPasswordRegisterAutoLockModule();
  const documentTarget = createFakeEventTarget();
  const windowTarget = createFakeEventTarget();
  const timers = new Map();
  const reasons = [];
  let clock = 0;
  let nextTimerId = 1;
  const autoLock = window.SoftoraPasswordRegisterAutoLock.create({
    document: documentTarget,
    window: windowTarget,
    inactivityMs: 300000,
    now: () => clock,
    setTimeout: (callback) => {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    onLock: (reason) => reasons.push(reason),
  });

  autoLock.start();
  documentTarget.hidden = true;
  documentTarget.dispatch('visibilitychange');

  documentTarget.hidden = false;
  autoLock.start();
  documentTarget.dispatch('freeze');

  autoLock.start();
  windowTarget.dispatch('pagehide');

  autoLock.start();
  windowTarget.dispatch('blur');
  clock += 100;
  windowTarget.dispatch('focus');

  autoLock.start();
  clock += 300001;
  windowTarget.dispatch('focus');

  autoLock.start();
  clock += 300000;
  for (const callback of [...timers.values()]) callback();

  assert.deepEqual(reasons, ['hidden', 'freeze', 'pagehide', 'blur', 'resume-timeout', 'inactivity']);
  assert.equal(autoLock.isActive(), false);
});
