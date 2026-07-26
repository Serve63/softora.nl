const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createController,
} = require('../../assets/kvk-database-metrics');

function createTextNode() {
  return { textContent: '', hidden: false };
}

function createElement(selectors = []) {
  const classes = new Set();
  const nodes = Object.fromEntries(selectors.map((selector) => [selector, createTextNode()]));
  return {
    textContent: '',
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    querySelector(selector) {
      return nodes[selector] || null;
    },
    nodes,
  };
}

test('kvk database metrics render current last-hour and grade values without another snapshot request', () => {
  const deltaSelectors = ['.stat-delta-number', '.stat-delta-label'];
  const gradeSelectors = [
    '.unusable-grade-delta-added',
    '.unusable-grade-delta-removed',
    '.unusable-grade-delta-label',
  ];
  const elements = {
    'companies-treated-last60': createElement(deltaSelectors),
    'companies-usable-last60': createElement(deltaSelectors),
    'companies-with-website-last60': createElement(deltaSelectors),
    'companies-without-website-last60': createElement(deltaSelectors),
    'companies-unusable-grade-1': createElement(),
    'companies-unusable-grade-2': createElement(),
    'companies-unusable-grade-1-last60': createElement(gradeSelectors),
    'companies-unusable-grade-2-last60': createElement(gradeSelectors),
  };
  const scraperState = {
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
  };
  const controller = createController({
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getState: () => scraperState,
  });

  controller.renderMetrics();

  assert.equal(elements['companies-treated-last60'].nodes['.stat-delta-number'].textContent, '+12');
  assert.equal(elements['companies-usable-last60'].nodes['.stat-delta-number'].textContent, '+6');
  assert.equal(elements['companies-with-website-last60'].nodes['.stat-delta-number'].textContent, '+5');
  assert.equal(elements['companies-without-website-last60'].nodes['.stat-delta-number'].textContent, '+1');
  assert.equal(elements['companies-unusable-grade-1'].textContent, '24.412');
  assert.equal(elements['companies-unusable-grade-2'].textContent, '30');
  assert.equal(elements['companies-unusable-grade-1-last60'].nodes['.unusable-grade-delta-added'].textContent, '+6');
  assert.equal(elements['companies-unusable-grade-1-last60'].nodes['.unusable-grade-delta-removed'].textContent, '-2');
  assert.equal(elements['companies-unusable-grade-2-last60'].nodes['.unusable-grade-delta-added'].textContent, '+1');
});
