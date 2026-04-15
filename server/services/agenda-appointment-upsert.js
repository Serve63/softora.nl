function createAgendaAppointmentUpsertService(deps = {}) {
  const {
    getGeneratedAgendaAppointments = () => [],
    agendaAppointmentIdByCallId = new Map(),
    getGeneratedAppointmentIndexById = () => -1,
    setGeneratedAgendaAppointmentAtIndex = () => null,
    findReusableLeadFollowUpAppointmentIndex = () => -1,
    buildConfirmationEmailDraftFallback = () => '',
    takeNextGeneratedAgendaAppointmentId = () => 1,
    queueRuntimeStatePersist = () => null,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    normalizeEmailAddress = (value) => String(value || '').trim().toLowerCase(),
  } = deps;

  function shouldPreserveExistingAgendaSchedule(existing) {
    if (!existing || typeof existing !== 'object') return false;
    const hasExistingDate = Boolean(normalizeDateYyyyMmDd(existing?.date || ''));
    if (!hasExistingDate) return false;
    return Boolean(
      !toBooleanSafe(existing?.needsConfirmationEmail, toBooleanSafe(existing?.aiGenerated, false)) ||
        existing?.confirmationEmailSent ||
        existing?.confirmationEmailSentAt ||
        existing?.confirmationResponseReceived ||
        existing?.confirmationResponseReceivedAt ||
        Number(existing?.activeOrderId || 0) > 0 ||
        existing?.activeOrderAddedAt
    );
  }

  function applyPreservedAgendaScheduleFields(existing, updated) {
    if (!shouldPreserveExistingAgendaSchedule(existing)) return updated;
    return {
      ...updated,
      date: normalizeDateYyyyMmDd(existing?.date || updated?.date || '') || '',
      time: normalizeTimeHhMm(existing?.time || updated?.time || '') || '09:00',
      location: sanitizeAppointmentLocation(
        existing?.location || existing?.appointmentLocation || updated?.location || updated?.appointmentLocation || ''
      ),
      appointmentLocation: sanitizeAppointmentLocation(
        existing?.appointmentLocation || existing?.location || updated?.appointmentLocation || updated?.location || ''
      ),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(
        existing?.whatsappInfo || existing?.whatsappNotes || updated?.whatsappInfo || updated?.whatsappNotes || ''
      ),
      whatsappConfirmed: toBooleanSafe(existing?.whatsappConfirmed, toBooleanSafe(updated?.whatsappConfirmed, false)),
      summary: normalizeString(existing?.summary || updated?.summary || ''),
      summaryFormatVersion: Number(existing?.summaryFormatVersion || updated?.summaryFormatVersion || 0) || 0,
    };
  }

  function ensureConfirmationDraft(appointment, generatedAtFallback) {
    if (normalizeString(appointment?.confirmationEmailDraft || '')) return appointment;
    return {
      ...appointment,
      confirmationEmailDraft: buildConfirmationEmailDraftFallback(appointment, appointment),
      confirmationEmailDraftGeneratedAt:
        normalizeString(appointment?.confirmationEmailDraftGeneratedAt || '') || generatedAtFallback,
      confirmationEmailDraftSource:
        normalizeString(appointment?.confirmationEmailDraftSource || '') || 'template-auto',
    };
  }

  function upsertGeneratedAgendaAppointment(appointment, callId) {
    if (!appointment || !callId) return null;

    const existingId = agendaAppointmentIdByCallId.get(callId);
    if (existingId) {
      const idx = getGeneratedAppointmentIndexById(existingId);
      if (idx >= 0) {
        const existing = getGeneratedAgendaAppointments()[idx];
        const updated = {
          ...existing,
          ...appointment,
          id: existingId,
          needsConfirmationEmail: toBooleanSafe(
            existing?.needsConfirmationEmail,
            toBooleanSafe(appointment?.aiGenerated, false)
          ),
          confirmationEmailSent: Boolean(existing?.confirmationEmailSent || existing?.confirmationEmailSentAt),
          confirmationEmailSentAt: normalizeString(existing?.confirmationEmailSentAt || '') || null,
          confirmationEmailSentBy: normalizeString(existing?.confirmationEmailSentBy || '') || null,
          confirmationResponseReceived: Boolean(
            existing?.confirmationResponseReceived || existing?.confirmationResponseReceivedAt
          ),
          confirmationResponseReceivedAt:
            normalizeString(existing?.confirmationResponseReceivedAt || '') || null,
          confirmationResponseReceivedBy:
            normalizeString(existing?.confirmationResponseReceivedBy || '') || null,
          confirmationAppointmentCancelled: Boolean(
            existing?.confirmationAppointmentCancelled || existing?.confirmationAppointmentCancelledAt
          ),
          confirmationAppointmentCancelledAt:
            normalizeString(existing?.confirmationAppointmentCancelledAt || '') || null,
          confirmationAppointmentCancelledBy:
            normalizeString(existing?.confirmationAppointmentCancelledBy || '') || null,
          confirmationEmailDraft: normalizeString(existing?.confirmationEmailDraft || '') || null,
          confirmationEmailDraftGeneratedAt:
            normalizeString(existing?.confirmationEmailDraftGeneratedAt || '') || null,
          confirmationEmailDraftSource:
            normalizeString(existing?.confirmationEmailDraftSource || '') || null,
          contactEmail:
            normalizeEmailAddress(
              appointment?.contactEmail || appointment?.email || existing?.contactEmail || existing?.email || ''
            ) || null,
          confirmationEmailLastError:
            normalizeString(existing?.confirmationEmailLastError || '') || null,
          confirmationEmailLastSentMessageId:
            normalizeString(existing?.confirmationEmailLastSentMessageId || '') || null,
          confirmationTaskCreatedAt:
            normalizeString(existing?.confirmationTaskCreatedAt || '') ||
            normalizeString(existing?.createdAt || '') ||
            new Date().toISOString(),
          postCallStatus:
            normalizeString(existing?.postCallStatus || appointment?.postCallStatus || '') || null,
          postCallNotesTranscript:
            normalizeString(
              existing?.postCallNotesTranscript || appointment?.postCallNotesTranscript || ''
            ) || null,
          postCallPrompt:
            normalizeString(existing?.postCallPrompt || appointment?.postCallPrompt || '') || null,
          postCallUpdatedAt:
            normalizeString(existing?.postCallUpdatedAt || appointment?.postCallUpdatedAt || '') || null,
          postCallUpdatedBy:
            normalizeString(existing?.postCallUpdatedBy || appointment?.postCallUpdatedBy || '') || null,
        };
        const stabilized = ensureConfirmationDraft(
          applyPreservedAgendaScheduleFields(existing, updated),
          new Date().toISOString()
        );
        return setGeneratedAgendaAppointmentAtIndex(idx, stabilized, 'agenda_appointment_upsert');
      }
    }

    const reusableIdx = findReusableLeadFollowUpAppointmentIndex(appointment, callId);
    if (reusableIdx >= 0) {
      const existing = getGeneratedAgendaAppointments()[reusableIdx];
      const existingIdForReuse = Number(existing?.id || 0) || 0;
      const updated = {
        ...existing,
        ...appointment,
        id: existingIdForReuse,
        callId,
        createdAt: normalizeString(appointment?.createdAt || existing?.createdAt || '') || new Date().toISOString(),
        needsConfirmationEmail: toBooleanSafe(
          existing?.needsConfirmationEmail,
          toBooleanSafe(appointment?.aiGenerated, false)
        ),
        confirmationEmailSent: Boolean(existing?.confirmationEmailSent || existing?.confirmationEmailSentAt),
        confirmationEmailSentAt: normalizeString(existing?.confirmationEmailSentAt || '') || null,
        confirmationEmailSentBy: normalizeString(existing?.confirmationEmailSentBy || '') || null,
        confirmationResponseReceived: Boolean(
          existing?.confirmationResponseReceived || existing?.confirmationResponseReceivedAt
        ),
        confirmationResponseReceivedAt:
          normalizeString(existing?.confirmationResponseReceivedAt || '') || null,
        confirmationResponseReceivedBy:
          normalizeString(existing?.confirmationResponseReceivedBy || '') || null,
        confirmationAppointmentCancelled: Boolean(
          existing?.confirmationAppointmentCancelled || existing?.confirmationAppointmentCancelledAt
        ),
        confirmationAppointmentCancelledAt:
          normalizeString(existing?.confirmationAppointmentCancelledAt || '') || null,
        confirmationAppointmentCancelledBy:
          normalizeString(existing?.confirmationAppointmentCancelledBy || '') || null,
        confirmationEmailDraft: normalizeString(existing?.confirmationEmailDraft || '') || null,
        confirmationEmailDraftGeneratedAt:
          normalizeString(existing?.confirmationEmailDraftGeneratedAt || '') || null,
        confirmationEmailDraftSource:
          normalizeString(existing?.confirmationEmailDraftSource || '') || null,
        contactEmail:
          normalizeEmailAddress(
            appointment?.contactEmail || appointment?.email || existing?.contactEmail || existing?.email || ''
          ) || null,
        confirmationEmailLastError:
          normalizeString(existing?.confirmationEmailLastError || '') || null,
        confirmationEmailLastSentMessageId:
          normalizeString(existing?.confirmationEmailLastSentMessageId || '') || null,
        confirmationTaskCreatedAt:
          normalizeString(appointment?.createdAt || appointment?.updatedAt || '') ||
          normalizeString(existing?.confirmationTaskCreatedAt || '') ||
          normalizeString(existing?.createdAt || '') ||
          new Date().toISOString(),
        postCallStatus:
          normalizeString(existing?.postCallStatus || appointment?.postCallStatus || '') || null,
        postCallNotesTranscript:
          normalizeString(
            existing?.postCallNotesTranscript || appointment?.postCallNotesTranscript || ''
          ) || null,
        postCallPrompt:
          normalizeString(existing?.postCallPrompt || appointment?.postCallPrompt || '') || null,
        postCallUpdatedAt:
          normalizeString(existing?.postCallUpdatedAt || appointment?.postCallUpdatedAt || '') || null,
        postCallUpdatedBy:
          normalizeString(existing?.postCallUpdatedBy || appointment?.postCallUpdatedBy || '') || null,
      };
      const stabilized = ensureConfirmationDraft(
        applyPreservedAgendaScheduleFields(existing, updated),
        new Date().toISOString()
      );
      return setGeneratedAgendaAppointmentAtIndex(reusableIdx, stabilized, 'agenda_appointment_reuse_upsert');
    }

    const appointments = getGeneratedAgendaAppointments();
    const createdAtIso = normalizeString(appointment?.createdAt) || new Date().toISOString();
    const needsConfirmationEmail = toBooleanSafe(
      appointment?.needsConfirmationEmail,
      toBooleanSafe(appointment?.aiGenerated, false)
    );
    const withId = {
      ...appointment,
      id: Number(takeNextGeneratedAgendaAppointmentId()) || 0,
      createdAt: createdAtIso,
      needsConfirmationEmail,
      confirmationEmailSent: false,
      confirmationEmailSentAt: null,
      confirmationEmailSentBy: null,
      confirmationResponseReceived: false,
      confirmationResponseReceivedAt: null,
      confirmationResponseReceivedBy: null,
      confirmationAppointmentCancelled: false,
      confirmationAppointmentCancelledAt: null,
      confirmationAppointmentCancelledBy: null,
      contactEmail: normalizeEmailAddress(appointment?.contactEmail || appointment?.email || '') || null,
      confirmationEmailDraft: buildConfirmationEmailDraftFallback(appointment, appointment),
      confirmationEmailDraftGeneratedAt: createdAtIso,
      confirmationEmailDraftSource: 'template-auto',
      confirmationEmailLastError: null,
      confirmationEmailLastSentMessageId: null,
      confirmationTaskCreatedAt: createdAtIso,
      postCallStatus: normalizeString(appointment?.postCallStatus || '') || null,
      postCallNotesTranscript: normalizeString(appointment?.postCallNotesTranscript || '') || null,
      postCallPrompt: normalizeString(appointment?.postCallPrompt || '') || null,
      postCallUpdatedAt: normalizeString(appointment?.postCallUpdatedAt || '') || null,
      postCallUpdatedBy: normalizeString(appointment?.postCallUpdatedBy || '') || null,
    };
    appointments.push(withId);
    agendaAppointmentIdByCallId.set(callId, withId.id);
    queueRuntimeStatePersist('agenda_appointment_insert');
    return withId;
  }

  return {
    applyPreservedAgendaScheduleFields,
    shouldPreserveExistingAgendaSchedule,
    upsertGeneratedAgendaAppointment,
  };
}

module.exports = {
  createAgendaAppointmentUpsertService,
};
