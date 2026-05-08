const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { TextEncoder, TextDecoder } = require('node:util');

test('premium wachtwoordenregister gebruikt dashboard-typografie en persistente editflow', () => {
  const pagePath = path.join(__dirname, '../../premium-wachtwoordenregister.html');
  const rendererPath = path.join(__dirname, '../../assets/premium-password-register-renderer.js');
  const storePath = path.join(__dirname, '../../assets/premium-password-register-store.js');
  const pinPath = path.join(__dirname, '../../assets/premium-password-register-pin.js');
  const appPath = path.join(__dirname, '../../assets/premium-password-register-app.js');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const rendererSource = fs.readFileSync(rendererPath, 'utf8');
  const storeSource = fs.readFileSync(storePath, 'utf8');
  const pinSource = fs.readFileSync(pinPath, 'utf8');
  const appSource = fs.readFileSync(appPath, 'utf8');
  const combinedSource = `${pageSource}\n${rendererSource}\n${storeSource}\n${pinSource}\n${appSource}`;

  assert.match(pageSource, /family=Inter:wght@300;400;500;600;700&family=Oswald:wght@400;500;600;700/);
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
  assert.match(pageSource, /assets\/premium-password-register-store\.js\?v=20260427a/);
  assert.match(pageSource, /assets\/premium-password-register-pin\.js\?v=20260427a/);
  assert.match(pageSource, /assets\/premium-password-register-app\.js\?v=20260427a/);
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
  assert.match(appSource, /global\.prompt\(/);
  assert.match(pinSource, /global\.SoftoraPasswordRegisterPin/);
  assert.match(storeSource, /hosting@example\.test/);
  assert.match(storeSource, /Voorbeeldgegevens geladen\. Vervang deze en sla daarna op om echte gegevens versleuteld te bewaren\./);
  assert.doesNotMatch(pageSource, /DEFAULT_PASSWORD_ENTRIES|fetchUiStateGetWithFallback|fetchUiStateSetWithFallback|PASSWORD_REGISTER_SCOPE/);
  assert.doesNotMatch(pageSource, /passwordRegisterStore|passwordRegisterPin|entryModalMode|saveEntryFromModal|persistPasswordEntries/);
  assert.doesNotMatch(pageSource, /persistPasswordEntries\('bootstrap'\)/);
  assert.doesNotMatch(combinedSource, /H0st!nger24|Tr@nsIP2026!|G00gl3Work!|Insta\$oft24|Link3dIn!26/);
  assert.doesNotMatch(combinedSource, /beheer@softora\.nl|admin@softora\.nl|info@softora\.nl/);
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
  assert.doesNotMatch(pageSource, /const PIN\s*=\s*['"][0-9]{6}['"]/);
  assert.match(pinSource, /fetch\("\/api\/premium-users\/verify-pin"/);
  assert.match(pinSource, /body:\s*JSON\.stringify\(\{\s*actionConfirmPin:\s*pin\s*\}\)/);
});

function loadPasswordRegisterStoreWithUiState(initialValues = {}) {
  const storePath = path.join(__dirname, '../../assets/premium-password-register-store.js');
  const source = fs.readFileSync(storePath, 'utf8');
  const postBodies = [];
  let values = { ...initialValues };
  const window = {
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  };
  const context = {
    window,
    fetch: async (_url, options = {}) => {
      if (options.method === 'POST') {
        const body = JSON.parse(String(options.body || '{}'));
        postBodies.push(body);
        values = { ...values, ...(body.patch || {}) };
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, source: 'supabase' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, source: 'supabase', values }),
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
      pw: 'super-geheim',
      cat: 'Test',
    },
  ], 'test-save');

  const posted = harness.getPostBodies().at(-1);
  assert.equal(posted.patch.entries_json, '');
  assert.equal(typeof posted.patch.entries_encrypted_v1, 'string');
  assert.doesNotMatch(posted.patch.entries_encrypted_v1, /super-geheim|beheer@example\.com|Productie login/);
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
      pw: 'oude-plaintext',
      cat: 'Legacy',
    },
  ];
  const legacyHarness = loadPasswordRegisterStoreWithUiState({
    entries_json: JSON.stringify(legacyEntries),
  });
  const legacyStore = legacyHarness.createStore();
  const migrated = await legacyStore.unlock('juiste master');

  assert.equal(migrated[0].pw, 'oude-plaintext');
  const migratedPatch = legacyHarness.getPostBodies().at(-1).patch;
  assert.equal(migratedPatch.entries_json, '');
  assert.equal(typeof migratedPatch.entries_encrypted_v1, 'string');
  assert.doesNotMatch(migratedPatch.entries_encrypted_v1, /oude-plaintext|legacy@example\.com/);

  const encryptedHarness = loadPasswordRegisterStoreWithUiState({
    entries_encrypted_v1: migratedPatch.entries_encrypted_v1,
  });
  const encryptedStore = encryptedHarness.createStore();
  const decrypted = await encryptedStore.unlock('juiste master');
  assert.equal(decrypted[0].user, 'legacy@example.com');
  assert.equal(decrypted[0].pw, 'oude-plaintext');
  await assert.rejects(
    () => encryptedHarness.createStore().unlock('verkeerde master'),
    /Master-wachtzin klopt niet/
  );
});
