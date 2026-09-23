const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateNewPersonnelPageStyle, validatePlatformArchitecture, readBaseline, resolveBaselineRef } = require('../../scripts/check-platform-architecture');
const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

function fixture() {
  return {
    files: new Set(['old.html']),
    baselineFiles: new Set(['old.html']),
    baseline: null,
    registry: { schemaVersion: 1, pages: { 'old.html': { delivery: 'legacy-document', targetReadyMs: 3000 } } },
    readFile: () => 'test contract',
  };
}

test('initial inventory accepts only actual pre-existing documents', () => {
  const input = fixture();
  assert.deepEqual(validatePlatformArchitecture(input), []);
  input.files.add('new.html');
  assert.match(validatePlatformArchitecture(input).join('\n'), /not registered/);
  input.registry.pages['new.html'] = { delivery: 'legacy-document', targetReadyMs: 3000 };
  assert.match(validatePlatformArchitecture(input).join('\n'), /new legacy exceptions/);
});

test('new personnel pages must use the canonical visual foundation', () => {
  const template = fs.readFileSync(path.join(__dirname, '../../templates/premium-personnel-page.html'), 'utf8');
  assert.deepEqual(validateNewPersonnelPageStyle('premium-new.html', template), []);
  assert.deepEqual(validateNewPersonnelPageStyle('personeel-new.html', template), []);
  assert.deepEqual(validateNewPersonnelPageStyle('public-new.html', '<html></html>'), []);

  const input = fixture();
  input.files.add('premium-new.html');
  input.registry.pages['premium-new.html'] = {
    delivery: 'public-document', targetReadyMs: 3000,
    readinessContract: 'test/contracts/new-page.test.js',
    requiredData: [], requiredImages: [], freshness: 'static',
  };
  input.readFile = (file) => file === 'premium-new.html'
    ? '<body><div data-sidebar-shell="canonical"><aside class="sidebar"></aside><h1>Nieuw</h1></div></body>'
    : 'test contract';
  const errors = validatePlatformArchitecture(input).join('\n');
  assert.match(errors, /new personnel page needs shared fonts\.css/);
  assert.match(errors, /new personnel page needs h1\.page-title/);
  assert.match(errors, /new personnel page needs p\.page-subtitle/);
  assert.match(errors, /load personnel-page-base\.css after page-specific stylesheets/);
  input.readFile = (file) => file === 'premium-new.html' ? template : 'test contract';
  assert.deepEqual(validatePlatformArchitecture(input), []);
});

test('migration cannot regress or quietly increase its complete readiness budget', () => {
  const input = fixture();
  input.baseline = { pages: { 'old.html': { delivery: 'public-document', targetReadyMs: 2500 } } };
  const errors = validatePlatformArchitecture(input).join('\n');
  assert.match(errors, /migration regressions/);
  assert.match(errors, /budget cannot grow/);
  input.registry.pages['old.html'].targetReadyMs = 4000;
  assert.match(validatePlatformArchitecture(input).join('\n'), /at most 3000/);
});

test('new documents declare completion evidence and unknown modes fail closed', () => {
  const input = fixture();
  const page = input.registry.pages['old.html'];
  page.delivery = 'public-document';
  assert.match(validatePlatformArchitecture(input).join('\n'), /readiness contract/i);
  page.readinessContract = 'test/contracts/public-page.test.js';
  page.requiredData = [];
  page.requiredImages = ['hero'];
  page.freshness = 'versioned static assets';
  assert.deepEqual(validatePlatformArchitecture(input), []);
  input.readFile = () => { throw new Error('Missing'); };
  assert.match(validatePlatformArchitecture(input).join('\n'), /contract does not exist/);
  page.delivery = 'invented';
  assert.match(validatePlatformArchitecture(input).join('\n'), /unknown delivery/);
});

test('isolation and module migration cannot be asserted without their implementation', () => {
  const input = fixture();
  input.registry.pages['old.html'].delivery = 'isolated-document';
  assert.match(validatePlatformArchitecture(input).join('\n'), /requires a reason/);
  input.registry.pages['old.html'].delivery = 'application-module';
  assert.match(validatePlatformArchitecture(input).join('\n'), /verified shared runtime/);
});

test('stale registry records fail, and real router preserves shell preference and fallback', () => {
  const input = fixture();
  input.files.clear();
  assert.match(validatePlatformArchitecture(input).join('\n'), /missing HTML/);
  const map = createKnownPrettyPageSlugToFile(new Set([
    'premium-kvk-database.html', 'premium-kvk-database-shell.html', 'premium-mailbox.html',
    'premium-ai-coldmailing.html', 'sportschool.html', 'live-momentum.html',
  ]));
  assert.equal(map.get('kvk-database'), 'premium-kvk-database-shell.html');
  assert.equal(map.get('mailbox'), 'premium-mailbox.html');
  assert.equal(map.get('premium-leads'), 'premium-ai-coldmailing.html');
  assert.equal(map.get('logboek'), 'sportschool.html');
  assert.equal(map.get('winnen'), 'live-momentum.html');
  assert.equal(createKnownPrettyPageSlugToFile(new Set(['premium-kvk-database.html'])).get('kvk-database'),
    'premium-kvk-database.html');
});

test('committing a new legacy exception cannot make it part of its own baseline', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-architecture-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', encoding: 'utf8' }).trim();
  git('init', '-b', 'main');
  git('config', 'user.name', 'Architecture Test');
  git('config', 'user.email', 'architecture@example.invalid');
  fs.writeFileSync(path.join(root, 'old.html'), '<html></html>');
  git('add', '.'); git('commit', '-m', 'base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('switch', '-c', 'codex/fixture');
  fs.mkdirSync(path.join(root, 'server/config'), { recursive: true });
  const input = fixture();
  input.files.add('new.html');
  input.registry.pages['new.html'] = { delivery: 'legacy-document', targetReadyMs: 3000 };
  fs.writeFileSync(path.join(root, 'new.html'), '<html></html>');
  fs.writeFileSync(path.join(root, 'server/config/platform-pages.json'), JSON.stringify(input.registry));
  git('add', '.'); git('commit', '-m', 'bad exception');
  const baseline = readBaseline(root, {});
  assert.equal(baseline.baseline, null);
  assert.equal(baseline.baselineFiles.has('new.html'), false);
  assert.match(validatePlatformArchitecture({ ...input, ...baseline }).join('\n'), /new legacy exceptions/);
  const baseSha = git('rev-parse', 'origin/main');
  git('switch', 'main');
  git('merge', '--no-ff', 'codex/fixture', '-m', 'PR merge fixture');
  const head = git('rev-parse', 'HEAD');
  const ciEnv = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_SHA: head, GITHUB_REF: 'refs/pull/1/merge' };
  const ciBaseline = readBaseline(root, ciEnv);
  assert.equal(ciBaseline.baselineFiles.has('new.html'), false);
  const calls = [];
  const selected = resolveBaselineRef(root, ciEnv, (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') return head;
    if (args[1] === '-p') return `tree ${head}\nparent ${baseSha}\n\nMessage`;
    if (args[1] === '-e') throw new Error('Shallow checkout');
    return '';
  });
  assert.equal(selected, baseSha);
  assert.deepEqual(calls[3], ['fetch', '--no-tags', '--depth=1', 'origin', baseSha]);
  assert.throws(() => resolveBaselineRef(root, { ...ciEnv, GITHUB_SHA: 'another-checkout' }),
    /exact GitHub merge commit/);
  assert.throws(() => resolveBaselineRef(root, { ...ciEnv, GITHUB_REF: 'refs/heads/feature' }),
    /exact GitHub merge commit/);
});
