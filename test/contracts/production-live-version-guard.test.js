const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractJsonObject,
  listLiveProductionVersionViolations,
  normalizeDeploymentHost,
  resolveHealthDeploymentSha,
} = require('../../scripts/check-live-production-version');
const {
  parsePositiveInteger,
  resolveWaitConfig,
  waitForLiveProductionVersion,
} = require('../../scripts/wait-live-production-version');

function createRunner(overrides = {}) {
  const responses = {
    'git fetch origin main --quiet': { status: 0, stdout: '' },
    'git rev-parse --verify origin/main': { status: 0, stdout: 'main-sha' },
    'curl --fail --silent --show-error --max-time 20 https://www.softora.nl/api/health/baseline': {
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        deployment: {
          commitSha: 'main-sha',
          commitRef: 'main',
        },
      }),
    },
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
  assert.equal(result.method, 'health');
});

test('live production version guard blocks rollback or stale production deployments', () => {
  const result = listLiveProductionVersionViolations({
    runner: createRunner({
      'curl --fail --silent --show-error --max-time 20 https://www.softora.nl/api/health/baseline': {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          deployment: {
            commitSha: 'old-sha',
            commitRef: 'codex/old-branch',
          },
        }),
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.match(result.violations.join('\n'), /meldt old-sha, maar origin\/main is main-sha/);
});

test('live production version guard blocks deployments without Git metadata', () => {
  const result = listLiveProductionVersionViolations({
    runner: createRunner({
      'curl --fail --silent --show-error --max-time 20 https://www.softora.nl/api/health/baseline': {
        status: 22,
        stdout: '',
        stderr: 'not found',
      },
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
  assert.equal(resolveHealthDeploymentSha({ deployment: { commitSha: 'abc123' } }), 'abc123');
});

test('live production version guard falls back to Vercel metadata while old production has no health commit', () => {
  const result = listLiveProductionVersionViolations({
    runner: createRunner({
      'curl --fail --silent --show-error --max-time 20 https://www.softora.nl/api/health/baseline': {
        status: 0,
        stdout: JSON.stringify({ ok: true, deployment: { commitSha: null } }),
      },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.liveSha, 'main-sha');
  assert.equal(result.method, 'vercel');
});

test('live production version wait helper retries until Vercel auto deploy reaches main', async () => {
  let attempts = 0;
  const result = await waitForLiveProductionVersion({
    maxAttempts: 3,
    intervalMs: 1,
    sleep: async () => {},
    assertFn: () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('[live-production] Productie wijkt af van main.');
      }
      return {
        liveSha: 'main-sha',
        liveRef: 'main',
      };
    },
  });

  assert.equal(result.attempts, 3);
  assert.equal(result.liveSha, 'main-sha');
});

test('live production version wait helper exposes stable timeout configuration', () => {
  assert.equal(parsePositiveInteger('2500', 10), 2500);
  assert.equal(parsePositiveInteger('nope', 10), 10);
  assert.deepEqual(
    resolveWaitConfig({
      LIVE_PRODUCTION_WAIT_TIMEOUT_MS: '60000',
      LIVE_PRODUCTION_WAIT_INTERVAL_MS: '15000',
    }),
    {
      intervalMs: 15000,
      maxAttempts: 5,
    }
  );
});
