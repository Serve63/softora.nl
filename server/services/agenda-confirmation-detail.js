function createAgendaConfirmationDetailHelpers(deps = {}) {
  const {
    openAiApiBaseUrl = 'https://api.openai.com/v1',
    aiCallInsightsByCallId = new Map(),
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
    normalizeEmailAddress = (value) => String(value || '').trim().toLowerCase(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
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
    getOpenAiApiKey = () => '',
    getOpenAiTranscriptionModelCandidates = () => ['gpt-4o-mini-transcribe'],
    parseJsonLoose = () => null,
  } = deps;

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

  return {
    buildConfirmationTaskDetail,
    fetchRecordingForConfirmationTaskDetail,
    transcribeConfirmationTaskRecording,
  };
}

module.exports = {
  createAgendaConfirmationDetailHelpers,
};
