import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type JsonObject = Record<string, unknown>;
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

type BridgeSession = {
  connectionId: number;
  twilioWs: WebSocket;
  streamSid: string;
  callSid: string;
  customParameters: JsonObject;
  conversationInitiationPayload: JsonObject | null;
  conversationInitiationPayloadSent: boolean;
  elevenWs: WebSocket | null;
  elevenConnecting: boolean;
  elevenConnectAttempts: number;
  elevenUnavailable: boolean;
  elevenAgentOutputTelephony: boolean;
  bufferedUserAudioChunks: string[];
  lastAgentAudioAtMs: number;
  ambienceTickTimer: NodeJS.Timeout | null;
  ambienceNoiseA: number;
  ambienceNoiseB: number;
  ambienceLfoPhase: number;
  ambienceHumPhaseA: number;
  ambienceHumPhaseB: number;
  ambienceHumPhaseC: number;
  stopping: boolean;
};

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const WS_PATH = '/twilio-media';
const MAX_BUFFERED_TWILIO_AUDIO_CHUNKS = 200;
const ELEVENLABS_AGENT_ID = normalizeString(process.env.ELEVENLABS_AGENT_ID);
const ELEVENLABS_API_KEY = normalizeString(process.env.ELEVENLABS_API_KEY);
const ELEVENLABS_FIRST_MESSAGE = normalizeString(process.env.ELEVENLABS_FIRST_MESSAGE);
const ELEVENLABS_API_BASE_URL = normalizeString(process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io');
const VERBOSE_MEDIA_LOGS = /^(1|true|yes)$/i.test(normalizeString(process.env.VERBOSE_MEDIA_LOGS || ''));
const ELEVENLABS_SEND_USER_ACTIVITY_ON_OPEN = !/^(0|false|no)$/i.test(
  normalizeString(process.env.ELEVENLABS_SEND_USER_ACTIVITY_ON_OPEN || 'true')
);
const AMBIENCE_ENABLED = /^(1|true|yes)$/i.test(
  normalizeString(process.env.AMBIENCE_ENABLED || process.env.TWILIO_AMBIENCE_ENABLED || '')
);
const AMBIENCE_LEVEL = Math.max(
  0,
  Math.min(0.45, Number(process.env.AMBIENCE_LEVEL || process.env.TWILIO_AMBIENCE_LEVEL || 0.12) || 0.12)
);
const AMBIENCE_IDLE_TRIGGER_MS = Math.max(
  20,
  Math.min(500, Number(process.env.AMBIENCE_IDLE_TRIGGER_MS || 80) || 80)
);
const AMBIENCE_TICK_MS = 20;
const TELEPHONY_SAMPLE_RATE = 8000;
const TELEPHONY_FRAME_SAMPLES = 160;
const ULAW_SILENCE_BYTE = 0xff;

let connectionCounter = 0;

function log(level: LogLevel, message: string, meta?: JsonObject): void {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${ts}] [${level}] ${message}`, meta);
    return;
  }
  console.log(`[${ts}] [${level}] ${message}`);
}

function logVerbose(message: string, meta?: JsonObject): void {
  if (!VERBOSE_MEDIA_LOGS) return;
  log('INFO', message, meta);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorDetails(error: unknown): JsonObject {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack || '',
    };
  }
  return {
    errorMessage: String(error),
  };
}

function sanitizeUrlForLogs(rawUrl: string): string {
  const normalized = normalizeString(rawUrl);
  if (!normalized) return '';
  try {
    const url = new URL(normalized);
    if (url.username) url.username = 'REDACTED';
    if (url.password) url.password = 'REDACTED';
    for (const key of Array.from(url.searchParams.keys())) {
      url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return normalized;
  }
}

function getPathFromRequest(req: IncomingMessage): string {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    return url.pathname;
  } catch {
    return '/';
  }
}

function buildDynamicVariablesFromTwilioCustomParameters(parameters: JsonObject): JsonObject {
  const dynamicVariables: JsonObject = {};
  for (const [key, value] of Object.entries(parameters || {})) {
    const normalizedKey = normalizeString(key);
    const normalizedValue = normalizeString(value);
    if (!normalizedKey || !normalizedValue) continue;
    dynamicVariables[normalizedKey] = normalizedValue;
  }
  return dynamicVariables;
}

function buildConversationInitiationPayload(parameters: JsonObject): JsonObject | null {
  const dynamicVariables = buildDynamicVariablesFromTwilioCustomParameters(parameters);
  const payload: JsonObject = {
    type: 'conversation_initiation_client_data',
  };

  if (Object.keys(dynamicVariables).length > 0) {
    payload.dynamic_variables = dynamicVariables;
  }

  if (ELEVENLABS_FIRST_MESSAGE) {
    payload.conversation_config_override = {
      agent: {
        first_message: ELEVENLABS_FIRST_MESSAGE,
      },
    };
  }

  return payload;
}

function sendConversationInitiationPayload(session: BridgeSession, reason: string): void {
  const payload = session.conversationInitiationPayload;
  const elevenWs = session.elevenWs;
  if (!payload || session.conversationInitiationPayloadSent || !elevenWs) return;

  const ok = safeSendWsJson(elevenWs, payload);
  if (!ok) {
    log('WARN', 'elevenlabs conversation initiation payload not sent (socket not open)', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      reason,
    });
    return;
  }

  session.conversationInitiationPayloadSent = true;
  log('INFO', 'elevenlabs conversation initiation payload sent', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    reason,
    hasFirstMessageOverride: Boolean(ELEVENLABS_FIRST_MESSAGE),
    dynamicVariableKeys: Object.keys(asObject(payload.dynamic_variables) || {}),
  });
}

function extractTwilioCustomParameters(value: unknown): JsonObject {
  const raw = asObject(value);
  if (!raw) return {};

  const customParametersCandidate = asObject(raw.customParameters) || raw;
  const out: JsonObject = {};
  for (const [key, nestedValue] of Object.entries(customParametersCandidate)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) continue;
    const objectValue = asObject(nestedValue);
    const normalizedValue =
      normalizeString(objectValue?.value) ||
      normalizeString(objectValue?.Value) ||
      normalizeString(nestedValue);
    if (!normalizedValue) continue;
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

function safeParseJson(raw: string): { ok: true; value: JsonObject } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const objectValue = asObject(parsed);
    if (!objectValue) return { ok: false, reason: 'payload_is_not_an_object' };
    return { ok: true, value: objectValue };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'invalid_json' };
  }
}

function rawDataToUtf8(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return '';
}

function sendText(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(body);
}

function sendXml(res: ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  res.end(body);
}

function getHeaderString(req: IncomingMessage, headerName: string): string {
  const value = req.headers[headerName.toLowerCase()];
  if (Array.isArray(value)) return normalizeString(value[0]);
  return normalizeString(value);
}

function buildTwilioMediaWsUrlFromRequest(req: IncomingMessage): string {
  const explicit = normalizeString(process.env.TWILIO_MEDIA_WS_URL);
  if (explicit) return explicit;

  const host = getHeaderString(req, 'x-forwarded-host') || getHeaderString(req, 'host');
  if (!host) return '';

  const forwardedProto = getHeaderString(req, 'x-forwarded-proto').toLowerCase();
  const scheme = forwardedProto === 'http' ? 'ws' : 'wss';
  return `${scheme}://${host}${WS_PATH}`;
}

