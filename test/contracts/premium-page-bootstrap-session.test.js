const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPageBootstrapSession,
} = require('../../assets/premium-page-bootstrap-session');

test('pagina-bootstrap deelt de bevestigde serversessie zonder extra API-request', () => {
  const window = {
    document: {
      getElementById(id) {
        if (id !== 'softoraCustomersBootstrap') return null;
        return {
          textContent: JSON.stringify({
            session: { authenticated: true, email: 'serve@softora.nl' },
          }),
        };
      },
    },
  };

  window.SoftoraPageBootstrapSession = createPageBootstrapSession(window);

  assert.equal(window.SoftoraPageBootstrapSession.get().email, 'serve@softora.nl');
  assert.equal(Object.isFrozen(window.SoftoraPageBootstrapSession), true);
});

test('pagina-bootstrap faalt stil bij ongeldige JSON', () => {
  const window = {
    document: {
      getElementById() {
        return { textContent: '{kapot' };
      },
    },
  };

  window.SoftoraPageBootstrapSession = createPageBootstrapSession(window);

  assert.equal(window.SoftoraPageBootstrapSession.get(), null);
});

test('pagina-bootstrap leest een unicode sessie uit veilige base64', () => {
  const payload = {
    session: { authenticated: true, email: 'serve@softora.nl', displayName: 'Servé Creusen' },
  };
  const window = {
    atob,
    TextDecoder,
    document: {
      getElementById(id) {
        if (id !== 'softoraPageStateBootstrap') return null;
        return {
          textContent: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
          getAttribute(name) {
            return name === 'data-softora-encoding' ? 'base64' : null;
          },
        };
      },
    },
  };

  const helper = createPageBootstrapSession(window);

  assert.equal(helper.get().displayName, 'Servé Creusen');
});

test('pagina-bootstrap deelt een afgeschermde tabcache met maximale leeftijd', () => {
  const values = new Map();
  const window = {
    document: { getElementById() { return null; } },
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); },
    },
  };
  const helper = createPageBootstrapSession(window);

  assert.equal(helper.cache.write('mailbox:user-1', { messages: [{ id: 'mail-1' }] }), true);
  assert.equal(helper.cache.read('mailbox:user-1', 60_000).messages[0].id, 'mail-1');
  assert.equal(helper.cache.read('mailbox:user-2', 60_000), null);
  assert.equal(helper.cache.remove('mailbox:user-1'), true);
  assert.equal(helper.cache.read('mailbox:user-1', 60_000), null);
});

test('de base64-mailboxbootstrap wordt één keer gedecodeerd en gedeeld door alle lezers', () => {
  const payload = {
    session: { authenticated: true, email: 'serve@softora.nl', displayName: 'Servé Creusen' },
    scopes: { premium_mailbox_preferences: { ok: true, source: 'supabase', values: { owner: 'serve' } } },
    mailbox: { owner: 'serve', messages: [{ id: 'inbox:1', subject: 'Offerte 💬 — “test”', body: 'Groet,\nServé' }] },
  };
  let atobCalls = 0;
  const element = {
    textContent: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'),
    getAttribute: (name) => (name === 'data-softora-encoding' ? 'base64' : null),
  };
  const window = {
    atob: (value) => { atobCalls += 1; return atob(value); },
    TextDecoder,
    document: { getElementById: (id) => (id === 'softoraPageStateBootstrap' ? element : null) },
  };

  assert.equal(createPageBootstrapSession(window).get().displayName, 'Servé Creusen');
  assert.equal(JSON.parse(element.softoraDecodedBootstrap).mailbox.messages[0].subject, 'Offerte 💬 — “test”');
  assert.equal(createPageBootstrapSession(window).get().email, 'serve@softora.nl');
  assert.equal(atobCalls, 1, 'another reader reuses the decoded text');

  const fs = require('node:fs');
  const path = require('node:path');
  for (const file of ['assets/premium-ui-state-client.js', 'assets/premium-mailbox-campaign-inbox.js', 'assets/premium-page-bootstrap-session.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');
    assert.match(source, /typeof element\.softoraDecodedBootstrap === ['"]string['"]/, file);
    assert.doesNotMatch(source, /Uint8Array\.from\(binary/, `${file}: Uint8Array.from with a mapper costs ~350 ms on the 2 MB Mailbox bootstrap`);
  }
});
