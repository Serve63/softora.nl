require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { mulaw } = require('alawmulaw');
const { createSpeechTurnState } = require('./audio-turn-state');
const {
  buildGeminiInitialRealtimeInputPayload,
  buildGeminiSetupPayload: buildGeminiSetupEnvelope,
  extractInlineAudioParts,
  parsePcmRateFromMime,
} = require('./gemini-payload');

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-live-preview';
const LEGACY_GEMINI_MODEL_ALIASES = new Map([
  ['gemini-live-2.5-flash-preview', DEFAULT_GEMINI_MODEL],
]);
const GEMINI_MODEL_REQUESTED_RAW = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
const GEMINI_MODEL_RAW =
  LEGACY_GEMINI_MODEL_ALIASES.get(GEMINI_MODEL_REQUESTED_RAW) || GEMINI_MODEL_REQUESTED_RAW;
const GEMINI_MODEL = GEMINI_MODEL_RAW.startsWith('models/')
  ? GEMINI_MODEL_RAW
  : `models/${GEMINI_MODEL_RAW}`;
const GEMINI_VOICE = String(process.env.GEMINI_VOICE || 'Puck').trim();
const BRIDGE_DEBUG_TOKEN = String(process.env.BRIDGE_DEBUG_TOKEN || '').trim();
const BRIDGE_VERBOSE_LOGS = /^(1|true|yes)$/i.test(String(process.env.BRIDGE_VERBOSE_LOGS || ''));
const GEMINI_WS_HANDSHAKE_TIMEOUT_MS = Math.max(
  3000,
  Math.min(20000, Number(process.env.GEMINI_WS_HANDSHAKE_TIMEOUT_MS || 10000) || 10000)
);
const MAX_PENDING_TWILIO_MEDIA_OUT = Math.max(
  50,
  Math.min(2000, Number(process.env.MAX_PENDING_TWILIO_MEDIA_OUT || 600) || 600)
);
const GEMINI_USE_MEDIA_CHUNKS_FOR_MIC = /^(1|true|yes)$/i.test(
  String(process.env.GEMINI_USE_MEDIA_CHUNKS_FOR_MIC || '')
);
const GEMINI_SYSTEM_PROMPT_LOCKED = !/^(0|false|no)$/i.test(
  String(process.env.GEMINI_SYSTEM_PROMPT_LOCKED || 'true')
);
const GEMINI_REQUIRE_CUSTOM_PROMPT = /^(1|true|yes)$/i.test(
  String(process.env.GEMINI_REQUIRE_CUSTOM_PROMPT || 'false')
);
const GEMINI_AUTO_START = !/^(0|false|no)$/i.test(String(process.env.GEMINI_AUTO_START || 'true'));
const GEMINI_VAD_START_SENSITIVITY = String(
  process.env.GEMINI_VAD_START_SENSITIVITY || 'START_SENSITIVITY_LOW'
).trim();
const GEMINI_VAD_END_SENSITIVITY = String(
  process.env.GEMINI_VAD_END_SENSITIVITY || 'END_SENSITIVITY_LOW'
).trim();
const GEMINI_VAD_PREFIX_PADDING_MS = Math.max(
  0,
  Math.min(500, Number(process.env.GEMINI_VAD_PREFIX_PADDING_MS || 120) || 120)
);
const GEMINI_VAD_SILENCE_DURATION_MS = Math.max(
  100,
  Math.min(2000, Number(process.env.GEMINI_VAD_SILENCE_DURATION_MS || 250) || 250)
);
const CALLER_SPEECH_RMS_THRESHOLD = Math.max(
  50,
  Math.min(12000, Number(process.env.CALLER_SPEECH_RMS_THRESHOLD || 1200) || 1200)
);
const CALLER_SPEECH_START_FRAMES = Math.max(
  1,
  Math.min(20, Number(process.env.CALLER_SPEECH_START_FRAMES || 4) || 4)
);
const CALLER_SPEECH_END_SILENCE_MS = Math.max(
  100,
  Math.min(5000, Number(process.env.CALLER_SPEECH_END_SILENCE_MS || 700) || 700)
);
const CALLER_BARGE_IN_SUPPRESSION_MS = Math.max(
  0,
  Math.min(3000, Number(process.env.CALLER_BARGE_IN_SUPPRESSION_MS || 220) || 220)
);
const GEMINI_PLAYBACK_ACTIVE_WINDOW_MS = Math.max(
  100,
  Math.min(3000, Number(process.env.GEMINI_PLAYBACK_ACTIVE_WINDOW_MS || 900) || 900)
);
const DEFAULT_SYSTEM_PROMPT = 'Je bent een vriendelijke Nederlandse sales assistent. Praat kort, helder en natuurlijk.';
const CUSTOM_SYSTEM_PROMPT = String(process.env.GEMINI_SYSTEM_PROMPT || '').replace(/\r/g, '').trim();
const SYSTEM_PROMPT = (CUSTOM_SYSTEM_PROMPT || DEFAULT_SYSTEM_PROMPT).trim();
const SYSTEM_PROMPT_SOURCE = CUSTOM_SYSTEM_PROMPT ? 'env:GEMINI_SYSTEM_PROMPT' : 'fallback:default';
const SYSTEM_PROMPT_FINGERPRINT = crypto
  .createHash('sha256')
  .update(SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);
