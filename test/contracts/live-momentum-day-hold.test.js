const test = require('node:test');
const assert = require('node:assert/strict');

const dayHold = require('../../assets/live-momentum-day-hold');

test('geen-data-dagen worden uniek, gesorteerd en nooit in de toekomst opgeslagen', () => {
  assert.deepEqual(dayHold.normalizeDays([20, '3', 20, 0, 32, 26], 31, 25), [3, 20]);
  assert.deepEqual(dayHold.toggleDay([], 20, 31, 25), [20]);
  assert.deepEqual(dayHold.toggleDay([20], 20, 31, 25), []);
  assert.deepEqual(dayHold.toggleDay([20], 26, 31, 25), [20]);
});

test('een gewone gemiste dag blijft 0 procent maar een dag op hold heeft geen score', () => {
  const cells = [
    { dataset: { day: '20', task: '0' }, checked: false },
    { dataset: { day: '20', task: '1' }, checked: false },
    { dataset: { day: '21', task: '0' }, checked: true },
  ];
  const options = {
    statusCells: cells,
    goalRows: [{ activeFromDay: 1 }, { activeFromDay: 1 }],
    getDay: (cell) => Number(cell.dataset.day),
    isActiveRow: () => true,
    isChecked: (cell) => cell.checked,
  };

  assert.equal(dayHold.scoreDay({ ...options, day: 20, isHeld: () => false }), 0);
  assert.equal(dayHold.scoreDay({ ...options, day: 20, isHeld: (day) => day === 20 }), null);
  assert.equal(dayHold.scoreDay({ ...options, day: 21, isHeld: () => false }), 100);
});

test('opgeslagen hold-state markeert na een verse render meteen de volledige dagkolom', () => {
  const cells = Array.from({ length: 31 }, () => {
    const classes = new Set();
    return {
      dataset: {},
      classList: {
        contains: (name) => classes.has(name),
        toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
      },
    };
  });
  let changes = 0;
  const controller = dayHold.createController({
    grid: { addEventListener() {}, querySelectorAll: () => [] },
    lastDay: 31,
    getToday: () => 25,
    getStatusCells: () => cells,
    getDay: (cell) => Number(cell.dataset.day || 0),
    isReady: () => true,
    onChange: () => { changes += 1; },
  });

  controller.hydrate([20]);
  controller.syncGrid();
  assert.equal(cells[18].classList.contains('is-on-hold'), false);
  assert.equal(cells[19].classList.contains('is-on-hold'), true);
  assert.deepEqual(controller.getState(), [20]);
  assert.equal(controller.toggle(20), true);
  assert.deepEqual(controller.getState(), []);
  assert.equal(changes, 1);
});
