const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const repoRoot = path.resolve(__dirname, '../..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('paid Google API entrypoints are hard-blocked by default in source', () => {
  const twilioBridge = readRepoFile('twilio-media-bridge/server.js');
  const placesImport = readRepoFile('server/services/premium-database-import.js');
  const agendaTravel = readRepoFile('server/services/agenda-travel.js');
  const agendaBootstrap = readRepoFile('server/services/agenda-page-bootstrap.js');

  assert.match(twilioBridge, /GOOGLE_PAID_APIS_HARD_BLOCK/);
  assert.match(twilioBridge, /&& !GOOGLE_PAID_APIS_HARD_BLOCK/);
  assert.match(twilioBridge, /const GEMINI_API_KEY = GOOGLE_PAID_APIS_ENABLED \? RAW_GEMINI_API_KEY : ''/);

  assert.match(placesImport, /GOOGLE_PAID_APIS_HARD_BLOCK/);
  assert.match(placesImport, /if \(hardBlock\) return false/);
  assert.match(placesImport, /GOOGLE_PAID_APIS_DISABLED/);

  assert.match(agendaTravel, /GOOGLE_PAID_APIS_HARD_BLOCK/);
  assert.match(agendaTravel, /return ''/);
  assert.match(agendaBootstrap, /GOOGLE_PAID_APIS_HARD_BLOCK/);
  assert.match(agendaBootstrap, /return ''/);
});

test('Render blueprint keeps paid Google spend impossible without two explicit switches', () => {
  const renderYaml = readRepoFile('render.yaml');

  assert.match(renderYaml, /- key: GOOGLE_PAID_APIS_ENABLED\s+value: false/);
  assert.match(renderYaml, /- key: GOOGLE_PAID_APIS_HARD_BLOCK\s+value: true/);
  assert.match(renderYaml, /- key: GEMINI_AUTO_START\s+value: false/);
  assert.match(renderYaml, /- key: AMBIENT_ONLY_MODE\s+value: true/);
  assert.match(renderYaml, /- key: TWILIO_MEDIA_WS_URL_GEMINI_FLASH_3_1_LIVE\s+value: ""/);
  assert.doesNotMatch(renderYaml, /TWILIO_MEDIA_WS_URL_GEMINI_FLASH_3_1_LIVE\s+value:\s+wss:/);
});
