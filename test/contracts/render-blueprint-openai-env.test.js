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

test('render blueprint keeps paid Google APIs disabled by default', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../render.yaml'), 'utf8');
  const [softoraService, twilioBridgeService = ''] = source.split(
    /\n  - type: web\n    name: twilio-media-bridge/
  );

  assert.match(softoraService, /- key: GOOGLE_PAID_APIS_ENABLED\s+value: false/);
  assert.match(softoraService, /- key: GOOGLE_PAID_APIS_HARD_BLOCK\s+value: true/);
  assert.match(softoraService, /- key: GOOGLE_CALENDAR_SYNC_ENABLED\s+value: false/);
  assert.match(softoraService, /- key: TWILIO_MEDIA_WS_URL_GEMINI_FLASH_3_1_LIVE\s+value: ""/);
  assert.match(twilioBridgeService, /- key: GOOGLE_PAID_APIS_ENABLED\s+value: false/);
  assert.match(twilioBridgeService, /- key: GOOGLE_PAID_APIS_HARD_BLOCK\s+value: true/);
  assert.match(twilioBridgeService, /- key: GEMINI_AUTO_START\s+value: false/);
  assert.match(twilioBridgeService, /- key: AMBIENT_ONLY_MODE\s+value: true/);
});
