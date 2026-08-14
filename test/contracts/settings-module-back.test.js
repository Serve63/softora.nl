const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '../..');
const routes = require('../../assets/settings-module-routes');

function read(file) {
  return fs.readFileSync(path.join(repoRoot, file), 'utf8');
}

test('de Extra-catalogus is de centrale route-inventory voor Instellingen-modules', () => {
  const linked = routes.getLinkedModules();
  assert.deepEqual(linked.map((module) => module.href), [
    '/winnen',
    '/kvk-database',
    '/premium-gezondheidsdossier',
    '/premium-omzetwerk',
  ]);
  assert.equal(routes.RETURN_HREF, '/premium-instellingen#extra');
  assert.equal(routes.findByPath('/live-momentum.html')?.href, '/winnen');
  assert.equal(routes.findByPath('/premium-personeel-dashboard'), null);

  const settings = read('premium-instellingen.html');
  const renderer = read('assets/premium-user-management.js');
  assert.match(settings, /settings-module-routes\.js\?v=20260814a/);
  assert.match(renderer, /SoftoraSettingsModuleRoutes/);
  assert.match(renderer, /moduleRoutes\.EXTRA_MODULES\.slice\(\)/);
  assert.match(renderer, /window\.location\.hash === '#extra'/);
  assert.doesNotMatch(renderer, /\? '\/winnen'[\s\S]*\? '\/kvk-database'/);
});

test('ieder doelbestand heeft exact één gedeelde host en dezelfde componentassets', () => {
  routes.getLinkedModules().forEach((module) => {
    module.files.forEach((file) => {
      const source = read(file);
      assert.equal((source.match(/data-settings-module-back-host/g) || []).length, 1, file);
      assert.match(source, /settings-module-back\.css\?v=20260814a/, file);
      assert.match(source, /settings-module-routes\.js\?v=20260814a/, file);
      assert.match(source, /settings-module-back\.js\?v=20260814a/, file);
      assert.equal((source.match(/class="settings-module-back"/g) || []).length, 0, file);
    });
  });
});

test('gedeelde terugknop is deterministisch, toegankelijk, mobiel en niet history-afhankelijk', () => {
  const source = read('assets/settings-module-back.js');
  const styles = read('assets/settings-module-back.css');

  assert.match(source, /routes\?\.findByPath\?\.\(window\.location\.pathname\)/);
  assert.match(source, /hosts\.length !== 1/);
  assert.match(source, /document\.querySelector\('\.settings-module-back'\)/);
  assert.match(source, /link\.href = routes\.RETURN_HREF/);
  assert.match(source, /aria-label', 'Terug naar instellingen'/);
  assert.doesNotMatch(source, /history\.back|location\.reload|localStorage|sessionStorage/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /@media \(max-width:\s*620px\)/);
});

test('locked en unlocked Winnen blijven één veilige gedeelde uitweg houden', () => {
  const locked = read('live-momentum-access.html');
  const unlocked = read('live-momentum.html');

  assert.equal((locked.match(/data-settings-module-back-host/g) || []).length, 1);
  assert.match(locked, /aria-label="Toegangsscherm sluiten"/);
  assert.doesNotMatch(locked, /momentum-settings-back/);
  assert.equal((unlocked.match(/data-settings-module-back-host/g) || []).length, 1);
  assert.doesNotMatch(unlocked, /momentum-settings-back/);
});
