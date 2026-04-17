function createAgendaConfirmationConversationHelpers(deps = {}) {
  const {
    getGeneratedAgendaAppointments = () => [],
    setGeneratedAgendaAppointmentAtIndex = () => null,
    resolveAppointmentCallId = () => '',
    normalizeString = (value) => String(value || '').trim(),
    truncateText = (value, maxLength = 500) => String(value || '').slice(0, maxLength),
    pickReadableConversationSummaryForLeadDetail = (...values) =>
      values.map((value) => String(value || '').trim()).find(Boolean) || '',
    buildCallBackedLeadDetail = async () => null,
    buildConversationSummaryForLeadDetail = async () => '',
    transcribeConfirmationTaskRecording = async () => '',
  } = deps;

  const confirmationTaskConversationPromiseByCacheKey = new Map();

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

  return {
    enrichConfirmationTaskDetailWithConversationSummary,
  };
}

module.exports = {
  createAgendaConfirmationConversationHelpers,
};
