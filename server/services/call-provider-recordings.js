function createCallProviderRecordingHelpers(options = {}) {
  const {
    env = process.env,
    twilioApiBaseUrl = 'https://api.twilio.com',
    defaultTwilioMediaWsUrl = '',
    fetchJsonWithTimeout = async () => {
      throw new Error('fetchJsonWithTimeout ontbreekt');
    },
    getEffectivePublicBaseUrl = () => '',
    normalizeAbsoluteHttpUrl = (value) => String(value || '').trim(),
    appendQueryParamsToUrl = (url) => url,
    normalizeString = (value, fallback = '') => {
      if (value === null || value === undefined) return fallback;
      return String(value).trim();
    },
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    parseIntSafe = (value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
    parseNumberSafe = (value, fallback = null) => {
      if (value === '' || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    },
  } = options;

  function buildTwilioApiUrl(relativePath) {
    const normalizedBase = `${normalizeString(twilioApiBaseUrl).replace(/\/+$/, '')}/`;
    return new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);
  }

  function hasTwilioRegionalApiKeyPair() {
    return Boolean(
      normalizeString(env.TWILIO_API_KEY_SID) && normalizeString(env.TWILIO_API_KEY_SECRET)
    );
  }

  function getTwilioBasicAuthorizationHeader() {
    const username = hasTwilioRegionalApiKeyPair()
      ? normalizeString(env.TWILIO_API_KEY_SID)
      : normalizeString(env.TWILIO_ACCOUNT_SID);
    const password = hasTwilioRegionalApiKeyPair()
      ? normalizeString(env.TWILIO_API_KEY_SECRET)
      : normalizeString(env.TWILIO_AUTH_TOKEN);
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    return `Basic ${basic}`;
  }

  function buildTwilioRecordingProxyUrl(callId, recordingSid = '') {
    const normalizedCallId = normalizeString(callId);
    const normalizedRecordingSid = normalizeString(recordingSid);
    if (!normalizedCallId && !normalizedRecordingSid) return '';
    const params = new URLSearchParams();
    if (normalizedCallId) params.set('callId', normalizedCallId);
    if (normalizedRecordingSid) params.set('recordingSid', normalizedRecordingSid);
    const qs = params.toString();
    return qs ? `/api/coldcalling/recording-proxy?${qs}` : '/api/coldcalling/recording-proxy';
  }

  function buildTwilioRecordingMediaUrl(recordingSid) {
    const accountSid = normalizeString(env.TWILIO_ACCOUNT_SID);
    const normalizedRecordingSid = normalizeString(recordingSid);
    if (!accountSid || !normalizedRecordingSid) return null;
    return buildTwilioApiUrl(
      `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(
        normalizedRecordingSid
      )}.mp3`
    );
  }

  async function fetchTwilioRecordingsByCallId(callId) {
    const accountSid = normalizeString(env.TWILIO_ACCOUNT_SID);
    const normalizedCallId = normalizeString(callId);
    if (!accountSid || !normalizedCallId) {
      throw new Error('TWILIO_ACCOUNT_SID of callId ontbreekt.');
    }

    const endpoint =
      `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings.json` +
      `?CallSid=${encodeURIComponent(normalizedCallId)}&PageSize=20`;

    const { response, data } = await fetchJsonWithTimeout(
      buildTwilioApiUrl(endpoint),
      {
        method: 'GET',
        headers: {
          Authorization: getTwilioBasicAuthorizationHeader(),
          'Content-Type': 'application/json',
        },
      },
      10000
    );

    if (!response.ok) {
      const statusError = new Error(
        data?.message ||
          data?.error ||
          data?.detail ||
          data?.raw ||
          `Twilio recordings fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      throw statusError;
    }

    const recordings = Array.isArray(data?.recordings) ? data.recordings : [];
    return { endpoint, data, recordings };
  }

  function extractTwilioRecordingSidFromUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const match = raw.match(/\/Recordings\/(RE[0-9a-f]{32})/i);
    return normalizeString(match?.[1] || '');
  }

  function extractCallIdFromRecordingUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://softora.local');
      return normalizeString(parsed.searchParams.get('callId') || '');
    } catch {
      const match = raw.match(/[?&]callId=([^&#]+)/i);
      if (!match) return '';
      try {
        return normalizeString(decodeURIComponent(match[1] || ''));
      } catch {
        return normalizeString(match[1] || '');
      }
    }
  }

  function normalizeRecordingReference(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://softora.local');
      const pathname = normalizeString(parsed.pathname || '');
      const callId = normalizeString(parsed.searchParams.get('callId') || '');
      const recordingSid = normalizeString(parsed.searchParams.get('recordingSid') || '');
      if (callId) return `${pathname}?callId=${callId}`;
      if (recordingSid) return `${pathname}?recordingSid=${recordingSid}`;
      return pathname || raw;
    } catch {
      return raw;
    }
  }

  function parseDateToIso(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    return new Date(ms).toISOString();
  }

  function getTwilioStackEnvSuffixes(stack) {
    const normalized = normalizeColdcallingStack(stack);
    if (normalized === 'gemini_flash_3_1_live') return ['GEMINI_FLASH_3_1_LIVE', 'GEMINI'];
    if (normalized === 'openai_realtime_1_5') {
      return ['OPENAI_REALTIME_1_5', 'OPENAI_REALTIME', 'OPENAI'];
    }
    if (normalized === 'hume_evi_3') return ['HUME_EVI_3', 'HUME_EVI', 'HUME'];
    return ['RETELL_AI', 'RETELL'];
  }

  function normalizeTwilioMediaWsUrl(value) {
    const raw = normalizeString(value);
    if (!raw) return '';
    const compatOrigin = normalizeString(
      env.TWILIO_MEDIA_BRIDGE_COMPAT_ORIGIN || 'wss://twilio-media-bridge-ln3f.onrender.com'
    ).replace(/\/+$/, '');
    return raw.replace(
      /wss?:\/\/twilio-media-bridge-pjzd\.onrender\.com(?=\/|$)/i,
      compatOrigin
    );
  }

  function getTwilioMediaWsUrlForStack(stack) {
    const suffixes = getTwilioStackEnvSuffixes(stack);
    for (const suffix of suffixes) {
      const candidate = normalizeString(env[`TWILIO_MEDIA_WS_URL_${suffix}`]);
      if (candidate) return normalizeTwilioMediaWsUrl(candidate);
    }
    return normalizeTwilioMediaWsUrl(env.TWILIO_MEDIA_WS_URL || defaultTwilioMediaWsUrl);
  }

  function getTwilioFromNumberForStack(stack) {
    const suffixes = getTwilioStackEnvSuffixes(stack);
    for (const suffix of suffixes) {
      const candidate = normalizeString(env[`TWILIO_FROM_NUMBER_${suffix}`]);
      if (candidate) return candidate;
    }
    return normalizeString(env.TWILIO_FROM_NUMBER);
  }

  function buildTwilioOutboundTwimlUrl(stack, campaign = {}) {
    const configuredUrl = normalizeString(env.TWILIO_OUTBOUND_TWIML_URL || env.TWILIO_TWIML_URL);
    const fallbackBaseUrl = getEffectivePublicBaseUrl(null, campaign?.publicBaseUrl);
    const baseUrl = configuredUrl || (fallbackBaseUrl ? `${fallbackBaseUrl}/api/twilio/voice` : '');
    const normalizedBase = normalizeAbsoluteHttpUrl(baseUrl);
    if (!normalizedBase) {
      throw new Error(
        'TWILIO_OUTBOUND_TWIML_URL of PUBLIC_BASE_URL ontbreekt/ongeldig voor Twilio outbound calling.'
      );
    }
    return appendQueryParamsToUrl(normalizedBase, { stack: normalizeColdcallingStack(stack) });
  }

  function buildTwilioStatusCallbackUrl(stack, campaign = {}) {
    const configuredUrl = normalizeString(env.TWILIO_STATUS_CALLBACK_URL);
    const fallbackBaseUrl = getEffectivePublicBaseUrl(null, campaign?.publicBaseUrl);
    const baseUrl = configuredUrl || (fallbackBaseUrl ? `${fallbackBaseUrl}/api/twilio/status` : '');
    const normalizedBase = normalizeAbsoluteHttpUrl(baseUrl);
    if (!normalizedBase) {
      throw new Error(
        'TWILIO_STATUS_CALLBACK_URL of PUBLIC_BASE_URL ontbreekt/ongeldig voor Twilio status callbacks.'
      );
    }
    const secret = normalizeString(env.TWILIO_WEBHOOK_SECRET);
    return appendQueryParamsToUrl(normalizedBase, {
      stack: normalizeColdcallingStack(stack),
      ...(secret ? { secret } : {}),
    });
  }

  function toIsoFromUnixMilliseconds(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    if (numeric < 1e11) {
      return new Date(numeric * 1000).toISOString();
    }
    return new Date(numeric).toISOString();
  }

  function isTerminalColdcallingStatus(status, endedReason = '') {
    const combined = `${normalizeString(status).toLowerCase()} ${normalizeString(endedReason).toLowerCase()}`;
    return /(ended|completed|failed|cancelled|canceled|busy|no-answer|no answer|voicemail|hungup|hangup|disconnected|done|error|not_connected|dial_)/.test(
      combined
    );
  }

  function parseTwilioRecordingDurationSeconds(recording) {
    const rawSeconds = parseNumberSafe(
      recording?.duration ||
        recording?.duration_seconds ||
        recording?.Duration ||
        recording?.DurationSeconds,
      null
    );
    return Number.isFinite(rawSeconds) && rawSeconds >= 0 ? Math.round(rawSeconds) : null;
  }

  function parseTwilioRecordingUpdatedAtMs(recording) {
    const candidates = [
      recording?.date_updated,
      recording?.date_created,
      recording?.start_time,
      recording?.startTime,
      recording?.created_at,
      recording?.updated_at,
    ];
    for (const candidate of candidates) {
      const raw = normalizeString(candidate);
      if (!raw) continue;
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
  }

  function choosePreferredTwilioRecording(recordings, preferredSid = '') {
    const list = Array.isArray(recordings) ? recordings.filter(Boolean) : [];
    if (!list.length) return null;
    const preferredSidNormalized = normalizeString(preferredSid);

    return list
      .slice()
      .sort((left, right) => {
        const leftCompleted = /completed/i.test(normalizeString(left?.status || '')) ? 1 : 0;
        const rightCompleted = /completed/i.test(normalizeString(right?.status || '')) ? 1 : 0;
        if (leftCompleted !== rightCompleted) return rightCompleted - leftCompleted;

        const leftDuration = parseTwilioRecordingDurationSeconds(left) || 0;
        const rightDuration = parseTwilioRecordingDurationSeconds(right) || 0;
        if (leftDuration !== rightDuration) return rightDuration - leftDuration;

        const leftPreferred = normalizeString(left?.sid || '') === preferredSidNormalized ? 1 : 0;
        const rightPreferred = normalizeString(right?.sid || '') === preferredSidNormalized ? 1 : 0;
        if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;

        const leftUpdated = parseTwilioRecordingUpdatedAtMs(left);
        const rightUpdated = parseTwilioRecordingUpdatedAtMs(right);
        return rightUpdated - leftUpdated;
      })[0];
  }

  function resolvePreferredRecordingUrl(...sources) {
    let callId = '';
    let recordingSid = '';
    let provider = '';
    const rawUrls = [];

    for (const source of sources) {
      if (!source || typeof source !== 'object') continue;
      callId = callId || normalizeString(source.callId || source.call_id || '');
      recordingSid =
        recordingSid ||
        normalizeString(
          source.recordingSid ||
            source.recording_sid ||
            extractTwilioRecordingSidFromUrl(source.recordingUrl || source.recording_url || '')
        );
      provider = provider || normalizeString(source.provider || '');

      const url = normalizeString(
        source.recordingUrl ||
          source.recording_url ||
          source.recordingUrlProxy ||
          source.audioUrl ||
          source.audio_url ||
          ''
      );
      if (url) rawUrls.push(url);
    }

    const firstRawUrl = rawUrls[0] || '';
    const hasProxyReference = rawUrls.some((url) => /\/api\/coldcalling\/recording-proxy/i.test(url));
    const isTwilioLike = provider === 'twilio' || Boolean(recordingSid) || hasProxyReference;

    if (callId && isTwilioLike) {
      return buildTwilioRecordingProxyUrl(callId);
    }
    if (!callId && recordingSid) {
      return buildTwilioRecordingProxyUrl('', recordingSid);
    }
    return firstRawUrl;
  }

  return {
    buildTwilioApiUrl,
    buildTwilioOutboundTwimlUrl,
    buildTwilioRecordingMediaUrl,
    buildTwilioRecordingProxyUrl,
    buildTwilioStatusCallbackUrl,
    choosePreferredTwilioRecording,
    extractCallIdFromRecordingUrl,
    extractTwilioRecordingSidFromUrl,
    fetchTwilioRecordingsByCallId,
    getTwilioBasicAuthorizationHeader,
    getTwilioFromNumberForStack,
    getTwilioMediaWsUrlForStack,
    getTwilioStackEnvSuffixes,
    isTerminalColdcallingStatus,
    normalizeRecordingReference,
    parseDateToIso,
    parseTwilioRecordingDurationSeconds,
    parseTwilioRecordingUpdatedAtMs,
    resolvePreferredRecordingUrl,
    toIsoFromUnixMilliseconds,
  };
}

module.exports = {
  createCallProviderRecordingHelpers,
};