const DEFAULT_INITIAL_MESSAGE = 'De call is nu verbonden. Begin direct met het gesprek.';
const CUSTOM_INITIAL_MESSAGE = String(process.env.GEMINI_INITIAL_MESSAGE || '').replace(/\r/g, '').trim();
const INITIAL_MESSAGE = (CUSTOM_INITIAL_MESSAGE || DEFAULT_INITIAL_MESSAGE).trim();
const INITIAL_MESSAGE_FINGERPRINT = crypto
  .createHash('sha256')
  .update(INITIAL_MESSAGE)
  .digest('hex')
  .slice(0, 16);

const PROMPT_OVERRIDE_QUERY_KEYS = [
  'prompt',
  'system_prompt',
  'systemPrompt',
  'system_instruction',
  'systemInstruction',
  'instructions',
];

function hasPromptOverrideHints(searchParams) {
  if (!searchParams || typeof searchParams.get !== 'function') return false;
  return PROMPT_OVERRIDE_QUERY_KEYS.some((key) => String(searchParams.get(key) || '').trim().length > 0);
}

function int16ArrayToBuffer(pcm) {
  const out = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i += 1) {
    out.writeInt16LE(pcm[i], i * 2);
  }
  return out;
}

function bufferToInt16Array(buffer) {
  const len = Math.floor(buffer.length / 2);
  const out = new Int16Array(len);
  for (let i = 0; i < len; i += 1) {
    out[i] = buffer.readInt16LE(i * 2);
  }
  return out;
}

function downsampleInt16(input, fromRate, toRate) {
  if (toRate >= fromRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const srcIndex = Math.min(input.length - 1, Math.floor(i * ratio));
    out[i] = input[srcIndex];
  }
  return out;
}

function buildGeminiWsUrl() {
  return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;
}

function buildGeminiSetupPayload() {
  return buildGeminiSetupEnvelope({
    model: GEMINI_MODEL,
    voiceName: GEMINI_VOICE,
    systemPrompt: SYSTEM_PROMPT,
    seedInitialHistory: false,
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: false,
        startOfSpeechSensitivity: GEMINI_VAD_START_SENSITIVITY,
        endOfSpeechSensitivity: GEMINI_VAD_END_SENSITIVITY,
        prefixPaddingMs: GEMINI_VAD_PREFIX_PADDING_MS,
        silenceDurationMs: GEMINI_VAD_SILENCE_DURATION_MS,
      },
      activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
    },
  });
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || '{}'));
  } catch {
    return null;
  }
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({
  noServer: true,
  perMessageDeflate: false,
});
const RECENT_SESSION_LIMIT = 20;
const recentSessions = [];

function recordRecentSession(session) {
  if (!session || typeof session !== 'object') return;
  recentSessions.unshift(session);
  if (recentSessions.length > RECENT_SESSION_LIMIT) recentSessions.length = RECENT_SESSION_LIMIT;
}

function summarizeGeminiMessage(msg) {
  const summary = {
    keys: Object.keys(msg || {}).slice(0, 8),
  };
  const serverContent = msg?.serverContent || msg?.server_content || null;
  if (serverContent && typeof serverContent === 'object') {
    const modelTurn = serverContent.modelTurn || serverContent.model_turn || {};
    const parts = Array.isArray(modelTurn.parts) ? modelTurn.parts : [];
    summary.serverContent = {
      interrupted: Boolean(serverContent.interrupted),
      turnComplete: Boolean(serverContent.turnComplete || serverContent.turn_complete),
      generationComplete: Boolean(
        serverContent.generationComplete || serverContent.generation_complete
      ),
      inputTranscription: Boolean(serverContent.inputTranscription || serverContent.input_transcription),
      outputTranscription: Boolean(
        serverContent.outputTranscription || serverContent.output_transcription
      ),
      modelTurnParts: parts.map((part) => {
        if (!part || typeof part !== 'object') return 'unknown';
        if (part.inlineData || part.inline_data) return 'inlineData';
        if (part.text) return 'text';
        return Object.keys(part)[0] || 'unknown';
      }),
    };
  }
  if (msg?.error) {
    summary.error = {
      message: String(msg.error?.message || ''),
      code: String(msg.error?.code || ''),
    };
  }
  return summary;
}

