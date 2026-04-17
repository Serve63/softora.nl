function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function createCallUpdateRuntime(deps = {}) {
  const {
    normalizeString = defaultNormalizeString,
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    normalizeLeadLikePhoneKey = () => '',
    extractCallIdFromRecordingUrl = () => '',
    extractTwilioRecordingSidFromUrl = () => '',
    normalizeRecordingReference = (value) => normalizeString(value),
    getLatestCallUpdateByCallId = () => null,
    getRuntimeSnapshotItemTimestampMs = (item = {}) => {
      const explicitMs = Number(item?.updatedAtMs || 0);
      if (Number.isFinite(explicitMs) && explicitMs > 0) return explicitMs;

      const candidateFields = [
        item?.updatedAt,
        item?.analyzedAt,
        item?.receivedAt,
        item?.endedAt,
        item?.startedAt,
        item?.confirmationEmailSentAt,
        item?.confirmationResponseReceivedAt,
        item?.confirmationAppointmentCancelledAt,
        item?.postCallUpdatedAt,
        item?.createdAt,
      ];

      for (const candidate of candidateFields) {
        const parsedMs = Date.parse(normalizeString(candidate || ''));
        if (Number.isFinite(parsedMs) && parsedMs > 0) return parsedMs;
      }

      return 0;
    },
    recentCallUpdates = [],
    callUpdatesById = new Map(),
    recentAiCallInsights = [],
    generatedAgendaAppointments = [],
    inferCallProvider = (_callId, fallbackProvider = 'retell') => fallbackProvider,
    fetchRetellCallStatusById = async () => ({ data: null }),
    fetchTwilioCallStatusById = async () => ({ data: null }),
    extractCallUpdateFromRetellCallStatusResponse = () => null,
    extractCallUpdateFromTwilioCallStatusResponse = () => null,
    upsertRecentCallUpdate = () => null,
    isTwilioStatusApiConfigured = () => false,
    hasRetellApiKey = () => false,
    isTerminalColdcallingStatus = () => false,
    retellCallStatusRefreshByCallId = new Map(),
    retellStatusRefreshCooldownMs = 8000,
    logger = console,
  } = deps;

  function logWarning(...args) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(...args);
    }
  }

  function findCallUpdateByRecordingReference(...sources) {
    const directCallIds = [];
    const recordingSids = [];
    const recordingRefs = [];
    const phoneKeys = [];
    const timestamps = [];

    (Array.isArray(sources) ? sources : []).forEach((source) => {
      if (!source || typeof source !== 'object') return;
      const directCallId =
        normalizeString(
          source.callId || source.call_id || source.sourceCallId || source.source_call_id || ''
        ) ||
        extractCallIdFromRecordingUrl(
          source.recordingUrl ||
            source.recording_url ||
            source.recordingUrlProxy ||
            source.audioUrl ||
            source.audio_url ||
            ''
        );
      if (directCallId) directCallIds.push(directCallId);

      const recordingSid =
        normalizeString(source.recordingSid || source.recording_sid || '') ||
        extractTwilioRecordingSidFromUrl(
          source.recordingUrl ||
            source.recording_url ||
            source.recordingUrlProxy ||
            source.audioUrl ||
            source.audio_url ||
            ''
        );
      if (recordingSid) recordingSids.push(recordingSid);

      [
        source.recordingUrl,
        source.recording_url,
        source.recordingUrlProxy,
        source.audioUrl,
        source.audio_url,
      ].forEach((candidate) => {
        const normalizedRef = normalizeRecordingReference(candidate);
        if (normalizedRef) recordingRefs.push(normalizedRef);
      });

      const phoneKey = normalizeLeadLikePhoneKey(
        source.phone || source.phoneNumber || source.phone_number || ''
      );
      if (phoneKey) phoneKeys.push(phoneKey);

      [
        source.updatedAt,
        source.createdAt,
        source.confirmationTaskCreatedAt,
        source.startedAt,
        source.endedAt,
        source.date && source.time ? `${source.date}T${source.time}:00` : source.date,
      ].forEach((candidate) => {
        const parsed = Date.parse(normalizeString(candidate || ''));
        if (Number.isFinite(parsed) && parsed > 0) timestamps.push(parsed);
      });
    });

    for (const callId of directCallIds) {
      const matched = getLatestCallUpdateByCallId(callId);
      if (matched) return matched;
    }

    const recordingSidSet = new Set(recordingSids.filter(Boolean));
    if (recordingSidSet.size > 0) {
      for (const candidate of recentCallUpdates) {
        const candidateSid =
          normalizeString(candidate?.recordingSid || candidate?.recording_sid || '') ||
          extractTwilioRecordingSidFromUrl(
            candidate?.recordingUrl || candidate?.recording_url || candidate?.recordingUrlProxy || ''
          );
        if (candidateSid && recordingSidSet.has(candidateSid)) return candidate;
      }
    }

    const recordingRefSet = new Set(recordingRefs.filter(Boolean));
    if (recordingRefSet.size > 0) {
      for (const candidate of recentCallUpdates) {
        const candidateRefs = [
          candidate?.recordingUrl,
          candidate?.recording_url,
          candidate?.recordingUrlProxy,
          candidate?.audioUrl,
          candidate?.audio_url,
        ]
          .map((value) => normalizeRecordingReference(value))
          .filter(Boolean);
        if (candidateRefs.some((ref) => recordingRefSet.has(ref))) return candidate;
      }
    }

    const phoneKeySet = new Set(phoneKeys.filter(Boolean));
    if (phoneKeySet.size === 0) return null;

    const targetTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
    let best = null;
    let bestScore = -Infinity;

    for (const candidate of recentCallUpdates) {
      const candidatePhoneKey = normalizeLeadLikePhoneKey(candidate?.phone || '');
      if (!candidatePhoneKey || !phoneKeySet.has(candidatePhoneKey)) continue;

      const candidateHasRecording = Boolean(
        normalizeString(
          candidate?.recordingUrl || candidate?.recording_url || candidate?.recordingUrlProxy || ''
        )
      );
      const candidateTs = getRuntimeSnapshotItemTimestampMs(candidate);
      const distancePenalty =
        targetTs > 0 && candidateTs > 0
          ? Math.min(10_000_000, Math.abs(candidateTs - targetTs)) / 1000
          : 3600;
      const score = (candidateHasRecording ? 100000 : 0) - distancePenalty;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    return best;
  }

  function resolveAppointmentCallId(appointment) {
    const direct = normalizeString(
      appointment?.callId ||
        appointment?.call_id ||
        appointment?.sourceCallId ||
        appointment?.source_call_id ||
        ''
    );
    if (direct) return direct;

    const fromRecordingUrl = extractCallIdFromRecordingUrl(
      appointment?.recordingUrl ||
        appointment?.recording_url ||
        appointment?.recordingUrlProxy ||
        appointment?.audioUrl ||
        appointment?.audio_url ||
        ''
    );
    if (fromRecordingUrl) return fromRecordingUrl;

    const matchedUpdate = findCallUpdateByRecordingReference(appointment);
    return normalizeString(matchedUpdate?.callId || '');
  }

  async function refreshCallUpdateFromRetellStatusApi(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;
    if (!hasRetellApiKey()) return null;

    try {
      const { data } = await fetchRetellCallStatusById(normalizedCallId);
      const update = extractCallUpdateFromRetellCallStatusResponse(normalizedCallId, data);
      if (!update) return null;
      return upsertRecentCallUpdate(update);
    } catch (error) {
      logWarning(
        '[Retell Call Status Refresh Failed]',
        JSON.stringify(
          {
            callId: normalizedCallId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
          },
          null,
          2
        )
      );
      return null;
    }
  }

  async function refreshCallUpdateFromTwilioStatusApi(callId, options = {}) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) return null;
    if (!isTwilioStatusApiConfigured()) return null;

    try {
      const { data } = await fetchTwilioCallStatusById(normalizedCallId);
      const update = extractCallUpdateFromTwilioCallStatusResponse(normalizedCallId, data, options);
      if (!update) return null;
      return upsertRecentCallUpdate(update);
    } catch (error) {
      logWarning(
        '[Twilio Call Status Refresh Failed]',
        JSON.stringify(
          {
            callId: normalizedCallId,
            message: error?.message || 'Onbekende fout',
            status: error?.status || null,
          },
          null,
          2
        )
      );
      return null;
    }
  }

  function shouldRefreshRetellCallStatus(update, nowMs = Date.now()) {
    const callId = normalizeString(update?.callId || '');
    if (!callId) return false;

    const provider = inferCallProvider(
      callId,
      normalizeString(update?.provider || 'retell').toLowerCase() || 'retell'
    );
    if (provider !== 'retell' && provider !== 'twilio') return false;

    const status = normalizeString(update?.status || '').toLowerCase();
    const endedReason = normalizeString(update?.endedReason || '');
    if (isTerminalColdcallingStatus(status, endedReason)) {
      retellCallStatusRefreshByCallId.delete(callId);
      return false;
    }

    const updatedAtMs = Number(update?.updatedAtMs || 0);
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0 && nowMs - updatedAtMs < 2500) {
      return false;
    }

    const lastRefreshMs = Number(retellCallStatusRefreshByCallId.get(callId) || 0);
    if (
      Number.isFinite(lastRefreshMs) &&
      nowMs - lastRefreshMs < retellStatusRefreshCooldownMs
    ) {
      return false;
    }

    retellCallStatusRefreshByCallId.set(callId, nowMs);
    return true;
  }

  function collectMissingCallUpdateRefreshCandidates(limit = 6) {
    const maxItems = Math.max(0, Math.min(30, Number(limit) || 6));
    if (maxItems <= 0) return [];

    const seenCallIds = new Set();
    const candidates = [];

    const registerCandidate = (item) => {
      const callId = normalizeString(item?.callId || item?.call_id || '');
      if (!callId || callId.startsWith('demo-')) return;
      if (callUpdatesById.has(callId) || seenCallIds.has(callId)) return;

      const stack = normalizeColdcallingStack(
        item?.coldcallingStack || item?.callingStack || item?.stack || item?.callingEngine || ''
      );
      const providerHint = normalizeString(
        item?.provider || inferCallProvider(callId, 'retell')
      ).toLowerCase();
      const provider = inferCallProvider(callId, providerHint || 'retell');
      const updatedAtMs = getRuntimeSnapshotItemTimestampMs(item || {});

      seenCallIds.add(callId);
      candidates.push({
        callId,
        provider,
        direction: 'outbound',
        stack,
        updatedAtMs,
      });
    };

    generatedAgendaAppointments.forEach(registerCandidate);
    recentAiCallInsights.forEach(registerCandidate);

    return candidates
      .sort((a, b) => Number(b?.updatedAtMs || 0) - Number(a?.updatedAtMs || 0))
      .slice(0, maxItems);
  }

  return {
    collectMissingCallUpdateRefreshCandidates,
    findCallUpdateByRecordingReference,
    refreshCallUpdateFromRetellStatusApi,
    refreshCallUpdateFromTwilioStatusApi,
    resolveAppointmentCallId,
    shouldRefreshRetellCallStatus,
  };
}

module.exports = {
  createCallUpdateRuntime,
};
