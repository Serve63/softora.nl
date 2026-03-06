const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');

const TWILIO_API_BASE_URL = 'https://api.twilio.com/2010-04-01';
const DEEPGRAM_REALTIME_URL = 'wss://api.deepgram.com/v1/listen';
const ELEVENLABS_API_BASE_URL = 'https://api.elevenlabs.io/v1';
const ELEVENLABS_REALTIME_URL = 'wss://api.elevenlabs.io/v1';
const DEFAULT_MEDIA_STREAM_PATH = '/ws/twilio-media-stream';
const DEFAULT_BRIDGE_PHRASES = ['Ja, helder.', 'Top, ik luister.', 'Helemaal goed.'];
const SESSION_RETENTION_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

function createLowLatencyColdcallingService(options = {}) {
  const env = options.env || process.env;
  const normalizeString =
    options.normalizeString || ((value) => (typeof value === 'string' ? value.trim() : String(value || '').trim()));
  const normalizeNlPhoneToE164 =
    options.normalizeNlPhoneToE164 || ((value) => normalizeString(value));
  const parseIntSafe =
    options.parseIntSafe ||
    ((value, fallback = 0) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    });
  const parseNumberSafe =
    options.parseNumberSafe ||
    ((value, fallback = null) => {
      if (value === '' || value === null || value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    });
  const getAnthropicApiKey =
    options.getAnthropicApiKey || (() => normalizeString(env.ANTHROPIC_API_KEY || env.CLAUDE_API_KEY));
  const onCallUpdate = typeof options.onCallUpdate === 'function' ? options.onCallUpdate : () => {};

  const sessionsById = new Map();
  const sessionsByCallSid = new Map();
  const bridgeAudioCache = new Map();
  let bridgeAudioWarmupPromise = null;
  let websocketServer = null;

  function boolEnv(key, fallback = false) {
    const raw = String(env[key] || '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'ja'].includes(raw)) return true;
    if (['0', 'false', 'no', 'nee'].includes(raw)) return false;
    return fallback;
  }

  function stringEnv(key, fallback = '') {
    const value = normalizeString(env[key]);
    return value || fallback;
  }

  function numberEnv(key, fallback) {
    const parsed = parseNumberSafe(env[key], fallback);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function getMediaStreamPath() {
    const custom = normalizeString(env.COLDCALL_LOW_LATENCY_MEDIA_STREAM_PATH);
    return custom || DEFAULT_MEDIA_STREAM_PATH;
  }

  function getBridgePhrases() {
    const raw = normalizeString(env.COLDCALL_LOW_LATENCY_BRIDGE_PHRASES);
    if (!raw) return DEFAULT_BRIDGE_PHRASES.slice();
    const phrases = raw
      .split('|')
      .map((value) => normalizeString(value))
      .filter(Boolean);
    return phrases.length ? phrases : DEFAULT_BRIDGE_PHRASES.slice();
  }

  function isEnabled() {
    return boolEnv('COLDCALL_LOW_LATENCY_ENABLED', false);
  }

  function isRuntimeCapable() {
    return !env.VERCEL && !env.AWS_LAMBDA_FUNCTION_NAME && !env.LAMBDA_TASK_ROOT;
  }

  function getRequiredEnv() {
    return [
      'COLDCALL_LOW_LATENCY_PUBLIC_BASE_URL',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_PHONE_NUMBER',
      'DEEPGRAM_API_KEY',
      'ELEVENLABS_API_KEY',
      'ANTHROPIC_API_KEY',
    ];
  }

  function getMissingEnv() {
    return getRequiredEnv().filter((key) => !normalizeString(env[key]));
  }

  function getPublicBaseUrl() {
    return stringEnv('COLDCALL_LOW_LATENCY_PUBLIC_BASE_URL', '');
  }

  function getWebSocketBaseUrl() {
    const explicit = stringEnv('COLDCALL_LOW_LATENCY_WS_BASE_URL', '');
    if (explicit) return explicit.replace(/\/$/, '');
    const publicBaseUrl = getPublicBaseUrl();
    if (!publicBaseUrl) return '';
    return publicBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:').replace(/\/$/, '');
  }

  function getAnthropicModel() {
    return stringEnv('COLDCALL_LOW_LATENCY_ANTHROPIC_MODEL', stringEnv('ANTHROPIC_MODEL', 'claude-opus-4-6'));
  }

  function getAnthropicApiBaseUrl() {
    return stringEnv('ANTHROPIC_API_BASE_URL', 'https://api.anthropic.com/v1');
  }

  function getAnthropicMaxTokens() {
    return Math.max(512, Math.min(4096, parseIntSafe(env.COLDCALL_LOW_LATENCY_MAX_TOKENS, 1400)));
  }

  function getAnthropicTemperature() {
    return Math.max(0, Math.min(1, numberEnv('COLDCALL_LOW_LATENCY_TEMPERATURE', 0.45)));
  }

  function getTwilioPhoneNumber() {
    return stringEnv('TWILIO_PHONE_NUMBER', '');
  }

  function getTwilioVoiceWebhookUrl(sessionId, streamToken) {
    const base = getPublicBaseUrl();
    return `${base}/api/twilio/voice/low-latency?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(streamToken)}`;
  }

  function getTwilioStatusWebhookUrl(sessionId, streamToken) {
    const base = getPublicBaseUrl();
    return `${base}/api/twilio/voice/low-latency-status?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(streamToken)}`;
  }

  function getTwilioAuthToken() {
    return stringEnv('TWILIO_AUTH_TOKEN', '');
  }

  function getDeepgramRealtimeUrl() {
    const url = new URL(DEEPGRAM_REALTIME_URL);
    url.searchParams.set('encoding', stringEnv('COLDCALL_LOW_LATENCY_STT_ENCODING', 'mulaw'));
    url.searchParams.set('sample_rate', String(parseIntSafe(env.COLDCALL_LOW_LATENCY_STT_SAMPLE_RATE, 8000)));
    url.searchParams.set('channels', '1');
    url.searchParams.set('language', stringEnv('COLDCALL_LOW_LATENCY_STT_LANGUAGE', 'nl'));
    url.searchParams.set('model', stringEnv('COLDCALL_LOW_LATENCY_STT_MODEL', 'nova-3'));
    url.searchParams.set('interim_results', 'true');
    url.searchParams.set('vad_events', 'true');
    url.searchParams.set('endpointing', String(parseIntSafe(env.COLDCALL_LOW_LATENCY_STT_ENDPOINTING_MS, 300)));
    url.searchParams.set('utterance_end_ms', String(parseIntSafe(env.COLDCALL_LOW_LATENCY_STT_UTTERANCE_END_MS, 700)));
    url.searchParams.set('punctuate', 'true');
    url.searchParams.set('smart_format', 'true');
    return url.toString();
  }

  function getElevenLabsVoiceId() {
    return stringEnv('COLDCALL_LOW_LATENCY_ELEVEN_VOICE_ID', stringEnv('VAPI_COLDCALL_VOICE_ID', ''));
  }

  function getElevenLabsModel() {
    return stringEnv('COLDCALL_LOW_LATENCY_ELEVEN_MODEL', stringEnv('VAPI_COLDCALL_11LABS_MODEL', 'eleven_flash_v2_5'));
  }

  function getElevenLabsRealtimeUrl() {
    const voiceId = getElevenLabsVoiceId();
    const url = new URL(`${ELEVENLABS_REALTIME_URL}/text-to-speech/${encodeURIComponent(voiceId)}/multi-stream-input`);
    url.searchParams.set('model_id', getElevenLabsModel());
    url.searchParams.set('language_code', stringEnv('COLDCALL_LOW_LATENCY_TTS_LANGUAGE', 'nl'));
    url.searchParams.set('output_format', stringEnv('COLDCALL_LOW_LATENCY_TTS_OUTPUT_FORMAT', 'ulaw_8000'));
    url.searchParams.set('auto_mode', boolEnv('COLDCALL_LOW_LATENCY_TTS_AUTO_MODE', true) ? 'true' : 'false');
    url.searchParams.set('sync_alignment', 'false');
    url.searchParams.set('inactivity_timeout', String(parseIntSafe(env.COLDCALL_LOW_LATENCY_TTS_INACTIVITY_TIMEOUT, 180)));
    url.searchParams.set('enable_ssml_parsing', 'false');
    return url.toString();
  }

  function getElevenLabsVoiceSettings() {
    return {
      stability: Math.max(0, Math.min(1, numberEnv('COLDCALL_LOW_LATENCY_VOICE_STABILITY', 0.45))),
      similarity_boost: Math.max(0, Math.min(1, numberEnv('COLDCALL_LOW_LATENCY_VOICE_SIMILARITY_BOOST', 0.8))),
      style: Math.max(0, Math.min(1, numberEnv('COLDCALL_LOW_LATENCY_VOICE_STYLE', 0))),
      speed: Math.max(0.9, Math.min(1.15, numberEnv('COLDCALL_LOW_LATENCY_VOICE_SPEED', 1))),
      use_speaker_boost: boolEnv('COLDCALL_LOW_LATENCY_VOICE_SPEAKER_BOOST', false),
    };
  }

  function getElevenLabsChunkLengthSchedule() {
    const raw = normalizeString(env.COLDCALL_LOW_LATENCY_TTS_CHUNK_LENGTH_SCHEDULE);
    if (!raw) return [70, 120, 180, 260];
    const values = raw
      .split(',')
      .map((value) => parseIntSafe(value, 0))
      .filter((value) => value > 0);
    return values.length ? values : [70, 120, 180, 260];
  }

  function getLowLatencyHealth() {
    return {
      enabled: isEnabled(),
      runtimeCapable: isRuntimeCapable(),
      missingEnv: getMissingEnv(),
      mediaStreamPath: getMediaStreamPath(),
      websocketAttached: Boolean(websocketServer),
      activeSessions: sessionsById.size,
      cachedBridgePhrases: Array.from(bridgeAudioCache.keys()),
    };
  }

  function clampConversation(messages) {
    const maxMessages = Math.max(6, Math.min(24, parseIntSafe(env.COLDCALL_LOW_LATENCY_CONVERSATION_MESSAGES, 14)));
    return messages.slice(-maxMessages);
  }

  function buildDefaultSystemPrompt(lead, campaign) {
    return [
      'JE ROL:',
      'Je bent Ruben van Softora.nl en belt een Nederlandse prospect over websites en online groei.',
      '',
      'GESPREKSSTIJL:',
      '- Spreek natuurlijk, rustig en menselijk Nederlands.',
      '- Klink niet als een chatbot.',
      '- Reageer direct en zonder onnatuurlijke stiltes.',
      '- Houd je antwoorden compact tenzij de prospect duidelijk om meer uitleg vraagt.',
      '- Stel meestal maar 1 vervolgvraag tegelijk.',
      '- Geen markdown, geen lijstjes, geen toneelregie.',
      '',
      'DOEL:',
      '- Eerst begrijpen wie je spreekt en of er behoefte is aan een betere of nieuwe website.',
      '- Vervolgens, als er interesse is, richting een korte intake of vervolggesprek bewegen.',
      '',
      'CONTEXT PROSPECT:',
      `- Naam: ${normalizeString(lead?.name) || 'onbekend'}`,
      `- Bedrijf: ${normalizeString(lead?.company) || 'onbekend'}`,
      `- Sector: ${normalizeString(campaign?.sector) || 'onbekend'}`,
      `- Regio: ${normalizeString(lead?.region || campaign?.region) || 'onbekend'}`,
      normalizeString(campaign?.extraInstructions)
        ? `- Extra instructies: ${normalizeString(campaign.extraInstructions)}`
        : '- Extra instructies: geen',
      '',
      'BELANGRIJK:',
      '- Als iemand alleen hallo zegt, antwoord direct met een korte natuurlijke opener en ga verder.',
      '- Breek niet midden in een zin af.',
      '- Als iemand afhaakt of geen interesse heeft, respecteer dat kort en professioneel.',
    ].join('\n');
  }

  function buildSession(lead, campaign) {
    const phoneE164 = normalizeNlPhoneToE164(lead.phone);
    return {
      id: crypto.randomUUID(),
      streamToken: crypto.randomBytes(16).toString('hex'),
      createdAt: new Date().toISOString(),
      updatedAt: Date.now(),
      lead: {
        name: normalizeString(lead.name),
        company: normalizeString(lead.company),
        phone: phoneE164,
        region: normalizeString(lead.region),
      },
      campaign: {
        amount: parseIntSafe(campaign.amount, 1),
        sector: normalizeString(campaign.sector),
        region: normalizeString(campaign.region),
        minProjectValue: parseNumberSafe(campaign.minProjectValue, null),
        maxDiscountPct: parseNumberSafe(campaign.maxDiscountPct, null),
        extraInstructions: normalizeString(campaign.extraInstructions),
        dispatchMode: normalizeString(campaign.dispatchMode),
        dispatchDelaySeconds: parseNumberSafe(campaign.dispatchDelaySeconds, 0),
      },
      systemPrompt: normalizeString(env.COLDCALL_LOW_LATENCY_SYSTEM_PROMPT) || buildDefaultSystemPrompt(lead, campaign),
      conversation: [],
      status: 'queued',
      lastError: '',
      twilio: {
        callSid: '',
        streamSid: '',
        ws: null,
        lastMediaAt: 0,
      },
      stt: {
        ws: null,
        ready: false,
        finalSegments: [],
        lastInterimTranscript: '',
        lastFinalizedTranscript: '',
      },
      tts: {
        ws: null,
        ready: false,
        readyPromise: null,
        contexts: new Map(),
      },
      ai: {
        turnId: 0,
        currentTurn: null,
        responding: false,
        abortController: null,
      },
      metrics: {
        turns: [],
      },
    };
  }

  function emitCallUpdate(session, patch = {}) {
    const nowIso = new Date().toISOString();
    const callId = normalizeString(patch.callId || session?.twilio?.callSid || session?.id || '');
    if (!callId) return;
    onCallUpdate({
      callId,
      phone: normalizeString(session?.lead?.phone || patch.phone || ''),
      company: normalizeString(session?.lead?.company || patch.company || ''),
      name: normalizeString(session?.lead?.name || patch.name || ''),
      status: normalizeString(patch.status || session?.status || ''),
      messageType: normalizeString(patch.messageType || 'twilio-low-latency.update'),
      summary: normalizeString(patch.summary || ''),
      transcriptSnippet: normalizeString(patch.transcriptSnippet || ''),
      endedReason: normalizeString(patch.endedReason || ''),
      latencyProfile: 'low-latency-rt',
      source: 'twilio-low-latency',
      startedAt: normalizeString(patch.startedAt || ''),
      endedAt: normalizeString(patch.endedAt || ''),
      durationSeconds: parseNumberSafe(patch.durationSeconds, null),
      recordingUrl: normalizeString(patch.recordingUrl || ''),
      updatedAt: nowIso,
      updatedAtMs: Date.now(),
    });
  }

  function xmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;');
  }

  function toAbsoluteRequestUrl(req) {
    const base = getPublicBaseUrl();
    if (base) {
      return new URL(req.originalUrl || req.url || '/', base).toString();
    }
    const proto = normalizeString(req.get?.('x-forwarded-proto') || '').split(',')[0] || req.protocol || 'https';
    const host = normalizeString(req.get?.('x-forwarded-host') || '').split(',')[0] || req.get?.('host') || 'localhost';
    return new URL(req.originalUrl || req.url || '/', `${proto}://${host}`).toString();
  }

  function computeTwilioRequestSignature(url, params, authToken) {
    const payload = [url];
    const entries = Object.entries(params || {}).sort(([left], [right]) => left.localeCompare(right));
    for (const [key, rawValue] of entries) {
      if (Array.isArray(rawValue)) {
        rawValue.forEach((value) => {
          payload.push(key, String(value ?? ''));
        });
      } else {
        payload.push(key, String(rawValue ?? ''));
      }
    }
    return crypto.createHmac('sha1', authToken).update(payload.join(''), 'utf8').digest('base64');
  }

  function isTwilioHttpRequestAuthorized(req) {
    if (boolEnv('COLDCALL_LOW_LATENCY_SKIP_TWILIO_SIGNATURE_CHECK', false)) {
      return true;
    }
    const authToken = getTwilioAuthToken();
    if (!authToken) {
      return false;
    }
    const signature = normalizeString(req.get?.('x-twilio-signature') || '');
    if (!signature) {
      return false;
    }
    const expected = computeTwilioRequestSignature(toAbsoluteRequestUrl(req), req.body || {}, authToken);
    return signature === expected;
  }

  function buildVoiceResponseTwiml(session) {
    const streamUrl = `${getWebSocketBaseUrl()}${getMediaStreamPath()}`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Connect>',
      `    <Stream url="${xmlEscape(streamUrl)}">`,
      `      <Parameter name="sessionId" value="${xmlEscape(session.id)}" />`,
      `      <Parameter name="streamToken" value="${xmlEscape(session.streamToken)}" />`,
      '    </Stream>',
      '  </Connect>',
      '</Response>',
    ].join('\n');
  }

  async function createTwilioOutboundCall(session) {
    const auth = Buffer.from(`${stringEnv('TWILIO_ACCOUNT_SID')}:${stringEnv('TWILIO_AUTH_TOKEN')}`).toString('base64');
    const params = new URLSearchParams();
    params.set('To', session.lead.phone);
    params.set('From', getTwilioPhoneNumber());
    params.set('Url', getTwilioVoiceWebhookUrl(session.id, session.streamToken));
    params.set('Method', 'POST');
    params.set('StatusCallback', getTwilioStatusWebhookUrl(session.id, session.streamToken));
    params.set('StatusCallbackMethod', 'POST');
    params.append('StatusCallbackEvent', 'initiated');
    params.append('StatusCallbackEvent', 'ringing');
    params.append('StatusCallbackEvent', 'answered');
    params.append('StatusCallbackEvent', 'completed');

    const response = await fetch(
      `${TWILIO_API_BASE_URL}/Accounts/${encodeURIComponent(stringEnv('TWILIO_ACCOUNT_SID'))}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      }
    );

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.message || data?.detail || `Twilio call start fout (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  async function fetchElevenLabsBridgeAudio(phrase) {
    const voiceId = getElevenLabsVoiceId();
    const response = await fetch(`${ELEVENLABS_API_BASE_URL}/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': stringEnv('ELEVENLABS_API_KEY'),
        'Content-Type': 'application/json',
        Accept: 'audio/basic',
      },
      body: JSON.stringify({
        text: phrase,
        model_id: getElevenLabsModel(),
        output_format: stringEnv('COLDCALL_LOW_LATENCY_TTS_OUTPUT_FORMAT', 'ulaw_8000'),
        language_code: stringEnv('COLDCALL_LOW_LATENCY_TTS_LANGUAGE', 'nl'),
        voice_settings: getElevenLabsVoiceSettings(),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`ElevenLabs bridge audio fout (${response.status}): ${detail}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  }

  function warmBridgeAudioCache() {
    if (bridgeAudioWarmupPromise) return bridgeAudioWarmupPromise;
    bridgeAudioWarmupPromise = Promise.all(
      getBridgePhrases().map(async (phrase) => {
        try {
          const audioBase64 = await fetchElevenLabsBridgeAudio(phrase);
          bridgeAudioCache.set(phrase, {
            audioBase64,
            cachedAt: Date.now(),
          });
        } catch (error) {
          console.warn('[LowLatency][BridgeWarmupError]', error?.message || error);
        }
      })
    )
      .catch((error) => {
        console.warn('[LowLatency][BridgeWarmupError]', error?.message || error);
      })
      .finally(() => {
        bridgeAudioWarmupPromise = null;
      });
    return bridgeAudioWarmupPromise;
  }

  function pickBridgePhrase(session) {
    const phrases = getBridgePhrases();
    const nextIndex = session.ai.turnId % phrases.length;
    return phrases[nextIndex] || phrases[0];
  }

  function getSessionByCallSid(callSid) {
    const sessionId = sessionsByCallSid.get(normalizeString(callSid));
    return sessionId ? sessionsById.get(sessionId) || null : null;
  }

  function safeJsonParse(input) {
    try {
      return JSON.parse(String(input || ''));
    } catch {
      return null;
    }
  }

  function touchSession(session) {
    session.updatedAt = Date.now();
  }

  function closeSocketQuietly(socket) {
    if (!socket) return;
    try {
      socket.close();
    } catch {}
  }

  function terminateSocketQuietly(socket) {
    if (!socket) return;
    try {
      socket.terminate();
    } catch {}
  }

  function cleanupSession(session, reason = 'cleanup') {
    if (!session) return;
    if (session.stt?.ws) {
      closeSocketQuietly(session.stt.ws);
      session.stt.ws = null;
      session.stt.ready = false;
    }
    if (session.tts?.ws) {
      closeSocketQuietly(session.tts.ws);
      session.tts.ws = null;
      session.tts.ready = false;
      session.tts.readyPromise = null;
      session.tts.contexts.clear();
    }
    if (session.ai?.abortController) {
      try {
        session.ai.abortController.abort(reason);
      } catch {}
      session.ai.abortController = null;
    }
    if (session.twilio?.ws) {
      terminateSocketQuietly(session.twilio.ws);
      session.twilio.ws = null;
    }
    if (session.twilio?.callSid) {
      sessionsByCallSid.delete(session.twilio.callSid);
    }
    sessionsById.delete(session.id);
  }

  function scheduleSessionCleanup(session, delayMs = SESSION_RETENTION_MS) {
    setTimeout(() => {
      const current = sessionsById.get(session.id);
      if (!current) return;
      cleanupSession(current, 'retention-expired');
    }, Math.max(15_000, delayMs)).unref?.();
  }

  function sendTwilioMessage(session, payload) {
    if (!session?.twilio?.ws || session.twilio.ws.readyState !== WebSocket.OPEN || !session.twilio.streamSid) {
      return false;
    }
    session.twilio.ws.send(
      JSON.stringify({
        ...payload,
        streamSid: session.twilio.streamSid,
      })
    );
    session.twilio.lastMediaAt = Date.now();
    return true;
  }

  function sendTwilioMedia(session, audioBase64, meta = {}) {
    if (!audioBase64) return false;
    const sent = sendTwilioMessage(session, {
      event: 'media',
      media: {
        payload: audioBase64,
      },
    });
    if (sent && meta.turn) {
      if (!meta.turn.firstAudioQueuedAt) {
        meta.turn.firstAudioQueuedAt = Date.now();
      }
      meta.turn.lastAudioQueuedAt = Date.now();
    }
    return sent;
  }

  function sendTwilioClear(session) {
    sendTwilioMessage(session, { event: 'clear' });
  }

  function interruptCurrentTurn(session, reason = 'interrupted') {
    const currentTurn = session.ai.currentTurn;
    if (!currentTurn) return;
    currentTurn.interruptedAt = Date.now();
    currentTurn.interruptReason = reason;
    if (session.ai.abortController) {
      try {
        session.ai.abortController.abort(reason);
      } catch {}
      session.ai.abortController = null;
    }
    if (session.tts?.ws && session.tts.ws.readyState === WebSocket.OPEN) {
      for (const contextId of currentTurn.contextIds || []) {
        try {
          session.tts.ws.send(JSON.stringify({ context_id: contextId, close_context: true }));
        } catch {}
      }
    }
    sendTwilioClear(session);
    session.ai.responding = false;
    session.ai.currentTurn = null;
  }

  async function ensureDeepgramSocket(session) {
    if (session.stt.ws && session.stt.ws.readyState === WebSocket.OPEN) return session.stt.ws;
    if (session.stt.connectPromise) return session.stt.connectPromise;

    session.stt.connectPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(getDeepgramRealtimeUrl(), {
        headers: {
          Authorization: `Token ${stringEnv('DEEPGRAM_API_KEY')}`,
        },
      });

      socket.on('open', () => {
        session.stt.ws = socket;
        session.stt.ready = true;
        resolve(socket);
      });

      socket.on('error', (error) => {
        reject(error);
      });

      socket.on('close', () => {
        session.stt.ready = false;
        session.stt.ws = null;
        session.stt.connectPromise = null;
      });

      socket.on('message', (raw) => {
        const data = safeJsonParse(raw);
        if (!data) return;
        handleDeepgramMessage(session, data);
      });
    }).catch((error) => {
      session.lastError = error?.message || 'Deepgram connect fout';
      session.stt.connectPromise = null;
      throw error;
    });

    return session.stt.connectPromise;
  }

  async function ensureElevenLabsSocket(session) {
    if (session.tts.ws && session.tts.ws.readyState === WebSocket.OPEN) return session.tts.ws;
    if (session.tts.readyPromise) return session.tts.readyPromise;

    session.tts.readyPromise = new Promise((resolve, reject) => {
      const socket = new WebSocket(getElevenLabsRealtimeUrl(), {
        headers: {
          'xi-api-key': stringEnv('ELEVENLABS_API_KEY'),
        },
      });

      socket.on('open', () => {
        session.tts.ws = socket;
        session.tts.ready = true;
        resolve(socket);
      });

      socket.on('error', (error) => {
        reject(error);
      });

      socket.on('close', () => {
        session.tts.ready = false;
        session.tts.ws = null;
        session.tts.readyPromise = null;
        session.tts.contexts.clear();
      });

      socket.on('message', (raw) => {
        const data = safeJsonParse(raw);
        if (!data) return;
        handleElevenLabsMessage(session, data);
      });
    }).catch((error) => {
      session.lastError = error?.message || 'ElevenLabs connect fout';
      session.tts.readyPromise = null;
      throw error;
    });

    return session.tts.readyPromise;
  }

  function getCurrentTurnContext(session, contextId) {
    return session.tts.contexts.get(contextId) || null;
  }

  function handleElevenLabsMessage(session, data) {
    const contextId = normalizeString(data.context_id || data.contextId || '');
    const context = contextId ? getCurrentTurnContext(session, contextId) : null;
    if (data.audio && context?.turn) {
      if (!context.turn.firstAudioQueuedAt) {
        context.turn.firstAudioQueuedAt = Date.now();
      }
      sendTwilioMedia(session, data.audio, { turn: context.turn });
    }
    if (data.isFinal && context?.turn) {
      context.turn.ttsCompletedAt = Date.now();
      session.tts.contexts.delete(contextId);
      if (session.ai.currentTurn && session.ai.currentTurn.id === context.turn.id) {
        session.ai.responding = false;
        session.ai.currentTurn = null;
      }
    }
  }

  function normalizeTranscript(text) {
    return normalizeString(String(text || '').replace(/\s+/g, ' '));
  }

  function wordCount(text) {
    return normalizeTranscript(text)
      .split(' ')
      .filter(Boolean).length;
  }

  function buildFinalTranscript(session) {
    const transcript = normalizeTranscript(session.stt.finalSegments.join(' '));
    if (transcript) return transcript;
    return normalizeTranscript(session.stt.lastInterimTranscript);
  }

  function resetTranscriptBuffer(session) {
    session.stt.finalSegments = [];
    session.stt.lastInterimTranscript = '';
  }

  function finalizeUserUtterance(session, source = 'speech-final') {
    const transcript = buildFinalTranscript(session);
    resetTranscriptBuffer(session);
    if (!transcript) return;
    if (transcript === session.stt.lastFinalizedTranscript) return;
    session.stt.lastFinalizedTranscript = transcript;
    void respondToUser(session, transcript, source).catch((error) => {
      console.warn('[LowLatency][RespondError]', error?.message || error);
      session.lastError = error?.message || 'Respond fout';
    });
  }

  function handleDeepgramMessage(session, data) {
    touchSession(session);
    const type = normalizeString(data.type || '');
    if (type === 'Results') {
      const transcript = normalizeTranscript(data.channel?.alternatives?.[0]?.transcript || '');
      if (!transcript) return;
      session.stt.lastInterimTranscript = transcript;

      if (session.ai.responding && wordCount(transcript) >= 2) {
        interruptCurrentTurn(session, 'barge-in');
      }

      if (data.is_final) {
        const lastSegment = session.stt.finalSegments[session.stt.finalSegments.length - 1] || '';
        if (lastSegment !== transcript) {
          session.stt.finalSegments.push(transcript);
        }
      }

      if (data.speech_final) {
        finalizeUserUtterance(session, 'speech-final');
      }
      return;
    }

    if (type === 'UtteranceEnd') {
      finalizeUserUtterance(session, 'utterance-end');
    }
  }

  function createTurn(session, userText, triggerSource) {
    const turn = {
      id: ++session.ai.turnId,
      userText,
      triggerSource,
      startedAt: Date.now(),
      modelFirstTokenAt: 0,
      firstAudioQueuedAt: 0,
      ttsCompletedAt: 0,
      pendingSpeechBuffer: '',
      assistantText: '',
      contextIds: [],
      ttsQueue: Promise.resolve(),
    };
    session.metrics.turns.push(turn);
    return turn;
  }

  function findSentenceBoundaryIndex(text) {
    const match = /^(.*?[.!?])(?:\s|$)/s.exec(text);
    if (!match) return -1;
    return match[1].length;
  }

  function findSoftBoundaryIndex(text) {
    if (text.length < 60) return -1;
    const pivot = Math.min(text.length, 140);
    const slice = text.slice(0, pivot);
    const lastComma = Math.max(slice.lastIndexOf(','), slice.lastIndexOf(';'), slice.lastIndexOf(':'));
    if (lastComma >= 32) return lastComma + 1;
    const lastSpace = slice.lastIndexOf(' ');
    return lastSpace >= 40 ? lastSpace + 1 : pivot;
  }

  function splitSpeakableChunks(buffer, force = false) {
    const chunks = [];
    let remaining = buffer;

    while (remaining) {
      const sentenceBoundary = findSentenceBoundaryIndex(remaining);
      if (sentenceBoundary > 0) {
        chunks.push({ text: remaining.slice(0, sentenceBoundary), flush: true });
        remaining = remaining.slice(sentenceBoundary).trimStart();
        continue;
      }

      if (!force) {
        const softBoundary = findSoftBoundaryIndex(remaining);
        if (softBoundary <= 0) break;
        chunks.push({ text: remaining.slice(0, softBoundary), flush: false });
        remaining = remaining.slice(softBoundary).trimStart();
        continue;
      }

      chunks.push({ text: remaining, flush: true });
      remaining = '';
    }

    return { chunks, remaining };
  }

  function enqueueTurnSpeech(turn, task) {
    turn.ttsQueue = turn.ttsQueue.then(task).catch((error) => {
      console.warn('[LowLatency][TTSQueueError]', error?.message || error);
    });
    return turn.ttsQueue;
  }

  async function sendElevenLabsContextText(session, turn, chunk, options = {}) {
    if (!chunk) return;
    const socket = await ensureElevenLabsSocket(session);
    const contextId = options.contextId || `turn-${turn.id}`;
    if (!session.tts.contexts.has(contextId)) {
      session.tts.contexts.set(contextId, {
        turn,
        initialized: false,
      });
    }
    const context = session.tts.contexts.get(contextId);
    const payload = {
      context_id: contextId,
      text: chunk,
    };
    if (!context.initialized) {
      payload.voice_settings = getElevenLabsVoiceSettings();
      payload.generation_config = {
        chunk_length_schedule: getElevenLabsChunkLengthSchedule(),
      };
      context.initialized = true;
      turn.contextIds.push(contextId);
    }
    if (options.flush) {
      payload.flush = true;
    } else {
      payload.try_trigger_generation = true;
    }
    socket.send(JSON.stringify(payload));
  }

  async function closeElevenLabsContext(session, contextId) {
    const socket = await ensureElevenLabsSocket(session);
    socket.send(JSON.stringify({ context_id: contextId, close_context: true }));
  }

  function queueAssistantSpeechDelta(session, turn, deltaText, isFinal = false) {
    turn.assistantText += deltaText;
    turn.pendingSpeechBuffer += deltaText;
    const { chunks, remaining } = splitSpeakableChunks(turn.pendingSpeechBuffer, isFinal);
    turn.pendingSpeechBuffer = remaining;

    for (const chunk of chunks) {
      const normalizedChunk = normalizeString(chunk.text);
      if (!normalizedChunk) continue;
      enqueueTurnSpeech(turn, async () => {
        await sendElevenLabsContextText(session, turn, normalizedChunk, {
          contextId: `turn-${turn.id}`,
          flush: chunk.flush,
        });
      });
    }

    if (isFinal) {
      enqueueTurnSpeech(turn, async () => {
        await closeElevenLabsContext(session, `turn-${turn.id}`);
      });
    }
  }

  async function streamAnthropicTurn(session, turn) {
    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY ontbreekt voor low-latency route');
    }

    const abortController = new AbortController();
    session.ai.abortController = abortController;
    session.ai.currentTurn = turn;
    session.ai.responding = true;

    const response = await fetch(`${getAnthropicApiBaseUrl()}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': stringEnv('ANTHROPIC_API_VERSION', '2023-06-01'),
      },
      body: JSON.stringify({
        model: getAnthropicModel(),
        system: session.systemPrompt,
        max_tokens: getAnthropicMaxTokens(),
        temperature: getAnthropicTemperature(),
        stream: true,
        messages: clampConversation(session.conversation),
      }),
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic streaming fout (${response.status}): ${detail}`);
    }

    const reader = response.body.getReader();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += Buffer.from(value).toString('utf8');

      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex !== -1) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        const lines = rawEvent.split('\n');
        let eventName = '';
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
          }
        }
        if (!dataLines.length) continue;
        const payload = safeJsonParse(dataLines.join('\n'));
        if (!payload) continue;

        if (eventName === 'content_block_delta' && payload.delta?.type === 'text_delta') {
          const delta = String(payload.delta.text || '');
          if (delta) {
            if (!turn.modelFirstTokenAt) {
              turn.modelFirstTokenAt = Date.now();
            }
            queueAssistantSpeechDelta(session, turn, delta, false);
          }
        }

        if (eventName === 'message_stop') {
          break;
        }
      }
    }

    queueAssistantSpeechDelta(session, turn, '', true);
    await turn.ttsQueue;
  }

  async function playBridgePhrase(session, turn) {
    const phrase = pickBridgePhrase(session);
    const cached = bridgeAudioCache.get(phrase);
    if (!cached?.audioBase64) return false;
    turn.bridgePhrase = phrase;
    return sendTwilioMedia(session, cached.audioBase64, { turn });
  }

  async function respondToUser(session, userText, triggerSource) {
    const normalizedUserText = normalizeTranscript(userText);
    if (!normalizedUserText) return;

    interruptCurrentTurn(session, 'new-user-turn');

    const turn = createTurn(session, normalizedUserText, triggerSource);
    session.conversation.push({ role: 'user', content: normalizedUserText });
    emitCallUpdate(session, {
      messageType: 'twilio-low-latency.user-turn',
      status: session.status,
      transcriptSnippet: normalizedUserText,
    });

    warmBridgeAudioCache();
    void ensureElevenLabsSocket(session).catch((error) => {
      console.warn('[LowLatency][ElevenConnectError]', error?.message || error);
    });
    void playBridgePhrase(session, turn);

    try {
      await streamAnthropicTurn(session, turn);
      const finalAssistantText = normalizeTranscript(turn.assistantText);
      if (finalAssistantText) {
        session.conversation.push({ role: 'assistant', content: finalAssistantText });
      }
      emitCallUpdate(session, {
        messageType: 'twilio-low-latency.assistant-turn',
        status: session.status,
        transcriptSnippet: normalizedUserText,
        summary: finalAssistantText,
      });
    } catch (error) {
      if (String(error?.name || '').toLowerCase() === 'aborterror') {
        return;
      }
      session.lastError = error?.message || 'Assistant response fout';
      console.warn('[LowLatency][AnthropicStreamError]', error?.message || error);
      const fallbackPhrase = bridgeAudioCache.get(getBridgePhrases()[0] || DEFAULT_BRIDGE_PHRASES[0]);
      if (fallbackPhrase?.audioBase64) {
        sendTwilioMedia(session, fallbackPhrase.audioBase64, { turn });
      }
    } finally {
      session.ai.responding = false;
      session.ai.abortController = null;
      if (session.ai.currentTurn && session.ai.currentTurn.id === turn.id) {
        session.ai.currentTurn = null;
      }
    }
  }

  async function handleTwilioMediaStart(session, ws, startPayload) {
    session.twilio.ws = ws;
    session.twilio.streamSid = normalizeString(startPayload.streamSid || '');
    session.twilio.callSid = normalizeString(startPayload.callSid || '');
    session.status = 'in-progress';
    touchSession(session);
    if (session.twilio.callSid) {
      sessionsByCallSid.set(session.twilio.callSid, session.id);
    }

    emitCallUpdate(session, {
      callId: session.twilio.callSid || session.id,
      status: session.status,
      messageType: 'twilio-low-latency.call-started',
      startedAt: new Date().toISOString(),
    });

    warmBridgeAudioCache();
    await ensureDeepgramSocket(session);
  }

  function handleTwilioMediaEvent(session, mediaPayload) {
    if (!session?.stt?.ws || session.stt.ws.readyState !== WebSocket.OPEN) return;
    if (!mediaPayload?.payload) return;
    session.stt.ws.send(Buffer.from(String(mediaPayload.payload), 'base64'));
  }

  function handleTwilioStop(session) {
    if (!session) return;
    session.status = 'completed';
    emitCallUpdate(session, {
      callId: session.twilio.callSid || session.id,
      status: session.status,
      messageType: 'twilio-low-latency.stream-stopped',
      endedAt: new Date().toISOString(),
    });
    scheduleSessionCleanup(session, 2 * 60 * 1000);
  }

  function handleTwilioMediaConnection(ws) {
    let session = null;

    ws.on('message', (raw) => {
      const message = safeJsonParse(raw);
      if (!message) return;
      const event = normalizeString(message.event || '');

      if (event === 'start') {
        const customParameters = message.start?.customParameters || {};
        const sessionId = normalizeString(customParameters.sessionId || '');
        const streamToken = normalizeString(customParameters.streamToken || '');
        const candidate = sessionsById.get(sessionId) || null;
        if (!candidate || candidate.streamToken !== streamToken) {
          terminateSocketQuietly(ws);
          return;
        }
        session = candidate;
        void handleTwilioMediaStart(session, ws, message.start || {}).catch((error) => {
          console.warn('[LowLatency][TwilioStartError]', error?.message || error);
          terminateSocketQuietly(ws);
        });
        return;
      }

      if (!session) return;
      if (event === 'media') {
        handleTwilioMediaEvent(session, message.media || {});
        return;
      }

      if (event === 'stop') {
        handleTwilioStop(session);
      }
    });

    ws.on('close', () => {
      if (session) {
        handleTwilioStop(session);
      }
    });
  }

  function attachWebSocketServer(server) {
    if (!server || typeof server.on !== 'function') {
      throw new Error('HTTP server ontbreekt voor low-latency websocket attach');
    }
    if (websocketServer) {
      return {
        attached: true,
        path: getMediaStreamPath(),
      };
    }

    websocketServer = new WebSocketServer({ noServer: true });
    const mediaStreamPath = getMediaStreamPath();

    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (pathname !== mediaStreamPath) {
        return;
      }
      websocketServer.handleUpgrade(request, socket, head, (ws) => {
        websocketServer.emit('connection', ws, request);
      });
    });

    websocketServer.on('connection', (ws) => {
      handleTwilioMediaConnection(ws);
    });

    return {
      attached: true,
      path: mediaStreamPath,
    };
  }

  async function startCallForLead(lead, campaign, index) {
    const session = buildSession(lead, campaign);
    sessionsById.set(session.id, session);

    try {
      const data = await createTwilioOutboundCall(session);
      session.status = normalizeString(data?.status || 'queued');
      session.twilio.callSid = normalizeString(data?.sid || '');
      if (session.twilio.callSid) {
        sessionsByCallSid.set(session.twilio.callSid, session.id);
      }
      emitCallUpdate(session, {
        callId: session.twilio.callSid || session.id,
        status: session.status,
        messageType: 'twilio-low-latency.call-created',
      });
      return {
        index,
        success: true,
        lead: {
          name: session.lead.name,
          company: session.lead.company,
          phone: lead.phone,
          phoneE164: session.lead.phone,
        },
        realtime: {
          sessionId: session.id,
          callSid: session.twilio.callSid,
          provider: 'twilio-media-stream',
        },
        vapi: {
          callId: session.twilio.callSid || session.id,
          status: session.status,
        },
      };
    } catch (error) {
      session.status = 'failed';
      session.lastError = error?.message || 'Twilio start fout';
      emitCallUpdate(session, {
        callId: session.twilio.callSid || session.id,
        status: session.status,
        messageType: 'twilio-low-latency.call-failed',
        endedReason: session.lastError,
      });
      scheduleSessionCleanup(session, 60_000);
      return {
        index,
        success: false,
        lead: {
          name: normalizeString(lead.name),
          company: normalizeString(lead.company),
          phone: normalizeString(lead.phone),
        },
        error: session.lastError,
        vapi: {
          callId: session.twilio.callSid || session.id,
          status: session.status,
        },
      };
    }
  }

  async function startLead(lead, campaign, index = 0) {
    if (!isEnabled()) {
      throw new Error('Low-latency coldcalling route staat uit. Zet COLDCALL_LOW_LATENCY_ENABLED=true.');
    }
    if (!isRuntimeCapable()) {
      throw new Error('Low-latency coldcalling route vereist een always-on Node runtime met WebSockets en draait niet in de huidige serverless runtime.');
    }
    const missingEnv = getMissingEnv();
    if (missingEnv.length > 0) {
      throw new Error(`Low-latency coldcalling mist env vars: ${missingEnv.join(', ')}`);
    }
    return startCallForLead(lead, campaign, index);
  }

  async function startBatch({ campaign, leads, sleep }) {
    if (!isEnabled()) {
      throw new Error('Low-latency coldcalling route staat uit. Zet COLDCALL_LOW_LATENCY_ENABLED=true.');
    }
    if (!isRuntimeCapable()) {
      throw new Error('Low-latency coldcalling route vereist een always-on Node runtime met WebSockets en draait niet in de huidige serverless runtime.');
    }
    const missingEnv = getMissingEnv();
    if (missingEnv.length > 0) {
      throw new Error(`Low-latency coldcalling mist env vars: ${missingEnv.join(', ')}`);
    }

    const leadsToProcess = leads.slice(0, Math.min(campaign.amount, leads.length));
    const dispatchMode = normalizeString(campaign.dispatchMode).toLowerCase() || 'sequential';
    const delayMs = Math.max(0, Math.round((parseNumberSafe(campaign.dispatchDelaySeconds, 0) || 0) * 1000));

    if (dispatchMode === 'parallel') {
      return Promise.all(leadsToProcess.map((lead, index) => startCallForLead(lead, campaign, index)));
    }

    const results = [];
    for (let index = 0; index < leadsToProcess.length; index += 1) {
      const lead = leadsToProcess[index];
      results.push(await startCallForLead(lead, campaign, index));
      const isLast = index === leadsToProcess.length - 1;
      if (!isLast && delayMs > 0) {
        await sleep(delayMs);
      }
    }
    return results;
  }

  function getSessionStatus(sessionId, callSid) {
    const normalizedSessionId = normalizeString(sessionId);
    const normalizedCallSid = normalizeString(callSid);
    const session =
      (normalizedSessionId ? sessionsById.get(normalizedSessionId) || null : null) ||
      (normalizedCallSid ? getSessionByCallSid(normalizedCallSid) : null);

    if (!session) return null;

    return {
      sessionId: session.id,
      callSid: session.twilio.callSid,
      status: session.status,
      lead: {
        name: session.lead.name,
        company: session.lead.company,
        phone: session.lead.phone,
      },
      lastError: session.lastError,
      turns: session.metrics.turns.map((turn) => ({
        id: turn.id,
        userText: turn.userText,
        bridgePhrase: turn.bridgePhrase || '',
        modelFirstTokenMs:
          turn.modelFirstTokenAt && turn.startedAt ? turn.modelFirstTokenAt - turn.startedAt : null,
        firstAudioQueuedMs:
          turn.firstAudioQueuedAt && turn.startedAt ? turn.firstAudioQueuedAt - turn.startedAt : null,
        ttsCompletedMs: turn.ttsCompletedAt && turn.startedAt ? turn.ttsCompletedAt - turn.startedAt : null,
        interruptedAtMs: turn.interruptedAt && turn.startedAt ? turn.interruptedAt - turn.startedAt : null,
      })),
    };
  }

  function handleVoiceWebhook(req, res) {
    if (!isTwilioHttpRequestAuthorized(req)) {
      return res.type('text/xml').status(403).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }
    const sessionId = normalizeString(req.query?.sessionId || req.body?.sessionId || '');
    const token = normalizeString(req.query?.token || req.body?.token || '');
    const session = sessionsById.get(sessionId) || null;
    if (!session || session.streamToken !== token) {
      return res.type('text/xml').status(404).send('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>');
    }
    return res.type('text/xml').status(200).send(buildVoiceResponseTwiml(session));
  }

  function handleStatusWebhook(req, res) {
    if (!isTwilioHttpRequestAuthorized(req)) {
      return res.status(403).json({ ok: false, error: 'Twilio signature ongeldig.' });
    }
    const sessionId = normalizeString(req.query?.sessionId || req.body?.sessionId || '');
    const token = normalizeString(req.query?.token || req.body?.token || '');
    const session = sessionsById.get(sessionId) || null;
    if (!session || session.streamToken !== token) {
      return res.status(404).json({ ok: false, error: 'Session niet gevonden.' });
    }

    const callSid = normalizeString(req.body?.CallSid || '');
    const callStatus = normalizeString(req.body?.CallStatus || '').toLowerCase();
    const callDuration = parseNumberSafe(req.body?.CallDuration, null);
    const recordingUrl = normalizeString(req.body?.RecordingUrl || '');

    if (callSid) {
      session.twilio.callSid = callSid;
      sessionsByCallSid.set(callSid, session.id);
    }

    if (callStatus) {
      session.status = callStatus;
    }

    emitCallUpdate(session, {
      callId: callSid || session.id,
      status: session.status,
      messageType: 'twilio-low-latency.status-callback',
      endedReason: callStatus,
      durationSeconds: callDuration,
      recordingUrl,
      endedAt: /completed|busy|failed|no-answer|canceled/.test(callStatus) ? new Date().toISOString() : '',
    });

    if (/completed|busy|failed|no-answer|canceled/.test(callStatus)) {
      scheduleSessionCleanup(session);
    }

    return res.status(200).json({ ok: true });
  }

  setInterval(() => {
    const now = Date.now();
    for (const session of sessionsById.values()) {
      if (now - session.updatedAt > SESSION_RETENTION_MS) {
        cleanupSession(session, 'stale-session');
      }
    }
  }, CLEANUP_INTERVAL_MS).unref?.();

  return {
    isEnabled,
    isRuntimeCapable,
    getMissingEnv,
    getHealth: getLowLatencyHealth,
    warmBridgeAudioCache,
    attachWebSocketServer,
    startLead,
    startBatch,
    handleVoiceWebhook,
    handleStatusWebhook,
    getSessionStatus,
  };
}

module.exports = {
  createLowLatencyColdcallingService,
};
