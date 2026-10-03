const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const folder = path.join(root, 'scripts/kvk_robot_v8_shadow');

test('v8 replay guards block external work, source writes and nested output', () => {
  const result = spawnSync('python3', [path.join(folder, 'test_replay_guard.py')], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stderr, /Ran 4 tests/);
  assert.match(result.stderr, /OK/);
});

test('v8 remains an explicit shadow experiment outside the installed engine list', () => {
  const runtime = fs.readFileSync(path.join(root, 'scripts/kvk_robot_v5.py'), 'utf8');
  assert.doesNotMatch(runtime, /kvk_robot_v8_shadow|['"]v8['"]\s*:/);
  const replay = fs.readFileSync(path.join(folder, 'replay.py'), 'utf8');
  assert.match(replay, /parser\.add_argument\("--candidate", action="store_true"\)/);
});

test('v8 comparison refuses partial coverage, changed sources and unsafe audits', () => {
  const result = spawnSync('python3', [path.join(folder, 'test_compare.py')], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stderr, /Ran 4 tests/);
  assert.match(result.stderr, /OK/);
});
