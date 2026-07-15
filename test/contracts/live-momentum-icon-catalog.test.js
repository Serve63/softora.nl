const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');

test('live momentum exposes a safe and searchable icon catalog', () => {
  const catalog = require(path.join(repoRoot, 'assets/live-momentum-icon-catalog.js'));

  assert.ok(Array.isArray(catalog));
  assert.ok(catalog.length >= 300);
  assert.equal(new Set(catalog.map((icon) => icon.key)).size, catalog.length);
  assert.ok(catalog.every((icon) => /^[a-z0-9-]+$/.test(icon.key)));
  assert.ok(catalog.every((icon) => typeof icon.label === 'string' && icon.label.length > 0));
  assert.ok(catalog.every((icon) => typeof icon.category === 'string' && icon.category.length > 0));
  assert.ok(catalog.every((icon) => typeof icon.keywords === 'string' && icon.keywords.length > 0));
  assert.ok(catalog.every((icon) => /^<(?:path|circle|rect|line|polyline|polygon|ellipse)/.test(icon.markup)));
  assert.ok(catalog.every((icon) => !/<(?:script|style)|\bon\w+\s*=|javascript:/i.test(icon.markup)));
  const categories = new Map();
  catalog.forEach((icon) => categories.set(icon.category, (categories.get(icon.category) || 0) + 1));
  assert.ok(categories.size >= 16);
  assert.ok(Array.from(categories.values()).every((count) => count >= 16));
  assert.deepEqual(Array.from(catalog.slice(0, 4), (icon) => icon.key), ['dumbbell', 'book', 'target', 'heart']);
  assert.ok(catalog.some((icon) => icon.key === 'teeth' && icon.keywords.includes('tandenpoetsen')));
  assert.ok(catalog.some((icon) => icon.key === 'piggy-bank' && icon.keywords.includes('sparen')));
  assert.ok(catalog.some((icon) => icon.key === 'flower-2' && icon.keywords.includes('meditatie')));
  assert.ok(catalog.some((icon) => icon.key === 'dog' && icon.keywords.includes('wandelen')));
});
