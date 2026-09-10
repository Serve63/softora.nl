const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createController,
  getLast60Minutes,
} = require('../../assets/kvk-database-metrics');

function createTextNode() {
  return { textContent: '', hidden: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } };
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

test('control room shows gross arrivals and departures even when the net change is zero', () => {
  const flow = createElement(['.stat-delta-added', '.stat-delta-removed']);
  const now = Date.parse('2026-09-10T11:00:00Z');
  let snapshot = { generatedAt: new Date(now).toISOString(), state: {
    last_60_minutes: { control_room: 0, control_room_activity: { added: 12, removed: 12 } },
  } };
  const controller = createController({
    document: { getElementById(id) { return id === 'companies-control-room-last60' ? flow : null; } },
    getSnapshot: () => snapshot, now: () => now,
  });
  controller.renderMetrics();
  assert.equal(flow.nodes['.stat-delta-added'].textContent, '+12');
  assert.equal(flow.nodes['.stat-delta-removed'].textContent, '−12');
  assert.equal(flow.nodes['.stat-delta-removed'].attributes['aria-label'], 'Afgehandeld: 12');
  assert.equal(flow.classList.contains('is-zero'), false);
  snapshot.generatedAt = new Date(now - 3600_000).toISOString();
  controller.renderMetrics();
  assert.equal(flow.nodes['.stat-delta-added'].textContent, '+0');
  assert.equal(flow.nodes['.stat-delta-removed'].textContent, '−0');
  assert.equal(flow.classList.contains('is-zero'), true);
  snapshot = { generatedAt: new Date(now).toISOString(), state: { last_60_minutes: { control_room: -8 } } };
  controller.renderMetrics();
  assert.equal(flow.nodes['.stat-delta-added'].textContent, '+—');
  assert.equal(flow.nodes['.stat-delta-removed'].textContent, '−—');
  assert.equal(flow.classList.contains('is-zero'), false);
});

test('kvk database metrics render current last-hour and grade values without another snapshot request', () => {
  const deltaSelectors = ['.stat-delta-number', '.stat-delta-label'];
  const gradeSelectors = [
    '.unusable-grade-delta-added',
    '.unusable-grade-delta-removed',
    '.unusable-grade-delta-label',
  ];
  const elements = {
    'companies-treated': createElement(),
    'companies-successful-found': createElement(),
    'companies-successful-found-last60': createElement(deltaSelectors),
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
    treated: 32_116,
    declared_usable: 6_993,
    unusable_grades: { 1: 24_412, 2: 30, 3: 121 },
    last_60_minutes: {
      treated: 12,
      declared_usable: 2,
      usable: 6,
      with_website: 5,
      without_website: 1,
      unusable_grades: { 1: 6, 2: 0, 3: 0 },
      unusable_grade_activity: {
        1: { added: 6, removed: 2 },
        2: { added: 1, removed: 0 },
        3: { added: 4, removed: 3 },
      },
    },
  };
  const controller = createController({
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    getSnapshot: () => ({ state: scraperState, generatedAt: '2026-09-08T22:00:00Z' }),
    now: () => Date.parse('2026-09-08T22:01:00Z'),
  });

  controller.renderMetrics();

  assert.equal(elements['companies-treated'].textContent, '32.116');
  assert.equal(elements['companies-successful-found'].textContent, '6.993');
  assert.equal(
    elements['companies-successful-found-last60'].nodes['.stat-delta-number'].textContent,
    '+2',
  );
  assert.equal(elements['companies-treated-last60'].nodes['.stat-delta-number'].textContent, '+12');
  assert.equal(elements['companies-usable-last60'].nodes['.stat-delta-number'].textContent, '+6');
  assert.equal(elements['companies-with-website-last60'].nodes['.stat-delta-number'].textContent, '+5');
  assert.equal(elements['companies-without-website-last60'].nodes['.stat-delta-number'].textContent, '+1');
  assert.equal(elements['companies-unusable-grade-1'].textContent, '24.412');
  assert.equal(elements['companies-unusable-grade-2'].textContent, '151');
  assert.equal(elements['companies-unusable-grade-1-last60'].nodes['.unusable-grade-delta-added'].textContent, '+6');
  assert.equal(elements['companies-unusable-grade-1-last60'].nodes['.unusable-grade-delta-removed'].textContent, '-2');
  assert.equal(elements['companies-unusable-grade-2-last60'].nodes['.unusable-grade-delta-added'].textContent, '+5');
  assert.equal(elements['companies-unusable-grade-2-last60'].nodes['.unusable-grade-delta-removed'].hidden, true);
});

