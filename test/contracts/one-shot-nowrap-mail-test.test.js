'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('temporary nowrap mail trigger is token protected and forces only the existing cron route', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../api/one-shot-nowrap-mail-test.js'),
    'utf8'
  );

  assert.match(source, /ONE_SHOT_TOKEN/);
  assert.match(source, /process\.env\.CRON_SECRET/);
  assert.match(source, /\/api\/coldmailing\/autopilot\/run/);
  assert.match(source, /JSON\.stringify\(\{ force: true \}\)/);
  assert.match(source, /Cache-Control', 'no-store/);
});
