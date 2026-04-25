const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createKnownPrettyPageSlugToFile } = require('../../server/config/page-routing');

test('agenda app page is available as pretty page and uses shared agenda endpoints', () => {
  const pagePath = path.join(__dirname, '../../agendaapp.html');
  const pageSource = fs.readFileSync(pagePath, 'utf8');
  const prettyPages = createKnownPrettyPageSlugToFile(new Set(['agendaapp.html']));

  assert.equal(prettyPages.get('agendaapp'), 'agendaapp.html');
  assert.match(pageSource, /<title>Softora Agenda App<\/title>/);
  assert.match(pageSource, /apple-mobile-web-app-capable/);
  assert.match(pageSource, /Softora Agenda App/);
  assert.match(pageSource, /id="agendaAppAppointments"/);
  assert.match(pageSource, /id="agendaAppForm"/);
  assert.match(pageSource, /data|zelfde agenda-data/i);
  assert.match(pageSource, /\/api\/agenda\/appointments\?fresh=1&limit=80/);
  assert.match(pageSource, /\/api\/agenda\/appointments\/manual/);
  assert.match(pageSource, /id="agendaAppWho"/);
  assert.match(pageSource, /<option value="serve">Servé<\/option>/);
  assert.match(pageSource, /<option value="martijn">Martijn<\/option>/);
  assert.match(pageSource, /<option value="both">Allebei<\/option>/);
  assert.match(pageSource, /actor: 'agendaapp'/);
});
