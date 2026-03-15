import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

type JsonObject = Record<string, unknown>;
type LogLevel = 'INFO' | 'WARN' | 'ERROR';

type BridgeSession = {
  connectionId: number;
  twilioWs: WebSocket;
  streamSid: string;
  callSid: string;
  elevenWs: WebSocket | null;
  elevenConnecting: boolean;
  elevenConnectAttempts: number;
  elevenUnavailable: boolean;
  agentSpeaking: boolean;
  ambienceActive: boolean;
  ambienceOffsetBytes: number;
  ambienceInterval: NodeJS.Timeout | null;
  agentSilenceTimer: NodeJS.Timeout | null;
  bufferedUserAudioChunks: string[];
  stopping: boolean;
};

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const WS_PATH = '/twilio-media';
const MAX_BUFFERED_TWILIO_AUDIO_CHUNKS = 200;
const TWILIO_MEDIA_CHUNK_MS = 20;
const TWILIO_ULAW_8K_CHUNK_BYTES = 160;
const AGENT_SILENCE_TO_AMBIENCE_MS = 900;
const ELEVENLABS_AGENT_ID = normalizeString(process.env.ELEVENLABS_AGENT_ID);
const ELEVENLABS_API_KEY = normalizeString(process.env.ELEVENLABS_API_KEY);
const ELEVENLABS_API_BASE_URL = normalizeString(process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io');
const AMBIENCE_ENABLED = parseBooleanEnv(process.env.AMBIENCE_ENABLED, false);
const AMBIENCE_FILE_PATH = normalizeString(process.env.AMBIENCE_FILE_PATH);

let connectionCounter = 0;
let ambienceMuLawAudio: Buffer | null = null;
let ambienceDisabledReason = '';

function log(level: LogLevel, message: string, meta?: JsonObject): void {
  const ts = new Date().toISOString();
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[${ts}] [${level}] ${message}`, meta);
    return;
  }
  console.log(`[${ts}] [${level}] ${message}`);
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBooleanEnv(value: unknown, fallback: boolean): boolean {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveAmbiencePath(filePath: string): string {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function getLoopingChunk(source: Buffer, offset: number, size: number): { chunk: Buffer; nextOffset: number } {
  if (source.length === 0) {
    return { chunk: Buffer.alloc(0), nextOffset: 0 };
  }

  const chunk = Buffer.alloc(size);
  let writeOffset = 0;
  let readOffset = offset % source.length;
  while (writeOffset < size) {
    const remainingSource = source.length - readOffset;
    const remainingChunk = size - writeOffset;
    const copySize = Math.min(remainingSource, remainingChunk);
    source.copy(chunk, writeOffset, readOffset, readOffset + copySize);
    writeOffset += copySize;
    readOffset = (readOffset + copySize) % source.length;
  }

  return { chunk, nextOffset: readOffset };
}

function loadAmbienceMuLawAudioBuffer(): void {
  ambienceMuLawAudio = null;
  ambienceDisabledReason = '';

  if (!AMBIENCE_ENABLED) {
    ambienceDisabledReason = 'AMBIENCE_ENABLED=false';
    log('INFO', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  if (!AMBIENCE_FILE_PATH) {
    ambienceDisabledReason = 'AMBIENCE_FILE_PATH ontbreekt';
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const resolvedPath = resolveAmbiencePath(AMBIENCE_FILE_PATH);
  if (!existsSync(resolvedPath)) {
    ambienceDisabledReason = `ambience file niet gevonden: ${resolvedPath}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === '.mulaw' || extension === '.ulaw' || extension === '.g711u') {
    try {
      const directBuffer = readFileSync(resolvedPath);
      if (!directBuffer.length) {
        ambienceDisabledReason = 'ambience file is leeg';
        log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
        return;
      }
      ambienceMuLawAudio = directBuffer;
      log('INFO', 'ambience loaded (raw mulaw)', {
        bytes: directBuffer.length,
        filePath: resolvedPath,
      });
      return;
    } catch (error) {
      ambienceDisabledReason = `raw ambience read mislukt: ${
        error instanceof Error ? error.message : String(error)
      }`;
      log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
      return;
    }
  }

  const converted = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      resolvedPath,
      '-ac',
      '1',
      '-ar',
      '8000',
      '-f',
      'mulaw',
      'pipe:1',
    ],
    {
      encoding: 'buffer',
      maxBuffer: 50 * 1024 * 1024,
    }
  );

  if (converted.error) {
    ambienceDisabledReason = `ffmpeg start mislukt: ${converted.error.message}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  if (converted.status !== 0) {
    const stderrText = Buffer.isBuffer(converted.stderr) ? converted.stderr.toString('utf8').slice(0, 400) : '';
    ambienceDisabledReason = `ffmpeg convert failed (exit ${converted.status}): ${stderrText || 'unknown error'}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const output = Buffer.isBuffer(converted.stdout) ? converted.stdout : Buffer.alloc(0);
  if (!output.length) {
    ambienceDisabledReason = 'ffmpeg gaf geen audio output';
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  ambienceMuLawAudio = output;
  log('INFO', 'ambience loaded (converted to mulaw/8000/mono)', {
    bytes: output.length,
    sourceFilePath: resolvedPath,
  });
}

function clearAgentSilenceTimer(session: BridgeSession): void {
  if (!session.agentSilenceTimer) return;
  clearTimeout(session.agentSilenceTimer);
  session.agentSilenceTimer = null;
}

function stopAmbience(session: BridgeSession, reason: string): void {
  if (session.ambienceInterval) {
    clearInterval(session.ambienceInterval);
    session.ambienceInterval = null;
  }
  if (!session.ambienceActive) return;
  session.ambienceActive = false;
  log('INFO', 'ambience stopped', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    reason,
  });
}