function handleTwilioVoiceWebhook(req: IncomingMessage, res: ServerResponse): void {
  const mediaWsUrl = buildTwilioMediaWsUrlFromRequest(req);
  if (!/^wss?:\/\//i.test(mediaWsUrl)) {
    sendText(res, 500, 'TWILIO_MEDIA_WS_URL ontbreekt of is ongeldig.');
    return;
  }

  sendXml(
    res,
    200,
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${mediaWsUrl}" />
  </Connect>
</Response>`
  );
}

function buildElevenLabsApiUrl(path: string): string {
  const normalizedBase = ELEVENLABS_API_BASE_URL.replace(/\/+$/, '');
  const baseWithVersion = normalizedBase.endsWith('/v1') ? normalizedBase : `${normalizedBase}/v1`;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseWithVersion}${normalizedPath}`;
}

function buildElevenLabsSignedUrlRequestUrl(): URL {
  const endpoint = new URL(buildElevenLabsApiUrl('/convai/conversation/get-signed-url'));
  if (ELEVENLABS_AGENT_ID) {
    endpoint.searchParams.set('agent_id', ELEVENLABS_AGENT_ID);
  }
  return endpoint;
}

async function fetchElevenLabsSignedUrl(): Promise<string> {
  if (!ELEVENLABS_AGENT_ID) {
    throw new Error('ELEVENLABS_AGENT_ID ontbreekt.');
  }
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY ontbreekt.');
  }

  const endpoint = buildElevenLabsSignedUrlRequestUrl();

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
  });

  const bodyText = await response.text();
  if (!response.ok) {
    const truncated = bodyText.slice(0, 500);
    throw new Error(`signed-url request failed (${response.status}): ${truncated}`);
  }

  const parsed = safeParseJson(bodyText);
  if (parsed.ok === false) {
    throw new Error(`signed-url response invalid JSON: ${parsed.reason}`);
  }

  const signedUrl = asString(parsed.value.signed_url);
  if (!signedUrl) {
    throw new Error('signed-url response mist signed_url.');
  }

  return signedUrl;
}

