const crypto = require('crypto');

const { createAgendaConfirmationPersistenceHelpers } = require('./agenda-confirmation-persistence');

function resolveManualPlannerLabel(body, normalizeString) {
  const key = resolveManualPlannerKey(body, normalizeString);
  if (key === 'serve') return 'Servé';
  if (key === 'martijn') return 'Martijn';
  if (key === 'both') return 'Servé en Martijn';
  if (key === 'overig') return 'Overig';
  return '';
}

function resolveManualPlannerKey(body, normalizeString) {
  const raw = normalizeString(body?.who || body?.manualWho || '').toLowerCase();
  if (raw === 'serve' || raw === 'servé') return 'serve';
  if (raw === 'martijn') return 'martijn';
  if (raw === 'both' || raw === 'allebei' || raw === 'beide' || raw === 'serve-martijn') {
    return 'both';
  }
  if (raw === 'overig' || raw === 'other') return 'overig';
  return '';
}

function normalizeManualLegendChoice(body, normalizeString) {
  const raw = normalizeString(body?.legendChoice || body?.manualLegendChoice || '').toLowerCase();
  if (raw === 'business' || raw === 'bedrijfssoftware') return 'business';
  if (raw === 'voice' || raw === 'voicesoftware') return 'voice';
  if (raw === 'chatbot' || raw === 'chatbots') return 'chatbot';
  if (raw === 'website') return 'website';
  if (raw === 'manual-martijn' || raw === 'martijn') return 'manual-martijn';
  if (raw === 'manual-both' || raw === 'both' || raw === 'allebei' || raw === 'beide') return 'manual-both';
  if (raw === 'private-serve' || raw === 'prive-serve' || raw === 'privé-serve') return 'private-serve';
  if (raw === 'private-martijn' || raw === 'prive-martijn' || raw === 'privé-martijn') return 'private-martijn';
  if (raw === 'manual-overig' || raw === 'overig' || raw === 'other') return 'manual-overig';
  if (raw === 'completed' || raw === 'afgerond') return 'completed';
  if (raw === 'manual-serve' || raw === 'serve' || raw === 'servé') return 'manual-serve';
  return raw ? '' : 'manual-serve';
}

function isManualAppointmentRecord(appointment, normalizeString) {
  if (!appointment || typeof appointment !== 'object') return false;
  const callId = normalizeString(appointment.callId || '').toLowerCase();
  if (callId.startsWith('manual_')) return true;
  const marker = [
    appointment.source,
    appointment.provider,
    appointment.providerLabel,
    appointment.coldcallingStack,
    appointment.createdFrom,
    appointment.summary,
  ]
    .map((value) => normalizeString(value || '').toLowerCase())
    .join(' ');
  return /\b(handmatig|manual|premium-personeel-agenda)\b/.test(marker);
}

