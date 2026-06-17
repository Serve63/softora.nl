const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  getSoftoraLocalEnvCandidates,
  loadSoftoraLocalEnv,
} = require('../../server/config/load-local-env');

function withEnvSnapshot(fn) {
  const original = {
    GSC_CLIENT_ID: process.env.GSC_CLIENT_ID,
    GSC_CLIENT_SECRET: process.env.GSC_CLIENT_SECRET,
    GSC_REFRESH_TOKEN: process.env.GSC_REFRESH_TOKEN,
    SOFTORA_ENV_FILE: process.env.SOFTORA_ENV_FILE,
  };
  return async () => {
    delete process.env.GSC_CLIENT_ID;
    delete process.env.GSC_CLIENT_SECRET;
    delete process.env.GSC_REFRESH_TOKEN;
    delete process.env.SOFTORA_ENV_FILE;
    try {
      await fn();
    } finally {
      for (const [key, value] of Object.entries(original)) {
        if (typeof value === 'undefined') delete process.env[key];
        else process.env[key] = value;
      }
    }
  };
}

test(
  'load local env prefers repo env and falls back to shared softora env files',
  withEnvSnapshot(async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'softora-local-env-'));
    const projectRootDir = path.join(tempRoot, 'project');
    const homeDir = path.join(tempRoot, 'home');
    fs.mkdirSync(projectRootDir, { recursive: true });
    fs.mkdirSync(path.join(homeDir, '.config', 'softora'), { recursive: true });

    fs.writeFileSync(
      path.join(homeDir, '.config', 'softora', 'search-console.env'),
      'GSC_CLIENT_ID=shared-client\nGSC_CLIENT_SECRET=shared-secret\nGSC_REFRESH_TOKEN=shared-refresh\n'
    );
    loadSoftoraLocalEnv({ projectRootDir, cwd: projectRootDir, homeDir });

    assert.equal(process.env.GSC_CLIENT_ID, 'shared-client');
    assert.equal(process.env.GSC_CLIENT_SECRET, 'shared-secret');
    assert.equal(process.env.GSC_REFRESH_TOKEN, 'shared-refresh');

    fs.writeFileSync(
      path.join(projectRootDir, '.env'),
      'GSC_CLIENT_ID=repo-client\nGSC_CLIENT_SECRET=repo-secret\nGSC_REFRESH_TOKEN=repo-refresh\n'
    );
    delete process.env.GSC_CLIENT_ID;
    delete process.env.GSC_CLIENT_SECRET;
    delete process.env.GSC_REFRESH_TOKEN;

    loadSoftoraLocalEnv({ projectRootDir, cwd: projectRootDir, homeDir });
    assert.equal(process.env.GSC_CLIENT_ID, 'repo-client');
    assert.equal(process.env.GSC_CLIENT_SECRET, 'repo-secret');
    assert.equal(process.env.GSC_REFRESH_TOKEN, 'repo-refresh');
  })
);

test('local env candidates include the shared softora search console file', () => {
  const candidates = getSoftoraLocalEnvCandidates({
    projectRootDir: '/tmp/project',
    cwd: '/tmp/project',
    homeDir: '/tmp/home',
  });

  assert.ok(candidates.includes('/tmp/home/.config/softora/search-console.env'));
  assert.ok(candidates.includes('/tmp/project/.env'));
});
