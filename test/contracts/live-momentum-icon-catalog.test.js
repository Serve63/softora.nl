const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '../..');

test('live momentum exposes a safe and searchable icon catalog', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/live-momentum-icon-catalog.js'), 'utf8');
  const context = { window: {} };
  vm.runInNewContext(source, context);
  const catalog = context.window.SoftoraMomentumIconCatalog;

  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 30);
  assert.equal(new Set(catalog.map((icon) => icon.key)).size, catalog.length);
  assert.ok(catalog.every((icon) => /^[a-z0-9-]+$/.test(icon.key)));
  assert.ok(catalog.every((icon) => typeof icon.label === 'string' && icon.label.length > 0));
  assert.ok(catalog.every((icon) => typeof icon.keywords === 'string' && icon.keywords.length > 0));
  assert.ok(catalog.every((icon) => /^<(?:path|circle|rect)/.test(icon.markup)));
  assert.ok(catalog.every((icon) => !/<(?:script|style)|\bon\w+\s*=|javascript:/i.test(icon.markup)));
  assert.deepEqual(Array.from(catalog.slice(0, 4), (icon) => icon.key), ['dumbbell', 'book', 'target', 'heart']);
});