function isDebugRequestAuthorized(req) {
  if (!BRIDGE_DEBUG_TOKEN) return true;
  const queryToken = String(req.query?.token || '').trim();
  const headerToken = String(req.get('x-bridge-debug-token') || '').trim();
  return queryToken === BRIDGE_DEBUG_TOKEN || headerToken === BRIDGE_DEBUG_TOKEN;
}

function probeGeminiSetup(timeoutMs = 9000) {
  return new Promise((resolve) => {
    if (!GEMINI_API_KEY) {
      resolve({ ok: false, stage: 'config', error: 'GEMINI_API_KEY/GOOGLE_API_KEY ontbreekt' });
      return;
    }

    const ws = new WebSocket(buildGeminiWsUrl());
    let done = false;
    const timer = setTimeout(() => {
      finish({
        ok: false,
        stage: 'timeout',
        error: `Geen setupComplete binnen ${timeoutMs}ms`,
      });
    }, timeoutMs);

    function finish(payload) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
      } catch {}
      resolve(payload);
    }

    ws.on('open', () => {
      ws.send(JSON.stringify(buildGeminiSetupPayload()));
    });

    ws.on('message', (chunk) => {
      const msg = safeJsonParse(chunk.toString('utf8'));
      if (!msg || typeof msg !== 'object') return;
      if (msg.setupComplete) {
        finish({
          ok: true,
          stage: 'setupComplete',
          model: GEMINI_MODEL,
          voice: GEMINI_VOICE,
        });
        return;
      }
      if (msg.error) {
        finish({
          ok: false,
          stage: 'server-error',
          error: msg.error?.message || 'Onbekende Gemini server error',
          details: msg.error || null,
        });
      }
    });

    ws.on('error', (error) => {
      finish({
        ok: false,
        stage: 'socket-error',
        error: error?.message || String(error),
      });
    });

    ws.on('close', (code, reasonBuffer) => {
      finish({
        ok: false,
        stage: 'socket-close',
        code,
        reason: Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || ''),
      });
    });
  });
}

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'twilio-media-bridge',
    geminiConfigured: Boolean(GEMINI_API_KEY),
    requestedModel: GEMINI_MODEL_REQUESTED_RAW,
    model: GEMINI_MODEL,
    modelAliasApplied:
      GEMINI_MODEL_REQUESTED_RAW !== GEMINI_MODEL_RAW
        ? `${GEMINI_MODEL_REQUESTED_RAW} -> ${GEMINI_MODEL_RAW}`
        : '',
    voice: GEMINI_VOICE,
    latencyTuning: {
      wsPerMessageDeflate: false,
      geminiHandshakeTimeoutMs: GEMINI_WS_HANDSHAKE_TIMEOUT_MS,
    },
    prompt: {
      source: SYSTEM_PROMPT_SOURCE,
      customConfigured: Boolean(CUSTOM_SYSTEM_PROMPT),
      locked: GEMINI_SYSTEM_PROMPT_LOCKED,
      requireCustom: GEMINI_REQUIRE_CUSTOM_PROMPT,
      length: SYSTEM_PROMPT.length,
      fingerprint: SYSTEM_PROMPT_FINGERPRINT,
    },
    autoStart: {
      enabled: GEMINI_AUTO_START,
      length: INITIAL_MESSAGE.length,
      fingerprint: INITIAL_MESSAGE_FINGERPRINT,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/', (_req, res) => {
  res.status(200).send('twilio-media-bridge up');
});

app.get('/debug/gemini-setup', async (req, res) => {
  if (!isDebugRequestAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  const timeoutMs = Math.max(3000, Math.min(20000, Number(req.query?.timeoutMs || 9000) || 9000));
  const result = await probeGeminiSetup(timeoutMs);
  return res.status(result.ok ? 200 : 500).json({
    ...result,
    timestamp: new Date().toISOString(),
  });
});

app.get('/debug/recent-sessions', (req, res) => {
  if (!isDebugRequestAuthorized(req)) {
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  return res.status(200).json({
    ok: true,
    sessions: recentSessions,
    timestamp: new Date().toISOString(),
  });
});

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname !== '/twilio-media') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  try {
    socket.setNoDelay(true);
  } catch {}
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, url);
  });
});

