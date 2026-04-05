const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateAgendaAppointmentsListRequest,
  validateConfirmationTaskDetailRequest,
  validateConfirmationTasksListRequest,
  validateInterestedLeadsListRequest,
} = require('../../server/schemas/agenda-read');

test('agenda appointments read validator clamps limit to safe range', () => {
  const result = validateAgendaAppointmentsListRequest({
    query: { limit: '5000' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.query.limit, '1000');
});

test('confirmation tasks read validator normalizes booleans and defaults', () => {
  const result = validateConfirmationTasksListRequest({
    query: {
      includeDemo: 'yes',
      fast: '1',
      count_only: 'true',
      limit: '0',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.query.includeDemo, 'true');
  assert.equal(result.query.quick, 'true');
  assert.equal(result.query.countOnly, 'true');
  assert.equal(result.query.limit, '1');
});

test('interested leads read validator normalizes countOnly alias', () => {
  const result = validateInterestedLeadsListRequest({
    query: {
      count_only: 'yes',
      limit: '250',
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.query.countOnly, 'true');
  assert.equal(result.query.limit, '250');
});

test('confirmation task detail validator requires task id from params or query', () => {
  const missing = validateConfirmationTaskDetailRequest({
    params: {},
    query: {},
  });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /taskId ontbreekt/i);

  const fromParams = validateConfirmationTaskDetailRequest({
    params: { id: '15' },
    query: {},
  });
  assert.equal(fromParams.ok, true);
  assert.equal(fromParams.params.id, '15');

  const fromQuery = validateConfirmationTaskDetailRequest({
    params: {},
    query: { taskId: 'abc-1' },
  });
  assert.equal(fromQuery.ok, true);
  assert.equal(fromQuery.query.taskId, 'abc-1');
});