function safeSendWsJson(ws: WebSocket, payload: JsonObject): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function clampPcm16(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return Math.trunc(value);
}

function decodeMuLawByte(input: number): number {
  const muLaw = (~input) & 0xff;
  const sign = muLaw & 0x80;
  const exponent = (muLaw >> 4) & 0x07;
  const mantissa = muLaw & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  return sign ? -sample : sample;
}

function encodeMuLawSample(input: number): number {
  let sample = clampPcm16(input);
  const sign = sample < 0 ? 0x80 : 0x00;
  if (sample < 0) sample = -sample;
  if (sample > 32635) sample = 32635;
  sample += 0x84;

  let exponent = 7;
  let expMask = 0x4000;
  while (exponent > 0 && (sample & expMask) === 0) {
    exponent -= 1;
    expMask >>= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const encoded = ~(sign | (exponent << 4) | mantissa);
  return encoded & 0xff;
}

function nextAmbienceSample(session: BridgeSession): number {
  // Lightweight synthetic office ambience: filtered random murmur + low hum.
  const white = (Math.random() * 2 - 1) * 0.6;
  session.ambienceNoiseA = session.ambienceNoiseA * 0.96 + white * 0.04;
  session.ambienceNoiseB = session.ambienceNoiseB * 0.985 + session.ambienceNoiseA * 0.015;
  session.ambienceLfoPhase += (2 * Math.PI * 0.23) / TELEPHONY_SAMPLE_RATE;
  if (session.ambienceLfoPhase > Math.PI * 2) session.ambienceLfoPhase -= Math.PI * 2;
  const lfo = 0.72 + 0.28 * Math.sin(session.ambienceLfoPhase);

  session.ambienceHumPhaseA += (2 * Math.PI * 120) / TELEPHONY_SAMPLE_RATE;
  session.ambienceHumPhaseB += (2 * Math.PI * 180) / TELEPHONY_SAMPLE_RATE;
  session.ambienceHumPhaseC += (2 * Math.PI * 320) / TELEPHONY_SAMPLE_RATE;
  if (session.ambienceHumPhaseA > Math.PI * 2) session.ambienceHumPhaseA -= Math.PI * 2;
  if (session.ambienceHumPhaseB > Math.PI * 2) session.ambienceHumPhaseB -= Math.PI * 2;
  if (session.ambienceHumPhaseC > Math.PI * 2) session.ambienceHumPhaseC -= Math.PI * 2;

  const hum =
    Math.sin(session.ambienceHumPhaseA) * 0.55 +
    Math.sin(session.ambienceHumPhaseB) * 0.32 +
    Math.sin(session.ambienceHumPhaseC) * 0.18;

  const combined = (session.ambienceNoiseB * 0.78 + hum * 0.22) * lfo;
  return clampPcm16(combined * 9000);
}

function buildAmbienceMuLawBuffer(session: BridgeSession, sampleCount: number): Buffer {
  const count = Math.max(1, Math.min(3200, Math.floor(sampleCount) || TELEPHONY_FRAME_SAMPLES));
  const out = Buffer.allocUnsafe(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = encodeMuLawSample(nextAmbienceSample(session));
  }
  return out;
}

function mixMuLawWithAmbience(agentMuLaw: Buffer, ambienceMuLaw: Buffer, ambienceLevel: number): Buffer {
  const out = Buffer.allocUnsafe(agentMuLaw.length);
  const bgGain = Math.max(0, Math.min(0.7, ambienceLevel));
  for (let i = 0; i < agentMuLaw.length; i += 1) {
    const speech = decodeMuLawByte(agentMuLaw[i]);
    const ambience = decodeMuLawByte(ambienceMuLaw[i] ?? ULAW_SILENCE_BYTE);
    const mixed = clampPcm16(speech + ambience * bgGain);
    out[i] = encodeMuLawSample(mixed);
  }
  return out;
}

function processAgentAudioForTwilio(session: BridgeSession, audioBase64: string): string {
  if (!audioBase64) return '';
  if (!AMBIENCE_ENABLED || !session.elevenAgentOutputTelephony) return audioBase64;

  let agentAudio: Buffer;
  try {
    agentAudio = Buffer.from(audioBase64, 'base64');
  } catch {
    return audioBase64;
  }
  if (!agentAudio.length) return '';

  const ambience = buildAmbienceMuLawBuffer(session, agentAudio.length);
  const mixed = mixMuLawWithAmbience(agentAudio, ambience, AMBIENCE_LEVEL);
  return mixed.toString('base64');
}

function sendIdleAmbienceFrame(session: BridgeSession): void {
  if (!AMBIENCE_ENABLED) return;
  if (!session.streamSid) return;
  if (session.stopping) return;
  if (Date.now() - session.lastAgentAudioAtMs < AMBIENCE_IDLE_TRIGGER_MS) return;

  const ambienceFrame = buildAmbienceMuLawBuffer(session, TELEPHONY_FRAME_SAMPLES);
  sendAudioToTwilio(session, ambienceFrame.toString('base64'));
}

function startAmbienceTickLoop(session: BridgeSession): void {
  if (!AMBIENCE_ENABLED) return;
  if (session.ambienceTickTimer) return;
  session.ambienceTickTimer = setInterval(() => {
    sendIdleAmbienceFrame(session);
  }, AMBIENCE_TICK_MS);
}

function stopAmbienceTickLoop(session: BridgeSession): void {
  if (!session.ambienceTickTimer) return;
  clearInterval(session.ambienceTickTimer);
  session.ambienceTickTimer = null;
}

function closeElevenLabsForSession(session: BridgeSession, reason: string): void {
  const elevenWs = session.elevenWs;
  if (!elevenWs) return;
  if (elevenWs.readyState === WebSocket.OPEN || elevenWs.readyState === WebSocket.CONNECTING) {
    try {
      elevenWs.close(1000, reason);
    } catch (error) {
      log('WARN', 'failed closing elevenlabs websocket', {
        connectionId: session.connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sendAudioToTwilio(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  if (!session.streamSid) {
    log('WARN', 'dropping elevenlabs audio because streamSid is missing', {
      connectionId: session.connectionId,
    });
    return;
  }

  const ok = safeSendWsJson(session.twilioWs, {
    event: 'media',
    streamSid: session.streamSid,
    media: { payload: audioBase64 },
  });

  if (!ok) {
    log('WARN', 'failed to send audio to twilio (socket not open)', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
    });
    return;
  }

  logVerbose('audio returned to twilio', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    payloadBytes: Buffer.byteLength(audioBase64, 'utf8'),
  });
}

function sendClearToTwilio(session: BridgeSession, reason: string): void {
  if (!session.streamSid) return;

  const ok = safeSendWsJson(session.twilioWs, {
    event: 'clear',
    streamSid: session.streamSid,
  });

  if (!ok) return;
  log('INFO', 'sent clear to twilio', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    reason,
  });
}

function flushBufferedAudioToElevenLabs(session: BridgeSession): void {
  const elevenWs = session.elevenWs;
  if (!elevenWs || elevenWs.readyState !== WebSocket.OPEN) return;

  let flushed = 0;
  while (session.bufferedUserAudioChunks.length > 0) {
    const chunk = session.bufferedUserAudioChunks.shift();
    if (!chunk) continue;
    const ok = safeSendWsJson(elevenWs, { user_audio_chunk: chunk });
    if (!ok) {
      session.bufferedUserAudioChunks.unshift(chunk);
      break;
    }
    flushed += 1;
  }

  if (flushed > 0) {
    log('INFO', 'flushed buffered twilio audio to elevenlabs', {
      connectionId: session.connectionId,
      chunks: flushed,
    });
  }
}

function sendTwilioAudioToElevenLabs(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  if (session.elevenUnavailable) {
    log('WARN', 'audio dropped: elevenlabs marked unavailable for this call', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      payloadBytes: Buffer.byteLength(audioBase64, 'utf8'),
    });
    return;
  }

  const elevenWs = session.elevenWs;
  if (elevenWs && elevenWs.readyState === WebSocket.OPEN) {
    const ok = safeSendWsJson(elevenWs, { user_audio_chunk: audioBase64 });
    if (ok) {
      logVerbose('audio forwarded twilio -> elevenlabs', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        payloadBytes: Buffer.byteLength(audioBase64, 'utf8'),
      });
    } else {
      log('WARN', 'audio forward failed twilio -> elevenlabs (socket not open)', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
      });
    }
    return;
  }

  session.bufferedUserAudioChunks.push(audioBase64);
  logVerbose('audio buffered twilio -> elevenlabs (awaiting elevenlabs websocket)', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    bufferedChunks: session.bufferedUserAudioChunks.length,
    payloadBytes: Buffer.byteLength(audioBase64, 'utf8'),
  });
  if (session.bufferedUserAudioChunks.length > MAX_BUFFERED_TWILIO_AUDIO_CHUNKS) {
    session.bufferedUserAudioChunks.shift();
    log('WARN', 'twilio audio buffer full, dropping oldest chunk', {
      connectionId: session.connectionId,
      maxBufferedChunks: MAX_BUFFERED_TWILIO_AUDIO_CHUNKS,
    });
  }
}

