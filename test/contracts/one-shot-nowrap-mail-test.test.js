'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('temporary nowrap mail trigger is token protected and only patches the isolated cron run', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../api/one-shot-nowrap-mail-test.js'),
    'utf8'
  );

  assert.match(source, /ONE_SHOT_TOKEN/);
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /require\.resolve\('\.\.\/server\/routes\/coldmailing'\)/);
  assert.match(source, /force: false/);
  assert.match(source, /force: true/);
  assert.match(source, /patchedModule\._compile/);
  assert.match(source, /\/api\/coldmailing\/autopilot\/run/);
  assert.match(source, /req\.method = 'GET'/);
  assert.match(source, /Cache-Control', 'no-store/);
});
