const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');
const { findUnsafeCredentialFixtures } = require('../testlib/credential-fixture-safety');

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
    'assets/premium-ui-state-client.js?v=20260722b',
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
  assert.match(storeSource, /cryptoObj\.subtle/);
  assert.match(storeSource, /fetchUiStateGetWithFallback\(PASSWORD_REGISTER_SCOPE\)/);
  assert.match(storeSource, /fetchUiStateSetWithFallback\(PASSWORD_REGISTER_SCOPE, payload\)/);
  assert.match(storeSource, /\[PASSWORD_REGISTER_ENCRYPTED_KEY\]: JSON\.stringify\(encryptedPayload\)/);
  assert.match(storeSource, /\[PASSWORD_REGISTER_LEGACY_ENTRIES_KEY\]: ""/);
  assert.match(appSource, /global\.SoftoraPasswordRegisterStore\.create/);
  assert.match(appSource, /passwordRegisterStore\.unlock\(masterSecret\)/);
  assert.match(appSource, /passwordRegisterStore\.persist\(entries, actor \|\| "save"\)/);
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
  assert.match(appSource, /passwordRegisterStore\.unlock\(masterSecret\)/);
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
  assert.match(appSource, /passwordRegisterPin\.bindNumpad\(pinNumpadEl\)/);
  assert.match(appSource, /passwordRegisterPin\.bindKeyboard\(document\)/);
  assert.match(appSource, /lockRegisterBtnEl\.addEventListener\("click", passwordRegisterPin\.lock\)/);
  assert.match(appSource, /secureLockCleanup/);
  assert.match(appSource, /SoftoraPasswordRegisterSecurity\.wipeEntries\(entries\)/);
  assert.match(appSource, /SoftoraPasswordRegisterSecurity\.clearSensitiveUi/);
  assert.match(appSource, /passwordRegisterAutoLock\.start\(\)/);
  assert.match(appSource, /finally\s*\{\s*masterSecret = "";/);
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
  assert.match(pageSource, /id="entry-password-toggle"/);
  assert.match(appSource, /toggleEntryPasswordVisibility/);
  assert.doesNotMatch(pageSource, /const PIN\s*=\s*['"][0-9]{6}['"]/);
  assert.match(pinSource, /fetch\("\/api\/premium-users\/verify-pin"/);
  assert.match(pinSource, /actionConfirmCode:\s*pin/);
  assert.match(pinSource, /actionConfirmScope:\s*"password-register"/);
  assert.match(pinSource, /credentials:\s*"same-origin"/);
  assert.match(pinSource, /data\.ok !== true/);
});

function loadPasswordRegisterStoreWithUiState(initialValues = {}, loadOptions = {}) {
  const storePath = path.join(__dirname, '../../assets/premium-password-register-store.js');
  const source = fs.readFileSync(storePath, 'utf8');
  const postBodies = [];
  let values = { ...initialValues };
  let getCount = 0;
  const window = {
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  const context = {
    window,
    fetch: async (_url, requestOptions = {}) => {
      if (requestOptions.method === 'POST') {
        const body = JSON.parse(String(requestOptions.body || '{}'));
        postBodies.push(body);
        if (typeof loadOptions.waitForPost === 'function') await loadOptions.waitForPost(body);
        values = { ...values, ...(body.patch || {}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, source: loadOptions.postSource || 'supabase' }),
        };
      }
      getCount += 1;
      if (loadOptions.readError) throw loadOptions.readError;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, source: loadOptions.readSource || 'supabase', values }),
      };
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
  return {
    createStore: context.window.SoftoraPasswordRegisterStore.create,
    getGetCount: () => getCount,
    getPostBodies: () => postBodies.slice(),
    getValues: () => ({ ...values }),
  };
}

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
  assert.equal(posted.patch.entries_json, '');
  assert.equal(typeof posted.patch.entries_encrypted_v1, 'string');
  assert.doesNotMatch(posted.patch.entries_encrypted_v1, /fixture-only-secret|beheer@example\.com|Productie login/);
  assert.match(posted.patch.entries_encrypted_v1, /"algorithm":"AES-GCM"/);
  assert.match(statuses.at(-1).message, /Versleutelde kluis/);
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

test('premium wachtwoordenregister faalt gesloten zonder gezaghebbende Supabase-read', async () => {
  const unavailableHarness = loadPasswordRegisterStoreWithUiState({}, {
    readError: new Error('Supabase onbereikbaar'),
  });
  await assert.rejects(
    () => unavailableHarness.createStore().unlock('lange unieke master wachtzin'),
    /Supabase onbereikbaar/
  );

  const fallbackHarness = loadPasswordRegisterStoreWithUiState({}, { readSource: 'memory' });
  await assert.rejects(
    () => fallbackHarness.createStore().unlock('lange unieke master wachtzin'),
    /niet gezaghebbend door Supabase bevestigd/
  );
});

test('premium wachtwoordenregister bewaart wachtwoord-whitespace exact', async () => {
  const harness = loadPasswordRegisterStoreWithUiState();
  const store = harness.createStore();
  const fixturePasswordWithWhitespace = '  fixture-exact-secret-with-spaces  ';
  await store.unlock('lange unieke master wachtzin');
  await store.persist([
    {
      id: 1,
      naam: 'Whitespace test',
      url: 'https://example.test',
      user: 'user@example.test',
      pw: fixturePasswordWithWhitespace,
      cat: 'Test',
    },
  ], 'whitespace-test');

  const reopened = loadPasswordRegisterStoreWithUiState(harness.getValues()).createStore();
  const entries = await reopened.unlock('lange unieke master wachtzin');
  assert.equal(entries[0].pw, fixturePasswordWithWhitespace);
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
  const entries = await store.unlock('lange unieke race test master wachtzin');
  const persistPromise = store.persist(entries, 'race-test');
  await postStarted;
  store.lock();
  releasePost();

  const result = await persistPromise;
  assert.equal(result.stale, true);
  assert.equal(result.entries.length, 0);
  const reopened = await store.unlock('lange unieke race test master wachtzin');
  assert.equal(reopened.length, entries.length);
  assert.equal(harness.getGetCount(), 2);
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
  const toast = createFakeElement('Account getoond');
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
  assert.equal(formResetCount, 1);
  assert.deepEqual(list.children, [{ message: 'Kluis vergrendeld.' }]);
});

test('premium wachtwoordenregister vergrendelt direct bij blur, inactiviteit, achtergrond en hervatten', () => {
  const documentListeners = {};
  const windowListeners = {};
  const timers = new Map();
  let timerId = 0;
  let now = 1000;
  const reasons = [];
  const fakeDocument = {
    hidden: false,
    addEventListener: (name, handler) => { documentListeners[name] = handler; },
  };
  const fakeWindow = {
    document: fakeDocument,
    addEventListener: (name, handler) => { windowListeners[name] = handler; },
    setTimeout: (handler, delay) => {
      timerId += 1;
      timers.set(timerId, { handler, delay });
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  const previousWindow = global.window;
  const modulePath = require.resolve('../../assets/premium-password-register-autolock.js');
  let create;
  try {
    global.window = fakeWindow;
    delete require.cache[modulePath];
    require('../../assets/premium-password-register-autolock.js');
    create = fakeWindow.SoftoraPasswordRegisterAutoLock.create;
  } finally {
    delete require.cache[modulePath];
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }

  const controller = create({
    document: fakeDocument,
    window: fakeWindow,
    inactivityMs: 300000,
    now: () => now,
    setTimeout: fakeWindow.setTimeout,
    clearTimeout: fakeWindow.clearTimeout,
    onLock: (reason) => reasons.push(reason),
  });
  controller.start();
  windowListeners.blur();
  assert.deepEqual(reasons, ['blur']);

  controller.start();
  fakeDocument.hidden = true;
  documentListeners.visibilitychange();
  assert.deepEqual(reasons, ['blur', 'hidden']);

  fakeDocument.hidden = false;
  controller.start();
  now += 300001;
  const pendingTimer = Array.from(timers.values()).at(-1);
  pendingTimer.handler();
  assert.deepEqual(reasons, ['blur', 'hidden', 'inactivity']);

  controller.start();
  now += 300001;
  windowListeners.focus();
  assert.deepEqual(reasons, ['blur', 'hidden', 'inactivity', 'resume-timeout']);

  controller.start();
  documentListeners.freeze();
  assert.equal(reasons.at(-1), 'freeze');
  controller.start();
  windowListeners.pagehide();
  assert.equal(reasons.at(-1), 'pagehide');
});
