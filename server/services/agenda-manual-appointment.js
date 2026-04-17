const crypto = require('crypto');

const { createAgendaConfirmationPersistenceHelpers } = require('./agenda-confirmation-persistence');

const BUSINESS_START_MIN = 9 * 60;
const BUSINESS_END_MIN = 17 * 60;

function createAgendaManualAppointmentCoordinator(deps = {}) {
  const {
    isSupabaseConfigured,
    getSupabaseStateHydrated,
    forceHydrateRuntimeStateWithRetries,
    syncRuntimeStateFromSupabaseIfNewer,
    backfillInsightsAndAppointmentsFromRecentCallUpdates,
    getGeneratedAgendaAppointments,
    getGeneratedAppointmentIndexById,
    setGeneratedAgendaAppointmentAtIndex,
    upsertGeneratedAgendaAppointment,
    appendDashboardActivity,
    buildRuntimeStateSnapshotPayload,
    applyRuntimeStateSnapshotPayload,
    waitForQueuedRuntimeSnapshotPersist,
    invalidateSupabaseSyncTimestamp,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    sanitizeAppointmentLocation,
    truncateText,
  } = deps;

  const {
    takeRuntimeMutationSnapshot,
    resolveGeneratedAgendaAppointmentById,
    doesAgendaMutationMatchAppointment,
    ensureLeadMutationPersistedOrRespond,
  } = createAgendaConfirmationPersistenceHelpers({
    isSupabaseConfigured,
    buildRuntimeStateSnapshotPayload,
    getGeneratedAgendaAppointments,
    getGeneratedAppointmentIndexById,
    normalizeString,
    normalizeDateYyyyMmDd,
    normalizeTimeHhMm,
    waitForQueuedRuntimeSnapshotPersist,
    syncRuntimeStateFromSupabaseIfNewer,
    applyRuntimeStateSnapshotPayload,
    invalidateSupabaseSyncTimestamp,
  });

  function appointmentStartMinutesWithinBusinessHours(timeHm) {
    const normalized = normalizeTimeHhMm(timeHm);
    if (!normalized) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(normalized);
    if (!m) return null;
    const h = Number(m[1]);
    const mins = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mins) || mins < 0 || mins > 59) return null;
    const total = h * 60 + mins;
    if (total < BUSINESS_START_MIN || total > BUSINESS_END_MIN) return null;
    return total;
  }

  async function createManualAgendaAppointmentResponse(req, res) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    await syncRuntimeStateFromSupabaseIfNewer({ force: true, maxAgeMs: 0 }).catch(() => false);
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const appointmentDate = normalizeDateYyyyMmDd(body.date || '');
    const appointmentTime = normalizeTimeHhMm(body.time || '');
    const location = sanitizeAppointmentLocation(body.location || '');
    const activity = truncateText(normalizeString(body.activity || ''), 500);
    const availableAgain = truncateText(normalizeString(body.availableAgain || ''), 800);
    const actor = truncateText(normalizeString(body.actor || body.doneBy || ''), 120);

    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!appointmentTime) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    }
    if (appointmentStartMinutesWithinBusinessHours(appointmentTime) === null) {
      return res.status(400).json({
        ok: false,
        error: 'Afspraken zijn alleen tussen 09:00 en 17:00. Kies een tijd in dat venster.',
      });
    }
    if (!location) {
      return res.status(400).json({ ok: false, error: 'Vul een locatie in.' });
    }
    if (!activity) {
      return res.status(400).json({ ok: false, error: 'Vul een activiteit in.' });
    }
    if (!availableAgain) {
      return res.status(400).json({
        ok: false,
        error: 'Vul in wanneer je weer beschikbaar of thuis bent na reizen.',
      });
    }

    const callId = `manual_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const summary = [activity, `Weer beschikbaar / thuis: ${availableAgain}`].join('\n\n');

    const baseAppointment = {
      callId,
      aiGenerated: false,
      needsConfirmationEmail: false,
      company: activity,
      contact: '—',
      phone: '',
      date: appointmentDate,
      time: appointmentTime,
      location,
      appointmentLocation: location,
      source: 'Handmatig',
      provider: 'manual',
      providerLabel: 'Handmatig',
      coldcallingStack: 'manual',
      summary,
      summaryFormatVersion: 4,
      branche: '',
      confirmationTaskType: '',
    };

    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const persisted = upsertGeneratedAgendaAppointment(baseAppointment, callId);
    if (!persisted) {
      return res.status(500).json({ ok: false, error: 'Afspraak kon niet worden opgeslagen.' });
    }

    const idx = getGeneratedAppointmentIndexById(persisted.id);
    if (idx < 0) {
      return res.status(500).json({ ok: false, error: 'Afspraak niet gevonden na opslaan.' });
    }

    const nowIso = new Date().toISOString();
    const actorLabel = actor || 'premium-personeel-agenda';
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...persisted,
        date: appointmentDate,
        time: appointmentTime,
        location,
        appointmentLocation: location,
        summary,
        summaryFormatVersion: 4,
        needsConfirmationEmail: false,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(persisted?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: actorLabel,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actorLabel,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'manual_agenda_appointment'
    );

    appendDashboardActivity(
      {
        type: 'manual_agenda_appointment',
        title: 'Handmatige afspraak toegevoegd',
        detail: `${activity} op ${appointmentDate} om ${appointmentTime}${location ? ` (${location})` : ''}.`,
        company: activity,
        actor: actorLabel,
        taskId: Number(updatedAppointment?.id || 0) || null,
        callId,
        source: 'premium-personeel-agenda',
      },
      'dashboard_activity_manual_agenda_appointment'
    );

    const persistOk = await ensureLeadMutationPersistedOrRespond(
      res,
      runtimeSnapshot,
      'Afspraak kon niet veilig in gedeelde opslag worden gezet.',
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
      persistencePending: persistOk === 'pending',
      appointment: updatedAppointment,
    });
  }

  return {
    createManualAgendaAppointmentResponse,
  };
}

module.exports = {
  createAgendaManualAppointmentCoordinator,
};
