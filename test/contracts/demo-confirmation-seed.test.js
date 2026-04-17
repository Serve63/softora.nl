const test = require('node:test');
const assert = require('node:assert/strict');

const { createDemoConfirmationSeedService } = require('../../server/services/demo-confirmation-seed');

test('demo confirmation seed service seeds once and links insight to appointment', () => {
  const generatedAgendaAppointments = [];
  const recentCallUpdates = [];
  const recentInsights = [];
  const persistReasons = [];
  let nextAppointmentId = 501;

  const service = createDemoConfirmationSeedService({
    nodeEnv: 'development',
    demoConfirmationTaskEnabled: false,
    generatedAgendaAppointments,
    normalizeString: (value) => String(value || '').trim(),
    upsertRecentCallUpdate: (update) => {
      recentCallUpdates.push(update);
      return update;
    },
    upsertAiCallInsight: (insight) => {
      const nextInsight = { ...insight };
      recentInsights.push(nextInsight);
      return nextInsight;
    },
    upsertGeneratedAgendaAppointment: (appointment) => {
      const nextAppointment = { id: nextAppointmentId++, ...appointment };
      generatedAgendaAppointments.push(nextAppointment);
      return nextAppointment;
    },
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    getNow: () => new Date('2026-04-16T12:00:00.000Z'),
  });

  service.seedDemoConfirmationTaskForUiTesting();
  service.seedDemoConfirmationTaskForUiTesting();

  assert.equal(recentCallUpdates.length, 1);
  assert.equal(recentInsights.length, 1);
  assert.equal(generatedAgendaAppointments.length, 1);
  assert.deepEqual(persistReasons, ['demo_seed_confirmation_task']);
  assert.equal(generatedAgendaAppointments[0].confirmationEmailDraftSource, 'seed');
  assert.equal(recentInsights[0].agendaAppointmentId, 501);
  assert.equal(generatedAgendaAppointments[0].callId, 'demo-confirmation-task-call-1');
});

test('demo confirmation seed service stays disabled in production without the feature flag', () => {
  let touched = false;
  const service = createDemoConfirmationSeedService({
    nodeEnv: 'production',
    demoConfirmationTaskEnabled: false,
    upsertRecentCallUpdate: () => {
      touched = true;
    },
  });

  service.seedDemoConfirmationTaskForUiTesting();

  assert.equal(touched, false);
});
