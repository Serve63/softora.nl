const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('hourly activity counts committed initial research across producer changes', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'test', '-p', 'kvk_activity_counts_test.py', '-v'], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});
