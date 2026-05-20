const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('render blueprint preserves OpenAI billing and project env placeholders', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../render.yaml'), 'utf8');
  const softoraService = source.split(/\n  - type: web\n    name: twilio-media-bridge/)[0] || '';

  [
    'OPENAI_API_KEY',
    'OPENAI_ADMIN_KEY',
    'OPENAI_ADMIN_API_KEY',
    'OPENAI_COSTS_API_KEY',
    'OPENAI_ORGANIZATION_ID',
    'OPENAI_ORG_ID',
    'OPENAI_PROJECT_ID',
  ].forEach((key) => {
    assert.match(
      softoraService,
      new RegExp(`- key: ${key}\\n\\s+sync: false`),
      `${key} moet als sync:false in render.yaml staan zodat Blueprint-deploys de waarde niet wissen.`
    );
  });
});