test('kvk database metrics combine legacy grade 3 fallback deltas into Definitief', () => {
  const gradeSelectors = [
    '.unusable-grade-delta-added',
    '.unusable-grade-delta-removed',
    '.unusable-grade-delta-label',
  ];
  const elements = {
    'companies-treated': createElement(),
    'companies-successful-found': createElement(),
    'companies-successful-found-last60': createElement(),
    'companies-treated-last60': createElement(),
    'companies-usable-last60': createElement(),
    'companies-with-website-last60': createElement(),
    'companies-without-website-last60': createElement(),
    'companies-unusable-grade-1': createElement(),
    'companies-unusable-grade-2': createElement(),
    'companies-unusable-grade-1-last60': createElement(gradeSelectors),
    'companies-unusable-grade-2-last60': createElement(gradeSelectors),
  };
  const controller = createController({
    document: {
      getElementById(id) {
        return elements[id] || null;
      },
    },
    now: () => Date.parse('2026-09-08T22:01:00Z'),
    getSnapshot: () => ({ generatedAt: '2026-09-08T22:00:00Z', state: {
      with_website: 5,
      without_website: 1,
      unusable: 10,
      unusable_grades: { 1: 10, 2: 2, 3: 4 },
      last_60_minutes: {
        unusable_grades: { 1: 0, 2: 2, 3: 4 },
        unusable_grade_activity: {},
      },
    } }),
  });

  controller.renderMetrics();

  assert.equal(elements['companies-treated'].textContent, '16');
  assert.equal(elements['companies-unusable-grade-2'].textContent, '6');
  assert.equal(elements['companies-unusable-grade-2-last60'].nodes['.unusable-grade-delta-added'].textContent, '+6');
  assert.equal(elements['companies-unusable-grade-2-last60'].nodes['.unusable-grade-delta-removed'].hidden, true);
});

test('last-hour activity expires against source time, including every review counter', () => {
  const snapshot = {
    generatedAt: '2026-08-24T20:35:03+02:00',
    syncedAt: '2026-09-08T22:15:00Z',
    state: { last_60_minutes: {
      found: 0, treated: 24, usable: 24, with_website: 0, without_website: 24,
      unusable: 15, luna_max_found: 9, unusable_grades: { 1: 15, 2: 12 },
      unusable_grade_activity: { 1: { added: 15, removed: 12 }, 2: { added: 12, removed: 0 } },
    } },
  };
  const sourceTime = Date.parse(snapshot.generatedAt);
  assert.deepEqual(getLast60Minutes(snapshot, sourceTime + 3_599_999), snapshot.state.last_60_minutes);
  const zero = {
    found: 0, treated: 0, usable: 0, with_website: 0, without_website: 0,
    unusable: 0, luna_max_found: 0, unusable_grades: { 1: 0, 2: 0 },
    unusable_grade_activity: { 1: { added: 0, removed: 0 }, 2: { added: 0, removed: 0 } },
  };
  assert.deepEqual(getLast60Minutes(snapshot, sourceTime + 3_600_000), zero);
  assert.deepEqual(getLast60Minutes(snapshot, Date.parse('2026-09-08T22:15:00Z')), zero);
  for (const generatedAt of [undefined, '', 'invalid', '2027-01-01T00:00:00Z']) {
    assert.deepEqual(getLast60Minutes({ ...snapshot, generatedAt }, sourceTime), zero);
  }
  assert.equal(snapshot.state.last_60_minutes.treated, 24, 'Stored historical activity is preserved');
});