function handleElevenLabsMessage(session: BridgeSession, raw: string): void {
  const parsed = safeParseJson(raw);
  if (parsed.ok === false) {
    log('WARN', 'invalid elevenlabs message ignored', {
      connectionId: session.connectionId,
      reason: parsed.reason,
    });
    return;
  }

  const payload = parsed.value;
  const type = asString(payload.type) || 'unknown';

  if (type === 'conversation_initiation_metadata') {
    const metadata = asObject(payload.conversation_initiation_metadata_event) || {};
    const userInputAudioFormat = asString(metadata.user_input_audio_format);
    const agentOutputAudioFormat = asString(metadata.agent_output_audio_format);
    log('INFO', 'elevenlabs event: conversation_initiation_metadata', {
      connectionId: session.connectionId,
      conversationId: asString(metadata.conversation_id),
      userInputAudioFormat,
      agentOutputAudioFormat,
    });
    const normalizedInput = userInputAudioFormat.toLowerCase();
    const normalizedOutput = agentOutputAudioFormat.toLowerCase();
    const inputLooksTelephony = /ulaw|mulaw|g711/.test(normalizedInput);
    const outputLooksTelephony = /ulaw|mulaw|g711/.test(normalizedOutput);
    session.elevenAgentOutputTelephony = !agentOutputAudioFormat || outputLooksTelephony;
    if ((userInputAudioFormat && !inputLooksTelephony) || (agentOutputAudioFormat && !outputLooksTelephony)) {
      log('WARN', 'elevenlabs audio format may not be telephony-compatible', {
        connectionId: session.connectionId,
        userInputAudioFormat,
        agentOutputAudioFormat,
      });
    }
    return;
  }

  if (type === 'ping') {
    const ping = asObject(payload.ping_event) || {};
    const eventId = ping.event_id;
    const pingMs = typeof ping.ping_ms === 'number' && Number.isFinite(ping.ping_ms) ? ping.ping_ms : 0;
    const sendPong = () => {
      const elevenWs = session.elevenWs;
      if (!elevenWs) return;
      safeSendWsJson(elevenWs, { type: 'pong', event_id: eventId });
    };
    if (pingMs > 0 && pingMs < 30_000) {
      setTimeout(sendPong, pingMs);
    } else {
      sendPong();
    }
    return;
  }

  if (type === 'audio') {
    const audioEvent = asObject(payload.audio_event) || {};
    const audioBase64 = asString(audioEvent.audio_base_64);
    session.lastAgentAudioAtMs = Date.now();
    sendAudioToTwilio(session, processAgentAudioForTwilio(session, audioBase64));
    return;
  }

  if (type === 'interruption') {
    const interruption = asObject(payload.interruption_event) || {};
    log('INFO', 'elevenlabs event: interruption', {
      connectionId: session.connectionId,
      reason: asString(interruption.reason),
    });
    sendClearToTwilio(session, 'elevenlabs_interruption');
    return;
  }

  if (type === 'user_transcript') {
    const transcript = asObject(payload.user_transcription_event) || {};
    log('INFO', 'elevenlabs event: user_transcript', {
      connectionId: session.connectionId,
      text: asString(transcript.user_transcript).slice(0, 180),
    });
    return;
  }

  if (type === 'agent_response') {
    const response = asObject(payload.agent_response_event) || {};
    log('INFO', 'elevenlabs event: agent_response', {
      connectionId: session.connectionId,
      text: asString(response.agent_response).slice(0, 180),
    });
    return;
  }

  log('INFO', 'elevenlabs event: unhandled', {
    connectionId: session.connectionId,
    type,
  });
}

