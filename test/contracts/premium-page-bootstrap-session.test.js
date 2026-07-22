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
