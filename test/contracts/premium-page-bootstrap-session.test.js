const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, '../../assets/premium-page-bootstrap-session.js'),
  'utf8'
);

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

  vm.runInNewContext(source, { window });

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

  vm.runInNewContext(source, { window });

  assert.equal(window.SoftoraPageBootstrapSession.get(), null);
});
