const test = require('node:test');
const assert = require('node:assert/strict');

const { createAgendaInterestedLeadStateService } = require('../../server/services/agenda-interested-lead-state');

function normalizeString(value) {
  return String(value || '').trim();
}

function createFixture(overrides = {}) {
  const dismissedInterestedLeadCallIds = overrides.dismissedInterestedLeadCallIds || new Set();
  const dismissedInterestedLeadKeys = overrides.dismissedInterestedLeadKeys || new Set();
  const generatedAgendaAppointments = overrides.generatedAgendaAppointments || [];
  const persistReasons = [];

  function buildLeadFollowUpCandidateKey(item) {
    const phone = normalizeString(item?.phone || '').replace(/\D/g, '');
    if (phone) return `phone:${phone}`;
    const company = normalizeString(item?.company || '').toLowerCase();
    const contact = normalizeString(item?.contact || '').toLowerCase();
    return company || contact ? `name:${company}|${contact}` : '';
  }

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, _reason) {
    generatedAgendaAppointments[idx] = { ...nextValue };
    return generatedAgendaAppointments[idx];
  }

  const service = createAgendaInterestedLeadStateService({
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    normalizeString,
    buildLeadFollowUpCandidateKey,
    queueRuntimeStatePersist: (reason) => {
      persistReasons.push(reason);
    },
    getGeneratedAgendaAppointments: () => generatedAgendaAppointments,
    mapAppointmentToConfirmationTask: (appointment) => {
      const taskType = normalizeString(appointment?.confirmationTaskType || appointment?.type || '').toLowerCase();
      return taskType === 'lead_follow_up' ? appointment : null;
    },
    setGeneratedAgendaAppointmentAtIndex,
  });

  return {
    dismissedInterestedLeadCallIds,
    dismissedInterestedLeadKeys,
    generatedAgendaAppointments,
    persistReasons,
    service,
  };
}

test('agenda interested lead state service dismisses by call id and lead key with stable persistence reasons', () => {
  const { dismissedInterestedLeadCallIds, dismissedInterestedLeadKeys, persistReasons, service } = createFixture();

  const changed = service.dismissInterestedLeadIdentity(
    'call-1',
    { company: 'Softora', contact: 'Serve', phone: '06 12 34 56 78' },
    'interested_lead_dismissed_manual'
  );

  assert.equal(changed, true);
  assert.equal(dismissedInterestedLeadCallIds.has('call-1'), true);
  assert.equal(dismissedInterestedLeadKeys.has('phone:0612345678'), true);
  assert.deepEqual(persistReasons, [
    'interested_lead_dismissed_manual',
    'interested_lead_dismissed_manual',
  ]);
});

test('agenda interested lead state service resolves dismissed state for rows via call id or reusable lead key', () => {
  const { service } = createFixture({
    dismissedInterestedLeadCallIds: new Set(['call-2']),
    dismissedInterestedLeadKeys: new Set(['name:softora|serve']),
  });

  assert.equal(service.isInterestedLeadDismissedForRow('call-2', { company: 'X' }), true);
  assert.equal(
    service.isInterestedLeadDismissedForRow('other-call', { company: 'Softora', contact: 'Serve' }),
    true
  );
  assert.equal(
    service.isInterestedLeadDismissedForRow('other-call', { company: 'Other', contact: 'Lead' }),
    false
  );
});

test('agenda interested lead state service can clear dismissed call ids without touching lead keys', () => {
  const { dismissedInterestedLeadCallIds, dismissedInterestedLeadKeys, service } = createFixture({
    dismissedInterestedLeadCallIds: new Set(['call-3']),
    dismissedInterestedLeadKeys: new Set(['phone:0611111111']),
  });

  assert.equal(service.clearDismissedInterestedLeadCallId('call-3'), true);
  assert.equal(dismissedInterestedLeadCallIds.has('call-3'), false);
  assert.equal(dismissedInterestedLeadKeys.has('phone:0611111111'), true);
});

test('agenda interested lead state service cancels matching open lead follow-up tasks by identity', () => {
  const { generatedAgendaAppointments, service } = createFixture({
    generatedAgendaAppointments: [
      {
        id: 11,
        confirmationTaskType: 'lead_follow_up',
        callId: 'call-match',
        company: 'Softora',
        contact: 'Serve',
        phone: '0612345678',
      },
      {
        id: 12,
        confirmationTaskType: 'lead_follow_up',
        callId: 'call-other',
        company: 'Softora',
        contact: 'Serve',
        phone: '0612345678',
      },
      {
        id: 13,
        confirmationTaskType: 'meeting',
        callId: 'call-ignore',
        company: 'Other',
      },
    ],
  });

  const cancelledCount = service.cancelOpenLeadFollowUpTasksByIdentity(
    'call-match',
    { company: 'Softora', contact: 'Serve', phone: '0612345678' },
    'Serve',
    'interested_lead_dismissed_manual_cancel'
  );

  assert.equal(cancelledCount, 2);
  assert.equal(generatedAgendaAppointments[0].confirmationAppointmentCancelled, true);
  assert.equal(generatedAgendaAppointments[1].confirmationAppointmentCancelled, true);
  assert.equal(generatedAgendaAppointments[2].confirmationAppointmentCancelled, undefined);
  assert.equal(generatedAgendaAppointments[0].confirmationAppointmentCancelledBy, 'Serve');
});
