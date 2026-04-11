function createAgendaInterestedLeadsCoordinator(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    backfillInsightsAndAppointmentsFromRecentCallUpdates = () => {},
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    agendaAppointmentIdByCallId = new Map(),
    getGeneratedAppointmentIndexById = () => -1,
    getGeneratedAgendaAppointments = () => [],
    findInterestedLeadRowByCallId = () => null,
    getLatestCallUpdateByCallId = () => null,
    aiCallInsightsByCallId = new Map(),
    buildGeneratedLeadFollowUpFromCall = () => null,
    normalizeColdcallingStack = (value) => String(value || '').trim(),
    getColdcallingStackLabel = () => '',
    buildLeadOwnerFields = () => ({}),
    normalizeEmailAddress = (value) => String(value || '').trim().toLowerCase(),
    formatEuroLabel = () => '',
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    resolveAppointmentLocation = () => '',
    resolveCallDurationSeconds = () => 0,
    resolvePreferredRecordingUrl = () => '',
    resolveAgendaLocationValue = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    upsertGeneratedAgendaAppointment = () => null,
    buildLeadToAgendaSummary = async (summary = '') => normalizeString(summary),
    setGeneratedAgendaAppointmentAtIndex = () => null,
    dismissInterestedLeadIdentity = () => {},
    appendDashboardActivity = () => {},
    cancelOpenLeadFollowUpTasksByIdentity = () => [],
    buildRuntimeStateSnapshotPayload = () => null,
    applyRuntimeStateSnapshotPayload = () => false,
    waitForQueuedRuntimeSnapshotPersist = async () => true,
  } = deps;

  function takeRuntimeMutationSnapshot() {
    if (!isSupabaseConfigured()) return null;
    const snapshot = buildRuntimeStateSnapshotPayload();
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  }

  async function ensureLeadMutationPersisted(runtimeSnapshot, failureMessage) {
    if (!isSupabaseConfigured()) return true;
    const persisted = await waitForQueuedRuntimeSnapshotPersist();
    if (persisted) return true;
    const rehydrated = await forceHydrateRuntimeStateWithRetries(1);
    if (!rehydrated && runtimeSnapshot) {
      applyRuntimeStateSnapshotPayload(runtimeSnapshot, {
        updatedAt: normalizeString(runtimeSnapshot?.savedAt || '') || new Date().toISOString(),
      });
    }
    return failureMessage || 'Leadwijziging kon niet veilig in gedeelde opslag worden opgeslagen.';
  }

  function buildMaterializedInterestedLeadAppointment(callId, requestBody = {}) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;

    const existingId = agendaAppointmentIdByCallId.get(normalizedCallId);
    const existingIdx = Number.isFinite(Number(existingId))
      ? getGeneratedAppointmentIndexById(existingId)
      : -1;
    const existingAppointment = existingIdx >= 0 ? getGeneratedAgendaAppointments()[existingIdx] || null : null;
    const leadRow = findInterestedLeadRowByCallId(normalizedCallId);
    const callUpdate = getLatestCallUpdateByCallId(normalizedCallId);
    const insight = aiCallInsightsByCallId.get(normalizedCallId) || null;
    const followUpLead = buildGeneratedLeadFollowUpFromCall(callUpdate, insight);
    const base = existingAppointment || followUpLead || leadRow;
    if (!base) return null;

    const normalizedStack = normalizeColdcallingStack(
      existingAppointment?.coldcallingStack ||
        followUpLead?.coldcallingStack ||
        leadRow?.coldcallingStack ||
        callUpdate?.stack ||
        insight?.coldcallingStack ||
        insight?.stack ||
        ''
    );
    const stackLabel = normalizeString(
      existingAppointment?.coldcallingStackLabel ||
        followUpLead?.coldcallingStackLabel ||
        leadRow?.coldcallingStackLabel ||
        callUpdate?.stackLabel ||
        insight?.coldcallingStackLabel ||
        insight?.stackLabel ||
        getColdcallingStackLabel(normalizedStack)
    );
    const leadOwner = buildLeadOwnerFields(
      normalizedCallId,
      existingAppointment?.leadOwnerName ||
        existingAppointment?.leadOwnerFullName ||
        existingAppointment?.leadOwnerKey ||
        followUpLead?.leadOwnerName ||
        followUpLead?.leadOwnerFullName ||
        followUpLead?.leadOwnerKey ||
        leadRow?.leadOwnerName ||
        leadRow?.leadOwnerFullName ||
        leadRow?.leadOwnerKey
        ? {
            key:
              existingAppointment?.leadOwnerKey ||
              followUpLead?.leadOwnerKey ||
              leadRow?.leadOwnerKey ||
              '',
            displayName:
              existingAppointment?.leadOwnerName ||
              followUpLead?.leadOwnerName ||
              leadRow?.leadOwnerName ||
              '',
            fullName:
              existingAppointment?.leadOwnerFullName ||
              followUpLead?.leadOwnerFullName ||
              leadRow?.leadOwnerFullName ||
              '',
            userId:
              existingAppointment?.leadOwnerUserId ||
              followUpLead?.leadOwnerUserId ||
              leadRow?.leadOwnerUserId ||
              '',
            email:
              existingAppointment?.leadOwnerEmail ||
              followUpLead?.leadOwnerEmail ||
              leadRow?.leadOwnerEmail ||
              '',
          }
        : null
    );

    return {
      company:
        normalizeString(
          requestBody.company ||
            existingAppointment?.company ||
            followUpLead?.company ||
            leadRow?.company ||
            callUpdate?.company ||
            insight?.company ||
            insight?.leadCompany ||
            ''
        ) || 'Onbekende lead',
      contact:
        normalizeString(
          requestBody.contact ||
            existingAppointment?.contact ||
            followUpLead?.contact ||
            leadRow?.contact ||
            callUpdate?.name ||
            insight?.contactName ||
            insight?.leadName ||
            ''
        ) || 'Onbekend',
      phone: normalizeString(
        requestBody.phone ||
          existingAppointment?.phone ||
          followUpLead?.phone ||
          leadRow?.phone ||
          callUpdate?.phone ||
          insight?.phone ||
          ''
      ),
      contactEmail:
        normalizeEmailAddress(
          requestBody.contactEmail ||
            existingAppointment?.contactEmail ||
            followUpLead?.contactEmail ||
            insight?.contactEmail ||
            insight?.email ||
            insight?.leadEmail ||
            ''
        ) || null,
      type: normalizeString(existingAppointment?.type || followUpLead?.type || 'meeting') || 'meeting',
      date:
        normalizeDateYyyyMmDd(
          requestBody.date || existingAppointment?.date || followUpLead?.date || leadRow?.date || ''
        ) || '',
      time:
        normalizeTimeHhMm(
          requestBody.time || existingAppointment?.time || followUpLead?.time || leadRow?.time || ''
        ) || '09:00',
      value:
        normalizeString(
          existingAppointment?.value ||
            followUpLead?.value ||
            formatEuroLabel(insight?.estimatedValueEur || insight?.estimated_value_eur) ||
            ''
        ) || '',
      branche:
        normalizeString(
          requestBody.branche ||
            existingAppointment?.branche ||
            followUpLead?.branche ||
            callUpdate?.branche ||
            insight?.branche ||
            insight?.sector ||
            ''
        ) || 'Onbekend',
      source:
        normalizeString(
          existingAppointment?.source ||
            followUpLead?.source ||
            leadRow?.source ||
            'AI Cold Calling (Lead opvolging)'
        ) || 'AI Cold Calling (Lead opvolging)',
      summary: truncateText(
        normalizeString(
          requestBody.summary ||
            existingAppointment?.summary ||
            followUpLead?.summary ||
            leadRow?.summary ||
            callUpdate?.summary ||
            insight?.summary ||
            'Lead toonde interesse tijdens het gesprek.'
        ),
        4000
      ),
      aiGenerated: true,
      callId: normalizedCallId,
      createdAt:
        normalizeString(
          existingAppointment?.createdAt ||
            followUpLead?.createdAt ||
            leadRow?.createdAt ||
            callUpdate?.endedAt ||
            callUpdate?.updatedAt ||
            callUpdate?.startedAt ||
            ''
        ) || new Date().toISOString(),
      needsConfirmationEmail: true,
      confirmationTaskType:
        normalizeString(
          existingAppointment?.confirmationTaskType || followUpLead?.confirmationTaskType || 'lead_follow_up'
        ) || 'lead_follow_up',
      provider:
        normalizeString(
          existingAppointment?.provider || followUpLead?.provider || leadRow?.provider || callUpdate?.provider || ''
        ) || '',
      coldcallingStack: normalizedStack || '',
      coldcallingStackLabel: stackLabel || '',
      location: resolveAppointmentLocation(
        requestBody,
        existingAppointment,
        followUpLead,
        leadRow,
        callUpdate,
        insight
      ),
      durationSeconds: resolveCallDurationSeconds(
        requestBody,
        existingAppointment,
        followUpLead,
        leadRow,
        callUpdate,
        insight
      ),
      whatsappConfirmed: toBooleanSafe(
        requestBody?.whatsappConfirmed,
        toBooleanSafe(existingAppointment?.whatsappConfirmed, false)
      ),
      whatsappInfo: sanitizeAppointmentWhatsappInfo(
        requestBody.whatsappInfo || existingAppointment?.whatsappInfo || leadRow?.whatsappInfo || ''
      ),
      recordingUrl: resolvePreferredRecordingUrl(existingAppointment, followUpLead, leadRow, callUpdate, insight),
      ...leadOwner,
    };
  }

  async function setInterestedLeadInAgendaResponse(req, res) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const callId = normalizeString(req.body?.callId || req.query?.callId || '');
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }

    const appointmentDate = normalizeDateYyyyMmDd(req.body?.appointmentDate || req.body?.date || '');
    const appointmentTime = normalizeTimeHhMm(req.body?.appointmentTime || req.body?.time || '');
    const rawLocation = sanitizeAppointmentLocation(req.body?.location || req.body?.appointmentLocation || '');
    const whatsappInfo = sanitizeAppointmentWhatsappInfo(req.body?.whatsappInfo || '');
    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');

    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!appointmentTime) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    }

    const baseAppointment = buildMaterializedInterestedLeadAppointment(callId, req.body || {});
    if (!baseAppointment) {
      return res.status(404).json({ ok: false, error: 'Lead of call niet gevonden.' });
    }
    const whatsappConfirmed = toBooleanSafe(
      req.body?.whatsappConfirmed,
      toBooleanSafe(baseAppointment?.whatsappConfirmed, false)
    );

    const location = rawLocation;
    if (!location) {
      return res.status(400).json({ ok: false, error: 'Vul een locatie in.' });
    }

    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const persistedAppointment = upsertGeneratedAgendaAppointment(baseAppointment, callId);
    if (!persistedAppointment) {
      return res.status(500).json({ ok: false, error: 'Lead kon niet worden opgeslagen.' });
    }

    const idx = getGeneratedAppointmentIndexById(persistedAppointment.id);
    if (idx < 0) {
      return res.status(500).json({ ok: false, error: 'Leadtaak niet gevonden na opslaan.' });
    }

    const nowIso = new Date().toISOString();
    const mergedSummary = await buildLeadToAgendaSummary(
      req.body?.summary || baseAppointment.summary,
      location,
      whatsappInfo,
      { whatsappConfirmed }
    );
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...persistedAppointment,
        date: appointmentDate,
        time: appointmentTime,
        location: location || null,
        appointmentLocation: location || null,
        whatsappInfo: whatsappInfo || null,
        whatsappConfirmed,
        summary: mergedSummary,
        summaryFormatVersion: 4,
        needsConfirmationEmail: false,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(persistedAppointment?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(persistedAppointment?.confirmationEmailSentBy || '') || actor || null,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor || null,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'interested_lead_set_in_agenda'
    );
    dismissInterestedLeadIdentity(
      normalizeString(updatedAppointment?.callId || callId || ''),
      updatedAppointment || baseAppointment || {},
      'interested_lead_set_in_agenda_dismiss'
    );

    appendDashboardActivity(
      {
        type: 'lead_set_in_agenda',
        title: 'Lead in agenda gezet',
        detail: `Interesse-lead handmatig ingepland op ${appointmentDate} om ${appointmentTime}${
          location ? ` (${location})` : ''
        }.`,
        company: updatedAppointment?.company || baseAppointment.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || 0) || null,
        callId,
        source: 'premium-ai-lead-generator',
      },
      'dashboard_activity_interested_lead_set_in_agenda'
    );

    const persistFailureMessage = await ensureLeadMutationPersisted(
      runtimeSnapshot,
      'Lead kon niet veilig in gedeelde opslag worden gezet.'
    );
    if (persistFailureMessage !== true) {
      return res.status(503).json({ ok: false, error: persistFailureMessage });
    }

    return res.status(200).json({
      ok: true,
      taskCompleted: true,
      appointment: updatedAppointment,
    });
  }

  async function dismissInterestedLeadResponse(req, res) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const callId = normalizeString(req.body?.callId || req.query?.callId || '');
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }

    const leadRow = findInterestedLeadRowByCallId(callId);
    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    dismissInterestedLeadIdentity(
      callId,
      leadRow || getLatestCallUpdateByCallId(callId) || {},
      'interested_lead_dismissed_manual'
    );
    const cancelledTasks = cancelOpenLeadFollowUpTasksByIdentity(
      callId,
      leadRow || getLatestCallUpdateByCallId(callId) || {},
      actor,
      'interested_lead_dismissed_manual_cancel'
    );

    appendDashboardActivity(
      {
        type: 'lead_removed',
        title: 'Lead verwijderd',
        detail: 'Interesse-lead handmatig verwijderd vanuit de Leads-pagina.',
        company: normalizeString(leadRow?.company || getLatestCallUpdateByCallId(callId)?.company || ''),
        actor,
        taskId: null,
        callId,
        source: 'premium-ai-lead-generator',
      },
      'dashboard_activity_interested_lead_removed'
    );

    const persistFailureMessage = await ensureLeadMutationPersisted(
      runtimeSnapshot,
      'Leadverwijdering kon niet veilig in gedeelde opslag worden opgeslagen.'
    );
    if (persistFailureMessage !== true) {
      return res.status(503).json({ ok: false, error: persistFailureMessage });
    }

    return res.status(200).json({
      ok: true,
      dismissed: true,
      callId,
      cancelledTasks,
    });
  }

  return {
    dismissInterestedLeadResponse,
    setInterestedLeadInAgendaResponse,
  };
}

module.exports = {
  createAgendaInterestedLeadsCoordinator,
};