function startAmbience(session: BridgeSession, reason: string): void {
  if (session.stopping || session.ambienceActive) return;
  if (!AMBIENCE_ENABLED || !ambienceMuLawAudio || ambienceMuLawAudio.length === 0) {
    return;
  }
  if (!session.streamSid || session.twilioWs.readyState !== WebSocket.OPEN) {
    return;
  }

  session.ambienceActive = true;
  if (!session.ambienceOffsetBytes || session.ambienceOffsetBytes >= ambienceMuLawAudio.length) {
    session.ambienceOffsetBytes = 0;
  }

  log('INFO', 'ambience started', {
    connectionId: session.connectionId,
    streamSid: session.streamSid,
    callSid: session.callSid,
    reason,
  });

  session.ambienceInterval = setInterval(() => {
    if (session.stopping || session.twilioWs.readyState !== WebSocket.OPEN || !session.streamSid) {
      stopAmbience(session, 'call_inactive');
      return;
    }
    if (!ambienceMuLawAudio || ambienceMuLawAudio.length === 0) {
      stopAmbience(session, 'ambience_unavailable');
      return;
    }

    const { chunk, nextOffset } = getLoopingChunk(
      ambienceMuLawAudio,
      session.ambienceOffsetBytes,
      TWILIO_ULAW_8K_CHUNK_BYTES
    );
    session.ambienceOffsetBytes = nextOffset;

    const ok = safeSendWsJson(session.twilioWs, {
      event: 'media',
      streamSid: session.streamSid,
      media: { payload: chunk.toString('base64') },
    });

    if (!ok) {
      stopAmbience(session, 'twilio_send_failed');
    }
  }, TWILIO_MEDIA_CHUNK_MS);
}

function scheduleAmbienceStartOnSilence(session: BridgeSession, reason: string): void {
  clearAgentSilenceTimer(session);
  if (session.stopping) return;
  session.agentSilenceTimer = setTimeout(() => {
    session.agentSilenceTimer = null;
    session.agentSpeaking = false;
    startAmbience(session, reason);
  }, AGENT_SILENCE_TO_AMBIENCE_MS);
}