async function connectElevenLabsForSession(session: BridgeSession): Promise<void> {
  if (session.elevenUnavailable) return;
  if (session.elevenConnecting) return;
  if (session.elevenWs && (session.elevenWs.readyState === WebSocket.CONNECTING || session.elevenWs.readyState === WebSocket.OPEN)) {
    return;
  }
  if (session.stopping) return;
  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    session.elevenUnavailable = true;
    log('ERROR', 'elevenlabs connect skipped: required env vars missing', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
      hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
    });
    return;
  }

  session.elevenConnectAttempts += 1;
  session.elevenConnecting = true;
  log('INFO', 'elevenlabs connect start', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    attempt: session.elevenConnectAttempts,
    hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
    hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
    elevenLabsSignedUrlEndpoint: sanitizeUrlForLogs(buildElevenLabsSignedUrlRequestUrl().toString()),
  });

  let signedUrl = '';
  try {
    signedUrl = await fetchElevenLabsSignedUrl();
    log('INFO', 'elevenlabs websocket url resolved', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      elevenLabsWebSocketUrl: sanitizeUrlForLogs(signedUrl),
    });
  } catch (error) {
    session.elevenConnecting = false;
    session.elevenUnavailable = true;
    log('ERROR', 'elevenlabs connect failed before websocket open', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
    return;
  }

  if (session.stopping || session.twilioWs.readyState !== WebSocket.OPEN) {
    session.elevenConnecting = false;
    return;
  }

  const elevenWs = new WebSocket(signedUrl);
  session.elevenWs = elevenWs;

  elevenWs.on('open', () => {
    session.elevenConnecting = false;
    log('INFO', 'elevenlabs websocket open', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
    });
    sendConversationInitiationPayload(session, 'elevenlabs_open');
    if (ELEVENLABS_SEND_USER_ACTIVITY_ON_OPEN) {
      safeSendWsJson(elevenWs, { type: 'user_activity' });
    }
    flushBufferedAudioToElevenLabs(session);
  });

  elevenWs.on('message', (data, isBinary) => {
    if (isBinary) {
      log('WARN', 'binary elevenlabs frame ignored', { connectionId: session.connectionId });
      return;
    }

    const raw = rawDataToUtf8(data);
    if (!raw) {
      log('WARN', 'empty elevenlabs frame ignored', { connectionId: session.connectionId });
      return;
    }

    handleElevenLabsMessage(session, raw);
  });

  elevenWs.on('close', (code, reason) => {
    session.elevenConnecting = false;
    session.elevenWs = null;
    log('WARN', 'elevenlabs websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
  });

  elevenWs.on('error', (error) => {
    log('ERROR', 'elevenlabs websocket error', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
  });
}

const server = http.createServer((req, res) => {
  const path = getPathFromRequest(req);
  if (path === '/api/twilio/voice') {
    handleTwilioVoiceWebhook(req, res);
    return;
  }
  if (path === '/' || path === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }
  sendText(res, 404, 'not found');
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const path = getPathFromRequest(req);

  if (path !== WS_PATH) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const connectionId = ++connectionCounter;
  const remoteAddress = asString(req.headers['x-forwarded-for']) || req.socket.remoteAddress || 'unknown';
  const session: BridgeSession = {
    connectionId,
    twilioWs: ws,
    streamSid: '',
    callSid: '',
    customParameters: {},
    conversationInitiationPayload: null,
    conversationInitiationPayloadSent: false,
    elevenWs: null,
    elevenConnecting: false,
    elevenConnectAttempts: 0,
    elevenUnavailable: false,
    elevenAgentOutputTelephony: true,
    bufferedUserAudioChunks: [],
    lastAgentAudioAtMs: Date.now(),
    ambienceTickTimer: null,
    ambienceNoiseA: 0,
    ambienceNoiseB: 0,
    ambienceLfoPhase: Math.random() * Math.PI * 2,
    ambienceHumPhaseA: Math.random() * Math.PI * 2,
    ambienceHumPhaseB: Math.random() * Math.PI * 2,
    ambienceHumPhaseC: Math.random() * Math.PI * 2,
    stopping: false,
  };

  log('INFO', 'twilio websocket connected', {
    connectionId: session.connectionId,
    remoteAddress,
    path: WS_PATH,
  });
  if (!session.elevenWs && !session.elevenConnecting && !session.elevenUnavailable) {
    void connectElevenLabsForSession(session);
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      log('WARN', 'binary twilio frame ignored', { connectionId: session.connectionId });
      return;
    }

    const raw = rawDataToUtf8(data);
    if (!raw) {
      log('WARN', 'empty twilio frame ignored', { connectionId: session.connectionId });
      return;
    }

    const parsed = safeParseJson(raw);
    if (parsed.ok === false) {
      log('WARN', 'invalid twilio message ignored', {
        connectionId: session.connectionId,
        reason: parsed.reason,
      });
      return;
    }

    const payload = parsed.value;
    const event = asString(payload.event) || 'unknown';
    const payloadStreamSid = asString(payload.streamSid);
    if (!session.streamSid && payloadStreamSid) session.streamSid = payloadStreamSid;

    if (event === 'connected') {
      log('INFO', 'twilio event: connected', { connectionId: session.connectionId });
      if (!session.elevenWs && !session.elevenConnecting && !session.elevenUnavailable) {
        void connectElevenLabsForSession(session);
      }
      return;
    }

    if (event === 'start') {
      const start = asObject(payload.start) || {};
      session.streamSid = asString(start.streamSid) || session.streamSid;
      session.callSid = asString(start.callSid) || session.callSid;
      session.customParameters = extractTwilioCustomParameters(start.customParameters);
      session.conversationInitiationPayload = buildConversationInitiationPayload(session.customParameters);
      session.conversationInitiationPayloadSent = false;

      log('INFO', 'twilio event: start', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
        customParameterKeys: Object.keys(session.customParameters),
      });
      log('INFO', 'elevenlabs call-start config', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
        hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
        hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
        elevenLabsSignedUrlEndpoint: sanitizeUrlForLogs(buildElevenLabsSignedUrlRequestUrl().toString()),
        elevenLabsWebSocketUrl: 'dynamic signed URL (resolved during connect)',
      });
      if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
        session.elevenUnavailable = true;
        log('ERROR', 'call has missing ElevenLabs configuration; realtime bridge will not start', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          callSid: session.callSid,
          hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
          hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
        });
      }

      sendConversationInitiationPayload(session, 'twilio_start');
      void connectElevenLabsForSession(session);
      startAmbienceTickLoop(session);
      return;
    }

    if (event === 'media') {
      const media = asObject(payload.media) || {};
      const mediaPayload = asString(media.payload);

      logVerbose('twilio event: media', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        chunk: asString(media.chunk),
        timestamp: asString(media.timestamp),
        payloadBytes: mediaPayload ? Buffer.byteLength(mediaPayload, 'utf8') : 0,
      });

      sendTwilioAudioToElevenLabs(session, mediaPayload);
      if (!session.elevenWs && !session.elevenConnecting) {
        void connectElevenLabsForSession(session);
      }
      return;
    }

    if (event === 'stop') {
      const stop = asObject(payload.stop) || {};
      session.streamSid = session.streamSid || asString(stop.streamSid);
      session.callSid = session.callSid || asString(stop.callSid);
      session.stopping = true;

      log('INFO', 'twilio event: stop', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
      });

      stopAmbienceTickLoop(session);
      closeElevenLabsForSession(session, 'twilio_stop');
      return;
    }

    log('INFO', 'twilio event: unhandled', { connectionId: session.connectionId, event });
  });

  ws.on('close', (code, reason) => {
    session.stopping = true;
    stopAmbienceTickLoop(session);
    closeElevenLabsForSession(session, 'twilio_close');
    log('INFO', 'twilio websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
  });

  ws.on('error', (error) => {
    stopAmbienceTickLoop(session);
    log('ERROR', 'twilio websocket error', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      ...errorDetails(error),
    });
  });
});

server.on('error', (error) => {
  log('ERROR', 'http server error', { error: error.message });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  log('ERROR', 'unhandled promise rejection', { error: message });
});

process.on('uncaughtException', (error) => {
  log('ERROR', 'uncaught exception', { error: error.message });
});

server.listen(PORT, () => {
  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    log('WARN', 'missing ElevenLabs env vars; audio bridge to ElevenLabs will fail', {
      hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
      hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
    });
  }

  log('INFO', 'twilio media bridge listening', {
    port: PORT,
    health: '/',
    healthz: '/healthz',
    websocket: WS_PATH,
    ambienceEnabled: AMBIENCE_ENABLED,
    ambienceLevel: AMBIENCE_LEVEL,
    ambienceIdleTriggerMs: AMBIENCE_IDLE_TRIGGER_MS,
  });
});
