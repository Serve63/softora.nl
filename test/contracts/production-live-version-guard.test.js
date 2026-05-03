const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractJsonObject,
  listLiveProductionVersionViolations,
  normalizeDeploymentHost,
} = require('../../scripts/check-live-production-version');

function createRunner(overrides = {}) {
  const responses = {
    'git fetch origin main --quiet': { status: 0, stdout: '' },
    'git rev-parse --verify origin/main': { status: 0, stdout: 'main-sha' },
    'npx vercel inspect www.softora.nl --format=json': {
      status: 0,
      stdout: 'Fetching deployment\n{"url":"softora-live.vercel.app","target":"production"}',
    },
    'npx vercel ls softora-nl --format=json': {
      status: 0,
      stdout: JSON.stringify({
        deployments: [
          {
            url: 'softora-live.vercel.app',
            target: 'production',
            meta: {
              gitCommitSha: 'main-sha',
              gitCommitRef: 'HEAD',
            },
          },
        ],
      }),
    },
    ...overrides,
  };

  return (command, args) => {
    return responses[[command, ...args].join(' ')] || {
      status: 1,
      stdout: '',
      stderr: 'unexpected command',
    };
  };
}

test('live production version guard accepts the deployment that matches origin/main', () => {
  const result = listLiveProductionVersionViolations({ runner: createRunner() });

  assert.equal(result.ok, true);
  assert.equal(result.expectedSha, 'main-sha');
  assert.equal(result.liveSha, 'main-sha');
});

test('live production version guard blocks rollback or stale production deployments', () => {
  const result = listLiveProductionVersionViolations({
    runner: createRunner({
      'npx vercel ls softora-nl --format=json': {
        status: 0,
        stdout: JSON.stringify({
          deployments: [
            {
              url: 'softora-live.vercel.app',
              target: 'production',
              meta: {
                githubCommitSha: 'old-sha',
                githubCommitRef: 'codex/old-branch',
              },
            },
          ],
        }),
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /draait op old-sha, maar origin\/main is main-sha/);
});

test('live production version guard blocks deployments without Git metadata', () => {
  const result = listLiveProductionVersionViolations({
    runner: createRunner({
      'npx vercel ls softora-nl --format=json': {
        status: 0,
        stdout: JSON.stringify({
          deployments: [
            {
              url: 'softora-live.vercel.app',
              target: 'production',
              meta: {},
            },
          ],
        }),
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /geen Git commit metadata/);
});

test('live production version helpers parse noisy Vercel JSON and normalize hosts', () => {
  assert.deepEqual(extractJsonObject('noise\n{"ok":true}\n'), { ok: true });
  assert.equal(normalizeDeploymentHost('https://softora-live.vercel.app/'), 'softora-live.vercel.app');
});
