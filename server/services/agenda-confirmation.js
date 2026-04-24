const { createAgendaConfirmationPersistenceHelpers } = require('./agenda-confirmation-persistence');
const { createAgendaConfirmationDetailHelpers } = require('./agenda-confirmation-detail');
const { createAgendaConfirmationConversationHelpers } = require('./agenda-confirmation-conversation');
const { createAgendaConfirmationMailHelpers } = require('./agenda-confirmation-mail');

function createAgendaConfirmationCoordinator(deps = {}) {
  const {
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = 'gpt-5.5',
    runtimeSyncCooldownMs = 60_000,
    aiCallInsightsByCallId = new Map(),
    getGeneratedAgendaAppointments = () => [],
    getGeneratedAppointmentIndexById = () => -1,
    setGeneratedAgendaAppointmentAtIndex = () => null,
    mapAppointmentToConfirmationTask = () => null,
    getLatestCallUpdateByCallId = () => null,
    pickReadableConversationSummaryForLeadDetail = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    getAppointmentTranscriptText = () => '',
    resolvePreferredRecordingUrl = () => '',
    sanitizeAppointmentLocation = (value) => String(value || '').trim(),
    resolveAgendaLocationValue = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    sanitizeAppointmentWhatsappInfo = (value) => String(value || '').trim(),
    resolveCallDurationSeconds = () => 0,
    normalizeString = (value) => String(value || '').trim(),
    normalizeDateYyyyMmDd = (value) => String(value || '').trim(),
    normalizeTimeHhMm = (value) => String(value || '').trim(),
    normalizeEmailAddress = (value) => String(value || '').trim().toLowerCase(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    toBooleanSafe = (value, fallback = false) =>
      value === undefined || value === null ? fallback : Boolean(value),
    resolveAppointmentCallId = () => '',
    inferCallProvider = () => '',
    refreshCallUpdateFromTwilioStatusApi = async () => null,
    refreshCallUpdateFromRetellStatusApi = async () => null,
    buildCallBackedLeadDetail = async () => null,
    buildConversationSummaryForLeadDetail = async () => '',
    buildConfirmationEmailDraftFallback = () => '',
    getOpenAiApiKey = () => '',
    fetchJsonWithTimeout = async () => ({
      response: { ok: false, status: 500 },
      data: null,
    }),
    extractOpenAiTextContent = (value) => String(value || ''),
    isSupabaseConfigured = () => false,
    getSupabaseStateHydrated = () => true,
    forceHydrateRuntimeStateWithRetries = async () => {},
    syncRuntimeStateFromSupabaseIfNewer = async () => {},
    isImapMailConfigured = () => false,
    syncInboundConfirmationEmailsFromImap = async () => ({ ok: true }),
    backfillInsightsAndAppointmentsFromRecentCallUpdates = () => {},
    isLikelyValidEmail = () => false,
    isSmtpMailConfigured = () => false,
    getMissingSmtpMailEnv = () => [],
    sendConfirmationEmailViaSmtp = async () => ({ ok: true, messageId: '' }),
    appendDashboardActivity = () => {},
    buildLeadToAgendaSummary = async (summary = '') => normalizeString(summary),
    dismissInterestedLeadIdentity = () => {},
    extractTwilioRecordingSidFromUrl = () => '',
    isTwilioStatusApiConfigured = () => false,
    fetchTwilioRecordingsByCallId = async () => ({ recordings: [] }),
    choosePreferredTwilioRecording = () => null,
    buildTwilioRecordingMediaUrl = () => '',
    fetchBinaryWithTimeout = async () => ({
      response: { ok: false, status: 500, headers: { get: () => '' } },
      bytes: Buffer.alloc(0),
    }),
    getTwilioBasicAuthorizationHeader = () => '',
    buildRecordingFileNameForTranscription = () => 'recording.mp3',
    getEffectivePublicBaseUrl = () => '',
    normalizeAbsoluteHttpUrl = (value) => String(value || '').trim(),
    getOpenAiTranscriptionModelCandidates = () => ['gpt-4o-mini-transcribe'],
    parseJsonLoose = () => null,
    buildRuntimeStateSnapshotPayload = () => null,
    applyRuntimeStateSnapshotPayload = () => false,
    waitForQueuedRuntimeSnapshotPersist = async () => true,
    invalidateSupabaseSyncTimestamp = () => {},
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
  const {
    buildConfirmationTaskDetail,
    fetchRecordingForConfirmationTaskDetail,
    transcribeConfirmationTaskRecording,
  } = createAgendaConfirmationDetailHelpers({
    openAiApiBaseUrl,
    aiCallInsightsByCallId,
    mapAppointmentToConfirmationTask,
    getLatestCallUpdateByCallId,
    pickReadableConversationSummaryForLeadDetail,
    getAppointmentTranscriptText,
    resolvePreferredRecordingUrl,
    sanitizeAppointmentLocation,
    resolveAgendaLocationValue,
    sanitizeAppointmentWhatsappInfo,
    resolveCallDurationSeconds,
    normalizeString,
    normalizeEmailAddress,
    truncateText,
    extractTwilioRecordingSidFromUrl,
    isTwilioStatusApiConfigured,
    fetchTwilioRecordingsByCallId,
    choosePreferredTwilioRecording,
    buildTwilioRecordingMediaUrl,
    fetchBinaryWithTimeout,
    getTwilioBasicAuthorizationHeader,
    buildRecordingFileNameForTranscription,
    getEffectivePublicBaseUrl,
    normalizeAbsoluteHttpUrl,
    getOpenAiApiKey,
    getOpenAiTranscriptionModelCandidates,
    parseJsonLoose,
  });
  const { enrichConfirmationTaskDetailWithConversationSummary } = createAgendaConfirmationConversationHelpers({
    getGeneratedAgendaAppointments,
    setGeneratedAgendaAppointmentAtIndex,
    resolveAppointmentCallId,
    normalizeString,
    truncateText,
    pickReadableConversationSummaryForLeadDetail,
    buildCallBackedLeadDetail,
    buildConversationSummaryForLeadDetail,
    transcribeConfirmationTaskRecording,
  });
  const { ensureConfirmationEmailDraftAtIndex, generateConfirmationEmailDraftWithAi } =
    createAgendaConfirmationMailHelpers({
      openAiApiBaseUrl,
      openAiModel,
      getGeneratedAgendaAppointments,
      setGeneratedAgendaAppointmentAtIndex,
      buildConfirmationTaskDetail,
      buildConfirmationEmailDraftFallback,
      getOpenAiApiKey,
      fetchJsonWithTimeout,
      extractOpenAiTextContent,
      normalizeString,
      normalizeDateYyyyMmDd,
      normalizeTimeHhMm,
      truncateText,
    });

  async function sendConfirmationTaskDetailResponse(req, res, taskIdRaw) {
    if (isSupabaseConfigured() && !getSupabaseStateHydrated()) {
      await forceHydrateRuntimeStateWithRetries(3);
    }
    await syncRuntimeStateFromSupabaseIfNewer({ maxAgeMs: runtimeSyncCooldownMs });
    if (isImapMailConfigured()) {
      await syncInboundConfirmationEmailsFromImap({ maxMessages: 15 });
    }
    backfillInsightsAndAppointmentsFromRecentCallUpdates();

    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }

    ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_detail_auto_draft' });
    const appointments = getGeneratedAgendaAppointments();
    const appointment = appointments[idx];
    let detail = buildConfirmationTaskDetail(appointment);
    const resolvedCallId = resolveAppointmentCallId(appointment);
    if (detail && !detail.transcriptAvailable && resolvedCallId) {
      const provider = inferCallProvider(
        resolvedCallId,
        normalizeString(detail?.provider || appointment?.provider || '')
      );
      if (provider === 'twilio') {
        await refreshCallUpdateFromTwilioStatusApi(resolvedCallId, { direction: 'outbound' });
      } else {
        await refreshCallUpdateFromRetellStatusApi(resolvedCallId);
      }
      detail = buildConfirmationTaskDetail(getGeneratedAgendaAppointments()[idx] || appointment);
    }
    if (detail) {
      detail = await enrichConfirmationTaskDetailWithConversationSummary(
        req,
        idx,
        getGeneratedAgendaAppointments()[idx] || appointment,
        detail
      );
    }
    if (!detail) {
      return res.status(404).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
    }

    return res.status(200).json({
      ok: true,
      task: detail,
    });
  }

  async function sendConfirmationTaskDraftEmailResponse(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }

    const appointments = getGeneratedAgendaAppointments();
    const appointment = appointments[idx];
    const detail = buildConfirmationTaskDetail(appointment);
    if (!detail) {
      return res.status(409).json({ ok: false, error: 'Geen open bevestigingstaak voor deze afspraak' });
    }

    try {
      const generated = await generateConfirmationEmailDraftWithAi(appointment, detail);
      const nowIso = new Date().toISOString();
      const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...getGeneratedAgendaAppointments()[idx],
          confirmationEmailDraft: generated.draft,
          confirmationEmailDraftGeneratedAt: nowIso,
          confirmationEmailDraftSource: normalizeString(generated.source || 'template'),
          confirmationEmailLastError: null,
        },
        'confirmation_task_draft_email'
      );

      appendDashboardActivity(
        {
          type: 'confirmation_mail_draft_generated',
          title: 'Bevestigingsmail concept gemaakt',
          detail: `Concept gegenereerd (${normalizeString(generated.source || 'template') || 'onbekende bron'}).`,
          company: updatedAppointment?.company || appointment?.company || '',
          actor: normalizeString(req.body?.actor || req.body?.doneBy || ''),
          taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
          callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
          source: 'premium-personeel-dashboard',
        },
        'dashboard_activity_draft_email'
      );

      return res.status(200).json({
        ok: true,
        task: buildConfirmationTaskDetail(updatedAppointment),
        generated: {
          source: normalizeString(generated.source || ''),
          model: normalizeString(generated.model || '') || null,
        },
      });
    } catch (error) {
      logger.error(
        '[ConfirmationTask][DraftEmailError]',
        JSON.stringify(
          {
            appointmentId: Number(appointment?.id) || null,
            callId: normalizeString(appointment?.callId || '') || null,
            message: error?.message || 'Onbekende fout',
            status: Number(error?.status || 0) || null,
          },
          null,
          2
        )
      );

      return res.status(500).json({
        ok: false,
        error: 'Kon geen bevestigingsmail opstellen.',
        detail: normalizeString(error?.message || '') || null,
      });
    }
  }

  async function sendConfirmationTaskEmailResponse(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    ensureConfirmationEmailDraftAtIndex(idx, { reason: 'confirmation_task_send_auto_draft' });
    const appointments = getGeneratedAgendaAppointments();
    const appointment = appointments[idx];
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const recipientEmail = normalizeEmailAddress(
      req.body?.recipientEmail || req.body?.email || appointment?.contactEmail || appointment?.email || ''
    );
    if (!isLikelyValidEmail(recipientEmail)) {
      return res.status(400).json({
        ok: false,
        error: 'Vul een geldig ontvanger e-mailadres in.',
        code: 'INVALID_RECIPIENT_EMAIL',
      });
    }

    if (!isSmtpMailConfigured()) {
      return res.status(503).json({
        ok: false,
        error: 'Mail verzending is nog niet geconfigureerd op de server (SMTP ontbreekt).',
        code: 'SMTP_NOT_CONFIGURED',
        missingEnv: getMissingSmtpMailEnv(),
      });
    }

    try {
      const delivery = await sendConfirmationEmailViaSmtp({
        appointment,
        recipientEmail,
        draftText: normalizeString(appointment?.confirmationEmailDraft || ''),
      });

      const nowIso = new Date().toISOString();
      const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          contactEmail: recipientEmail,
          confirmationEmailSent: true,
          confirmationEmailSentAt: nowIso,
          confirmationEmailSentBy: actor || null,
          confirmationEmailLastError: null,
          confirmationEmailLastSentMessageId: normalizeString(delivery?.messageId || '') || null,
        },
        'confirmation_task_send_email'
      );

      appendDashboardActivity(
        {
          type: 'confirmation_mail_sent',
          title: 'Bevestigingsmail verstuurd',
          detail: `E-mail verstuurd naar ${recipientEmail} via SMTP.`,
          company: updatedAppointment?.company || appointment?.company || '',
          actor,
          taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
          callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
          source: 'premium-personeel-dashboard',
        },
        'dashboard_activity_send_email'
      );

      return res.status(200).json({
        ok: true,
        sent: true,
        task: buildConfirmationTaskDetail(updatedAppointment),
        delivery,
      });
    } catch (error) {
      logger.error(
        '[ConfirmationTask][SendEmailError]',
        JSON.stringify(
          {
            appointmentId: Number(appointment?.id) || null,
            callId: normalizeString(appointment?.callId || '') || null,
            recipientEmail,
            code: normalizeString(error?.code || ''),
            message: error?.message || 'Onbekende fout',
          },
          null,
          2
        )
      );

      const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
        idx,
        {
          ...appointment,
          contactEmail: recipientEmail || normalizeEmailAddress(appointment?.contactEmail || '') || null,
          confirmationEmailLastError: truncateText(
            normalizeString(error?.message || 'Bevestigingsmail verzenden mislukt.'),
            500
          ),
        },
        'confirmation_task_send_email_error'
      );

      return res.status(500).json({
        ok: false,
        error: 'Bevestigingsmail verzenden mislukt.',
        detail: normalizeString(error?.message || '') || null,
        code: normalizeString(error?.code || '') || null,
        task: updatedAppointment ? buildConfirmationTaskDetail(updatedAppointment) : null,
      });
    }
  }

  function markConfirmationTaskSentById(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }
    const appointment = getGeneratedAgendaAppointments()[idx];
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailSent: true,
        confirmationEmailSentAt: nowIso,
        confirmationEmailSentBy: actor || null,
      },
      'confirmation_task_mark_sent'
    );

    appendDashboardActivity(
      {
        type: 'confirmation_mail_sent',
        title: 'Bevestigingsmail verstuurd',
        detail: 'Bevestigingsmail is als verstuurd gemarkeerd in het personeel dashboard.',
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_mark_sent'
    );

    return res.status(200).json({
      ok: true,
      taskUpdated: true,
      task: buildConfirmationTaskDetail(updatedAppointment),
    });
  }

  async function setLeadTaskInAgendaById(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const appointmentDate = normalizeDateYyyyMmDd(
      req.body?.appointmentDate || req.body?.date || appointment?.date || ''
    );
    const appointmentTime = normalizeTimeHhMm(
      req.body?.appointmentTime || req.body?.time || appointment?.time || ''
    );
    const location = sanitizeAppointmentLocation(
      req.body?.location || req.body?.appointmentLocation || ''
    );
    const whatsappInfo = sanitizeAppointmentWhatsappInfo(
      req.body?.whatsappInfo ||
        req.body?.whatsappNotes ||
        req.body?.notes ||
        appointment?.whatsappInfo ||
        ''
    );
    const whatsappConfirmed = toBooleanSafe(
      req.body?.whatsappConfirmed,
      toBooleanSafe(appointment?.whatsappConfirmed, false)
    );

    if (!appointmentDate) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige datum in (YYYY-MM-DD).' });
    }
    if (!appointmentTime) {
      return res.status(400).json({ ok: false, error: 'Vul een geldige tijd in (HH:MM).' });
    }
    if (!location) {
      return res.status(400).json({ ok: false, error: 'Vul een locatie in.' });
    }

    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const nowIso = new Date().toISOString();
    const mergedSummary = await buildLeadToAgendaSummary(
      req.body?.summary || appointment?.summary,
      location,
      whatsappInfo,
      { whatsappConfirmed }
    );
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
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
        confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor || null,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'confirmation_task_set_in_agenda'
    );
    dismissInterestedLeadIdentity(
      normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
      updatedAppointment || appointment || {},
      'confirmation_task_set_in_agenda_dismiss'
    );

    appendDashboardActivity(
      {
        type: 'lead_set_in_agenda',
        title: 'Lead in agenda gezet',
        detail: `Lead handmatig ingepland op ${appointmentDate} om ${appointmentTime}${
          location ? ` (${location})` : ''
        }.`,
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-ai-lead-generator',
      },
      'dashboard_activity_lead_set_in_agenda'
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

  function markConfirmationTaskResponseReceivedById(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }
    const appointment = getGeneratedAgendaAppointments()[idx];
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor || null,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'confirmation_task_mark_response_received'
    );

    appendDashboardActivity(
      {
        type: 'appointment_confirmed_by_mail',
        title: 'Afspraak bevestigd per mail',
        detail: 'De klant heeft de afspraak per mail bevestigd.',
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_mark_response_received'
    );

    return res.status(200).json({
      ok: true,
      taskCompleted: true,
      appointment: updatedAppointment,
    });
  }

  async function markLeadTaskCancelledById(req, res, taskIdRaw) {
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }
    const appointment = getGeneratedAgendaAppointments()[idx];
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const callId = normalizeString(appointment?.callId || '');
    const runtimeSnapshot = takeRuntimeMutationSnapshot();
    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailSent: true,
        confirmationEmailSentAt: normalizeString(appointment?.confirmationEmailSentAt || '') || nowIso,
        confirmationEmailSentBy: normalizeString(appointment?.confirmationEmailSentBy || '') || actor || null,
        confirmationResponseReceived: false,
        confirmationResponseReceivedAt: null,
        confirmationResponseReceivedBy: null,
        confirmationAppointmentCancelled: true,
        confirmationAppointmentCancelledAt: nowIso,
        confirmationAppointmentCancelledBy: actor || null,
      },
      'confirmation_task_mark_cancelled'
    );
    dismissInterestedLeadIdentity(
      normalizeString(updatedAppointment?.callId || callId || ''),
      updatedAppointment || appointment || {},
      'confirmation_task_mark_cancelled_dismiss'
    );

    appendDashboardActivity(
      {
        type: 'appointment_cancelled',
        title: 'Afspraak geannuleerd',
        detail: 'Afspraak is geannuleerd vanuit het bevestigingsmailproces.',
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_mark_cancelled'
    );

    const persistOk = await ensureLeadMutationPersistedOrRespond(
      res,
      runtimeSnapshot,
      'Leadverwijdering kon niet veilig in gedeelde opslag worden opgeslagen.'
    );
    if (!persistOk) return res;

    return res.status(200).json({
      ok: true,
      taskCompleted: true,
      cancelled: true,
      appointment: updatedAppointment,
    });
  }

  function completeConfirmationTaskById(req, res, taskIdRaw) {
    const taskId = Number(taskIdRaw);
    const idx = getGeneratedAppointmentIndexById(taskIdRaw);
    if (idx < 0) {
      return res.status(404).json({ ok: false, error: 'Taak of afspraak niet gevonden' });
    }

    const appointment = getGeneratedAgendaAppointments()[idx];
    if (!mapAppointmentToConfirmationTask(appointment)) {
      return res.status(409).json({ ok: false, error: 'Taak is al afgerond of niet beschikbaar' });
    }

    const actor = normalizeString(req.body?.actor || req.body?.doneBy || '');
    const nowIso = new Date().toISOString();
    const updatedAppointment = setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailSent: true,
        confirmationEmailSentAt: nowIso,
        confirmationEmailSentBy: actor || null,
        confirmationResponseReceived: true,
        confirmationResponseReceivedAt: nowIso,
        confirmationResponseReceivedBy: actor || null,
        confirmationAppointmentCancelled: false,
        confirmationAppointmentCancelledAt: null,
        confirmationAppointmentCancelledBy: null,
      },
      'confirmation_task_complete'
    );

    appendDashboardActivity(
      {
        type: 'confirmation_task_completed',
        title: 'Bevestigingstaak afgerond',
        detail: 'Bevestigingsmail + bevestiging ontvangen via snelle complete-route.',
        company: updatedAppointment?.company || appointment?.company || '',
        actor,
        taskId: Number(updatedAppointment?.id || appointment?.id || 0) || null,
        callId: normalizeString(updatedAppointment?.callId || appointment?.callId || ''),
        source: 'premium-personeel-dashboard',
      },
      'dashboard_activity_complete_task'
    );

    return res.status(200).json({
      ok: true,
      taskCompleted: true,
      taskId,
      appointment: updatedAppointment,
    });
  }

  return {
    ensureConfirmationEmailDraftAtIndex,
    sendConfirmationTaskDetailResponse,
    sendConfirmationTaskDraftEmailResponse,
    sendConfirmationTaskEmailResponse,
    markConfirmationTaskSentById,
    setLeadTaskInAgendaById,
    markConfirmationTaskResponseReceivedById,
    markLeadTaskCancelledById,
    completeConfirmationTaskById,
  };
}

module.exports = {
  createAgendaConfirmationCoordinator,
};
