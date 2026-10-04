const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { robotLocationText } = require('../../assets/kvk-database-mobile-heading');

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

test('without a Robot label the active planning row is used, and nothing when there is none', () => {
  assert.equal(robotLocationText(list([row({ place: 'Vught', progress: 'Controle: 16%', active: true })])), 'Vught · 16%');
  assert.equal(robotLocationText(list([row({ place: 'Vught', progress: '' })])), '');
  assert.equal(robotLocationText(null), '');
});

test('the location and the white Safari bars are phone-only', () => {
  const page = fs.readFileSync(path.join(root, 'premium-kvk-database.html'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'premium-kvk-database-shell.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'assets/kvk-database-mobile.css'), 'utf8');
  assert.match(page, /<h2>Recent onderzocht<\/h2>\s*<span id="latest-robot-location"[^>]*hidden><\/span>/);
  assert.match(page, /kvk-database-mobile-heading\.js\?v=/);
  assert.match(page, /<meta name="theme-color" content="#ffffff" media="\(max-width: 700px\)">/);
  assert.match(shell, /<meta name="theme-color" content="#ffffff" media="\(max-width: 700px\)">/);
  assert.match(css, /^\/\* Only the phone heading shows where the Robot works\. \*\/\n\.latest-robot-location \{ display: none; \}/);
});
