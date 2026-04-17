function defaultNormalizeString(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function defaultParseIntSafe(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultParseNumberSafe(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultTruncateText(value, maxLength = 500, normalizeString = defaultNormalizeString) {
  const text = normalizeString(value);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function createCallProviderHelpers(options = {}) {
  const {
    env = process.env,
    retellApiBaseUrl = 'https://api.retellai.com',
    twilioApiBaseUrl = 'https://api.twilio.com',
    defaultTwilioMediaWsUrl = '',
    fetchJsonWithTimeout = async () => {
      throw new Error('fetchJsonWithTimeout ontbreekt');
    },
    getEffectivePublicBaseUrl = () => '',
    normalizeAbsoluteHttpUrl = (value) => defaultNormalizeString(value),
    appendQueryParamsToUrl = (url) => url,
    normalizeString = defaultNormalizeString,
    normalizeColdcallingStack = (value) => normalizeString(value).toLowerCase(),
    normalizeNlPhoneToE164 = (value) => normalizeString(value),
    parseIntSafe = defaultParseIntSafe,
    parseNumberSafe = defaultParseNumberSafe,
    truncateText = (value, maxLength) => defaultTruncateText(value, maxLength, normalizeString),
    getColdcallingStackLabel = (stack) => normalizeString(stack),
    extractRetellTranscriptText = () => '',
  } = options;

  function classifyRetellFailure(error) {
    const message = String(error?.message || '').toLowerCase();
    const detailText = JSON.stringify(error?.data || {}).toLowerCase();
    const combined = `${message} ${detailText}`;
    const status = Number(error?.status || 0);

    if (
      status === 402 ||
      /credit|credits|balance|billing|payment required|insufficient funds|no_valid_payment/.test(
        combined
      )
    ) {
      return {
        cause: 'credits',
        explanation: 'Waarschijnlijk onvoldoende Retell-credits/balance om de call te starten.',
      };
    }

    if (status === 401 || /unauthorized|invalid api key|bearer/.test(combined)) {
      return {
        cause: 'wrong retell api key',
        explanation: 'RETELL_API_KEY lijkt ongeldig of ontbreekt.',
      };
    }

    if (
      /override_agent_id|agent/.test(combined) &&
      /(invalid|unknown|not found|missing|does not exist)/.test(combined)
    ) {
      return {
        cause: 'wrong retell agent',
        explanation: 'RETELL_AGENT_ID lijkt ongeldig of niet beschikbaar.',
      };
    }

    if (
      /from_number|to_number|invalid_destination|e\\.164|phone|number|nummer/.test(combined) &&
      /(invalid|format|not found|permission|omzetten|ongeldig)/.test(combined)
    ) {
      return {
        cause: 'invalid number',
        explanation: 'Het doelnummer of belnummer voor Retell is ongeldig of niet toegestaan.',
      };
    }

    if (/dynamic variables?|retell_llm_dynamic_variables|key value pairs of strings/.test(combined)) {
      return {
        cause: 'invalid dynamic variables',
        explanation:
          'Retell verwacht platte dynamic variables met alleen string-waarden. De payload is nu aangepast om alleen string -> string mee te sturen.',
      };
    }

    if (
      status >= 500 ||
      /provider|carrier|telecom|twilio|sip|timeout|temporar|rate limit|service unavailable|unavailable/.test(
        combined
      )
    ) {
      return {
        cause: 'provider issue',
        explanation: 'Waarschijnlijk een issue bij Retell/provider/carrier (tijdelijk of extern).',
      };
    }

    return {
      cause: 'unknown',
      explanation:
        'Oorzaak kon niet eenduidig worden bepaald. Controleer de exacte foutmelding en Retell response body.',
    };
  }

  function classifyTwilioFailure(error) {
    const message = String(error?.message || '').toLowerCase();
    const detailText = JSON.stringify(error?.data || {}).toLowerCase();
    const combined = `${message} ${detailText}`;
    const status = Number(error?.status || 0);

    if (
      status === 401 ||
      status === 403 ||
      /auth|token|credential|account sid|permission/i.test(combined)
    ) {
      return {
        cause: 'wrong twilio credentials',
        explanation: 'TWILIO_ACCOUNT_SID of TWILIO_AUTH_TOKEN lijkt ongeldig.',
      };
    }

    if (/from|callerid|caller id|owned|verified|not a valid phone/i.test(combined)) {
      return {
        cause: 'invalid twilio from number',
        explanation: 'TWILIO_FROM_NUMBER is ongeldig of niet beschikbaar in het Twilio account.',
      };
    }

    if (/to|destination|e\\.164|invalid phone|phone number/i.test(combined)) {
      return {
        cause: 'invalid number',
        explanation: 'Het doelnummer is ongeldig of door Twilio/carrier geweigerd.',
      };
    }

    if (status === 429 || /rate limit|too many|throttle/i.test(combined)) {
      return {
        cause: 'rate limit',
        explanation: 'Twilio rate limit bereikt; probeer later opnieuw.',
      };
    }

    if (status >= 500 || /temporar|timeout|unavailable|carrier|provider/i.test(combined)) {
      return {
        cause: 'provider issue',
        explanation: 'Waarschijnlijk een tijdelijk probleem bij Twilio of de carrier.',
      };
    }

    return {
      cause: 'unknown',
      explanation: 'Controleer de exacte Twilio response body voor de foutoorzaak.',
    };
  }

  function buildVariableValues(lead, campaign) {
    const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
    const minProjectValue = parseNumberSafe(campaign.minProjectValue, null);
    const maxDiscountPct = parseNumberSafe(campaign.maxDiscountPct, null);
    const rawValues = {
      name: normalizeString(lead.name),
      company: normalizeString(lead.company),
      branche: normalizeString(lead.branche || lead.branch || lead.sector || ''),
      sector: normalizeString(campaign.sector),
      region: effectiveRegion,
      minProjectValue: Number.isFinite(minProjectValue) ? String(minProjectValue) : '',
      maxDiscountPct: Number.isFinite(maxDiscountPct) ? String(maxDiscountPct) : '',
      extraInstructions: normalizeString(campaign.extraInstructions),
    };

    return Object.fromEntries(
      Object.entries(rawValues).filter(
        ([key, value]) => normalizeString(key) && typeof value === 'string'
      )
    );
  }

  function buildRetellApiUrl(relativePath, searchParams = null) {
    const normalizedBase = `${normalizeString(retellApiBaseUrl).replace(/\/+$/, '')}/`;
    const url = new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);

    if (searchParams && typeof searchParams === 'object') {
      Object.entries(searchParams).forEach(([key, value]) => {
        const normalizedValue = normalizeString(value);
        if (!normalizedValue) return;
        url.searchParams.set(key, normalizedValue);
      });
    }

    return url;
  }

  function buildTwilioApiUrl(relativePath) {
    const normalizedBase = `${normalizeString(twilioApiBaseUrl).replace(/\/+$/, '')}/`;
    return new URL(String(relativePath || '').replace(/^\/+/, ''), normalizedBase);
  }

  function getTwilioBasicAuthorizationHeader() {
    const accountSid = normalizeString(env.TWILIO_ACCOUNT_SID);
    const authToken = normalizeString(env.TWILIO_AUTH_TOKEN);
    const basic = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
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

  function getTwilioMediaWsUrlForStack(stack) {
    const suffixes = getTwilioStackEnvSuffixes(stack);
    for (const suffix of suffixes) {
      const candidate = normalizeString(env[`TWILIO_MEDIA_WS_URL_${suffix}`]);
      if (candidate) return candidate;
    }
    return normalizeString(env.TWILIO_MEDIA_WS_URL || defaultTwilioMediaWsUrl);
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

  function buildRetellPayload(lead, campaign) {
    const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
    const effectiveRegion = normalizeString(lead.region) || normalizeString(campaign.region);
    const effectiveProvince = normalizeString(lead.province);
    const effectiveAddress = normalizeString(lead.address);
    const overrideAgentId = normalizeString(env.RETELL_AGENT_ID);
    const overrideAgentVersion = parseIntSafe(env.RETELL_AGENT_VERSION, 0);

    return {
      from_number: normalizeString(env.RETELL_FROM_NUMBER),
      to_number: normalizedPhone,
      ...(overrideAgentId ? { override_agent_id: overrideAgentId } : {}),
      ...(overrideAgentVersion > 0 ? { override_agent_version: overrideAgentVersion } : {}),
      retell_llm_dynamic_variables: buildVariableValues(
        {
          ...lead,
          phone: normalizedPhone,
        },
        campaign
      ),
      metadata: {
        source: 'softora-coldcalling-dashboard',
        leadCompany: normalizeString(lead.company),
        leadName: normalizeString(lead.name),
        leadBranche: normalizeString(lead.branche || lead.branch || lead.sector || ''),
        leadPhoneE164: normalizedPhone,
        leadRegion: effectiveRegion,
        leadProvince: effectiveProvince,
        leadAddress: effectiveAddress,
        sector: normalizeString(campaign.sector),
        region: effectiveRegion,
      },
    };
  }

  function buildTwilioOutboundPayload(lead, campaign) {
    const normalizedPhone = normalizeNlPhoneToE164(lead.phone);
    const stack = normalizeColdcallingStack(campaign?.coldcallingStack);
    const twimlUrl = buildTwilioOutboundTwimlUrl(stack, campaign);
    const statusCallbackUrl = buildTwilioStatusCallbackUrl(stack, campaign);
    const fromNumber = getTwilioFromNumberForStack(stack);
    if (!fromNumber) {
      throw new Error('TWILIO_FROM_NUMBER ontbreekt voor geselecteerde stack.');
    }

    return {
      To: normalizedPhone,
      From: fromNumber,
      Url: twimlUrl,
      Method: 'POST',
      StatusCallback: statusCallbackUrl,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      Record: 'true',
      RecordingChannels: 'dual',
      RecordingStatusCallback: statusCallbackUrl,
      RecordingStatusCallbackMethod: 'POST',
      RecordingStatusCallbackEvent: ['in-progress', 'completed', 'absent'],
      Timeout: String(Math.max(15, Math.min(90, parseIntSafe(env.TWILIO_DIAL_TIMEOUT_SECONDS, 30)))),
    };
  }

  async function createRetellOutboundCall(payload) {
    const endpoint = '/v2/create-phone-call';
    const { response, data } = await fetchJsonWithTimeout(
      buildRetellApiUrl(endpoint),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RETELL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
      15000
    );

    if (!response.ok) {
      const statusError = new Error(
        data?.message ||
          data?.error ||
          data?.detail ||
          data?.raw ||
          `Retell API fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      throw statusError;
    }

    return { endpoint, data };
  }

  async function fetchRetellCallStatusById(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) {
      throw new Error('callId ontbreekt');
    }

    const endpoint = `/v2/get-call/${encodeURIComponent(normalizedCallId)}`;
    const { response, data } = await fetchJsonWithTimeout(
      buildRetellApiUrl(endpoint),
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${env.RETELL_API_KEY}`,
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
          `Retell call status fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      throw statusError;
    }

    return { endpoint, data };
  }

  async function createTwilioOutboundCall(payload) {
    const accountSid = normalizeString(env.TWILIO_ACCOUNT_SID);
    const endpoint = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`;
    const form = new URLSearchParams();
    Object.entries(payload || {}).forEach(([key, value]) => {
      if (!normalizeString(key)) return;
      if (Array.isArray(value)) {
        value.forEach((entry) => {
          const normalizedEntry = normalizeString(entry);
          if (!normalizedEntry) return;
          form.append(key, normalizedEntry);
        });
        return;
      }
      const normalizedValue = normalizeString(value);
      if (!normalizedValue) return;
      form.set(key, normalizedValue);
    });

    const { response, data } = await fetchJsonWithTimeout(
      buildTwilioApiUrl(endpoint),
      {
        method: 'POST',
        headers: {
          Authorization: getTwilioBasicAuthorizationHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
      15000
    );

    if (!response.ok) {
      const statusError = new Error(
        data?.message ||
          data?.error ||
          data?.detail ||
          data?.raw ||
          `Twilio API fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      throw statusError;
    }

    return { endpoint, data };
  }

  async function fetchTwilioCallStatusById(callId) {
    const normalizedCallId = normalizeString(callId);
    if (!normalizedCallId) {
      throw new Error('callId ontbreekt');
    }

    const accountSid = normalizeString(env.TWILIO_ACCOUNT_SID);
    const endpoint = `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls/${encodeURIComponent(
      normalizedCallId
    )}.json`;
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
          `Twilio call status fout (${response.status})`
      );
      statusError.status = response.status;
      statusError.endpoint = endpoint;
      statusError.data = data;
      throw statusError;
    }

    return { endpoint, data };
  }

  function extractCallUpdateFromRetellPayload(payload) {
    const event = normalizeString(payload?.event || payload?.type || 'retell.webhook.unknown');
    const call = payload?.call && typeof payload.call === 'object' ? payload.call : {};
    const callId = normalizeString(call?.call_id || payload?.call_id || payload?.callId || '');
    const status = normalizeString(call?.call_status || payload?.call_status || payload?.status || '');
    const phone =
      normalizeString(call?.to_number) ||
      normalizeString(call?.metadata?.leadPhoneE164) ||
      normalizeString(call?.from_number);
    const company =
      normalizeString(call?.metadata?.leadCompany) || normalizeString(call?.metadata?.company);
    const branche =
      normalizeString(call?.metadata?.leadBranche) ||
      normalizeString(call?.metadata?.branche) ||
      normalizeString(call?.metadata?.sector);
    const region =
      normalizeString(call?.metadata?.leadRegion) ||
      normalizeString(call?.metadata?.region) ||
      normalizeString(call?.metadata?.leadCity) ||
      normalizeString(call?.metadata?.city);
    const province =
      normalizeString(call?.metadata?.leadProvince) ||
      normalizeString(call?.metadata?.province) ||
      normalizeString(call?.metadata?.state);
    const address =
      normalizeString(call?.metadata?.leadAddress) ||
      normalizeString(call?.metadata?.address) ||
      normalizeString(call?.metadata?.street);
    const name =
      normalizeString(call?.metadata?.leadName) || normalizeString(call?.metadata?.lead_name);
    const summary =
      normalizeString(call?.call_analysis?.call_summary) ||
      normalizeString(call?.call_analysis?.summary);
    const transcriptFull = extractRetellTranscriptText(call, { maxLength: 9000, preferFull: true });
    const transcriptSnippet = transcriptFull
      ? truncateText(transcriptFull.replace(/\s+/g, ' '), 450)
      : '';
    const endedReason = normalizeString(call?.disconnection_reason || '');
    const startedAt = toIsoFromUnixMilliseconds(call?.start_timestamp);
    const endedAt = toIsoFromUnixMilliseconds(call?.end_timestamp);
    const durationFromMs = parseNumberSafe(call?.duration_ms, null);
    const durationSeconds =
      Number.isFinite(durationFromMs) && durationFromMs > 0
        ? Math.max(1, Math.round(durationFromMs / 1000))
        : Number.isFinite(Date.parse(startedAt)) && Number.isFinite(Date.parse(endedAt))
          ? Math.max(1, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000))
          : null;
    const recordingUrl =
      normalizeString(call?.recording_url) ||
      normalizeString(call?.recording_multi_channel_url) ||
      normalizeString(call?.scrubbed_recording_url) ||
      normalizeString(call?.scrubbed_recording_multi_channel_url);
    const terminal = isTerminalColdcallingStatus(status, endedReason);
    const updatedAtMs = terminal
      ? Number(call?.end_timestamp || call?.start_timestamp || Date.now())
      : Date.now();

    if (!callId && !phone && !company && !summary && !transcriptSnippet && !status) {
      return null;
    }

    return {
      callId: callId || `retell-anon-${Date.now()}`,
      phone,
      company,
      branche,
      region,
      province,
      address,
      name,
      status,
      messageType: `retell.${event || 'webhook'}`,
      summary,
      transcriptSnippet,
      transcriptFull,
      endedReason,
      startedAt,
      endedAt,
      durationSeconds,
      recordingUrl,
      updatedAt: new Date(updatedAtMs).toISOString(),
      updatedAtMs,
      provider: 'retell',
    };
  }

  function extractCallUpdateFromRetellCallStatusResponse(callId, data) {
    const call = data && typeof data === 'object' ? data : null;
    if (!call) return null;

    const extracted = extractCallUpdateFromRetellPayload({
      event: 'call_status_fetch',
      call,
    });
    if (!extracted) return null;

    return {
      ...extracted,
      callId: normalizeString(call?.call_id || callId || extracted.callId),
      messageType: 'retell.call_status_fetch',
      updatedAtMs: Number(
        call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now()
      ),
      updatedAt:
        toIsoFromUnixMilliseconds(call?.end_timestamp || call?.start_timestamp) ||
        new Date(
          Number(call?.end_timestamp || call?.start_timestamp || extracted.updatedAtMs || Date.now())
        ).toISOString(),
    };
  }

  function extractCallUpdateFromTwilioPayload(payload = {}, options = {}) {
    if (!payload || typeof payload !== 'object') return null;
    const fallbackStack = normalizeColdcallingStack(options.stack);
    const callId = normalizeString(payload?.CallSid || payload?.sid || options.callId || '');
    const streamEvent = normalizeString(
      payload?.StreamEvent || payload?.stream_event || ''
    ).toLowerCase();
    const recordingStatus = normalizeString(
      payload?.RecordingStatus || payload?.recording_status || ''
    ).toLowerCase();
    const direction = normalizeString(
      payload?.Direction ||
        payload?.direction ||
        payload?.CallDirection ||
        payload?.call_direction ||
        options.direction ||
        ''
    ).toLowerCase();
    let status = normalizeString(payload?.CallStatus || payload?.status || '').toLowerCase();
    if (!status && streamEvent) {
      if (streamEvent === 'stream-started') status = 'in_progress';
      else if (streamEvent === 'stream-stopped') status = 'completed';
      else if (streamEvent === 'stream-error') status = 'failed';
    }
    const toNumber = normalizeString(payload?.To || payload?.to || payload?.Called || '');
    const fromNumber = normalizeString(payload?.From || payload?.from || payload?.Caller || '');
    const phone = direction.includes('inbound') ? fromNumber || toNumber : toNumber || fromNumber;
    const startedAt =
      parseDateToIso(
        payload?.StartTime || payload?.start_time || payload?.date_created || payload?.Timestamp
      ) || '';
    const endedAt =
      parseDateToIso(payload?.EndTime || payload?.end_time) ||
      (isTerminalColdcallingStatus(status, '') || streamEvent === 'stream-stopped'
        ? new Date().toISOString()
        : '');
    const endedReason = normalizeString(
      payload?.CallStatusReason ||
        payload?.ErrorMessage ||
        payload?.DialCallStatus ||
        payload?.SipResponseCode ||
        payload?.StreamError ||
        ''
    );
    const durationSeconds = parseNumberSafe(payload?.CallDuration || payload?.duration, null);
    const region = normalizeString(
      payload?.Region ||
        payload?.region ||
        payload?.LeadRegion ||
        payload?.leadRegion ||
        payload?.City ||
        payload?.city ||
        ''
    );
    const province = normalizeString(
      payload?.Province || payload?.province || payload?.State || payload?.state || ''
    );
    const address = normalizeString(
      payload?.Address ||
        payload?.address ||
        payload?.LeadAddress ||
        payload?.leadAddress ||
        payload?.Street ||
        payload?.street ||
        ''
    );
    const recordingSid = normalizeString(
      payload?.RecordingSid ||
        payload?.recording_sid ||
        extractTwilioRecordingSidFromUrl(payload?.RecordingUrl || '')
    );
    const recordingUrlRaw = normalizeString(payload?.RecordingUrl || payload?.recording_url || '');
    const recordingUrlProxy = buildTwilioRecordingProxyUrl(callId);
    const recordingUrl = recordingUrlProxy || recordingUrlRaw;
    const updatedAtMs = Date.now();
    const stackLabel = getColdcallingStackLabel(fallbackStack);
    const messageType = streamEvent
      ? `twilio.stream.${streamEvent}`
      : recordingStatus
        ? `twilio.recording.${recordingStatus}`
        : `twilio.status.${status || 'unknown'}`;

    if (!callId && !status && !phone) return null;

    return {
      callId: callId || `twilio-anon-${updatedAtMs}`,
      phone,
      company: normalizeString(
        payload?.Company || payload?.company || payload?.LeadCompany || payload?.leadCompany || ''
      ),
      branche: normalizeString(
        payload?.Branche ||
          payload?.branche ||
          payload?.Sector ||
          payload?.sector ||
          payload?.LeadBranche ||
          ''
      ),
      region,
      province,
      address,
      name: normalizeString(
        payload?.LeadName || payload?.name || payload?.CallerName || payload?.callerName || ''
      ),
      status,
      messageType,
      summary: normalizeString(payload?.summary || ''),
      transcriptSnippet: '',
      transcriptFull: '',
      endedReason,
      startedAt: startedAt || '',
      endedAt: endedAt || '',
      durationSeconds:
        Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= 0
          ? Math.round(Number(durationSeconds))
          : null,
      recordingUrl,
      recordingSid,
      recordingUrlProxy,
      updatedAt: new Date(updatedAtMs).toISOString(),
      updatedAtMs,
      provider: 'twilio',
      direction,
      stack: fallbackStack,
      stackLabel,
    };
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

  function extractCallUpdateFromTwilioCallStatusResponse(callId, data, options = {}) {
    if (!data || typeof data !== 'object') return null;
    const update = extractCallUpdateFromTwilioPayload(
      {
        CallSid: normalizeString(data?.sid || callId),
        CallStatus: normalizeString(data?.status || ''),
        Direction: normalizeString(data?.direction || options?.direction || ''),
        To: normalizeString(data?.to || ''),
        From: normalizeString(data?.from || ''),
        StartTime: normalizeString(data?.start_time || data?.date_created || ''),
        EndTime: normalizeString(data?.end_time || ''),
        CallDuration: normalizeString(data?.duration || ''),
        RecordingUrl: normalizeString(data?.recording_url || ''),
        ErrorMessage: normalizeString(data?.subresource_uris?.events || ''),
      },
      options
    );
    if (!update) return null;
    return {
      ...update,
      messageType: 'twilio.call_status_fetch',
    };
  }

  return {
    buildRetellApiUrl,
    buildRetellPayload,
    buildTwilioApiUrl,
    buildTwilioOutboundPayload,
    buildTwilioOutboundTwimlUrl,
    buildTwilioRecordingMediaUrl,
    buildTwilioRecordingProxyUrl,
    buildTwilioStatusCallbackUrl,
    buildVariableValues,
    choosePreferredTwilioRecording,
    classifyRetellFailure,
    classifyTwilioFailure,
    createRetellOutboundCall,
    createTwilioOutboundCall,
    extractCallIdFromRecordingUrl,
    extractCallUpdateFromRetellCallStatusResponse,
    extractCallUpdateFromRetellPayload,
    extractCallUpdateFromTwilioCallStatusResponse,
    extractCallUpdateFromTwilioPayload,
    extractTwilioRecordingSidFromUrl,
    fetchRetellCallStatusById,
    fetchTwilioCallStatusById,
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
  createCallProviderHelpers,
};