test('an open page expires activity without a new snapshot and resumes with fresh source data', () => {
  const deltaSelectors = ['.stat-delta-number', '.stat-delta-label'];
  const elements = Object.fromEntries([
    'companies-treated', 'companies-treated-last60', 'companies-unusable-grade-1',
    'companies-unusable-grade-2', 'companies-usable-last60',
  ].map((id) => [id, createElement(deltaSelectors)]));
  let snapshot = {
    generatedAt: '2026-09-08T22:00:00Z',
    state: { treated: 32518, last_60_minutes: { treated: 24, usable: 24 } },
  };
  let now = Date.parse('2026-09-08T22:59:59Z');
  const controller = createController({
    document: { getElementById: (id) => elements[id] || null },
    getSnapshot: () => snapshot,
    now: () => now,
  });
  controller.renderMetrics();
  assert.equal(elements['companies-treated-last60'].nodes['.stat-delta-number'].textContent, '+24');
  now += 1000;
  controller.renderMetrics();
  assert.equal(elements['companies-treated-last60'].nodes['.stat-delta-number'].textContent, '0');
  assert.equal(elements['companies-usable-last60'].nodes['.stat-delta-number'].textContent, '0');
  assert.equal(elements['companies-treated'].textContent, '32.518');
  snapshot = { generatedAt: new Date(now).toISOString(), state: { ...snapshot.state, last_60_minutes: { treated: 2 } } };
  controller.renderMetrics();
  assert.equal(elements['companies-treated-last60'].nodes['.stat-delta-number'].textContent, '+2');
});

test('metrics keep updating when the review card is absent', () => {
  const treated = createElement();
  const successful = createElement();
  const controller = createController({
    document: { getElementById: (id) => ({ 'companies-treated': treated, 'companies-successful-found': successful })[id] || null },
    getSnapshot: () => ({ state: { treated: 32518, declared_usable: 7146, unusable_grades: { '1': 24173, '2': 1199 } } }),
  });
  assert.doesNotThrow(() => controller.renderMetrics());
  assert.equal(treated.textContent, '32.518');
  assert.equal(successful.textContent, '7.146');
});

test('review cards partition treated companies and never trust the old candidate count', () => {
  const ids = ['companies-treated', 'companies-successful-found', 'companies-declared-unusable', 'companies-control-room'];
  const elements = Object.fromEntries(ids.map(id => [id, createElement()]));
  let state = { treated: 12, successful_found: 10, declared_usable: 3, declared_unusable: 2, control_room: 7 };
  const controller = createController({ document: { getElementById: id => elements[id] || null }, getSnapshot: () => ({ state }) });
  controller.renderMetrics();
  assert.deepEqual(ids.map(id => elements[id].textContent), ['12', '3', '2', '7']);
  state = { treated: 12, successful_found: 10 };
  controller.renderMetrics();
  assert.equal(elements['companies-successful-found'].textContent, '0');
});


test('new declarations use review decisions and do not reuse the available-stock counter', () => {
  const successful = createElement(['.stat-delta-number', '.stat-delta-label']);
  const usable = createElement(['.stat-delta-number', '.stat-delta-label']);
  const elements = { 'companies-successful-found-last60': successful, 'companies-usable-last60': usable };
  let activity = { treated: 1, declared_usable: 2, usable: 2 };
  const controller = createController({
    document: { getElementById: id => elements[id] || null },
    getSnapshot: () => ({ generatedAt: '2026-09-09T22:10:00Z', state: { last_60_minutes: activity } }),
    now: () => Date.parse('2026-09-09T22:11:00Z'),
  });
  controller.renderMetrics();
  assert.equal(successful.nodes['.stat-delta-number'].textContent, '+2');
  assert.equal(usable.nodes['.stat-delta-number'].textContent, '+2');
  activity = { treated: 1, declared_usable: 1, usable: 1 };
  controller.renderMetrics();
  assert.equal(successful.nodes['.stat-delta-number'].textContent, '+1');
  activity = { declared_usable: -1, usable: 0 };
  controller.renderMetrics();
  assert.equal(successful.nodes['.stat-delta-number'].textContent, '-1');
  activity = { luna_max_found: 0, usable: 2 };
  controller.renderMetrics();
  assert.equal(successful.nodes['.stat-delta-number'].textContent, '0');
});
