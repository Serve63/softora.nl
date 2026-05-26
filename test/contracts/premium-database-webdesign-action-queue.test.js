const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('premium database webdesign action starts clicked jobs through one local queue', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../assets/premium-database-webdesign-action.js'),
    'utf8'
  );

  assert.match(source, /let startQueue = Promise\.resolve\(\);/);
  assert.match(source, /function enqueueStart\(starter\)/);
  assert.match(source, /startQueue = next\.catch\(function \(\) \{/);
  assert.match(source, /return enqueueStart\(function \(\) \{\s*return startQueuedGeneration\(target, jobId\);\s*\}\);/);
});

test('premium database page loads the queued webdesign action asset version', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../premium-database.html'), 'utf8');

  assert.match(page, /assets\/premium-database-webdesign-action\.js\?v=20260526a/);
});
