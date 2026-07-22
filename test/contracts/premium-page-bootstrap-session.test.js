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