function cleanupSessionState(session: BridgeSession, reason: string): void {
  clearAgentSilenceTimer(session);
  stopAmbience(session, reason);
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonObject;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shouldForwardTwilioMediaToElevenLabs(track: string): boolean {
  const normalized = normalizeString(track).toLowerCase();
  if (!normalized) return true;
  if (normalized === 'inbound' || normalized === 'inbound_track') return true;
  if (normalized === 'outbound' || normalized === 'outbound_track') return false;
  return true;
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
  if (!parsed.ok) {
    throw new Error(`signed-url response invalid JSON: ${'reason' in parsed ? parsed.reason : 'invalid_json'}`);
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

  log('INFO', 'audio returned to twilio', {
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
  log('INFO', 'clear sent to twilio', {
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
      log('INFO', 'audio forwarded twilio -> elevenlabs', {
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
  log('INFO', 'audio buffered twilio -> elevenlabs (awaiting elevenlabs websocket)', {
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
  if (!parsed.ok) {
    log('WARN', 'invalid elevenlabs message ignored', {
      connectionId: session.connectionId,
      reason: 'reason' in parsed ? parsed.reason : 'invalid_json',
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
    if (!audioBase64) return;

    if (!session.agentSpeaking) {
      sendClearToTwilio(session, 'agent_audio_resumed');
      stopAmbience(session, 'agent_audio_resumed');
      log('INFO', 'agent audio resumed', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
      });
    }
    session.agentSpeaking = true;
    scheduleAmbienceStartOnSilence(session, 'agent_silence');
    sendAudioToTwilio(session, audioBase64);
    return;
  }

  if (type === 'interruption') {
    const interruption = asObject(payload.interruption_event) || {};
    log('INFO', 'elevenlabs event: interruption', {
      connectionId: session.connectionId,
      reason: asString(interruption.reason),
    });
    sendClearToTwilio(session, 'elevenlabs_interruption');
    session.agentSpeaking = false;
    scheduleAmbienceStartOnSilence(session, 'elevenlabs_interruption');
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
    flushBufferedAudioToElevenLabs(session);
    scheduleAmbienceStartOnSilence(session, 'waiting_for_agent_audio');
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
    session.agentSpeaking = false;
    log('WARN', 'elevenlabs websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
    });
    if (!session.stopping) {
      startAmbience(session, 'elevenlabs_ws_closed');
    }
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

loadAmbienceMuLawAudioBuffer();

const server = http.createServer((req, res) => {
  const path = getPathFromRequest(req);
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
    elevenWs: null,
    elevenConnecting: false,
    elevenConnectAttempts: 0,
    elevenUnavailable: false,
    agentSpeaking: false,
    ambienceActive: false,
    ambienceOffsetBytes: 0,
    ambienceInterval: null,
    agentSilenceTimer: null,
    bufferedUserAudioChunks: [],
    stopping: false,
  };

  log('INFO', 'twilio websocket connected', {
    connectionId: session.connectionId,
    remoteAddress,
    path: WS_PATH,
  });

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
    if (!parsed.ok) {
      log('WARN', 'invalid twilio message ignored', {
        connectionId: session.connectionId,
        reason: 'reason' in parsed ? parsed.reason : 'invalid_json',
      });
      return;
    }

    const payload = parsed.value;
    const event = asString(payload.event) || 'unknown';
    const payloadStreamSid = asString(payload.streamSid);
    if (!session.streamSid && payloadStreamSid) session.streamSid = payloadStreamSid;

    if (event === 'connected') {
      log('INFO', 'twilio event: connected', { connectionId: session.connectionId });
      return;
    }

    if (event === 'start') {
      const start = asObject(payload.start) || {};
      session.streamSid = asString(start.streamSid) || session.streamSid;
      session.callSid = asString(start.callSid) || session.callSid;

      log('INFO', 'twilio event: start', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        callSid: session.callSid,
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
      if (AMBIENCE_ENABLED && !ambienceMuLawAudio) {
        log('WARN', 'ambience disabled for call', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          callSid: session.callSid,
          reason: ambienceDisabledReason || 'ambience audio not available',
        });
      }
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

      scheduleAmbienceStartOnSilence(session, 'call_started_waiting_for_agent');
      void connectElevenLabsForSession(session);
      return;
    }

    if (event === 'media') {
      const media = asObject(payload.media) || {};
      const mediaPayload = asString(media.payload);
      const mediaTrack = asString(media.track);

      log('INFO', 'twilio event: media', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
        track: mediaTrack || 'unknown',
        chunk: asString(media.chunk),
        timestamp: asString(media.timestamp),
        payloadBytes: mediaPayload ? Buffer.byteLength(mediaPayload, 'utf8') : 0,
      });

      if (shouldForwardTwilioMediaToElevenLabs(mediaTrack)) {
        sendTwilioAudioToElevenLabs(session, mediaPayload);
      } else {
        log('INFO', 'twilio outbound media ignored for elevenlabs', {
          connectionId: session.connectionId,
          streamSid: session.streamSid,
          track: mediaTrack,
        });
      }
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

      cleanupSessionState(session, 'twilio_stop');
      closeElevenLabsForSession(session, 'twilio_stop');
      return;
    }

    log('INFO', 'twilio event: unhandled', { connectionId: session.connectionId, event });
  });

  ws.on('close', (code, reason) => {
    session.stopping = true;
    cleanupSessionState(session, 'twilio_close');
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
  log('INFO', 'ambience startup config', {
    AMBIENCE_ENABLED,
    AMBIENCE_FILE_PATH: AMBIENCE_FILE_PATH || '(empty)',
    ffmpeg: 'used for non-mulaw ambience conversion',
  });

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
  });
});
