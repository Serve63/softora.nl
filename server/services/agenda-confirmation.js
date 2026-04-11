function createAgendaConfirmationCoordinator(deps = {}) {
  const {
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    openAiModel = 'gpt-4o-mini',
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
    logger = console,
  } = deps;

  const confirmationTaskConversationPromiseByCacheKey = new Map();

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

  function buildConfirmationTaskDetail(appointment) {
    const task = mapAppointmentToConfirmationTask(appointment);
    if (!task) return null;

    const callUpdate = getLatestCallUpdateByCallId(task.callId);
    const aiInsight = task.callId ? aiCallInsightsByCallId.get(task.callId) || null : null;
    const storedConversationSummary = pickReadableConversationSummaryForLeadDetail(
      appointment?.leadConversationSummary || ''
    );
    const transcript = getAppointmentTranscriptText(appointment) || '';
    const recordingUrl = resolvePreferredRecordingUrl(callUpdate, appointment);
    const fullSummary = truncateText(
      normalizeString(appointment?.summary || callUpdate?.summary || aiInsight?.summary || task?.summary || ''),
      4000
    );
    const resolvedLocation = resolveAgendaLocationValue(
      sanitizeAppointmentLocation(appointment?.location || appointment?.appointmentLocation || ''),
      fullSummary,
      appointment?.whatsappInfo || appointment?.whatsappNotes || appointment?.whatsapp || '',
      callUpdate?.summary || '',
      callUpdate?.transcriptSnippet || '',
      transcript
    );

    return {
      ...task,
      appointmentSummary: fullSummary || task.summary || '',
      conversationSummary: storedConversationSummary || '',
      summary: fullSummary || task.summary || '',
      contactEmail: normalizeEmailAddress(appointment?.contactEmail || appointment?.email || '') || '',
      location: resolvedLocation || '',
      whatsappInfo: sanitizeAppointmentWhatsappInfo(
        appointment?.whatsappInfo || appointment?.whatsappNotes || appointment?.whatsapp || ''
      ),
      durationSeconds: resolveCallDurationSeconds(appointment, callUpdate, aiInsight),
      transcript,
      transcriptAvailable: Boolean(transcript),
      recordingUrl,
      recordingUrlAvailable: Boolean(recordingUrl),
      callSummary: normalizeString(callUpdate?.summary || ''),
      transcriptSnippet: normalizeString(callUpdate?.transcriptSnippet || ''),
      aiSummary: normalizeString(aiInsight?.summary || ''),
      confirmationEmailDraft: normalizeString(appointment?.confirmationEmailDraft || ''),
      confirmationEmailDraftGeneratedAt:
        normalizeString(appointment?.confirmationEmailDraftGeneratedAt || '') || null,
      confirmationEmailDraftSource:
        normalizeString(appointment?.confirmationEmailDraftSource || '') || null,
      confirmationEmailLastError: normalizeString(appointment?.confirmationEmailLastError || '') || null,
      confirmationEmailLastSentMessageId:
        normalizeString(appointment?.confirmationEmailLastSentMessageId || '') || null,
      rawStatus: {
        callStatus: normalizeString(callUpdate?.status || ''),
        callMessageType: normalizeString(callUpdate?.messageType || ''),
        endedReason: normalizeString(callUpdate?.endedReason || ''),
      },
    };
  }

  async function fetchRecordingForConfirmationTaskDetail(req, appointment, detail, resolvedCallId = '') {
    const normalizedCallId = normalizeString(resolvedCallId || detail?.callId || appointment?.callId || '');
    const provider = normalizeString(detail?.provider || appointment?.provider || '').toLowerCase();
    const recordingUrl = resolvePreferredRecordingUrl(
      detail,
      appointment,
      normalizedCallId ? { callId: normalizedCallId, provider } : null
    );
    if (!recordingUrl) return null;

    let recordingSid =
      normalizeString(
        detail?.recordingSid ||
          detail?.recording_sid ||
          appointment?.recordingSid ||
          appointment?.recording_sid ||
          ''
      ) || extractTwilioRecordingSidFromUrl(recordingUrl);
    const hasTwilioProxyReference = /\/api\/coldcalling\/recording-proxy/i.test(recordingUrl);

    if ((provider === 'twilio' || recordingSid || hasTwilioProxyReference) && isTwilioStatusApiConfigured()) {
      try {
        if (!recordingSid && normalizedCallId) {
          const { recordings } = await fetchTwilioRecordingsByCallId(normalizedCallId);
          const preferred = choosePreferredTwilioRecording(recordings);
          recordingSid = normalizeString(preferred?.sid || '');
        }

        if (recordingSid) {
          const mediaUrl = buildTwilioRecordingMediaUrl(recordingSid);
          if (mediaUrl) {
            const { response, bytes } = await fetchBinaryWithTimeout(
              mediaUrl,
              {
                method: 'GET',
                headers: {
                  Authorization: getTwilioBasicAuthorizationHeader(),
                },
              },
              30000
            );

            if (!response.ok) {
              const err = new Error(`Twilio opname ophalen mislukt (${response.status}).`);
              err.status = response.status;
              throw err;
            }

            const contentType = normalizeString(response.headers.get('content-type') || '') || 'audio/mpeg';
            return {
              bytes,
              contentType,
              sourceUrl: mediaUrl.toString(),
              fileName: buildRecordingFileNameForTranscription(
                normalizedCallId || recordingSid || `task-${Number(appointment?.id || detail?.id || 0) || 'call'}`,
                contentType,
                mediaUrl.toString()
              ),
            };
          }
        }
      } catch (_error) {
        // Fall through to non-Twilio URL fetching.
      }
    }

    const baseUrl = getEffectivePublicBaseUrl(req);
    const absoluteRecordingUrl =
      normalizeAbsoluteHttpUrl(recordingUrl) ||
      (recordingUrl.startsWith('/') && baseUrl ? new URL(recordingUrl, baseUrl).toString() : '');
    if (!absoluteRecordingUrl) return null;

    const { response, bytes } = await fetchBinaryWithTimeout(
      absoluteRecordingUrl,
      {
        method: 'GET',
      },
      30000
    );
    if (!response.ok) {
      const err = new Error(`Opname ophalen mislukt (${response.status}).`);
      err.status = response.status;
      throw err;
    }

    const contentType = normalizeString(response.headers.get('content-type') || '') || 'audio/mpeg';
    return {
      bytes,
      contentType,
      sourceUrl: absoluteRecordingUrl,
      fileName: buildRecordingFileNameForTranscription(
        normalizedCallId || `task-${Number(appointment?.id || detail?.id || 0) || 'call'}`,
        contentType,
        absoluteRecordingUrl
      ),
    };
  }

  async function transcribeConfirmationTaskRecording(req, appointment, detail, resolvedCallId = '') {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) return '';

    const recording = await fetchRecordingForConfirmationTaskDetail(req, appointment, detail, resolvedCallId);
    if (!recording?.bytes || recording.bytes.length === 0) return '';
    if (recording.bytes.length > 24 * 1024 * 1024) {
      throw new Error('Opname is te groot om direct te transcriberen.');
    }

    const sourceKey =
      normalizeString(resolvedCallId || detail?.callId || appointment?.callId || '') ||
      `task-${Number(appointment?.id || detail?.id || 0) || 'call'}`;
    const models = getOpenAiTranscriptionModelCandidates();
    let lastError = null;

    for (const model of models) {
      try {
        const form = new FormData();
        form.append(
          'file',
          new Blob([recording.bytes], { type: recording.contentType || 'audio/mpeg' }),
          recording.fileName ||
            buildRecordingFileNameForTranscription(sourceKey, recording.contentType, recording.sourceUrl)
        );
        form.append('model', model);
        form.append('language', 'nl');
        form.append('temperature', '0');
        form.append('response_format', 'text');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);

        try {
          const response = await fetch(`${openAiApiBaseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: form,
            signal: controller.signal,
          });

          const rawBody = await response.text();
          if (!response.ok) {
            const err = new Error(`OpenAI transcriptie mislukt (${response.status})`);
            err.status = response.status;
            err.data = parseJsonLoose(rawBody) || rawBody;
            throw err;
          }

          const parsed = parseJsonLoose(rawBody);
          const transcriptText =
            normalizeString(parsed?.text || parsed?.transcript || parsed?.output_text || '') ||
            normalizeString(rawBody);
          if (transcriptText) {
            return truncateText(transcriptText, 9000);
          }
        } finally {
          clearTimeout(timeout);
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    return '';
  }

  async function enrichConfirmationTaskDetailWithConversationSummary(req, idx, appointment, detail) {
    if (!appointment || !detail) return detail;

    const resolvedCallId = normalizeString(detail?.callId || resolveAppointmentCallId(appointment));
    const cacheKey = resolvedCallId || `task:${Number(appointment?.id || detail?.id || idx || 0)}`;
    if (!cacheKey) return detail;

    const existingConversationSummary = pickReadableConversationSummaryForLeadDetail(
      detail?.conversationSummary,
      appointment?.leadConversationSummary
    );
    const existingTranscript = normalizeString(detail?.transcript || appointment?.leadConversationTranscript || '');
    if (existingConversationSummary && (existingTranscript || detail?.recordingUrlAvailable)) {
      return {
        ...detail,
        callId: resolvedCallId || normalizeString(detail?.callId || ''),
        conversationSummary: existingConversationSummary,
        summary: existingConversationSummary,
        transcript: truncateText(existingTranscript, 9000),
        transcriptAvailable: Boolean(existingTranscript),
      };
    }

    const existingPromise = confirmationTaskConversationPromiseByCacheKey.get(cacheKey);
    if (existingPromise) return existingPromise;

    const run = (async () => {
      let callBackedDetail = null;
      if (resolvedCallId) {
        try {
          callBackedDetail = await buildCallBackedLeadDetail(resolvedCallId);
        } catch (_error) {
          callBackedDetail = null;
        }
      }

      const recordingUrl = normalizeString(
        callBackedDetail?.recordingUrl || detail?.recordingUrl || detail?.recording_url || ''
      );
      let transcript = normalizeString(
        appointment?.leadConversationTranscript || callBackedDetail?.transcript || detail?.transcript || ''
      );

      if (!transcript && recordingUrl) {
        try {
          transcript = await transcribeConfirmationTaskRecording(
            req,
            appointment,
            { ...detail, recordingUrl },
            resolvedCallId
          );
        } catch (_error) {
          transcript = '';
        }
      }

      let conversationSummary = pickReadableConversationSummaryForLeadDetail(
        appointment?.leadConversationSummary,
        callBackedDetail?.summary,
        callBackedDetail?.callSummary,
        callBackedDetail?.aiSummary,
        detail?.conversationSummary,
        detail?.callSummary,
        detail?.aiSummary,
        detail?.transcriptSnippet,
        detail?.summary,
        transcript
      );

      if (
        !conversationSummary &&
        (transcript ||
          callBackedDetail ||
          detail?.callSummary ||
          detail?.aiSummary ||
          detail?.summary ||
          appointment?.summary)
      ) {
        conversationSummary = await buildConversationSummaryForLeadDetail(
          {
            summary: normalizeString(
              callBackedDetail?.callSummary || detail?.callSummary || detail?.summary || appointment?.summary || ''
            ),
            transcriptSnippet: normalizeString(
              callBackedDetail?.transcriptSnippet || detail?.transcriptSnippet || transcript
            ),
          },
          {
            summary: normalizeString(callBackedDetail?.aiSummary || detail?.aiSummary || ''),
            followUpReason: normalizeString(
              callBackedDetail?.followUpReason || detail?.whatsappInfo || appointment?.whatsappInfo || ''
            ),
          },
          {
            summary: normalizeString(appointment?.leadConversationSummary || ''),
            whatsappInfo: normalizeString(detail?.whatsappInfo || appointment?.whatsappInfo || ''),
          },
          transcript
        );
      }

      const normalizedConversationSummary = normalizeString(conversationSummary || '');
      const normalizedTranscript = normalizeString(transcript || detail?.transcript || '');
      const mergedDetail = {
        ...detail,
        callId: resolvedCallId || normalizeString(callBackedDetail?.callId || detail?.callId || ''),
        conversationSummary: normalizedConversationSummary,
        summary: normalizedConversationSummary || normalizeString(detail?.summary || ''),
        transcript: truncateText(normalizedTranscript, 9000),
        transcriptAvailable: Boolean(normalizedTranscript),
        transcriptSnippet: truncateText(
          normalizeString(callBackedDetail?.transcriptSnippet || detail?.transcriptSnippet || normalizedTranscript),
          1200
        ),
        callSummary: normalizeString(callBackedDetail?.callSummary || detail?.callSummary || ''),
        aiSummary: normalizeString(callBackedDetail?.aiSummary || detail?.aiSummary || ''),
        followUpReason: normalizeString(
          callBackedDetail?.followUpReason || detail?.followUpReason || appointment?.whatsappInfo || ''
        ),
        recordingUrl: recordingUrl || normalizeString(detail?.recordingUrl || ''),
        recordingUrlAvailable: Boolean(recordingUrl || normalizeString(detail?.recordingUrl || '')),
      };

      const appointments = getGeneratedAgendaAppointments();
      if (
        idx >= 0 &&
        idx < appointments.length &&
        (normalizedConversationSummary || normalizedTranscript || mergedDetail.callId || mergedDetail.recordingUrl)
      ) {
        const previousAppointment = appointments[idx] || appointment;
        setGeneratedAgendaAppointmentAtIndex(
          idx,
          {
            ...previousAppointment,
            callId: normalizeString(mergedDetail.callId || previousAppointment?.callId || ''),
            recordingUrl: normalizeString(mergedDetail.recordingUrl || previousAppointment?.recordingUrl || ''),
            leadConversationSummary:
              normalizedConversationSummary || normalizeString(previousAppointment?.leadConversationSummary || ''),
            leadConversationTranscript:
              normalizedTranscript || normalizeString(previousAppointment?.leadConversationTranscript || ''),
            leadConversationUpdatedAt: new Date().toISOString(),
          },
          'confirmation_task_conversation_materialized'
        );
      }

      return mergedDetail;
    })().finally(() => {
      confirmationTaskConversationPromiseByCacheKey.delete(cacheKey);
    });

    confirmationTaskConversationPromiseByCacheKey.set(cacheKey, run);
    return run;
  }

  function ensureConfirmationEmailDraftAtIndex(idx, options = {}) {
    const appointments = getGeneratedAgendaAppointments();
    if (!Number.isInteger(idx) || idx < 0 || idx >= appointments.length) return null;
    const appointment = appointments[idx];
    if (!appointment || typeof appointment !== 'object') return null;
    if (normalizeString(appointment?.confirmationEmailDraft || '')) return appointment;

    const detail = buildConfirmationTaskDetail(appointment) || {};
    const fallbackDraft = buildConfirmationEmailDraftFallback(appointment, detail);
    const nowIso = new Date().toISOString();
    return setGeneratedAgendaAppointmentAtIndex(
      idx,
      {
        ...appointment,
        confirmationEmailDraft: fallbackDraft,
        confirmationEmailDraftGeneratedAt:
          normalizeString(appointment?.confirmationEmailDraftGeneratedAt || '') || nowIso,
        confirmationEmailDraftSource:
          normalizeString(appointment?.confirmationEmailDraftSource || '') || 'template-auto',
      },
      normalizeString(options.reason || 'confirmation_task_auto_draft')
    );
  }

  async function generateConfirmationEmailDraftWithAi(appointment, detail = {}) {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      return {
        draft: buildConfirmationEmailDraftFallback(appointment, detail),
        source: 'template',
        model: null,
      };
    }

    const payload = {
      timezone: 'Europe/Amsterdam',
      appointment: {
        company: normalizeString(appointment?.company || ''),
        contact: normalizeString(appointment?.contact || ''),
        phone: normalizeString(appointment?.phone || ''),
        date: normalizeDateYyyyMmDd(appointment?.date),
        time: normalizeTimeHhMm(appointment?.time),
        source: normalizeString(appointment?.source || ''),
        branche: normalizeString(appointment?.branche || ''),
        value: normalizeString(appointment?.value || ''),
      },
      context: {
        aiSummary: truncateText(normalizeString(detail?.aiSummary || ''), 1000),
        callSummary: truncateText(normalizeString(detail?.callSummary || ''), 1000),
        transcriptSnippet: truncateText(normalizeString(detail?.transcriptSnippet || ''), 1200),
        transcript: truncateText(normalizeString(detail?.transcript || ''), 4000),
      },
    };

    const systemPrompt = [
      'Je bent een Nederlandse sales assistent.',
      'Schrijf een professionele maar korte bevestigingsmail na een telefonisch gesprek.',
      'Doel: afspraak bevestigen en de klant vragen om per mail te bevestigen dat tijd/datum klopt.',
      'Gebruik Nederlands.',
      'Geef alleen de emailtekst terug (met onderwerpregel bovenaan), geen markdown.',
      'Wees concreet over datum/tijd als aanwezig.',
      'Maximaal ongeveer 220 woorden.',
    ].join('\n');

    const { response, data } = await fetchJsonWithTimeout(
      `${openAiApiBaseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: openAiModel,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(payload) },
          ],
        }),
      },
      25000
    );

    if (!response.ok) {
      const err = new Error(`OpenAI bevestigingsmail generatie mislukt (${response.status})`);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    const content = data?.choices?.[0]?.message?.content;
    const text = extractOpenAiTextContent(content);
    const draft = normalizeString(text);
    if (!draft) {
      return {
        draft: buildConfirmationEmailDraftFallback(appointment, detail),
        source: 'template-fallback-empty',
        model: null,
      };
    }

    return {
      draft: truncateText(draft, 5000),
      source: 'openai',
      model: openAiModel,
    };
  }

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

    const persistFailureMessage = await ensureLeadMutationPersisted(
      runtimeSnapshot,
      'Leadverwijdering kon niet veilig in gedeelde opslag worden opgeslagen.'
    );
    if (persistFailureMessage !== true) {
      return res.status(503).json({ ok: false, error: persistFailureMessage });
    }

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
