function createAgendaLeadFollowUpService(deps = {}) {
  const {
    getGeneratedAgendaAppointments = () => [],
    agendaAppointmentIdByCallId = new Map(),
    mapAppointmentToConfirmationTask = () => null,
    normalizeString = (value) => String(value || '').trim(),
    buildLeadFollowUpCandidateKey = () => '',
    getLeadLikeRecencyTimestamp = () => 0,
    buildLatestInterestedLeadRowsByKey = () => new Map(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    resolveAppointmentLocation = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    resolveCallDurationSeconds = () => 0,
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    resolvePreferredRecordingUrl = () => '',
    normalizeColdcallingStack = (value) => String(value || '').trim(),
    clearDismissedInterestedLeadCallId = () => false,
    queueRuntimeStatePersist = () => null,
  } = deps;

  function isOpenLeadFollowUpAppointment(appointment) {
    if (!appointment || typeof appointment !== 'object') return false;
    const taskType = normalizeString(
      appointment?.confirmationTaskType || appointment?.taskType || appointment?.type || ''
    ).toLowerCase();
    if (taskType !== 'lead_follow_up') return false;
    return Boolean(mapAppointmentToConfirmationTask(appointment));
  }

  function findReusableLeadFollowUpAppointmentIndex(appointment, callId) {
    const key = buildLeadFollowUpCandidateKey(appointment);
    const normalizedCallId = normalizeString(callId || appointment?.callId || '');
    if (!key) return -1;

    let bestIdx = -1;
    let bestTs = -1;

    getGeneratedAgendaAppointments().forEach((item, idx) => {
      if (!isOpenLeadFollowUpAppointment(item)) return;

      const itemKey = buildLeadFollowUpCandidateKey(item);
      const itemCallId = normalizeString(item?.callId || '');
      if (!itemKey || itemKey !== key) return;
      if (normalizedCallId && itemCallId === normalizedCallId) return;

      const itemTs = getLeadLikeRecencyTimestamp(item);
      if (itemTs > bestTs) {
        bestTs = itemTs;
        bestIdx = idx;
      }
    });

    return bestIdx;
  }

  function backfillOpenLeadFollowUpAppointmentsFromLatestCalls() {
    const latestRowsByKey = buildLatestInterestedLeadRowsByKey();
    if (!latestRowsByKey.size) return 0;

    let touched = 0;
    const appointments = getGeneratedAgendaAppointments();

    appointments.forEach((appointment, idx) => {
      if (!isOpenLeadFollowUpAppointment(appointment)) return;

      const key = buildLeadFollowUpCandidateKey(appointment);
      if (!key) return;

      const latestRow = latestRowsByKey.get(key);
      if (!latestRow) return;

      const latestTs = getLeadLikeRecencyTimestamp(latestRow);
      const currentTs = getLeadLikeRecencyTimestamp(appointment);
      if (latestTs <= currentTs) return;

      const updated = {
        ...appointment,
        company: normalizeString(latestRow?.company || appointment?.company || '') || 'Onbekende lead',
        contact: normalizeString(latestRow?.contact || appointment?.contact || '') || 'Onbekend',
        phone: normalizeString(latestRow?.phone || appointment?.phone || ''),
        date: normalizeDateYyyyMmDd(latestRow?.date || appointment?.date || '') || '',
        time: normalizeTimeHhMm(latestRow?.time || appointment?.time || '') || '09:00',
        source: normalizeString(latestRow?.source || appointment?.source || ''),
        summary: truncateText(normalizeString(latestRow?.summary || appointment?.summary || ''), 4000),
        createdAt:
          normalizeString(latestRow?.createdAt || latestRow?.confirmationTaskCreatedAt || appointment?.createdAt || '') ||
          new Date().toISOString(),
        confirmationTaskCreatedAt:
          normalizeString(
            latestRow?.confirmationTaskCreatedAt ||
              latestRow?.createdAt ||
              appointment?.confirmationTaskCreatedAt ||
              appointment?.createdAt ||
              ''
          ) || new Date().toISOString(),
        callId: normalizeString(latestRow?.callId || appointment?.callId || ''),
        location: resolveAppointmentLocation(latestRow, appointment),
        durationSeconds: resolveCallDurationSeconds(latestRow, appointment),
        whatsappInfo: sanitizeAppointmentWhatsappInfo(latestRow?.whatsappInfo || appointment?.whatsappInfo || ''),
        recordingUrl: resolvePreferredRecordingUrl(latestRow, appointment),
        provider: normalizeString(latestRow?.provider || appointment?.provider || ''),
        coldcallingStack: normalizeColdcallingStack(
          latestRow?.coldcallingStack || appointment?.coldcallingStack || ''
        ),
        coldcallingStackLabel: normalizeString(
          latestRow?.coldcallingStackLabel || appointment?.coldcallingStackLabel || latestRow?.providerLabel || ''
        ),
        leadType: normalizeString(latestRow?.leadType || appointment?.leadType || ''),
        leadOwnerKey: normalizeString(latestRow?.leadOwnerKey || appointment?.leadOwnerKey || ''),
        leadOwnerName: normalizeString(latestRow?.leadOwnerName || appointment?.leadOwnerName || ''),
        leadOwnerFullName: normalizeString(latestRow?.leadOwnerFullName || appointment?.leadOwnerFullName || ''),
        leadOwnerUserId: normalizeString(latestRow?.leadOwnerUserId || appointment?.leadOwnerUserId || ''),
        leadOwnerEmail: normalizeString(latestRow?.leadOwnerEmail || appointment?.leadOwnerEmail || ''),
      };

      const previousCallId = normalizeString(appointment?.callId || '');
      const nextCallId = normalizeString(updated?.callId || '');
      appointments[idx] = updated;

      const appointmentId = Number(updated?.id || 0) || 0;
      if (previousCallId && previousCallId !== nextCallId) {
        const mappedId = agendaAppointmentIdByCallId.get(previousCallId);
        if (Number(mappedId || 0) === appointmentId) {
          agendaAppointmentIdByCallId.delete(previousCallId);
        }
      }
      if (appointmentId > 0 && nextCallId) {
        agendaAppointmentIdByCallId.set(nextCallId, appointmentId);
        clearDismissedInterestedLeadCallId(nextCallId);
      }

      touched += 1;
    });

    if (touched > 0) {
      queueRuntimeStatePersist('lead_follow_up_latest_call_backfill');
    }

    return touched;
  }

  return {
    backfillOpenLeadFollowUpAppointmentsFromLatestCalls,
    findReusableLeadFollowUpAppointmentIndex,
    isOpenLeadFollowUpAppointment,
  };
}

module.exports = {
  createAgendaLeadFollowUpService,
};
