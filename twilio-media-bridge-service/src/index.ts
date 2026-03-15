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
  agentAudioQueue: Buffer[];
  ambienceOffsetBytes: number;
  outboundInterval: NodeJS.Timeout | null;
  outboundFramesSent: number;
  outboundFramesDropped: number;
  outboundMediaIgnored: number;
  bufferedUserAudioChunks: string[];
  stopping: boolean;
};

const PORT = Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 3000;
const WS_PATH = '/twilio-media';
const MAX_BUFFERED_TWILIO_AUDIO_CHUNKS = 200;
const MAX_AGENT_AUDIO_QUEUE_FRAMES = 300;
const MAX_TWILIO_WS_BUFFERED_BYTES = 128 * 1024;
const TWILIO_MEDIA_CHUNK_MS = 20;
const TWILIO_ULAW_8K_CHUNK_BYTES = 160;
const ELEVENLABS_AGENT_ID = normalizeString(process.env.ELEVENLABS_AGENT_ID);
const ELEVENLABS_API_KEY = normalizeString(process.env.ELEVENLABS_API_KEY);
const ELEVENLABS_API_BASE_URL = normalizeString(process.env.ELEVENLABS_API_BASE_URL || 'https://api.elevenlabs.io');
const AMBIENCE_ENABLED = parseBooleanEnv(process.env.AMBIENCE_ENABLED, true);
const AMBIENCE_FILE_PATH = normalizeString(process.env.AMBIENCE_FILE_PATH || 'assets/office-ambience.wav');
const AMBIENCE_GAIN = Math.min(1, Math.max(0, parseNumberEnv(process.env.AMBIENCE_GAIN, 0.06)));
const AMBIENCE_UNDER_AGENT_GAIN = Math.min(1, Math.max(0, parseNumberEnv(process.env.AMBIENCE_UNDER_AGENT_GAIN, 0.5)));
const OUTBOUND_AGENT_PRIORITY_QUEUE_THRESHOLD = 6;
const OUTBOUND_AMBIENCE_BACKPRESSURE_BYTES = 64 * 1024;

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

