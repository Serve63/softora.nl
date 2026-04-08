function createAgendaTaskHelpers(deps = {}) {
  const {
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeEmailAddress = (value) => normalizeString(String(value || '').trim().toLowerCase()),
    getLatestCallUpdateByCallId = () => null,
    resolveAppointmentCallId = () => '',
    normalizeColdcallingStack = (value) => normalizeString(value || ''),
    getColdcallingStackLabel = () => '',
    resolveAgendaLocationValue = (...values) =>
      values.map((value) => normalizeString(value)).find(Boolean) || '',
    resolveCallDurationSeconds = () => null,
    buildLeadOwnerFields = () => ({}),
  } = deps;

  function compareConfirmationTasks(a, b) {
    const aTs = Date.parse(normalizeString(a?.confirmationTaskCreatedAt || a?.createdAt || '')) || 0;
    const bTs = Date.parse(normalizeString(b?.confirmationTaskCreatedAt || b?.createdAt || '')) || 0;
    if (aTs === bTs) return Number(a?.id || 0) - Number(b?.id || 0);
    return bTs - aTs;
  }

  function formatDateTimeLabelNl(dateYmd, timeHm) {
    const date = normalizeDateYyyyMmDd(dateYmd);
    const time = normalizeTimeHhMm(timeHm) || '09:00';
    if (!date) return '';
    const dt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(dt.getTime())) return `${date} ${time}`;
    return dt.toLocaleString('nl-NL', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function sanitizeAppointmentLocation(value) {
    return truncateText(normalizeString(value || ''), 220);
  }

  function sanitizeAppointmentWhatsappInfo(value) {
    return truncateText(normalizeString(value || ''), 6000);
  }

  function mapAppointmentToConfirmationTask(appointment) {
    if (!appointment || typeof appointment !== 'object') return null;
    const confirmationTaskTypeRaw = normalizeString(
      appointment.confirmationTaskType || appointment.taskType || ''
    ).toLowerCase();
    const isLeadFollowUpTask = confirmationTaskTypeRaw === 'lead_follow_up';
    const needsConfirmation = toBooleanSafe(
      appointment.needsConfirmationEmail,
      toBooleanSafe(appointment.aiGenerated, false)
    );
    const alreadyDone = Boolean(
      appointment.confirmationResponseReceived ||
        appointment.confirmationResponseReceivedAt ||
        appointment.confirmationAppointmentCancelled ||
        appointment.confirmationAppointmentCancelledAt
    );
    if ((!needsConfirmation && !isLeadFollowUpTask) || alreadyDone) return null;

    const callId = resolveAppointmentCallId(appointment);
    const callUpdate = callId ? getLatestCallUpdateByCallId(callId) : null;
    const rawProvider = normalizeString(callUpdate?.provider || appointment?.provider || '').toLowerCase();
    const normalizedStack = normalizeColdcallingStack(
      callUpdate?.stack ||
        appointment?.coldcallingStack ||
        appointment?.callingStack ||
        appointment?.callingEngine ||
        ''
    );
    const stackLabel = normalizeString(
      callUpdate?.stackLabel || appointment?.coldcallingStackLabel || getColdcallingStackLabel(normalizedStack)
    );
    const providerText = normalizeString(
      [
        stackLabel,
        normalizedStack,
        appointment?.coldcallingStackLabel,
        appointment?.coldcallingStack,
        appointment?.source,
        appointment?.summary,
      ]
        .filter(Boolean)
        .join(' ')
    ).toLowerCase();

    let providerLabel = '';
    if (stackLabel) {
      providerLabel = stackLabel;
    } else if (/gemini/.test(providerText)) {
      providerLabel = 'Gemini 3.1 Live';
    } else if (/openai|realtime/.test(providerText)) {
      providerLabel = 'OpenAI Realtime 1.5';
    } else if (/hume/.test(providerText)) {
      providerLabel = 'Hume Evi 3';
    } else if (/retell/.test(providerText) || rawProvider === 'retell') {
      providerLabel = 'Retell AI';
    } else if (/twilio/.test(providerText) || rawProvider === 'twilio') {
      providerLabel = 'Twilio';
    }

    return {
      id: Number(appointment.id) || 0,
      type: isLeadFollowUpTask ? 'lead_follow_up' : 'send_confirmation_email',
      title: isLeadFollowUpTask ? 'Lead opvolgen' : 'Bevestigingsmail sturen',
      company: normalizeString(appointment.company || 'Onbekende lead'),
      contact: normalizeString(appointment.contact || 'Onbekend'),
      phone: normalizeString(appointment.phone || ''),
      date: normalizeDateYyyyMmDd(appointment.date) || '',
      time: normalizeTimeHhMm(appointment.time) || '09:00',
      datetimeLabel: formatDateTimeLabelNl(appointment.date, appointment.time),
      source: normalizeString(appointment.source || 'AI Cold Calling'),
      summary: truncateText(normalizeString(appointment.summary || ''), 300),
      conversationSummary: truncateText(normalizeString(appointment.leadConversationSummary || ''), 4000),
      value: normalizeString(appointment.value || ''),
      createdAt: normalizeString(appointment.confirmationTaskCreatedAt || appointment.createdAt || ''),
      appointmentId: Number(appointment.id) || 0,
      callId,
      contactEmail: normalizeEmailAddress(appointment.contactEmail || appointment.email || '') || '',
      location: resolveAgendaLocationValue(
        sanitizeAppointmentLocation(appointment.location || appointment.appointmentLocation || ''),
        appointment?.summary || '',
        appointment?.whatsappInfo || ''
      ),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(
        appointment.whatsappInfo || appointment.whatsappNotes || appointment.whatsapp || ''
      ),
      whatsappConfirmed: toBooleanSafe(appointment?.whatsappConfirmed, false),
      durationSeconds: resolveCallDurationSeconds(appointment, callUpdate),
      mailDraftAvailable: Boolean(normalizeString(appointment.confirmationEmailDraft || '')),
      mailSent: Boolean(appointment.confirmationEmailSent || appointment.confirmationEmailSentAt),
      mailSentAt: normalizeString(appointment.confirmationEmailSentAt || '') || null,
      mailSentBy: normalizeString(appointment.confirmationEmailSentBy || '') || null,
      confirmationReceived: Boolean(
        appointment.confirmationResponseReceived || appointment.confirmationResponseReceivedAt
      ),
      confirmationReceivedAt: normalizeString(appointment.confirmationResponseReceivedAt || '') || null,
      confirmationReceivedBy: normalizeString(appointment.confirmationResponseReceivedBy || '') || null,
      appointmentCancelled: Boolean(
        appointment.confirmationAppointmentCancelled || appointment.confirmationAppointmentCancelledAt
      ),
      appointmentCancelledAt:
        normalizeString(appointment.confirmationAppointmentCancelledAt || '') || null,
      appointmentCancelledBy:
        normalizeString(appointment.confirmationAppointmentCancelledBy || '') || null,
      provider: rawProvider || '',
      providerLabel: providerLabel || '',
      coldcallingStack: normalizedStack || '',
      coldcallingStackLabel: stackLabel || '',
      ...buildLeadOwnerFields(
        callId,
        appointment?.leadOwnerName || appointment?.leadOwnerFullName || appointment?.leadOwnerKey
          ? {
              key: appointment?.leadOwnerKey,
              displayName: appointment?.leadOwnerName,
              fullName: appointment?.leadOwnerFullName,
              userId: appointment?.leadOwnerUserId,
              email: appointment?.leadOwnerEmail,
            }
          : null
      ),
    };
  }

  return {
    compareConfirmationTasks,
    formatDateTimeLabelNl,
    mapAppointmentToConfirmationTask,
    sanitizeAppointmentLocation,
    sanitizeAppointmentWhatsappInfo,
  };
}

module.exports = {
  createAgendaTaskHelpers,
};
