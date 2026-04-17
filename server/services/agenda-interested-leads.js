const {
  buildLeadTraceContext,
  hasLeadTraceContext,
  logLeadTrace,
  summarizeLeadRow,
} = require('./lead-trace');

function createAgendaInterestedLeadsCoordinator(deps = {}) {
  const {
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    syncRuntimeStateFromSupabaseIfNewer = async () => false,
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
    buildAllInterestedLeadRows = () => [],
    buildLeadFollowUpCandidateKey = () => '',
    collectInterestedLeadCallIdsByIdentity = () => [],
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
    persistDismissedLeadsToSupabase = async () => false,
    ensureDismissedLeadsFreshFromSupabase = async () => false,
    appendDashboardActivity = () => {},
    cancelOpenLeadFollowUpTasksByIdentity = () => [],
    buildRuntimeStateSnapshotPayload = () => null,
    applyRuntimeStateSnapshotPayload = () => false,
    waitForQueuedRuntimeSnapshotPersist = async () => true,
    invalidateSupabaseSyncTimestamp = () => {},
  } = deps;

  function takeRuntimeMutationSnapshot() {
    if (!isSupabaseConfigured()) return null;
    const snapshot = buildRuntimeStateSnapshotPayload();
    return snapshot && typeof snapshot === 'object' ? snapshot : null;
  }

  function hasRequestBackedInterestedLeadInput(requestBody = {}) {
    return Boolean(
      normalizeString(requestBody.company || '') ||
        normalizeString(requestBody.contact || '') ||
        normalizeString(requestBody.phone || '') ||
        normalizeString(requestBody.summary || '') ||
        normalizeString(requestBody.contactEmail || '') ||
        normalizeString(requestBody.branche || '')
    );
  }

  function resolveGeneratedAgendaAppointmentById(rawId) {
    const id = Number(rawId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const idx = getGeneratedAppointmentIndexById(id);
    if (idx < 0) return null;
    return getGeneratedAgendaAppointments()[idx] || null;
  }

  function hasVisibleInterestedLeadIdentity(callId, rowLike) {
    const normalizedCallId = normalizeString(callId || '');
    const normalizedLeadKey = normalizeString(buildLeadFollowUpCandidateKey(rowLike || {}));
    if (!normalizedCallId && !normalizedLeadKey) return false;

    return buildAllInterestedLeadRows().some((row) => {
      const rowCallId = normalizeString(row?.callId || '');
      const rowLeadKey = normalizeString(buildLeadFollowUpCandidateKey(row || {}));
      if (normalizedCallId && rowCallId && rowCallId === normalizedCallId) return true;
      if (normalizedLeadKey && rowLeadKey && rowLeadKey === normalizedLeadKey) return true;
      return false;
    });
  }

  function doesAgendaMutationMatchAppointment(expected, candidate) {
    if (!expected || !candidate) return false;

    const expectedId = Number(expected?.id || 0);
    const candidateId = Number(candidate?.id || 0);
    if (!Number.isFinite(expectedId) || expectedId <= 0 || expectedId !== candidateId) return false;

    const expectedCallId = normalizeString(expected?.callId || '');
    const candidateCallId = normalizeString(candidate?.callId || '');
    if (expectedCallId && expectedCallId !== candidateCallId) return false;

    const expectedDate = normalizeDateYyyyMmDd(expected?.date || '');
    const candidateDate = normalizeDateYyyyMmDd(candidate?.date || '');
    if (expectedDate && expectedDate !== candidateDate) return false;

    const expectedTime = normalizeTimeHhMm(expected?.time || '');
    const candidateTime = normalizeTimeHhMm(candidate?.time || '');
    if (expectedTime && expectedTime !== candidateTime) return false;

    const expectedLocation = normalizeString(expected?.location || expected?.appointmentLocation || '');
    const candidateLocation = normalizeString(candidate?.location || candidate?.appointmentLocation || '');
    if (expectedLocation && expectedLocation !== candidateLocation) return false;

    return true;
  }

  function waitForPendingPersistResponse(ms) {
    return new Promise((resolve) => {
      setTimeout(() => resolve('pending'), Math.max(250, Number(ms) || 3000));
    });
  }

  async function ensureLeadMutationPersisted(runtimeSnapshot, failureMessage, options = {}) {
    const verifyPersisted =
      options && typeof options.verifyPersisted === 'function' ? options.verifyPersisted : null;
    const allowPendingResponse = Boolean(options?.allowPendingResponse);
    const pendingResponseAfterMs = Math.max(1000, Math.min(15000, Number(options?.pendingResponseAfterMs) || 3000));
    let persisted = null;

    if (allowPendingResponse && isSupabaseConfigured()) {
      const fastPersistResult = await Promise.race([
        waitForQueuedRuntimeSnapshotPersist()
          .then((value) => (value ? true : false))
          .catch(() => false),
        waitForPendingPersistResponse(pendingResponseAfterMs),
      ]);
      if (fastPersistResult === true) return true;
      if (fastPersistResult === 'pending') {
        if (!verifyPersisted) return 'pending';
        try {
          if (verifyPersisted()) return 'pending';
        } catch {
          // Val terug op het bestaande foutpad als lokale verificatie faalt.
        }
      } else {
        persisted = false;
      }
    } else {
      persisted = await waitForQueuedRuntimeSnapshotPersist();
      if (persisted) return true;
    }

    if (persisted === null) {
      persisted = await waitForQueuedRuntimeSnapshotPersist();
      if (persisted) return true;
    }

    if (!isSupabaseConfigured()) return true;
    const syncedFromSharedState = await syncRuntimeStateFromSupabaseIfNewer({ force: true, maxAgeMs: 0 }).catch(
      () => false
    );
    if (syncedFromSharedState && verifyPersisted) {
      try {
        if (verifyPersisted()) return true;
      } catch {
        // Val terug op foutpad als verificatie zelf faalt.
      }
    }

    if (!syncedFromSharedState && runtimeSnapshot) {
      applyRuntimeStateSnapshotPayload(runtimeSnapshot, {
        updatedAt: normalizeString(runtimeSnapshot?.savedAt || '') || new Date().toISOString(),
      });
    }
    return failureMessage || 'Leadwijziging kon niet veilig in gedeelde opslag worden opgeslagen.';
  }

  async function ensureLeadMutationPersistedOrRespond(res, runtimeSnapshot, failureMessage, options = {}) {
    const persistResult = await ensureLeadMutationPersisted(runtimeSnapshot, failureMessage, options);
    if (persistResult === true || persistResult === 'pending') {
      invalidateSupabaseSyncTimestamp();
      return persistResult;
    }

    const errorMessage =
      normalizeString(persistResult || failureMessage) ||
      'Leadwijziging kon niet veilig in gedeelde opslag worden opgeslagen.';
    res.status(503).json({
      ok: false,
      error: errorMessage,
    });
    return false;
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
    // De modal op /premium-leads bevat al een snapshot van de leaddata. Als de
    // POST vervolgens op een andere warme Vercel-instance landt die deze callId
    // nog niet uit runtime/call-update sync kent, mag "in agenda zetten" niet
    // met 404 stranden terwijl de gebruiker een geldige open lead voor zich
    // heeft. In dat geval materialiseren we de afspraak veilig uit de
    // request-body snapshot.
    const requestBackedFallback = hasRequestBackedInterestedLeadInput(requestBody) ? {} : null;
    const base = existingAppointment || followUpLead || leadRow || requestBackedFallback;
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
    const callId = normalizeString(req.body?.callId || req.query?.callId || '');
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }

    const requestBody = req.body && typeof req.body === 'object' ? req.body : {};
    const appointmentDate = normalizeDateYyyyMmDd(requestBody?.appointmentDate || requestBody?.date || '');
    const appointmentTime = normalizeTimeHhMm(requestBody?.appointmentTime || requestBody?.time || '');
    const rawLocation = sanitizeAppointmentLocation(requestBody?.location || requestBody?.appointmentLocation || '');
    const whatsappInfo = sanitizeAppointmentWhatsappInfo(requestBody?.whatsappInfo || '');
    const actor = normalizeString(requestBody?.actor || requestBody?.doneBy || '');

    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!appointmentTime) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    }

    // Probeer eerst direct uit de huidige instance en request-body snapshot te
    // materialiseren. De lead-modal stuurt al voldoende context mee; een
    // verplichte shared-state refresh hier veroorzaakte juist false timeouts
    // terwijl de afspraak later alsnog werd aangemaakt.
    backfillInsightsAndAppointmentsFromRecentCallUpdates();
    let baseAppointment = buildMaterializedInterestedLeadAppointment(callId, requestBody);
    if (!baseAppointment && isSupabaseConfigured()) {
      if (!getSupabaseStateHydrated()) {
        await forceHydrateRuntimeStateWithRetries(3);
      }
      await syncRuntimeStateFromSupabaseIfNewer({ force: true, maxAgeMs: 0 }).catch(() => false);
      backfillInsightsAndAppointmentsFromRecentCallUpdates();
      baseAppointment = buildMaterializedInterestedLeadAppointment(callId, requestBody);
    }
    if (!baseAppointment) {
      return res.status(404).json({ ok: false, error: 'Lead of call niet gevonden.' });
    }
    const whatsappConfirmed = toBooleanSafe(
      requestBody?.whatsappConfirmed,
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
      requestBody?.summary || baseAppointment.summary,
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

    const persistOk = await ensureLeadMutationPersistedOrRespond(
      res,
      runtimeSnapshot,
      'Lead kon niet veilig in gedeelde opslag worden gezet.',
      {
        allowPendingResponse: true,
        pendingResponseAfterMs: 3000,
        verifyPersisted: () =>
          doesAgendaMutationMatchAppointment(
            updatedAppointment,
            resolveGeneratedAgendaAppointmentById(updatedAppointment?.id)
          ),
      }
    );
    if (!persistOk) return res;

    return res.status(persistOk === 'pending' ? 202 : 200).json({
      ok: true,
      taskCompleted: true,
      persistencePending: persistOk === 'pending',
      appointment: updatedAppointment,
    });
  }

  async function dismissInterestedLeadResponse(req, res) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    // Vercel serverless: deze instance kan sinds zijn cold start nooit meer
    // remote dismisses hebben gezien. Refresh altijd de dedicated dismissed-row
    // zodat we ná de dismiss met de volledige union persisten (en we niet per
    // ongeluk dismisses van andere instances "vergeten").
    if (isSupabaseConfigured()) {
      await ensureDismissedLeadsFreshFromSupabase({ force: true }).catch(() => false);
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const callId = normalizeString(req.body?.callId || req.query?.callId || '');
    if (!callId) {
      return res.status(400).json({ ok: false, error: 'callId ontbreekt.' });
    }

    const trace = buildLeadTraceContext(req);
    const leadRow = findInterestedLeadRowByCallId(callId);
    const leadIdentity = leadRow || getLatestCallUpdateByCallId(callId) || {};
    const relatedCallIds = collectInterestedLeadCallIdsByIdentity(callId, leadIdentity);
    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    if (hasLeadTraceContext(trace)) {
      logLeadTrace('dismiss', 'request', {
        traceId: trace.traceId,
        trigger: trace.trigger,
        callId,
        actor,
        leadRow: summarizeLeadRow(leadRow),
        leadIdentity: summarizeLeadRow(leadIdentity),
        relatedCallIds,
      });
    }
    dismissInterestedLeadIdentity(
      callId,
      leadIdentity,
      'interested_lead_dismissed_manual',
      {
        relatedCallIds,
      }
    );
    const cancelledTasks = cancelOpenLeadFollowUpTasksByIdentity(
      callId,
      leadIdentity,
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

    const locallyHiddenAfterDismiss = !hasVisibleInterestedLeadIdentity(callId, leadIdentity);
    const dedicatedDismissedPersistOk = isSupabaseConfigured()
      ? await persistDismissedLeadsToSupabase('interested_lead_dismissed_manual_route_confirm').catch(() => false)
      : false;

    if (hasLeadTraceContext(trace)) {
      logLeadTrace('dismiss', 'checkpoint', {
        traceId: trace.traceId,
        trigger: trace.trigger,
        callId,
        locallyHiddenAfterDismiss,
        dedicatedDismissedPersistOk,
      });
    }

    let persistOk = false;
    if (isSupabaseConfigured() && dedicatedDismissedPersistOk && locallyHiddenAfterDismiss) {
      invalidateSupabaseSyncTimestamp();
      persistOk = true;
    } else {
      persistOk = await ensureLeadMutationPersistedOrRespond(
        res,
        runtimeSnapshot,
        'Leadverwijdering kon niet veilig in gedeelde opslag worden bevestigd.',
        {
          verifyPersisted: () => !hasVisibleInterestedLeadIdentity(callId, leadIdentity),
        }
      );
    }
    if (!persistOk) return res;

    if (hasLeadTraceContext(trace)) {
      logLeadTrace('dismiss', 'response', {
        traceId: trace.traceId,
        trigger: trace.trigger,
        callId,
        cancelledTasks,
        stillVisibleAfterPersist: hasVisibleInterestedLeadIdentity(callId, leadIdentity),
      });
    }

    return res.status(200).json({
      ok: true,
      dismissed: true,
      persistencePending: false,
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
