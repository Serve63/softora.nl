const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.join(__dirname, '../..');

function createElement() {
  const classes = new Set();
  return {
    textContent: '',
    innerHTML: '',
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
  };
}

test('kvk database metrics render current last-hour and grade values without another snapshot request', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'assets/kvk-database-metrics.js'), 'utf8');
  const elementIds = [
    'companies-treated-last60',
    'companies-usable-last60',
    'companies-with-website-last60',
    'companies-without-website-last60',
    'companies-unusable-grade-1',
    'companies-unusable-grade-2',
    'companies-unusable-grade-3',
    'companies-unusable-grade-1-last60',
    'companies-unusable-grade-2-last60',
    'companies-unusable-grade-3-last60',
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [id, createElement()]));
  let intervalCallback = null;
  let fetchCalls = 0;
  const context = vm.createContext({
    activeSnapshot: {
      state: {
        unusable_grades: { 1: 24_412, 2: 30, 3: 121 },
        last_60_minutes: {
          treated: 12,
          usable: 6,
          with_website: 5,
          without_website: 1,
          unusable_grades: { 1: 6, 2: 0, 3: 0 },
          unusable_grade_activity: {
            1: { added: 6, removed: 2 },
            2: { added: 1, removed: 0 },
            3: { added: 0, removed: 0 },
          },
        },
      },
    },
    document: {
      hidden: false,
      getElementById(id) {
        return elements[id] || null;
      },
      addEventListener() {},
    },
    window: {
      setInterval(callback) {
        intervalCallback = callback;
        return 1;
      },
      addEventListener() {},
    },
    fetch() {
      fetchCalls += 1;
    },
    Intl,
    Math,
    Number,
  });

  vm.runInContext(source, context);

  assert.match(elements['companies-treated-last60'].innerHTML, /\+12/);
  assert.match(elements['companies-usable-last60'].innerHTML, /\+6/);
  assert.match(elements['companies-with-website-last60'].innerHTML, /\+5/);
  assert.match(elements['companies-without-website-last60'].innerHTML, /\+1/);
  assert.equal(elements['companies-unusable-grade-1'].textContent, '24.412');
  assert.equal(elements['companies-unusable-grade-2'].textContent, '30');
  assert.equal(elements['companies-unusable-grade-3'].textContent, '121');
  assert.match(elements['companies-unusable-grade-1-last60'].innerHTML, /\+6/);
  assert.match(elements['companies-unusable-grade-1-last60'].innerHTML, /-2/);
  assert.match(elements['companies-unusable-grade-2-last60'].innerHTML, /\+1/);
  assert.doesNotMatch(elements['companies-unusable-grade-3-last60'].innerHTML, /unusable-grade-delta-removed/);
  assert.equal(typeof intervalCallback, 'function');
  assert.equal(fetchCalls, 0);
});
