const crypto = require('crypto');

const { createAgendaConfirmationPersistenceHelpers } = require('./agenda-confirmation-persistence');

const BUSINESS_START_MIN = 9 * 60;
const BUSINESS_END_MIN = 17 * 60;

function resolveManualPlannerLabel(body, normalizeString) {
  const raw = normalizeString(body?.who || body?.manualWho || '').toLowerCase();
  if (raw === 'serve' || raw === 'servé') return 'Servé';
  if (raw === 'martijn') return 'Martijn';
  if (raw === 'overig' || raw === 'other') return 'Overig';
  return '';
}

function normalizeManualLegendChoice(body, normalizeString) {
  const raw = normalizeString(body?.legendChoice || body?.manualLegendChoice || '').toLowerCase();
  if (raw === 'business' || raw === 'bedrijfssoftware') return 'business';
  if (raw === 'voice' || raw === 'voicesoftware') return 'voice';
  if (raw === 'chatbot' || raw === 'chatbots') return 'chatbot';
  if (raw === 'manual-martijn' || raw === 'martijn') return 'manual-martijn';
  if (raw === 'manual-overig' || raw === 'overig' || raw === 'other') return 'manual-overig';
  if (raw === 'completed' || raw === 'afgerond') return 'completed';
  if (raw === 'manual-serve' || raw === 'serve' || raw === 'servé') return 'manual-serve';
  return raw ? '' : 'manual-serve';
}

function isTruthyAllDayUnavailable(body) {
  const v = body?.allDayUnavailable ?? body?.geheleDagNietBeschikbaar;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return /^(1|true|yes)$/i.test(String(v).trim());
  return false;
}

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
    createGoogleCalendarEventForAppointment = async () => ({ ok: true, skipped: true }),
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
    const allDayUnavailable = isTruthyAllDayUnavailable(body);
    const whoLabel = resolveManualPlannerLabel(body, normalizeString);
    const actor = truncateText(normalizeString(body.actor || body.doneBy || ''), 120);

    let appointmentTime;
    let activityTime;
    let location;
    let activity;
    let availableAgain;
    let legendChoice;

    if (allDayUnavailable) {
      appointmentTime = '09:00';
      activityTime = '';
      availableAgain = '17:00';
      location = sanitizeAppointmentLocation('—');
      activity = 'Gehele dag niet beschikbaar';
      legendChoice = normalizeManualLegendChoice(body, normalizeString) || 'manual-serve';
    } else {
      appointmentTime = normalizeTimeHhMm(body.time || '');
      activityTime = normalizeTimeHhMm(body.activityTime || body.activity_time || '');
      location =
        sanitizeAppointmentLocation(body.location || '') || '—';
      activity = truncateText(normalizeString(body.activity || ''), 500);
      availableAgain = normalizeTimeHhMm(body.availableAgain || '');
      legendChoice = normalizeManualLegendChoice(body, normalizeString);
    }

    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!whoLabel) {
      return res.status(400).json({
        ok: false,
        error: 'Kies wie de afspraak plant: Servé, Martijn of Overig.',
      });
    }
    if (!allDayUnavailable) {
      if (!appointmentTime) {
        return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
      }
      if (appointmentStartMinutesWithinBusinessHours(appointmentTime) === null) {
        return res.status(400).json({
          ok: false,
          error: 'Afspraken zijn alleen tussen 09:00 en 17:00. Kies een tijd in dat venster.',
        });
      }
      if (!activity) {
        return res.status(400).json({ ok: false, error: 'Vul een activiteit in.' });
      }
      if (!activityTime) {
        return res.status(400).json({
          ok: false,
          error: 'Vul een geldig tijdstip van activiteit in (HH:MM).',
        });
      }
      if (!legendChoice) {
        return res.status(400).json({
          ok: false,
          error: 'Kies een geldige legenda keuze.',
        });
      }
      if (!availableAgain) {
        return res.status(400).json({
          ok: false,
          error: 'Kies een geldige tijd (HH:MM) voor wanneer je weer beschikbaar bent.',
        });
      }
    }

    const callId = `manual_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const summary = [
      activity,
      `Wie: ${whoLabel}`,
      activityTime ? `Tijdstip activiteit: ${activityTime}` : '',
      legendChoice ? `Legenda: ${legendChoice}` : '',
      `Weer thuis, beschikbaar voor een reis naar prospect: ${availableAgain}`,
    ].filter(Boolean).join('\n\n');

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
      manualPlannerWho: whoLabel === 'Martijn' ? 'martijn' : whoLabel === 'Overig' ? 'overig' : 'serve',
      manualLegendChoice: legendChoice,
      manualActivityTime: activityTime,
      manualAllDayUnavailable: allDayUnavailable,
      manualAvailableAgain: availableAgain,
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
        detail: allDayUnavailable
          ? `${activity} op ${appointmentDate} (09:00–17:00). Door: ${whoLabel}.`
          : `${activity} op ${appointmentDate} om ${appointmentTime}. Door: ${whoLabel}.`,
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

    let finalAppointment = updatedAppointment;
    let googleCalendarSync = null;
    try {
      googleCalendarSync = await createGoogleCalendarEventForAppointment(updatedAppointment);
      if (googleCalendarSync && googleCalendarSync.appointment) {
        finalAppointment = googleCalendarSync.appointment;
      }
    } catch (error) {
      googleCalendarSync = {
        ok: false,
        error: truncateText(String(error && error.message ? error.message : error), 300),
      };
    }

    return res.status(persistOk === 'pending' ? 202 : 200).json({
      ok: true,
      persistencePending: persistOk === 'pending',
      appointment: finalAppointment,
      googleCalendarSync,
    });
  }

  return {
    createManualAgendaAppointmentResponse,
  };
}

module.exports = {
  createAgendaManualAppointmentCoordinator,
};
