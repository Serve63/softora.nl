function createAgendaInterestedLeadStateService(deps = {}) {
  const {
    dismissedInterestedLeadCallIds = new Set(),
    dismissedInterestedLeadKeys = new Set(),
    normalizeString = (value) => String(value || '').trim(),
    buildLeadFollowUpCandidateKey = () => '',
    queueRuntimeStatePersist = () => null,
    getGeneratedAgendaAppointments = () => [],
    mapAppointmentToConfirmationTask = () => null,
    setGeneratedAgendaAppointmentAtIndex = () => null,
  } = deps;

  function isInterestedLeadDismissed(callId) {
    const normalizedCallId = normalizeString(callId);
    if (normalizedCallId && dismissedInterestedLeadCallIds.has(normalizedCallId)) return true;
    return false;
  }

  function isInterestedLeadDismissedByKey(leadKey) {
    const normalizedLeadKey = normalizeString(leadKey);
    return Boolean(normalizedLeadKey && dismissedInterestedLeadKeys.has(normalizedLeadKey));
  }

  function isInterestedLeadDismissedForRow(callId, rowLike) {
    const normalizedCallId = normalizeString(callId);
    if (normalizedCallId) return isInterestedLeadDismissed(normalizedCallId);
    const leadKey = buildLeadFollowUpCandidateKey(rowLike || {});
    return isInterestedLeadDismissedByKey(leadKey);
  }

  function dismissInterestedLeadCallId(callId, reason = 'interested_lead_dismissed') {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId || dismissedInterestedLeadCallIds.has(normalizedCallId)) return false;
    dismissedInterestedLeadCallIds.add(normalizedCallId);
    queueRuntimeStatePersist(reason);
    return true;
  }

  function dismissInterestedLeadKey(leadKey, reason = 'interested_lead_dismissed') {
    const normalizedLeadKey = normalizeString(leadKey);
    if (!normalizedLeadKey || dismissedInterestedLeadKeys.has(normalizedLeadKey)) return false;
    dismissedInterestedLeadKeys.add(normalizedLeadKey);
    queueRuntimeStatePersist(reason);
    return true;
  }

  function dismissInterestedLeadIdentity(callId, rowLike, reason = 'interested_lead_dismissed') {
    const normalizedCallId = normalizeString(callId || '');
    const leadKey = buildLeadFollowUpCandidateKey(rowLike || {});
    const byCall = normalizedCallId ? dismissInterestedLeadCallId(normalizedCallId, reason) : false;
    const byKey = leadKey ? dismissInterestedLeadKey(leadKey, reason) : false;
    return Boolean(byCall || byKey);
  }

  function clearDismissedInterestedLeadCallId(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return false;
    return dismissedInterestedLeadCallIds.delete(normalizedCallId);
  }

  function cancelOpenLeadFollowUpTasksByIdentity(
    callId,
    rowLike,
    actor = '',
    reason = 'interested_lead_dismissed_manual_cancel'
  ) {
    const normalizedCallId = normalizeString(callId || '');
    const identityKey = buildLeadFollowUpCandidateKey(rowLike || {});
    if (!normalizedCallId && !identityKey) return 0;

    const nowIso = new Date().toISOString();
    let cancelledCount = 0;
    getGeneratedAgendaAppointments().forEach((appointment, idx) => {
      if (!appointment || !mapAppointmentToConfirmationTask(appointment)) return;
      const appointmentCallId = normalizeString(appointment?.callId || '');
      const appointmentKey = buildLeadFollowUpCandidateKey(appointment);
      const matchesCallId = Boolean(normalizedCallId && appointmentCallId && appointmentCallId === normalizedCallId);
      const matchesKey = Boolean(identityKey && appointmentKey && appointmentKey === identityKey);
      if (!matchesCallId && !matchesKey) return;

      setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          confirmationResponseReceived: false,
          confirmationResponseReceivedAt: null,
          confirmationResponseReceivedBy: null,
          confirmationAppointmentCancelled: true,
          confirmationAppointmentCancelledAt: nowIso,
          confirmationAppointmentCancelledBy: actor || null,
        },
        reason
      );
      cancelledCount += 1;
    });

    return cancelledCount;
  }

  return {
    cancelOpenLeadFollowUpTasksByIdentity,
    clearDismissedInterestedLeadCallId,
    dismissInterestedLeadCallId,
    dismissInterestedLeadIdentity,
    dismissInterestedLeadKey,
    isInterestedLeadDismissed,
    isInterestedLeadDismissedByKey,
    isInterestedLeadDismissedForRow,
  };
}

module.exports = {
  createAgendaInterestedLeadStateService,
};
