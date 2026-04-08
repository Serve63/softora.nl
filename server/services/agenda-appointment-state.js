function createAgendaAppointmentStateService(deps = {}) {
  const {
    getGeneratedAgendaAppointments = () => [],
    agendaAppointmentIdByCallId = new Map(),
    getRecentDashboardActivities = () => [],
    mapAppointmentToConfirmationTask = () => null,
    clearDismissedInterestedLeadCallId = () => false,
    queueRuntimeStatePersist = () => null,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
  } = deps;

  function getGeneratedAppointmentIndexById(id) {
    const taskId = Number(id);
    if (!Number.isFinite(taskId) || taskId <= 0) return -1;
    return getGeneratedAgendaAppointments().findIndex((item) => Number(item?.id) === taskId);
  }

  function setGeneratedAgendaAppointmentAtIndex(idx, nextValue, reason = 'agenda_appointment_update') {
    const appointments = getGeneratedAgendaAppointments();
    if (!Number.isInteger(idx) || idx < 0 || idx >= appointments.length) return null;
    if (!nextValue || typeof nextValue !== 'object') return null;

    const previous = appointments[idx];
    const previousCallId = normalizeString(previous?.callId || '');
    appointments[idx] = nextValue;

    const id = Number(nextValue.id);
    const callId = normalizeString(nextValue.callId || '');
    if (previousCallId && previousCallId !== callId) {
      const mappedId = agendaAppointmentIdByCallId.get(previousCallId);
      if (Number(mappedId || 0) === Number(id || 0)) {
        agendaAppointmentIdByCallId.delete(previousCallId);
      }
    }

    if (Number.isFinite(id) && id > 0 && callId) {
      agendaAppointmentIdByCallId.set(callId, id);
      const hasOpenLeadTask = Boolean(mapAppointmentToConfirmationTask(nextValue));
      if (hasOpenLeadTask) {
        clearDismissedInterestedLeadCallId(callId);
      }
    }

    queueRuntimeStatePersist(reason);
    return appointments[idx];
  }

  function extractAgendaScheduleFromDashboardActivity(activity) {
    if (!activity || typeof activity !== 'object') return null;
    const type = normalizeString(activity?.type || '').toLowerCase();
    if (type !== 'lead_set_in_agenda') return null;

    const detail = normalizeString(activity?.detail || '');
    if (!detail) return null;

    const dateTimeMatch = detail.match(/\b(\d{4}-\d{2}-\d{2})\b\s+om\s+(\d{2}:\d{2})\b/i);
    if (!dateTimeMatch) return null;

    const date = normalizeDateYyyyMmDd(dateTimeMatch[1] || '');
    const time = normalizeTimeHhMm(dateTimeMatch[2] || '') || '09:00';
    if (!date || !time) return null;

    const locationMatch = detail.match(/\(([^()]{3,220})\)\s*\.?\s*$/);
    const location = sanitizeAppointmentLocation(locationMatch?.[1] || '');

    return { date, time, location };
  }

  function repairAgendaAppointmentsFromDashboardActivities() {
    const activities = getRecentDashboardActivities();
    const appointments = getGeneratedAgendaAppointments();
    if (!activities.length || !appointments.length) return 0;

    const orderedActivities = activities
      .slice()
      .sort((a, b) => {
        const aTs = Date.parse(normalizeString(a?.createdAt || '')) || 0;
        const bTs = Date.parse(normalizeString(b?.createdAt || '')) || 0;
        return bTs - aTs;
      });

    const seenIdentityKeys = new Set();
    let touched = 0;

    for (const activity of orderedActivities) {
      const schedule = extractAgendaScheduleFromDashboardActivity(activity);
      if (!schedule) continue;

      const taskId = Number(activity?.taskId || 0) || 0;
      const callId = normalizeString(activity?.callId || '');
      const identityKey = taskId > 0 ? `task:${taskId}` : callId ? `call:${callId}` : '';
      if (!identityKey || seenIdentityKeys.has(identityKey)) continue;
      seenIdentityKeys.add(identityKey);

      let idx = taskId > 0 ? getGeneratedAppointmentIndexById(taskId) : -1;
      if (idx < 0 && callId) {
        const appointmentId = Number(agendaAppointmentIdByCallId.get(callId) || 0) || 0;
        if (appointmentId > 0) idx = getGeneratedAppointmentIndexById(appointmentId);
      }
      if (idx < 0) continue;

      const appointment = appointments[idx];
      if (!appointment || typeof appointment !== 'object') continue;

      const currentDate = normalizeDateYyyyMmDd(appointment?.date || '');
      const currentTime = normalizeTimeHhMm(appointment?.time || '') || '09:00';
      const currentLocation = sanitizeAppointmentLocation(
        appointment?.location || appointment?.appointmentLocation || ''
      );
      const nextLocation = schedule.location || currentLocation || '';

      if (
        currentDate === schedule.date &&
        currentTime === schedule.time &&
        currentLocation === nextLocation
      ) {
        continue;
      }

      const updated = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          date: schedule.date,
          time: schedule.time,
          location: nextLocation || null,
          appointmentLocation: nextLocation || null,
        },
        'agenda_schedule_repaired_from_activity_log'
      );
      if (updated) touched += 1;
    }

    return touched;
  }

  return {
    extractAgendaScheduleFromDashboardActivity,
    getGeneratedAppointmentIndexById,
    repairAgendaAppointmentsFromDashboardActivities,
    setGeneratedAgendaAppointmentAtIndex,
  };
}

module.exports = {
  createAgendaAppointmentStateService,
};
