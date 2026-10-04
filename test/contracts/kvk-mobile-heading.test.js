const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { robotLocationText, filterRows } = require('../../assets/kvk-database-mobile-heading');

const root = path.join(__dirname, '../..');

// A planning row as the dashboard renders it, reduced to what the heading reads.
function row({ place, progress, robot = false, active = false }) {
  const item = { closest: () => item };
  const pathNode = { firstChild: { textContent: `Nederland | Noord-Brabant | Heusden | ${place}` }, textContent: '' };
  const parts = {
    '.location-path': pathNode,
    '.location-stage-progress': { textContent: progress },
  };
  item.querySelector = selector => parts[selector] || null;
  return { item, robot, active };
}

function list(rows) {
  return {
    querySelectorAll: () => rows.map(r => r.item),
    querySelector(selector) {
      const match = rows.find(r => (selector.includes('is-robot') && r.robot) || (selector.includes('is-contact-active') && r.active));
      return match ? { closest: () => match.item } : null;
    },
  };
}

test('the phone heading names the place the Robot works in with its progress', () => {
  const rows = [row({ place: 'Haaren', progress: 'Afgerond: 100%' }), row({ place: 'Drunen', progress: 'Onderzoek: 45%', robot: true })];
  assert.equal(robotLocationText(list(rows)), 'Drunen · 45%');
});

test('the heading adds the usable companies found in that place', () => {
  const rows = [row({ place: 'Drunen', progress: 'Onderzoek: 45%', robot: true })];
  const counts = new Map([['nederland | noord-brabant | heusden | drunen', 1234]]);
  assert.equal(robotLocationText(list(rows), counts), 'Drunen · 45% · 1.234 bruikbaar');
});

test('the place of the Robot\'s latest company wins over the planning head it works ahead of', () => {
  const rows = [row({ place: 'Drunen', progress: 'Onderzoek: 50%', robot: true }), row({ place: 'Vlijmen', progress: 'Onderzoek: 12%' })];
  assert.equal(robotLocationText(list(rows), new Map(), 'Vlijmen'), 'Vlijmen · 12%');
  assert.equal(robotLocationText(list(rows), new Map(), 'Onbekend'), 'Drunen · 50%');
});

test('without a Robot label the active planning row is used, and nothing when there is none', () => {
  assert.equal(robotLocationText(list([row({ place: 'Vught', progress: 'Controle: 16%', active: true })])), 'Vught · 16%');
  assert.equal(robotLocationText(list([row({ place: 'Vught', progress: '' })])), '');
  assert.equal(robotLocationText(null), '');
});

function fakeBody(producers) {
  const rows = producers.map(name => ({
    hidden: false,
    classList: { contains: () => false },
    cells: [{}, {}, {}, { querySelector: () => ({ textContent: name }), textContent: name }],
  }));
  const body = {
    rows,
    appended: [],
    querySelector: () => body.appended[0] || null,
    ownerDocument: {
      createElement: () => {
        const cell = { textContent: '' };
        const row = { className: '', set innerHTML(_v) {}, cells: [cell], remove: () => { body.appended = []; } };
        return row;
      },
    },
    appendChild: row => { body.appended.push(row); },
  };
  return body;
}

test('the picker shows only the chosen robot and says so when it has no work yet', () => {
  const body = fakeBody(['Robot', 'Controleur', 'Robot']);
  assert.equal(filterRows(body, 'searcher'), 2);
  assert.deepEqual(body.rows.map(row => row.hidden), [false, true, false]);
  assert.equal(filterRows(body, 'controller'), 0);
  assert.equal(body.appended[0].cells[0].textContent, 'Nog geen controles van de Robot Controleur.');
  const withControl = fakeBody(['Robot Controleur']);
  assert.equal(filterRows(withControl, 'controller'), 1);
});

test('the location and the white Safari bars are phone-only', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'premium-kvk-database-shell.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/kvk-database-mobile.css'), 'utf8');
  assert.match(page, /<option value="searcher">Robot Searcher<\/option>\s*<option value="controller">Robot Controleur<\/option>/);
  assert.match(page, /<span id="latest-robot-location"[^>]*hidden><\/span>/);
  assert.match(page, /kvk-database-mobile-heading\.js\?v=/);
  assert.match(page, /<meta name="theme-color" content="#ffffff" media="\(max-width: 700px\)">/);
  assert.match(shell, /<meta name="theme-color" content="#ffffff" media="\(max-width: 700px\)">/);
  assert.match(css, /^\/\* Only the phone heading shows the robot picker and where the Robot works\. \*\/\n\.latest-robot-location, \.latest-role-picker \{ display: none; \}/);
});