function normalizeManualLeadOwnerKey(value, normalizeString) {
  const normalized = normalizeString(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (normalized.includes('martijn')) return 'martijn';
  if (normalized.includes('serve')) return 'serve';
  return '';
}

function resolveManualLeadOwner(body, normalizeString) {
  const key = normalizeManualLeadOwnerKey(
    body?.manualLeadOwner || body?.leadOwnerKey || body?.leadOwnerName || body?.leadOwnerFullName,
    normalizeString
  );
  if (key === 'martijn') return { key: 'martijn', name: 'Martijn van de Ven', fullName: 'Martijn van de Ven', email: '' };
  if (key === 'serve') return { key: 'serve', name: 'Servé Creusen', fullName: 'Servé Creusen', email: '' };
  return null;
}

function isMeetingLegendChoice(value) {
  return ['website', 'business', 'voice', 'chatbot'].includes(String(value || '').trim().toLowerCase());
}

function resolveManualAppointmentKind(rawKind, legendChoice) {
  const normalizedKind = String(rawKind || '').trim().toLowerCase();
  if (normalizedKind === 'meeting' || normalizedKind === 'appointment' || normalizedKind === 'overig') {
    return normalizedKind;
  }
  const normalizedLegend = String(legendChoice || '').trim().toLowerCase();
  if (isMeetingLegendChoice(normalizedLegend)) return 'meeting';
  if (
    normalizedLegend === 'private-serve' ||
    normalizedLegend === 'private-martijn' ||
    normalizedLegend === 'manual-overig'
  ) {
    return 'overig';
  }
  return 'appointment';
}

function isTruthyAllDayUnavailable(body) {
  const v = body?.allDayUnavailable ?? body?.geheleDagNietBeschikbaar;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') return /^(1|true|yes)$/i.test(String(v).trim());
  return false;
}

function logManualAppointmentWarning(logger, label, detail) {
  const message = detail && detail.message ? detail.message : detail;
  if (typeof logger?.warn === 'function') {
    logger.warn('[Agenda Manual Appointment]', label, message || '');
  } else if (typeof logger?.error === 'function') {
    logger.error('[Agenda Manual Appointment]', label, message || '');
  }
}

async function runWithManualSoftTimeout(label, run, options = {}) {
  const timeoutMs = Math.max(1, Math.min(15000, Number(options.timeoutMs) || 3500));
  const fallbackValue = options.fallbackValue;
  const logger = options.logger;
  let timeoutHandle = null;
  let timedOut = false;

  const guardedRun = Promise.resolve()
    .then(run)
    .catch((error) => {
      if (timedOut) {
        logManualAppointmentWarning(logger, `${label}_late_error`, error);
        return fallbackValue;
      }
      throw error;
    });

  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      logManualAppointmentWarning(logger, `${label}_timeout`, `na ${timeoutMs}ms`);
      resolve(fallbackValue);
    }, timeoutMs);
  });

  try {
    return await Promise.race([guardedRun, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function createAgendaManualAppointmentCoordinator(deps = {}) {
  const {
    isSupabaseConfigured,
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
    manualGoogleCalendarSyncTimeoutMs = 3500,
    logger = console,
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

  async function createManualAgendaAppointmentResponse(req, res) {
    // Handmatige afspraken bevatten alle benodigde velden in de request zelf.
    // Eerst een volledige shared-state refresh doen kan de UI laten time-outen.
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const appointmentDate = normalizeDateYyyyMmDd(body.date || '');
    const allDayUnavailable = isTruthyAllDayUnavailable(body);
    const whoKey = resolveManualPlannerKey(body, normalizeString);
    const whoLabel = resolveManualPlannerLabel(body, normalizeString);
    const actor = truncateText(normalizeString(body.actor || body.doneBy || ''), 120);
    const requestedAppointmentKind = normalizeString(body.appointmentKind || body.manualAppointmentKind || '').toLowerCase();

    let appointmentTime;
    let activityTime;
    let location;
    let activity;
    let phone;
    let notes;
    let availableAgain;
    let legendChoice;

    if (allDayUnavailable) {
      appointmentTime = '09:00';
      activityTime = '';
      availableAgain = '17:00';
      location = sanitizeAppointmentLocation('—');
      activity = 'Gehele dag niet beschikbaar';
      phone = '';
      notes = '';
      legendChoice = normalizeManualLegendChoice(body, normalizeString) || 'manual-serve';
    } else {
      appointmentTime = normalizeTimeHhMm(body.time || '');
      activityTime = normalizeTimeHhMm(body.activityTime || body.activity_time || body.time || '');
      location =
        sanitizeAppointmentLocation(body.location || '') || '—';
      activity = truncateText(normalizeString(body.title || body.activity || ''), 500);
      phone = truncateText(normalizeString(body.phone || body.manualPhone || body.telefoon || body.telefoonnummer || ''), 80);
      notes = truncateText(normalizeString(body.notes || body.opmerkingen || ''), 1000);
      legendChoice = normalizeManualLegendChoice(body, normalizeString);
    }
    const appointmentKind =
      allDayUnavailable && !requestedAppointmentKind
        ? 'overig'
        : resolveManualAppointmentKind(requestedAppointmentKind, legendChoice);
    const canStoreAvailableAgain =
      !allDayUnavailable &&
      appointmentKind === 'overig' &&
      (whoKey === 'serve' || whoKey === 'martijn');
    if (!allDayUnavailable) {
      availableAgain = canStoreAvailableAgain ? normalizeTimeHhMm(body.availableAgain || '') : '';
    }
    const manualLeadOwner = resolveManualLeadOwner(body, normalizeString);
    const requiresManualLeadOwner =
      !allDayUnavailable && appointmentKind === 'meeting' && isMeetingLegendChoice(legendChoice);

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
      if (!activity) {
        return res.status(400).json({ ok: false, error: 'Vul een titel in.' });
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
      if (requiresManualLeadOwner && !manualLeadOwner) {
        return res.status(400).json({
          ok: false,
          error: 'Kies wie deze lead heeft geregeld.',
        });
      }
    }

    const callId = `manual_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const summary = [
      activity,
      `Wie: ${whoLabel}`,
      activityTime ? `Tijdstip activiteit: ${activityTime}` : '',
      location && location !== '—' ? `Locatie: ${location}` : '',
      phone ? `Telefoonnummer: ${phone}` : '',
      legendChoice ? `Legenda: ${legendChoice}` : '',
      manualLeadOwner ? `Lead geregeld door: ${manualLeadOwner.name}` : '',
      notes ? `Opmerkingen: ${notes}` : '',
      availableAgain ? `Weer beschikbaar vanaf: ${availableAgain}` : '',
    ].filter(Boolean).join('\n\n');

    const baseAppointment = {
      callId,
      aiGenerated: false,
      needsConfirmationEmail: false,
      company: activity,
      contact: '—',
      phone,
      manualPhone: phone,
      contactPhone: phone,
      date: appointmentDate,
      time: appointmentTime,
      location,
      appointmentLocation: location,
      source: 'Handmatig',
      provider: 'manual',
      providerLabel: 'Handmatig',
      coldcallingStack: 'manual',
      manualPlannerWho:
        whoKey || 'serve',
      appointmentKind,
      manualLegendChoice: legendChoice,
      manualActivityTime: activityTime,
      manualNotes: notes,
      manualLeadOwnerKey: manualLeadOwner?.key || '',
      manualLeadOwnerName: manualLeadOwner?.name || '',
      leadOwnerKey: manualLeadOwner?.key || '',
      leadOwnerName: manualLeadOwner?.name || '',
      leadOwnerFullName: manualLeadOwner?.fullName || '',
      leadOwnerEmail: manualLeadOwner?.email || '',
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
        appointmentKind,
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
        allowLocalVerifiedPending: true,
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
      googleCalendarSync = await runWithManualSoftTimeout(
        'google_calendar_manual_export',
        () => createGoogleCalendarEventForAppointment(updatedAppointment),
        {
          timeoutMs: manualGoogleCalendarSyncTimeoutMs,
          fallbackValue: {
            ok: false,
            skipped: true,
            timedOut: true,
            reason: 'google_calendar_sync_timeout',
            error: 'Google Calendar synchronisatie duurde te lang; afspraak is wel opgeslagen.',
          },
          logger,
        }
      );
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

  async function updateManualAgendaAppointmentResponse(req, res, appointmentIdRaw) {
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const appointmentId = Number(appointmentIdRaw || req.params?.id || req.query?.appointmentId || 0);
    if (!Number.isFinite(appointmentId) || appointmentId <= 0) {
      return res.status(400).json({ ok: false, error: 'Afspraak-id ontbreekt.' });
    }

    const idx = getGeneratedAppointmentIndexById(appointmentId);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Afspraak niet gevonden.' });
    }

    const existing = getGeneratedAgendaAppointments()[idx] || null;
    if (!isManualAppointmentRecord(existing, normalizeString)) {
      return res.status(400).json({ ok: false, error: 'Alleen handmatige afspraken kunnen hier worden gewijzigd.' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const appointmentDate = normalizeDateYyyyMmDd(body.date || '');
    const appointmentTime = normalizeTimeHhMm(body.time || '');
    const activityTime = normalizeTimeHhMm(body.activityTime || body.activity_time || body.time || '');
    const location = sanitizeAppointmentLocation(body.location || '') || '—';
    const activity = truncateText(normalizeString(body.title || body.activity || ''), 500);
    const phone = truncateText(normalizeString(body.phone || body.manualPhone || body.telefoon || body.telefoonnummer || ''), 80);
    const notes = truncateText(normalizeString(body.notes || body.opmerkingen || ''), 1000);
    const whoKey = resolveManualPlannerKey(body, normalizeString);
    const whoLabel = resolveManualPlannerLabel(body, normalizeString);
    const legendChoice = normalizeManualLegendChoice(body, normalizeString);
    const appointmentKind = resolveManualAppointmentKind(
      normalizeString(body.appointmentKind || body.manualAppointmentKind || '').toLowerCase(),
      legendChoice
    );
    const availableAgain =
      appointmentKind === 'overig' && (whoKey === 'serve' || whoKey === 'martijn')
        ? normalizeTimeHhMm(body.availableAgain || '')
        : '';
    const manualLeadOwner = resolveManualLeadOwner(body, normalizeString);
    const requiresManualLeadOwner = appointmentKind === 'meeting' && isMeetingLegendChoice(legendChoice);

    if (!appointmentDate) return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    if (!appointmentTime) return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    if (!activity) return res.status(400).json({ ok: false, error: 'Vul een titel in.' });
    if (!activityTime) return res.status(400).json({ ok: false, error: 'Vul een geldig tijdstip van activiteit in (HH:MM).' });
    if (!whoLabel || !whoKey) {
      return res.status(400).json({ ok: false, error: 'Kies wie bij deze afspraak hoort.' });
    }
    if (!legendChoice) return res.status(400).json({ ok: false, error: 'Kies een geldige legenda keuze.' });
    if (requiresManualLeadOwner && !manualLeadOwner) {
      return res.status(400).json({ ok: false, error: 'Kies wie deze lead heeft geregeld.' });
    }

    const summary = [
      activity,
      `Wie: ${whoLabel}`,
      activityTime ? `Tijdstip activiteit: ${activityTime}` : '',
      location && location !== '—' ? `Locatie: ${location}` : '',
      phone ? `Telefoonnummer: ${phone}` : '',
      legendChoice ? `Legenda: ${legendChoice}` : '',
      manualLeadOwner ? `Lead geregeld door: ${manualLeadOwner.name}` : '',
      notes ? `Opmerkingen: ${notes}` : '',
      availableAgain ? `Weer beschikbaar vanaf: ${availableAgain}` : '',
    ].filter(Boolean).join('\n\n');

    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const actor = truncateText(normalizeString(body.actor || body.doneBy || ''), 120);
    const actorLabel = actor || 'premium-personeel-agenda';
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...existing,
        company: activity,
        contact: normalizeString(existing.contact || '') || '—',
        phone,
        manualPhone: phone,
        contactPhone: phone,
        date: appointmentDate,
        time: appointmentTime,
        location,
        appointmentLocation: location,
        source: 'Handmatig',
        provider: 'manual',
        providerLabel: 'Handmatig',
        coldcallingStack: 'manual',
        manualPlannerWho: whoKey,
        appointmentKind,
        manualLegendChoice: legendChoice,
        legendChoice,
        manualActivityTime: activityTime,
        manualAvailableAgain: availableAgain,
        manualNotes: notes,
        manualLeadOwnerKey: manualLeadOwner?.key || '',
        manualLeadOwnerName: manualLeadOwner?.name || '',
        leadOwnerKey: manualLeadOwner?.key || '',
        leadOwnerName: manualLeadOwner?.name || '',
        leadOwnerFullName: manualLeadOwner?.fullName || '',
        leadOwnerEmail: manualLeadOwner?.email || '',
        summary,
        summaryFormatVersion: 4,
        needsConfirmationEmail: false,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(existing?.confirmationEmailSentAt || '') || new Date().toISOString(),
        confirmationEmailSentBy: normalizeString(existing?.confirmationEmailSentBy || '') || actorLabel,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: normalizeString(existing?.confirmationResponseReceivedAt || '') || new Date().toISOString(),
        confirmationResponseReceivedBy: normalizeString(existing?.confirmationResponseReceivedBy || '') || actorLabel,
      },
      'manual_agenda_appointment_update'
    );

    appendDashboardActivity(
      {
        type: 'manual_agenda_appointment_update',
        title: 'Handmatige afspraak gewijzigd',
        detail: `${activity} op ${appointmentDate} om ${appointmentTime}. Door: ${whoLabel}.`,
        company: activity,
        actor: actorLabel,
        taskId: Number(updatedAppointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || ''),
        source: 'premium-personeel-agenda',
      },
      'dashboard_activity_manual_agenda_appointment_update'
    );

    const persistOk = await ensureLeadMutationPersistedOrRespond(
      res,
      runtimeSnapshot,
      'Afspraak kon niet veilig in gedeelde opslag worden bijgewerkt.',
      {
        allowPendingResponse: true,
        pendingResponseAfterMs: 3000,
        allowLocalVerifiedPending: true,
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
    updateManualAgendaAppointmentResponse,
  };
}

module.exports = {
  createAgendaManualAppointmentCoordinator,
};