function parseNumberEnv(value: unknown, fallback: number): number {
  const normalized = normalizeString(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
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

function resolveAmbiencePath(filePath: string): string {
  if (!filePath) return '';
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function setNoDelay(socket: unknown): void {
  try {
    const candidate = socket as { setNoDelay?: (noDelay?: boolean) => void } | null;
    if (candidate && typeof candidate.setNoDelay === 'function') {
      candidate.setNoDelay(true);
    }
  } catch {
    // Ignore socket tuning failures.
  }
}

function getLoopingChunk(source: Buffer, offset: number, size: number): { chunk: Buffer; nextOffset: number } {
  if (source.length === 0) return { chunk: Buffer.alloc(0), nextOffset: 0 };

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

  const resolvedPath = resolveAmbiencePath(AMBIENCE_FILE_PATH);
  if (!resolvedPath || !existsSync(resolvedPath)) {
    ambienceDisabledReason = `ambience file not found: ${resolvedPath || '(empty)'}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  if (extension === '.mulaw' || extension === '.ulaw' || extension === '.g711u') {
    const raw = readFileSync(resolvedPath);
    if (!raw.length) {
      ambienceDisabledReason = 'ambience file is empty';
      log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
      return;
    }
    ambienceMuLawAudio = raw;
    log('INFO', 'ambience loaded (raw mulaw)', {
      bytes: raw.length,
      filePath: resolvedPath,
      gain: AMBIENCE_GAIN,
    });
    return;
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
    { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }
  );

  if (converted.error || converted.status !== 0) {
    const stderrText = Buffer.isBuffer(converted.stderr) ? converted.stderr.toString('utf8').slice(0, 300) : '';
    ambienceDisabledReason = converted.error
      ? `ffmpeg start failed: ${converted.error.message}`
      : `ffmpeg convert failed (exit ${converted.status}): ${stderrText || 'unknown error'}`;
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  const output = Buffer.isBuffer(converted.stdout) ? converted.stdout : Buffer.alloc(0);
  if (!output.length) {
    ambienceDisabledReason = 'ffmpeg returned empty audio';
    log('WARN', 'ambience disabled', { reason: ambienceDisabledReason });
    return;
  }

  ambienceMuLawAudio = output;
  log('INFO', 'ambience loaded (converted)', {
    bytes: output.length,
    sourceFilePath: resolvedPath,
    gain: AMBIENCE_GAIN,
  });
}

function shouldForwardTwilioMediaToElevenLabs(track: string): boolean {
  const normalized = normalizeString(track).toLowerCase();
  if (!normalized) return true;
  if (normalized === 'inbound' || normalized === 'inbound_track' || normalized.includes('inbound')) return true;
  if (normalized === 'outbound' || normalized === 'outbound_track' || normalized.includes('outbound')) return false;
  if (normalized.includes('both')) return false;
  return true;
}

function muLawByteToPcm16(sample: number): number {
  const mu = (~sample) & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  const magnitude = ((mantissa << 3) + 0x84) << exponent;
  const pcm = magnitude - 0x84;
  return sign ? -pcm : pcm;
}

const MU_LAW_TO_PCM16 = Int16Array.from({ length: 256 }, (_, i) => muLawByteToPcm16(i));

function pcm16ToMuLaw(sample: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;

  let pcm = Math.max(-32768, Math.min(32767, Math.trunc(sample)));
  const sign = pcm < 0 ? 0x80 : 0;
  if (sign) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (pcm & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return (~(sign | (exponent << 4) | mantissa)) & 0xff;
}

function applyMuLawGain(frame: Buffer, gain: number): Buffer {
  const out = Buffer.allocUnsafe(TWILIO_ULAW_8K_CHUNK_BYTES);
  for (let i = 0; i < TWILIO_ULAW_8K_CHUNK_BYTES; i += 1) {
    const pcm = MU_LAW_TO_PCM16[frame[i] as number];
    out[i] = pcm16ToMuLaw(pcm * gain);
  }
  return out;
}

function mixMuLawFrames(agentFrame: Buffer, ambienceFrame: Buffer, ambienceGain: number): Buffer {
  const out = Buffer.allocUnsafe(TWILIO_ULAW_8K_CHUNK_BYTES);
  for (let i = 0; i < TWILIO_ULAW_8K_CHUNK_BYTES; i += 1) {
    const agentPcm = MU_LAW_TO_PCM16[agentFrame[i] as number];
    const ambiencePcm = MU_LAW_TO_PCM16[ambienceFrame[i] as number];
    const mixed = agentPcm + ambiencePcm * ambienceGain;
    out[i] = pcm16ToMuLaw(mixed);
  }
  return out;
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

function sendAudioFrameToTwilio(session: BridgeSession, frame: Buffer): boolean {
  if (!frame.length || !session.streamSid) return false;
  if (session.twilioWs.bufferedAmount > MAX_TWILIO_WS_BUFFERED_BYTES) {
    session.outboundFramesDropped += 1;
    return false;
  }

  const audioBase64 = frame.toString('base64');
  if (!session.streamSid) {
    return false;
  }

  const ok = safeSendWsJson(session.twilioWs, {
    event: 'media',
    streamSid: session.streamSid,
    media: { payload: audioBase64 },
  });

  if (!ok) {
    session.outboundFramesDropped += 1;
    return false;
  }
  session.outboundFramesSent += 1;
  return true;
}

function enqueueAgentAudioForTwilio(session: BridgeSession, audioBase64: string): void {
  if (!audioBase64) return;
  const raw = Buffer.from(audioBase64, 'base64');
  if (!raw.length) return;

  for (let offset = 0; offset < raw.length; offset += TWILIO_ULAW_8K_CHUNK_BYTES) {
    const frame = Buffer.alloc(TWILIO_ULAW_8K_CHUNK_BYTES, 0xff);
    raw.copy(frame, 0, offset, Math.min(offset + TWILIO_ULAW_8K_CHUNK_BYTES, raw.length));
    session.agentAudioQueue.push(frame);
  }

  while (session.agentAudioQueue.length > MAX_AGENT_AUDIO_QUEUE_FRAMES) {
    session.agentAudioQueue.shift();
    session.outboundFramesDropped += 1;
  }
}

function startOutboundLoop(session: BridgeSession): void {
  if (session.outboundInterval) return;
  session.outboundInterval = setInterval(() => {
    if (session.stopping || session.twilioWs.readyState !== WebSocket.OPEN || !session.streamSid) {
      return;
    }

    const hasAmbience = Boolean(AMBIENCE_ENABLED && ambienceMuLawAudio && ambienceMuLawAudio.length > 0);
    let ambienceFrame: Buffer | null = null;
    if (hasAmbience && ambienceMuLawAudio) {
      const ambience = getLoopingChunk(ambienceMuLawAudio, session.ambienceOffsetBytes, TWILIO_ULAW_8K_CHUNK_BYTES);
      session.ambienceOffsetBytes = ambience.nextOffset;
      ambienceFrame = ambience.chunk;
    }

    const agentFrame = session.agentAudioQueue.shift() || null;
    const ambienceAllowed =
      session.twilioWs.bufferedAmount <= OUTBOUND_AMBIENCE_BACKPRESSURE_BYTES &&
      session.agentAudioQueue.length <= OUTBOUND_AGENT_PRIORITY_QUEUE_THRESHOLD;

    if (agentFrame && ambienceFrame) {
      if (ambienceAllowed && AMBIENCE_GAIN > 0 && AMBIENCE_UNDER_AGENT_GAIN > 0) {
        sendAudioFrameToTwilio(session, mixMuLawFrames(agentFrame, ambienceFrame, AMBIENCE_GAIN * AMBIENCE_UNDER_AGENT_GAIN));
      } else {
        sendAudioFrameToTwilio(session, agentFrame);
      }
      return;
    }
    if (agentFrame) {
      sendAudioFrameToTwilio(session, agentFrame);
      return;
    }
    if (ambienceFrame) {
      if (ambienceAllowed && AMBIENCE_GAIN > 0) {
        sendAudioFrameToTwilio(session, applyMuLawGain(ambienceFrame, AMBIENCE_GAIN));
      }
    }
  }, TWILIO_MEDIA_CHUNK_MS);
}

function stopOutboundLoop(session: BridgeSession): void {
  if (!session.outboundInterval) return;
  clearInterval(session.outboundInterval);
  session.outboundInterval = null;
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
    if (!ok) {
      log('WARN', 'audio forward failed twilio -> elevenlabs (socket not open)', {
        connectionId: session.connectionId,
        streamSid: session.streamSid,
      });
    }
    return;
  }

  session.bufferedUserAudioChunks.push(audioBase64);
  if (session.bufferedUserAudioChunks.length === 1 || session.bufferedUserAudioChunks.length % 25 === 0) {
    log('INFO', 'audio buffered twilio -> elevenlabs (awaiting elevenlabs websocket)', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      bufferedChunks: session.bufferedUserAudioChunks.length,
    });
  }
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
    enqueueAgentAudioForTwilio(session, audioBase64);
    return;
  }

  if (type === 'interruption') {
    const interruption = asObject(payload.interruption_event) || {};
    log('INFO', 'elevenlabs event: interruption', {
      connectionId: session.connectionId,
      reason: asString(interruption.reason),
    });
    session.agentAudioQueue.length = 0;
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

  const elevenWs = new WebSocket(signedUrl, { perMessageDeflate: false });
  session.elevenWs = elevenWs;

  elevenWs.on('open', () => {
    setNoDelay((elevenWs as unknown as { _socket?: unknown })._socket);
    session.elevenConnecting = false;
    log('INFO', 'elevenlabs websocket open', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
    });
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

loadAmbienceMuLawAudioBuffer();

const server = http.createServer((req, res) => {
  const path = getPathFromRequest(req);
  if (path === '/' || path === '/healthz') {
    sendText(res, 200, 'ok');
    return;
  }
  sendText(res, 404, 'not found');
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  setNoDelay(socket);
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
  setNoDelay(req.socket);
  setNoDelay((ws as unknown as { _socket?: unknown })._socket);
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
    agentAudioQueue: [],
    ambienceOffsetBytes: 0,
    outboundInterval: null,
    outboundFramesSent: 0,
    outboundFramesDropped: 0,
    outboundMediaIgnored: 0,
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

      startOutboundLoop(session);
      void connectElevenLabsForSession(session);
      return;
    }

    if (event === 'media') {
      const media = asObject(payload.media) || {};
      const mediaPayload = asString(media.payload);
      const mediaTrack = asString(media.track);
      if (shouldForwardTwilioMediaToElevenLabs(mediaTrack)) {
        sendTwilioAudioToElevenLabs(session, mediaPayload);
      } else {
        session.outboundMediaIgnored += 1;
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

      session.agentAudioQueue.length = 0;
      stopOutboundLoop(session);
      closeElevenLabsForSession(session, 'twilio_stop');
      return;
    }

    log('INFO', 'twilio event: unhandled', { connectionId: session.connectionId, event });
  });

  ws.on('close', (code, reason) => {
    session.stopping = true;
    session.agentAudioQueue.length = 0;
    stopOutboundLoop(session);
    closeElevenLabsForSession(session, 'twilio_close');
    log('INFO', 'twilio websocket close', {
      connectionId: session.connectionId,
      streamSid: session.streamSid,
      callSid: session.callSid,
      code,
      reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason || ''),
      outboundFramesSent: session.outboundFramesSent,
      outboundFramesDropped: session.outboundFramesDropped,
      outboundMediaIgnored: session.outboundMediaIgnored,
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
  if (!ELEVENLABS_AGENT_ID || !ELEVENLABS_API_KEY) {
    log('WARN', 'missing ElevenLabs env vars; audio bridge to ElevenLabs will fail', {
      hasElevenLabsAgentId: Boolean(ELEVENLABS_AGENT_ID),
      hasElevenLabsApiKey: Boolean(ELEVENLABS_API_KEY),
    });
  }

  log('INFO', 'ambience config', {
    AMBIENCE_ENABLED,
    AMBIENCE_FILE_PATH: AMBIENCE_FILE_PATH || '(empty)',
    AMBIENCE_GAIN,
    AMBIENCE_UNDER_AGENT_GAIN,
    OUTBOUND_AMBIENCE_BACKPRESSURE_BYTES,
    OUTBOUND_AGENT_PRIORITY_QUEUE_THRESHOLD,
    ambienceLoaded: Boolean(ambienceMuLawAudio && ambienceMuLawAudio.length > 0),
    ambienceDisabledReason: ambienceDisabledReason || '(none)',
  });

  log('INFO', 'twilio media bridge listening', {
    port: PORT,
    health: '/',
    healthz: '/healthz',
    websocket: WS_PATH,
  });
});
