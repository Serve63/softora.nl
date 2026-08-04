const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  OUTPUT_DIRECTORY_NAME,
  PUBLIC_SOURCE_DIRECTORIES,
  buildVercelStaticOutput,
} = require('../../scripts/build-vercel-static');

const repoRoot = path.resolve(__dirname, '../..');

test('Vercel publiceert alleen de expliciete asset-allowlist als statische output', (context) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-vercel-static-'));
  context.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));

  const expectedAsset = 'window.fixtureAsset = true;\n';
  fs.mkdirSync(path.join(fixtureRoot, 'assets', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'assets', 'nested', 'app.js'), expectedAsset);

  const privateSourceFiles = [
    'server.js',
    'AGENTS.md',
    'docs/security.md',
    'scripts/check-tracked-secrets.js',
    'server/security/auth.js',
    'supabase/runtime-state-schema.sql',
    'test/contracts/private.test.js',
    '.github/workflows/verify-critical.yml',
  ];
  for (const relativePath of privateSourceFiles) {
    const absolutePath = path.join(fixtureRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, 'private source fixture\n');
  }

  const result = buildVercelStaticOutput({ repoRoot: fixtureRoot });
  const outputEntries = fs.readdirSync(result.outputDirectory).sort();

  assert.equal(OUTPUT_DIRECTORY_NAME, '.vercel-static');
  assert.deepEqual(PUBLIC_SOURCE_DIRECTORIES, ['assets']);
  assert.deepEqual(result.publicSourceDirectories, ['assets']);
  assert.deepEqual(outputEntries, ['assets']);
  assert.equal(
    fs.readFileSync(path.join(result.outputDirectory, 'assets', 'nested', 'app.js'), 'utf8'),
    expectedAsset
  );
  for (const relativePath of privateSourceFiles) {
    assert.equal(fs.existsSync(path.join(result.outputDirectory, relativePath)), false, relativePath);
  }
});

test('Vercel-config gebruikt de afgeschermde static-output in plaats van de repositoryroot', () => {
  const vercelConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));

  assert.equal(vercelConfig.framework, null);
  assert.equal(vercelConfig.buildCommand, 'node scripts/build-vercel-static.js');
  assert.equal(vercelConfig.outputDirectory, '.vercel-static');
  assert.equal(vercelConfig.rewrites.at(-1).source, '/(.*)');
  assert.equal(vercelConfig.rewrites.at(-1).destination, '/api');
});
