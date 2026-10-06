const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'assets/website-showcase/availability.js'), 'utf8');

function loadAvailability(instant) {
  const label = { textContent: '' };
  let currentInstant = instant;
  let refresh;
  let onVisibilityChange;
  const document = {
    hidden: false,
    querySelector: () => label,
    addEventListener: (event, handler) => {
      if (event === 'visibilitychange') onVisibilityChange = handler;
    }
  };
  vm.runInNewContext(source, {
    document,
    Intl,
    Date: class extends Date {
      constructor() { super(currentInstant); }
    },
    window: { setInterval: handler => { refresh = handler; } }
  });
  return {
    label,
    refreshAt: instant => { currentInstant = instant; refresh(); },
    showAt: instant => { currentInstant = instant; onVisibilityChange(); }
  };
}

test('website availability shows four places with the current Dutch month', () => {
  const html = fs.readFileSync(path.join(root, 'assets/website-showcase/index.html'), 'utf8');
  assert.match(html, /data-website-availability>4 plekken beschikbaar deze maand\./);
  assert.match(html, /<script src="availability\.js\?[^\"]+" defer><\/script>/);
  assert.doesNotMatch(html, /september<!-- --> zijn 4 plekken/);
  assert.equal(loadAvailability('2026-10-06T13:00:00Z').label.textContent, '4 plekken beschikbaar in oktober.');
});

test('an open website rolls over at the Dutch month and year boundary', () => {
  const availability = loadAvailability('2026-12-31T22:59:59Z');
  assert.equal(availability.label.textContent, '4 plekken beschikbaar in december.');
  availability.refreshAt('2026-12-31T23:00:00Z');
  assert.equal(availability.label.textContent, '4 plekken beschikbaar in januari.');
});

test('returning to the website refreshes the month using Dutch summer time', () => {
  const availability = loadAvailability('2026-09-30T21:59:59Z');
  assert.equal(availability.label.textContent, '4 plekken beschikbaar in september.');
  availability.showAt('2026-09-30T22:00:00Z');
  assert.equal(availability.label.textContent, '4 plekken beschikbaar in oktober.');
});