wss.on('connection', (twilioWs, _request, url) => {
  const sessionSummary = {
    connectedAt: new Date().toISOString(),
    stack: String(url.searchParams.get('stack') || '').trim() || 'gemini_flash_3_1_live',
    streamSid: '',
    autoStart: GEMINI_AUTO_START,
    geminiReady: false,
    twilioMediaInCount: 0,
    geminiAudioOutCount: 0,
    audioStreamEndCount: 0,
    twilioClearCount: 0,
    bargeInCount: 0,
    serverInterruptedCount: 0,
    droppedGeminiAudioChunkCount: 0,
    geminiMessages: [],
    close: null,
  };
  let streamSid = '';
  let closed = false;
  let geminiReady = false;
  let autoStartSent = false;
  let sentConfigError = false;
  let twilioMediaInCount = 0;
  let geminiAudioOutCount = 0;
  let suppressGeminiAudioUntilMs = 0;
  let lastGeminiAudioSentAtMs = 0;
  const callerSpeechState = createSpeechTurnState({
    rmsThreshold: CALLER_SPEECH_RMS_THRESHOLD,
    startFrames: CALLER_SPEECH_START_FRAMES,
    endSilenceMs: CALLER_SPEECH_END_SILENCE_MS,
  });

  if (!GEMINI_API_KEY) {
    console.error('[Bridge] GEMINI_API_KEY/GOOGLE_API_KEY ontbreekt');
    twilioWs.close(1011, 'GEMINI_API_KEY ontbreekt');
    return;
  }
  if (GEMINI_REQUIRE_CUSTOM_PROMPT && !CUSTOM_SYSTEM_PROMPT) {
    console.error('[Bridge] GEMINI_SYSTEM_PROMPT ontbreekt terwijl GEMINI_REQUIRE_CUSTOM_PROMPT=true');
    twilioWs.close(1011, 'GEMINI_SYSTEM_PROMPT ontbreekt');
    return;
  }
  if (GEMINI_SYSTEM_PROMPT_LOCKED && hasPromptOverrideHints(url.searchParams)) {
    console.warn('[Bridge] Prompt override hints in query gedetecteerd en genegeerd (prompt lock actief).');
  }

  const stack = sessionSummary.stack;
  const geminiWs = new WebSocket(buildGeminiWsUrl(), {
    perMessageDeflate: false,
    handshakeTimeout: GEMINI_WS_HANDSHAKE_TIMEOUT_MS,
  });
  const connectionStartedAtMs = Date.now();
  try {
    if (twilioWs?._socket && typeof twilioWs._socket.setNoDelay === 'function') {
      twilioWs._socket.setNoDelay(true);
    }
  } catch {}

  const pendingUlawB64Out = [];

  function flushPendingUlawOut() {
    while (
      pendingUlawB64Out.length > 0 &&
      streamSid &&
      twilioWs.readyState === WebSocket.OPEN
    ) {
      const payload = pendingUlawB64Out.shift();
      twilioWs.send(
        JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload },
        })
      );
      geminiAudioOutCount += 1;
      sessionSummary.geminiAudioOutCount = geminiAudioOutCount;
    }
  }

  function clearTwilioBufferedAudio(reason = 'unknown') {
    pendingUlawB64Out.length = 0;
    if (!streamSid || twilioWs.readyState !== WebSocket.OPEN) return;
    twilioWs.send(
      JSON.stringify({
        event: 'clear',
        streamSid,
      })
    );
    sessionSummary.twilioClearCount += 1;
    if (BRIDGE_VERBOSE_LOGS) {
      console.log(`[Bridge] clear naar Twilio verstuurd (${reason})`);
    }
  }

  function isGeminiPlaybackLikelyActive(nowMs = Date.now()) {
    return (
      pendingUlawB64Out.length > 0 ||
      (lastGeminiAudioSentAtMs > 0 && nowMs - lastGeminiAudioSentAtMs <= GEMINI_PLAYBACK_ACTIVE_WINDOW_MS)
    );
  }

  function enqueueGeminiAudioToTwilio(ulawB64) {
    if (!ulawB64) return;
    const nowMs = Date.now();
    if (nowMs < suppressGeminiAudioUntilMs) {
      sessionSummary.droppedGeminiAudioChunkCount += 1;
      return;
    }
    if (streamSid && twilioWs.readyState === WebSocket.OPEN) {
      twilioWs.send(
        JSON.stringify({
          event: 'media',
          streamSid,
          media: { payload: ulawB64 },
        })
      );
      lastGeminiAudioSentAtMs = nowMs;
      geminiAudioOutCount += 1;
      sessionSummary.geminiAudioOutCount = geminiAudioOutCount;
      return;
    }
    if (twilioWs.readyState !== WebSocket.OPEN) return;
    if (pendingUlawB64Out.length >= MAX_PENDING_TWILIO_MEDIA_OUT) {
      pendingUlawB64Out.shift();
      if (BRIDGE_VERBOSE_LOGS) {
        console.warn('[Bridge] pending Twilio media uit buffer vol; oudste chunk gedropt');
      }
    }
    pendingUlawB64Out.push(ulawB64);
  }

  function closeBoth(reason = 'unknown') {
    if (closed) return;
    closed = true;
    callerSpeechState.reset();
    sessionSummary.close = sessionSummary.close || {
      reason,
      at: new Date().toISOString(),
      twilioMediaInCount,
      geminiAudioOutCount,
      streamSid: streamSid || '',
    };
    recordRecentSession({
      ...sessionSummary,
      geminiReady,
      twilioMediaInCount,
      geminiAudioOutCount,
      streamSid: streamSid || '',
    });
    try {
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close(1000, reason);
    } catch {}
    try {
      if (geminiWs.readyState === WebSocket.OPEN || geminiWs.readyState === WebSocket.CONNECTING) geminiWs.close();
    } catch {}
  }

  geminiWs.on('open', () => {
    try {
      if (geminiWs?._socket && typeof geminiWs._socket.setNoDelay === 'function') {
        geminiWs._socket.setNoDelay(true);
      }
    } catch {}
    geminiWs.send(JSON.stringify(buildGeminiSetupPayload()));
  });

  geminiWs.on('message', (chunk) => {
    const msg = safeJsonParse(chunk.toString('utf8'));
    if (!msg || typeof msg !== 'object') return;

    if (msg.setupComplete) {
      geminiReady = true;
      sessionSummary.geminiReady = true;
      if (BRIDGE_VERBOSE_LOGS) {
        console.log(`[Bridge] setupComplete stack=${stack}`);
      }
      if (GEMINI_AUTO_START && INITIAL_MESSAGE && !autoStartSent) {
        const initialPayload = buildGeminiInitialRealtimeInputPayload(INITIAL_MESSAGE);
        if (initialPayload) {
          geminiWs.send(JSON.stringify(initialPayload));
          autoStartSent = true;
          if (BRIDGE_VERBOSE_LOGS) {
            console.log('[Bridge] auto-start bericht naar Gemini verstuurd');
          }
        }
      }
      return;
    }

    if (msg.error) {
      console.error('[Bridge] Gemini server error:', JSON.stringify(msg.error));
    }

    sessionSummary.geminiMessages.push(summarizeGeminiMessage(msg));
    if (sessionSummary.geminiMessages.length > 12) sessionSummary.geminiMessages.shift();

    if (msg.error) return;

    const serverContent = msg.serverContent || msg.server_content || null;
    if (
      serverContent &&
      (serverContent.interrupted || serverContent.interrupted === true)
    ) {
      sessionSummary.serverInterruptedCount += 1;
      suppressGeminiAudioUntilMs = Date.now() + CALLER_BARGE_IN_SUPPRESSION_MS;
      if (isGeminiPlaybackLikelyActive()) {
        clearTwilioBufferedAudio('gemini-interrupted');
      }
    }

    const audioParts = extractInlineAudioParts(msg);
    if (!audioParts.length || twilioWs.readyState !== WebSocket.OPEN) return;

    audioParts.forEach((audio) => {
      try {
        const pcmBuffer = Buffer.from(audio.data, 'base64');
        if (!pcmBuffer.length) return;
        const sampleRate = parsePcmRateFromMime(audio.mimeType);
        const pcm16 = bufferToInt16Array(pcmBuffer);
        const downsampled = downsampleInt16(pcm16, sampleRate, 8000);
        const ulaw = mulaw.encode(downsampled);
        const payload = Buffer.from(ulaw).toString('base64');
        enqueueGeminiAudioToTwilio(payload);
      } catch (error) {
        console.error('[Bridge] Audio render fout:', error?.message || error);
      }
    });
  });

  geminiWs.on('error', (error) => {
    console.error('[Bridge] Gemini WS error:', error?.message || error);
    closeBoth('gemini-ws-error');
  });

  geminiWs.on('close', (code, reasonBuffer) => {
    const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
    console.warn(
      `[Bridge] Gemini WS close code=${code} reason="${reason}" upMs=${Date.now() - connectionStartedAtMs} in=${twilioMediaInCount} out=${geminiAudioOutCount}`
    );
    closeBoth('gemini-ws-close');
  });

  twilioWs.on('message', (chunk) => {
    const msg = safeJsonParse(chunk.toString('utf8'));
    if (!msg || typeof msg !== 'object') return;

    const event = String(msg.event || '').toLowerCase();
    if (BRIDGE_VERBOSE_LOGS && event && event !== 'media') {
      console.log(`[Bridge] Twilio event=${event}`);
    }
    if (event === 'start') {
      streamSid = String(
        msg.start?.streamSid ||
          msg.start?.StreamSid ||
          msg.streamSid ||
          msg.StreamSid ||
          ''
      ).trim();
      sessionSummary.streamSid = streamSid;
      if (BRIDGE_VERBOSE_LOGS) {
        console.log(`[Bridge] Twilio start streamSid=${streamSid || '(leeg)'}`);
      }
      flushPendingUlawOut();
      return;
    }
    if (event === 'stop') {
      closeBoth('twilio-stop');
      return;
    }
    if (event !== 'media') return;

    if (!geminiReady || geminiWs.readyState !== WebSocket.OPEN) return;
    const payload = String(msg.media?.payload || '');
    if (!payload) return;
    twilioMediaInCount += 1;
    sessionSummary.twilioMediaInCount = twilioMediaInCount;

    try {
      const ulaw = Uint8Array.from(Buffer.from(payload, 'base64'));
      const pcm16 = mulaw.decode(ulaw);
      const speechState = callerSpeechState.processPcmFrame(pcm16, Date.now());
      if (speechState.speechStarted && isGeminiPlaybackLikelyActive()) {
        sessionSummary.bargeInCount += 1;
        suppressGeminiAudioUntilMs = Date.now() + CALLER_BARGE_IN_SUPPRESSION_MS;
        clearTwilioBufferedAudio('caller-speech-start');
      }
      const pcmBuffer = int16ArrayToBuffer(pcm16);
      const b64 = pcmBuffer.toString('base64');
      const realtimePayload = GEMINI_USE_MEDIA_CHUNKS_FOR_MIC
        ? {
            realtimeInput: {
              mediaChunks: [
                {
                  mimeType: 'audio/pcm;rate=8000',
                  data: b64,
                },
              ],
            },
          }
        : {
            realtimeInput: {
              audio: {
                mimeType: 'audio/pcm;rate=8000',
                data: b64,
              },
            },
          };
      geminiWs.send(JSON.stringify(realtimePayload));
    } catch (error) {
      if (!sentConfigError) {
        sentConfigError = true;
        console.error('[Bridge] Twilio media decode fout:', error?.message || error);
      }
    }
  });

  twilioWs.on('close', (code, reasonBuffer) => {
    const reason = Buffer.isBuffer(reasonBuffer) ? reasonBuffer.toString('utf8') : String(reasonBuffer || '');
    console.warn(
      `[Bridge] Twilio WS close code=${code} reason="${reason}" upMs=${Date.now() - connectionStartedAtMs} stream=${streamSid || '-'} in=${twilioMediaInCount} out=${geminiAudioOutCount}`
    );
    closeBoth('twilio-close');
  });

  twilioWs.on('error', (error) => {
    console.error('[Bridge] Twilio WS error:', error?.message || error);
    closeBoth('twilio-ws-error');
  });

  console.log(
    `[Bridge] Connected stack=${stack} stream=${streamSid || '-'} model=${GEMINI_MODEL} voice=${GEMINI_VOICE}`
  );
});

server.listen(PORT, () => {
  console.log(`[Bridge] listening on :${PORT}`);
  if (GEMINI_MODEL_REQUESTED_RAW !== GEMINI_MODEL_RAW) {
    console.warn(
      `[Bridge] legacy model alias toegepast: ${GEMINI_MODEL_REQUESTED_RAW} -> ${GEMINI_MODEL_RAW}`
    );
  }
  console.log(`[Bridge] model=${GEMINI_MODEL}`);
  console.log(`[Bridge] geminiConfigured=${Boolean(GEMINI_API_KEY)}`);
});
