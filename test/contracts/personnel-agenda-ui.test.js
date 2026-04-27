const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const pagePath = path.join(__dirname, '../../personeel-agenda.html');

function readPage() {
  return fs.readFileSync(pagePath, 'utf8');
}

test('personeel agenda gebruikt delegated actions zonder inline handlers', () => {
  const source = readPage();

  assert.doesNotMatch(source, /\son(?:click|input|change|keydown|submit)=/i);
  assert.match(source, /data-modal-close/);
  assert.match(source, /data-month-offset="-1"/);
  assert.match(source, /data-month-offset="1"/);
  assert.match(source, /data-appointment-id="\$\{apt\.id\}"/);
  assert.match(source, /calendarGrid\.addEventListener\('click'/);
  assert.match(source, /calendarGrid\.addEventListener\('keydown'/);
});

test('personeel agenda rendert server-afspraken als veilige tekst', () => {
  const source = readPage();

  assert.match(source, /function escapeAgendaHtml\(value\)/);
  assert.match(source, /escapeAgendaHtml\(apt\.company\)/);
  assert.match(source, /role="button" tabindex="0"/);
});
